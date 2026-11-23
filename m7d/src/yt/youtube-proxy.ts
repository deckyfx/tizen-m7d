import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import type { TvTarget } from "../services/settings-store";
import { MITM_HOSTS } from "./mitm-server";

/** Traffic per destination host. */
export interface HostTraffic {
  host: string;
  connections: number;
  bytes: number;
}

/** Live state of the proxy (shown on the YouTube page). */
export interface ProxyStats {
  listening: boolean;
  port: number;
  /** Addresses admitted (the TV + YT_PROXY_ALLOW). */
  allowed: string[];
  startedAt: string | null;
  /** Why it is not listening (e.g. EADDRINUSE). */
  error: string | null;
  activeConnections: number;
  totalConnections: number;
  /** Connections from addresses outside the allowlist (dropped). */
  rejected: number;
  lastRejected: { ip: string; at: string } | null;
  /** Last connection from the TV. */
  lastTvAt: string | null;
  bytesFromClients: number;
  bytesToClients: number;
  /** Busiest destinations, most bytes first. */
  topHosts: HostTraffic[];
}

/** Largest request head accepted before the first blank line. */
const MAX_HEAD = 16 * 1024;

/** A client must send its request head within this time. */
const HEAD_TIMEOUT_MS = 10_000;

/** How many destination hosts are tracked. */
const MAX_TRACKED_HOSTS = 200;

/** `CONNECT host:port` target (IPv6 in brackets). */
const CONNECT_TARGET = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+)):(\d{1,5})$/i;

/** `::ffff:192.0.2.10` → `192.0.2.10`. */
function plainIp(address: string | undefined): string {
  return (address ?? "").replace(/^::ffff:/, "");
}

/** Writes a minimal HTTP response and closes the socket. */
function reply(socket: Socket, status: string, body = ""): void {
  socket.end(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

/** Rewrites a plain-HTTP request head so the upstream connection closes after one exchange. */
function closingHead(head: string): string {
  const lines = head.split("\r\n").filter((line) => !/^(proxy-)?connection:/i.test(line));
  // lines ends with ["", ""] (the blank line); insert before it.
  lines.splice(lines.length - 2, 0, "Connection: close");
  return lines.join("\r\n");
}

/**
 * The HTTP proxy Cobalt on the TV is started with (`--proxy=http://<homelab>:8101`).
 *
 * - Only the TV (and `YT_PROXY_ALLOW`) may connect, so this is not an open proxy on the LAN.
 * - `CONNECT` to the intercepted YouTube hosts goes to the {@link MitmServer} loopback port; every
 *   other host (video from googlevideo.com) is a raw TCP tunnel, so 4K streams cost no TLS work.
 * - It listens at once on start: no key generation before `listen()`.
 */
export class YoutubeProxy {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  /** Admitted client connections still open (for live byte counts). */
  private readonly clients = new Set<Socket>();
  /** Open upstream connections and their host (for live per-host bytes). */
  private readonly tunnels = new Map<Socket, string>();
  private readonly traffic = new Map<string, HostTraffic>();
  private readonly extraAllowed: string[];
  private readonly counters = {
    startedAt: null as string | null,
    error: null as string | null,
    totalConnections: 0,
    rejected: 0,
    lastRejected: null as ProxyStats["lastRejected"],
    lastTvAt: null as string | null,
    bytesFromClients: 0,
    bytesToClients: 0,
  };

  constructor(
    private readonly port: number,
    extraAllowed: string[],
    /** The TV (its current IP is always admitted). */
    private readonly target: TvTarget,
    /** Loopback port of the {@link MitmServer} (read on every tunnel; set once it listens). */
    private readonly mitmPort: () => number,
  ) {
    this.extraAllowed = extraAllowed;
  }

  /**
   * Starts listening on all interfaces. Retries briefly while the port is still held (a
   * `bun --hot` reload closes the previous instance just before); resolves false and records
   * why when it stays taken.
   */
  async start(attempts = 10): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const error = await this.listenOnce();
      if (!error) return true;
      this.counters.error = `${error.code ?? "error"}: ${error.message}`;
      if (error.code !== "EADDRINUSE" || attempt === attempts) break;
      await Bun.sleep(300);
    }
    console.error(`[yt] proxy failed to listen on :${this.port}: ${this.counters.error}`);
    return false;
  }

  /** One listen attempt; resolves the error, or undefined on success. */
  private listenOnce(): Promise<NodeJS.ErrnoException | undefined> {
    return new Promise((resolve) => {
      const server = createServer((socket) => this.onConnection(socket));
      server.once("error", (error: NodeJS.ErrnoException) => {
        server.close();
        resolve(error);
      });
      server.listen(this.port, "0.0.0.0", () => {
        this.server = server;
        this.counters.startedAt = new Date().toISOString();
        this.counters.error = null;
        resolve(undefined);
      });
    });
  }

  /** Stops listening and cuts every open tunnel. */
  stop(): void {
    this.server?.close();
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.clients.clear();
    this.tunnels.clear();
  }

  /** Port actually bound (differs from the configured one only when that is 0, in tests). */
  get boundPort(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? this.port;
  }

  /** Snapshot for the UI: closed connections plus the live bytes of open ones. */
  stats(): ProxyStats {
    const hosts = new Map([...this.traffic].map(([host, entry]) => [host, { ...entry }]));
    for (const [socket, host] of this.tunnels) {
      const entry = hosts.get(host);
      if (entry) entry.bytes += socket.bytesRead + socket.bytesWritten;
    }
    let fromClients = this.counters.bytesFromClients;
    let toClients = this.counters.bytesToClients;
    for (const client of this.clients) {
      fromClients += client.bytesRead;
      toClients += client.bytesWritten;
    }
    return {
      listening: this.server !== undefined,
      port: this.boundPort,
      allowed: [...this.allowed()],
      ...this.counters,
      bytesFromClients: fromClients,
      bytesToClients: toClients,
      activeConnections: this.clients.size,
      topHosts: [...hosts.values()].sort((a, b) => b.bytes - a.bytes || b.connections - a.connections).slice(0, 12),
    };
  }

  /** Addresses admitted right now: the TV's current IP plus the configured extras. */
  private allowed(): Set<string> {
    return new Set([this.target.tvHost, ...this.extraAllowed].filter(Boolean));
  }

  /** Admits the client and waits for its request head. */
  private onConnection(client: Socket): void {
    const ip = plainIp(client.remoteAddress);
    if (!this.allowed().has(ip)) {
      this.counters.rejected += 1;
      this.counters.lastRejected = { ip, at: new Date().toISOString() };
      client.destroy();
      return;
    }
    this.counters.totalConnections += 1;
    if (ip === this.target.tvHost) this.counters.lastTvAt = new Date().toISOString();
    this.sockets.add(client);
    this.clients.add(client);
    client.setNoDelay(true);
    client.on("error", () => client.destroy());

    let head = Buffer.alloc(0);
    const timer = setTimeout(() => client.destroy(), HEAD_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > MAX_HEAD) client.destroy();
        return;
      }
      client.off("data", onData);
      client.pause();
      clearTimeout(timer);
      this.route(client, head.subarray(0, end + 4).toString("latin1"), head.subarray(end + 4));
    };
    client.on("data", onData);
    client.once("close", () => {
      clearTimeout(timer);
      this.sockets.delete(client);
      this.clients.delete(client);
      this.counters.bytesFromClients += client.bytesRead;
      this.counters.bytesToClients += client.bytesWritten;
    });
  }

  /** Dispatches a request head: CONNECT tunnel, plain-HTTP forward, or our own health check. */
  private route(client: Socket, head: string, rest: Buffer): void {
    const [method = "", target = ""] = head.slice(0, head.indexOf("\r\n")).split(" ");

    if (method === "CONNECT") {
      const match = CONNECT_TARGET.exec(target);
      const host = (match?.[1] ?? match?.[2] ?? "").toLowerCase();
      const port = Number(match?.[3]);
      if (!host || !(port > 0 && port < 65536)) return reply(client, "400 Bad Request", "Bad CONNECT target");
      const intercept = port === 443 && MITM_HOSTS.includes(host);
      const upstream = intercept ? connect(this.mitmPort(), "127.0.0.1") : connect(port, host);
      return this.splice(client, upstream, host, "HTTP/1.1 200 Connection Established\r\n\r\n", rest);
    }

    if (target.startsWith("/")) {
      if (method === "GET" && target === "/__m7d/health") return reply(client, "200 OK", "m7d youtube proxy");
      return reply(client, "400 Bad Request", "Not a proxy request");
    }

    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return reply(client, "400 Bad Request", "Bad URL");
    }
    if (url.protocol !== "http:") return reply(client, "400 Bad Request", "Only http:// or CONNECT");
    const upstream = connect(Number(url.port || 80), url.hostname);
    const forwarded = Buffer.concat([Buffer.from(closingHead(head), "latin1"), rest]);
    this.splice(client, upstream, url.hostname.toLowerCase(), "", forwarded);
  }

  /** Once `upstream` connects: sends `greeting` to the client, `initial` upstream, then pipes both ways. */
  private splice(client: Socket, upstream: Socket, host: string, greeting: string, initial: Buffer): void {
    this.sockets.add(upstream);
    upstream.setNoDelay(true);
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      this.count(host, 1, 0);
      this.tunnels.set(upstream, host);
      upstream.setKeepAlive(true, 30_000);
      client.setKeepAlive(true, 30_000);
      if (greeting) client.write(greeting);
      if (initial.length) upstream.write(initial);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => {
      if (!connected && !client.destroyed) return reply(client, "502 Bad Gateway", `Cannot reach ${host}`);
      client.destroy();
    });
    upstream.once("close", () => {
      this.sockets.delete(upstream);
      this.tunnels.delete(upstream);
      if (connected) this.count(host, 0, upstream.bytesRead + upstream.bytesWritten);
      if (connected) client.destroy();
    });
    client.once("close", () => upstream.destroy());
  }

  /** Adds to the per-host traffic table (connections when a tunnel opens, bytes when it closes). */
  private count(host: string, connections: number, bytes: number): void {
    const entry = this.traffic.get(host) ?? { host, connections: 0, bytes: 0 };
    entry.connections += connections;
    entry.bytes += bytes;
    this.traffic.set(host, entry);
    if (this.traffic.size > MAX_TRACKED_HOSTS) {
      const smallest = [...this.traffic.values()].sort((a, b) => a.bytes - b.bytes)[0];
      if (smallest) this.traffic.delete(smallest.host);
    }
  }
}

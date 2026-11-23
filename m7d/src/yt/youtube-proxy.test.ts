import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CertAuthority } from "./cert-authority";
import { MitmServer, USERSCRIPT_PATH } from "./mitm-server";
import { Userscript } from "./userscript";
import { YoutubeProxy } from "./youtube-proxy";

/**
 * End to end through a real proxy socket: Bun's fetch (with `proxy` + our CA) plays Cobalt,
 * a local HTTP server plays youtube.com, so no internet is needed.
 */
let dir = "";
let caPem = "";
let origin: ReturnType<typeof Bun.serve>;
let echo: Server;
let mitm: MitmServer;
let proxy: YoutubeProxy;
let proxyUrl = "";
const userscript = new Userscript();
const GZIPPED = Bun.gzipSync(new TextEncoder().encode("compressed body ".repeat(50)));

const TV_HTML =
  '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head><body><p>tv</p></body></html>';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "m7d-yt-"));
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case "/tv":
          return new Response(TV_HTML, {
            headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'" },
          });
        case "/gz":
          return new Response(GZIPPED, { headers: { "content-encoding": "gzip", "content-type": "text/plain" } });
        case "/redirect":
          return new Response(null, { status: 302, headers: { location: "https://www.youtube.com/tv" } });
        case "/echo":
          return Response.json({
            method: request.method,
            body: await request.text(),
            cookie: request.headers.get("cookie"),
            userAgent: request.headers.get("user-agent"),
          });
        case "/plain":
          return new Response("plain http ok");
        default:
          return new Response("nope", { status: 404 });
      }
    },
  });
  echo = createServer((socket) => socket.pipe(socket)).listen(0, "127.0.0.1");
  await new Promise((resolve) => echo.once("listening", resolve));

  const ca = new CertAuthority(join(dir, "ca"));
  caPem = await ca.caPem();
  mitm = new MitmServer(ca, userscript, () => `http://127.0.0.1:${origin.port}`);
  await mitm.start();
  proxy = new YoutubeProxy(0, ["127.0.0.1"], { tvHost: "10.9.9.9", homelabIp: "" }, () => mitm.port);
  expect(await proxy.start()).toBe(true);
  proxyUrl = `http://127.0.0.1:${proxy.boundPort}`;
});

afterAll(async () => {
  proxy.stop();
  mitm.stop();
  void origin.stop(true);
  echo.close();
  await rm(dir, { recursive: true, force: true });
});

/** fetch through the proxy, trusting only our CA (like Cobalt with ssl/certs). */
const viaProxy = (url: string, init: BunFetchRequestInit = {}) =>
  fetch(url, { ...init, proxy: proxyUrl, tls: { ca: caPem } });

/** Sends raw bytes to the proxy and collects the reply until it closes (or `until` matches). */
function rawProxy(payload: string, until?: RegExp, port = proxy.boundPort): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(payload));
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString();
      if (until?.test(text)) socket.destroy();
    });
    socket.on("close", () => resolve(text));
    socket.on("error", () => resolve(text));
  });
}

describe("YouTube proxy + TLS interception", () => {
  test("the /tv page gets the userscript tag and a relaxed CSP", async () => {
    const { hash } = await userscript.get();
    const response = await viaProxy("https://www.youtube.com/tv?env=1");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`<script src="${USERSCRIPT_PATH}?sha=${hash}"></script></body>`);
    expect(html).not.toContain("http-equiv");
    expect(response.headers.get("content-security-policy")).toContain("script-src *");
    expect(mitm.stats.injections).toBe(1);
  });

  test("the pinned userscript is served from memory, revalidated on every load", async () => {
    const bundle = await userscript.get();
    const url = `https://www.youtube.com${USERSCRIPT_PATH}?v=${bundle.hash}`;
    const response = await viaProxy(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect((await response.arrayBuffer()).byteLength).toBe(bundle.size);
    const again = await viaProxy(url, { headers: { "if-none-match": `"${bundle.hash}"` } });
    expect(again.status).toBe(304);
    expect(mitm.stats.userscriptLoads).toBe(2);
  });

  test("compressed responses pass through untouched", async () => {
    const response = await viaProxy("https://youtube.com/gz", { decompress: false });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(GZIPPED);
  });

  test("redirects are returned to the client, not followed", async () => {
    const response = await viaProxy("https://www.youtube.com/redirect", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://www.youtube.com/tv");
  });

  test("request bodies, cookies and the user agent are forwarded", async () => {
    const response = await viaProxy("https://www.youtube.com/echo", {
      method: "POST",
      body: "payload",
      headers: { cookie: "SID=abc", "user-agent": "Cobalt/25" },
    });
    expect(await response.json()).toEqual({ method: "POST", body: "payload", cookie: "SID=abc", userAgent: "Cobalt/25" });
  });

  test("other hosts are raw TCP tunnels (no interception)", async () => {
    const port = (echo.address() as AddressInfo).port;
    const reply = await rawProxy(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: x\r\n\r\nping`, /ping$/);
    expect(reply).toBe("HTTP/1.1 200 Connection Established\r\n\r\nping");
  });

  test("plain http:// requests are forwarded", async () => {
    const response = await fetch(`http://127.0.0.1:${origin.port}/plain`, { proxy: proxyUrl });
    expect(await response.text()).toBe("plain http ok");
  });

  test("health check and garbage", async () => {
    expect(await rawProxy("GET /__m7d/health HTTP/1.1\r\n\r\n")).toContain("200 OK");
    expect(await rawProxy("CONNECT nope HTTP/1.1\r\n\r\n")).toContain("400 Bad Request");
  });

  test("unreachable tunnel targets get a 502", async () => {
    expect(await rawProxy("CONNECT 127.0.0.1:1 HTTP/1.1\r\n\r\n")).toContain("502 Bad Gateway");
  });

  test("addresses outside the allowlist are dropped", async () => {
    const closed = new YoutubeProxy(0, [], { tvHost: "10.0.0.1", homelabIp: "" }, () => mitm.port);
    expect(await closed.start()).toBe(true);
    try {
      expect(await rawProxy("GET /__m7d/health HTTP/1.1\r\n\r\n", undefined, closed.boundPort)).toBe("");
      expect(closed.stats().rejected).toBe(1);
      expect(closed.stats().lastRejected?.ip).toBe("127.0.0.1");
    } finally {
      closed.stop();
    }
  });

  test("stats count connections and bytes per host", () => {
    const stats = proxy.stats();
    expect(stats.listening).toBe(true);
    expect(stats.totalConnections).toBeGreaterThan(5);
    expect(stats.topHosts.map((entry) => entry.host)).toContain("www.youtube.com");
    // Bytes of still-open (pooled) tunnels are counted live.
    expect(stats.topHosts.find((entry) => entry.host === "www.youtube.com")?.bytes).toBeGreaterThan(0);
    expect(stats.bytesToClients).toBeGreaterThan(0);
  });
});

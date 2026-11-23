import type { TvTarget } from "../services/settings-store";
import { connect, type Socket } from "node:net";
import { SdbError } from "../lib/errors";
import { Mutex } from "../lib/mutex";
import {
  SDB_CLIENT_MAX_PAYLOAD,
  SDB_CLIENT_VERSION,
  SdbPacketReader,
  encodePacket,
  type SdbPacket,
} from "./sdb-protocol";

/** One open sdb stream waiting for its output. */
interface PendingStream {
  localId: number;
  remoteId: number;
  chunks: Buffer[];
  timer: ReturnType<typeof setTimeout>;
  resolve: (output: string) => void;
  reject: (error: SdbError) => void;
}

/** Callbacks for the in-flight handshake. */
interface HandshakeWaiter {
  resolve: () => void;
  reject: (error: SdbError) => void;
}

/** Node socket error with an errno code. */
type SocketError = Error & { code?: string };

/** How long to wait for sdbd's CNXN reply. */
const HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Client for the TV's sdbd that speaks the sdb wire protocol directly.
 *
 * The M7's sdbd accepts only ONE host connection at a time (verified: a second socket is reset
 * before CNXN). This client therefore opens the connection on demand, runs commands one at a
 * time, and releases the slot after `idleReleaseMs` so other tools (sdb CLI, apps2samsung-cli)
 * can use it in between.
 *
 * Uses `node:net` rather than `Bun.connect` because it buffers partial writes for us.
 */
export class SdbClient {
  private socket: Socket | undefined;
  private connecting: Promise<void> | undefined;
  private handshake: HandshakeWaiter | undefined;
  private readonly reader = new SdbPacketReader();
  private readonly streams = new Map<number, PendingStream>();
  private readonly lock = new Mutex();
  private nextLocalId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private deviceBanner = "";
  /** Label of the external tool holding the TV's sdb slot (see {@link exclusive}). */
  private lentTo: string | undefined;

  /**
   * @param target where the TV is (read on every connect, so a changed TV IP applies next time)
   * @param port sdbd port (26101)
   * @param idleReleaseMs close the connection after this long without commands
   */
  constructor(
    private readonly target: TvTarget,
    private readonly port: number,
    private readonly idleReleaseMs: number,
  ) {}

  /** Banner of the last successful handshake, e.g. `device::<model>::0`. */
  get banner(): string {
    return this.deviceBanner;
  }

  /** True while the TV's sdb slot is held by this client. */
  get isConnected(): boolean {
    return this.socket !== undefined && this.deviceBanner !== "";
  }

  /** Name of the tool currently using the TV's sdb slot instead of m7d, if any. */
  get lentToTool(): string | undefined {
    return this.lentTo;
  }

  /**
   * Runs `shell:<command>` (e.g. `0 vd_applist`) and returns its full output.
   * Commands are serialized; the connection is opened if needed.
   */
  shell(command: string, timeoutMs = 15000): Promise<string> {
    // Fail fast while another tool has the slot: callers (UI polling) must not hang for minutes.
    if (this.lentTo) {
      return Promise.reject(
        SdbError.create(`TV sdb slot is lent to ${this.lentTo}`, "busy"),
      );
    }
    return this.lock.run(async () => {
      this.cancelIdleRelease();
      await this.ensureConnected();
      return this.openStream(`shell:${command}`, timeoutMs).finally(() =>
        this.scheduleIdleRelease(),
      );
    });
  }

  /** Closes the connection now, freeing the TV's single sdb slot. */
  release(): void {
    this.cancelIdleRelease();
    this.socket?.destroy();
  }

  /**
   * Lends the TV's single sdb slot to an external tool (e.g. apps2samsung-cli, which opens
   * its own connection): waits for running commands, closes m7d's connection, runs `task`,
   * and makes {@link shell} fail fast with `busy` until it finishes.
   */
  exclusive<T>(tool: string, task: () => Promise<T>): Promise<T> {
    return this.lock.run(async () => {
      this.release();
      // Give sdbd a moment to see the close before the tool connects.
      await Bun.sleep(150);
      this.lentTo = tool;
      return task().finally(() => {
        this.lentTo = undefined;
      });
    });
  }

  /** Opens and handshakes the connection unless it is already up. */
  private ensureConnected(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    this.connecting ??= this.connectAndHandshake().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  /** Opens the TCP socket and completes the CNXN exchange. */
  private connectAndHandshake(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.target.tvHost) {
        reject(SdbError.create("No TV IP set: enter it in the dashboard's Settings", "closed"));
        return;
      }
      const socket = connect({ host: this.target.tvHost, port: this.port });
      this.socket = socket;
      this.reader.reset();

      const timer = setTimeout(() => {
        this.failHandshake(
          SdbError.create("sdb handshake timed out", "timeout"),
        );
        socket.destroy();
      }, HANDSHAKE_TIMEOUT_MS);

      this.handshake = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      socket.on("connect", () => {
        socket.write(
          encodePacket(
            "CNXN",
            SDB_CLIENT_VERSION,
            SDB_CLIENT_MAX_PAYLOAD,
            Buffer.from("host::\0"),
          ),
        );
      });
      socket.on("data", (chunk: Buffer) => this.onData(chunk));
      socket.on("error", (error: SocketError) =>
        this.failHandshake(this.toSdbError(error)),
      );
      socket.on("close", () => this.onClose(socket));
    });
  }

  /** Maps a socket error to an {@link SdbError} with a useful reason. */
  private toSdbError(error: SocketError): SdbError {
    if (error.code === "ECONNRESET" && !this.deviceBanner) {
      return SdbError.create(
        "TV sdb slot is held by another client (sdb server, apps2samsung-cli, …); it allows only one",
        "busy",
      );
    }
    return SdbError.create(
      `sdb connection failed: ${error.code ?? error.message}`,
      "closed",
    );
  }

  /** Rejects the pending handshake, if any. */
  private failHandshake(error: SdbError): void {
    const waiter = this.handshake;
    this.handshake = undefined;
    waiter?.reject(error);
  }

  /** Decodes incoming bytes and dispatches each packet. */
  private onData(chunk: Buffer): void {
    const packets = this.decode(chunk);
    for (const packet of packets) this.onPacket(packet);
  }

  /** Decodes `chunk`; on corruption the connection is dropped (streams fail via onClose). */
  private decode(chunk: Buffer): SdbPacket[] {
    const result = (() => {
      try {
        return this.reader.push(chunk);
      } catch (error) {
        if (error instanceof SdbError) return error;
        throw error;
      }
    })();
    if (result instanceof SdbError) {
      this.failHandshake(result);
      this.socket?.destroy();
      return [];
    }
    return result;
  }

  /** Handles one decoded packet. */
  private onPacket(packet: SdbPacket): void {
    switch (packet.command) {
      case "CNXN": {
        this.deviceBanner = packet.payload.toString("utf8").replace(/\0/g, "");
        const waiter = this.handshake;
        this.handshake = undefined;
        waiter?.resolve();
        return;
      }
      case "AUTH":
        this.failHandshake(
          SdbError.create(
            "TV asked for sdb key authentication (unsupported)",
            "rejected",
          ),
        );
        this.socket?.destroy();
        return;
      case "OKAY": {
        const stream = this.streams.get(packet.arg1);
        if (stream && stream.remoteId === 0) stream.remoteId = packet.arg0;
        return;
      }
      case "WRTE": {
        const stream = this.streams.get(packet.arg1);
        if (!stream) return;
        stream.chunks.push(packet.payload);
        this.write(encodePacket("OKAY", stream.localId, packet.arg0));
        return;
      }
      case "CLSE": {
        const stream = this.streams.get(packet.arg1);
        if (!stream) return;
        this.streams.delete(stream.localId);
        clearTimeout(stream.timer);
        if (stream.remoteId === 0) {
          stream.reject(
            SdbError.create("TV refused the sdb service request", "rejected"),
          );
          return;
        }
        this.write(encodePacket("CLSE", stream.localId, stream.remoteId));
        stream.resolve(Buffer.concat(stream.chunks).toString("utf8"));
        return;
      }
      default:
        return;
    }
  }

  /** Opens a stream for `service` and resolves with everything the TV writes before closing it. */
  private openStream(service: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const localId = this.allocateLocalId();
      const timer = setTimeout(() => {
        const stream = this.streams.get(localId);
        if (!stream) return;
        this.streams.delete(localId);
        if (stream.remoteId !== 0)
          this.write(encodePacket("CLSE", localId, stream.remoteId));
        reject(
          SdbError.create(
            `sdb command timed out after ${timeoutMs} ms: ${service}`,
            "timeout",
          ),
        );
      }, timeoutMs);

      this.streams.set(localId, {
        localId,
        remoteId: 0,
        chunks: [],
        timer,
        resolve,
        reject,
      });
      this.write(
        encodePacket("OPEN", localId, 0, Buffer.from(`${service}\0`, "utf8")),
      );
    });
  }

  /** Returns the next free local stream id (never 0). */
  private allocateLocalId(): number {
    const id = this.nextLocalId;
    this.nextLocalId =
      this.nextLocalId >= 0x7fffffff ? 1 : this.nextLocalId + 1;
    return id;
  }

  /** Writes to the current socket, if any. */
  private write(packet: Buffer): void {
    this.socket?.write(packet);
  }

  /** Cleans up after the socket closes: every pending stream fails. */
  private onClose(socket: Socket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.deviceBanner = "";
    this.reader.reset();
    this.failHandshake(
      SdbError.create("sdb connection closed during handshake", "closed"),
    );
    for (const stream of this.streams.values()) {
      clearTimeout(stream.timer);
      stream.reject(SdbError.create("sdb connection closed", "closed"));
    }
    this.streams.clear();
  }

  /** Arms the idle timer once no stream is open. */
  private scheduleIdleRelease(): void {
    this.cancelIdleRelease();
    if (this.streams.size > 0) return;
    this.idleTimer = setTimeout(() => this.release(), this.idleReleaseMs);
  }

  /** Cancels a pending idle release. */
  private cancelIdleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}

/**
 * sdbd connection-limit probe.
 *
 * Opens N raw TCP connections to the TV's sdbd and sends only the CNXN handshake
 * on each (no commands are run). Reports, per connection, whether sdbd answered
 * with its own CNXN (accepted) or closed the socket (rejected).
 *
 * Usage: bun tools/sdb-probe/probe.ts [host] [port] [connections] [mode]
 *   mode = "parallel" (all open at once, default) | "serial" (one after another)
 */
import { connect, type Socket } from "node:net";

const HOST = process.argv[2] ?? Bun.env.TV_HOST ?? "192.0.2.130";
const PORT = Number(process.argv[3] ?? 26101);
const COUNT = Number(process.argv[4] ?? 2);
const MODE = process.argv[5] ?? "parallel";

/** Protocol constants as used by working Tizen TV clients (Vetro, adbhost). */
const VERSION = 0x01000000;
const MAX_PAYLOAD = 4096;
const HEADER_BYTES = 24;
const NAMES = ["SYNC", "OPEN", "CNXN", "AUTH", "OKAY", "CLSE", "WRTE"] as const;

/** Little-endian u32 of a 4-char command name, e.g. "CNXN". */
const cmdOf = (name: string): number => Buffer.from(name).readUInt32LE(0);
const nameOf = (cmd: number): string =>
  NAMES.find((n) => cmdOf(n) === cmd) ?? `0x${cmd.toString(16)}`;

/** Encodes one sdb packet: 24-byte header + payload. */
function encode(cmd: string, arg0: number, arg1: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  const c = cmdOf(cmd);
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) >>> 0;
  header.writeUInt32LE(c, 0);
  header.writeUInt32LE(arg0 >>> 0, 4);
  header.writeUInt32LE(arg1 >>> 0, 8);
  header.writeUInt32LE(payload.length, 12);
  header.writeUInt32LE(sum, 16);
  header.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([header, payload]);
}

type Outcome = { id: number; result: string; ms: number };

/** Opens one connection, sends CNXN, and resolves with what sdbd did. */
function probe(id: number, holdMs: number): Promise<{ outcome: Promise<Outcome>; socket: Socket }> {
  return new Promise((ready) => {
    const started = Date.now();
    const socket = connect(PORT, HOST);
    const outcome = new Promise<Outcome>((done) => {
      let buf = Buffer.alloc(0);
      let settled = false;
      const finish = (result: string) => {
        if (settled) return;
        settled = true;
        done({ id, result, ms: Date.now() - started });
      };
      socket.on("connect", () => {
        socket.write(encode("CNXN", VERSION, MAX_PAYLOAD, Buffer.from("host::\0")));
      });
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < HEADER_BYTES) return;
        const cmd = nameOf(buf.readUInt32LE(0));
        const len = buf.readUInt32LE(12);
        const payload = buf.subarray(HEADER_BYTES, HEADER_BYTES + len).toString("utf8").replace(/\0/g, "");
        finish(`ANSWERED ${cmd} arg0=0x${buf.readUInt32LE(4).toString(16)} payload="${payload}"`);
      });
      socket.on("close", () => finish("CLOSED by TV before answering"));
      socket.on("error", (e) => finish(`ERROR ${e.message}`));
      setTimeout(() => finish("NO ANSWER within 5 s (socket still open)"), 5000);
    });
    // Keep every socket open for holdMs so connections overlap in parallel mode.
    setTimeout(() => ready({ outcome, socket }), MODE === "parallel" ? 300 : 0);
    // Serial: close this socket as soon as sdbd has answered, then wait holdMs before the next one.
    if (MODE === "serial") outcome.then(() => socket.destroy());
  });
}

const sockets: Socket[] = [];
const outcomes: Promise<Outcome>[] = [];
for (let i = 1; i <= COUNT; i++) {
  const { outcome, socket } = await probe(i, 200);
  sockets.push(socket);
  outcomes.push(outcome);
  if (MODE === "serial") { await outcome; await Bun.sleep(1000); }
}
for (const o of await Promise.all(outcomes)) {
  console.log(`conn #${o.id}: ${o.result} (${o.ms} ms)`);
}
for (const s of sockets) s.destroy();

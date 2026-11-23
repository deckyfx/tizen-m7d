import { SdbError } from "../lib/errors";

/**
 * Wire format of the sdb protocol (ADB-compatible): a 24-byte little-endian header
 * `command, arg0, arg1, payloadLength, payloadChecksum, magic` followed by the payload.
 */

/** Command names used on the wire. */
export const SDB_COMMANDS = [
  "SYNC",
  "CNXN",
  "AUTH",
  "OPEN",
  "OKAY",
  "CLSE",
  "WRTE",
] as const;

/** One of {@link SDB_COMMANDS}. */
export type SdbCommandName = (typeof SDB_COMMANDS)[number];

/** A decoded sdb packet. */
export interface SdbPacket {
  command: SdbCommandName;
  arg0: number;
  arg1: number;
  payload: Buffer;
}

/** Header size in bytes. */
export const SDB_HEADER_BYTES = 24;

/** Protocol version and max payload this client announces (as working TV clients do). */
export const SDB_CLIENT_VERSION = 0x01000000;
export const SDB_CLIENT_MAX_PAYLOAD = 4096;

/** Upper bound for a single incoming payload; anything larger is treated as corruption. */
const MAX_INCOMING_PAYLOAD = 1024 * 1024;

/** Command name → numeric code (the 4 ASCII bytes read as a little-endian u32). */
const CODE_BY_NAME = new Map<SdbCommandName, number>(
  SDB_COMMANDS.map((name) => [
    name,
    Buffer.from(name, "ascii").readUInt32LE(0),
  ]),
);

/** Numeric code → command name. */
const NAME_BY_CODE = new Map<number, SdbCommandName>(
  [...CODE_BY_NAME].map(([name, code]) => [code, name]),
);

/** Returns the numeric code of `command`. */
function codeOf(command: SdbCommandName): number {
  const code = CODE_BY_NAME.get(command);
  if (code === undefined)
    return SdbError.throw(`unknown sdb command ${command}`, "protocol");
  return code;
}

/** Sum of all payload bytes, as sdb's checksum. */
function checksum(payload: Buffer): number {
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) >>> 0;
  return sum;
}

/** Encodes one packet ready to write to the socket. */
export function encodePacket(
  command: SdbCommandName,
  arg0: number,
  arg1: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  const code = codeOf(command);
  const header = Buffer.alloc(SDB_HEADER_BYTES);
  header.writeUInt32LE(code, 0);
  header.writeUInt32LE(arg0 >>> 0, 4);
  header.writeUInt32LE(arg1 >>> 0, 8);
  header.writeUInt32LE(payload.length, 12);
  header.writeUInt32LE(checksum(payload), 16);
  header.writeUInt32LE((code ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([header, payload]);
}

/**
 * Incremental decoder: feed raw socket chunks, get complete packets back.
 * Throws {@link SdbError} (`protocol`) on a malformed header.
 */
export class SdbPacketReader {
  private buffer: Buffer = Buffer.alloc(0);

  /** Appends `chunk` and returns every packet that is now complete. */
  push(chunk: Buffer): SdbPacket[] {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : chunk;
    const packets: SdbPacket[] = [];

    while (this.buffer.length >= SDB_HEADER_BYTES) {
      const code = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(12);
      const magic = this.buffer.readUInt32LE(20);
      const command = NAME_BY_CODE.get(code);

      if (
        !command ||
        magic !== (code ^ 0xffffffff) >>> 0 ||
        length > MAX_INCOMING_PAYLOAD
      ) {
        return SdbError.throw(
          `malformed sdb packet header (code 0x${code.toString(16)})`,
          "protocol",
        );
      }
      if (this.buffer.length < SDB_HEADER_BYTES + length) break;

      packets.push({
        command,
        arg0: this.buffer.readUInt32LE(4),
        arg1: this.buffer.readUInt32LE(8),
        payload: Buffer.from(
          this.buffer.subarray(SDB_HEADER_BYTES, SDB_HEADER_BYTES + length),
        ),
      });
      this.buffer = this.buffer.subarray(SDB_HEADER_BYTES + length);
    }
    return packets;
  }

  /** Drops any partial data (after a reconnect). */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

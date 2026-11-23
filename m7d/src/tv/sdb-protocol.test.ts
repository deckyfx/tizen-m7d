import { describe, expect, test } from "bun:test";
import { SdbError } from "../lib/errors";
import {
  SDB_HEADER_BYTES,
  SdbPacketReader,
  encodePacket,
} from "./sdb-protocol";

describe("sdb packet codec", () => {
  test("round-trips a packet with payload", () => {
    const packet = encodePacket(
      "OPEN",
      7,
      0,
      Buffer.from("shell:0 vd_applist\0"),
    );
    const [decoded] = new SdbPacketReader().push(packet);
    expect(decoded?.command).toBe("OPEN");
    expect(decoded?.arg0).toBe(7);
    expect(decoded?.payload.toString()).toBe("shell:0 vd_applist\0");
  });

  test("writes the magic as command XOR 0xffffffff", () => {
    const packet = encodePacket("CNXN", 0x01000000, 4096);
    expect(packet.length).toBe(SDB_HEADER_BYTES);
    expect(packet.readUInt32LE(20)).toBe(
      (packet.readUInt32LE(0) ^ 0xffffffff) >>> 0,
    );
  });

  test("reassembles packets split across chunks and batched together", () => {
    const a = encodePacket("WRTE", 1, 2, Buffer.from("hello "));
    const b = encodePacket("CLSE", 1, 2);
    const stream = Buffer.concat([a, b]);
    const reader = new SdbPacketReader();
    expect(reader.push(stream.subarray(0, 10))).toEqual([]);
    const packets = reader.push(stream.subarray(10));
    expect(packets.map((p) => p.command)).toEqual(["WRTE", "CLSE"]);
    expect(packets[0]?.payload.toString()).toBe("hello ");
  });

  test("rejects a header with a bad magic", () => {
    const packet = encodePacket("OKAY", 1, 1);
    packet.writeUInt32LE(0, 20);
    expect(() => new SdbPacketReader().push(packet)).toThrow(SdbError);
  });
});

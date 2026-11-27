import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Device, DeviceStore } from "./device-store";

let dir = "";
let idleDays = 90;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "m7d-devices-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

/** A store whose file holds `devices` (to fake old lastSeen dates). */
async function storeWith(devices: Device[]): Promise<DeviceStore> {
  const path = join(dir, `${crypto.randomUUID()}.json`);
  await Bun.write(path, JSON.stringify(devices));
  const store = new DeviceStore(path, () => idleDays);
  await store.load();
  return store;
}

describe("DeviceStore", () => {
  test("only the secret's hash is saved; the cookie value verifies", async () => {
    const path = join(dir, "plain.json");
    const store = new DeviceStore(path, () => idleDays);
    await store.load();
    const { device, cookie } = await store.create({ name: "Laptop", userAgent: "UA", ip: "10.0.0.5", via: "token", ephemeral: false });
    const saved = await Bun.file(path).text();
    expect(saved).not.toContain(cookie.split(".")[1] ?? "x");
    expect((await store.verify(cookie, "10.0.0.5"))?.device.id).toBe(device.id);
    expect(await store.verify(`${device.id}.wrong`, "10.0.0.5")).toBeUndefined();
    expect(await store.verify(undefined, "10.0.0.5")).toBeUndefined();
    expect((await Bun.file(path).stat()).mode & 0o777).toBe(0o600);
  });

  test("unused devices expire after the configured days; 0 days means never", async () => {
    const path = join(dir, "expiry.json");
    const first = new DeviceStore(path, () => idleDays);
    await first.load();
    const { cookie } = await first.create({ name: "Old", userAgent: "", ip: "", via: "token", ephemeral: false });
    // Pretend it was last used 40 days ago.
    const saved = (await Bun.file(path).json()) as Device[];
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const store = await storeWith(saved.map((device) => ({ ...device, lastSeenAt: old })));
    idleDays = 30;
    expect(await store.verify(cookie, "")).toBeUndefined();
    expect(store.list()).toHaveLength(0);
    idleDays = 0;
    expect(await store.verify(cookie, "")).toBeDefined();
    idleDays = 90;
  });

  test("session-only devices last 12 hours", async () => {
    const store = await storeWith([]);
    const { device } = await store.create({ name: "Guest", userAgent: "", ip: "", via: "approval", ephemeral: true });
    const hours = (Date.parse(device.expiresAt ?? "") - Date.parse(device.lastSeenAt)) / 3_600_000;
    expect(hours).toBe(12);
  });
});

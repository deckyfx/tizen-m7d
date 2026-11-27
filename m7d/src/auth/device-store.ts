import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Mutex } from "../lib/mutex";

/** How a browser got access. */
export type DeviceOrigin = "token" | "approval";

/** A remembered browser (what is saved; the secret itself is never stored). */
export interface Device {
  /** Public id (shown, used to revoke). */
  id: string;
  /** SHA-256 (hex) of the secret held in the browser's cookie. */
  secretHash: string;
  name: string;
  userAgent: string;
  via: DeviceOrigin;
  /** Session-only: "Remember this browser" was off; forgotten after {@link EPHEMERAL_HOURS}. */
  ephemeral: boolean;
  createdAt: string;
  lastSeenAt: string;
  lastIp: string;
}

/** A device as the dashboard shows it. */
export type DeviceView = Omit<Device, "secretHash"> & {
  /** When it will be forgotten unless used again (null = never). */
  expiresAt: string | null;
};

/** Browser-session sign-ins ("Remember this browser" off) last at most this long. */
export const EPHEMERAL_HOURS = 12;

/** lastSeen is written to disk at most this often per device (every request would be too much). */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Most remembered browsers kept (the oldest unused one goes first). */
const MAX_DEVICES = 100;

const DAY_MS = 24 * 60 * 60_000;

/** SHA-256 hex of a secret. */
function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Remembered browsers, saved in `<DATA_DIR>/auth/devices.json`. A browser holds
 * `<id>.<secret>` in an HttpOnly cookie; only the secret's hash is stored here, so a copy of this
 * file grants no access. Unused devices expire after `idleDays()` (0 = never).
 */
export class DeviceStore {
  private devices: Device[] = [];
  private readonly lock = new Mutex();

  constructor(
    private readonly path: string,
    /** Current idle limit in days (read live from the settings). */
    private readonly idleDays: () => number,
  ) {}

  /** Reads the saved devices (a missing file means none). */
  async load(): Promise<void> {
    const file = Bun.file(this.path);
    this.devices = (await file.exists()) ? ((await file.json()) as Device[]) : [];
  }

  /** Remembers a new browser; returns it and the cookie value (`<id>.<secret>`, shown once). */
  create(input: { name: string; userAgent: string; ip: string; via: DeviceOrigin; ephemeral: boolean }): Promise<{
    device: DeviceView;
    cookie: string;
  }> {
    return this.lock.run(async () => {
      this.prune();
      const id = randomBytes(6).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const now = new Date().toISOString();
      const device: Device = {
        id,
        secretHash: hash(secret),
        name: input.name.trim().slice(0, 60) || "Browser",
        userAgent: input.userAgent.slice(0, 300),
        via: input.via,
        ephemeral: input.ephemeral,
        createdAt: now,
        lastSeenAt: now,
        lastIp: input.ip,
      };
      this.devices.push(device);
      if (this.devices.length > MAX_DEVICES) {
        this.devices.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
        this.devices.length = MAX_DEVICES;
      }
      await this.save();
      return { device: this.view(device), cookie: `${id}.${secret}` };
    });
  }

  /**
   * The device a cookie value belongs to, or undefined (unknown, wrong secret, expired).
   * Records the use (throttled); `renew` is true when it did, so the caller can renew the cookie.
   */
  async verify(cookie: string | undefined, ip: string): Promise<{ device: DeviceView; renew: boolean } | undefined> {
    const [id, secret] = (cookie ?? "").split(".");
    if (!id || !secret) return undefined;
    const device = this.devices.find((candidate) => candidate.id === id);
    if (!device) return undefined;
    const presented = Buffer.from(hash(secret), "hex");
    const expected = Buffer.from(device.secretHash, "hex");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return undefined;
    if (this.isExpired(device)) return undefined;
    const now = Date.now();
    const renew = now - Date.parse(device.lastSeenAt) > TOUCH_INTERVAL_MS;
    if (renew || device.lastIp !== ip) {
      device.lastSeenAt = new Date(now).toISOString();
      device.lastIp = ip;
      await this.lock.run(() => this.save());
    }
    return { device: this.view(device), renew };
  }

  /** All devices that have not expired, most recently used first. */
  list(): DeviceView[] {
    return this.devices
      .filter((device) => !this.isExpired(device))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map((device) => this.view(device));
  }

  /** Renames a device; false when it does not exist. */
  rename(id: string, name: string): Promise<boolean> {
    return this.lock.run(async () => {
      const device = this.devices.find((candidate) => candidate.id === id);
      if (!device) return false;
      device.name = name.trim().slice(0, 60) || device.name;
      await this.save();
      return true;
    });
  }

  /** Forgets the devices with these ids (or all except `keep` when `ids` is "all"); returns how many. */
  revoke(ids: string[] | "all", keep?: string): Promise<number> {
    return this.lock.run(async () => {
      const before = this.devices.length;
      this.devices = this.devices.filter((device) =>
        ids === "all" ? device.id === keep : !ids.includes(device.id),
      );
      const removed = before - this.devices.length;
      if (removed) await this.save();
      return removed;
    });
  }

  /** True when the device has been unused for longer than allowed. */
  private isExpired(device: Device): boolean {
    const limit = this.limitMs(device);
    return limit !== null && Date.now() - Date.parse(device.lastSeenAt) > limit;
  }

  /** Idle limit of a device in ms (null = never expires). */
  private limitMs(device: Device): number | null {
    if (device.ephemeral) return EPHEMERAL_HOURS * 60 * 60_000;
    const days = this.idleDays();
    return days > 0 ? days * DAY_MS : null;
  }

  /** Public view with the computed expiry. */
  private view(device: Device): DeviceView {
    const { secretHash: _secretHash, ...rest } = device;
    const limit = this.limitMs(device);
    return {
      ...rest,
      expiresAt: limit === null ? null : new Date(Date.parse(device.lastSeenAt) + limit).toISOString(),
    };
  }

  /** Drops expired devices (called before adding). */
  private prune(): void {
    this.devices = this.devices.filter((device) => !this.isExpired(device));
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await Bun.write(this.path, JSON.stringify(this.devices, null, 2));
    // Bun.write ignores `mode`; the file holds only hashes, but keep it private anyway.
    await chmod(this.path, 0o600);
  }
}

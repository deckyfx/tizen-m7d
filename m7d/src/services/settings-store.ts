import { createSocket } from "node:dgram";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PolicyError } from "../lib/errors";

/** Where the TV is and how it reaches this box: read live by every TV-facing component. */
export interface TvTarget {
  /** TV IP, or "" when not configured yet. */
  readonly tvHost: string;
  /** This box's IP on the TV's network, or "" when unknown. */
  readonly homelabIp: string;
}

/** Settings changeable from the dashboard (saved values override the environment). */
export interface EditableSettings {
  /** "" removes the saved value (back to the environment default). */
  tvHost?: string;
  homelabIp?: string;
}

/** Where a setting's current value comes from. */
export type SettingSource = "dashboard" | "environment" | "detected" | "unset";

/** Settings as shown in the dashboard. */
export interface SettingsView {
  tvHost: string;
  tvHostSource: SettingSource;
  homelabIp: string;
  homelabIpSource: SettingSource;
}

/** Strict dotted IPv4 (both values end up in commands, URLs and the shim's config.xml). */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/**
 * Local address the OS would use to reach `host` (a UDP "connect" sends nothing). On a box with
 * several interfaces (Docker bridges, VPNs) this picks the one on the TV's network.
 */
function localAddressTowards(host: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const done = (address: string) => {
      socket.close();
      resolve(address);
    };
    socket.once("error", () => done(""));
    socket.connect(9, host, () => {
      try {
        done(socket.address().address);
      } catch {
        done("");
      }
    });
  });
}

/**
 * Runtime settings saved in `<DATA_DIR>/settings.json`. The TV IP and this box's IP can be set
 * from the dashboard; unset values fall back to the environment (`TV_HOST`, `HOMELAB_IP`), and
 * this box's IP is detected from the route to the TV when neither gives one.
 */
export class SettingsStore implements TvTarget {
  private saved: EditableSettings = {};
  private detectedHomelabIp = "";
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly path: string,
    private readonly defaults: { tvHost: string; homelabIp: string },
  ) {}

  /** Reads the saved settings (a missing file means none) and detects this box's IP. */
  async load(): Promise<void> {
    const file = Bun.file(this.path);
    if (await file.exists()) this.saved = (await file.json()) as EditableSettings;
    await this.detect();
  }

  get tvHost(): string {
    return this.saved.tvHost || this.defaults.tvHost;
  }

  get homelabIp(): string {
    return this.saved.homelabIp || this.defaults.homelabIp || this.detectedHomelabIp;
  }

  /** Current values and where they come from. */
  view(): SettingsView {
    return {
      tvHost: this.tvHost,
      tvHostSource: this.saved.tvHost ? "dashboard" : this.defaults.tvHost ? "environment" : "unset",
      homelabIp: this.homelabIp,
      homelabIpSource: this.saved.homelabIp
        ? "dashboard"
        : this.defaults.homelabIp
          ? "environment"
          : this.detectedHomelabIp
            ? "detected"
            : "unset",
    };
  }

  /** Validates and saves a change, then notifies listeners (they drop connections to the old TV). */
  async update(patch: EditableSettings): Promise<SettingsView> {
    const next: EditableSettings = { ...this.saved };
    for (const key of ["tvHost", "homelabIp"] as const) {
      const value = patch[key]?.trim();
      if (value === undefined) continue;
      if (value !== "" && !IPV4.test(value)) return PolicyError.throw(`Not an IPv4 address: ${value}`);
      if (value === "") delete next[key];
      else next[key] = value;
    }
    const tvChanged = (next.tvHost || this.defaults.tvHost) !== this.tvHost;
    this.saved = next;
    await mkdir(dirname(this.path), { recursive: true });
    await Bun.write(this.path, JSON.stringify(this.saved, null, 2));
    if (tvChanged) await this.detect();
    for (const listener of this.listeners) listener();
    return this.view();
  }

  /** Calls `listener` after every saved change. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Re-detects this box's address towards the current TV. */
  private async detect(): Promise<void> {
    this.detectedHomelabIp = this.tvHost ? await localAddressTowards(this.tvHost) : "";
  }
}

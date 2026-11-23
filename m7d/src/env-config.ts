import { resolve } from "node:path";

/**
 * Typed access to m7d's environment configuration (singleton).
 *
 * Values come from `.env` (auto-loaded by Bun) or the process environment.
 */
class EnvConfig {
  private static instance: EnvConfig;

  private constructor() {}

  /** Returns the shared instance. */
  static getInstance(): EnvConfig {
    if (!EnvConfig.instance) EnvConfig.instance = new EnvConfig();
    return EnvConfig.instance;
  }

  /** Reads an integer variable, falling back to `fallback` when unset or invalid. */
  private int(name: string, fallback: number): number {
    const raw = Bun.env[name];
    const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(value) ? value : fallback;
  }

  /** HTTP port of the web UI + API. */
  get SERVER_PORT(): number {
    return this.int("SERVER_PORT", 8787);
  }

  /** Interface the HTTP server binds to (`0.0.0.0` = whole LAN). */
  get SERVER_HOST(): string {
    return Bun.env.SERVER_HOST ?? "0.0.0.0";
  }

  /** Bearer token required by every `/api` route except `/api/health` (required). */
  get M7D_TOKEN(): string {
    const token = Bun.env.M7D_TOKEN;
    if (!token || token.length < 16) {
      throw new Error("M7D_TOKEN is required in .env (at least 16 characters)");
    }
    return token;
  }

  /** Default TV IP ("" = set it in the dashboard; a value saved there wins). */
  get TV_HOST(): string {
    return Bun.env.TV_HOST ?? "";
  }

  /** sdbd port on the TV. */
  get TV_SDB_PORT(): number {
    return this.int("TV_SDB_PORT", 26101);
  }

  /** Samsung REST API port (plain HTTP). */
  get TV_REST_PORT(): number {
    return this.int("TV_REST_PORT", 8001);
  }

  /** Samsung remote-control WebSocket port (TLS, self-signed). */
  get TV_REMOTE_PORT(): number {
    return this.int("TV_REMOTE_PORT", 8002);
  }

  /** How long the idle sdb connection is kept before the TV's single slot is released. */
  get SDB_IDLE_RELEASE_MS(): number {
    return this.int("SDB_IDLE_RELEASE_MS", 5000);
  }

  /** Directory for runtime state (remote pairing token, caches). */
  get DATA_DIR(): string {
    return resolve(Bun.env.DATA_DIR ?? ".data");
  }

  /** True when running in development mode (enables HMR for the web UI). */
  get IS_DEVELOPMENT(): boolean {
    return (Bun.env.NODE_ENV ?? "development") === "development";
  }

  /**
   * Hand the access token to requests whose source IP is the TV, so the TV's
   * browser needs no typing. Anything on the TV (or spoofing its IP) gets access.
   */
  get TRUST_TV_IP(): boolean {
    return (Bun.env.TRUST_TV_IP ?? "true") === "true";
  }

  /** Path of the apps2samsung-cli binary. */
  get A2S_CLI_PATH(): string {
    return resolve(
      Bun.env.A2S_CLI_PATH ?? "../tools/apps2samsung/apps2samsung-cli",
    );
  }

  /**
   * Default for this box's IP on the TV's network ("" = detect it from the route to the TV; a
   * value saved in the dashboard wins). Baked into the YouTube shim (`--proxy`, setup report URL),
   * so it must stay fixed (DHCP reservation).
   */
  get HOMELAB_IP(): string {
    return Bun.env.HOMELAB_IP ?? "";
  }

  /** Port of the YouTube proxy that Cobalt on the TV uses (`--proxy`). */
  get YT_PROXY_PORT(): number {
    return this.int("YT_PROXY_PORT", 8101);
  }

  /**
   * Addresses admitted by the YouTube proxy besides the TV (comma list; the TV's current IP is
   * always admitted). The proxy is never open to the whole LAN; 127.0.0.1 allows curl tests.
   */
  get YT_PROXY_ALLOW(): string[] {
    return (Bun.env.YT_PROXY_ALLOW ?? "127.0.0.1")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);
  }
}

/** Shared configuration instance. */
export const envConfig = EnvConfig.getInstance();

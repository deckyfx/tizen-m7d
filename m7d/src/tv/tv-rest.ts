import type { TvTarget } from "../services/settings-store";
import { TvUnreachableError } from "../lib/errors";

/** Subset of the TV's `/api/v2/` device description that m7d uses. */
export interface TvDeviceInfo {
  name: string;
  modelName: string;
  model: string;
  ip: string;
  powerState: string;
  developerMode: boolean;
  developerIp: string;
  networkType: string;
  resolution: string;
}

/** Runtime state of one app as reported by the REST API. */
export interface TvAppStatus {
  id: string;
  name: string;
  running: boolean;
  visible: boolean;
  version: string;
}

/** Raw `/api/v2/` response shape (only the fields read here). */
interface RawDeviceResponse {
  name?: string;
  device?: {
    name?: string;
    modelName?: string;
    model?: string;
    ip?: string;
    PowerState?: string;
    developerMode?: string;
    developerIP?: string;
    networkType?: string;
    resolution?: string;
  };
}

/** How long a REST call may take before the TV counts as unreachable. */
const REST_TIMEOUT_MS = 3000;

/**
 * Client for the TV's unauthenticated REST API on port 8001.
 *
 * Verified on the M7: `GET` status, `POST` launch and `DELETE` close (running apps only)
 * work from the LAN without pairing.
 */
export class TvRestClient {
  /** @param target where the TV is (read per request), @param port REST port (8001) */
  constructor(
    private readonly target: TvTarget,
    private readonly port: number,
  ) {}

  /**
   * Sends one request; network failures become {@link TvUnreachableError}. The TV's REST
   * server now and then resets a kept-alive connection (seen 2026-11-23 while the TV was on),
   * so a reset is retried once on a fresh connection; a timeout (TV off) is not.
   */
  private async request(
    path: string,
    method: "GET" | "POST" | "DELETE",
  ): Promise<Response> {
    if (!this.target.tvHost) return TvUnreachableError.throw("No TV IP set: enter it in the dashboard's Settings");
    const send = (fresh: boolean) =>
      fetch(`http://${this.target.tvHost}:${this.port}/api/v2${path}`, {
        method,
        keepalive: !fresh,
        headers: fresh ? { connection: "close" } : undefined,
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
      });
    return send(false)
      .catch((error: Error) => {
        if (!/ECONNRESET|socket connection was closed/i.test(error.message)) throw error;
        return send(true);
      })
      .catch((error: Error) =>
        TvUnreachableError.throw(
          `TV REST API unreachable (${error.name}: ${error.message})`,
        ),
      );
  }

  /** Returns the device description; throws {@link TvUnreachableError} when the TV is off. */
  async deviceInfo(): Promise<TvDeviceInfo> {
    const response = await this.request("/", "GET");
    const raw = (await response.json()) as RawDeviceResponse;
    const device = raw.device ?? {};
    return {
      name: (device.name ?? raw.name ?? "").replace(/&quot;/g, '"'),
      modelName: device.modelName ?? "",
      model: device.model ?? "",
      ip: device.ip ?? "",
      powerState: device.PowerState ?? "unknown",
      developerMode: device.developerMode === "1",
      developerIp: device.developerIP ?? "",
      networkType: device.networkType ?? "",
      resolution: device.resolution ?? "",
    };
  }

  /** Returns the app's status, or `undefined` if the REST API does not know the id. */
  async appStatus(appId: string): Promise<TvAppStatus | undefined> {
    const response = await this.request(
      `/applications/${encodeURIComponent(appId)}`,
      "GET",
    );
    if (response.status === 404) return undefined;
    const raw = (await response.json()) as Partial<TvAppStatus>;
    if (raw.id === undefined) return undefined;
    return {
      id: raw.id,
      name: raw.name ?? raw.id,
      running: raw.running === true,
      visible: raw.visible === true,
      version: raw.version ?? "",
    };
  }

  /** Launches the app; returns true when the TV accepted the request. */
  async launch(appId: string): Promise<boolean> {
    const response = await this.request(
      `/applications/${encodeURIComponent(appId)}`,
      "POST",
    );
    return response.ok;
  }

  /** Asks the TV to close a running app; returns false when it was not running. */
  async close(appId: string): Promise<boolean> {
    const response = await this.request(
      `/applications/${encodeURIComponent(appId)}`,
      "DELETE",
    );
    if (!response.ok) return false;
    return (await response.text()).trim() === "true";
  }
}

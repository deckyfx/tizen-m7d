import { treaty } from "@elysiajs/eden";
import type { App } from "../../server";

/** What the server knows about this browser (`GET /api/client`, public). */
export interface ClientInfo {
  /** This page runs on the TV itself (its browser or an app on it). */
  isTv: boolean;
  /** Source IP the server saw. */
  ip: string;
  /** Tizen id of the TV browser, i.e. the app this dashboard runs in on the TV. */
  selfTizenId: string;
  /** Access token handed out to the trusted TV (null otherwise). */
  token: string | null;
}

/** Fallback when the server cannot be asked (offline, old server). */
const UNKNOWN_CLIENT: ClientInfo = {
  isTv: false,
  ip: "",
  selfTizenId: "org.tizen.browser",
  token: null,
};

/**
 * Asks the server whether this browser is the TV. `?tv=1` / `?tv=0` in the URL
 * forces TV layout on or off (for testing on a PC).
 */
export async function fetchClientInfo(): Promise<ClientInfo> {
  const publicApi = treaty<App>(window.location.origin, { parseDate: false });
  const { data } = await publicApi.api.client.get();
  const info: ClientInfo = data
    ? {
        isTv: data.isTv,
        ip: data.ip,
        selfTizenId: data.selfTizenId,
        token: data.token,
      }
    : UNKNOWN_CLIENT;

  const forced = new URLSearchParams(window.location.search).get("tv");
  if (forced === "1") return { ...info, isTv: true };
  if (forced === "0") return { ...info, isTv: false };
  return info;
}

/** Switches the page between phone/desktop and TV (10-foot) presentation. */
export function applyTvMode(isTv: boolean): void {
  document.documentElement.classList.toggle("tv", isTv);
}

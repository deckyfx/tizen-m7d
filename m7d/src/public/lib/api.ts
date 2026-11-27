import { treaty } from "@elysiajs/eden";
import type { App } from "../../server";

/**
 * Creates the type-safe API client for the server that served this page.
 * Uses `window.location.origin`, so it works from any device/IP on the LAN. With a token (the TV)
 * it sends it as a Bearer header; otherwise the remembered-browser cookie signs requests in.
 */
export function createApi(token = "") {
  return treaty<App>(window.location.origin, {
    // Keep dates as the strings the API types declare (Eden would turn them into Date objects,
    // which React cannot render: "Objects are not valid as a React child").
    parseDate: false,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

/** Typed client returned by {@link createApi}. */
export type Api = ReturnType<typeof createApi>;

/**
 * Key under which the bearer token is kept in this browser: only on the TV (handed over by IP).
 * PCs and phones use the remembered-browser cookie; an old stored token is traded for one.
 */
const TOKEN_KEY = "m7d.token";

/** Reads the remembered token ("" if none or storage is blocked). */
export function loadToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remembers (or with "" forgets) the token in this browser. */
export function saveToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private mode): the token only lives for this page load.
  }
}

/** Shape of every API error body. */
interface ApiErrorBody {
  error?: string;
}

/** Turns an Eden error into a human-readable message ("502: …"). */
export function errorMessage(error: { status: unknown; value: unknown }): string {
  const body = error.value as ApiErrorBody | string | undefined;
  const text = typeof body === "string" ? body : body?.error;
  return `${String(error.status)}: ${text ?? "request failed"}`;
}

/**
 * Fetches a protected file (signed package, log text) with the stored token, or else the cookie.
 * The one place the UI uses fetch directly: Eden cannot hand over raw downloads.
 */
export async function fetchProtected(path: string): Promise<Response> {
  const token = loadToken();
  return fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

/** Downloads a protected file as `filename` in the browser. */
export async function downloadProtected(path: string, filename: string): Promise<boolean> {
  const response = await fetchProtected(path);
  if (!response.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

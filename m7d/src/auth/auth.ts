import { timingSafeEqual } from "node:crypto";
import { normalizeIp } from "../lib/client-detect";
import type { AccessRequests } from "./access-requests";
import type { DeviceStore, DeviceView } from "./device-store";

/** Cookie holding `<device id>.<secret>`. */
export const DEVICE_COOKIE = "m7d_device";

/** Chrome caps cookie lifetimes at 400 days; m7d renews the cookie as the browser is used. */
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** Wrong tokens allowed per address per window before sign-in by token is refused for a while. */
const MAX_TOKEN_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60_000;

/** Who a request is. */
export type Principal =
  | { kind: "token" }
  | { kind: "device"; device: DeviceView }
  | { kind: "none" };

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/** Constant-time check of a presented token. */
function tokenMatches(presented: string, token: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sign-in for the dashboard and API:
 * - `Authorization: Bearer <M7D_TOKEN>`: scripts, the TV's own browser (handed the token by IP);
 * - a remembered browser: `m7d_device` cookie (HttpOnly, SameSite=Strict, Secure over HTTPS),
 *   obtained by typing the token once or by approval from an already signed-in device.
 */
export class Auth {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly token: string,
    readonly devices: DeviceStore,
    readonly requests: AccessRequests,
    /** Socket address of a request (from the HTTP server). */
    private readonly socketAddress: (request: Request) => string | undefined,
  ) {}

  /**
   * Address to show and rate-limit by: the proxy's X-Real-IP / X-Forwarded-For when present
   * (nginx proxy manager in front), else the socket address. Display only: never trust it for
   * recognising the TV.
   */
  clientIp(request: Request): string {
    const forwarded =
      request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return normalizeIp(forwarded || this.socketAddress(request));
  }

  /** Identifies the caller (token first, then the device cookie); renews a used cookie. */
  async identify(request: Request, setCookie: (value: string) => void): Promise<Principal> {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer && tokenMatches(bearer, this.token)) return { kind: "token" };
    const cookie = readCookie(request.headers.get("cookie"), DEVICE_COOKIE);
    if (!cookie) return { kind: "none" };
    const result = await this.devices.verify(cookie, this.clientIp(request));
    if (!result) return { kind: "none" };
    if (result.renew && !result.device.ephemeral) setCookie(this.cookieHeader(request, cookie, false));
    return { kind: "device", device: result.device };
  }

  /**
   * Cookie-authenticated changes must come from the dashboard itself: when the browser sends an
   * Origin, its host must be the host the request was sent to (SameSite=Strict already keeps
   * other sites' requests cookie-less; this also covers older browsers).
   */
  sameOrigin(request: Request): boolean {
    const origin = request.headers.get("origin");
    if (!origin || request.method === "GET" || request.method === "HEAD") return true;
    try {
      return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    } catch {
      return false;
    }
  }

  /** Checks a typed token (rate limited per address); true when it is right. */
  checkToken(request: Request, presented: string): "ok" | "wrong" | "locked" {
    const ip = this.clientIp(request);
    const now = Date.now();
    const entry = this.failures.get(ip);
    if (entry && now - entry.since > FAILURE_WINDOW_MS) this.failures.delete(ip);
    const current = this.failures.get(ip);
    if (current && current.count >= MAX_TOKEN_FAILURES) return "locked";
    if (tokenMatches(presented, this.token)) {
      this.failures.delete(ip);
      return "ok";
    }
    this.failures.set(ip, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
    return "wrong";
  }

  /** Set-Cookie value for a device cookie (`ephemeral`: until the browser closes). */
  cookieHeader(request: Request, value: string, ephemeral: boolean): string {
    const parts = [`${DEVICE_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict"];
    if (!ephemeral) parts.push(`Max-Age=${COOKIE_MAX_AGE_S}`);
    if (this.isHttps(request)) parts.push("Secure");
    return parts.join("; ");
  }

  /** Set-Cookie value that deletes the device cookie. */
  clearCookieHeader(request: Request): string {
    const parts = [`${DEVICE_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
    if (this.isHttps(request)) parts.push("Secure");
    return parts.join("; ");
  }

  /** True when the browser reached m7d over HTTPS (directly or through the proxy). */
  private isHttps(request: Request): boolean {
    return request.headers.get("x-forwarded-proto") === "https" || request.url.startsWith("https:");
  }
}

/**
 * Detects whether a dashboard request comes from the TV itself.
 */

/** Result of {@link detectClient}. */
export interface ClientDetection {
  /** Request source IP (IPv4-mapped IPv6 prefix removed). */
  ip: string;
  /** Source IP equals the TV's IP: the TV's own browser (or an app on it). */
  fromTvIp: boolean;
  /** User agent looks like a Samsung/Tizen TV browser. */
  tvUserAgent: boolean;
}

/** Matches Samsung Smart TV / Tizen browser user agents. */
const TV_USER_AGENT = /\b(Tizen|SMART-TV|SmartTV|SamsungBrowser\/[\d.]+.*TV)\b/i;

/** Strips the `::ffff:` prefix Bun reports for IPv4 clients on a dual-stack socket. */
export function normalizeIp(address: string | undefined): string {
  return (address ?? "").replace(/^::ffff:/i, "");
}

/** Classifies a request by source IP and user agent. */
export function detectClient(
  address: string | undefined,
  userAgent: string | undefined,
  tvHost: string,
): ClientDetection {
  const ip = normalizeIp(address);
  return {
    ip,
    fromTvIp: ip !== "" && ip === tvHost,
    tvUserAgent: TV_USER_AGENT.test(userAgent ?? ""),
  };
}

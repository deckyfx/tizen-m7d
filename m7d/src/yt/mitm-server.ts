import type { Server } from "bun";
import type { CertAuthority } from "./cert-authority";
import type { Userscript } from "./userscript";

/** Hosts whose TLS the proxy terminates (to inject the userscript). Everything else is tunnelled untouched. */
export const MITM_HOSTS: readonly string[] = ["www.youtube.com", "youtube.com"];

/** Same-origin path the injected `<script>` loads the userscript from (answered here, never upstream). */
export const USERSCRIPT_PATH = "/__m7d/userscript.js";

/** Headers that belong to one hop and must not be forwarded. */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/** Statuses that never carry a body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** `<meta http-equiv="Content-Security-Policy…">` tags in the /tv page. */
const CSP_META = /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi;

/** The /tv page's CSP after injection (TizenTube's policy: the userscript talks to SponsorBlock/DeArrow). */
const TV_PAGE_CSP = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "script-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src * data: blob: 'unsafe-inline'",
  "connect-src *",
  "font-src * data:",
].join("; ");

/** Counters shown on the YouTube page. */
export interface MitmStats {
  requests: number;
  /** /tv pages the userscript was injected into. */
  injections: number;
  lastInjectionAt: string | null;
  /** Times Cobalt fetched the userscript (it then runs in the page). */
  userscriptLoads: number;
  errors: number;
  lastError: { at: string; message: string } | null;
}

/** Copies `source` without hop-by-hop headers. */
function forwardable(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
}

/**
 * TLS endpoint for the intercepted YouTube hosts, listening on a random loopback port that only the
 * proxy connects to. Requests are replayed to the real host with `fetch` (certificates
 * verified, bodies streamed, compression passed through). The `/tv` page gets its CSP relaxed
 * and a `<script>` for the pinned userscript, which is served from memory here.
 */
export class MitmServer {
  private server: Server<undefined> | undefined;
  readonly stats: MitmStats = {
    requests: 0,
    injections: 0,
    lastInjectionAt: null,
    userscriptLoads: 0,
    errors: 0,
    lastError: null,
  };

  constructor(
    private readonly ca: CertAuthority,
    private readonly userscript: Userscript,
    /** Where requests for `host` really go (tests point this at a local server). */
    private readonly upstreamOrigin: (host: string) => string = (host) => `https://${host}`,
  ) {}

  /** Loopback port the proxy forwards intercepted tunnels to (0 before {@link start}). */
  get port(): number {
    return this.server?.port ?? 0;
  }

  /** Makes sure the host certificates exist, then listens on a random 127.0.0.1 port. */
  async start(): Promise<void> {
    const tls = await Promise.all(
      MITM_HOSTS.map(async (serverName) => ({ serverName, ...(await this.ca.hostCertificate(serverName)) })),
    );
    await this.userscript.get();
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls,
      // No idle limit: YouTube long-polls (lounge, sign-in) stay open for minutes, and Bun's 10 s
      // default cut them ("Bun.serve() timed out a request after 10 seconds", 2026-11-23).
      // Dead TV connections still end: the proxy's keep-alive closes the outer tunnel.
      // (A unix socket was used first: there idleTimeout is untyped and server.timeout() is ignored.)
      idleTimeout: 0,
      fetch: (request) => this.handle(request),
    });
  }

  /** Stops listening and drops open connections. */
  stop(): void {
    void this.server?.stop(true);
    this.server = undefined;
  }

  /** Records a failure for the UI. */
  private fail(message: string): Response {
    this.stats.errors += 1;
    this.stats.lastError = { at: new Date().toISOString(), message: message.slice(0, 300) };
    return new Response("m7d proxy: upstream failed", { status: 502 });
  }

  /** Handles one request arriving through the intercepted tunnel. */
  private async handle(request: Request): Promise<Response> {
    this.stats.requests += 1;
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? url.host).replace(/:\d+$/, "").toLowerCase();
    if (!MITM_HOSTS.includes(host)) return new Response("Misdirected request", { status: 421 });
    if (url.pathname === USERSCRIPT_PATH) return this.serveUserscript(request);

    const isTvPage = request.method === "GET" && url.pathname === "/tv";
    const headers = forwardable(request.headers);
    headers.delete("host");
    // The /tv page is rewritten, so ask for it uncompressed.
    if (isTvPage) headers.set("accept-encoding", "identity");
    const hasBody = request.method !== "GET" && request.method !== "HEAD";

    let upstream: Response;
    try {
      upstream = await fetch(`${this.upstreamOrigin(host)}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: "manual",
        decompress: false,
        // Cobalt hanging up (or giving up on a long-poll) cancels the upstream request too.
        signal: request.signal,
      });
    } catch (error) {
      return this.fail(`${request.method} ${host}${url.pathname}: ${(error as Error).message}`);
    }

    const responseHeaders = forwardable(upstream.headers);
    const isHtml = upstream.headers.get("content-type")?.includes("text/html") ?? false;
    if (!isTvPage || !isHtml || upstream.status !== 200) {
      return new Response(NULL_BODY.has(upstream.status) ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }
    return this.injectInto(upstream, responseHeaders);
  }

  /** Rewrites the /tv page: relaxed CSP and the userscript tag before `</body>`. */
  private async injectInto(upstream: Response, headers: Headers): Promise<Response> {
    const { hash } = await this.userscript.get();
    // `sha=`, not the first build's `v=`: Cobalt cached the `v=` URL as immutable for a year.
    const tag = `<script src="${USERSCRIPT_PATH}?sha=${hash}"></script>`;
    let html = (await upstream.text()).replace(CSP_META, "");
    html = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;

    for (const name of ["content-length", "content-encoding", "content-security-policy", "content-security-policy-report-only"]) {
      headers.delete(name);
    }
    headers.set("content-security-policy", TV_PAGE_CSP);
    headers.set("cache-control", "no-store");
    this.stats.injections += 1;
    this.stats.lastInjectionAt = new Date().toISOString();
    return new Response(html, { status: 200, headers });
  }

  /**
   * Serves the pinned userscript (gzip when accepted). `no-cache` + ETag: Cobalt revalidates on
   * every page load (a 304 when unchanged), so each load is visible in {@link MitmStats.userscriptLoads}.
   */
  private async serveUserscript(request: Request): Promise<Response> {
    const bundle = await this.userscript.get();
    this.stats.userscriptLoads += 1;
    const etag = `"${bundle.hash}"`;
    const headers = new Headers({
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      vary: "accept-encoding",
      etag,
    });
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const gzip = request.headers.get("accept-encoding")?.includes("gzip") ?? false;
    if (gzip) headers.set("content-encoding", "gzip");
    return new Response(gzip ? bundle.gzip : bundle.body, { headers });
  }
}

import packageJson from "../../package.json";
import { detectClient } from "../lib/client-detect";
import { DIAG_PAGE_HTML } from "./diag-page";
import { a2sPlugin, type A2sDeps } from "./routeA2s";
import { ytPlugin, ytReportPlugin } from "./routeYt";
import { Elysia, t } from "elysia";
import {
  A2sError,
  AppNotFoundError,
  PolicyError,
  SdbError,
  TvRemoteError,
  TvUnreachableError,
  YtSetupError,
} from "../lib/errors";
import { APP_ACTIONS, type AppManager } from "../services/app-manager";
import type { SdbClient } from "../tv/sdb-client";
import {
  REMOTE_KEYS,
  TV_BROWSER_TIZEN_ID,
  type RemoteKey,
  type TvRemoteClient,
} from "../tv/tv-remote";
import type { TvRestClient } from "../tv/tv-rest";
import type { YtService } from "../yt/yt-service";
import type { SettingsStore } from "../services/settings-store";
import { settingsPlugin } from "./routeSettings";
import type { Auth } from "../auth/auth";
import { authAdminPlugin, authPublicPlugin } from "./routeAuth";

/** Services the API routes need (injected by `server.ts`). */
export interface ApiDeps {
  apps: AppManager;
  rest: TvRestClient;
  remote: TvRemoteClient;
  sdb: SdbClient;
  /** The token handed to the trusted TV (sign-in itself goes through `auth`). */
  token: string;
  /** Token and remembered-browser sign-in. */
  auth: Auth;
  /** The TV (its IP recognises the TV's own browser) and the settings page's store. */
  settings: SettingsStore;
  /** Give the token to requests from the TV's IP (no typing on the TV). */
  trustTvIp: boolean;
  /** Source address of a request (from the HTTP server). */
  clientAddress: (request: Request) => string | undefined;
  /** Apps2Samsung service, job queue and upload folder. */
  a2s: A2sDeps;
  /** Homelab YouTube (proxy, shim, setup). */
  yt: YtService;
}

/** Last user agent seen from the TV's browser (to know its engine version). */
interface TvBrowserSighting {
  userAgent: string;
  seenAt: string;
  /** Feature report posted by the `/api/diag` page, if it ran on the TV. */
  features: Record<string, string | number | boolean> | null;
}

/** Status-only state of the TV when its REST API does not answer. */
const OFFLINE = { online: false as const };

/**
 * `/api` routes: health (public) and the authenticated TV / task-manager endpoints.
 */
export const apiPlugin = (deps: ApiDeps) => {
  let tvBrowser: TvBrowserSighting | undefined;

  /** Builds a sighting stamped with the current time. */
  const sighting = (
    userAgent: string,
    features: TvBrowserSighting["features"],
  ): TvBrowserSighting => ({
    userAgent,
    seenAt: new Date().toISOString(),
    features,
  });

  /** True when `request` comes from the TV (IP or user agent). */
  const fromTv = (request: Request, userAgent: string): boolean => {
    const client = detectClient(
      deps.clientAddress(request),
      userAgent,
      deps.settings.tvHost,
    );
    return client.fromTvIp || client.tvUserAgent;
  };

  return new Elysia({ prefix: "/api" })
    .error({
      SdbError,
      TvUnreachableError,
      TvRemoteError,
      AppNotFoundError,
      A2sError,
      PolicyError,
      YtSetupError,
    })
    .onError(({ code, error, status }) => {
      switch (code) {
        case "AppNotFoundError":
          return status(404, { error: error.message, kind: code });
        case "TvUnreachableError":
          return status(503, { error: error.message, kind: code });
        case "SdbError":
          return status(error.reason === "busy" ? 409 : 502, {
            error: error.message,
            kind: code,
          });
        case "TvRemoteError":
          return status(502, { error: error.message, kind: code });
        case "PolicyError":
          return status(400, { error: error.message, kind: code });
        case "YtSetupError":
          return status(502, { error: error.message, kind: code });
        case "A2sError":
          // 3 = the CLI stopped at a pre-install check: a conflict the user can override.
          return status(error.exitCode === 3 ? 409 : 502, {
            error: error.message,
            kind: code,
            exitCode: error.exitCode,
          });
        case "UNKNOWN":
        case "INTERNAL_SERVER_ERROR":
          // Programming bugs: keep Elysia's 500 response, but never fail silently.
          console.error(`[m7d] unexpected ${code} error:`, error);
          return undefined;
        default:
          return undefined;
      }
    })
    .get("/health", () => ({ ok: true as const, service: "m7d", version: packageJson.version }))
    // Public, script-light diagnostics page: works on any engine, records the TV's browser.
    .get("/diag", ({ request, headers }) => {
      const userAgent = headers["user-agent"] ?? "";
      if (fromTv(request, userAgent)) {
        console.log(`[m7d] TV opened /api/diag: ${userAgent}`);
        tvBrowser = sighting(userAgent, tvBrowser?.features ?? null);
      }
      return new Response(DIAG_PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    })
    .post(
      "/diag",
      ({ request, headers, body }) => {
        const userAgent = headers["user-agent"] ?? "";
        if (!fromTv(request, userAgent)) return { recorded: false };
        console.log(`[m7d] TV browser features: ${JSON.stringify(body)}`);
        tvBrowser = sighting(userAgent, body);
        return { recorded: true };
      },
      {
        body: t.Record(
          t.String({ maxLength: 64 }),
          t.Union([t.String({ maxLength: 512 }), t.Number(), t.Boolean()]),
        ),
      },
    )
    .get("/client", ({ request, headers }) => {
      const userAgent = headers["user-agent"] ?? "";
      const client = detectClient(
        deps.clientAddress(request),
        userAgent,
        deps.settings.tvHost,
      );
      const isTv = client.fromTvIp || client.tvUserAgent;
      if (isTv && tvBrowser?.userAgent !== userAgent) {
        console.log(`[m7d] TV browser connected from ${client.ip}: ${userAgent}`);
      }
      if (isTv) tvBrowser = sighting(userAgent, tvBrowser?.features ?? null);
      const trusted = client.fromTvIp && deps.trustTvIp;
      return {
        isTv,
        ip: client.ip,
        trusted,
        token: trusted ? deps.token : null,
        selfTizenId: TV_BROWSER_TIZEN_ID,
      };
    })
    .use(ytReportPlugin({ yt: deps.yt, target: deps.settings, clientAddress: deps.clientAddress }))
    .use(authPublicPlugin(deps.auth))
    .guard(
      {
        // Bearer token (scripts, the TV) or a remembered browser's cookie.
        async beforeHandle({ request, set, status }) {
          const who = await deps.auth.identify(request, (cookie) => {
            set.headers["set-cookie"] = cookie;
          });
          if (who.kind === "none") {
            return status(401, { error: "Not signed in", kind: "Unauthorized" });
          }
          if (who.kind === "device" && !deps.auth.sameOrigin(request)) {
            return status(403, { error: "Cross-site request refused", kind: "Forbidden" });
          }
        },
      },
      (app) =>
        app
          .get("/tv", async () => {
            const info = await deps.rest.deviceInfo().catch((error: Error) => {
              if (error instanceof TvUnreachableError) return undefined;
              throw error;
            });
            if (!info) return OFFLINE;
            return {
              online: true as const,
              ...info,
              sdb: { connected: deps.sdb.isConnected, banner: deps.sdb.banner },
              remotePaired: await deps.remote.isPaired(),
              tvBrowser: tvBrowser ?? null,
            };
          })
          .get("/apps", ({ query }) => deps.apps.list(query.refresh === "1"), {
            query: t.Object({ refresh: t.Optional(t.String()) }),
          })
          .post(
            "/apps/:appId/:action",
            ({ params }) => deps.apps.perform(params.appId, params.action),
            {
              params: t.Object({
                appId: t.String({ minLength: 1, maxLength: 128 }),
                // Not t.UnionEnum: under a real Bun.serve (Elysia 1.4.32, Bun 1.4.5) it makes every request
                // fail with "Attempting to change configurable attribute of unconfigurable property".
                action: t.Union(APP_ACTIONS.map((action) => t.Literal(action))),
              }),
            },
          )
          .post(
            "/tv/key",
            async ({ body }) => {
              await deps.remote.sendKey(
                body.key,
                body.holdMs ? { kind: "hold", holdMs: body.holdMs } : { kind: "click" },
              );
              return { ok: true as const };
            },
            {
              body: t.Object({
                // Not t.UnionEnum (breaks under Bun.serve, see /apps route).
                key: t.Unsafe<RemoteKey>(
                  t.Union(REMOTE_KEYS.map((key) => t.Literal(key))),
                ),
                holdMs: t.Optional(t.Number({ minimum: 100, maximum: 5000 })),
              }),
            },
          )
          .post(
            "/tv/text",
            async ({ body }) => {
              await deps.remote.sendText(body.text);
              return { ok: true as const };
            },
            { body: t.Object({ text: t.String({ minLength: 1, maxLength: 500 }) }) },
          )
          .post(
            "/tv/power-off",
            async () => {
              await deps.remote.powerOff();
              return {
                ok: true as const,
                message: "Power-off sent. The next power-on is a cold boot.",
              };
            },
            { body: t.Object({ confirm: t.Literal(true) }) },
          )
          .use(a2sPlugin(deps.a2s))
          .use(ytPlugin(deps.yt))
          .use(settingsPlugin(deps.settings))
          .use(authAdminPlugin(deps.auth, deps.settings)),
    );
};

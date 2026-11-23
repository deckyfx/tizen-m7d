import { Elysia, t } from "elysia";
import { normalizeIp } from "../lib/client-detect";
import type { TvTarget } from "../services/settings-store";
import type { YtService } from "../yt/yt-service";

/** Body the shim's setup service POSTs (see src/yt/shim/setup-service.es5.txt). */
const SetupReportBody = t.Object({
  ok: t.Boolean(),
  shimVersion: t.String({ maxLength: 32 }),
  node: t.String({ maxLength: 32 }),
  contentDir: t.String({ maxLength: 256 }),
  source: t.Optional(t.String({ maxLength: 256 })),
  files: t.Optional(t.Integer({ minimum: 0 })),
  bytes: t.Optional(t.Integer({ minimum: 0 })),
  content: t.Optional(t.Union([t.Literal("current"), t.Literal("copied")])),
  certFiles: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 20 })),
  removed: t.Optional(t.Array(t.String({ maxLength: 256 }), { maxItems: 20 })),
  error: t.Optional(t.String({ maxLength: 2000 })),
  durationMs: t.Integer({ minimum: 0 }),
});

/** What the public report route needs. */
export interface YtReportDeps {
  yt: YtService;
  target: TvTarget;
  clientAddress: (request: Request) => string | undefined;
}

/**
 * `POST /yt/setup-report`: the setup service on the TV has no token, so this route is outside
 * the token guard and admits only the TV's IP.
 */
export const ytReportPlugin = (deps: YtReportDeps) =>
  new Elysia({ prefix: "/yt" }).post(
    "/setup-report",
    async ({ request, body, status }) => {
      if (normalizeIp(deps.clientAddress(request)) !== deps.target.tvHost || !deps.target.tvHost) {
        return status(403, { error: "Only the TV may report", kind: "Forbidden" });
      }
      await deps.yt.receiveReport(body);
      return { recorded: true as const };
    },
    { body: SetupReportBody },
  );

/**
 * `/yt` routes (behind the token): homelab YouTube status, shim install, setup and launch.
 */
export const ytPlugin = (yt: YtService) =>
  new Elysia({ prefix: "/yt" })
    .get("/status", () => yt.status())
    .get(
      "/ca.pem",
      async () =>
        new Response(await yt.caPem(), {
          headers: {
            "content-type": "application/x-pem-file",
            "content-disposition": 'attachment; filename="m7d-youtube-proxy-ca.pem"',
          },
        }),
    )
    .post("/shim/install", () => yt.installShim())
    .post("/setup", () => yt.runSetup())
    .post("/launch", () => yt.launch());

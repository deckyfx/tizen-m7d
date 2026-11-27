import { join } from "node:path";
import { Elysia } from "elysia";
import { A2sCli } from "./a2s/a2s-cli";
import { A2sService } from "./a2s/a2s-service";
import { JobRunner } from "./a2s/job-runner";
import { envConfig } from "./env-config";
import { apiPlugin } from "./plugins/routeApi";
import { appPlugin } from "./plugins/routeApp";
import { AppManager } from "./services/app-manager";
import { SettingsStore } from "./services/settings-store";
import { AccessRequests } from "./auth/access-requests";
import { Auth } from "./auth/auth";
import { DeviceStore } from "./auth/device-store";
import { SdbClient } from "./tv/sdb-client";
import { TvRemoteClient } from "./tv/tv-remote";
import { TvRestClient } from "./tv/tv-rest";
import { CertAuthority } from "./yt/cert-authority";
import { MitmServer } from "./yt/mitm-server";
import { Userscript } from "./yt/userscript";
import { YoutubeProxy } from "./yt/youtube-proxy";
import { YtService } from "./yt/yt-service";

/**
 * m7d: homelab daemon for the Samsung M7.
 * Single owner of the TV's sdb connection; serves the task-manager API and web UI.
 */
// TV IP and this box's IP: set in the dashboard (Settings), defaulting to TV_HOST / HOMELAB_IP.
const settings = new SettingsStore(join(envConfig.DATA_DIR, "settings.json"), {
  tvHost: envConfig.TV_HOST,
  homelabIp: envConfig.HOMELAB_IP,
});
await settings.load();

const sdb = new SdbClient(settings, envConfig.TV_SDB_PORT, envConfig.SDB_IDLE_RELEASE_MS);
const rest = new TvRestClient(settings, envConfig.TV_REST_PORT);
const remote = new TvRemoteClient(
  settings,
  envConfig.TV_REMOTE_PORT,
  `${envConfig.DATA_DIR}/tv-remote.token`,
);
const apps = new AppManager(sdb, rest);

// Apps2Samsung as a web service: the CLI borrows the TV's sdb slot for each command.
const uploadDir = join(envConfig.DATA_DIR, "uploads");
const jobs = new JobRunner();
const a2s = new A2sService(new A2sCli(envConfig.A2S_CLI_PATH), sdb, jobs, {
  target: settings,
  uploadDir,
  profileDir: join(envConfig.DATA_DIR, "profiles"),
  signedDir: join(envConfig.DATA_DIR, "signed"),
  onTvAppsChanged: () => apps.invalidate(),
  ensureTvOnline: async () => {
    await rest.deviceInfo();
  },
});

// Homelab YouTube: proxy + TLS interception for Cobalt on the TV, the shim app, its setup service.
const ytDir = join(envConfig.DATA_DIR, "yt");
const ca = new CertAuthority(join(ytDir, "ca"));
const userscript = new Userscript();
const mitm = new MitmServer(ca, userscript);
const yt = new YtService(
  ca,
  userscript,
  mitm,
  new YoutubeProxy(envConfig.YT_PROXY_PORT, envConfig.YT_PROXY_ALLOW, settings, () => mitm.port),
  a2s,
  sdb,
  apps,
  {
    target: settings,
    proxyPort: envConfig.YT_PROXY_PORT,
    serverPort: envConfig.SERVER_PORT,
    dir: ytDir,
    ensureTvOnline: async () => {
      await rest.deviceInfo();
    },
  },
);

// A new TV IP: drop the connections to the old TV and forget its app list.
settings.onChange((change) => {
  if (!change.tvHost) return;
  sdb.release();
  remote.disconnect();
  apps.invalidate();
});

// `bun --hot` re-runs this module: stop the previous instance's listeners before starting ours.
const hot = globalThis as typeof globalThis & { __m7dYt?: YtService };
hot.__m7dYt?.stop();
hot.__m7dYt = yt;
await yt.start().catch((error: Error) => console.error(`[yt] not started: ${error.message}`));

/** Filled after listen(); lets the API read client IPs without a type cycle on `app`. */
const httpServer: { current?: { requestIP(request: Request): { address: string } | null } } = {};
const clientAddress = (request: Request) => httpServer.current?.requestIP(request)?.address;

// Sign-in: the token (scripts, the TV) or remembered browsers (token once, or approval).
const devices = new DeviceStore(join(envConfig.DATA_DIR, "auth", "devices.json"), () => settings.deviceIdleDays);
await devices.load();
const auth = new Auth(envConfig.M7D_TOKEN, devices, new AccessRequests(), clientAddress);

const app = new Elysia({
  serve: {
    development: envConfig.IS_DEVELOPMENT,
    // Some Apps2Samsung reads (leftovers, installed) take well over Bun's 10 s default.
    idleTimeout: 240,
  },
})
  .use(
    apiPlugin({
      apps,
      rest,
      remote,
      sdb,
      token: envConfig.M7D_TOKEN,
      settings,
      trustTvIp: envConfig.TRUST_TV_IP,
      clientAddress,
      auth,
      a2s: { a2s, jobs, uploadDir },
      yt,
    }),
  )
  .use(appPlugin)
  .listen({ port: envConfig.SERVER_PORT, hostname: envConfig.SERVER_HOST });
httpServer.current = app.server ?? undefined;

console.log(
  `m7d listening on http://${envConfig.SERVER_HOST}:${app.server?.port} (TV ${settings.tvHost || "not set"}, data ${envConfig.DATA_DIR})`,
);

/** App type for the Eden Treaty client. */
export type App = typeof app;

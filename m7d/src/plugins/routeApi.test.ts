import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { AppManager } from "../services/app-manager";
import { SdbClient } from "../tv/sdb-client";
import { TvRemoteClient } from "../tv/tv-remote";
import { TvRestClient } from "../tv/tv-rest";
import { A2sCli } from "../a2s/a2s-cli";
import { A2sService } from "../a2s/a2s-service";
import { JobRunner } from "../a2s/job-runner";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CertAuthority } from "../yt/cert-authority";
import { MitmServer } from "../yt/mitm-server";
import { Userscript } from "../yt/userscript";
import { YoutubeProxy } from "../yt/youtube-proxy";
import { YtService } from "../yt/yt-service";
import { SettingsStore } from "../services/settings-store";
import { apiPlugin } from "./routeApi";

/**
 * Runs the API on a real Bun.serve socket (not `app.handle()`): some Elysia schema bugs only
 * show up there (t.UnionEnum params → "Attempting to change configurable attribute…").
 * The "TV" is an unreachable loopback port, so no real device is touched.
 */
const TOKEN = "test-token-0123456789abcdef";
const DEAD_HOST = "127.0.0.1";
/** Pretend IP of the TV; each test sets the IP the API "sees" via clientIp. */
const FAKE_TV_IP = "10.9.9.9";
let clientIp = "192.0.2.50";
/** apps2samsung-cli is never actually run by these tests. */
const FAKE_CLI_PATH = "/nonexistent/apps2samsung-cli";
const jobs = new JobRunner();
/** Scratch folder for the YouTube CA and setup report. */
const ytDir = mkdtempSync(join(tmpdir(), "m7d-api-yt-"));

/** The TV clients talk to a dead local port, so no real device is touched (and nothing hangs). */
const DEAD_TV = { tvHost: DEAD_HOST, homelabIp: "" };
/** Settings as the API sees them: the "TV" is FAKE_TV_IP (for recognising the TV's browser). */
const settings = new SettingsStore(join(ytDir, "settings.json"), { tvHost: FAKE_TV_IP, homelabIp: "10.9.9.2" });

/** Builds the API against the unreachable "TV" and starts it on a random port. */
function startApi() {
  const sdb = new SdbClient(DEAD_TV, 1, 100);
  const rest = new TvRestClient(DEAD_TV, 1);
  const remote = new TvRemoteClient(DEAD_TV, 1, "/nonexistent/tv-remote.token");
  const apps = new AppManager(sdb, rest);
  const a2s = new A2sService(new A2sCli(FAKE_CLI_PATH), sdb, jobs, {
    target: DEAD_TV,
    uploadDir: "/nonexistent/uploads",
    profileDir: "/nonexistent/profiles",
    signedDir: "/nonexistent/signed",
    onTvAppsChanged: () => {},
    ensureTvOnline: () => Promise.resolve(),
  });
  // Constructed only: the proxy and TLS endpoint are not started by these tests.
  const ca = new CertAuthority(join(ytDir, "ca"));
  const userscript = new Userscript();
  const mitm = new MitmServer(ca, userscript);
  const yt = new YtService(
    ca,
    userscript,
    mitm,
    new YoutubeProxy(0, ["127.0.0.1"], settings, () => mitm.port),
    a2s,
    sdb,
    apps,
    { target: { tvHost: FAKE_TV_IP, homelabIp: "127.0.0.1" }, proxyPort: 8101, serverPort: 8787, dir: ytDir, ensureTvOnline: () => Promise.resolve() },
  );
  return new Elysia()
    .use(
      apiPlugin({
        apps,
        rest,
        remote,
        sdb,
        token: TOKEN,
        settings,
        trustTvIp: true,
        clientAddress: () => clientIp,
        a2s: { a2s, jobs, uploadDir: "/nonexistent/uploads" },
        yt,
      }),
    )
    .listen({ port: 0, hostname: "127.0.0.1" });
}

let app: ReturnType<typeof startApi>;
let base = "";

beforeAll(() => {
  app = startApi();
  base = `http://127.0.0.1:${app.server?.port}`;
});

afterAll(() => {
  void app.stop(true);
  rmSync(ytDir, { recursive: true, force: true });
});

/** Sends a request with (or without) the bearer token. */
const call = (method: string, path: string, auth = true, body?: object) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("api over a real socket", () => {
  test("health is public", async () => {
    expect((await call("GET", "/api/health", false)).status).toBe(200);
  });

  test("protected routes need the token", async () => {
    expect((await call("GET", "/api/apps", false)).status).toBe(401);
  });

  test("TV offline is reported, not an error", async () => {
    const response = await call("GET", "/api/tv");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ online: false });
  });

  test("app action route compiles and maps sdb failures (502, never 500)", async () => {
    const response = await call("POST", "/api/apps/some.app/kill");
    expect(response.status).toBe(502);
    expect(((await response.json()) as { kind: string }).kind).toBe("SdbError");
  });

  test("unknown action is rejected by validation", async () => {
    expect((await call("POST", "/api/apps/some.app/explode")).status).toBe(422);
  });

  test("power-off requires explicit confirmation", async () => {
    expect(
      (await call("POST", "/api/tv/power-off", true, { confirm: false }))
        .status,
    ).toBe(422);
  });

  test("a phone is not trusted and gets no token", async () => {
    clientIp = "192.0.2.50";
    const body = await (await call("GET", "/api/client", false)).json();
    expect(body).toMatchObject({ isTv: false, trusted: false, token: null });
  });

  test("the TV's own IP is recognised and handed the token", async () => {
    clientIp = `::ffff:${FAKE_TV_IP}`;
    const body = await (await call("GET", "/api/client", false)).json();
    expect(body).toMatchObject({ isTv: true, trusted: true, token: TOKEN });
    expect(body.ip).toBe(FAKE_TV_IP);
  });

  test("Apps2Samsung routes sit behind the token", async () => {
    expect((await call("GET", "/api/a2s/jobs", false)).status).toBe(401);
    expect((await call("GET", "/api/a2s/jobs")).status).toBe(200);
  });

  test("unsafe CLI arguments are refused with 400 (policy), not run", async () => {
    const response = await call("POST", "/api/a2s/jobs/uninstall", true, {
      appId: "--allow-root",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { kind: string }).kind).toBe("PolicyError");
  });

  test("unknown job id is a 404", async () => {
    expect((await call("GET", "/api/a2s/jobs/nope")).status).toBe(404);
  });

  const report = {
    ok: true,
    shimVersion: "1.0.0",
    node: "v12.22.12",
    contentDir: "/home/owner/share/m7d-cobalt-content",
    content: "copied",
    certFiles: ["deadbeef.0 (written)"],
    durationMs: 1234,
  };

  test("only the TV may post a setup report (no token needed)", async () => {
    clientIp = "192.0.2.50";
    expect((await call("POST", "/api/yt/setup-report", false, report)).status).toBe(403);
    clientIp = `::ffff:${FAKE_TV_IP}`;
    const response = await call("POST", "/api/yt/setup-report", false, report);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true });
  });

  test("settings: read, save, refuse bad IPs, clear back to the default", async () => {
    expect((await call("GET", "/api/settings", false)).status).toBe(401);
    expect(await (await call("GET", "/api/settings")).json()).toMatchObject({
      tvHost: FAKE_TV_IP,
      tvHostSource: "environment",
      homelabIp: "10.9.9.2",
    });
    const bad = await call("PUT", "/api/settings", true, { tvHost: "192.0.2.300" });
    expect(bad.status).toBe(400);
    const saved = await call("PUT", "/api/settings", true, { tvHost: "10.9.9.8" });
    expect(await saved.json()).toMatchObject({ tvHost: "10.9.9.8", tvHostSource: "dashboard" });
    expect(await Bun.file(join(ytDir, "settings.json")).json()).toEqual({ tvHost: "10.9.9.8" });
    // The new IP is live: the old TV IP no longer counts as the TV.
    clientIp = FAKE_TV_IP;
    expect(await (await call("GET", "/api/client", false)).json()).toMatchObject({ isTv: false });
    const cleared = await call("PUT", "/api/settings", true, { tvHost: "" });
    expect(await cleared.json()).toMatchObject({ tvHost: FAKE_TV_IP, tvHostSource: "environment" });
  });

  test("YouTube status sits behind the token and shows the last report", async () => {
    expect((await call("GET", "/api/yt/status", false)).status).toBe(401);
    const response = await call("GET", "/api/yt/status");
    expect(response.status).toBe(200);
    const status = (await response.json()) as {
      setup: { report: { node: string } };
      shim: { installed: boolean | null; cobaltArguments: string };
      ca: { hashes: string[] };
      proxy: { listening: boolean };
    };
    expect(status.setup.report.node).toBe("v12.22.12");
    expect(status.shim.installed).toBeNull(); // TV unreachable
    expect(status.shim.cobaltArguments).toContain("--proxy=http://127.0.0.1:8101");
    expect(status.ca.hashes.length).toBeGreaterThan(0);
    expect(status.proxy.listening).toBe(false);
  });
});

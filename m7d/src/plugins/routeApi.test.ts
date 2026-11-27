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
import { AccessRequests } from "../auth/access-requests";
import { Auth } from "../auth/auth";
import { DeviceStore } from "../auth/device-store";
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
        auth: new Auth(TOKEN, new DeviceStore(join(ytDir, "auth", "devices.json"), () => settings.deviceIdleDays), new AccessRequests(), () => clientIp),
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
const call = (method: string, path: string, auth = true, body?: object, extra: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

/** The `m7d_device=…` pair from a response's Set-Cookie (as a browser would send it back). */
function deviceCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

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

  describe("remembered browsers", () => {
    test("the token signs a browser in once; its cookie then opens protected routes", async () => {
      clientIp = "192.0.2.60";
      expect((await call("POST", "/api/auth/token", false, { token: "wrong", name: "Laptop", remember: true })).status).toBe(401);
      const signIn = await call("POST", "/api/auth/token", false, { token: TOKEN, name: "Laptop", remember: true });
      expect(signIn.status).toBe(200);
      const setCookie = signIn.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Max-Age=");
      const cookie = deviceCookie(signIn);
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie })).status).toBe(200);
      expect(await (await call("GET", "/api/auth/me", false, undefined, { cookie })).json()).toMatchObject({
        signedIn: true,
        via: "device",
        device: { name: "Laptop", via: "token" },
      });
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie: "m7d_device=nope.nope" })).status).toBe(401);
    });

    test("without 'remember', the cookie lasts only until the browser closes", async () => {
      const signIn = await call("POST", "/api/auth/token", false, { token: TOKEN, name: "Guest", remember: false });
      expect(signIn.headers.get("set-cookie")).not.toContain("Max-Age");
    });

    test("cookie-authenticated changes from another site are refused", async () => {
      const cookie = deviceCookie(await call("POST", "/api/auth/token", false, { token: TOKEN, name: "Laptop 2", remember: true }));
      const host = new URL(base).host;
      const foreign = await call("PUT", "/api/settings", false, { deviceIdleDays: 30 }, { cookie, origin: "http://evil.example" });
      expect(foreign.status).toBe(403);
      const own = await call("PUT", "/api/settings", false, { deviceIdleDays: 30 }, { cookie, origin: `http://${host}` });
      expect(own.status).toBe(200);
      expect(await own.json()).toMatchObject({ deviceIdleDays: 30 });
    });

    test("a new browser is let in by approving its code from a signed-in device", async () => {
      clientIp = "192.0.2.61";
      const ticket = (await (await call("POST", "/api/auth/requests", false, { name: "Phone", remember: true })).json()) as {
        requestId: string;
        code: string;
      };
      expect(ticket.code).toMatch(/^[A-Z0-9]{2}-[A-Z0-9]{2}$/);
      expect(await (await call("GET", `/api/auth/requests/${ticket.requestId}`, false)).json()).toMatchObject({ status: "pending" });
      // Listing and approving need a signed-in caller.
      expect((await call("GET", "/api/auth/pending", false)).status).toBe(401);
      const pending = (await (await call("GET", "/api/auth/pending")).json()) as { code: string; name: string; ip: string }[];
      expect(pending).toContainEqual(expect.objectContaining({ code: ticket.code, name: "Phone", ip: "192.0.2.61" }));
      expect((await call("POST", `/api/auth/pending/${ticket.code}/approve`)).status).toBe(200);
      const granted = await call("GET", `/api/auth/requests/${ticket.requestId}`, false);
      expect(await granted.json()).toMatchObject({ status: "approved", device: { name: "Phone", via: "approval" } });
      const cookie = deviceCookie(granted);
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie })).status).toBe(200);
      // The grant is handed out once.
      expect(await (await call("GET", `/api/auth/requests/${ticket.requestId}`, false)).json()).toMatchObject({ status: "expired" });
    });

    test("a denied request gets no cookie", async () => {
      clientIp = "192.0.2.62";
      const ticket = (await (await call("POST", "/api/auth/requests", false, { name: "Unknown", remember: true })).json()) as {
        requestId: string;
        code: string;
      };
      expect((await call("POST", `/api/auth/pending/${ticket.code}/deny`)).status).toBe(200);
      const answer = await call("GET", `/api/auth/requests/${ticket.requestId}`, false);
      expect(await answer.json()).toMatchObject({ status: "denied", device: null });
      expect(answer.headers.get("set-cookie")).toBeNull();
    });

    test("the device list marks this browser; removing others and signing out revoke access", async () => {
      clientIp = "192.0.2.63";
      const other = deviceCookie(await call("POST", "/api/auth/token", false, { token: TOKEN, name: "Old PC", remember: true }));
      const mine = deviceCookie(await call("POST", "/api/auth/token", false, { token: TOKEN, name: "This PC", remember: true }));
      const list = (await (await call("GET", "/api/auth/devices", false, undefined, { cookie: mine })).json()) as {
        devices: { name: string; current: boolean }[];
      };
      expect(list.devices.find((device) => device.current)?.name).toBe("This PC");
      const host = new URL(base).host;
      await call("POST", "/api/auth/devices/remove-others", false, undefined, { cookie: mine, origin: `http://${host}` });
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie: other })).status).toBe(401);
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie: mine })).status).toBe(200);
      const out = await call("POST", "/api/auth/logout", false, undefined, { cookie: mine });
      expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await call("GET", "/api/a2s/jobs", false, undefined, { cookie: mine })).status).toBe(401);
    });

    test("ten wrong tokens lock token sign-in for that address", async () => {
      clientIp = "192.0.2.64";
      for (let i = 0; i < 10; i++) await call("POST", "/api/auth/token", false, { token: "guess", name: "x", remember: true });
      const locked = await call("POST", "/api/auth/token", false, { token: TOKEN, name: "x", remember: true });
      expect(locked.status).toBe(429);
    });
  });
});

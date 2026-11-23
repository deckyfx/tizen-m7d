import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "acorn";
import { buildShim, COBALT_SOURCES, setupServiceSource, SHIM, shimConfigXml, type ShimParams } from "./shim-builder";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";

const PARAMS: ShimParams = {
  homelabIp: "192.0.2.102",
  proxyPort: 8101,
  serverPort: 8787,
  caPem: PEM,
  caHashes: ["deadbeef", "0badf00d"],
};

let dir = "";
let reports: Record<string, unknown>[] = [];
let reportServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "m7d-shim-"));
  reportServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      reports.push((await request.json()) as Record<string, unknown>);
      return Response.json({ recorded: true });
    },
  });
});

afterAll(async () => {
  void reportServer.stop(true);
  await rm(dir, { recursive: true, force: true });
});

describe("shim package", () => {
  test("config.xml points Cobalt at the homelab proxy and declares the one-shot setup service", () => {
    const xml = shimConfigXml(PARAMS);
    expect(xml).toContain(
      `value="--base_url=https://www.youtube.com/tv --proxy=http://192.0.2.102:8101 --content=${SHIM.contentDir} --dial_name=${SHIM.dialName} --use_eden"`,
    );
    expect(xml).toContain('value="com.samsung.tv.cobalt-yt"');
    // Square icon only: a 16:9 banner gets squeezed into the square app tile.
    expect(xml.match(/<icon /g)).toHaveLength(1);
    expect(xml).toContain('<icon src="icon.png" width="512" height="512"/>');
    expect(xml).toContain(`<tizen:service id="${SHIM.serviceId}" auto-restart="false" on-boot="false">`);
    expect(xml).toContain(`<tizen:application id="${SHIM.appId}" package="${SHIM.packageId}"`);
  });

  test("a non-IPv4 homelab address is refused (it ends up in XML)", () => {
    expect(() => shimConfigXml({ ...PARAMS, homelabIp: 'x" onload="' })).toThrow();
  });

  test("the setup service stays ES5 after the config is baked in", async () => {
    const source = await setupServiceSource(PARAMS);
    expect(source).toContain('"caHashes":["deadbeef","0badf00d"]');
    expect(() => parse(source, { ecmaVersion: 5, sourceType: "script" })).not.toThrow();
  });

  test("the .wgt holds config, page, icons and the service", async () => {
    const built = await buildShim(PARAMS, join(dir, "out"));
    expect(built.path.endsWith(`${SHIM.packageId}-${SHIM.version}.wgt`)).toBe(true);
    const list = Bun.spawnSync(["unzip", "-Z1", built.path]).stdout.toString().trim().split("\n").sort();
    expect(list).toEqual(["config.xml", "icon.png", "index.html", "service/", "service/setup.js"]);
    // No staging folders left behind.
    expect(await readdir(join(dir, "out"))).toEqual([`${SHIM.packageId}-${SHIM.version}.wgt`]);
  });
});

describe("setup service (run under Bun as a stand-in for the TV's Node)", () => {
  const source = () => join(dir, "cobalt");
  const target = () => join(dir, "share", "m7d-cobalt-content");

  /** Runs setup-service.js with paths pointed into the temp folder; returns its report. */
  async function runSetup(): Promise<Record<string, unknown>> {
    const template = await Bun.file(join(import.meta.dir, "setup-service.es5.txt")).text();
    const config = {
      shimVersion: SHIM.version,
      contentDir: target(),
      cobaltSources: [join(dir, "missing"), source()],
      // Outside /home/owner/share/: the service must refuse to delete it.
      cleanup: [join(dir, "keep-me")],
      caPem: PEM,
      caHashes: PARAMS.caHashes,
      reportHost: "127.0.0.1",
      reportPort: reportServer.port,
      reportPath: "/api/yt/setup-report",
    };
    const script = join(dir, "setup.js");
    await Bun.write(script, template.replace("/*@M7D_CONFIG@*/ null", JSON.stringify(config)));
    reports = [];
    const child = Bun.spawn([process.execPath, script], { stdout: "ignore", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(reports).toHaveLength(1);
    return reports[0] ?? {};
  }

  test("first run copies the content and installs the CA", async () => {
    await mkdir(join(source(), "ssl", "certs"), { recursive: true });
    await mkdir(join(source(), "web"), { recursive: true });
    await Bun.write(join(source(), "web", "app.js"), "console.log(1)");
    await Bun.write(join(source(), "ssl", "certs", "deadbeef.0"), "someone else's CA");

    const report = await runSetup();
    expect(report).toMatchObject({ ok: true, content: "copied", source: source(), files: 2, shimVersion: SHIM.version });
    expect(report.certFiles).toEqual(["deadbeef.1 (written)", "0badf00d.0 (written)"]);
    expect(await Bun.file(join(target(), "web", "app.js")).text()).toBe("console.log(1)");
    expect(await Bun.file(join(target(), "ssl", "certs", "deadbeef.1")).text()).toBe(PEM);
    expect(await Bun.file(join(target(), "ssl", "certs", "deadbeef.0")).text()).toBe("someone else's CA");
  });

  test("clean-up never deletes outside /home/owner/share/", async () => {
    await Bun.write(join(dir, "keep-me", "file"), "x");
    const report = await runSetup();
    expect(report.removed).toEqual([]);
    expect(await Bun.file(join(dir, "keep-me", "file")).exists()).toBe(true);
  });

  test("a second run changes nothing", async () => {
    const report = await runSetup();
    expect(report).toMatchObject({ ok: true, content: "current" });
    expect(report.certFiles).toEqual(["deadbeef.1 (present)", "0badf00d.0 (present)"]);
  });

  test("a changed source (YouTube update) is copied again, with no leftovers", async () => {
    await appendFile(join(source(), "web", "app.js"), "\nconsole.log(2)");
    const report = await runSetup();
    expect(report).toMatchObject({ ok: true, content: "copied" });
    expect(await Bun.file(join(target(), "web", "app.js")).text()).toContain("console.log(2)");
    expect(await Bun.file(join(target(), "ssl", "certs", "0badf00d.0")).text()).toBe(PEM);
    const siblings = await readdir(join(dir, "share"));
    expect(siblings).toEqual(["m7d-cobalt-content"]);
  });

  test("missing Cobalt content is reported as a failure", async () => {
    await rm(source(), { recursive: true, force: true });
    const report = await runSetup();
    expect(report.ok).toBe(false);
    expect(String(report.error)).toContain("Cobalt content not found");
  });

  test("real Cobalt locations are the ones TizenTube uses", () => {
    expect(COBALT_SOURCES[0]).toBe("/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content");
  });
});

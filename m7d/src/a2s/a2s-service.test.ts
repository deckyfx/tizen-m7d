import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyError } from "../lib/errors";
import { compareVersions, runsOnTv } from "../public/lib/tizen";
import { SdbClient } from "../tv/sdb-client";
import { A2sCli } from "./a2s-cli";
import { A2sService } from "./a2s-service";
import { JobRunner, type JobSnapshot } from "./job-runner";

/**
 * Fake CLI: `catalog` returns two apps (one of them root); `install … stopme` stops at a
 * check (exit 3) unless `--yes` is present; anything else echoes its arguments.
 */
const FAKE_CLI = `#!/bin/sh
case "$1" in
  catalog) echo '{"ok":true,"count":2,"apps":[
    {"name":"Jellyfin","category":"media","description":"","requiresPartner":false,"hasVariants":false,"adult":false,"root":false,"tag":"v1","published":"","author":"a","source":"","files":[{"file":"J.wgt","version":"1","size":1,"default":true,"tizen":"3.0"}],"ownSource":false,"closedSource":false,"selfUpdating":false,"from":"Official","installable":true},
    {"name":"Vetro","category":"tools","description":"","requiresPartner":false,"hasVariants":false,"adult":false,"root":true,"tag":"v1","published":"","author":"b","source":"","files":[{"file":"V.wgt","version":"1","size":1,"default":true,"tizen":"3.0"}],"ownSource":false,"closedSource":false,"selfUpdating":false,"from":"Official","installable":true}]}' ;;
  *) case "$*" in
       *stopme*--yes*) printf '{"ok":true,"args":"%s"}\\n' "$*" ;;
       *stopme*) echo '{"ok":false,"error":"Stopped","details":{"checks":[]}}'; exit 3 ;;
       *) printf '{"ok":true,"args":"%s"}\\n' "$*" ;;
     esac ;;
esac
`;

let dir = "";
let service: A2sService;
let jobs: JobRunner;
let changes = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "m7d-a2s-service-"));
  const binary = join(dir, "apps2samsung-cli");
  await Bun.write(binary, FAKE_CLI);
  await chmod(binary, 0o755);
  jobs = new JobRunner();
  // The sdb client is never connected: exclusive() only closes an absent socket.
  service = new A2sService(new A2sCli(binary), new SdbClient({ tvHost: "127.0.0.1", homelabIp: "" }, 1, 100), jobs, {
    target: { tvHost: "10.9.9.9", homelabIp: "10.9.9.2" },
    uploadDir: join(dir, "uploads"),
    profileDir: join(dir, "profiles"),
    signedDir: join(dir, "signed"),
    onTvAppsChanged: () => {
      changes += 1;
    },
    ensureTvOnline: () => Promise.resolve(),
  });
});

afterAll(() => rm(dir, { recursive: true, force: true }));

/** Waits until the queue is idle and returns the job's final state. */
async function settle(job: JobSnapshot): Promise<JobSnapshot> {
  while (jobs.busy) await Bun.sleep(10);
  return jobs.get(job.id) ?? job;
}

/** The arguments the fake CLI echoed for a finished job. */
function echoedArgs(job: JobSnapshot): string {
  return (job.result as { args: string }).args;
}

describe("A2sService", () => {
  test("hides root apps from the catalog and refuses to install them", async () => {
    const names = (await service.catalog()).map((app) => app.name);
    expect(names).toEqual(["Jellyfin"]);
    expect(service.install({ app: "Vetro" })).rejects.toThrow(PolicyError);
  });

  test("builds install arguments from the request and targets the TV", async () => {
    const job = await settle(
      await service.install({
        app: "Jellyfin",
        settings: { server: "http://nas:8096", empty: "" },
        launch: true,
        from: "Official",
      }),
    );
    expect(job.status).toBe("succeeded");
    expect(echoedArgs(job)).toBe(
      "install Jellyfin --set server=http://nas:8096 --launch --tv 10.9.9.9 --local-ip 10.9.9.2 --json",
    );
    expect(changes).toBeGreaterThan(0);
  });

  test("blocks option-like values from reaching the CLI", async () => {
    expect(service.uninstall("--allow-root")).rejects.toThrow(PolicyError);
    expect(service.update(["-x"])).rejects.toThrow(PolicyError);
  });

  test("profile saves overwrite (--yes) and are never retryable", async () => {
    const saved = await settle(await service.saveProfile("stopme", false));
    expect(saved.status).toBe("succeeded");
    expect(echoedArgs(saved)).toContain("--yes");
    expect(saved.canRetryAnyway).toBe(false);
    expect(service.retryAnyway(saved.id)).rejects.toThrow(PolicyError);
  });

  test("a stopped restore can be retried anyway, which adds --yes", async () => {
    const restore = await settle(await service.restoreProfile("stopme", []));
    expect(restore.status).toBe("stopped");
    expect(restore.canRetryAnyway).toBe(true);
    const retried = await settle(await service.retryAnyway(restore.id));
    expect(retried.status).toBe("succeeded");
    expect(echoedArgs(retried)).toEndWith("--yes --json");
  });

  test("update without names updates all", async () => {
    const job = await settle(await service.update("all"));
    expect(echoedArgs(job)).toStartWith("update --all --tv 10.9.9.9");
  });
});

describe("Tizen compatibility", () => {
  test("compares dotted versions numerically", () => {
    expect(compareVersions("6.5", "6.0")).toBeGreaterThan(0);
    expect(compareVersions("10.0", "9.0")).toBeGreaterThan(0);
    expect(compareVersions("6.5", "6.5")).toBe(0);
  });

  test("the M7 (Tizen 6.5) runs 3.0 packages but not 7.0 ones", () => {
    expect(runsOnTv("3.0")).toBe(true);
    expect(runsOnTv("6.5")).toBe(true);
    expect(runsOnTv("7.0")).toBe(false);
  });
});

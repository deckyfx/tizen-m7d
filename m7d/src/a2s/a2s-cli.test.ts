import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2sCli, assertSafeArg, SIGN_IN_REQUIRED } from "./a2s-cli";
import { JobRunner } from "./job-runner";

/**
 * A fake apps2samsung-cli: the first argument picks a scenario; stdout carries the JSON
 * answer and stderr the progress lines, exactly like the real CLI in --json mode.
 */
const FAKE_CLI = `#!/bin/sh
case "$1" in
  ok)      echo "Loading the app catalog…" >&2; echo "warning: be careful" >&2
           printf '{"ok":true,"args":"%s"}\\n' "$*" ;;
  stopped) echo "Checking 192.0.2.130…" >&2
           echo '{"ok":false,"error":"Stopped before installing","details":{"checks":[{"kind":"Storage","defaultTitle":"Low space","message":"Free some"}]}}'
           exit 3 ;;
  garbage) echo "not json"; exit 1 ;;
  slow)    sleep 0.2; echo '{"ok":true,"slow":true}' ;;
  signin)  echo "A Samsung account sign-in is needed to create the signing certificate." >&2
           sleep 30; echo '{"ok":true}' ;;
esac
`;

let dir = "";
let cli: A2sCli;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "m7d-fake-cli-"));
  const binary = join(dir, "apps2samsung-cli");
  await Bun.write(binary, FAKE_CLI);
  await chmod(binary, 0o755);
  cli = new A2sCli(binary);
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("A2sCli", () => {
  test("parses the JSON answer, appends --json and classifies stderr lines", async () => {
    const seen: string[] = [];
    const run = await cli.run<{ ok: true; args: string }>(["ok", "x"], {
      onLine: (line) => seen.push(`${line.level}:${line.text}`),
    });
    expect(run.exitCode).toBe(0);
    expect(run.data?.args).toBe("ok x --json");
    expect(seen).toEqual(["progress:Loading the app catalog…", "warning:be careful"]);
  });

  test("exit 3 is a failure carrying the stopping checks", async () => {
    const run = await cli.run(["stopped"]);
    expect(run.exitCode).toBe(3);
    expect(run.failure?.error).toBe("Stopped before installing");
    expect(run.failure?.details?.checks?.[0]?.kind).toBe("Storage");
  });

  test("non-JSON output becomes a readable failure", async () => {
    const run = await cli.run(["garbage"]);
    expect(run.data).toBeUndefined();
    expect(run.failure?.error).toContain("exited with 1");
  });
});

describe("sign-in prompts", () => {
  test("a run that asks for a Samsung sign-in is stopped at once with a clear message", async () => {
    const started = performance.now();
    const run = await cli.run(["signin"]);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(run.failure?.error).toBe(SIGN_IN_REQUIRED);
  });
});

describe("assertSafeArg", () => {
  test("rejects option-like and control-character values", () => {
    expect(() => assertSafeArg("--allow-root", "app")).toThrow();
    expect(() => assertSafeArg("a\nb", "app")).toThrow();
    expect(() => assertSafeArg("", "app")).toThrow();
    expect(assertSafeArg("Jellyfin + Bonfire", "app")).toBe("Jellyfin + Bonfire");
  });
});

describe("JobRunner", () => {
  test("runs jobs one at a time and records results, logs and retryable stops", async () => {
    const jobs = new JobRunner();
    const order: string[] = [];
    const first = jobs.enqueue("install", "slow", async (onLine) => {
      order.push("first-start");
      const run = await cli.run(["slow"], { onLine });
      order.push("first-end");
      return run;
    });
    const second = jobs.enqueue(
      "install",
      "stopped",
      async (onLine) => {
        order.push("second-start");
        return cli.run(["stopped"], { onLine });
      },
      true,
    );
    expect(second.status).toBe("queued");
    while (jobs.busy) await Bun.sleep(20);

    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("stopped");
    expect(second.canRetryAnyway).toBe(true);
    expect(second.checks?.[0]?.defaultTitle).toBe("Low space");
    expect(second.log.map((line) => line.text)).toEqual(["Checking 192.0.2.130…"]);
  });
});

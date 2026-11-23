import { AppNotFoundError, SdbError } from "../lib/errors";
import { parseAppList, type InstalledApp } from "../tv/app-list";
import type { SdbClient } from "../tv/sdb-client";
import type { TvRestClient } from "../tv/tv-rest";

/** An installed app plus its live state. */
export interface AppEntry extends InstalledApp {
  running: boolean;
  visible: boolean;
}

/** Actions the task manager can perform on an app. */
export const APP_ACTIONS = ["launch", "close", "kill", "restart"] as const;

/** One of {@link APP_ACTIONS}. */
export type AppAction = (typeof APP_ACTIONS)[number];

/** Outcome of an app action. */
export interface ActionResult {
  appId: string;
  action: AppAction;
  ok: boolean;
  running: boolean;
  message: string;
}

/**
 * Apps that share one runtime and must be stopped together for a real cold restart.
 * Verified: launching TizenTube also marks stock YouTube running (shared Cobalt engine).
 * The m7d YouTube shim starts the same Cobalt engine; a Cobalt already running with stock
 * arguments (no proxy) must be stopped first or the shim just brings it to the front.
 */
const ENGINE_GROUPS: readonly (readonly string[])[] = [
  ["M7dYouTube.YouTube", "xvvl3S1TT1.TizenTubeStandalone", "111299001912"],
];

/** How long the installed-app list is cached (installs change rarely). */
const INSTALLED_CACHE_MS = 60_000;

/** Polling interval while waiting for an app to start or stop. */
const POLL_MS = 300;

/**
 * Task manager for the TV: lists apps and launches, closes, kills or cold-restarts them.
 *
 * - launch / close / status: REST API (fast, no sdb slot needed)
 * - kill: `sdb shell 0 was_kill <tizenId>` (hard kill, works when REST close does nothing)
 */
export class AppManager {
  private installedCache:
    { apps: InstalledApp[]; fetchedAt: number } | undefined;

  constructor(
    private readonly sdb: SdbClient,
    private readonly rest: TvRestClient,
  ) {}

  /** Installed apps from `vd_applist`, cached for {@link INSTALLED_CACHE_MS}. */
  async installed(refresh = false): Promise<InstalledApp[]> {
    const cache = this.installedCache;
    if (!refresh && cache && Date.now() - cache.fetchedAt < INSTALLED_CACHE_MS)
      return cache.apps;
    const output = await this.sdb.shell("0 vd_applist").catch((error: Error) => {
      // While apps2samsung-cli holds the sdb slot, serve the last known list instead of failing.
      if (error instanceof SdbError && error.reason === "busy" && cache) return undefined;
      throw error;
    });
    if (output === undefined && cache) return cache.apps;
    const apps = parseAppList(output ?? "");
    this.installedCache = { apps, fetchedAt: Date.now() };
    return apps;
  }

  /** Forgets the installed-app list (after an install or uninstall). */
  invalidate(): void {
    this.installedCache = undefined;
  }

  /** Installed apps with their running/visible state, running apps first. */
  async list(refresh = false): Promise<AppEntry[]> {
    const apps = await this.installed(refresh);
    const entries = await Promise.all(
      apps.map(async (app): Promise<AppEntry> => {
        const status = await this.rest.appStatus(app.appId);
        return {
          ...app,
          running: status?.running ?? false,
          visible: status?.visible ?? false,
        };
      }),
    );
    return entries.sort(
      (a, b) =>
        Number(b.running) - Number(a.running) || a.title.localeCompare(b.title),
    );
  }

  /** Runs `action` on `appId`. */
  async perform(id: string, action: AppAction): Promise<ActionResult> {
    // Accept the REST id or the Tizen id (Apps2Samsung lists apps by Tizen id).
    const appId = (await this.find(id)).appId;
    switch (action) {
      case "launch":
        return this.launch(appId);
      case "close":
        return this.close(appId);
      case "kill":
        return this.kill(appId);
      case "restart":
        return this.restart(appId);
    }
  }

  /** Looks up an installed app or throws {@link AppNotFoundError}. */
  private async find(appId: string): Promise<InstalledApp> {
    const app = (await this.installed()).find(
      (candidate) => candidate.appId === appId || candidate.tizenId === appId,
    );
    return app ?? AppNotFoundError.throw(appId);
  }

  /** Current running state (false when the REST API does not know the app). */
  private async isRunning(appId: string): Promise<boolean> {
    return (await this.rest.appStatus(appId))?.running ?? false;
  }

  /** Polls until the app's running state equals `running` or `timeoutMs` passes. */
  private async waitForRunning(
    appId: string,
    running: boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.isRunning(appId)) === running) return true;
      await Bun.sleep(POLL_MS);
    }
    return (await this.isRunning(appId)) === running;
  }

  /** Builds an {@link ActionResult}. */
  private result(
    appId: string,
    action: AppAction,
    ok: boolean,
    running: boolean,
    message: string,
  ): ActionResult {
    return { appId, action, ok, running, message };
  }

  /** Starts the app via REST and waits until it reports running. */
  private async launch(appId: string): Promise<ActionResult> {
    await this.find(appId);
    if (!(await this.rest.launch(appId)))
      return this.result(
        appId,
        "launch",
        false,
        false,
        "TV rejected the launch",
      );
    const started = await this.waitForRunning(appId, true, 10_000);
    return this.result(
      appId,
      "launch",
      started,
      started,
      started ? "Launched" : "Launch sent, but not running after 10 s",
    );
  }

  /** Graceful close via REST. */
  private async close(appId: string): Promise<ActionResult> {
    await this.find(appId);
    if (!(await this.isRunning(appId)))
      return this.result(appId, "close", true, false, "Not running");
    await this.rest.close(appId);
    const stopped = await this.waitForRunning(appId, false, 5000);
    return this.result(
      appId,
      "close",
      stopped,
      !stopped,
      stopped ? "Closed" : "Still running; try Kill",
    );
  }

  /** Hard kill via `was_kill`. */
  private async kill(appId: string): Promise<ActionResult> {
    const app = await this.find(appId);
    const output = await this.sdb.shell(`0 was_kill ${app.tizenId}`);
    if (!output.includes("terminate app")) {
      return SdbError.throw(
        `was_kill gave unexpected output: ${output.trim().slice(0, 200)}`,
        "rejected",
      );
    }
    const stopped = await this.waitForRunning(appId, false, 5000);
    return this.result(
      appId,
      "kill",
      stopped,
      !stopped,
      stopped ? "Killed" : "Kill sent, but still running",
    );
  }

  /** Stops one app: REST close first, `was_kill` if it is still running. */
  private async stop(appId: string): Promise<void> {
    if (!(await this.isRunning(appId))) return;
    await this.rest.close(appId);
    if (await this.waitForRunning(appId, false, 3000)) return;
    await this.kill(appId);
  }

  /** Cold restart: stop the app and every app sharing its runtime, then launch it fresh. */
  private async restart(appId: string): Promise<ActionResult> {
    await this.find(appId);
    const group = ENGINE_GROUPS.find((members) => members.includes(appId)) ?? [
      appId,
    ];
    const installedIds = new Set(
      (await this.installed()).map((app) => app.appId),
    );
    for (const member of group) {
      if (installedIds.has(member)) await this.stop(member);
    }
    const launched = await this.launch(appId);
    const stoppedNote =
      group.length > 1 ? ` (stopped ${group.join(", ")} first)` : "";
    return {
      ...launched,
      action: "restart",
      message: `${launched.message}${stoppedNote}`,
    };
  }
}

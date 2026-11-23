import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { A2sService } from "../a2s/a2s-service";
import type { JobSnapshot } from "../a2s/job-runner";
import { PolicyError, YtSetupError } from "../lib/errors";
import { Mutex } from "../lib/mutex";
import type { ActionResult, AppManager } from "../services/app-manager";
import type { InstalledApp } from "../tv/app-list";
import type { TvTarget } from "../services/settings-store";
import type { SdbClient } from "../tv/sdb-client";
import type { CaInfo, CertAuthority } from "./cert-authority";
import type { MitmServer, MitmStats } from "./mitm-server";
import { buildShim, cobaltArguments, SHIM, type ShimParams } from "./shim/shim-builder";
import type { Userscript } from "./userscript";
import type { ProxyStats, YoutubeProxy } from "./youtube-proxy";

/** What the setup service on the TV reports (see shim/setup-service.es5.txt). */
export interface SetupReport {
  ok: boolean;
  shimVersion: string;
  /** Node version of the TV's service runtime. */
  node: string;
  contentDir: string;
  /** Cobalt content folder it copied from. */
  source?: string;
  files?: number;
  bytes?: number;
  /** `copied` after a (re)copy, `current` when the copy was already up to date. */
  content?: "current" | "copied";
  certFiles?: string[];
  /** Old TizenTube leftovers deleted in this run. */
  removed?: string[];
  error?: string;
  durationMs: number;
}

/** A received report with context. */
export interface SetupRecord {
  report: SetupReport;
  receivedAt: string;
  /** Stock YouTube version at that time: a change means Cobalt may have been updated. */
  youtubeVersion: string | null;
}

/** An app that the shim replaces (TizenTube and its launchers): their proxies fight over 8100/8101. */
export interface LegacyApp {
  appId: string;
  tizenId: string;
  title: string;
  version: string;
}

/** Everything the YouTube page shows. */
export interface YtStatus {
  proxy: ProxyStats;
  mitm: MitmStats;
  userscript: { version: string; hash: string; size: number };
  ca: CaInfo;
  shim: {
    appId: string;
    name: string;
    version: string;
    /** null when the TV could not be asked (off, or the sdb slot is busy). */
    installed: boolean | null;
    installedVersion: string | null;
    cobaltArguments: string;
  };
  setup: SetupRecord | null;
  setupRunning: boolean;
  /** Old TizenTube pieces still on the TV (null when unknown). */
  legacy: LegacyApp[] | null;
}

/** Result of "Open YouTube". */
export interface YtLaunchResult extends ActionResult {
  /** The setup service ran first (new install, YouTube update, or a week since the last run). */
  setupRan: boolean;
}

/** Configuration of {@link YtService}. */
export interface YtConfig {
  /** The TV and this box's IP (baked into the shim as the proxy and report address). */
  target: TvTarget;
  proxyPort: number;
  serverPort: number;
  /** Folder for the built package and the last setup report. */
  dir: string;
  /** Throws fast when the TV is off. */
  ensureTvOnline: () => Promise<void>;
}

/** Stock YouTube's REST id; its version change hints at a Cobalt update. */
const STOCK_YOUTUBE = "111299001912";

/** How long m7d waits for the setup service's report. */
const SETUP_TIMEOUT_MS = 90_000;

/** Setup runs again before a launch when the last good run is older than this. */
const SETUP_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Packages of the old TizenTube setup (TizenTube itself; TTStartApp launcher). */
const LEGACY_PACKAGES = ["xvvl3S1TT1", "TTStartApp", "TTStartr01"];

/** True for TizenTube and its launchers (not our shim). */
function isLegacy(app: InstalledApp): boolean {
  const pkg = app.tizenId.split(".")[0] ?? "";
  return (
    app.appId !== SHIM.appId &&
    (LEGACY_PACKAGES.includes(pkg) || /tizentube/i.test(app.title))
  );
}

/**
 * Homelab YouTube: the proxy + TLS interception (replacing TizenTube's on-TV service),
 * the shim app that points Cobalt at it, and the shim's one-shot setup service.
 */
export class YtService {
  private readonly setupLock = new Mutex();
  private setupRecord: SetupRecord | null = null;
  private setupWaiter: ((record: SetupRecord) => void) | undefined;
  private setupRunning = false;

  constructor(
    private readonly ca: CertAuthority,
    private readonly userscript: Userscript,
    private readonly mitm: MitmServer,
    private readonly proxy: YoutubeProxy,
    private readonly a2s: A2sService,
    private readonly sdb: SdbClient,
    private readonly apps: AppManager,
    private readonly config: YtConfig,
  ) {}

  private get recordPath(): string {
    return join(this.config.dir, "setup.json");
  }

  /** Starts the TLS endpoint, then the proxy (the proxy only accepts once interception works). */
  async start(): Promise<void> {
    await mkdir(this.config.dir, { recursive: true });
    const saved = Bun.file(this.recordPath);
    if (await saved.exists()) this.setupRecord = (await saved.json()) as SetupRecord;
    await this.ca.ensure();
    await this.mitm.start();
    if (await this.proxy.start()) {
      console.log(`[yt] YouTube proxy on :${this.config.proxyPort} (TLS interception on 127.0.0.1:${this.mitm.port})`);
    }
  }

  /** Stops both listeners (server shutdown and `bun --hot` reloads). */
  stop(): void {
    this.proxy.stop();
    this.mitm.stop();
  }

  /** Values baked into the shim package. */
  private async shimParams(): Promise<ShimParams> {
    const ca = await this.ca.ensure();
    return {
      homelabIp: this.config.target.homelabIp,
      proxyPort: this.config.proxyPort,
      serverPort: this.config.serverPort,
      caPem: await this.ca.caPem(),
      caHashes: ca.hashes,
    };
  }

  /** Installed apps, or null when the TV cannot be asked right now. */
  private async installedOrNull(refresh = false): Promise<InstalledApp[] | null> {
    return this.apps.installed(refresh).catch(() => null);
  }

  /** Status for the YouTube page (never fails because the TV is off). */
  async status(): Promise<YtStatus> {
    const [installed, bundle, ca, params] = await Promise.all([
      this.installedOrNull(),
      this.userscript.get(),
      this.ca.ensure(),
      this.shimParams(),
    ]);
    const shimApp = installed?.find((app) => app.appId === SHIM.appId);
    return {
      proxy: this.proxy.stats(),
      mitm: this.mitm.stats,
      userscript: { version: bundle.version, hash: bundle.hash, size: bundle.size },
      ca,
      shim: {
        appId: SHIM.appId,
        name: SHIM.name,
        version: SHIM.version,
        installed: installed ? shimApp !== undefined : null,
        installedVersion: shimApp?.version ?? null,
        cobaltArguments: cobaltArguments(params),
      },
      setup: this.setupRecord,
      setupRunning: this.setupRunning,
      legacy: installed
        ? installed.filter(isLegacy).map(({ appId, tizenId, title, version }) => ({ appId, tizenId, title, version }))
        : null,
    };
  }

  /** The CA certificate (public), e.g. for a download. */
  caPem(): Promise<string> {
    return this.ca.caPem();
  }

  /** Builds the shim .wgt and queues its install (signed by Apps2Samsung). */
  async installShim(): Promise<JobSnapshot> {
    await this.config.ensureTvOnline();
    const built = await buildShim(await this.shimParams(), this.config.dir);
    console.log(`[yt] built ${built.path} (${built.size} bytes, sha256 ${built.sha256.slice(0, 12)})`);
    return this.a2s.installBuilt(built.path, `${SHIM.name} ${SHIM.version}`);
  }

  /**
   * Starts the shim's setup service on the TV (`0 execute`) and waits for its report.
   * Throws {@link YtSetupError} when it fails or does not report in time.
   */
  runSetup(): Promise<SetupRecord> {
    return this.setupLock.run(async () => {
      await this.config.ensureTvOnline();
      const installed = await this.apps.installed(true);
      if (!installed.some((app) => app.appId === SHIM.appId)) {
        return PolicyError.throw(`Install ${SHIM.name} first`);
      }
      this.setupRunning = true;
      let timer: Timer | undefined;
      try {
        const reported = new Promise<SetupRecord | undefined>((resolve) => {
          this.setupWaiter = resolve;
          timer = setTimeout(() => resolve(undefined), SETUP_TIMEOUT_MS);
        });
        const output = (await this.sdb.shell(`0 execute ${SHIM.serviceId}`)).trim();
        console.log(`[yt] 0 execute ${SHIM.serviceId}: ${output.slice(0, 200)}`);
        const record = await reported;
        if (!record) {
          return YtSetupError.throw(
            `The setup service did not report within ${SETUP_TIMEOUT_MS / 1000} s (TV said: ${output.slice(0, 160) || "nothing"})`,
          );
        }
        if (!record.report.ok) return YtSetupError.throw(`Setup failed on the TV: ${record.report.error ?? "unknown error"}`);
        return record;
      } finally {
        clearTimeout(timer);
        this.setupWaiter = undefined;
        this.setupRunning = false;
      }
    });
  }

  /** Stores a report from the setup service (POSTed from the TV's IP). */
  async receiveReport(report: SetupReport): Promise<void> {
    const installed = await this.installedOrNull();
    const record: SetupRecord = {
      report,
      receivedAt: new Date().toISOString(),
      youtubeVersion: installed?.find((app) => app.appId === STOCK_YOUTUBE)?.version ?? null,
    };
    this.setupRecord = record;
    await Bun.write(this.recordPath, JSON.stringify(record, null, 2));
    console.log(
      `[yt] setup report: ${report.ok ? "ok" : `FAILED (${report.error})`}, content ${report.content ?? "-"}, node ${report.node}, ${report.durationMs} ms`,
    );
    this.setupWaiter?.(record);
  }

  /** Why setup must run before the next launch, or undefined when it is current. */
  private async setupNeeded(): Promise<string | undefined> {
    const record = this.setupRecord;
    if (!record?.report.ok) return "no successful setup yet";
    if (record.report.shimVersion !== SHIM.version) return "the app was updated";
    if (Date.now() - Date.parse(record.receivedAt) > SETUP_MAX_AGE_MS) return "last setup is over a week old";
    const youtube = (await this.installedOrNull())?.find((app) => app.appId === STOCK_YOUTUBE);
    if (youtube && youtube.version !== record.youtubeVersion) return "YouTube was updated";
    return undefined;
  }

  /**
   * "Open YouTube": checks the proxy, refreshes the setup when needed, then cold-starts the
   * shim (stopping any Cobalt that runs with stock arguments).
   */
  async launch(): Promise<YtLaunchResult> {
    if (!this.proxy.stats().listening) {
      return PolicyError.throw(`The YouTube proxy is not listening on :${this.config.proxyPort}`);
    }
    const reason = await this.setupNeeded();
    if (reason) {
      console.log(`[yt] running setup before launch: ${reason}`);
      await this.runSetup();
    }
    const result = await this.apps.perform(SHIM.appId, "restart");
    return { ...result, setupRan: reason !== undefined };
  }
}

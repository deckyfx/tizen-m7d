/**
 * JSON contracts of `apps2samsung-cli --json` (v3.3.1), taken from its source
 * (Apps2Samsung.Cli/Commands/*.cs, Output.cs). Fields serialized as null are
 * omitted by the CLI, hence the optional properties.
 */

/** An install setting a package asks for (`install --set key=value`). */
export interface CatalogSetting {
  key: string;
  label: string;
  type: string;
  required: boolean;
  pattern?: string;
  helpUrl?: string;
}

/** One downloadable file (variant) of a catalog app. */
export interface CatalogFile {
  file: string;
  version: string;
  size: number;
  default: boolean;
  /** Minimum Tizen version, e.g. "3.0". */
  tizen: string;
  variant?: string;
  settings?: CatalogSetting[];
}

/** One app of `catalog --json`. */
export interface CatalogApp {
  name: string;
  category: string;
  description: string;
  requiresPartner: boolean;
  hasVariants: boolean;
  adult: boolean;
  root: boolean;
  tag: string;
  published: string;
  author: string;
  source: string;
  downloads?: number;
  files: CatalogFile[];
  ownSource: boolean;
  closedSource: boolean;
  selfUpdating: boolean;
  from: string;
  installable: boolean;
}

/** `catalog --json`. */
export interface CatalogResult {
  ok: true;
  count: number;
  apps: CatalogApp[];
}

/** Catalog comparison state of an installed app. */
export type CatalogState = "up-to-date" | "update-available" | "different" | "unknown";

/** Why the catalog stopped distributing an installed app. */
export interface RemovedInfo {
  name: string;
  reason: string;
  text: string;
  note?: string;
  since?: string;
}

/** One row of `installed --json`. */
export interface InstalledRow {
  title: string;
  appId: string;
  version?: string;
  installDate: string;
  removable: boolean;
  catalogApp?: string;
  catalogFile?: string;
  catalogVersion?: string;
  state?: CatalogState;
  catalogVariant?: string;
  variantRemembered: boolean;
  removed?: RemovedInfo;
}

/** `installed --json`. */
export interface InstalledResult {
  ok: true;
  tv: string;
  count: number;
  apps: InstalledRow[];
}

/** TV readiness as `tv <ip>` / `scan` report it. */
export interface TvCheckState {
  ip: string;
  name?: string;
  model?: string;
  developerMode: boolean;
  developerIp?: string;
  debugPortOpen: boolean;
  ready: boolean;
  notReadyReason?: string;
  mac?: string;
  route: string;
  relayDown: boolean;
  problem?: string;
}

/** `tv <ip> --json`. */
export interface TvCheckResult {
  ok: true;
  localIp?: string;
  tv: TvCheckState;
  tizenVersion?: string;
  duid?: string;
}

/** One file in the TV's install staging folder. */
export interface LeftoverFile {
  name: string;
  path: string;
  size: number;
  modified?: string;
  isPackage: boolean;
}

/** `leftovers --json` (listing). */
export interface LeftoversResult {
  ok: true;
  tv: string;
  agentVersion?: string;
  count: number;
  packages: number;
  packageBytes: number;
  files: LeftoverFile[];
  errors: string[];
}

/** One signing certificate profile (`cert --json`). */
export interface CertProfile {
  level: string;
  exists: boolean;
  usable: boolean;
  duids: string[];
  validFrom?: string;
  validUntil?: string;
  /** Folder of the profile on this machine. */
  path?: string;
}

/** `cert --json`. */
export interface CertResult {
  ok: true;
  store: string;
  profiles: CertProfile[];
  tizenProfiles: CertProfile[];
}

/** One user source (`sources --json`). */
export interface UserSource {
  name?: string;
  url: string;
  kind?: string;
  fingerprint?: string;
}

/** `sources --json`. */
export interface SourcesResult {
  sources: UserSource[];
}

/** A pre-install check that stopped an install (exit 3, `details.checks`). */
export interface InstallCheck {
  kind: string;
  defaultTitle: string;
  message: string;
}

/** Failure envelope of any command. */
export interface CliFailure {
  ok: false;
  error: string;
  details?: { checks?: InstallCheck[] } & Record<string, unknown>;
}

/** One app in a saved TV profile (`tv save`, schema 1). */
export interface ProfileApp {
  /** Catalog name, as `tv restore … [app...]` expects it. */
  name: string;
  appId: string;
  /** The variant this TV had. */
  packageFile: string;
  source: string;
  version: string;
  /** The variant could not be determined for sure. */
  uncertain?: boolean;
}

/** A saved TV profile file (`tv save`). */
export interface ProfileFile {
  schema: number;
  savedAtUtc: string;
  tvIp: string;
  containsSettings: boolean;
  apps: ProfileApp[];
}

/** One CLI session log (`logs --json`). */
export interface CliLogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

/** `logs --json`. */
export interface LogsResult {
  ok: true;
  folder: string;
  logs: CliLogFile[];
}

/** CLI exit codes (Output.cs). */
export const CLI_EXIT = { ok: 0, failed: 1, usage: 2, stopped: 3 } as const;

/**
 * Parser for the output of `sdb shell 0 vd_applist`.
 *
 * Each field is printed as `--------------key   =value-------------`, records are separated
 * by lines made only of dashes.
 */

/** An installed app as reported by `vd_applist`. */
export interface InstalledApp {
  /** Id used by the REST API (`111299001912`, `xvvl3S1TT1.TizenTubeStandalone`). */
  appId: string;
  /** Tizen application id used by `was_kill` (`9Ur5IzDKqV.TizenYouTube`). */
  tizenId: string;
  title: string;
  version: string;
  /** `user` for sideloaded apps, `normal` for store/preinstalled apps. */
  type: string;
  installDate: string;
  removable: boolean;
}

/** Matches one `key = value` line, stripping the dash padding on both sides. */
const FIELD_LINE = /^-+([^=]+?)\s*=(.*?)-*\s*$/;

/** Parses the full `vd_applist` output into apps (records without an app id are skipped). */
export function parseAppList(output: string): InstalledApp[] {
  const apps: InstalledApp[] = [];
  let fields = new Map<string, string>();

  const flush = (): void => {
    const appId = fields.get("app_id");
    if (appId) {
      apps.push({
        appId,
        tizenId: fields.get("app_tizen_id") ?? appId,
        title: fields.get("app_title") ?? appId,
        version: fields.get("app_version") ?? "",
        type: fields.get("type") ?? "",
        installDate: fields.get("install_date") ?? "",
        removable: fields.get("is_removable") === "1",
      });
    }
    fields = new Map();
  };

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (/^-+$/.test(line)) {
      flush();
      continue;
    }
    const match = FIELD_LINE.exec(line);
    const key = match?.[1]?.trim();
    if (key) fields.set(key, (match?.[2] ?? "").trim());
  }
  flush();

  // vd_applist sometimes prints a record twice around separators; keep the first.
  const seen = new Set<string>();
  return apps.filter((app) => !seen.has(app.appId) && seen.add(app.appId));
}

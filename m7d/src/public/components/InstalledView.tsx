import {
  ArchiveRestore,
  CircleCheck,
  Download,
  HardDrive,
  Package,
  Play,
  RefreshCw,
  ListChecks,
  Save,
  ShieldCheck,
  Sparkles,
  Trash,
  TriangleExclamationPoint,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { InstalledResult, InstalledRow, ProfileFile } from "../../a2s/types";
import { errorMessage, type Api } from "../lib/api";
import { useLayout } from "../lib/layout";
import { useJob } from "../lib/use-job";
import { usePoll } from "../lib/use-poll";
import { JobCard, type Job } from "./JobCard";
import { Badge, Button, Card, Checkbox, EmptyState, Field, fieldClass, Notice } from "./ui";

/** Props for {@link InstalledView}. */
interface InstalledViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Badge comparing the installed version with the catalog's (icon + words). */
function CatalogState({ row }: { row: InstalledRow }) {
  if (row.removed) {
    return (
      <Badge tone="danger" icon={TriangleExclamationPoint}>
        Removed from catalog
      </Badge>
    );
  }
  switch (row.state) {
    case "update-available":
      return (
        <Badge tone="info" icon={Sparkles}>
          Update {row.catalogVersion ?? ""}
        </Badge>
      );
    case "up-to-date":
      return (
        <Badge tone="success" icon={CircleCheck}>
          Up to date
        </Badge>
      );
    case "different":
      return <Badge tone="neutral">Catalog has {row.catalogVersion ?? "?"}</Badge>;
    default:
      return null;
  }
}

/** Result shape of the Eden calls that start a job. */
type JobStart = { data: Job | null; error: { status: unknown; value: unknown } | null };

/**
 * "On the TV": installed apps compared with the catalog, per-app Update / Open /
 * Uninstall, Update all, and saving or restoring the TV's app list (profiles).
 */
export function InstalledView({ api, onMessage }: InstalledViewProps) {
  const { isTv } = useLayout();
  const [started, setStarted] = useState<Job | undefined>(undefined);
  const job = useJob(api, started);
  const [confirmId, setConfirmId] = useState("");
  const [profileName, setProfileName] = useState("m7");
  const [withSettings, setWithSettings] = useState(false);

  const installed = usePoll<InstalledResult>(async () => {
    const { data, error } = await api.api.a2s.installed.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);

  const profiles = usePoll(async () => {
    const { data, error } = await api.api.a2s.profiles.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);

  // The TV marks even Samsung's own apps as removable; vd_applist's `type` tells them apart
  // ("normal" = store/preinstalled, "user" = sideloaded).
  const storeApps = usePoll<Set<string>>(async () => {
    const { data, error } = await api.api.apps.get({ query: {} });
    if (error) return { error: errorMessage(error) };
    return { data: new Set(data.filter((app) => app.type === "normal").map((app) => app.tizenId)) };
  }, 0);

  /** Shows a started job inline, or its error. */
  const start = (result: JobStart) => {
    if (result.error) onMessage(errorMessage(result.error), true);
    else if (result.data) setStarted(result.data);
  };

  const apps = installed.data?.apps ?? [];
  const removable = apps.filter((row) => row.removable);
  const builtIn = apps.filter((row) => !row.removable);
  const updates = removable.filter((row) => row.state === "update-available");
  const busy = job?.status === "queued" || job?.status === "running";

  const open = async (row: InstalledRow) => {
    const { data, error } = await api.api.apps({ appId: row.appId })({ action: "launch" }).post();
    if (error) onMessage(errorMessage(error), true);
    else onMessage(`${row.title}: ${data.message}`, !data.ok);
  };

  const uninstall = async (row: InstalledRow) => {
    if (confirmId !== row.appId) {
      setConfirmId(row.appId);
      return;
    }
    setConfirmId("");
    start(await api.api.a2s.jobs.uninstall.post({ appId: row.appId }));
  };

  const renderRow = (row: InstalledRow) => (
    <li
      key={row.appId}
      className="grid items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Package size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{row.title}</p>
          <p className="truncate font-mono text-xs text-slate-600">{row.appId}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone="neutral">v{row.version ?? "?"}</Badge>
        <CatalogState row={row} />
        {row.catalogVariant && <Badge tone="neutral">{row.catalogVariant}</Badge>}
        {storeApps.data?.has(row.appId) && (
          <Badge tone="neutral" icon={ShieldCheck}>
            Samsung app
          </Badge>
        )}
        <span className="text-xs text-slate-600">installed {row.installDate}</span>
        {row.removed && <p className="w-full text-xs text-rose-800">{row.removed.text}</p>}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {row.state === "update-available" && row.catalogApp && (
          <Button
            size="sm"
            variant="primary"
            icon={Download}
            disabled={busy}
            onClick={async () => start(await api.api.a2s.jobs.update.post({ apps: [row.catalogApp ?? ""] }))}
          >
            Update
          </Button>
        )}
        <Button size="sm" icon={Play} onClick={() => void open(row)}>
          Open
        </Button>
        {row.removable && (
          <Button
            size="sm"
            variant="danger"
            icon={Trash}
            disabled={busy}
            onClick={() => void uninstall(row)}
          >
            {confirmId === row.appId
              ? `${storeApps.data?.has(row.appId) ? "Samsung app! " : ""}${isTv ? "OK" : "Tap"} again to remove`
              : "Uninstall"}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {installed.data
            ? `${apps.length} apps · ${removable.length} removable · ${updates.length} updates`
            : installed.loading
              ? "Reading the TV (takes a few seconds)…"
              : "Not loaded"}
        </p>
        <Button icon={RefreshCw} busy={installed.loading} onClick={() => void installed.reload()}>
          Check for updates
        </Button>
      </div>

      {installed.error && <Notice tone="danger">{installed.error}</Notice>}
      {job && <JobCard api={api} job={job} expanded onMessage={onMessage} onRetried={setStarted} />}

      {updates.length > 0 && (
        <Notice
          tone="info"
          icon={Sparkles}
          title={`${updates.length} app${updates.length === 1 ? " has" : "s have"} an update`}
          actions={
            <Button
              variant="primary"
              icon={Download}
              disabled={busy}
              onClick={async () => start(await api.api.a2s.jobs.update.post({}))}
            >
              Update all
            </Button>
          }
        >
          {updates.map((row) => row.title).join(", ")}
        </Notice>
      )}

      {installed.data && apps.length === 0 && <EmptyState icon={Package} title="No apps reported" />}

      <AppGroup title="Installed apps" icon={Package} rows={removable} render={renderRow} />
      <AppGroup title="Built-in apps" icon={HardDrive} rows={builtIn} render={renderRow} />

      <Card
        title="App list backup"
        icon={ArchiveRestore}
        description="Saves which catalog apps (and variants) this TV has, to reinstall them after a reset."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Field label="Backup name">
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className={fieldClass}
                />
              </Field>
            </div>
            <Button
              icon={Save}
              disabled={busy}
              onClick={async () => {
                start(await api.api.a2s.jobs["profile-save"].post({ name: profileName, withSettings }));
                void profiles.reload();
              }}
            >
              Save app list
            </Button>
          </div>
          <Checkbox checked={withSettings} onChange={setWithSettings}>
            Include typed values (server addresses, API keys); keep such a file private
          </Checkbox>
          {profiles.data && profiles.data.length > 0 && (
            <ul className="divide-y divide-slate-200 rounded-xl ring-1 ring-slate-200">
              {profiles.data.map((profile) => (
                <ProfileRow
                  key={profile.name}
                  api={api}
                  name={profile.name}
                  modified={profile.modified}
                  busy={busy}
                  onStart={start}
                  onMessage={onMessage}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>
    </section>
  );
}

/** A titled list of installed apps (hidden when empty). */
function AppGroup({
  title,
  icon,
  rows,
  render,
}: {
  title: string;
  icon: typeof Package;
  rows: InstalledRow[];
  render: (row: InstalledRow) => ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <Card title={`${title} (${rows.length})`} icon={icon} padded={false}>
      <ul className="divide-y divide-slate-200">{rows.map(render)}</ul>
    </Card>
  );
}

/** Props for {@link ProfileRow}. */
interface ProfileRowProps {
  api: Api;
  name: string;
  modified: string;
  busy: boolean;
  onStart: (result: JobStart) => void;
  onMessage: (text: string, isError?: boolean) => void;
}

/** A saved app list: restore everything missing, or pick which apps to restore. */
function ProfileRow({ api, name, modified, busy, onStart, onMessage }: ProfileRowProps) {
  const [profile, setProfile] = useState<ProfileFile | undefined>(undefined);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const choose = async () => {
    if (profile) return setProfile(undefined);
    const { data, error } = await api.api.a2s.profiles({ name }).get();
    if (error) return onMessage(errorMessage(error), true);
    setProfile(data);
    setChosen(new Set(data.apps.map((app) => app.name)));
  };

  const toggle = (app: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(app);
    else next.delete(app);
    setChosen(next);
  };

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          <span className="font-semibold text-slate-900">{name}</span>{" "}
          <span className="text-slate-600">· {new Date(modified).toLocaleString()}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" icon={ListChecks} onClick={() => void choose()}>
            {profile ? "Hide apps" : "Choose apps…"}
          </Button>
          <Button
            size="sm"
            icon={ArchiveRestore}
            disabled={busy}
            onClick={async () => onStart(await api.api.a2s.jobs["profile-restore"].post({ name }))}
          >
            Restore all missing
          </Button>
        </span>
      </div>
      {profile && (
        <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-600">
            Apps already on the TV are skipped. Saved {new Date(profile.savedAtUtc).toLocaleString()}
            {profile.containsSettings ? " · includes typed values" : ""}.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {profile.apps.map((app) => (
              <li key={app.appId}>
                <Checkbox checked={chosen.has(app.name)} onChange={(on) => toggle(app.name, on)}>
                  <span className="font-medium">{app.name}</span>{" "}
                  <span className="text-slate-600">
                    v{app.version} · {app.packageFile}
                  </span>
                  {app.uncertain && (
                    <>
                      {" "}
                      <Badge tone="warning">variant guessed</Badge>
                    </>
                  )}
                </Checkbox>
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="primary"
              icon={ArchiveRestore}
              disabled={busy || chosen.size === 0}
              onClick={async () =>
                onStart(await api.api.a2s.jobs["profile-restore"].post({ name, apps: [...chosen] }))
              }
            >
              Restore selected ({chosen.size})
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

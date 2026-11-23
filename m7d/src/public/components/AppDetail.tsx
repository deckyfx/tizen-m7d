import {
  ChevronLeft,
  Code,
  Download,
  ExternalLink,
  Rocket,
  ShieldCheck,
  Sparkles,
  TriangleExclamationPoint,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { CatalogApp, CatalogFile } from "../../a2s/types";
import { errorMessage, type Api } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { runsOnTv, TV_TIZEN_VERSION } from "../lib/tizen";
import { useJob } from "../lib/use-job";
import { JobCard, type Job } from "./JobCard";
import { VariantPicker } from "./VariantPicker";
import { Badge, Button, ButtonLink, Card, Checkbox, Field, fieldClass, Notice } from "./ui";

/** Props for {@link AppDetail}. */
interface AppDetailProps {
  api: Api;
  app: CatalogApp;
  onClose: () => void;
  onMessage: (text: string, isError?: boolean) => void;
  /** Searches the catalog (used for "more by this author"). */
  onSearch: (query: string) => void;
}

/** Label of a file in the variant picker. */
function fileLabel(file: CatalogFile): string {
  return `${file.variant ?? file.file} · v${file.version} · ${formatBytes(file.size)}${file.default ? " (default)" : ""}`;
}

/**
 * Catalog app sheet: description, variant choice, the package's install settings
 * (rendered from its schema), certificate and install options, and Install with live progress.
 */
export function AppDetail({ api, app, onClose, onMessage, onSearch }: AppDetailProps) {
  const defaultFile = app.files.find((file) => file.default) ?? app.files[0];
  const [fileName, setFileName] = useState(defaultFile?.file ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [partner, setPartner] = useState(app.requiresPartner);
  const [launchAfter, setLaunchAfter] = useState(true);
  const [allowRemove, setAllowRemove] = useState(false);
  const [started, setStarted] = useState<Job | undefined>(undefined);
  const job = useJob(api, started);

  const file = useMemo(
    () => app.files.find((candidate) => candidate.file === fileName) ?? defaultFile,
    [app.files, defaultFile, fileName],
  );
  const settings = file?.settings ?? [];
  const compatible = file ? runsOnTv(file.tizen) : false;

  /** First problem with the typed settings, or undefined when they are valid. */
  const problem = settings
    .map((setting) => {
      const value = values[setting.key] ?? "";
      if (setting.required && !value) return `${setting.label} is required`;
      if (value && setting.pattern && !new RegExp(setting.pattern).test(value)) {
        return `${setting.label} has an invalid format`;
      }
      return undefined;
    })
    .find(Boolean);

  const install = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) return onMessage(problem, true);
    // Send the file only when the app has a choice; the CLI picks the default itself.
    const chosen = app.files.length > 1 && file ? (file.variant ?? file.file) : undefined;
    const { data, error } = await api.api.a2s.jobs.install.post({
      app: app.name,
      file: chosen,
      settings: Object.keys(values).length ? values : undefined,
      partner: partner || undefined,
      from: app.from,
      launch: launchAfter || undefined,
      allowRemove: allowRemove || undefined,
    });
    if (error) onMessage(errorMessage(error), true);
    else setStarted(data);
  };

  const running = job?.status === "queued" || job?.status === "running";

  return (
    <section className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" icon={ChevronLeft} onClick={onClose}>
          Back to catalog
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
        <Card padded>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-sky-50 font-display text-2xl font-bold text-sky-800">
                {app.name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-slate-900">{app.name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {app.category} · by{" "}
                  <button
                    type="button"
                    onClick={() => onSearch(app.author)}
                    className="font-medium text-sky-800 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700"
                  >
                    {app.author}
                  </button>{" "}
                  · {app.tag}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {app.downloads !== undefined && (
                <Badge tone="neutral" icon={Download}>
                  {formatCount(app.downloads)} downloads
                </Badge>
              )}
              {app.requiresPartner && (
                <Badge tone="warning" icon={ShieldCheck}>
                  Needs Partner certificate
                </Badge>
              )}
              {app.closedSource && <Badge tone="neutral">Closed source</Badge>}
              {app.selfUpdating && (
                <Badge tone="warning" icon={Sparkles}>
                  Downloads newer versions of itself
                </Badge>
              )}
              {!app.installable && <Badge tone="danger">Not installable</Badge>}
            </div>

            <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{app.description}</p>

            <div>
              <ButtonLink href={app.source} target="_blank" rel="noreferrer" icon={Code}>
                Source code
                <ExternalLink size={14} aria-hidden="true" />
              </ButtonLink>
            </div>
          </div>
        </Card>

        <Card title="Install on the TV" icon={Rocket}>
          <form onSubmit={install} className="flex flex-col gap-4">
            {app.files.length > 1 ? (
              <VariantPicker files={app.files} value={fileName} onChange={setFileName} runsOnTv={runsOnTv} />
            ) : (
              file && (
                <p className="text-sm text-slate-700">
                  {fileLabel(file)} · needs Tizen {file.tizen}+
                </p>
              )
            )}

            {file && !compatible && (
              <Notice tone="danger" icon={TriangleExclamationPoint}>
                This file needs Tizen {file.tizen}; the TV has {TV_TIZEN_VERSION}.
              </Notice>
            )}

            {settings.map((setting) => (
              <Field
                key={setting.key}
                label={`${setting.label}${setting.required ? " *" : ""}`}
                hint={
                  setting.helpUrl && (
                    <a href={setting.helpUrl} target="_blank" rel="noreferrer" className="text-sky-800 underline">
                      Where to get this
                    </a>
                  )
                }
              >
                <input
                  type={setting.type === "password" ? "password" : "text"}
                  value={values[setting.key] ?? ""}
                  onChange={(event) => setValues({ ...values, [setting.key]: event.target.value })}
                  className={fieldClass}
                />
              </Field>
            ))}

            <div className="flex flex-col gap-2.5">
              <Checkbox checked={partner} disabled={app.requiresPartner} onChange={setPartner}>
                Sign with the Partner certificate
              </Checkbox>
              <Checkbox checked={launchAfter} onChange={setLaunchAfter}>
                Open the app on the TV afterwards
              </Checkbox>
              <Checkbox checked={allowRemove} onChange={setAllowRemove}>
                If the TV refuses an update in place, allow remove and reinstall (erases the app’s data)
              </Checkbox>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              icon={Rocket}
              busy={running}
              disabled={!app.installable || !compatible}
            >
              {running ? "Installing…" : "Install on TV"}
            </Button>
          </form>
        </Card>
      </div>

      {job && <JobCard api={api} job={job} expanded onMessage={onMessage} onRetried={setStarted} />}
    </section>
  );
}

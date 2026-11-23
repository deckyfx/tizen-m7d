import {
  CircleCheck,
  CircleX,
  Download,
  FileText,
  Info,
  Play,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash,
  TriangleExclamationPoint,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { LeftoversResult, TvCheckResult } from "../../a2s/types";
import { downloadProtected, errorMessage, type Api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useJob } from "../lib/use-job";
import { JobCard, type Job } from "./JobCard";
import { Badge, Button, Card, fieldClass, InfoRow, Notice } from "./ui";

/** Props for {@link ToolboxView}. */
interface ToolboxViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Yes/no with an icon. */
function YesNo({ value, yes, no }: { value: boolean; yes: string; no: string }) {
  return value ? (
    <Badge tone="success" icon={CircleCheck}>
      {yes}
    </Badge>
  ) : (
    <Badge tone="danger" icon={CircleX}>
      {no}
    </Badge>
  );
}

/** Result shape of the Eden calls that start a job. */
type JobStart = { data: Job | null; error: { status: unknown; value: unknown } | null };

/**
 * TV toolbox: TV information and Developer Mode guide, open an app by id,
 * install leftovers (staging folder clean-up) and signing a package without installing it.
 */
export function ToolboxView({ api, onMessage }: ToolboxViewProps) {
  const [check, setCheck] = useState<TvCheckResult | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [appId, setAppId] = useState("");
  const [leftovers, setLeftovers] = useState<LeftoversResult | undefined>(undefined);
  const [loadingLeftovers, setLoadingLeftovers] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [started, setStarted] = useState<Job | undefined>(undefined);
  const [signFile, setSignFile] = useState<File | undefined>(undefined);
  const [signedId, setSignedId] = useState("");
  const job = useJob(api, started);
  const busy = job?.status === "queued" || job?.status === "running";

  const runCheck = async () => {
    setChecking(true);
    const { data, error } = await api.api.a2s["tv-check"].get();
    setChecking(false);
    if (error) onMessage(errorMessage(error), true);
    else setCheck(data);
  };

  const launch = async (event: FormEvent) => {
    event.preventDefault();
    if (!appId.trim()) return;
    const { data, error } = await api.api.apps({ appId: appId.trim() })({ action: "launch" }).post();
    if (error) onMessage(errorMessage(error), true);
    else onMessage(`${data.appId}: ${data.message}`, !data.ok);
  };

  const loadLeftovers = async () => {
    setLoadingLeftovers(true);
    const { data, error } = await api.api.a2s.leftovers.get();
    setLoadingLeftovers(false);
    if (error) onMessage(errorMessage(error), true);
    else setLeftovers(data);
  };

  /** Shows a started job inline, or its error. */
  const start = (result: JobStart) => {
    if (result.error) onMessage(errorMessage(result.error), true);
    else if (result.data) setStarted(result.data);
  };

  const sign = async () => {
    if (!signFile) return;
    const upload = await api.api.a2s.upload.post({ file: signFile });
    if (upload.error) return onMessage(errorMessage(upload.error), true);
    setSignedId(upload.data.uploadId);
    start(await api.api.a2s.jobs.sign.post({ uploadId: upload.data.uploadId, label: signFile.name }));
  };

  const tv = check?.tv;

  return (
    <section className="flex flex-col gap-5">
      {job && <JobCard api={api} job={job} expanded onMessage={onMessage} onRetried={setStarted} />}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="TV information"
          icon={Stethoscope}
          description="Developer Mode, debug port and identity, as Apps2Samsung sees them."
          actions={
            <Button icon={RefreshCw} busy={checking} onClick={() => void runCheck()}>
              {check ? "Check again" : "Check the TV"}
            </Button>
          }
        >
          {!check && <p className="text-sm text-slate-600">Press “Check the TV” to read its state.</p>}
          {check && tv && (
            <dl className="divide-y divide-slate-200">
              <InfoRow label="TV IP" value={tv.ip} />
              <InfoRow label="Name" value={tv.name} />
              <InfoRow label="Model" value={tv.model} />
              <InfoRow label="Tizen version" value={check.tizenVersion} />
              <InfoRow label="DUID" value={<code className="text-xs">{check.duid}</code>} />
              <InfoRow label="Developer mode" value={<YesNo value={tv.developerMode} yes="On" no="Off" />} />
              <InfoRow label="Developer host IP" value={tv.developerIp} />
              <InfoRow label="This machine" value={check.localIp} />
              <InfoRow label="Debug port 26101" value={<YesNo value={tv.debugPortOpen} yes="Open" no="Closed" />} />
              <InfoRow label="Ready to install" value={<YesNo value={tv.ready} yes="Ready" no="Not ready" />} />
            </dl>
          )}
          {tv && !tv.ready && (
            <div className="mt-4">
              <Notice tone="warning" icon={TriangleExclamationPoint} title={tv.problem ?? tv.notReadyReason ?? "The TV is not ready."}>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>On the TV, open Apps.</li>
                  <li>With the remote, type 1 2 3 4 5.</li>
                  <li>Switch Developer Mode on.</li>
                  <li>Enter this Host PC IP: {check?.localIp ?? "this box's IP (see Settings → TV connection)"}</li>
                  <li>Restart the TV (hold Power until it shuts down), then press “Check again”.</li>
                </ol>
              </Notice>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Open an app" icon={Play} description="Launch any installed app by its id (REST or Tizen id).">
            <form onSubmit={launch} className="flex flex-wrap gap-2">
              <input
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                placeholder="111299001912 or xvvl3S1TT1.TizenTubeStandalone"
                aria-label="App id"
                className={`${fieldClass} min-w-0 flex-1 font-mono`}
              />
              <Button type="submit" variant="primary" icon={Play}>
                Launch
              </Button>
            </form>
          </Card>

          <Card
            title="Sign a package"
            icon={ShieldCheck}
            description="Signs a local .wgt/.tpk with the certificate that covers this TV, without installing it."
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".wgt,.tpk"
                onChange={(event) => setSignFile(event.target.files?.[0])}
                className="text-sm file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:font-medium file:text-slate-800 hover:file:bg-slate-200"
              />
              <Button icon={ShieldCheck} disabled={!signFile || busy} onClick={() => void sign()}>
                Sign
              </Button>
              {signedId && job?.kind === "sign" && job.status === "succeeded" && (
                <Button
                  variant="success"
                  icon={Download}
                  onClick={async () => {
                    const ok = await downloadProtected(
                      `/api/a2s/signed/${signedId}`,
                      `signed-${signFile?.name ?? signedId}`,
                    );
                    if (!ok) onMessage("Download failed", true);
                  }}
                >
                  Download signed file
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card
        title="Install leftovers"
        icon={FileText}
        description="Every install leaves its package in a staging folder that retail firmware never cleans. Installed apps are never touched."
        actions={
          <>
            <Button icon={RefreshCw} busy={loadingLeftovers} onClick={() => void loadLeftovers()}>
              {leftovers ? "Refresh" : "Show leftovers"}
            </Button>
            {leftovers && leftovers.packages > 0 && (
              <Button
                variant="danger"
                icon={Trash}
                disabled={busy}
                onClick={async () => {
                  if (!confirmClear) return setConfirmClear(true);
                  setConfirmClear(false);
                  start(await api.api.a2s.jobs["leftovers-clear"].post());
                }}
              >
                {confirmClear
                  ? "Again to delete all"
                  : `Clear ${leftovers.packages} packages (${formatBytes(leftovers.packageBytes)})`}
              </Button>
            )}
          </>
        }
        padded={false}
      >
        {leftovers && (
          <ul className="divide-y divide-slate-200">
            {leftovers.files.length === 0 && (
              <li className="flex items-center gap-2 px-5 py-4 text-sm text-slate-600">
                <Info size={16} aria-hidden="true" /> The staging folder is empty.
              </li>
            )}
            {leftovers.files.map((file) => (
              <li key={file.path} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-600">
                    {formatBytes(file.size)}
                    {file.modified ? ` · ${file.modified}` : ""}
                    {file.isPackage ? "" : " · not a package"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  icon={Trash}
                  disabled={busy}
                  onClick={async () => start(await api.api.a2s.jobs["leftovers-delete"].post({ file: file.name }))}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

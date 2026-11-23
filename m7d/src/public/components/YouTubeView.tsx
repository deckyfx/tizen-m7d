import {
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Download,
  FileCode,
  MonitorPlay,
  PackagePlus,
  Play,
  ShieldCheck,
  TriangleExclamationPoint,
  Waypoints,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { downloadProtected, errorMessage, type Api } from "../lib/api";
import { formatBytes, formatCount, formatDateTime } from "../lib/format";
import { useJob } from "../lib/use-job";
import { usePoll } from "../lib/use-poll";
import { JobCard, type Job } from "./JobCard";
import { Badge, Button, Card, InfoRow, Notice } from "./ui";

/** Props for {@link YouTubeView}. */
interface YouTubeViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** `GET /api/yt/status` as the client sees it. */
type YtStatus = NonNullable<Awaited<ReturnType<Api["api"]["yt"]["status"]["get"]>>["data"]>;

/** Yes / no / unknown badge (never colour alone). */
function State({ value, yes, no, unknown = "Unknown" }: { value: boolean | null; yes: string; no: string; unknown?: string }) {
  if (value === null) {
    return (
      <Badge tone="neutral" icon={CircleQuestionMark}>
        {unknown}
      </Badge>
    );
  }
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

/** Time (with the date unless today), or a dash. */
function when(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : "—";
}

/**
 * Homelab YouTube: the proxy Cobalt uses (replacing TizenTube's flaky on-TV service), the
 * "YouTube m7d" app that points Cobalt at it, its one-shot setup on the TV, and launch.
 */
export function YouTubeView({ api, onMessage }: YouTubeViewProps) {
  const status = usePoll<YtStatus>(async () => {
    const { data, error } = await api.api.yt.status.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 3000);
  const [started, setStarted] = useState<Job | undefined>(undefined);
  const job = useJob(api, started);
  const installing = job?.status === "queued" || job?.status === "running";
  const [launching, setLaunching] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  const s = status.data;

  const launch = async () => {
    setLaunching(true);
    const { data, error } = await api.api.yt.launch.post();
    setLaunching(false);
    if (error) onMessage(errorMessage(error), true);
    else onMessage(`YouTube m7d: ${data.message}${data.setupRan ? " (setup ran first)" : ""}`, !data.ok);
    void status.reload();
  };

  const install = async () => {
    const { data, error } = await api.api.yt.shim.install.post();
    if (error) onMessage(errorMessage(error), true);
    else setStarted(data);
  };

  const setup = async () => {
    setSettingUp(true);
    const { data, error } = await api.api.yt.setup.post();
    setSettingUp(false);
    if (error) onMessage(errorMessage(error), true);
    else onMessage(`Setup done: content ${data.report.content ?? "?"} in ${data.report.durationMs} ms`);
    void status.reload();
  };

  if (!s) {
    return status.error ? (
      <Notice tone="danger" icon={TriangleExclamationPoint} title="Could not load the YouTube status">
        {status.error}
      </Notice>
    ) : (
      <p className="text-sm text-slate-600">Loading…</p>
    );
  }

  const { proxy, mitm, shim, setup: lastSetup, legacy } = s;
  const report = lastSetup?.report;

  return (
    <section className="flex flex-col gap-5">
      <Notice
        tone={proxy.listening ? "info" : "danger"}
        icon={proxy.listening ? MonitorPlay : TriangleExclamationPoint}
        title={proxy.listening ? "Ad-free YouTube through the homelab" : `The proxy is not listening on :${proxy.port}`}
        actions={
          <Button
            variant="primary"
            size="lg"
            icon={Play}
            busy={launching}
            disabled={!proxy.listening || shim.installed === false || installing}
            onClick={() => void launch()}
          >
            Open YouTube
          </Button>
        }
      >
        {proxy.listening
          ? "Cold-starts YouTube m7d on the TV. Setup runs first when it is new, YouTube was updated, or a week has passed."
          : (proxy.error ?? "See the m7d log.")}
      </Notice>

      {shim.installed === false && (
        <Notice tone="warning" icon={PackagePlus} title="Step 1: install YouTube m7d on the TV">
          It is a small app that starts Samsung's YouTube engine (Cobalt) with this proxy. Install it below, then press
          “Open YouTube”.
        </Notice>
      )}

      {legacy && legacy.length > 0 && (
        <Notice tone="warning" icon={TriangleExclamationPoint} title="Old TizenTube pieces are still installed">
          {legacy.map((app) => `${app.title} (${app.tizenId})`).join(", ")}. Their on-TV proxies fight over ports 8100/8101.
          Once YouTube m7d works, uninstall them on the Installed page.
        </Notice>
      )}

      {job && <JobCard api={api} job={job} expanded onMessage={onMessage} onRetried={setStarted} />}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="YouTube m7d app"
          icon={MonitorPlay}
          description="Starts Cobalt with the homelab proxy and its own content folder. No service runs on the TV."
          actions={
            <Button icon={PackagePlus} busy={installing} onClick={() => void install()}>
              {shim.installed ? "Reinstall" : "Install"}
            </Button>
          }
        >
          <dl className="divide-y divide-slate-200">
            <InfoRow label="On the TV" value={<State value={shim.installed} yes="Installed" no="Not installed" unknown="TV not reachable" />} />
            <InfoRow label="App id" value={<code className="text-xs">{shim.appId}</code>} />
            <InfoRow label="Version" value={shim.installedVersion ? `${shim.installedVersion} (package ${shim.version})` : shim.version} />
          </dl>
          <p className="mt-3 text-xs font-medium text-slate-600">Cobalt arguments</p>
          <code className="mt-1 block rounded-lg bg-slate-50 p-3 font-mono text-xs break-all text-slate-800 ring-1 ring-slate-200">
            {shim.cobaltArguments}
          </code>
        </Card>

        <Card
          title="Setup on the TV"
          icon={Wrench}
          description="A one-shot service copies Samsung's Cobalt content and installs this proxy's CA, then exits."
          actions={
            <Button icon={Wrench} busy={settingUp || s.setupRunning} disabled={shim.installed === false} onClick={() => void setup()}>
              Run setup
            </Button>
          }
        >
          {!report && <p className="text-sm text-slate-600">Not run yet. “Open YouTube” runs it automatically.</p>}
          {report && (
            <dl className="divide-y divide-slate-200">
              <InfoRow label="Result" value={<State value={report.ok} yes="OK" no="Failed" />} />
              <InfoRow label="When" value={when(lastSetup?.receivedAt)} />
              <InfoRow
                label="Cobalt content"
                value={
                  report.content
                    ? `${report.content === "copied" ? "Copied" : "Up to date"} · ${formatCount(report.files ?? 0)} files · ${formatBytes(report.bytes ?? 0)}`
                    : "—"
                }
              />
              <InfoRow label="CA files" value={report.certFiles?.join(", ")} />
              {report.removed && report.removed.length > 0 && (
                <InfoRow label="Deleted old leftovers" value={report.removed.join(", ")} />
              )}
              <InfoRow label="YouTube version then" value={lastSetup?.youtubeVersion} />
              <InfoRow label="TV service Node" value={report.node} />
              <InfoRow label="Took" value={`${report.durationMs} ms`} />
              {report.error && <InfoRow label="Error" value={<span className="text-rose-700">{report.error}</span>} />}
            </dl>
          )}
        </Card>

        <Card
          title="Proxy"
          icon={Waypoints}
          description={`Cobalt's --proxy. Only ${proxy.allowed.join(", ")} may connect; video is tunnelled untouched.`}
          actions={<State value={proxy.listening} yes={`Listening on :${proxy.port}`} no="Stopped" />}
        >
          <dl className="divide-y divide-slate-200">
            <InfoRow label="Last TV connection" value={when(proxy.lastTvAt)} />
            <InfoRow label="Open connections" value={formatCount(proxy.activeConnections)} />
            <InfoRow label="Connections since start" value={`${formatCount(proxy.totalConnections)} (since ${when(proxy.startedAt)})`} />
            <InfoRow label="Traffic to / from clients" value={`${formatBytes(proxy.bytesToClients)} / ${formatBytes(proxy.bytesFromClients)}`} />
            <InfoRow
              label="Refused (not allowed)"
              value={proxy.lastRejected ? `${proxy.rejected} · last ${proxy.lastRejected.ip} at ${when(proxy.lastRejected.at)}` : "0"}
            />
          </dl>
          {proxy.topHosts.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <caption className="pb-2 text-left text-xs font-medium text-slate-600">Busiest destinations</caption>
              <thead>
                <tr className="text-left text-xs text-slate-600">
                  <th scope="col" className="py-1 font-medium">Host</th>
                  <th scope="col" className="py-1 pl-4 text-right font-medium whitespace-nowrap">Connections</th>
                  <th scope="col" className="py-1 pl-4 text-right font-medium whitespace-nowrap">Traffic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {proxy.topHosts.map((host) => (
                  <tr key={host.host}>
                    <td className="py-1.5 font-mono text-xs break-all text-slate-800">{host.host}</td>
                    <td className="py-1.5 pl-4 text-right whitespace-nowrap text-slate-700 tabular-nums">{formatCount(host.connections)}</td>
                    <td className="py-1.5 pl-4 text-right whitespace-nowrap text-slate-700 tabular-nums">{formatBytes(host.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="TLS interception"
          icon={ShieldCheck}
          description="Only www.youtube.com and youtube.com are decrypted, to add the userscript to the /tv page."
          actions={
            <Button
              icon={Download}
              size="sm"
              onClick={() =>
                void downloadProtected("/api/yt/ca.pem", "m7d-youtube-proxy-ca.pem").then(
                  (ok) => ok || onMessage("Download failed", true),
                )
              }
            >
              CA certificate
            </Button>
          }
        >
          <dl className="divide-y divide-slate-200">
            <InfoRow label="CA" value={s.ca.subject.replace(/^CN\s*=\s*/, "")} />
            <InfoRow label="Valid until" value={when(s.ca.notAfter)} />
            <InfoRow label="SHA-256" value={<code className="text-xs break-all">{s.ca.sha256.slice(0, 32)}…</code>} />
            <InfoRow label="Requests decrypted" value={formatCount(mitm.requests)} />
            <InfoRow label="Pages with the userscript" value={`${formatCount(mitm.injections)} · last ${when(mitm.lastInjectionAt)}`} />
            <InfoRow label="Userscript loads" value={formatCount(mitm.userscriptLoads)} />
            <InfoRow
              label="Upstream errors"
              value={mitm.lastError ? `${mitm.errors} · ${mitm.lastError.message}` : String(mitm.errors)}
            />
          </dl>
        </Card>

        <Card
          title="Userscript"
          icon={FileCode}
          description="TizenTube's ad-blocking and SponsorBlock script, pinned in package.json (no CDN at runtime)."
        >
          <dl className="divide-y divide-slate-200">
            <InfoRow label="@foxreis/tizentube" value={s.userscript.version} />
            <InfoRow label="Size" value={formatBytes(s.userscript.size)} />
            <InfoRow label="Hash" value={<code className="text-xs">{s.userscript.hash}</code>} />
          </dl>
        </Card>
      </div>
    </section>
  );
}

import {
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  LoaderCircle,
  RotateCcw,
  TriangleExclamationPoint,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { errorMessage, type Api } from "../lib/api";
import { formatTime } from "../lib/format";
import { Badge, Button, Notice, type Tone } from "./ui";

/** A job as returned by the API. */
export type Job = NonNullable<Awaited<ReturnType<Api["api"]["a2s"]["jobs"]["get"]>>["data"]>[number];

/** Tone, icon and label per job status (icon + text, never colour alone). */
const STATUS: Record<Job["status"], { tone: Tone; icon: LucideIcon; label: string }> = {
  queued: { tone: "neutral", icon: Clock, label: "Queued" },
  running: { tone: "info", icon: LoaderCircle, label: "Running" },
  succeeded: { tone: "success", icon: CircleCheck, label: "Done" },
  failed: { tone: "danger", icon: CircleX, label: "Failed" },
  stopped: { tone: "warning", icon: TriangleExclamationPoint, label: "Stopped at a check" },
};

/** Props for {@link JobCard}. */
interface JobCardProps {
  api: Api;
  job: Job;
  /** Start with the log expanded (inline progress after an action). */
  expanded?: boolean;
  onMessage: (text: string, isError?: boolean) => void;
  /** Called with the new job after "Retry anyway". */
  onRetried?: (job: Job) => void;
}

/** One Apps2Samsung job: status, live log, stopping checks and "Retry anyway". */
export function JobCard({ api, job, expanded = false, onMessage, onRetried }: JobCardProps) {
  const [open, setOpen] = useState(expanded);
  const status = STATUS[job.status];
  const active = job.status === "queued" || job.status === "running";
  const lastLine = job.log[job.log.length - 1];

  const retry = async () => {
    const { data, error } = await api.api.a2s.jobs({ id: job.id }).retry.post();
    if (error) onMessage(errorMessage(error), true);
    else {
      onMessage(`Retrying: ${data.title}`);
      onRetried?.(data);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge tone={status.tone} icon={status.icon}>
            {status.label}
          </Badge>
          <h3 className="truncate font-semibold text-slate-900">{job.title}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span>{formatTime(job.createdAt)}</span>
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => setOpen(!open)}>
            {open ? "Hide log" : `Log (${job.log.length})`}
          </Button>
        </div>
      </header>

      {active && lastLine && !open && <p className="truncate text-sm text-slate-600">{lastLine.text}</p>}

      {job.error && (
        <Notice tone={job.status === "stopped" ? "warning" : "danger"} icon={job.status === "stopped" ? TriangleExclamationPoint : CircleX}>
          {job.error}
        </Notice>
      )}

      {job.checks && job.checks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {job.checks.map((check) => (
            <li key={check.kind}>
              <Notice tone="warning" icon={TriangleExclamationPoint} title={check.defaultTitle}>
                {check.message}
              </Notice>
            </li>
          ))}
        </ul>
      )}

      {job.canRetryAnyway && (
        <div>
          <Button variant="warning" icon={RotateCcw} onClick={() => void retry()}>
            Retry anyway
          </Button>
        </div>
      )}

      {open && (
        <pre className="max-h-80 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
          {job.log.length === 0
            ? active
              ? "Waiting for output…"
              : "No output."
            : job.log
                .map(
                  (line) =>
                    `${formatTime(line.at)}  ${line.level === "warning" ? "⚠ " : line.level === "error" ? "✖ " : ""}${line.text}`,
                )
                .join("\n")}
        </pre>
      )}
    </article>
  );
}

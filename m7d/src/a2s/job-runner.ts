import { Mutex } from "../lib/mutex";
import type { CliLogLine, CliRun } from "./a2s-cli";
import { CLI_EXIT, type InstallCheck } from "./types";

/** Lifecycle of a job. `stopped` = the CLI refused at a pre-install check (retry with "anyway"). */
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

/** Kinds of long-running Apps2Samsung operations. */
export type JobKind =
  | "install"
  | "install-file"
  | "uninstall"
  | "update"
  | "leftovers-clear"
  | "leftovers-delete"
  | "profile-save"
  | "profile-restore"
  | "sign";

/** Public view of a job (what the API returns). */
export interface JobSnapshot {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  /** Checks that stopped an install (status `stopped`). */
  checks?: InstallCheck[];
  /** Parsed CLI answer on success. */
  result?: unknown;
  /** Arguments to repeat the job with `--yes` (set when it was stopped at a check). */
  canRetryAnyway: boolean;
  log: CliLogLine[];
}

/** Work a job performs: runs the CLI, streaming lines to `onLine`. */
export type JobWork = (onLine: (line: CliLogLine) => void) => Promise<CliRun<unknown>>;

/** How many finished jobs are remembered. */
const HISTORY = 50;

/**
 * Runs Apps2Samsung jobs strictly one at a time (the TV installs one package at a time and
 * has a single sdb slot) and keeps their live logs for the UI.
 */
export class JobRunner {
  private readonly jobs: JobSnapshot[] = [];
  private readonly lock = new Mutex();
  private counter = 0;

  /** Queues `work`; returns the job immediately (status `queued`). */
  enqueue(kind: JobKind, title: string, work: JobWork, retryable = false): JobSnapshot {
    this.counter += 1;
    const job: JobSnapshot = {
      id: `${Date.now().toString(36)}-${this.counter}`,
      kind,
      title,
      status: "queued",
      createdAt: new Date().toISOString(),
      canRetryAnyway: false,
      log: [],
    };
    this.jobs.unshift(job);
    this.jobs.splice(HISTORY);
    void this.lock.run(() => this.execute(job, work, retryable));
    return job;
  }

  /** All remembered jobs, newest first. */
  list(): JobSnapshot[] {
    return this.jobs;
  }

  /** One job by id. */
  get(id: string): JobSnapshot | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  /** True while a job is queued or running. */
  get busy(): boolean {
    return this.jobs.some((job) => job.status === "queued" || job.status === "running");
  }

  /** Runs one job and records its outcome; never rejects (keeps the queue alive). */
  private async execute(job: JobSnapshot, work: JobWork, retryable: boolean): Promise<void> {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    const run = await work((line) => job.log.push(line)).catch(
      (error: Error): CliRun<unknown> => ({
        exitCode: CLI_EXIT.failed,
        data: undefined,
        failure: { ok: false, error: error.message },
        lines: [],
      }),
    );
    job.finishedAt = new Date().toISOString();
    job.exitCode = run.exitCode;
    if (run.failure) {
      job.status = run.exitCode === CLI_EXIT.stopped ? "stopped" : "failed";
      job.error = run.failure.error;
      job.checks = run.failure.details?.checks;
      job.canRetryAnyway = retryable && job.status === "stopped";
      return;
    }
    job.status = "succeeded";
    job.result = run.data;
  }
}

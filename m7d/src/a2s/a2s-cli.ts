import { PolicyError } from "../lib/errors";
import { CLI_EXIT, type CliFailure } from "./types";

/** One stderr line of a CLI run (progress or warning). */
export interface CliLogLine {
  at: string;
  level: "progress" | "warning" | "error";
  text: string;
}

/** Outcome of a CLI run. Exactly one of `data` / `failure` is set. */
export interface CliRun<T> {
  exitCode: number;
  data: T | undefined;
  failure: CliFailure | undefined;
  lines: CliLogLine[];
}

/** Options for {@link A2sCli.run}. */
export interface CliRunOptions {
  /** Called for every stderr line as it arrives (live job logs). */
  onLine?: (line: CliLogLine) => void;
  /** Kill the process after this long (default 10 minutes). */
  timeoutMs?: number;
}

/** How long to keep reading pipes after a stopped run has exited. */
const PIPE_GRACE_MS = 300;

/** Default run timeout: installs download packages and can take minutes. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * The CLI announces an interactive Samsung sign-in with this line (a certificate it needs is
 * missing). It then waits for a browser login that a background service can never complete.
 */
const SIGN_IN_PROMPT = /Samsung account sign-in is needed/i;

/** Message returned when a run needed a Samsung sign-in. */
export const SIGN_IN_REQUIRED =
  "Apps2Samsung needs a Samsung sign-in to create a signing certificate it is missing. " +
  "Sign in once on the homelab: apps2samsung-cli cert --prepare --partner --tv <TV IP>";

/** Arguments a caller-supplied value may never look like (would be parsed as an option). */
const OPTION_LIKE = /^-/;

/**
 * Rejects values that would change the CLI's meaning: empty, option-like (`--allow-root`),
 * or containing control characters. The CLI is spawned without a shell, so this is about
 * argument injection, not shell injection.
 */
export function assertSafeArg(value: string, what: string): string {
  // eslint-disable-next-line no-control-regex
  if (!value || OPTION_LIKE.test(value) || /[\u0000-\u001f]/.test(value) || value.length > 512) {
    return PolicyError.throw(`Invalid ${what}: ${JSON.stringify(value.slice(0, 80))}`);
  }
  return value;
}

/** Classifies one stderr line of the CLI's plain/JSON mode. */
function toLogLine(text: string): CliLogLine {
  const at = new Date().toISOString();
  if (text.startsWith("warning: ")) return { at, level: "warning", text: text.slice(9) };
  if (text.startsWith("error: ")) return { at, level: "error", text: text.slice(7) };
  return { at, level: "progress", text };
}

/** Reads a byte stream line by line, calling `onLine` for each non-empty line. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) onLine(part.trim());
  }
  pending += decoder.decode();
  if (pending.trim()) onLine(pending.trim());
}

/**
 * Runs `apps2samsung-cli … --json` and returns its parsed result.
 * Progress/warnings (stderr) are streamed to `onLine`; the result (stdout) is one JSON document.
 */
export class A2sCli {
  /** @param binary absolute path of apps2samsung-cli */
  constructor(private readonly binary: string) {}

  /** Runs the CLI with `args` (no shell) and parses its JSON answer. */
  async run<T>(args: string[], options: CliRunOptions = {}): Promise<CliRun<T>> {
    const lines: CliLogLine[] = [];
    const child = Bun.spawn([this.binary, ...args, "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      // BROWSER=true: xdg-open runs `true` instead of popping a sign-in page on the homelab.
      env: { ...Bun.env, NO_COLOR: "1", TERM: "dumb", BROWSER: "true" },
    });
    let needsSignIn = false;
    // Stopping a run (sign-in prompt, timeout) must not wait on pipes that a leftover
    // grandchild process could keep open: once killed, give the pipes a short grace period.
    let signalStopped = (): void => {};
    const stopped = new Promise<void>((resolve) => {
      signalStopped = resolve;
    });
    const stop = (): void => {
      child.kill();
      signalStopped();
    };
    const timer = setTimeout(stop, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const reads = Promise.all([
      new Response(child.stdout).text(),
      readLines(child.stderr, (text) => {
        const line = toLogLine(text);
        lines.push(line);
        options.onLine?.(line);
        // Never hang on an interactive login: stop the run and report it.
        if (!needsSignIn && SIGN_IN_PROMPT.test(line.text)) {
          needsSignIn = true;
          stop();
        }
      }),
    ]).then(([out]) => out);
    const afterStop = stopped
      .then(() => child.exited)
      .then(() => Bun.sleep(PIPE_GRACE_MS))
      .then(() => "");
    const stdout = await Promise.race([reads, afterStop]);
    const exitCode = await child.exited;
    clearTimeout(timer);

    if (needsSignIn) {
      return { exitCode, data: undefined, failure: { ok: false, error: SIGN_IN_REQUIRED }, lines };
    }

    const parsed = parseJson(stdout);
    if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
      return { exitCode, data: undefined, failure: parsed as CliFailure, lines };
    }
    if (parsed === undefined || (exitCode !== CLI_EXIT.ok && exitCode !== CLI_EXIT.stopped)) {
      const tail = lines.slice(-3).map((line) => line.text).join(" | ");
      const failure: CliFailure = {
        ok: false,
        error: child.signalCode
          ? `apps2samsung-cli was stopped (${child.signalCode}, timeout?)`
          : `apps2samsung-cli exited with ${exitCode} without a JSON answer${tail ? `: ${tail}` : ""}`,
      };
      return { exitCode, data: undefined, failure, lines };
    }
    return { exitCode, data: parsed as T, failure: undefined, lines };
  }
}

/** Parses the CLI's stdout (one JSON document), or undefined when it is not JSON. */
function parseJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some builds print a banner line first; the document is then the last line.
    const last = text.split("\n").pop() ?? "";
    try {
      return JSON.parse(last) as unknown;
    } catch {
      return undefined;
    }
  }
}

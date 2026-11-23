import { CircleCheck, CircleX, FileText, Folder, KeyRound, Link, Plus, Trash, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { CertResult, LogsResult, SourcesResult } from "../../a2s/types";
import { errorMessage, fetchProtected, type Api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { usePoll } from "../lib/use-poll";
import { TvConnectionCard } from "./TvConnectionCard";
import { Badge, Button, Card, Field, fieldClass, Notice } from "./ui";

/** Props for {@link SettingsView}. */
interface SettingsViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/**
 * Settings: signing certificates on the homelab, the user's own app sources,
 * and Apps2Samsung's session logs (for diagnosing a failed install).
 */
export function SettingsView({ api, onMessage }: SettingsViewProps) {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  const [logText, setLogText] = useState<{ name: string; text: string } | undefined>(undefined);

  const certs = usePoll<CertResult>(async () => {
    const { data, error } = await api.api.a2s.certificates.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);
  const sources = usePoll<SourcesResult>(async () => {
    const { data, error } = await api.api.a2s.sources.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);
  const logs = usePoll<LogsResult>(async () => {
    const { data, error } = await api.api.a2s.logs.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);

  const addSource = async (event: FormEvent) => {
    event.preventDefault();
    const { error } = await api.api.a2s.sources.post({
      link,
      name: name || undefined,
      fingerprint: fingerprint || undefined,
    });
    if (error) return onMessage(errorMessage(error), true);
    onMessage(`Source added: ${link}`);
    setLink("");
    setName("");
    setFingerprint("");
    await sources.reload();
  };

  const removeSource = async (source: string) => {
    if (confirmRemove !== source) return setConfirmRemove(source);
    setConfirmRemove("");
    const { error } = await api.api.a2s.sources.remove.post({ source });
    if (error) return onMessage(errorMessage(error), true);
    onMessage(`Source removed: ${source}`);
    await sources.reload();
  };

  const showLog = async (logName: string) => {
    const response = await fetchProtected(`/api/a2s/logs/${encodeURIComponent(logName)}`);
    if (!response.ok) return onMessage(`Could not read ${logName}`, true);
    setLogText({ name: logName, text: await response.text() });
  };

  const allProfiles = [...(certs.data?.profiles ?? []), ...(certs.data?.tizenProfiles ?? [])];

  return (
    <section className="flex flex-col gap-5">
      <TvConnectionCard api={api} onMessage={onMessage} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Signing certificates"
          icon={KeyRound}
          description={certs.data ? <code className="text-xs">{certs.data.store}</code> : undefined}
          padded={false}
        >
          {certs.error && (
            <div className="p-5">
              <Notice tone="danger">{certs.error}</Notice>
            </div>
          )}
          <ul className="divide-y divide-slate-200">
            {allProfiles.map((profile) => (
              <li
                key={`${profile.level}-${profile.path ?? ""}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <span className="font-semibold text-slate-900">{profile.level}</span>
                {profile.usable ? (
                  <span className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    <Badge tone="success" icon={CircleCheck}>
                      Valid until {profile.validUntil ?? "?"}
                    </Badge>
                    <span className="font-mono text-xs">{profile.duids.join(", ") || "no TV"}</span>
                  </span>
                ) : (
                  <Badge tone="neutral" icon={CircleX}>
                    Not created
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-200 px-5 py-4 text-xs text-slate-600">
            Creating or renewing a certificate needs a Samsung sign-in in a browser on this box itself
            (the login returns to a local port there). Run{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">
              apps2samsung-cli cert --prepare --partner --tv &lt;TV IP&gt;
            </code>{" "}
            on this box (in Docker: prefix it with{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">docker exec -it tizen-m7d</code>).
          </p>
        </Card>

        <Card
          title="Your sources"
          icon={Link}
          description="Extra repositories, release links, .wgt links or feeds; their apps appear in the catalog."
        >
          <div className="flex flex-col gap-4">
            <ul className="divide-y divide-slate-200 rounded-xl ring-1 ring-slate-200">
              {sources.data?.sources.length === 0 && (
                <li className="px-4 py-3 text-sm text-slate-600">No sources added.</li>
              )}
              {sources.data?.sources.map((source) => {
                const id = source.name ?? source.url;
                return (
                  <li key={source.url} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 text-sm">
                      {source.name && <span className="font-semibold text-slate-900">{source.name} · </span>}
                      <span className="break-all text-slate-600">{source.url}</span>
                    </span>
                    <Button size="sm" variant="danger" icon={Trash} onClick={() => void removeSource(id)}>
                      {confirmRemove === id ? "Again to remove" : "Remove"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <form onSubmit={addSource} className="flex flex-col gap-3">
              <Field label="Link">
                <input
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="github.com/owner/repo, a release page, a .wgt link or a feed"
                  className={fieldClass}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name (optional)">
                  <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
                </Field>
                <Field label="Key fingerprint" hint="Only for signed repositories">
                  <input
                    value={fingerprint}
                    onChange={(event) => setFingerprint(event.target.value)}
                    className={`${fieldClass} font-mono`}
                  />
                </Field>
              </div>
              <div>
                <Button type="submit" variant="primary" icon={Plus} disabled={link.trim().length < 3}>
                  Add source
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>

      <Card
        title="Apps2Samsung logs"
        icon={FileText}
        description="Every CLI run: each install step, SDB command and the TV’s own install output. Newest first."
        padded={false}
      >
        <div className="grid gap-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="divide-y divide-slate-200 border-b border-slate-200 lg:border-r lg:border-b-0">
            {logs.data?.logs.slice(0, 15).map((log) => (
              <li key={log.name}>
                <button
                  type="button"
                  onClick={() => void showLog(log.name)}
                  aria-pressed={logText?.name === log.name}
                  className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-slate-50 ${
                    logText?.name === log.name ? "bg-sky-50" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 text-slate-900">
                    <Folder size={16} className="text-slate-500" aria-hidden="true" />
                    {new Date(log.modified).toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-600">{formatBytes(log.size)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 p-5">
            {logText ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <code className="truncate text-xs text-slate-600">{logText.name}</code>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setLogText(undefined)}>
                    Close
                  </Button>
                </div>
                <pre className="max-h-[32rem] overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
                  {logText.text}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Pick a run to read its log.</p>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

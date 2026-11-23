import { CircleCheck, CircleQuestionMark, CircleX, Network, Save, TriangleExclamationPoint } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, type Api } from "../lib/api";
import { usePoll } from "../lib/use-poll";
import { useTv } from "../lib/use-tv";
import { Badge, Button, Card, Field, fieldClass, InfoRow, Notice } from "./ui";

/** Props for {@link TvConnectionCard}. */
interface TvConnectionCardProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** `GET /api/settings`. */
type Settings = NonNullable<Awaited<ReturnType<Api["api"]["settings"]["get"]>>["data"]>;

/** Where a value comes from, as a small label. */
function SourceBadge({ source }: { source: Settings["tvHostSource"] }) {
  const label = { dashboard: "Saved here", environment: "From .env", detected: "Detected", unset: "Not set" }[source];
  return <Badge tone={source === "unset" ? "warning" : "neutral"}>{label}</Badge>;
}

/** Green / red / unknown check with text (never colour alone). */
function Check({ ok, yes, no }: { ok: boolean | null; yes: string; no: string }) {
  if (ok === null)
    return (
      <Badge tone="neutral" icon={CircleQuestionMark}>
        Unknown
      </Badge>
    );
  return ok ? (
    <Badge tone="success" icon={CircleCheck}>
      {yes}
    </Badge>
  ) : (
    <Badge tone="danger" icon={CircleX}>
      {no}
    </Badge>
  );
}

/**
 * TV connection settings: the TV's IP and this box's IP (both saved in m7d, overriding .env),
 * a live check of the TV's Developer Mode, and how to point the TV's Host PC IP at this box.
 */
export function TvConnectionCard({ api, onMessage }: TvConnectionCardProps) {
  const settings = usePoll<Settings>(async () => {
    const { data, error } = await api.api.settings.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 0);
  const tv = useTv();
  const [tvHost, setTvHost] = useState("");
  const [homelabIp, setHomelabIp] = useState("");
  const [saving, setSaving] = useState(false);

  const current = settings.data;
  useEffect(() => {
    if (!current) return;
    setTvHost(current.tvHostSource === "dashboard" || current.tvHostSource === "environment" ? current.tvHost : "");
    setHomelabIp(current.homelabIpSource === "dashboard" ? current.homelabIp : "");
  }, [current]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const { data, error } = await api.api.settings.put({ tvHost: tvHost.trim(), homelabIp: homelabIp.trim() });
    setSaving(false);
    if (error) return onMessage(errorMessage(error), true);
    onMessage(`Saved. TV ${data.tvHost || "not set"}, this box ${data.homelabIp || "unknown"}.`);
    void settings.reload();
    void tv?.reload();
  };

  const state = tv?.data;
  const online = state?.online === true ? state : undefined;
  const boxIp = current?.homelabIp ?? "";
  const hostMatches = online ? online.developerMode && online.developerIp === boxIp : null;

  return (
    <Card
      title="TV connection"
      icon={Network}
      description="Which TV m7d controls, and how the TV reaches this box. Saved here; .env only gives the defaults."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field
            label={
              <span className="flex items-center gap-2">
                TV IP {current && <SourceBadge source={current.tvHostSource} />}
              </span>
            }
            hint="Give the TV a fixed address (DHCP reservation) in your router."
          >
            <input
              value={tvHost}
              onChange={(event) => setTvHost(event.target.value)}
              placeholder="e.g. 192.168.1.50"
              inputMode="decimal"
              className={fieldClass}
            />
          </Field>
          <Field
            label={
              <span className="flex items-center gap-2">
                This box's IP {current && <SourceBadge source={current.homelabIpSource} />}
              </span>
            }
            hint={
              <>
                Leave empty to use {current?.homelabIp ? <strong>{current.homelabIp}</strong> : "the detected address"}. It is built
                into YouTube m7d: after changing it, reinstall that app (YouTube page).
              </>
            }
          >
            <input
              value={homelabIp}
              onChange={(event) => setHomelabIp(event.target.value)}
              placeholder={current?.homelabIp || "detected from the route to the TV"}
              inputMode="decimal"
              className={fieldClass}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" icon={Save} busy={saving}>
              Save
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          <dl className="divide-y divide-slate-200">
            <InfoRow
              label="TV answers"
              value={<Check ok={current?.tvHost ? Boolean(online) : false} yes="Yes" no={current?.tvHost ? "No (off or wrong IP)" : "No TV IP set"} />}
            />
            <InfoRow label="Model" value={online ? `${online.name} · ${online.model}` : "—"} />
            <InfoRow label="Developer Mode" value={<Check ok={online ? online.developerMode : null} yes="On" no="Off" />} />
            <InfoRow
              label="TV's Host PC IP"
              value={
                online ? (
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <code className="text-xs">{online.developerIp || "—"}</code>
                    <Check ok={hostMatches} yes="This box" no="Not this box" />
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </dl>

          {hostMatches !== true && (
            <Notice tone={hostMatches === false ? "warning" : "info"} icon={TriangleExclamationPoint} title="Point the TV at this box">
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>On the TV, open <strong>Apps</strong>.</li>
                <li>
                  Type <strong>1 2 3 4 5</strong> with the remote (on a remote without digits, use its <strong>123</strong> button
                  for the on-screen keypad).
                </li>
                <li>Switch <strong>Developer mode</strong> on.</li>
                <li>
                  Set <strong>Host PC IP</strong> to <code className="font-semibold">{boxIp || "this box's IP"}</code> and press OK.
                </li>
                <li>
                  Restart the TV: hold Power until the screen goes off (or use “Power off” in the header), then turn it on again.
                </li>
                <li>This card then shows “This box”. Only one Host PC IP is allowed: other PCs lose debug access.</li>
              </ol>
            </Notice>
          )}
        </div>
      </div>
    </Card>
  );
}

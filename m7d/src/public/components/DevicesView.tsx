import { Clock, MonitorSmartphone, Pencil, Save, Trash, UserX } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, type Api } from "../lib/api";
import { describeUserAgent } from "../lib/browser-name";
import { formatDateTime } from "../lib/format";
import { usePoll } from "../lib/use-poll";
import { AccessRequests } from "./AccessRequests";
import { Badge, Button, Card, EmptyState, Field, fieldClass } from "./ui";

/** Props for {@link DevicesView}. */
interface DevicesViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** `GET /api/auth/devices`. */
type DeviceList = NonNullable<Awaited<ReturnType<Api["api"]["auth"]["devices"]["get"]>>["data"]>;

/** One remembered browser. */
type DeviceEntry = DeviceList["devices"][number];

/** How a browser got in, for people. */
const VIA_LABEL: Record<DeviceEntry["via"], string> = { token: "Access token", approval: "Approved" };

/**
 * Remembered browsers: approve waiting ones, choose how long unused browsers are remembered,
 * rename or remove them (one, or all except this browser).
 */
export function DevicesView({ api, onMessage }: DevicesViewProps) {
  const list = usePoll<DeviceList>(async () => {
    const { data, error } = await api.api.auth.devices.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 15000);
  const [days, setDays] = useState("");
  const [savingDays, setSavingDays] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | undefined>(undefined);
  const [confirm, setConfirm] = useState("");

  const idleDays = list.data?.idleDays;
  useEffect(() => {
    if (idleDays !== undefined) setDays(String(idleDays));
  }, [idleDays]);

  const saveDays = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0 || value > 3650) return onMessage("Enter whole days from 0 to 3650", true);
    setSavingDays(true);
    const { error } = await api.api.settings.put({ deviceIdleDays: value });
    setSavingDays(false);
    if (error) return onMessage(errorMessage(error), true);
    onMessage(value === 0 ? "Remembered browsers now never expire." : `Unused browsers are now forgotten after ${value} days.`);
    void list.reload();
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const { error } = await api.api.auth.devices({ id: editing.id }).patch({ name: editing.name });
    if (error) return onMessage(errorMessage(error), true);
    setEditing(undefined);
    void list.reload();
  };

  const remove = async (device: DeviceEntry) => {
    if (confirm !== device.id) return setConfirm(device.id);
    setConfirm("");
    const { error } = await api.api.auth.devices({ id: device.id }).delete();
    if (error) return onMessage(errorMessage(error), true);
    onMessage(`Removed “${device.name}”: it has to sign in again.`);
    void list.reload();
  };

  const removeOthers = async () => {
    if (confirm !== "others") return setConfirm("others");
    setConfirm("");
    const { data, error } = await api.api.auth.devices["remove-others"].post();
    if (error) return onMessage(errorMessage(error), true);
    onMessage(`Removed ${data.removed} other browser${data.removed === 1 ? "" : "s"}.`);
    void list.reload();
  };

  const devices = list.data?.devices ?? [];
  const others = devices.filter((device) => !device.current).length;

  return (
    <section className="flex flex-col gap-5">
      <Card title="Waiting for approval" icon={MonitorSmartphone} description="New browsers that asked to be let in.">
        <AccessRequests
          api={api}
          onMessage={onMessage}
          emptyText="No browser is waiting. On a new browser, open m7d and press “Ask for access”."
        />
      </Card>

      <Card title="Remember browsers" icon={Clock} description="A signed-in browser stays signed in as long as it keeps being used.">
        <form onSubmit={saveDays} className="flex flex-wrap items-end gap-3">
          <Field label="Forget a browser after this many days unused" hint="0 = never. Browsers signed in without “Remember” last at most 12 hours.">
            <input
              type="number"
              min={0}
              max={3650}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className={`${fieldClass} w-32`}
            />
          </Field>
          <Button type="submit" icon={Save} busy={savingDays}>
            Save
          </Button>
        </form>
      </Card>

      <Card
        title="Remembered browsers"
        icon={MonitorSmartphone}
        description="Removing a browser signs it out at once. The TV's own browser signs in by its IP and is not listed."
        padded={false}
        actions={
          others > 0 && (
            <Button variant={confirm === "others" ? "danger" : "secondary"} size="sm" icon={UserX} onClick={() => void removeOthers()}>
              {confirm === "others" ? `Remove ${others}? Click again` : "Remove all others"}
            </Button>
          )
        }
      >
        {devices.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={MonitorSmartphone} title="No remembered browsers">
              You are signed in with the access token (the TV, or a script).
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  {editing?.id === device.id ? (
                    <form onSubmit={rename} className="flex flex-wrap gap-2">
                      <label className="sr-only" htmlFor={`name-${device.id}`}>
                        Name
                      </label>
                      <input
                        id={`name-${device.id}`}
                        value={editing.name}
                        maxLength={60}
                        onChange={(event) => setEditing({ id: device.id, name: event.target.value })}
                        className={`${fieldClass} max-w-xs`}
                      />
                      <Button type="submit" size="sm" icon={Save}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {device.name}
                      {device.current && <Badge tone="info">This browser</Badge>}
                      {device.ephemeral && <Badge>Until closed</Badge>}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-600">
                    {describeUserAgent(device.userAgent)} · {VIA_LABEL[device.via]} · last used {formatDateTime(device.lastSeenAt)} from{" "}
                    {device.lastIp || "?"} · {device.expiresAt ? `forgotten ${formatDateTime(device.expiresAt)} if unused` : "never expires"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing({ id: device.id, name: device.name })}>
                    Rename
                  </Button>
                  <Button size="sm" variant={confirm === device.id ? "danger" : "secondary"} icon={Trash} onClick={() => void remove(device)}>
                    {confirm === device.id ? "Click again" : "Remove"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

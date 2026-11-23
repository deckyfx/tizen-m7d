import { CircleCheck, CircleX, Power } from "lucide-react";
import { useRef, useState } from "react";
import { errorMessage, type Api } from "../lib/api";
import { useLayout } from "../lib/layout";
import { isOnline, useTv } from "../lib/use-tv";
import { Badge, Button } from "./ui";

/** How long the "press again to confirm" state of the power button lasts. */
const CONFIRM_WINDOW_MS = 4000;

/** Compact TV status for the sidebar: name, model and IP. */
export function TvStatusCard() {
  const tv = useTv()?.data;
  const online = isOnline(tv);
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <span
          className={`size-2.5 shrink-0 rounded-full ${online ? "bg-emerald-600" : "bg-slate-400"}`}
          aria-hidden="true"
        />
        <p className="truncate text-sm font-semibold text-slate-900">
          {tv?.online ? tv.name : tv === undefined ? "Checking TV…" : "TV offline"}
        </p>
      </div>
      {tv?.online && (
        <p className="mt-1 truncate text-xs text-slate-600">
          {tv.modelName} · {tv.ip}
        </p>
      )}
    </div>
  );
}

/** Header pill: online/offline with an icon (never colour alone). */
export function TvStatusBadge() {
  const tv = useTv()?.data;
  if (tv?.online) {
    return (
      <Badge tone="success" icon={CircleCheck}>
        TV on · power {tv.powerState}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={CircleX}>
      {tv === undefined ? "Checking TV…" : "TV offline"}
    </Badge>
  );
}

/** Two-step "Power off (cold)": a full shutdown, so the next power-on is a cold boot. */
export function PowerButton({
  api,
  onMessage,
}: {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}) {
  const { isTv } = useLayout();
  const online = isOnline(useTv()?.data);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const press = async () => {
    if (!armed) {
      setArmed(true);
      disarmTimer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(disarmTimer.current);
    setArmed(false);
    setBusy(true);
    const { data, error } = await api.api.tv["power-off"].post({ confirm: true });
    setBusy(false);
    if (error) onMessage(errorMessage(error), true);
    else onMessage(data.message);
  };

  const label = armed
    ? `${isTv ? "Press OK" : "Tap"} again to power off`
    : isTv
      ? "Turn this screen off"
      : "Power off";

  return (
    <Button
      variant={armed ? "danger" : "secondary"}
      icon={Power}
      busy={busy}
      disabled={!online}
      onClick={() => void press()}
      title="Full shutdown: the next power-on is a cold boot"
    >
      {busy ? "Powering off…" : label}
    </Button>
  );
}

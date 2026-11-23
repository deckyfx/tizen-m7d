import {
  CircleDot,
  MonitorPlay,
  Package,
  Play,
  RefreshCw,
  RotateCcw,
  Skull,
  Square,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, type Api } from "../lib/api";
import { useLayout } from "../lib/layout";
import { Badge, Button, type ButtonVariant, CardGrid, EmptyState } from "./ui";

/** One app row from `GET /api/apps`. */
type AppRow = NonNullable<Awaited<ReturnType<Api["api"]["apps"]["get"]>>["data"]>[number];

/** Actions offered per app (mirrors the server's APP_ACTIONS). */
type Action = "launch" | "close" | "kill" | "restart";

/** Props for {@link AppList}. */
interface AppListProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Button per action; `whenRunning` null = always shown. */
const ACTIONS: {
  action: Action;
  label: string;
  icon: LucideIcon;
  variant: ButtonVariant;
  whenRunning: boolean | null;
}[] = [
  { action: "launch", label: "Launch", icon: Play, variant: "primary", whenRunning: false },
  { action: "close", label: "Close", icon: Square, variant: "secondary", whenRunning: true },
  { action: "kill", label: "Kill", icon: Skull, variant: "danger", whenRunning: true },
  { action: "restart", label: "Cold restart", icon: RotateCcw, variant: "warning", whenRunning: null },
];

/** Task manager: installed apps as full-width cards with live state and actions. */
export function AppList({ api, onMessage }: AppListProps) {
  const { isTv, selfTizenId } = useLayout();
  const [apps, setApps] = useState<AppRow[] | undefined>(undefined);
  const [busy, setBusy] = useState<{ appId: string; action: Action } | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      const { data, error } = await api.api.apps.get({ query: refresh ? { refresh: "1" } : {} });
      setLoading(false);
      if (error) onMessage(errorMessage(error), true);
      else setApps(data);
    },
    [api, onMessage],
  );

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(false), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const run = async (appId: string, action: Action) => {
    setBusy({ appId, action });
    const { data, error } = await api.api.apps({ appId })({ action }).post();
    setBusy(undefined);
    if (error) onMessage(errorMessage(error), true);
    else onMessage(`${data.appId}: ${data.message}`, !data.ok);
    await load(false);
  };

  const running = apps?.filter((app) => app.running).length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {apps ? `${apps.length} apps · ${running} running` : "Loading apps…"}
        </p>
        <Button icon={RefreshCw} busy={loading && apps === undefined} onClick={() => void load(true)}>
          Refresh
        </Button>
      </div>

      {apps?.length === 0 && <EmptyState icon={Package} title="No apps reported by the TV" />}

      <CardGrid min={isTv ? "20rem" : "19rem"}>
        {apps?.map((app) => {
          const isSelf = isTv && app.tizenId === selfTizenId;
          return (
            <li key={app.appId}>
              <article
                className={`flex h-full flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ${
                  app.running ? "ring-emerald-300" : "ring-slate-200"
                }`}
              >
                <header className="flex items-start gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                      app.running ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <Package size={20} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-slate-900">{app.title}</h3>
                    <p className="truncate font-mono text-xs text-slate-600">{app.appId}</p>
                  </div>
                </header>

                <div className="flex flex-wrap gap-1.5">
                  {app.running ? (
                    <Badge tone="success" icon={CircleDot}>
                      {app.visible ? "Foreground" : "Running"}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Stopped</Badge>
                  )}
                  {isSelf && (
                    <Badge tone="info" icon={MonitorPlay}>
                      This dashboard
                    </Badge>
                  )}
                  {app.type === "user" && <Badge tone="neutral">Sideloaded</Badge>}
                  <Badge tone="neutral">v{app.version}</Badge>
                </div>

                <footer className="mt-auto flex flex-wrap gap-2">
                  {ACTIONS.filter((item) => item.whenRunning === null || item.whenRunning === app.running).map(
                    (item) => (
                      <Button
                        key={item.action}
                        size="sm"
                        variant={item.variant}
                        icon={item.icon}
                        busy={busy?.appId === app.appId && busy.action === item.action}
                        disabled={busy !== undefined}
                        onClick={() => void run(app.appId, item.action)}
                        title={
                          isSelf && item.action !== "launch" ? "This closes the dashboard you are using" : undefined
                        }
                      >
                        {item.label}
                      </Button>
                    ),
                  )}
                </footer>
              </article>
            </li>
          );
        })}
      </CardGrid>
    </section>
  );
}

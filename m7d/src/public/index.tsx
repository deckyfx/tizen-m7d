import { LogOut, Stethoscope, Tv } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppList } from "./components/AppList";
import { CatalogView } from "./components/CatalogView";
import { InstalledView } from "./components/InstalledView";
import { JobsView } from "./components/JobsView";
import { NavBar } from "./components/NavBar";
import { RemoteView } from "./components/RemoteView";
import { SettingsView } from "./components/SettingsView";
import { Toast, type ToastMessage } from "./components/Toast";
import { AccessRequests } from "./components/AccessRequests";
import { DevicesView } from "./components/DevicesView";
import { SignInView } from "./components/SignInView";
import { ToolboxView } from "./components/ToolboxView";
import { TvBanner } from "./components/TvBanner";
import { PowerButton, TvStatusBadge, TvStatusCard } from "./components/TvPanel";
import { Button, ButtonLink, PageHeader } from "./components/ui";
import { UploadView } from "./components/UploadView";
import { YouTubeView } from "./components/YouTubeView";
import { createApi, errorMessage, loadToken, saveToken, type Api } from "./lib/api";
import { describeUserAgent } from "./lib/browser-name";
import { applyTvMode, fetchClientInfo, type ClientInfo } from "./lib/client";
import { registerFonts } from "./lib/fonts";
import { LayoutContext, type Layout } from "./lib/layout";
import { pageInfo, usePage, type PageId } from "./lib/route";
import { enableSpatialNavigation } from "./lib/spatial-nav";
import { usePoll } from "./lib/use-poll";
import { TvContext, type TvState } from "./lib/use-tv";

/** Brand block (logo tile, name, device). */
function Brand() {
  return (
    <a href="#/tasks" className="flex items-center gap-3 rounded-lg">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-700 text-white shadow-sm">
        <Tv size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-lg leading-tight font-bold text-slate-900">m7d</span>
        <span className="block truncate text-xs text-slate-600">Smart Monitor M7 control</span>
      </span>
    </a>
  );
}

/** How this page is signed in: the TV's handed-over token, or this browser's device cookie. */
type Session = { kind: "token"; token: string } | { kind: "cookie" };

/**
 * Asks the server whether this browser is signed in. A token stored by an older version of the
 * dashboard is traded once for a remembered-browser cookie, then deleted from the page.
 */
async function resumeSession(): Promise<Session | null> {
  const publicApi = createApi();
  const me = await publicApi.api.auth.me.get();
  if (me.data?.signedIn) return { kind: "cookie" };
  const oldToken = loadToken();
  if (!oldToken) return null;
  const traded = await publicApi.api.auth.token.post({
    token: oldToken,
    name: describeUserAgent(navigator.userAgent),
    remember: true,
  });
  saveToken("");
  return traded.error ? null : { kind: "cookie" };
}

/**
 * Root component: detects whether it runs on the TV (10-foot layout, automatic sign-in),
 * then shows the sign-in screen or the full-width shell (sidebar, header, page).
 */
function App() {
  const page = usePage();
  const [client, setClient] = useState<ClientInfo | undefined>(undefined);
  // undefined = still checking, null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [toast, setToast] = useState<ToastMessage | undefined>(undefined);
  const api = useMemo(() => (session ? createApi(session.kind === "token" ? session.token : "") : undefined), [session]);

  useEffect(() => {
    void fetchClientInfo().then(async (info) => {
      setClient(info);
      applyTvMode(info.isTv);
      // The trusted TV gets the token from the server: no typing with a remote.
      if (info.token) {
        saveToken(info.token);
        setSession({ kind: "token", token: info.token });
        return;
      }
      setSession(await resumeSession());
    });
  }, []);

  useEffect(() => (client?.isTv ? enableSpatialNavigation() : undefined), [client?.isTv]);

  const onMessage = useCallback((text: string, isError = false) => {
    // A 401 means this browser is no longer signed in (removed, expired): show the sign-in again.
    if (isError && text.startsWith("401")) {
      saveToken("");
      setSession(null);
    }
    setToast({ text, isError, id: Date.now() });
  }, []);

  const signOut = async () => {
    await createApi().api.auth.logout.post();
    saveToken("");
    setSession(null);
  };

  const layout: Layout = useMemo(
    () => ({
      isTv: client?.isTv ?? false,
      selfTizenId: client?.selfTizenId ?? "org.tizen.browser",
    }),
    [client],
  );

  // Wait for the TV check and the session check, so nothing flashes the sign-in screen.
  if (!client || session === undefined) return null;

  if (!api) return <SignInView onSignedIn={() => setSession({ kind: "cookie" })} />;

  return (
    <LayoutContext.Provider value={layout}>
      <Shell api={api} page={page} client={client} onMessage={onMessage} onSignOut={() => void signOut()} />
      <Toast toast={toast} onClose={() => setToast(undefined)} />
    </LayoutContext.Provider>
  );
}

/** Props for {@link Shell}. */
interface ShellProps {
  api: Api;
  page: PageId;
  client: ClientInfo;
  onMessage: (text: string, isError?: boolean) => void;
  onSignOut: () => void;
}

/** Full-width layout: sidebar on laptops and the TV, tab row on phones. */
function Shell({ api, page, client, onMessage, onSignOut }: ShellProps) {
  const info = pageInfo(page);
  const tv = usePoll<TvState>(async () => {
    const { data, error } = await api.api.tv.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 5000);

  // TV mode always uses the sidebar (1536 CSS px wide); phones get the tab row.
  const sidebar = client.isTv ? "flex" : "hidden lg:flex";
  const grid = client.isTv ? "grid-cols-[16rem_1fr]" : "lg:grid-cols-[16rem_1fr]";

  return (
    <TvContext.Provider value={tv}>
      <div className={`grid min-h-dvh ${grid}`}>
        <aside
          className={`${sidebar} sticky top-0 h-dvh flex-col gap-6 overflow-y-auto border-r border-slate-200 bg-white p-4`}
        >
          <Brand />
          <NavBar page={page} orientation="vertical" />
          <div className="mt-auto flex flex-col gap-2">
            <TvStatusCard />
            {!client.isTv && (
              <Button variant="ghost" size="sm" icon={LogOut} onClick={onSignOut} className="justify-start">
                Sign out
              </Button>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm">
            <div className={`${client.isTv ? "hidden" : "flex lg:hidden"} items-center justify-between gap-3 px-4 pt-3 pb-2`}>
              <Brand />
              <TvStatusBadge />
            </div>
            <div className={client.isTv ? "hidden" : "lg:hidden"}>
              <NavBar page={page} orientation="horizontal" />
            </div>
            <div className={`${client.isTv ? "flex" : "hidden lg:flex"} items-center justify-end gap-3 px-6 py-3`}>
              <TvStatusBadge />
              <span className="flex-1" />
              <ButtonLink href="/api/diag" icon={Stethoscope} size="md">
                Diagnostics
              </ButtonLink>
              <PowerButton api={api} onMessage={onMessage} />
            </div>
          </header>

          <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            {client.isTv && <TvBanner ip={client.ip} />}
            {page !== "devices" && <AccessRequests api={api} onMessage={onMessage} />}
            <PageHeader
              title={info.label}
              description={info.description}
              actions={
                !client.isTv && (
                  <span className="flex gap-2 lg:hidden">
                    <PowerButton api={api} onMessage={onMessage} />
                  </span>
                )
              }
            />
            <PageContent page={page} api={api} onMessage={onMessage} />
          </main>
        </div>
      </div>
    </TvContext.Provider>
  );
}

/** Props for {@link PageContent}. */
interface PageContentProps {
  page: PageId;
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Renders the current page. */
function PageContent({ page, api, onMessage }: PageContentProps) {
  switch (page) {
    case "tasks":
      return <AppList api={api} onMessage={onMessage} />;
    case "youtube":
      return <YouTubeView api={api} onMessage={onMessage} />;
    case "catalog":
      return <CatalogView api={api} onMessage={onMessage} />;
    case "installed":
      return <InstalledView api={api} onMessage={onMessage} />;
    case "upload":
      return <UploadView api={api} onMessage={onMessage} />;
    case "toolbox":
      return <ToolboxView api={api} onMessage={onMessage} />;
    case "remote":
      return <RemoteView api={api} onMessage={onMessage} />;
    case "jobs":
      return <JobsView api={api} onMessage={onMessage} />;
    case "devices":
      return <DevicesView api={api} onMessage={onMessage} />;
    case "settings":
      return <SettingsView api={api} onMessage={onMessage} />;
  }
}

registerFonts();
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

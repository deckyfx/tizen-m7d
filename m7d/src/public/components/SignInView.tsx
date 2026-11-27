import { KeyRound, MonitorSmartphone, RefreshCw, Tv } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createApi, errorMessage } from "../lib/api";
import { describeUserAgent } from "../lib/browser-name";
import { Button, Checkbox, Field, fieldClass, Notice } from "./ui";

/** Props for {@link SignInView}. */
interface SignInViewProps {
  /** Called once this browser holds a valid device cookie. */
  onSignedIn: () => void;
}

/** An open access request, as this browser sees it. */
interface Ticket {
  requestId: string;
  code: string;
  expiresAt: string;
}

/** How often the waiting browser asks whether it was approved. */
const POLL_MS = 2000;

/**
 * Sign-in for PCs and phones: ask a signed-in device to approve this browser (shows a code to
 * match), or type the access token once. Either way the browser is remembered by an HttpOnly
 * cookie; the token is never stored in the page.
 */
export function SignInView({ onSignedIn }: SignInViewProps) {
  const api = useRef(createApi()).current;
  const [name, setName] = useState(() => describeUserAgent(navigator.userAgent));
  const [remember, setRemember] = useState(true);
  const [ticket, setTicket] = useState<Ticket | undefined>(undefined);
  const [message, setMessage] = useState<{ text: string; tone: "danger" | "warning" } | undefined>(undefined);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  // While a request is open, ask every 2 s whether it was decided.
  useEffect(() => {
    if (!ticket) return undefined;
    const timer = setInterval(async () => {
      const { data, error } = await api.api.auth.requests({ requestId: ticket.requestId }).get();
      if (error) return;
      if (data.status === "approved") {
        clearInterval(timer);
        onSignedIn();
      } else if (data.status === "denied" || data.status === "expired") {
        clearInterval(timer);
        setTicket(undefined);
        setMessage({
          text: data.status === "denied" ? "The request was denied." : "The request expired. Ask again.",
          tone: data.status === "denied" ? "danger" : "warning",
        });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, ticket, onSignedIn]);

  const ask = async () => {
    setMessage(undefined);
    setBusy(true);
    const { data, error } = await api.api.auth.requests.post({ name: name.trim() || "Browser", remember });
    setBusy(false);
    if (error) setMessage({ text: errorMessage(error), tone: "danger" });
    else setTicket(data);
  };

  const useToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setMessage(undefined);
    setBusy(true);
    const { error } = await api.api.auth.token.post({ token: token.trim(), name: name.trim() || "Browser", remember });
    setBusy(false);
    if (error) setMessage({ text: errorMessage(error), tone: "danger" });
    else onSignedIn();
  };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-sky-700 text-white">
            <Tv size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold">m7d</h1>
            <p className="text-sm text-slate-600">Sign in this browser</p>
          </div>
        </div>

        {!ticket && (
          <>
            <Field label="Name for this browser" hint="Shown in the list of remembered browsers.">
              <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} className={fieldClass} />
            </Field>
            <Checkbox checked={remember} onChange={setRemember}>
              Remember this browser (otherwise until it is closed, at most 12 hours)
            </Checkbox>
          </>
        )}

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MonitorSmartphone size={16} aria-hidden="true" /> Approve from a signed-in device
          </h2>
          {ticket ? (
            <div className="flex flex-col items-center gap-3 rounded-xl bg-sky-50 p-5 text-center ring-1 ring-sky-200 ring-inset">
              <p className="text-sm text-sky-900">On a device that is already signed in (or the TV), approve this code:</p>
              <p className="font-mono text-4xl font-bold tracking-widest text-sky-900" aria-live="polite">
                {ticket.code}
              </p>
              <p className="text-xs text-sky-800">
                Waiting… the request expires at {new Date(ticket.expiresAt).toLocaleTimeString()}.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setTicket(undefined)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="lg" icon={RefreshCw} busy={busy} onClick={() => void ask()}>
              Ask for access
            </Button>
          )}
        </section>

        {!ticket && (
          <form onSubmit={useToken} className="flex flex-col gap-3 border-t border-slate-200 pt-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <KeyRound size={16} aria-hidden="true" /> Or use the access token
            </h2>
            <Field label="Access token" hint="M7D_TOKEN of the m7d server. It is not stored in this browser.">
              <input
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className={fieldClass}
              />
            </Field>
            <Button type="submit" busy={busy} icon={KeyRound}>
              Sign in with the token
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

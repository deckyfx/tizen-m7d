import { Check, MonitorSmartphone, X } from "lucide-react";
import { useState } from "react";
import { errorMessage, type Api } from "../lib/api";
import { describeUserAgent } from "../lib/browser-name";
import { formatDateTime } from "../lib/format";
import { usePoll } from "../lib/use-poll";
import { Button, Notice } from "./ui";

/** Props for {@link AccessRequests}. */
interface AccessRequestsProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
  /** Text when nothing is waiting (omit to render nothing, e.g. in the page banner). */
  emptyText?: string;
}

/** `GET /api/auth/pending`. */
type Pending = NonNullable<Awaited<ReturnType<Api["api"]["auth"]["pending"]["get"]>>["data"]>;

/**
 * Browsers waiting to be let in: compare the code with the one on the new browser, then Approve
 * or Deny. Shown on every page (so the TV or a phone sees requests) and on the Devices page.
 */
export function AccessRequests({ api, onMessage, emptyText }: AccessRequestsProps) {
  const pending = usePoll<Pending>(async () => {
    const { data, error } = await api.api.auth.pending.get();
    return error ? { error: errorMessage(error) } : { data };
  }, 4000);
  const [deciding, setDeciding] = useState("");

  const decide = async (code: string, decision: "approve" | "deny") => {
    setDeciding(code);
    const { error } = await api.api.auth.pending({ code })({ decision }).post();
    setDeciding("");
    if (error) onMessage(errorMessage(error), true);
    else onMessage(decision === "approve" ? `Approved ${code}: that browser is now signed in.` : `Denied ${code}.`);
    void pending.reload();
  };

  const requests = pending.data ?? [];
  if (requests.length === 0) return emptyText ? <p className="text-sm text-slate-600">{emptyText}</p> : null;

  return (
    <div className="flex flex-col gap-3">
      {requests.map((request) => (
        <Notice
          key={request.code}
          tone="warning"
          icon={MonitorSmartphone}
          title={
            <>
              “{request.name}” asks for access, code <span className="font-mono text-base">{request.code}</span>
            </>
          }
          actions={
            <>
              <Button
                variant="success"
                icon={Check}
                busy={deciding === request.code}
                onClick={() => void decide(request.code, "approve")}
              >
                Approve
              </Button>
              <Button variant="danger" icon={X} disabled={deciding === request.code} onClick={() => void decide(request.code, "deny")}>
                Deny
              </Button>
            </>
          }
        >
          {describeUserAgent(request.userAgent)} from {request.ip || "unknown address"}, asked at {formatDateTime(request.createdAt)}.
          Approve only if the same code shows on that browser.
        </Notice>
      ))}
    </div>
  );
}

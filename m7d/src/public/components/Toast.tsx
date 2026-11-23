import { CircleCheck, CircleX, X } from "lucide-react";
import { useEffect } from "react";

/** A status message shown at the bottom of the screen. */
export interface ToastMessage {
  text: string;
  isError: boolean;
  /** Changes for every message so identical texts still re-show. */
  id: number;
}

/** How long a success message stays (errors stay until dismissed). */
const SUCCESS_MS = 6000;

/** Bottom-right status message with an icon; successes fade out on their own. */
export function Toast({ toast, onClose }: { toast: ToastMessage | undefined; onClose: () => void }) {
  useEffect(() => {
    if (!toast || toast.isError) return undefined;
    const timer = setTimeout(onClose, SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  const Icon = toast.isError ? CircleX : CircleCheck;
  return (
    <div
      role={toast.isError ? "alert" : "status"}
      className={`fixed right-4 bottom-4 left-4 z-50 ml-auto flex max-w-lg items-start gap-3 rounded-xl p-4 text-sm shadow-lg ring-1 ${
        toast.isError ? "bg-rose-50 text-rose-900 ring-rose-200" : "bg-white text-slate-900 ring-slate-200"
      }`}
    >
      <Icon size={20} className={`shrink-0 ${toast.isError ? "text-rose-700" : "text-emerald-700"}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{toast.text}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="-m-1 rounded-md p-1 text-slate-600 hover:bg-slate-200"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

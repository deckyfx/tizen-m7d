import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Shared UI primitives (daylight theme). Colors meet WCAG contrast on white:
 * filled buttons use 700 shades with white text (≥4.5:1); states always pair color
 * with an icon or text.
 */

/** Visual weight of a button. */
export type ButtonVariant = "primary" | "secondary" | "danger" | "warning" | "success" | "ghost";

/** Button height and padding. */
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-sky-700 text-white shadow-sm hover:bg-sky-800 hover:shadow",
  secondary:
    "bg-white text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400",
  danger: "bg-rose-700 text-white shadow-sm hover:bg-rose-800 hover:shadow",
  warning: "bg-amber-700 text-white shadow-sm hover:bg-amber-800 hover:shadow",
  success: "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 hover:shadow",
  ghost: "text-slate-700 hover:bg-slate-200",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-sm",
  md: "h-10 gap-2 rounded-lg px-3.5 text-sm",
  lg: "h-12 gap-2 rounded-xl px-5 text-base",
};

/** Classes shared by {@link Button} and {@link ButtonLink}. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return `inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap disabled:opacity-50 disabled:shadow-none ${VARIANT[variant]} ${SIZE[size]}`;
}

/** Props for {@link Button}. */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Shows a spinner instead of the icon and disables the button. */
  busy?: boolean;
}

/** Native button with an optional leading icon. */
export function Button({
  variant,
  size,
  icon: Icon,
  busy = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconSize = size === "lg" ? 20 : 16;
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`${buttonClass(variant, size)} ${className}`}
      {...rest}
    >
      {busy ? (
        <LoaderCircle size={iconSize} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

/** Props for {@link ButtonLink}. */
interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
}

/** A link styled as a button (navigation, not actions). */
export function ButtonLink({ variant, size, icon: Icon, className = "", children, ...rest }: ButtonLinkProps) {
  return (
    <a className={`${buttonClass(variant, size)} ${className}`} {...rest}>
      {Icon && <Icon size={size === "lg" ? 20 : 16} aria-hidden="true" />}
      {children}
    </a>
  );
}

/** Semantic tone of a badge or notice. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-rose-50 text-rose-800 ring-rose-200",
};

/** Small status label with an optional icon (never color alone). */
export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}
    >
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Highlighted message box (warnings, results, guidance). */
export function Notice({
  tone = "info",
  icon: Icon,
  title,
  children,
  actions,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl p-4 ring-1 ring-inset ${TONE[tone]}`}>
      {Icon && <Icon size={20} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** White content panel with an optional titled header and header actions. */
export function Card({
  title,
  icon: Icon,
  description,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** False when the body manages its own padding (lists). */
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700">
                <Icon size={18} aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-base font-semibold text-slate-900">{title}</h3>}
              {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className={padded ? "p-5" : ""}>{children}</div>}
    </section>
  );
}

/** Page title row: heading, one-line description and page-level actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Centered placeholder for empty or not-yet-loaded content. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <Icon size={32} className="text-slate-400" aria-hidden="true" />
      <p className="font-semibold text-slate-800">{title}</p>
      {children && <div className="max-w-md text-sm text-slate-600">{children}</div>}
    </div>
  );
}

/** Text input / select styling (white field, visible 3:1 border, sky focus ring). */
export const fieldClass =
  "h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 hover:border-slate-500 focus:border-sky-600";

/** Labelled form field. */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
    </label>
  );
}

/** Checkbox with its label (the whole row is clickable). */
export function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-slate-800">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-sky-700"
      />
      <span>{children}</span>
    </label>
  );
}

/** Responsive grid that fills the full width with cards of at least `min` width. */
export function CardGrid({ children, min = "18rem" }: { children: ReactNode; min?: string }) {
  return (
    <ul className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))` }}>
      {children}
    </ul>
  );
}

/** One label/value row of a `<dl>` information table (use inside `<dl className="divide-y …">`). */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

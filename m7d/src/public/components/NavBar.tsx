import {
  Activity,
  Gamepad2,
  LayoutGrid,
  ListChecks,
  MonitorSmartphone,
  MonitorPlay,
  type LucideIcon,
  Settings,
  Tv,
  Upload,
  Wrench,
} from "lucide-react";
import { PAGES, type PageId } from "../lib/route";

/** Icon per page. */
export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  tasks: Activity,
  youtube: MonitorPlay,
  catalog: LayoutGrid,
  installed: Tv,
  upload: Upload,
  toolbox: Wrench,
  remote: Gamepad2,
  jobs: ListChecks,
  devices: MonitorSmartphone,
  settings: Settings,
};

/** Props for {@link NavBar}. */
interface NavBarProps {
  page: PageId;
  /** `vertical` for the sidebar, `horizontal` for the phone tab row. */
  orientation: "vertical" | "horizontal";
}

/**
 * Page navigation as plain hash links: they work with arrow keys + OK on the TV and keep
 * the browser's back button (and the remote's Back key) meaningful.
 */
export function NavBar({ page, orientation }: NavBarProps) {
  const vertical = orientation === "vertical";
  return (
    <nav
      aria-label="Pages"
      className={
        vertical
          ? "flex flex-col gap-1"
          : "flex snap-x gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
      }
    >
      {PAGES.map((item) => {
        const Icon = PAGE_ICONS[item.id];
        const active = item.id === page;
        return (
          <a
            key={item.id}
            href={`#/${item.id}`}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 snap-start items-center gap-3 rounded-lg font-medium ${
              vertical ? "px-3 py-2.5 text-sm" : "px-3 py-2 text-sm"
            } ${
              active
                ? "bg-sky-700 text-white shadow-sm"
                : vertical
                  ? "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            }`}
          >
            <Icon size={18} aria-hidden="true" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

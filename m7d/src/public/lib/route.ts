import { useEffect, useState } from "react";

/** Pages of the dashboard (URL hash `#/<page>`), with the header text shown for each. */
export const PAGES = [
  { id: "tasks", label: "Running", description: "What runs on the TV right now: launch, close, kill or cold-restart apps." },
  { id: "youtube", label: "YouTube", description: "Ad-free YouTube through the homelab proxy: the YouTube m7d app, its setup and live traffic." },
  { id: "catalog", label: "Catalog", description: "The Apps2Samsung community catalog: browse, configure and install apps." },
  { id: "installed", label: "Installed", description: "Apps on the TV compared with the catalog: updates, uninstall, backup and restore." },
  { id: "upload", label: "Install file", description: "Install a local .wgt or .tpk package, signed for this TV." },
  { id: "toolbox", label: "Toolbox", description: "TV information, Developer Mode, install leftovers and package signing." },
  { id: "remote", label: "Remote", description: "A virtual remote control: navigation, volume, media keys and typing." },
  { id: "jobs", label: "Jobs", description: "Installs, updates and clean-ups with their live logs." },
  { id: "settings", label: "Settings", description: "TV connection, signing certificates, your app sources and Apps2Samsung logs." },
] as const;

/** One of the page ids. */
export type PageId = (typeof PAGES)[number]["id"];

/** A page entry. */
export type PageInfo = (typeof PAGES)[number];

/** Reads the page from `location.hash`, defaulting to the task manager. */
function currentPage(): PageId {
  const id = window.location.hash.replace(/^#\/?/, "");
  return PAGES.find((page) => page.id === id)?.id ?? "tasks";
}

/** Current page; follows hash changes (links, back/forward, remote Back key). */
export function usePage(): PageId {
  const [page, setPage] = useState<PageId>(currentPage);
  useEffect(() => {
    const onChange = () => setPage(currentPage());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return page;
}

/** Metadata of a page. */
export function pageInfo(id: PageId): PageInfo {
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

/** Navigates to `page`. */
export function goTo(page: PageId): void {
  window.location.hash = `/${page}`;
}

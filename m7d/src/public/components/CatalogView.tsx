import { Download, LayoutGrid, Package, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogApp } from "../../a2s/types";
import { errorMessage, type Api } from "../lib/api";
import { formatCount } from "../lib/format";
import { useLayout } from "../lib/layout";
import { runsOnTv } from "../lib/tizen";
import { usePoll } from "../lib/use-poll";
import { AppDetail } from "./AppDetail";
import { Badge, Button, CardGrid, Checkbox, EmptyState, fieldClass, Notice } from "./ui";

/** Props for {@link CatalogView}. */
interface CatalogViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Category filter value meaning "every category". */
const ALL = "all";

/** Community catalog: search, category filter, popularity order, and app detail/install. */
export function CatalogView({ api, onMessage }: CatalogViewProps) {
  const { isTv } = useLayout();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [showClosed, setShowClosed] = useState(true);
  const [selected, setSelected] = useState<CatalogApp | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const catalog = usePoll<CatalogApp[]>(async () => {
    const { data, error } = await api.api.a2s.catalog.get({ query: {} });
    return error ? { error: errorMessage(error) } : { data };
  }, 0);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of catalog.data ?? []) counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog.data]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog.data ?? [])
      .filter((app) => category === ALL || app.category === category)
      .filter((app) => showClosed || !app.closedSource)
      .filter((app) => {
        const text = `${app.name} ${app.description} ${app.author}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  }, [catalog.data, category, query, showClosed]);

  const refresh = async () => {
    setRefreshing(true);
    const { error } = await api.api.a2s.catalog.get({ query: { refresh: "1" } });
    setRefreshing(false);
    if (error) onMessage(errorMessage(error), true);
    else await catalog.reload();
  };

  if (selected) {
    return (
      <AppDetail
        api={api}
        app={selected}
        onClose={() => setSelected(undefined)}
        onMessage={onMessage}
        onSearch={(text) => {
          setQuery(text);
          setCategory(ALL);
          setSelected(undefined);
        }}
      />
    );
  }

  const chip = (id: string, label: string, count: number | undefined) => (
    <button
      key={id}
      type="button"
      aria-pressed={category === id}
      onClick={() => setCategory(id)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium capitalize ${
        category === id
          ? "bg-sky-700 text-white shadow-sm"
          : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`text-xs ${category === id ? "text-sky-100" : "text-slate-500"}`}>{count}</span>
      )}
    </button>
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${catalog.data?.length ?? ""} apps by name, description or author`}
            aria-label="Search the catalog"
            className={`${fieldClass} h-11 pl-10`}
          />
        </div>
        <Checkbox checked={showClosed} onChange={setShowClosed}>
          Show closed-source apps
        </Checkbox>
        <Button icon={RefreshCw} busy={refreshing} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {chip(ALL, "All", catalog.data?.length)}
        {categories.map(([name, count]) => chip(name, name, count))}
      </div>

      {catalog.error && <Notice tone="danger">{catalog.error}</Notice>}
      {catalog.loading && !catalog.data && <EmptyState icon={LayoutGrid} title="Loading the catalog…" />}
      {catalog.data && visible.length === 0 && (
        <EmptyState icon={Search} title="No app matches">
          Try another word or category.
        </EmptyState>
      )}

      <CardGrid min={isTv ? "19rem" : "17rem"}>
        {visible.map((app) => {
          const file = app.files.find((candidate) => candidate.default) ?? app.files[0];
          const compatible = app.files.some((candidate) => runsOnTv(candidate.tizen));
          return (
            <li key={`${app.from}:${app.name}`}>
              <button
                type="button"
                onClick={() => setSelected(app)}
                className="flex h-full w-full flex-col gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:ring-sky-300"
              >
                <span className="flex w-full items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-50 font-display text-lg font-bold text-sky-800">
                    {app.name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || <Package size={20} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{app.name}</span>
                    <span className="block truncate text-xs text-slate-600">
                      {app.author} · v{file?.version ?? "?"}
                    </span>
                  </span>
                </span>
                <span className="line-clamp-3 text-sm text-slate-700">{app.description}</span>
                <span className="mt-auto flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{app.category}</Badge>
                  {app.downloads !== undefined && (
                    <Badge tone="neutral" icon={Download}>
                      {formatCount(app.downloads)}
                    </Badge>
                  )}
                  {app.hasVariants && <Badge tone="info">{app.files.length} variants</Badge>}
                  {app.requiresPartner && (
                    <Badge tone="warning" icon={ShieldCheck}>
                      Partner
                    </Badge>
                  )}
                  {!compatible && <Badge tone="danger">Needs newer Tizen</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </CardGrid>
    </section>
  );
}

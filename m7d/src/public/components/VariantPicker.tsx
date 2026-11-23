import { CircleCheck, Search, TriangleExclamationPoint, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { CatalogFile } from "../../a2s/types";
import { formatBytes } from "../lib/format";
import { Badge, Button, fieldClass } from "./ui";

/** Props for {@link VariantPicker}. */
interface VariantPickerProps {
  files: CatalogFile[];
  /** Selected file name. */
  value: string;
  onChange: (file: string) => void;
  /** True when the TV can run a file with this minimum Tizen version. */
  runsOnTv: (tizen: string) => boolean;
}

/** Search and tag filters appear from this many variants on. */
const FILTER_FROM = 7;

/** Most tag chips shown. */
const MAX_TAGS = 16;

/** File name without its package extension. */
function stem(file: CatalogFile): string {
  return file.variant ?? file.file.replace(/\.(wgt|tpk)$/i, "");
}

/** Longest prefix all names share, cut back to a separator ("Jellyfin-"), so names stay distinct. */
function commonPrefix(names: string[]): string {
  if (names.length < 2) return "";
  let prefix = names[0] ?? "";
  for (const name of names) while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf("-"), prefix.lastIndexOf("_"), prefix.lastIndexOf(" "));
  return cut >= 0 ? prefix.slice(0, cut + 1) : "";
}

/** Words of a variant name ("10.11.z-secondary-TrailerFix" → 10.11.z, secondary, TrailerFix). */
function tokens(name: string): string[] {
  return name.split(/[-_\s]+/).filter(Boolean);
}

/** One variant with its display name and searchable text. */
interface Entry {
  file: CatalogFile;
  name: string;
  words: string[];
  haystack: string;
}

/**
 * Variant chooser for apps with many packages (Jellyfin offers 40): a searchable, tag-filterable
 * radio list. Native radios keep keyboard and screen-reader behaviour; the selected row is marked
 * by background, icon and bold text. Tags (words shared by some variants) let the TV remote filter
 * without typing.
 */
export function VariantPicker({ files, value, onChange, runsOnTv }: VariantPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const entries = useMemo<Entry[]>(() => {
    const prefix = commonPrefix(files.map(stem));
    // The default variant first; the rest in catalog order.
    const ordered = [...files].sort((a, b) => Number(b.default) - Number(a.default));
    return ordered.map((file) => {
      const name = stem(file).slice(prefix.length) || stem(file);
      return {
        file,
        name,
        words: tokens(name).map((word) => word.toLowerCase()),
        haystack: `${stem(file)} ${file.file} v${file.version} tizen ${file.tizen}`.toLowerCase(),
      };
    });
  }, [files]);

  /** Words shared by several (not all) variants, most common first. */
  const tags = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const entry of entries) {
      for (const word of new Set(tokens(entry.name))) {
        const key = word.toLowerCase();
        const current = counts.get(key) ?? { label: word, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
    }
    return [...counts.entries()]
      .filter(([, { count }]) => count >= 2 && count < entries.length)
      .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
      .slice(0, MAX_TAGS)
      .map(([key, { label, count }]) => ({ key, label, count }));
  }, [entries]);

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = entries.filter(
    (entry) =>
      terms.every((term) => entry.haystack.includes(term)) && activeTags.every((tag) => entry.words.includes(tag)),
  );
  const selected = entries.find((entry) => entry.file.file === value);
  const selectedHidden = selected !== undefined && !visible.includes(selected);
  const filtering = terms.length > 0 || activeTags.length > 0;
  const showFilters = entries.length >= FILTER_FROM;

  const toggleTag = (key: string) =>
    setActiveTags((current) => (current.includes(key) ? current.filter((tag) => tag !== key) : [...current, key]));
  const clear = () => {
    setQuery("");
    setActiveTags([]);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1.5 text-sm font-medium text-slate-800">
        Variant <span className="font-normal text-slate-600">({entries.length} available)</span>
      </legend>

      {showFilters && (
        <>
          <div className="relative">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
            <label htmlFor={`${id}-search`} className="sr-only">
              Search variants
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              placeholder="Search variants, e.g. 12.z trailer"
              onChange={(event) => setQuery(event.target.value)}
              // Enter must not submit the surrounding install form.
              onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
              className={`${fieldClass} pl-9`}
            />
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tag">
              {tags.map((tag) => {
                const on = activeTags.includes(tag.key);
                return (
                  <button
                    key={tag.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(tag.key)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                      on ? "bg-sky-700 text-white ring-sky-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {on && <CircleCheck size={12} aria-hidden="true" />}
                    {tag.label}
                    <span className={on ? "text-sky-100" : "text-slate-500"}>{tag.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <p role="status">
              {filtering ? `Showing ${visible.length} of ${entries.length}` : `${entries.length} variants`}
            </p>
            {filtering && (
              <Button type="button" variant="ghost" size="sm" icon={X} onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
        </>
      )}

      {showFilters && selected && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-200 ring-inset">
          <CircleCheck size={14} aria-hidden="true" className="shrink-0" />
          <span>
            Selected: <strong className="break-all">{selected.name}</strong>
            {selected.file.default && " (default)"}
            {selectedHidden && " · hidden by the filter"}
          </span>
        </p>
      )}

      <div className="max-h-96 overflow-y-auto rounded-xl ring-1 ring-slate-200">
        {visible.length === 0 && <p className="p-4 text-sm text-slate-600">No variant matches. Clear the filters.</p>}
        <ul className="divide-y divide-slate-100">
          {visible.map((entry) => {
            const checked = entry.file.file === value;
            const compatible = runsOnTv(entry.file.tizen);
            return (
              <li key={entry.file.file}>
                <label
                  className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors ${
                    checked ? "bg-sky-50 ring-2 ring-sky-600 ring-inset" : "hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-variant`}
                    value={entry.file.file}
                    checked={checked}
                    onChange={() => onChange(entry.file.file)}
                    className="mt-1 size-4 shrink-0 accent-sky-700"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words text-sm text-slate-900 ${checked ? "font-bold" : "font-medium"}`}>
                      {entry.name}
                      <span className="sr-only">.</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <span>
                        v{entry.file.version} · {formatBytes(entry.file.size)} · Tizen {entry.file.tizen}+
                      </span>
                      {entry.file.default && <Badge tone="info">Default</Badge>}
                      {!compatible && (
                        <Badge tone="danger" icon={TriangleExclamationPoint}>
                          Too new for this TV
                        </Badge>
                      )}
                    </span>
                  </span>
                  {checked && <CircleCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sky-700" />}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </fieldset>
  );
}

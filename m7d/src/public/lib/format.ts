/** Human-readable byte size (1.4 MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Compact count (106068 → 106k). */
export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

/** Local time of an ISO timestamp (10:42:07). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

/** Time only for today, otherwise date and time (23 Nov 2026, 13:30); for things that may be days old. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString();
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

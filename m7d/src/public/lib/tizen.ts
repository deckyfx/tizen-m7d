/** Tizen version of the one TV this dashboard manages (verified: platform_version 6.5). */
export const TV_TIZEN_VERSION = "6.5";

/** Compares dotted versions numerically: <0 when a < b, 0 when equal, >0 when a > b. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when a package needing Tizen `minimum` runs on this TV. */
export function runsOnTv(minimum: string): boolean {
  return compareVersions(minimum, TV_TIZEN_VERSION) <= 0;
}

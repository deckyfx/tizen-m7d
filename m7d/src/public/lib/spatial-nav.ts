/**
 * Arrow-key focus navigation for the TV remote (D-pad): moves focus to the nearest
 * focusable element in the pressed direction; OK/Enter then clicks it natively.
 *
 * Follows Modern Web Guidance `spatial-navigation`: candidates come from live geometry on every
 * keypress, the direction test is edge-based, aligned candidates win before a weighted fallback,
 * and when nothing lies in that direction the event is left alone so the page scrolls natively.
 */

/** Direction of an arrow key. */
type Direction = "up" | "down" | "left" | "right";

/** DOM `key` values of the arrow keys (the TV browser reports the same names). */
const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Elements the remote can land on. */
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']";

/** Targets that use arrow keys themselves (caret, options, sliders). */
const CONSUMES_ARROWS = ":read-write, select, input[type='range'], [role='slider']";

/** Sub-pixel tolerance for the edge test. */
const TOLERANCE = 1;

/** Weight of the perpendicular offset in the fallback score (favours aligned items). */
const PERPENDICULAR_WEIGHT = 2;

/** Distance from `from` to `to` along the pressed axis, or undefined when `to` is not that way. */
function gapInDirection(from: DOMRect, to: DOMRect, direction: Direction): number | undefined {
  switch (direction) {
    case "right":
      return to.left >= from.right - TOLERANCE ? to.left - from.right : undefined;
    case "left":
      return to.right <= from.left + TOLERANCE ? from.left - to.right : undefined;
    case "down":
      return to.top >= from.bottom - TOLERANCE ? to.top - from.bottom : undefined;
    case "up":
      return to.bottom <= from.top + TOLERANCE ? from.top - to.bottom : undefined;
  }
}

/** Whether the two boxes overlap on the axis perpendicular to `direction`. */
function overlapsPerpendicular(from: DOMRect, to: DOMRect, direction: Direction): boolean {
  return direction === "left" || direction === "right"
    ? to.top < from.bottom && to.bottom > from.top
    : to.left < from.right && to.right > from.left;
}

/** Offset between the boxes' centres on the perpendicular axis. */
function perpendicularOffset(from: DOMRect, to: DOMRect, direction: Direction): number {
  return direction === "left" || direction === "right"
    ? Math.abs(to.top + to.height / 2 - (from.top + from.height / 2))
    : Math.abs(to.left + to.width / 2 - (from.left + from.width / 2));
}

/** True when the element is rendered (hidden ones report a 0x0 rect at the origin). */
function isVisible(element: HTMLElement): boolean {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : element.getClientRects().length > 0;
}

/** Picks the best candidate from `current` in `direction`, or undefined when there is none. */
function findCandidate(current: HTMLElement, direction: Direction): HTMLElement | undefined {
  const from = current.getBoundingClientRect();
  let aligned: { element: HTMLElement; gap: number; offset: number } | undefined;
  let fallback: { element: HTMLElement; score: number } | undefined;

  for (const element of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element === current || !isVisible(element)) continue;
    const to = element.getBoundingClientRect();
    const gap = gapInDirection(from, to, direction);
    if (gap === undefined) continue;
    const offset = perpendicularOffset(from, to, direction);
    if (overlapsPerpendicular(from, to, direction)) {
      if (!aligned || gap < aligned.gap || (gap === aligned.gap && offset < aligned.offset)) {
        aligned = { element, gap, offset };
      }
    } else {
      const score = gap + PERPENDICULAR_WEIGHT * offset;
      if (!fallback || score < fallback.score) fallback = { element, score };
    }
  }
  return aligned?.element ?? fallback?.element;
}

/** Handles one keydown; returns true when focus moved (and the event was consumed). */
function handle(event: KeyboardEvent): boolean {
  const direction = KEY_DIRECTIONS[event.key];
  if (!direction || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;

  const target = event.composedPath()[0];
  if (target instanceof Element && target.matches(CONSUMES_ARROWS)) return false;

  const current = document.activeElement;
  if (!(current instanceof HTMLElement) || !current.matches(FOCUSABLE)) {
    // Nothing focused yet: the first press lands on the first visible control.
    const first = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isVisible);
    if (!first) return false;
    first.focus();
    return true;
  }

  const next = findCandidate(current, direction);
  if (!next) return false; // let the browser scroll natively
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

/**
 * OK on a radio button or checkbox selects/toggles it. Natively, Enter does not toggle them and
 * Chrome submits the surrounding form instead (OK on a variant would start an install).
 */
function toggleChoice(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLInputElement) || (target.type !== "radio" && target.type !== "checkbox")) return false;
  target.click();
  return true;
}

/** Enables D-pad navigation for the whole page. Returns a function that disables it again. */
export function enableSpatialNavigation(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (handle(event)) event.preventDefault();
    else if (event.key === "Enter" && toggleChoice(event)) event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

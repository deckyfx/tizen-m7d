import type { BunPlugin, PluginBuilder } from "bun";
import tailwind from "bun-plugin-tailwind";
import { transform } from "lightningcss";

/**
 * Tailwind for the TV: wraps `bun-plugin-tailwind` and lowers its output with Lightning CSS.
 *
 * Tailwind v4 emits native CSS nesting for every variant (`&:hover`, `&:focus`, `&:disabled`,
 * `@media (hover: hover)` inside rules). The TV's browser is Chrome 108, which only supports
 * nesting from 112 and drops such rules entirely, so without this every `hover:`, `focus:`
 * and `disabled:` utility silently does nothing on the TV.
 */

/** Lightning CSS encodes versions as `major << 16 | minor << 8 | patch`. */
const version = (major: number, minor = 0): number => (major << 16) | (minor << 8);

/** Oldest browsers the dashboard must render correctly in. */
export const CSS_TARGETS = {
  /** Samsung M7 browser (UA Chrome/108.0.5359.1, verified via /api/client). */
  chrome: version(108),
  /** Phones and laptops on the LAN. */
  safari: version(16, 4),
  firefox: version(115),
};

/** Lowers modern CSS syntax (nesting, color-mix, …) to {@link CSS_TARGETS}. */
export function lowerCss(path: string, css: string): string {
  const { code } = transform({
    filename: path,
    code: Buffer.from(css),
    targets: CSS_TARGETS,
    minify: false,
    sourceMap: false,
  });
  return code.toString();
}

/** The `onLoad` registration function of a plugin builder. */
type OnLoad = PluginBuilder["onLoad"];

const plugin: BunPlugin = {
  name: "tailwind-tv-compatible",
  setup(build) {
    // Hand Tailwind a builder whose onLoad wraps every callback with the lowering step.
    const onLoad: OnLoad = (options, callback) =>
      build.onLoad(options, async (args) => {
        const result = await callback(args);
        if (!result || !("loader" in result) || result.loader !== "css") return result;
        if (typeof result.contents !== "string") return result;
        return { ...result, contents: lowerCss(args.path, result.contents) };
      });
    const wrapped = new Proxy(build, {
      get(target, property, receiver) {
        if (property === "onLoad") return onLoad;
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return tailwind.setup(wrapped);
  },
};

export default plugin;

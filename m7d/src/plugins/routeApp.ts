import { Elysia, t } from "elysia";
import index from "../public/index.html";

import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2" with { type: "file" };
import interLatinExt from "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2" with { type: "file" };
import jakartaLatin from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2" with { type: "file" };
import jakartaLatinExt from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2" with { type: "file" };
import monoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" with { type: "file" };
import monoLatinExt from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2" with { type: "file" };

/**
 * Font files the UI registers (see src/public/lib/fonts.ts): Latin + Latin Extended. Imported as
 * files so `bun build --compile` embeds them (a runtime node_modules lookup fails in the binary).
 */
const FONT_FILES: Record<string, string> = {
  "inter-latin-wght-normal.woff2": interLatin,
  "inter-latin-ext-wght-normal.woff2": interLatinExt,
  "plus-jakarta-sans-latin-wght-normal.woff2": jakartaLatin,
  "plus-jakarta-sans-latin-ext-wght-normal.woff2": jakartaLatinExt,
  "jetbrains-mono-latin-wght-normal.woff2": monoLatin,
  "jetbrains-mono-latin-ext-wght-normal.woff2": monoLatinExt,
};

/**
 * Serves the React web UI (registered after the API so `/api/*` wins) and the
 * self-hosted fonts (allowlisted files only, cached for a year).
 */
export const appPlugin = new Elysia()
  .get(
    "/fonts/:name",
    ({ params, status }) => {
      const path = FONT_FILES[params.name];
      if (!path) return status(404, "Unknown font");
      return new Response(Bun.file(path), {
        headers: {
          "content-type": "font/woff2",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    },
    { params: t.Object({ name: t.String({ maxLength: 80 }) }) },
  )
  .get("/", index)
  .get("/*", index);

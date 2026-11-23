/**
 * Registers the dashboard's self-hosted variable fonts (Latin + Latin Extended only).
 *
 * The files are served by m7d at `/fonts/*` (see routeApp.ts) with long-lived caching, so
 * the TV needs no internet for them. Registering them from script keeps the bundler from
 * inlining every subset into the stylesheet (that made the CSS ~500 KB and delayed first paint).
 */

/** Unicode ranges of the Fontsource "latin" and "latin-ext" subsets. */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

/** Font families and their file stems under /fonts. */
const FAMILIES = [
  { family: "Inter Variable", stem: "inter" },
  { family: "Plus Jakarta Sans Variable", stem: "plus-jakarta-sans" },
  { family: "JetBrains Mono Variable", stem: "jetbrains-mono" },
] as const;

/** Adds the font faces to the document; the browser downloads a file only when text needs it. */
export function registerFonts(): void {
  if (!("fonts" in document) || typeof FontFace === "undefined") return;
  for (const { family, stem } of FAMILIES) {
    for (const [subset, unicodeRange] of [
      ["latin", LATIN],
      ["latin-ext", LATIN_EXT],
    ] as const) {
      const face = new FontFace(family, `url(/fonts/${stem}-${subset}-wght-normal.woff2) format("woff2")`, {
        weight: "100 900",
        style: "normal",
        display: "swap",
        unicodeRange,
      });
      document.fonts.add(face);
    }
  }
}

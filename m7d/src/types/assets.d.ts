/**
 * Files imported `with { type: "file" }`: Bun resolves them to a path (inside the compiled
 * binary: an embedded `$bunfs` path), so they ship in `bun build --compile` output.
 */
declare module "*.woff2" {
  const path: string;
  export default path;
}

/** The pinned TizenTube userscript (a built bundle; imported as a file path, never executed here). */
declare module "@foxreis/tizentube/dist/userScript.js" {
  const path: string;
  export default path;
}

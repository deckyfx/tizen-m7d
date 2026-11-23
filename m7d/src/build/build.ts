/**
 * Production build: compiles m7d (server, React UI, Tailwind CSS lowered for the TV, fonts,
 * userscript, shim template) into one standalone executable.
 *
 *   bun run build            → binaries/m7d-linux-x64
 *
 * Only linux-x64: the image also ships apps2samsung-cli, which exists for linux-x64 only, and
 * the homelab is x64. Runtime settings (TV IP, token, ports) stay in the environment.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import tailwindTv from "./tailwind-tv";

/** Project root (this file lives in src/build/). */
const ROOT = join(import.meta.dir, "..", "..");
const OUTFILE = join(ROOT, "binaries", "m7d-linux-x64");

console.log("🏗️  Building m7d (linux-x64)…");
await rm(join(ROOT, "binaries"), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "src", "server.ts")],
  compile: { outfile: OUTFILE, target: "bun-linux-x64" },
  // Same CSS pipeline as `bun --hot` (bunfig.toml): Tailwind, then lowered for Chrome 108.
  plugins: [tailwindTv],
  // Keep identifier names: Elysia reads handler parameters from the source text (`({ headers })`)
  // to decide what to parse; renamed parameters left `headers` undefined in every guarded route.
  minify: { whitespace: true, syntax: true, identifiers: false },
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  console.error("❌ Build failed:");
  for (const log of result.logs) console.error(`   ${log.message}`);
  process.exit(1);
}

// outputs[0].size is 0 for compiled binaries; read the size from disk.
const size = Bun.file(OUTFILE).size;
console.log(`✅ ${OUTFILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);

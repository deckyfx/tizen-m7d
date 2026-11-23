import manifest from "@foxreis/tizentube/package.json";
import userscriptPath from "@foxreis/tizentube/dist/userScript.js" with { type: "file" };

/** The userscript as served to Cobalt. */
export interface UserscriptBundle {
  /** Package version (`@foxreis/tizentube`, pinned exactly in package.json + bun.lock). */
  version: string;
  /** First 12 hex chars of the SHA-256; used as the cache-busting `?v=`. */
  hash: string;
  size: number;
  body: Uint8Array<ArrayBuffer>;
  gzip: Uint8Array<ArrayBuffer>;
}

/**
 * Loads the pinned TizenTube userscript from node_modules once. Replaces TizenTube's
 * runtime jsDelivr load with an unpinned `?ver=Date.now()`; update it by bumping
 * the exact version in package.json.
 */
export class Userscript {
  private bundle: UserscriptBundle | undefined;

  /** The bundle (read and compressed on first call). */
  async get(): Promise<UserscriptBundle> {
    if (this.bundle) return this.bundle;
    // Imported, not looked up in node_modules: the compiled binary embeds both.
    const body = await Bun.file(userscriptPath).bytes();
    this.bundle = {
      version: manifest.version,
      hash: new Bun.CryptoHasher("sha256").update(body).digest("hex").slice(0, 12),
      size: body.byteLength,
      body,
      gzip: Bun.gzipSync(body, { level: 9 }),
    };
    return this.bundle;
  }
}

import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PolicyError } from "../lib/errors";
import { Mutex } from "../lib/mutex";

/** PEM key + certificate chain for a TLS server. */
export interface HostCertificate {
  key: string;
  /** Host certificate followed by the CA certificate. */
  cert: string;
}

/** Public facts about the CA (shown in the UI, baked into the shim). */
export interface CaInfo {
  subject: string;
  notAfter: string;
  sha256: string;
  /**
   * OpenSSL subject hashes (`-subject_hash`, `-subject_hash_old`): Cobalt finds trusted CAs
   * as `ssl/certs/<hash>.<n>` files inside its `--content` folder.
   */
  hashes: string[];
}

/** Common name of our CA; the shim's setup service installs only this public cert on the TV. */
export const CA_COMMON_NAME = "m7d YouTube Proxy CA";

/** Host certificates are renewed this long before they expire. */
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60_000;

/** A hostname we are willing to make a certificate for. */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Runs openssl with `args` (no shell) and returns stdout; throws with stderr on failure. */
async function openssl(args: string[], stdin?: string): Promise<string> {
  const child = Bun.spawn(["openssl", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`openssl ${args[0]} failed: ${stderr.trim().slice(0, 300)}`);
  return stdout;
}

/**
 * The YouTube proxy's certificate authority, made with the system `openssl`.
 *
 * - The CA key never leaves `dir` (mode 0600). Only the public certificate goes to the TV.
 * - Host certificates (www.youtube.com, youtube.com) are made once and cached on disk, so the
 *   proxy is ready instantly: the on-TV proxy's 3–4 s key generation before `listen()` was
 *   TizenTube's startup race.
 */
export class CertAuthority {
  private readonly lock = new Mutex();
  private readonly hosts = new Map<string, HostCertificate>();
  private info: CaInfo | undefined;

  constructor(private readonly dir: string) {}

  private get caKeyPath(): string {
    return join(this.dir, "ca.key");
  }

  private get caCertPath(): string {
    return join(this.dir, "ca.crt");
  }

  /** Creates the CA on first use (10 years); returns its public facts. */
  ensure(): Promise<CaInfo> {
    return this.lock.run(() => this.ensureLocked());
  }

  private async ensureLocked(): Promise<CaInfo> {
    if (this.info) return this.info;
    await mkdir(join(this.dir, "hosts"), { recursive: true, mode: 0o700 });
    if (!(await Bun.file(this.caKeyPath).exists()) || !(await Bun.file(this.caCertPath).exists())) {
      await openssl([
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
        "-keyout", this.caKeyPath, "-out", this.caCertPath,
        "-subj", `/CN=${CA_COMMON_NAME}`,
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
        "-addext", "subjectKeyIdentifier=hash",
      ]);
      await chmod(this.caKeyPath, 0o600);
      console.log(`[yt] created CA ${this.caCertPath}`);
    }
    const out = await openssl([
      "x509", "-in", this.caCertPath, "-noout",
      "-subject", "-enddate", "-fingerprint", "-sha256", "-subject_hash", "-subject_hash_old",
    ]);
    const lines = out.trim().split("\n");
    const field = (prefix: string) =>
      lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
    const hashes = lines.filter((line) => /^[0-9a-f]{8}$/.test(line.trim())).map((line) => line.trim());
    this.info = {
      subject: field("subject="),
      notAfter: new Date(field("notAfter=")).toISOString(),
      sha256: field("sha256 Fingerprint=").replaceAll(":", "").toLowerCase(),
      hashes: [...new Set(hashes)],
    };
    return this.info;
  }

  /** The CA certificate (public, PEM). */
  async caPem(): Promise<string> {
    await this.ensure();
    return Bun.file(this.caCertPath).text();
  }

  /** Key + chain for `hostname`, made (or renewed) when needed. */
  hostCertificate(hostname: string): Promise<HostCertificate> {
    if (!HOSTNAME.test(hostname)) return PolicyError.throw(`Not a valid hostname: ${hostname}`);
    return this.lock.run(async () => {
      const cached = this.hosts.get(hostname);
      if (cached) return cached;
      await this.ensureLocked();
      const keyPath = join(this.dir, "hosts", `${hostname}.key`);
      const certPath = join(this.dir, "hosts", `${hostname}.crt`);
      if (!(await this.isFresh(certPath)) || !(await Bun.file(keyPath).exists())) {
        await this.issue(hostname, keyPath, certPath);
      }
      const host: HostCertificate = {
        key: await Bun.file(keyPath).text(),
        cert: (await Bun.file(certPath).text()) + (await Bun.file(this.caCertPath).text()),
      };
      this.hosts.set(hostname, host);
      return host;
    });
  }

  /** True when the certificate exists and is valid for at least {@link RENEW_BEFORE_MS}. */
  private async isFresh(certPath: string): Promise<boolean> {
    if (!(await Bun.file(certPath).exists())) return false;
    const seconds = String(Math.floor(RENEW_BEFORE_MS / 1000));
    return openssl(["x509", "-in", certPath, "-noout", "-checkend", seconds]).then(
      () => true,
      () => false,
    );
  }

  /** Makes a server certificate for `hostname` signed by the CA (397 days, the browser maximum). */
  private async issue(hostname: string, keyPath: string, certPath: string): Promise<void> {
    const csrPath = `${certPath}.csr`;
    const extPath = `${certPath}.ext`;
    try {
      await openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", `/CN=${hostname}`]);
      await chmod(keyPath, 0o600);
      await Bun.write(
        extPath,
        [
          "basicConstraints=critical,CA:FALSE",
          "keyUsage=critical,digitalSignature,keyEncipherment",
          "extendedKeyUsage=serverAuth",
          `subjectAltName=DNS:${hostname}`,
          "subjectKeyIdentifier=hash",
          "authorityKeyIdentifier=keyid",
        ].join("\n"),
      );
      await openssl([
        "x509", "-req", "-sha256", "-days", "397", "-in", csrPath,
        "-CA", this.caCertPath, "-CAkey", this.caKeyPath, "-set_serial", `0x${Date.now().toString(16)}`,
        "-out", certPath, "-extfile", extPath,
      ]);
      console.log(`[yt] issued certificate for ${hostname}`);
    } finally {
      await rm(csrPath, { force: true });
      await rm(extPath, { force: true });
    }
  }
}

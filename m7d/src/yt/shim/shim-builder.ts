import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PolicyError } from "../../lib/errors";
import { shimIcon } from "./icon";
// ES5 JavaScript kept as .txt so it is imported as text and embedded in the compiled binary.
import setupServiceTemplate from "./setup-service.es5.txt" with { type: "text" };

/** Identity of the YouTube shim package on the TV. */
export const SHIM = {
  packageId: "M7dYouTube",
  /** App id (also the REST id): launching it starts Cobalt with our arguments. */
  appId: "M7dYouTube.YouTube",
  /** One-shot setup service, started by m7d with `0 execute`. */
  serviceId: "M7dYouTube.Setup",
  version: "1.0.1",
  name: "YouTube m7d",
  /** Cobalt `--content` folder (our copy of Samsung's, plus our CA). */
  contentDir: "/home/owner/share/m7d-cobalt-content",
  /** DIAL name, distinct from stock YouTube so casting keeps going to the stock app. */
  dialName: "m7dYouTube",
} as const;

/** Samsung's Cobalt content on Tizen 6.5 (first), older firmware (second). */
export const COBALT_SOURCES = [
  "/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content",
  "/usr/apps/com.samsung.tv.cobalt/content/data",
];

/**
 * Leftovers of the old TizenTube setup that the setup service deletes on every run (it is the
 * only thing on the TV that can delete files for us). Fixed here; the service also refuses
 * anything outside /home/owner/share/.
 */
export const LEGACY_LEFTOVERS = ["/home/owner/share/tizentube-content"];

/** Path of the setup service's report endpoint on m7d. */
export const SETUP_REPORT_PATH = "/api/yt/setup-report";

/** Values baked into the package. */
export interface ShimParams {
  /** Homelab address on the TV's network (proxy + report target). */
  homelabIp: string;
  proxyPort: number;
  /** m7d's HTTP port (setup report). */
  serverPort: number;
  /** CA certificate (public PEM). */
  caPem: string;
  /** OpenSSL subject hashes of the CA (file names in ssl/certs). */
  caHashes: string[];
}

/** A built (unsigned) package. */
export interface BuiltShim {
  path: string;
  size: number;
  sha256: string;
}

/** Strict IPv4 check: the address ends up in config.xml. */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** Cobalt's command line (`native.userdata`). */
export function cobaltArguments(params: ShimParams): string {
  return [
    "--base_url=https://www.youtube.com/tv",
    `--proxy=http://${params.homelabIp}:${params.proxyPort}`,
    `--content=${SHIM.contentDir}`,
    `--dial_name=${SHIM.dialName}`,
    "--use_eden",
  ].join(" ");
}

/**
 * config.xml: TizenTube's (proven on this TV) with our ids, our proxy and content folder, and a
 * setup service that neither starts on boot nor restarts (it runs once when m7d asks).
 */
export function shimConfigXml(params: ShimParams): string {
  if (!IPV4.test(params.homelabIp)) return PolicyError.throw(`HOMELAB_IP is not an IPv4 address: ${params.homelabIp}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns:tizen="http://tizen.org/ns/widgets" xmlns="http://www.w3.org/ns/widgets" id="http://m7d.local/youtube" version="${SHIM.version}" viewmodes="maximized">
    <access origin="*" subdomains="true"></access>
    <tizen:allow-navigation href="*"/>
    <tizen:application id="${SHIM.appId}" package="${SHIM.packageId}" required_version="3.0"/>
    <content src="index.html"/>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <feature name="http://tizen.org/feature/web.service"/>
    <icon src="icon.png" width="512" height="512"/>
    <name>${SHIM.name}</name>
    <tizen:metadata key="http://samsung.com/tv/metadata/prelaunch.support" value="true"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/floating.navigation" value="false"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/use.uwe" value="true"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/no_use_process_pool" value="true"/>
    <tizen:metadata key="multiview_support" value="true"/>
    <tizen:metadata key="multiview_min_resource" value="FHD+"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/html5.4k.support" value="true"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/microphone.support" value="1"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/microphone.area" value="open"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/pkgid" value="com.samsung.tv.cobalt"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/nativeID" value="com.samsung.tv.cobalt-yt"/>
    <tizen:metadata key="http://samsung.com/tv/metadata/native.userdata" value="${cobaltArguments(params)}"/>
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:privilege name="http://tizen.org/privilege/recorder"/>
    <tizen:privilege name="http://tizen.org/privilege/mediacapture"/>
    <tizen:privilege name="http://tizen.org/privilege/unlimitedstorage"/>
    <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
    <tizen:profile name="tv-samsung"/>
    <tizen:service id="${SHIM.serviceId}" auto-restart="false" on-boot="false">
        <tizen:content src="service/setup.js"/>
        <tizen:name>Setup</tizen:name>
        <tizen:description>Copies the Cobalt content and installs the m7d proxy CA, then exits</tizen:description>
    </tizen:service>
    <tizen:setting screen-orientation="landscape" context-menu="enable" background-support="enable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}

/** Placeholder in setup-service.es5.txt replaced by the JSON config. */
const CONFIG_MARKER = "/*@M7D_CONFIG@*/ null";

/** The setup service source with its configuration baked in. */
export async function setupServiceSource(params: ShimParams): Promise<string> {
  const template = setupServiceTemplate;
  if (!template.includes(CONFIG_MARKER)) throw new Error("setup-service.es5.txt lost its config marker");
  const config = {
    shimVersion: SHIM.version,
    contentDir: SHIM.contentDir,
    cobaltSources: COBALT_SOURCES,
    cleanup: LEGACY_LEFTOVERS,
    caPem: params.caPem,
    caHashes: params.caHashes,
    reportHost: params.homelabIp,
    reportPort: params.serverPort,
    reportPath: SETUP_REPORT_PATH,
  };
  return template.replace(CONFIG_MARKER, JSON.stringify(config));
}

/** Shown only if the app's web page is ever opened (the nativeID normally starts Cobalt directly). */
const INDEX_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${SHIM.name}</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#18181b;color:#fff;font:32px sans-serif">
${SHIM.name}: open it from the Smart Hub tile or the m7d dashboard.
</body></html>
`;

/** Builds the unsigned .wgt into `outDir` (Apps2Samsung signs it on install). */
export async function buildShim(params: ShimParams, outDir: string): Promise<BuiltShim> {
  await mkdir(outDir, { recursive: true });
  const staging = await mkdtemp(join(outDir, "build-"));
  const path = join(outDir, `${SHIM.packageId}-${SHIM.version}.wgt`);
  try {
    await Bun.write(join(staging, "config.xml"), shimConfigXml(params));
    await Bun.write(join(staging, "index.html"), INDEX_HTML);
    await Bun.write(join(staging, "icon.png"), shimIcon());
    await Bun.write(join(staging, "service", "setup.js"), await setupServiceSource(params));
    await rm(path, { force: true });
    const zip = Bun.spawn(["zip", "-X", "-q", "-r", path, "."], { cwd: staging, stdout: "ignore", stderr: "pipe" });
    const [stderr, exitCode] = await Promise.all([new Response(zip.stderr).text(), zip.exited]);
    if (exitCode !== 0) throw new Error(`zip failed (${exitCode}): ${stderr.trim()}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const bytes = await Bun.file(path).bytes();
  return {
    path,
    size: bytes.byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  };
}

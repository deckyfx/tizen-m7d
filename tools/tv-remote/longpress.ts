/**
 * Samsung TV remote-control WebSocket probe: pairs once (TV shows "Allow"),
 * then sends a key as Click, or as Press → hold → Release (long-press).
 *
 * Usage: bun tools/tv-remote/longpress.ts [key] [holdMs] [mode]
 *   key    default KEY_POWER
 *   holdMs default 8000 (ignored for mode=click)
 *   mode   "long" (default) | "click" | "pair" (connect + save token only)
 *
 * The pairing token is stored next to this script in `.token` (gitignored).
 */
const TV = Bun.env.TV_HOST ?? "192.0.2.130";
const KEY = process.argv[2] ?? "KEY_POWER";
const HOLD_MS = Number(process.argv[3] ?? 8000);
const MODE = process.argv[4] ?? "long";
const TOKEN_FILE = Bun.file(`${import.meta.dir}/.token`);
const NAME = Buffer.from("m7d").toString("base64");

/** Event shape the TV sends on the remote channel. */
type TvEvent = { event: string; data?: { token?: string } };

const savedToken = (await TOKEN_FILE.exists()) ? (await TOKEN_FILE.text()).trim() : "";
const url =
  `wss://${TV}:8002/api/v2/channels/samsung.remote.control?name=${NAME}` +
  (savedToken ? `&token=${savedToken}` : "");

/** Builds one remote-key command frame. */
const keyFrame = (cmd: "Click" | "Press" | "Release"): string =>
  JSON.stringify({
    method: "ms.remote.control",
    params: { Cmd: cmd, DataOfCmd: KEY, Option: "false", TypeOfRemote: "SendRemoteKey" },
  });

// The TV serves a self-signed certificate on 8002.
const ws = new WebSocket(url, { tls: { rejectUnauthorized: false } } as unknown as string[]);
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const giveUp = setTimeout(() => {
  log("no 'ms.channel.connect' within 60 s (prompt not accepted?)");
  ws.close();
  process.exit(2);
}, 60_000);

ws.onopen = () => log(`socket open (${savedToken ? "with saved token" : "first pairing: accept on TV"})`);
ws.onerror = (e) => log(`socket error: ${(e as ErrorEvent).message ?? "unknown"}`);
ws.onclose = (e) => log(`socket closed code=${e.code} reason=${e.reason || "-"}`);

ws.onmessage = async (msg) => {
  const ev = JSON.parse(String(msg.data)) as TvEvent;
  log(`event: ${ev.event}`);
  if (ev.event === "ms.channel.unauthorized") {
    clearTimeout(giveUp);
    log("TV denied the connection");
    ws.close();
    return;
  }
  if (ev.event !== "ms.channel.connect") return;
  clearTimeout(giveUp);
  if (ev.data?.token && ev.data.token !== savedToken) {
    await Bun.write(TOKEN_FILE, ev.data.token);
    log("pairing token saved");
  }
  if (MODE === "pair") {
    ws.close();
    return;
  }
  if (MODE === "click") {
    ws.send(keyFrame("Click"));
    log(`Click ${KEY}`);
  } else {
    ws.send(keyFrame("Press"));
    log(`Press ${KEY}, holding ${HOLD_MS} ms`);
    await Bun.sleep(HOLD_MS);
    ws.send(keyFrame("Release"));
    log(`Release ${KEY}`);
  }
  await Bun.sleep(500);
  ws.close();
};

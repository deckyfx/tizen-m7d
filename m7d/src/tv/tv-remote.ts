import type { TvTarget } from "../services/settings-store";
import { mkdir } from "node:fs/promises";
import { TvRemoteError } from "../lib/errors";

/** How a key is sent: a short click, or press → hold → release. */
export type KeyMode = { kind: "click" } | { kind: "hold"; holdMs: number };

/** Events m7d reads from the remote channel. */
interface RemoteEvent {
  event: string;
  data?: { token?: string };
}

/** Name the TV shows in its "Allow" prompt (sent base64-encoded). */
const CLIENT_NAME = "m7d";

/** Max wait for `ms.channel.connect` (includes the user pressing "Allow" on first pairing). */
const CONNECT_TIMEOUT_MS = 30_000;

/** Long-press duration that powers the M7 fully off (verified 2026-11-23). */
export const POWER_OFF_HOLD_MS = 8000;

/** An open channel is reused for this long after the last key (snappy D-pad). */
const IDLE_CLOSE_MS = 20_000;

/** Remote keys the dashboard may send (KEY_POWER only via {@link TvRemoteClient.powerOff}). */
export const REMOTE_KEYS = [
  "KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_ENTER", "KEY_RETURN",
  "KEY_HOME", "KEY_MENU", "KEY_SOURCE", "KEY_INFO", "KEY_EXIT", "KEY_TOOLS",
  "KEY_VOLUP", "KEY_VOLDOWN", "KEY_MUTE", "KEY_CHUP", "KEY_CHDOWN",
  "KEY_PLAY", "KEY_PAUSE", "KEY_STOP", "KEY_FF", "KEY_REWIND",
  "KEY_0", "KEY_1", "KEY_2", "KEY_3", "KEY_4", "KEY_5", "KEY_6", "KEY_7", "KEY_8", "KEY_9",
] as const;

/** One of {@link REMOTE_KEYS}. */
export type RemoteKey = (typeof REMOTE_KEYS)[number];

/**
 * Client for the TV's remote-control WebSocket (`wss://<tv>:8002`, self-signed cert).
 *
 * The first connection makes the TV show an "Allow" prompt; the returned token is persisted
 * in `tokenPath` so later connections are silent.
 */
export class TvRemoteClient {
  /**
   * @param target where the TV is (read when a channel opens)
   * @param port remote WebSocket port (8002)
   * @param tokenPath file holding the pairing token
   */
  private cached: WebSocket | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly target: TvTarget,
    private readonly port: number,
    private readonly tokenPath: string,
  ) {}

  /** Closes the cached channel (the TV IP changed). */
  disconnect(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.cached?.close();
    this.cached = undefined;
  }

  /** Returns an open channel, reusing the last one; it closes after {@link IDLE_CLOSE_MS} idle. */
  private async channel(): Promise<WebSocket> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const socket =
      this.cached && this.cached.readyState === WebSocket.OPEN ? this.cached : await this.open();
    this.cached = socket;
    this.idleTimer = setTimeout(() => {
      socket.close();
      if (this.cached === socket) this.cached = undefined;
    }, IDLE_CLOSE_MS);
    return socket;
  }

  /** Reads the saved pairing token ("" when not paired yet). */
  private async readToken(): Promise<string> {
    const file = Bun.file(this.tokenPath);
    return (await file.exists()) ? (await file.text()).trim() : "";
  }

  /** Persists a new pairing token. */
  private async saveToken(token: string): Promise<void> {
    await mkdir(this.tokenPath.replace(/\/[^/]+$/, ""), { recursive: true });
    await Bun.write(this.tokenPath, token);
  }

  /** True once a pairing token is stored. */
  async isPaired(): Promise<boolean> {
    return (await this.readToken()) !== "";
  }

  /** Builds one remote-key frame. */
  private static keyFrame(
    cmd: "Click" | "Press" | "Release",
    key: string,
  ): string {
    return JSON.stringify({
      method: "ms.remote.control",
      params: {
        Cmd: cmd,
        DataOfCmd: key,
        Option: "false",
        TypeOfRemote: "SendRemoteKey",
      },
    });
  }

  /** Opens the channel and resolves once the TV confirms the connection. */
  private async open(): Promise<WebSocket> {
    if (!this.target.tvHost) return TvRemoteError.throw("No TV IP set: enter it in the dashboard's Settings");
    const savedToken = await this.readToken();
    const name = Buffer.from(CLIENT_NAME).toString("base64");
    const url =
      `wss://${this.target.tvHost}:${this.port}/api/v2/channels/samsung.remote.control?name=${name}` +
      (savedToken ? `&token=${savedToken}` : "");

    return new Promise<WebSocket>((resolve, reject) => {
      // Bun accepts a `tls` option on WebSocket; the TV's certificate is self-signed.
      const options = {
        tls: { rejectUnauthorized: false },
      } as unknown as string[];
      const socket = new WebSocket(url, options);
      const timer = setTimeout(() => {
        socket.close();
        reject(
          TvRemoteError.create(
            "TV did not confirm the remote connection (pairing prompt not accepted?)",
          ),
        );
      }, CONNECT_TIMEOUT_MS);

      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as RemoteEvent;
        if (event.event === "ms.channel.unauthorized") {
          clearTimeout(timer);
          socket.close();
          reject(TvRemoteError.create("TV denied the remote connection"));
          return;
        }
        if (event.event !== "ms.channel.connect") return;
        clearTimeout(timer);
        const token = event.data?.token;
        const saved =
          token && token !== savedToken
            ? this.saveToken(token)
            : Promise.resolve();
        saved.then(() => resolve(socket), reject);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(TvRemoteError.create("TV remote WebSocket unreachable"));
      };
    });
  }

  /** Sends `key` (e.g. `KEY_HOME`) as a click or a long press. */
  async sendKey(key: string, mode: KeyMode): Promise<void> {
    const socket = await this.channel();
    if (mode.kind === "click") {
      socket.send(TvRemoteClient.keyFrame("Click", key));
      return;
    }
    socket.send(TvRemoteClient.keyFrame("Press", key));
    await Bun.sleep(mode.holdMs);
    socket.send(TvRemoteClient.keyFrame("Release", key));
  }

  /** Types `text` into the focused text field on the TV (on-screen keyboard open). */
  async sendText(text: string): Promise<void> {
    const socket = await this.channel();
    socket.send(
      JSON.stringify({
        method: "ms.remote.control",
        params: {
          Cmd: Buffer.from(text, "utf8").toString("base64"),
          DataOfCmd: "base64",
          TypeOfRemote: "SendInputString",
        },
      }),
    );
  }

  /** Fully powers the TV off (long-press Power). The next power-on is a cold boot. */
  powerOff(): Promise<void> {
    return this.sendKey("KEY_POWER", {
      kind: "hold",
      holdMs: POWER_OFF_HOLD_MS,
    });
  }

}

/** Tizen id of the TV's built-in web browser (the app the dashboard runs in on the TV). */
export const TV_BROWSER_TIZEN_ID = "org.tizen.browser";

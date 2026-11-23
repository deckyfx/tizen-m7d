import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FastForward,
  House,
  Info,
  Keyboard,
  Menu,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  Send,
  Square,
  Undo2,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { errorMessage, type Api } from "../lib/api";
import { useLayout } from "../lib/layout";
import { Button, Card, fieldClass, Notice } from "./ui";

/** Keys the server accepts (mirrors REMOTE_KEYS in tv-remote.ts). */
type RemoteKey =
  | "KEY_UP" | "KEY_DOWN" | "KEY_LEFT" | "KEY_RIGHT" | "KEY_ENTER" | "KEY_RETURN"
  | "KEY_HOME" | "KEY_MENU" | "KEY_SOURCE" | "KEY_INFO" | "KEY_EXIT" | "KEY_TOOLS"
  | "KEY_VOLUP" | "KEY_VOLDOWN" | "KEY_MUTE" | "KEY_CHUP" | "KEY_CHDOWN"
  | "KEY_PLAY" | "KEY_PAUSE" | "KEY_STOP" | "KEY_FF" | "KEY_REWIND"
  | "KEY_0" | "KEY_1" | "KEY_2" | "KEY_3" | "KEY_4" | "KEY_5" | "KEY_6" | "KEY_7" | "KEY_8" | "KEY_9";

/** One remote button. */
interface Pad {
  key: RemoteKey;
  label: string;
  icon?: LucideIcon;
}

const NAV: Pad[] = [
  { key: "KEY_RETURN", label: "Back", icon: Undo2 },
  { key: "KEY_HOME", label: "Home", icon: House },
  { key: "KEY_EXIT", label: "Exit", icon: X },
  { key: "KEY_MENU", label: "Menu", icon: Menu },
  { key: "KEY_SOURCE", label: "Source" },
  { key: "KEY_INFO", label: "Info", icon: Info },
  { key: "KEY_TOOLS", label: "Tools" },
];

const VOLUME: Pad[] = [
  { key: "KEY_VOLUP", label: "Vol +", icon: Volume2 },
  { key: "KEY_VOLDOWN", label: "Vol −", icon: Minus },
  { key: "KEY_MUTE", label: "Mute", icon: VolumeX },
  { key: "KEY_CHUP", label: "Ch +", icon: Plus },
  { key: "KEY_CHDOWN", label: "Ch −", icon: Minus },
];

const MEDIA: Pad[] = [
  { key: "KEY_REWIND", label: "Rewind", icon: Rewind },
  { key: "KEY_PLAY", label: "Play", icon: Play },
  { key: "KEY_PAUSE", label: "Pause", icon: Pause },
  { key: "KEY_STOP", label: "Stop", icon: Square },
  { key: "KEY_FF", label: "Forward", icon: FastForward },
];

const DIGITS: Pad[] = (["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const).map((digit) => ({
  key: `KEY_${digit}` as RemoteKey,
  label: digit,
}));

/** Props for {@link RemoteView}. */
interface RemoteViewProps {
  api: Api;
  onMessage: (text: string, isError?: boolean) => void;
}

/** Virtual remote over the TV's remote-control WebSocket (keys and typing text). */
export function RemoteView({ api, onMessage }: RemoteViewProps) {
  const { isTv } = useLayout();
  const [text, setText] = useState("");

  const press = async (key: RemoteKey) => {
    const { error } = await api.api.tv.key.post({ key });
    if (error) onMessage(errorMessage(error), true);
  };

  const type = async (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    const { error } = await api.api.tv.text.post({ text });
    if (error) onMessage(errorMessage(error), true);
    else {
      onMessage("Text sent (a text field must be focused on the TV)");
      setText("");
    }
  };

  /** A remote key button. */
  const key = (pad: Pad, className = "") => {
    const Icon = pad.icon;
    return (
      <button
        key={pad.key}
        type="button"
        onClick={() => void press(pad.key)}
        aria-label={pad.label}
        className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl bg-white text-xs font-medium text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50 hover:shadow ${className}`}
      >
        {Icon ? <Icon size={20} aria-hidden="true" /> : <span className="text-base font-semibold">{pad.label}</span>}
        {Icon && <span>{pad.label}</span>}
      </button>
    );
  };

  /** A D-pad arrow. */
  const arrow = (padKey: RemoteKey, label: string, Icon: LucideIcon) => (
    <button
      type="button"
      onClick={() => void press(padKey)}
      aria-label={label}
      className="grid size-16 place-items-center rounded-2xl bg-white text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50"
    >
      <Icon size={28} aria-hidden="true" />
    </button>
  );

  return (
    <section className="flex flex-col gap-5">
      {isTv && (
        <Notice tone="info" icon={Info}>
          This remote is meant for phones; on the TV itself the keys act on this page’s browser.
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Card title="Navigation" padded>
          <div className="mx-auto grid w-fit grid-cols-3 gap-2">
            <span />
            {arrow("KEY_UP", "Up", ChevronUp)}
            <span />
            {arrow("KEY_LEFT", "Left", ChevronLeft)}
            <button
              type="button"
              onClick={() => void press("KEY_ENTER")}
              className="grid size-16 place-items-center rounded-full bg-sky-700 text-lg font-bold text-white shadow hover:bg-sky-800"
            >
              OK
            </button>
            {arrow("KEY_RIGHT", "Right", ChevronRight)}
            <span />
            {arrow("KEY_DOWN", "Down", ChevronDown)}
            <span />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2">{NAV.map((pad) => key(pad))}</div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Volume & channels">
            <div className="grid grid-cols-5 gap-2">{VOLUME.map((pad) => key(pad))}</div>
          </Card>
          <Card title="Media">
            <div className="grid grid-cols-5 gap-2">{MEDIA.map((pad) => key(pad))}</div>
          </Card>
          <Card title="Numbers">
            <div className="grid grid-cols-5 gap-2">{DIGITS.map((pad) => key(pad))}</div>
          </Card>
          <Card title="Type on the TV" icon={Keyboard} description="Sends text to the focused text field on the TV.">
            <form onSubmit={type} className="flex gap-2">
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                aria-label="Text to type on the TV"
                className={`${fieldClass} min-w-0 flex-1`}
              />
              <Button type="submit" variant="primary" icon={Send}>
                Send
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </section>
  );
}

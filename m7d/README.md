# m7d

Homelab daemon for the Samsung Smart Monitor M7. It is the single owner of the TV's sdb connection and
serves a web UI (task manager, Apps2Samsung as a web service, ad-free YouTube) for any device on the LAN,
including the TV's own browser.

## Run

```sh
cp .env.example .env   # set M7D_TOKEN (16+ characters)
bun install
bun run dev            # hot reload on :8787 (YouTube proxy on :8101)
```

Open `http://<this box>:8787`, enter `M7D_TOKEN` once, then **Settings → TV connection**:
- enter the TV's IP (saved in `.data/settings.json`; `.env` `TV_HOST` is only the default);
- this box's IP is detected from the route to the TV (override it there or with `HOMELAB_IP`);
- the card checks Developer Mode and shows how to set the TV's **Host PC IP** to this box
  (Apps → `1 2 3 4 5` → Developer mode On → Host PC IP → restart the TV).

## Build and Docker

```sh
bun run build          # type check + bun build --compile → binaries/m7d-linux-x64 (UI, fonts, userscript embedded)
docker build -t tizen-m7d m7d/
```

The image (`deckyfx/tizen-m7d`, built and pushed by `.github/workflows/docker.yml`) contains the compiled
binary, apps2samsung-cli (official release, checksum pinned), openssl and zip. Run it with
`deploy/docker-compose.yml`: **host networking** (TV recognised by source IP; the TV connects back for
YouTube and setup reports), `/data` and `/home/m7d/.config/Apps2Samsung` as volumes owned by UID 1000.
The compiled binary keeps identifier names when minifying: Elysia reads handler parameter names.

## Features

| Feature          | How it works on the TV                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| TV status        | REST `GET :8001/api/v2/`                                                    |
| App list         | `sdb shell 0 vd_applist` + REST running state per app                       |
| Launch / Close   | REST `POST` / `DELETE :8001/api/v2/applications/<id>`                       |
| Kill             | `sdb shell 0 was_kill <tizenId>`                                            |
| Cold restart     | stop the app and its shared-engine group (TizenTube + YouTube), then launch |
| Power off (cold) | remote WebSocket `:8002`, 8 s `KEY_POWER` long-press = full shutdown        |

## Pages

| Page | What it does | Backed by |
| ---- | ------------ | --------- |
| Running | task manager: running state, launch / close / kill / cold restart | sdb + REST |
| YouTube | ad-free YouTube: install the YouTube m7d app, run its setup, Open YouTube, live proxy traffic | homelab proxy `:8101` |
| Catalog | community catalog: search, categories, variants, per-app install settings, install | `apps2samsung-cli catalog` / `install` |
| Installed | apps on the TV vs the catalog, Update / Update all / Open / Uninstall, app-list backup and restore | `installed`, `update`, `uninstall`, `tv save`/`restore` |
| Install file | upload a .wgt/.tpk and install it | `install <file>` |
| Toolbox | TV information + Developer Mode guide, open app by id, install leftovers, sign a package | `tv`, `leftovers`, `sign` |
| Remote | D-pad, navigation, volume, media, digits, type text | remote WebSocket `:8002` |
| Jobs | queue of installs/updates/clean-ups with live logs and "Retry anyway" | job runner |
| Settings | signing certificates, your sources, Apps2Samsung session logs | `cert`, `sources`, `logs` |

The TV's own browser gets the same pages in a 10-foot layout (see PLAN.md).

### Apps2Samsung as a web service

- m7d runs `apps2samsung-cli … --json` (path `A2S_CLI_PATH`, `--local-ip A2S_LOCAL_IP`) without a shell.
  While a CLI command runs, m7d **lends the TV's single sdb slot** to it; the task manager then serves
  its cached list and other sdb calls answer `409` immediately.
- Long operations are **jobs**, run one at a time, with the CLI's progress lines as a live log. Exit code 3
  (stopped at a pre-install check) can be retried with `--yes` ("Retry anyway").
- Policy: **root apps are filtered out and refused**; `--allow-root` and `--adult` are never passed;
  option-like arguments (`-…`) are rejected before the CLI is run.
- A TV command first checks the TV's REST API (3 s); an off TV answers `503` at once.
- Creating or renewing the signing certificate needs a Samsung sign-in in a browser **on the homelab**
  (the login returns to a local port): `apps2samsung-cli cert --prepare --partner --tv 192.0.2.130`.

### Homelab YouTube (replaces TizenTube's on-TV proxy)

```
TV: "YouTube m7d" (M7dYouTube.YouTube, nativeID com.samsung.tv.cobalt-yt)
      Cobalt --proxy=http://HOMELAB_IP:8101 --content=/home/owner/share/m7d-cobalt-content
        │ CONNECT
        ▼
m7d :8101  ── only the TV + YT_PROXY_ALLOW ──┐
   www.youtube.com / youtube.com → TLS endpoint (random 127.0.0.1 port, our CA)
        → fetch() to the real host; /tv gets the userscript <script> + relaxed CSP
   everything else (googlevideo video, ytimg…) → raw TCP tunnel
```

- **CA**: `.data/yt/ca/` (openssl, 10 years; key mode 0600, never leaves the homelab). Host certificates are made
  once and cached, so the proxy listens instantly (TizenTube's keygen-before-listen race is gone).
- **Userscript**: `@foxreis/tizentube`, pinned exactly in package.json (bun.lock integrity); served from memory at
  `/__m7d/userscript.js` with `no-cache` + ETag. Update: bump the version, restart.
- **Shim app**: built by m7d (`src/yt/shim/`), signed and installed by Apps2Samsung. Its only code is a one-shot ES5
  setup service (`M7dYouTube.Setup`, no boot start, no ports) that m7d starts with `sdb shell 0 execute`: it copies
  Samsung's Cobalt content (again when it changed), installs the CA as `ssl/certs/<hash>.<n>`, POSTs a report to
  `/api/yt/setup-report` (TV IP only) and exits.
- **Open YouTube** (`POST /api/yt/launch`): proxy must be listening; setup runs first when never run, the shim or
  stock YouTube changed version, or after 7 days; then a cold restart that stops any Cobalt running with stock arguments.
- If m7d is down, YouTube m7d shows "Network error"; stock YouTube keeps working.
- `bun --hot` reloads restart the proxy and cut open tunnels; Cobalt reconnects by itself.

## API

All routes except `/api/health` need `Authorization: Bearer <M7D_TOKEN>`.

| Method | Path                       | Notes                                               |
| ------ | -------------------------- | --------------------------------------------------- |
| GET    | `/api/health`              | public                                              |
| GET    | `/api/tv`                  | `{ online: false }` when the TV is off              |
| GET    | `/api/apps?refresh=1`      | `refresh` re-reads the installed list (cached 60 s) |
| POST   | `/api/apps/:appId/:action` | action: `launch` \| `close` \| `kill` \| `restart`  |
| POST   | `/api/tv/power-off`        | body `{ "confirm": true }`                          |
| POST   | `/api/tv/key`              | body `{ "key": "KEY_HOME", "holdMs"?: 100–5000 }` (allowlisted keys, no power) |
| POST   | `/api/tv/text`             | body `{ "text": "…" }`, types into the focused field |
| GET    | `/api/a2s/catalog` · `installed` · `tv-check` · `certificates` · `sources` · `leftovers` · `profiles` · `logs[/:name]` | reads |
| POST   | `/api/a2s/jobs/install` · `install-upload` · `uninstall` · `update` · `leftovers-clear` · `leftovers-delete` · `profile-save` · `profile-restore` · `sign` · `:id/retry` | start jobs |
| GET    | `/api/a2s/jobs` · `/api/a2s/jobs/:id` | job list / one job with its log |
| POST   | `/api/a2s/upload`          | multipart `file` (.wgt/.tpk) → `uploadId` |
| GET    | `/api/a2s/signed/:id`      | download a signed package |
| GET    | `/api/yt/status`           | proxy, interception, CA, userscript, shim, last setup report, old TizenTube apps |
| POST   | `/api/yt/shim/install` · `/api/yt/setup` · `/api/yt/launch` | install job · run setup (waits ≤ 90 s) · open YouTube |
| GET    | `/api/yt/ca.pem`           | CA certificate (public) |
| POST   | `/api/yt/setup-report`     | **no token, TV IP only**: report of the setup service |

Errors: `404` unknown app, `409` sdb slot busy, `502` sdb/remote/setup failure, `503` TV unreachable.

## Browser support (the TV)

The TV's browser is **Chrome 108** (Tizen 6.5). The UI must keep working there:

- `src/build/tailwind-tv.ts` (registered in `bunfig.toml`) lowers Tailwind's output with Lightning CSS to
  Chrome 108 / Safari 16.4 / Firefox 115: without it, Tailwind v4's native CSS nesting makes every
  `hover:` / `focus:` / `disabled:` utility silently do nothing on the TV. **Restart the dev server after
  changing `bunfig.toml`.**
- `global.css` redefines the used palettes in hex (Chrome 108 has no `oklch()`); no `color-mix()`-based
  opacity modifiers (`bg-black/50`); no container *style* queries, `subgrid`, `font-size-adjust` or `linear()`.
- Icons are inline SVG (`lucide-react`); fonts (Inter, Plus Jakarta Sans, JetBrains Mono; Latin subsets)
  are served by m7d at `/fonts/*` and registered in `src/public/lib/fonts.ts`.
- UI work follows Chrome's Modern Web Guidance skill (`~/.claude/skills/modern-web-guidance`) with this
  Chrome 108 floor as the custom browser-support policy.

## Notes

- **One sdb client at a time.** The TV accepts a single sdb connection. m7d holds it only while a command
  runs and releases it after `SDB_IDLE_RELEASE_MS`. If you run the `sdb` CLI on this machine, its server keeps
  the slot and m7d answers `409`; free it with `sdb kill-server`.
- The remote-control pairing token lives in `.data/tv-remote.token`. If it is deleted, the TV shows an
  "Allow" prompt for `m7d` on the next power-off.
- `.env` and `.data/` hold secrets and are gitignored. `.data/yt/ca/` is the CA the TV trusts: keep it
  when moving m7d (a new CA means running YouTube m7d's setup again).

## Develop

```sh
bun run typecheck
bun test
```

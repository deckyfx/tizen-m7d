# Tizen M7 Toolkit — Plan

Personal project for ONE device. No multi-model support, no public release.

## Decisions (2026-11-23)

- **No root.** All features must work with a normal Developer Mode connection.
  (`samsung-tv-root` is only validated on QN90B/QN90F; the M7 is not a target.)
- **Host PC IP stays `192.0.2.102`**, the always-on homelab (this machine). A server daemon there
  (`m7d`) is the single owner of the TV's one sdb connection. (This replaces the earlier
  "Host PC IP = 127.0.0.1 + relay on the TV" idea.)
  - Windows laptop `192.0.2.100`, phone and other devices reach the TV through `m7d`'s web UI
    ("Apps2Samsung as a web service"). The A2S desktop app can no longer reach the TV directly.
  - Signing: a **new partner cert created on the homelab** with `apps2samsung-cli cert --prepare --partner`
    (user does the Samsung sign-in). Laptop-installed apps then update only by uninstall + reinstall.
  - The TV app is a thin client. It calls `m7d` over the LAN and shows its diagnosis, and keeps
    local-only fallbacks (kill via `tizen.application`) for when the homelab is down.
- Target only this TV; no compatibility code for other models/Tizen versions.

## Target device (verified 2026-11-23)

| Item | Value | Source |
|---|---|---|
| Model | Samsung 32" Smart Monitor M7, `LS32BM700UEXXD`, platform `22_NIKEL_SMT` | `:8001/api/v2/` |
| Tizen | **6.5** (`platform_version:6.5`), **armv7, 32-bit** | `sdb capability` |
| sdbd | 2.2.31, plugin `3.8.5_TV_REL`; `intershell_support:disabled` (no free shell, only `0 <cmd>` vendor commands); `sdbd_rootperm:disabled`; push/pull supported but app dirs and `/home/owner/share` refuse pull | `sdb capability` |
| IP | 192.0.2.130 (wireless), panel 3840x2160; Tizen DUID `<DUID>` | REST, A2S CLI |
| Developer mode | ON, Host PC IP currently `192.0.2.102` (temporarily, for recon) | sdb works |
| DRM | PlayReady=false, Widevine=false | REST `isSupport` |
| Open ports | 8001/8002 (remote API), 8080 (DIAL), 26101 (sdbd), **8101 (TizenTube proxy — bound 0.0.0.0, reachable from LAN!)** | nmap |

Installed third-party apps (`sdb shell 0 vd_applist`):

| App ID | Name | Version | Note |
|---|---|---|---|
| `xvvl3S1TT1.TizenTubeStandalone` | TizenTube | 2.1.1 | Cobalt + proxy mode |
| `TTStartApp.Start` | TizenTube FARA RECLAME | 1.0.3 | [LemoTwist/tizentube-launcher](https://github.com/LemoTwist/tizentube-launcher) (GPL-3.0), cloned to `references/` |
| `xvvl3S1bvH.TizenBrewStandalone` | TizenBrewNextGeneration | 2.0.5 | |
| `AprZAARz4r.Jellyfin` | Jellyfin | 0.1.0 | |
| `CYL8nSudXE.m3uIPTV` | M3U IPTV | 3.0.10 | store app |
| `111299001912` / `9Ur5IzDKqV.TizenYouTube` | YouTube | 2.1.513 | stock |

## How TizenTube (Cobalt mode) works on this TV

```
[TizenTube icon] --nativeID--> Samsung Cobalt player (com.samsung.tv.cobalt-yt)
                                 --proxy=http://127.0.0.2:8101
                                        |
                  xvvl3S1TT1.StandaloneService (Node.js, on-boot, auto-restart)
                    - MITM youtube.com with own CA (/home/owner/share/tizentube-ca.*)
                    - injects userScript.js from jsDelivr into /tv
                    - tunnels everything else
```

`index.html` never runs in this mode (nativeID launches Cobalt directly), so nothing
starts the service except `on-boot`.

## Root causes of flakiness (from code: references/TizenTube/standalone/service)

1. **Startup race**: `cobaltProxyServer.js` generates 2× RSA-2048 keys *before* `listen(8101)`
   (~3–4 s on the TV CPU). Cobalt starts first and shows "Network error occurred".
2. **Service often not started after cold boot**: `on-boot="true"` is unreliable (upstream #695, #712).
   Nothing else starts it in Cobalt mode. (On the 2026-11-23 reboot it *did* come up.)
3. **Runtime CDN dependency**: the userscript is loaded from `cdn.jsdelivr.net/npm/@foxreis/tizentube` with
   `?ver=Date.now()` on every launch, so it depends on the network and the version is unpinned.
4. **Stale Cobalt content**: `cobaltSetup.js` copies Samsung's Cobalt content once and never refreshes
   it after a firmware update of YouTube.
5. **Unexplained mid-session proxy death** (coldstart-fix #4): there is no supervisor or health check.
6. **Security**: the proxy listens on `0.0.0.0:8101`, so it is an open HTTP/CONNECT proxy for the whole LAN.

7. **Two competing proxies**: `TTStartApp` ships an *unmodified* copy of the TizenTube 2.1.1 service
   (`TTStartApp.Service`, on-boot + auto-restart). It and `xvvl3S1TT1.StandaloneService` both bind
   8100/8101. The loser crashes with EADDRINUSE and auto-restart loops it. Both copies still have bugs 1, 3 and 6.

Reference fixes:
- `references/tizentube-cobalt-coldstart-fix`: fixes 1 and 2 (listen first, lazy + cached host certs, own launcher).
- `references/tizentube-launcher`: fixes 2. It starts its own service copy, kills any stale TizenTube/Cobalt
  instance that started without the proxy, then launches TizenTube.

## App kill / cold restart (non-root)

- Apps2Samsung (PC side): `sdb shell 0 was_kill <appId>` (found in its binary). Same family:
  `0 vd_applist`, `0 execute <svc>`, `0 debug <app>`, `0 was_execute`, `0 vd_appinstall`, `0 getduid`.
  These are sdbd vendor RPCs and need no root.
- On the TV (proven by TizenBrew): with Host PC IP = `127.0.0.1`, a Node service speaks the
  sdb/ADB protocol (`adbhost`) to `127.0.0.1:26101` and runs `shell:0 …`. So the same `was_kill`
  can run from inside the TV.
- Cold restart = `0 was_kill <appId>` → wait until gone → launch.
- Sandbox facts (coldstart-fix, Tizen 9; re-verify on 6.5): apps can't launch another package's
  *service*; apps can't reach other apps on `127.0.0.1` but can on `127.0.0.2` or the LAN IP.

**Verified on the M7 (2026-11-23), from the homelab:**

| Action | Command | Result |
|---|---|---|
| Launch | REST `POST :8001/api/v2/applications/<appId>` (no pairing) | `200`; app running |
| Kill | `sdb shell 0 was_kill 9Ur5IzDKqV.TizenYouTube` (Tizen app id, not store id) | `terminate app …` in 40 ms; stopped |
| Close | REST `DELETE :8001/api/v2/applications/<appId>` on a **running** app | `true`; stopped (`500` = not running) |
| Status | REST `GET :8001/api/v2/applications/<appId>` | `{running, visible, version}` |

- Launching TizenTube also makes stock YouTube `111299001912` report `running:true`: both share the Cobalt
  engine. Closing TizenTube stopped the engine too.
- On-TV option (for m7kit's offline fallback): `tizen.application.kill(contextId)` with `appmanager.kill`.
  `TTStartApp` uses it on another package, and our partner cert grants the privilege.
- m7d uses REST for launch/close/status (works from any LAN device) and `was_kill` as the hard kill.

## TV reboot (non-root) — replaces pulling the plug

| # | Method | Works when UI frozen? | Status |
|---|---|---|---|
| R1 | **Hold Power on the physical remote ~5–10 s** until the Samsung logo appears | yes | try now; zero code |
| R2 | **Software long-press**: Samsung remote WebSocket API (`wss://:8002`, `ms.remote.control`, `Cmd:"Press"` → 8 s → `"Release"` on `KEY_POWER`), `tools/tv-remote/longpress.ts` | no (needs a responsive system) | **Tested 2026-11-23: full power-OFF, not a reboot.** Network (ping) gone ~15 s after release, and the TV stayed off until turned on by hand. That power-on was a cold boot (on-boot proxy came up). Pairing: one "Allow" prompt, token saved. **Needs a wake method (R3) to become a reboot.** |
| R3 | Wake-on-LAN | — | **Dropped**: the M7 has no "Power On with Mobile" setting. |
| R4 | Wi-Fi **smart plug** (automated "pull the plug"), triggered from a phone or Home Assistant | yes | hardware fallback |

**Decision (2026-11-23): no automatic reboot.** m7d offers **"Power off (cold)"** = R2 long-press. It is a full
shutdown (network gone), so the user's next power-on with the remote is a real cold boot: a software "pull the plug".
For a fully frozen TV: R1 (hold Power on the remote) or R4 (smart plug).

Ruled out: root `reboot` (decision), Samsung B2B `b2bapis.b2bcontrol.rebootDevice()` (signage-only
privilege), sdbd vendor reboot command (none in any reference; `0 help` prints nothing).
If the WS remote API needs pairing, the TV shows an "Allow" prompt once; the token is then stored by the service.

## SDB relay (on the homelab, inside m7d)

Needed because sdbd allows only one host connection, and `m7d` holds it.

- **Verified on the M7 (2026-11-23, `tools/sdb-probe/probe.ts`)**: one host connection at a time. The 2nd and 3rd
  concurrent sockets get `ECONNRESET` right after connecting; a new client is accepted as soon as the previous
  one closes. sdbd answers CNXN with version `0x2000000`, banner `device::LS32BM700UEXXD::0`.
- **Relay concept verified**: `tools/sdb-probe/pipe-relay.ts` on this PC (plain pipe to TV:26101). Through it,
  `sdb capability` and `0 vd_applist` both work. Gotcha: the sdb client auto-attaches local ports
  26101–26xxx as `emulator-<port>`, which grabs the single slot. Bind the relay to the LAN IP, not loopback.
- The final relay **multiplexes**: one upstream, client stream ids rewritten, CNXN answered locally (port of
  Vetro `rooting/service/sdb-tunnel.js`, MIT). It opens the upstream on demand and releases it after an idle
  grace period, so tools that dial TV:26101 directly (apps2samsung-cli) can run when `m7d` is idle; `m7d`
  serializes those jobs with its own sdb use.
- Security: the relay gives full developer access. Admit only allowlisted IPs (`.100` + any others), with a toggle in the web UI.
- Still to verify: the A2S Windows desktop app through `192.0.2.102:26201` (it may expect port 26101 on the
  TV's IP; fallback: the web UI covers its features); push/install of large .wgt files through the relay.

## Target architecture

```
 phone / laptop / any browser ──HTTP──┐
                                      ▼
            ┌──────────── m7d on homelab 192.0.2.102 (Bun, systemd) ────────────┐
            │ YouTube MITM proxy :8101 (only TV IP admitted; CA key stays here)   │
            │   + bundled pinned userscript                                       │
            │ sdb client + multiplexer (single owner of TV:26101), relay :26201   │
            │ TV REST/WS client (status, launch, keys, power long-press)          │
            │ apps2samsung-cli wrapper: catalog, install, uninstall, sign (--json) │
            │ HTTP API + web UI ("Apps2Samsung as a web service" + task manager)  │
            └─────────────────────────────────┬───────────────────────────────────┘
               Cobalt traffic via proxy │     │ sdb :26101 + REST :8001/8002 + WoL
                                        ▲     ▼
            ┌─────────────────────── TV 192.0.2.130 ─────────────────────────────┐
            │ YouTube shim: nativeID cobalt-yt,                                     │
            │   --proxy=http://192.0.2.102:8101 --content=/home/owner/share/m7-content │
            │   + one-shot ES5 setup service (run by m7d with `0 execute`):         │
            │     copy Cobalt content if missing/stale, install our CA cert, exit   │
            │ m7kit app (thin): "Start YouTube" + diagnosis panel → calls m7d       │
            │   local fallback: tizen.application kill/launch; stock YouTube if     │
            │   the homelab is down                                                 │
            └──────────────────────────────────────────────────────────────────────┘
```

**Decision (2026-11-23): the YouTube proxy runs on `m7d`, not on the TV.** No listening ports on the TV at all.
- This removes root causes 1 (keygen race), 2 (service not started), 5 (proxy death), 6 (open proxy on the TV)
  and 7 (two proxies fighting). Cause 3 is gone too: the userscript is bundled and pinned, and updates need
  no TV reinstall. Cause 4 is handled by the setup service, which `m7d` triggers when the YouTube app version changes.
- Cobalt trusts the CA through the `ssl/certs` folder inside its `--content` dir (how TizenTube works today).
  Only the CA **public** cert goes to the TV. The private key never leaves the homelab.
- Copying Samsung's Cobalt content needs a process on the TV, because sdb has no shell. Verified 2026-11-23:
  sdb **push** to `/home/owner/share/tmp/sdk_tools/` works, but **pull** is refused. Hence the tiny one-shot setup service (ES5, no ports).
- Security: the proxy admits only `192.0.2.130`, so it is not an open proxy on the LAN.
- Cost: YouTube depends on the homelab. If `m7d` is down, Cobalt shows "Network error". m7kit checks
  `m7d` health first and falls back to stock YouTube (`111299001912`, with ads).
- Requirement: `192.0.2.102` must be fixed (DHCP reservation), because it is baked into the shim's config.xml.
- Video goes through the homelab via CONNECT tunnels (TV Wi-Fi → AP → wired homelab). Check 4K throughput.

**m7d (homelab, Bun)** — the brain:
- YouTube proxy (port of TizenTube's `cobaltProxyServer.js`: listen-first, cached host certs, bundled userscript).
- sdb client + multiplexed relay; reconnects when the TV sleeps or reboots.
- Task manager: list (`0 vd_applist` + REST running state), kill (`0 was_kill`), cold restart (kill → launch).
- Reboot: R2 WS long-press, WoL (R3), smart-plug hook (R4) later.
- "Apps2Samsung as a web service": wraps `apps2samsung-cli` (`catalog`, `installed`, `install <name|file>`,
  `uninstall`, `launch`, `update`), with .wgt upload. This replaces the laptop's A2S desktop app, which
  can't reach the TV while Host PC IP is `.102`.
- Setup orchestration: push the CA cert, `0 execute` the shim's setup service, read the result.
- HTTP API + web UI with auth (token/password), LAN only. The same API serves the TV app.

**m7kit (TV, web app)**: thin client. "Start YouTube" checks `m7d` health, then launches the shim (or stock
YouTube if `m7d` is down). The diagnosis/task-manager panel renders `m7d` data. Offline fallback: local `tizen.application`.

**Userscript**: fork of `TizenTube/mods`, built locally, pinned, served by `m7d`.

TV-side constraint: services run on an old Node (Vetro: Node 4.4 on Tizen 4/5.5, Node 12 on Q80A Tizen 6.0;
M7 6.5 to measure). The only TV service is the one-shot setup job, written in plain ES5.

## Signing certificate

The A2S CLI keeps certs as `Certificate/<profile>/{author.p12,distributor.p12,password.txt}` and imports either
an `.a2scert` backup or that folder (`apps2samsung-cli cert --import <file> --tv 192.0.2.130`).
- Laptop (desktop app has no export button): look in `%APPDATA%\Apps2Samsung\Certificate\` (.NET maps the same
  folder to `~/.config/Apps2Samsung/Certificate` here) and `Documents\Apps2Samsung\Certificate backups\`.
- **Preferred: import the laptop's cert.** Apps installed from the laptop (Jellyfin, TizenBrew, TizenTube,
  TTStartApp) can then still be *updated* in place from the homelab (same author).
- Fallback: a new partner cert here: `apps2samsung-cli cert --prepare --partner --tv 192.0.2.130`
  (Samsung sign-in). Our new packages work fine with it. Laptop-installed apps then need uninstall + reinstall to update.
- These are signing keys: copy privately over the LAN, keep them out of the project/git.

## Phases

0. **Recon** — [x] sdb, capability, applist, connection limit, relay concept, push works / pull refused.
   - [x] Partner certificate on the homelab: profile "<certificate profile>", valid 2026-11-23 → **2027-11-23**, covers DUID `<DUID>`; store `~/.config/Apps2Samsung/Certificate`, backup `~/Documents/Apps2Samsung/Certificate backups`.
   - [x] Live tests: `0 was_kill` + relaunch YouTube; REST launch/close; R2 WS long-press (= power off).
1. **m7d core** ✅ (2026-11-23, `m7d/`): Bun + Elysia + React + Tailwind + Eden. Native sdb client (on-demand,
   idle release), TV REST client, remote WS client (power-off), task manager (list/launch/close/kill/cold
   restart), token auth, web UI. 12 tests (incl. a real-socket API test); typecheck clean.
   Gotcha (fixed): `t.UnionEnum` in route params breaks every request under real `Bun.serve`
   (Elysia 1.4.32 / Bun 1.4.5, "Attempting to change configurable attribute…"); use `t.Union(t.Literal…)`.
   `app.handle()` tests don't catch it, so the API test listens on a real port.
2. **A2S web service** ✅ code-complete 2026-11-23 (TV test scheduled 13:00): every relevant
   Apps2Samsung desktop view rebuilt in the dashboard (Catalog + app sheet with schema-driven
   `--set` form, Installed/updates/backup, Install file, Toolbox, Remote, Jobs, Settings), from a
   view-by-view spec of the GPL desktop source (read via GitHub API, not cloned). JSON contracts
   taken from `Apps2Samsung.Cli/Commands/*.cs`. Out of scope: TV-Store, TV picker, language,
   self-updater, Jellyfin/TizenTube/ImmiTV custom settings (not in the CLI), debug console,
   service-menu key sequences. To verify on the TV: `installed`/`leftovers`/`tv save` JSON shapes,
   whether the CLI releases the sdb slot cleanly after each run, install + Retry anyway.
3. **Homelab YouTube** ✅ working on the TV 2026-11-23 (`m7d/src/yt/`, dashboard page "YouTube"):
   - Proxy `:8101` (node:net, TV IP + `YT_PROXY_ALLOW` only) → `www.youtube.com`/`youtube.com` CONNECTs go to a
     Bun TLS server on a unix socket (SNI certs from our openssl CA), replayed with `fetch` (`decompress: false`,
     `redirect: manual`); `/tv` gets the pinned userscript tag + relaxed CSP; all other hosts are raw tunnels.
   - Userscript = npm `@foxreis/tizentube` 1.15.2 pinned in package.json, served from memory.
   - Shim `M7dYouTube.YouTube` 1.0.0 ("YouTube m7d", icon drawn in code), built + signed (Partner) + installed
     from m7d in 2.8 s. Setup service `M7dYouTube.Setup` started by `sdb shell 0 execute` **works**; it reports by
     HTTP POST. Report: Node **v12.16.3** on the TV, 144 files / 5.3 MB copied from
     `/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content` in 0.5 s, CA hashes `00aef9f7.0`, `6ea62e3b.0`.
   - Open YouTube: cold restart in 0.46 s; 35 youtube.com requests decrypted (CA trusted), userscript injected and
     fetched, video tunnelled from googlevideo; 0 upstream errors. Hot reloads cut tunnels; Cobalt reconnects in ~25 s.
   - Lessons: an `immutable` userscript URL got cached by Cobalt for a year (now `no-cache` + ETag, `?sha=`);
     the TV REST API occasionally resets a kept-alive connection (one retry on a fresh connection).
   - Confirmed by the user on screen; 126 MB streamed with 0 errors. Shim 1.0.1: square icon only (the 16:9
     banner was squeezed into the square app tile); the setup service now deletes old TizenTube leftovers
     (`/home/owner/share/tizentube-content` removed 2026-11-23; only paths under /home/owner/share/).
   - The user removes TizenTube, TTStartApp and TizenBrew by hand.
4. **TV uses the dashboard in its own browser** (decision 2026-11-23, replaces a separate m7kit app):
   `org.tizen.browser` opens `http://192.0.2.102:8787`. m7d recognises the TV by source IP (+ user agent),
   hands it the token (`TRUST_TV_IP`), and switches to a 10-foot layout (bigger rem root, tiles,
   arrow-key focus navigation, "this dashboard" marker on Browser).
   No better browser is possible: every Tizen web app uses the firmware's web engine.
   **TV browser = Chrome 108** (UA `Mozilla/5.0 (Linux;) AppleWebKit/537.36 … Chrome/108.0.5359.1`, no "Tizen"
   token, so detection relies on the source IP). The JS bundle runs fine. Tailwind v4's `oklch()` palette
   (needs Chrome 111) rendered colorless, so it was fixed by redefining the used palettes in hex in
   `src/public/global.css`. `/api/diag` = ES5 feature-check page (TV report visible in `/api/tv`).
   TV report: oklch ❌, color-mix ❌ (avoid Tailwind `/opacity` color modifiers), @layer/@property/gap ✅,
   ES modules / `?.` / `??=` / class fields / async ✅; viewport 1536x749 @ DPR 1.25. User confirmed it looks right.
   Remote "open URL" (`ed.apps.launch` with NATIVE_LAUNCH/DEEP_LINK, tizen or store id) does nothing on
   the M7, so "Show on TV" was removed; open/bookmark the URL in the TV browser by hand.
   Optional later: tiny kiosk .wgt (same engine) for Smart Hub tile + remote-key capture.
   **TV test 2026-11-23 ~11:50, all passed:** tv-check 0.5 s; installed 1.0 s (9 apps); the CLI releases the sdb slot
   cleanly (task manager answers right after); leftovers 2.9 s (15 stale packages, 35 MB); leftovers-delete
   job; `tv save` (profile format: `apps[]{name, appId, packageFile, version, uncertain?}`); real install +
   uninstall of "App Manager" (installs as "Apps", 9KN9k5Eqgh.Apps) with live % progress, signed Partner.
   Fixed during the test:
   - CLI defaulted to a *Public* cert for its debug agent and hung on a browser sign-in →
     `~/.config/Apps2Samsung/settings.json` `{"CertificatePreference":"Partner"}`; m7d now kills a run at the
     "Samsung account sign-in is needed" line and sets `BROWSER=true` (no sign-in window on the homelab).
   - First leftovers call after the agent install raced its inspector ("Unable to connect to the remote
     server") → one automatic retry after 1.5 s.
   - Stopped runs no longer wait on pipes held open by grandchild processes.
   - The TV marks *all* apps removable (even YouTube/Browser): Installed now labels Samsung apps
     (`vd_applist type=normal`) and says so in the uninstall confirmation.
   - Restore can now pick individual apps from a saved list.
   Not exercised on the TV: "Retry anyway" (needs a real pre-install stop; covered by fake-CLI tests).
4b. **Daylight redesign** (2026-11-23): full-width shell (sidebar / phone tab row), light theme, Inter +
   Plus Jakarta Sans + JetBrains Mono (self-hosted), Lucide icons, pointer cursor on all clickables,
   hover/press/focus-visible states, guide-based D-pad navigation. Found + fixed: Tailwind v4 nesting
   silently broke all variants on the TV (Lightning CSS lowering plugin `src/build/tailwind-tv.ts`).
5. Hardening: multiplexed `:26201` relay (raw sdb from other machines), logs/history, WoL/smart plug,
   auth polish, Docker image (needs `openssl` + `zip`). (Cobalt refresh on YouTube update: done in Phase 3.)

## Open questions

- Deploy `m7d` as a systemd service (Bun single executable) or in Docker? (default: systemd)
- Is `192.0.2.102` a DHCP reservation/static?
- Remove TizenBrew too?

## Layout

- `references/`: shallow clones (read-only): TizenTube, TizenBrew, TizenBrewInstaller,
  tizenbrew-device-manager, tizentube-cobalt-coldstart-fix, tizentube-launcher (TTStartApp),
  vetro (only `rooting/service/sdb*.js` and the non-root app service matter; root parts are out of
  scope). Big sources are excluded on purpose.
- `tools/apps2samsung/apps2samsung-cli`: v3.3.1 linux-x64.
- `backup/`: empty for now (pull refused).

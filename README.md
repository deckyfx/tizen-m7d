# tizen-m7d

Make a Samsung Tizen TV (built and tested on a **Smart Monitor M7**, Tizen 6.5) easier to live with,
**without root**, from an always-on box on the same network:

- **Task manager**: see what runs, close, hard-kill or cold-restart any app (e.g. a stuck YouTube).
- **Power off for real**: a cold shutdown instead of pulling the plug.
- **Apps2Samsung as a web service**: catalog, install, update, uninstall, backup/restore, signing,
  from any browser, including the TV's own.
- **Ad-free YouTube without a flaky on-TV proxy**: a small "YouTube m7d" app starts Samsung's YouTube
  engine (Cobalt) with a proxy that runs on the box, which injects the pinned TizenTube userscript.

| Folder | What |
| ------ | ---- |
| [`m7d/`](m7d/README.md) | The daemon: Bun + Elysia + React, compiled into one binary. Start here. |
| `deploy/` | `docker-compose.yml` for the always-on box. |
| `tools/` | Small probes used while researching the TV (sdb, remote control). |
| [`PLAN.md`](PLAN.md) | Research notes: how the TV behaves, decisions, test results. |

## Quick start (Docker)

1. On the TV: Apps → type `1 2 3 4 5` → Developer mode **On** → **Host PC IP** = this box → restart the TV.
2. Run `deploy/docker-compose.yml` (set `M7D_TOKEN`; host networking).
3. Open `http://<this box>:8787` → Settings → TV connection → enter the TV's IP.
4. Signing certificate for installs: `docker exec -it tizen-m7d apps2samsung-cli cert --prepare --partner --tv <TV IP>`
   (Samsung sign-in in a browser on the box), or mount an existing `~/.config/Apps2Samsung`.

## Credits

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) (CLI, GPL-3.0) does the installing and signing;
the YouTube userscript is [TizenTube](https://github.com/reisxd/TizenTube) (`@foxreis/tizentube`, GPL-3.0).

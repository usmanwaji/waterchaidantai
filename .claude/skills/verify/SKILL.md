---
name: verify
description: Drive the waterchaidantai / naraflood flood-watch website (static HTML pages, Thai UI) in headless Chromium the way a phone user does, and capture screenshots plus a JSON report as proof. Use to prove a change to any page (check.html, index.html, map.html, shelter.html, the shared tab bar) works in the real browser, not just that the HTML is edited.
---

# Verify the site in a real browser

The site is plain static HTML/JS served from the repo root, no build step. Most users are on phones, so the driver defaults to a 390x844 touch viewport. Pages pull live data from outside hosts (ThaiWater, Open-Meteo, Supabase, the Cloudflare `*-proxy` workers, Leaflet from unpkg, supabase-js from jsDelivr). Each card is meant to degrade to its own offline message when its source fails, so a missing host is a fact about the network, not automatically a bug.

All commands run from the repo root.

## Launch

```sh
.claude/skills/verify/serve.sh start
```

Starts `node .devserver.mjs` on `http://127.0.0.1:8788` and returns once `index.html` answers 200. It prints `ready at http://127.0.0.1:8788 (pid N)`. The port is fixed in `.devserver.mjs`, so only one instance can run. If something it did not start already holds 8788, `start` refuses: that is probably the user's own server, so don't drive it or kill it.

## Doctor

```sh
.claude/skills/verify/serve.sh doctor
```

Read-only. Checks that the server is the one this script started, that it answers, that it serves this checkout (it compares `js/tabbar.js` with the copy on disk), and that Playwright is installed. It then lists which outside data hosts this machine can reach. Run it first, and again whenever a page looks wrong. An `unreachable` host means every card fed by it will show its offline state, so judge those cards against that state.

In Claude Code cloud sessions the default network policy blocks `cdn.jsdelivr.net`, `unpkg.com`, `api.open-meteo.com`, `*.supabase.co` and the `*.workers.dev` proxies. `api-v3.thaiwater.net` is allowed. Pages that build a Leaflet map (shelter.html, map.html, parts of index.html) stop running their script at the first `L.` call when unpkg is blocked. To prove those pages, add the hosts to the environment's allowed domains, or verify on a machine with open internet.

## Drive

```sh
node .claude/skills/verify/drive.mjs <page.html> [steps.mjs] [--wide]
```

- Opens the page in a fresh browser context, so no service worker or localStorage carries over from earlier runs. Waits up to 15 s for the network to go idle, then takes `01-loaded.png`.
- Then runs the steps module, if you give one. A steps module default-exports `async ({ page, shot, log }) => {}`: `page` is a Playwright page, `shot(name)` saves the next numbered PNG, and `log(key, value)` prints the value and records it in the report.
- `--wide` switches to a 1280x900 desktop viewport. Some controls only exist at one width: check.html shows `#ampSel` at 640 px and below and `#provSel` above it.
- Exits 0 when every step ran and 1 on any thrown error or timeout.
- Do not pass Playwright's `proxy` launch option. Chromium already uses the environment proxy for outside hosts and connects to 127.0.0.1 directly. With the option set, localhost goes through the proxy, which answers 405.

Ready-made steps live in `steps/`, one per mapped feature. See `features/README.md` for which steps file proves which feature. Write a new steps file for a new flow rather than one-off inline scripts, so the next run can repeat it.

Prefer stable handles: element ids (the pages use them heavily, e.g. `#ampSel`, `#riskLv`, `#tabMore`), ARIA roles and names (the tab bar is `navigation` named `เมนูหลัก`), and visible Thai labels. Never use coordinates.

## Evidence

Each run writes to `shots/verify/<UTC timestamp>-<page>/`. The repo already ignores `shots/` in git. A run folder holds:

- `NN-<name>.png` screenshots, in order.
- `report.json` with the run's status, every `log` value, and errors in separate buckets:
  - `blocked`: hosts the network policy refused (Chromium reports `ERR_TUNNEL_CONNECTION_FAILED`).
  - `failed`: every other failed request. These are worth investigating.
  - `pageErrors`: uncaught exceptions in the page.
  - `console`: console errors.

Proof standards:

- Drive the control a user touches, such as picking from the select or tapping the tab. Don't call page functions like `run()` or set variables from `evaluate`.
- Capture before and after: the `01-loaded` shot plus a shot after the action, and `log` the values that changed, not only the final screen.
- Read the text a user sees (card contents, `aria-current`, `aria-expanded`), not internal state.
- When a card shows an offline message, check `blocked` before calling it a bug. An offline message for a host that `doctor` called reachable is a real finding.
- For pages that write to Supabase (shelter add/edit, people.html, admin.html), a proof needs the row to land in Supabase. That needs the network and a signed-in account, so ask the user instead of writing to the live project.

## Cleanup

```sh
.claude/skills/verify/serve.sh stop
```

Stops only the server whose pid `start` recorded in `${TMPDIR:-/tmp}/waterchaidantai-verify/`. Never kill node processes by name, because the user may be running their own server. Browsers close at the end of each `drive.mjs` run. Evidence in `shots/verify/` is never deleted by cleanup; remove old runs by hand when no longer needed.

## Helpers

| File | Run as |
| --- | --- |
| `serve.sh` | `.claude/skills/verify/serve.sh start\|doctor\|stop` |
| `drive.mjs` | `node .claude/skills/verify/drive.mjs <page.html> [steps.mjs] [--wide]` |
| `steps/check-district.mjs` | `DISTRICT=ตากใบ node .claude/skills/verify/drive.mjs check.html .claude/skills/verify/steps/check-district.mjs` |
| `steps/tabbar-more.mjs` | `node .claude/skills/verify/drive.mjs index.html .claude/skills/verify/steps/tabbar-more.mjs` |
| `steps/shelter-summary.mjs` | `node .claude/skills/verify/drive.mjs shelter.html .claude/skills/verify/steps/shelter-summary.mjs` |

Set `PLAYWRIGHT_MODULE` to the path of Playwright's `index.mjs` if it is not at `/opt/node22/lib/node_modules/playwright/index.mjs`.

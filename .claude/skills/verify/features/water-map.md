# Water map (map.html)

The main live map of water levels, rain, radar, dams, CCTV and risk layers across the southern border provinces, with a station list and summary tiles.

## Sub-features

- Leaflet map `#map`, with a sidebar `#sidebar` holding the summary `#summary`, search `#search` and station list `#list`.
- Layer toggles in `#controls`: `#lyWL` water level (on by default), `#lyRain`, `#lyRadar`, `#lyDam`, `#lySea`, `#lyRisk`, `#lyCctv`, `#lyDdpm`, `#lyTele`. The ONWR layers `#lyOnwrRadar`, `#lyOnwrAccum`, `#lyOnwrRain` and `#lyOnwrSites` go through onwr-proxy.
- `#btnRefresh`, `#btnHelp` (`#helpModal`), `#btnReport`, the DDPM camera modal `#ddpmModal`, and the language switch `#langSw`.

## How to get to it (user POV)

Tap the แผนที่น้ำ tab.

## Driving it with drive.mjs

No steps file yet. A first one should wait for `#list` to fill, log the number of stations and the `#summary` tiles, then toggle `#lyRain` and screenshot. Water-level data comes from ThaiWater, which the sandbox allows, but the map itself needs unpkg.com for Leaflet. Run `serve.sh doctor` first.

## Gotchas

- With unpkg.com blocked, `L is not defined` stops the page script, so the list and map stay empty.
- The ONWR layers show "โหลดข้อมูล สทนช. ไม่สำเร็จ" when onwr-proxy is unreachable or not deployed (see DEPLOY.md §1.1); the other layers keep working.

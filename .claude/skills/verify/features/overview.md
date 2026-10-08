# Situation overview (index.html)

The home page: a hero card with the current state for the user's place, the hourly rain, water-level direction, station list, TMD 7-day forecast, district rain forecast map, radar and night-cloud imagery, and a visit counter.

## Sub-features

- Hero `#hero`: the place `#heroPlace` (set with `#heroLocBtn` or `#heroSetLoc`), the gauge `#heroGaugeK`/`#heroPct`, rows `#heroRows`, and share `#heroShare`.
- District chips `#ampChips` and `#wtaChips` choose the area for `#hourRow` and `#nowBox`.
- Water direction card `#dirCard` (rising, falling, flat counts) and station list `#stList`.
- TMD cards `#tmdCard` (7-day) and `#drCard` (district rain map `#drMap`, via tmd-proxy `/riskmap`).
- Radar `#radarCard` and the night-cloud player `#ncCard`/`#ncSlider`/`#ncPlay`.

## How to get to it (user POV)

Open the site root, or tap the สถานการณ์ tab.

## Driving it with drive.mjs

No steps file yet. `node .claude/skills/verify/drive.mjs index.html` loads it and screenshots the top. A first steps file should tap a `#wtaChips .chip` (they carry `data-wamp` with the district name), then log `#whereAmp` and `#hourRow` and screenshot them.

## Gotchas

- This page uses the most outside hosts of any page: Open-Meteo, ThaiWater, the tmd-proxy and ddpm-proxy workers, satellite/radar image hosts, semet.uk, and unpkg. In the cloud sandbox most cards show their offline state.
- `#wtaChips` scrolls sideways. Scroll the chip into view before tapping it.

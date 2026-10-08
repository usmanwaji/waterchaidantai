# Tab bar and more menu (js/tabbar.js)

The same bottom navigation is injected into every page: four tabs plus a "เพิ่มเติม" button that opens a sheet with the rest of the pages. One source of truth for navigation, so a mismatch between pages is a bug.

## Sub-features

- `nav.tabbar` (role `navigation`, name `เมนูหลัก`): tabs สถานการณ์ (index.html), แผนที่น้ำ (map.html), พื้นที่ฉัน (check.html), ศูนย์พักพิง (shelter.html). The current page's tab has `aria-current="page"`.
- `#tabMore` toggles `.sheet` (role `dialog`, name `เมนูเพิ่มเติม`) and `.sheet-scrim`. `aria-expanded` follows the open state.
- Escape and a tap on the scrim close the sheet. Escape returns focus to `#tabMore`.
- Sheet groups: คาดการณ์และย้อนหลัง (forecast, history, repeat), ลงมือ (route, resources, alert) and สำหรับเจ้าหน้าที่ (eoc, people, admin, stats; stats opens for admins only). sim.html is commented out on purpose.

## How to get to it (user POV)

Visible at the bottom of any page on a phone. Tap a tab to switch page, or tap เพิ่มเติม for the rest.

## Driving it with drive.mjs

```sh
node .claude/skills/verify/drive.mjs index.html .claude/skills/verify/steps/tabbar-more.mjs
```

The step logs the tab labels and the current tab, opens the sheet and logs its links, presses Escape and checks `aria-expanded` is back to `false`, then taps แผนที่น้ำ and confirms map.html loads with its own tab marked current. To check another page's bar, pass that page instead of index.html.

Proven end state (2026-10-08): tabs `สถานการณ์, แผนที่น้ำ, พื้นที่ฉัน, ศูนย์พักพิง`, current `สถานการณ์`; the sheet listed 10 links (forecast … stats); `aria-expanded` went true then false; the tap landed on `/map.html` with `แผนที่น้ำ` current.

## Gotchas

- The bar is added by JS after load. Wait for it rather than reading the static HTML.
- The bar is styled for phones; check the `--wide` layout separately if a change touches its CSS.

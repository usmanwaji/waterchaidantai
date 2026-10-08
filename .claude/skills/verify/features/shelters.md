# Shelters (shelter.html)

Temporary shelters in Narathiwat: a Leaflet map and table of shelters with coordinates, a "nearest to me" button, an official per-district summary, and add/edit forms for signed-in members.

## Sub-features

- Official summary `#officialCard`: `#offIntro` totals and `#offBody`, one row per district (13 rows) from the inline `SUMM` constant.
- Map `#map` (Leaflet) with markers. `#nearBtn` finds the nearest open shelter.
- Table `#tbody` with search `#q` and district filter `#ampSel`. Rows come from `DATA` plus Supabase.
- Member actions (sign-in through js/auth-ui.js): the `#shModal` form (`#f_name`, `#f_cap`, `#f_occ`, `#f_status` …), `#btnSave`, `#btnDel`, map-pick `#btnPick`, GPS `#btnGps`.

## How to get to it (user POV)

Tap the ศูนย์พักพิง tab in the bottom bar.

## Driving it with drive.mjs

```sh
node .claude/skills/verify/drive.mjs shelter.html .claude/skills/verify/steps/shelter-summary.mjs
```

The step waits for `#offBody tr`, logs the intro, the row count (expect 13) and the first row, counts `#tbody` rows, and screenshots the summary card.

Unproven here: on 2026-10-08 the cloud sandbox blocked unpkg.com, so `L` was undefined. The page script threw at `L.map` (around shelter.html:393) before `renderOfficial()` ran, and the step timed out waiting for `#offBody tr`. The step needs unpkg.com reachable. Run `serve.sh doctor` first. If unpkg is unreachable, a timeout on this step is a network limit, not proof of a regression.

Do not save, edit or delete shelters during verification without the user's go-ahead: the forms write to the live Supabase project.

## Gotchas

- The whole page script depends on Leaflet loading first. With unpkg down, even the static summary table stays empty. That is also how it behaves for real users when unpkg fails.
- The `#ampSel` on this page is the table's district filter, not the one on check.html.

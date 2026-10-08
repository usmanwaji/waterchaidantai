# Check my area (check.html)

Answers "is my home at risk of flooding?" on one page. The user picks a district (phone) or province (desktop), or shares their location. The page then shows a risk level, the coming rain, the nearest water station, and the nearest open shelter.

## Sub-features

- District select `#ampSel` (phone layout, 640 px wide or less): 13 Narathiwat districts. Each maps to a centre point in `AMP_CENTER_NARA`.
- Province select `#provSel` (desktop layout): Satun, Songkhla, Pattani, Yala, Narathiwat.
- `#btnGeo` "ใช้ตำแหน่งของฉัน": uses browser geolocation and picks the nearest province.
- Result cards inside `#result`: risk `#riskLv`/`#riskDs`, rain `#rainNow` (Open-Meteo), station `#stName`/`#stBar`/`#stDs` (ThaiWater water level), shelter `#shName`/`#shBtns` (Supabase).
- Link to repeat.html (repeat-flood map) and an alert sign-up link.

## How to get to it (user POV)

Tap the พื้นที่ฉัน tab in the bottom bar, or the เช็คพื้นที่ฉัน link in the page header. Pick a district from "หรือเลือกอำเภอ".

## Driving it with drive.mjs

```sh
DISTRICT=ตากใบ node .claude/skills/verify/drive.mjs check.html .claude/skills/verify/steps/check-district.mjs
```

The step selects the district, waits for `#result` to lose `.hide`, waits until no card still shows `…`, then logs every card and screenshots the risk card. For desktop use `--wide` and select `#provSel` instead; `#ampSel` is `display:none` there. To test geolocation, grant the `geolocation` permission and set coordinates on the context in a steps file, e.g. `page.context().setGeolocation({ latitude: 6.25, longitude: 102.05 })` after `grantPermissions(['geolocation'])`.

Proven end state (2026-10-08, cloud sandbox): `#riskLv` showed a level (`🟡 เฝ้าระวัง`), `#stName` showed a real station with a filled `#stBar` and a percentage. `#rainNow` showed `ดึงพยากรณ์ไม่ได้` and `#shName` showed `ระบบศูนย์พักพิงไม่พร้อม (ออฟไลน์)`, both correct offline states because Open-Meteo and jsDelivr were blocked.

## Gotchas

- The district list is hidden on desktop and the province list is hidden on phones, so the viewport decides which select exists for clicking.
- When supabase-js can't load, the console shows `createClient`/`sb is not defined` errors. The rest of the page still works.
- The page header is sticky and covers the top of `#result` when scrolled. Scroll the card you are proving to the centre before the screenshot.
- A floating "ติดตั้งแอป" install button covers the lower-left of the screen on phones.

# Feature map

User-facing features of the site and how to prove each one with `drive.mjs`. One file per feature. A proof of a change is complete only when it covers every entry point this map lists for the feature it touches.

| Feature | Page | Steps file | Needs outside hosts |
| --- | --- | --- | --- |
| [Check my area](check-my-area.md) | check.html | `steps/check-district.mjs` | api-v3.thaiwater.net; api.open-meteo.com and Supabase for the rain and shelter cards |
| [Tab bar and more menu](tabbar.md) | every page (js/tabbar.js) | `steps/tabbar-more.mjs` | none |
| [Shelters](shelters.md) | shelter.html | `steps/shelter-summary.mjs` | unpkg.com (Leaflet), cdn.jsdelivr.net + Supabase for member data |
| [Water map](water-map.md) | map.html | none yet | unpkg.com (Leaflet), api-v3.thaiwater.net, the workers.dev proxies |
| [Situation overview](overview.md) | index.html | none yet | many; see the file |

Not mapped yet: forecast.html, history.html, repeat.html, route.html, resources.html, alert.html, eoc.html, people.html, admin.html, stats.html, sim.html (hidden from the menu), slides.html, privacy.html.

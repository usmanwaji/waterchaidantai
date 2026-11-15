# line-oa

Rich menu, tests, and helper scripts for the NaraFlood LINE OA. The design is in `LINE-OA-PLAN.md`. Deploy steps are in DEPLOY.md section "4) LINE OA". The webhook itself lives in `supabase/functions/line-webhook/`.

```bash
node --test "line-oa/test/*.test.mjs"                                   # test the webhook logic
node line-oa/setup-richmenu.mjs --dry-run                               # validate JSON + image
LINE_CHANNEL_ACCESS_TOKEN=<token> node line-oa/setup-richmenu.mjs       # install the menu
```

To change the image, edit `richmenu.html` and re-render it at device scale 1. Keep `bounds` in `richmenu.json` matching the grid:

```bash
chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=2500,1686 --virtual-time-budget=8000 --screenshot="$PWD/line-oa/richmenu.png" "file://$PWD/line-oa/richmenu.html"
```

`test/fixtures/home.json` is a real home-proxy response captured on 15 Nov 2026 at 21:40 Bangkok time. It contains NWT06 at DDPM level 3 (เตรียมรับมือ).

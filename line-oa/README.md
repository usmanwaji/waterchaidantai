# line-oa — rich menu และเครื่องมือของ LINE OA NaraFlood

ขั้นตอนเต็มอยู่ใน `DEPLOY.md` ข้อ 4 · แบบอยู่ใน `LINE-OA-PLAN.md`

```bash
node --test line-oa/test/*.test.mjs                    # ทดสอบตรรกะบอท (supabase/functions/line-webhook/core.mjs)
node line-oa/render-richmenu.mjs                       # richmenu.html → richmenu.png
LINE_CHANNEL_ACCESS_TOKEN=... node line-oa/setup-richmenu.mjs --info --webhook   # Basic ID + ผูก webhook
LINE_CHANNEL_ACCESS_TOKEN=... node line-oa/setup-richmenu.mjs                    # ติดตั้ง rich menu
```

| ไฟล์ | หน้าที่ |
|---|---|
| `richmenu.json` | ปุ่ม 6 ช่อง (ผังตรงกับรูป) |
| `richmenu.html` / `richmenu.png` | ต้นฉบับรูปและรูปที่ถ่ายแล้ว (2500×1686) |
| `setup-richmenu.mjs` | ตรวจ → สร้าง → อัปโหลด → ตั้งค่าเริ่มต้น → ลบเมนูเก่า · `--webhook` ผูก webhook · `--info` ดู Basic ID/โควตา |
| `test/` | ชุดทดสอบ node --test · `fixtures/home.json` คือข้อมูลจริงจาก home-proxy 15 พ.ย. 2569 20:48 น. |

โฟลเดอร์นี้ไม่ขึ้นเว็บ (ตัดออกใน `.github/workflows/cloudflare-pages.yml`)

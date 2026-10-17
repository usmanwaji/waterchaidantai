# DEPLOY — waterchaidantai (One Map ชายแดนใต้)

ขั้นตอน deploy: **(1) เว็บหน้าเว็บ → Cloudflare Pages** · **(2) ฐานข้อมูล → Supabase (schema v6–v8)** · **(3) แจ้งเตือน → Telegram + Edge Function**

Project ref (Supabase): `tnvzeahfugmmrydtnsdv`
Site: https://naraflood.com/

---

## 1) เว็บหน้าเว็บ (Cloudflare Pages)

หน้าเว็บทั้งหมดเป็น static — push ขึ้น branch `main` แล้ว Cloudflare Pages จะ deploy ให้อัตโนมัติ (ไม่มีขั้น build)

```bash
cd "Dashboard อุทกภัย"
git add -A
git commit -m "update"
git push origin main      # ต้องล็อกอิน GitHub (Credential Manager หรือ Personal Access Token)
```

รอ ~1 นาที เว็บอัปเดตที่ลิงก์ด้านบน · ดูสถานะได้ที่ dash.cloudflare.com → **Workers & Pages → naraflood → Deployments**  
PWA/Service Worker ทำงานเฉพาะบน https (Cloudflare Pages เป็น https อยู่แล้ว)

### 1.0) ตั้งค่า Cloudflare Pages ครั้งแรก (ทำครั้งเดียว)

1. **สร้างโปรเจกต์** — dash.cloudflare.com → **Workers & Pages → Create → Pages → Import an existing Git repository**
   → เชื่อม GitHub แล้วเลือก `usmanwaji/waterchaidantai`
   - Project name: `naraflood` (ได้ลิงก์ทดสอบ `https://naraflood.pages.dev` · ถ้าชื่อซ้ำ Cloudflare จะเติมตัวอักษรต่อท้ายให้)
   - Production branch: `main`
   - Framework preset: **None** · Build command: **เว้นว่าง** · Build output directory: `/`
   - กด **Save and Deploy** แล้วเปิดลิงก์ `.pages.dev` ดูว่าหน้าแรกและแผนที่ขึ้นปกติ
2. **ไม่ให้ build branch `cam`** — โปรเจกต์ → **Settings → Builds → Branch control** → Preview branch: **Custom branches**
   → Include: `*` · Exclude: `cam` → Save
   ตัวดึงข้อมูล telerid push ขึ้น `cam` ทุกไม่กี่นาที ถ้าไม่กันไว้ Cloudflare จะ build ทุกครั้งจนโควตาฟรี 500 build/เดือนหมด
   (`cam` ไม่ใช่หน้าเว็บ หน้าแผนที่อ่านไฟล์จาก raw.githubusercontent.com โดยตรง) · ไม่ต้องการลิงก์ทดสอบของ branch อื่นเลยก็เลือก **None**
3. **ผูกโดเมน** — โปรเจกต์ → **Custom domains → Set up a custom domain** → `naraflood.com` (ใช้ www ด้วยก็เพิ่ม `www.naraflood.com` อีกตัว)
   - DNS ของ naraflood.com อยู่ที่ Cloudflare แล้ว: Cloudflare สร้าง record ให้เอง ถ้าฟ้องว่ามี record ซ้ำ ให้ลบ A record เดิมของ GitHub (`185.199.108.153`–`185.199.111.153`) ก่อน
   - DNS ยังอยู่ที่ผู้ให้บริการโดเมนเดิม: โดเมนหลัก (ไม่มี www) ผูกกับ Pages ได้เมื่อ DNS อยู่ที่ Cloudflare เท่านั้น
     → dash.cloudflare.com → **Onboard a domain** → `naraflood.com` → แผน Free → ตรวจว่า record เดิมครบ (โดยเฉพาะ MX/TXT ของอีเมลถ้ามี)
     → นำ nameserver 2 ตัวที่ Cloudflare ให้ไปใส่ที่หน้าจัดการโดเมน → รอสถานะ Active แล้วค่อยทำข้อนี้
   - เสร็จแล้วรอ 5–30 นาที เปิด https://naraflood.com ถ้าเปิด DevTools → Network แล้ว header `server` เป็น `cloudflare` (ไม่ใช่ `GitHub.com`) แปลว่าย้ายสำเร็จ
4. **Supabase Auth** — Authentication → URL Configuration → Redirect URLs เพิ่ม `https://naraflood.com/**`
   Cloudflare ตัด `.html` ออกจาก URL หลังล็อกอินจึงกลับมาที่ `/route` ไม่ใช่ `/route.html` ถ้าในรายการมีแค่ชื่อเต็ม Supabase จะส่งไปที่ Site URL แทนหน้าที่กดล็อกอิน
5. **Supabase secrets** — ให้ลิงก์ในข้อความแจ้งเตือนชี้มาที่ naraflood.com
   ```bash
   supabase secrets set SITE_URL=https://naraflood.com
   supabase secrets set ADMIN_DASHBOARD_URL=https://naraflood.com/admin.html
   ```
6. **GitHub Pages** — เปิดทิ้งไว้ได้ ลิงก์เก่า `usmanwaji.github.io/waterchaidantai/...` จะยังส่งต่อมาที่ naraflood.com
   (GitHub จะเตือนว่า DNS ไม่ได้ชี้มาที่ GitHub — ไม่เป็นไร) จะปิดเมื่อไหร่ก็ได้ที่ repo → **Settings → Pages**
   ไฟล์ `CNAME` ใช้กับ GitHub Pages เท่านั้น Cloudflare ไม่อ่าน

**ข้อต่างจาก GitHub Pages ที่โค้ดรองรับไว้แล้ว**
- Cloudflare ส่ง `/map.html` ต่อไปที่ `/map` เสมอ (redirect 308) — ลิงก์ในโค้ดเขียน `.html` ตามเดิมได้ ใช้ได้ทั้งบน Cloudflare และ `node .devserver.mjs`
  - `js/tabbar.js` กับ `js/views.js` เติม `.html` กลับเอง (แถบล่างไฮไลต์ถูกหน้า · ตัวนับผู้เข้าชมนับต่อจากยอดเดิม)
  - `sw.js` เก็บสำเนาหน้าเว็บแบบไม่มีธง redirect ไว้ใช้ตอนออฟไลน์ (ถ้าเก็บแบบมีธง เบราว์เซอร์จะไม่ยอมเปิดหน้าตอนออฟไลน์)
  - โค้ดใหม่ที่อ่านชื่อหน้าจาก `location.pathname` ต้องรองรับทั้ง `/map` และ `/map.html`
- ต้องมี `404.html` เสมอ — ถ้าไม่มี Cloudflare จะส่งหน้าแรกกลับไปแทนทุก URL ที่ไม่มีอยู่จริง (สถานะ 200) ไฟล์ข้อมูลที่หายจะได้ HTML แทน error

### 1.1) Cloudflare Worker proxies (แก้ CORS ให้ API ราชการ)

หน้า map.html/index.html เรียก API บางตัวผ่าน Worker ฟรีของ Cloudflare เพราะต้นทางไม่เปิด CORS
ทุกตัว deploy แบบเดียวกัน: **dash.cloudflare.com → Workers & Pages → Create Worker → ตั้งชื่อตามตาราง → Edit code → วางไฟล์ → Save and deploy**
ถ้าตั้งชื่อ worker ตรงตามตาราง URL จะตรงกับที่ตั้งค่าไว้ในโค้ดแล้ว ไม่ต้องแก้อะไร

| ไฟล์ | ชื่อ worker | ใช้กับ | ทดสอบ |
|------|-------------|--------|--------|
| `ddpm-proxy.worker.js` | `ddpm-proxy` | map.html — ภาพกล้อง ปภ. | `https://ddpm-proxy.<บัญชี>.workers.dev/stations/PTN07` |
| `home-proxy.worker.js` | `home-proxy` | index.html — รวมข้อมูลหน้าแรกทุกแหล่งเป็นคำขอเดียว (ระดับน้ำ ฝน พยากรณ์ ทิศทางน้ำ เรดาร์) · ต้องผูก Service binding 4 ตัว + Cron Trigger (ด้านล่าง) | `https://home-proxy.<บัญชี>.workers.dev/` |
| `tmd-proxy.worker.js` | `tmd-proxy` | index.html — พยากรณ์ 7 วัน TMD + แผนที่ฝนคาดการณ์รายอำเภอ · forecast.html — ฝนคาดการณ์รายอำเภอ + ปุ่มเปิดหน้าแผนที่เสี่ยงภัยรายอำเภอ | `https://tmd-proxy.<บัญชี>.workers.dev/region7days` · `/riskmap` · `/riskmap-district` |
| `hyd-proxy.worker.js` | `hyd-proxy` | map.html — ชั้น "โทรมาตร ชป.": สถานีอุทกวิทยา ชป. (hyd-app.rid.go.th/hydro8h.html) ที่ thaiwater ไม่มี เช่น X.199 · ต้องเปิด Smart Placement | `https://hyd-proxy.<บัญชี>.workers.dev/stations.json` |
| `ews-proxy.worker.js` | `ews-proxy` | map.html — ชั้น "◆ เตือนภัย ทน.": สถานีวัดระดับน้ำของระบบเตือนภัยล่วงหน้า กรมทรัพยากรน้ำ (ews1.dwr.go.th) ในนราธิวาส 7 สถานี เช่น STN2155 บ้านไอปาโจ · STN2233 ชุมชนยะกัง | `https://ews-proxy.<บัญชี>.workers.dev/stations.json` |
| `onwr-proxy.worker.js` | `onwr-proxy` | map.html — 4 ชั้นเรดาร์ สทนช. (เรดาร์ TMD + คาดการณ์ 3 ชม. · ฝนสะสม 3 ชม. ล่วงหน้ารายอำเภอ/ตำบล · ฝนสถานีรายชั่วโมง · สถานีเรดาร์) | `https://onwr-proxy.<บัญชี>.workers.dev/frames` |
| `status-dash.worker.js` | `status-dash` | ไม่ได้ใช้กับหน้าเว็บ — หน้าสถานะ Worker ทุกตัวสำหรับผู้ดูแล เปิดได้เฉพาะลิงก์ที่มีรหัสลับ · ต้องผูก Service binding 7 ตัว + secret `DASH_KEY` (ด้านล่าง) | `https://status-dash.<บัญชี>.workers.dev/<DASH_KEY>` |

`home-proxy` เก็บผลของแต่ละแหล่งไว้ใน Cache ของ Cloudflare แล้วตอบหน้าแรกเป็น JSON ก้อนเดียว
ยกเว้นระดับน้ำ thaiwater (ตอบ 429 ให้ IP ร่วมของ Cloudflare) และพยากรณ์ open-meteo (ตอบ Worker ไม่ทัน) ที่หน้าเว็บดึงตรง
Cron ทุกนาทีดึงข้อมูลไว้ล่วงหน้า แต่ละส่วนดึงเฉพาะเมื่อถึงรอบของมัน (นาทีที่ไม่มีอะไรถึงรอบไม่ยิงต้นทาง) คนดูจึงเจอแคชที่สดเสมอ:

| ข้อมูล | รอบที่ Worker ดึงใหม่ |
|---|---|
| ระดับน้ำ ปภ. | ทุก 5 นาที |
| โทรมาตร ชป. · ทิศทางน้ำ ชป. · เรดาร์ฝนระยะสั้น | ทุก 14 นาที |
| ทิศทางน้ำ ปภ. (กราฟรายชั่วโมง) | ชั่วโมงละครั้ง |
| X.199 (hyd-app) | ทุก 30 นาที |
| ฝนคาดการณ์รายอำเภอ | ทุก 12 ชม. |
| ฝนสะสม 3 วัน | ทุก 22 ชม. |
| พยากรณ์รายภาค กรมอุตุฯ | วันละครั้ง 14:00 น. |
| เกณฑ์เฝ้าระวัง ปภ. | ทุกวันที่ 15 ของเดือน |

ดึงไม่สำเร็จพัก 3 นาที · เจอ 429 พัก 5 → 10 → 20 … นาที (สูงสุด 1 ชม.) · แท็บหน้าแรกที่เปิดค้างขอข้อมูลจาก home-proxy ทุก 6 นาที (ตอบจากแคช)
ใช้แผนฟรีได้ทั้งหมด (ไม่ใช้ KV) · หลัง deploy ต้องตั้ง:
- **Settings → Bindings → Add binding → Service binding** 4 ตัว ชื่อตัวแปรต้องตรง:
  `TELERID` → `telerid-proxy` · `HYD` → `hyd-proxy` · `TMD` → `tmd-proxy` · `SELF` → `home-proxy` (ตัวเอง ใช้กับ cron)
  (Worker เรียก Worker อื่นในบัญชีเดียวกันผ่าน URL workers.dev ไม่ได้ ได้ error 1042)
- **Settings → Trigger events → Cron Triggers**: `* * * * *` (ทุกนาที)
  Placement มีผลกับ fetch เท่านั้น cron จึงเรียก `/cron` ของตัวเองผ่าน `SELF` ให้ไปรันที่ BKK ใช้แคชชุดเดียวกับคนดู
- **Settings → Runtime → Placement → Region**: AWS `ap-southeast-7` (ให้ทุกคำขอใช้แคชที่ BKK ชุดเดียว)
- ตั้ง cron ของ home-proxy แล้ว ปิด Cron Trigger ของ `telerid-proxy` ได้ (home-proxy เรียก `/stations.json` ทุก 14 นาทีแทน)

ตรวจ: เปิด `/home.json` สักครั้ง แล้วเปิด `/` ทุกส่วนควรมี `ageSec` และ `lastError` เป็น null · `hint` บอกว่ายังขาด binding ตัวไหน
หลังตั้ง cron สักพัก ช่อง `cron` ต้องมี `lastRunAgoSec` ไม่เกินราว 300 (รอบ ปภ.) และ `runsIn` เป็น `BKK`
ถ้ายังไม่ deploy หรือส่วนไหนล่ม หน้าแรกดึงส่วนนั้นตรงจากต้นทางแบบเดิมเอง ไม่พัง

`status-dash` รวมหน้าสถานะ (`/`) ของ home-proxy, telerid-proxy, hyd-proxy, ews-proxy, tmd-proxy, ddpm-proxy, onwr-proxy และรุ่น service worker ของเว็บจริงไว้หน้าเดียว (รีเฟรชเองทุก 2 นาที เก็บผล 60 วิ)
ไม่มีลิงก์จากเว็บ เปิดได้เฉพาะ `/<DASH_KEY>` path อื่นตอบ 404 · หลัง deploy ต้องตั้ง:
- **Settings → Bindings → Service binding** 7 ตัว: `HOME` → `home-proxy` · `TELERID` → `telerid-proxy` · `HYD` → `hyd-proxy` · `EWS` → `ews-proxy` · `TMD` → `tmd-proxy` · `DDPM` → `ddpm-proxy` · `ONWR` → `onwr-proxy`
- **Settings → Variables and Secrets → Secret** ชื่อ `DASH_KEY` ค่าเป็นข้อความสุ่มยาว ๆ (ห้าม commit ลง repo นี้ เพราะ repo เป็นสาธารณะ) · เปลี่ยนค่า = ลิงก์เดิมใช้ไม่ได้ทันที
- **Settings → Runtime → Placement → Region**: AWS `ap-southeast-7` (ให้เห็นแคชของ home-proxy ชุดเดียวกับที่ cron เขียน)

`ews-proxy` ดึงรายชื่อสถานีทั้งประเทศจาก ews1.dwr.go.th (~3 MB) แล้วส่งเฉพาะสถานีวัดระดับน้ำในนราธิวาส (~2 KB) แคช 10 นาที
ews.dwr.go.th ตัดการเชื่อมต่อจาก IP นอกไทย แต่ ews1 เปิดได้จากทุกที่ จึงไม่ต้องเปิด Smart Placement · หน้าแรกของ worker บอกว่าเปิดได้ทางไหน
ถ้ายังไม่ deploy รอบที่มี `/stations.json` หน้า map จะขึ้น "บางแหล่งข้อมูลโหลดไม่สำเร็จ" เฉพาะชั้นนี้ ชั้นอื่นทำงานปกติ

`onwr-proxy` กรองข้อมูลให้เหลือเฉพาะนราธิวาสก่อนส่ง (ต้นทาง `zones?level=subdistrict` ใหญ่ 8 MB) และแคชผล 5 นาที
ถ้ายังไม่ deploy หน้า map จะขึ้น "โหลดข้อมูล สทนช. ไม่สำเร็จ" เฉพาะชั้นเหล่านี้ ชั้นอื่นทำงานปกติ

`tmd-proxy` เส้นทาง `/riskmap` ดึงฝนสะสมรายวันคาดการณ์รายอำเภอจาก hpc.tmd.go.th (ไฟล์ทั้งประเทศ ~570 KB)
กรองเหลือ 13 อำเภอนราธิวาสแล้วแคช 1 ชม. → เหลือ ~2 KB · ถ้ายังไม่ deploy รอบใหม่
หน้า forecast.html จะขึ้น "โหลดไม่สำเร็จ" เฉพาะการ์ดฝนรายอำเภอ ส่วนอื่นทำงานปกติ · หน้า index.html
ใช้เส้นทางเดียวกันวาดเป็นแผนที่ 13 อำเภอพร้อมตัวเลขฝนรายวัน (การ์ด "คาดการณ์ปริมาณฝนรายอำเภอ")
ถ้ายังไม่ deploy การ์ดนี้จะขึ้น "โหลดไม่สำเร็จ" เช่นกัน ส่วนอื่นของหน้าแรกทำงานปกติ

`tmd-proxy` เส้นทาง `/riskmap-district` เสิร์ฟหน้าเว็บ "แผนที่เสี่ยงภัยรายอำเภอ" ของ hpc.tmd.go.th
ให้ปุ่ม **คาดการณ์ปริมาณฝนรายอำเภอ** ใน forecast.html ฝังเป็น iframe โดยล็อกตัวกรองไว้ที่นราธิวาส
(ต้นทางเลือกจังหวัดจาก URL ไม่ได้ และช่องค้นหาของต้นทางไม่วาดตารางใหม่ให้เอง ต้องพิมพ์จังหวัดก่อนแล้วเปลี่ยนวันซ้ำ — worker แทรกช่องที่หายไปกลับให้)
เส้นทาง `/static/...` กับ `/api/...` ของ worker เป็นตัวส่งต่อไฟล์ที่หน้านั้นเรียก ห้ามลบ
ถ้ายังไม่ deploy รอบใหม่ กดปุ่มแล้วกรอบจะขึ้นข้อความ `Unknown route` — ใช้ลิงก์ "เปิดหน้าเต็มที่เว็บกรมอุตุฯ" ในหัวกรอบแทนได้

---

## 2) ฐานข้อมูล (Supabase)

รัน SQL ตามลำดับใน **Supabase Dashboard → SQL Editor → New query → paste → Run**
(ต้องรัน `schema.sql` และ v2–v5 มาก่อนแล้วตามการตั้งค่าเดิม)

| ไฟล์ | สร้างอะไร |
|------|-----------|
| `supabase/schema-v6.sql` | `shelters`, `incidents`, `resource_requests`, `alert_rules`, `alert_log` + คอลัมน์ `profiles.province_scope` + ฟังก์ชัน `can_edit_province()` |
| `supabase/schema-v7.sql` | `audit_log` (บันทึกการกระทำแอดมิน) |
| `supabase/schema-v8.sql` | `vulnerable_people` (กลุ่มเปราะบาง, RLS เข้มงวด PDPA) + ฟังก์ชัน `is_admin_for_province()` |
| `supabase/schema-v9.sql` | `page_views` + ฟังก์ชัน `bump_page_view()` / `get_page_views()` — ตัวนับผู้เข้าชมมุมขวาล่างของทุกหน้า |

หน้าเว็บที่พึ่งตารางเหล่านี้ (shelter, eoc, alert, resources, admin, people) จะ **degrade gracefully** ถ้ายังไม่ได้รัน — ไม่ error แค่ไม่มีข้อมูลสด
ป้ายนับผู้เข้าชมก็เช่นกัน — ถ้ายังไม่ได้รัน `schema-v9.sql` ป้ายจะไม่ขึ้น (ไม่มี error)

**ดูสถิติผู้เข้าชมย้อนหลัง** ที่ SQL Editor:
```sql
select day, sum(views) as views from public.page_views group by day order by day desc limit 30;
select path, sum(views) as views from public.page_views group by path order by views desc;
```

**สิทธิ์ (RLS) โดยย่อ**
- `shelters` — อ่านสาธารณะ · แก้/เพิ่มเฉพาะสมาชิกอนุมัติในจังหวัดที่รับผิดชอบ
- `incidents` / `resource_requests` — อ่าน/เขียนเฉพาะสมาชิกอนุมัติ
- `alert_rules` / `alert_log` — เฉพาะสมาชิกอนุมัติ (มี chat/channel id)
- `audit_log` — อ่านเฉพาะแอดมิน
- `vulnerable_people` — เห็น/แก้ได้เฉพาะ **แอดมินของจังหวัดนั้น** เท่านั้น (ข้อมูลอ่อนไหว)

ตั้งขอบเขตจังหวัดให้สมาชิก/แอดมินได้ที่หน้า **admin.html** (ช่อง “ขอบเขตจังหวัด”)

---

## 3) แจ้งเตือนน้ำผ่าน Telegram (Edge Functions `telegram-webhook` + `notify-water`)

> ใช้ **Telegram Bot API** เพราะส่งข้อความได้ไม่จำกัดและไม่มีค่าใช้จ่าย
> ต่างจาก LINE OA ที่จำกัดโควตาข้อความต่อเดือน (LINE Notify เองก็ปิดบริการไปแล้ว มี.ค. 2025)

### 3.1 เตรียมบอท Telegram
1. เปิด Telegram แล้วทักหา **@BotFather** → ส่ง `/newbot` → ตั้งชื่อและ username (ต้องลงท้ายด้วย `bot`)
2. BotFather จะให้ **token** หน้าตาแบบ `123456789:AAH...` — เก็บไว้ใช้ข้อ 3.2 และ 3.3
3. เอา username ของบอทไปใส่ค่า `TG_BOT` ในไฟล์ `alert.html` (ไม่ต้องใส่ `@`)
   เพื่อให้ปุ่ม "เปิดบอทใน Telegram" ในหน้าแจ้งเตือนชี้ถูกตัว

> หมายเหตุ: บอทส่งข้อความได้เฉพาะคนที่ **กด `/start` แล้ว** หรือ **กลุ่มที่บอทอยู่** เท่านั้น
> (ส่งหาคนที่ไม่เคยทักบอทไม่ได้ — กันสแปมเหมือนกับฝั่ง LINE)

### 3.2 Deploy webhook ให้ประชาชนสมัครเองได้ (Edge Function `telegram-webhook`)

ฟังก์ชันนี้ทำให้กด `/start` ในบอทแล้วเลือกระดับได้เลย **ไม่ต้องให้เจ้าหน้าที่เปิด
`getUpdates` อ่าน chat id ให้ทีละคน** — สมัครที่จับคู่ได้คือระดับ "ทั้งจังหวัดนราธิวาส"
เท่านั้น (ตั้งใจไม่ทำเลือกรายอำเภอ เพราะเครื่องยนต์แจ้งเตือนใน `notify-water` จับคู่กฎ
ด้วยจังหวัดหรือรหัสสถานีที่แน่นอนเท่านั้น ไม่เคยอ่านชื่ออำเภอจากสถานี — ทำปุ่มเลือก
อำเภอไปจะได้กฎที่ดูถูกต้องแต่กรองไม่ได้จริง) ใครอยากได้แจ้งเตือนเฉพาะสถานีเดียว
ให้พิมพ์ `/status` ในบอทเพื่อดู chat id แล้วแจ้งเจ้าหน้าที่ตั้งกฎเองในข้อ 3.5

```bash
supabase functions deploy telegram-webhook --no-verify-jwt

supabase secrets set TELEGRAM_BOT_TOKEN=<token จาก BotFather ข้อ 3.1>
supabase secrets set TELEGRAM_WEBHOOK_SECRET=<สุ่มสตริงยาว ๆ เอง ไม่ใช่ตัวเดียวกับ CRON_SECRET>
```

แล้วผูก webhook เข้ากับบอท (ทำครั้งเดียว):
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url="https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/telegram-webhook" \
  -d secret_token="<TELEGRAM_WEBHOOK_SECRET เดียวกับด้านบน>"
```
ต้องได้ `{"ok":true,"result":true,...}` กลับมา · ตรวจสอบทีหลังได้ด้วย
`https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

- `secret_token` คือด่านกันคนอื่นยิง POST ปลอมมาที่ endpoint นี้ (Telegram จะแนบ
  header `X-Telegram-Bot-Api-Secret-Token` มาให้ทุกครั้ง ฟังก์ชันเทียบค่าเอง)
- `--no-verify-jwt` จำเป็นเหมือนกับ `notify-water` เพราะ Telegram ไม่ส่ง JWT ของ Supabase มา

### 3.3 Deploy function ยิงแจ้งเตือน (Edge Function `notify-water`) + secrets
```bash
supabase login
supabase link --project-ref tnvzeahfugmmrydtnsdv

supabase functions deploy notify-water --no-verify-jwt

supabase secrets set TELEGRAM_BOT_TOKEN=<token เดียวกับข้อ 3.1/3.2>
supabase secrets set CRON_SECRET=<สุ่มสตริงยาว ๆ เอง>
supabase secrets set SITE_URL=https://naraflood.com
```
- `--no-verify-jwt` จำเป็น เพราะฟังก์ชันถูกเรียกโดยตัวตั้งเวลา ไม่ใช่ผู้ใช้ล็อกอิน (ป้องกันด้วย `CRON_SECRET` แทน)
- **ไม่ต้อง** ตั้ง `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase ใส่ให้อัตโนมัติ

### 3.4 ตั้งเวลาให้รันทุก 15 นาที (Supabase SQL Editor)
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-water-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/notify-water',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET เดียวกับ 3.3>'),
    body    := '{}'::jsonb
  );
  $$
);
```
(หรือใช้ Dashboard → Edge Functions → notify-water → Schedules แต่ต้องใส่ header `x-cron-secret` เอง)

### 3.5 เพิ่มกฎเฉพาะทาง (ถ้าต้องการ) + ทดสอบ
ถ้าทำข้อ 3.2 แล้ว ประชาชนทั่วไปสมัครรับแจ้งเตือนทั้งจังหวัดเองได้จากปุ่มในบอทอยู่แล้ว
ไม่ต้องเพิ่มกฎในนี้ · เข้าหน้านี้เฉพาะตอนต้องการกฎที่ระบบไม่รองรับเอง เช่น
**เฉพาะสถานีเดียว** หรือ **กลุ่ม/หน่วยงานที่อยากตั้งเกณฑ์เอง**

- เพิ่มกฎที่หน้า **alert.html** (ล็อกอินสมาชิกอนุมัติ → ⚙️ กติกาแจ้งเตือน → + เพิ่มกฎ)
  เช่น metric `% ของตลิ่ง`, threshold `80`, channel `telegram:-1001234567890`
  (chat id ของผู้ใช้แต่ละคนดูได้จากพิมพ์ `/status` ในบอท ไม่ต้องเปิด `getUpdates` เอง)
- ทดสอบยิงเองครั้งเดียว:
```bash
curl -X POST 'https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/notify-water' \
  -H 'x-cron-secret: <CRON_SECRET>'
```
คืนค่า `{"ok":true,"checked":N,"fired":M}` · ข้อความจริงจะเข้า Telegram และถูกบันทึกใน `alert_log`
(ถ้า `fired` ขึ้นแต่ข้อความไม่เข้า ให้ดู log ของฟังก์ชันใน Supabase — จะมีเหตุผลจาก Telegram เช่น chat id ผิด หรือผู้ใช้บล็อกบอท)

> `cooldown_min` (ค่าเริ่มต้น 180 นาที) กันสแปม — ตอนทดสอบถ้าอยากให้ยิงซ้ำทันที ให้ลบแถวล่าสุดใน `alert_log` ของกฎนั้น

---

## แหล่งข้อมูลภายนอกที่ระบบใช้ (ไม่ต้อง deploy — เป็น public API)
สสน. thaiwater.net · Open-Meteo · GISTDA flood API · ปภ. ArcGIS (CCTV) · กรมชลประทาน telerid  
สถานะความพร้อมของแหล่งเหล่านี้ดูได้ที่ **admin.html → Data Health**

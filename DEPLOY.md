# DEPLOY — waterchaidantai (One Map ชายแดนใต้)

ขั้นตอน deploy: **(1) เว็บหน้าเว็บ → GitHub Pages** · **(2) ฐานข้อมูล → Supabase (schema v6–v8)** · **(3) แจ้งเตือน → Telegram + Edge Function**

Project ref (Supabase): `tnvzeahfugmmrydtnsdv`
Site: https://usmanwaji.github.io/waterchaidantai/

---

## 1) เว็บหน้าเว็บ (GitHub Pages)

หน้าเว็บทั้งหมดเป็น static — push ขึ้น branch `main` แล้ว GitHub Pages จะ build ให้อัตโนมัติ

```bash
cd "Dashboard อุทกภัย"
git add -A
git commit -m "update"
git push origin main      # ต้องล็อกอิน GitHub (Credential Manager หรือ Personal Access Token)
```

รอ ~1 นาที เว็บอัปเดตที่ลิงก์ด้านบน  
PWA/Service Worker ทำงานเฉพาะบน https (GitHub Pages เป็น https อยู่แล้ว)

### 1.1) Cloudflare Worker proxies (แก้ CORS ให้ API ราชการ)

หน้า map.html/index.html เรียก API บางตัวผ่าน Worker ฟรีของ Cloudflare เพราะต้นทางไม่เปิด CORS
ทุกตัว deploy แบบเดียวกัน: **dash.cloudflare.com → Workers & Pages → Create Worker → ตั้งชื่อตามตาราง → Edit code → วางไฟล์ → Save and deploy**
ถ้าตั้งชื่อ worker ตรงตามตาราง URL จะตรงกับที่ตั้งค่าไว้ในโค้ดแล้ว ไม่ต้องแก้อะไร

| ไฟล์ | ชื่อ worker | ใช้กับ | ทดสอบ |
|------|-------------|--------|--------|
| `ddpm-proxy.worker.js` | `ddpm-proxy` | map.html — ภาพกล้อง ปภ. | `https://ddpm-proxy.<บัญชี>.workers.dev/stations/PTN07` |
| `tmd-proxy.worker.js` | `tmd-proxy` | index.html — พยากรณ์ 7 วัน TMD + แผนที่ฝนคาดการณ์รายอำเภอ · forecast.html — ฝนคาดการณ์รายอำเภอ + ปุ่มเปิดหน้าแผนที่เสี่ยงภัยรายอำเภอ | `https://tmd-proxy.<บัญชี>.workers.dev/region7days` · `/riskmap` · `/riskmap-district` |
| `onwr-proxy.worker.js` | `onwr-proxy` | map.html — 4 ชั้นเรดาร์ สทนช. (เรดาร์ TMD + คาดการณ์ 3 ชม. · ฝนสะสม 3 ชม. ล่วงหน้ารายอำเภอ/ตำบล · ฝนสถานีรายชั่วโมง · สถานีเรดาร์) | `https://onwr-proxy.<บัญชี>.workers.dev/frames` |

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

## 3) แจ้งเตือนน้ำผ่าน Telegram (Edge Function `notify-water`)

> ใช้ **Telegram Bot API** เพราะส่งข้อความได้ไม่จำกัดและไม่มีค่าใช้จ่าย
> ต่างจาก LINE OA ที่จำกัดโควตาข้อความต่อเดือน (LINE Notify เองก็ปิดบริการไปแล้ว มี.ค. 2025)

### 3.1 เตรียมบอท Telegram
1. เปิด Telegram แล้วทักหา **@BotFather** → ส่ง `/newbot` → ตั้งชื่อและ username (ต้องลงท้ายด้วย `bot`)
2. BotFather จะให้ **token** หน้าตาแบบ `123456789:AAH...` — เก็บไว้ใช้ข้อ 3.2
3. เอา username ของบอทไปใส่ค่า `TG_BOT` ในไฟล์ `alert.html` (ไม่ต้องใส่ `@`)
   เพื่อให้ปุ่ม "เปิดบอทใน Telegram" ในหน้าแจ้งเตือนชี้ถูกตัว
4. หาปลายทาง (chat id ที่จะส่งถึง):
   - **รายคน:** ให้ผู้ใช้กด `/start` ในห้องแชทของบอทก่อน (ไม่กดก่อน บอทจะส่งหาไม่ได้)
   - **กลุ่มอำเภอ/อปท.:** เชิญบอทเข้ากลุ่ม แล้วพิมพ์อะไรก็ได้ในกลุ่มหนึ่งครั้ง
   - เปิด `https://api.telegram.org/bot<TOKEN>/getUpdates` แล้วอ่าน `message.chat.id`
   - ใส่ในกฎแจ้งเตือนเป็น `telegram:123456789` (รายคน) หรือ `telegram:-1001234567890` (กลุ่ม)

> หมายเหตุ: บอทส่งข้อความได้เฉพาะคนที่ **กด `/start` แล้ว** หรือ **กลุ่มที่บอทอยู่** เท่านั้น
> (ส่งหาคนที่ไม่เคยทักบอทไม่ได้ — กันสแปมเหมือนกับฝั่ง LINE)

> ตอนนี้ยังไม่มี webhook ที่ตอบ chat id ให้ผู้ใช้อัตโนมัติ เจ้าหน้าที่จึงต้องอ่านจาก `getUpdates` ให้
> ถ้าต้องการให้ประชาชนสมัครเองได้ ต้องเพิ่มฟังก์ชัน webhook รับ `/start` แล้วตอบ chat id กลับ

### 3.2 Deploy function + secrets
```bash
supabase login
supabase link --project-ref tnvzeahfugmmrydtnsdv

supabase functions deploy notify-water --no-verify-jwt

supabase secrets set TELEGRAM_BOT_TOKEN=<token จาก BotFather ข้อ 3.1>
supabase secrets set CRON_SECRET=<สุ่มสตริงยาว ๆ เอง>
supabase secrets set SITE_URL=https://usmanwaji.github.io/waterchaidantai
```
- `--no-verify-jwt` จำเป็น เพราะฟังก์ชันถูกเรียกโดยตัวตั้งเวลา ไม่ใช่ผู้ใช้ล็อกอิน (ป้องกันด้วย `CRON_SECRET` แทน)
- **ไม่ต้อง** ตั้ง `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase ใส่ให้อัตโนมัติ

### 3.3 ตั้งเวลาให้รันทุก 15 นาที (Supabase SQL Editor)
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-water-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/notify-water',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET เดียวกับ 3.2>'),
    body    := '{}'::jsonb
  );
  $$
);
```
(หรือใช้ Dashboard → Edge Functions → notify-water → Schedules แต่ต้องใส่ header `x-cron-secret` เอง)

### 3.4 เพิ่มกฎ + ทดสอบ
- เพิ่มกฎที่หน้า **alert.html** (ล็อกอินสมาชิกอนุมัติ → ⚙️ กติกาแจ้งเตือน → + เพิ่มกฎ)
  เช่น metric `% ของตลิ่ง`, threshold `80`, channel `telegram:-1001234567890`
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

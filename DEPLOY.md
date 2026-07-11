# DEPLOY — waterchaidantai (One Map ชายแดนใต้)

ขั้นตอน deploy: **(1) เว็บหน้าเว็บ → GitHub Pages** · **(2) ฐานข้อมูล → Supabase (schema v6–v8)** · **(3) แจ้งเตือน → LINE + Edge Function**

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

---

## 2) ฐานข้อมูล (Supabase)

รัน SQL ตามลำดับใน **Supabase Dashboard → SQL Editor → New query → paste → Run**
(ต้องรัน `schema.sql` และ v2–v5 มาก่อนแล้วตามการตั้งค่าเดิม)

| ไฟล์ | สร้างอะไร |
|------|-----------|
| `supabase/schema-v6.sql` | `shelters`, `incidents`, `resource_requests`, `alert_rules`, `alert_log` + คอลัมน์ `profiles.province_scope` + ฟังก์ชัน `can_edit_province()` |
| `supabase/schema-v7.sql` | `audit_log` (บันทึกการกระทำแอดมิน) |
| `supabase/schema-v8.sql` | `vulnerable_people` (กลุ่มเปราะบาง, RLS เข้มงวด PDPA) + ฟังก์ชัน `is_admin_for_province()` |

หน้าเว็บที่พึ่งตารางเหล่านี้ (shelter, eoc, alert, resources, admin, people) จะ **degrade gracefully** ถ้ายังไม่ได้รัน — ไม่ error แค่ไม่มีข้อมูลสด

**สิทธิ์ (RLS) โดยย่อ**
- `shelters` — อ่านสาธารณะ · แก้/เพิ่มเฉพาะสมาชิกอนุมัติในจังหวัดที่รับผิดชอบ
- `incidents` / `resource_requests` — อ่าน/เขียนเฉพาะสมาชิกอนุมัติ
- `alert_rules` / `alert_log` — เฉพาะสมาชิกอนุมัติ (มี chat/channel id)
- `audit_log` — อ่านเฉพาะแอดมิน
- `vulnerable_people` — เห็น/แก้ได้เฉพาะ **แอดมินของจังหวัดนั้น** เท่านั้น (ข้อมูลอ่อนไหว)

ตั้งขอบเขตจังหวัดให้สมาชิก/แอดมินได้ที่หน้า **admin.html** (ช่อง “ขอบเขตจังหวัด”)

---

## 3) แจ้งเตือนน้ำผ่าน LINE (Edge Function `notify-water`)

> LINE Notify ปิดบริการแล้ว (มี.ค. 2025) — ระบบใช้ **LINE Messaging API (LINE Official Account)**

### 3.1 เตรียม LINE OA
1. สร้าง **LINE Official Account** (https://manager.line.biz) และเปิดใช้ **Messaging API**
2. ที่ **LINE Developers Console** (https://developers.line.biz) → เลือก channel ของ OA →
   - แท็บ **Messaging API** → คัดลอก **Channel access token (long-lived)**
3. หาปลายทาง (id ที่จะส่งถึง):
   - ให้ OA เป็นเพื่อนกับผู้ใช้ หรือเชิญ OA เข้ากลุ่ม LINE ของอำเภอ
   - ตั้ง Webhook แล้วอ่าน `source.userId` (ขึ้นต้น `U…`) หรือ `source.groupId` (`C…`)
   - id นี้ใส่ในกฎแจ้งเตือนเป็น `line:U…` หรือ `line:C…` (กลุ่ม)

> หมายเหตุ: LINE push ส่งได้เฉพาะผู้ที่ **เพิ่ม OA เป็นเพื่อน** หรือ **กลุ่มที่ OA อยู่** เท่านั้น (push หาผู้ใช้ทั่วไปที่ไม่ได้เพิ่มเพื่อนไม่ได้)

### 3.2 Deploy function + secrets
```bash
supabase login
supabase link --project-ref tnvzeahfugmmrydtnsdv

supabase functions deploy notify-water --no-verify-jwt

supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=<channel access token จากข้อ 3.1>
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
  เช่น metric `% ของตลิ่ง`, threshold `80`, channel `line:C…`
- ทดสอบยิงเองครั้งเดียว:
```bash
curl -X POST 'https://tnvzeahfugmmrydtnsdv.supabase.co/functions/v1/notify-water' \
  -H 'x-cron-secret: <CRON_SECRET>'
```
คืนค่า `{"ok":true,"checked":N,"fired":M}` · ข้อความจริงจะเข้า LINE และถูกบันทึกใน `alert_log`

> `cooldown_min` (ค่าเริ่มต้น 180 นาที) กันสแปม — ตอนทดสอบถ้าอยากให้ยิงซ้ำทันที ให้ลบแถวล่าสุดใน `alert_log` ของกฎนั้น

---

## แหล่งข้อมูลภายนอกที่ระบบใช้ (ไม่ต้อง deploy — เป็น public API)
สสน. thaiwater.net · Open-Meteo · GISTDA flood API · ปภ. ArcGIS (CCTV) · กรมชลประทาน telerid  
สถานะความพร้อมของแหล่งเหล่านี้ดูได้ที่ **admin.html → Data Health**

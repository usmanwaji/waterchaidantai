# คู่มือติดตั้ง: สมาชิก + หน้าเส้นทางน้ำท่วม

ทำตามลำดับนี้ ใช้เวลาประมาณ 30–45 นาที ทำครั้งเดียวจบ (ยกเว้นข้อ 6 ที่ทำซ้ำได้ถ้าต้องเปลี่ยน secret)

ทุกขั้นตอนทำในเว็บเบราว์เซอร์ของคุณเอง (Claude จะไม่กรอกรหัสผ่าน/คีย์ใด ๆ แทนคุณ) — สิ่งที่คุณต้องส่งกลับมาให้ Claude มีแค่ **ค่าสาธารณะ** (public URL, public anon key, OAuth client ID) ไม่ใช่รหัสลับ

---

## 1. สร้างโปรเจกต์ Supabase

1. ไปที่ https://supabase.com → **Sign up / Sign in** (ใช้ GitHub หรือ Google ก็ได้)
2. กด **New project**
   - Name: `waterchaidantai` (หรือชื่อใดก็ได้)
   - Database Password: ตั้งรหัสผ่าน แล้ว**เก็บไว้เอง** (ไม่ต้องส่งให้ Claude)
   - Region: `Southeast Asia (Singapore)` (ใกล้ที่สุด)
3. รอ 1-2 นาทีจนโปรเจกต์พร้อม
4. ไปที่ **Project Settings → Data API** แล้วจดค่า 2 อย่างนี้ไว้:
   - **Project URL** (หน้าตาแบบ `https://xxxxxxxxxxxx.supabase.co`)
   - **Project API keys → anon public** (สตริงยาว ๆ)

   ทั้งสองค่านี้เป็น**ค่าสาธารณะ** ปลอดภัยที่จะให้ Claude ใส่ในโค้ดหน้าเว็บ

---

## 2. สร้าง Google OAuth Client (สำหรับปุ่ม "เข้าสู่ระบบด้วย Google")

1. ไปที่ https://console.cloud.google.com/ → สร้างโปรเจกต์ใหม่ (หรือใช้โปรเจกต์เดิม)
2. เมนูซ้าย → **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - กรอกชื่อแอป เช่น "One Map ชายแดนใต้", อีเมลติดต่อ: `newusmanwaji@gmail.com`
   - Scopes: ค่าเริ่มต้นพอ (email, profile, openid)
   - Test users: ไม่จำเป็นถ้าจะ Publish app (แนะนำกด **Publish App** เพื่อให้ทุกคนล็อกอินได้ ไม่ใช่แค่ test user)
3. เมนูซ้าย → **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `waterchaidantai`
   - **Authorized redirect URIs** — ใส่ URL นี้ (แทนที่ `xxxxxxxxxxxx` ด้วย project ref จริงของคุณจากข้อ 1):
     ```
     https://xxxxxxxxxxxx.supabase.co/auth/v1/callback
     ```
4. กด Create → จะได้ **Client ID** และ **Client Secret**

## 3. เปิดใช้ Google Sign-in ใน Supabase

1. ใน Supabase Dashboard → **Authentication → Sign In / Providers → Google**
2. เปิด (Enable) แล้ววาง **Client ID** และ **Client Secret** จากข้อ 2 ลงไป → Save
3. ไปที่ **Authentication → URL Configuration**:
   - **Site URL**: `https://usmanwaji.github.io/waterchaidantai/route.html`
   - **Redirect URLs**: เพิ่มทั้งสองบรรทัด
     ```
     https://usmanwaji.github.io/waterchaidantai/route.html
     https://usmanwaji.github.io/waterchaidantai/admin.html
     ```

---

## 4. รันฐานข้อมูล (schema.sql)

1. Supabase Dashboard → **SQL Editor → New query**
2. เปิดไฟล์ `supabase/schema.sql` (ที่ Claude สร้างให้) → คัดลอกทั้งหมด → วางในช่อง → กด **Run**
3. ควรเห็น "Success. No rows returned" — ถ้ามี error ส่ง error message นั้นกลับมาให้ Claude ดูได้เลย

ไฟล์นี้สร้างตาราง `profiles`, `flood_reports`, สิทธิ์การเข้าถึง (RLS), และ trigger ที่สร้างโปรไฟล์อัตโนมัติเมื่อมีคนล็อกอินครั้งแรก

---

## 5. ตั้งอีเมลแจ้งเตือนแอดมิน (Resend + Edge Function)

**5.1 สร้างบัญชี Resend (ส่งอีเมล ฟรีสำหรับปริมาณน้อย)**
1. ไปที่ https://resend.com → Sign up
2. เมนู **API Keys → Create API Key** → คัดลอกคีย์ที่ขึ้นต้นด้วย `re_...` (เก็บไว้ ไม่ต้องส่งให้ Claude เห็นหน้าจอ แต่จะต้องพิมพ์ใส่ terminal เองในข้อ 5.3)
   - ใช้ผู้ส่งทดสอบ `onboarding@resend.dev` ไปก่อนได้ (จำกัดส่งได้เฉพาะอีเมลที่ยืนยันบัญชี Resend ไว้) — ถ้าต้องการส่งไปอีเมลอื่นแบบ production ค่อยเพิ่ม/ยืนยันโดเมนของคุณเองทีหลังในเมนู **Domains**

**5.2 ติดตั้ง Supabase CLI (ทำครั้งเดียวในเครื่องคุณ)**
```bash
npm install -g supabase
supabase login
```

**5.3 Deploy ฟังก์ชัน**
1. สร้างโฟลเดอร์ `supabase/functions/notify-admin/` ในโปรเจกต์ แล้ววางไฟล์ `index.ts` ที่ Claude สร้างให้ลงไป
2. ในเทอร์มินัล ที่โฟลเดอร์โปรเจกต์:
   ```bash
   supabase link --project-ref xxxxxxxxxxxx
   supabase functions deploy notify-admin
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set WEBHOOK_SECRET=<<คิดสตริงสุ่มยาว ๆ เอง เช่น 40 ตัวอักษร>>
   supabase secrets set ADMIN_EMAIL=newusmanwaji@gmail.com
   ```
3. จดค่า **Edge Function URL** ที่ได้ (รูปแบบ `https://xxxxxxxxxxxx.supabase.co/functions/v1/notify-admin`) และ **WEBHOOK_SECRET** ที่คุณตั้งไว้เอง

**5.4 เชื่อม trigger เข้ากับฟังก์ชัน**

กลับไปที่ SQL Editor แล้วรันเฉพาะส่วนนี้ (แทนที่ด้วยค่าจริงจากข้อ 5.3):
```sql
create or replace function public.notify_admin_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    perform net.http_post(
      url     := 'https://xxxxxxxxxxxx.supabase.co/functions/v1/notify-admin',
      headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret','<<WEBHOOK_SECRET ที่ตั้งไว้>>'),
      body    := jsonb_build_object('id', new.id, 'email', new.email, 'name', new.full_name, 'created_at', new.created_at)
    );
  end if;
  return new;
end;
$$;
```

> ไม่อยากยุ่งกับอีเมลตอนนี้ก็ข้ามข้อ 5 ทั้งหมดได้ — ระบบยังทำงานได้ปกติ เพียงแต่คุณต้องเข้าไปเช็คหน้า `admin.html` เองว่ามีคนรออนุมัติหรือไม่ แทนที่จะได้รับอีเมลแจ้งเตือน

---

## 6. สร้าง Google Maps API Key (สำหรับหน้าเส้นทาง)

1. ไปที่ https://console.cloud.google.com/ → ใช้โปรเจกต์เดิมจากข้อ 2 (หรือสร้างใหม่ก็ได้)
2. เมนูซ้าย → **APIs & Services → Library** → ค้นหาและ **Enable** ทั้ง 3 APIs นี้:
   - **Maps JavaScript API**
   - **Places API (New)**
   - **Directions API**
3. เมนูซ้าย → **APIs & Services → Credentials → + Create Credentials → API key**
4. คลิก **Restrict Key** (แนะนำ):
   - **Application restrictions**: เลือก **HTTP referrers** แล้วเพิ่ม:
     ```
     https://usmanwaji.github.io/*
     ```
     (ถ้าทดสอบในเครื่องเพิ่ม `http://localhost:*` ด้วย)
   - **API restrictions**: เลือก **Restrict key** แล้วเลือก 3 APIs ข้างต้น
5. กด **Save** → คัดลอก API Key ไว้

> Google ให้เครดิตฟรี $200/เดือน (~28,000 map loads) เพียงพอสำหรับการใช้งานระดับหน่วยงานเดียว

---

## 7. ใส่ค่า Supabase + Google Maps API Key ลงโค้ด

**7.1 Supabase** — เปิดไฟล์ `js/supabase-client.js` แล้วแก้ 2 บรรทัดนี้ด้วยค่าจากข้อ 1:
```js
const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'ค่า anon public key ของคุณ';
```

**7.2 Google Maps** — เปิดไฟล์ `route.html` แล้วแก้บรรทัดนี้ด้วยค่าจากข้อ 6:
```js
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY';
```

(บอก Claude ให้แก้ให้ก็ได้ ถ้าส่งค่ามาในแชท — API Key ของ Google Maps ที่จำกัด referrer แล้วถือว่าปลอดภัยพอสำหรับ client-side)

---

## 8. ตั้งตัวเองเป็นแอดมินคนแรก

1. Deploy เว็บ (route.html, admin.html) ขึ้น GitHub Pages ตามปกติ
2. เปิด `https://usmanwaji.github.io/waterchaidantai/route.html` แล้วกด **เข้าสู่ระบบด้วย Google** ด้วยบัญชี `newusmanwaji@gmail.com`
   - ตอนนี้บัญชีจะถูกสร้างในสถานะ "pending" (ยังไม่มีแอดมินอนุมัติได้ เพราะยังไม่มีแอดมิน)
3. กลับไป Supabase → SQL Editor → รันคำสั่งนี้ (แก้ให้ตรงอีเมลถ้าใช้อีเมลอื่น):
   ```sql
   update public.profiles
     set role = 'admin', status = 'approved', approved_at = now()
     where email = 'newusmanwaji@gmail.com';
   ```
4. รีเฟรชหน้า `admin.html` → ควรเข้าหน้าผู้ดูแลระบบได้แล้ว

จากนี้ไป คนอื่นที่ล็อกอินจะขึ้นสถานะ "รออนุมัติ" ในหน้า `admin.html` ให้คุณกด ✓/✕ ได้เลย

---

## 9. ทดสอบทั้งระบบ

- [ ] แผนที่ Google Maps แสดงผลบนหน้า `route.html` (ภาษาไทย)
- [ ] ค้นหาสถานที่ด้วย Google Places Autocomplete ทำงานถูกต้อง
- [ ] ค้นหาเส้นทาง + เส้นทางทางเลือกแสดงบนแผนที่
- [ ] ล็อกอิน Google ที่ `route.html` สำเร็จ
- [ ] บัญชีใหม่ขึ้นสถานะ "รออนุมัติ" (ยังบันทึกรายงานไม่ได้)
- [ ] อนุมัติจาก `admin.html` แล้วกลับไปที่ `route.html` บันทึกรายงานน้ำท่วมได้
- [ ] จุดน้ำท่วมที่บันทึกแสดงบนแผนที่และในการค้นหาเส้นทาง
- [ ] เลือกประเภทรถต่างกัน แล้วผลลัพธ์ "ผ่านได้/ผ่านไม่ได้" เปลี่ยนตามความลึกน้ำถูกต้อง
- [ ] (ถ้าตั้งข้อ 5) มีอีเมลแจ้งเตือนไปที่ newusmanwaji@gmail.com เมื่อมีผู้สมัครใหม่

---

## หมายเหตุสำคัญ

- **เส้นทาง + แผนที่ (Google Maps)**: ใช้ Google Maps JavaScript API ซึ่งมีเครดิตฟรี $200/เดือน เพียงพอสำหรับการใช้งานระดับหน่วยงาน ตรวจสอบการใช้งานได้ที่ Google Cloud Console → APIs & Services → Dashboard
- **API Key Security**: ควรจำกัด referrer ให้เฉพาะโดเมนที่ใช้งาน (เช่น `https://usmanwaji.github.io/*`) เพื่อป้องกันการใช้งานโดยคนอื่น
- **ระดับความลึกน้ำที่ปลอดภัยต่อรถแต่ละประเภท** (ในไฟล์ `js/supabase-client.js`, ตัวแปร `VEHICLE_TYPES`) เป็นค่าอ้างอิงทั่วไป ปรับตัวเลขให้ตรงกับสภาพจริงของพื้นที่ได้ตลอดเวลา
- Claude ไม่ได้และจะไม่จัดการรหัสผ่าน/API key ของคุณโดยตรง ทุกขั้นตอนข้างต้นทำในบัญชีของคุณเองทั้งหมด

# shelter-sync — ข้อมูลศูนย์พักพิง ปภ. วันละ 2 รอบ

ดึงข้อมูลศูนย์พักพิง จ.นราธิวาส ล่าสุดจาก **ระบบหลังบ้าน ปภ.** (https://shelter.disaster.go.th/backoffice/dashboard)
แล้วเขียนเป็น `data/shelters-ddpm.json` ให้หน้า https://naraflood.com/shelter แสดง

- รันอัตโนมัติด้วย GitHub Actions (`.github/workflows/shelter-sync.yml`) **06:17 และ 18:17 น.** เวลาไทย
  (GitHub อาจเริ่มช้ากว่ากำหนด 5-30 นาที)
- ได้ข้อมูลใหม่ → commit ลง `main` → สั่ง deploy Cloudflare Pages เอง
- ดึงไม่ได้/ได้ข้อมูลน้อยผิดปกติ → ไม่เขียนทับ หน้าเว็บใช้ชุดเดิม · ชุดเดิมเก่าเกิน 3 วัน → หน้าเว็บกลับไปใช้ชั้น ArcGIS UAT สาธารณะเอง

## ตั้งค่าครั้งแรก

1. GitHub → repo `waterchaidantai` → **Settings → Secrets and variables → Actions → New repository secret**
   - `DDPM_SHELTER_USER` = ชื่อผู้ใช้ระบบศูนย์พักพิง ปภ.
   - `DDPM_SHELTER_PASS` = รหัสผ่าน
2. **Actions → Sync shelters from DDPM backoffice → Run workflow** เพื่อลองรันครั้งแรก
3. ดู log ขั้น **Fetch shelters**: มี "รายงานสิ่งที่หน้าเว็บโหลด" (URL, ชื่อฟิลด์, จำนวนแถว · ไม่มีค่าข้อมูล)
   และบรรทัดสรุป `พบรายการคล้ายศูนย์พักพิง … · นราธิวาส … แถว`

## ถ้าล้มเหลว

- `ล็อกอินไม่สำเร็จ` → ตรวจ secret · ถ้าระบบมี CAPTCHA/OTP สคริปต์นี้ใช้ไม่ได้
- `ไม่พบรายการศูนย์พักพิงนราธิวาส` → หน้า dashboard ไม่ได้โหลดรายการศูนย์ทั้งหมด
  ให้ใส่ path หน้ารายการศูนย์ (เช่น `/backoffice/shelters`) ในช่อง `extra_paths` ตอนกด Run workflow
  ใช้ได้แล้วตั้งถาวรที่ **Settings → Secrets and variables → Actions → Variables** ชื่อ `SHELTER_EXTRA_PATHS`

## รันบนเครื่องตัวเอง

```
cd shelter-sync
npm install && npx playwright install chromium
DDPM_SHELTER_USER=... DDPM_SHELTER_PASS=... node sync.mjs ../data/shelters-ddpm.json
```

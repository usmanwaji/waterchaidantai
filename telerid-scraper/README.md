# telerid-scraper — ภาพกล้อง+ระดับน้ำ โทรมาตร กรมชลประทาน (5 จังหวัดใต้)

ดึงภาพกล้อง CCTV + ระดับน้ำ ของสถานีโทรมาตร [telerid.rid.go.th](https://telerid.rid.go.th/)
ใน **สตูล · สงขลา · ปัตตานี · ยะลา · นราธิวาส** ด้วย **Playwright (เบราว์เซอร์จริงแบบ headless)**
แล้ว publish ภาพขึ้นสาขา `cam` ให้ dashboard ดึงไปแสดง

> ทำไมต้องใช้เบราว์เซอร์: API ภาพของ telerid ต้องมี token ที่หน้าเว็บสร้างตอนรัน + มี WAF บล็อกการเรียกตรง ๆ
> จึงต้องเปิดแอปจริงให้มันจัดการ token เอง แล้วเราค่อยเก็บภาพ (แนวเดียวกับ Hatyai City Climate ที่รันเซิร์ฟเวอร์ดึงภาพมาโฮสต์)

## วิธีติดตั้ง (ครั้งเดียว)

1. วางโฟลเดอร์ `telerid-scraper/` และไฟล์ `.github/workflows/telerid-cctv.yml` ไว้ใน repo `usmanwaji/waterchaidantai`
2. push ขึ้น GitHub → ไปแท็บ **Actions** → เปิดใช้งาน workflow ถ้าถูกถาม
3. กด **Run workflow** (telerid-cctv-scrape) เพื่อรันครั้งแรกด้วยมือ
4. หลังรันเสร็จ จะมีสาขาใหม่ชื่อ **`cam`** โผล่ขึ้นมา ข้างในมี `{CODE}.jpg` + `stations.json`

หลังจากนั้นมันจะรันเองทุก 15 นาที (แก้ `cron` ในไฟล์ workflow ได้)

## ถ้ารันครั้งแรกแล้วไม่ได้ภาพ

เปิดไฟล์ในสาขา `cam`:
- **`stations.json`** — ดู `tokenCaptured`, `withImage`, และ `imgStatus` ของแต่ละสถานี
- **`_discovery.json`** — request จริงที่แอปยิง (ไว้ดูว่า API ภาพหน้าตายังไง)

แล้วส่ง 2 ไฟล์นี้ให้ผม (Claude) ปรับสคริปต์ให้ตรง

**ถ้า anonymous ดึงไม่ได้จริง ๆ** (token ต้องล็อกอิน) → ไปที่ repo **Settings → Secrets and variables → Actions**
เพิ่ม secret 2 ตัว: `RID_USER`, `RID_PASS` (บัญชี RID ของท่าน) แล้วรันใหม่
— token/รหัสจะอยู่ในฝั่ง Action เท่านั้น **ไม่โผล่ในหน้าเว็บสาธารณะ**

## dashboard อ่านจากไหน

`map.js` มีค่า `TELERID_CAM` ชี้ไปที่:
```
https://raw.githubusercontent.com/usmanwaji/waterchaidantai/cam/
```
โหลด `stations.json` มาปักหมุด + แสดง `<img>` จาก `{CODE}.jpg` (ใส่ ?v=เวลา กันแคช)
ถ้ายังไม่มีสาขา `cam` → หมุดโทรมาตรจะกลับไปเป็นลิงก์ออกเหมือนเดิม (ไม่พัง)

## รันในเครื่องเพื่อทดสอบ (ไม่บังคับ)

```bash
cd telerid-scraper
npm install
npx playwright install chromium
node scrape.mjs      # ได้ผลใน ./telerid-cam/
```

# naraflood — แอป Android (TWA)

แอปนี้คือ **TWA (Trusted Web Activity)** = ห่อเว็บ naraflood.com เป็นแอป Android
ไม่ได้เขียนโค้ดแอปใหม่ ตัวแอปเปิดเว็บเดิมแบบเต็มจอ ไม่มีแถบเบราว์เซอร์

**ข้อดีที่สำคัญที่สุด:** เว็บอัปเดตเมื่อไหร่ แอปอัปเดตทันที
แก้เกณฑ์เตือน แก้การ์ด เพิ่มหน้าใหม่ → push ขึ้น main แล้วจบ
**ไม่ต้องปล่อยเวอร์ชันใหม่ขึ้น Play Store** (ปล่อยใหม่เฉพาะตอนเปลี่ยนไอคอน ชื่อ หรือสีของตัวแอป)

---

## สิ่งที่มีอยู่แล้วในรีโป

| ไฟล์ | ใช้ทำอะไร |
|------|-----------|
| `manifest.json` | PWA manifest ของเว็บ — bubblewrap อ่านค่าจากนี่ |
| `twa-manifest.json` | ค่าตั้งของตัวแอป (ชื่อ สี ไอคอน ทางลัด) — ตรวจผ่าน validator ของ bubblewrap แล้ว |
| `.well-known/assetlinks.json` | ไฟล์ยืนยันว่าเว็บนี้กับแอปนี้เป็นเจ้าของเดียวกัน — **ยังต้องเติมลายนิ้วมือ** |
| `sw.js` | service worker เดิม — ทำให้แอปใช้งานออฟไลน์ได้อยู่แล้ว |

## สิ่งที่ต้องมีในเครื่องที่ build

- **JDK 17+** และ **Android SDK** (ลง Android Studio แล้วได้ทั้งคู่)
- **Node 18+**
- บัญชี **Google Play Console** (ค่าสมัครครั้งเดียว 25 USD) ถ้าจะขึ้นสโตร์

> build ในแซนด์บ็อกซ์ของ Claude ไม่ได้ เพราะ `dl.google.com` ถูกบล็อกด้วย network policy
> (ที่โหลด Android SDK กับ artifact ของ Google) จึงต้อง build บนเครื่องตัวเอง

---

## ขั้นตอน

### 1) ติดตั้ง bubblewrap
```bash
npm i -g @bubblewrap/cli
```

### 2) สร้างโปรเจกต์ Android จากค่าที่เตรียมไว้
```bash
mkdir -p ~/naraflood-android && cd ~/naraflood-android
cp /path/to/waterchaidantai/twa-manifest.json .
bubblewrap init --manifest=https://naraflood.com/manifest.json
```
ตอนถาม ให้กด Enter รับค่าที่มีอยู่ (มันอ่านจาก `twa-manifest.json` ที่ copy มา)
ครั้งแรก bubblewrap จะขอโหลด JDK/Android SDK ให้เอง ตอบ yes ได้

### 3) สร้าง keystore (ทำครั้งเดียว — ห้ามหาย)
```bash
keytool -genkeypair -v -keystore android.keystore -alias android \
  -keyalg RSA -keysize 2048 -validity 10000
```

> **เก็บ `android.keystore` + รหัสผ่านให้ดีที่สุด** สำรองไว้นอกเครื่องด้วย
> ถ้าหาย จะอัปเดตแอปตัวเดิมบน Play Store ไม่ได้อีกเลย ต้องขึ้น package ใหม่ทั้งหมด
> (ถ้าเปิด Play App Signing ไว้ Google จะถือกุญแจจริงให้ ลดความเสี่ยงข้อนี้ลงมาก — แนะนำให้เปิด)

### 4) build
```bash
bubblewrap build
```
ได้ `app-release-bundle.aab` (ขึ้น Play Store) และ `app-release-signed.apk` (ลงเครื่องทดสอบเอง)

### 5) เอาลายนิ้วมือใส่ `assetlinks.json` ← **ขั้นที่พลาดกันบ่อยที่สุด**

ถ้าไม่ทำขั้นนี้ แอปจะเปิดได้แต่ **โผล่แถบ URL ของเบราว์เซอร์ด้านบน** (verification ไม่ผ่าน)

- **ใช้ Play App Signing (แนะนำ):** อัปโหลด `.aab` ขึ้น Play Console ก่อน แล้วไปที่
  **Release → Setup → App signing** คัดลอก **SHA-256 certificate fingerprint**
- **เซ็นเอง:** `keytool -list -v -keystore android.keystore -alias android` แล้วอ่านค่า SHA256

เอาค่าที่ได้ไปแทน `REPLACE_WITH_SHA256_FINGERPRINT_FROM_PLAY_CONSOLE` ใน
`.well-known/assetlinks.json` แล้ว push ขึ้น main (Cloudflare deploy เอง)

จากนั้น **ตรวจว่าไฟล์เสิร์ฟจริง**:
```bash
curl -i https://naraflood.com/.well-known/assetlinks.json
```
ต้องได้ `200` และ `content-type: application/json`
(Cloudflare ยอมเสิร์ฟโฟลเดอร์ `.well-known` อยู่แล้ว เป็นข้อยกเว้นของกฎที่ข้ามไฟล์ขึ้นต้นด้วยจุด
แต่ยังไม่เคยยิงทดสอบจากที่นี่ เพราะโดเมนถูกบล็อกในแซนด์บ็อกซ์ — กรุณายืนยันด้วยคำสั่งข้างบน)

เช็คอีกทางด้วยเครื่องมือของ Google:
```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://naraflood.com&relation=delegate_permission/common.handle_all_urls
```

### 6) ขึ้น Play Store
อัปโหลด `.aab` → กรอกคำอธิบาย ภาพหน้าจอ นโยบายความเป็นส่วนตัว → ส่งตรวจ
รอบแรกมักใช้เวลาตรวจ 2–7 วัน

**นโยบายความเป็นส่วนตัว** มีอยู่แล้วที่ `https://naraflood.com/privacy.html`
ใส่ URL นี้ในช่อง Privacy Policy ของ Play Console ได้เลย · เขียนโดยผู้พัฒนาเว็บ
อธิบายตามจริงว่าระบบเก็บ/ใช้/แสดงข้อมูลอะไรบ้าง **ไม่ใช่เอกสารที่ผ่านการตรวจสอบ
ทางกฎหมาย** — ถ้าจะยื่นในนามหน่วยงานราชการอย่างเป็นทางการ ควรให้ผู้เชี่ยวชาญ
ด้านกฎหมาย/PDPA ตรวจอีกรอบก่อน

Play Console ยังมีแบบฟอร์ม **Data Safety** ที่ต้องกรอกแยกต่างหาก (ไม่ใช่แค่แปะลิงก์
พอ) — เนื้อหาที่ต้องกรอกตรงกับตารางในหน้า privacy.html: chat id ของ Telegram
(เก็บ · ใช้ส่งแจ้งเตือน · ผู้ใช้ลบเองได้ผ่าน `/stop`) และอีเมล/ชื่อจาก Google Sign-In
(เฉพาะบัญชีเจ้าหน้าที่/สมาชิก ไม่ใช่ผู้เยี่ยมชมทั่วไป)

---

## เรื่องที่ตัดสินใจไว้แล้ว (และเหตุผล)

**`enableNotifications: false`** — ตั้งใจปิดไว้ เพราะเว็บยังไม่ได้ทำ Web Push
ถ้าเปิดทิ้งไว้ แอปจะขอสิทธิ์แจ้งเตือนจากผู้ใช้ทั้งที่ไม่เคยส่งอะไรเลย
ตอนนี้การแจ้งเตือนใช้ **Telegram** (ดู `DEPLOY.md` ข้อ 3) ซึ่งส่งถึงมือถือได้อยู่แล้วโดยไม่ต้องพึ่งแอป

ถ้าวันหนึ่งอยากให้แอปเด้งเตือนเอง ต้องทำเพิ่ม:
1. ฝั่งเว็บ: service worker รับ `push` + สมัคร subscription (VAPID)
2. ฝั่งหลังบ้าน: ส่ง push ไปที่ endpoint ของ subscription
3. แล้วค่อยเปลี่ยนเป็น `enableNotifications: true` แล้ว build ใหม่

**`packageId: com.naraflood.app`** — ตั้งชื่อตามโดเมน
เปลี่ยนได้ก่อนขึ้นสโตร์ครั้งแรกเท่านั้น หลังจากนั้นเปลี่ยนไม่ได้แล้ว

**`minSdkVersion: 21`** (Android 5.0) — ครอบคลุมเครื่องเก่าในพื้นที่
TWA ต้องการ Chrome 72+ บนเครื่องนั้นด้วย เครื่องที่ Chrome เก่ากว่านั้น
จะถอยไปเปิดแบบ Custom Tabs ให้เอง (ตั้งไว้ที่ `fallbackType: customtabs`)

---

## อัปเดตแอปภายหลัง

| เปลี่ยนอะไร | ต้อง build ใหม่ไหม |
|-------------|--------------------|
| เนื้อหาเว็บ การ์ด เกณฑ์ ทุกอย่างในหน้าเว็บ | **ไม่ต้อง** — push ขึ้น main พอ |
| ไอคอน ชื่อแอป สีธีม ทางลัด | ต้อง — แก้ `twa-manifest.json` → `bubblewrap update` → `bubblewrap build` → อัปโหลดใหม่ |
| เปิด Web Push | ต้อง — ดูหัวข้อด้านบน |

ตอน build ใหม่ อย่าลืมเพิ่ม `appVersionCode` ใน `twa-manifest.json` (Play ไม่รับเลขซ้ำ)

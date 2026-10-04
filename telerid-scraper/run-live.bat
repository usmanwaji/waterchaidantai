@echo off
rem run-live.bat — โหมดสด: เปิดค้างไว้ ดึง telerid ทุก 2 นาที ส่งขึ้น GitHub (สาขา cam) เฉพาะตอนค่าเปลี่ยน
rem หน้าแผนที่จะเห็นค่าใหม่ภายในไม่กี่นาทีหลังสถานีส่งค่า (สถานีส่งทุก 15 นาที)
rem ปิดหน้าต่างนี้ = หยุด · ดู log ที่ telerid-live.log · เปลี่ยนรอบได้ด้วย setx WATCH_MIN 3
rem ถ้ามีตัวหนึ่งรันอยู่แล้ว ตัวที่เปิดซ้ำจะปิดตัวเองทันที (ตั้ง Task Scheduler ให้เรียกซ้ำได้ไม่ซ้อนกัน)
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo ติดตั้งครั้งแรก... รอสัก 2-3 นาที นะครับ
  call npm install || goto :err
  call npx playwright install chromium || goto :err
)

echo โหมดสดทำงานอยู่ - ปิดหน้าต่างนี้เพื่อหยุด (log: telerid-live.log)
:loop
node scrape.mjs --watch
rem 0 = มีตัวอื่นรันอยู่แล้ว/สั่งหยุด · 2 = ตั้งค่าไม่ครบ (GH_TOKEN) · 1 = ล่ม → รอ 1 นาทีแล้วเริ่มใหม่
if errorlevel 2 goto :err
if errorlevel 1 (
  ping -n 61 127.0.0.1 >nul
  goto :loop
)
goto :eof

:err
echo.
echo !!! มีข้อผิดพลาด - อ่านข้อความด้านบน หรือเปิดไฟล์ telerid-live.log !!!
if /i not "%~1"=="hidden" pause
exit /b 1

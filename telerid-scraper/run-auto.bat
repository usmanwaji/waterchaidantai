@echo off
rem run-auto.bat — เวอร์ชันอัตโนมัติ (ไม่มี pause) สำหรับ Task Scheduler
rem ดึงภาพ+ระดับน้ำ telerid แล้ว publish ขึ้นสาขา cam — เขียน log ไว้ที่ telerid-auto.log
chcp 65001 >nul
cd /d "%~dp0"
set "LOG=%~dp0telerid-auto.log"
echo ================ START %date% %time% ================>> "%LOG%"
call node scrape.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo !!! scrape ล้มเหลว - ไม่ publish ^(กันไม่ให้ข้อมูลเก่าทับของใหม่^)>> "%LOG%"
  echo ---------------- FAILED %date% %time% ----------------->> "%LOG%"
  exit /b 1
)
call node publish-github.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo !!! publish ล้มเหลว>> "%LOG%"
  echo ---------------- FAILED %date% %time% ----------------->> "%LOG%"
  exit /b 1
)
echo ---------------- DONE  %date% %time% ----------------->> "%LOG%"

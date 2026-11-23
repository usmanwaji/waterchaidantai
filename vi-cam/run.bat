@echo off
rem run.bat — จับภาพกล้องเทศบาลจาก VI MonitorPlus แล้วส่งขึ้นสาขา vicam (Task Scheduler เรียกทุก 20 นาทีผ่าน run-hidden.vbs)
rem log อยู่ที่ vi-cam.log · ไม่มีภาพ (exit 2) = ไม่ส่งอะไรขึ้นไป ภาพเดิมบนเว็บยังอยู่พร้อมเวลาที่ถ่าย
chcp 65001 >nul
cd /d "%~dp0"
set "LOG=%~dp0vi-cam.log"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture.ps1" >> "%LOG%" 2>&1
if errorlevel 2 exit /b 0
if errorlevel 1 (
  echo %date% %time% !!! capture ผิดพลาด>> "%LOG%"
  exit /b 1
)
set "PUBLISH_DIR=%~dp0out"
set "GH_BRANCH=vicam"
node "%~dp0..\telerid-scraper\publish-github.mjs" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo %date% %time% !!! publish ล้มเหลว>> "%LOG%"
  exit /b 1
)

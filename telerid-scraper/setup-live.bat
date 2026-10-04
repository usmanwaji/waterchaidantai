@echo off
rem setup-live.bat - one-time setup of telerid live mode (double-click). Details: setup-live.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-live.ps1"
echo.
pause

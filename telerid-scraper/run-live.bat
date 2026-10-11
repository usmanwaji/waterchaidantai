@echo off
rem run-live.bat - live mode: checks telerid every 2 minutes, uploads to GitHub (branch cam) only when values change.
rem Close this window to stop. Log: telerid-live.log - startup errors: telerid-live-error.log
rem Safe to start again: if live mode is already running, the new copy exits at once.
rem The "telerid live" task (setup-live.ps1) starts it every 15 minutes, so a crash or reboot recovers by itself.
rem This file is ASCII only on purpose (works in any folder name / Windows language).
cd /d "%~dp0"
set "ERRLOG=%~dp0telerid-live-error.log"

rem node.exe path saved by setup-live.ps1 (scheduled tasks may not see a freshly updated PATH)
set "NODE=node"
if exist "%~dp0node-path.txt" set /p NODE=<"%~dp0node-path.txt"

if not exist "%~dp0node_modules\playwright" (
  echo %date% %time% node_modules missing - installing>> "%ERRLOG%"
  call npm install --no-audit --no-fund >> "%ERRLOG%" 2>&1 || goto :err
  call npx playwright install chromium >> "%ERRLOG%" 2>&1 || goto :err
)

echo Live mode is running - close this window to stop (log: telerid-live.log)
"%NODE%" scrape.mjs --watch 2>> "%ERRLOG%"
rem 0 = another copy is already running / stopped normally; 1 = crashed; 2 = GH_TOKEN missing
if errorlevel 1 goto :err
exit /b 0

:err
echo %date% %time% run-live.bat stopped with error %errorlevel% (node: %NODE%)>> "%ERRLOG%"
echo.
echo !!! Live mode stopped with an error - see telerid-live-error.log and telerid-live.log !!!
if /i not "%~1"=="hidden" pause
exit /b 1

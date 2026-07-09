@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo   ดึงภาพกล้อง telerid (5 จังหวัดใต้) - รันบนเครื่องนี้
echo ==================================================
echo.

if not exist node_modules (
  echo [1/3] ติดตั้งครั้งแรก... รอสัก 2-3 นาที นะครับ
  call npm install || goto :err
  call npx playwright install chromium || goto :err
) else (
  echo [1/3] ติดตั้งครบแล้ว ข้ามไป
)

echo.
echo [2/3] กำลังเปิด telerid และดึงภาพกล้อง...
call node scrape.mjs || goto :err

echo.
echo [3/3] กำลังส่งภาพขึ้น GitHub (สาขา cam)...
call node publish-github.mjs || goto :err

echo.
echo *** เสร็จเรียบร้อย! ***
echo เปิดเว็บหน้า "สถานการณ์" เปิดชั้น "โทรมาตร ชป." คลิกหมุด (สามเหลี่ยม) ดูภาพได้เลย
goto :done

:err
echo.
echo !!! มีข้อผิดพลาด - เลื่อนขึ้นไปอ่านบรรทัดสีแดง/ข้อความด้านบน แล้วแคปส่งให้ผมดูได้ครับ !!!

:done
echo.
pause

@echo off
title REA Desktop Studio - Standalone Decompiler
color 0b

echo ======================================================================
echo           REA DESKTOP STUDIO - NATIVE STANDALONE APP
echo ======================================================================
echo.

:: 1. Giai phong cong 3399 neu co tien trinh cu
echo [1/2] Kiem tra va giai phong cong mang 3399...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3399 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: 2. Kiem tra Node.js
echo [2/2] Kiem tra Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js tai https://nodejs.org
    pause
    exit /b
)

echo.
echo [OK] Dang khoi dong Server... Cua so Desktop App se tu dong mo len ngay!
echo ======================================================================
echo   (Giu cua so terminal nay khi dung, dong cua so nay de thoat app)
echo ======================================================================
echo.

node server/index.js
pause

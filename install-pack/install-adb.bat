@echo off
REM Optional: install schoolie.apk over USB (requires adb on PATH)
cd /d "%~dp0"
if not exist "schoolie.apk" (
  echo Missing schoolie.apk in this folder.
  pause
  exit /b 1
)
where adb >nul 2>&1
if errorlevel 1 (
  echo adb not found. On Android: open 00-OPEN-ME-TO-INSTALL.html or schoolie.apk.
  pause
  exit /b 1
)
adb devices
adb install -r schoolie.apk
echo Installed. Open Schoolie on the phone.
pause

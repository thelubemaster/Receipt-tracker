@echo off
REM Optional: install Project Cost Tracker APK over USB (requires adb on PATH)
cd /d "%~dp0"
set APK=
if exist "00-INSTALL-Project-Cost-Tracker.apk" set APK=00-INSTALL-Project-Cost-Tracker.apk
if not defined APK if exist "project-cost-tracker.apk" set APK=project-cost-tracker.apk
if not defined APK if exist "schoolie.apk" set APK=schoolie.apk
if not defined APK (
  echo Missing APK in this folder.
  pause
  exit /b 1
)
where adb >nul 2>&1
if errorlevel 1 (
  echo adb not found. On Android: open 00-INSTALL-Project-Cost-Tracker.apk instead.
  pause
  exit /b 1
)
adb devices
adb install -r "%APK%"
echo Installed. Open Project Cost Tracker on the phone.
pause

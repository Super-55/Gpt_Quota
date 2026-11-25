@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Please run npm install first.
  pause
  exit /b 1
)
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "Quota Glass" node_modules\electron\dist\electron.exe .

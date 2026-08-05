@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
call "%~dp0BUILD_DESKTOP_WINDOWS.cmd"
if errorlevel 1 (
  echo.
  echo Build failed. Check the messages above.
  pause
  exit /b 1
)

set "SETUP="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%~dp0desktop-app\dist\*Setup-x64.exe" 2^>nul') do (
  if not defined SETUP set "SETUP=%~dp0desktop-app\dist\%%F"
)

if not defined SETUP (
  echo.
  echo Installer was not found in: %~dp0desktop-app\dist
  pause
  exit /b 1
)

echo.
echo Starting local installer:
echo !SETUP!
start "" /wait "!SETUP!"
if errorlevel 1 (
  echo.
  echo Installer returned an error.
  pause
  exit /b 1
)

echo.
echo Local installation finished.
pause

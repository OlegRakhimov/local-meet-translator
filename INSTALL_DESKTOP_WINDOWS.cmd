@echo off
setlocal
cd /d "%~dp0"
call "%~dp0BUILD_DESKTOP_WINDOWS.cmd"
if errorlevel 1 (
  echo.
  echo Build failed. Check the messages above.
  pause
  exit /b 1
)
echo.
echo Installer is ready in: %~dp0desktop-app\dist
echo Run the *Setup-x64.exe file, then keep "Create desktop shortcut" enabled.
start "" "%~dp0desktop-app\dist"
pause

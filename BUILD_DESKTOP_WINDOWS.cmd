@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\desktop\build-windows-installer.ps1"
exit /b %errorlevel%

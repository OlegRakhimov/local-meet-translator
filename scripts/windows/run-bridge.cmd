\
@echo off
REM Convenience wrapper for PowerShell script.
REM Usage from repo root:
REM   scripts\windows\run-bridge.cmd

powershell -ExecutionPolicy Bypass -File "%~dp0run-bridge.ps1"

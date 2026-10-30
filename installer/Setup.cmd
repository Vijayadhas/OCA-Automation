@echo off
setlocal
cd /d "%~dp0"
title OCA Automation Setup

if not exist "%~dp0installer\Setup.ps1" (
  echo [ERROR] installer\Setup.ps1 was not found next to Setup.cmd.
  echo Right-click the downloaded zip, choose "Extract All", then run Setup.cmd from the extracted folder.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\Setup.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_EXIT%

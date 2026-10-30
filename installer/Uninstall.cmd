@echo off
setlocal
title Uninstall OCA Automation
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "DATA_DIR=%LOCALAPPDATA%\OCA-Automation"

echo This removes OCA Automation from:
echo   %APP_DIR%
echo.
choice /C YN /M "Uninstall OCA Automation"
if errorlevel 2 exit /b 0

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$app = $env:APP_DIR;" ^
  "Get-Process -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and $_.Path.StartsWith($app, [StringComparison]::OrdinalIgnoreCase) } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue;" ^
  "Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'OCA Automation.lnk') -Force -ErrorAction SilentlyContinue;" ^
  "Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'OCA Automation.lnk') -Force -ErrorAction SilentlyContinue"

echo.
echo Your runs, browser sign-in and settings are in:
echo   %DATA_DIR%
choice /C YN /M "Delete them too"
if errorlevel 2 goto remove_app
rmdir /s /q "%DATA_DIR%" 2>nul

:remove_app
echo.
echo OCA Automation is uninstalled.
pause
rem This file is inside the folder being removed, so the folder is deleted by a separate window.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & rmdir /s /q "%APP_DIR%""
exit /b 0

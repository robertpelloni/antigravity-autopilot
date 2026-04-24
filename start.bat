@echo off
setlocal
title Antigravity Autopilot
cd /d "%~dp0"

echo [Antigravity Autopilot] Starting...
where npm >nul 2>nul
if errorlevel 1 (
    echo [Antigravity Autopilot] npm not found. Please install it.
    pause
    exit /b 1
)

npm run compile && npm run watch

if errorlevel 1 (
    echo [Antigravity Autopilot] Exited with error code %errorlevel%.
    pause
)
endlocal

@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer, then run this file again.
  pause
  exit /b 1
)
echo AI Sana: http://127.0.0.1:8765
echo Keep this window open while using the website.
node server.mjs
pause

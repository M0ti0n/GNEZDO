@echo off
rem Starts GNEZDO. Close this window to stop it.
cd /d "%~dp0"
if not exist config.json copy config.example.json config.json >nul
start "" http://localhost:8090
GNEZDO.exe
pause


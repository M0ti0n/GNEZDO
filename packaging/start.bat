@echo off
rem Starts GNEZDO. Close this window to stop it.
cd /d "%~dp0"
if not exist config.json copy config.example.json config.json >nul
set GNEZDO_CONFIG=%~dp0config.json
start "" http://localhost:8090
"%~dp0program\GNEZDO.exe"
pause

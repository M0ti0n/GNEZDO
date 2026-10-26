@echo off
rem Starts GNEZDO. Close this window to stop it.
cd /d "%~dp0"
if not exist config.json copy config.example.json config.json >nul
set GNEZDO_CONFIG=%~dp0config.json

rem Company rules may not let GNEZDO.exe run from this folder ("Access is denied").
"%~dp0program\GNEZDO.exe" --check >nul 2>&1
if errorlevel 1 goto blocked

start "" http://localhost:8090
"%~dp0program\GNEZDO.exe"
pause
exit /b

:blocked
echo.
echo This PC does not let GNEZDO.exe run from this folder (company rules or a download block).
echo See INSTALL.txt, part 5. Meanwhile the DEMO starts with Python instead (nothing is saved).
echo.
where py >nul 2>&1
if errorlevel 1 goto nopython
py -3 demo_server.py
pause
exit /b

:nopython
echo Python is not installed either, so the demo cannot start. See INSTALL.txt, part 5.
pause

@echo off
setlocal enabledelayedexpansion
REM Trakerz - one-click local launcher (Windows)
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: Python was not found on your PATH.
    echo Install Python 3.9+ from https://www.python.org/downloads/
    echo and make sure to check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to create the virtual environment.
        echo.
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat

echo Installing/checking dependencies...
python -m pip install -q --upgrade pip
python -m pip install -q -r backend\requirements.txt
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies ^(see pip output above^).
    echo This can happen if you have no internet connection, or if a
    echo package has no prebuilt version yet for your Python version.
    echo Try again, or ask for help with the exact error above.
    echo.
    pause
    exit /b 1
)

echo.
echo Starting Trakerz server...
cd backend
start "Trakerz Server" /min ..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
cd ..

echo Waiting for the server to come up...
set READY=
for /l %%i in (1,1,25) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:8000/api/dashboard -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        set READY=1
        goto :ready
    )
    timeout /t 1 /nobreak >nul
)
:ready

if defined READY (
    start "" http://127.0.0.1:8000
    echo.
    echo Trakerz is running at http://127.0.0.1:8000
    echo A minimized window called "Trakerz Server" is now running the app.
    echo Closing THAT window stops the app. You can close this window.
    echo.
) else (
    echo.
    echo ERROR: The server did not respond within 25 seconds.
    echo Look for a window titled "Trakerz Server" for the actual error
    echo ^(it may be minimized in your taskbar^), or run this manually:
    echo   .venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
    echo.
)
pause

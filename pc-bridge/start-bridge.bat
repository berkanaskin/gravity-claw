@echo off
:: ── Gravity Claw PC Bridge — Auto Start ─────────────
:: Starts Chrome CDP, PC Bridge server, and SSH tunnel.
:: Placed in Windows Startup folder for auto-launch on login.

echo [%date% %time%] === Gravity Claw PC Bridge Starting === >> "%~dp0bridge.log"

:: 1. Start Chrome with CDP (if not already running)
tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] Starting Chrome with CDP port 9222... >> "%~dp0bridge.log"
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
    timeout /t 3 /nobreak >NUL
) else (
    echo [%date% %time%] Chrome already running >> "%~dp0bridge.log"
)

:: 2. Start SSH reverse tunnel (background)
echo [%date% %time%] Starting SSH tunnel... >> "%~dp0bridge.log"
start /min "" "%~dp0start-tunnel.bat"

:: 3. Wait for tunnel to establish
timeout /t 3 /nobreak >NUL

:: 4. Start PC Bridge WebSocket server
echo [%date% %time%] Starting PC Bridge server... >> "%~dp0bridge.log"
cd /d "%~dp0"
node dist/server.js >> "%~dp0bridge.log" 2>&1

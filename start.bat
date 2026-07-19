@echo off
cd /d "%~dp0"

:: Kill any existing instance on port 7860
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7860" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$me=$PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and (($_.Name -match '^(python|pythonw)\.exe$' -and $_.CommandLine -like '*app.py*') -or ($_.Name -match '^(cmd|powershell)\.exe$' -and $_.CommandLine -like '*app.py*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-Process chrome,msedge,firefox,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '7860|127\.0\.0\.1|Local LLM' } | ForEach-Object { $null = $_.CloseMainWindow() }" >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo  Local LLM Chat - Starting...
echo.

:: Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo  Python not found. Install from https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

:: Create venv if it doesn't exist
if not exist "venv" (
    echo  Creating virtual environment...
    python -m venv venv
)

:: Activate venv and install / update dependencies
call venv\Scripts\activate.bat
pip install -r requirements.txt -q

:: Launch the Flask server in a minimised background window
echo  Launching server...
start /min "Local LLM Chat - Server" python app.py

:: Poll port 7860 every 500 ms, up to 15 s, then open browser
echo  Waiting for server to be ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i-lt30;$i++){Start-Sleep -Milliseconds 500;try{$null=(Invoke-WebRequest 'http://127.0.0.1:7860' -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop);Write-Host '  Server ready.';exit 0}catch{}};Write-Host '  Timed out waiting - opening anyway...'"

:: Open the default browser
start "" "http://127.0.0.1:7860"
echo.
echo  Opened http://127.0.0.1:7860 in your browser.
echo  The server is running in a minimised window.
echo  Close this window or the server window to shut down.
echo.
pause

@echo off
cd /d "%~dp0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7860" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$me=$PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and (($_.Name -match '^(python|pythonw)\.exe$' -and $_.CommandLine -like '*app.py*') -or ($_.Name -match '^(cmd|powershell)\.exe$' -and $_.CommandLine -like '*app.py*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-Process chrome,msedge,firefox,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '7860|127\.0\.0\.1|Local LLM' } | ForEach-Object { $null = $_.CloseMainWindow() }" >nul 2>&1
timeout /t 1 /nobreak >nul
echo.
echo  Local LLM Chat - Starting...
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat
pip install -r requirements.txt -q
python app.py

pause

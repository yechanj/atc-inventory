@echo off
set PYTHON32=C:\Users\yechan\AppData\Local\Programs\Python\Python38-32\python.exe

if not exist "%PYTHON32%" (
    echo [ERROR] Python not found: %PYTHON32%
    pause
    exit /b 1
)

echo [INFO] Python: %PYTHON32%

%PYTHON32% -m pip install pyinstaller pyodbc
if errorlevel 1 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
)

%PYTHON32% -m PyInstaller --onefile --windowed --name atc_sync --distpath dist-x86 atc_sync.py
if errorlevel 1 (
    echo [ERROR] PyInstaller failed
    pause
    exit /b 1
)

echo.
echo Done! dist-x86\atc_sync.exe created (32-bit).
echo.
pause

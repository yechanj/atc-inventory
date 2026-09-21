@echo off
chcp 65001 > nul

pip install pyinstaller pyodbc
if errorlevel 1 (
    echo [ERROR] pip install failed
    pause
    exit /b 1
)

pyinstaller --onefile --windowed --name atc_sync atc_sync.py
if errorlevel 1 (
    echo [ERROR] PyInstaller failed
    pause
    exit /b 1
)

echo.
echo Done! dist\atc_sync.exe created.
echo Copy dist\atc_sync.exe to pharmacy PC and run it.
echo.
pause

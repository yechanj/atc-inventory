@echo off
chcp 65001 > nul

:: 32비트 Python 경로 — 설치 위치에 맞게 수정하세요
set PYTHON32=C:\Python312-32\python.exe

if not exist "%PYTHON32%" (
    echo [ERROR] 32비트 Python을 찾을 수 없습니다: %PYTHON32%
    echo 32비트 Python 설치 후 이 파일의 PYTHON32 경로를 수정하세요.
    echo 다운로드: https://www.python.org/downloads/windows/
    echo   ^(Windows installer - 32-bit 선택^)
    pause
    exit /b 1
)

echo [INFO] 32비트 Python: %PYTHON32%

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

copy /Y dist-x86\atc_sync.exe dist-x86\atc_sync.exe > nul

echo.
echo Done! dist-x86\atc_sync.exe created (32-bit).
echo Copy dist-x86\atc_sync.exe and dist\config.json to pharmacy PC.
echo.
pause

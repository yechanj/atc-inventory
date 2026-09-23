@echo off
:: Python 경로 자동 탐색
set PYTHON=

for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python38-32\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python38\python.exe"
    "C:\Python38-32\python.exe"
    "C:\Python38\python.exe"
    "C:\Python310-32\python.exe"
) do (
    if exist %%P (
        set PYTHON=%%P
        goto :found
    )
)

echo [ERROR] Python을 찾을 수 없습니다.
echo Python 3.8 32비트를 설치해주세요.
echo https://www.python.org/downloads/release/python-3810/
pause
exit /b 1

:found
echo [INFO] Python: %PYTHON%
%PYTHON% -m pip install pyodbc --quiet
%PYTHON% atc_sync.py

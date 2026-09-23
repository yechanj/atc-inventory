@echo off
set PYTHON=

for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python38-32\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python38\python.exe"
    "C:\Python38-32\python.exe"
    "C:\Python38\python.exe"
) do (
    if exist %%P (
        set PYTHON=%%P
        goto :found
    )
)

echo [ERROR] Python not found. Install Python 3.8 32-bit.
pause
exit /b 1

:found
echo [INFO] Python: %PYTHON%
%PYTHON% -m pip install pyodbc --quiet
%PYTHON% atc_sync.py

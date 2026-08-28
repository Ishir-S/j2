@echo off
title JARVIS - Personal AI Assistant
color 0b

echo ========================================================
echo                 JARVIS NATIVE ASSISTANT
echo ========================================================
echo.

:: Detect Python executable
set "PYTHON_EXE=python"
python --version >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else (
        echo [ERROR] Python not found in PATH or standard AppData locations.
        pause
        exit /b 1
    )
)

echo [JARVIS] Using Python: %PYTHON_EXE%
echo [JARVIS] Initializing backend daemon and opening HUD...
"%PYTHON_EXE%" run.py

if %errorlevel% neq 0 (
    echo [JARVIS] Server stopped with code %errorlevel%.
    pause
)

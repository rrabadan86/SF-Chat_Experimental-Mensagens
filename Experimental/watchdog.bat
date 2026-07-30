@echo off
chcp 65001 >nul
title Slimfit Watchdog
color 0A

set "APP_DIR=%~dp0"
set "LOG_FILE=%APP_DIR%logs\watchdog.log"
set "SCHEDULER_LOG=%APP_DIR%logs\scheduler.log"
set "LOCK_FILE=%APP_DIR%logs\watchdog.lock"
set "RESTART_DELAY=15"
set "MAX_LOG_SIZE=5242880"

if not exist "%APP_DIR%logs" mkdir "%APP_DIR%logs"

if exist "%LOCK_FILE%" (
    for /f "tokens=*" %%a in (%LOCK_FILE%) do set "OLD_PID=%%a"
    tasklist /FI "PID eq %OLD_PID%" 2>nul | find "%OLD_PID%" >nul
    if not errorlevel 1 (
        echo [%date% %time%] Watchdog ja esta rodando - PID %OLD_PID% - Saindo.
        exit /b 0
    )
    echo [%date% %time%] Lock antigo encontrado - PID morto - Assumindo controle.
)

echo %RANDOM%%RANDOM% > "%LOCK_FILE%"

echo ============================================
echo   Slimfit - Watchdog (Auto-restart)
echo   Dir: %APP_DIR%
echo ============================================
echo.

:loop
echo [%date% %time%] Iniciando scheduler...
echo [%date% %time%] Scheduler iniciado >> "%LOG_FILE%"

if exist "%SCHEDULER_LOG%" (
    for %%A in ("%SCHEDULER_LOG%") do (
        if %%~zA GTR %MAX_LOG_SIZE% (
            copy /y "%SCHEDULER_LOG%" "%SCHEDULER_LOG%.old" >nul 2>&1
            echo. > "%SCHEDULER_LOG%" 2>nul
        )
    )
)

cd /d "%APP_DIR%"
node src/scheduler.js

set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [%date% %time%] Scheduler parou! (exit code: %EXIT_CODE%) Reiniciando em %RESTART_DELAY%s...
echo [%date% %time%] Scheduler parou (exit code: %EXIT_CODE%) >> "%LOG_FILE%"
timeout /t %RESTART_DELAY% /nobreak >nul
goto loop

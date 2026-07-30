@echo off
title Slimfit - Reiniciando Scheduler
color 0E

echo ============================================
echo   Slimfit - Reiniciar Scheduler
echo ============================================
echo.

:: Mata todos os processos node existentes
echo [%date% %time%] Parando processos anteriores...
taskkill /F /IM node.exe >nul 2>&1
if not errorlevel 1 (
    echo   Processos anteriores encerrados.
) else (
    echo   Nenhum processo anterior encontrado.
)
timeout /t 3 /nobreak >nul

:: Inicia o scheduler
echo [%date% %time%] Iniciando scheduler...
cd /d "%~dp0"
start /min "Slimfit Scheduler" node src/scheduler.js

timeout /t 5 /nobreak >nul

:: Verifica se iniciou
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find "node.exe" >nul
if not errorlevel 1 (
    color 0A
    echo.
    echo   ✅ Scheduler reiniciado com sucesso!
) else (
    color 0C
    echo.
    echo   ❌ Falha ao iniciar o scheduler!
)

echo.
echo   Fechando em 5 segundos...
timeout /t 5 /nobreak >nul

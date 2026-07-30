@echo off
:: ─────────────────────────────────────────────────────────
::  Registra o Slimfit Watchdog no Agendador de Tarefas
::  do Windows para iniciar automaticamente no login.
::
::  Execute como Administrador!
:: ─────────────────────────────────────────────────────────
title Slimfit - Setup Agendador de Tarefas
color 0E

echo ============================================
echo   Slimfit - Configurar Inicio Automatico
echo ============================================
echo.

set "APP_DIR=%~dp0"
set "TASK_NAME=SlimfitWatchdog"
set "WATCHDOG_PATH=%APP_DIR%watchdog.bat"

:: Verifica se está rodando como admin
net session >nul 2>&1
if errorlevel 1 (
    echo ERRO: Execute este script como Administrador!
    echo Clique com botao direito ^> "Executar como administrador"
    echo.
    pause
    exit /b 1
)

:: Remove tarefa existente se houver
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

:: Cria a tarefa agendada:
::   - Roda no LOGON do usuario atual
::   - Reinicia a cada 1 hora se falhar
::   - Roda por tempo indefinido
::   - Roda em modo minimizado (nao abre janela cheia)
schtasks /Create ^
    /TN "%TASK_NAME%" ^
    /TR "cmd /c start /min \"Slimfit Watchdog\" \"%WATCHDOG_PATH%\"" ^
    /SC ONLOGON ^
    /RL HIGHEST ^
    /F

if errorlevel 1 (
    echo.
    echo ERRO: Falha ao criar tarefa agendada!
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Tarefa "%TASK_NAME%" criada com sucesso!
echo ============================================
echo.
echo   O watchdog vai iniciar automaticamente
echo   toda vez que voce fizer login no Windows.
echo.
echo   Para verificar: Agendador de Tarefas ^> "%TASK_NAME%"
echo   Para remover:    schtasks /Delete /TN "%TASK_NAME%" /F
echo.

:: Pergunta se quer iniciar agora
set /p START="Deseja iniciar o watchdog agora? (S/N): "
if /i "%START%"=="S" (
    echo.
    echo Iniciando watchdog...
    start /min "Slimfit Watchdog" "%WATCHDOG_PATH%"
    echo Watchdog iniciado em background!
)

echo.
pause

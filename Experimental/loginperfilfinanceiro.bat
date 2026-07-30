@echo off
REM ============================================================
REM  Login no perfil DEDICADO do bot: WhatsApp FINANCEIRO
REM  Abre um Edge ISOLADO (pasta C:\SlimfitBot\edge-fin).
REM  Faca o login UMA vez aqui:
REM   1) web.whatsapp.com  -> escaneie o QR com o WhatsApp FINANCEIRO
REM  Depois pode fechar. O bot usa exatamente este perfil na renovacao.
REM ============================================================
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not exist "C:\SlimfitBot\edge-fin" mkdir "C:\SlimfitBot\edge-fin"

start "" "%EDGE%" --user-data-dir="C:\SlimfitBot\edge-fin" --profile-directory=Default --no-first-run https://web.whatsapp.com

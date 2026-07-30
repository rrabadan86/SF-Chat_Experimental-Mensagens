@echo off
REM ============================================================
REM  Login no perfil DEDICADO do bot: WhatsApp SlimFit + Instagram
REM  Abre um Edge ISOLADO (pasta C:\SlimfitBot\edge-wa).
REM  Faca o login UMA vez aqui:
REM   1) web.whatsapp.com  -> escaneie o QR com o WhatsApp do SlimFit
REM   2) instagram.com     -> entre com a conta slimfit.setorbueno
REM  Depois pode fechar. O bot usa exatamente este perfil.
REM ============================================================
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not exist "C:\SlimfitBot\edge-wa" mkdir "C:\SlimfitBot\edge-wa"

start "" "%EDGE%" --user-data-dir="C:\SlimfitBot\edge-wa" --profile-directory=Default --no-first-run https://web.whatsapp.com https://www.instagram.com

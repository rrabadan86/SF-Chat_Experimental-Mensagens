@echo off
echo ========================================
echo  Abrindo Chrome com depuracao remota...
echo ========================================
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
echo.
echo Chrome aberto! Agora pode rodar o scheduler.
echo.
pause

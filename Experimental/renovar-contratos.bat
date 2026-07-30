@echo off
REM Renovacao de contratos - SlimFit Setor Bueno
REM Roda toda segunda-feira as 10h
cd /d C:\AntiGravity\Experimental
node src\renovar-contratos.js --enviar >> logs\renovar-contratos.log 2>&1
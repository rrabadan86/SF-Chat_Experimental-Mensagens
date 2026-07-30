@echo off
cd /d C:\AntiGravity\Experimental\src\agendamento_evo
python run_agendamento.py run --hours-back 24 >> agendamento.log 2>&1
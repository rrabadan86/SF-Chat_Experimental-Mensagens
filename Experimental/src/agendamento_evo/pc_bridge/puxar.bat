@echo off
set FORM_CLOUD_URL=https://sf-formularioexperimental.onrender.com
set FORM_OUTBOX_TOKEN=030985
set STUDIO_OUTBOX_FILE=C:\AntiGravity\Experimental\src\agendamento_evo\confirmacoes_outbox.jsonl
python "C:\AntiGravity\Experimental\src\agendamento_evo\pc_bridge\puxar_confirmacoes.py"
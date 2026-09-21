@echo off
set FORM_CLOUD_URL=https://SEU-PAINEL.duckdns.org/agendamentoexperimental
set FORM_OUTBOX_TOKEN=030985
set STUDIO_OUTBOX_FILE=C:\AntiGravity\Experimental\src\agendamento_evo\confirmacoes_outbox.jsonl
python "C:\AntiGravity\Experimental\src\agendamento_evo\pc_bridge\puxar_confirmacoes.py"
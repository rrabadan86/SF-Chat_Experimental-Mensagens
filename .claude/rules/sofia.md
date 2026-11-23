---
paths:
  - "ChatBot/**"
  - "Experimental/src/sofia-*.js"
  - "Experimental/src/painel-sofia.js"
  - "Experimental/src/wa-versao-reserva.js"
  - "scripts/sofia.js"
---

# SoFIA (IA no WhatsApp próprio da loja)

`ChatBot/sofia-listener.ts` (WhatsApp, fila, campanhas) + `sofia.ts`/`sofia-engine.ts` (IA).
Dados em `SOFIA_DIR` (fora do repositório). O painel edita o prompt e as configurações
em `SOFIA_DIR`; os modelos versionados são os `*.default.*`.

- **SOF-01** Quando a recepção assume a conversa, a SoFIA pausa naquela conversa.
- **SOF-02** Campanha: teto por dia (padrão **40**), janela de horário e pausa entre envios; cada pessoa recebe **uma vez**; campanha cancelada não volta. (decisão do dono para o teto padrão, 23/11/2026)
- **SOF-03** Conexão: esperas crescentes entre tentativas (1, 2, 4, 8, 15 min, guardadas em `.sofia-boot-fails`); depois de 8 falhas seguidas o login salvo é descartado no próximo início. Reconectar: painel (🔧 Reconectar a SoFIA) ou `slimfit-sofia` — nunca mandar o dono apagar pasta de sessão.
- **SOF-04** Versão do WhatsApp Web: ao vivo; se a página abre mas a conexão fica sem estado, usa a versão **reserva** por 7 dias. Mesma regra do robô — fonte única em `Experimental/src/wa-versao-reserva.js` (a SoFIA repete a lógica em TypeScript; mudou um, mude o outro).
- **SOF-05** Agendamento pela SoFIA **pode** marcar experimental para quem já fez uma (não aplica AGE-01). (decisão do dono, 23/11/2026)
- **SOF-06** Cobrança: a SoFIA envia a fila que o robô grava (`cobranca-outbox.jsonl`), até 3 tentativas por item; regras de cobrança em `envio.md` (COB).
- **SOF-07** Chaves da IA e da transcrição só no `.env`/painel (Credenciais), nunca no código nem no chat.

Conferir antes de commit: `ChatBot/node_modules/.bin/esbuild ChatBot/sofia-listener.ts --format=esm --platform=node --log-level=error > /dev/null` (e `sofia.ts`, `sofia-engine.ts`).
Reiniciar a SoFIA só fora dos horários de envio.

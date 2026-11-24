---
paths:
  - "ChatBot/**"
  - "Experimental/src/sofia-*.js"
  - "Experimental/src/painel-sofia.js"
  - "Experimental/src/wa-versao-reserva.js"
  - "Experimental/src/wa-qr-tela.js"
  - "Experimental/src/ia-conta.js"
  - "Experimental/src/sofia-aquecimento.js"
  - "scripts/sofia.js"
---

# SoFIA (IA no WhatsApp próprio da loja)

`ChatBot/sofia-listener.ts` (WhatsApp, fila, campanhas) + `sofia.ts`/`sofia-engine.ts` (IA).
Dados em `SOFIA_DIR` (fora do repositório). O painel edita o prompt e as configurações
em `SOFIA_DIR`; os modelos versionados são os `*.default.*`.

- **SOF-01** Quando a recepção assume a conversa, a SoFIA pausa naquela conversa.
- **SOF-02** Campanha: teto por dia (padrão **40**), janela de horário e pausa entre envios; cada pessoa recebe **uma vez**; campanha cancelada não volta. (decisão do dono para o teto padrão, 23/11/2026)
- **SOF-03** Conexão: esperas crescentes entre tentativas (1, 2, 4, 8, 15 min, guardadas em `.sofia-boot-fails`); o login salvo **não** é apagado sozinho — só pelo painel ("QR novo") ou pelo `slimfit-sofia` (decisão do dono, 24/11/2026; o antigo "apaga depois de 8 falhas" só volta com `SOFIA_LIMPAR_LOGIN_APOS=8` no `.env`). Reconectar: painel (🔧 Reconectar a SoFIA) ou `slimfit-sofia` — nunca mandar o dono apagar pasta de sessão.
- **SOF-04** Versão do WhatsApp Web: ao vivo; se a página abre mas a conexão fica sem estado, usa a versão **reserva** por 7 dias. Mesma regra do robô — fonte única em `Experimental/src/wa-versao-reserva.js` (a SoFIA repete a lógica em TypeScript; mudou um, mude o outro).
- **SOF-08** QR pela tela: sem login, o WhatsApp Web (desde 2.3000.1055969240, 24/11/2026) abre a tela nova de entrada e a biblioteca não avisa o QR. SoFIA e robô copiam o QR **da página** para o painel (renova sozinho), deixam marcado "continuar conectado" e, quando alguém escaneia: se a biblioteca já conectou sozinha, **seguem no mesmo processo** (reiniciar logo após vincular deixava duas conexões e o WhatsApp desfazia o vínculo — Lago Norte, 24/11/2026); se autenticou e ainda sincroniza, esperam até **5 min** antes de desistir (`esperarConexaoAposLogin`); só então fecham o navegador de verdade e sobem de novo com o login salvo. "Conectar por código" também pela página (módulo interno do WhatsApp Web ou tela "Conectar com número de telefone"), um pedido a cada **3 min**; com o código na tela a leitura não clica em nada. Fonte única: `Experimental/src/wa-qr-tela.js` (a SoFIA importa).
- **SOF-09** IA parada (sem crédito na Anthropic ou chave recusada): não repete a chamada; avisa a equipe no celular (ntfy) **uma vez** por episódio — o episódio acaba quando a IA volta a responder. A lead recebe a mensagem de "instabilidade". Fonte única: `Experimental/src/ia-conta.js`.
- **SOF-10** A IA da conversa só recebe as ferramentas da SoFIA (`tools: []` nas opções de `sofia.ts`): as do Claude Code (terminal, arquivos, web) ficam de fora — custam tokens em toda chamada e não são para ela.
- **SOF-11** Modelos da IA: conversa e extração escolhidos no painel (`sofia-modelo.json`; lista igual em `sofia.ts` e `sofia-editor.js`). **Haiku 5.5** só para extração (resumos, tags, ficha, frases), nunca na conversa, e sempre sem pensamento (`semPensar`), senão as respostas curtas saem vazias. Trocar o modelo da conversa é decisão do dono (24/11/2026: fica no Sonnet 5).
- **SOF-12** Envios que a SoFIA **inicia** (cobrança, campanha, follow-up): esperam **30 min** depois de cada conexão (`SOFIA_QUIETO_MIN`) e não saem com o **número em aquecimento** (SoFIA → Configuração, 3/7/14 dias, até 30) — aí cobrança e follow-up são descartados (cobrança fica no Log; o robô repõe), o aviso de "app reativado" (`tipo: app`, gravado uma vez só) fica **guardado** na fila e o grupo da equipe é avisado para falar com a aluna, e a campanha espera. Responder quem escreve, avisos à equipe e mensagens da recepção seguem. Fonte única: `Experimental/src/sofia-aquecimento.js`. (decisão do dono, 24/11/2026)
- **SOF-05** Agendamento pela SoFIA **pode** marcar experimental para quem já fez uma (não aplica AGE-01). (decisão do dono, 23/11/2026)
- **SOF-06** Cobrança: a SoFIA envia a fila que o robô grava (`cobranca-outbox.jsonl`), até 3 tentativas por item; regras de cobrança em `envio.md` (COB).
- **SOF-07** Chaves da IA e da transcrição só no `.env`/painel (Credenciais), nunca no código nem no chat.

Conferir antes de commit: `ChatBot/node_modules/.bin/esbuild ChatBot/sofia-listener.ts --format=esm --platform=node --log-level=error > /dev/null` (e `sofia.ts`, `sofia-engine.ts`).
Reiniciar a SoFIA só fora dos horários de envio.

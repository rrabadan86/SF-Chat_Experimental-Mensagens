---
paths:
  - "Experimental/data/**"
  - "**/.env*"
  - "**/.gitignore"
  - "Experimental/src/env-arquivo.js"
  - "Experimental/src/backup-dados.js"
  - ".claude/hooks/**"
  - ".claude/settings.json"
---

# Dados e segredos

- **DAD-01** Segredo nunca é escrito, repetido, pedido no chat nem commitado: chaves de IA e de transcrição, token e senha do EVO, `PAINEL_SENHA`, segredo da sessão, tokens do formulário, chave do Fitily. Credencial nova o dono salva no painel (SoFIA → Configuração → Credenciais) ou no `.env` do servidor.
- **DAD-02** Nunca vão para o Git: os `.env`; **tudo** de `Experimental/data/` (só `data/.gitkeep`); `SOFIA_DIR`; sessões do WhatsApp (`.wwebjs_auth`, `wwebjs_auth`) e perfis do Chrome; `backups/`; `*.log` do agendamento; `sofia-demo/` e `demo-conversas-reais*.json`.
- **DAD-03** Dado pessoal (contatos, conversas, Slim Club, formulários) e marcadores de "já enviei" ficam só no servidor. Marcador no Git seria sobrescrito numa atualização e o robô reenviaria.
- **DAD-04** Teste e experimento usam cópia temporária (`ambienteIsolado()`), nunca a `data/` do repositório nem a de um servidor.
- **DAD-05** O painel grava o `.env` só por `env-arquivo.js` (aspas quando precisa, uma linha, troca atômica e releitura para conferir).
- **DAD-06** Arquivo de estado novo grava de forma atômica (`.tmp` + `rename`).
- **DAD-07** A trava `.claude/hooks/bloquear-segredos.js` barra commit/push com segredo ou arquivo proibido (arquivo apagado não conta). Não conta como segredo: valor de exemplo ("exemplo…", só zeros) e, em arquivo de código, valor sem aspas que parece código (`/regra/`, `f.campo`, `funcao(…)`) (decisão do dono, 25/11/2026). Falso alarme: mostrar ao dono e pedir confirmação — nunca contornar.

---
paths:
  - "scripts/**"
  - ".github/**"
  - ".claude/skills/**"
  - "Experimental/setup-novo-studio.sh"
  - "Experimental/src/atualizacao-painel.js"
  - "Experimental/src/pm2-nomes.js"
  - "Experimental/src/agendamento_evo/formulario_web/templates/implantacao.html"
---

# Publicar e atualizar os servidores

- **DEP-01** O Claude faz commit e push só na branch de trabalho; PR para `main`; **merge só com o CI ✓** (squash); depois `git fetch origin main && git merge origin/main` e push. CI vermelho: corrigir a causa, nunca mesclar por cima. Passo a passo: skill `subir-versao`.
- **DEP-02** Os servidores baixam só a marca `estavel`, que o CI move quando a `main` passa em tudo (`scripts/ramo-estavel.js`). Só depois disso dizer ao dono para atualizar.
- **DEP-03** `slimfit-atualizar` atualiza todas as pastas do servidor e **reinicia painel, robô, SoFIA e formulário** — rodar fora dos horários de envio. `--painel` reinicia só os painéis.
- **DEP-04** Nomes do PM2 vêm de `pm2-nomes.js` (Bueno `slimfit-*`, Lago Norte `lagonorte-*`, Lago Sul 1 e 2 `lagosul1-*` / `lagosul2-*` no mesmo servidor).
- **DEP-05** Mudança que o dono vai notar → item em **Novidades** de `implantacao.html` dizendo o que reiniciar (e em Manutenção, se for comando).
- **DEP-06** Comandos para o dono: simples, um por linha, sem `rm` com variável. Backup em branch (`backup/...`) e reescrever histórico só com pedido explícito.

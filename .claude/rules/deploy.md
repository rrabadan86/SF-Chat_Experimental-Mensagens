---
paths:
  - "scripts/**"
  - ".github/**"
  - ".claude/skills/**"
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - "Experimental/setup-novo-studio.sh"
  - "Experimental/src/atualizacao-painel.js"
  - "Experimental/src/pm2-nomes.js"
  - "Experimental/src/nova-loja-*.js"
  - "Experimental/src/agendamento_evo/formulario_web/templates/implantacao.html"
---

# Publicar e atualizar os servidores

- **DEP-01** O Claude faz commit e push só na branch de trabalho; PR para `main`; **merge só com o CI ✓** (squash); depois `git fetch origin main && git merge origin/main` e push. CI vermelho: corrigir a causa, nunca mesclar por cima. Passo a passo: skill `subir-versao`.
- **DEP-02** Os servidores baixam só a marca `estavel`, que o CI move quando a `main` passa em tudo (`scripts/ramo-estavel.js`). Só depois disso dizer ao dono para atualizar.
- **DEP-03** `slimfit-atualizar` atualiza todas as pastas do servidor e **reinicia painel, robô, SoFIA e formulário** — rodar fora dos horários de envio. `--painel` reinicia só os painéis.
- **DEP-04** Nomes do PM2 vêm de `pm2-nomes.js` (Bueno `slimfit-*`, Lago Norte `lagonorte-*`, Lago Sul 1 e 2 `lagosul1-*` / `lagosul2-*` no mesmo servidor).
- **DEP-05** Mudança que o dono vai notar → item em **Novidades** de `implantacao.html` dizendo o que reiniciar (e em Manutenção, se for comando).
- **DEP-06** Comandos para o dono: simples, um por linha, sem `rm` com variável. Backup em branch (`backup/...`) e reescrever histórico só com pedido explícito.
- **DEP-07** Skills (`.claude/skills/`): `subir-versao` (publicar), `conferir-pr` (lista ✓/✗ antes do merge), `conferir-celular` (telas mexidas a 390/1366 px com prints), `nova-tela` (passo a passo de tela nova). Hooks (`.claude/settings.json`): `bloquear-segredos.js` antes de commit/push (DAD-07); `depois-do-git.js` depois do commit lembra as regras da área dos arquivos e as regras sem teste, e depois do push lembra a `conferir-pr`; `limpar-restos-teste.js` ao fim de cada resposta (TST-10). Hook só avisa ou bloqueia — nunca muda arquivo do repositório.
- **DEP-08** GitHub (`.github/workflows/`): `ci.yml` em todo PR e na main (unidade, EVO, telas; a página do CI mostra as regras mexidas e o resumo da matriz); `noturno.yml` toda madrugada (03:37) roda a mesma bateria na main mais os testes em outros fusos e abre o aviso "Rodada noturna com falha" (fecha sozinho quando volta a passar); `prints.yml` é manual: prints de todas as telas com o relógio parado, anexados por 30 dias. Prints de **referência** (guardados para comparar) só depois da revisão de design (`docs/revisao-de-design.md`). (decisão do dono, 23/11/2026)

## Nova loja pelo painel (Perfis → 🏪 Nova loja, só admin; o dono usa a do Bueno)
- **NOV-01** O painel instala a loja por SSH com o mesmo `setup-novo-studio.sh --tudo` (fonte única: `nova-loja-remoto.js`). A **senha do servidor** só serve para entrar a 1ª vez — não é gravada; logo depois o painel instala a **chave** dele e usa só ela. A **impressão digital** do servidor é anotada e, se mudar, o painel não entra. Os segredos da loja vão num arquivo 600 (`--segredos`) que o script apaga depois de ler — nunca na linha de comando nem no log. Tudo o que o admin digita é conferido (`validar`) e vai entre aspas simples. A instalação roda **solta no servidor novo** (`setsid nohup`): se o painel reiniciar, ela continua; o painel acompanha entrando com a chave (no máximo a cada 5 s). Uma instalação por apelido de cada vez; apelido já usado em outro servidor é recusado. Estado e log em `data/nova-loja/`, sem segredos; na demonstração a tela só mostra. (decisão do dono, 25/11/2026)
- **NOV-02** Endereço da loja nova no DuckDNS: o dono tem **duas contas** (cada uma aceita 5 endereços); os tokens ficam no `.env` do painel (`DUCKDNS_TOKEN_1/2`, apelidos em `DUCKDNS_NOME_1/2`) e nunca voltam para a tela. O endereço é criado pelo dono no duckdns.org; o painel aponta para o **IP** do servidor e espera responder **antes** de entrar no servidor — se o DuckDNS recusar, não instala. Fonte única: `nova-loja-duckdns.js`. (decisão do dono, 25/11/2026)
- **NOV-03** Depois de instalar, o painel **confere a loja sozinho uma vez** (e de novo no botão): painel no ar com https, `--check` do script, processos no pm2, chave da IA (só consulta, sem gastar), os **3 segmentos do EVO** pelos nomes que os jobs procuram (`conferir-segmentos.js`: só lê, respeita EVO-01) e liga o **🌱 aquecimento de 7 dias** na primeira vez. Os filtros dos segmentos não são lidos — a tela diz quais usar. A senha do painel novo é escolhida no formulário (vai pelo `--segredos`, nunca é mostrada). (decisão do dono, 25/11/2026)

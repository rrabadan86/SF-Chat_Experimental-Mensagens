---
name: conferir-pr
description: Confere um PR do SlimFit antes do merge — CI, matriz de rastreabilidade, regras da área mexida, Novidades e nada de dado ou segredo no PR — e devolve uma lista ✓/✗ em português. Use depois do push e antes de mesclar (a skill subir-versao chama esta).
---

# Conferir PR (SlimFit)

Só confere e relata — **não mescla**. Quem mescla é a `subir-versao`, depois desta lista ficar toda ✓.

1. **Arquivos do PR**: `git fetch origin main && git diff --name-only origin/main...HEAD`.
   - ✗ se aparecer `.env`, `Experimental/data/` (menos `.gitkeep`), `.wwebjs_auth`, `sofia-demo/`, `demo-conversas-reais*`, `*.log` ou print solto (`*.png` fora de `app-icones`/`demo-assets`). Regra DAD-02.
   - A trava `.claude/hooks/bloquear-segredos.js` já barrou o commit/push se achou segredo; se ela avisou falso alarme, confirme que o dono aprovou (DAD-07).

2. **Testes das regras mexidas**: `cd Experimental && npm run testar-alteracao`.
   - Leia os avisos: regra mexida **sem teste** (❌) ou **parcial** → diga ao dono qual regra e por quê não tem teste, ou escreva o teste.
   - Mexeu em tela → `node testes/tela/telas.js --estrito` e a skill `conferir-celular`.
   - Mexeu no `agendamento_evo` → `cd src/agendamento_evo && python3 -m tests.test_offline`.

3. **Matriz**: `node scripts/matriz.js --conferir` (na raiz) sem erro.
   - Regra nova ou alterada → tem linha em `docs/rastreabilidade.md` e teste com o código no nome (TST-02).
   - Achou erro de regra de negócio no caminho → **não corrija sozinho**: registre em "Achados" da matriz e mostre ao dono.

4. **Regras da área**: para cada arquivo de `.claude/rules/` cujos `paths:` batem com os arquivos do PR, releia as regras e confira que o PR as segue (o hook `depois-do-git.js` lista quais são depois de cada commit). Atenção especial: ENV-01/ENV-02 (envio), PAI-01/PAI-02 (rota nova com regra de acesso), DEM-01 (demonstração).

5. **Novidades**: mudança que o dono vai notar → item em *Novidades* de `implantacao.html`, dizendo o que reiniciar (DEP-05). Mudança só interna (testes, docs, skills) não precisa.

6. **CI**: pelas ferramentas do GitHub (`pull_request_read`, método `get_check_runs`): "Código e regras (Node)", "Agendamento EVO (Python)" e "Telas" todos ✓; `mergeable_state` limpo. ✗ → leia o log do job, corrija a causa e volte ao passo 2.

7. **Relatório ao dono** (português simples), uma linha por item:
   ```
   ✓/✗ Arquivos (nada de dado ou segredo)
   ✓/✗ Testes das regras mexidas (N regras; sem teste: …)
   ✓/✗ Matriz em dia
   ✓/✗ Regras da área (…)
   ✓/✗ Novidades
   ✓/✗ CI
   ```
   Tudo ✓ → siga com o merge da `subir-versao`. Algum ✗ → corrija ou pergunte; nunca mescle com ✗.

---
name: subir-versao
description: Sobe uma mudança do SlimFit para a main com segurança — confere sintaxe e testes, faz commit na branch de trabalho, abre o PR, espera o CI ficar ✓ e só então faz o squash merge e sincroniza a branch. Use sempre que for publicar/mesclar uma alteração.
---

# Subir versão (SlimFit)

Siga na ordem. Pare e avise o usuário se algum passo falhar — nunca mescle com CI vermelho.

1. **Conferir localmente**
   - `node --check` em cada `.js` alterado. Se mexeu na SoFIA: `ChatBot/node_modules/.bin/esbuild ChatBot/sofia-listener.ts --format=esm --platform=node --log-level=error > /dev/null`.
   - `cd Experimental && node --test testes/unidade/*.test.js`
   - Se mexeu em tela do painel: `cd Experimental && node testes/tela/telas.js` (sobe a demonstração numa pasta temporária; leia os avisos).
   - Se mexeu no `agendamento_evo`: `cd Experimental/src/agendamento_evo && python3 -m tests.test_offline`.
   - `git status`: nada de `Experimental/data/`, `.env`, sessões do WhatsApp ou prints soltos no commit.

2. **Regras de envio**: regra nova/alterada que manda mensagem para cliente → linha em `docs/REGRAS-DE-ENVIO.md` com o teste que a garante.
3. **Novidades**: se o usuário vai notar a mudança, acrescente um item em *Novidades* de `Experimental/src/agendamento_evo/formulario_web/templates/implantacao.html` (e em *Manutenção* se for comando novo).

4. **Commit e push** na branch de trabalho da sessão (mensagem em português, com as linhas de atribuição pedidas pela sessão). `git push -u origin <branch>`.

5. **PR** para `main` (título e descrição em português; diga o que muda e como foi testado).

6. **Esperar o CI** (`.github/workflows/ci.yml`: "Código e regras (Node)", "Agendamento EVO (Python)", "Telas"). Consulte o estado do PR pelas ferramentas do GitHub até todos os checks terminarem.
   - ✓ em tudo → siga.
   - ✗ → leia o log do job que falhou, corrija na mesma branch, faça push e espere de novo. Não mescle.

7. **Merge**: squash. Depois sincronize a branch: `git fetch origin main && git merge --no-edit origin/main && git push origin <branch>`.
   - O CI da main roda de novo e, com tudo ✓, move a marca `estavel` (job "Marcar versão estável"). Os servidores só baixam a `estavel`: espere esse job terminar antes de dizer ao usuário para rodar `slimfit-atualizar`.

8. **Avisar o usuário** em português simples: o que mudou, o que ele precisa rodar no servidor (normalmente `slimfit-atualizar`, fora dos horários de envio se reiniciar robô/SoFIA) e o resultado dos testes.

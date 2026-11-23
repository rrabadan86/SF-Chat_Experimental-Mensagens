---
paths:
  - "Experimental/src/painel-*.js"
  - "Experimental/src/usuarios.js"
  - "Experimental/src/acessos.js"
  - "Experimental/src/auditoria.js"
  - "Experimental/src/push*.js"
  - "Experimental/src/unidades-rede.js"
  - "Experimental/src/config-unidade.js"
  - "Experimental/src/atualizacao-painel.js"
  - "Experimental/src/slimclub*.js"
  - "Experimental/src/formularios*.js"
---

# Painel (rotas, perfis, telas)

Node `http` puro, sem framework. Todas as rotas passam por `painel-mensagens.js`;
cada aba monta o HTML no servidor (`painel-<aba>.js`), com o kit de `painel-base.js`.

## Perfis e permissões (conferidos NO SERVIDOR)
- **PAI-01** Toda rota exige login, menos as públicas: `/login`, `/logout`, `/unidades`, `/termos`, `/privacidade`, `/midia-publica`, `/auth/google*`, `/slimclub*`, `/SlimClubCadastro*`, `/formulario/*`, manifesto, `sw.js` e ícones. Rota pública fica **antes** de `const sess = usuarioDaReq(req)`.
- **PAI-02** Rota nova = regra em `telaDaUrl` e, nas abas SoFIA/WhatsApp, em `sofiaRotaPermitida` / `msgRotaPermitida`. Esconder o botão não basta. `testes/unidade/permissoes.test.js` lê as rotas do código e falha se alguma abrir sem permissão.
- **PAI-03** Admin vê tudo. Só admin: Perfis, `/sistema/*` (atualizar), `/config-unidade/*` (copiar configuração) e salvar credenciais/`.env`.
- **PAI-04** As permissões por tela são as de `usuarios.js` (`TELAS`); chave desconhecida é descartada ao salvar.
- **PAI-05** Login: 10 erros em 15 min (por IP e por usuário) bloqueiam; sessão em cookie `HttpOnly` + `SameSite=Lax`, assinada; o admin pode encerrar sessões.
- **PAI-06** Ação que grava registra quem fez em `auditoria.registrar(usuario, acao, alvo, detalhe)`.

## Como as telas são feitas
- **PAI-07** Todo dado que vai para o HTML passa por `esc()`. Nada de montar HTML com texto do usuário sem escapar.
- **PAI-08** Use as peças de `painel-base.js` (`chrome`, `uiTopo`, `uiChips`, `uiDatas`, `infoI`, subnavs) antes de criar outra. Padrão visual e peças: `visual.md`.
- **PAI-09** Ação por `fetch` responde JSON `{ ok, erro }`; formulário clássico responde 303 de volta à tela com `?ok=` / `?erro=`.
- **PAI-10** Demonstração: nenhum POST executa (`demoBloqueado`) — regras em `demo.md`.
- **PAI-11** Tela nova entra em `TELAS` de `testes/tela/telas.js` (ver `testes.md`).

Indicadores e suas contas: `indicadores.md`. Dados e segredos: `dados-e-segredos.md`.

# Matriz de rastreabilidade — cada regra, onde está e o que a garante

Toda regra do sistema tem um código (`ÁREA-NN`) definido **uma vez** num arquivo de
`.claude/rules/`. Aqui cada código aparece numa linha com: onde a regra está no código,
o teste que a garante e a cobertura.

- **✅** o teste confere a regra inteira · **parcial** confere uma parte (o que falta vem
  escrito) · **❌** não há teste · **processo** é regra de trabalho (como publicar, como
  testar), garantida pela revisão e pelo CI, não por um teste de código.
- Coluna "Teste": `` `arquivo` › começo do título do teste `` (vários separados por `<br>`).
  `telas.js` é o teste de telas inteiro; `test_offline.py` › nome da função Python.
- O teste `testes/unidade/matriz.test.js` confere esta matriz em todo PR: todo código das
  regras tem linha; todo teste citado existe; todo teste com código no nome está na linha
  do seu código; os arquivos de "Onde" existem; o resumo está em dia.
- Depois de mexer aqui: `cd Experimental && npm run matriz` reconta o resumo.
- Antes de um PR: `cd Experimental && npm run testar-alteracao` roda primeiro os testes
  das regras dos arquivos mexidos e avisa as regras deles que não têm teste.

## Resumo

<!-- resumo:inicio -->
| Área | Regras | ✅ | parcial | ❌ | processo |
|---|---|---|---|---|---|
| Envios a clientes | 30 | 14 | 7 | 9 | 0 |
| Painel | 12 | 5 | 2 | 3 | 2 |
| Padrão visual | 7 | 2 | 3 | 1 | 1 |
| SoFIA | 13 | 0 | 10 | 3 | 0 |
| EVO e aula experimental | 11 | 3 | 1 | 7 | 0 |
| Indicadores e tags | 10 | 9 | 0 | 1 | 0 |
| Dados e segredos | 7 | 4 | 1 | 0 | 2 |
| Demonstração | 4 | 3 | 0 | 0 | 1 |
| Publicar e atualizar | 11 | 2 | 4 | 2 | 3 |
| Testes | 10 | 5 | 0 | 0 | 5 |
| **Total** | 115 | 47 | 28 | 26 | 14 |

Regras de código (sem as de processo): **75 de 101** com teste (47 inteiras, 28 em parte); **26** sem teste.

Testes: 183 no total, 144 ligados a uma regra. Os outros 39 conferem funções que ainda não têm regra com código: `cpu-carga.test.js` (3), `metas.test.js` (3), `push-eventos.test.js` (5), `push.test.js` (5), `retencao-atendimento.test.js` (4), `senha-evo.test.js` (1), `unidades-rede.test.js` (1), `visao-cliente.test.js` (2), `whatsapp-inicio.test.js` (2), `test_offline.py` (13).
<!-- resumo:fim -->

## Envios a clientes (`envio.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| ENV-01 | Anota o envio na hora; nunca manda em dobro | `retomada-sofia.js`, `followup-encerramento.js`, `whatsapp-sender.js`, `boas-vindas.js` | `retomada.test.js` › RET-01 ENV-01 envia uma vez só<br>`encerramento.test.js` › FUP-03 ENV-01 manda o encerramento<br>`confirmacao-envio.test.js` › CONF-01 confirmação<br>`boas-vindas.test.js` › ALU-03 boas-vindas | parcial: follow-up, no-show, FREE, contratos a vencer e campanhas da SoFIA sem teste |
| ENV-02 | Sem conseguir ler ou confirmar, não envia | `retomada-sofia.js`, `followup-encerramento.js`, `resumo-semanal.js`, `evo-tabela-aniversario.js`, `renovacoes-mes-grupo.js` | `retomada.test.js` › RET-01 ENV-02 sem conseguir ler<br>`encerramento.test.js` › FUP-03 ENV-02 sem conseguir ler<br>`resumo-semana-refazer.test.js` › GRP-01 ENV-02 resumo da semana: se o WhatsApp falhar<br>`aniversario-tabela.test.js` › EVO-02 trava: datas de outros meses | parcial: contratos a vencer (sem o filtro do EVO não envia lista vazia) sem teste |
| ENV-03 | Um job por vez | `scheduler.js`, `jobs-batimento.js` | `fila-jobs.test.js` › ENV-03 ENV-04 job que desistiu de esperar | parcial: confere a espera da vez, não dois jobs disputando o robô |
| ENV-04 | Job perdido roda depois só das 7h às 21h e com até 3 h de atraso | `jobs-batimento.js`, `scheduler.js` | `fila-jobs.test.js` › ENV-04 ENV-05 job que esperava a vez<br>`fila-jobs.test.js` › ENV-03 ENV-04 job que desistiu<br>`fila-jobs.test.js` › ENV-04 de noite não manda nada<br>`fila-jobs.test.js` › ENV-04 job sem etiqueta | ✅ |
| ENV-05 | Job interrompido no meio não repete sozinho | `jobs-batimento.js` | `fila-jobs.test.js` › ENV-04 ENV-05 job que esperava a vez | ✅ |
| ENV-06 | Texto de `mensagens.js`; `{nome}` some quando não há nome | `mensagens.js` | `contatos-mensagens.test.js` › ENV-06 mensagens: preenche<br>`contatos-mensagens.test.js` › ENV-06 mensagens: todo texto padrão | ✅ |
| ENV-07 | Contato achado pelo telefone com ou sem o 9 | `contatos.js` | `contatos-mensagens.test.js` › ENV-07 telefone: normaliza<br>`contatos-mensagens.test.js` › ENV-07 contato é achado | ✅ |
| ENV-08 | Trancada não recebe avisos de ausência nem de vencimento | `suspensoes.js`, `sentimos-falta.js`, `ausentes-10-dias.js` | — | ❌ |
| ENV-09 | WhatsApp do robô sem responder: 2 verificações seguidas avisam a equipe e religam | `wa-client.js` | `whatsapp-keepalive.test.js` › ENV-09 WhatsApp oco<br>`whatsapp-keepalive.test.js` › ENV-09 conectado sem as peças<br>`whatsapp-keepalive.test.js` › ENV-09 uma falha solta | ✅ |
| CONF-01 | Confirmação da aula: hoje 08:30 e amanhã 15:30; anota quem recebeu | `scheduler.js`, `whatsapp-sender.js`, `horarios.js` | `confirmacao-envio.test.js` › CONF-01 confirmação | parcial: os horários padrão não têm teste |
| CONF-02 | 2ª mensagem 1h30+ depois, aula ainda longe, sem resposta | `confirmacao-sem-resposta.js` | `confirmacao-sem-resposta.test.js` › CONF-02 2ª mensagem<br>`datas.test.js` › CONF-02 confirmação: a hora da aula | ✅ |
| CONF-03 | Quem segue sem responder entra uma vez na lista da equipe | `confirmacao-sem-resposta.js` | `confirmacao-sem-resposta.test.js` › CONF-03 lista da equipe | ✅ |
| FUP-01 | Follow-up pós-aula 10:30 e 16:00 | `followup-experimental.js` | — | ❌ |
| FUP-02 | Faltou (no-show) 11:30 e 19:30 | `follow-up-no-show.js` | — | ❌ |
| FUP-03 | Encerramento no dia seguinte só para quem não respondeu, não virou aluna e não agendou | `followup-encerramento.js`, `agendou-registro.js` | `encerramento.test.js` › FUP-03 ENV-01 manda o encerramento<br>`encerramento.test.js` › FUP-03 quem virou aluna<br>`encerramento.test.js` › FUP-03 quem agendou de novo<br>`encerramento.test.js` › FUP-03 ENV-02 sem conseguir ler | ✅ |
| RET-01 | Retomada: 24h+ sem resposta, dentro de N dias, sem impedimento | `retomada-sofia.js` | `retomada.test.js` › RET-01 escolhe só quem está na janela<br>`retomada.test.js` › RET-01 ENV-01 envia uma vez só<br>`retomada.test.js` › RET-01 se a recepção já falou<br>`retomada.test.js` › RET-01 ENV-02 sem conseguir ler | ✅ |
| ALU-01 | Renovação: avisa quem vence em exatos 7 dias | `renovar-contratos.js`, `renovacao-config.js` | — | ❌ |
| ALU-02 | "Vence hoje": só SlimFit, uma vez por contrato; 60+ = leitura suspeita | `vence-hoje.js` | `datas.test.js` › ALU-02 "vence hoje" | parcial: conferidos os dias cobertos e o texto; "só SlimFit", "uma vez por contrato" e a trava dos 60 sem teste |
| ALU-03 | Boas-vindas: nova, retorno e renovação | `boas-vindas.js` | `boas-vindas.test.js` › ALU-03 boas-vindas | ✅ |
| ALU-04 | Indicação aos 30 dias, se ainda ativa | `boas-vindas.js` | `boas-vindas.test.js` › ALU-04 indicação | ✅ |
| ALU-05 | "Sentimos sua falta": 14 dias, 2ª 10 dias depois | `sentimos-falta.js` | `datas.test.js` › ALU-05 "Sentimos sua falta" | parcial: "depois nada até ela voltar" sem teste |
| ALU-06 | Lista de ausentes da equipe com 10 dias | `ausentes-10-dias.js` | — | ❌ |
| ALU-07 | Contrato sem assinatura: seg/qua/sex, 1×/dia; "Não enviar" vale sempre | `assinaturas.js` | — | ❌ |
| ALU-08 | Quem não renovou sai dos grupos | `saidas-grupos.js` | — | ❌ |
| ALU-09 | Aniversário: coluna certa; não manda se o celular é de outra aluna | `aniversariantes.js`, `evo-tabela-aniversario.js` | `cobranca-aniversario.test.js` › ALU-09 aniversário<br>`aniversario-tabela.test.js` › EVO-02 ALU-09 lê a data | ✅ |
| COB-01 | Cobrança no máximo 1×/dia; só marca com envio confirmado | `inadimplentes.js` | `cobranca-aniversario.test.js` › COB-01 cobrança | ✅ |
| COB-02 | Boleto vencido há 2+ dias e aviso no dia do vencimento | `inadimplentes.js`, `inadimplentes-config.js` | `cobranca-aniversario.test.js` › COB-02 cobrança | parcial: o prazo de 2+ dias ajustável no painel sem teste |
| COB-03 | Bloqueio do app com pendência há 11+ dias | `bloqueio-app.js` | — | ❌ |
| GRP-01 | Resumo da semana "Rodar de novo" vale como o envio do dia | `resumo-semanal.js` | `resumo-semana-refazer.test.js` › GRP-01 resumo da semana: rodar de novo<br>`resumo-semana-refazer.test.js` › GRP-01 ENV-02 resumo da semana: se o WhatsApp falhar<br>`resumo-semana-refazer.test.js` › GRP-01 o Log oferece | ✅ |
| GRP-02 | Circuito: convocatória quarta e lembrete sexta, só com Circuito no sábado | `enviar-circuito.js` | — | ❌ |

## Painel (`painel.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| PAI-01 | Toda rota exige login, menos as públicas | `painel-mensagens.js` | `permissoes.test.js` › PAI-01 PAI-02 usuário sem nenhuma permissão<br>`perfis.test.js` › PAI-01..04 cada perfil<br>`unidades-rede.test.js` › PAI-01 PAI-03 no painel: /unidades | ✅ |
| PAI-02 | Rota nova tem regra de acesso no servidor | `painel-mensagens.js`, `painel-sofia.js`, `painel-whatsapp.js` | `permissoes.test.js` › PAI-01 PAI-02 usuário sem nenhuma permissão<br>`perfis.test.js` › PAI-01..04 cada perfil<br>`sofia-reconectar.test.js` › SOF-03 PAI-02 no painel<br>`rotas-telas.test.js` › PAI-02 todo fetch | ✅ |
| PAI-03 | Admin vê tudo; Perfis, sistema e credenciais só admin | `painel-mensagens.js` | `perfis.test.js` › PAI-01..04 cada perfil<br>`senha-evo.test.js` › DAD-05 PAI-03 no painel<br>`unidades-rede.test.js` › PAI-01 PAI-03 no painel: /unidades | ✅ |
| PAI-04 | Permissões por tela de `usuarios.js`; chave desconhecida descartada | `usuarios.js` | `perfis.test.js` › PAI-01..04 cada perfil | ✅ |
| PAI-05 | Login: 10 erros em 15 min bloqueiam; cookie HttpOnly, assinado | `painel-mensagens.js`, `usuarios.js` | — | ❌ |
| PAI-06 | Ação que grava registra quem fez (auditoria) | `auditoria.js` | — | ❌ |
| PAI-07 | Todo dado no HTML passa por `esc()` | `painel-base.js`, `painel-componentes.js` | `componentes.test.js` › VIS-03 tabela padrão: texto vindo de fora<br>`unidades-rede.test.js` › tela de acesso | parcial: só a tabela padrão e a tela de acesso |
| PAI-08 | Usar as peças de `painel-base.js` antes de criar outra | `painel-base.js` | — | processo |
| PAI-09 | `fetch` responde `{ ok, erro }`; formulário responde 303 | `painel-mensagens.js`, `painel-componentes.js` | `componentes.test.js` › VIS-06 erro ao salvar | parcial: só a janela de erro; as respostas das rotas não |
| PAI-10 | Demonstração: nenhum POST executa | `painel-mensagens.js`, `demo-guard.js` | — | ❌ |
| PAI-11 | Tela nova entra em `TELAS` de `telas.js` | `testes/tela/telas.js` | — | processo |
| PAI-12 | Usuário criado/redefinido cria a própria senha no primeiro acesso | `usuarios.js`, `painel-mensagens.js`, `painel-publicas.js` | `trocar-senha.test.js` › PAI-12 primeiro acesso | ✅ |

## Padrão visual (`visual.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| VIS-01 | Simples: uma tela, um assunto | `painel-base.js` | — | processo |
| VIS-02 | Nada rola para o lado; no celular a tabela vira cartão | `painel-componentes.js`, `painel-base.js` | `componentes.test.js` › VIS-02 a tabela não usa rolagem lateral<br>`componentes.test.js` › VIS-02 o script que vai para o navegador<br>`componentes.test.js` › VIS-02/03/06 tabela padrão e janela de erro<br>`telas.js` | ✅ |
| VIS-03 | Lista longa é tabela (`uiTabela`) | `painel-componentes.js` | `componentes.test.js` › VIS-03 tabela padrão: busca<br>`componentes.test.js` › VIS-03 tabela padrão: texto vindo de fora<br>`componentes.test.js` › VIS-03 tabela vazia<br>`componentes.test.js` › VIS-02/03/06 tabela padrão e janela de erro<br>`telas.js` | parcial: a peça está testada; Funil, Professoras, Log, Auditoria e Campanhas ainda não a usam (`visual.md`) |
| VIS-04 | ⓘ em toda coluna e todo quadro de número | `painel-base.js`, `painel-componentes.js` | `componentes.test.js` › VIS-03 tabela padrão: busca | parcial: nenhum teste confere o ⓘ em todas as telas |
| VIS-05 | Cor só por classe ou token, nada de `#hex` em `style=` | `painel-base.js` | — | ❌ |
| VIS-06 | Erro ao salvar abre janela e marca o campo | `painel-componentes.js` | `componentes.test.js` › VIS-06 erro ao salvar<br>`componentes.test.js` › VIS-02/03/06 tabela padrão e janela de erro | parcial: a peça está testada; SoFIA, Formulários e Slim Club ainda usam `alert()` (`visual.md`) |
| VIS-07 | Toda tela conferida a 390 px e no computador | `testes/tela/telas.js` | `telas.js` | ✅ |

## SoFIA (`sofia.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| SOF-01 | Recepção assume → SoFIA pausa naquela conversa | `ChatBot/sofia-engine.ts`, `ChatBot/sofia-listener.ts` | — | ❌ |
| SOF-02 | Campanha: teto por dia, janela, pausa; uma vez por pessoa; cancelada não volta | `ChatBot/sofia-listener.ts`, `painel-mensagens.js` | — | ❌ |
| SOF-03 | Conexão: esperas crescentes; reconectar pelo painel ou `slimfit-sofia` | `ChatBot/sofia-listener.ts`, `painel-sofia.js`, `scripts/sofia.js` | `sofia-reconectar.test.js` › SOF-03 reconectar: volta<br>`sofia-reconectar.test.js` › SOF-03 reconectar: se não volta<br>`sofia-reconectar.test.js` › SOF-03 reconectar: se nem o QR<br>`sofia-reconectar.test.js` › SOF-03 SoFIA: a pausa<br>`sofia-reconectar.test.js` › SOF-03 PAI-02 no painel | parcial: "não apaga o login sozinho" (TypeScript) sem teste |
| SOF-04 | WhatsApp Web: ao vivo; sem estado → versão reserva por 7 dias | `wa-versao-reserva.js`, `wa-client.js`, `ChatBot/sofia-listener.ts` | `whatsapp-versao-reserva.test.js` › SOF-04 robô: a versão ao vivo<br>`whatsapp-versao-reserva.test.js` › SOF-04 robô: conexão presa<br>`whatsapp-versao-reserva.test.js` › SOF-04 robô: nem a reserva<br>`whatsapp-versao-reserva.test.js` › SOF-04 reserva: o marcador | parcial: a cópia em TypeScript da SoFIA sem teste |
| SOF-05 | SoFIA pode agendar experimental para quem já fez | `ChatBot/rota_book_sofia.py`, `agendamento_evo/formulario_web/app.py` | — | ❌ |
| SOF-06 | Cobrança: a SoFIA envia a fila do robô, até 3 tentativas | `ChatBot/sofia-listener.ts`, `inadimplentes.js` | `cobranca-aniversario.test.js` › COB-01 cobrança | parcial: as 3 tentativas da SoFIA sem teste |
| SOF-07 | Chaves da IA e da transcrição só no `.env`/painel | `painel-sofia.js`, `env-arquivo.js` | `trava-segredos.test.js` › DAD-07 trava de segredos: barra | parcial: a trava pega chave no código; o painel não tem teste |
| SOF-08 | QR pela tela nova de entrada do WhatsApp Web (SoFIA e robô) | `wa-qr-tela.js`, `wa-client.js`, `ChatBot/sofia-listener.ts` | `qr-tela.test.js` › SOF-08 QR pela tela: copia<br>`qr-tela.test.js` › SOF-08 QR pela tela: uma leitura<br>`qr-tela.test.js` › SOF-08 robô: na tela<br>`qr-tela.test.js` › SOF-08 tela nova de entrada<br>`qr-tela.test.js` › SOF-08 código pela tela<br>`qr-tela.test.js` › SOF-08 robô: se o WhatsApp<br>`sofia-aquecimento.test.js` › SOF-08 SoFIA<br>`qr-tela.test.js` › SOF-08 depois do login<br>`qr-tela.test.js` › SOF-08 leitura sem cliques | parcial: a SoFIA (TypeScript) usa a mesma peça mas não tem teste próprio; o WhatsApp de verdade só se confere na loja |
| SOF-09 | IA sem crédito / chave recusada: não insiste, avisa a equipe uma vez por episódio | `ia-conta.js`, `ChatBot/sofia.ts`, `ChatBot/sofia-listener.ts` | `ia-conta.test.js` › SOF-09 IA parada: reconhece<br>`ia-conta.test.js` › SOF-09 IA parada: avisa<br>`ia-conta.test.js` › SOF-09 SoFIA: não repete | parcial: a ligação no TypeScript é conferida pelo texto do código |
| SOF-10 | A IA só recebe as ferramentas da SoFIA (`tools: []`) | `ChatBot/sofia.ts` | `ia-conta.test.js` › SOF-10 SoFIA | parcial: conferido pelo texto do código |
| SOF-11 | Modelos da IA pelo painel; Haiku 5.5 só extração e sem pensamento | `sofia-editor.js`, `painel-sofia.js`, `ChatBot/sofia.ts` | `ia-modelos.test.js` › SOF-11 modelos<br>`ia-modelos.test.js` › SOF-11 SoFIA | parcial: o TypeScript é conferido pelo texto do código |
| SOF-13 | Já fez experimental: sem perguntar da aula antiga, convite para a aula para relembrar (gratuita) | `ChatBot/sofia.ts`, `painel-sofia.js` | `sofia-historico.test.js` › SOF-13 já fez experimental | parcial: conferido pelo texto do código (o que a IA responde só se vê na conversa) |
| SOF-12 | Envios que a SoFIA inicia: 30 min após conectar e nada em aquecimento | `sofia-aquecimento.js`, `ChatBot/sofia-listener.ts`, `painel-sofia.js` | `sofia-aquecimento.test.js` › SOF-12 aquecimento<br>`sofia-aquecimento.test.js` › SOF-12 envios<br>`sofia-aquecimento.test.js` › SOF-12 SoFIA<br>`sofia-aquecimento.test.js` › SOF-12 fila de cobrança<br>`sofia-aquecimento.test.js` › SOF-12 bloqueio do app<br>`sofia-aquecimento.test.js` › SOF-12 follow-up segurado<br>`sofia-aquecimento.test.js` › SOF-12 painel | parcial: a ligação no TypeScript é conferida pelo texto do código |

## EVO e aula experimental (`evo.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| EVO-01 | Primeira recusa de senha: para de tentar | `evo-login-estado.js`, `evo-login.js` | `evo-login-recusado.test.js` › EVO-01 reconhece a recusa<br>`evo-login-recusado.test.js` › EVO-01 senha recusada<br>`evo-login-recusado.test.js` › EVO-01 login que seguiu normal<br>`evo-login-recusado.test.js` › EVO-01 código do EVO<br>`evo-login-recusado.test.js` › EVO-01 todo job | ✅ |
| EVO-02 | Aniversário pela coluna "Data de aniversário"; outro mês para o job | `evo-tabela-aniversario.js` | `aniversario-tabela.test.js` › EVO-02 ALU-09 lê a data<br>`aniversario-tabela.test.js` › EVO-02 dia/mês<br>`aniversario-tabela.test.js` › EVO-02 trava: datas de outros meses | ✅ |
| EVO-03 | O robô nunca recebe, estorna, exclui ou cancela no EVO | `evo-scraper.js`, `inadimplentes.js`, `bloqueio-app.js` | — | ❌ |
| EVO-04 | API do EVO: ~40 pedidos/min, com limitador | `agendamento_evo/evo_agendamento/evo_ratelimit.py` | — | ❌ |
| AGE-01 | Formulário: uma experimental por pessoa | `agendamento_evo/formulario_web/app.py` | — | ❌ |
| AGE-02 | Pela SoFIA a AGE-01 não vale | `ChatBot/rota_book_sofia.py` | — | ❌ |
| AGE-03 | Limite de experimentais por turma (só SlimFit) | `agendamento_evo/evo_agendamento/config.py`, `painel-sofia.js` | — | ❌ |
| AGE-04 | FREE: no máximo 1 dia de antecedência; desmarca 2+ e avisa | `free-antecedencia.js`, `agendamento_evo/evo_agendamento/free_antecedencia.py` | — | ❌ |
| AGE-05 | Turma cheia devolve alternativas; soluço do EVO não vira "lotada" | `agendamento_evo/evo_agendamento/orchestrator.py` | `test_offline.py` › test_book_raises_when_full_with_alternatives | parcial: "soluço do EVO não vira lotada" sem teste |
| AGE-06 | Rotas internas do formulário exigem token | `agendamento_evo/formulario_web/app.py` | — | ❌ |
| AGE-07 | Atividade e serviço da experimental (SlimFit e Circuito) editados no painel; valem antes do `.env` | `painel-whatsapp.js`, `painel-mensagens.js`, `agendamento_evo/evo_agendamento/config.py` | `servicos-evo.test.js` › AGE-07 atividade e serviço<br>`test_offline.py` › test_slimfit_evo_painel_vale_antes_do_env<br>`test_offline.py` › test_push_slots_nao_envia_grade_vazia | ✅ |

## Indicadores e tags (`indicadores.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| IND-01 | Ativa = contrato vigente; trancada conta; tolerância de 7 dias | `ativas-dados.js`, `indicadores.js` | `indicadores-formulas.test.js` › IND-01 alunas ativas: mês em andamento<br>`indicadores-formulas.test.js` › IND-01 alunas ativas: quem venceu | ✅ |
| IND-02 | Agendamento anotado na hora; o mesmo em 2 h conta uma vez | `agendou-registro.js` | `funil-agendamentos.test.js` › IND-02 funil: etiqueta trocada<br>`funil-agendamentos.test.js` › IND-02 funil: quem tem mais de 30<br>`funil-agendamentos.test.js` › IND-02 funil: agendamento conta mesmo sem<br>`funil-agendamentos.test.js` › IND-02 funil: o mesmo agendamento<br>`funil-agendamentos.test.js` › IND-02 IND-04 funil: agendamento antigo | ✅ |
| IND-03 | Comparecimento = fez ÷ (fez + faltou) | `indicadores.js` | `indicadores-formulas.test.js` › IND-03 IND-04 funil: comparecimento | ✅ |
| IND-04 | "Conversaram" = quem escreveu no período; remarcação no 1º agendamento | `indicadores.js` | `indicadores-formulas.test.js` › IND-03 IND-04 funil: comparecimento<br>`funil-agendamentos.test.js` › IND-02 IND-04 funil: agendamento antigo | ✅ |
| IND-05 | Quem tem "Conversas da SoFIA" vê o Funil | `painel-base.js`, `painel-mensagens.js` | `perfis.test.js` › PAI-01..04 cada perfil | ✅ |
| IND-06 | O mês fecha no dia 9 e a foto não muda | `metas.js`, `painel-metas.js` | `metas.test.js` › IND-06 fechamento<br>`metas.test.js` › IND-06 tela de Metas<br>`datas.test.js` › IND-06 metas<br>`funil-agendamentos.test.js` › IND-06 metas: mês fechado | ✅ |
| IND-07 | Inadimplência = em atraso ÷ o que já venceu | `indicadores.js` | `indicadores-formulas.test.js` › IND-07 recebimentos | ✅ |
| TAG-01 | Entrar numa etapa tira a anterior | `contatos.js` | `contatos-mensagens.test.js` › TAG-01 tags do funil | ✅ |
| PAG-01 | Sábado por aula (R$ 35 para quem deu cada aula) a partir do mês escolhido | `pagamento/calculo.js`, `pagamento/config.js`, `pagamento/painel.js` | `pagamento-sabado.test.js` › PAG-01 sábado por aula: R$ 35<br>`pagamento-sabado.test.js` › PAG-01 sábado por aula: antes<br>`pagamento-sabado.test.js` › PAG-01 sábado por aula: mês inválido | ✅ |
| TAG-02 | Presença semanal: "Fez aula" / "sem presença" | `comparecimento.js` | — | ❌ |

## Dados e segredos (`dados-e-segredos.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| DAD-01 | Segredo nunca escrito, pedido nem commitado | `.claude/hooks/bloquear-segredos.js` | `trava-segredos.test.js` › DAD-07 trava de segredos: barra | parcial: a trava só reconhece alguns formatos (achado R3) |
| DAD-02 | `.env`, `data/`, `SOFIA_DIR` e sessões fora do Git | `Experimental/.gitignore`, `.claude/hooks/bloquear-segredos.js` | `trava-segredos.test.js` › DAD-07 trava de segredos: barra<br>`trava-segredos.test.js` › DAD-07 trava de segredos: deixa passar | ✅ |
| DAD-03 | Dado pessoal e marcador de envio só no servidor | `Experimental/.gitignore` | `trava-segredos.test.js` › DAD-07 trava de segredos: barra | ✅ |
| DAD-04 | Teste usa cópia temporária | `testes/ajuda.js` | — | processo |
| DAD-05 | `.env` gravado só por `env-arquivo.js` | `env-arquivo.js` | `senha-evo.test.js` › DAD-05 .env: o valor lido<br>`senha-evo.test.js` › DAD-05 .env: linha repetida<br>`senha-evo.test.js` › DAD-05 PAI-03 no painel | ✅ |
| DAD-06 | Arquivo de estado novo grava de forma atômica | — | — | processo |
| DAD-07 | A trava barra commit/push com segredo | `.claude/hooks/bloquear-segredos.js` | `trava-segredos.test.js` › DAD-07 trava de segredos: barra<br>`trava-segredos.test.js` › DAD-07 trava de segredos: deixa passar<br>`trava-segredos.test.js` › DAD-07 trava de segredos: no código | ✅ |

## Demonstração (`demo.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| DEM-01 | Nada sai para a rede; nenhuma ação executa | `demo-guard.js` | `demonstracao.test.js` › DEM-01/02 demonstração<br>`demonstracao.test.js` › DEM-01 fora da demonstração | ✅ |
| DEM-02 | Pasta da SoFIA da demonstração dentro da instalação | `demo-dados.js` | `demonstracao.test.js` › DEM-01/02 demonstração | ✅ |
| DEM-03 | Dados fictícios; conversas reais só no servidor | `demo-dados.js`, `demo-conversas.js` | — | processo |
| DEM-04 | O teste de telas roda sobre a demonstração | `testes/tela/telas.js` | `telas.js` | ✅ |

## Publicar e atualizar (`deploy.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| DEP-01 | Push só na branch de trabalho; merge só com CI ✓ | `.claude/skills/subir-versao/SKILL.md`, `.github/workflows/ci.yml` | — | processo |
| DEP-02 | Servidores baixam só a marca `estavel` | `scripts/ramo-estavel.js` | `ramo-estavel.test.js` › DEP-02 baixa a "estavel" | ✅ |
| DEP-03 | `slimfit-atualizar` reinicia tudo; rodar fora do horário de envio | `scripts/atualizar.js` | — | ❌ |
| DEP-04 | Nomes do PM2 vêm de `pm2-nomes.js` | `pm2-nomes.js` | — | ❌ |
| DEP-05 | Mudança que o dono nota → Novidades | `agendamento_evo/formulario_web/templates/implantacao.html` | — | processo |
| DEP-06 | Comandos simples, um por linha; nada de backup sem pedido | `scripts/atualizar.js` | — | processo |
| DEP-07 | Skills (subir-versao, conferir-pr, conferir-celular, nova-tela) e hooks (segredos, lembretes depois do git, limpeza) | `.claude/settings.json`, `.claude/hooks/depois-do-git.js`, `.claude/skills/conferir-pr/SKILL.md` | `skills-hooks.test.js` › DEP-07 skills<br>`skills-hooks.test.js` › DEP-07 hooks<br>`skills-hooks.test.js` › DEP-07 depois do commit | ✅ |
| DEP-08 | GitHub: CI em todo PR, rodada noturna com aviso, botão de prints com relógio fixo | `.github/workflows/ci.yml`, `.github/workflows/noturno.yml`, `.github/workflows/prints.yml`, `testes/tela/relogio-fixo.js` | `skills-hooks.test.js` › DEP-08 GitHub<br>`skills-hooks.test.js` › DEP-08 relógio fixo | parcial: o workflow em si só roda no GitHub; aqui se confere a montagem e o relógio |
| NOV-01 | Nova loja pelo painel: senha só na 1ª vez, chave depois, impressão digital, segredos em arquivo apagado | `nova-loja-remoto.js`, `nova-loja.js`, `painel-nova-loja.js`, `setup-novo-studio.sh` | `nova-loja-remoto.test.js` › NOV-01 nova loja: dados<br>`nova-loja-remoto.test.js` › NOV-01 nova loja: segredos<br>`nova-loja-remoto.test.js` › NOV-01 nova loja: diagnóstico<br>`nova-loja-remoto.test.js` › NOV-01 setup-novo-studio.sh: --segredos<br>`nova-loja-remoto.test.js` › NOV-01 nova loja: num servidor<br>`nova-loja-remoto.test.js` › NOV-01 setup-novo-studio.sh: nunca<br>`nova-loja-remoto.test.js` › NOV-01 nova loja: leitura<br>`nova-loja.test.js` › NOV-01 nova loja: o formulário<br>`nova-loja.test.js` › NOV-01 nova loja: endereço primeiro<br>`nova-loja.test.js` › NOV-01 nova loja: andamento<br>`nova-loja.test.js` › NOV-01 nova loja: atividade<br>`nova-loja.test.js` › NOV-01 nova loja: só no painel<br>`nova-loja.test.js` › NOV-01 nova loja: na 1ª vez<br>`perfis.test.js` › PAI-01..04 cada perfil | parcial: o teste com servidor de verdade (SSH) só roda com `SF_TESTE_VPS` (Ubuntu em Docker) |
| NOV-02 | Endereço no DuckDNS (2 contas, tokens só no .env), apontado e conferido antes de instalar | `nova-loja-duckdns.js`, `nova-loja.js` | `nova-loja.test.js` › NOV-02 duckdns | parcial: o DuckDNS de verdade não é chamado nos testes |
| NOV-03 | Conferência no fim: https, --check, pm2, IA, 3 segmentos do EVO (só leitura), aquecimento ligado | `nova-loja-remoto.js`, `nova-loja.js`, `conferir-segmentos.js`, `painel-nova-loja.js` | `nova-loja.test.js` › NOV-03 conferência: lê<br>`nova-loja.test.js` › NOV-03 conferência: o script<br>`nova-loja.test.js` › NOV-03 conferência: concluiu | parcial: o EVO e a Anthropic de verdade não são chamados nos testes |

## Testes (`testes.md`)

| Código | Regra | Onde | Teste | Cobertura |
|---|---|---|---|---|
| TST-01 | Teste nunca toca dado real (`ambienteIsolado`) | `testes/ajuda.js`, `testes/bloqueios.js` | — | processo |
| TST-02 | Regra nova → teste e linha nesta matriz | `docs/rastreabilidade.md`, `scripts/matriz.js`, `scripts/testar-alteracao.js` | `matriz.test.js` › TST-02 a matriz tem<br>`matriz.test.js` › TST-02 a matriz só cita<br>`matriz.test.js` › TST-02 a matriz: todo teste<br>`matriz.test.js` › TST-02 a matriz: o resumo | ✅ |
| TST-03 | Tela nova entra em `TELAS` | `testes/tela/telas.js` | — | processo |
| TST-04 | Porta de teste por `portaLivre()` | `testes/ajuda.js` | — | processo |
| TST-05 | Teste instável: achar a causa | `testes/ajuda.js` | — | processo |
| TST-06 | Bateria completa antes do PR; CI ✓ | `.github/workflows/ci.yml` | — | processo |
| TST-07 | "Hoje" vem de `relogio.js`; teste fixa com `SF_AGORA` | `relogio.js` | `datas.test.js` › relógio | ✅ |
| TST-08 | Perfis: todas as rotas e cada perfil | `testes/unidade/perfis.test.js` | `perfis.test.js` › PAI-01..04 cada perfil<br>`permissoes.test.js` › PAI-01 PAI-02 usuário sem nenhuma permissão | ✅ |
| TST-09 | Telas a 1366 e 390 px, sem rolagem lateral | `testes/tela/telas.js` | `telas.js` | ✅ |
| TST-10 | Teste apaga a pasta temporária; o hook apaga os restos `sf-*` com mais de 2 h | `.claude/hooks/limpar-restos-teste.js`, `testes/ajuda.js` | `skills-hooks.test.js` › TST-10 limpeza | ✅ |

## Achados

Erros e lacunas encontrados. Cada um sai daqui quando for resolvido (com PR).

**Riscos no código**
- **R3** A trava de segredos só reconhece `NOME=valor` e chaves conhecidas; não pega JSON com chave privada fora de `data/` (DAD-01).
- **R4** Formulário: `/api/diag-evo` é público e devolve o texto do erro; tokens vão na URL e são comparados com `!=` (AGE-06).
- **R5** GET que grava: abrir Metas fecha o mês (IND-06); `GET /logout`.
- **R6** ~47 respostas do painel mostram `e.message` (pode trazer caminho de arquivo ou saída do git).
- **R7** Telefone normalizado de 3 jeitos (`contatos.normTel`, `formularios.normTel`, `agendamentos.normalizarTelefone`) + ~20 "últimos 8 dígitos" soltos (ENV-07).
- **R8** Regras repetidas: horários padrão em `config.js` e `horarios.js`; tolerância de 7 dias no Python e em 5 lugares do JS (IND-01); identificação de navegador e versão reserva no robô e na SoFIA (SOF-04); dois `patch-wwebjs.js` diferentes.
- **R11** `painel-mensagens.js` e `painel-sofia.js` (~3 mil linhas cada) misturam rota, regra e HTML.
- **R12** IA, transcrição e envio real não têm simulação de teste (SOF-01, SOF-02).
- **R18** A biblioteca do WhatsApp (`whatsapp-web.js`) não tem versão fixa: o `package.json` pede `#main` e o `package-lock.json` aponta outro repositório, então cada `npm install` (loja nova, ou `slimfit-atualizar` quando as dependências mudam) baixa a versão do dia — cada loja pode ficar com uma diferente. Sorocaba (26/11/2026) subiu sem as peças da biblioteca na página (ENV-09).

**Regras de envio sem teste** — pedem separar a leitura do EVO da decisão, como foi feito
na cobrança (`inadimplentes.enfileirar`):
- **R13** Follow-up e no-show (FUP-01, FUP-02) leem o EVO pelo navegador.
- **R14** Contratos a vencer (ENV-02, `renovacoes-mes-grupo.js`) e renovação (ALU-01): navegador.
- **R15** FREE (AGE-04) está no Python e no JS.
- **R16** Campanhas da SoFIA (SOF-02) estão em TypeScript, sem bateria de testes.
- **R17** Trancada não recebe ausência nem vencimento (ENV-08): a regra está espalhada (`suspensoes.js` + cada job) e nenhum teste a confere.

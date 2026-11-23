# Regras de envio — onde estão e o que as garante

Mapa das regras que **mandam mensagem para clientes** (as críticas): cada regra, o
arquivo que a cumpre e o teste automático que a garante. Rodam em todo PR (CI).

- O teste `testes/unidade/matriz-regras.test.js` confere este arquivo: todo teste citado
  aqui precisa existir com o mesmo título. Se você renomear ou apagar um teste, o CI avisa.
- Regra sem teste fica marcada **falta teste**. Regra nova de envio entra aqui, com teste
  (veja `CLAUDE.md`).

Formato da coluna "Teste": `arquivo.test.js` › título do teste.

## Regras gerais (valem para todos os jobs)

| Regra | Onde | Teste |
|---|---|---|
| Anota o envio NA HORA — nunca manda em dobro | `retomada-sofia.js` | `retomada.test.js` › envia uma vez só, anota na hora e não repete na rodada seguinte |
| Anota o envio NA HORA — nunca manda em dobro | `followup-encerramento.js` | `encerramento.test.js` › manda o encerramento só para quem não respondeu, uma vez só |
| Sem conseguir ler a conversa, não envia | `retomada-sofia.js` | `retomada.test.js` › sem conseguir ler a conversa não envia, e para depois de 3 falhas seguidas |
| Sem conseguir ler a conversa, não envia | `followup-encerramento.js` | `encerramento.test.js` › sem conseguir ler a conversa, não envia |
| Job que esperava a vez e se perdeu (reinício/robô ocupado) roda depois; o que já tinha começado NÃO repete | `jobs-batimento.js`, `scheduler.js` | `fila-jobs.test.js` › job que esperava a vez quando o robô reiniciou roda depois; o que já tinha começado não repete |
| Job atrasado não sai de noite nem com mais de 3 h de atraso | `jobs-batimento.js` | `fila-jobs.test.js` › de noite não manda nada atrasado; atrasado demais sai da fila (com aviso) |
| Texto das mensagens: variáveis preenchidas; `{nome}` some quando não há nome | `mensagens.js` | `contatos-mensagens.test.js` › mensagens: preenche as variáveis e some com {nome} quando não há nome |
| Todo texto padrão existe e não tem variável desconhecida | `mensagens.js` | `contatos-mensagens.test.js` › mensagens: todo texto padrão do catálogo existe e não tem variável desconhecida solta |
| Contato é achado pelo telefone com ou sem o 9 | `contatos.js` | `contatos-mensagens.test.js` › contato é achado pelo telefone mesmo sem o 9 |
| Permissões checadas no servidor (quem não pode, não aciona envio nenhum) | `painel-mensagens.js` | `permissoes.test.js` › usuário sem nenhuma permissão não acessa rota nenhuma do painel |

## Por job

| Regra | Onde | Teste |
|---|---|---|
| Retomada: só quem está na janela e sem impedimento | `retomada-sofia.js` | `retomada.test.js` › escolhe só quem está na janela e sem impedimento |
| Retomada: se a recepção já falou com ela pelo Studio, não envia | `retomada-sofia.js` | `retomada.test.js` › se a recepção já falou com ela pelo Studio, não envia |
| Resumo da semana: "Rodar de novo" vale como o envio do dia e não repete o que já saiu hoje | `resumo-semanal.js` | `resumo-semana-refazer.test.js` › resumo da semana: rodar de novo manda nos grupos, vale como o envio do dia e não repete |
| Encerramento: quem virou aluna não recebe | `followup-encerramento.js` | `encerramento.test.js` › quem virou aluna não recebe encerramento |
| Encerramento: quem agendou de novo depois da mensagem não recebe (vale o registro de agendamentos, mesmo sem etiqueta de "agendou") | `followup-encerramento.js`, `agendou-registro.js` | `encerramento.test.js` › quem agendou de novo depois da mensagem não recebe encerramento — mesmo sem etiqueta de "agendou" |
| Tags do funil: entrar numa etapa tira a anterior | `contatos.js` | `contatos-mensagens.test.js` › tags do funil: entrar numa etapa tira a anterior, e a tag que chega fica |
| Aniversário: data pela coluna "Data de aniversário" (nunca a última presença) | `evo-tabela-aniversario.js` | `aniversario-tabela.test.js` › lê a data pela coluna "Data de aniversário" (dia/mês), nunca a última presença |
| Aniversário: datas de outro mês (coluna errada) param o job e avisam | `evo-tabela-aniversario.js` | `aniversario-tabela.test.js` › trava: datas de outros meses (coluna errada) param o job em vez de dizer "ninguém hoje" |
| Aniversário: não manda se o celular do cadastro é de outra aluna | `aniversariantes.js` | `cobranca-aniversario.test.js` › ALU-09 aniversário: não manda quando o celular do cadastro é de OUTRA aluna |
| Confirmação da aula experimental (hoje/amanhã): sem telefone não envia; anota na hora quem recebeu | `scheduler.js`, `whatsapp-sender.js` | `confirmacao-envio.test.js` › CONF-01 confirmação: envia a cada aluna com telefone, anota na hora quem recebeu e não anota quem falhou |
| Confirmação sem resposta: 2ª mensagem (1h30+, aula longe, sem resposta, uma vez) | `confirmacao-sem-resposta.js` | `confirmacao-sem-resposta.test.js` › CONF-02 2ª mensagem: só quem ficou em silêncio 1h30+, com a aula ainda longe — e uma vez só |
| Confirmação sem resposta: lista da equipe (uma vez por pessoa) | `confirmacao-sem-resposta.js` | `confirmacao-sem-resposta.test.js` › CONF-03 lista da equipe: quem recebeu a 2ª e continua sem responder entra UMA vez; quem respondeu sai |
| Follow-up da experimental (manhã/tarde) | `followup-experimental.js` | falta teste |
| Faltou (no-show) | `follow-up-no-show.js` | falta teste |
| Boas-vindas: uma vez por contrato, mensagem do tipo (nova, voltou, renovou) | `boas-vindas.js` | `boas-vindas.test.js` › ALU-03 boas-vindas: nova, voltou e renovou recebem a mensagem do seu tipo — e cada contrato uma vez só |
| Indicação aos 30 dias: uma vez só | `boas-vindas.js` | `boas-vindas.test.js` › ALU-04 indicação: aos 30 dias do início do período, uma vez só |
| Cobrança de inadimplentes: no máximo 1×/dia, só marca com envio confirmado | `inadimplentes.js` | `cobranca-aniversario.test.js` › COB-01 cobrança: no máximo 1 vez por dia, sem duplicar a fila, e só a SoFIA marca como cobrada |
| Cobrança: boleto que vence hoje só no disparo "vence hoje" | `inadimplentes.js` | `cobranca-aniversario.test.js` › COB-02 cobrança: o boleto que vence hoje só sai no disparo "vence hoje", e o vencido só no regular |
| Planos FREE: desmarca quem marcou com 2+ dias e avisa a equipe | `free-antecedencia.js` | falta teste |
| Contratos a vencer: sem o filtro do EVO, falha e não envia lista vazia | `renovacoes-mes-grupo.js` | falta teste |
| Campanhas da SoFIA: cada pessoa recebe uma vez; cancelada não retoma | `painel-mensagens.js`, `ChatBot/sofia-listener.ts` | falta teste |
| Demonstração nunca toca a unidade real (pasta da SoFIA só dentro da instalação) | `demo-dados.js`, `demo-guard.js` | `demonstracao.test.js` › DEM-01/02 demonstração: comandos e rede para fora bloqueados; pasta da SoFIA sempre dentro da instalação |
| Sentimos sua falta: 14 dias sem presença para a 1ª, 10 dias depois a 2ª | `sentimos-falta.js` | `datas.test.js` › ALU-05 "Sentimos sua falta": a contagem de dias atravessa fevereiro e o mês da 2ª mensagem |
| "Vence hoje": a segunda cobre o domingo sem disparo | `vence-hoje.js` | `datas.test.js` › ALU-02 "vence hoje": segunda cobre o domingo sem disparo, inclusive na virada de fevereiro para março |

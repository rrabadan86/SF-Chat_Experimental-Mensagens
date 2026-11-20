/**
 * dicionario-indicadores.js — o que significa cada número do painel, do jeito que o
 * código calcula HOJE (Indicadores → Dicionário).
 *
 * É a referência única: mudou uma conta, muda aqui no mesmo commit. Onde dois
 * números têm nome parecido e regra diferente, isso está escrito em `atencao` —
 * é melhor avisar do que deixar as telas "não baterem" sem explicação.
 *
 * Cada item: { nome, conta, fonte, atencao? }. O texto vai para a tela como HTML
 * escrito aqui (sem dado de usuário).
 */
const GRUPOS = [
  {
    tela: 'Funil', href: '/funil',
    itens: [
      { nome: 'Conversaram', conta: 'Pessoas que <b>escreveram para a SoFIA</b> dentro do período. Mensagem só da SoFIA (follow-up, campanha) e resposta automática do WhatsApp da pessoa não contam. Quem agendou pela SoFIA no período entra aqui.', fonte: 'Conversas e histórico de interações da SoFIA.' },
      { nome: 'Agendaram', conta: 'Pessoas com agendamento de aula experimental <b>dentro do período</b>, pela data em que agendaram. Cada pessoa conta uma vez por período. Quem agendou e <b>remarcou depois</b> conta nos dois períodos.', fonte: 'Histórico de tags (cada agendamento da SoFIA, do Formulário ou do Express grava a tag de “agendou” com o canal).' },
      { nome: '% de quem conversou', conta: '<b>Agendaram pela SoFIA ÷ conversaram</b>, os dois no mesmo período.', fonte: 'Os dois números acima (filtro SoFIA).' },
      { nome: 'Fizeram a aula', conta: 'De quem agendou no período, quem <b>compareceu</b>. Inclui quem depois fechou contrato.', fonte: 'Tag de presença (automação “Presença da experimental”, que lê o EVO) ou a presença lançada na agenda do EVO.' },
      { nome: 'Comparecimento', conta: '<b>Fez ÷ (fez + faltou)</b>. Só entra quem já teve a aula: quem ainda vai fazer e quem está sem registro ficam fora.', fonte: 'Fizeram a aula e Faltaram.', atencao: 'Em Professoras a presença usa a mesma conta, mas sobre as aulas da agenda do EVO — os dois números ficam próximos, não iguais.' },
      { nome: 'Aguardando a aula', conta: 'Agendou e a aula ainda não aconteceu.', fonte: 'Data da aula gravada no agendamento.' },
      { nome: 'Sem registro no EVO', conta: 'A aula já passou e a presença não foi lançada, ou a experimental não foi achada no EVO (desmarcada, ou marcada com outro nome).', fonte: 'Agenda de experimentais do EVO.' },
      { nome: 'Fecharam contrato (Funil)', conta: 'De quem agendou no período, quem <b>hoje</b> tem a tag de aluna (contrato ativo no EVO, sem Circuito/VIP).', fonte: 'Tag “0. Aluna”, posta pela sincronização de alunas.', atencao: 'Regra diferente de <b>Professoras</b>. Aqui vale a situação de hoje: quem fechou e depois saiu deixa de contar, e quem fez a aula há poucos dias ainda não teve tempo de fechar.' },
      { nome: '▲ / ▼ período anterior', conta: 'Diferença de “agendaram” para o período anterior <b>do mesmo tamanho</b> (7 dias × os 7 anteriores). Só aparece quando o histórico de tags cobre o período anterior inteiro.', fonte: 'Histórico de tags.' },
      { nome: 'Por que não agendaram', conta: 'Motivo que a SoFIA dá ao encerrar uma conversa sem agendamento. Conta a última conversa de cada pessoa no período.', fonte: 'Resumo da conversa feito pela IA.' },
    ],
  },
  {
    tela: 'Formulário', href: '/indicadores',
    itens: [
      { nome: 'Aberturas (acessos)', conta: 'Cada vez que a página do formulário de agendamento foi aberta. A mesma pessoa pode abrir várias vezes.', fonte: 'Registro de acessos do formulário.' },
      { nome: 'Pessoas', conta: 'Visitantes diferentes. Abertura sem identificação do navegador conta como uma pessoa.', fonte: 'Identificador gravado no navegador de quem abriu.' },
      { nome: 'Conversão (por pessoa)', conta: '<b>Agendamentos ÷ pessoas</b> que abriram o formulário.', fonte: 'Os dois números acima.', atencao: 'A mesma pessoa em dois aparelhos conta duas vezes como pessoa.' },
    ],
  },
  {
    tela: 'Professoras', href: '/professoras',
    itens: [
      { nome: 'Experimentais', conta: 'Aulas experimentais lançadas na agenda do EVO no período. Ficam fora: canceladas, quem <b>já era aluna</b> no dia e professora lançada como aluna.', fonte: 'Agenda de experimentais do EVO (lida toda noite).' },
      { nome: 'Presença', conta: '<b>Vieram ÷ (vieram + faltaram)</b>. Aula ainda agendada não entra.', fonte: 'Presença lançada no EVO.' },
      { nome: 'Fecharam (Professoras)', conta: 'Veio à aula e <b>começou um contrato</b> (sem Circuito/VIP) entre 3 dias antes e 120 dias depois da aula.', fonte: 'Contratos do EVO (os mesmos de Alunas ativas).', atencao: 'Regra diferente do <b>Funil</b>. Conta por <b>aula</b>: quem fez duas experimentais e fechou conta duas vezes. Períodos recentes ainda não tiveram os 120 dias.' },
      { nome: 'Conversão', conta: '<b>Fecharam ÷ vieram</b>, por professora e por horário. Com menos de 5 aulas feitas o número fica cinza.', fonte: 'Os números acima.' },
    ],
  },
  {
    tela: 'Alunas ativas', href: '/ativas',
    itens: [
      { nome: 'Aluna ativa', conta: 'Tem <b>contrato vigente</b> no dia (início, fim e cancelamento). <b>Trancada conta.</b> Contrato Circuito e VIP não contam; renovação que ainda não começou (na fila) não conta.', fonte: 'Contratos de todas as clientes no EVO (atualizado às 05:25).', atencao: 'A <b>Grade</b> usa outra base para o TKM: o status do EVO (ativo + trancado, sem VIP). Lá o Circuito entra; por isso os dois totais podem diferir.' },
      { nome: 'Início', conta: 'Ativas quando o período começou — o fechamento do período anterior.', fonte: 'Série diária.' },
      { nome: 'Entraram', conta: 'Contratos que começaram no período: <b>novas</b> (primeiro contrato) + <b>voltaram</b> (ex-aluna com intervalo maior que a tolerância).', fonte: 'Contratos do EVO.' },
      { nome: 'Saíram', conta: 'Perderam o contrato ativo: venceu sem renovar ou cancelou. A saída conta no dia seguinte ao fim. Renovação com até <b>7 dias</b> de atraso não é saída.', fonte: 'Contratos do EVO.' },
      { nome: 'Ainda podem renovar', conta: 'Saídas do mês/semana em andamento cujo contrato venceu há até 7 dias. Já contam como saída; se renovarem no prazo, deixam de contar.', fonte: 'Contratos do EVO.' },
      { nome: 'Saldo / Variação', conta: '<b>Fim − Início</b> (= entraram − saíram).', fonte: 'Série diária.' },
      { nome: 'Taxa de saída', conta: '<b>Saíram ÷ Início</b>: de cada 100 alunas do começo do período, quantas saíram.', fonte: 'Série diária.' },
      { nome: 'Comparar dois meses', conta: 'Se um dos meses ainda não fechou, os dois contam só <b>do dia 1 até hoje</b>.', fonte: 'Série diária.' },
    ],
  },
  {
    tela: 'Grade', href: '/grade',
    itens: [
      { nome: 'Taxa de ocupação FIXAS', conta: '<b>Matrículas fixas ÷ vagas</b> das turmas da semana, sem sábado. Mede quanto da agenda está vendida.', fonte: 'Turmas e matrículas do EVO.' },
      { nome: 'Presença na turma', conta: '<b>Quem ocupou a aula ÷ vagas</b> (fixas presentes + reposição + FREE), só nas aulas já realizadas, sem sábado.', fonte: 'Agenda do EVO.', atencao: 'É a <b>ocupação real da sala</b>, não a frequência das matriculadas: turma com 5 fixas em 9 vagas, todas presentes, mostra 56%.' },
      { nome: 'Alunas fixas', conta: 'Alunas com matrícula fixa em alguma turma da semana, e quanto são das ativas do EVO.', fonte: 'Matrículas do EVO.' },
      { nome: 'Previsto para receber no mês', conta: 'Soma dos lançamentos com <b>vencimento no mês</b> (não cancelados), pagos ou não. É a previsão, não o que entrou.', fonte: 'Recebíveis do EVO (lidos às 05:40 ou em “Atualizar tudo”).' },
      { nome: 'Recebido no mês', conta: 'Do previsto, o que <b>já caiu de fato</b> até a leitura. Cartão que a operadora ainda vai repassar não conta.', fonte: 'Recebíveis do EVO.' },
      { nome: 'Em atraso', conta: 'Venceu e não foi pago. O cartão já passado com repasse futuro fica à parte, em “cartão a cair”.', fonte: 'Recebíveis do EVO.' },
      { nome: 'Inadimplência', conta: '<b>Em atraso ÷ o que já venceu no mês</b> (pago + em atraso). O que ainda vai vencer e o cartão a cair ficam fora.', fonte: 'Recebíveis do EVO.' },
      { nome: 'TKM médio', conta: 'Média do <b>valor do contrato ÷ meses de duração</b> de cada aluna ativa. Um anual de R$ 7.320 vira R$ 610/mês.', fonte: 'Contrato vigente e venda no EVO.', atencao: 'É o <b>preço contratado</b>, não o dinheiro que entrou. Contrato sem data de fim ou sem venda casada, e VIP/cortesia, ficam fora da média (a tela mostra quantas).' },
    ],
  },
  {
    tela: 'Campanhas', href: '/sofia?view=campanhas',
    itens: [
      { nome: 'Responderam', conta: 'Receberam a campanha e mandaram <b>qualquer mensagem</b> em até 7 dias.', fonte: 'Conversas da SoFIA.' },
      { nome: 'Agendaram', conta: 'Receberam a campanha e agendaram em até 30 dias.', fonte: 'Agendamentos registrados pela SoFIA.' },
      { nome: 'Viraram alunas', conta: 'Têm a tag de aluna hoje e não tinham quando a campanha foi criada. Sem prazo.', fonte: 'Tags dos contatos.', atencao: 'Os três mostram o que aconteceu <b>depois</b> da campanha, não o que foi <b>por causa</b> dela. Quem recebeu duas campanhas conta nas duas.' },
    ],
  },
  {
    tela: 'Metas', href: '/metas',
    itens: [
      { nome: 'No ritmo / abaixo do ritmo', conta: 'Compara o realizado com o <b>esperado até hoje</b> = meta × parte do mês que já passou, com 5% de folga. Em “Recebido”, a parte do mês é a fatia do previsto que já venceu.', fonte: 'Metas digitadas + números das outras telas.' },
      { nome: 'Projeção', conta: 'Se o resto do mês andar igual ao que já passou, onde o mês fecha.', fonte: 'Realizado até hoje.' },
      { nome: 'Mês fechado 🔒', conta: 'Foto dos números do mês, tirada no <b>dia 9 do mês seguinte</b> (depois dos 7 dias de tolerância de renovação). Depois disso não muda mais.', fonte: 'Alunas ativas, Funil e a última leitura dos recebimentos dentro do mês.' },
    ],
  },
];

module.exports = { GRUPOS };

/**
 * manual.js — a página /manual: o que o sistema faz, tela por tela.
 *
 * Escrito para o médico e para a recepção, não para quem programa. Por isso
 * fala de "local de atendimento" e não de "hospital.id", e explica o porquê
 * de cada regra em vez de listar campos.
 *
 * Montado no servidor, como o resto: o nome do médico e os locais saem da
 * configuração, então o manual acompanha o que está no ar em vez de
 * envelhecer numa pasta. O que nunca entra aqui é dado de contato da
 * recepção ou de paciente — a página é pública.
 */
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SUMARIO = [
  ['visao', 'Como funciona, em uma tela'],
  ['paciente', 'A página do paciente'],
  ['whatsapp', 'A conversa com a recepção'],
  ['painel', 'O painel do médico'],
  ['regras', 'As regras que definem os horários'],
  ['indicadores', 'Os indicadores'],
  ['duvidas', 'Quando algo não sai como esperado'],
  ['privacidade', 'Privacidade'],
];

function topo(medico) {
  return `<div class="topbar">
  <div class="wrap">
    <div class="brandmark">
      <div class="sigil" aria-hidden="true">M</div>
      <div class="brandtxt"><b>Manual do sistema</b><span>${esc(medico.nome)}</span></div>
    </div>
    <nav class="topnav"><a class="btn sm" href="/">Ver o site</a></nav>
  </div>
</div>`;
}

function passo(numero, titulo, corpo) {
  return `<li class="passo-manual">
    <span class="passo-num">${numero}</span>
    <div><h3>${esc(titulo)}</h3><p>${corpo}</p></div>
  </li>`;
}

function bloco(id, titulo, corpo) {
  return `<section id="${id}">
  <div class="wrap">
    <h2>${esc(titulo)}</h2>
    ${corpo}
  </div>
</section>`;
}

function listaLocais(hospitais) {
  const ativos = (hospitais || []).filter((h) => h.ativo !== false);
  if (!ativos.length) return '<p>Nenhum local ligado no momento.</p>';
  return `<ul class="lista-simples">${ativos.map((h) => `<li><b>${esc(h.nome)}</b>${
    h.endereco ? ` — ${esc(h.endereco)}` : ''}</li>`).join('')}</ul>`;
}

function paginaManual({ medico, hospitais, url }) {
  const nome = medico.nome || 'o médico';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual do sistema — ${esc(nome)}</title>
<meta name="description" content="O que o sistema de agendamento faz, o que tem na página do paciente e o que tem no painel do médico.">
<!-- O manual não deve concorrer com a página do paciente na busca: quem
     procura o médico tem que achar o site, não o manual dele. -->
<meta name="robots" content="noindex, follow">
${url ? `<link rel="canonical" href="${esc(url)}/manual">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Karla:wght@400;600;700&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/estilo.css">
</head>
<body class="manual">

${topo(medico)}

<header class="hero">
  <div class="wrap">
    <div class="eyebrow">Manual</div>
    <h1>O que este sistema faz</h1>
    <p class="lede">O paciente escolhe o horário no site. O sistema segura a vaga na
      agenda do Google e avisa a recepção pelo WhatsApp. A recepção confirma
      respondendo uma mensagem, e o paciente recebe a confirmação. Este manual
      explica cada uma dessas partes.</p>
    <nav class="sumario" aria-label="Índice">
      ${SUMARIO.map(([id, t], i) =>
        `<a href="#${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(t)}</a>`).join('')}
    </nav>
  </div>
</header>

<main>

${bloco('visao', 'Como funciona, em uma tela', `
  <ol class="passos-manual">
    ${passo(1, 'O paciente escolhe', 'Ele entra no site, escolhe o local, o dia e o horário, '
      + 'preenche os dados e envia. Não precisa ligar nem esperar horário comercial.')}
    ${passo(2, 'A vaga é segurada na hora', 'O sistema cria o compromisso na agenda do Google '
      + 'daquele local, marcado como <strong>PRÉ ·</strong> e ainda provisório. A partir desse '
      + 'instante o horário some do site para os outros pacientes — ninguém marca em cima.')}
    ${passo(3, 'A recepção recebe no WhatsApp', 'Chega uma mensagem com nome, telefone, tipo de '
      + 'consulta, convênio, o local e o horário — tudo que ela precisa para ligar. '
      + 'A mensagem traz um <strong>protocolo</strong>, que é o número do pedido.')}
    ${passo(4, 'A recepção confirma', 'Ela responde <code>CONFIRMAR</code> com o protocolo. '
      + 'O compromisso deixa de ser provisório no Google, e o paciente recebe a confirmação '
      + 'no WhatsApp dele.')}
  </ol>
  <p class="nota">Enquanto ninguém confirma, o horário continua reservado. Se a recepção
    responder <code>REMARCAR</code>, a vaga volta para o site e outro paciente pode usá-la.</p>
`)}

${bloco('paciente', 'A página do paciente', `
  <p>É o endereço principal, o que o paciente acessa: <code>${esc(url || '/')}</code>.
    Tudo nela é editável no painel — texto, foto, ordem das seções. As seções são:</p>
  <dl class="glossario">
    <dt>Apresentação</dt>
    <dd>Título, texto de abertura, foto, registro profissional e os números em destaque
      (quantos locais, duração da consulta, prazo de confirmação).</dd>
    <dt>Frase de destaque</dt>
    <dd>Uma faixa com uma frase na voz do médico. Deixando a frase em branco no painel,
      a faixa some.</dd>
    <dt>Agendamento</dt>
    <dd>O formulário, em quatro etapas: local → dia e horário → dados do paciente →
      revisar e enviar. Só aparecem horários realmente livres.</dd>
    <dt>Sobre o médico</dt>
    <dd>Apresentação em texto, áreas de atuação e formação.</dd>
    <dt>Onde atendo</dt>
    <dd>Um cartão por local, com endereço, dias e duração da consulta.</dd>
    <dt>Dúvidas</dt>
    <dd>Perguntas e respostas, livres para editar.</dd>
  </dl>
  <p>Locais ligados agora:</p>
  ${listaLocais(hospitais)}
  <p class="nota">A ordem dessas seções é escolhida no painel, e qualquer uma pode ser
    escondida — menos o agendamento, que é a razão do site existir.</p>
`)}

${bloco('whatsapp', 'A conversa com a recepção', `
  <p>Toda a confirmação acontece por mensagem, sem ninguém precisar abrir sistema nenhum.
    A recepção responde na mesma conversa em que recebeu o pedido.</p>
  <p>O pedido vai <strong>para a recepção do local que o paciente escolheu</strong>. O
    médico atende em mais de um lugar, e quem atende o telefone costuma ser outra pessoa
    em cada um — o pedido do hospital A não pode cair na secretária do hospital B. Se a
    mesma pessoa cuida dos dois, basta repetir o número no cadastro dos dois locais.</p>
  <table class="tabela-manual">
    <thead><tr><th>O que responder</th><th>O que acontece</th></tr></thead>
    <tbody>
      <tr>
        <td><code>CONFIRMAR PA-0000-0000</code></td>
        <td>A consulta deixa de ser provisória na agenda do Google e o paciente
          recebe a confirmação no WhatsApp.</td>
      </tr>
      <tr>
        <td><code>REMARCAR PA-0000-0000</code></td>
        <td>O compromisso sai da agenda e o horário volta a aparecer no site.
          Use quando o horário não servir e o paciente for remarcar.</td>
      </tr>
    </tbody>
  </table>
  <p>O <strong>protocolo</strong> (<code>PA-0000-0000</code>) vem na mensagem. Pode estar em
    qualquer lugar do texto, e maiúscula ou minúscula não importa. Conversa normal não
    dispara nada: só as duas palavras acima, acompanhadas de um protocolo, viram comando.</p>
  <p class="nota">Comando vindo de um número que não está cadastrado em nenhum local é
    ignorado, para ninguém confirmar consulta por engano ou de propósito.</p>
`)}

${bloco('painel', 'O painel do médico', `
  <p>Fica em <code>/admin</code> e pede senha. É onde tudo se configura, sem mexer em
    código. São duas abas.</p>

  <h3>Aba <em>Agenda</em></h3>
  <dl class="glossario">
    <dt>Indicadores</dt>
    <dd>Quantas pessoas entraram e quantas agendaram. Detalhado
      <a href="#indicadores">mais abaixo</a>.</dd>
    <dt>Divulgação</dt>
    <dd>Os links marcados de cada canal, prontos para copiar. É o que permite ao painel
      dizer se o paciente veio do WhatsApp, de uma indicação ou de um anúncio.</dd>
    <dt>Locais de atendimento</dt>
    <dd>Adicionar, editar, desligar ou excluir um local. Cada local tem a sua agenda do
      Google, os dias e horários em que o médico atende ali, a duração da consulta,
      quantas consultas cabem no mesmo horário e <strong>o WhatsApp da recepção
      daquele lugar</strong>.
      <strong>Desligar</strong> tira o local do site na hora sem apagar nada;
      <strong>excluir</strong> remove de vez.</dd>
    <dt>Como ligar uma agenda nova</dt>
    <dd>O passo a passo para criar a agenda no Google e compartilhá-la com o sistema.
      Traz o endereço que precisa ser autorizado e um botão para copiá-lo. Antes de
      salvar, o botão <strong>Testar acesso</strong> diz se a permissão está correta —
      vale sempre usar, porque agenda compartilhada só para leitura deixa o sistema
      ver os horários mas não marcar consulta.</dd>
    <dt>WhatsApp</dt>
    <dd>Conectar o WhatsApp do consultório pelo QR, ver se está conectado, enviar uma
      mensagem de teste e desconectar. Mostra por qual número as mensagens saem — um só,
      o do consultório — e a recepção de cada local, que é para onde elas vão. Se aparecer aviso de mensagem não entregue, há um botão
      para reenviar.</dd>
    <dt>Médico e recepção</dt>
    <dd>Nome, especialidade, registro profissional e o nome de quem confirma. O número
      de WhatsApp <strong>não fica aqui</strong>: ele pertence a cada local, porque
      quem atende o telefone é outra pessoa em cada lugar.</dd>
  </dl>

  <h3>Aba <em>Site</em></h3>
  <dl class="glossario">
    <dt>Ordem e visibilidade das seções</dt>
    <dd>Subir, descer ou esconder cada seção da página do paciente.</dd>
    <dt>Textos e foto</dt>
    <dd>Todo texto do site: título, apresentação, frase de destaque, parágrafos do
      "sobre", áreas de atuação, formação, dúvidas e rodapé. A foto entra por upload
      ou por link.</dd>
  </dl>
  <p class="nota">As alterações do site só valem depois de <strong>Salvar conteúdo</strong>.
    Já os locais e o WhatsApp salvam cada um no seu próprio botão.</p>
`)}

${bloco('regras', 'As regras que definem os horários', `
  <p>O que aparece para o paciente não vem do Google: vem do que está configurado no
    painel, descontando o que já está ocupado. Estas são as regras:</p>
  <dl class="glossario">
    <dt>Dias e horários por local</dt>
    <dd>Cada local tem as suas faixas — por exemplo, segunda a quarta das 07:30 às 12:00
      e quinta das 14:00 às 17:00. Fora dessas faixas não existe horário para escolher.</dd>
    <dt>A consulta tem que caber inteira</dt>
    <dd>Numa faixa que termina às 12:00, com consulta de 40 minutos, o último horário
      oferecido é 11:20. Não se oferece meia consulta.</dd>
    <dt>Duas consultas no mesmo horário</dt>
    <dd>Se o local aceitar mais de uma consulta por horário, o horário só some do site
      quando encher. A recepção é avisada quando o pedido é o segundo daquele horário.</dd>
    <dt>O médico é um só</dt>
    <dd>Compromisso marcado num local bloqueia o mesmo horário no outro. Ninguém consegue
      agendar em dois hospitais ao mesmo tempo.</dd>
    <dt>Antecedência mínima</dt>
    <dd>Horários perto demais do momento atual não aparecem, para a recepção ter tempo
      de confirmar antes.</dd>
    <dt>Compromissos do próprio Google</dt>
    <dd>O que o médico marcar direto na agenda — cirurgia, reunião, um dia inteiro de
      férias — some do site automaticamente. Não precisa avisar o sistema.</dd>
  </dl>
`)}

${bloco('indicadores', 'Os indicadores', `
  <p>No topo do painel, com seletor de 7, 30 ou 90 dias. São quatro grupos.</p>

  <h3>Quem entrou</h3>
  <dl class="glossario">
    <dt>pessoas</dt>
    <dd>Visitantes distintos. Quem abriu o site três vezes no mesmo dia conta uma vez.</dd>
    <dt>visitas</dt>
    <dd>Páginas abertas, contando as repetições. Sempre maior que "pessoas".</dd>
    <dt>viram horários</dt>
    <dd>Quantas dessas pessoas chegaram a escolher um local e ver a agenda. É o sinal de
      interesse real — quem só leu a apresentação e saiu não entra aqui.</dd>
    <dt>agendaram</dt>
    <dd>Pedidos enviados. Conta no momento do pedido, mesmo que a recepção ainda não
      tenha confirmado.</dd>
    <dt>conversão</dt>
    <dd>De cada 100 pessoas que entraram, quantas agendaram. É calculado sobre
      "pessoas", não sobre "visitas".</dd>
  </dl>
  <p>O par que mais diz alguma coisa é <strong>pessoas → viram horários</strong>. Se
    muita gente entra e pouca abre a agenda, o problema está na página. Se muita gente
    abre a agenda e pouca agenda, o problema está no formulário ou na falta de horário bom.</p>

  <h3>Do pedido à confirmação</h3>
  <dl class="glossario">
    <dt>pediram · confirmados · remarcados</dt>
    <dd>O caminho completo de um pedido. "Confirmados" e "remarcados" contam as respostas
      da recepção no WhatsApp.</dd>
    <dt>sem resposta</dt>
    <dd>Pedidos que ainda não tiveram nem <code>CONFIRMAR</code> nem <code>REMARCAR</code>.
      É o único número do painel que pede ação — por isso fica destacado quando passa de
      zero.</dd>
    <dt>tempo médio e pior espera</dt>
    <dd>Quanto a recepção demora para confirmar, contado desde o instante do pedido.
      A pior espera aparece separada de propósito: uma demora de nove horas desaparece
      dentro de uma média boa, e é justamente ela que denuncia pedido esquecido.</dd>
  </dl>
  <p class="nota">Este grupo existe porque o site promete confirmação <em>no mesmo dia
    útil</em>. Sem medir, ninguém sabe se a promessa se cumpre.</p>

  <h3>O que os pacientes escolhem</h3>
  <p>Dias da semana, horários e tipos de consulta mais procurados. Vale reparar que é a
    <strong>consulta escolhida</strong>, não a hora em que a pessoa mexeu no site: "querem
    quinta de manhã" ajuda a montar o expediente, "pedem à noite" não ajuda em nada.</p>
  <p>Se um dia da agenda concentra a procura e outro fica vazio, aqui é onde isso
    aparece — e o expediente é a decisão mais cara de errar, porque envolve hospital,
    deslocamento e agenda pessoal.</p>

  <h3>De onde vieram</h3>
  <p>Google, Instagram, WhatsApp ou acesso direto. Tem um detalhe importante: o navegador
    <strong>não informa</strong> a procedência quando o link é aberto de dentro do
    WhatsApp ou do Instagram — os dois abrem o site num navegador interno. Sem ajuda,
    esses dois canais cairiam todos em "direto".</p>
  <p>Para separá-los, use um link diferente em cada lugar onde divulga. Os links
    prontos ficam no painel, em <strong>Divulgação</strong>, com botão de copiar —
    não precisa digitar nada:</p>
  <table class="tabela-manual">
    <thead><tr><th>Canal</th><th>Onde usar</th><th>Endereço</th></tr></thead>
    <tbody>
      <tr><td>WhatsApp</td><td>mensagens para pacientes</td>
        <td><code>${esc(url || '')}/?de=whatsapp</code></td></tr>
      <tr><td>Indicação</td><td>colegas que encaminham</td>
        <td><code>${esc(url || '')}/?de=indicacao</code></td></tr>
      <tr><td>Propaganda</td><td>anúncio pago, panfleto, outdoor</td>
        <td><code>${esc(url || '')}/?de=propaganda</code></td></tr>
      <tr><td>Instagram</td><td>link da bio</td>
        <td><code>${esc(url || '')}/?de=instagram</code></td></tr>
    </tbody>
  </table>
  <p>O paciente não nota diferença nenhuma — abre a mesma página. Se quiser separar
    mais de perto, invente o rótulo que precisar: <code>?de=congresso</code>,
    <code>?de=radio</code>. Ele aparece no painel com o nome que você escreveu.</p>
  <p class="nota">Só funciona se o link divulgado for o marcado. Um paciente que chegue
    pelo endereço sem rótulo entra como "Direto ou app" — então vale trocar os links já
    publicados, não só os novos.</p>

  <h3>Como ler o gráfico</h3>
  <p>Uma coluna por dia: a parte clara é quanta gente entrou, a escura é quantos
    agendaram. Passando o mouse aparece o número exato daquele dia.</p>
  <p>Colunas <strong>hachuradas</strong> são dias anteriores ao início da contagem.
    Não querem dizer que ninguém entrou — querem dizer que o sistema ainda não estava
    medindo. A data em que a medição começou aparece logo abaixo do gráfico.</p>
  <p class="nota">Robôs de busca e a prévia de link do WhatsApp não entram na conta —
    sem esse filtro o número maior seria o do robô, não o de gente.</p>
`)}

${bloco('duvidas', 'Quando algo não sai como esperado', `
  <dl class="glossario">
    <dt>Não aparece nenhum horário para o paciente</dt>
    <dd>Quase sempre é o expediente: confira, no painel, se o local tem faixas nos dias
      certos. Se tiver, veja se a agenda do Google não está tomada por compromissos.</dd>
    <dt>A recepção não recebeu a mensagem</dt>
    <dd>Veja o bloco WhatsApp no painel: ele lista a recepção de cada local, e avisa
      quando algum está sem número. Se a conexão estiver caída, é só ler o QR de novo.
      Quando um aviso falha, ele fica marcado e o painel oferece o reenvio — a consulta
      não se perde.</dd>
    <dt>Confirmei e a agenda não mudou</dt>
    <dd>Confira se o protocolo da resposta é o mesmo da mensagem, e se a resposta saiu do
      número cadastrado como o da recepção.</dd>
    <dt>O paciente marcou e não pode mais vir</dt>
    <dd>Responda <code>REMARCAR</code> com o protocolo: o horário volta para o site.</dd>
    <dt>Quero fechar um dia inteiro</dt>
    <dd>Crie um evento de dia inteiro na agenda do Google daquele local. O dia some do
      site sozinho.</dd>
    <dt>Apaguei consultas da agenda e os indicadores não mudaram</dt>
    <dd>É assim mesmo. A agenda do Google guarda o <strong>estado atual</strong> — o que
      está marcado agora. Os indicadores guardam o <strong>histórico</strong> — quantos
      pedidos chegaram naquele dia. Apagar o compromisso depois não faz o pedido não ter
      acontecido, e se o número caísse junto você nunca saberia que aquele dia foi
      movimentado.</dd>
    <dt>Os indicadores mostram zero num período em que houve movimento</dt>
    <dd>Confira a data logo abaixo do gráfico: ela diz quando a contagem começou. Antes
      dessa data nada foi medido, e as colunas aparecem hachuradas justamente para não
      afirmar que ninguém entrou.</dd>
  </dl>
`)}

${bloco('privacidade', 'Privacidade', `
  <p>As consultas ficam nas agendas do Google do próprio médico — o sistema escreve
    nelas, não guarda uma cópia. O que o servidor mantém é a configuração do consultório
    e a contagem de acessos.</p>
  <p>O site não usa cookie de rastreamento nem envia dados para serviços de terceiros,
    e por isso não precisa de banner de consentimento. Os indicadores são contados aqui
    mesmo: guardam um número por dia, nunca uma linha por pessoa, e não gravam endereço
    de IP.</p>
  <p>Os dados que o paciente digita servem só para marcar e confirmar a consulta,
    conforme a LGPD (Lei 13.709/2018).</p>
`)}

</main>

<footer class="rodape">
  <div class="wrap">
    <p class="small muted">Manual do sistema de agendamento — ${esc(nome)}.
      <a href="/">Voltar ao site</a> · <a href="/admin">Abrir o painel</a></p>
  </div>
</footer>

</body>
</html>`;
}

module.exports = { paginaManual, SUMARIO };

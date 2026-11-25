/**
 * metricas.js — quantas pessoas entraram, quantas agendaram.
 *
 * Contagem própria em vez de Google Analytics, por três motivos:
 *
 *  1. É um site de oncologia. Quem visita muitas vezes acabou de receber um
 *     diagnóstico. Mandar esse tráfego para um terceiro que cruza com o resto
 *     do perfil da pessoa é o tipo de coisa que a LGPD trata como dado
 *     sensível — e que ninguém precisa fazer para saber quantas visitas teve.
 *  2. Sem cookie, sem banner de consentimento.
 *  3. O servidor já vê toda requisição. O que falta é só contar.
 *
 * O que fica gravado é um número por dia, nunca uma linha por pessoa. Para
 * separar "visitas" de "visitantes" é preciso reconhecer quem repete, e para
 * isso guarda-se um hash curto de IP + navegador — com um sal que muda todo
 * dia, e nunca o IP em si. Na virada do dia o sal antigo é sobrescrito e os
 * hashes de ontem viram números sem volta: dá para contar, não dá para
 * seguir alguém.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const t = require('./tempo');

const RAIZ = path.join(__dirname, '..');
const ARQUIVO = process.env.METRICAS_ARQUIVO || path.join(RAIZ, 'dados', 'metricas.json');

/** Quantos dias de histórico manter. Um ano é mais que suficiente. */
const DIAS_GUARDADOS = 400;

/** Teto de visitantes distintos por dia, para o arquivo não crescer sem limite. */
const TETO_DIGITAIS = 5000;

/**
 * Robô não é gente. Sem este filtro o número mais alto do painel seria a
 * prévia de link do WhatsApp: cada vez que alguém manda o endereço numa
 * conversa, o servidor da Meta abre a página para montar o cartãozinho.
 */
const ROBOS = /bot|crawl|spider|slurp|bingpreview|facebookexternal|whatsapp|telegram|preview|monitor|curl|wget|headless|python-requests|lighthouse/i;

const vazio = () => ({
  visitas: 0,          // páginas abertas
  unicos: 0,           // pessoas distintas
  interessados: 0,     // pessoas que chegaram a pedir horários
  agendamentos: 0,     // pré-agendamentos criados
  confirmados: 0,      // a recepção respondeu CONFIRMAR
  remarcados: 0,       // a recepção respondeu REMARCAR
  esperaSoma: 0,       // minutos entre o pedido e a confirmação, somados
  esperaCont: 0,       // quantas confirmações entraram na soma
  esperaMax: 0,        // a pior espera do dia
  porLocal: {},        // agendamentos por hospital
  porDiaSemana: {},    // que dia da semana o paciente escolheu
  porHora: {},         // que hora do dia ele escolheu
  porTipo: {},         // primeira consulta, retorno, segunda opinião
  origens: {},         // de onde a visita veio
  digitais: [],        // hashes do dia (só para contar sem repetir)
  viramGrade: [],      // hashes de quem pediu horários
});

/**
 * De onde veio a visita.
 *
 * Duas fontes, porque uma só não basta. O `?de=` é um rótulo que o médico
 * cola no próprio link ("...duckdns.org/?de=instagram") e é o único jeito
 * confiável de reconhecer WhatsApp e Instagram: os dois abrem o site num
 * navegador interno que não informa a procedência. O cabeçalho do navegador
 * cobre o resto, principalmente a busca do Google.
 */
const SITES = [
  [/(^|\.)google\./, 'Google'],
  [/(^|\.)bing\./, 'Bing'],
  [/duckduckgo/, 'DuckDuckGo'],
  [/instagram/, 'Instagram'],
  [/facebook|(^|\.)fb\./, 'Facebook'],
  [/whatsapp|wa\.me/, 'WhatsApp'],
  [/linkedin|lnkd\.in/, 'LinkedIn'],
  [/t\.co$|twitter|(^|\.)x\.com$/, 'X'],
  [/youtube|youtu\.be/, 'YouTube'],
  [/doctoralia|boaconsulta/, 'Diretórios médicos'],
];

/**
 * Os canais que o consultório divulga, com o nome que aparece no painel.
 *
 * O rótulo do link é escrito sem acento e em minúscula, porque vai na barra
 * de endereço; a tela mostra o nome de gente. Rótulo fora desta lista
 * continua valendo — entra no painel como foi escrito.
 */
const CANAIS = {
  whatsapp: 'WhatsApp',
  indicacao: 'Indicação',
  propaganda: 'Propaganda',
  instagram: 'Instagram',
  cartao: 'Cartão de visita',
};

function origemDe(req) {
  const rotulo = String((req.query && req.query.de) || '').trim().slice(0, 24);
  if (rotulo) {
    const chave = rotulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return CANAIS[chave] || rotulo.replace(/[^\p{L}\p{N} .-]/gu, '') || 'Marcado';
  }

  const bruto = req.headers.referer || req.headers.referrer || '';
  if (!bruto) return 'Direto ou app';
  let host;
  try {
    host = new URL(bruto).hostname.toLowerCase();
  } catch {
    return 'Direto ou app';
  }
  // navegação dentro do próprio site não é origem
  const meu = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (host === meu) return null;
  for (const [padrao, nome] of SITES) if (padrao.test(host)) return nome;
  return host.replace(/^www\./, '').slice(0, 32);
}

const somar1 = (mapa, chave) => { mapa[chave] = (mapa[chave] || 0) + 1; };

let cache = null;

/** As chaves que são dias; `desde` e afins ficam de fora. */
const ehDia = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);
const diasNoArquivo = (dados) => Object.keys(dados).filter(ehDia).sort();

function ler() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    if (!cache || typeof cache !== 'object') cache = {};
  } catch {
    cache = {};                       // primeira execução, ou arquivo corrompido
  }
  // arquivo gravado antes de existir o marco: o dia mais antigo que ele tem
  // é, por definição, o primeiro dia que chegou a ser medido
  if (!cache.desde) {
    const primeiro = diasNoArquivo(cache)[0];
    if (primeiro) cache.desde = primeiro;
  }
  return cache;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    const temporario = `${ARQUIVO}.${process.pid}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(cache), 'utf8');
    fs.renameSync(temporario, ARQUIVO);        // troca atômica
  } catch (e) {
    // medição nunca pode derrubar o agendamento: falhou, perde-se a contagem
    console.error('[metricas] não consegui gravar:', e.message);
  }
}

/**
 * Grava no máximo uma vez por segundo.
 *
 * Contar acontece a cada visita; escrever a cada visita seria bater no disco
 * à toa. O `unref` evita que este timer segure o processo no ar.
 */
let pendente = null;
function agendarGravacao() {
  if (pendente) return;
  pendente = setTimeout(() => { pendente = null; gravar(); }, 1000);
  if (pendente.unref) pendente.unref();
}

function diaDe(agora) {
  return t.hoje(agora);                        // AAAA-MM-DD no fuso de Brasília
}

function doDia(dia) {
  const dados = ler();
  // o primeiro dia medido fica registrado: sem isso não há como distinguir
  // "ninguém entrou" de "ainda não estávamos contando"
  if (!dados.desde) dados.desde = dia;
  if (!dados[dia]) {
    dados[dia] = vazio();
    podar(dados);
  }
  // Dia gravado por uma versão anterior não tem os campos novos. Sem
  // completar, o primeiro acesso do dia estoura ao somar num mapa que não
  // existe — e como quem chama é a página do paciente, o site sai do ar.
  // Preenche no próprio objeto: cópia não voltaria para o arquivo.
  const d = dados[dia];
  const base = vazio();
  for (const campo of Object.keys(base)) {
    if (d[campo] === undefined) d[campo] = base[campo];
  }
  return d;
}

function podar(dados) {
  const dias = diasNoArquivo(dados);
  while (dias.length > DIAS_GUARDADOS) delete dados[dias.shift()];
}

/**
 * Identificador de um visitante, válido só hoje.
 *
 * O sal é sorteado uma vez por dia e fica gravado junto com os números. Já
 * viveu só na memória, e isso quebrava a conta: cada reinício do servidor
 * sorteava um sal novo, a mesma pessoa passava a gerar outro hash e entrava
 * como visitante novo. Num dia de implantação, com vinte e um reinícios, três
 * pessoas viraram vinte e nove.
 *
 * Só existe um sal por vez, e o do dia anterior é sobrescrito na virada. É o
 * que mantém a propriedade que importa: passado o dia, os hashes não têm mais
 * como ser ligados a ninguém — não sobra o segredo que os gerou.
 */
function salDe(dia) {
  const dados = ler();
  if (!dados.sal || dados.sal.dia !== dia) {
    dados.sal = { dia, valor: crypto.randomBytes(16).toString('hex') };
    agendarGravacao();
  }
  return dados.sal.valor;
}

function digital(req, dia) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || '';
  const navegador = req.headers['user-agent'] || '';
  return crypto.createHash('sha256')
    .update(`${salDe(dia)}|${ip}|${navegador}`)
    .digest('hex')
    .slice(0, 12);
}

const ehRobo = (req) => ROBOS.test(req.headers['user-agent'] || '');

/** Marca a digital numa lista, respeitando o teto. Diz se era nova. */
function anotarDigital(lista, marca) {
  if (lista.includes(marca)) return false;
  if (lista.length >= TETO_DIGITAIS) return true;    // conta, mas não guarda mais
  lista.push(marca);
  return true;
}

function registrarVisita(req, agora = new Date()) {
  if (ehRobo(req)) return;
  const dia = diaDe(agora);
  const d = doDia(dia);
  d.visitas += 1;
  // a origem conta uma vez por pessoa: senão quem recarrega a página dez vezes
  // faz parecer que aquele canal traz dez vezes mais gente
  if (anotarDigital(d.digitais, digital(req, dia))) {
    d.unicos += 1;
    const origem = origemDe(req);
    if (origem) somar1(d.origens, origem);
  }
  agendarGravacao();
}

/** Pediu a grade de horários: passou de quem só olhou para quem cogitou. */
function registrarInteresse(req, agora = new Date()) {
  if (ehRobo(req)) return;
  const dia = diaDe(agora);
  const d = doDia(dia);
  if (anotarDigital(d.viramGrade, digital(req, dia))) d.interessados += 1;
  agendarGravacao();
}

/**
 * Um pedido enviado.
 *
 * `escolha` descreve o que o paciente marcou — o dia da semana, a hora e o
 * tipo —, não quando ele pediu. É a diferença entre "as pessoas pedem à
 * noite" e "as pessoas querem ser atendidas na quinta de manhã"; só a
 * segunda ajuda a montar o expediente.
 */
function registrarAgendamento(hospitalId, escolha = {}, agora = new Date()) {
  const d = doDia(diaDe(agora));
  d.agendamentos += 1;
  somar1(d.porLocal, String(hospitalId || 'desconhecido'));
  if (escolha.data) somar1(d.porDiaSemana, t.diaDaSemana(escolha.data));
  if (escolha.hora) somar1(d.porHora, String(escolha.hora).slice(0, 2));
  if (escolha.tipo) somar1(d.porTipo, String(escolha.tipo).slice(0, 40));
  agendarGravacao();
}

/**
 * A recepção confirmou. `minutos` é quanto o paciente esperou desde o pedido.
 *
 * Guarda soma e contagem em vez da lista de esperas: a média sai da divisão e
 * o arquivo não cresce com o movimento. O máximo vai à parte porque é ele que
 * denuncia o pedido esquecido — uma espera de 9 horas some numa média boa.
 */
function registrarConfirmacao(minutos, agora = new Date()) {
  const d = doDia(diaDe(agora));
  d.confirmados += 1;
  // `Number(null)` é 0: sem esta guarda, uma confirmação sem carimbo de hora
  // entraria na média como espera de zero minuto e faria o indicador parecer
  // melhor do que é — justamente o erro que um painel não pode cometer.
  const m = minutos === null || minutos === undefined || minutos === '' ? NaN : Number(minutos);
  if (Number.isFinite(m) && m >= 0) {
    d.esperaSoma += m;
    d.esperaCont += 1;
    if (m > d.esperaMax) d.esperaMax = m;
  }
  agendarGravacao();
}

function registrarLiberacao(agora = new Date()) {
  doDia(diaDe(agora)).remarcados += 1;
  agendarGravacao();
}

/**
 * Os últimos `dias` dias, do mais antigo para o mais novo, sem buracos:
 * dia sem movimento entra zerado, senão o gráfico mente sobre a frequência.
 */
function resumo(dias = 30, agora = new Date()) {
  const dados = ler();
  const hoje = diaDe(agora);
  const linhas = [];
  for (let i = dias - 1; i >= 0; i -= 1) {
    const dia = t.somarDias(hoje, -i);
    const d = dados[dia] || vazio();
    linhas.push({
      dia,
      visitas: d.visitas,
      unicos: d.unicos,
      interessados: d.interessados,
      agendamentos: d.agendamentos,
      confirmados: d.confirmados || 0,
      remarcados: d.remarcados || 0,
      esperaSoma: d.esperaSoma || 0,
      esperaCont: d.esperaCont || 0,
      esperaMax: d.esperaMax || 0,
      porLocal: { ...d.porLocal },
      porDiaSemana: { ...d.porDiaSemana },
      porHora: { ...d.porHora },
      porTipo: { ...d.porTipo },
      origens: { ...d.origens },
      // dia anterior ao início da medição: zero aqui não quer dizer
      // "ninguém entrou", quer dizer "não estávamos contando"
      medido: Boolean(dados.desde) && dia >= dados.desde,
    });
  }
  return {
    dias: linhas,
    desde: dados.desde || null,
    total: somar(linhas),
    hoje: somar(linhas.slice(-1)),
    escolhas: {
      diaSemana: juntar(linhas, 'porDiaSemana'),
      hora: juntar(linhas, 'porHora'),
      tipo: juntar(linhas, 'porTipo'),
    },
    origens: juntar(linhas, 'origens'),
  };
}

/** Soma os mapas de todos os dias num só, do maior para o menor. */
function juntar(linhas, campo) {
  const total = {};
  for (const l of linhas) {
    for (const [chave, n] of Object.entries(l[campo] || {})) {
      total[chave] = (total[chave] || 0) + n;
    }
  }
  return Object.entries(total)
    .sort((a, b) => b[1] - a[1])
    .map(([chave, n]) => ({ chave, n }));
}

function somar(linhas) {
  const total = linhas.reduce((acc, l) => ({
    visitas: acc.visitas + l.visitas,
    unicos: acc.unicos + l.unicos,
    interessados: acc.interessados + l.interessados,
    agendamentos: acc.agendamentos + l.agendamentos,
    confirmados: acc.confirmados + (l.confirmados || 0),
    remarcados: acc.remarcados + (l.remarcados || 0),
    esperaSoma: acc.esperaSoma + (l.esperaSoma || 0),
    esperaCont: acc.esperaCont + (l.esperaCont || 0),
    esperaMax: Math.max(acc.esperaMax, l.esperaMax || 0),
  }), {
    visitas: 0, unicos: 0, interessados: 0, agendamentos: 0,
    confirmados: 0, remarcados: 0, esperaSoma: 0, esperaCont: 0, esperaMax: 0,
  });

  // "de cada 100 pessoas que entraram, quantas agendaram" — sobre visitantes,
  // não sobre visitas: quem abre a página três vezes é uma pessoa só.
  total.conversao = total.unicos ? Math.round((total.agendamentos / total.unicos) * 1000) / 10 : 0;
  total.esperaMedia = total.esperaCont ? Math.round(total.esperaSoma / total.esperaCont) : null;

  // O que pediu e ainda não teve resposta da recepção. Só faz sentido não ser
  // negativo: confirmação de pedido de ontem cai no dia de hoje, então num
  // recorte curto os confirmados podem passar os pedidos.
  total.parados = Math.max(0, total.agendamentos - total.confirmados - total.remarcados);
  return total;
}

/**
 * Grava o que ainda não foi para o disco antes do processo morrer.
 *
 * A gravação é adiada em 1 segundo para não bater no disco a cada visita, e o
 * timer é `unref` — ou seja, não segura o processo no ar. Sem isto, todo
 * `pm2 restart` (e são vários, a cada atualização) descartaria as contagens
 * do último segundo.
 */
function descarregar() {
  if (!pendente) return;
  clearTimeout(pendente);
  pendente = null;
  gravar();
}
for (const sinal of ['SIGINT', 'SIGTERM', 'beforeExit']) process.on(sinal, descarregar);

/**
 * Zera a contagem, guardando uma cópia antes.
 *
 * Existe porque nos primeiros dias os números ficam contaminados por teste e
 * por defeito recém-corrigido, e recomeçar limpo é mais honesto do que ler um
 * histórico que ninguém confia. A cópia fica ao lado do arquivo: apagar por
 * engano o trabalho de meses não pode custar um clique.
 */
function zerar(agora = new Date()) {
  const anterior = ler();
  let copia = null;
  if (diasNoArquivo(anterior).length) {
    try {
      copia = `${ARQUIVO}.${agora.toISOString().slice(0, 19).replace(/[:T-]/g, '')}.bak`;
      fs.writeFileSync(copia, JSON.stringify(anterior), 'utf8');
      podarCopias();
    } catch (e) {
      console.error('[metricas] não consegui guardar a cópia:', e.message);
      copia = null;
    }
  }

  cache = {};
  if (pendente) { clearTimeout(pendente); pendente = null; }
  gravar();
  return { copia };
}

/** Mantém só as cinco cópias mais recentes; o resto é entulho. */
function podarCopias() {
  const pasta = path.dirname(ARQUIVO);
  const base = `${path.basename(ARQUIVO)}.`;
  const copias = fs.readdirSync(pasta)
    .filter((f) => f.startsWith(base) && f.endsWith('.bak'))
    .sort();
  while (copias.length > 5) {
    try { fs.unlinkSync(path.join(pasta, copias.shift())); } catch { /* já foi */ }
  }
}

/** Só para teste: esquece o que está em memória. */
function _limpar() {
  cache = null;
  if (pendente) { clearTimeout(pendente); pendente = null; }
}

module.exports = {
  ARQUIVO, CANAIS, registrarVisita, registrarInteresse, registrarAgendamento,
  registrarConfirmacao, registrarLiberacao, resumo,
  zerar, descarregar, _limpar, _gravarAgora: gravar,
};

/**
 * demo-dados.js — gera os DADOS FICTÍCIOS do painel de demonstração (PAINEL_DEMO=1).
 *
 * Escreve em Experimental/data e na pasta da SoFIA (SOFIA_DIR) arquivos no mesmo
 * formato que o robô, a SoFIA e o EVO produzem — com nomes e números inventados.
 * Tudo é calculado a partir de HOJE e é DETERMINÍSTICO por dia (a mesma semente
 * no mesmo dia): rodar de novo no mesmo dia não muda o conteúdo, só revela o que
 * já "aconteceu" até agora (nada com horário futuro aparece). Por isso o cron
 * roda a cada 15 min e a demonstração parece viva o dia todo.
 *
 * Uso:  node src/demo-dados.js        (só roda com PAINEL_DEMO=1 no .env, por segurança)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), override: true }); // o .env da demonstração vence o ambiente do terminal
const fs = require('fs');
const path = require('path');

if (!/^(1|true|sim|yes)$/i.test(String(process.env.PAINEL_DEMO || ''))) {
  console.error('demo-dados: só roda numa instalação de DEMONSTRAÇÃO (PAINEL_DEMO=1 no .env). Nada foi alterado.');
  process.exit(1);
}
const DATA = path.resolve(__dirname, '..', 'data');
// A pasta da SoFIA TEM de ficar dentro desta instalação de demonstração — nunca a
// SoFIA de uma unidade real (ex.: /root/sofia-data), mesmo que o terminal exporte SOFIA_DIR.
const RAIZ_DEMO = path.resolve(__dirname, '..', '..');
const SOFIA = path.resolve(process.env.SOFIA_DIR || path.join(RAIZ_DEMO, 'sofia-demo'));
if (!SOFIA.startsWith(RAIZ_DEMO + path.sep) || SOFIA === path.join(RAIZ_DEMO, 'ChatBot')) {
  console.error(`demo-dados: a pasta da SoFIA (${SOFIA}) está FORA da demonstração (${RAIZ_DEMO}). Nada foi alterado.\nAjuste SOFIA_DIR no .env da demonstração para ${path.join(RAIZ_DEMO, 'sofia-demo')}.`);
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(SOFIA, { recursive: true });

// ── relógio e sorte determinística ───────────────────────────────────────────
const TZ = 'America/Sao_Paulo';
const AGORA = Date.now();
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const dia = (n) => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Instante (ms) de "YYYY-MM-DD HH:MM" no horário de Brasília (UTC-3, sem horário de verão).
const em = (d, hhmm) => Date.parse(`${d}T${hhmm}:00-03:00`);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const diaDe = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
const wd = (d) => new Date(d + 'T12:00:00Z').getUTCDay(); // 0=dom
let semente = [...hoje].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const rnd = () => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const passou = (ms) => ms <= AGORA;
const pad = (n, k = 2) => String(n).padStart(k, '0');
const cap = (t) => String(t || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const corta = (t, n) => Array.from(String(t || '')).slice(0, n).join(''); // não parte emoji ao meio
const gravar = (arq, conteudo) => { const tmp = arq + '.tmp'; fs.writeFileSync(tmp, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo)); fs.renameSync(tmp, arq); };

// ── gente inventada ──────────────────────────────────────────────────────────
const NOMES = ['Ana Beatriz', 'Bruna', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Karina', 'Larissa', 'Mariana', 'Natália', 'Olívia', 'Patrícia', 'Rafaela', 'Sabrina', 'Tatiana', 'Vanessa', 'Aline', 'Bianca', 'Carolina', 'Débora', 'Elisa', 'Flávia', 'Giovana', 'Jéssica', 'Letícia', 'Michele', 'Nicole', 'Paula', 'Renata', 'Simone', 'Thaís', 'Vitória', 'Amanda', 'Beatriz', 'Cristina', 'Denise', 'Érica', 'Fabiana', 'Gisele', 'Lorena', 'Marcela', 'Priscila', 'Raquel', 'Sílvia', 'Talita', 'Yasmin', 'Adriana', 'Clara', 'Luana', 'Mirela', 'Roberta', 'Sofia', 'Valéria', 'Lívia', 'Manuela', 'Cecília'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gouveia', 'Holanda', 'Lacerda', 'Machado', 'Nogueira', 'Oliveira', 'Pacheco', 'Queiroz', 'Rezende', 'Sampaio', 'Teixeira', 'Vasconcelos', 'Xavier', 'Zanetti', 'Moreira', 'Campos', 'Rocha', 'Prado'];
const PROFS = ['Ana', 'Bia', 'Carol', 'Duda'];
const HORAS = ['05:45', '07:00', '08:15', '09:30', '14:00', '16:15', '17:30', '18:45', '20:00'];
const PLANOS = ['SLIM 2X MENSAL', 'SLIM 3X MENSAL', 'SLIM 3X TRIMESTRAL', 'SLIM 4X SEMESTRAL', 'SLIM FREE 3X QUADRIMESTRAL', 'SLIM 5X ANUAL'];
const pessoas = NOMES.map((n, i) => ({
  i, nome: `${n} ${SOBRENOMES[i % SOBRENOMES.length]}`.toUpperCase(), primeiro: n.split(' ')[0],
  tel: '556290000' + pad(i, 4), id: String(3100 + i * 13),
}));
const ALUNAS = pessoas.slice(0, 34), EX = pessoas.slice(34, 42), LEADS = pessoas.slice(42);
const T = { contato: 'FX - 1. Contato inicial', agendou: 'FX - 3. Agendou Aula Exp', fez: 'FX - 5. Fez Aula Experimental', faltou: 'FX - 2. Encerrado com Agendamento sem Presença', encerrado: 'FX - 2. Encerrado sem agendamento', semInteresse: 'FX - 0. Sem interesse', aluna: '0. Aluna', ex: '0. Ex Aluna', preco: '0. Preço', anuncio: '0. Patrocinado' };

const conversas = {}, tagLog = [], encerradas = {}, custo = [], agendaramCanal = {};
const tagsLead = {}, contatosReais = {};

// ── aulas experimentais (histórico lido do "EVO") ────────────────────────────
const aulas = {};
let nAula = 0;
// Experimentais "avulsas" (pessoas sem conversa na SoFIA: vieram pelo formulário, telefone, recepção…)
const AVULSAS = Array.from({ length: 70 }, (_, j) => ({ nome: `${NOMES[(j * 11 + 5) % NOMES.length]} ${SOBRENOMES[(j * 7 + 3) % SOBRENOMES.length]} ${SOBRENOMES[(j * 5 + 9) % SOBRENOMES.length]}`.toUpperCase(), id: String(8000 + j * 3) }));
for (let n = -30; n <= 6; n++) {
  const d = dia(n); if (wd(d) === 0) continue;
  const qtd = wd(d) === 6 ? entre(0, 2) : entre(1, 4);
  for (let j = 0; j < qtd; j++) {
    const p = AVULSAS[nAula % AVULSAS.length]; nAula++;
    const hora = pick(HORAS), prof = PROFS[(nAula + HORAS.indexOf(hora)) % PROFS.length];
    const aconteceu = em(d, hora) + 3600e3 < AGORA;
    let status = 'Agendado', contrato = '';
    if (aconteceu) {
      const r = rnd();
      status = r < 0.78 ? 'Presença' : 'Falta';
      if (status === 'Presença' && rnd() < 0.42) contrato = pick(PLANOS);
    }
    aulas[`${d}|${hora}|${p.id}`] = { dia: d, hora, prof, nome: p.nome, id: p.id, status, contrato, visto: AGORA };
  }
}
// Funil: quem agendou fez a aula? fechou? faltou? (tags atuais + a aula no histórico)
const resultadoAula = (p, quando, canal, d0) => {
  const dAula = dia(d0 + entre(1, 3)), hora = pick(HORAS), prof = pick(PROFS);
  const aconteceu = em(dAula, hora) + 3600e3 < AGORA;
  let status = 'Agendado', contrato = '', tags = [T.agendou];
  if (aconteceu) {
    const r = rnd();
    if (r < 0.17) { status = 'Falta'; tags = [T.faltou]; }
    else if (r < 0.52) { status = 'Presença'; contrato = pick(PLANOS); tags = [T.aluna]; }
    else { status = 'Presença'; tags = [T.fez]; }
  }
  aulas[`${dAula}|${hora}|${p.id}`] = { dia: dAula, hora, prof, nome: p.nome, id: p.id, status, contrato, visto: AGORA };
  tagLog.push({ chave: p.tel, tag: T.agendou, motivo: 'agendou', por: '', acao: 'add', em: quando, canal });
  return tags;
};
// ── conversas da SoFIA (histórias completas: demo-conversas.js) ─────────────
const { HISTORIAS, ELENCO_LEADS, ELENCO_ALUNAS } = require('./demo-conversas');
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const ddmm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
const semDomingo = (off) => { while ([0, 6].includes(wd(dia(off)))) off++; return off; }; // aula experimental: seg a sex
const titulo = (t) => String(t).toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const semAcento = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const FUNIL = { contato: T.contato, agendou: T.agendou, fez: T.fez, faltou: T.faltou, semInteresse: T.semInteresse, aluna: T.aluna };
function viverHistoria(p, chave, d0, inicio, extra = {}) {
  const h = HISTORIAS[chave];
  const horas = h.horas || HORAS.filter(x => x !== '05:45');
  const hora = pick(horas);
  const alts = (h.horasAlt || HORAS.filter(x => x !== '05:45')).filter(x => x !== hora);
  const horaAlt = pick(alts.length ? alts : HORAS);
  const prof = pick(PROFS);
  const offA = semDomingo(d0 + (h.offA || 2)), offB = semDomingo(offA + (h.offB || 2));
  const sobrenome = titulo(p.nome.split(' ').slice(1).join(' ') || 'Silva');
  const ctx = {
    primeiro: p.primeiro, nomeCompleto: titulo(p.nome), sobrenome, sobrenomeMin: semAcento(sobrenome.split(' ')[0].toLowerCase()),
    email: semAcento(p.primeiro.toLowerCase()) + '.' + semAcento(sobrenome.split(' ')[0].toLowerCase()) + '@exemplo.com',
    hora, horaAlt, prof, plano: extra.plano || '',
    quando: offA - d0 === 1 ? 'amanhã' : SEMANA[wd(dia(offA))], Quando: offA - d0 === 1 ? 'Amanhã' : titulo(SEMANA[wd(dia(offA))]),
    diaAula: SEMANA[wd(dia(offA))], dataAula: ddmm(dia(offA)), diaAula2: SEMANA[wd(dia(offB))], dataAula2: ddmm(dia(offB)),
  };
  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? ctx[k] : m));
  const diaDoPasso = (x) => (typeof x === 'number' ? d0 + x : (x[0] === 'A' ? offA : offB) + (Number(x.slice(1)) || 0));
  const horaDoPasso = (dd, s) => { const m = /^(\{hora\}|\d\d:\d\d)([+-]\d+)?$/.exec(s); return em(dia(dd), m[1] === '{hora}' ? hora : m[1]) + (Number(m[2]) || 0) * 60000; };
  const aulaDe = (slot) => { const d = dia(slot === 'B' ? offB : offA); return aulas[`${d}|${hora}|${p.id}`] || (aulas[`${d}|${hora}|${p.id}`] = { dia: d, hora, prof, nome: p.nome, id: p.id, status: 'Agendado', contrato: '', visto: AGORA }); };
  const msgs = [];
  let funil = extra.funil || '', extras = [], t = 0, primeiroAt = true;
  for (const passo of h.passos) {
    const [op] = passo;
    if (op === '@') {
      let hm = passo[2];
      if (primeiroAt && inicio) hm = inicio;
      primeiroAt = false;
      t = Math.max(t, horaDoPasso(diaDoPasso(passo[1]), hm));
      continue;
    }
    if (!passou(t)) break;
    if (op === 'tag') {
      const [, k, motivo, canal] = passo;
      const tag = k === 'anuncio' ? T.anuncio : FUNIL[k];
      if (k === 'anuncio') extras.push(tag); else funil = tag;
      tagLog.push({ chave: p.tel, tag, motivo, por: '', acao: 'add', em: t + 15000, ...(canal ? { canal } : {}) });
      if (k === 'agendou') agendaramCanal[p.tel.slice(-8)] = canal || 'sofia';
      continue;
    }
    if (op === 'agenda') { aulaDe(passo[1]); continue; }
    if (op === 'aula') { aulaDe(passo[2]).status = passo[1]; continue; }
    if (op === 'contrato') { aulaDe('A').contrato = passo[1]; continue; }
    if (op === 'encerra') { encerradas[p.tel] = { em: t + 60000, por: 'SoFIA' }; continue; }
    const [autor, texto, mins, opc = {}] = passo;
    const tm = t + (mins || 0) * 60000 + entre(5, 50) * 1000;
    if (!passou(tm)) break;
    t = tm;
    const m = { autor, texto: fill(texto), em: t };
    if (opc.tipo) m.tipo = opc.tipo;
    if (opc.foto === 'grade') m.foto = 'grade-demo.png'; // imagem da grade (como a SoFIA envia)
    if (opc.por) m.por = opc.por;
    msgs.push(m);
    if (autor === 'sofia' && !opc.tipo) custo.push({ em: new Date(t).toISOString(), tipo: 'conversa', model: 'claude-sonnet', tel: p.tel, inTok: entre(9000, 16000), outTok: entre(80, 260), usd: +(0.03 + rnd() * 0.035).toFixed(4) });
  }
  if (!msgs.length) return null;
  conversas[p.tel] = { jid: p.tel + '@c.us', nome: p.primeiro, ultimaEm: msgs[msgs.length - 1].em, msgs };
  return [funil, ...extras].filter(Boolean);
}
// Conversas REAIS anonimizadas (demo-exportar-reais.js, rodado na unidade): quando
// existem, a demonstração mostra SÓ elas. Sem o arquivo, ficam as conversas de exemplo.
const REAIS = (() => { try { return JSON.parse(fs.readFileSync(path.join(SOFIA, 'demo-conversas-reais.json'), 'utf8')).conversas || []; } catch (_) { return []; } })();
const SEMANA_MS = 7 * 86400e3;
// Datas escritas no texto ("quinta (12/11)") andam junto com a conversa.
const moverDatas = (txt, emOrig, desloc) => String(txt || '').replace(/\b(\d{1,2})\/(\d{1,2})(\/(\d{2}|\d{4}))?\b/g, (m, dd, mm, _y, yy) => {
  const d = +dd, mo = +mm; if (d < 1 || d > 31 || mo < 1 || mo > 12) return m;
  const anoRef = new Date(emOrig).getUTCFullYear();
  const ano = yy ? (yy.length === 2 ? 2000 + +yy : +yy) : anoRef;
  const t = Date.UTC(ano, mo - 1, d, 15);
  if (Math.abs(t - emOrig) > 60 * 86400e3) return m; // não parece data da conversa
  const n = new Date(t + desloc);
  return pad(n.getUTCDate()) + '/' + pad(n.getUTCMonth() + 1) + (yy ? '/' + (yy.length === 2 ? String(n.getUTCFullYear()).slice(2) : n.getUTCFullYear()) : '');
});
if (REAIS.length) {
  REAIS.forEach((c, k) => {
    const msgsOrig = (c.msgs || []).filter(m => m && m.em);
    if (!msgsOrig.length) return;
    const tel = '556290000' + pad(2000 + k, 4);
    // desloca em SEMANAS inteiras (mantém dia da semana e horário) para terminar nos últimos 7 dias
    const ultimo = Math.max(...msgsOrig.map(m => m.em));
    const desloc = Math.max(0, Math.floor((AGORA - ultimo) / SEMANA_MS)) * SEMANA_MS;
    const msgs = msgsOrig.map(m => {
      const o = Object.assign({}, m, { em: m.em + desloc, texto: moverDatas(m.texto, m.em, desloc) });
      if (o.citacao) o.citacao = moverDatas(o.citacao, m.em, desloc);
      if (o.foto && o.foto !== 'grade-demo.png') delete o.foto;
      return o;
    }).filter(m => passou(m.em));
    if (!msgs.length) return;
    conversas[tel] = { jid: tel + '@c.us', nome: c.nome, ultimaEm: msgs[msgs.length - 1].em, msgs };
    for (const m of msgs) if (m.autor === 'sofia' && !m.tipo) custo.push({ em: new Date(m.em).toISOString(), tipo: 'conversa', model: 'claude-sonnet', tel, inTok: entre(9000, 16000), outTok: entre(80, 260), usd: +(0.03 + rnd() * 0.035).toFixed(4) });
    for (const e of (c.eventos || [])) if (e && e.em) tagLog.push(Object.assign({}, e, { chave: tel, por: '', em: e.em + desloc }));
    if (c.encerrada && c.encerrada.em) encerradas[tel] = { em: c.encerrada.em + desloc, por: 'SoFIA' };
    if ((c.tags || []).includes(T.agendou)) agendaramCanal[tel.slice(-8)] = 'sofia';
    contatosReais[tel] = { tel, nome: c.nome, tags: c.tags || [], instrucoes: '', criadoEm: msgs[0].em, atualizadoEm: msgs[msgs.length - 1].em };
  });
} else {
  LEADS.forEach((p, k) => {
    const [chave, d0, inicio] = ELENCO_LEADS[k % ELENCO_LEADS.length];
    const tags = viverHistoria(p, chave, d0, inicio);
    if (tags) tagsLead[p.tel] = tags;
  });
  // Alunas ativas que falam com a SoFIA (trocar horário, 2ª via…): a SoFIA sabe que já são alunas.
  const ALUNAS_CONVERSA = ALUNAS.slice(28, 28 + ELENCO_ALUNAS.length);
  ALUNAS_CONVERSA.forEach((p, k) => {
    const [chave, d0, inicio] = ELENCO_ALUNAS[k];
    viverHistoria(p, chave, d0, inicio, { plano: PLANOS[(28 + k) % PLANOS.length], funil: T.aluna });
  });
}
// Alunas que vieram da experimental neste mês (agendaram → fizeram → fecharam).
const VIERAM = ALUNAS.slice(0, 9);
VIERAM.forEach((p, k) => {
  const d0 = -entre(4, 27), quando = em(dia(d0), pick(['09:20', '11:40', '14:05', '19:30', '21:10']));
  const canal = pick(['sofia', 'sofia', 'formulario', 'express']);
  const tags = resultadoAula(p, quando, canal, d0);
  // quem não fechou na aula ainda pode ter fechado depois: mantém aluna (é aluna ativa)
  for (const a of Object.values(aulas)) if (a.id === p.id && a.status !== 'Agendado') { a.status = 'Presença'; a.contrato = a.contrato || pick(PLANOS); }
});
const lidos = {}; for (let n = -30; n <= 6; n++) lidos[dia(n)] = AGORA;

// ── contatos (CRM) ───────────────────────────────────────────────────────────
const contatos = {};
const criado = em(dia(-120), '10:00');
for (const p of ALUNAS) contatos[p.tel] = { tel: p.tel, nome: p.nome, tags: [T.aluna], instrucoes: '', criadoEm: criado, atualizadoEm: criado, idEvo: p.id };
for (const p of EX) contatos[p.tel] = { tel: p.tel, nome: p.nome, tags: [T.ex], instrucoes: '', criadoEm: criado, atualizadoEm: criado, idEvo: p.id };
Object.assign(contatos, contatosReais);
for (const p of LEADS) if (conversas[p.tel]) contatos[p.tel] = { tel: p.tel, nome: p.primeiro, tags: tagsLead[p.tel] || [], instrucoes: '', criadoEm: conversas[p.tel].msgs[0].em, atualizadoEm: conversas[p.tel].ultimaEm };

// ── alunas ativas (leitura diária do "EVO") ──────────────────────────────────
const pesAtivas = {}, idsAtivos = [];
// Além das alunas com conversa/contato, um Studio de verdade tem ~130 ativas.
const EXTRAS = [];
for (let k = 0; EXTRAS.length < 96; k++) {
  const n = NOMES[(k * 7 + 3) % NOMES.length], sb = SOBRENOMES[(k * 5 + 11) % SOBRENOMES.length], sb2 = SOBRENOMES[(k * 3 + 1) % SOBRENOMES.length];
  EXTRAS.push({ nome: `${n} ${sb} ${sb2}`.toUpperCase(), tel: '556290000' + pad(1000 + k, 4), id: String(5200 + k * 7) });
}
ALUNAS.forEach((p, k) => {
  const ini = dia(-entre(20, 540)), plano = PLANOS[k % PLANOS.length];
  const fim = dia(entre(5, 300));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, plano, fim, 0]] };
  if (k % 9 === 0) pesAtivas[p.id].fq = [plano, dia(entre(10, 40))];
  idsAtivos.push(p.id);
});
EXTRAS.forEach((p, k) => {
  const ini = dia(-entre(15, 700)), plano = PLANOS[(k + 2) % PLANOS.length], fim = dia(entre(3, 330));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, plano, fim, 0]] };
  idsAtivos.push(p.id);
});
// Série dos últimos 24 meses (reconstruída "pelos contratos"): cresce com sazonalidade.
const DIAS_SERIE = 730, inicioSerie = dia(-(DIAS_SERIE - 1));
const serAtivas = [], serEntr = [], serNovas = [], serSai = [];
{
  let atual = Math.round(idsAtivos.length * 0.74);
  const alvo = idsAtivos.length;
  for (let i = 0; i < DIAS_SERIE; i++) {
    const dd = dia(-(DIAS_SERIE - 1) + i), mes = +dd.slice(5, 7), dow = wd(dd);
    const restante = DIAS_SERIE - i;
    const tend = (alvo - atual) / Math.max(1, restante);
    const forte = [1, 2, 3, 8].includes(mes) ? 1.6 : [6, 12].includes(mes) ? 0.5 : 1;
    let e = dow === 0 ? 0 : (rnd() < 0.36 * forte ? entre(1, 2) : 0);
    let sa = dow === 0 ? 0 : (rnd() < 0.3 * (mes === 12 || mes === 6 ? 1.7 : 1) ? entre(1, 2) : 0);
    if (tend > 0.2 && dow !== 0 && rnd() < 0.5) e++;
    if (tend < -0.2 && dow !== 0 && rnd() < 0.5) sa++;
    if (i === DIAS_SERIE - 1) { const dif = alvo - (atual + e - sa); if (dif > 0) e += dif; else sa -= dif; }
    atual = atual + e - sa;
    serAtivas.push(atual); serEntr.push(e); serNovas.push(e ? entre(0, e) : 0); serSai.push(sa);
  }
}
EX.forEach((p) => {
  const ini = dia(-entre(300, 700)), fim = dia(-entre(20, 200));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, pick(PLANOS), fim, 0]] };
});

// ── log de envios do robô (aba Log) + SoFIA ──────────────────────────────────
const atividade = [], atividadeSofia = [];
const ev = (d, hora, contexto, destino, preview, extra = {}) => {
  const t = em(d, hora); if (!passou(t)) return;
  atividade.push({ data: d, ts: new Date(t).toISOString(), quando: hora, contexto, destino: extra.grupo ? destino : cap(destino), grupo: !!extra.grupo, midia: !!extra.midia, ok: extra.ok !== false, erro: extra.erro || '', preview: corta(preview, 80), texto: preview });
};
for (let n = -6; n <= 0; n++) {
  const d = dia(n); if (wd(d) === 0) continue;
  const doDia = Object.values(aulas).filter(a => a.dia === d);
  const amanha = Object.values(aulas).filter(a => a.dia === dia(n + 1));
  for (const a of doDia) ev(d, '06:30', 'Confirmação — aula de hoje', a.nome.split(' ')[0], `Bom dia, ${a.nome.split(' ')[0][0] + a.nome.split(' ')[0].slice(1).toLowerCase()}! Passando para confirmar sua aula experimental hoje às ${a.hora} 💪`);
  for (const a of amanha) ev(d, '18:00', 'Confirmação — aula de amanhã', a.nome.split(' ')[0], `Oi! Sua aula experimental é amanhã às ${a.hora}. Podemos confirmar? 😊`);
  for (const a of Object.values(aulas).filter(a => a.dia === dia(n - 1) && a.status === 'Presença' && !a.contrato)) ev(d, '10:00', 'Follow-up pós-aula', a.nome.split(' ')[0], 'Oi! Aqui é a professora da sua aula de ontem 💛 O que achou da experiência?', { midia: true });
  for (const a of Object.values(aulas).filter(a => a.dia === d && a.status === 'Falta')) ev(d, '20:15', 'Faltou (no-show) — convite para remarcar', a.nome.split(' ')[0], 'Oi! Sentimos sua falta hoje 😕 Quer remarcar sua aula experimental?');
  ev(d, '07:00', 'Aniversário', 'SlimFit Alunas 💪', `🎉 Hoje é dia de festa! Parabéns, ${pick(ALUNAS).primeiro}! Muita saúde e muitos treinos 💛`, { grupo: true, midia: true });
  ev(d, '19:45', 'Resumo do dia', 'SlimFit Equipe 💪', `📊 Resumo de hoje: ${doDia.length} experimentais · ${doDia.filter(a => a.status === 'Presença').length} vieram · ${doDia.filter(a => a.contrato).length} fecharam`, { grupo: true });
  if (n === -2) ev(d, '09:10', 'Renovação de contrato', pick(ALUNAS).primeiro, 'Oi! Seu plano vence semana que vem — quer que a gente já deixe a renovação pronta? 💛');
  if (n === -1) ev(d, '09:12', 'Renovação de contrato', pick(ALUNAS).primeiro, 'Oi! Seu plano vence semana que vem — quer que a gente já deixe a renovação pronta? 💛', { ok: false, erro: 'número sem WhatsApp' });
  // cobrança (pela SoFIA)
  const tCob = em(d, '12:05');
  if (passou(tCob) && n % 2 === 0) atividadeSofia.push({ data: d, ts: new Date(tCob).toISOString(), quando: '12:05', contexto: 'Cobrança — boleto', destino: pick(ALUNAS).tel, grupo: false, midia: false, ok: true, erro: '', preview: 'Oi! 💜 Passando pra lembrar que o boleto da sua mensalidade venceu…', texto: 'Oi! 💜 Passando pra lembrar que o boleto da sua mensalidade venceu. Segue o link para pagamento.' });
}
atividade.sort((a, b) => a.ts.localeCompare(b.ts));

// ── formulário (acessos e agendamentos) ──────────────────────────────────────
const indicadores = [];
for (let n = -29; n <= 0; n++) {
  const d = dia(n);
  const acessos = entre(18, 55);
  for (let j = 0; j < acessos; j++) {
    const hh = pick(['07', '08', '09', '11', '12', '13', '18', '19', '20', '21', '22']) + ':' + pad(entre(0, 59));
    if (!passou(em(d, hh))) continue;
    const vid = 'v' + d.replace(/-/g, '') + (j % Math.max(1, Math.floor(acessos * 0.7)));
    indicadores.push({ id: `a-${d}-${j}`, tipo: 'acesso', origem: pick(['instagram', 'instagram', 'sofia', 'google', 'site']), vid, hora: '', dia: d, quando: hh, tsForm: '' });
    if (rnd() < 0.09) indicadores.push({ id: `g-${d}-${j}`, tipo: 'agendou', origem: pick(['instagram', 'sofia', 'site']), vid, hora: pick(HORAS), dia: d, quando: hh, tsForm: '' });
  }
}

// ── campanhas ────────────────────────────────────────────────────────────────
const camp = (id, nome, status, enviadosQtd, pendQtd, desdeDias) => {
  const base = em(dia(-desdeDias), '09:00');
  const alvos = [...EX, ...LEADS];
  return {
    id, nome, tag: status === 'concluida' ? T.ex : T.fez,
    textoBase: 'Oi {nome}! 💛 Sentimos sua falta por aqui. Neste mês temos condição especial — quer receber os horários disponíveis?',
    variacoes: [], limiteDia: 40, delayMinSeg: 60, delayMaxSeg: 180, janelaIni: '09:00', janelaFim: '19:00', dataInicio: dia(-desdeDias),
    status, pendentes: alvos.slice(enviadosQtd, enviadosQtd + pendQtd).map(p => ({ tel: p.tel, nome: p.primeiro })),
    enviados: alvos.slice(0, enviadosQtd).map((p, k) => ({ tel: p.tel, nome: p.primeiro, em: base + k * 150000 })),
    falhas: [], enviadosHoje: status === 'enviando' ? Math.min(enviadosQtd, 12) : 0, diaRef: hoje, proxEnvioEm: AGORA + 120000, criadoEm: base - 3600e3, atualizadoEm: AGORA,
  };
};
const campanhas = [camp('demo-c1', 'Volta às aulas — ex-alunas', 'concluida', 8, 0, 9), camp('demo-c2', 'Black November — quem fez experimental', 'enviando', 12, 9, 1)];

// ── Saúde: status dos WhatsApps e batimento dos envios ───────────────────────
const statusOk = { estado: 'conectado', qr: null, atualizadoEm: new Date(AGORA - 40000).toISOString() };
let registrados = {};
try {
  const cfg = require('./config');
  for (const [k, expr] of Object.entries(cfg.schedule || {})) if (expr) registrados[k] = { expr: String(expr), tz: TZ, desde: new Date(AGORA - 30 * 86400e3).toISOString() };
} catch (_) {}
const disparos = {}; for (const k of Object.keys(registrados)) disparos[k] = new Date(AGORA - 60000).toISOString();

// ── arquivos-base da SoFIA (prompt, extração, mídias, regras) — só se faltarem ──
{
  const CHATBOT = path.resolve(__dirname, '..', '..', 'ChatBot');
  for (const f of ['sofia-prompt.default.txt', 'sofia-extracao.default.txt', 'sofia-midias.default.txt', 'sofia-regras.default.json']) {
    try { const dst = path.join(SOFIA, f); if (!fs.existsSync(dst) && fs.existsSync(path.join(CHATBOT, f))) fs.copyFileSync(path.join(CHATBOT, f), dst); } catch (_) {}
  }
}

// imagem da grade fictícia (aparece nas conversas, como a foto que a SoFIA envia)
try { fs.mkdirSync(path.join(SOFIA, 'humano-fotos'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'demo-assets', 'grade-demo.png'), path.join(SOFIA, 'humano-fotos', 'grade-demo.png')); } catch (_) {}

// ── Slim Club (benefícios de alunas para alunas) ─────────────────────────────
const slimclub = [], usosClub = [], recsClub = {}, reclClub = [];
{
  const sid = (n) => 'de' + pad(n, 14);
  const cnpj = (n) => '4' + pad(n * 7919 % 1e7, 7) + '0001' + pad(n * 13 % 100, 2);
  const iso = (d, h) => new Date(em(d, h)).toISOString();
  const neg = [
    // [n, aluna dona (índice em ALUNAS) | null = parceira, negócio, categoria, benefício, alcance, instagram, status, dias atrás]
    [1, 1, 'Studio Bella Unhas', 'Beleza', '15% de desconto em manicure e pedicure, de terça a quinta', 'local', 'bellaunhas.exemplo', 'aprovado', 58],
    [2, 3, 'Nutri Ana Lacerda', 'Saúde', 'Primeira consulta nutricional com 30% de desconto + plano alimentar para treino', 'local', 'nutri.exemplo', 'aprovado', 51],
    [3, 5, 'Doce Fit Confeitaria', 'Alimentação', '10% em todos os bolos e doces fit (encomendas com 48h de antecedência)', 'local', 'docefit.exemplo', 'aprovado', 44],
    [4, 7, 'Ateliê Flor de Lis', 'Moda', '12% em peças da nova coleção e ajustes de roupa grátis', 'local', 'flordelis.exemplo', 'aprovado', 37],
    [5, 10, 'Clínica Derma Vida', 'Saúde', 'Limpeza de pele por R$ 120 (valor normal R$ 180)', 'local', 'dermavida.exemplo', 'aprovado', 30],
    [6, 12, 'Prado Contabilidade', 'Consultoria', 'Abertura de MEI gratuita e 20% na mensalidade contábil no 1º ano', 'nacional', 'pradocontabil.exemplo', 'aprovado', 22],
    [7, null, 'Empório Natural Verde', 'Alimentação', '8% em toda a loja (granel, suplementos e naturais)', 'local', 'emporioverde.exemplo', 'aprovado', 40],
    [8, null, 'Farmácia Exemplo', 'Saúde', '10% em dermocosméticos e suplementos', 'local', 'farmaciaexemplo', 'aprovado', 15],
    [9, 15, 'Glow Estética', 'Beleza', 'Drenagem linfática: pacote de 5 sessões pelo preço de 4', 'local', 'glowestetica.exemplo', 'pendente', 1],
    [10, 17, 'Luz Fotografia', 'Serviços', '20% em ensaios femininos e de família', 'local', 'luzfoto.exemplo', 'pendente', 0],
  ];
  const AV = ['julia', 'demonstracao'];
  for (const [n, ia, negocio, categoria, beneficio, alcance, instagram, status, atras] of neg) {
    const dona = ia == null ? null : ALUNAS[ia];
    const criadoEm = iso(dia(-atras), pick(['09:12', '11:40', '15:05', '19:22', '21:08']));
    const r = { id: sid(n), status, criadoEm, nome: dona ? titulo(dona.nome) : pick(['Marcos Teixeira', 'Renata Moreira', 'Paulo Campos']), telefone: dona ? dona.tel : '556290000' + pad(9000 + n, 4),
      negocio, categoria, documento: cnpj(n), beneficio, alcance, validacao: 'carteira', fimVigencia: n === 5 ? dia(45) : '', instagram, whatsapp: '' };
    if (dona) r.nomeNoCadastro = dona.primeiro; else Object.assign(r, { tipo: 'parceira', origem: n === 8 ? 'recepcao' : 'externo' });
    if (status === 'aprovado') Object.assign(r, { avaliadoPor: pick(AV), avaliadoEm: iso(dia(-atras + 1), '10:30'), codigo: String(310000 + n * 7351).slice(0, 6), codigoVer: 1 });
    slimclub.push(r);
    try { fs.mkdirSync(path.join(DATA, 'slimclub-fotos'), { recursive: true }); fs.copyFileSync(path.join(__dirname, 'demo-assets', 'slimclub', n + '.jpg'), path.join(DATA, 'slimclub-fotos', r.id + '.jpg')); } catch (_) {}
  }
  // um recusado (benefício vago) — mostra o motivo que volta para a aluna
  slimclub.push({ id: sid(11), status: 'recusado', criadoEm: iso(dia(-9), '20:14'), nome: titulo(ALUNAS[19].nome), telefone: ALUNAS[19].tel, negocio: 'Loja da Bia Acessórios', categoria: 'Moda',
    documento: cnpj(11), beneficio: 'Desconto especial para alunas', alcance: 'local', validacao: 'carteira', fimVigencia: '', instagram: 'lojadabia.exemplo', whatsapp: '', nomeNoCadastro: ALUNAS[19].primeiro,
    avaliadoPor: 'julia', avaliadoEm: iso(dia(-8), '10:05'), motivo: 'Descreva o benefício de forma específica (ex.: "10% em qualquer peça") para as alunas saberem o que vão ganhar.' });
  try { fs.copyFileSync(path.join(__dirname, 'demo-assets', 'slimclub', '4.jpg'), path.join(DATA, 'slimclub-fotos', sid(11) + '.jpg')); } catch (_) {}
  // usos registrados pela leitura do QR da carteira (últimos 60 dias)
  const aprovados = slimclub.filter(r => r.status === 'aprovado');
  const peso = { 1: 9, 2: 5, 3: 8, 4: 4, 5: 6, 6: 2, 7: 7, 8: 5 };
  for (const r of aprovados) {
    const nUsos = peso[Number(r.id.slice(-2))] || 3;
    const quem = new Set();
    for (let j = 0; j < nUsos * 2; j++) {
      const a = pick(ALUNAS), d = dia(-entre(0, 55));
      if (a.tel === r.telefone || !passou(em(d, '12:00'))) continue;
      usosClub.push({ empresaId: r.id, tel: a.tel, nome: titulo(a.nome), em: iso(d, pick(['10:15', '14:40', '17:05', '19:30'])), dia: d });
      quem.add(a.tel);
    }
    recsClub[r.id] = [...quem].slice(0, Math.max(1, Math.round(quem.size * 0.6)));
  }
  reclClub.push({ id: 'dc0000000001', empresaId: sid(4), empresa: 'Ateliê Flor de Lis', tel: ALUNAS[22].tel, nome: titulo(ALUNAS[22].nome),
    texto: 'Fui ontem e disseram que o desconto só vale para pagamento em dinheiro. No anúncio não fala isso.', em: iso(dia(-1), '18:42'), status: 'aberta' });
  reclClub.push({ id: 'dc0000000002', empresaId: sid(3), empresa: 'Doce Fit Confeitaria', tel: ALUNAS[25].tel, nome: titulo(ALUNAS[25].nome),
    texto: 'A atendente não sabia como ler o QR da carteira e não deu o desconto.', em: iso(dia(-12), '16:20'), status: 'resolvida',
    nota: 'Conversamos com a dona: a equipe foi orientada e a aluna recebeu o desconto na compra seguinte.', tratadaPor: 'julia', tratadaEm: iso(dia(-11), '09:40') });
}

// ── Grade de matrículas fixas (Indicadores → Grade): semana passada, esta e a próxima ──
const gradeSemanas = {};
{
  const ROSTER = [...ALUNAS.map(p => titulo(p.nome)), ...EXTRAS.map(p => titulo(p.nome))];
  const TICKET = { 'SLIM 2X MENSAL': 587, 'SLIM 3X MENSAL': 689, 'SLIM 3X TRIMESTRAL': 649, 'SLIM 4X SEMESTRAL': 659, 'SLIM FREE 3X QUADRIMESTRAL': 619, 'SLIM 5X ANUAL': 699 };
  const planoDe = {}; ROSTER.forEach((n, k) => { planoDe[n] = PLANOS[k % PLANOS.length]; });
  const CHEIAS = ['07:00', '18:45', '17:30'];
  const celulas = [];
  for (let w = 0; w <= 5; w++) for (const h of HORAS) {
    if (w === 5 && !['08:15', '09:30'].includes(h)) continue;      // sábado: só de manhã (escala)
    if (h === '14:00' && ![0, 2, 4].includes(w)) continue;          // 14:00 só seg/qua/sex
    const cap = 9;
    const n = CHEIAS.includes(h) ? entre(8, 9) : (h === '14:00' || h === '05:45' ? entre(3, 5) : entre(5, 8));
    const ini = (w * 17 + HORAS.indexOf(h) * 11) % ROSTER.length;
    const fixas = Array.from({ length: n }, (_, j) => ROSTER[(ini + j * 5) % ROSTER.length]);
    celulas.push({ w, h, cap, fixas: [...new Set(fixas)], prof: PROFS[(w + HORAS.indexOf(h)) % PROFS.length] });
  }
  const segDe = (off) => { const d = new Date(hoje + 'T12:00:00Z'); const dw = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dw + off * 7); return d.toISOString().slice(0, 10); };
  for (const off of [-1, 0, 1]) {
    const seg = segDe(off);
    const dataDe = (w) => { const d = new Date(seg + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + w); return d.toISOString().slice(0, 10); };
    const turmas = celulas.map(c => {
      const data = dataDe(c.w), aconteceu = em(data, c.h) + 3600e3 < AGORA;
      const fixas = c.fixas.map(nome => {
        const x = { nome, plano: planoDe[nome], ticket: TICKET[planoDe[nome]] };
        if (aconteceu) { const r = rnd(); x.pres = r < 0.8 ? 'foi' : r < 0.9 ? 'faltou' : r < 0.97 ? 'justif' : 'trancada'; }
        return x;
      });
      const livres = aconteceu ? fixas.filter(x => x.pres !== 'foi').length : 0;
      const reposicao = aconteceu ? Array.from({ length: Math.min(livres, entre(0, 2)) }, () => pick(ROSTER)) : [];
      const free = aconteceu && rnd() < 0.25 && livres > reposicao.length ? [pick(ROSTER)] : [];
      const presentes = fixas.filter(x => x.pres === 'foi').length;
      const t = { weekday: c.w, data, hora: c.h, capacity: c.cap, nFixas: fixas.length, vagas: Math.max(0, c.cap - fixas.length), professora: c.prof, fixas, reposicao, free,
        nRepo: reposicao.length, nFree: free.length, aconteceu };
      if (aconteceu) Object.assign(t, { presentes, faltas: fixas.filter(x => x.pres === 'faltou').length, nReal: presentes + reposicao.length + free.length });
      return t;
    }).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    const semSab = turmas.filter(t => t.weekday !== 5), feitas = semSab.filter(t => t.aconteceu);
    const somaF = semSab.reduce((a, t) => a + t.nFixas, 0), somaV = semSab.reduce((a, t) => a + t.capacity, 0);
    const somaR = feitas.reduce((a, t) => a + t.nReal, 0), somaRV = feitas.reduce((a, t) => a + t.capacity, 0);
    const alunasFixas = new Set(turmas.flatMap(t => t.fixas.map(x => x.nome))).size;
    const tks = ROSTER.map(n => TICKET[planoDe[n]]);
    const mes = hoje.slice(0, 7);
    const fatura_itens = ROSTER.slice(0, idsAtivos.length).map((n, k) => {
      const venc = mes + '-' + pad([5, 10, 15, 20, 25][k % 5]), valor = TICKET[planoDe[n]];
      const passouVenc = venc <= hoje, r = rnd();
      const sit = !passouVenc ? 'a receber' : (r < 0.93 ? 'pago' : 'vencido');
      return { aluna: n, contrato: planoDe[n], venc, valor, pago: sit === 'pago' ? valor : 0, sit };
    });
    const porProf = PROFS.map(pf => {
      const ts = semSab.filter(t => t.professora === pf), fe = ts.filter(t => t.aconteceu);
      const fx = ts.reduce((a, t) => a + t.nFixas, 0), vg = ts.reduce((a, t) => a + t.capacity, 0);
      const rl = fe.reduce((a, t) => a + t.nReal, 0), rv = fe.reduce((a, t) => a + t.capacity, 0);
      return { professora: pf, turmas: ts.length, fixas: fx, vagas: vg, pct: vg ? Math.round(fx / vg * 100) : null, pres_pct: rv ? Math.round(rl / rv * 100) : null, pres_turmas: fe.length };
    });
    const geradoEm = new Date(Math.min(AGORA, em(off <= 0 ? hoje : seg, '06:10'))).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    gradeSemanas[off] = {
      inicio: seg, fim: dataDe(5), gerado_em: geradoEm, financeiro_em: geradoEm, turmas, por_professora: porProf,
      resumo: {
        turmas: turmas.length, alunas_fixas: alunasFixas, ativas: idsAtivos.length, trancadas: 5,
        ocupacao_pct: somaV ? Math.round(somaF / somaV * 100) : null, ocupacao_fixas: somaF, ocupacao_vagas: somaV,
        presenca_pct: somaRV ? Math.round(somaR / somaRV * 100) : null, presenca_real: somaR, presenca_vagas: somaRV,
        tkm_medio: Math.round(tks.reduce((a, b) => a + b, 0) / tks.length), tkm_alunas: tks.length, sem_contrato: [],
        fatura_mes: fatura_itens.reduce((a, it) => a + it.valor, 0), fatura_n: fatura_itens.length, fatura_itens,
      },
    };
  }
}

// ── grava tudo ───────────────────────────────────────────────────────────────
gravar(path.join(SOFIA, 'sofia-conversas.json'), conversas);
gravar(path.join(SOFIA, 'sofia-tag-log.jsonl'), tagLog.filter(e => passou(e.em)).map(e => JSON.stringify(e)).join('\n') + '\n');
gravar(path.join(SOFIA, 'sofia-encerradas.json'), encerradas);
gravar(path.join(SOFIA, 'sofia-custo.jsonl'), custo.map(e => JSON.stringify(e)).join('\n') + '\n');
gravar(path.join(SOFIA, 'sofia-wa-status.json'), { estado: 'conectado', qr: '', codigo: '', atualizadoEm: statusOk.atualizadoEm });
gravar(path.join(SOFIA, 'campanhas.json'), campanhas);
gravar(path.join(SOFIA, 'sofia-agendaram-canal.json'), agendaramCanal);
gravar(path.join(SOFIA, 'sofia-lid-stats.json'), { mapeados: 14, semTel: 0, ultimoSemTelEm: 0, semTelLista: [], em: AGORA });
gravar(path.join(SOFIA, 'sofia-estado.txt'), 'on');
gravar(path.join(DATA, 'contatos.json'), contatos);
gravar(path.join(DATA, 'experimentais-historico.json'), { aulas, lidos, status: { estado: 'ok', inicio: AGORA - 600000, fim: AGORA - 540000, msg: 'leitura concluída', dias: 37, aulas: Object.keys(aulas).length }, cfg: { desde: dia(-30) } });
gravar(path.join(DATA, 'alunas-ativas-historico.json'), {
  ultimo: { dia: hoje, ids: idsAtivos }, pessoas: pesAtivas,
  dias: { [dia(-1)]: { ativas: serAtivas[serAtivas.length - 2], trancadas: 4, entraram: serEntr[serEntr.length - 2], sairam: serSai[serSai.length - 2] }, [hoje]: { ativas: idsAtivos.length, trancadas: 5, entraram: serEntr[serEntr.length - 1], sairam: serSai[serSai.length - 1] } },
  reconstruido: { inicio: inicioSerie, ativas: serAtivas, entraram: serEntr, novas: serNovas, sairam: serSai },
});
gravar(path.join(DATA, 'atividade.json'), atividade);
gravar(path.join(DATA, 'atividade-sofia.jsonl'), atividadeSofia.map(e => JSON.stringify(e)).join('\n') + (atividadeSofia.length ? '\n' : ''));
gravar(path.join(DATA, 'indicadores.json'), indicadores);
gravar(path.join(DATA, 'wa-status.json'), statusOk);
gravar(path.join(DATA, 'comparecimento.json'), { on: true, tagAgendou: T.agendou, tagsAgendou: [T.agendou], tagCompareceu: T.fez, tagFaltou: T.faltou, numeroRelatorio: '', criarNovos: false, diasJanela: 7, intervaloHoras: 0 });
gravar(path.join(DATA, 'auto-tag-alunas.json'), { on: true, tagAluna: T.aluna, tagExAluna: T.ex });
gravar(path.join(DATA, 'slimclub.json'), { cadastros: slimclub });
gravar(path.join(DATA, 'slimclub-usos.json'), { usos: usosClub });
gravar(path.join(DATA, 'slimclub-avaliacoes.json'), { recs: recsClub, reclamacoes: reclClub });
for (const [off, g] of Object.entries(gradeSemanas)) gravar(path.join(DATA, Number(off) === 0 ? 'grade-fixas.json' : `grade-fixas.s${off}.json`), g);
gravar(path.join(DATA, 'jobs-disparos.json'), { desde: new Date(AGORA - 30 * 86400e3).toISOString(), boot: new Date(AGORA - 3 * 86400e3).toISOString(), registrados, disparos, falhas: {} });

console.log(`demo-dados: ${Object.keys(conversas).length} conversas · ${Object.keys(contatos).length} contatos · ${Object.keys(aulas).length} experimentais · ${idsAtivos.length} alunas ativas · ${atividade.length} envios no log · ${indicadores.length} eventos do formulário.`);

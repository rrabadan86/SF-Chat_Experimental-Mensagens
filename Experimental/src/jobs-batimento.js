/**
 * Batimento dos envios automáticos — para a Saúde do sistema saber se cada job
 * agendado RODOU no horário e se FALHOU.
 *
 * O robô (scheduler) agenda cada job com agendar(chave, cron, fn): aqui fica
 * registrado o horário (cron) de cada chave, o último disparo e a última falha.
 * A falha é atribuída ao job certo pelo AsyncLocalStorage: tudo o que o job faz
 * (inclusive promessas que ele não espera) carrega a chave dele, e o logError do
 * scheduler chama falhou() aqui.
 *
 * O painel (outro processo) só lê data/jobs-disparos.json e compara com o último
 * horário previsto de cada cron: "deveria ter rodado e não rodou" = o robô estava
 * fora do ar, travado ou reiniciou depois do horário.
 *
 *   data/jobs-disparos.json → { desde, boot, registrados: { chave: { expr, tz } },
 *                               disparos: { chave: ISO }, falhas: { chave: { em, msg } } }
 */
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const ARQ = path.resolve(__dirname, '..', 'data', 'jobs-disparos.json');
const als = new AsyncLocalStorage();
let est = null;
let anteriores = {}; // registrados do boot anterior (para saber desde quando cada horário vale)

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return (o && typeof o === 'object') ? o : null; } catch (_) { return null; }
}
function gravar() {
  try {
    fs.mkdirSync(path.dirname(ARQ), { recursive: true });
    const tmp = ARQ + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(est));
    fs.renameSync(tmp, ARQ);
  } catch (_) { /* nunca derruba o robô */ }
}
// Chamado uma vez no boot do robô: zera a lista de registrados (o que foi agendado
// NESTE boot) e mantém o histórico de disparos/falhas. "desde" = quando o
// monitoramento começou (antes disso não dá para dizer que um job "não rodou").
function iniciar() {
  const o = ler() || {};
  anteriores = o.registrados || {};
  est = { desde: o.desde || new Date().toISOString(), boot: new Date().toISOString(), registrados: {}, disparos: o.disparos || {}, falhas: o.falhas || {} };
  gravar();
}

// Substitui cron.schedule(expr, fn, opts) no scheduler.
function agendar(cron, chave, expr, fn, opts) {
  if (!est) iniciar();
  // "desde": quando ESTE horário passou a valer no robô. Mesmo horário do boot
  // anterior → mantém; envio novo ou horário mudado → agora (não acusa "não rodou"
  // por um horário de hoje que já tinha passado quando ele foi ligado).
  const ant = anteriores[chave];
  const desdeChave = (ant && ant.expr === String(expr) && ant.desde) ? ant.desde : new Date().toISOString();
  est.registrados[chave] = { expr: String(expr), tz: (opts && opts.timezone) || '', desde: desdeChave };
  gravar();
  handlers[chave] = fn;
  return cron.schedule(expr, function (...a) {
    try { est.disparos[chave] = new Date().toISOString(); gravar(); } catch (_) {}
    return als.run({ chave }, () => fn.apply(this, a));
  }, opts);
}

// ── Fila dos jobs que ficaram sem rodar ────────────────────────────────────
// Um job agendado que encontra o robô ocupado ESPERA a vez (esperarVez). Se o robô
// reinicia nesse meio tempo, ou se o job desiste depois de 40 min, ele se perdia.
// Agora quem está esperando fica anotado em data/jobs-fila.json; com o robô livre,
// a fila roda esses jobs (o mais antigo primeiro). Só entra na fila quem AINDA NÃO
// COMEÇOU — um job interrompido no meio NÃO é repetido sozinho (poderia mandar em
// dobro): vira um alerta para conferir.
//   data/jobs-fila.json → { esperando: { chave: { nome, desde, boot, desistiu? } },
//                           rodando: { chave, nome, desde, boot } | null }
const ARQ_FILA = path.resolve(__dirname, '..', 'data', 'jobs-fila.json');
const handlers = {};
const BOOT = new Date().toISOString() + '#' + process.pid;
const FILA_MAX_MS = (parseFloat(process.env.FILA_JOBS_MAX_HORAS || '3') || 3) * 3600e3; // mais velho que isso: descarta
const HORA_INI = parseInt(process.env.FILA_JOBS_HORA_INI || '7', 10);  // só roda atrasado entre 7h
const HORA_FIM = parseInt(process.env.FILA_JOBS_HORA_FIM || '21', 10); // e 21h (Brasília)
let fila = null;
function lerFila() {
  if (fila) return fila;
  try { fila = JSON.parse(fs.readFileSync(ARQ_FILA, 'utf8')); } catch (_) { fila = null; }
  if (!fila || typeof fila !== 'object') fila = {};
  if (!fila.esperando || typeof fila.esperando !== 'object') fila.esperando = {};
  if (fila.rodando === undefined) fila.rodando = null;
  return fila;
}
function gravarFila() {
  try {
    fs.mkdirSync(path.dirname(ARQ_FILA), { recursive: true });
    fs.writeFileSync(ARQ_FILA + '.tmp', JSON.stringify(fila));
    fs.renameSync(ARQ_FILA + '.tmp', ARQ_FILA);
  } catch (_) { /* nunca derruba o robô */ }
}
const ctxFila = () => { const s = als.getStore(); return (s && s.chave && handlers[s.chave]) ? s : null; };

// esperarVez: o robô estava ocupado e este job vai esperar.
function esperando(nome) {
  const s = ctxFila(); if (!s) return;
  const f = lerFila();
  f.esperando[s.chave] = { nome, desde: s.desde || new Date().toISOString(), boot: BOOT };
  gravarFila();
}
// esperarVez: este job pegou o robô (vai começar agora).
function pegouVez(nome) {
  const s = ctxFila(); if (!s) return;
  const f = lerFila();
  delete f.esperando[s.chave];
  f.rodando = { chave: s.chave, nome, desde: new Date().toISOString(), boot: BOOT };
  gravarFila();
}
// esperarVez: esperou demais e desistiu — fica na fila para quando o robô liberar.
function desistiu(nome) {
  const s = ctxFila(); if (!s) return;
  const f = lerFila();
  const e = f.esperando[s.chave] || { nome, desde: s.desde || new Date().toISOString() };
  f.esperando[s.chave] = Object.assign(e, { boot: BOOT, desistiu: new Date().toISOString() });
  gravarFila();
}
// O robô está livre: o job que estava rodando terminou.
function liberou() {
  const f = lerFila();
  if (f.rodando && f.rodando.boot === BOOT) { f.rodando = null; gravarFila(); }
}
// No boot do robô: job que estava RODANDO quando o robô caiu (não repete sozinho).
function interrompido() {
  const f = lerFila();
  const r = f.rodando && f.rodando.boot !== BOOT ? f.rodando : null;
  if (r) { f.rodando = null; gravarFila(); }
  return r;
}
const horaSP = (ms) => new Date(ms - 3 * 3600e3).getUTCHours();
/**
 * Próximo job da fila que pode rodar agora (robô livre): o mais antigo entre os que
 * ficaram de um boot anterior ou desistiram de esperar. Tira da fila e devolve
 * { chave, nome, desde } — ou null. Os velhos demais saem em `descartados`.
 */
function proximo(agora = Date.now()) {
  const f = lerFila();
  const descartados = [];
  let melhor = null;
  for (const [chave, e] of Object.entries(f.esperando)) {
    const desde = Date.parse(e.desde) || 0;
    if (!handlers[chave] || agora - desde > FILA_MAX_MS) { descartados.push({ chave, ...e }); delete f.esperando[chave]; continue; }
    if (e.boot === BOOT && !e.desistiu) continue; // está esperando agora, neste robô
    if (!melhor || desde < (Date.parse(melhor.desde) || 0)) melhor = { chave, ...e };
  }
  const h = horaSP(agora);
  if (melhor && (h < HORA_INI || h >= HORA_FIM)) melhor = null; // de noite não manda nada atrasado
  if (melhor) delete f.esperando[melhor.chave];
  if (melhor || descartados.length) gravarFila();
  proximo.descartados = descartados;
  return melhor;
}
// Roda de novo o job da fila (mesmo caminho do cron: liga/desliga, esperarVez…).
function disparar(item) {
  const fn = handlers[item.chave]; if (!fn) return false;
  try { est.disparos[item.chave] = new Date().toISOString(); gravar(); } catch (_) {}
  als.run({ chave: item.chave, desde: item.desde }, () => { Promise.resolve().then(() => fn()).catch(() => {}); });
  return true;
}

// logError do scheduler → marca a falha no job em execução (se houver).
function falhou(msg) {
  const s = als.getStore();
  if (!s || !est) return;
  est.falhas[s.chave] = { em: new Date().toISOString(), msg: String(msg || '').slice(0, 220) };
  gravar();
}

// ── Cron: último horário previsto (≤ ate) ──────────────────────────────────
function conjunto(f, min, max) {
  f = String(f || '*');
  if (f === '*' || f === '?') return null;
  const s = new Set();
  for (const parte of f.split(',')) {
    const [r, st] = parte.split('/');
    const passo = st ? Math.max(1, parseInt(st, 10) || 1) : 1;
    let a, b;
    if (r === '*') { a = min; b = max; }
    else if (r.includes('-')) { [a, b] = r.split('-').map(n => parseInt(n, 10)); }
    else { a = parseInt(r, 10); b = st ? max : a; }
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    for (let v = a; v <= b; v += passo) s.add(max === 6 ? v % 7 : v); // dia da semana 7 = domingo
  }
  return s;
}
const SP_OFFSET_MS = -3 * 3600e3; // Brasília (sem horário de verão desde 2019)
function anterior(expr, ateMs, tz) {
  const p = String(expr || '').trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [mi, ho, dm, me, dw] = [conjunto(p[0], 0, 59), conjunto(p[1], 0, 23), conjunto(p[2], 1, 31), conjunto(p[3], 1, 12), conjunto(p[4], 0, 6)];
  const sp = !tz || /sao_paulo/i.test(tz);
  const partes = (ms) => {
    const d = sp ? new Date(ms + SP_OFFSET_MS) : new Date(ms);
    return sp ? { mi: d.getUTCMinutes(), ho: d.getUTCHours(), dm: d.getUTCDate(), me: d.getUTCMonth() + 1, dw: d.getUTCDay() }
      : { mi: d.getMinutes(), ho: d.getHours(), dm: d.getDate(), me: d.getMonth() + 1, dw: d.getDay() };
  };
  const diaOk = (x) => {
    if (me && !me.has(x.me)) return false;
    if (dm && dw) return dm.has(x.dm) || dw.has(x.dw); // regra do cron: um OU outro
    if (dm && !dm.has(x.dm)) return false;
    if (dw && !dw.has(x.dw)) return false;
    return true;
  };
  let t = Math.floor(ateMs / 60000) * 60000;
  const limite = t - 35 * 86400e3;
  while (t > limite) {
    const x = partes(t);
    if (!diaOk(x) || (ho && !ho.has(x.ho))) { t -= (x.mi + 1) * 60000; continue; } // pula para o fim da hora anterior
    if (!mi || mi.has(x.mi)) return t;
    t -= 60000;
  }
  return null;
}

// ── Leitura para o painel ──────────────────────────────────────────────────
const FOLGA_MS = 10 * 60 * 1000;      // dá 10 min para o disparo aparecer
const FALHA_VALE_MS = 24 * 3600e3;    // falha some do cartão depois de 24h (ou no próximo disparo)
function situacao(agora = Date.now()) {
  const o = ler();
  if (!o || !o.registrados) return null;
  const desde = Date.parse(o.desde || '') || agora;
  const itens = [];
  for (const [chave, r] of Object.entries(o.registrados)) {
    const previsto = anterior(r.expr, agora - FOLGA_MS, r.tz);
    const disparo = Date.parse((o.disparos || {})[chave] || '') || 0;
    const f = (o.falhas || {})[chave];
    const falhaEm = f ? (Date.parse(f.em) || 0) : 0;
    let estado = 'ok';
    if (falhaEm && falhaEm >= disparo && agora - falhaEm < FALHA_VALE_MS) estado = 'falhou';
    else if (previsto && previsto >= Math.max(desde, Date.parse(r.desde || '') || 0) && disparo < previsto - 2 * 60000) estado = 'perdeu';
    else if (!disparo) estado = 'aguardando';
    itens.push({ chave, expr: r.expr, previsto, disparo, falha: estado === 'falhou' ? { em: falhaEm, msg: f.msg || '' } : null, estado });
  }
  return { desde, boot: Date.parse(o.boot || '') || 0, itens };
}

module.exports = { iniciar, agendar, falhou, anterior, situacao, ARQ, esperando, pegouVez, desistiu, liberou, interrompido, proximo, disparar, ARQ_FILA };

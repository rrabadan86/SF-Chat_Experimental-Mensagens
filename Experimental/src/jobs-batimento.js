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
  return cron.schedule(expr, function (...a) {
    try { est.disparos[chave] = new Date().toISOString(); gravar(); } catch (_) {}
    return als.run({ chave }, () => fn.apply(this, a));
  }, opts);
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

module.exports = { iniciar, agendar, falhou, anterior, situacao, ARQ };

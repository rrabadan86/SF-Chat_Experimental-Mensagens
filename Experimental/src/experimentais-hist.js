/**
 * experimentais-hist.js — HISTÓRICO das aulas experimentais lidas no EVO.
 *
 * A agenda de experimentais do EVO traz, em cada linha: aluna, dia/horário,
 * PROFESSORA, status (presença/falta…) e o "Nome do contrato" (preenchido quando
 * a experimental virou aluna). Vários jobs já liam essa tabela e descartavam;
 * aqui guardamos, para a tela Indicadores → Professoras (conversão por professora).
 *
 * data/experimentais-historico.json:
 *   { aulas: { "<dia>|<hora>|<id ou nome>": { dia, hora, prof, nome, id, status, contrato, visto } },
 *     lidos: { "<dia>": ms }, status: { estado, inicio, fim, msg, dias, aulas },
 *     cfg: { desde: "YYYY-MM-DD" } }   ← até onde buscar para trás (escolhido no painel)
 *
 * Ler um dia SUBSTITUI o que havia dele (status e contrato mudam com o tempo).
 * Se a leitura volta vazia, mantém o que já havia (pode ter sido lentidão do EVO).
 */
const fs = require('fs');
const path = require('path');

const ARQ = path.resolve(__dirname, '..', 'data', 'experimentais-historico.json');

function ler() {
  try {
    const o = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
    return { aulas: (o && o.aulas) || {}, lidos: (o && o.lidos) || {}, status: (o && o.status) || {}, cfg: (o && o.cfg) || {} };
  } catch (_) { return { aulas: {}, lidos: {}, status: {}, cfg: {} }; }
}
function gravar(h) {
  const dir = path.dirname(ARQ);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(h), 'utf8');
  fs.renameSync(tmp, ARQ);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// "DD/MM/YYYY" → "YYYY-MM-DD"
function diaIso(dataBR) {
  const m = String(dataBR || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// Classifica o status do EVO: 'veio' | 'faltou' | 'cancelada' | 'agendada'.
function situacao(status) {
  const s = norm(status);
  if (s.includes('presen') || s.includes('realizad')) return 'veio';
  if (s.includes('falta') || s.includes('justificad') || s.includes('ausent')) return 'faltou';
  if (s.includes('cancel')) return 'cancelada';
  return 'agendada';
}

// A coluna da professora é achada por exclusão (scraper); se por acaso vier o
// status ou o contrato no lugar, descarta.
function limparProf(a) {
  const p = String(a.professor || '').replace(/\s+/g, ' ').trim();
  if (!p) return '';
  const n = norm(p);
  if (/^(presen|falta|ausent|justificad|confirmad|cancelad|pendente|agendad|realizad)/.test(n)) return '';
  if (a.contrato && n === norm(a.contrato)) return '';
  return p;
}

/** Grava as aulas lidas de UM dia (dataBR = DD/MM/YYYY). Devolve quantas gravou. */
function registrarDia(dataBR, aulas) {
  const dia = diaIso(dataBR);
  if (!dia) return 0;
  const lista = (Array.isArray(aulas) ? aulas : []).filter(a => a && a.name);
  const h = ler();
  if (lista.length) {
    for (const k of Object.keys(h.aulas)) if (h.aulas[k].dia === dia) delete h.aulas[k];
    for (const a of lista) {
      const hora = String(a.time || '').trim();
      const id = String(a.id || '').trim();
      const k = `${dia}|${hora}|${id || norm(a.name)}`;
      h.aulas[k] = { dia, hora, prof: limparProf(a), nome: String(a.name).trim(), id, status: String(a.status || '').trim(), contrato: String(a.contrato || '').trim(), visto: Date.now() };
    }
  }
  h.lidos[dia] = Date.now();
  gravar(h);
  return lista.length;
}

function setStatus(st) {
  const h = ler();
  h.status = Object.assign({}, h.status, st);
  gravar(h);
}

// ── Quais dias ler no EVO ────────────────────────────────────────────────────
// Toda vez: os últimos 30 dias (presença e contrato mudam depois da aula). Mais um
// lote dos dias ANTIGOS ainda não lidos, até a data de início (padrão: 90 dias atrás;
// o painel pode escolher outra, ex.: 01/01 para o ano todo). Domingo não tem aula.
const JANELA = 30;
const HISTORICO_PADRAO = 90;
function dataBR(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function limiteDias(h) {
  const desde = (h || ler()).cfg.desde;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) return HISTORICO_PADRAO;
  const hoje = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00');
  const dias = Math.floor((hoje - new Date(desde + 'T12:00:00')) / 86400000) + 1;
  return Math.max(JANELA, Math.min(dias, 1500));
}
// Dias antigos (fora dos 30 recentes) que ainda faltam ler até a data de início.
function antigosPendentes(h) {
  h = h || ler();
  const out = [];
  for (let i = JANELA, lim = limiteDias(h); i < lim; i++) {
    const d = diasAtras(i);
    if (d.getDay() !== 0 && !h.lidos[diaIso(dataBR(d))]) out.push(dataBR(d));
  }
  return out;
}
function datasParaLer(extras) {
  const out = [];
  for (let i = 0; i < JANELA; i++) { const d = diasAtras(i); if (d.getDay() !== 0) out.push(dataBR(d)); }
  return out.concat(antigosPendentes().slice(0, Math.max(0, extras | 0)));
}
function definirDesde(dia) {
  const h = ler();
  h.cfg = Object.assign({}, h.cfg, { desde: /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : '' });
  gravar(h);
}

// ── Achar a experimental de uma pessoa (pelo nome) ──────────────────────────
// O CRM e o EVO nem sempre têm o nome igual (o do WhatsApp pode vir sem o meio).
// Casa pelo nome inteiro; se não achar, pelo 1º + último nome.
function chavesNome(nome) {
  const n = norm(nome).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return [];
  const p = n.split(' ');
  return p.length > 1 ? [n, p[0] + ' ' + p[p.length - 1]] : [n];
}
function indicePorNome(h) {
  const idx = new Map();
  for (const a of Object.values((h || ler()).aulas)) {
    if (situacao(a.status) === 'cancelada') continue;
    chavesNome(a.nome).forEach((k, i) => {
      const kk = (i ? '~' : '=') + k;
      (idx.get(kk) || idx.set(kk, []).get(kk)).push(a);
    });
  }
  return idx;
}
// A aula experimental da pessoa: a 1ª a partir de `desdeDia` (YYYY-MM-DD, ex.: o
// dia em que agendou); se não houver, a mais recente. null se não achar.
function acharAula(idx, nome, desdeDia) {
  const ks = chavesNome(nome);
  let lista = ks.length ? idx.get('=' + ks[0]) : null;
  if (!lista && ks[1]) lista = idx.get('~' + ks[1]) || idx.get('=' + ks[1]);
  if (!lista && ks.length === 1) lista = idx.get('~' + ks[0]);
  if (!lista || !lista.length) return null;
  // Pelo 1º + último nome só vale se for UMA pessoa (ex.: duas "Ana Silva" → não arrisca).
  if (new Set(lista.map(a => norm(a.nome))).size > 1 && !idx.get('=' + ks[0])) return null;
  const ord = lista.slice().sort((a, b) => (a.dia + a.hora).localeCompare(b.dia + b.hora));
  return (desdeDia && ord.find(a => a.dia >= desdeDia)) || ord[ord.length - 1];
}

module.exports = { ARQ, ler, registrarDia, setStatus, situacao, diaIso, norm, datasParaLer, antigosPendentes, definirDesde, limiteDias, HISTORICO_PADRAO, indicePorNome, acharAula, chavesNome };

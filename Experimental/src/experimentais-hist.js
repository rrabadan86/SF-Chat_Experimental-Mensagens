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
 *     lidos: { "<dia>": ms }, status: { estado, inicio, fim, msg, dias, aulas } }
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
    return { aulas: (o && o.aulas) || {}, lidos: (o && o.lidos) || {}, status: (o && o.status) || {} };
  } catch (_) { return { aulas: {}, lidos: {}, status: {} }; }
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

module.exports = { ARQ, ler, registrarDia, setStatus, situacao, diaIso, norm };

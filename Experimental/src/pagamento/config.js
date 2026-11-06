/**
 * pagamento/config.js — regras do pagamento e o percentual/piso/teto de cada
 * professor (com histórico por mês de início). Arquivo: data/pagamento/config.json
 */
const fs = require('fs');
const path = require('path');

const ARQ = path.resolve(__dirname, '..', '..', 'data', 'pagamento', 'config.json');

// Regras que antes estavam fixas no código do sf-pagamento (valores do Bueno).
const REGRAS_PADRAO = {
  freeValor: 11,          // R$ por presença de aluna Free / avulsa / reposição com plano Free
  sabadoValor: 70,        // diária do sábado, uma por sábado, independente de quantas aulas
  descontoFixoPct: 3,     // % descontado da mensalidade das fixas antes do rateio (taxa)
  pctPadrao: 20,          // % do professor sem configuração própria
  pisoPadrao: 55,         // R$ mínimo por aula
  tetoPadrao: 90,         // R$ máximo por aula
  capacidade: 9,          // presenças máximas por aula (acima disso = aviso de lançamento errado)
  vipZero: ['juliana quintiliano', 'paula vanessa carmo', 'amanda ferreira de castro', 'lorena dos santos silva amorim'],
};
const LIMITES = { freeValor: [0, 500], sabadoValor: [0, 1000], descontoFixoPct: [0, 50], pctPadrao: [0, 100], pisoPadrao: [0, 1000], tetoPadrao: [0, 2000], capacidade: [1, 50] };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function ler() {
  let o = {}; try { o = JSON.parse(fs.readFileSync(ARQ, 'utf8')) || {}; } catch (_) {}
  const regras = Object.assign({}, REGRAS_PADRAO, o.regras || {});
  if (!Array.isArray(regras.vipZero)) regras.vipZero = REGRAS_PADRAO.vipZero.slice();
  return { regras, professores: o.professores || {} };
}
function gravar(cfg) {
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  const tmp = ARQ + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, ARQ);
}

function salvarRegras(v) {
  const cfg = ler();
  for (const k of Object.keys(LIMITES)) {
    if (v[k] === undefined || v[k] === '') continue;
    const n = Number(String(v[k]).replace(',', '.'));
    if (!Number.isFinite(n) || n < LIMITES[k][0] || n > LIMITES[k][1]) throw new Error(`Valor inválido em "${k}".`);
    cfg.regras[k] = n;
  }
  if (v.vipZero !== undefined) cfg.regras.vipZero = String(v.vipZero).split(/\n|;/).map(s => norm(s)).filter(Boolean);
  if (cfg.regras.pisoPadrao > cfg.regras.tetoPadrao) throw new Error('O piso não pode ser maior que o teto.');
  gravar(cfg); return cfg.regras;
}

// Percentual vigente de um professor num mês ('AAAA-MM'): o registro mais recente
// com "desde" <= mês. Sem registro → padrão das regras (configurado: false).
function vigente(cfg, chave, ym) {
  const p = cfg.professores[chave];
  const hist = (p && p.hist) || [];
  const r = hist.filter(h => String(h.desde) <= ym).sort((a, b) => String(b.desde).localeCompare(String(a.desde)))[0];
  if (!r) return { pct: cfg.regras.pctPadrao, piso: cfg.regras.pisoPadrao, teto: cfg.regras.tetoPadrao, configurado: false };
  return { pct: Number(r.pct), piso: Number(r.piso), teto: Number(r.teto), configurado: true, desde: r.desde };
}

function salvarProfessor(chave, nome, { desde, pct, piso, teto }) {
  chave = String(chave || '').trim(); if (!chave) throw new Error('Professor sem identificação.');
  if (!/^\d{4}-\d{2}$/.test(String(desde || ''))) throw new Error('Mês de início inválido (use AAAA-MM).');
  const n = (x) => Number(String(x).replace(',', '.'));
  const r = { desde: String(desde), pct: n(pct), piso: n(piso), teto: n(teto) };
  if (![r.pct, r.piso, r.teto].every(Number.isFinite) || r.pct < 0 || r.pct > 100 || r.piso < 0 || r.teto < r.piso) throw new Error('Confira percentual (0–100), piso e teto (teto ≥ piso).');
  const cfg = ler();
  const p = cfg.professores[chave] || { nome: nome || chave, hist: [] };
  if (nome) p.nome = nome;
  p.hist = (p.hist || []).filter(h => h.desde !== r.desde).concat([r]).sort((a, b) => a.desde.localeCompare(b.desde));
  cfg.professores[chave] = p; gravar(cfg); return p;
}
function removerVigencia(chave, desde) {
  const cfg = ler(); const p = cfg.professores[chave]; if (!p) return;
  p.hist = (p.hist || []).filter(h => h.desde !== desde); gravar(cfg);
}

/**
 * Importa o CSV da tabela ProfessorPercentual do Supabase (sf-pagamento).
 * Lá o professor é identificado pelo NOME (idProfessorEvo = nome); aqui casamos
 * pelo nome com os professores da grade do EVO (nomesParaChave: nome → chave).
 */
function importarCsvSupabase(csv, nomesParaChave) {
  const linhas = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) throw new Error('CSV vazio.');
  const sep = linhas[0].includes(';') && !linhas[0].includes(',') ? ';' : ',';
  const parse = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const cab = parse(linhas[0]).map(c => c.toLowerCase());
  const col = (nome) => cab.indexOf(nome.toLowerCase());
  const iNome = col('nomeProfessor') >= 0 ? col('nomeProfessor') : col('idProfessorEvo');
  const iPct = col('percentual'), iPiso = col('piso'), iTeto = col('teto'), iIni = col('dataInicio');
  if (iNome < 0 || iPct < 0) throw new Error('Não achei as colunas nomeProfessor/percentual no CSV.');
  const cfg = ler(); const res = { importados: 0, semPar: [] };
  const mapa = new Map(Object.entries(nomesParaChave || {}).map(([nm, ch]) => [norm(nm), ch]));
  for (const l of linhas.slice(1)) {
    const c = parse(l); const nome = c[iNome]; if (!nome) continue;
    const chave = mapa.get(norm(nome)) || ('nome:' + norm(nome));
    if (!mapa.has(norm(nome))) res.semPar.push(nome);
    const desde = /^\d{4}-\d{2}/.test(c[iIni] || '') ? String(c[iIni]).slice(0, 7) : '2000-01';
    const r = { desde, pct: Number(c[iPct]), piso: iPiso >= 0 ? Number(c[iPiso]) : cfg.regras.pisoPadrao, teto: iTeto >= 0 ? Number(c[iTeto]) : cfg.regras.tetoPadrao };
    if (![r.pct, r.piso, r.teto].every(Number.isFinite)) continue;
    const p = cfg.professores[chave] || { nome, hist: [] };
    p.hist = (p.hist || []).filter(h => h.desde !== r.desde).concat([r]).sort((a, b) => a.desde.localeCompare(b.desde));
    cfg.professores[chave] = p; res.importados++;
  }
  gravar(cfg); return res;
}

module.exports = { ler, salvarRegras, vigente, salvarProfessor, removerVigencia, importarCsvSupabase, REGRAS_PADRAO, LIMITES, norm };

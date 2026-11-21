/**
 * agendou-registro.js — de onde saem os AGENDAMENTOS de aula experimental que o painel conta
 * (Funil, Professoras, Metas, resumo da semana e o encerramento do follow-up).
 *
 * Antes a conta vinha só do histórico de etiquetas (sofia-tag-log.jsonl), lido pelo
 * fim. Dois furos faziam o Funil mostrar quase nada:
 *   1. o agendamento só entrava no histórico se a unidade tivesse uma etiqueta com o
 *      gatilho "agendou" — sem ela, nada era anotado;
 *   2. só as últimas 8000 linhas eram lidas: uma troca de etiqueta em lote em milhares
 *      de contatos empurrava os agendamentos para fora da leitura.
 *
 * Agora cada agendamento é anotado NA HORA num arquivo próprio
 * (sofia-agendamentos.jsonl, uma linha por agendamento, nunca apagado), e a leitura
 * junta três fontes para não perder o que já passou:
 *   • o registro próprio (daqui para a frente);
 *   • o histórico de etiquetas INTEIRO (o passado; e a etiqueta posta à mão);
 *   • sofia-agendaram-aula.json (o último agendamento de cada telefone, com data —
 *     existe mesmo onde não havia etiqueta de "agendou").
 * O mesmo agendamento visto em mais de uma fonte vira um só (até 2 h de diferença).
 *
 * Só leitura de arquivos e contas — sem HTML.
 */
const fs = require('fs');
const path = require('path');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');

const ARQ = path.join(sofia.DIR, 'sofia-agendamentos.jsonl');
const ARQ_TAGLOG = path.join(sofia.DIR, 'sofia-tag-log.jsonl');
const ARQ_AULA = path.join(sofia.DIR, 'sofia-agendaram-aula.json');
const ARQ_LISTA = path.join(sofia.DIR, 'sofia-agendaram.json');
const ARQ_CANAL = path.join(sofia.DIR, 'sofia-agendaram-canal.json');
const JUNTA_MS = 2 * 3600 * 1000;

const l8De = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const lerJson = (arq, padrao) => { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o == null ? padrao : o; } catch (_) { return padrao; } };

// Anota os agendamentos que acabaram de chegar (SoFIA, Formulário ou Express).
// Chamado ANTES de qualquer etiqueta ou aviso: não depende de configuração nenhuma.
function registrar(evs) {
  let linhas = '';
  for (const ev of (evs || [])) {
    const tel = String((ev && ev.telefone) || '').replace(/\D/g, '');
    if (!tel) continue;
    linhas += JSON.stringify({ tel, nome: String(ev.nome || '').trim().slice(0, 120), when: String(ev.when || '').trim().slice(0, 60), canal: String(ev.canal || '').trim().toLowerCase(), em: Number(ev.em) || Date.now() }) + '\n';
  }
  if (!linhas) return 0;
  fs.appendFileSync(ARQ, linhas, 'utf8');
  return linhas.split('\n').length - 1;
}

function lerRegistro() {
  let txt = '';
  try { txt = fs.readFileSync(ARQ, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const l of txt.split('\n')) {
    const s = l.trim(); if (!s) continue;
    try { const o = JSON.parse(s); if (o && o.tel && Number(o.em) > 0) out.push(o); } catch (_) {}
  }
  return out;
}

let _cache = null;
const carimbo = (etiquetas) => [ARQ, ARQ_TAGLOG, ARQ_AULA, ARQ_LISTA, ARQ_CANAL].map(a => { try { const s = fs.statSync(a); return s.mtimeMs + ':' + s.size; } catch (_) { return '-'; } }).join('|') + '|' + etiquetas.join('\u0001');

// Lê tudo e monta:
//   pessoas : { <8 últimos dígitos>: [ { em, canal, when, manual, por, sistema } … ] } — em ordem de data
//             canal   = sofia | formulario | express | '' (não gravado)
//             manual  = etiqueta de "agendou" posta à mão em Contatos (por = quem)
//             sistema = agendamento feito de verdade (SoFIA, Formulário ou Express)
//   semData : [ { l8, tel, canal } ] — agendou (está na lista do follow-up) mas não
//             sobrou data em lugar nenhum; só dá para contar em "todo o período"
//   inicio  : instante do registro mais antigo (0 = nada) — antes dele, "0 agendaram"
//             é falta de registro, não falta de agendamento
function tudo() {
  let etiquetas = [];
  try { etiquetas = contatos.tagsPorGatilho('agendou').map(a => String(a.tag || '').trim()).filter(Boolean); } catch (_) {}
  const chave = carimbo(etiquetas);
  if (_cache && _cache.chave === chave) return _cache.dados;

  const bruto = {};
  let inicio = Infinity;
  const por = (l8) => bruto[l8] || (bruto[l8] = []);
  for (const o of lerRegistro()) {
    const l8 = l8De(o.tel); if (!l8) continue;
    const em = Number(o.em);
    if (em < inicio) inicio = em;
    por(l8).push({ em, canal: String(o.canal || '').trim().toLowerCase(), when: String(o.when || ''), sistema: true });
  }
  let tl = {};
  try { tl = sofia.lerTagLog({ tudo: true }) || {}; } catch (_) {}
  for (const l8 in tl) {
    for (const e of tl[l8]) {
      if (!e || !e.em) continue;
      if (e.em < inicio) inicio = e.em;
      if (e.acao !== 'add') continue;
      const doSistema = e.motivo === 'agendou';
      if (!doSistema && !etiquetas.includes(String(e.tag || '').trim())) continue;
      const canal = String(e.canal || '').trim();
      por(l8).push({ em: e.em, canal, when: '', sistema: doSistema, manual: !canal && e.motivo === 'manual', por: String(e.por || '').trim() });
    }
  }
  const aula = lerJson(ARQ_AULA, {});
  if (aula && typeof aula === 'object' && !Array.isArray(aula)) {
    for (const k in aula) {
      const a = aula[k], l8 = l8De(k), em = Number(a && a.em) || 0;
      if (!l8 || !em) continue;
      if (em < inicio) inicio = em;
      por(l8).push({ em, canal: String(a.canal || '').trim().toLowerCase(), when: String(a.when || ''), sistema: true });
    }
  }

  // O mesmo agendamento em mais de uma fonte (ou a etiqueta posta logo depois) = um só.
  const pessoas = {};
  for (const l8 in bruto) {
    const evs = bruto[l8].sort((a, b) => a.em - b.em);
    const out = [];
    for (const e of evs) {
      const u = out[out.length - 1];
      if (u && e.em - u.em <= JUNTA_MS) {
        if (e.sistema && !u.sistema) { u.sistema = true; }
        if (e.canal && (!u.canal || (u.manual && !e.manual))) u.canal = e.canal;
        if (!e.manual) { u.manual = false; u.por = ''; }
        if (e.when && !u.when) u.when = e.when;
        continue;
      }
      out.push({ em: e.em, canal: e.canal || '', when: e.when || '', sistema: !!e.sistema, manual: !!e.manual, por: e.manual ? (e.por || '') : '' });
    }
    pessoas[l8] = out;
  }

  const canalMap = lerJson(ARQ_CANAL, {});
  const semData = [], visto = new Set();
  const lista = lerJson(ARQ_LISTA, []);
  for (const t of (Array.isArray(lista) ? lista : [])) {
    const tel = String(t || '').replace(/\D/g, ''), l8 = l8De(tel);
    if (!l8 || pessoas[l8] || visto.has(l8)) continue;
    visto.add(l8);
    semData.push({ l8, tel, canal: String((canalMap && canalMap[l8]) || '').trim().toLowerCase() });
  }

  const dados = { pessoas, semData, inicio: inicio === Infinity ? 0 : inicio };
  _cache = { chave, dados };
  return dados;
}

const porPessoa = () => tudo().pessoas;
// Agendamentos de UMA pessoa (lista em ordem de data; vazia se não há).
const de = (tel) => tudo().pessoas[l8De(tel)] || [];
// Agendou de verdade (SoFIA, Formulário ou Express) a partir de `desde`?
const agendouDesde = (tel, desde) => de(tel).some(e => e.sistema && e.em >= (Number(desde) || 0));

module.exports = { ARQ, registrar, lerRegistro, tudo, porPessoa, de, agendouDesde, l8De };

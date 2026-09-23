/**
 * auto-tag-alunas.js — Mantém as tags "0. Aluna" e "0. Ex Aluna" no CRM da SoFIA
 * em sincronia com a leitura de ALUNAS ATIVAS do EVO (a mesma da planilha de
 * aniversários). Roda JUNTO da planilha (1x/dia), então não faz leitura extra.
 *
 * Regra (casando por TELEFONE — últimos 8 dígitos, tolera o 9º):
 *   - Aluna ATIVA (contrato vigente = está na lista de ativas / "SIM" na planilha)
 *     → põe "0. Aluna" e tira "0. Ex Aluna". Cadastra o contato se ainda não existir.
 *   - Contato que TINHA "0. Aluna" mas NÃO está mais entre as ativas → virou
 *     ex-aluna (sem vínculo) → põe "0. Ex Aluna" e tira "0. Aluna".
 *
 * Só age "daqui pra frente": um ex-aluno que saiu ANTES de a automação existir
 * (e nunca teve a tag "0. Aluna") não é reetiquetado — o passado já está no CRM.
 *
 * Config editável no painel: data/auto-tag-alunas.json { on, tagAluna, tagExAluna }
 */
const fs = require('fs');
const path = require('path');
const contatos = require('./contatos');

const ARQ = path.resolve(__dirname, '..', 'data', 'auto-tag-alunas.json');
const PADRAO = { on: false, tagAluna: '0. Aluna', tagExAluna: '0. Ex Aluna' };

function ler() {
  let o = {};
  try { const p = JSON.parse(fs.readFileSync(ARQ, 'utf8')); if (p && typeof p === 'object') o = p; } catch (_) {}
  return {
    on: !!o.on,
    tagAluna: String(o.tagAluna || PADRAO.tagAluna).trim() || PADRAO.tagAluna,
    tagExAluna: String(o.tagExAluna || PADRAO.tagExAluna).trim() || PADRAO.tagExAluna,
  };
}
function gravar(cfg) {
  const o = {
    on: !!(cfg && cfg.on),
    tagAluna: String((cfg && cfg.tagAluna) || PADRAO.tagAluna).trim() || PADRAO.tagAluna,
    tagExAluna: String((cfg && cfg.tagExAluna) || PADRAO.tagExAluna).trim() || PADRAO.tagExAluna,
  };
  try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQ, JSON.stringify(o, null, 2), 'utf8');
  return o;
}

const last8 = (x) => String(x || '').replace(/\D/g, '').slice(-8);
const norm = (t) => String(t || '').trim().toLowerCase();

/**
 * Sincroniza as tags a partir da lista de ALUNAS ATIVAS (com telefone) do EVO.
 * @param {Array<{id?,nome?,telefone?}>} ativas
 * @param {{dry?:boolean}} opts  dry=true só simula (não grava tag nenhuma).
 * @returns {{on,dry,alunasNovas,alunasAtualizadas,exAlunas,semTelefone,abortado,...}}
 */
function sincronizarTags(ativas, { dry = false } = {}) {
  const cfg = ler();
  const r = { on: cfg.on, dry: !!dry, alunasNovas: 0, alunasAtualizadas: 0, exAlunas: 0, semTelefone: 0, abortado: false };
  // Em modo real, só age se estiver ligado. Em --dry, mostra o que FARIA mesmo desligado.
  if (!cfg.on && !dry) { r.desligado = true; return r; }
  if (!Array.isArray(ativas)) { r.erro = 'lista de ativas inválida'; return r; }

  const alunaLc = norm(cfg.tagAluna), exLc = norm(cfg.tagExAluna);

  let mapa = {};
  try { mapa = contatos.carregar() || {}; } catch (e) { r.erro = 'não consegui ler os contatos: ' + (e && e.message); return r; }

  // Índice telefone(last8) → { key, contato } e contagem de quem já é "0. Aluna".
  const idx = new Map();
  let alunasAntes = 0;
  for (const tel in mapa) {
    const k = last8(tel); if (k && !idx.has(k)) idx.set(k, { key: tel, c: mapa[tel] });
    if ((mapa[tel].tags || []).some(t => norm(t) === alunaLc)) alunasAntes++;
  }

  // Telefones das ativas de hoje.
  const ativasTel = new Set();
  for (const a of ativas) { const k = last8(a.telefone); if (k) ativasTel.add(k); else r.semTelefone++; }

  // 1. ATIVAS → "0. Aluna" (cadastra se faltar; tira "0. Ex Aluna").
  for (const a of ativas) {
    const tel = String(a.telefone || '').replace(/\D/g, '');
    if (!tel) continue;
    const achou = idx.get(last8(tel));
    const jaAluna = achou && (achou.c.tags || []).some(t => norm(t) === alunaLc);
    if (!achou) r.alunasNovas++; else if (!jaAluna) r.alunasAtualizadas++;
    if (!dry) {
      try { contatos.adicionarTag(tel, a.nome || (achou && achou.c.nome) || '', cfg.tagAluna); } catch (_) {}
      if (achou && (achou.c.tags || []).some(t => norm(t) === exLc)) { try { contatos.removerTag(tel, cfg.tagExAluna); } catch (_) {} }
    }
  }

  // TRAVA DE SEGURANÇA: se a leitura veio suspeita (poucas ativas × muitas já
  // marcadas), NÃO rebaixa ninguém para ex-aluna — evita virar todo mundo
  // ex-aluna por um soluço do EVO. (As "0. Aluna" acima são seguras de aplicar.)
  if (alunasAntes >= 10 && ativasTel.size < alunasAntes * 0.5) {
    r.abortado = true;
    r.motivoAborto = `leitura suspeita: ${ativasTel.size} ativa(s) × ${alunasAntes} já marcada(s) — não rebaixei ninguém para ex-aluna.`;
    return r;
  }

  // 2. Quem TINHA "0. Aluna" e NÃO está mais entre as ativas → "0. Ex Aluna".
  for (const [k, v] of idx) {
    if (!(v.c.tags || []).some(t => norm(t) === alunaLc)) continue; // não era aluna
    if (ativasTel.has(k)) continue;                                  // segue ativa
    r.exAlunas++;
    if (!dry) {
      try { contatos.removerTag(v.key, cfg.tagAluna); } catch (_) {}
      try { contatos.adicionarTag(v.key, v.c.nome || '', cfg.tagExAluna); } catch (_) {}
    }
  }

  return r;
}

module.exports = { ler, gravar, sincronizarTags, PADRAO };

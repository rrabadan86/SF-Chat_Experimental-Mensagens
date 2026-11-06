/**
 * pagamento/ajustes.js — ajustes manuais do cálculo de um mês, GUARDADOS (no
 * sf-pagamento eles valiam só até recarregar a página):
 *   - exclusão de aluna com motivo: só na aula (sessão), em todas as aulas do
 *     professor, ou em todas as aulas do mês (global — "Gestão Central");
 *   - inserção de aluna numa aula (conta com o valor do plano dela);
 *   - horário oculto na matriz (o "×": tira o horário de seg a sex do cálculo).
 * Arquivo: data/pagamento/ajustes-AAAA-MM.json. Cada item guarda quem fez e quando.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', '..', 'data', 'pagamento');
const arq = (ym) => path.join(DIR, `ajustes-${ym}.json`);
const okYm = (ym) => /^\d{4}-\d{2}$/.test(String(ym || ''));

function ler(ym) {
  if (!okYm(ym)) return { exclusoes: [], insercoes: [], ocultos: [] };
  let o = {}; try { o = JSON.parse(fs.readFileSync(arq(ym), 'utf8')) || {}; } catch (_) {}
  return { exclusoes: o.exclusoes || [], insercoes: o.insercoes || [], ocultos: o.ocultos || [] };
}
function gravar(ym, a) { fs.mkdirSync(DIR, { recursive: true }); const t = arq(ym) + '.tmp'; fs.writeFileSync(t, JSON.stringify(a, null, 2)); fs.renameSync(t, arq(ym)); }
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function excluir(ym, { m, nome, escopo, prof, profNome, s, sDesc, motivo, de, ate }, por) {
  if (!okYm(ym)) throw new Error('Mês inválido.');
  m = Number(m); if (!m) throw new Error('Aluna inválida.');
  // "periodo": todas as aulas da aluna entre de e ate (AAAA-MM-DD), de qualquer
  // professor — usado na prorrogação do contrato por trancamento.
  if (!['sessao', 'prof', 'global', 'periodo'].includes(escopo)) throw new Error('Escolha onde excluir.');
  const dia = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  if (escopo === 'periodo' && (!dia(de) || !dia(ate) || dia(de) > dia(ate))) throw new Error('Período inválido.');
  motivo = String(motivo || '').trim(); if (motivo.length < 3) throw new Error('Informe o motivo da exclusão.');
  if (escopo !== 'global' && escopo !== 'periodo' && !prof) throw new Error('Professor não informado.');
  if (escopo === 'sessao' && !s) throw new Error('Aula não informada.');
  const a = ler(ym);
  a.exclusoes.push({ id: novoId(), m, nome: String(nome || ''), escopo, prof: (escopo === 'global' || escopo === 'periodo') ? '' : String(prof), profNome: String(profNome || ''), s: escopo === 'sessao' ? String(s) : '', sDesc: String(sDesc || ''), ...(escopo === 'periodo' ? { de: dia(de), ate: dia(ate) } : {}), motivo: motivo.slice(0, 500), por: por || '', em: new Date().toISOString() });
  gravar(ym, a); return a;
}
function inserir(ym, { m, nome, s, sDesc, prof, motivo }, por) {
  if (!okYm(ym)) throw new Error('Mês inválido.');
  m = Number(m); if (!m || !s) throw new Error('Escolha a aluna e a aula.');
  const a = ler(ym);
  if (a.insercoes.some(x => x.m === m && String(x.s) === String(s))) throw new Error('Essa aluna já foi incluída nesta aula.');
  a.insercoes.push({ id: novoId(), m, nome: String(nome || ''), s: String(s), sDesc: String(sDesc || ''), prof: String(prof || ''), motivo: String(motivo || '').trim().slice(0, 500), por: por || '', em: new Date().toISOString() });
  gravar(ym, a); return a;
}
function desfazer(ym, id) {
  const a = ler(ym);
  a.exclusoes = a.exclusoes.filter(x => x.id !== id);
  a.insercoes = a.insercoes.filter(x => x.id !== id);
  gravar(ym, a); return a;
}
function alternarOculto(ym, h, por) {
  if (!okYm(ym) || !/^\d{2}:\d{2}$/.test(String(h || ''))) throw new Error('Horário inválido.');
  const a = ler(ym);
  if (a.ocultos.some(x => x.h === h)) a.ocultos = a.ocultos.filter(x => x.h !== h);
  else a.ocultos.push({ h, por: por || '', em: new Date().toISOString() });
  gravar(ym, a); return a;
}

module.exports = { ler, excluir, inserir, desfazer, alternarOculto };

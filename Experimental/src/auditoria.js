/*
 * auditoria.js — registro de atividades do painel ("quem fez o quê").
 *
 * Cada ação de IMPACTO ou SEGURANÇA (criar/iniciar/pausar campanha, mudar prompt,
 * gerir usuários, bloquear/encerrar, reiniciar/desconectar...) grava uma linha em
 * data/auditoria.jsonl: { em, usuario, acao, alvo, detalhe }.
 *   - usuario: quem fez (do login da sessão)
 *   - acao:    rótulo curto e estável (ex.: "campanha.iniciar")
 *   - alvo:    sobre o quê (ex.: nome da campanha, telefone, usuário)
 *   - detalhe: texto livre opcional
 * A tela Perfis → Auditoria (só admin) lista os mais recentes. Podado para não
 * crescer sem limite. Arquivo é estado por VPS (fora do Git).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const F = path.join(DATA_DIR, 'auditoria.jsonl');
const MANTER = 2000; // linhas mantidas ao podar
const CORTE = 2500;  // poda quando passar disto

function registrar(usuario, acao, alvo, detalhe) {
  const rec = {
    em: Date.now(),
    usuario: String(usuario || '').trim() || '—',
    acao: String(acao || '').trim(),
    alvo: String(alvo || '').trim(),
    detalhe: String(detalhe || '').trim(),
  };
  if (!rec.acao) return;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  try { fs.appendFileSync(F, JSON.stringify(rec) + '\n'); } catch (_) {}
  _podar();
}

function _podar() {
  try {
    const l = fs.readFileSync(F, 'utf8').split('\n').filter(Boolean);
    if (l.length > CORTE) fs.writeFileSync(F, l.slice(-MANTER).join('\n') + '\n');
  } catch (_) {}
}

// Últimos N registros, do mais recente para o mais antigo.
function ler(n) {
  n = Number(n) || 200;
  let l = [];
  try { l = fs.readFileSync(F, 'utf8').split('\n').filter(Boolean); } catch (_) { return []; }
  const out = [];
  for (let i = l.length - 1; i >= 0 && out.length < n; i--) {
    try { const o = JSON.parse(l[i]); if (o && o.acao) out.push(o); } catch (_) {}
  }
  return out;
}

module.exports = { registrar, ler };

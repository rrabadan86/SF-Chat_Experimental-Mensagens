/**
 * Número em aquecimento (SOF-12) — usado pela SoFIA (ChatBot/sofia-listener.ts) e pelo painel.
 *
 * Número novo (ou recém-restringido) que sai mandando mensagem para quem não tem o
 * número salvo é restringido pelo WhatsApp. Em 24/11/2026 o Lago Norte foi restringido
 * duas vezes: a SoFIA conectava e, em segundos, soltava a cobrança que estava na fila.
 *
 * Duas travas para os envios que a SoFIA INICIA (cobrança, campanha, follow-up):
 *  1. Aquecimento ligado no painel (por N dias): não envia. Responder quem escreveu,
 *     os avisos para a equipe e o que a recepção escreve pelo painel continuam.
 *     A cobrança que chega nesse período é descartada (o robô volta a pôr na fila no
 *     próximo dia de cobrança, depois do aquecimento); campanha e follow-up esperam.
 *  2. Sempre, logo depois de conectar: espera QUIETO_MIN minutos (padrão 30) antes do
 *     primeiro envio que ela inicia — nada de rajada na hora em que o vínculo é novo.
 */
const fs = require('fs');
const path = require('path');

const ARQ = 'sofia-aquecimento.json';
const ARQ_FUP = 'sofia-aquecimento-followups.jsonl'; // follow-ups que não saíram no aquecimento (para a recepção retomar)
const FUP_MAX = 500;
const DIAS_MAX = 30;
const QUIETO_MIN_PADRAO = 30;

// Pasta de dados da SoFIA vista do painel e do robô (mesma regra do sofia-editor.js).
function dirPadrao() { return process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot'); }
function hojeSP(agora = Date.now()) { return new Date(agora).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function somaDias(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** → { ate: 'AAAA-MM-DD' | '', desde, dias } */
function ler(dir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, ARQ), 'utf8')) || {};
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(o.ate || '')) ? o.ate : '';
    return { ate, desde: String(o.desde || ''), dias: +o.dias || 0 };
  } catch (_) { return { ate: '', desde: '', dias: 0 }; }
}

/** Liga por `dias` (1–30, contando hoje) ou desliga (0). → o que ficou gravado */
function gravar(dir, dias, agora = Date.now()) {
  const n = Math.max(0, Math.min(DIAS_MAX, Math.floor(+dias || 0)));
  const arq = path.join(dir, ARQ);
  if (!n) { try { fs.rmSync(arq, { force: true }); } catch (_) {} return ler(dir); }
  const hoje = hojeSP(agora);
  fs.mkdirSync(dir, { recursive: true });
  // aquecimento novo, lista nova (ao DESLIGAR a lista fica: é quando a recepção vai retomar)
  if (!ativo(dir, agora)) { try { fs.rmSync(path.join(dir, ARQ_FUP), { force: true }); } catch (_) {} }
  // grava num arquivo ao lado e troca de uma vez: a SoFIA lê este arquivo a cada poucos
  // segundos, e um arquivo pela metade seria lido como "desligado" (soltaria os envios)
  const tmp = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ desde: hoje, ate: somaDias(hoje, n - 1), dias: n }));
  fs.renameSync(tmp, arq);
  return ler(dir);
}

/** Em aquecimento hoje? (vale até o dia `ate`, inclusive) */
function ativo(dir, agora = Date.now()) { const a = ler(dir); return !!a.ate && hojeSP(agora) <= a.ate; }

/**
 * Pode a SoFIA INICIAR um envio agora (cobrança, campanha, follow-up)?
 * → '' (pode) | 'aquecimento' | 'acabou-de-conectar'
 */
function bloqueio({ dir, prontaDesde, agora = Date.now(), quietoMin = QUIETO_MIN_PADRAO }) {
  if (dir && ativo(dir, agora)) return 'aquecimento';
  if (!prontaDesde || agora - prontaDesde < Math.max(0, +quietoMin || 0) * 60000) return 'acabou-de-conectar';
  return '';
}

/**
 * Fila de cobrança em aquecimento: o que descartar (o robô repõe) e o que GUARDAR.
 * Guarda o aviso de "acesso ao app reativado" (tipo "app"): o robô grava uma vez só.
 * @param linhas linhas JSON da fila → { guardar: [linha], descartar: [objeto] }
 */
function separarFila(linhas) {
  const guardar = [], descartar = [];
  for (const linha of linhas || []) {
    let ent = null; try { ent = JSON.parse(linha); } catch (_) { continue; } // linha estragada: fora
    if (ent && String(ent.tipo || '') === 'app') guardar.push(linha); else if (ent) descartar.push(ent);
  }
  return { guardar, descartar };
}

/**
 * Anota os follow-ups que NÃO saíram por causa do aquecimento (a fila é descartada).
 * @param linhasFila linhas JSON da fila de follow-up ({ tel, instrucao, em }) → quantos anotou
 */
function anotarFollowups(dir, linhasFila, agora = Date.now()) {
  const novos = [];
  for (const l of linhasFila || []) {
    let ent = null; try { ent = JSON.parse(l); } catch (_) { continue; }
    const tel = String((ent && ent.tel) || '').replace(/\D/g, '');
    if (tel) novos.push(JSON.stringify({ tel, em: agora }));
  }
  if (!novos.length) return 0;
  const arq = path.join(dir, ARQ_FUP);
  let antigos = [];
  try { antigos = fs.readFileSync(arq, 'utf8').split('\n').filter((x) => x.trim()); } catch (_) {}
  const todos = antigos.concat(novos).slice(-FUP_MAX); // não cresce sem fim
  fs.mkdirSync(dir, { recursive: true });
  const tmp = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, todos.join('\n') + '\n');
  fs.renameSync(tmp, arq);
  return novos.length;
}
/** → [{ tel, em, vezes }] uma linha por telefone, a mais recente primeiro */
function lerFollowups(dir) {
  const porTel = new Map();
  try {
    for (const l of fs.readFileSync(path.join(dir, ARQ_FUP), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let o = null; try { o = JSON.parse(l); } catch (_) { continue; }
      const tel = String((o && o.tel) || '').replace(/\D/g, ''); const em = +(o && o.em) || 0;
      if (!tel) continue;
      const a = porTel.get(tel);
      porTel.set(tel, { tel, em: Math.max(em, a ? a.em : 0), vezes: (a ? a.vezes : 0) + 1 });
    }
  } catch (_) {}
  return [...porTel.values()].sort((a, b) => b.em - a.em);
}

module.exports = { ARQ, ARQ_FUP, anotarFollowups, lerFollowups, DIAS_MAX, QUIETO_MIN_PADRAO, dirPadrao, ler, gravar, ativo, bloqueio, separarFila, hojeSP };

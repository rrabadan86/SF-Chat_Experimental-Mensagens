/**
 * sofia-destravar.js — reconecta o WhatsApp da SoFIA em um passo só.
 *
 * O mesmo procedimento do comando `slimfit-sofia` (scripts/sofia.js), agora também
 * no painel (SoFIA → Configuração → "Reconectar a SoFIA"), sem entrar no servidor:
 *   1. RECONECTAR mantendo o login: para a SoFIA, zera o contador de falhas, limpa o
 *      cache do WhatsApp Web, tira a trava do navegador e sobe de novo. Espera até 3 min.
 *   2. Se não conectou, QR NOVO: faz o mesmo com o login salvo GUARDADO À PARTE — sobe
 *      com um perfil limpo e aí aparece um QR para escanear. Espera até 3 min.
 *      • apareceu o QR → o login antigo não servia mesmo: é apagado;
 *      • não apareceu  → o problema NÃO era o login (ex.: o WhatsApp bloqueando a
 *        conexão por excesso de tentativas): o login salvo é DEVOLVIDO, para a SoFIA
 *        voltar sozinha quando o WhatsApp liberar, sem precisar do celular.
 * Conversas, tags e configurações não são tocadas em nenhum dos dois.
 *
 * Só as pastas da PRÓPRIA SoFIA desta instalação (dir/auth vêm de quem chama).
 */
const fs = require('fs');
const path = require('path');

// Maior que a espera da própria SoFIA pelo WhatsApp (2 min) + o tempo de subir.
const ESPERA_MS = 180000;
const lerJson = (a) => { try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch (_) { return null; } };

// O que a SoFIA diz do próprio WhatsApp agora → { estado, em }.
function estadoWa(dir) {
  const o = lerJson(path.join(dir, 'sofia-wa-status.json')) || {};
  return { estado: o.estado || '', em: o.atualizadoEm || '' };
}

// Arruma as pastas com a SoFIA PARADA. modo: 'reconectar' | 'qr'. → lista do que fez.
function preparar({ dir, auth, modo }) {
  const feito = [];
  try { fs.writeFileSync(path.join(dir, '.sofia-boot-fails'), '0'); feito.push('contador de falhas zerado'); } catch (_) {}
  try { fs.rmSync(path.join(dir, '.wwebjs_cache'), { recursive: true, force: true }); feito.push('cache do WhatsApp Web limpo'); } catch (_) {}
  try {
    for (const nome of fs.existsSync(auth) ? fs.readdirSync(auth) : []) {
      if (!nome.startsWith('session')) continue;
      for (const t of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.rmSync(path.join(auth, nome, t), { force: true });
    }
    feito.push('trava do navegador removida');
  } catch (_) {}
  try { fs.rmSync(path.join(dir, 'sofia-parear.json'), { force: true }); } catch (_) {}
  if (modo === 'qr') {
    // Guarda o login salvo à parte (a SoFIA está parada): se o QR não aparecer, ele volta.
    let guardou = false;
    try {
      fs.rmSync(guardado(auth), { recursive: true, force: true });
      if (fs.existsSync(auth)) { fs.renameSync(auth, guardado(auth)); guardou = true; }
    } catch (_) {}
    if (guardou) feito.push('login salvo guardado à parte');
    else if (fs.existsSync(auth)) {
      // Não deu para mover (pasta presa): a própria SoFIA apaga o login ao subir, como antes.
      fs.writeFileSync(path.join(dir, '.sofia-limpar-auth'), JSON.stringify({ porque: 'reconectar a SoFIA (QR novo)', em: Date.now() }));
      feito.push('login antigo será descartado ao subir');
    }
  }
  return feito;
}

const guardado = (auth) => auth.replace(/[\\/]+$/, '') + '.guardado';
const temGuardado = (auth) => fs.existsSync(guardado(auth));
// O QR apareceu: o login antigo não servia — apaga a cópia guardada.
function descartarGuardado(auth) { try { fs.rmSync(guardado(auth), { recursive: true, force: true }); } catch (_) {} }
// O QR não apareceu: devolve o login salvo (com a SoFIA parada). → true se devolveu.
function devolverGuardado(auth) {
  if (!temGuardado(auth)) return false;
  try { fs.rmSync(auth, { recursive: true, force: true }); fs.renameSync(guardado(auth), auth); return true; } catch (_) { return false; }
}

// QR novo com rede de segurança: se o QR não aparecer, o login salvo volta para o lugar.
// → { estado: 'qr' | 'codigo' | 'conectado' | '', devolvido: bool }
async function qrNovo(alvo, aoPasso = () => {}) {
  const r = await tentar({ ...alvo, modo: 'qr', aoPasso });
  if (r) { descartarGuardado(alvo.auth); return { estado: r, devolvido: false }; }
  if (!temGuardado(alvo.auth)) return { estado: '', devolvido: false };
  try { await alvo.pm2(['stop', String(alvo.pm2Id)]); } catch (_) {}
  const devolvido = devolverGuardado(alvo.auth);
  if (devolvido) aoPasso('o QR não apareceu: login salvo devolvido');
  try { await alvo.pm2(['start', String(alvo.pm2Id)]); } catch (_) {}
  return { estado: '', devolvido };
}

// Uma tentativa: para, arruma, sobe e espera. → 'conectado' | 'qr' | 'codigo' | '' (não deu).
// pm2(args) roda o PM2; dormir(ms) espera — os dois vêm de quem chama (o painel usa
// versões que não travam o servidor; os testes, versões de mentira).
async function tentar({ modo, pm2Id, dir, auth, pm2, dormir, aoPasso = () => {}, esperaMs = ESPERA_MS, agora = Date.now }) {
  try { await pm2(['stop', String(pm2Id)]); aoPasso('parada'); } catch (_) { aoPasso('não consegui parar (sigo assim mesmo)'); }
  for (const f of preparar({ dir, auth, modo })) aoPasso(f);
  await pm2(['start', String(pm2Id)]);
  aoPasso('iniciada');
  const inicio = agora();
  while (agora() - inicio < esperaMs) {
    await dormir(5000);
    const w = estadoWa(dir);
    if (w.em && Date.parse(w.em) < inicio - 2000) continue; // ainda é o estado de antes
    if (w.estado === 'conectado' || w.estado === 'qr' || w.estado === 'codigo') return w.estado;
  }
  return '';
}

// O procedimento inteiro, sem perguntar nada: reconecta; se não der, QR novo.
// aoMudar({ etapa, msg, loginMantido }) — etapa: 'reconectando' | 'qr-novo' | 'conectado' | 'qr' | 'codigo' | 'falhou'.
async function destravar(alvo, aoMudar = () => {}) {
  const passo = (etapa) => (msg) => aoMudar({ etapa, msg });
  aoMudar({ etapa: 'reconectando', msg: 'começando' });
  let r = await tentar({ ...alvo, modo: 'reconectar', aoPasso: passo('reconectando') });
  let loginMantido = true;
  if (!r) {
    aoMudar({ etapa: 'qr-novo', msg: 'não conectou mantendo o login' });
    const q = await qrNovo(alvo, passo('qr-novo'));
    r = q.estado; loginMantido = q.devolvido;
  }
  aoMudar({ etapa: r || 'falhou', msg: '', loginMantido: r ? undefined : loginMantido });
  return r || 'falhou';
}

module.exports = { ESPERA_MS, estadoWa, preparar, tentar, qrNovo, destravar, descartarGuardado, devolverGuardado };

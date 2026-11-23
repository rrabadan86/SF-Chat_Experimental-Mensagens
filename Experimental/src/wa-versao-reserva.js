/**
 * wa-versao-reserva.js — quando a versão AO VIVO do WhatsApp Web não chega no QR,
 * a próxima tentativa usa uma versão RESERVA (a última que sabemos que funciona).
 *
 * Por que existe: em 23/11/2026 o WhatsApp Web mudou (versão 2.3000.10558…) e a
 * biblioteca (whatsapp-web.js 1.34.x) deixou de perceber que o QR estava pronto: a
 * página mostrava o QR, mas a "conexão" ficava sem estado e tudo terminava em
 * "Waiting failed". Quem já estava conectado seguiu funcionando; qualquer QR NOVO
 * (troca de número, login perdido) falhava em todas as lojas.
 *
 * Como funciona: se a página abriu (tem versão) mas a conexão ficou SEM ESTADO, anota
 * um marcador. Por RESERVA_DIAS, as subidas seguintes usam a versão reserva (uma URL
 * de .html do repositório wa-version). Depois tenta a ao vivo de novo — quando a
 * biblioteca for atualizada, volta sozinha. Uma versão fixada no .env
 * (WA_WEB_VERSION_FILE / WA_WEB_VERSION_URL) sempre manda mais que a reserva.
 * WA_WEB_VERSION_RESERVA=off desliga; WA_WEB_VERSION_RESERVA=<url> troca a reserva.
 *
 * A SoFIA (ChatBot/sofia-listener.ts) tem a mesma lógica, escrita lá.
 */
const fs = require('fs');

const URL_PADRAO = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1055837054-alpha.html';
const RESERVA_DIAS = 7;
const DESLIGADA = /^(off|none|nao|não|0)$/i;

function url(env = process.env) {
  const v = String(env.WA_WEB_VERSION_RESERVA == null ? '' : env.WA_WEB_VERSION_RESERVA).trim();
  if (DESLIGADA.test(v)) return '';
  return v || URL_PADRAO;
}

// O marcador ainda vale? → { em, versao } | null
function ativa(arq, agora = Date.now()) {
  try {
    const o = JSON.parse(fs.readFileSync(arq, 'utf8'));
    if (o && o.em && agora - o.em < RESERVA_DIAS * 86400000) return o;
  } catch (_) {}
  return null;
}
function marcar(arq, versao, agora = Date.now()) {
  try { fs.writeFileSync(arq, JSON.stringify({ em: agora, versao: String(versao || '') })); return true; } catch (_) { return false; }
}
function limpar(arq) { try { fs.rmSync(arq, { force: true }); } catch (_) {} }

// O estado lido da página na falha indica a versão nova que a biblioteca não entende?
// (a página abriu — tem versão — mas a conexão ficou sem estado nenhum)
function falhaDeVersao(info) {
  return !!(info && info.versao && !info.socket);
}

module.exports = { URL_PADRAO, RESERVA_DIAS, url, ativa, marcar, limpar, falhaDeVersao };

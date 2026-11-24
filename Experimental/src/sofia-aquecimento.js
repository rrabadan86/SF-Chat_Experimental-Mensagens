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
const DIAS_MAX = 30;
const QUIETO_MIN_PADRAO = 30;

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
  fs.writeFileSync(arq, JSON.stringify({ desde: hoje, ate: somaDias(hoje, n - 1), dias: n }));
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

module.exports = { ARQ, DIAS_MAX, QUIETO_MIN_PADRAO, ler, gravar, ativo, bloqueio, hojeSP };

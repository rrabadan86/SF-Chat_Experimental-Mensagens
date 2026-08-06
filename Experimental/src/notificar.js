// notificar.js — ALERTAS de saúde do sistema via ntfy.sh (push no celular).
//
// Canal escolhido: ntfy.sh (grátis, sem conta). Você instala o app "ntfy" no
// celular, assina UM tópico secreto (ex.: "slimfit-alertas-7h3k9") e pronto:
// tudo que este módulo publicar chega como notificação push.
//
// É INDEPENDENTE do WhatsApp de propósito: se o WhatsApp cair e precisar de QR,
// o alerta ainda chega (não usa o WhatsApp para avisar que o WhatsApp caiu).
//
// Configuração (.env):
//   NTFY_TOPIC = slimfit-alertas-7h3k9      (o nome do tópico que você assinou)
//   NTFY_URL   = https://ntfy.sh            (opcional; troque se usar servidor próprio)
//
// Sem NTFY_TOPIC definido, este módulo NÃO faz nada (falha em silêncio) — o
// sistema continua funcionando normalmente, só sem enviar os alertas.
//
// Uso:
//   const notif = require('./notificar');
//   await notif.alertar('WhatsApp caiu', 'Escaneie o QR no servidor', { prioridade: 'urgent', tags: 'rotating_light' });

const BASE = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
const TOPIC = process.env.NTFY_TOPIC || '';

// Anti-spam: não repete o MESMO alerta (mesmo título) dentro da janela abaixo.
// Evita, por ex., um job que falha em loop mandar 50 push seguidos.
const JANELA_MS = 30 * 60 * 1000; // 30 min
const _ultimoEnvio = new Map();

function log(msg) { console.log(`[notif] ${msg}`); }

/**
 * Publica um alerta no ntfy. Falha em silêncio (nunca derruba o job que chamou).
 *   titulo     — cabeçalho do push (também usado para o anti-spam)
 *   mensagem   — corpo do push
 *   prioridade — 'min' | 'low' | 'default' | 'high' | 'urgent'  (padrão 'high')
 *   tags       — emojis do ntfy separados por vírgula (ex.: 'warning,robot')
 *   forcar     — ignora o anti-spam (para alertas críticos que devem sempre sair)
 */
async function alertar(titulo, mensagem, { prioridade = 'high', tags = 'warning', forcar = false } = {}) {
  if (!TOPIC) return false; // não configurado → não faz nada

  const chave = titulo || mensagem || 'alerta';
  const agora = Date.now();
  if (!forcar) {
    const ultimo = _ultimoEnvio.get(chave) || 0;
    if (agora - ultimo < JANELA_MS) return false; // já avisei isso há pouco
  }
  _ultimoEnvio.set(chave, agora);

  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(TOPIC)}`, {
      method: 'POST',
      headers: {
        'Title': encodeAscii(titulo || 'SlimFit'),
        'Priority': prioridade,
        'Tags': tags,
      },
      body: mensagem || '',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { log(`ntfy respondeu HTTP ${r.status}`); return false; }
    return true;
  } catch (e) {
    // Nunca propaga: o alerta é "best-effort". Só registra no log.
    log(`falha ao enviar alerta (${e.message}) — seguindo sem alerta.`);
    return false;
  }
}

// O header HTTP só aceita ASCII/latin1. Emojis/acentos no Title quebram o fetch
// com "Invalid character in header". Troca acentos e remove o que não for ASCII.
function encodeAscii(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[^\x20-\x7E]/g, '')                      // remove não-ASCII (emoji)
    .trim() || 'SlimFit';
}

/**
 * Alerta RESUMIDO no fim de um job de envio em massa.
 * Manda UM push com o total ("Follow-up manhã: 2 de 8 falharam") em vez de um
 * por pessoa. Silencioso quando não houve falha — só avisa o que precisa de ação.
 *
 *   nome  — nome do job (ex.: 'Follow-up manhã')
 *   enviadas / falhas / puladas — contadores do job
 *   detalhe — opcional: nomes de quem falhou, para saber com quem falar
 */
async function alertarResumo(nome, { enviadas = 0, falhas = 0, puladas = 0, detalhe = '' } = {}) {
  if (!falhas) return false;                 // tudo certo → não incomoda
  const total = enviadas + falhas;
  const corpo = `${falhas} de ${total} envio(s) falharam`
    + (puladas ? ` (${puladas} pulada[s])` : '')
    + (detalhe ? `.\n${detalhe}` : '.')
    + '\nVeja pm2 logs slimfit-exp.';
  return alertar(`${nome}: ${falhas} falha(s)`, corpo, { prioridade: 'high', tags: 'warning' });
}

module.exports = { alertar, alertarResumo };

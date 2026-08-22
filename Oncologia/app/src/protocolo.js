/**
 * protocolo.js — o número que amarra o evento da agenda à conversa do WhatsApp.
 *
 * Formato: PA-2026-4817 (Pré-Agendamento, ano, 4 dígitos).
 * Curto de propósito: a recepcionista digita isso na mão no celular.
 */
const crypto = require('crypto');

const PADRAO = /\bPA-(\d{4})-(\d{4})\b/i;
const COMANDOS = {
  CONFIRMAR: /\bconfirmar\b/i,
  REMARCAR: /\bremarcar\b/i,
  CANCELAR: /\bcancelar\b/i,
};

function gerar(ano = new Date().getFullYear()) {
  const n = 1000 + (crypto.randomInt(9000));
  return `PA-${ano}-${n}`;
}

/** Acha um protocolo dentro de um texto qualquer. */
function extrair(texto = '') {
  const m = String(texto).match(PADRAO);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Interpreta a resposta da recepcionista.
 * "confirmar pa-2026-4817" -> { comando:'CONFIRMAR', protocolo:'PA-2026-4817' }
 * Devolve null se não for um comando reconhecível.
 */
function interpretar(texto = '') {
  const protocolo = extrair(texto);
  if (!protocolo) return null;
  for (const [comando, regex] of Object.entries(COMANDOS)) {
    if (regex.test(texto)) return { comando, protocolo };
  }
  return { comando: null, protocolo };
}

module.exports = { gerar, extrair, interpretar, PADRAO };

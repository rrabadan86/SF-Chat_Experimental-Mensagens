/**
 * Estado do WhatsApp compartilhado entre o robô (slimfit-exp) e o painel
 * (slimfit-painel). Os dois processos não compartilham memória, então o robô
 * GRAVA o estado (e o QR, quando a sessão cai) neste arquivo e o painel LÊ.
 *
 * data/wa-status.json = { estado, qr, atualizadoEm }
 *   estado: 'conectado' | 'qr' | 'desconectado' | 'iniciando'
 *   qr:     data URL (imagem PNG do QR) quando estado === 'qr', senão null
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'wa-status.json');

function set(estado, qr) {
  try {
    const dir = path.dirname(ARQUIVO);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify({
      estado,
      qr: qr || null,
      atualizadoEm: new Date().toISOString(),
    }), 'utf8');
  } catch (_) { /* estado é só conveniência */ }
}

function get() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); }
  catch (_) { return { estado: 'desconhecido', qr: null, atualizadoEm: null }; }
}

module.exports = { set, get, ARQUIVO };

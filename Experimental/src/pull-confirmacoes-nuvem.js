// pull-confirmacoes-nuvem.js
// Ponte PC <- Nuvem, em Node, para rodar DENTRO do Watchdog (scheduler.js).
// Substitui o script Python "puxar_confirmacoes.py" e a janela de terminal /
// tarefa agendada separada. Puxa as confirmações que o formulário (Render)
// enfileirou (GET /api/outbox/pending), grava no MESMO arquivo que o bot já
// envia (confirmacoes_outbox.jsonl) e confirma (POST /api/outbox/ack).
//
// IMPORTANTE: chame a cada ~1 min (NÃO a cada 15 min). O Render free dorme após
// ~15 min ocioso e APAGA a fila da nuvem; puxar de 1 em 1 min traz a confirmação
// antes disso E mantém o Render acordado.
//
// Variáveis de ambiente (mesmas do bridge Python):
//   FORM_CLOUD_URL       = https://sf-formularioexperimental.onrender.com
//   FORM_OUTBOX_TOKEN    = <o MESMO token configurado no Render>
//   STUDIO_OUTBOX_FILE   = C:\AntiGravity\Experimental\src\agendamento_evo\confirmacoes_outbox.jsonl
//   FORM_PULL_STATE      = (opcional) caminho do web_puxados.json

const fs = require('fs');
const path = require('path');

const CLOUD_URL = (process.env.FORM_CLOUD_URL || 'https://sf-formularioexperimental.onrender.com')
  .replace(/\/+$/, '');
const TOKEN = process.env.FORM_OUTBOX_TOKEN || '';
const LOCAL_OUTBOX = process.env.STUDIO_OUTBOX_FILE
  || 'C:\\AntiGravity\\Experimental\\src\\agendamento_evo\\confirmacoes_outbox.jsonl';
const STATE_FILE = process.env.FORM_PULL_STATE
  || path.join(path.dirname(LOCAL_OUTBOX) || '.', 'web_puxados.json');

function _key(row) { return `${row.contactId}|${row.when}|${row.ts}`; }

function _loadState() {
  try { return new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function _saveState(set) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify([...set]), 'utf8'); }
  catch (e) { console.log('[bridge] aviso: não consegui salvar estado:', e.message); }
}

// Grava uma linha garantindo que o arquivo termina em \n (evita colar dois JSON
// na mesma linha, o que faria o leitor descartar ambos).
function _appendLinha(arquivo, linha) {
  try {
    if (fs.existsSync(arquivo)) {
      const size = fs.statSync(arquivo).size;
      if (size > 0) {
        const fd = fs.openSync(arquivo, 'r');
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, size - 1);
        fs.closeSync(fd);
        if (buf.toString('utf8') !== '\n') fs.appendFileSync(arquivo, '\n');
      }
    }
  } catch { /* se falhar a checagem, segue o append normal */ }
  fs.appendFileSync(arquivo, linha + '\n', 'utf8');
}

/**
 * Puxa uma vez da nuvem. Retorna o nº de confirmações novas gravadas localmente.
 */
async function pullConfirmacoesNuvem() {
  if (!TOKEN) {
    console.log('[bridge] FORM_OUTBOX_TOKEN não definido — pull ignorado.');
    return 0;
  }
  let rows = [];
  try {
    const r = await fetch(`${CLOUD_URL}/api/outbox/pending?token=${encodeURIComponent(TOKEN)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { console.log(`[bridge] pull respondeu HTTP ${r.status}`); return 0; }
    const data = await r.json();
    rows = (data && data.rows) || [];
  } catch (e) {
    console.log('[bridge] falha ao puxar da nuvem:', e.message);
    return 0;
  }

  const ja = _loadState();
  let novas = 0;
  const keys = [];
  for (const row of rows) {
    const k = _key(row);
    keys.push(k);
    if (ja.has(k)) continue;              // já tinha trazido antes
    _appendLinha(LOCAL_OUTBOX, JSON.stringify(row));
    ja.add(k);
    novas++;
  }
  _saveState(ja);
  if (novas) console.log(`[bridge] ${novas} confirmação(ões) nova(s) trazida(s) da nuvem.`);

  // Confirma o recebimento p/ a nuvem parar de reenviar.
  if (keys.length) {
    try {
      await fetch(`${CLOUD_URL}/api/outbox/ack?token=${encodeURIComponent(TOKEN)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      console.log('[bridge] aviso: não consegui confirmar (ack) com a nuvem:', e.message);
    }
  }
  return novas;
}

module.exports = { pullConfirmacoesNuvem };

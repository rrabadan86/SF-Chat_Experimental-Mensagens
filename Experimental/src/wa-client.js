/**
 * wa-client.js — CLIENTE ÚNICO e PERSISTENTE do WhatsApp (whatsapp-web.js).
 *
 * Sobe UMA vez com a aplicação (PM2) e fica autenticado em memória. Todos os
 * jobs do scheduler REAPROVEITAM este mesmo cliente para disparar — nada de
 * abrir/fechar o navegador a cada envio (era isso que derrubava a sessão).
 *
 * Recursos:
 *   - LocalAuth: sessão salva em disco (wwebjs_auth) — escaneia o QR 1 vez só.
 *   - Evento 'ready': libera os envios só quando o WhatsApp Web terminou de
 *     sincronizar (sem setTimeout fixo).
 *   - Keep-alive: getState a cada ~2h para manter o WebSocket "quente".
 *   - Shutdown gracioso: client.destroy() salva a sessão com segurança.
 *
 * Standalone (para escanear o QR a 1ª vez):
 *   node src/wa-client.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const AUTH_DIR = process.env.WA_AUTH_DIR || path.resolve(__dirname, '..', 'wwebjs_auth');
// whatsapp-web.js roda bem headless; deixe WA_HEADLESS=false só se quiser com tela (xvfb).
const HEADLESS = process.env.WA_HEADLESS !== 'false';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

let client = null;
let pronto = false;
let initPromise = null;
let keepAliveTimer = null;

function log(msg) { console.log(`[wa] ${msg}`); }

function criarClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: {
      headless: HEADLESS,
      executablePath: CHROMIUM_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });
}

/**
 * Inicializa o cliente (idempotente). Resolve quando o WhatsApp está PRONTO.
 */
function initWhatsApp() {
  if (initPromise) return initPromise;
  client = criarClient();

  initPromise = new Promise((resolve) => {
    client.on('qr', (qr) => {
      console.log('\n📲 Escaneie o QR no WhatsApp do número (Aparelhos conectados → Conectar um aparelho):\n');
      qrcodeTerminal.generate(qr, { small: true });
    });
    let nAuth = 0;
    client.on('authenticated', () => { nAuth++; log(`🔐 Autenticado (${nAuth}).`); });
    client.on('auth_failure', (m) => log('❌ auth_failure: ' + m));
    client.on('loading_screen', (percent, message) => log(`⏳ carregando ${percent}% ${message || ''}`));
    client.on('change_state', (s) => log('🔄 estado: ' + s));
    client.on('ready', () => {
      pronto = true;
      log('✅ WhatsApp PRONTO (ready) — pode disparar.');
      iniciarKeepAlive();
      resolve(client);
    });
    client.on('disconnected', (motivo) => {
      pronto = false;
      log('⚠️  Desconectado: ' + motivo);
    });
    // Alerta se demorar demais para ficar pronto (ajuda a diagnosticar versão da lib)
    setTimeout(() => {
      if (!pronto) log('⚠️  90s sem "ready". Pode ser incompatibilidade da versão da whatsapp-web.js com o WhatsApp Web.');
    }, 90000);
  });

  client.initialize();
  return initPromise;
}

function isReady() { return pronto; }
function getClient() { return client; }

/** Converte um telefone em chatId do WhatsApp (55...@c.us). */
function toChatId(telefone) {
  let n = String(telefone || '').replace(/\D/g, '');
  if (!n) throw new Error('telefone vazio');
  if (!n.startsWith('55')) n = '55' + n;
  return n + '@c.us';
}

async function sendTexto(telefone, texto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  return client.sendMessage(toChatId(telefone), texto);
}

/**
 * Envia mídia (áudio/imagem/etc). Aceita URL http(s) ou caminho local.
 * legenda é opcional. Para áudio como "mensagem de voz", passe sendAudioAsVoice.
 */
async function sendMidia(telefone, urlOuCaminho, { legenda = '', comoVoz = false } = {}) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  const media = /^https?:\/\//i.test(urlOuCaminho)
    ? await MessageMedia.fromUrl(urlOuCaminho, { unsafeMime: true })
    : MessageMedia.fromFilePath(urlOuCaminho);
  return client.sendMessage(toChatId(telefone), media, {
    caption: legenda || undefined,
    sendAudioAsVoice: comoVoz || undefined,
  });
}

/** Acha um grupo pelo NOME (exato; senão parcial). */
async function acharGrupo(nomeGrupo) {
  const alvo = (nomeGrupo || '').trim().toLowerCase();
  const chats = await client.getChats();
  return chats.find((c) => c.isGroup && (c.name || '').trim().toLowerCase() === alvo)
      || chats.find((c) => c.isGroup && (c.name || '').toLowerCase().includes(alvo))
      || null;
}

async function sendGrupo(nomeGrupo, texto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  const g = await acharGrupo(nomeGrupo);
  if (!g) throw new Error('Grupo não encontrado: ' + nomeGrupo);
  return client.sendMessage(g.id._serialized, texto);
}

/** Keep-alive: mantém o WebSocket quente (getState) a cada ~2h. */
function iniciarKeepAlive(horas = 2) {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(async () => {
    try {
      const s = await client.getState();
      log('💓 keep-alive — estado: ' + s);
    } catch (e) {
      log('keep-alive falhou: ' + e.message);
    }
  }, horas * 3600 * 1000);
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}

/** Encerra com segurança (salva a sessão). Chamado no shutdown do PM2. */
async function destroy() {
  try {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    if (client) { log('encerrando com destroy()...'); await client.destroy(); }
  } catch (_) { /* ignore */ }
}

module.exports = {
  initWhatsApp, isReady, getClient,
  sendTexto, sendMidia, sendGrupo, acharGrupo,
  iniciarKeepAlive, destroy, toChatId, MessageMedia,
};

// ── Standalone: escanear o QR pela 1ª vez e deixar a sessão salva ────────────
if (require.main === module) {
  console.log('🐧 Iniciando cliente do WhatsApp (aguarde o QR)...');
  initWhatsApp().then(() => {
    log('Sessão ativa e salva em: ' + AUTH_DIR);
    log('Pode deixar rodando, ou Ctrl+C — a sessão fica salva para o scheduler usar.');
  });
  const sair = async () => { await destroy(); process.exit(0); };
  process.on('SIGINT', sair);
  process.on('SIGTERM', sair);
}

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
// Fixa uma versão conhecida do WhatsApp Web (resolve o "travado em 99% / sem ready").
// Se essa versão parar de funcionar, troque a URL pela variável WA_WEB_VERSION_URL no .env.
const WEB_VERSION_URL = process.env.WA_WEB_VERSION_URL
  || 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901307-alpha.html';

let client = null;
let pronto = false;
let initPromise = null;
let keepAliveTimer = null;

function log(msg) { console.log(`[wa] ${msg}`); }

// Erros transitórios do puppeteer quando o WhatsApp Web recarrega/desanexa o
// frame (comum em processos de longa duração). Vale a pena esperar e repetir.
function ehTransiente(e) {
  const m = (e && e.message) || '';
  return /detached Frame|Execution context was destroyed|Target closed|Cannot find context|Session closed|Protocol error|Node is detached/i.test(m);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a página do WhatsApp voltar a responder após um reload (frame novo). */
async function esperarPaginaOk(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await client.pupPage.evaluate(() => document.readyState === 'complete');
      if (ok) {
        // confirma que o WhatsApp está CONECTADO antes de seguir
        try { if ((await client.getState()) === 'CONNECTED') return true; } catch (_) {}
      }
    } catch (_) { /* frame ainda recarregando */ }
    await espera(2500);
  }
  return false;
}

// Mais tentativas + espera pela página (o reload do WhatsApp Web pode levar
// dezenas de segundos). Antes eram 4x4s (16s) — insuficiente num reload longo.
async function comRetry(fn, tentativas = 8, esperaMs = 4000) {
  let ultimo;
  for (let i = 1; i <= tentativas; i++) {
    try { return await fn(); }
    catch (e) {
      ultimo = e;
      if (!ehTransiente(e) || i === tentativas) throw e;
      log(`⏳ frame instável (${i}/${tentativas}): ${e.message} — aguardando a página voltar...`);
      // espera a página re-estabilizar (até ~20s) em vez de só um sleep fixo
      const voltou = await esperarPaginaOk(20000);
      if (!voltou) await espera(esperaMs);
    }
  }
  throw ultimo;
}

// Cache de grupo por nome (evita reler a lista de chats a cada envio).
const gruposCache = new Map();

function criarClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    webVersionCache: { type: 'remote', remotePath: WEB_VERSION_URL },
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

  let rejectInit = null;
  initPromise = new Promise((resolve, reject) => {
    rejectInit = reject;
    client.on('qr', (qr) => {
      console.log('\n📲 Escaneie o QR no WhatsApp do número (Aparelhos conectados → Conectar um aparelho):\n');
      qrcodeTerminal.generate(qr, { small: true });
    });
    let resolvido = false;
    const marcarPronto = (via) => {
      if (resolvido) return;
      resolvido = true;
      pronto = true;
      log(`✅ WhatsApp PRONTO (${via}) — pode disparar.`);
      iniciarKeepAlive();
      resolve(client);
    };

    let nAuth = 0;
    let poll = null;
    const iniciarPoll = () => {
      if (poll) return;
      // Fallback robusto: alguns casos carregam 100% e autenticam, mas o evento
      // 'ready' não dispara. Então verificamos o estado real com getState().
      poll = setInterval(async () => {
        if (resolvido) { clearInterval(poll); return; }
        try {
          const s = await client.getState();
          log('estado(check): ' + s);
          if (s === 'CONNECTED') { clearInterval(poll); marcarPronto('getState CONNECTED'); }
        } catch (_) { /* ainda inicializando o Store */ }
      }, 5000);
    };

    client.on('authenticated', () => { nAuth++; log(`🔐 Autenticado (${nAuth}).`); iniciarPoll(); });
    client.on('auth_failure', (m) => log('❌ auth_failure: ' + m));
    client.on('loading_screen', (percent, message) => { log(`⏳ carregando ${percent}% ${message || ''}`); if (Number(percent) >= 100) iniciarPoll(); });
    client.on('change_state', (s) => { log('🔄 estado: ' + s); if (s === 'CONNECTED') marcarPronto('change_state CONNECTED'); });
    client.on('ready', () => marcarPronto('evento ready'));
    client.on('disconnected', (motivo) => {
      pronto = false;
      log('⚠️  Desconectado: ' + motivo);
    });

    setTimeout(() => {
      if (!pronto) log('⚠️  Ainda sem "ready" após 90s (o fallback getState continua tentando).');
    }, 90000);
  });

  client.initialize().catch((e) => {
    const msg = (e && e.message) || String(e);
    if (/already running/i.test(msg)) {
      log('❌ Já existe uma sessão do WhatsApp aberta para este perfil.');
      log('   → Provavelmente o scheduler no PM2. Pare-o antes de rodar scripts standalone:');
      log('     pm2 stop slimfit-exp   (e depois: pm2 start slimfit-exp)');
    } else {
      log('❌ Falha ao inicializar o WhatsApp: ' + msg);
    }
    initPromise = null; // permite nova tentativa depois
    if (rejectInit) rejectInit(new Error(msg));
  });
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

/**
 * Resolve o ID correto do destinatário via getNumberId (trata o novo "LID" do
 * WhatsApp e valida se o número existe). Cai para @c.us se getNumberId não vier.
 */
async function resolverId(telefone) {
  let n = String(telefone || '').replace(/\D/g, '');
  if (!n) throw new Error('telefone vazio');
  if (!n.startsWith('55')) n = '55' + n;
  try {
    const numId = await comRetry(() => client.getNumberId(n));
    if (numId && numId._serialized) return numId._serialized;
  } catch (_) { /* usa fallback abaixo */ }
  return n + '@c.us';
}

async function sendTexto(telefone, texto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  const id = await resolverId(telefone);
  return comRetry(() => client.sendMessage(id, texto));
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
  const id = await resolverId(telefone);
  return comRetry(() => client.sendMessage(id, media, {
    caption: legenda || undefined,
    sendAudioAsVoice: comoVoz || undefined,
  }));
}

/**
 * Lista LEVE de grupos [{ id, name }] lida direto do Store, SEM serializar cada
 * chat. O client.getChats() do whatsapp-web.js serializa tudo (metadata do grupo
 * + migração de LID por participante) e estoura um erro minificado ('r') se um
 * único grupo tiver estrutura problemática. Aqui só lemos id e nome.
 */
async function listarGrupos() {
  return comRetry(async () => {
    const page = client.pupPage;
    if (!page) throw new Error('página do WhatsApp indisponível');
    return page.evaluate(() => {
      let arr = [];
      try { arr = window.require('WAWebCollections').Chat.getModelsArray() || []; }
      catch (_) { arr = []; }
      const out = [];
      for (const c of arr) {
        try {
          const id = (c.id && c.id._serialized) ? c.id._serialized : String(c.id);
          const isGroup = (c.id && c.id.server === 'g.us') || !!c.groupMetadata || c.isGroup;
          if (!isGroup) continue;
          const name = c.name || c.formattedTitle || (c.contact && c.contact.name) || '';
          out.push({ id, name });
        } catch (_) { /* pula grupo problemático */ }
      }
      return out;
    });
  });
}

/** Acha um grupo pelo NOME (exato; senão parcial). Retorna { id, name } ou null. */
async function acharGrupo(nomeGrupo) {
  const alvo = (nomeGrupo || '').trim().toLowerCase();
  if (gruposCache.has(alvo)) return gruposCache.get(alvo);
  let grupos;
  try { grupos = await listarGrupos(); }
  catch (e) { throw new Error('listar grupos falhou: ' + (e && e.message)); }
  const g = grupos.find((x) => (x.name || '').trim().toLowerCase() === alvo)
        || grupos.find((x) => (x.name || '').toLowerCase().includes(alvo))
        || null;
  if (g) gruposCache.set(alvo, g); // cacheia o ID p/ os próximos envios
  return g;
}

async function sendGrupo(nomeGrupo, texto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  const g = await acharGrupo(nomeGrupo);
  if (!g) throw new Error('Grupo não encontrado: ' + nomeGrupo);
  return comRetry(() => client.sendMessage(g.id, texto));
}

/**
 * Retorna os grupos EM COMUM com um contato (mesma pessoa nos dois lados).
 * Usa a API nativa do whatsapp-web.js (getCommonGroups) e resolve os nomes pela
 * lista leve (sem getChatById, que serializa e pode estourar 'r').
 * → [{ id: '...@g.us', name: 'Nome do grupo' }]
 */
async function getCommonGroups(telefone) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  const id = await resolverId(telefone);
  let comuns = [];
  try { comuns = await comRetry(() => client.getCommonGroups(id)); } catch (_) { comuns = []; }

  // mapa id → nome (leve), para rotular sem serializar cada grupo
  let nomePorId = {};
  try {
    const lista = await listarGrupos();
    for (const g of lista) nomePorId[g.id] = g.name;
  } catch (_) { /* segue sem nomes */ }

  const out = [];
  for (const g of (comuns || [])) {
    const gid = (g && g._serialized) ? g._serialized : String(g);
    out.push({ id: gid, name: nomePorId[gid] || '' });
  }
  return out;
}

/**
 * Envia num grupo MARCANDO (@) uma pessoa. Monta o texto como
 *   textoAntes + @<pessoa> + textoDepois
 * e passa a menção nativa (o número tem que estar no texto E em mentions).
 * Envia direto por client.sendMessage(groupId, ...) — sem getChatById.
 */
async function sendGrupoComMencao(groupId, textoAntes, textoDepois, telefoneMencionado) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');

  let mid;
  try { mid = await resolverId(telefoneMencionado); }
  catch (e) { throw new Error('resolverId: ' + (e && e.message)); }

  const user = mid.replace(/@.*/, '');                     // só dígitos p/ o token @
  const texto = `${textoAntes || ''}@${user}${textoDepois || ''}`;

  // Formato atual do whatsapp-web.js: mentions = array de IDs (strings).
  try {
    return await comRetry(() => client.sendMessage(groupId, texto, { mentions: [mid] }));
  } catch (e) {
    throw new Error('sendMessage(mention): ' + (e && e.message));
  }
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
  sendTexto, sendMidia, sendGrupo, acharGrupo, listarGrupos,
  getCommonGroups, sendGrupoComMencao,
  iniciarKeepAlive, destroy, toChatId, MessageMedia,
};

// ── Standalone: escanear o QR pela 1ª vez e deixar a sessão salva ────────────
if (require.main === module) {
  const testeNum = process.argv[2]; // opcional: node src/wa-client.js 5562XXXXXXXXX
  console.log('🐧 Iniciando cliente do WhatsApp (aguarde o QR)...');
  initWhatsApp().then(async () => {
    log('Sessão ativa e salva em: ' + AUTH_DIR);
    if (testeNum) {
      log('Enviando mensagem de teste para ' + testeNum + '...');
      try {
        const msg = await sendTexto(testeNum, 'Teste do cliente único SlimFit ✅ (whatsapp-web.js)');
        log('📨 Enfileirada, aguardando entrega...');
        // Espera a entrega REAL antes de encerrar (senão o destroy corta o envio).
        await new Promise((r) => setTimeout(r, 8000));
        try {
          const ack = msg && typeof msg.ack !== 'undefined' ? msg.ack : '?';
          log('🎉 Mensagem de teste enviada! (ack=' + ack + ')');
        } catch (_) { log('🎉 Mensagem de teste enviada!'); }
      } catch (e) {
        log('❌ Falha no envio de teste: ' + e.message);
      }
      await destroy();
      process.exit(0);
    }
    log('Pode deixar rodando, ou Ctrl+C — a sessão fica salva para o scheduler usar.');
  });
  const sair = async () => { await destroy(); process.exit(0); };
  process.on('SIGINT', sair);
  process.on('SIGTERM', sair);
}

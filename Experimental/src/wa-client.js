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
const waStatus = require('./wa-status');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const notif = require('./notificar'); // alertas de saúde (ntfy.sh) — best-effort
const atividade = require('./atividade'); // registro do que foi enviado (aba "Hoje")

const AUTH_DIR = process.env.WA_AUTH_DIR || path.resolve(__dirname, '..', 'wwebjs_auth');
// whatsapp-web.js roda bem headless; deixe WA_HEADLESS=false só se quiser com tela (xvfb).
const HEADLESS = process.env.WA_HEADLESS !== 'false';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;
// Fixa uma versão conhecida do WhatsApp Web (resolve o "travado em 99% / sem ready").
// Se essa versão parar de funcionar, troque a URL pela variável WA_WEB_VERSION_URL no .env.
// O arquivo é de um repositório de terceiros e PODE SUMIR (já virou 404). Enquanto
// o wwebjs_cache local existe ninguém percebe; no dia em que o cache é apagado, a
// página sobe sem os internos do WhatsApp Web e o Client.inject estoura em 30s.
// Por isso conferimos a URL antes de usar. WA_WEB_VERSION_URL=off desliga o pin.
const WEB_VERSION_URL = process.env.WA_WEB_VERSION_URL
  || 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1046618780-alpha.html';
const VERSAO_FIXA_DESLIGADA = /^(off|none|nao|não|0)$/i.test(String(WEB_VERSION_URL).trim());

// true = dá para usar a versão fixa. Um 404 é PIOR do que não fixar versão nenhuma.
// Se a própria consulta falhar (rede fora), mantemos o pin — o cache local pode servir.
async function versaoFixaUsavel() {
  if (VERSAO_FIXA_DESLIGADA) { log('versão do WhatsApp Web NÃO fixada (WA_WEB_VERSION_URL=off).'); return false; }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(WEB_VERSION_URL, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) return true;
    log('⚠️  a versão fixa do WhatsApp Web respondeu ' + r.status + ' — subindo SEM versão fixa. '
      + 'Para fixar outra, ponha WA_WEB_VERSION_URL no .env com uma URL que exista.');
    return false;
  } catch (e) {
    log('não consegui conferir a versão fixa (' + (e && e.message) + ') — sigo com ela mesmo.');
    return true;
  }
}

let client = null;
let pronto = false;
let initPromise = null;
let keepAliveTimer = null;
let comandoTimer = null;

function log(msg) { console.log(`[wa] ${msg}`); }

// ── Ponte de comando painel → robô ──────────────────────────────────────────
// O painel (processo separado) grava data/wa-comando.json para pedir ações que
// só podem ser feitas AQUI (onde o cliente vive). Hoje: "logout" (desconectar o
// WhatsApp). Lemos a cada poucos segundos, executamos e apagamos o arquivo.
const COMANDO_FILE = path.resolve(__dirname, '..', 'data', 'wa-comando.json');
function iniciarWatcherComando() {
  if (comandoTimer) return;
  comandoTimer = setInterval(async () => {
    let cmd = null;
    try { cmd = JSON.parse(require('fs').readFileSync(COMANDO_FILE, 'utf8')); } catch (_) { return; } // sem comando
    try { require('fs').unlinkSync(COMANDO_FILE); } catch (_) {} // consome uma vez só
    if (!cmd || cmd.cmd !== 'logout') return;
    log('🔌 comando do painel: DESCONECTAR (logout). Encerrando a sessão…');
    waStatus.set('desconectado', null);
    try { if (client) await client.logout(); log('sessão desvinculada (logout).'); }
    catch (e) { log('logout falhou (' + ((e && e.message) || e) + ') — vou reiniciar mesmo assim.'); }
    // Sai para o PM2 reiniciar: como a sessão foi removida, sobe um QR novo no painel.
    setTimeout(() => process.exit(0), 500);
  }, 4000);
  if (comandoTimer.unref) comandoTimer.unref();
}

// Erros transitórios do puppeteer quando o WhatsApp Web recarrega/desanexa o
// frame (comum em processos de longa duração). Vale a pena esperar e repetir.
function ehTransiente(e) {
  const m = (e && e.message) || '';
  // Além dos erros de frame/contexto do puppeteer, tratamos como transitório o
  // "Cannot read properties of undefined (reading 'getChat'/...)" e afins: são o
  // Store do WhatsApp-Web ainda não montado logo após um reinício. Antes esses
  // caíam como erro definitivo e a pessoa era contada como falha em vez de
  // repetida quando o cliente voltasse.
  return /detached Frame|Execution context was destroyed|Target closed|Cannot find context|Session closed|Protocol error|Node is detached|Cannot read properties of undefined|Evaluation failed|WWebJS|window\.Store|getChat/i.test(m);
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

/** Espera o cliente voltar a ficar PRONTO (após uma reinicialização). */
async function esperarPronto(timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pronto) return true;
    await espera(1500);
  }
  return pronto;
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
      if (!voltou) {
        // A página não voltou sozinha: o frame provavelmente morreu de vez (só um
        // reload não conserta). Faz o conserto COMPLETO (destrói e recria com a
        // sessão salva) e espera ficar pronto ANTES de tentar de novo — assim o
        // mesmo envio é retomado, em vez de a pessoa ser contada como falha (era
        // o que acontecia quando a tentativa caía no meio da reinicialização).
        log('🔧 frame não voltou — forçando reinicialização do cliente...');
        try { await reinicializar(); } catch (_) { /* reinicializar já alerta */ }
        await esperarPronto(90000);
      }
    }
  }
  throw ultimo;
}

// Cache de grupo por nome (evita reler a lista de chats a cada envio).
const gruposCache = new Map();

// User-Agent REAL de Chrome desktop. Sem isso o Chrome headless se anuncia como
// "HeadlessChrome/NNN" e a WhatsApp Web atual mostra "atualize o navegador"
// (mesmo com Chrome novo), a página nunca injeta e o Client.inject estoura em 30s.
const WA_UA = process.env.WA_USER_AGENT
  || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

function criarClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    webVersionCache: { type: 'none' },
    userAgent: WA_UA,
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
  iniciarWatcherComando(); // escuta o pedido de "desconectar" vindo do painel

  let rejectInit = null;
  initPromise = new Promise((resolve, reject) => {
    rejectInit = reject;
    client.on('qr', (qr) => {
      console.log('\n📲 Escaneie o QR no WhatsApp do número (Aparelhos conectados → Conectar um aparelho):\n');
      qrcodeTerminal.generate(qr, { small: true });
      // Grava o QR (como imagem) no estado compartilhado para o painel exibir.
      // O QR é gerado LOCALMENTE (nunca enviado a serviços externos — é um token).
      require('qrcode').toDataURL(qr, { margin: 1, width: 320 })
        .then(dataUrl => waStatus.set('qr', dataUrl))
        .catch(() => waStatus.set('qr', null));
      // ALERTA CRÍTICO: com a sessão salva, o QR NÃO deveria aparecer. Se apareceu,
      // a sessão caiu e o bot está PARADO até alguém escanear o QR (no painel ou servidor).
      notif.alertar(
        'WhatsApp CAIU — precisa de QR',
        'A sessao do WhatsApp expirou. Abra o painel (aba WhatsApp) e escaneie o QR, ou rode no servidor: pm2 logs slimfit-exp. Ate la, NENHUMA mensagem sai.',
        { prioridade: 'urgent', tags: 'rotating_light', forcar: true },
      );
    });
    let resolvido = false;
    const marcarPronto = (via) => {
      if (resolvido) return;
      resolvido = true;
      pronto = true;
      waStatus.set('conectado', null);
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
      waStatus.set('desconectado', null);
      log('⚠️  Desconectado: ' + motivo);
    });

    setTimeout(() => {
      if (!pronto) log('⚠️  Ainda sem "ready" após 90s (o fallback getState continua tentando).');
    }, 90000);
  });

  waStatus.set('iniciando', null);
  // PADRÃO: versão AO VIVO (type 'none'). Provado em produção: com o User-Agent
  // certo a lib conecta ao vivo, e FIXAR versão (mesmo uma que existe) faz o
  // inject travar. Só fixa se WA_WEB_VERSION_URL vier explícito no .env e responder 200.
  (process.env.WA_WEB_VERSION_URL && !VERSAO_FIXA_DESLIGADA
    ? versaoFixaUsavel().then((ok) => { if (ok) client.options.webVersionCache = { type: 'remote', remotePath: WEB_VERSION_URL }; })
    : Promise.resolve())
    .catch(() => {})
    .then(() => client.initialize())
    .catch((e) => {
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
/**
 * Variações brasileiras do mesmo celular: COM e SEM o 9º dígito.
 * Contas antigas seguem registradas no WhatsApp sem o 9 (ex.: 11 8428-3474),
 * enquanto o cadastro traz com o 9 (11 99428-3474) — e vice-versa. Tentar só
 * uma forma dá "No LID for user" e a mensagem nunca sai.
 */
function variantesBR(n) {
  const out = [n];
  const m = /^55(\d{2})(\d+)$/.exec(n);
  if (m) {
    const [, ddd, local] = m;
    if (local.length === 9 && local[0] === '9') out.push(`55${ddd}${local.slice(1)}`); // tira o 9
    else if (local.length === 8 && '6789'.includes(local[0])) out.push(`55${ddd}9${local}`); // põe o 9
  }
  return out;
}

async function resolverId(telefone) {
  let n = String(telefone || '').replace(/\D/g, '');
  if (!n) throw new Error('telefone vazio');
  if (!n.startsWith('55')) n = '55' + n;

  let houveErro = false;             // erro de conexão ≠ número inexistente
  for (const cand of variantesBR(n)) {
    try {
      const numId = await comRetry(() => client.getNumberId(cand));
      if (numId && numId._serialized) {
        if (cand !== n) log(`ℹ️  ${n} não existe no WhatsApp; usando ${cand} (9º dígito).`);
        return numId._serialized;
      }
    } catch (_) { houveErro = true; }  // instabilidade: não conclui que é inválido
  }

  // Nenhuma variação existe. Antes caíamos em "<numero>@c.us", o envio falhava
  // com "No LID for user" e o job repetia por horas. Agora desiste na hora.
  if (!houveErro) {
    const err = new Error(`número sem WhatsApp: ${n}`);
    err.code = 'INVALIDO';
    throw err;
  }
  return n + '@c.us';                 // só instabilidade → deixa o envio tentar
}

// Envia texto para uma pessoa. `chaveFoto` (opcional): se houver uma foto (flyer)
// salva no painel para essa mensagem, ela é enviada JUNTO, com o texto como
// legenda. Sem foto salva, envia só o texto — comportamento idêntico ao antigo.
async function sendTexto(telefone, texto, contexto, chaveFoto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  let fotoPath = null;
  if (chaveFoto) { try { fotoPath = require('./mensagens').fotoPath(chaveFoto); } catch (_) {} }
  try {
    const id = await resolverId(telefone);
    let r;
    if (fotoPath) {
      const media = MessageMedia.fromFilePath(fotoPath); // flyer com o texto como legenda
      r = await comRetry(() => client.sendMessage(id, media, { caption: texto || undefined }));
    } else {
      r = await comRetry(() => client.sendMessage(id, texto));
    }
    atividade.registrar({ destino: telefone, preview: (fotoPath ? '📎 ' : '') + texto, midia: !!fotoPath, ok: true, contexto });
    return r;
  } catch (e) {
    atividade.registrar({ destino: telefone, preview: texto, ok: false, erro: e && e.message, contexto });
    throw e;
  }
}

/**
 * Envia mídia (áudio/imagem/etc). Aceita URL http(s) ou caminho local.
 * legenda é opcional. Para áudio como "mensagem de voz", passe sendAudioAsVoice.
 */
async function sendMidia(telefone, urlOuCaminho, { legenda = '', comoVoz = false, contexto } = {}) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  try {
    const media = /^https?:\/\//i.test(urlOuCaminho)
      ? await MessageMedia.fromUrl(urlOuCaminho, { unsafeMime: true })
      : MessageMedia.fromFilePath(urlOuCaminho);
    // Nota de voz (PTT): o WhatsApp só decodifica Opus se o mimetype trouxer o
    // codec. O MessageMedia grava só "audio/ogg" → o destinatário vê "há algo
    // errado com o arquivo de áudio". Forçamos "audio/ogg; codecs=opus".
    if (comoVoz && /\.(ogg|opus|oga)(\?|$)/i.test(urlOuCaminho)) {
      media.mimetype = 'audio/ogg; codecs=opus';
    }
    const id = await resolverId(telefone);
    const r = await comRetry(() => client.sendMessage(id, media, {
      caption: legenda || undefined,
      sendAudioAsVoice: comoVoz || undefined,
    }));
    atividade.registrar({ destino: telefone, preview: legenda || (comoVoz ? '🎤 áudio' : '📎 mídia'), midia: true, ok: true, contexto });
    return r;
  } catch (e) {
    atividade.registrar({ destino: telefone, preview: legenda || '📎 mídia', midia: true, ok: false, erro: e && e.message, contexto });
    throw e;
  }
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

async function sendGrupo(nomeGrupo, texto, contexto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  try {
    const g = await acharGrupo(nomeGrupo);
    if (!g) throw new Error('Grupo não encontrado: ' + nomeGrupo);
    const r = await comRetry(() => client.sendMessage(g.id, texto));
    atividade.registrar({ destino: nomeGrupo, preview: texto, grupo: true, ok: true, contexto });
    return r;
  } catch (e) {
    atividade.registrar({ destino: nomeGrupo, preview: texto, grupo: true, ok: false, erro: e && e.message, contexto });
    throw e;
  }
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
    const r = await comRetry(() => client.sendMessage(groupId, texto, { mentions: [mid] }));
    atividade.registrar({ destino: 'grupo', preview: texto, grupo: true, ok: true });
    return r;
  } catch (e) {
    atividade.registrar({ destino: 'grupo', preview: texto, grupo: true, ok: false, erro: e && e.message });
    throw new Error('sendMessage(mention): ' + (e && e.message));
  }
}

/** Envia uma FOTO (com legenda) num grupo, achando-o pelo nome. */
async function sendGrupoMidia(nomeGrupo, caminho, legenda, contexto) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  try {
    const g = await acharGrupo(nomeGrupo);
    if (!g) throw new Error('Grupo não encontrado: ' + nomeGrupo);
    const media = MessageMedia.fromFilePath(caminho);
    const r = await comRetry(() => client.sendMessage(g.id, media, { caption: legenda || undefined }));
    atividade.registrar({ destino: nomeGrupo, preview: legenda || '📎 foto', grupo: true, midia: true, ok: true, contexto });
    return r;
  } catch (e) {
    atividade.registrar({ destino: nomeGrupo, preview: legenda || '📎 foto', grupo: true, midia: true, ok: false, erro: e && e.message, contexto });
    throw e;
  }
}

/** Envia uma FOTO num grupo com a legenda MARCANDO (@) uma pessoa. */
async function sendGrupoMidiaComMencao(groupId, caminho, textoAntes, textoDepois, telefoneMencionado) {
  if (!pronto) throw new Error('WhatsApp ainda não está pronto (ready).');
  let mid;
  try { mid = await resolverId(telefoneMencionado); }
  catch (e) { throw new Error('resolverId: ' + (e && e.message)); }
  const user = mid.replace(/@.*/, '');
  const legenda = `${textoAntes || ''}@${user}${textoDepois || ''}`;
  try {
    const media = MessageMedia.fromFilePath(caminho);
    const r = await comRetry(() => client.sendMessage(groupId, media, { caption: legenda, mentions: [mid] }));
    atividade.registrar({ destino: 'grupo', preview: legenda, grupo: true, midia: true, ok: true });
    return r;
  } catch (e) {
    atividade.registrar({ destino: 'grupo', preview: legenda, grupo: true, midia: true, ok: false, erro: e && e.message });
    throw new Error('sendMessage(midiaMencao): ' + (e && e.message));
  }
}

let reconectando = false;
/**
 * Recupera o cliente quando o frame do WhatsApp Web morre e não volta sozinho
 * (destrói e recria usando a sessão salva — sem QR). É o "conserto automático".
 */
async function reinicializar() {
  if (reconectando) return;
  reconectando = true;
  try {
    log('♻️  Frame do WhatsApp morto — reinicializando o cliente...');
    try { if (client) await client.destroy(); } catch (_) { /* já morto */ }
    pronto = false;
    initPromise = null;
    gruposCache.clear();
    await initWhatsApp(); // recria + reconecta (LocalAuth: usa a sessão salva)
    log('✅ Cliente do WhatsApp reinicializado com sucesso.');
  } catch (e) {
    log('❌ Falha ao reinicializar o WhatsApp: ' + (e && e.message));
    // O conserto automático falhou — avisa para intervenção manual no servidor.
    notif.alertar(
      'WhatsApp nao reconectou sozinho',
      'O watchdog tentou religar o WhatsApp e falhou: ' + ((e && e.message) || 'erro desconhecido') +
      '. Verifique o servidor (pm2 restart slimfit-exp) e, se pedir, escaneie o QR.',
      { prioridade: 'urgent', tags: 'rotating_light', forcar: true },
    );
  } finally {
    reconectando = false;
  }
}

/**
 * Watchdog do WhatsApp: a cada ~15 min confere o estado (getState). Se o frame
 * estiver morto/detached, RECONECTA sozinho (reinicializar) — antes só avisava,
 * e o cliente ficava travado até o restart das 03:00.
 */
function iniciarKeepAlive(minutos = 15) {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(async () => {
    try {
      const s = await client.getState();
      log('💓 keep-alive — estado: ' + s);
    } catch (e) {
      log('⚠️  keep-alive falhou: ' + e.message);
      if (ehTransiente(e)) await reinicializar(); // frame morto → autorrecupera
    }
  }, minutos * 60 * 1000);
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
  getCommonGroups, sendGrupoComMencao, sendGrupoMidia, sendGrupoMidiaComMencao,
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

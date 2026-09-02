/**
 * instagram-api.js — Integração OFICIAL do Instagram (Graph API da Meta).
 *
 * Substitui a automação por cookie/navegador (que vivia caindo). Aqui NÃO há
 * login por senha nem sessionid: a Meta chama o nosso webhook quando alguém
 * COMENTA ou manda DM, e a gente responde no DM pela API oficial — dentro das
 * regras da plataforma, então não derruba a conta.
 *
 * Fluxo: aluna comenta a palavra-chave num post/reel  →  webhook  →  DM
 * automático com uma mensagem calorosa + link do formulário (que já agenda no
 * EVO e entrega pra SoFIA no WhatsApp). Reaproveita todo o funil que já existe.
 *
 * Segredos vêm do .env (nunca do código/Git):
 *   IG_APP_ID          ID do aplicativo Meta
 *   IG_APP_SECRET      Chave secreta (confere a assinatura dos webhooks)
 *   IG_PAGE_ID         ID da Página do Facebook ligada ao Instagram
 *   IG_PAGE_TOKEN      Token de acesso gerado no painel da Meta
 *   IG_VERIFY_TOKEN    Senha de verificação do webhook (a gente define)
 *   IG_FORM_URL        Link do formulário (opcional; entra no {link} da mensagem)
 *   IG_GRAPH_VER       Versão da Graph API (opcional; padrão v21.0)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let atividade = null;
try { atividade = require('./atividade'); } catch (_) { atividade = null; }

const APP_ID = process.env.IG_APP_ID || '';
const APP_SECRET = process.env.IG_APP_SECRET || '';
const PAGE_ID = process.env.IG_PAGE_ID || '';
const PAGE_TOKEN_ENV = process.env.IG_PAGE_TOKEN || '';
const VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN || '';
const GRAPH = process.env.IG_GRAPH_VER || 'v21.0';
const HOST = 'graph.facebook.com';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'instagram-api-token.json'); // token de longa duração + ids (gitignored: *token*)
const CFG_FILE = path.join(DATA_DIR, 'instagram-api-config.json');  // palavra-chave, mensagem, link (estado por VPS)

// ─── Config editável (arquivo por VPS; painel edita depois) ────────────────
function cfgPadrao() {
  return {
    enabled: true,
    // Se o comentário CONTÉM qualquer uma destas palavras (sem diferenciar
    // maiúscula/acento), dispara o DM. Vazio = qualquer comentário dispara.
    palavras: ['eu', 'quero', 'experimental', 'aula', 'info'],
    // {link} é trocado pelo IG_FORM_URL (ou pelo campo link abaixo).
    mensagem: 'Oii! Que alegria te ver por aqui 💚\n\nBora marcar sua aula experimental gratuita? É rapidinho, é só preencher aqui que a gente já organiza o melhor horário pra você:\n\n{link}\n\nQualquer dúvida, é só me chamar por aqui! 😊',
    link: process.env.IG_FORM_URL || '',
    responderDM: true, // também responde quem manda DM direto (dentro das 24h)
    maxDia: parseInt(process.env.IG_MAX_DIA || '80', 10),
  };
}
function lerCfg() {
  try { return Object.assign(cfgPadrao(), JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); }
  catch (_) { return cfgPadrao(); }
}
function gravarCfg(patch) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const novo = Object.assign(lerCfg(), patch || {}, { atualizadoEm: new Date().toISOString() });
  fs.writeFileSync(CFG_FILE, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

// ─── Cache do token/ids (persistido entre reinícios) ───────────────────────
function lerCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (_) { return {}; } }
function gravarCache(patch) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const novo = Object.assign(lerCache(), patch || {});
  fs.writeFileSync(CACHE_FILE, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

let _cache = lerCache();
function tokenAtual() { return _cache.token || PAGE_TOKEN_ENV || ''; }
function igUserId() { return _cache.igUserId || ''; }

// ─── HTTP helpers (Graph API) ──────────────────────────────────────────────
function req(metodo, caminho, corpoObj) {
  return new Promise((resolve, reject) => {
    const dados = corpoObj ? JSON.stringify(corpoObj) : null;
    const r = https.request({
      host: HOST, method: metodo, path: `/${GRAPH}${caminho}`,
      headers: Object.assign({ 'Accept': 'application/json' },
        dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
    }, (resp) => {
      let b = '';
      resp.on('data', c => { b += c; });
      resp.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch (_) { j = { raw: b }; }
        if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(j);
        else reject(new Error((j && j.error && j.error.message) || ('HTTP ' + resp.statusCode)));
      });
    });
    r.on('error', reject);
    r.setTimeout(15000, () => r.destroy(new Error('timeout')));
    if (dados) r.write(dados);
    r.end();
  });
}
const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ─── Bootstrap: token de longa duração + descobrir a conta do Instagram ────
async function bootstrap() {
  if (!APP_ID || !APP_SECRET || !PAGE_ID || !PAGE_TOKEN_ENV) {
    console.log('[ig-api] faltam variáveis (.env): IG_APP_ID / IG_APP_SECRET / IG_PAGE_ID / IG_PAGE_TOKEN — integração inativa.');
    return { ok: false, motivo: 'env' };
  }
  try {
    // 1) troca o token por um de LONGA duração (não vence em ~1h)
    let longo = PAGE_TOKEN_ENV;
    try {
      const tk = await req('GET', `/oauth/access_token?${qs({
        grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: PAGE_TOKEN_ENV,
      })}`);
      if (tk && tk.access_token) longo = tk.access_token;
    } catch (e) { console.log('[ig-api] não deu p/ trocar por longa duração (', e.message, ') — sigo com o token informado.'); }

    // 2) descobre o ID/@ da conta do Instagram ligada à Página
    const pg = await req('GET', `/${PAGE_ID}?${qs({ fields: 'name,instagram_business_account{id,username,name}', access_token: longo })}`);
    const iba = pg && pg.instagram_business_account;
    if (!iba || !iba.id) throw new Error('a Página não tem uma conta do Instagram profissional vinculada');

    _cache = gravarCache({ token: longo, igUserId: iba.id, igUsername: iba.username || '', pageName: pg.name || '', validadoEm: new Date().toISOString() });
    console.log(`[ig-api] pronto ✅ conta @${iba.username || iba.id} (id ${iba.id}) vinculada à Página "${pg.name || PAGE_ID}".`);
    // Faz 1 chamada bem-sucedida de CADA permissão — é o que a Meta exige pra
    // liberar o botão "Solicitar acesso avançado" (App Review). Best-effort.
    aquecerPermissoes(longo, iba.id).catch(() => {});
    return { ok: true, igUserId: iba.id, igUsername: iba.username };
  } catch (e) {
    console.log('[ig-api] falha no bootstrap:', e.message);
    return { ok: false, motivo: e.message };
  }
}

// Dispara uma leitura leve por permissão, pra "registrar uso" na Meta e ativar
// o pedido de acesso avançado. Cada chamada é isolada (uma falha não trava as
// outras) e o resultado vai pro log — bom pra você acompanhar.
async function aquecerPermissoes(token, igId) {
  const tentar = async (rotulo, caminho) => {
    try { await req('GET', `${caminho}${caminho.includes('?') ? '&' : '?'}${qs({ access_token: token })}`); console.log(`[ig-api] aquecimento ✓ ${rotulo}`); return true; }
    catch (e) { console.log(`[ig-api] aquecimento ✗ ${rotulo}: ${e.message}`); return false; }
  };
  // instagram_basic — ler a própria conta
  await tentar('instagram_basic (conta)', `/${igId}?fields=username,followers_count`);
  // instagram_manage_messages — listar conversas do Instagram. O caminho oficial
  // é pela PÁGINA (?platform=instagram); se falhar, tenta pela conta como reserva.
  let okMsg = false;
  if (PAGE_ID) okMsg = await tentar('instagram_manage_messages (conversas via página)', `/${PAGE_ID}/conversations?platform=instagram&fields=id&limit=1`);
  if (!okMsg) await tentar('instagram_manage_messages (conversas via conta)', `/${igId}/conversations?platform=instagram&fields=id&limit=1`);
  // pages_manage_metadata — ver apps assinados na Página
  if (PAGE_ID) await tentar('pages_manage_metadata (subscribed_apps)', `/${PAGE_ID}/subscribed_apps`);
  // instagram_manage_comments — ler comentários da mídia mais recente
  try {
    const media = await req('GET', `/${igId}/media?fields=id&limit=1&${qs({ access_token: token })}`);
    const mid = media && media.data && media.data[0] && media.data[0].id;
    if (mid) await tentar('instagram_manage_comments (comentários)', `/${mid}/comments?fields=id&limit=1`);
    else console.log('[ig-api] aquecimento — sem mídia p/ testar comentários (poste algo e reinicie).');
  } catch (e) { console.log('[ig-api] aquecimento ✗ comentários (mídia):', e.message); }
  console.log('[ig-api] aquecimento concluído — os botões "Solicitar acesso avançado" costumam ativar em até 24h.');
}

// ─── Webhook: verificação (GET) e assinatura (POST) ────────────────────────
// A Meta chama GET /ig/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
function verificar(query) {
  const p = new URLSearchParams(query || '');
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === VERIFY_TOKEN && VERIFY_TOKEN) {
    return p.get('hub.challenge') || '';
  }
  return null;
}
// Confere X-Hub-Signature-256: sha256=<hmac do corpo cru com o APP_SECRET>.
function assinaturaValida(corpoCru, header) {
  if (!APP_SECRET || !header) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(corpoCru, 'utf8').digest('hex');
  try {
    const a = Buffer.from(header); const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// ─── Regras: casar palavra-chave e montar a mensagem ───────────────────────
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function combina(texto, palavras) {
  if (!palavras || !palavras.length) return true; // sem filtro = qualquer texto dispara
  const t = semAcento(texto);
  return palavras.some(p => t.includes(semAcento(p)));
}
function montarMensagem(cfg) {
  const link = cfg.link || process.env.IG_FORM_URL || '';
  return String(cfg.mensagem || '').replace(/\{link\}/g, link).trim();
}

// ─── Envio de DM (resposta a comentário = private reply; ou DM direto) ─────
async function enviarDM(recipient, texto) {
  const id = igUserId();
  if (!id) throw new Error('conta do Instagram ainda não resolvida (rode o bootstrap)');
  return req('POST', `/${id}/messages?${qs({ access_token: tokenAtual() })}`, { recipient, message: { text: texto } });
}

// ─── De-dup (webhooks reenviam; não responder 2x o mesmo id) ───────────────
const _vistos = new Set();
function jaTratado(id) {
  if (!id) return false;
  if (_vistos.has(id)) return true;
  _vistos.add(id);
  if (_vistos.size > 2000) { for (const k of _vistos) { _vistos.delete(k); if (_vistos.size <= 1500) break; } }
  return false;
}

function contadorHoje() {
  try { return (atividade ? atividade.doDia() : []).filter(e => e.contexto === 'Instagram (DM)' && e.ok).length; }
  catch (_) { return 0; }
}

// ─── Processa um payload de webhook do Instagram ───────────────────────────
async function processar(body) {
  const cfg = lerCfg();
  if (!cfg.enabled) return { ok: true, ignorado: 'desligado' };
  if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) return { ok: true, ignorado: 'nao-instagram' };

  const meu = igUserId();
  const msgTexto = montarMensagem(cfg);
  let enviados = 0, erros = 0;

  for (const entry of body.entry) {
    // 1) COMENTÁRIOS (gatilho principal: "comentou EU")
    for (const ch of (entry.changes || [])) {
      if (ch.field !== 'comments') continue;
      const v = ch.value || {};
      const fromId = v.from && v.from.id;
      const commentId = v.id;
      if (!commentId || (fromId && meu && String(fromId) === String(meu))) continue; // ignora meus próprios comentários
      if (jaTratado('c:' + commentId)) continue;
      if (!combina(v.text || '', cfg.palavras)) continue;
      if (contadorHoje() >= cfg.maxDia) { console.log('[ig-api] limite/dia atingido — pulando.'); continue; }
      try {
        await enviarDM({ comment_id: commentId }, msgTexto); // private reply: 1 DM em resposta ao comentário
        enviados++;
        if (atividade) atividade.registrar({ contexto: 'Instagram (DM)', destino: (v.from && v.from.username) || fromId || 'comentário', midia: false, ok: true, preview: 'resposta a comentário: ' + (v.text || '') });
      } catch (e) {
        erros++;
        if (atividade) atividade.registrar({ contexto: 'Instagram (DM)', destino: (v.from && v.from.username) || fromId || 'comentário', ok: false, erro: e.message, preview: v.text || '' });
        console.log('[ig-api] erro ao responder comentário:', e.message);
      }
    }

    // 2) DMs recebidos (responde quem escreve, dentro da janela de 24h)
    if (cfg.responderDM) {
      for (const m of (entry.messaging || [])) {
        const msg = m.message || {};
        if (msg.is_echo) continue;                          // ignora ecos das minhas próprias mensagens
        const senderId = m.sender && m.sender.id;
        if (!senderId || (meu && String(senderId) === String(meu))) continue;
        const mid = msg.mid;
        if (jaTratado('m:' + (mid || senderId + ':' + (m.timestamp || '')))) continue;
        if (!combina(msg.text || '', cfg.palavras)) continue;
        if (contadorHoje() >= cfg.maxDia) continue;
        try {
          await enviarDM({ id: senderId }, msgTexto);
          enviados++;
          if (atividade) atividade.registrar({ contexto: 'Instagram (DM)', destino: senderId, midia: false, ok: true, preview: 'resposta a DM: ' + (msg.text || '') });
        } catch (e) {
          erros++;
          if (atividade) atividade.registrar({ contexto: 'Instagram (DM)', destino: senderId, ok: false, erro: e.message, preview: msg.text || '' });
          console.log('[ig-api] erro ao responder DM:', e.message);
        }
      }
    }
  }
  return { ok: true, enviados, erros };
}

// Metadados p/ o painel (nunca expõe token/secret).
function status() {
  const c = lerCache();
  return {
    configurado: !!(APP_ID && APP_SECRET && PAGE_ID && PAGE_TOKEN_ENV),
    verifyDefinido: !!VERIFY_TOKEN,
    conta: c.igUsername ? ('@' + c.igUsername) : '',
    igUserId: c.igUserId || '',
    pagina: c.pageName || '',
    validadoEm: c.validadoEm || '',
    enviadosHoje: contadorHoje(),
  };
}

module.exports = {
  bootstrap, verificar, assinaturaValida, processar, enviarDM,
  lerCfg, gravarCfg, status, igUserId, tokenAtual, VERIFY_TOKEN_DEFINIDO: !!VERIFY_TOKEN,
};

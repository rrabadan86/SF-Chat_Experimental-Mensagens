/**
 * push.js — notificações do painel no celular e no computador (Web Push).
 *
 * O painel vira "app instalável" e cada aparelho pode pedir para receber avisos:
 *   atendente — alguém pediu atendente na SoFIA
 *   agendou   — aula experimental agendada
 *   recepcao  — os outros avisos que a SoFIA manda para a recepção
 *   saude     — alerta da Saúde (robô parado, WhatsApp desconectado…)
 *
 * Sem dependência nova: usa só o `crypto` e o `https` do Node.
 *   • VAPID (RFC 8292): o servidor se identifica ao serviço de push com um JWT
 *     assinado por uma chave própria desta unidade (data/push-vapid.json).
 *   • Conteúdo cifrado (RFC 8291, aes128gcm): a mensagem vai cifrada para a chave
 *     DO APARELHO — Google/Apple/Mozilla só repassam, não leem.
 *
 * Arquivos em data/ (não vão para o git):
 *   push-vapid.json        chave desta unidade (a privada é SEGREDO)
 *   push-inscricoes.json   aparelhos inscritos: de quem, quais avisos
 *
 * Regras:
 *   • Permissão conferida NO ENVIO: quem perdeu a permissão (ou foi excluído) para
 *     de receber, mesmo com o aparelho ainda inscrito.
 *   • O endereço de entrega vem do navegador: só aceitamos os serviços de push
 *     conhecidos (senão o servidor poderia ser usado para chamar qualquer endereço).
 *   • Demonstração: não envia nada (nada sai para a rede).
 *   • Nunca derruba quem chamou: enviar() não lança erro.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const DATA = path.resolve(__dirname, '..', 'data');
const ARQ_VAPID = path.join(DATA, 'push-vapid.json');
const ARQ_INSC = path.join(DATA, 'push-inscricoes.json');
const MAX_POR_USUARIO = 8, MAX_TOTAL = 300;

// Tipos de aviso — cada pessoa escolhe, em cada aparelho, quais quer receber — e a
// permissão que cada um exige (a mesma da tela correspondente). `padrao` = já vem
// marcado na primeira vez.
const TIPOS = {
  atendente: { rot: 'Alguém pediu atendente', sub: 'A pessoa pediu para falar com alguém da equipe e a conversa ficou marcada em vermelho.', tela: 'sofia_conversas', padrao: true },
  agendou: { rot: 'Aula experimental agendada', sub: 'Uma lead agendou pela SoFIA ou pelo Formulário.', tela: 'sofia_conversas', padrao: true },
  recepcao: { rot: 'Outros avisos da SoFIA para a recepção', sub: 'Palavra-chave, intenção detectada, resposta a campanha, lead nova… — os que estão marcados para avisar a recepção em SoFIA → Tags.', tela: 'sofia_conversas', padrao: false },
  saude: { rot: 'Alertas da Saúde do sistema', sub: 'Robô parado, WhatsApp desconectado, servidor sobrecarregado, backup atrasado.', tela: 'saude', padrao: true },
};
const podeTipo = (sess, tipo) => !!(sess && TIPOS[tipo] && (sess.admin || (sess.telas || []).includes(TIPOS[tipo].tela)));
const tiposDe = (sess) => Object.keys(TIPOS).filter(t => podeTipo(sess, t));

const b64u = (b) => Buffer.from(b).toString('base64url');
const deB64u = (s) => Buffer.from(String(s || ''), 'base64url');
const lerJson = (arq, padrao) => { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o == null ? padrao : o; } catch (_) { return padrao; } };
function gravarJson(arq, obj, modo) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = arq + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), modo ? { mode: modo } : undefined);
  fs.renameSync(tmp, arq);
}

// ── Chave desta unidade (VAPID) ─────────────────────────────────────────────
// Criada na primeira vez. Se for apagada, todos os aparelhos precisam ativar de novo.
function chaves() {
  const o = lerJson(ARQ_VAPID, null);
  if (o && o.publica && o.privada) return o;
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const d = ec.getPrivateKey(); // pode vir com menos de 32 bytes (zeros à esquerda cortados)
  const nova = { publica: b64u(ec.getPublicKey()), privada: b64u(Buffer.concat([Buffer.alloc(32 - d.length), d])), criadaEm: new Date().toISOString() };
  gravarJson(ARQ_VAPID, nova, 0o600);
  return nova;
}
function chavePublica() { return chaves().publica; }
// JWT que identifica este servidor ao serviço de push (vale 12 h, só para aquele serviço).
function vapidJwt(endpoint, contato, agora) {
  const k = chaves(), pub = deB64u(k.publica);
  const chave = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: k.privada, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor((agora || Date.now()) / 1000) + 12 * 3600, sub: contato || 'https://localhost' }));
  const ass = crypto.sign('sha256', Buffer.from(cab + '.' + corpo), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `${cab}.${corpo}.${b64u(ass)}`;
}

// ── Cifra (RFC 8291, aes128gcm) ─────────────────────────────────────────────
// p256dh = chave pública do aparelho (65 bytes), auth = segredo do aparelho (16 bytes).
function cifrar(p256dh, auth, texto) {
  const ua = deB64u(p256dh), seg = deB64u(auth);
  if (ua.length !== 65 || ua[0] !== 4 || seg.length !== 16) throw new Error('chaves do aparelho inválidas');
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const as = ec.getPublicKey();
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ec.computeSecret(ua), seg, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]); // 0x02 = último registro
  const cab = Buffer.alloc(21); salt.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = as.length;
  return Buffer.concat([cab, as, ct]);
}

// ── Endereço de entrega ─────────────────────────────────────────────────────
// Só os serviços de push dos navegadores (Chrome/Android/Edge/Samsung, Firefox, Safari).
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];
function endpointOk(u) {
  try { const o = new URL(String(u || '')); return o.protocol === 'https:' && !o.username && !o.password && (!o.port || o.port === '443') && HOSTS_PUSH.some(r => r.test(o.hostname)); } catch (_) { return false; }
}

// ── Aparelhos inscritos ─────────────────────────────────────────────────────
function inscricoes() { const l = lerJson(ARQ_INSC, []); return Array.isArray(l) ? l.filter(x => x && x.endpoint && x.usuario) : []; }
const idDe = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 16);
// "Chrome no Android", "Safari no iPhone"… (só para a pessoa reconhecer o aparelho na lista)
function aparelhoDe(ua) {
  const s = String(ua || '');
  const onde = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'aparelho';
  const nav = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'navegador';
  return `${nav} no ${onde}`;
}
// Inscreve (ou atualiza) o aparelho do usuário. `sess` = quem está logado; `tipos`
// pedidos são filtrados pelo que a pessoa pode ver. → a inscrição gravada.
function inscrever(sess, sub, tipos, ua, origem) {
  if (!sess || !sess.usuario) throw new Error('faça login');
  const endpoint = String((sub && sub.endpoint) || '');
  if (!endpointOk(endpoint)) throw new Error('este navegador usa um serviço de notificação que o painel não reconhece');
  const p256dh = String((sub.keys && sub.keys.p256dh) || ''), auth = String((sub.keys && sub.keys.auth) || '');
  if (deB64u(p256dh).length !== 65 || deB64u(auth).length !== 16) throw new Error('chaves do aparelho inválidas');
  const quer = (Array.isArray(tipos) ? tipos : []).filter(t => podeTipo(sess, t));
  if (!quer.length) throw new Error('escolha pelo menos um tipo de aviso');
  const id = idDe(endpoint);
  let l = inscricoes().filter(x => x.id !== id);
  const meus = l.filter(x => x.usuario === sess.usuario);
  if (meus.length >= MAX_POR_USUARIO) { const velho = meus.sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0))[0]; l = l.filter(x => x !== velho); }
  if (l.length >= MAX_TOTAL) throw new Error('muitos aparelhos inscritos nesta unidade');
  const nova = { id, usuario: sess.usuario, endpoint, keys: { p256dh, auth }, tipos: quer, aparelho: aparelhoDe(ua), criadoEm: Date.now() };
  l.push(nova);
  gravarJson(ARQ_INSC, l, 0o600);
  // contato do VAPID = endereço público deste painel (o serviço de push exige um; não é dado de ninguém)
  if (origem && /^https:\/\//.test(origem)) { const k = chaves(); if (k.contato !== origem) gravarJson(ARQ_VAPID, { ...k, contato: origem }, 0o600); }
  return nova;
}
function remover(usuario, id) {
  const l = inscricoes(), fica = l.filter(x => !(x.id === id && x.usuario === usuario));
  if (fica.length === l.length) return false;
  gravarJson(ARQ_INSC, fica, 0o600); return true;
}
// O que a tela mostra de cada aparelho (sem chaves nem endereço de entrega).
function doUsuario(usuario) { return inscricoes().filter(x => x.usuario === usuario).map(x => ({ id: x.id, aparelho: x.aparelho, tipos: x.tipos, criadoEm: x.criadoEm, ultimoOk: x.ultimoOk || 0 })); }

// Permissões de HOJE de um usuário (sem depender do painel estar no ar: o robô e
// o vigia também enviam). null = usuário não existe mais.
function sessDe(usuario) {
  const usuarios = require('./usuarios');
  if (usuarios.normU(usuario) === usuarios.normU(process.env.PAINEL_USER || 'admin')) return { usuario, admin: true, telas: [] };
  const u = usuarios.obter(usuario);
  return u ? { usuario, admin: !!u.admin, telas: u.telas || [] } : null;
}

// ── Envio ───────────────────────────────────────────────────────────────────
// Transporte trocável nos testes: (endpoint, cabeçalhos, corpo) → Promise<{ status }>.
let transporte = (endpoint, headers, corpo) => new Promise((ok, falha) => {
  const u = new URL(endpoint);
  const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers, timeout: 15000 }, (r) => { r.resume(); r.on('end', () => ok({ status: r.statusCode })); });
  req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
  req.on('error', falha);
  req.end(corpo);
});
function usarTransporte(fn) { transporte = fn; }

// Monta a requisição de UM aparelho (cabeçalhos + corpo cifrado).
function montar(insc, dados, { urgente } = {}) {
  const texto = JSON.stringify({ titulo: String(dados.titulo || 'SlimFit').slice(0, 120), corpo: String(dados.corpo || '').slice(0, 600), url: /^\/[^/\\]/.test(String(dados.url || '')) || dados.url === '/' ? String(dados.url).slice(0, 300) : '/', tag: String(dados.tag || '').slice(0, 60) });
  const corpo = cifrar(insc.keys.p256dh, insc.keys.auth, texto);
  const k = chaves();
  return { corpo, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': corpo.length,
    TTL: String(urgente ? 24 * 3600 : 4 * 3600), Urgency: urgente ? 'high' : 'normal',
    Authorization: `vapid t=${vapidJwt(insc.endpoint, k.contato)}, k=${k.publica}`,
  } };
}
// Envia para uma lista de inscrições e faz a faxina: aparelho que o serviço diz
// que não existe mais (404/410) sai da lista. → { enviados, falhas, removidos }
async function entregar(lista, dados, opcoes) {
  const r = { enviados: 0, falhas: 0, removidos: 0 };
  const sumiram = new Set(), ok = new Set();
  await Promise.all(lista.map(async (insc) => {
    try {
      if (!endpointOk(insc.endpoint)) { sumiram.add(insc.id); return; }
      const m = montar(insc, dados, opcoes);
      const res = await transporte(insc.endpoint, m.headers, m.corpo);
      if (res.status >= 200 && res.status < 300) { r.enviados++; ok.add(insc.id); }
      else if (res.status === 404 || res.status === 410) sumiram.add(insc.id);
      else { r.falhas++; console.log(`[push] ${insc.aparelho || 'aparelho'} de ${insc.usuario}: o serviço respondeu HTTP ${res.status}`); }
    } catch (e) { r.falhas++; console.log(`[push] falha ao enviar para ${insc.usuario} (${e && e.message})`); }
  }));
  if (sumiram.size || ok.size) {
    try {
      const agora = Date.now();
      // (relê na hora de gravar: o robô, o vigia e o painel enviam, cada um no seu processo;
      //  e só regrava o "último aviso entregue" de hora em hora, para não ficar escrevendo à toa)
      const atual = inscricoes();
      const mudou = sumiram.size > 0 || atual.some(x => ok.has(x.id) && agora - (x.ultimoOk || 0) > 3600e3);
      if (mudou) gravarJson(ARQ_INSC, atual.filter(x => !sumiram.has(x.id)).map(x => ok.has(x.id) ? { ...x, ultimoOk: agora } : x), 0o600);
      r.removidos = sumiram.size;
    } catch (_) {}
  }
  return r;
}
// Envia um aviso do `tipo` para todos os aparelhos inscritos nele cujo dono AINDA
// tem a permissão. dados = { titulo, corpo, url (caminho do painel), tag }.
async function enviar(tipo, dados, opcoes) {
  const vazio = { enviados: 0, falhas: 0, removidos: 0 };
  try {
    if (require('./demo-guard').ativo || !TIPOS[tipo]) return vazio;
    const cache = new Map();
    const pode = (u) => { if (!cache.has(u)) { let s = null; try { s = sessDe(u); } catch (_) {} cache.set(u, podeTipo(s, tipo)); } return cache.get(u); };
    const lista = inscricoes().filter(x => (x.tipos || []).includes(tipo) && pode(x.usuario));
    if (!lista.length) return vazio;
    return await entregar(lista, dados, opcoes);
  } catch (e) { console.log('[push] envio falhou:', e && e.message); return vazio; }
}
// Teste da tela: só para UM aparelho do próprio usuário.
async function enviarTeste(usuario, id) {
  if (require('./demo-guard').ativo) throw new Error('na demonstração nada é enviado');
  const insc = inscricoes().find(x => x.id === id && x.usuario === usuario);
  if (!insc) throw new Error('este aparelho não está inscrito');
  const r = await entregar([insc], { titulo: 'SlimFit · teste', corpo: 'As notificações estão funcionando neste aparelho.', url: '/notificacoes', tag: 'teste' }, { urgente: true });
  if (r.removidos) throw new Error('o navegador cancelou a inscrição deste aparelho — ative de novo');
  if (!r.enviados) throw new Error('o serviço de notificação recusou o envio — tente de novo em instantes');
  return true;
}

module.exports = {
  ARQ_VAPID, ARQ_INSC, TIPOS, podeTipo, tiposDe, chavePublica, vapidJwt, cifrar, endpointOk, aparelhoDe,
  inscricoes, inscrever, remover, doUsuario, sessDe, montar, enviar, enviarTeste, usarTransporte,
};

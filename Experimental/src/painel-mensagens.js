/**
 * Painel web do Studio (roda na VPS, sob o PM2, porta PAINEL_PORT — padrão 8080).
 * Protegido por usuário e senha (Basic Auth) do .env: PAINEL_USER / PAINEL_SENHA.
 *
 * Duas páginas:
 *   • "/"        → editar os textos das mensagens do robô (data/mensagens.json)
 *   • "/agendar" → agendar envios avulsos por WhatsApp (data/agendamentos.json)
 *                  disparados 10:45 (manhã) e 15:45 (tarde) — ver enviar-agendados.js
 *
 * ⚠️ Basic Auth manda a senha só codificada (não criptografada). Exponha este
 *    painel SEMPRE atrás de HTTPS (ex.: Caddy + subdomínio). Ver o runbook.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const mensagens = require('./mensagens');
const ag = require('./agendamentos');
const waStatus = require('./wa-status');
const horarios = require('./horarios');
const atividade = require('./atividade');
const teste = require('./teste-envio');
const igcfg = require('./instagram-config');
const igcookies = require('./instagram-cookies');
const igforcar = require('./ig-forcar');
const testeIg = require('./teste-instagram');
const indicadores = require('./indicadores');
const bookings = require('./bookings');
const origens = require('./origens');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const usuarios = require('./usuarios');

// Limite de aulas experimentais por turma — editável na aba SoFIA → Configuração.
// Gravado em data/sofia-exp-limite.txt; o cálculo da grade (Python) lê este arquivo.
const EXP_LIM_FILE = path.join(__dirname, '..', 'data', 'sofia-exp-limite.txt');
function lerExpLimite() { try { const n = parseInt(String(fs.readFileSync(EXP_LIM_FILE, 'utf8')).trim(), 10); return (Number.isFinite(n) && n >= 0) ? n : null; } catch (_) { return null; } }
function gravarExpLimite(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 0) return false;
  try { fs.mkdirSync(path.dirname(EXP_LIM_FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(EXP_LIM_FILE, String(v), 'utf8');
  return true;
}

const PORT = parseInt(process.env.PAINEL_PORT || '8080', 10);
// Por padrão escuta SÓ no localhost da VPS: o acesso vem pelo HTTPS do Caddy
// (reverse_proxy localhost:8080) ou por um túnel SSH — nunca direto da internet.
const HOST = process.env.PAINEL_HOST || '127.0.0.1';
const USER = process.env.PAINEL_USER || 'admin';
const SENHA = process.env.PAINEL_SENHA || '';

function seguraIgual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Login por perfil (cookie de sessão assinado) ────────────────────────────
// O admin do .env (USER/SENHA) é o super-usuário: entra sempre, vê tudo e é o
// único que gerencia os Perfis. Os demais usuários ficam em data/usuarios.json
// (via usuarios.js) e só veem as telas marcadas. Sessão = cookie assinado com
// HMAC (não dá pra forjar), guardado no navegador; nada de senha no cookie.
const TODAS_TELAS = usuarios.TELAS_KEYS.slice();
const SESSAO_DIAS = parseInt(process.env.PAINEL_SESSAO_DIAS || '30', 10);
// Segredo de assinatura: do .env, senão gerado e guardado em data/.sessao-segredo
// (assim as sessões sobrevivem a reinícios). Nunca vai para o Git.
const SEGREDO = (function () {
  if (process.env.PAINEL_SESSAO_SEGREDO) return process.env.PAINEL_SESSAO_SEGREDO;
  try {
    const p = require('path').resolve(__dirname, '..', 'data', '.sessao-segredo');
    try { return require('fs').readFileSync(p, 'utf8').trim(); } catch (_) {}
    const s = crypto.randomBytes(32).toString('hex');
    try { require('fs').mkdirSync(require('path').dirname(p), { recursive: true }); } catch (_) {}
    try { require('fs').writeFileSync(p, s, 'utf8'); } catch (_) {}
    return s;
  } catch (_) { return crypto.randomBytes(32).toString('hex'); }
})();
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function assinar(dado) { return crypto.createHmac('sha256', SEGREDO).update(dado).digest('hex'); }
function criarToken(usuario) {
  const payload = b64url(JSON.stringify({ u: usuario, exp: Date.now() + SESSAO_DIAS * 864e5 }));
  return payload + '.' + assinar(payload);
}
function lerToken(tok) {
  const i = String(tok || '').indexOf('.');
  if (i < 0) return null;
  const payload = tok.slice(0, i), sig = tok.slice(i + 1);
  const esperado = assinar(payload);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  let o; try { o = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; }
  if (!o || !o.u || !o.exp || Date.now() > o.exp) return null;
  return o;
}
function lerCookie(req, nome) {
  const raw = req.headers.cookie || '';
  for (const par of raw.split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim() === nome) return decodeURIComponent(par.slice(i + 1).trim()); }
  return '';
}
function ehHttps(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
function setCookieSessao(req, res, valor, maxAgeSec) {
  const partes = [`sf_sess=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (ehHttps(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}
// Devolve o usuário logado (objeto {usuario, admin, telas}) ou null.
function usuarioDaReq(req) {
  const o = lerToken(lerCookie(req, 'sf_sess'));
  if (!o) return null;
  if (SENHA && usuarios.normU(o.u) === usuarios.normU(USER)) return { usuario: USER, admin: true, telas: TODAS_TELAS };
  const u = usuarios.obter(o.u);
  if (!u) return null; // usuário apagado depois de logar
  return { usuario: u.usuario, admin: false, telas: u.telas || [] };
}
// Confere usuário+senha no login. Devolve {usuario, admin} ou null.
function validarLogin(usuario, senha) {
  const u = String(usuario || '').trim();
  if (SENHA && usuarios.normU(u) === usuarios.normU(USER) && seguraIgual(senha, SENHA)) return { usuario: USER, admin: true };
  const fu = usuarios.verificar(u, senha);
  return fu ? { usuario: fu.usuario, admin: false } : null;
}
// Qual aba uma URL pertence (para a checagem de acesso). O resto é a aba WhatsApp.
function telaDaUrl(u) {
  if (u === '/hoje') return 'msg'; // Hoje virou sub-aba do WhatsApp
  if (u === '/indicadores' || u === '/origens/criar' || u === '/origens/excluir') return 'ind';
  if (u === '/instagram' || u.startsWith('/instagram/')) return 'ig';
  if (u === '/sofia' || u.startsWith('/sofia/')) return 'sofia';
  if (u === '/perfis' || u.startsWith('/perfis/')) return 'perfis';
  return 'msg';
}
// Sofia é dividida em três sub-abas com permissão própria.
const SOFIA_SUBS = ['conversas', 'config', 'contatos', 'campanhas'];
function podeSofiaSub(sess, sub) { return sess.admin || (sess.telas || []).includes('sofia_' + sub); }
function temSofia(sess) { return sess.admin || SOFIA_SUBS.some(s => podeSofiaSub(sess, s)); }
function sofiaHref(sess) {
  if (podeSofiaSub(sess, 'conversas')) return '/sofia?view=conversas';
  if (podeSofiaSub(sess, 'config')) return '/sofia';
  if (podeSofiaSub(sess, 'contatos')) return '/sofia?view=contatos';
  if (podeSofiaSub(sess, 'campanhas')) return '/sofia?view=campanhas';
  return '/sofia';
}
// Rota /sofia/* (fora o GET da página) → sub-permissão exigida. O "salvar-novo"
// (marcar tags/salvar contato a partir de uma conversa) vale para Conversas OU Contatos.
function sofiaRotaPermitida(sess, url) {
  const has = k => (sess.telas || []).includes(k);
  if (url === '/sofia/conversas' || url === '/sofia/responder' || url === '/sofia/humano' || url === '/sofia/humano-foto' || url === '/sofia/conversas/encerrar') return has('sofia_conversas');
  if (url === '/sofia/contatos/salvar-novo') return has('sofia_conversas') || has('sofia_contatos');
  if (url === '/sofia/contatos/bloquear') return has('sofia_conversas') || has('sofia_contatos'); // bloquear vem tb do chat (Conversas)
  if (url === '/sofia/contatos/importar' || url === '/sofia/contatos/salvar' || url === '/sofia/contatos/tag' || url === '/sofia/contatos/interacoes' || url === '/sofia/contatos/modelo.csv' || url === '/sofia/contatos/exportar' || url === '/sofia/contatos/tagcfg' || url === '/sofia/contatos/criar-tag') return has('sofia_contatos');
  if (url === '/sofia/campanhas' || url.startsWith('/sofia/campanhas/')) return has('sofia_campanhas');
  if (url === '/sofia/salvar' || url === '/sofia/restaurar' || url === '/sofia/toggle' || url === '/sofia/estado' || url === '/sofia/desconectar') return has('sofia_config');
  return false;
}
// WhatsApp é dividido em três sub-abas: Configuração, Agendamento e Hoje.
function podeMsgSub(sess, sub) { return sess.admin || (sess.telas || []).includes('msg_' + sub); }
function temMsg(sess) { return sess.admin || ['config', 'agendar', 'hoje'].some(s => podeMsgSub(sess, s)); }
function msgHref(sess) { return podeMsgSub(sess, 'config') ? '/' : (podeMsgSub(sess, 'agendar') ? '/?view=agendar' : (podeMsgSub(sess, 'hoje') ? '/hoje' : '/')); }
// Rota da aba WhatsApp → sub-permissão. Agendamento = /agendar* e /?view=agendar;
// Hoje = /hoje; o resto (mensagens, fotos, teste, horários, conexão) é Configuração.
function msgRotaPermitida(sess, url, fullUrl) {
  const has = k => (sess.telas || []).includes(k);
  if (url === '/hoje') return has('msg_hoje');
  if (url === '/agendar' || url.startsWith('/agendar/')) return has('msg_agendar');
  if (url === '/' && /(?:^|[?&])view=agendar/.test(fullUrl || '')) return has('msg_agendar');
  return has('msg_config'); // /, /salvar, /mensagem/*, /teste/*, /horarios*, /wa*
}
function primeiraTela(sess) {
  if (sess.admin) return '/hoje';
  if (temMsg(sess)) return msgHref(sess);
  if (sess.telas.includes('ind')) return '/indicadores';
  if (sess.telas.includes('ig')) return '/instagram';
  if (temSofia(sess)) return sofiaHref(sess);
  return '';
}

// Sessão do request atual, para o chrome() montar o menu só com as telas
// liberadas. O painel é de baixíssimo tráfego (um Studio), então guardar aqui
// entre o início do dispatch e a renderização síncrona da página é seguro.
let _navSess = null;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Ícone de ajuda (ⓘ) com explicação ao passar o mouse / tocar. O texto é HTML
// estático (confiável) — pode ter <b>. Usado ao lado dos rótulos de config.
const infoI = html => `<span class="info" tabindex="0">i<span class="info-pop">${html}</span></span>`;

function hojeSP() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function fmtData(d) { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; }
function fmtTel(t) { // 5562999999999 → (62) 99999-9999
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
// Horários dos envios agendados vêm dos jobs (podem ter sido editados no painel).
function horaAg(turno) { return horaTurno(turno === 'manha' ? 'agendadosManha' : 'agendadosTarde') || (turno === 'manha' ? '10:45' : '15:45'); }
function turnoLabel(turno) { return (turno === 'manha' ? '☀️ Manhã · ' : '🌇 Tarde · ') + horaAg(turno); }

// ── Chrome comum (cabeçalho + abas + estilo) ────────────────────────────────
const ESTILO = `
  :root{
    --teal:#11abae;--teal-esc:#0c7f82;--coral:#ff5b57;--coral-esc:#ef5a53;
    --tinta:#2d2a2f;--cinza:#7a7a7d;--bg:#f6f7f8;--card:#fff;--linha:#e8e8ea;
    --ok:#1c8f52;--ok-bg:#eef9f2;--ok-bd:#cbe8d5;
    --erro:#b3261e;--erro-bg:#fcecec;--erro-bd:#f2cccc;
    --warn:#9a6b00;--warn-bg:#fff7e6;--warn-bd:#f2ddb0;
    --avi-bg:#e9f6f6;--avi-bd:#c3e6e6;--avi-tx:#0c7f82;
    /* escala de tipografia — poucos tamanhos, reaproveitados em todo o painel */
    --fs-h1:1.15rem;--fs-h2:1rem;--fs-sec:.95rem;--fs-body:.92rem;--fs-sm:.8rem;--fs-xs:.72rem;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:"Open Sans",-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--tinta);line-height:1.5;font-size:var(--fs-body)}
  h1,h2,h3,button,.tabs a{font-family:"Montserrat","Open Sans",Arial,sans-serif}
  header{background:var(--teal);color:#fff;padding:15px 16px}
  .wrap{max-width:820px;margin:0 auto;padding:14px 16px}
  header .wrap{padding:0 16px;display:flex;align-items:center;gap:14px}
  header .logo-box{background:#fff;border-radius:11px;padding:6px 10px;flex:none;box-shadow:0 2px 8px rgba(0,0,0,.12)}
  header .logo-box img{height:26px;width:auto;display:block}
  header h1{margin:0;font-size:var(--fs-h1);font-weight:700}
  header p{margin:3px 0 0;opacity:.9;font-size:var(--fs-sm)}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;max-width:820px;margin:12px auto 0;padding:0 16px}
  .tabs a{flex:1 1 84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;line-height:1.1;text-decoration:none;font-weight:700;color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:12px;padding:9px 6px}
  .tabs a .tic{font-size:1.2rem;line-height:1}
  .tabs a .ttx{font-size:.78rem}
  .tabs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  /* No mobile: a barra de abas fica GRUDADA no topo ao rolar (o cabeçalho da
     logo pode sair da tela). Só as abas ficam fixas. */
  @media(max-width:760px){
    .tabs{position:sticky;top:0;z-index:50;margin-top:0;padding:8px 12px 10px;background:var(--bg);box-shadow:0 4px 12px -6px rgba(0,0,0,.22)}
  }
  .aviso{background:var(--avi-bg);border:1px solid var(--avi-bd);color:var(--avi-tx);border-radius:10px;padding:10px 14px;margin:14px 0;font-size:var(--fs-sm)}
  .aviso.err{background:var(--erro-bg);border-color:var(--erro-bd);color:var(--erro)}
  .card{background:var(--card);border:1px solid var(--linha);border-radius:12px;padding:13px 15px;margin:10px 0}
  .chead{display:flex;align-items:center;gap:10px}
  h2{font-size:var(--fs-h2);font-weight:700;margin:0}
  h3{font-size:var(--fs-sec);font-weight:700}
  .badge{background:var(--erro-bg);color:var(--erro);border:1px solid var(--erro-bd);border-radius:999px;font-size:var(--fs-xs);font-weight:700;padding:2px 9px}
  .quando{color:var(--cinza);font-size:var(--fs-sm);margin:5px 0 8px}
  .vars{font-size:var(--fs-sm);color:var(--cinza);margin:0 0 8px}
  .var{display:inline-block;background:#eef7f7;color:var(--teal-esc);border:1px solid #cdeaea;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace;font-size:var(--fs-sm);cursor:pointer;user-select:none;transition:.12s}
  .var:hover{background:var(--teal);color:#fff;border-color:var(--teal)}
  label{display:block;font-weight:600;font-size:var(--fs-sm);margin:12px 0 4px}
  input[type=text],input[type=tel],input[type=date],input[type=time],input[type=number],textarea{width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff}
  select{width:100%;max-width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:9px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff}
  textarea{line-height:1.5;resize:vertical}
  input:focus,textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(17,171,174,.15)}
  .acts{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
  button{border:none;border-radius:999px;padding:9px 18px;font-size:var(--fs-body);font-weight:700;cursor:pointer;font-family:inherit}
  .save{background:var(--coral);color:#fff}
  .reset,.rm{background:#fff;color:var(--cinza);border:1px solid #dcdcdc}
  .turnos{display:flex;gap:10px;margin-top:6px}
  .turnos label{flex:1;margin:0;display:block}
  .turnos input{position:absolute;opacity:0;pointer-events:none}
  .turnos span{display:block;text-align:center;border:1.5px solid #dcdcdc;border-radius:12px;padding:11px;font-weight:700;cursor:pointer;color:var(--tinta)}
  .turnos input:checked + span{border-color:var(--teal);background:var(--teal-soft,#e6f6f7);color:#0c6f70}
  .fotorow{margin-top:12px}
  .chk{display:flex;align-items:center;gap:9px;font-weight:600;font-size:.9rem;cursor:pointer}
  .chk input{width:18px;height:18px}
  #fotoWrap{display:none;margin-top:8px}
  #fotoWrap.on{display:block}
  .item{border:1px solid var(--linha);border-radius:12px;padding:10px 13px;margin:8px 0;display:flex;gap:12px;align-items:flex-start;background:#fff}
  .item .thumb{width:52px;height:52px;border-radius:9px;object-fit:cover;flex:none;border:1px solid var(--linha)}
  .item .body{flex:1;min-width:0}
  .item .tel{font-weight:700}
  .item .meta{font-size:var(--fs-sm);color:var(--cinza);margin-top:2px}
  .item .txt{font-size:var(--fs-body);color:var(--tinta);margin-top:6px;white-space:pre-wrap;word-break:break-word}
  .pill{display:inline-block;font-size:var(--fs-xs);font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--linha)}
  .st-pendente{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bd)}
  .st-enviado{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd)}
  .st-falha{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-bd)}
  .sec-t{font-family:"Montserrat";font-weight:700;font-size:var(--fs-sec);margin:15px 0 4px}
  /* Seções recolhíveis (<details class="acc-sec">): o cabeçalho vira um cartão
     destacado e clicável, com chevron à direita e realce quando aberto — para
     não passar despercebido como uma linha de texto. */
  .acc-sec{margin:12px 0}
  .acc-sec>summary{list-style:none;cursor:pointer;position:relative;padding:14px 42px 14px 15px!important;margin:0!important;background:var(--card);border:1px solid var(--linha);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .acc-sec>summary::-webkit-details-marker{display:none}
  .acc-sec>summary::after{content:"▸";position:absolute;right:15px;top:50%;transform:translateY(-50%);color:var(--teal);font-weight:900;font-size:1rem}
  .acc-sec>summary:hover{border-color:var(--teal)}
  /* Aberta: a seção INTEIRA vira um contêiner com contorno teal; o cabeçalho
     fica no topo e o conteúdo DENTRO, em sub-cartões com fundo próprio — assim
     não se mistura com o resto da página. */
  .acc-sec[open]{border:1px solid var(--teal);border-radius:12px;background:var(--card);box-shadow:0 4px 16px -7px rgba(12,127,130,.30)}
  .acc-sec[open]>summary{border:0!important;border-bottom:1px solid var(--avi-bd)!important;border-radius:11px 11px 0 0;background:var(--avi-bg);box-shadow:none}
  .acc-sec[open]>summary::after{content:"▾"}
  .acc-sec[open]>*:not(summary){margin:12px}
  .acc-sec[open]>.card{background:var(--bg);box-shadow:none}
  .vazio{color:var(--cinza);font-size:var(--fs-sm)}
  .wabar{border-radius:12px;padding:10px 14px;margin:14px 0 0;font-weight:600;font-size:var(--fs-sm);display:flex;align-items:center;gap:8px}
  .wabar.ok{background:var(--ok-bg);border:1px solid var(--ok-bd);color:var(--ok)}
  .wabar.warn{background:var(--erro-bg);border:1px solid var(--erro-bd);color:var(--erro)}
  .wabar a{color:inherit;font-weight:700;margin-left:auto;white-space:nowrap}
  .wa-card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:14px 18px;text-align:center;margin:12px 0}
  .wa-card.ok{border-color:var(--ok-bd);background:var(--ok-bg)}
  .wa-card.warn{border-color:var(--erro-bd);background:var(--erro-bg)}
  .wa-ic{font-size:1.7rem;line-height:1}
  .wa-card h2{margin:4px 0 3px}
  .wa-card p{color:var(--cinza);margin:3px auto 0;max-width:none;font-size:var(--fs-sm)}
  .wa-card .qr{width:280px;max-width:82%;height:auto;margin:16px auto 6px;display:block;border:8px solid #fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12)}
  .wa-hint{font-size:var(--fs-sm)}
  .wa-upd{text-align:center;color:var(--cinza);font-size:var(--fs-xs);margin-top:10px}
  .hsec{margin-top:14px;padding-top:14px;border-top:1px dashed var(--linha)}
  .hsec-t{font-family:"Montserrat";font-weight:700;font-size:var(--fs-sm);color:var(--teal-esc);margin:0 0 10px}
  .hjob{background:var(--card);border:1px solid var(--linha);border-radius:12px;padding:14px 16px;margin:12px 0}
  .hjob h3{font-size:var(--fs-h2);margin:0 0 8px}
  .hrow{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end}
  .hrow + .hrow{margin-top:12px}
  .hrow input[type=time]{width:130px}
  .hrow .lbl{font-weight:600;font-size:.82rem;margin:0 0 4px;color:var(--cinza)}
  .dias{display:flex;gap:5px;flex-wrap:wrap}
  .dias label{margin:0}
  .dias input{position:absolute;opacity:0;pointer-events:none}
  .dias span{display:inline-block;min-width:40px;text-align:center;border:1.5px solid #dcdcdc;border-radius:9px;padding:7px 4px;font-size:.8rem;font-weight:700;cursor:pointer;color:var(--tinta)}
  .dias input:checked + span{border-color:var(--teal);background:#e6f6f7;color:#0c6f70}
  .hbar{position:sticky;bottom:0;background:linear-gradient(180deg,transparent,var(--bg) 40%);padding:14px 0 6px;margin-top:6px}
  .badge-ed{background:var(--erro-bg);color:var(--erro);border:1px solid var(--erro-bd);border-radius:999px;font-size:var(--fs-xs);font-weight:700;padding:2px 8px;margin-left:6px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
  .stat{background:var(--card);border:1px solid var(--linha);border-radius:12px;padding:14px;text-align:center}
  .stat .n{font-family:"Montserrat";font-weight:800;font-size:1.8rem;line-height:1}
  .stat .l{font-size:var(--fs-xs);color:var(--cinza);margin-top:4px;font-weight:600}
  .stat.ok .n{color:var(--ok)}.stat.err .n{color:var(--erro)}.stat.tot .n{color:var(--teal)}
  .jobrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--linha)}
  .jobrow:last-child{border-bottom:0}
  .jobrow .jn{font-weight:700;font-size:var(--fs-body);flex:1;min-width:0}
  .jobrow .jc{font-size:var(--fs-sm);font-weight:700;color:var(--ok);white-space:nowrap}
  .jobrow .jc .f{color:var(--erro)}
  .ev{display:flex;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--linha);font-size:var(--fs-body)}
  .ev:last-child{border-bottom:0}
  .ev .h{color:var(--cinza);font-variant-numeric:tabular-nums;font-size:var(--fs-sm);flex:none}
  .ev .d{flex:1;min-width:0}
  .ev .who{font-weight:600}
  .ev .ctx{font-size:var(--fs-xs);color:var(--cinza)}
  .ev .pv{color:var(--cinza);font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}
  .ev .ic{flex:none}
  .datesel{display:flex;gap:8px;align-items:center;margin:4px 0 0}
  .datesel input{width:auto}
  .segs{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 0}
  .segs a{text-decoration:none;font-weight:700;font-size:var(--fs-sm);color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:999px;padding:6px 13px}
  .segs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  .bar{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linha);font-size:var(--fs-sm)}
  .bar:last-child{border-bottom:0}
  .bar .bd{width:64px;flex:none;color:var(--cinza);font-variant-numeric:tabular-nums}
  .bar .btrack{flex:1;background:#eef1f2;border-radius:6px;height:18px;position:relative;overflow:hidden;min-width:60px}
  .bar .bfill{position:absolute;inset:0 auto 0 0;background:var(--teal);border-radius:6px}
  .bar .bfill.ag{background:var(--coral);opacity:.85}
  .bar .bn{flex:none;width:96px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .bar .bn small{font-weight:600;color:var(--cinza)}
  .testbar{background:#fff8f0;border:1px solid #f3dcbf}
  .testbar label{margin:0 0 4px}
  .testbar input{max-width:260px}
  .prev{margin-top:10px}
  .prev-t{font-size:var(--fs-xs);font-weight:700;color:var(--cinza);margin-bottom:4px}
  .prev-b{white-space:pre-wrap;word-break:break-word;background:#eef7f7;border:1px solid #cdeaea;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);line-height:1.5}
  .prev-b.ok{background:var(--ok-bg);border-color:var(--ok-bd);color:var(--ok)}
  .prev-b.err{background:var(--erro-bg);border-color:var(--erro-bd);color:var(--erro)}
  .tbtn{background:#fff;color:var(--cinza);border:1px solid #dcdcdc}
  footer{color:var(--cinza);font-size:var(--fs-xs);text-align:center;padding:18px}
  /* Contatos — tabela + modal */
  .ct-wrap{background:var(--card);border:1px solid var(--linha);border-radius:12px;overflow-x:auto;margin:10px 0}
  .ct-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm);table-layout:fixed}
  .ct-int-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .ct-int-tab th{text-align:left;font-family:"Montserrat";font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;padding:9px 8px;border-bottom:1px solid var(--linha)}
  .ct-int-tab td{padding:10px 8px;border-bottom:1px solid var(--linha);vertical-align:middle}
  .ct-int-tab tr:last-child td{border-bottom:0}
  .ct-badge{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 9px;border-radius:999px}
  .ct-badge.ativa{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-bd)}
  .ct-badge.enc{background:#eef0f1;color:#6b6b70;border:1px solid #dfe1e3}
  .cpf-sec{border-top:1px solid var(--linha);margin-top:20px;padding-top:18px}
  .cpf-sec.first{border-top:0;margin-top:0;padding-top:0}
  .cpf-h{font-family:"Montserrat";font-weight:700;font-size:var(--fs-sec);margin:0 0 14px;display:flex;align-items:center;gap:8px}
  .cpf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
  .cpf-field label{display:block;font-weight:700;font-size:.8rem;margin:0 0 5px}
  .cpf-field .sub{font-weight:400;color:var(--cinza)}
  .cpf-grid-lim{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}
  @media(max-width:560px){ .cpf-grid-lim{grid-template-columns:1fr} }
  .cpf-range{display:flex;align-items:center;gap:8px}
  .cpf-range input{flex:1;min-width:0;width:auto}
  .cpf-suf{color:var(--cinza);font-size:var(--fs-sm);white-space:nowrap;flex:none}
  .info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#e2e4e6;color:#5c5960;font-size:.66rem;font-weight:800;font-style:normal;cursor:help;margin-left:6px;position:relative;vertical-align:middle;user-select:none}
  .info:hover,.info:focus{background:var(--teal);color:#fff;outline:none}
  .info .info-pop{display:none;position:absolute;left:0;top:calc(100% + 8px);width:280px;max-width:72vw;background:#2d2a2f;color:#fff;font-size:.78rem;font-weight:400;font-style:normal;line-height:1.45;text-align:left;padding:9px 12px;border-radius:9px;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:40;white-space:normal}
  .info .info-pop b{color:#fff}
  .info:hover .info-pop,.info:focus .info-pop{display:block}
  .info .info-pop::before{content:"";position:absolute;left:6px;top:-5px;border:5px solid transparent;border-top:0;border-bottom-color:#2d2a2f}
  .cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px 22px}
  .cfg-grid label{display:flex;align-items:center;font-weight:700;font-size:.82rem;margin:0 0 6px}
  .cfg-in{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cfg-in input[type=number]{width:92px;flex:none}
  .cfg-in .suf{color:var(--cinza);font-size:var(--fs-sm)}
  .cpf-acc{border-top:1px solid var(--linha);margin-top:6px}
  .cpf-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:"Montserrat";font-weight:700;font-size:var(--fs-sec);padding:16px 0}
  .cpf-sum::-webkit-details-marker{display:none}
  .cpf-sum .sub{font-weight:400;font-size:.8rem}
  .cpf-sum::after{content:"▾";margin-left:auto;font-size:.9rem;color:var(--cinza);transition:transform .2s}
  .cpf-acc[open] .cpf-sum::after{transform:rotate(180deg)}
  .cpf-body{padding:2px 0 14px}
  .tagrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--linha)}
  .tagrow:last-child{border-bottom:0}
  .tagrow form{display:flex;gap:8px;align-items:center;flex:1;min-width:250px;margin:0;flex-wrap:nowrap}
  .tagrow input[type=text]{flex:1;min-width:120px;font-size:.85rem}
  .tagrow .tagn{color:var(--cinza);font-size:.78rem;width:46px;text-align:right;font-variant-numeric:tabular-nums;flex:none}
  .tagbtn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 12px;font-size:.8rem;white-space:nowrap;background:#fff;color:var(--cinza);border:1px solid var(--linha);border-radius:9px;cursor:pointer;font-weight:700;flex:none}
  .tagbtn.ren{width:96px}
  .tagbtn.rm{width:82px}
  .tagbtn.aut{width:140px}
  .tagbtn.ren:hover{border-color:var(--teal);color:var(--teal-esc)}
  .tagbtn.rm:hover{border-color:var(--erro);color:var(--erro);background:var(--erro-bg)}
  .tagbtn.aut:hover{border-color:var(--teal);color:var(--teal-esc)}
  .tagbtn.on{border-color:var(--teal);color:var(--teal-esc);background:#eef7f7}
  @media(max-width:640px){ .tagrow form{flex-wrap:wrap} .tagrow input[type=text]{min-width:100%} }
  .cp-sec{margin:0 0 14px}
  .cp-h{font-family:"Montserrat";font-weight:700;font-size:var(--fs-sm);margin:0 0 4px}
  .cp-list{max-height:200px;overflow-y:auto;border:1px solid var(--linha);border-radius:10px;padding:2px 12px}
  .cp-list>div:last-child{border-bottom:0}
  .ct-tab col.c-nome{width:32%}.ct-tab col.c-tel{width:21%}.ct-tab col.c-tags{width:31%}.ct-tab col.c-act{width:16%}
  .ct-tab th{text-align:left;font-family:"Montserrat";font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;letter-spacing:.03em;padding:11px 14px;border-bottom:1px solid var(--linha);white-space:nowrap;background:#fafbfb}
  .ct-tab td{padding:10px 14px;border-bottom:1px solid var(--linha);vertical-align:middle}
  .ct-tab tbody tr:last-child td{border-bottom:0}
  .ct-row{cursor:pointer;transition:background .12s}
  .ct-row:hover{background:#f6fbfb}
  .ct-av{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border-radius:50%;color:#fff;font-weight:700;font-size:.78rem;font-family:"Montserrat"}
  .ct-nm{font-weight:700;color:var(--tinta);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .ct-tel{color:var(--cinza);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ct-acts{text-align:right;white-space:normal}
  .ct-ic{background:#fff;border:1px solid var(--linha);border-radius:8px;padding:4px 6px;cursor:pointer;font-size:.82rem;line-height:1;margin:2px 0 2px 3px}
  .ct-ic:hover{border-color:var(--teal)}
  .ct-ic.ct-del:hover{border-color:var(--erro);background:var(--erro-bg)}
  .ct-fil{background:none;border:0;color:var(--cinza);cursor:pointer;font-size:.85rem;padding:0 2px}
  .ct-sort{background:none;border:0;cursor:pointer;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;padding:0;display:inline-flex;align-items:center;gap:5px}
  .ct-sort:hover{color:var(--teal-esc)}
  .ct-ov{display:none;position:fixed;inset:0;background:rgba(30,28,32,.5);z-index:50;align-items:flex-start;justify-content:center;padding:20px 14px;overflow-y:auto}
  .ct-dlg{background:#fff;border-radius:16px;max-width:520px;width:100%;padding:20px 22px;margin:auto;box-shadow:0 10px 40px rgba(0,0,0,.25)}
  .ct-dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .ct-dh h2{margin:0;font-size:var(--fs-h2)}
  .ct-x{background:none;border:0;font-size:1.5rem;line-height:1;color:var(--cinza);cursor:pointer;padding:0 4px}
  .ct-hero{text-align:center;margin:0 0 16px}
  .ct-av-lg{width:76px;height:76px;font-size:1.5rem;margin:0 auto 8px}
  .ct-hnome{font-family:"Montserrat";font-weight:700;font-size:1.05rem}
  .ct-htel{color:var(--cinza);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
  .ct-dlg label{display:block;font-weight:700;font-size:var(--fs-sm);margin:0 0 5px}
  .ct-tglist{display:flex;flex-wrap:wrap;gap:7px}
  .ct-tg{border:1px solid #e8e8ea;border-radius:999px;padding:5px 12px;font-size:.78rem;font-weight:600;cursor:pointer;transition:.12s}
  .ct-nova{display:flex;gap:8px;margin-top:10px}
  .ct-nova input{flex:1}
  .ct-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--linha)}
`;

// Menu de abas, mostrando só as telas que o usuário logado pode ver (+ Perfis p/ admin).
function navTabs(ativo) {
  const sess = _navSess || { admin: true, telas: usuarios.TELAS_KEYS };
  const pode = k => sess.admin || (sess.telas || []).includes(k);
  const cel = (href, on, ic, tx) => `<a href="${href}" class="${on ? 'on' : ''}"><span class="tic">${ic}</span><span class="ttx">${tx}</span></a>`;
  const item = (k, href, ic, tx) => pode(k) ? cel(href, ativo === k, ic, tx) : '';
  let html = item('ind', '/indicadores', '📈', 'Formulário');
  if (temMsg(sess)) html += cel(msgHref(sess), ativo === 'msg', '💬', 'WhatsApp');
  html += item('ig', '/instagram', '📸', 'Instagram');
  // Perfis antes; SoFIA por último para ficar em destaque (no mobile ela cai
  // sozinha na 2ª linha, ocupando a largura toda) — a SoFIA é a principal.
  if (sess.admin) html += cel('/perfis', ativo === 'perfis', '👤', 'Perfis');
  if (temSofia(sess)) html += cel(sofiaHref(sess), ativo === 'sofia', '🤖', 'SoFIA');
  return html;
}

function chrome(titSubtitulo, ativo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titSubtitulo.tab)} · SlimFit</title>
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap">
<style>${ESTILO}</style></head><body>
<header><div class="wrap">
  <div class="logo-box"><img alt="SlimFit Studio" src="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/logo-com-contraste.svg"></div>
  <div style="flex:1"><h1>${esc(titSubtitulo.h1)}</h1><p>${titSubtitulo.p}</p></div>
  ${_navSess ? `<div style="text-align:right;font-size:.82rem;white-space:nowrap"><div style="opacity:.92">👤 ${esc(_navSess.usuario)}</div><a href="/logout" style="color:#fff;font-weight:700;text-decoration:underline">Sair</a></div>` : ''}
</div></header>
<nav class="tabs">
  ${navTabs(ativo)}
</nav>
${corpo}
<footer>SlimFit · painel do Studio</footer>
<script>
/* Seções recolhíveis em TODAS as telas: transforma cada cabeçalho .sec-t (que
   não seja de uma seção já recolhível) num <details class="acc-sec">. Só recolhe
   onde a tela é realmente segmentada (>=2 seções no mesmo bloco), abre por padrão
   (nada some) e lembra o estado por seção (localStorage). Não move formulários de
   lugar — só os envolve, então tudo continua salvando igual. */
(function(){
  try{
    var heads=[].slice.call(document.querySelectorAll('.wrap .sec-t')).filter(function(h){
      return h.tagName!=='SUMMARY' && !h.closest('details') && !h.hasAttribute('data-nosec');
    });
    var cnt=new Map();
    heads.forEach(function(h){ cnt.set(h.parentNode,(cnt.get(h.parentNode)||0)+1); });
    heads.forEach(function(h){
      if((cnt.get(h.parentNode)||0)<2) return;   // seção única no bloco → não recolhe
      var sibs=[], el=h.nextElementSibling;
      while(el && !(el.classList && el.classList.contains('sec-t'))){ sibs.push(el); el=el.nextElementSibling; }
      if(!sibs.length) return;
      var det=document.createElement('details'); det.className='acc-sec';
      var sum=document.createElement('summary'); sum.className='sec-t'; sum.innerHTML=h.innerHTML;
      det.appendChild(sum); sibs.forEach(function(s){ det.appendChild(s); });
      var key='sec:'+location.pathname+':'+(sum.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60);
      var aberto=true; try{ if(localStorage.getItem(key)==='0') aberto=false; }catch(e){}
      det.open=aberto;
      det.addEventListener('toggle',function(){ try{ localStorage.setItem(key, det.open?'1':'0'); }catch(e){} });
      h.parentNode.replaceChild(det,h);
    });
  }catch(e){}
})();
</script>
</body></html>`;
}

// Barra "número para testes" (compartilhada por Mensagens e Instagram).
function barraTeste() {
  return `<div class="card testbar">
    <label>🧪 Número para testes</label>
    <input id="telTeste" type="tel" inputmode="numeric" placeholder="(62) 99999-9999" maxlength="16">
    <p class="quando" style="margin:6px 0 0">Usado pelos botões <b>Enviar teste</b>. Fica salvo só neste navegador. A prévia usa valores de exemplo (ex.: nome → <i>Maria</i>).</p>
  </div>`;
}
// Script de pré-visualizar/enviar teste + inserir variável (compartilhado).
function scriptPreviewTeste() {
  const exemplosJson = JSON.stringify(mensagens.exemplosCompletos()).replace(/</g, '\\u003c');
  return `<script>
  var EXEMPLOS = ${exemplosJson};
  function inserirVar(el, token){
    var ta = el.closest('form').querySelector('textarea');
    if(!ta) return;
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length;
  }
  function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function renderEx(txt){ for(var k in EXEMPLOS){ txt = txt.split('{'+k+'}').join(EXEMPLOS[k]); } return txt; }
  function previewMsg(btn){
    var card = btn.closest('.card'); var ta = card.querySelector('textarea'); var b = card.querySelector('.prev');
    b.style.display='block';
    b.innerHTML = '<div class="prev-t">👁 Como a pessoa vê (valores de exemplo):</div><div class="prev-b">'+escHtml(renderEx(ta.value))+'</div>';
  }
  function soDigTeste(s){ return (s||'').replace(/\\D/g,''); }
  var _tt = document.getElementById('telTeste');
  if(_tt){
    try{ _tt.value = localStorage.getItem('sf_tel_teste') || ''; }catch(_){}
    _tt.addEventListener('input', function(e){
      var v=soDigTeste(e.target.value).slice(0,11);
      if(v.length>=7)e.target.value=v.replace(/(\\d{2})(\\d{4,5})(\\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
      else if(v.length>=3)e.target.value=v.replace(/(\\d{2})(\\d{0,5})/,'($1) $2'); else e.target.value=v;
      try{ localStorage.setItem('sf_tel_teste', e.target.value); }catch(_){}
    });
  }
  async function testarMsg(btn){
    var tel = soDigTeste((_tt&&_tt.value)||'');
    var card = btn.closest('.card'); var ta = card.querySelector('textarea'); var b = card.querySelector('.prev');
    if(tel.length<10){ alert('Preencha o "Número para testes" no topo da página.'); if(_tt) _tt.focus(); return; }
    b.style.display='block'; b.innerHTML = '<div class="prev-b">⏳ Enviando teste para '+escHtml(tel)+'…</div>';
    btn.disabled=true;
    try{
      var r = await fetch('/teste/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:tel, texto:ta.value})});
      var d = await r.json();
      if(!d.ok){ b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(d.erro||'Não foi possível enviar.')+'</div>'; btn.disabled=false; return; }
      var tries=0;
      var iv=setInterval(async function(){
        tries++;
        try{
          var s = await (await fetch('/teste/status?id='+encodeURIComponent(d.id))).json();
          if(s.status==='enviado'){ clearInterval(iv); b.innerHTML='<div class="prev-b ok">✅ Teste enviado para '+escHtml(tel)+'! Confira o WhatsApp.</div>'; btn.disabled=false; }
          else if(s.status==='falha'){ clearInterval(iv); b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(s.erro||'Falha no envio.')+'</div>'; btn.disabled=false; }
          else if(tries>25){ clearInterval(iv); b.innerHTML='<div class="prev-b">⏳ Ainda processando — o robô pode estar ocupado. A mensagem deve chegar em instantes.</div>'; btn.disabled=false; }
        }catch(_){ }
      },2000);
    }catch(err){ b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(err.message||'Falha ao enviar.')+'</div>'; btn.disabled=false; }
  }
  function mfToggle(chk){ var w=chk.closest('.fotorow').querySelector('.mfWrap'); if(w) w.style.display=chk.checked?'':'none'; }
  function mfLer(f){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsDataURL(f); }); }
  async function mfSalvar(btn, chave){
    var wrap=btn.closest('.mfWrap'); var file=wrap.querySelector('.mfFile'); var msg=wrap.querySelector('.mfMsg');
    if(!file.files[0]){ msg.className='mfMsg meta'; msg.textContent='Escolha uma imagem primeiro.'; return; }
    if(file.files[0].size>6*1024*1024){ msg.textContent='Imagem muito grande (máx. ~6 MB).'; return; }
    btn.disabled=true; msg.textContent='Enviando…';
    try{
      var dataUrl=await mfLer(file.files[0]);
      var r=await fetch('/mensagem/foto/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:chave, fotoDataUrl:dataUrl})});
      var d=await r.json();
      if(!d.ok){ msg.textContent='⚠️ '+(d.erro||'Falha ao salvar.'); btn.disabled=false; return; }
      var thumb=wrap.querySelector('.mfThumb'); thumb.src='/mensagem/foto?chave='+encodeURIComponent(chave)+'&v='+Date.now(); thumb.style.display='';
      wrap.querySelector('.mfRm').style.display=''; file.value='';
      msg.textContent='✅ Foto salva — vai junto no próximo envio desta mensagem.';
    }catch(e){ msg.textContent='⚠️ '+(e.message||'Falha.'); }
    finally{ btn.disabled=false; }
  }
  async function mfRemover(btn, chave){
    if(!confirm('Remover a foto desta mensagem?')) return;
    var wrap=btn.closest('.mfWrap'); var msg=wrap.querySelector('.mfMsg'); btn.disabled=true;
    try{
      var r=await fetch('/mensagem/foto/remover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:chave})});
      await r.json();
      wrap.querySelector('.mfThumb').style.display='none'; btn.style.display='none';
      msg.textContent='Foto removida — volta a enviar só o texto.';
    }catch(e){ msg.textContent='⚠️ '+(e.message||'Falha.'); btn.disabled=false; }
  }
  async function testarDMIg(btn){
    var card = btn.closest('.card'); var ta = card.querySelector('textarea'); var b = card.querySelector('.prev');
    var inp = card.querySelector('.igteste'); var u = ((inp&&inp.value)||'').replace(/^@+/,'').trim().split(/\\s+/)[0];
    if(!u){ alert('Informe o @usuário do Instagram para testar.'); if(inp) inp.focus(); return; }
    b.style.display='block'; b.innerHTML = '<div class="prev-b">⏳ Enviando DM de teste para @'+escHtml(u)+'… pode levar até ~1 min (abre o navegador, usa o proxy e o cookie).</div>';
    btn.disabled=true;
    try{
      var r = await fetch('/instagram/teste-dm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u, texto:ta.value})});
      var d = await r.json();
      if(!d.ok){ b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(d.erro||'Não foi possível iniciar o teste.')+'</div>'; btn.disabled=false; return; }
      var tries=0;
      var iv=setInterval(async function(){
        tries++;
        try{
          var s = await (await fetch('/instagram/teste-dm/status?id='+encodeURIComponent(d.id))).json();
          if(s.status==='enviado'){ clearInterval(iv); b.innerHTML='<div class="prev-b ok">✅ DM enviada para @'+escHtml(u)+'! A sessão (cookie) está funcionando. Confira no Instagram.</div>'; btn.disabled=false; }
          else if(s.status==='falha'){ clearInterval(iv); b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(s.erro||'Falha no envio.')+'</div>'; btn.disabled=false; }
          else if(tries>60){ clearInterval(iv); b.innerHTML='<div class="prev-b">⏳ Ainda processando — o robô pode estar ocupado com outro envio. Tente de novo em instantes.</div>'; btn.disabled=false; }
        }catch(_){ }
      },3000);
    }catch(err){ b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(err.message||'Falha ao enviar.')+'</div>'; btn.disabled=false; }
  }
</script>`;
}

// Card de edição de UMA mensagem (texto + variáveis + preview/teste). Reusável.
// opts.ig = true → o teste é um DM do Instagram para um @usuário (não WhatsApp).
function cardMensagem(m, voltar, opts = {}) {
  const vars = (m.vars || []).map(([t, d]) => `<span class="var" title="${esc(d)} — clique para inserir" onclick="inserirVar(this,'{${esc(t)}}')">{${esc(t)}}</span>`).join(' ');
  const badge = m.editado ? '<span class="badge">editada</span>' : '';
  const botaoTeste = opts.ig
    ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <input class="igteste" type="text" placeholder="@usuario para testar" style="max-width:220px">
        <button type="button" class="tbtn" onclick="testarDMIg(this)">📩 Enviar DM de teste</button>
        <small style="color:var(--cinza)">envia o DM de verdade — e comprova o cookie</small>
       </div>`
    : `<button type="button" class="tbtn" onclick="testarMsg(this)">🧪 Enviar teste</button>`;
  return `<form method="POST" action="/salvar">
      <input type="hidden" name="chave" value="${esc(m.chave)}">
      ${voltar ? `<input type="hidden" name="voltar" value="${esc(voltar)}">` : ''}
      <div class="chead"><h2>${esc(m.titulo)} ${badge}</h2></div>
      <p class="quando">${esc(m.quando)}</p>
      ${vars ? `<p class="vars">Variáveis (clique para inserir): ${vars} <small>— são trocadas automaticamente no envio; mantenha-as no texto</small></p>` : ''}
      <textarea name="texto" rows="7" spellcheck="true">${esc(m.texto)}</textarea>
      <div class="acts">
        <button type="submit" class="save">Salvar texto</button>
        <button type="button" class="tbtn" onclick="previewMsg(this)">👁 Pré-visualizar</button>
        ${opts.ig ? '' : botaoTeste}
        <button type="submit" name="reset" value="1" class="reset" onclick="return confirm('Voltar esta mensagem ao texto padrão?')">Restaurar padrão</button>
      </div>
      ${opts.ig ? botaoTeste : ''}
      ${m.aceitaFoto ? cardFoto(m) : ''}
      <div class="prev" style="display:none"></div>
    </form>`;
}

// Bloco "enviar com foto (flyer)" para as mensagens de grupo que aceitam.
function cardFoto(m) {
  const tem = !!m.fotoNome;
  const src = tem ? `/mensagem/foto?chave=${esc(m.chave)}&v=${Date.now()}` : '';
  return `<div class="fotorow" style="margin-top:12px;border-top:1px dashed var(--linha);padding-top:12px">
    <label class="chk"><input type="checkbox" class="mfChk"${tem ? ' checked' : ''} onchange="mfToggle(this)"> 📎 Enviar com foto (flyer junto da mensagem)</label>
    <div class="mfWrap"${tem ? '' : ' style="display:none"'}>
      <img class="mfThumb thumb" style="${tem ? '' : 'display:none;'}width:130px;height:auto;max-height:180px;border-radius:9px;margin:8px 0" src="${src}" alt="foto">
      <div style="margin-top:6px"><input type="file" class="mfFile" accept="image/png,image/jpeg,image/webp"></div>
      <div class="acts" style="margin-top:8px">
        <button type="button" class="tbtn" onclick="mfSalvar(this,'${esc(m.chave)}')">Salvar foto</button>
        <button type="button" class="rm mfRm" onclick="mfRemover(this,'${esc(m.chave)}')"${tem ? '' : ' style="display:none"'}>Remover foto</button>
      </div>
      <div class="mfMsg meta" style="margin-top:6px"></div>
    </div>
  </div>`;
}

// ── Página 1: editar mensagens (texto + horário de cada uma) ────────────────
// Conexão do WhatsApp do ROBÔ, no MESMO leiaute (wa-card) da aba Sofia.
function blocoWaRobo() {
  const st = waStatus.get() || {};
  if (st.estado === 'conectado') {
    return `<div class="wa-card ok"><div class="wa-ic">✅</div><h2>WhatsApp conectado</h2><p>A sessão está ativa — o robô envia normalmente.</p></div>`;
  }
  if (st.estado === 'qr' && st.qr) {
    return `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2>
      <p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR do WhatsApp"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira ✅.</p></div>`;
  }
  if (st.estado === 'iniciando') {
    return `<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>O robô está subindo a conexão. Se precisar de QR, ele aparece aqui.</p></div>`;
  }
  if (st.estado === 'desconectado') {
    return `<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>O robô está tentando reconectar sozinho. Se aparecer um QR aqui, escaneie.</p></div>`;
  }
  return `<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>Confira se o robô (<code>slimfit-exp</code>) está rodando.</p></div>`;
}

// Sub-navegação da aba WhatsApp Mensagens: Configuração (mensagens/horários) x Agendamento (envios pontuais).
function subnavMensagens(view) {
  const base = 'display:inline-flex;align-items:center;justify-content:center;padding:6px 13px;border-radius:999px;font-weight:700;font-family:Montserrat,sans-serif;font-size:.8rem;text-decoration:none;border:1px solid #e8e8ea;white-space:nowrap';
  const on = 'background:#11abae;color:#fff;border-color:#11abae';
  const off = 'background:#fff;color:#5c5960';
  const href = (v) => v === 'agendar' ? '/?view=agendar' : (v === 'hoje' ? '/hoje' : '/');
  const item = (v, rot) => `<a href="${href(v)}" style="${base};${view === v ? on : off}">${rot}</a>`;
  const sess = _navSess || { admin: true, telas: [] };
  let its = '';
  if (podeMsgSub(sess, 'config')) its += item('config', '⚙️ Configuração');
  if (podeMsgSub(sess, 'agendar')) its += item('agendar', '📅 Agendamento');
  if (podeMsgSub(sess, 'hoje')) its += item('hoje', '📊 Log');
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px">${its}</div>`;
}

function paginaMensagens(aviso, erro) {
  // Índice dos horários por chave de job, para embutir em cada mensagem.
  const hmap = {};
  horarios.listar().forEach(j => { hmap[j.chave] = j; });

  // A mensagem do Instagram é editada na aba "📸 Instagram" (fica tudo do IG lá).
  const itens = mensagens.listar().filter(m => m.chave !== 'instagram').map(m => {
    // Bloco de horário embutido no card (inputs pertencem ao form #fh).
    const mapa = HORARIOS_DA_MSG[m.chave];
    let hbloco = '';
    if (mapa === 'compartilha:followup') {
      hbloco = `<div class="hsec"><div class="hsec-t">🕒 Horário</div>
        <p class="quando" style="margin:0">Segue o <b>mesmo horário do Follow-up pós-aula (ainda não fechou)</b>, logo acima — é o mesmo disparo, muda só o texto conforme a lead.</p></div>`;
    } else if (Array.isArray(mapa)) {
      const linhas = mapa.map(([chave, sub]) => hmap[chave] ? blocoHorario(hmap[chave], sub) : '').join('');
      const editouHora = mapa.some(([chave]) => hmap[chave] && hmap[chave].editado);
      const badgeH = editouHora ? '<span class="badge-ed">alterado</span>' : '';
      hbloco = `<div class="hsec"><div class="hsec-t">🕒 Horário deste envio ${badgeH}</div>${linhas}</div>`;
    }
    return `<div class="card">${cardMensagem(m)}${hbloco}</div>`;
  }).join('\n');

  // Seção final: jobs sem texto editável (só horário).
  const outros = OUTROS_JOBS.map(chave => hmap[chave]).filter(Boolean).map(j => {
    const badgeH = j.editado ? '<span class="badge-ed">alterado</span>' : '';
    return `<div class="card"><div class="chead"><h2 style="font-size:.98rem">${esc(j.titulo)} ${badgeH}</h2></div>
      <div class="hsec" style="border:0;margin:8px 0 0;padding:0">${blocoHorario(j, '')}</div></div>`;
  }).join('\n');

  const corpo = `<div class="wrap">
    ${subnavMensagens('config')}
    <div id="waBanner">${blocoWaRobo()}</div>
    <div style="text-align:right;margin:-4px 0 0"><form method="POST" action="/wa/desconectar" onsubmit="return confirm('Desconectar o WhatsApp do robô?\\n\\nO robô para de enviar e será preciso reescanear o QR (aqui mesmo) para reconectar.')" style="display:inline"><button type="submit" class="reset" style="padding:4px 11px;font-size:var(--fs-xs)">🔌 Desconectar</button></form></div>
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${barraTeste()}
    <form id="fh" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnH');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"></form>
    ${itens}
    <div class="sec-t">Outros envios automáticos <small style="font-weight:600;color:var(--cinza)">(sem texto editável)</small></div>
    ${outros}
    <div class="hbar">
      <div class="acts"><button type="submit" form="fh" id="btnH" class="save">🕒 Salvar horários e reiniciar o robô</button></div>
      <p class="quando" style="text-align:center;margin:8px 0 0">O <b>texto</b> é salvo na hora (sem reiniciar). Já mudanças de <b>horário</b> só valem depois que o robô reinicia — alguns segundos. Evite salvar bem em cima de um horário de disparo.</p>
    </div>
  </div>
${scriptPreviewTeste()}
<script>
  function renderWa(st){
    var e = st && st.estado;
    if(e==='conectado') return '<div class="wa-card ok"><div class="wa-ic">✅</div><h2>WhatsApp conectado</h2><p>A sessão está ativa — o robô envia normalmente.</p></div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2><p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código.</p><img class="qr" src="'+st.qr+'" alt="QR do WhatsApp"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira ✅.</p></div>';
    if(e==='iniciando') return '<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>O robô está subindo a conexão. Se precisar de QR, ele aparece aqui.</p></div>';
    if(e==='desconectado') return '<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>O robô está tentando reconectar sozinho. Se aparecer um QR aqui, escaneie.</p></div>';
    return '<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>Confira se o robô (slimfit-exp) está rodando.</p></div>';
  }
  function atualizaWa(){
    fetch('/wa/estado').then(function(r){return r.json();}).then(function(st){
      var el=document.getElementById('waBanner'); if(el) el.innerHTML=renderWa(st);
    }).catch(function(){});
  }
  atualizaWa(); setInterval(atualizaWa, 7000);
</script>`;
  return chrome({ tab: 'WhatsApp Mensagens', h1: '💬 WhatsApp — mensagens do robô', p: 'Conexão, texto e horário de cada envio no mesmo lugar.' }, 'msg', corpo);
}

// ── Página 2: agendar envios ────────────────────────────────────────────────
function itemHtml(a) {
  const thumb = a.foto ? `<img class="thumb" src="/agendar/foto?nome=${encodeURIComponent(a.foto)}" alt="foto">` : '';
  const st = a.status === 'enviado' ? 'st-enviado' : a.status === 'falha' ? 'st-falha' : 'st-pendente';
  const stTxt = a.status === 'enviado' ? '✅ enviado' : a.status === 'falha' ? ('⚠️ falha' + (a.erro ? '' : '')) : '⏳ pendente';
  const acoes = a.status === 'pendente'
    ? `<div class="acts" style="margin-top:8px">
        <button type="button" class="reset" onclick="editarAg('${esc(a.id)}')">Editar</button>
        <form method="POST" action="/agendar/remover" onsubmit="return confirm('Remover este agendamento?')" style="margin:0"><input type="hidden" name="id" value="${esc(a.id)}"><button class="rm" type="submit">Remover</button></form>
      </div>`
    : '';
  return `<div class="item" id="ag-${esc(a.id)}">${thumb}<div class="body">
    <div class="tel">${esc(fmtTel(a.telefone))}</div>
    <div class="meta">${esc(fmtData(a.data))} · ${esc(turnoLabel(a.turno))} · <span class="pill ${st}">${stTxt}</span></div>
    ${a.mensagem ? `<div class="txt">${esc(a.mensagem)}</div>` : (a.foto ? '<div class="txt"><i>(só foto)</i></div>' : '')}
    ${a.erro ? `<div class="meta" style="color:#a12626">${esc(a.erro)}</div>` : ''}
    ${acoes}
  </div></div>`;
}
// Card "horários de disparo" na aba Agendar envios (edita agendadosManha/Tarde).
function cardHorariosAgendados() {
  const hmap = {};
  horarios.listar().forEach(j => { hmap[j.chave] = j; });
  const linhas = [['agendadosManha', 'Manhã'], ['agendadosTarde', 'Tarde']]
    .map(([chave, sub]) => hmap[chave] ? blocoHorario(hmap[chave], sub, 'fhAg') : '').join('');
  const editou = ['agendadosManha', 'agendadosTarde'].some(c => hmap[c] && hmap[c].editado);
  const badge = editou ? '<span class="badge-ed">alterado</span>' : '';
  return `
  <div class="sec-t">🕒 Horários de disparo</div>
  <div class="card">
    <form id="fhAg" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnHAg');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"><input type="hidden" name="voltar" value="/agendar"></form>
    <p class="quando" style="margin:0 0 6px">Quando os envios agendados de cada turno são disparados ${badge}. Vale para <b>todos</b> os agendamentos.</p>
    ${linhas}
    <div class="acts" style="margin-top:14px"><button type="submit" form="fhAg" id="btnHAg" class="save">🕒 Salvar horários e reiniciar o robô</button></div>
    <p class="quando" style="margin:8px 0 0">Só vale depois que o robô reinicia — alguns segundos. Evite salvar bem em cima de um horário de disparo.</p>
  </div>`;
}

function paginaAgendar(aviso, erro) {
  const hoje = hojeSP();
  const todos = ag.carregar();
  const pend = todos.filter(a => a.status === 'pendente').sort((x, y) => (x.data + x.turno).localeCompare(y.data + y.turno));
  const hist = todos.filter(a => a.status !== 'pendente').sort((x, y) => String(y.enviadoEm || '').localeCompare(String(x.enviadoEm || ''))).slice(0, 25);

  const dados = {};
  pend.forEach(a => { dados[a.id] = { tel: fmtTel(a.telefone), msg: a.mensagem || '', turno: a.turno, data: a.data, temFoto: !!a.foto }; });
  const dadosJson = JSON.stringify(dados).replace(/</g, '\\u003c');

  const form = `
  <form class="card" id="formAg">
    <input type="hidden" id="editId" value="">
    <div class="chead"><h2 id="formTit">Novo agendamento</h2><a id="cancelarEd" href="javascript:void(0)" onclick="cancelarEdicao()" style="display:none;margin-left:auto;font-size:.85rem;color:var(--coral-esc);font-weight:700">cancelar edição</a></div>
    <label>Número (WhatsApp)</label>
    <input id="telefone" inputmode="numeric" placeholder="(62) 99999-9999" maxlength="16">
    <label>Mensagem</label>
    <textarea id="mensagem" rows="5" placeholder="Escreva a mensagem que será enviada…" spellcheck="true"></textarea>
    <div style="position:relative;margin:6px 0 2px">
      <button type="button" id="emojiBtn" class="reset" onclick="toggleEmoji()" style="padding:5px 12px;font-size:.95rem" title="Inserir emoji">😊 Emoji</button>
      <div id="emojiPop" style="display:none;position:absolute;z-index:60;top:40px;left:0;background:#fff;border:1px solid var(--linha);border-radius:12px;box-shadow:0 10px 28px -10px rgba(0,0,0,.30);padding:8px;width:min(340px,92vw);max-height:230px;overflow:auto;flex-wrap:wrap;gap:1px"></div>
    </div>
    <div class="fotorow">
      <label class="chk"><input type="checkbox" id="temFoto"> Enviar com foto</label>
      <div id="fotoWrap"><input type="file" id="foto" accept="image/png,image/jpeg,image/webp"></div>
      <div id="fotoAtual" class="meta" style="display:none;margin-top:6px"></div>
    </div>
    <label>Turno do envio</label>
    <div class="turnos">
      <label><input type="radio" name="turno" value="manha" checked><span>☀️ Manhã<br><small>${esc(horaAg('manha'))}</small></span></label>
      <label><input type="radio" name="turno" value="tarde"><span>🌇 Tarde<br><small>${esc(horaAg('tarde'))}</small></span></label>
    </div>
    <label>Data</label>
    <input type="date" id="data" value="${hoje}" min="${hoje}">
    <div class="acts"><button type="submit" class="save">Agendar</button></div>
    <div id="msg" class="aviso" style="display:none"></div>
  </form>

  <details class="acc-sec"${pend.length ? ' open' : ''}>
    <summary class="sec-t" style="cursor:pointer;padding:4px 0">⏳ Pendentes (${pend.length})<small style="font-weight:400;color:var(--cinza)"> — clique para ${pend.length ? 'recolher' : 'abrir'}</small></summary>
    ${pend.length ? pend.map(itemHtml).join('') : '<div class="vazio">Nenhum envio pendente.</div>'}
  </details>

  <details class="acc-sec">
    <summary class="sec-t" style="cursor:pointer;padding:4px 0">📜 Histórico <small style="font-weight:400;color:var(--cinza)">(${hist.length} envio${hist.length === 1 ? '' : 's'} — clique para abrir)</small></summary>
    ${hist.length ? hist.map(itemHtml).join('') : '<div class="vazio">Sem envios recentes.</div>'}
  </details>
  ${cardHorariosAgendados()}
  `;

  const corpo = `<div class="wrap">${subnavMensagens('agendar')}${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}${form}</div>
<script>
  var AGS = ${dadosJson};
  var chk=document.getElementById('temFoto'), wrap=document.getElementById('fotoWrap'), file=document.getElementById('foto');
  var editId=document.getElementById('editId'), fotoAtual=document.getElementById('fotoAtual');
  chk.addEventListener('change',function(){ wrap.classList.toggle('on', chk.checked); if(!chk.checked) file.value=''; });
  function soDig(s){return (s||'').replace(/\\D/g,'');}
  document.getElementById('telefone').addEventListener('input',function(e){
    var v=soDig(e.target.value).slice(0,11);
    if(v.length>=7)e.target.value=v.replace(/(\\d{2})(\\d{4,5})(\\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
    else if(v.length>=3)e.target.value=v.replace(/(\\d{2})(\\d{0,5})/,'($1) $2'); else e.target.value=v;
  });
  function lerArquivo(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result);};r.onerror=rej;r.readAsDataURL(f);});}
  // Seletor de emoji (offline, sem dependências): grade de emojis comuns; clicar
  // insere no cursor da Mensagem. Fica aberto p/ escolher vários; fecha ao clicar fora.
  var EMOJIS='😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 😎 🤩 🥳 🤗 🤔 😅 😂 🤣 😌 😋 😇 🙃 😴 🥲 😢 😭 🥺 😳 🙄 😬 🤫 😮 👍 👎 👌 🙏 👏 🙌 💪 🤝 👋 🤙 ✌️ 💃 🕺 🏃 🎉 🎊 🎈 🎁 ✨ ⭐ 🌟 💫 🔥 💯 ✅ ❌ ❤️ 🧡 💛 💚 💙 💜 🤍 💖 💕 💞 💗 😻 🥇 🏆 🎯 📅 📆 ⏰ ⏳ 📍 📌 📎 📞 📱 💬 💡 ☀️ 🌇 🌈 🌸 🌺 🌻 💐 🏋️ 🧘 🚴 🏊 🥊 🏅 💧 🍏'.split(' ');
  function inserirEmoji(e){ var ta=document.getElementById('mensagem'); if(!ta) return; var s=ta.selectionStart==null?ta.value.length:ta.selectionStart, en=ta.selectionEnd==null?ta.value.length:ta.selectionEnd; ta.value=ta.value.slice(0,s)+e+ta.value.slice(en); var pos=s+e.length; ta.selectionStart=ta.selectionEnd=pos; ta.focus(); }
  function toggleEmoji(){
    var p=document.getElementById('emojiPop'); if(!p) return;
    if(!p.dataset.done){
      p.innerHTML=EMOJIS.map(function(e){return '<button type="button" class="emj" style="border:0;background:transparent;font-size:1.3rem;line-height:1;cursor:pointer;padding:4px 5px;border-radius:8px">'+e+'</button>';}).join('');
      p.addEventListener('click',function(ev){ var b=ev.target.closest?ev.target.closest('.emj'):null; if(b) inserirEmoji(b.textContent); });
      p.dataset.done='1';
    }
    p.style.display=(p.style.display==='none'||!p.style.display)?'flex':'none';
  }
  document.addEventListener('click',function(ev){ var p=document.getElementById('emojiPop'), b=document.getElementById('emojiBtn'); if(!p||p.style.display==='none') return; if((p.contains&&p.contains(ev.target))||(b&&b.contains(ev.target))) return; p.style.display='none'; });
  function rotuloBtn(){ return editId.value ? 'Salvar alterações' : 'Agendar'; }
  window.editarAg=function(id){
    var a=AGS[id]; if(!a) return;
    editId.value=id;
    document.getElementById('telefone').value=a.tel;
    document.getElementById('mensagem').value=a.msg;
    document.getElementById('data').value=a.data;
    var r=document.querySelector('input[name=turno][value="'+a.turno+'"]'); if(r)r.checked=true;
    chk.checked=a.temFoto; wrap.classList.toggle('on',a.temFoto); file.value='';
    if(a.temFoto){ fotoAtual.style.display='block'; fotoAtual.textContent='📎 Foto atual será mantida. Escolha outra para trocar, ou desmarque "Enviar com foto" para remover.'; }
    else { fotoAtual.style.display='none'; }
    document.getElementById('formTit').textContent='Editar agendamento';
    document.querySelector('#formAg button.save').textContent='Salvar alterações';
    document.getElementById('cancelarEd').style.display='inline';
    document.getElementById('formAg').scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.cancelarEdicao=function(){
    editId.value=''; document.getElementById('formAg').reset();
    wrap.classList.remove('on'); fotoAtual.style.display='none';
    document.getElementById('formTit').textContent='Novo agendamento';
    document.querySelector('#formAg button.save').textContent='Agendar';
    document.getElementById('cancelarEd').style.display='none';
  };
  document.getElementById('formAg').addEventListener('submit', async function(e){
    e.preventDefault();
    var msg=document.getElementById('msg');
    var btn=e.target.querySelector('button.save'); btn.disabled=true; btn.textContent='Salvando…';
    try{
      var payload={
        id: editId.value || null,
        telefone:document.getElementById('telefone').value,
        mensagem:document.getElementById('mensagem').value,
        turno:(document.querySelector('input[name=turno]:checked')||{}).value,
        data:document.getElementById('data').value,
        temFoto: chk.checked,
        fotoDataUrl:null
      };
      if(chk.checked && file.files[0]){
        if(file.files[0].size>6*1024*1024){ throw new Error('Imagem muito grande (máx. ~6 MB).'); }
        payload.fotoDataUrl=await lerArquivo(file.files[0]);
      }
      var r=await fetch('/agendar/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var d=await r.json();
      if(d.ok){ location.href='/agendar?ok=1'; return; }
      msg.className='aviso err'; msg.textContent=d.erro||'Não foi possível salvar.'; msg.style.display='block';
    }catch(err){ msg.className='aviso err'; msg.textContent=err.message||'Falha ao salvar.'; msg.style.display='block'; }
    finally{ btn.disabled=false; btn.textContent=rotuloBtn(); }
  });
</script>`;
  return chrome({ tab: 'Agendamento', h1: '📅 Agendamento de envios', p: `Mensagens são enviadas <b>${esc(horaAg('manha'))}</b> (manhã) e <b>${esc(horaAg('tarde'))}</b> (tarde) do dia agendado.` }, 'msg', corpo);
}

// ── Página 3: conexão do WhatsApp (QR quando cai) ───────────────────────────
function paginaWa() {
  const st = waStatus.get();
  const quando = st.atualizadoEm ? new Date(st.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  let bloco;
  if (st.estado === 'conectado') {
    bloco = `<div class="wa-card ok"><div class="wa-ic">✅</div><h2>WhatsApp conectado</h2><p>A sessão está ativa — o robô envia normalmente.</p></div>`;
  } else if (st.estado === 'qr' && st.qr) {
    bloco = `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2>
      <p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código abaixo.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR do WhatsApp">
      <p class="wa-hint">Esta página se atualiza sozinha. Assim que conectar, vira “✅ conectado”.</p></div>`;
  } else if (st.estado === 'iniciando') {
    bloco = `<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>O robô está subindo a conexão. Aguarde alguns segundos — se precisar de QR, ele aparece aqui.</p></div>`;
  } else if (st.estado === 'desconectado') {
    bloco = `<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>O robô está tentando reconectar sozinho. Se aparecer um QR aqui em instantes, escaneie; senão, a reconexão automática costuma resolver.</p></div>`;
  } else {
    bloco = `<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>O robô ainda não gravou o estado. Verifique se o <code>slimfit-exp</code> está rodando (<code>pm2 status</code>).</p></div>`;
  }
  const reload = st.estado === 'conectado' ? '' : '<script>setTimeout(function(){location.reload()},6000)</script>';
  const corpo = `<div class="wrap">${bloco}<p class="wa-upd">Última atualização do robô: ${esc(quando)}</p></div>${reload}`;
  return chrome({ tab: 'WhatsApp', h1: '📱 Conexão do WhatsApp', p: 'Veja se a sessão está ativa — e escaneie o QR aqui se ela cair.' }, 'wa', corpo);
}

// ── Horários por mensagem (embutidos nos cards da aba Mensagens) ────────────
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// mensagem (chave em mensagens.js) → jobs de horário (chave em horarios.js).
// [chave, sublabel]. Sublabel '' = envio único; senão distingue os dois turnos.
const HORARIOS_DA_MSG = {
  confirmacao_hoje:    [['morning', '']],
  confirmacao_amanha:  [['afternoon', '']],
  followup:            [['followupMorning', 'Manhã'], ['followupAfternoon', 'Tarde']],
  followup_aluna:      'compartilha:followup', // mesmo job do follow-up — só nota
  no_show:             [['noShowMorning', 'Manhã'], ['noShowAfternoon', 'Tarde']],
  renovacao:           [['renewal', '']],
  aniversario:         [['aniversariantes', '']],
  instagram:           [['instagram', '']],
  circuito_convocacao: [['circuitoConvoca', '']],
  circuito_lembrete:   [['circuitoLembrete', '']],
};
// Jobs sem texto editável, na seção "Outros envios" da aba Mensagens.
// (os agendados manhã/tarde ficam na aba "Agendar envios", pois são dela.)
const OUTROS_JOBS = ['resumoDia', 'resumoSemana'];

// Uma linha "hora + dias" para um job; inputs pertencem ao form informado (padrão #fh).
function blocoHorario(info, sublabel, formId = 'fh') {
  const f = esc(formId);
  const dias = DIAS.map((nome, i) => {
    const on = info.dias.includes(i) ? ' checked' : '';
    return `<label><input type="checkbox" form="${f}" name="dias_${esc(info.chave)}" value="${i}"${on}><span>${nome}</span></label>`;
  }).join('');
  const rot = sublabel ? `Horário — ${esc(sublabel)}` : 'Horário';
  return `<div class="hrow">
    <div><div class="lbl">${rot}</div><input type="time" form="${f}" name="hora_${esc(info.chave)}" value="${esc(info.hora)}" required></div>
    <div><div class="lbl">Dias da semana</div><div class="dias">${dias}</div></div>
  </div>`;
}

// Hora 'HH:MM' de um job (override ou padrão) — usada nos rótulos do /agendar.
function horaTurno(chave) { try { return horarios.parse(horarios.cronDe(chave)).hora; } catch (_) { return ''; } }

// ── Página: o que o robô fez hoje ───────────────────────────────────────────
function paginaHoje(dia) {
  const d = dia || atividade.hojeSP();
  const r = atividade.resumoHoje(d);
  const evs = atividade.listarHoje(d, 150);
  const ehHoje = d === atividade.hojeSP();

  const jobs = r.jobs.map(j => `<div class="jobrow">
    <div class="jn">${esc(j.contexto)}</div>
    <div class="jc">${j.sent} enviada${j.sent === 1 ? '' : 's'}${j.failed ? ` · <span class="f">${j.failed} falha${j.failed === 1 ? '' : 's'}</span>` : ''}</div>
  </div>`).join('');

  const lista = evs.map(e => {
    const ic = e.ok ? '✅' : '⚠️';
    const who = e.grupo ? esc(e.destino || 'grupo') : esc(fmtTel(e.destino));
    const pv = e.erro ? `<span style="color:#a12626">${esc(e.erro)}</span>` : esc(e.preview || (e.midia ? '📎 mídia' : ''));
    return `<div class="ev"><span class="h">${esc(e.quando)}</span><span class="ic">${ic}</span>
      <div class="d"><span class="who">${who}</span> <span class="ctx">· ${esc(e.contexto)}</span><span class="pv">${pv}</span></div></div>`;
  }).join('');

  const corpo = `<div class="wrap">
    ${subnavMensagens('hoje')}
    <div class="datesel">
      <form method="GET" action="/hoje" class="datesel" style="margin:0">
        <label style="margin:0">Dia:</label>
        <input type="date" name="dia" value="${esc(d)}" max="${esc(atividade.hojeSP())}" onchange="this.form.submit()">
        ${ehHoje ? '' : '<a href="/hoje" style="font-size:.85rem;font-weight:700;color:var(--teal)">voltar para hoje</a>'}
      </form>
    </div>
    <div class="stats">
      <div class="stat tot"><div class="n">${r.total}</div><div class="l">total de envios</div></div>
      <div class="stat ok"><div class="n">${r.enviados}</div><div class="l">✅ enviados</div></div>
      <div class="stat err"><div class="n">${r.falhas}</div><div class="l">⚠️ falhas</div></div>
    </div>
    <div class="card">
      <div class="chead"><h2>Por tipo de envio</h2></div>
      ${jobs || '<div class="vazio">Nenhum envio registrado ' + (ehHoje ? 'hoje' : 'neste dia') + ' ainda.</div>'}
    </div>
    <div class="sec-t">📜 Envios ${ehHoje ? 'de hoje' : 'do dia'} (${evs.length})</div>
    <div class="card">${lista || '<div class="vazio">Sem envios para mostrar.</div>'}</div>
    <p class="quando" style="text-align:center">Registrado automaticamente a cada envio do robô. ${ehHoje ? 'Atualiza ao recarregar.' : ''}</p>
  </div>${ehHoje ? '<script>setTimeout(function(){location.reload()},60000)</script>' : ''}`;
  return chrome({ tab: 'Log', h1: '📊 Log — o que o robô fez', p: ehHoje ? 'Todos os envios de <b>hoje</b>, em tempo quase real.' : `Envios do dia <b>${esc(fmtData(d))}</b>.` }, 'msg', corpo);
}

// ── Página: Instagram (status + liga/desliga) ───────────────────────────────
function lerJsonData(nome) {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', nome), 'utf8')); }
  catch (_) { return null; }
}
function paginaInstagram(aviso, erro) {
  const on = igcfg.ligado();
  const fonte = igcfg.fonte();
  const limite = igcfg.maxDia();
  const fonteMax = igcfg.fonteMax();
  const maxTent = parseInt(process.env.IG_MAX_TENTATIVAS_INDISP || '2', 10);
  const msgIg = mensagens.listar().find(m => m.chave === 'instagram');
  const jobIg = horarios.listar().find(j => j.chave === 'instagram');
  const ck = igcookies.status();
  const ckQuando = ck.atualizadoEm ? new Date(ck.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const ckTexto = (ck.existe && ck.temSessionId)
    ? `✅ Cookies presentes (${ck.quantidade} cookie${ck.quantidade === 1 ? '' : 's'}, sessionid ok). Atualizado em ${esc(ckQuando)}.`
    : ck.existe
      ? '⚠️ Há cookies salvos, mas <b>sem o sessionid</b> — reimporte estando logada.'
      : '⚠️ Nenhum cookie salvo — a sessão do Instagram depende deles. Cole abaixo para (re)conectar.';
  // Saúde REAL da sessão (aferida na última execução do robô): coletou seguidoras
  // = viva; coletou 0 = caiu (parede de login). É diferente de "ligado".
  const sessIg = lerJsonData('instagram-sessao.json');
  const sessQuando = (sessIg && sessIg.em) ? new Date(sessIg.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const sessTxt = sessIg
    ? (sessIg.ok
        ? `✅ Sessão verificada e <b>ativa</b> na última execução (${esc(sessQuando)}).`
        : `⚠️ <b>A sessão do Instagram caiu</b> na última execução (${esc(sessQuando)}) — coletou 0 seguidoras (parede de login). <b>Reimporte os cookies</b> abaixo.`)
    : 'ℹ️ Sessão ainda não verificada por uma execução — use “Enviar agora” abaixo para testar.';
  const sessCor = sessIg ? (sessIg.ok ? 'var(--ok)' : 'var(--erro)') : 'var(--cinza)';
  const rel = lerJsonData('instagram-envios.json');
  const indisp = lerJsonData('instagram-indisponiveis.json') || {};
  const enviados = lerJsonData('instagram-enviados.json');
  const totalRecebeu = (enviados && Array.isArray(enviados.usernames)) ? enviados.usernames.length : 0;

  let ultima = '—', env = 0, ind = 0, err = 0, teveRun = false;
  if (rel && Array.isArray(rel.resultados)) {
    teveRun = true;
    ultima = rel.executadoEm || '—';
    for (const r of rel.resultados) { if (r.status === 'sent') env++; else if (r.status === 'unavailable') ind++; else err++; }
  }

  const puladasArr = Object.entries(indisp).sort((a, b) => b[1] - a[1]);
  const puladas = puladasArr.map(([u, n]) => {
    const bloq = n >= maxTent;
    return `<div class="jobrow"><div class="jn">@${esc(u)}</div><div class="jc">${bloq ? `<span class="f">⛔ ${n}/${maxTent} — não tenta mais</span>` : `${n}/${maxTent} tentativa${n === 1 ? '' : 's'}`}</div></div>`;
  }).join('');

  const statusCard = on
    ? `<div class="wa-card ok"><div class="wa-ic">📸</div><h2>Instagram LIGADO</h2>
        <p>O robô envia boas-vindas às novas seguidoras às <b>07:00</b>, no máximo <b>${limite}/dia</b>.</p>
        <form method="POST" action="/instagram/toggle" style="margin-top:14px"><input type="hidden" name="alvo" value="off">
          <button class="rm" type="submit" onclick="return confirm('Pausar o envio de boas-vindas no Instagram?')">⏸️ Pausar Instagram</button></form></div>`
    : `<div class="wa-card warn"><div class="wa-ic">📸</div><h2>Instagram pausado</h2>
        <p>As boas-vindas automáticas estão <b>desligadas</b>. Ligue só com o proxy e os cookies configurados (senão a conta pode ser bloqueada).</p>
        <form method="POST" action="/instagram/toggle" style="margin-top:14px"><input type="hidden" name="alvo" value="on">
          <button class="save" type="submit" onclick="return confirm('Ligar o envio de boas-vindas no Instagram?')">▶️ Ligar Instagram</button></form></div>`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${statusCard}

    <div class="card" style="border-left:4px solid ${sessCor}">
      <p class="quando" style="margin:0 0 12px;font-size:.9rem">${sessTxt}</p>
      <button type="button" class="save" onclick="forcarIg()" id="btnForcarIg" style="padding:9px 16px">▶️ Enviar boas-vindas agora</button>
      <p class="quando" style="margin:8px 0 0">Dispara o envio <b>na hora</b> (não espera as 07:00) e <b>testa a sessão</b>: se ela tiver caído, a execução coleta 0 seguidoras e avisa aqui.</p>
      <p id="forcarIgMsg" class="quando" style="margin:10px 0 0;font-weight:700"></p>
    </div>

    <div class="sec-t">🍪 Sessão do Instagram (cookies)</div>
    <div class="card">
      <p class="quando" style="margin:0 0 10px">${ckTexto}</p>
      <form method="POST" action="/instagram/cookies">
        <label style="margin:0 0 4px">Cole o JSON dos cookies (Cookie-Editor → instagram.com logada → Export)</label>
        <textarea name="cookies" rows="4" spellcheck="false" placeholder='[{"name":"sessionid","value":"..."}, ... ]' style="font-family:ui-monospace,monospace;font-size:.85rem"></textarea>
        <div class="acts"><button type="submit" class="save" onclick="return confirm('Importar estes cookies do Instagram?')">🍪 Importar cookies</button></div>
      </form>
      <p class="quando" style="margin:10px 0 0">🔒 Fica só no servidor (nunca é mostrado de volta) e vale já na próxima execução — sem reiniciar. Instale a extensão <b>Cookie-Editor</b>, abra o <b>instagram.com logada na conta do Studio</b>, clique em <b>Export</b> (JSON) e cole aqui.</p>
    </div>

    <div class="stats">
      <div class="stat tot"><div class="n">${limite}</div><div class="l">limite/dia</div></div>
      <div class="stat ok"><div class="n">${teveRun ? env : '—'}</div><div class="l">✅ última execução</div></div>
      <div class="stat"><div class="n" style="color:var(--tinta)">${totalRecebeu}</div><div class="l">já receberam (total)</div></div>
    </div>
    <div class="card">
      <div class="chead"><h2>Última execução</h2></div>
      ${teveRun
        ? `<p class="quando" style="margin:0 0 8px">${esc(ultima)}</p>
           <div class="jobrow"><div class="jn">✅ Enviadas</div><div class="jc">${env}</div></div>
           <div class="jobrow"><div class="jn">🚫 Indisponíveis</div><div class="jc">${ind}</div></div>
           <div class="jobrow"><div class="jn">⚠️ Falhas</div><div class="jc">${err}</div></div>`
        : '<div class="vazio">Ainda não há registro de execução do Instagram.</div>'}
    </div>
    <div class="sec-t">⛔ Contas puladas (${puladasArr.length})</div>
    <div class="card">
      ${puladas || '<div class="vazio">Nenhuma conta na lista de indisponíveis.</div>'}
      ${puladasArr.length ? `<p class="quando" style="margin:10px 0 0">Contas privadas/restritas que deram "Mensagem Indisponível". Após ${maxTent} tentativas o robô para de tentar (não gastam as vagas do dia). Se uma delas abrir o perfil depois, recebe normalmente.</p>` : ''}
    </div>

    <div class="sec-t">🎯 Limite de envios por dia</div>
    <div class="card">
      <form method="POST" action="/instagram/limite" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div><label style="margin:0 0 4px">Máximo de DMs por dia</label><input type="number" name="max" min="1" max="100" value="${limite}" style="width:120px" required></div>
        <button type="submit" class="save">Salvar limite</button>
      </form>
      <p class="quando" style="margin:8px 0 0">Fonte: <b>${fonteMax === 'painel' ? 'painel' : '.env (IG_MAX_DIA)'}</b>. Recomendado começar baixo (4–5) e subir aos poucos. Vale já no próximo disparo — sem reiniciar.</p>
    </div>

    <div class="sec-t">✍️ Mensagem de boas-vindas</div>
    ${msgIg ? `<div class="card">${cardMensagem(msgIg, '/instagram', { ig: true })}</div>` : ''}

    <div class="sec-t">🕒 Horário do envio</div>
    <div class="card">
      <form id="fhIg" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnHIg');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"><input type="hidden" name="voltar" value="/instagram"></form>
      ${jobIg ? blocoHorario(jobIg, '', 'fhIg') : '<div class="vazio">Sem horário configurável.</div>'}
      <div class="acts" style="margin-top:14px"><button type="submit" form="fhIg" id="btnHIg" class="save">🕒 Salvar horário e reiniciar o robô</button></div>
      <p class="quando" style="margin:8px 0 0">Só vale depois que o robô reinicia — alguns segundos.</p>
    </div>

    <p class="quando" style="text-align:center">Fonte do liga/desliga: <b>${fonte === 'painel' ? 'painel' : '.env (IG_ENABLED)'}</b>. Mudar aqui vale no próximo disparo — sem reiniciar.</p>
  </div>
  ${scriptPreviewTeste()}
  <script>
  function forcarIg(){
    var b=document.getElementById('btnForcarIg'), m=document.getElementById('forcarIgMsg');
    if(!confirm('Disparar as boas-vindas do Instagram AGORA?')) return;
    if(b) b.disabled=true; if(m) m.textContent='⏳ Enviando o pedido ao robô…';
    fetch('/instagram/forcar',{method:'POST'}).then(function(r){return r.json();}).then(function(j){
      if(!j||!j.ok){ if(m) m.textContent='❌ '+((j&&j.erro)||'não consegui pedir'); if(b) b.disabled=false; return; }
      pollForcarIg();
    }).catch(function(){ if(m) m.textContent='❌ erro de rede'; if(b) b.disabled=false; });
  }
  function pollForcarIg(){
    var b=document.getElementById('btnForcarIg'), m=document.getElementById('forcarIgMsg');
    fetch('/instagram/forcar/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(st){
      st=st||{};
      if(st.status==='pendente'){ if(b)b.disabled=true; if(m) m.textContent='⏳ Na fila do robô…'; setTimeout(pollForcarIg,3000); }
      else if(st.status==='executando'){ if(b)b.disabled=true; if(m) m.textContent='🚀 Enviando… o navegador do Instagram está rodando (pode levar alguns minutos).'; setTimeout(pollForcarIg,4000); }
      else if(st.status==='concluido'){ if(b)b.disabled=false; if(m) m.innerHTML='✅ Concluído! Veja o resultado em <b>Última execução</b> abaixo — atualize a página.'; }
      else if(st.status==='falha'){ if(b)b.disabled=false; if(m) m.textContent='❌ Falhou: '+(st.erro||'erro')+'. Se for login/sessão, reimporte os cookies abaixo.'; }
      else { if(b)b.disabled=false; if(m) m.textContent=''; }
    }).catch(function(){ setTimeout(pollForcarIg,4000); });
  }
  // Se já houver um envio em andamento (recarregou a página), retoma o acompanhamento.
  (function(){ fetch('/instagram/forcar/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(st){ if(st&&(st.status==='pendente'||st.status==='executando')) pollForcarIg(); }).catch(function(){}); })();
  </script>`;
  return chrome({ tab: 'Instagram', h1: '📸 Instagram', p: 'Status, liga/desliga, limite, mensagem e horário — tudo do Instagram aqui.' }, 'ig', corpo);
}

// ── Página: Indicadores do formulário ───────────────────────────────────────
function paginaIndicadores(dias, aviso) {
  const janelas = [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [0, 'Tudo']];
  const jan = janelas.some(([d]) => d === dias) ? dias : 7;
  const r = indicadores.resumo(jan);

  const segs = janelas.map(([d, l]) => `<a href="/indicadores?dias=${d}" class="${d === jan ? 'on' : ''}">${l}</a>`).join('');

  // Barras por dia (mais recente primeiro), escala pelo maior nº de PESSOAS.
  const maxP = Math.max(1, ...r.porDia.map(d => d.pessoas));
  const fmtDia = s => { const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  const barras = r.porDia.filter(d => d.pessoas || d.agendamentos).map(d => {
    const wP = Math.round((d.pessoas / maxP) * 100);
    return `<div class="bar">
      <span class="bd">${fmtDia(d.dia)}</span>
      <span class="btrack"><span class="bfill" style="width:${wP}%"></span></span>
      <span class="bn">${d.pessoas} <small>pessoa${d.pessoas === 1 ? '' : 's'}</small> · <span style="color:var(--coral-esc)">${d.agendamentos}</span> <small>agend.</small></span>
    </div>`;
  }).join('');

  const barLinha = (label, n, max, coral) => `<div class="bar"><span class="bd">${esc(label)}</span><span class="btrack"><span class="bfill${coral ? ' ag' : ''}" style="width:${Math.round((n / max) * 100)}%"></span></span><span class="bn">${n}</span></div>`;
  const maxH = Math.max(1, ...r.picoHoras.map(h => h.n));
  const picoHorasHtml = r.picoHoras.slice(0, 8).map(h => barLinha(h.hora, h.n, maxH)).join('');
  const maxD = Math.max(1, ...r.picoDias.map(d => d.n));
  const picoDiasHtml = r.picoDias.map(d => barLinha(d.dia, d.n, maxD)).join('');
  const maxA = Math.max(1, ...r.horariosAula.map(a => a.n));
  const aulaHtml = r.horariosAula.slice(0, 12).map(a => barLinha(a.hora, a.n, maxA, true)).join('');

  // Gerador de links por origem: um link etiquetado por canal + botão "Copiar".
  const FORM_BASE = (process.env.FORM_CLOUD_URL || 'https://sf-formularioexperimental.onrender.com').replace(/\/+$/, '');
  let CANAIS = []; try { CANAIS = origens.listar(); } catch (_) {}
  // Casa os contadores já registrados (r.porOrigem) com cada canal, sem diferenciar maiúsculas.
  const origMap = {};
  (r.porOrigem || []).forEach(o => { origMap[String(o.origem || '').trim().toLowerCase()] = o; });
  const usados = new Set(CANAIS.map(c => c.slug));
  const semTag = origMap['(sem etiqueta)'] || null;
  const outras = (r.porOrigem || []).filter(o => {
    const k = String(o.origem || '').trim().toLowerCase();
    return k && k !== '(sem etiqueta)' && !usados.has(k);
  });

  const cardCanal = c => {
    const o = origMap[c.slug] || { acessos: 0, agendamentos: 0 };
    const url = `${FORM_BASE}/?origem=${c.slug}`;
    const cont = (o.acessos || o.agendamentos)
      ? `<b style="color:var(--teal-esc)">${o.acessos}</b> acesso${o.acessos === 1 ? '' : 's'} · <span style="color:var(--coral-esc)">${o.agendamentos} agend.</span>`
      : `<span style="color:var(--cinza)">ainda sem acessos</span>`;
    return `<div class="card" style="display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${esc(c.rot)}</div>
          <div class="quando" style="margin:2px 0 0">${esc(c.desc || '')}</div>
        </div>
        <form method="POST" action="/origens/excluir" style="margin:0;flex:none" onsubmit="return confirm('Excluir o canal “${esc(c.rot)}”? (os acessos já registrados continuam no histórico)')">
          <input type="hidden" name="slug" value="${esc(c.slug)}">
          <button type="submit" class="tagbtn rm" title="Excluir canal" style="width:auto">🗑️</button>
        </form>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code style="flex:1 1 220px;min-width:0;background:var(--bg);border:1px solid var(--linha);border-radius:8px;padding:8px 10px;font-size:var(--fs-sm);word-break:break-all">${esc(url)}</code>
        <button type="button" class="save" style="flex:none" onclick="copiarLink(this,'${esc(url)}')">📋 Copiar</button>
      </div>
      <div class="quando" style="margin:0">${cont}</div>
    </div>`;
  };

  const outrasHtml = outras.length ? `
    <div class="sec-t">🏷️ Outras etiquetas registradas</div>
    <div class="card">
      ${outras.map(o => `<div class="jobrow"><div class="jn">${esc(o.origem)}</div><div class="jc">${o.acessos} acesso${o.acessos === 1 ? '' : 's'} · <span style="color:var(--coral-esc)">${o.agendamentos} agend.</span></div></div>`).join('')}
    </div>` : '';

  const semTagHtml = (semTag && (semTag.acessos || semTag.agendamentos)) ? `
    <div class="card" style="border-style:dashed">
      <p class="quando" style="margin:0">Além desses, <b>${semTag.acessos} acesso${semTag.acessos === 1 ? '' : 's'}</b> chegaram por um endereço <b>sem etiqueta</b> — entram como “Direto ou app”. Trocar os links já divulgados pelos de cima faz esses acessos passarem a aparecer por canal.</p>
    </div>` : '';

  const origemBloco = `
    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">🔗 Gerador de links por origem <small style="font-weight:400;color:var(--cinza)">(${CANAIS.length} cana${CANAIS.length === 1 ? 'l' : 'is'} — clique para abrir)</small></summary>
    <div class="card" style="border-style:dashed">
      <p class="quando" style="margin:0">De onde vem cada pessoa? Use um <b>link diferente em cada lugar</b> — Instagram, WhatsApp, indicação, anúncio. Quem acessar por ele já entra etiquetado e a conversão de cada canal aparece aqui embaixo. Copie o link do canal e use no lugar do link comum.</p>
    </div>
    ${CANAIS.map(cardCanal).join('')}
    <details class="card"><summary style="cursor:pointer;font-weight:700">＋ Criar canal</summary>
      <form method="POST" action="/origens/criar" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:160px"><label style="margin:0 0 4px">Nome do canal</label><input type="text" name="rot" placeholder="ex.: Facebook, Panfleto, TikTok" required></div>
        <div style="flex:2;min-width:180px"><label style="margin:0 0 4px">Descrição <small style="color:var(--cinza)">(opcional)</small></label><input type="text" name="desc" placeholder="onde você vai usar este link"></div>
        <button type="submit" class="save" style="padding:9px 16px">Criar</button>
      </form>
      <p class="quando" style="margin:8px 0 0">O link vira <code>…/?origem=&lt;nome&gt;</code> (sem acento/espaço). Os 4 canais iniciais também podem ser excluídos.</p>
    </details>
    ${semTagHtml}
    ${outrasHtml}
    </details>`;

  // Log completo dos agendamentos (dados da aluna). Mostra os mais recentes; o
  // conteúdo completo fica num <details> para não pesar a página.
  let LOG = []; try { LOG = bookings.listar(300); } catch (_) {}
  const fmtQuando = ts => { try { const d = new Date(ts); return isNaN(d) ? esc(ts || '—') : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return esc(ts || '—'); } };
  const cadCelula = b => {
    if (b.cadastroNovo) return '<span class="pill" style="border-color:var(--teal)">cadastro novo</span>';
    const a = b.atualizacao;
    let extra = '';
    if (a && a.ok === true) extra = ' <span class="pill" style="border-color:var(--teal)">✓ dados atualizados</span>';
    else if (a && a.ok === false) extra = ' <span class="pill" style="border-color:var(--coral)" title="' + esc(String(a.erro || '')) + '">⚠ não atualizado</span>';
    return '<span class="pill" style="border-color:var(--linha)">já existia</span>' + extra;
  };
  const logRows = LOG.map(b => `<tr>
      <td style="white-space:nowrap">${fmtQuando(b.ts)}</td>
      <td>${esc(b.nome || '—')}</td>
      <td style="white-space:nowrap">${esc(fmtTel ? fmtTel(b.telefone) : b.telefone)}</td>
      <td style="white-space:nowrap">${esc(b.cpf || '—')}</td>
      <td>${esc(b.email || '—')}</td>
      <td style="white-space:nowrap">${esc(b.nascimento || '—')}</td>
      <td style="white-space:nowrap">${esc(b.when || '—')}</td>
      <td>${esc(b.origem || '—')}</td>
      <td>${cadCelula(b)}</td>
    </tr>`).join('');
  const logBloco = `
    <div class="sec-t">🗒️ Agendamentos pelo formulário (dados completos)</div>
    <details class="card"${LOG.length ? '' : ' open'}>
      <summary style="cursor:pointer;font-weight:700">${LOG.length ? `Ver os ${LOG.length} agendamento${LOG.length === 1 ? '' : 's'} registrado${LOG.length === 1 ? '' : 's'}` : 'Nenhum agendamento registrado ainda'}</summary>
      <p class="quando" style="margin:10px 0">Tudo o que a aluna digitou no formulário (nome, CPF, telefone, e-mail e nascimento), o horário da aula e o que o EVO fez com o cadastro. Serve para conferir os dados quando o cadastro do EVO veio incompleto (ex.: cadastro antigo). Atualiza a cada ~2 min.</p>
      ${LOG.length ? `<div style="overflow-x:auto"><table class="logtab">
        <thead><tr><th>Quando</th><th>Nome</th><th>Telefone</th><th>CPF</th><th>E-mail</th><th>Nascimento</th><th>Aula</th><th>Origem</th><th>Cadastro no EVO</th></tr></thead>
        <tbody>${logRows}</tbody></table></div>` : '<div class="vazio">Assim que alguém agendar pelo formulário, os dados aparecem aqui.</div>'}
    </details>`;

  // Quebra do funil "de onde vieram": nome amigável do canal (usa o rótulo do
  // Gerador de links quando existe; senão a própria etiqueta) e mini-pílulas com
  // a contagem por origem. `campo` = 'pessoas' (visitantes) ou 'agendamentos'.
  const rotDe = {}; CANAIS.forEach(c => { rotDe[c.slug] = c.rot; });
  const nomeOrigem = k => {
    const kl = String(k || '').trim().toLowerCase();
    if (kl === '(sem etiqueta)') return 'Direto/app';
    return rotDe[kl] || k;
  };
  const funilPorOrigem = (campo) => {
    const its = (r.porOrigem || []).filter(o => o[campo] > 0).sort((a, b) => b[campo] - a[campo]);
    if (!its.length) return '';
    const tot = its.reduce((s, o) => s + o[campo], 0) || 1;
    const rows = its.map(o => {
      const pct = Math.max(4, Math.round((o[campo] / tot) * 100));
      return `<div style="display:flex;align-items:center;gap:9px;font-size:var(--fs-sm)">
        <span style="width:104px;flex:none;color:var(--cinza);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(nomeOrigem(o.origem))}">${esc(nomeOrigem(o.origem))}</span>
        <span style="flex:1;min-width:40px;height:7px;background:var(--linha);border-radius:999px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:var(--teal)"></span></span>
        <span style="width:30px;flex:none;text-align:right;font-weight:700;color:var(--teal-esc)">${o[campo]}</span>
      </div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;padding:4px 4px 12px 26px">${rows}</div>`;
  };
  const funilPessoasOrig = funilPorOrigem('pessoas');
  const funilAgendOrig = funilPorOrigem('agendamentos');

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso err">${esc(aviso)}</div>` : ''}
    <div class="segs">${segs}</div>
    <div class="stats">
      <div class="stat tot"><div class="n">${r.pessoas}</div><div class="l">👥 pessoas</div></div>
      <div class="stat"><div class="n" style="color:var(--cinza)">${r.acessos}</div><div class="l">aberturas (acessos)</div></div>
      <div class="stat ok"><div class="n">${r.agendamentos}</div><div class="l">agendaram</div></div>
      <div class="stat"><div class="n" style="color:var(--coral-esc)">${r.conversao}%</div><div class="l">conversão (por pessoa)</div></div>
    </div>
    <div class="card">
      <div class="chead"><h2>Funil</h2></div>
      <div class="jobrow"><div class="jn">👥 Pessoas que visitaram</div><div class="jc">${r.pessoas}</div></div>
      ${funilPessoasOrig}
      <div class="jobrow"><div class="jn">👀 Aberturas da página (acessos)</div><div class="jc">${r.acessos}</div></div>
      <div class="jobrow"><div class="jn">✅ Agendaram a experimental</div><div class="jc">${r.agendamentos}</div></div>
      ${funilAgendOrig}
      <div class="jobrow"><div class="jn">↩️ Visitaram e não agendaram</div><div class="jc">${r.naoAgendaram}</div></div>
    </div>
    <div class="sec-t">📅 Por dia (pessoas ▮ · agendamentos)</div>
    <div class="card">${barras || '<div class="vazio">Sem dados ainda neste período. Os números aparecem conforme as pessoas acessam o formulário.</div>'}</div>

    <div class="sec-t">⏰ Horários de pico &nbsp;·&nbsp; 📆 Dias da semana</div>
    <div class="card">
      <p class="quando" style="margin:0 0 8px">Quando as pessoas mais <b>acessam</b> o formulário.</p>
      <div style="display:grid;grid-template-columns:1fr;gap:2px">${picoHorasHtml || '<div class="vazio">Sem acessos no período.</div>'}</div>
      <div style="height:12px"></div>
      <div style="display:grid;grid-template-columns:1fr;gap:2px">${picoDiasHtml}</div>
    </div>

    <div class="sec-t">🎯 Horários de aula mais escolhidos</div>
    <div class="card">
      ${aulaHtml || '<div class="vazio">Ainda sem agendamentos com horário registrado neste período — passa a contar a partir dos próximos agendamentos.</div>'}
    </div>
    ${origemBloco}
    ${logBloco}
    <p class="quando" style="text-align:center">Coletado do formulário a cada ~2 min. ${r.primeiroDia ? `Desde ${esc(fmtData(r.primeiroDia))}.` : 'Ainda começando a coletar.'}</p>
  </div>
  <style>
  .logtab{width:100%;border-collapse:collapse;font-size:var(--fs-sm,.85rem)}
  .logtab th,.logtab td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--linha)}
  .logtab th{color:var(--cinza);font-weight:700;white-space:nowrap}
  .logtab tbody tr:hover{background:var(--bg)}
  </style>
  <script>
  function copiarLink(btn, url){
    var ok=function(){var t=btn.textContent;btn.textContent='✅ Copiado';btn.disabled=true;setTimeout(function(){btn.textContent=t;btn.disabled=false;},1500);};
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(ok).catch(function(){fallback();});
    } else { fallback(); }
    function fallback(){
      try{var ta=document.createElement('textarea');ta.value=url;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');document.body.removeChild(ta);ok();}
      catch(e){window.prompt('Copie o link:',url);}
    }
  }
  </script>`;
  return chrome({ tab: 'Formulário', h1: '📈 Formulário', p: 'Acessos, agendamentos e taxa de conversão do formulário de agendamento.' }, 'ind', corpo);
}

// ── Página: Sofia (chatbot) — prompt, configs e conexão do WhatsApp dela ─────
function blocoSofiaWa() {
  const st = sofia.waStatus();
  const quando = st.atualizadoEm ? new Date(st.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  if (st.estado === 'conectado') {
    return `<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da SoFIA conectado</h2><p>A SoFIA está no ar e responde as alunas neste número.</p></div>`;
  }
  if (st.estado === 'qr' && st.qr) {
    return `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da SoFIA</h2>
      <p>Este é o WhatsApp <b>da SoFIA</b> (número próprio, diferente do robô de mensagens). No celular do número da SoFIA: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR da SoFIA"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>`;
  }
  // Sem status publicado ainda (o listener da Sofia precisa gravar sofia-wa-status.json).
  return `<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da SoFIA — sem informação</h2>
    <p>Para o QR da SoFIA aparecer aqui, o processo dela precisa <b>publicar o estado</b> em <code>sofia-wa-status.json</code>. Enquanto isso não estiver ligado, conecte a SoFIA pelo terminal como de costume.</p>
    <p class="wa-upd">Última atualização: ${esc(quando)}</p></div>`;
}

// Sub-navegação da aba Sofia: Configuração (prompt/configs) x Conversas (inbox).
function subnavSofia(view) {
  const base = 'display:inline-flex;align-items:center;justify-content:center;padding:6px 13px;border-radius:999px;font-weight:700;font-family:Montserrat,sans-serif;font-size:.8rem;text-decoration:none;border:1px solid #e8e8ea;white-space:nowrap';
  const on = 'background:#11abae;color:#fff;border-color:#11abae';
  const off = 'background:#fff;color:#5c5960';
  const item = (v, rot) => `<a href="/sofia${v === 'config' ? '' : '?view=' + v}" style="${base};${view === v ? on : off}">${rot}</a>`;
  const sess = _navSess || { admin: true, telas: [] };
  let its = '';
  if (podeSofiaSub(sess, 'config')) its += item('config', '⚙️ Configuração');
  if (podeSofiaSub(sess, 'conversas')) its += item('conversas', '💬 Conversas');
  if (podeSofiaSub(sess, 'contatos')) its += item('contatos', '📇 Contatos');
  if (podeSofiaSub(sess, 'campanhas')) its += item('campanhas', '📣 Campanhas');
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px">${its}</div>`;
}

// Aba Sofia → Conversas: inbox das conversas da Sofia (ler e, na Parte 2, responder).
function paginaSofiaConversas(aviso, erro) {
  const tagsLista = contatos.tagsDistintas().map(t => t.tag);
  let sessaoHoras = 12; try { sessaoHoras = sofia.lerSessaoHoras(); } catch (_) {}
  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('conversas')}
    <div class="sec-t" data-nosec="1">💬 Conversas da SoFIA <span id="waTag" title="Situação do WhatsApp da SoFIA" style="display:inline-block;vertical-align:middle;margin:0 6px;border-radius:999px;padding:2px 10px;font-size:.7rem;font-weight:700;background:#eee;color:#7a7a7a">⚪ …</span><small style="font-weight:600;color:#5c5960">(atualiza sozinho — histórico das conversas neste número)</small></div>
    <style>
      .inbox-grid{display:grid;grid-template-columns:236px minmax(0,1fr);gap:14px;align-items:stretch}
      .inbox-grid>div{min-width:0}
      #convChat{display:flex;flex-direction:column;min-height:360px;max-height:calc(100vh - 190px)}
      @media(max-width:760px){ .inbox-grid{grid-template-columns:minmax(0,1fr);align-items:start} #convLista{max-height:260px;overflow:auto} #convChat{min-height:60vh;max-height:80vh;max-height:80dvh} }
    </style>
    <div class="inbox-grid">
      <div>
        <div style="margin-bottom:8px"><input type="search" id="convBusca" oninput="filtrarBusca(this.value)" placeholder="🔎 Buscar por nome, telefone ou palavra na conversa" style="width:100%;font-size:.85rem;padding:9px 12px;border:1px solid var(--linha);border-radius:9px"></div>
        <div style="margin-bottom:8px"><select id="convFiltroTag" onchange="filtrarTag(this.value)" style="width:100%;font-size:.85rem"><option value="">🏷️ Todas as tags</option><option value="__sem__">🏷️ Sem tag</option>${tagsLista.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
        <div id="convLista" style="min-height:120px"></div>
        <div id="convPag" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px"></div>
      </div>
      <div id="convChat" class="card" style="min-width:0">Selecione uma conversa à esquerda.</div>
    </div>
  </div>
  <div id="ctIntModal" class="ct-ov" onclick="if(event.target===this)fecharInteracoes()">
    <div class="ct-dlg" style="max-width:600px">
      <div class="ct-dh"><h2>Interações</h2><button type="button" class="ct-x" onclick="fecharInteracoes()">×</button></div>
      <div id="ctIntHero" class="quando" style="margin:0 0 10px"></div>
      <div id="ctIntBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <div id="ctResModal" class="ct-ov" style="z-index:60" onclick="if(event.target===this)fecharResumo()">
    <div class="ct-dlg" style="max-width:460px">
      <div class="ct-dh"><h2>Resumo do atendimento</h2><button type="button" class="ct-x" onclick="fecharResumo()">×</button></div>
      <div id="ctResData" class="quando" style="margin:0 0 8px"></div>
      <div id="ctResBody" style="font-size:var(--fs-body);line-height:1.55;white-space:pre-wrap"></div>
    </div>
  </div>
<script>
  var selecionada=null, pagina=0, POR_PAGINA=10, ultimoData={}, ultimoRender={chave:null,n:-1,humano:null}, ncSel=[], rascunhos={}, fotoPend={}, tagFiltro='', buscaTexto='', tagEdAberto=false, ncNome='', ncDirty=false, ncTodas=[];
  // Atalho vindo de Contatos: ?chat=<telefone> abre a conversa correspondente.
  var alvoChat=(new URLSearchParams(location.search).get('chat')||'').replace(/\\D/g,''), alvoAplicado=false;
  function mesmoTel(a,b){ a=String(a||'').replace(/\\D/g,''); b=String(b||'').replace(/\\D/g,''); if(!a||!b) return false; if(a===b) return true; var la=a.slice(-8), lb=b.slice(-8); return la.length===8 && la===lb; }
  // ── Interações (histórico de atendimentos) — mesmo do Contatos ─────────────
  var intSessoes=[];
  function fmtDataHora(ts){ try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+'h'; }catch(e){ return ''; } }
  function abrirInteracoes(tel){
    if(!tel) return;
    var c=ultimoData[tel]||{};
    document.getElementById('ctIntHero').textContent=((c.nome||'(sem nome)')+' · '+fmtTel(tel));
    document.getElementById('ctIntBody').innerHTML='<p class="quando">Carregando…</p>';
    document.getElementById('ctIntModal').style.display='flex';
    fetch('/sofia/contatos/interacoes?tel='+encodeURIComponent(tel),{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(j){ intSessoes=(j&&j.sessoes)||[]; renderInteracoes(); })
      .catch(function(){ document.getElementById('ctIntBody').innerHTML='<p class="quando">❌ Não consegui carregar agora.</p>'; });
  }
  function renderInteracoes(){
    var box=document.getElementById('ctIntBody');
    if(!intSessoes.length){ box.innerHTML='<p class="quando">Nenhuma interação registrada ainda. O histórico começa a contar a partir de agora — cada atendimento encerrado aparece aqui.</p>'; return; }
    var linhas=intSessoes.map(function(s,idx){
      var badge=s.status==='ativa'?'<span class="ct-badge ativa">Em andamento</span>':'<span class="ct-badge enc">Encerrado</span>';
      return '<tr><td>'+badge+'</td><td>'+fmtDataHora(s.inicioEm)+'</td><td style="color:var(--cinza)">'+(s.nMsgs||0)+' msg</td><td style="text-align:right"><button type="button" class="ct-ic" title="Ver resumo" onclick="verResumo('+idx+')">📄</button></td></tr>';
    }).join('');
    box.innerHTML='<div style="overflow-x:auto"><table class="ct-int-tab"><thead><tr><th>Status</th><th>Data</th><th>Trocas</th><th style="text-align:right">Resumo</th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      +'<p class="quando" style="margin:10px 0 0">Total de '+intSessoes.length+' interaç'+(intSessoes.length===1?'ão':'ões')+'.</p>';
  }
  function fecharInteracoes(){ document.getElementById('ctIntModal').style.display='none'; }
  function verResumo(idx){
    var s=intSessoes[idx]; if(!s) return;
    document.getElementById('ctResData').textContent=fmtDataHora(s.inicioEm);
    var body=document.getElementById('ctResBody');
    if(s.status==='ativa'){ body.innerHTML='<span class="quando">Este atendimento ainda está em andamento — o resumo é gerado quando a conversa encerra.</span>'; }
    else if(!s.resumoPronto){ body.innerHTML='<span class="quando">Resumo sendo gerado… abra de novo em instantes.</span>'; }
    else if(!s.resumo){ body.innerHTML='<span class="quando">Sem resumo para este atendimento (conversa muito curta ou sem conteúdo).</span>'; }
    else { body.textContent=s.resumo; }
    document.getElementById('ctResModal').style.display='flex';
  }
  function fecharResumo(){ document.getElementById('ctResModal').style.display='none'; }
  var TAGS_EXISTENTES = ${JSON.stringify(tagsLista)};
  var SESSAO_MS = ${Math.round(sessaoHoras * 3600 * 1000)};
  function encerrada(c){ return !!(c && (c.enc || (c.ultimaEm && (Date.now()-c.ultimaEm > SESSAO_MS)))); }
  function escH(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtHora(ts){ try{return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';} }
  function autorRot(a){ return a==='aluna'?'Aluna':(a==='humano'?'Você':'SoFIA'); }
  function fmtTel(k){ var d=String(k||'').replace(/\\D/g,''); if(/^55\\d{10,11}$/.test(d)){ var ddd=d.slice(2,4), r=d.slice(4); return '+55 ('+ddd+') '+(r.length===9?r.slice(0,5)+'-'+r.slice(5):r.slice(0,4)+'-'+r.slice(4)); } return k; }
  function renderChat(c,k){
    var chat=document.getElementById('convChat'); if(!chat) return;
    var msgs=c.msgs||[];
    var bolhas = msgs.map(function(m){
      var mine = (m.autor!=='aluna');
      var bg = m.autor==='aluna'?'#f1f3f4':(m.autor==='humano'?'#dff5e6':'#e6f6f7');
      var img = m.foto ? '<img src="/sofia/humano-foto?arq='+encodeURIComponent(m.foto)+'" alt="foto enviada" style="display:block;max-width:100%;max-height:220px;border-radius:9px;margin:'+(m.texto?'6px 0 0':'2px 0 0')+';cursor:pointer" onclick="window.open(this.src,\\'_blank\\')">' : '';
      var corpoMsg = (m.texto?'<div style="white-space:pre-wrap">'+escH(m.texto)+'</div>':'') + img;
      return '<div style="display:flex;justify-content:'+(mine?'flex-end':'flex-start')+';margin:4px 0"><div style="max-width:82%;background:'+bg+';padding:8px 12px;border-radius:12px;overflow-wrap:anywhere"><div style="font-size:.68rem;font-weight:700;color:#888">'+autorRot(m.autor)+' · '+fmtHora(m.em)+'</div>'+corpoMsg+'</div></div>';
    }).join('');
    var fim = encerrada(c) ? '<div style="text-align:center;margin:10px 0 2px"><span style="display:inline-block;background:#f3eaea;color:#a15a5a;border:1px solid #e6cfcf;border-radius:999px;padding:3px 12px;font-size:.72rem;font-weight:700">🔒 Sessão encerrada · a SoFIA recomeça do zero se a aluna voltar</span></div>' : '';
    var hum = !!c.humano;
    // Cabeçalho enxuto: nome + telefone à esquerda, botão de controle (compacto) à direita.
    var pill='<button type="button" onclick="toggleHumano()" class="'+(hum?'save':'reset')+'" style="padding:5px 12px;font-size:.78rem;white-space:nowrap">'+(hum?'🙋 devolver à SoFIA':'assumir')+'</button>';
    var btnInt='<button type="button" onclick="abrirInteracoes(selecionada)" class="reset" title="Interações" style="padding:5px 10px;font-size:.9rem;white-space:nowrap">📊</button>';
    var encM=!!c.enc; // encerrada MANUALMENTE (cadeado à mão)
    var btnEnc='<button type="button" onclick="encerrarConversa()" class="reset" title="'+(encM?'Conversa já encerrada':'Encerrar conversa agora (cadeado — a SoFIA recomeça do zero)')+'" style="padding:5px 10px;font-size:.9rem;white-space:nowrap'+(encM?';color:#a15a5a':'')+'"'+(encM?' disabled':'')+'>🔒</button>';
    var bloq=!!c.bloq;
    var btnBloq='<button type="button" onclick="bloquearConversa()" class="reset" title="'+(bloq?'Desbloquear contato':'Bloquear contato (a SoFIA ignora)')+'" style="padding:5px 10px;font-size:.9rem;white-space:nowrap'+(bloq?';color:#1c8f52':'')+'">'+(bloq?'✅':'🚫')+'</button>';
    var selo=bloq?'<span title="Contato bloqueado" style="background:#fdeaea;color:#c0392b;border:1px solid #f0c8c4;border-radius:999px;padding:1px 8px;font-size:.66rem;font-weight:700;margin-left:6px">🚫 bloqueado</span>':'';
    var header='<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">'
      +'<div style="flex:1;min-width:0"><div style="font-weight:800">'+escH(c.nome||'(sem nome)')+selo+'</div><div class="quando" style="margin:0">'+escH(fmtTel(k))+'</div></div>'
      +'<div style="display:flex;gap:6px;align-items:center;flex:none">'+btnInt+btnEnc+btnBloq+pill+'</div></div>';
    // Linha de tags recolhível — o editor completo só aparece ao clicar em "editar".
    var mini=function(t){return '<span style="display:inline-block;background:#eef7f7;color:#0e8e91;border-radius:999px;padding:1px 8px;font-size:.7rem;margin:0 4px 0 0">'+escH(t)+'</span>';};
    var resumo = ncSel.length ? ncSel.map(mini).join('') : '<span class="quando" style="margin:0">sem tags</span>';
    var tagLinha='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:.82rem">'
      +'🏷️ '+(tagEdAberto?'':resumo)
      +'<a href="javascript:void(0)" onclick="toggleTagEd()" class="quando" style="margin:0;text-decoration:underline">'+(tagEdAberto?'fechar':'editar')+'</a>'
      +((!tagEdAberto && ncDirty)?'<span style="color:#9a6b00;font-weight:700">⚠️ não salvo</span>':'')+'</div>';
    var editor = tagEdAberto ? ('<div style="margin:0 0 12px;padding:10px 12px;background:#fafafa;border:1px solid #eee;border-radius:10px">'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      +'<span class="quando" style="margin:0">Nome</span>'
      +'<input id="ncNome" value="'+escH(ncNome)+'" placeholder="nome do contato" oninput="ncNome=this.value;ncMarcaSujo()" style="flex:1;min-width:150px;font-size:.85rem">'
      +'</div>'
      +'<div class="quando" style="margin:0 0 4px">Tags <small>(marque as que se aplicam)</small></div>'
      +'<div id="ncTags" style="max-height:190px;overflow:auto;border:1px solid #eee;border-radius:8px;padding:6px 10px;background:#fff;margin-bottom:8px"></div>'
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      +'<input id="ncNovaTag" placeholder="criar nova tag" style="flex:1;min-width:150px;font-size:.85rem" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();ncAddNovaTag();}">'
      +'<button type="button" class="reset" style="padding:5px 12px" onclick="ncAddNovaTag()">+ criar</button>'
      +'</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +'<button type="button" id="ncSalvar" class="save" style="padding:5px 12px" onclick="salvarContato(\\''+k+'\\')">💾 '+(c.salvo?'Salvar tags':'Salvar contato')+'</button>'
      +'<span id="ncMsg" class="quando" style="margin:0"></span>'
      +'</div></div>') : '';
    var composer='<div style="display:flex;gap:8px;margin-top:10px;align-items:flex-end">'
      +'<input type="file" id="msgFoto" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="msgFotoSel()">'
      +'<button type="button" id="msgClip" title="Anexar foto" onclick="msgAbreFoto()" '+(hum?'':'disabled')+' style="padding:9px 12px;font-size:1.05rem;line-height:1;background:#fff;border:1px solid var(--linha,#ddd);border-radius:8px;cursor:pointer'+(hum?'':';opacity:.4;cursor:not-allowed')+'">📎</button>'
      +'<textarea id="msgTxt" rows="2" '+(hum?'':'disabled')+' placeholder="'+(hum?'Escreva uma mensagem…  (Enter envia)':'🔒 Clique em “assumir” para responder')+'" oninput="if(selecionada)rascunhos[selecionada]=this.value" onkeydown="msgKey(event)" style="flex:1;resize:vertical;min-height:44px;font-size:.9rem'+(hum?'':';background:#f5f5f5;color:#aaa;cursor:not-allowed')+'"></textarea>'
      +'<button type="button" class="save" onclick="enviarMsg()" '+(hum?'':'disabled')+' style="padding:9px 16px;white-space:nowrap'+(hum?'':';opacity:.4;cursor:not-allowed')+'">Enviar ➤</button>'
      +'</div>'
      +'<div id="msgFotoPrev" style="display:none;margin-top:6px;align-items:center;gap:8px">'
      +'<img id="msgFotoImg" alt="prévia" style="max-width:64px;max-height:64px;border-radius:8px;border:1px solid var(--linha,#ddd);vertical-align:middle">'
      +'<span class="quando" style="margin:0">foto anexada</span> '
      +'<a href="javascript:void(0)" onclick="msgFotoLimpa()" class="quando" style="margin:0;text-decoration:underline">remover</a></div>'
      +'<div id="msgStatus" class="quando" style="margin-top:4px;min-height:14px;font-size:.75rem"></div>';
    chat.innerHTML = header+tagLinha+editor+'<div id="bolhas" style="flex:1;min-height:120px;overflow:auto;padding-right:4px">'+bolhas+fim+'</div>'+composer;
    if(tagEdAberto){ ncRenderTags(); ncAtualizaStatus(); }
    var ta=document.getElementById('msgTxt'); if(ta) ta.value=rascunhos[k]||'';
    msgFotoMostra(k); // reexibe a prévia se havia foto anexada nessa conversa
    var b=document.getElementById('bolhas'); if(b) b.scrollTop=b.scrollHeight;
  }
  function toggleTagEd(){ tagEdAberto=!tagEdAberto; if(selecionada){ ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[selecionada],selecionada); } }
  function toggleHumano(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; var novo=!c.humano;
    fetch('/sofia/humano',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k])ultimoData[k].humano=novo; ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[k],k); } });
  }
  function bloquearConversa(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; var novo=!c.bloq;
    if(novo && !confirm('Bloquear este contato? A SoFIA vai IGNORAR por completo as mensagens dele (não responde, não registra).')) return;
    fetch('/sofia/contatos/bloquear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:k,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k])ultimoData[k].bloq=novo; ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[k],k); } else { alert(j.erro||'Não consegui atualizar o bloqueio.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function encerrarConversa(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; if(c.enc) return;
    if(!confirm('Encerrar esta conversa agora?\\n\\nAparece o cadeado 🔒, a SoFIA recomeça do zero se a aluna voltar a escrever e o follow-up deixa de incomodar este contato.')) return;
    fetch('/sofia/conversas/encerrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k])ultimoData[k].enc=true; ultimoRender={chave:null,n:-1,humano:null}; renderInbox(ultimoData); } else { alert(j.erro||'Não consegui encerrar a conversa.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function msgKey(ev){ if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); enviarMsg(); } }
  function msgAbreFoto(){ var inp=document.getElementById('msgFoto'); if(inp) inp.click(); }
  function msgFotoSel(){
    var k=selecionada; if(!k) return;
    var inp=document.getElementById('msgFoto'); var f=inp&&inp.files&&inp.files[0]; if(!f) return;
    if(f.size>10*1024*1024){ var st=document.getElementById('msgStatus'); if(st)st.textContent='❌ imagem muito grande (máx. 10MB).'; inp.value=''; return; }
    var rd=new FileReader(); rd.onload=function(){ fotoPend[k]=rd.result; msgFotoMostra(k); }; rd.readAsDataURL(f);
  }
  function msgFotoMostra(k){
    var box=document.getElementById('msgFotoPrev'); if(!box) return;
    if(fotoPend[k]){ var img=document.getElementById('msgFotoImg'); if(img)img.src=fotoPend[k]; box.style.display='flex'; }
    else { box.style.display='none'; }
  }
  function msgFotoLimpa(){ var k=selecionada; if(k) delete fotoPend[k]; var inp=document.getElementById('msgFoto'); if(inp)inp.value=''; msgFotoMostra(k); }
  function enviarMsg(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; var jid=c.jid||'';
    var ta=document.getElementById('msgTxt'); var txt=(ta&&ta.value||'').trim();
    var foto=fotoPend[k]||'';
    var st=document.getElementById('msgStatus');
    if(!c.humano){ if(st)st.textContent='Ative o controle humano para responder.'; return; }
    if(!txt && !foto){ if(st)st.textContent=''; return; }
    if(st)st.textContent='Enviando…';
    fetch('/sofia/responder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,jid:jid,texto:txt,fotoBase64:foto})})
      .then(function(r){return r.json();}).then(function(j){
        if(j.ok){ if(ta)ta.value=''; rascunhos[k]=''; delete fotoPend[k]; var inp=document.getElementById('msgFoto'); if(inp)inp.value=''; msgFotoMostra(k); if(st)st.textContent='✓ enviada';
          setTimeout(atualizaInbox,800); setTimeout(atualizaInbox,2000); setTimeout(atualizaInbox,3600); }
        else if(st){ st.textContent='❌ '+(j.erro||'não consegui enviar'); }
      }).catch(function(){ if(st)st.textContent='❌ erro de rede'; });
  }
  function ncRenderTags(){
    var el=document.getElementById('ncTags'); if(!el) return;
    ncTodas = TAGS_EXISTENTES.slice();
    ncSel.forEach(function(t){ if(ncTodas.indexOf(t)<0) ncTodas.push(t); });
    ncTodas.sort(function(a,b){ return a.localeCompare(b,'pt-BR'); });
    el.innerHTML = ncTodas.map(function(t,i){ var on=ncSel.indexOf(t)>=0;
      return '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.85rem;cursor:pointer"><input type="checkbox" '+(on?'checked':'')+' onchange="ncToggleTagIdx('+i+',this.checked)" style="width:16px;height:16px;margin:0;flex:none"> '+escH(t)+'</label>';
    }).join('') || '<span class="quando" style="margin:0">Nenhuma tag ainda — crie a primeira em "criar nova tag".</span>';
  }
  function ncToggleTagIdx(i,checked){ var t=ncTodas[i]; if(!t) return; var idx=ncSel.indexOf(t); if(checked){ if(idx<0) ncSel.push(t); } else if(idx>=0){ ncSel.splice(idx,1); } ncMarcaSujo(); }
  function ncAddNovaTag(){ var inp=document.getElementById('ncNovaTag'); if(!inp) return; var t=(inp.value||'').trim(); inp.value=''; if(!t) return; if(ncSel.indexOf(t)<0) ncSel.push(t); ncRenderTags(); ncMarcaSujo(); }
  function ncMarcaSujo(){ ncDirty=true; ncAtualizaStatus(); }
  function ncAtualizaStatus(){
    var msg=document.getElementById('ncMsg'), btn=document.getElementById('ncSalvar'); if(!msg) return;
    if(ncDirty){ msg.innerHTML='<span style="color:#9a6b00;font-weight:700">⚠️ não salvo — clique em Salvar</span>'; if(btn)btn.style.boxShadow='0 0 0 3px rgba(255,91,87,.30)'; }
    else { var c=ultimoData[selecionada]||{}; msg.innerHTML=c.salvo?'<span style="color:#1c8f52">✓ salvo</span>':''; if(btn)btn.style.boxShadow='none'; }
  }
  function salvarContato(k){
    ncAddNovaTag(); // comita qualquer "nova tag" digitada e não adicionada
    var msg=document.getElementById('ncMsg'); if(msg)msg.textContent='Salvando…';
    var nome=(ncNome||'').trim();
    fetch('/sofia/contatos/salvar-novo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:k,nome:nome,tags:ncSel})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k]){ultimoData[k].salvo=true; ultimoData[k].tagsContato=ncSel.slice(); if(nome)ultimoData[k].nome=nome;} ncDirty=false; ncAtualizaStatus(); } else if(msg){ msg.textContent='❌ '+(j.erro||'falha'); } })
      .catch(function(){ if(msg)msg.textContent='❌ erro'; });
  }
  function filtrarTag(t){ tagFiltro=t||''; pagina=0; renderInbox(ultimoData); }
  function filtrarBusca(v){ buscaTexto=String(v||'').trim().toLowerCase(); pagina=0; renderInbox(ultimoData); }
  // Casa a busca com nome, telefone (só dígitos) OU o texto de qualquer mensagem.
  function casaBusca(k, c){
    if(!buscaTexto) return true;
    var q=buscaTexto, qd=q.replace(/\\D/g,'');
    if((c.nome||'').toLowerCase().indexOf(q)>=0) return true;
    if(qd && String(k||'').replace(/\\D/g,'').indexOf(qd)>=0) return true;
    var ms=c.msgs||[];
    for(var i=0;i<ms.length;i++){ if((ms[i].texto||'').toLowerCase().indexOf(q)>=0) return true; }
    return false;
  }
  function renderInbox(data){
    ultimoData = data||{};
    // Atalho de Contatos: assim que os dados chegam, seleciona a conversa alvo (uma vez).
    if(alvoChat && !alvoAplicado){
      alvoAplicado=true;
      var alvoK=Object.keys(ultimoData).filter(function(k){return mesmoTel(k,alvoChat);})[0];
      if(alvoK){ selecionada=alvoK; ncSel=(ultimoData[alvoK].tagsContato||[]).slice(); ncNome=ultimoData[alvoK].nome||''; ncDirty=false; ultimoRender={chave:null,n:-1,humano:null}; }
    }
    var chaves = Object.keys(ultimoData).sort(function(a,b){return (ultimoData[b].ultimaEm||0)-(ultimoData[a].ultimaEm||0);});
    if(tagFiltro==='__sem__') chaves = chaves.filter(function(k){ return !((ultimoData[k].tagsContato||[]).length); });
    else if(tagFiltro) chaves = chaves.filter(function(k){ return (ultimoData[k].tagsContato||[]).indexOf(tagFiltro)>=0; });
    if(buscaTexto) chaves = chaves.filter(function(k){ return casaBusca(k, ultimoData[k]||{}); });
    var total=chaves.length, paginas=Math.max(1,Math.ceil(total/POR_PAGINA));
    if(pagina>=paginas) pagina=paginas-1; if(pagina<0) pagina=0;
    var lista=document.getElementById('convLista'), pag=document.getElementById('convPag');
    if(!total){ if(lista)lista.innerHTML='<p class="quando" style="padding:12px">'+(buscaTexto?'Nada encontrado para “'+escH(buscaTexto)+'” (nome, telefone ou palavra na conversa).':(tagFiltro==='__sem__'?'Nenhuma conversa sem tag.':(tagFiltro?'Nenhuma conversa com a tag “'+escH(tagFiltro)+'”.':'Nenhuma conversa ainda. Assim que a SoFIA receber mensagens, elas aparecem aqui.')))+'</p>'; if(pag)pag.innerHTML=''; return; }
    var ini=pagina*POR_PAGINA, fatia=chaves.slice(ini,ini+POR_PAGINA);
    lista.innerHTML = fatia.map(function(k){
      var c=ultimoData[k]; var ult=c.msgs&&c.msgs.length?c.msgs[c.msgs.length-1]:null;
      var on=(k===selecionada);
      var pendente = !!(ult && ult.autor==='aluna'); // última foi da aluna → esperando resposta
      var dot = pendente ? '<span title="aguardando resposta" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#11abae;flex:none"></span>' : '';
      var tgs=(c.tagsContato||[]).map(function(t){return '<span style="display:inline-block;background:#eef7f7;color:#0e8e91;border-radius:999px;padding:0 7px;font-size:.64rem;margin-left:5px">'+escH(t)+'</span>';}).join('');
      var enc=encerrada(c)?'<span style="display:inline-block;background:#f3eaea;color:#a15a5a;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">🔒 encerrada</span>':'';
      var hb=c.humano?'<span style="display:inline-block;background:#e6f6ec;color:#1f8f52;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">🙋 você</span>':'';
      var fu=c.fuEspera?'<span title="Follow-up pronto, aguardando o horário permitido" style="display:inline-block;background:#fdf2e0;color:#b8770a;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">⏳ follow-up '+escH(c.fuEspera)+'</span>':'';
      var nome='<div style="display:flex;align-items:center;gap:6px"><span style="font-weight:'+(pendente?'800':'700')+';font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">'+escH(c.nome||fmtTel(k))+'</span>'+dot+'</div>';
      var meta='<div class="quando" style="font-size:.72rem;margin:0;display:flex;align-items:center;flex-wrap:wrap;row-gap:3px">'+fmtHora(c.ultimaEm)+tgs+hb+enc+fu+'</div>';
      return '<div onclick="abrir(\\''+k+'\\')" style="cursor:pointer;padding:9px 12px;border-radius:10px;margin-bottom:6px;border:1px solid '+(on?'#11abae':'#eee')+';background:'+(on?'#e6f6f7':(encerrada(c)?'#fbf7f7':'#fff'))+'">'+nome+'<div class="quando" style="margin:1px 0 3px">'+escH(fmtTel(k))+'</div>'+meta+'</div>';
    }).join('');
    if(pag){
      if(paginas>1){ pag.innerHTML='<button type="button" class="reset" onclick="mudarPag(-1)" '+(pagina===0?'disabled':'')+' style="padding:6px 12px">‹ Anterior</button><span class="quando" style="text-align:center">Página '+(pagina+1)+' de '+paginas+'<br>'+total+' conversas</span><button type="button" class="reset" onclick="mudarPag(1)" '+(pagina>=paginas-1?'disabled':'')+' style="padding:6px 12px">Próxima ›</button>'; }
      else { pag.innerHTML='<span class="quando">'+total+' conversa'+(total>1?'s':'')+'</span>'; }
    }
    if(selecionada && ultimoData[selecionada]){
      var cc=ultimoData[selecionada], nn=(cc.msgs?cc.msgs.length:0);
      // Só re-renderiza o chat quando muda de conversa, chega mensagem nova ou muda
      // o controle humano — assim o refresh de 4s não apaga o que você está digitando.
      if(ultimoRender.chave!==selecionada || ultimoRender.n!==nn || ultimoRender.humano!==!!cc.humano){ renderChat(cc, selecionada); ultimoRender={chave:selecionada,n:nn,humano:!!cc.humano}; }
    }
  }
  function mudarPag(d){ pagina+=d; renderInbox(ultimoData); }
  function abrir(k){ selecionada=k; ncSel=(ultimoData[k]&&ultimoData[k].tagsContato?ultimoData[k].tagsContato.slice():[]); ncNome=(ultimoData[k]&&ultimoData[k].nome)||''; ncDirty=false; tagEdAberto=false; ultimoRender={chave:null,n:-1,humano:null}; renderInbox(ultimoData); }
  function atualizaWa(e){
    var b=document.getElementById('waTag'); if(!b) return;
    var m={conectado:['🟢','online','#1c8f52','#e6f6ec'],desconectado:['🔴','off-line','#c0392b','#fdeaea'],qr:['🟠','reconectar','#b8770a','#fdf2e0'],iniciando:['🟡','conectando','#b8770a','#fdf2e0']};
    var s=m[e]||['⚪','—','#7a7a7a','#eee'];
    b.textContent=s[0]+' '+s[1]; b.style.color=s[2]; b.style.background=s[3];
  }
  function atualizaInbox(){ fetch('/sofia/conversas',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ j=j||{}; atualizaWa(j.wa); renderInbox(j.conv||{}); }).catch(function(){}); }
  atualizaInbox(); setInterval(atualizaInbox, 4000);
</script>`;
  return chrome({ tab: 'SoFIA', h1: '🤖 SoFIA', p: 'Conversas da SoFIA — leia o histórico de cada atendimento.' }, 'sofia', corpo);
}

// Aba Sofia → Contatos: CRM leve (importar CSV, etiquetar, filtrar por tag).
function paginaSofiaContatos(aviso, erro, params) {
  params = params || {};
  const q = params.q || '';
  const tagSel = params.tag || '';
  const pagina = parseInt(params.pagina, 10) || 0;
  const r = contatos.listar({ q, tag: tagSel, pagina, porPagina: 25 });
  const tags = contatos.tagsDistintas();
  const total = contatos.totalContatos();

  const fmtTelP = (t) => { const d = String(t || '').replace(/\D/g, ''); if (/^55\d{10,11}$/.test(d)) { const ddd = d.slice(2, 4), x = d.slice(4); return '+55 (' + ddd + ') ' + (x.length === 9 ? x.slice(0, 5) + '-' + x.slice(5) : x.slice(0, 4) + '-' + x.slice(4)); } return t || ''; };
  const qs = (pg) => { const p = new URLSearchParams(); p.set('view', 'contatos'); if (q) p.set('q', q); if (tagSel) p.set('tag', tagSel); p.set('pagina', pg); return '/sofia?' + p.toString(); };
  const hidden = `<input type="hidden" name="q" value="${esc(q)}"><input type="hidden" name="tag" value="${esc(tagSel)}"><input type="hidden" name="pagina" value="${pagina}">`;

  // Cores estáveis por texto (mesma tag/nome → mesma cor, no servidor e no navegador).
  const _hash = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const PAL_TAG = [['#e6f6f7', '#0e8e91', '#b8e6e7'], ['#fdecea', '#c0392b', '#f5c6cb'], ['#eef9f2', '#1c8f52', '#cbe8d5'], ['#fff4e5', '#b26a00', '#ffe0b2'], ['#eef1fb', '#3b4fb0', '#d3dcf7'], ['#f3e9fb', '#7a3fb0', '#e2cff5'], ['#fce8f1', '#b0367a', '#f7cfe0']];
  const PAL_AV = ['#f39c12', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71', '#e74c3c', '#5567c9'];
  const corTag = (t) => PAL_TAG[_hash(t) % PAL_TAG.length];
  const corAv = (s) => PAL_AV[_hash(s) % PAL_AV.length];
  const iniciais = (nome, tel) => {
    const nm = String(nome || '').trim();
    if (nm) { const p = nm.split(/\s+/); return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
    return '#';
  };
  const chipTag = (t) => { const [bg, fg, bd] = corTag(t); return `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:6px;padding:2px 8px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;line-height:1.35">${esc(t)}</span>`; };
  const podeConversa = podeSofiaSub(_navSess || { admin: true, telas: [] }, 'conversas');

  const linhas = r.itens.map(c => {
    const nm = c.nome || '';
    const jc = esc(JSON.stringify(c.tel));
    const btnConversa = podeConversa ? `<button type="button" class="ct-ic" title="Ir para a conversa" onclick='irConversa(${jc})'>💬</button>` : '';
    const bloq = sofia.estaBloqueado(c.tel);
    return `<tr class="ct-row" data-nome="${esc((nm || '').toLowerCase())}" data-tel="${esc(c.tel)}" data-bloq="${bloq ? '1' : '0'}" onclick='abrirModal(${jc})'>
      <td>
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <span class="ct-av" style="background:${corAv(nm || c.tel)}">${esc(iniciais(nm, c.tel))}</span>
          <span class="ct-nm">${esc(nm || '(sem nome)')}</span>
          ${bloq ? '<span title="Contato bloqueado" style="flex:none;color:#c0392b;font-size:.9rem">🚫</span>' : ''}
        </div>
      </td>
      <td class="ct-tel">${esc(fmtTelP(c.tel))}</td>
      <td>${(c.tags || []).map(chipTag).join('') || '<span class="quando" style="font-size:.74rem">—</span>'}</td>
      <td class="ct-acts" onclick="event.stopPropagation()">
        <button type="button" class="ct-ic" title="Interações" onclick='abrirInteracoes(${jc})'>📊</button>
        ${btnConversa}
        <button type="button" class="ct-ic" title="Editar" onclick='abrirModal(${jc})'>✏️</button>
        <button type="button" class="ct-ic ct-del" title="Excluir" onclick='excluirContato(${jc})'>🗑️</button>
      </td>
    </tr>`;
  }).join('');

  const gerenciarTags = `<details class="card" style="padding:10px 15px;margin:0 0 12px"${tags.length ? '' : ' open'}><summary style="cursor:pointer;font-weight:700">🏷️ Gerenciar tags <small style="font-weight:400;color:#5c5960">(criar, renomear, excluir ou automatizar)</small></summary>
    <div class="card">
      <div style="margin-bottom:12px"><button type="button" class="save" onclick="criarTagNova()" style="padding:8px 16px">＋ Criar tag</button></div>
      ${tags.length ? tags.map((t, i) => { const cfg = contatos.tagConfig(t.tag); return `<div class="tagrow">
      <form method="POST" action="/sofia/contatos/tag">
        <input type="hidden" name="de" value="${esc(t.tag)}">${hidden}
        <input type="text" name="para" value="${esc(t.tag)}">
        <span class="tagn">${t.n}</span>
        <button type="submit" class="tagbtn ren" name="acao" value="renomear">Renomear</button>
        <button type="submit" class="tagbtn rm" name="acao" value="excluir" onclick="return confirm('Excluir a tag em TODOS os contatos?')">Excluir</button>
      </form>
      <button type="button" class="tagbtn aut${(cfg.gatilho || cfg.remove.length) ? ' on' : ''}" onclick="abrirTagCfg(${i})" title="Automação desta tag">⚙️ Automação${(cfg.gatilho || cfg.remove.length) ? ' ⚡' : ''}</button>
    </div>`; }).join('') : '<p class="quando" style="margin:0">Nenhuma tag ainda. Crie uma acima ou etiquete um contato.</p>'}
    </div></details>`;

  const opcoes = ['<option value="">Todas as tags</option>', `<option value="__sem__"${tagSel === '__sem__' ? ' selected' : ''}>Sem tag</option>`]
    .concat(tags.map(t => `<option value="${esc(t.tag)}"${t.tag === tagSel ? ' selected' : ''}>${esc(t.tag)} (${t.n})</option>`)).join('');

  const pag = r.paginas > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <a class="reset" style="padding:6px 12px;${pagina <= 0 ? 'pointer-events:none;opacity:.4' : ''}" href="${qs(Math.max(0, pagina - 1))}">‹ Anterior</a>
      <span class="quando">Página ${r.pagina + 1} de ${r.paginas} · ${r.total} contato(s)</span>
      <a class="reset" style="padding:6px 12px;${pagina >= r.paginas - 1 ? 'pointer-events:none;opacity:.4' : ''}" href="${qs(Math.min(r.paginas - 1, pagina + 1))}">Próxima ›</a>
    </div>` : '';

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('contatos')}
    <div class="sec-t">📇 Contatos <small style="font-weight:600;color:#5c5960">(${total} no total — importe por CSV, etiquete e filtre por tag)</small></div>

    <details class="card" style="padding:10px 15px">
      <summary style="cursor:pointer;font-weight:700">⬆️ Importar CSV <small style="font-weight:400;color:#5c5960">(colunas: Nome, Telefone, Instruções personalizadas, Tags)</small></summary>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <input type="file" id="csvFile" accept=".csv,text/csv">
        <button type="button" class="save" onclick="importarCsv()" style="padding:8px 14px">Importar arquivo</button>
        <span id="impMsg" class="quando"></span>
      </div>
      <p class="quando" style="margin:8px 0 0">📄 <a href="/sofia/contatos/modelo.csv" download style="color:var(--teal-esc);font-weight:700">Baixar modelo de CSV</a> — preencha por cima e reimporte. Várias tags no mesmo contato: separe por <code>;</code>.</p>
      <p class="quando" style="margin:4px 0 0">A importação <b>mescla</b> (não apaga): contatos existentes ganham as tags novas; telefones repetidos não duplicam.</p>
    </details>

    <details class="card" style="padding:10px 15px">
      <summary style="cursor:pointer;font-weight:700">⬇️ Exportar CSV <small style="font-weight:400;color:#5c5960">(baixar toda a base)</small></summary>
      <div style="margin-top:10px">
        <a href="/sofia/contatos/exportar" download class="save" style="display:inline-block;padding:8px 16px;text-decoration:none">📥 Baixar contatos (${total})</a>
      </div>
      <p class="quando" style="margin:8px 0 0">Gera um <b>CSV</b> com <b>Nome, Telefone, Instruções personalizadas e Tags</b> de todos os contatos — abre no Excel/Google Planilhas e serve para <b>migrar de plataforma</b> ou guardar backup. O próprio arquivo pode ser reimportado aqui.</p>
    </details>

    <form method="GET" action="/sofia" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="hidden" name="view" value="contatos">
      <input type="text" name="q" value="${esc(q)}" placeholder="Buscar por nome ou telefone" style="flex:1;min-width:180px">
      <select id="ctTagSel" name="tag" style="min-width:200px" onchange="this.form.submit()">${opcoes}</select>
      <button type="submit" class="save" style="padding:8px 14px">Filtrar</button>
      ${(q || tagSel) ? `<a href="/sofia?view=contatos" class="reset" style="padding:8px 14px">Limpar</a>` : ''}
      <button type="button" id="ctBloqFil" class="reset" onclick="filtrarBloqueados()" style="padding:8px 14px" title="Mostrar só os contatos bloqueados">🚫 Bloqueados</button>
    </form>

    ${gerenciarTags}

    ${r.itens.length ? `<div class="ct-wrap">
      <table class="ct-tab">
        <colgroup><col class="c-nome"><col class="c-tel"><col class="c-tags"><col class="c-act"></colgroup>
        <thead><tr>
          <th><button type="button" class="ct-sort" title="Ordenar por nome" onclick="ordenarContatos()">Nome <span id="ctSortArr" style="opacity:.4">↕</span></button></th>
          <th>Telefone</th>
          <th>Tags <button type="button" class="ct-fil" title="Filtrar por tag" onclick="abrirFiltroTag()">▾</button></th>
          <th style="text-align:right">Ações</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>` : '<div class="card"><p class="quando">Nenhum contato encontrado. Importe um CSV acima ou ajuste o filtro.</p></div>'}
    ${pag}
  </div>

  <div id="ctIntModal" class="ct-ov" onclick="if(event.target===this)fecharInteracoes()">
    <div class="ct-dlg" style="max-width:600px">
      <div class="ct-dh"><h2>Interações</h2><button type="button" class="ct-x" onclick="fecharInteracoes()">×</button></div>
      <div id="ctIntHero" class="quando" style="margin:0 0 10px"></div>
      <div id="ctIntBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <div id="ctResModal" class="ct-ov" style="z-index:60" onclick="if(event.target===this)fecharResumo()">
    <div class="ct-dlg" style="max-width:460px">
      <div class="ct-dh"><h2>Resumo do atendimento</h2><button type="button" class="ct-x" onclick="fecharResumo()">×</button></div>
      <div id="ctResData" class="quando" style="margin:0 0 8px"></div>
      <div id="ctResBody" style="font-size:var(--fs-body);line-height:1.55;white-space:pre-wrap"></div>
    </div>
  </div>

  <div id="tgModal" class="ct-ov" onclick="if(event.target===this)fecharTagCfg()">
    <div class="ct-dlg" style="max-width:520px">
      <div class="ct-dh"><h2>Automação da tag</h2><button type="button" class="ct-x" onclick="fecharTagCfg()">×</button></div>
      <p class="quando" style="margin:0 0 14px">Tag: <b id="tgNome" style="color:var(--teal-esc)"></b></p>
      <label>Aplicar esta tag automaticamente quando…</label>
      <select id="tgGatilho" onchange="tgSync()">
        <option value="">— não automatizar (só uso manual) —</option>
        <option value="novo">🆕 a aluna mandar a 1ª mensagem (lead novo)</option>
        <option value="palavra">🔑 a aluna escrever uma palavra-chave</option>
        <option value="agendou">📅 a SoFIA agendar uma aula experimental</option>
        <option value="humano">🙋 você assumir a conversa (controle humano)</option>
        <option value="encerrou">🔒 a conversa encerrar sem agendamento</option>
        <option value="campanha">💬 a aluna responder a uma campanha</option>
      </select>
      <div id="tgPalBox" style="margin-top:14px;display:none">
        <label>Palavras-chave <span class="sub" style="font-weight:400;color:var(--cinza)">— separadas por vírgula (ex.: cancelar, valor, reclamação, endereço)</span></label>
        <input type="text" id="tgPalavras" placeholder="cancelar, valor, endereço">
        <p class="quando" style="margin:6px 0 0">Dispara quando a mensagem da aluna <b>contém</b> qualquer uma delas (não diferencia maiúsculas/acentos simples).</p>
      </div>
      <div id="tgWppBox" style="margin-top:16px;display:none">
        <label>Avisar no WhatsApp <span class="sub" style="font-weight:400;color:var(--cinza)">— número que recebe o recado (nome + telefone)</span></label>
        <input type="tel" id="tgWpp" placeholder="(62) 99999-9999" inputmode="tel">
        <p class="quando" style="margin:6px 0 0">Deixe em branco para só etiquetar, sem avisar ninguém.</p>
      </div>
      <div style="margin-top:16px">
        <label>Ao aplicar esta tag, remover <span class="sub" style="font-weight:400;color:var(--cinza)">— transição de funil (ex.: entrar em "Agendou" tira "Contato inicial")</span></label>
        <div id="tgRemove" class="ct-tglist" style="max-height:150px;overflow:auto"></div>
      </div>
      <div class="ct-foot">
        <button type="button" class="reset" onclick="fecharTagCfg()" style="padding:9px 16px">Cancelar</button>
        <button type="button" class="save" id="tgSalvar" onclick="salvarTagCfg()" style="padding:9px 18px">Salvar</button>
      </div>
    </div>
  </div>

  <div id="ctModal" class="ct-ov" onclick="if(event.target===this)fecharModal()">
    <div class="ct-dlg">
      <div class="ct-dh"><h2>Editar contato</h2><button type="button" class="ct-x" onclick="fecharModal()">×</button></div>
      <div class="ct-hero"><span id="ctAv" class="ct-av ct-av-lg"></span><div id="ctHnome" class="ct-hnome"></div><div id="ctHtel" class="ct-htel"></div><div id="ctBloqTag" style="display:none;margin-top:6px"><span style="background:#fdeaea;color:#c0392b;border:1px solid #f0c8c4;border-radius:999px;padding:2px 12px;font-size:.74rem;font-weight:700">🚫 Contato bloqueado</span></div></div>
      <label>Nome</label>
      <input type="text" id="ctNome" placeholder="Nome do contato">
      <label style="margin-top:12px">Tags</label>
      <div id="ctTags" class="ct-tglist"></div>
      <div class="ct-nova"><input type="text" id="ctNovaTag" placeholder="Nova tag" onkeydown="if(event.key==='Enter'){event.preventDefault();addNovaTag();}"><button type="button" class="reset" onclick="addNovaTag()" style="padding:7px 12px">＋ Adicionar</button></div>
      <div class="ct-foot">
        ${podeConversa ? `<button type="button" class="reset" id="ctConversa" onclick="irConversaModal()" style="padding:9px 16px;margin-right:auto">💬 Ver conversa</button>` : ''}
        <button type="button" class="reset" id="ctBloq" onclick="alternarBloqueio()" style="padding:9px 16px${podeConversa ? '' : ';margin-right:auto'}">🚫 Bloquear</button>
        <button type="button" class="reset" onclick="fecharModal()" style="padding:9px 16px">Cancelar</button>
        <button type="button" class="save" id="ctSalvar" onclick="salvarContato()" style="padding:9px 18px">Salvar</button>
      </div>
    </div>
  </div>
<script>
  var CONTATOS = ${JSON.stringify(r.itens.map(c => ({ tel: c.tel, telFmt: fmtTelP(c.tel), nome: c.nome || '', tags: c.tags || [], ini: iniciais(c.nome, c.tel), cor: corAv(c.nome || c.tel), bloq: sofia.estaBloqueado(c.tel) })))};
  var TAGS_CFG = ${JSON.stringify(tags.map(t => { const c = contatos.tagConfig(t.tag); return { tag: t.tag, gatilho: c.gatilho, palavras: c.palavras, wpp: c.avisarWpp, remove: c.remove }; }))};
  var TODAS_TAGS_LISTA = ${JSON.stringify(tags.map(t => t.tag))};
  var tgRemove = [];
  var tgSel=null;
  function abrirTagCfg(i){
    var c=TAGS_CFG[i]; if(!c) return; tgSel=c;
    document.getElementById('tgNome').textContent=c.tag;
    document.getElementById('tgGatilho').value=c.gatilho||'';
    document.getElementById('tgPalavras').value=(c.palavras||[]).join(', ');
    document.getElementById('tgWpp').value=c.wpp||'';
    tgRemove=(c.remove||[]).slice();
    tgRenderRemove();
    tgSync();
    document.getElementById('tgModal').style.display='flex';
  }
  function tgRenderRemove(){
    var box=document.getElementById('tgRemove');
    var outras=TODAS_TAGS_LISTA.filter(function(t){return !tgSel||t!==tgSel.tag;});
    if(!outras.length){ box.innerHTML='<span class="quando">Nenhuma outra tag ainda.</span>'; return; }
    box.innerHTML=outras.map(function(t){
      var on=tgRemove.indexOf(t)>=0;
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" style="'+(on?'background:#fdecea;color:#c0392b;border-color:#f5c6cb':'background:#fff;color:#5c5960;border-color:#e8e8ea')+'" onclick="tgToggleRemove(this,\\''+t.replace(/'/g,"\\\\'")+'\\')">'+(on?'✕ ':'')+esc(t)+'</button>';
    }).join('');
  }
  function tgToggleRemove(btn,t){ var i=tgRemove.indexOf(t); if(i>=0)tgRemove.splice(i,1); else tgRemove.push(t); tgRenderRemove(); }
  function tgSync(){
    var g=document.getElementById('tgGatilho').value;
    document.getElementById('tgPalBox').style.display=(g==='palavra')?'block':'none';
    document.getElementById('tgWppBox').style.display=g?'block':'none';
  }
  function fecharTagCfg(){ document.getElementById('tgModal').style.display='none'; tgSel=null; }
  function salvarTagCfg(){
    if(!tgSel) return;
    var g=document.getElementById('tgGatilho').value;
    if(g==='palavra' && !document.getElementById('tgPalavras').value.trim()){ alert('Informe ao menos uma palavra-chave.'); return; }
    var b=document.getElementById('tgSalvar'); b.disabled=true; b.textContent='Salvando…';
    var pals=document.getElementById('tgPalavras').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
    var d={ tag:tgSel.tag, gatilho:g, palavras:pals, avisarWpp:document.getElementById('tgWpp').value, remove:tgRemove };
    fetch('/sofia/contatos/tagcfg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { b.disabled=false; b.textContent='Salvar'; alert('❌ '+(j.erro||'falha ao salvar')); } })
      .catch(function(){ b.disabled=false; b.textContent='Salvar'; alert('❌ erro de rede'); });
  }
  function criarTagNova(){
    var nome=prompt('Nome da nova tag:'); if(nome==null) return;
    nome=nome.trim(); if(!nome) return;
    fetch('/sofia/contatos/criar-tag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { alert('❌ '+(j.erro||'falha ao criar')); } })
      .catch(function(){ alert('❌ erro de rede'); });
  }
  var TODAS_TAGS = ${JSON.stringify(tags.map(t => t.tag))};
  var PAL_TAG = ${JSON.stringify(PAL_TAG)};
  function _hash(s){var h=0;s=String(s||'');for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
  function corTagJs(t){return PAL_TAG[_hash(t)%PAL_TAG.length];}
  var ctSel=null, ctTags=[];
  function abrirFiltroTag(){var s=document.getElementById('ctTagSel');if(s){s.focus();if(s.showPicker)try{s.showPicker();}catch(e){}}}
  var ctSoBloq=false;
  function filtrarBloqueados(){
    ctSoBloq=!ctSoBloq;
    var btn=document.getElementById('ctBloqFil');
    if(btn){ btn.classList.toggle('save',ctSoBloq); btn.classList.toggle('reset',!ctSoBloq); btn.textContent=ctSoBloq?'✅ Ver todos':'🚫 Bloqueados'; }
    var linhas=document.querySelectorAll('.ct-tab tbody tr');
    var n=0;
    linhas.forEach(function(tr){ var bl=tr.getAttribute('data-bloq')==='1'; var mostra=!ctSoBloq||bl; tr.style.display=mostra?'':'none'; if(mostra&&bl)n++; });
    var av=document.getElementById('ctBloqAviso');
    if(ctSoBloq&&!n&&!av){ var tb=document.querySelector('.ct-tab tbody'); if(tb){ var tr=document.createElement('tr'); tr.id='ctBloqAviso'; tr.innerHTML='<td colspan="4" style="text-align:center;color:var(--cinza);padding:18px">Nenhum contato bloqueado.</td>'; tb.appendChild(tr); } }
    else if(av){ av.style.display=(ctSoBloq&&!n)?'':'none'; }
  }
  var ctOrdemNome=0; // 0=original, 1=crescente (A→Z), 2=decrescente (Z→A)
  function ordenarContatos(){
    var tb=document.querySelector('.ct-tab tbody'); if(!tb) return;
    ctOrdemNome=(ctOrdemNome+1)%3; // alterna: original → crescente → decrescente
    var arr=document.querySelector('#ctSortArr');
    if(ctOrdemNome===0){ if(arr){arr.textContent='↕';arr.style.opacity='.4';} location.reload(); return; }
    var asc=(ctOrdemNome===1);
    if(arr){ arr.textContent=asc?'▲':'▼'; arr.style.opacity='1'; }
    var linhas=Array.prototype.slice.call(tb.querySelectorAll('tr'));
    linhas.sort(function(a,b){
      var na=a.getAttribute('data-nome')||'', nb=b.getAttribute('data-nome')||'';
      if(!na&&nb) return 1; if(na&&!nb) return -1; // sem nome sempre por último
      var c=na.localeCompare(nb,'pt-BR',{sensitivity:'base',numeric:true});
      return asc?c:-c;
    });
    linhas.forEach(function(tr){ tb.appendChild(tr); });
  }
  function abrirModal(tel){
    var c=null; for(var i=0;i<CONTATOS.length;i++){if(CONTATOS[i].tel===tel){c=CONTATOS[i];break;}}
    if(!c) return;
    ctSel=c; ctTags=(c.tags||[]).slice();
    var av=document.getElementById('ctAv'); av.textContent=c.ini; av.style.background=c.cor;
    document.getElementById('ctHnome').textContent=c.nome||'(sem nome)';
    document.getElementById('ctHtel').textContent=c.telFmt;
    document.getElementById('ctNome').value=c.nome||'';
    document.getElementById('ctNovaTag').value='';
    renderTags();
    ctPintaBloqueio(!!c.bloq);
    document.getElementById('ctModal').style.display='flex';
  }
  function ctPintaBloqueio(bl){
    var b=document.getElementById('ctBloq'), tag=document.getElementById('ctBloqTag');
    if(b){ b.textContent=bl?'✅ Desbloquear':'🚫 Bloquear'; b.style.color=bl?'#1c8f52':'#c0392b'; }
    if(tag) tag.style.display=bl?'block':'none';
  }
  function alternarBloqueio(){
    if(!ctSel) return;
    var novo=!ctSel.bloq;
    var b=document.getElementById('ctBloq'); if(b){ b.disabled=true; b.textContent='…'; }
    fetch('/sofia/contatos/bloquear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:ctSel.tel,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){
        if(b) b.disabled=false;
        if(j.ok){ ctSel.bloq=novo; ctPintaBloqueio(novo);
          for(var i=0;i<CONTATOS.length;i++){ if(CONTATOS[i].tel===ctSel.tel){ CONTATOS[i].bloq=novo; break; } }
          var row=document.querySelector('.ct-row[data-tel="'+ctSel.tel.replace(/"/g,'')+'"]'); if(row) row.setAttribute('data-bloq',novo?'1':'0');
        } else { ctPintaBloqueio(ctSel.bloq); alert(j.erro||'Não consegui atualizar o bloqueio.'); }
      }).catch(function(){ if(b) b.disabled=false; ctPintaBloqueio(ctSel.bloq); alert('Erro de rede.'); });
  }
  function fecharModal(){document.getElementById('ctModal').style.display='none';ctSel=null;}
  function renderTags(){
    var todas=TODAS_TAGS.slice();
    for(var i=0;i<ctTags.length;i++) if(todas.indexOf(ctTags[i])<0) todas.push(ctTags[i]);
    var box=document.getElementById('ctTags');
    if(!todas.length){box.innerHTML='<span class="quando">Nenhuma tag ainda — crie uma abaixo.</span>';return;}
    box.innerHTML=todas.map(function(t){
      var on=ctTags.indexOf(t)>=0, c=corTagJs(t);
      var st=on?('background:'+c[0]+';color:'+c[1]+';border-color:'+c[2]):'background:#fff;color:#5c5960;border-color:#e8e8ea';
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" style="'+st+'" onclick="toggleTag(this,\\''+t.replace(/'/g,"\\\\'")+'\\')">'+(on?'✓ ':'')+esc(t)+'</button>';
    }).join('');
  }
  function esc(s){return String(s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];});}
  function toggleTag(btn,t){var i=ctTags.indexOf(t);if(i>=0)ctTags.splice(i,1);else ctTags.push(t);renderTags();}
  function addNovaTag(){
    var inp=document.getElementById('ctNovaTag'), t=(inp.value||'').trim();
    if(!t) return;
    if(ctTags.indexOf(t)<0) ctTags.push(t);
    if(TODAS_TAGS.indexOf(t)<0) TODAS_TAGS.push(t);
    inp.value=''; renderTags();
  }
  function salvarContato(){
    if(!ctSel) return;
    var b=document.getElementById('ctSalvar'); b.disabled=true; b.textContent='Salvando…';
    fetch('/sofia/contatos/salvar-novo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:ctSel.tel,nome:document.getElementById('ctNome').value,tags:ctTags})})
      .then(function(r){return r.json();}).then(function(j){
        if(j.ok){ location.reload(); }
        else { b.disabled=false; b.textContent='Salvar'; alert('❌ '+(j.erro||'falha ao salvar')); }
      }).catch(function(){ b.disabled=false; b.textContent='Salvar'; alert('❌ erro de rede'); });
  }
  function irConversa(tel){ location.href='/sofia?view=conversas&chat='+encodeURIComponent(tel); }
  function irConversaModal(){ if(ctSel) irConversa(ctSel.tel); }
  var intSessoes=[];
  function fmtDataHora(ts){ try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+'h'; }catch(e){ return ''; } }
  function abrirInteracoes(tel){
    var c=null; for(var i=0;i<CONTATOS.length;i++){if(CONTATOS[i].tel===tel){c=CONTATOS[i];break;}}
    document.getElementById('ctIntHero').textContent=c?((c.nome||'(sem nome)')+' · '+c.telFmt):'';
    document.getElementById('ctIntBody').innerHTML='<p class="quando">Carregando…</p>';
    document.getElementById('ctIntModal').style.display='flex';
    fetch('/sofia/contatos/interacoes?tel='+encodeURIComponent(tel),{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(j){
        intSessoes=(j&&j.sessoes)||[];
        renderInteracoes();
      }).catch(function(){ document.getElementById('ctIntBody').innerHTML='<p class="quando">❌ Não consegui carregar agora.</p>'; });
  }
  function renderInteracoes(){
    var box=document.getElementById('ctIntBody');
    if(!intSessoes.length){ box.innerHTML='<p class="quando">Nenhuma interação registrada ainda. O histórico começa a contar a partir de agora — quando a aluna conversar com a SoFIA, cada atendimento aparece aqui.</p>'; return; }
    var linhas=intSessoes.map(function(s,idx){
      var badge=s.status==='ativa'?'<span class="ct-badge ativa">Em andamento</span>':'<span class="ct-badge enc">Encerrado</span>';
      return '<tr><td>'+badge+'</td><td>'+fmtDataHora(s.inicioEm)+'</td><td style="color:var(--cinza)">'+(s.nMsgs||0)+' msg</td><td style="text-align:right"><button type="button" class="ct-ic" title="Ver resumo" onclick="verResumo('+idx+')">📄</button></td></tr>';
    }).join('');
    box.innerHTML='<div style="overflow-x:auto"><table class="ct-int-tab"><thead><tr><th>Status</th><th>Data</th><th>Trocas</th><th style="text-align:right">Resumo</th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      +'<p class="quando" style="margin:10px 0 0">Total de '+intSessoes.length+' interaç'+(intSessoes.length===1?'ão':'ões')+'.</p>';
  }
  function fecharInteracoes(){ document.getElementById('ctIntModal').style.display='none'; }
  function verResumo(idx){
    var s=intSessoes[idx]; if(!s) return;
    document.getElementById('ctResData').textContent=fmtDataHora(s.inicioEm);
    var body=document.getElementById('ctResBody');
    if(s.status==='ativa'){ body.innerHTML='<span class="quando">Este atendimento ainda está em andamento — o resumo é gerado quando a conversa encerra.</span>'; }
    else if(!s.resumoPronto){ body.innerHTML='<span class="quando">Resumo sendo gerado… abra de novo em instantes.</span>'; }
    else if(!s.resumo){ body.innerHTML='<span class="quando">Sem resumo para este atendimento (conversa muito curta ou sem conteúdo).</span>'; }
    else { body.textContent=s.resumo; }
    document.getElementById('ctResModal').style.display='flex';
  }
  function fecharResumo(){ document.getElementById('ctResModal').style.display='none'; }
  function excluirContato(tel){
    if(!confirm('Excluir este contato de vez?')) return;
    fetch('/sofia/contatos/salvar',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'acao=excluir&telOrig='+encodeURIComponent(tel)})
      .then(function(){ location.reload(); }).catch(function(){ alert('❌ erro de rede'); });
  }
  function importarCsv(){
    var f=document.getElementById('csvFile'), msg=document.getElementById('impMsg');
    if(!f.files||!f.files[0]){ msg.textContent='Escolha um arquivo .csv primeiro.'; return; }
    msg.textContent='Importando…';
    var rd=new FileReader();
    rd.onload=function(){
      fetch('/sofia/contatos/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:rd.result})})
        .then(function(r){return r.json();}).then(function(j){
          if(j.ok){ msg.textContent='✅ '+j.resumo.novos+' novos, '+j.resumo.atualizados+' atualizados, '+j.resumo.ignorados+' ignorados.'; setTimeout(function(){location.href='/sofia?view=contatos';},1000); }
          else { msg.textContent='❌ '+(j.erro||'falha ao importar'); }
        }).catch(function(){ msg.textContent='❌ erro de rede'; });
    };
    rd.readAsText(f.files[0],'utf-8');
  }
</script>`;
  return chrome({ tab: 'Contatos', h1: '🤖 SoFIA', p: 'Contatos — importe, etiquete e filtre por tag.' }, 'sofia', corpo);
}

// Estimativa de término de uma campanha, a partir do que falta e das configs.
function estimarCampanha(c) {
  const restantes = (c.pendentes || []).length;
  if (!restantes) return null;
  const mm = (h) => { const p = String(h || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
  const avg = Math.max(1, ((Number(c.delayMinSeg) || 1) + (Number(c.delayMaxSeg) || 1)) / 2);
  const win = mm(c.janelaFim) - mm(c.janelaIni);
  const maxWin = win > 0 ? Math.max(1, Math.floor(win * 60 / avg)) : 1;
  const porDia = Math.max(1, Math.min(Number(c.limiteDia) || 1, maxWin));
  const dias = Math.max(1, Math.ceil(restantes / porDia));
  const hoje = hojeSP();
  const iniStr = (c.dataInicio && c.dataInicio > hoje) ? c.dataInicio : hoje;
  const d = new Date(iniStr + 'T12:00:00'); d.setDate(d.getDate() + (dias - 1));
  const fim = `${('0' + d.getDate()).slice(-2)}/${('0' + (d.getMonth() + 1)).slice(-2)}/${d.getFullYear()}`;
  return { porDia, dias, fim };
}
const fmtDataBR = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (s || ''); };

// Só a LISTA de campanhas (usada tanto na página quanto no fragmento que o painel
// busca a cada poucos segundos para atualizar o progresso SEM recarregar a página).
function campListHTML() {
  let campanhas = []; try { campanhas = sofia.lerCampanhas(); } catch (_) {}
  const rotStatus = { gerando: '⏳ gerando variações', pronta: '✅ pronta p/ iniciar', enviando: '📤 enviando', pausada: '⏸️ pausada', concluida: '✔️ concluída', cancelada: '🚫 cancelada' };
  if (!campanhas.length) return '<p class="vazio">Nenhuma campanha ainda.</p>';
  return campanhas.map(c => {
    const total = (c.enviados ? c.enviados.length : 0) + (c.pendentes ? c.pendentes.length : 0) + (c.falhas ? c.falhas.length : 0);
    const enviados = c.enviados ? c.enviados.length : 0;
    const pct = total ? Math.round((enviados + (c.falhas ? c.falhas.length : 0)) / total * 100) : 0;
    const est = (c.status === 'pronta' || c.status === 'pausada' || c.status === 'enviando') ? estimarCampanha(c) : null;
    const podeIniciar = (c.status === 'pronta' || c.status === 'pausada') && (c.pendentes || []).length;
    const podePausar = c.status === 'enviando';
    const variacoes = (c.variacoes || []).slice(0, 12).map((v, i) => `<div style="padding:6px 0;border-bottom:1px solid var(--linha);font-size:var(--fs-sm)"><b style="color:var(--teal-esc)">#${i + 1}</b> ${esc(v)}</div>`).join('');
    const btn = (acao, rot, cls) => `<form method="POST" action="/sofia/campanhas/${acao === 'excluir' ? 'excluir' : 'controle'}"${acao === 'cancelar' || acao === 'excluir' ? ` onsubmit="return confirm('${acao === 'excluir' ? 'Excluir esta campanha do painel?' : 'Cancelar o envio desta campanha?'}')"` : ''} style="display:inline"><input type="hidden" name="id" value="${esc(c.id)}">${acao !== 'excluir' ? `<input type="hidden" name="acao" value="${acao}">` : ''}<button type="submit" class="${cls}" style="padding:5px 12px;font-size:var(--fs-sm)">${rot}</button></form>`;
    return `<div class="card">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <a href="javascript:void(0)" onclick="abrirCampDetalhe('${esc(c.id)}')" style="font-weight:700;font-size:var(--fs-h2);color:var(--teal-esc);text-decoration:none;cursor:pointer" title="Ver detalhes do envio">${esc(c.nome)}</a>
        <span class="pill" style="border-color:var(--linha)">🏷️ ${esc(c.tag)}</span>
        ${c.fotoArquivo ? '<span class="pill" style="border-color:var(--linha)">📷 com foto</span>' : ''}
        <span class="quando" style="margin:0">${rotStatus[c.status] || c.status}${(c.status === 'pausada' && (c.falhasSeguidas || 0) >= 3) ? ' <span style="color:var(--erro)">(pausada por falhas — verifique a conexão)</span>' : ''}</span>
      </div>
      <div style="margin:8px 0">
        <div style="background:#eef1f2;border-radius:6px;height:16px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--teal)"></div></div>
        <div class="quando" style="margin:4px 0 0">${enviados} enviadas · ${(c.pendentes || []).length} na fila · ${(c.falhas || []).length} falha(s) · ${total} no total · hoje: ${c.enviadosHoje || 0}/${c.limiteDia}</div>
        <div class="quando" style="margin:2px 0 0">📅 início ${esc(fmtDataBR(c.dataInicio))} · das ${esc(c.janelaIni)} às ${esc(c.janelaFim)} · ${c.delayMinSeg}–${c.delayMaxSeg}s entre envios${est ? ` · <b>término previsto ${est.fim}</b> (~${est.dias} dia${est.dias > 1 ? 's' : ''}, ~${est.porDia}/dia)` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${podeIniciar ? btn('iniciar', '▶️ Iniciar', 'save') : ''}
        ${podePausar ? btn('pausar', '⏸️ Pausar', 'reset') : ''}
        ${(c.status !== 'concluida' && c.status !== 'cancelada') ? btn('cancelar', '🚫 Cancelar', 'reset') : ''}
        ${btn('excluir', '🗑️ Excluir', 'reset')}
        ${(c.variacoes || []).length ? `<a href="javascript:void(0)" onclick="var d=this.parentNode.parentNode.querySelector('.vars-'+'${esc(c.id)}');if(d)d.style.display=d.style.display==='none'?'block':'none'" class="quando" style="margin:0;text-decoration:underline">ver variações (${(c.variacoes || []).length})</a>` : ''}
      </div>
      <div class="vars-${esc(c.id)}" style="display:none;margin-top:8px">${variacoes}</div>
    </div>`;
  }).join('');
}

// Aba SoFIA → Campanhas: envio em massa por tag (com variações da IA e limites).
function paginaSofiaCampanhas(aviso, erro) {
  const tags = contatos.tagsDistintas();

  const opcoesTag = tags.length
    ? tags.map(t => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`).join('')
    : '';

  const novo = `
    <div class="sec-t">📣 Nova campanha</div>
    <div class="card">
      ${tags.length ? `<form id="cpForm" onsubmit="return enviarCampanha(event)">
        <div class="cpf-sec first">
          <div class="cpf-h">✍️ Mensagem</div>
          <div class="cpf-grid">
            <div class="cpf-field"><label>Nome da campanha</label><input type="text" name="nome" placeholder="ex.: Reativação outubro" required></div>
            <div class="cpf-field"><label>Enviar para a tag</label><select name="tag" required style="text-overflow:ellipsis">${opcoesTag}</select></div>
          </div>
          <div class="cpf-field" style="margin-top:14px">
            <label>Mensagem base <span class="sub">— a IA cria ~10 variações naturais a partir dela</span></label>
            <textarea name="textoBase" rows="4" placeholder="Escreva como você mandaria para uma aluna…  Use {nome} para personalizar (ex.: Oi, {nome}!)" required></textarea>
            <p class="quando" style="margin:6px 0 0">💡 <b>{nome}</b> vira o primeiro nome do contato. Quem não tem nome salvo recebe a versão sem o nome.</p>
          </div>
          <div class="cpf-field" style="margin-top:14px">
            <label>Foto <span class="sub">— opcional, enviada junto com a mensagem como legenda</span></label>
            <input type="file" id="cpFoto" accept="image/*" onchange="prevFoto()" style="padding:8px">
            <div id="cpFotoPrev" style="display:none;margin-top:8px"><img id="cpFotoImg" alt="prévia" style="max-width:180px;max-height:180px;border-radius:10px;border:1px solid var(--linha)"><br><a href="javascript:void(0)" onclick="limpaFoto()" class="quando" style="text-decoration:underline">remover foto</a></div>
          </div>
        </div>

        <details class="cpf-acc">
          <summary class="cpf-sum">🛡️ Ritmo e limites <span class="sub quando" style="margin:0">— já vem com um ritmo seguro; abra para ajustar</span></summary>
          <div class="cpf-body">
          <div class="cpf-grid-lim">
            <div class="cpf-field"><label>Começar em</label><input type="date" id="cpIni" name="dataInicio" value="${esc(hojeSP())}" min="${esc(hojeSP())}" oninput="estCamp()"></div>
            <div class="cpf-field"><label>Máx. por dia</label><div class="cpf-range"><input type="number" id="cpMax" name="limiteDia" min="1" max="1000" value="40" oninput="estCamp()"><span class="cpf-suf">msg</span></div></div>
            <div class="cpf-field"><label>Horário de envio</label><div class="cpf-range"><input type="time" id="cpJi" name="janelaIni" value="09:00" oninput="estCamp()"><span class="cpf-suf">até</span><input type="time" id="cpJf" name="janelaFim" value="20:00" oninput="estCamp()"></div></div>
            <div class="cpf-field"><label>Intervalo entre envios</label><div class="cpf-range"><input type="number" id="cpDmin" name="delayMinSeg" min="1" max="3600" value="25" oninput="estCamp()"><span class="cpf-suf">a</span><input type="number" id="cpDmax" name="delayMaxSeg" min="1" max="3600" value="70" oninput="estCamp()"><span class="cpf-suf">s</span></div></div>
          </div>
          <p class="quando" style="margin:10px 0 0">Intervalo aleatório entre cada mensagem — quanto maior, mais natural e seguro.</p>
          </div>
        </details>
        <div id="cpEst" class="aviso" style="margin:14px 0 0;display:none"></div>

        <details class="cpf-acc">
          <summary class="cpf-sum">🚀 Testar e criar</summary>
          <div class="cpf-body">
          <p class="quando" style="margin:0 0 10px">Mande a mensagem (e a foto) para um número seu antes, pra conferir como chega.</p>
          <div class="cpf-range" style="flex-wrap:wrap">
            <input type="tel" id="cpTesteTel" placeholder="(62) 99999-9999" style="max-width:220px">
            <button type="button" class="reset" onclick="testarCampanha()" style="padding:9px 16px;flex:none">Enviar teste</button>
            <span id="cpTesteMsg" class="quando" style="margin:0"></span>
          </div>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px">
            <button type="submit" class="save" style="padding:11px 24px">📣 Criar campanha</button>
            <span class="quando" style="margin:0;flex:1;min-width:220px">⚠️ Só envia depois de você clicar em <b>Iniciar</b>. Comece com poucos por dia e delays altos — envio em massa pode bloquear o número.</span>
          </div>
          </div>
        </details>
        <script>
          var TAGN = ${JSON.stringify(Object.fromEntries(tags.map(t => [t.tag, t.n])))};
          function selTagEl(){ return document.querySelector('select[name=tag]'); }
          function mm(h){ var p=String(h||'').split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
          function fmtD(d){ return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear(); }
          function estCamp(){
            var el=document.getElementById('cpEst'); if(!el) return;
            var tag=selTagEl()?selTagEl().value:''; var n=TAGN[tag]||0;
            if(!n){ el.style.display='none'; return; }
            var maxd=Math.max(1,parseInt(document.getElementById('cpMax').value,10)||1);
            var dmin=Math.max(1,parseInt(document.getElementById('cpDmin').value,10)||1);
            var dmax=Math.max(dmin,parseInt(document.getElementById('cpDmax').value,10)||dmin);
            var avg=(dmin+dmax)/2;
            var win=mm(document.getElementById('cpJf').value)-mm(document.getElementById('cpJi').value);
            if(win<=0){ el.style.display='block'; el.className='aviso err'; el.textContent='O horário "até" precisa ser depois do "das".'; return; }
            var maxWin=Math.max(1,Math.floor(win*60/avg));
            var porDia=Math.max(1,Math.min(maxd,maxWin));
            var dias=Math.max(1,Math.ceil(n/porDia));
            var ini=document.getElementById('cpIni').value; var d=ini?new Date(ini+'T12:00:00'):new Date();
            d.setDate(d.getDate()+(dias-1));
            el.className='aviso'; el.style.display='block';
            el.innerHTML='📊 <b>'+n+' contatos</b> nesta tag · ~<b>'+porDia+'/dia</b> · leva ~<b>'+dias+' dia'+(dias>1?'s':'')+'</b> · término previsto: <b>'+fmtD(d)+'</b>'+(porDia<maxd?' <span style="opacity:.8">(a janela de horário limita a '+porDia+'/dia)</span>':'');
          }
          document.addEventListener('DOMContentLoaded',estCamp);
          var _st=selTagEl(); if(_st) _st.addEventListener('change',estCamp);
          function prevFoto(){ var f=document.getElementById('cpFoto').files[0]; var box=document.getElementById('cpFotoPrev'); if(!f){box.style.display='none';return;} var rd=new FileReader(); rd.onload=function(){ document.getElementById('cpFotoImg').src=rd.result; box.style.display='block'; }; rd.readAsDataURL(f); }
          function testarCampanha(){
            var tel=document.getElementById('cpTesteTel').value.replace(/\\D/g,''); var msg=document.getElementById('cpTesteMsg');
            var texto=document.querySelector('textarea[name=textoBase]').value.trim();
            if(!tel || tel.length<10){ if(msg)msg.textContent='Informe um número válido.'; return; }
            if(!texto){ if(msg)msg.textContent='Escreva a mensagem primeiro.'; return; }
            if(msg)msg.textContent='Enviando teste…';
            var d={ telefone:tel, texto:texto };
            function post(){ fetch('/sofia/campanhas/teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json();}).then(function(j){ if(msg)msg.textContent=j.ok?'✓ teste enviado (confira o WhatsApp).':'❌ '+(j.erro||'falha'); }).catch(function(){ if(msg)msg.textContent='❌ erro de rede'; }); }
            var file=document.getElementById('cpFoto').files[0];
            if(file){ if(file.size>10*1024*1024){ if(msg)msg.textContent='Imagem muito grande (máx. 10MB).'; return; } var rd=new FileReader(); rd.onload=function(){ d.fotoBase64=rd.result; post(); }; rd.readAsDataURL(file); }
            else post();
          }
          function limpaFoto(){ document.getElementById('cpFoto').value=''; document.getElementById('cpFotoPrev').style.display='none'; }
          function enviarCampanha(ev){
            ev.preventDefault();
            var f=ev.target;
            if(!confirm('Criar a campanha e preparar o envio? Nada é enviado até você clicar em Iniciar.')) return false;
            var d={ nome:f.nome.value, tag:f.tag.value, textoBase:f.textoBase.value, limiteDia:f.limiteDia.value, delayMinSeg:f.delayMinSeg.value, delayMaxSeg:f.delayMaxSeg.value, janelaIni:f.janelaIni.value, janelaFim:f.janelaFim.value, dataInicio:f.dataInicio.value };
            var btn=f.querySelector('button[type=submit]'); if(btn){btn.disabled=true;btn.textContent='Criando…';}
            function post(){ fetch('/sofia/campanhas/criar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.href='/sofia?view=campanhas&okc=criada'; } else { alert(j.erro||'Erro ao criar campanha'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} } }).catch(function(){ alert('Erro de rede'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} }); }
            var file=document.getElementById('cpFoto').files[0];
            if(file){ if(file.size>10*1024*1024){ alert('Imagem muito grande (máx. 10MB).'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} return false; } var rd=new FileReader(); rd.onload=function(){ d.fotoBase64=rd.result; post(); }; rd.readAsDataURL(file); }
            else post();
            return false;
          }
        </script>
      </form>`
      : `<p class="vazio">Você ainda não tem contatos com tags. Vá em <b>Contatos</b>, importe e etiquete primeiro — as campanhas são enviadas por tag.</p>`}
    </div>`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('campanhas')}
    ${novo}
    <div class="sec-t">📋 Campanhas</div>
    <div id="campList">${campListHTML()}</div>
  </div>
  <div id="cpModal" class="ct-ov" onclick="if(event.target===this)fecharCampDet()">
    <div class="ct-dlg" style="max-width:640px">
      <div class="ct-dh"><h2 id="cpTit">Detalhes do envio</h2><button type="button" class="ct-x" onclick="fecharCampDet()">×</button></div>
      <div id="cpStats" class="quando" style="margin:0 0 10px"></div>
      <div id="cpBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <script>
    (function(){
      var box=document.getElementById('campList'); if(!box) return;
      var ultimo=box.innerHTML;
      function poll(){ fetch('/sofia/campanhas/lista',{cache:'no-store'}).then(function(r){return r.text();}).then(function(h){ if(h && h!==ultimo){ ultimo=h; box.innerHTML=h; } }).catch(function(){}); }
      var n=0, iv=setInterval(function(){ n++; poll(); if(n>=3){ clearInterval(iv); setInterval(poll,6000); } },1200);
    })();
    var cpId=null, cpTimer=null, CP_CONV=${podeSofiaSub(_navSess || { admin: true, telas: [] }, 'conversas') ? 'true' : 'false'};
    function irConversaCamp(tel){ location.href='/sofia?view=conversas&chat='+encodeURIComponent(tel); }
    function cpEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }
    function cpFmtTel(k){ var d=String(k||'').replace(/\\D/g,''); if(/^55\\d{10,11}$/.test(d)){ var ddd=d.slice(2,4), r=d.slice(4); return '+55 ('+ddd+') '+(r.length===9?r.slice(0,5)+'-'+r.slice(5):r.slice(0,4)+'-'+r.slice(4)); } return k||''; }
    function cpFmtHora(ts){ if(!ts) return ''; try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
    function abrirCampDetalhe(id){
      cpId=id;
      document.getElementById('cpBody').innerHTML='<p class="quando">Carregando…</p>';
      document.getElementById('cpStats').textContent='';
      document.getElementById('cpModal').style.display='flex';
      cpCarregar();
      if(cpTimer) clearInterval(cpTimer);
      cpTimer=setInterval(cpCarregar, 5000); // acompanha ao vivo enquanto aberto
    }
    function cpCarregar(){
      if(!cpId) return;
      fetch('/sofia/campanhas/detalhe?id='+encodeURIComponent(cpId),{cache:'no-store'})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok) cpRender(j); })
        .catch(function(){});
    }
    function cpRender(j){
      var tEnv=j.enviadosTotal!=null?j.enviadosTotal:j.enviados.length, tPen=j.pendentesTotal!=null?j.pendentesTotal:j.pendentes.length, tFal=j.falhasTotal!=null?j.falhasTotal:j.falhas.length;
      document.getElementById('cpTit').textContent='Envio · '+(j.nome||'');
      document.getElementById('cpStats').innerHTML='<b style="color:var(--ok)">'+tEnv+'</b> enviadas · <b>'+tPen+'</b> na fila · <b style="color:var(--erro)">'+tFal+'</b> falha(s) · hoje '+(j.enviadosHoje||0)+'/'+(j.limiteDia||0);
      function linha(nome,tel,dir){ var ir=CP_CONV?('<button type="button" class="ct-ic" title="Ir para a conversa" style="margin:0" onclick="irConversaCamp(\\''+cpEsc(String(tel).replace(/[^0-9]/g,''))+'\\')">💬</button>'):''; return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--linha)"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>'+cpEsc(nome||'(sem nome)')+'</b> <span class="quando">'+cpEsc(cpFmtTel(tel))+'</span></span><span style="white-space:nowrap;flex:none;display:flex;align-items:center;gap:8px"><span class="quando" style="margin:0">'+dir+'</span>'+ir+'</span></div>'; }
      function maisN(mostrados,total){ return total>mostrados?('<div class="quando" style="padding:7px 0">…e mais '+(total-mostrados)+'</div>'):''; }
      var env=j.enviados.slice().reverse().map(function(x){ return linha(x.nome,x.tel,'✅ '+cpFmtHora(x.em)); }).join('')+maisN(j.enviados.length,tEnv) || '<p class="quando">Ninguém ainda.</p>';
      var fila=j.pendentes.map(function(x){ return linha(x.nome,x.tel,'⏳ na fila'); }).join('')+maisN(j.pendentes.length,tPen) || '<p class="quando">Fila vazia.</p>';
      var fal=j.falhas.slice().reverse().map(function(x){ return linha(x.nome,x.tel,'<span style="color:var(--erro)">⚠️ '+cpEsc((x.erro||'').slice(0,40))+'</span>'); }).join('') || '<p class="quando">Nenhuma falha. 🎉</p>';
      document.getElementById('cpBody').innerHTML=
        '<div class="cp-sec"><div class="cp-h">✅ Enviadas ('+tEnv+')</div><div class="cp-list">'+env+'</div></div>'+
        '<div class="cp-sec"><div class="cp-h">⏳ Na fila ('+tPen+')</div><div class="cp-list">'+fila+'</div></div>'+
        (tFal?('<div class="cp-sec"><div class="cp-h">⚠️ Falhas ('+tFal+')</div><div class="cp-list">'+fal+'</div></div>'):'');
    }
    function fecharCampDet(){ document.getElementById('cpModal').style.display='none'; cpId=null; if(cpTimer){ clearInterval(cpTimer); cpTimer=null; } }
  </script>`;
  return chrome({ tab: 'Campanhas', h1: '🤖 SoFIA', p: 'Campanhas — envio em massa por tag, com variações e limites.' }, 'sofia', corpo);
}

function paginaSofia(aviso, erro) {
  if (!sofia.disponivel()) {
    const corpo = `<div class="wrap">
      ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
      <div class="card"><div class="chead"><h2>SoFIA não encontrada nesta máquina</h2></div>
        <p class="quando">Não achei a pasta da SoFIA (<code>${esc(sofia.DIR)}</code>) ou o arquivo do prompt. Se a SoFIA roda em outra pasta/servidor, aponte com a variável <code>SOFIA_DIR</code> no <code>.env</code> do painel e reinicie: <code>pm2 restart slimfit-painel --update-env</code>.</p>
      </div></div>`;
    return chrome({ tab: 'SoFIA', h1: '🤖 SoFIA', p: 'Prompt, configurações e conexão do chatbot.' }, 'sofia', corpo);
  }

  const e = sofia.estado();
  // Cada seção é um card recolhível (começa MINIMIZADA — só o título aparece) e
  // reordenável (↑ ↓). A ordem no DOM = ordem salva no prompt. O textarea, mesmo
  // recolhido (display:none), continua sendo enviado no POST.
  const cardSecao = (titulo, corpo) => {
    const rows = Math.min(16, Math.max(4, String(corpo || '').split('\n').length + 1));
    return `<div class="card sec-card">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <button type="button" class="reset secTog" onclick="toggleSecao(this)" title="Expandir/recolher" style="padding:6px 9px;flex:none">▸</button>
        <input type="text" name="titulo[]" value="${esc(titulo)}" placeholder="TÍTULO DA SEÇÃO" style="flex:1;min-width:0;font-weight:700;font-family:Montserrat,sans-serif;font-size:.9rem">
        <button type="button" class="reset" onclick="moverSecao(this,-1)" title="Subir" style="padding:6px 9px;flex:none">↑</button>
        <button type="button" class="reset" onclick="moverSecao(this,1)" title="Descer" style="padding:6px 9px;flex:none">↓</button>
        <button type="button" class="reset" onclick="removerSecao(this)" title="Remover esta seção" style="padding:6px 10px;flex:none">🗑️</button>
      </div>
      <textarea name="corpo[]" rows="${rows}" spellcheck="false" style="display:none">${esc(corpo)}</textarea>
    </div>`;
  };
  const cardsSecoes = e.secoes.map(s => cardSecao(s.titulo, s.corpo)).join('');

  const inpMidia = (nome, valor, rot) => `<label>${rot}</label><input type="text" name="${nome}" value="${esc(valor)}" style="font-family:ui-monospace,monospace;font-size:.86rem">`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('config')}

    <div class="sec-t">📱 Conexão do WhatsApp da SoFIA <small style="font-weight:600;color:var(--cinza)">(número próprio, diferente do robô)</small></div>
    <div id="sofiaWa">${blocoSofiaWa()}</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 6px">
      <span style="margin-right:auto;font-weight:700;font-size:.95rem">${e.ativa ? '🟢 IA ativa' : '⏸️ IA pausada'}<small style="font-weight:400;color:var(--cinza)"> — ${e.ativa ? 'respondendo as alunas' : 'não responde (atenda manual)'}</small></span>
      <form method="POST" action="/sofia/toggle" style="margin:0;display:inline"><button type="submit" class="${e.ativa ? 'reset' : 'save'}" style="padding:6px 14px">${e.ativa ? '⏸️ Pausar SoFIA' : '▶️ Ativar SoFIA'}</button></form>
      <form method="POST" action="/sofia/desconectar" onsubmit="return confirm('Desconectar o WhatsApp da SoFIA?\\n\\nA SoFIA para de responder e será preciso reescanear o QR (aqui mesmo) para reconectar.')" style="margin:0;display:inline"><button type="submit" class="reset" style="padding:6px 14px">🔌 Desconectar</button></form>
    </div>

    <form id="formSalvar" method="POST" action="/sofia/salvar">

      <details class="acc-sec">
        <summary class="sec-t" style="cursor:pointer;padding:4px 0">⌨️ Jeito de responder <small style="font-weight:400;color:var(--cinza)">— IA, ritmo da conversa, memória e operação</small></summary>

      <!-- Grupo 1 · Inteligência (modelo de IA + transcrição) -->
      <div class="card">
        <div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">🧠 Inteligência</div>
        <p class="quando" style="margin:0 0 12px">Qual Claude a SoFIA usa e se ela entende áudios.</p>
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <label>Modelo da conversa ${infoI('Modelo que <b>conversa com as alunas</b> e gera o <b>follow-up</b>. É o mais importante para a qualidade do atendimento. Padrão: Sonnet 5.')}</label>
            <select name="modeloConversa" style="width:100%;padding:9px">${e.modelosValidos.map(m => `<option value="${esc(m.id)}"${m.id === e.modelos.conversa ? ' selected' : ''}>${esc(m.rot)}</option>`).join('')}</select>
          </div>
          <div style="flex:1;min-width:240px">
            <label>Modelo de extração/resumos ${infoI('Modelo que <b>extrai os dados</b> do agendamento (nome, e-mail, dia, hora) e gera os <b>resumos</b> das interações. Roda pouco — dá para usar um mais barato aqui. Padrão: Sonnet 5.')}</label>
            <select name="modeloExtracao" style="width:100%;padding:9px">${e.modelosValidos.map(m => `<option value="${esc(m.id)}"${m.id === e.modelos.extracao ? ' selected' : ''}>${esc(m.rot)}</option>`).join('')}</select>
          </div>
        </div>
        <p class="quando" style="margin:8px 0 0">Modelos maiores custam mais por conversa. A troca vale <b>após reiniciar a SoFIA</b> (<code>pm2 restart sofia-listener</code>).</p>
        <hr style="border:0;border-top:1px solid var(--linha);margin:14px 0 12px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="transcricaoOn" value="1"${e.transcricaoOn ? ' checked' : ''} style="width:auto;margin:0">
          🎤 Transcrever áudios das alunas${infoI('Quando a aluna manda <b>áudio</b>, a SoFIA transcreve (fala→texto) e responde ao conteúdo — aparece como “🎤 …” no painel. Precisa de uma <b>chave de transcrição</b> no arquivo <code>.env</code> (<code>TRANSCRICAO_API_KEY</code>, OpenAI ou Groq). Desligado, a SoFIA pede para a aluna mandar por texto.')}
        </label>
        <p class="quando" style="margin:6px 0 0">Precisa da chave no <code>ChatBot/.env</code>. Sem chave, fica sem efeito. Vale <b>após reiniciar</b> a SoFIA.</p>
      </div>

      <!-- Grupo 2 · Ritmo da conversa (humano/velocidade + agrupar + pausa celular) -->
      <div class="card">
        <div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">💬 Ritmo da conversa</div>
        <p class="quando" style="margin:0 0 12px">Como ela fala e o tempo até responder.</p>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="ritHumano" value="1"${e.ritmo.humano ? ' checked' : ''} style="width:auto;margin:0">
          Modo humano — quebra respostas longas em várias mensagens e mostra “digitando…”
        </label>
        <p class="quando" style="margin:6px 0 12px">Desmarcado, a SoFIA manda tudo de uma vez, sem simular digitação.</p>
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          <div>
            <label>Velocidade da digitação</label>
            <div><input type="number" name="ritMsPorChar" min="0" max="500" value="${e.ritmo.msPorChar}" style="width:110px"> ms por caractere</div>
            <p class="quando" style="margin:4px 0 0">Maior = digita mais devagar.</p>
          </div>
          <div>
            <label>Pausa mínima</label>
            <div><input type="number" name="ritDelayMin" min="0" max="60000" value="${e.ritmo.delayMin}" style="width:110px"> ms</div>
            <p class="quando" style="margin:4px 0 0">Tempo mínimo “digitando…” por mensagem.</p>
          </div>
          <div>
            <label>Pausa máxima</label>
            <div><input type="number" name="ritDelayMax" min="0" max="60000" value="${e.ritmo.delayMax}" style="width:110px"> ms</div>
            <p class="quando" style="margin:4px 0 0">Teto, mesmo em mensagens longas.</p>
          </div>
        </div>
        <hr style="border:0;border-top:1px solid var(--linha);margin:14px 0 12px">
        <div class="cfg-grid">
          <div>
            <label>🧩 Agrupar mensagens da aluna${infoI('A aluna às vezes manda <b>várias mensagens seguidas</b>. A SoFIA espera esse tempo após a última e responde <b>uma vez só</b>, juntando tudo — evita respostas cruzadas/confusas. Padrão: 7 segundos. 0 = responder na hora. As mensagens aparecem no painel na hora.')}</label>
            <div class="cfg-in"><input type="number" name="agruparSeg" min="0" max="120" step="1" value="${e.agruparSeg}"><span class="suf">segundos (0 = na hora)</span></div>
          </div>
          <div>
            <label>⏳ Pausa ao responder pelo celular${infoI('Se você responder uma aluna <b>direto pelo WhatsApp</b> (no celular da SoFIA), ela se cala nessa conversa por esse tempo, pra não falar por cima de você. É <b>diferente</b> do botão “assumir” do painel, que deixa a SoFIA fora <b>até você devolver</b>.')}</label>
            <div class="cfg-in"><input type="number" name="pausaMin" min="1" max="1440" value="${e.pausaMin}"><span class="suf">minutos</span></div>
          </div>
        </div>
      </div>

      <!-- Grupo 3 · Memória e operação (sessão + verificação + limite) -->
      <div class="card">
        <div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">⚙️ Memória e operação</div>
        <p class="quando" style="margin:0 0 12px">Duração da memória, saúde da conexão e limite de vagas por turma.</p>
        <div class="cfg-grid">
          <div>
            <label>🧠 Tempo de sessão (memória)${infoI('Depois desse tempo <b>sem mensagens</b>, a próxima mensagem da aluna começa uma conversa <b>nova</b> — a SoFIA não lembra do que foi dito antes. Na aba Conversas aparece como <b>“Sessão encerrada”</b>. Padrão: 12 horas.')}</label>
            <div class="cfg-in"><input type="number" name="sessaoHoras" min="1" max="720" step="1" value="${e.sessaoHoras}"><span class="suf">horas</span></div>
          </div>
          <div>
            <label>🩺 Verificação de conexão${infoI('De tempos em tempos a SoFIA confere se o WhatsApp dela ainda está <b>de verdade</b> conectado. Se travar (parar de responder sem cair o QR), ela <b>te avisa no celular</b> e <b>reinicia sozinha</b>. Padrão: 3 minutos. Vale na hora, sem reiniciar.')}</label>
            <div class="cfg-in">checar a cada <input type="number" name="healthMin" min="0" max="120" step="1" value="${e.healthMin}"><span class="suf">min (0 = off)</span></div>
          </div>
          <div>
            <label>🎟️ Máx. experimentais por turma${infoI('Quando uma turma já tem esse número de experimentais marcadas, a SoFIA <b>para de oferecer</b> aquele horário (mesmo com vaga normal). Aumente para aceitar mais. Padrão: 2. Vale na próxima atualização da grade. <b>Atenção:</b> a checagem final roda no formulário (Render) — se aumentar muito aqui, ajuste o EVO_MAX_EXPERIMENTAIS lá também.')}</label>
            <div class="cfg-in"><input type="number" name="expLimite" min="0" max="50" step="1" value="${lerExpLimite() == null ? 2 : lerExpLimite()}"><span class="suf">por turma (0 = sem limite)</span></div>
          </div>
        </div>
      </div>

      </details>

      <details class="acc-sec">
        <summary class="sec-t" style="cursor:pointer;padding:4px 0">🔁 Follow-up de leads <small style="font-weight:400;color:var(--cinza)">— a SoFIA retoma sozinha quem esfriou sem agendar</small></summary>
      <div class="card">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="followupOn" value="1"${e.followup.on ? ' checked' : ''} style="width:auto;margin:0">
          Ativar follow-up automático${infoI('Quando uma lead conversa e <b>para de responder sem agendar</b>, a SoFIA espera o tempo abaixo e manda <b>uma</b> mensagem de retomada, escrita pela IA com base nas últimas mensagens daquela conversa. Nunca incomoda quem <b>já agendou</b>, quem está <b>bloqueado</b>, sob <b>controle humano</b> ou com a conversa <b>encerrada à mão</b> (🔒), e manda <b>só uma vez</b> por conversa (até a lead responder de novo).')}
        </label>
        <p class="quando" style="margin:6px 0 14px">Desativado, a SoFIA não faz retomada nenhuma. Ao <b>ligar</b>, vale <b>só daqui pra frente</b> — o acúmulo de conversas antigas não recebe (evita disparo em massa).</p>
        <div style="max-width:420px">
          <label>Esperar sem resposta</label>
          <div class="cfg-in"><input type="number" name="followupHoras" min="0.25" max="720" step="0.25" value="${e.followup.horas}"><span class="suf">horas (ex.: 24 = 1 dia)</span></div>
        </div>
        <div style="margin-top:14px;max-width:420px">
          <label>Só enviar entre${infoI('Horário permitido para a retomada. Se o prazo acima vencer <b>fora</b> desta janela (ex.: 19h50), a SoFIA <b>não manda de madrugada</b> — espera e envia no <b>próximo horário permitido</b> (ex.: 8h do dia seguinte). Nesse meio-tempo, a conversa aparece na aba <b>Conversas</b> com o selo <b>⏳ follow-up &lt;hora&gt;</b>. Horário de Brasília.')}</label>
          <div class="cfg-in" style="gap:8px"><input type="time" name="followupJanIni" value="${esc(e.followup.janelaIni)}" style="width:auto"><span class="suf">e</span><input type="time" name="followupJanFim" value="${esc(e.followup.janelaFim)}" style="width:auto"></div>
        </div>
        ${(function(){ var ks=Object.keys(fuEsperando||{}); var n=ks.length; if(!n) return ''; var h=esc(fuEsperando[ks[0]]||e.followup.janelaIni); return '<div style="margin-top:12px;background:#fdf2e0;border:1px solid #f0d9a8;border-radius:10px;padding:10px 12px"><p class="quando" style="margin:0;color:#8a6100">⏳ <b>'+n+' lead'+(n>1?'s':'')+' aguardando o horário</b> — '+(n>1?'saem':'sai')+' a partir das <b>'+h+'</b>. Venceram fora da janela; a SoFIA segura para não enviar tarde da noite. (Na aba <b>Conversas</b> aparecem com o selo ⏳.)</p></div>'; })()}
        <div style="margin-top:14px">
          <label>Instrução para a IA gerar a mensagem</label>
          <textarea name="followupInstrucao" rows="3" maxlength="1000" placeholder="Ex.: Pergunte se ela ainda tem interesse e retome o convite para a aula experimental gratuita, de forma calorosa." style="width:100%;resize:vertical">${esc(e.followup.instrucao)}</textarea>
          <p class="quando" style="margin:6px 0 0">A IA escreve a mensagem no tom da SoFIA, usando o contexto da conversa + essa orientação.</p>
        </div>
      </div>

      </details>

      <details class="acc-sec" open>
        <summary class="sec-t">💬 Prompt da SoFIA <small style="font-weight:400;color:var(--cinza)">— o roteiro (cada bloco é uma parte do atendimento; clique no título p/ abrir, ↑↓ reordenam)</small></summary>
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px">
            <button type="button" class="reset" onclick="expandirTodas(true)" style="padding:6px 12px">▾ Expandir todas</button>
            <button type="button" class="reset" onclick="expandirTodas(false)" style="padding:6px 12px">▸ Recolher todas</button>
          </div>
          <div id="secoes">${cardsSecoes}</div>
          <button type="button" class="reset" onclick="adicionarSecao()" style="margin:2px 0 0">➕ Nova seção</button>
        </div>
      </details>

      <details class="acc-sec">
        <summary class="sec-t">🔗 Script de integração <small style="font-weight:400;color:var(--cinza)">— dados enviados ao EVO</small></summary>
      <div class="card">
        <label>Extração do resumo (nome, e-mail, dia, hora)</label>
        <textarea name="extracao" rows="12" spellcheck="false">${esc(e.extracao)}</textarea>
      </div>
      </details>

      <details class="acc-sec">
        <summary class="sec-t">📷 Imagens <small style="font-weight:400;color:var(--cinza)">— troque as URLs quando atualizar a grade/preços</small></summary>
      <div class="card">
        ${inpMidia('precos_imagem', e.midias.precos_imagem, 'Imagem da TABELA DE PREÇOS (URL)')}
        ${inpMidia('precos_link', e.midias.precos_link, 'Link (Google Drive) da tabela de preços')}
        ${inpMidia('grade_imagem', e.midias.grade_imagem, 'Imagem da GRADE DE HORÁRIOS (URL)')}
        ${inpMidia('grade_link', e.midias.grade_link, 'Link (Google Drive) da grade')}
      </div>
      </details>

      <div class="hbar">
        <div class="acts">
          <button type="submit" class="save">💾 Salvar tudo</button>
          <button type="submit" class="reset" formaction="/sofia/restaurar" onclick="return confirm('Restaurar a versão anterior de TODOS os campos?')">↩️ Restaurar anterior</button>
        </div>
        <p class="quando" style="text-align:center;margin:8px 0 0">Vale nas próximas conversas — a SoFIA lê os arquivos na hora, sem reiniciar.</p>
      </div>
    </form>
  </div>
<script>
  function renderSofiaWa(st){
    var e = st && st.estado;
    if(e==='conectado') return '<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da SoFIA conectado</h2><p>A SoFIA está no ar e responde as alunas neste número.</p></div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da SoFIA</h2><p>Este é o WhatsApp <b>da SoFIA</b> (número próprio, diferente do robô de mensagens). No celular do número da SoFIA: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p><img class="qr" src="'+st.qr+'" alt="QR da SoFIA"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>';
    if(e==='iniciando') return '<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>Subindo a conexão da SoFIA. Se precisar de QR, ele aparece aqui.</p></div>';
    if(e==='desconectado') return '<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>A SoFIA caiu. Se aparecer um QR aqui, escaneie de novo.</p></div>';
    return '<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da SoFIA — sem informação</h2><p>O processo da SoFIA (sofia-listener) precisa estar rodando e publicando o estado.</p></div>';
  }
  function atualizaSofiaWa(){
    fetch('/sofia/estado',{cache:'no-store'}).then(function(r){return r.json();}).then(function(st){
      var el=document.getElementById('sofiaWa'); if(el) el.innerHTML=renderSofiaWa(st);
    }).catch(function(){});
  }
  atualizaSofiaWa(); setInterval(atualizaSofiaWa, 5000);

  // Editar seções do prompt: recolher/expandir, reordenar (↑↓), remover, adicionar.
  function toggleSecao(btn){
    var card = btn.closest('.sec-card'); if(!card) return;
    var ta = card.querySelector('textarea'); if(!ta) return;
    var aberto = ta.style.display !== 'none';
    ta.style.display = aberto ? 'none' : 'block';
    btn.textContent = aberto ? '▸' : '▾';
  }
  function moverSecao(btn, dir){
    var card = btn.closest('.sec-card'); if(!card || !card.parentNode) return;
    var wrap = card.parentNode;
    if(dir < 0){ var prev = card.previousElementSibling; if(prev) wrap.insertBefore(card, prev); }
    else { var next = card.nextElementSibling; if(next) wrap.insertBefore(next, card); }
    card.scrollIntoView({block:'nearest'});
  }
  function expandirTodas(abrir){
    var cards = document.querySelectorAll('#secoes .sec-card');
    for(var i=0;i<cards.length;i++){
      var ta = cards[i].querySelector('textarea'), tog = cards[i].querySelector('.secTog');
      if(ta){ ta.style.display = abrir ? 'block' : 'none'; }
      if(tog){ tog.textContent = abrir ? '▾' : '▸'; }
    }
  }
  function removerSecao(btn){
    if(!confirm('Remover esta seção inteira? (título e conteúdo)')) return;
    var card = btn.closest('.sec-card'); if(card && card.parentNode) card.parentNode.removeChild(card);
  }
  function adicionarSecao(){
    var wrap = document.getElementById('secoes'); if(!wrap) return;
    var div = document.createElement('div');
    div.className = 'card sec-card';
    // Nova seção já ENTRA ABERTA (o textarea visível) para você digitar de cara.
    div.innerHTML = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">'
      + '<button type="button" class="reset secTog" onclick="toggleSecao(this)" title="Expandir/recolher" style="padding:6px 9px;flex:none">▾</button>'
      + '<input type="text" name="titulo[]" value="" placeholder="TÍTULO DA SEÇÃO" style="flex:1;min-width:0;font-weight:700;font-family:Montserrat,sans-serif;font-size:.9rem">'
      + '<button type="button" class="reset" onclick="moverSecao(this,-1)" title="Subir" style="padding:6px 9px;flex:none">↑</button>'
      + '<button type="button" class="reset" onclick="moverSecao(this,1)" title="Descer" style="padding:6px 9px;flex:none">↓</button>'
      + '<button type="button" class="reset" onclick="removerSecao(this)" title="Remover esta seção" style="padding:6px 10px;flex:none">🗑️</button>'
      + '</div><textarea name="corpo[]" rows="6" spellcheck="false" style="display:block"></textarea>';
    wrap.appendChild(div);
    var inp = div.querySelector('input'); if(inp) inp.focus();
  }
</script>`;
  return chrome({ tab: 'SoFIA', h1: '🤖 SoFIA', p: 'Edite o prompt, as configurações e conecte o WhatsApp da SoFIA.' }, 'sofia', corpo);
}

// Página de login (sem menu). Simples: usuário + senha.
function paginaLogin(erro) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · SlimFit</title>
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Open+Sans:wght@400;500;600;700&display=swap">
<style>${ESTILO}
  .loginwrap{max-width:380px;margin:8vh auto;padding:16px}
  .loginwrap .logo-box{background:var(--teal);border-radius:14px;padding:14px 16px;text-align:center;margin-bottom:18px}
  .loginwrap .logo-box img{height:34px}
  .loginwrap .card{padding:22px}
  .loginwrap h1{font-family:Montserrat;font-size:1.2rem;margin:0 0 4px;text-align:center}
  .loginwrap p.sub{color:var(--cinza);font-size:.86rem;text-align:center;margin:0 0 12px}
  .loginwrap button{width:100%;margin-top:16px}
</style></head><body>
<div class="loginwrap">
  <div class="logo-box"><img alt="SlimFit Studio" src="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/logo-com-contraste.svg"></div>
  <div class="card">
    <h1>Painel do Studio</h1>
    <p class="sub">Entre com o seu usuário e senha.</p>
    ${erro ? `<div class="aviso err" style="margin:0 0 12px">${esc(erro)}</div>` : ''}
    <form method="POST" action="/login">
      <label>Usuário</label>
      <input type="text" name="usuario" autofocus autocapitalize="none" autocomplete="username" spellcheck="false">
      <label>Senha</label>
      <input type="password" name="senha" autocomplete="current-password" style="width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:11px 12px;font-size:1rem;font-family:inherit;background:#fff">
      <button type="submit" class="save">Entrar</button>
    </form>
  </div>
  <footer>SlimFit · painel do Studio</footer>
</div></body></html>`;
}

// Aba "Perfis" (só admin): cria usuários, define telas, senha e exclui.
function paginaPerfis(aviso, erro) {
  const lista = usuarios.listar();
  const umChk = (t, marcadas, prefixo) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:600;font-size:var(--fs-sm);cursor:pointer;white-space:nowrap"><input type="checkbox" name="${prefixo}" value="${t.key}"${(marcadas || []).includes(t.key) ? ' checked' : ''} style="width:15px;height:15px;margin:0"> ${t.rot}</label>`;
  const chkTelas = (marcadas, prefixo) => {
    const soltas = usuarios.TELAS.filter(t => !t.grupo);
    const grupos = {};
    for (const t of usuarios.TELAS) if (t.grupo) (grupos[t.grupo] = grupos[t.grupo] || []).push(t);
    const linha = `<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${soltas.map(t => umChk(t, marcadas, prefixo)).join('')}</div>`;
    const gs = Object.keys(grupos).map(g => `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin-top:7px"><span style="font-weight:700;font-size:var(--fs-xs);color:var(--teal-esc);min-width:84px">${g}</span>${grupos[g].map(t => umChk(t, marcadas, prefixo)).join('')}</div>`).join('');
    return linha + gs;
  };

  const cardsUsuarios = lista.length ? lista.map(u => `
    <div class="card" style="margin-bottom:8px">
      <form method="POST" action="/perfis/telas">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-weight:700;font-size:var(--fs-h2)">${esc(u.usuario)}</span>
          <span class="quando" style="margin:0">${(u.telas || []).length} tela(s)</span>
        </div>
        <input type="hidden" name="usuario" value="${esc(u.usuario)}">
        <div style="margin:0 0 10px">${chkTelas(u.telas, 'telas')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding-top:10px;border-top:1px dashed var(--linha)">
          <button type="submit" class="save" style="padding:6px 13px">Salvar telas</button>
          <input type="text" name="senha" placeholder="nova senha" style="width:140px" form="sn-${esc(u.usuario)}">
          <button type="submit" class="reset" form="sn-${esc(u.usuario)}" style="padding:6px 13px">Redefinir senha</button>
          <button type="submit" class="reset" formaction="/perfis/excluir" onclick="return confirm('Excluir o usuário ${esc(u.usuario)}?')" style="padding:6px 13px;margin-left:auto">Excluir</button>
        </div>
      </form>
      <form method="POST" action="/perfis/senha" id="sn-${esc(u.usuario)}" style="display:none"><input type="hidden" name="usuario" value="${esc(u.usuario)}"></form>
    </div>`).join('') : '<p class="vazio">Nenhum usuário criado ainda. Crie o primeiro abaixo.</p>';

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    <div class="sec-t">➕ Novo usuário</div>
    <div class="card">
      <form method="POST" action="/perfis/criar">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px"><label>Usuário</label><input type="text" name="usuario" autocapitalize="none" spellcheck="false" placeholder="ex.: recepcao"></div>
          <div style="flex:1;min-width:160px"><label>Senha</label><input type="text" name="senha" placeholder="senha inicial"></div>
        </div>
        <label style="margin-top:12px">Telas que este usuário pode acessar</label>
        <div style="margin:4px 0 2px">${chkTelas([], 'telas')}</div>
        <div class="acts"><button type="submit" class="save">Criar usuário</button></div>
        <p class="quando" style="margin:8px 0 0">O usuário entra com esse login e senha na hora — sem reiniciar. A senha pode ser trocada depois aqui mesmo.</p>
      </form>
    </div>

    <div class="sec-t">👥 Usuários</div>
    <div class="card" style="background:#f3fbfb;border-color:#bfe8e7"><p class="quando" style="margin:0">🔑 <b>Admin</b> (do sistema): <b>${esc(USER)}</b> — vê todas as telas e gerencia os Perfis. Para trocar a senha do admin, altere <code>PAINEL_SENHA</code> no <code>.env</code>.</p></div>
    ${cardsUsuarios}
  </div>`;
  return chrome({ tab: 'Perfis', h1: '👤 Perfis', p: 'Crie usuários e escolha quais telas cada um pode acessar.' }, 'perfis', corpo);
}

// Página "sem acesso" (usuário logado tentando uma tela não liberada).
function negarAcesso(res, sess) {
  const destino = primeiraTela(sess);
  const corpo = `<div class="wrap"><div class="card" style="text-align:center;padding:28px">
    <div style="font-size:2rem">🔒</div>
    <h2 style="margin:8px 0">Você não tem acesso a esta tela</h2>
    <p class="quando">Fale com o administrador se precisar deste acesso.</p>
    ${destino ? `<a href="${destino}" style="display:inline-block;margin-top:10px;background:var(--coral);color:#fff;border-radius:999px;padding:10px 20px;font-weight:700;text-decoration:none">Voltar ao painel</a>` : `<a href="/logout" style="display:inline-block;margin-top:10px;color:var(--cinza);text-decoration:underline">Sair</a>`}
  </div></div>`;
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(chrome({ tab: 'Sem acesso', h1: 'SlimFit', p: 'Painel do Studio.' }, '', corpo));
}

function lerCorpo(req, limite, cb) {
  let corpo = '';
  req.on('data', c => { corpo += c; if (corpo.length > limite) req.destroy(); });
  req.on('end', () => cb(corpo));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  _navSess = null;

  // ── Login / logout (rotas públicas) ──────────────────────────────────────
  if (url === '/login') {
    if (req.method === 'GET') {
      const jaLogado = usuarioDaReq(req);
      if (jaLogado) { res.writeHead(303, { Location: primeiraTela(jaLogado) || '/hoje' }); return res.end(); }
      const e = /(?:^|&)e=1/.test(req.url.split('?')[1] || '') ? 'Usuário ou senha incorretos.' : '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaLogin(e));
    }
    if (req.method === 'POST') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        const ok = validarLogin(p.get('usuario'), p.get('senha') || '');
        if (!ok) { res.writeHead(303, { Location: '/login?e=1' }); return res.end(); }
        setCookieSessao(req, res, criarToken(ok.usuario), SESSAO_DIAS * 86400);
        const sess = { admin: ok.admin, telas: ok.admin ? TODAS_TELAS : (usuarios.obter(ok.usuario) || { telas: [] }).telas };
        res.writeHead(303, { Location: primeiraTela(sess) || '/hoje' }); res.end();
      });
    }
  }
  if (url === '/logout') {
    setCookieSessao(req, res, '', 0);
    res.writeHead(303, { Location: '/login' }); return res.end();
  }

  // ── Exige login ──────────────────────────────────────────────────────────
  const sess = usuarioDaReq(req);
  if (!sess) {
    if (req.method === 'GET') { res.writeHead(303, { Location: '/login' }); return res.end(); }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Faça login.');
  }
  _navSess = sess;

  // ── Autorização por tela ─────────────────────────────────────────────────
  const tela = telaDaUrl(url);
  if (tela === 'perfis') { if (!sess.admin) return negarAcesso(res, sess); }
  else if (tela === 'sofia') {
    if (!sess.admin) {
      if (req.method === 'GET' && url === '/sofia') { if (!temSofia(sess)) return negarAcesso(res, sess); }
      else if (!sofiaRotaPermitida(sess, url)) return negarAcesso(res, sess);
    }
  }
  else if (tela === 'msg') {
    if (!sess.admin) {
      if (req.method === 'GET' && url === '/') { if (!temMsg(sess)) return negarAcesso(res, sess); }
      else if (!msgRotaPermitida(sess, url, req.url)) return negarAcesso(res, sess);
    }
  }
  else if (tela && !sess.admin && !(sess.telas || []).includes(tela)) return negarAcesso(res, sess);

  // ── Perfis (só admin — já barrado acima) ─────────────────────────────────
  if (tela === 'perfis') {
    if (req.method === 'GET' && url === '/perfis') {
      const q = req.url.split('?')[1] || '';
      let aviso = '', erro = false;
      if (/(?:^|&)ok=criado/.test(q)) aviso = 'Usuário criado! Já pode entrar.';
      else if (/(?:^|&)ok=telas/.test(q)) aviso = 'Telas atualizadas.';
      else if (/(?:^|&)ok=senha/.test(q)) aviso = 'Senha redefinida.';
      else if (/(?:^|&)ok=excluido/.test(q)) aviso = 'Usuário excluído.';
      else if (/(?:^|&)err=/.test(q)) { aviso = decodeURIComponent((q.match(/err=([^&]*)/) || [])[1] || 'Erro.'); erro = true; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaPerfis(aviso, erro));
    }
    if (req.method === 'POST' && url === '/perfis/criar') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { usuarios.criar({ usuario: p.get('usuario'), senha: p.get('senha') || '', telas: p.getAll('telas') }); res.writeHead(303, { Location: '/perfis?ok=criado' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/telas') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        usuarios.definirTelas(p.get('usuario'), p.getAll('telas'));
        res.writeHead(303, { Location: '/perfis?ok=telas' }); res.end();
      });
    }
    if (req.method === 'POST' && url === '/perfis/senha') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { usuarios.definirSenha(p.get('usuario'), p.get('senha') || ''); res.writeHead(303, { Location: '/perfis?ok=senha' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/excluir') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        usuarios.remover(p.get('usuario'));
        res.writeHead(303, { Location: '/perfis?ok=excluido' }); res.end();
      });
    }
  }

  // Página de mensagens
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Mensagem salva! Já vale no próximo envio.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horários salvos e robô reiniciado. Já valem.';
    else if (/(?:^|&)dcon=1/.test(q)) aviso = '🔌 Desconexão solicitada. O robô vai encerrar a sessão e, em alguns segundos, mostrar um QR novo aqui para reconectar.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horários salvos, mas não consegui reiniciar o robô automaticamente. Rode no servidor: pm2 restart slimfit-exp'; erro = true; }
    // Só a sub-aba permitida; se pediu uma sem acesso, cai na primeira permitida.
    let view = /(?:^|&)view=agendar/.test(q) ? 'agendar' : 'config';
    if (!podeMsgSub(sess, view)) view = ['config', 'agendar', 'hoje'].find(s => podeMsgSub(sess, s)) || 'config';
    if (view === 'hoje') { res.writeHead(303, { Location: '/hoje' }); return res.end(); } // só tem Hoje → vai pra lá
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (view === 'agendar') return res.end(paginaAgendar(aviso, erro)); // sub-aba Agendamento
    return res.end(paginaMensagens(aviso, erro));
  }
  if (req.method === 'POST' && url === '/salvar') {
    return lerCorpo(req, 1e6, corpo => {
      const p = new URLSearchParams(corpo);
      const voltar = p.get('voltar') === '/instagram' ? '/instagram' : '/'; // whitelist
      try {
        if (p.get('reset')) mensagens.salvarOverride(p.get('chave'), '');
        else mensagens.salvarOverride(p.get('chave'), p.get('texto') || '');
        res.writeHead(303, { Location: voltar + '?ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        const msg = 'Erro ao salvar: ' + e.message;
        res.end(voltar === '/instagram' ? paginaInstagram(msg, true) : paginaMensagens(msg, true));
      }
    });
  }

  // Foto (flyer) de uma mensagem: salvar / remover / servir.
  if (req.method === 'POST' && url === '/mensagem/foto/salvar') {
    return lerCorpo(req, 12e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        mensagens.salvarFoto(d.chave, d.fotoDataUrl);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'POST' && url === '/mensagem/foto/remover') {
    return lerCorpo(req, 1e5, corpo => {
      try { mensagens.removerFoto(JSON.parse(corpo || '{}').chave); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
    });
  }
  if (req.method === 'GET' && url === '/mensagem/foto') {
    const chave = new URLSearchParams(req.url.split('?')[1] || '').get('chave');
    const caminho = /^[a-z_]+$/i.test(chave || '') ? mensagens.fotoPath(chave) : null;
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('nao encontrada'); }
    const ext = caminho.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=60' });
    return fs.createReadStream(caminho).pipe(res);
  }

  // Enviar teste: painel grava o pedido; o robô (que tem a sessão) envia.
  if (req.method === 'POST' && url === '/teste/enviar') {
    return lerCorpo(req, 1e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const textoFinal = mensagens.renderTexto(d.texto || '', mensagens.EXEMPLOS);
        const id = teste.solicitar({ telefone: d.telefone, texto: textoFinal });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'GET' && url === '/teste/status') {
    const id = new URLSearchParams(req.url.split('?')[1] || '').get('id');
    const p = teste.ler(id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(p ? { status: p.status, erro: p.erro } : { status: 'desconhecido' }));
  }

  // Página de agendamentos
  if (req.method === 'GET' && (url === '/agendar')) {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Agendamento salvo! Será enviado no dia e turno escolhidos.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horários salvos e robô reiniciado. Já valem.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horários salvos, mas não consegui reiniciar o robô automaticamente. Rode no servidor: pm2 restart slimfit-exp'; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaAgendar(aviso, erro));
  }
  if (req.method === 'POST' && url === '/agendar/salvar') {
    return lerCorpo(req, 12e6, corpo => { // base64 da foto cabe aqui (~10-12 MB)
      try {
        const d = JSON.parse(corpo || '{}');
        if (d.id) ag.atualizar(d.id, { telefone: d.telefone, mensagem: d.mensagem, fotoDataUrl: d.fotoDataUrl, temFoto: !!d.temFoto, turno: d.turno, data: d.data });
        else ag.adicionar({ telefone: d.telefone, mensagem: d.mensagem, fotoDataUrl: d.fotoDataUrl, turno: d.turno, data: d.data });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'POST' && url === '/agendar/remover') {
    return lerCorpo(req, 1e5, corpo => {
      try { ag.remover(new URLSearchParams(corpo).get('id')); } catch (_) {}
      res.writeHead(303, { Location: '/agendar' }); res.end();
    });
  }
  if (req.method === 'GET' && url === '/agendar/foto') {
    const nome = new URLSearchParams(req.url.split('?')[1] || '').get('nome');
    const caminho = ag.caminhoFoto(nome);
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('nao encontrada'); }
    const ext = nome.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(caminho).pipe(res);
  }

  // /horarios agora vive dentro da aba Mensagens — redireciona quem tiver link antigo.
  if (req.method === 'GET' && url === '/horarios') {
    res.writeHead(301, { Location: '/' }); return res.end();
  }
  if (req.method === 'POST' && url === '/horarios/salvar') {
    return lerCorpo(req, 1e6, corpo => {
      const p = new URLSearchParams(corpo);
      const vRaw = p.get('voltar');
      const voltar = (vRaw === '/agendar' || vRaw === '/instagram') ? vRaw : '/'; // whitelist
      try {
        // Valida TUDO antes de salvar qualquer coisa (build lança em entrada inválida).
        const planos = horarios.CATALOGO.map(j => {
          const hora = p.get('hora_' + j.chave);
          if (hora == null) return null; // job não presente no form → mantém como está
          const dias = p.getAll('dias_' + j.chave).map(Number);
          horarios.build(hora, dias); // valida (lança se inválido)
          return { chave: j.chave, hora, dias };
        }).filter(Boolean);
        planos.forEach(pl => horarios.salvar(pl.chave, pl.hora, pl.dias));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        const msg = 'Erro ao salvar horários: ' + e.message + ' (nada foi alterado).';
        return res.end(voltar === '/agendar' ? paginaAgendar(msg, true) : voltar === '/instagram' ? paginaInstagram(msg, true) : paginaMensagens(msg, true));
      }
      // Reinicia o robô para reagendar os jobs com os novos horários.
      exec('pm2 restart slimfit-exp --update-env', { timeout: 25000 }, (err) => {
        res.writeHead(303, { Location: voltar + (err ? '?errh=1' : '?okh=1') }); res.end();
      });
    });
  }

  // Página de indicadores do formulário
  if (req.method === 'GET' && url === '/indicadores') {
    const sp2 = new URLSearchParams(req.url.split('?')[1] || '');
    const d = sp2.get('dias');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaIndicadores(d == null ? 7 : parseInt(d, 10), sp2.get('erro') || ''));
  }
  // Criar / excluir canal de origem (gerador de links).
  if (req.method === 'POST' && url === '/origens/criar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      let ok = true, msg = '';
      try { origens.criar({ rot: p.get('rot'), desc: p.get('desc') }); } catch (e) { ok = false; msg = e.message; }
      res.writeHead(303, { Location: '/indicadores' + (ok ? '' : '?erro=' + encodeURIComponent(msg)) }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/origens/excluir') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try { origens.remover(p.get('slug')); } catch (_) {}
      res.writeHead(303, { Location: '/indicadores' }); res.end();
    });
  }

  // Página "Hoje" (o que o robô enviou)
  if (req.method === 'GET' && url === '/hoje') {
    const dia = new URLSearchParams(req.url.split('?')[1] || '').get('dia');
    const valido = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : null;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaHoje(valido));
  }

  // Aba Sofia (chatbot): prompt, configs e conexão
  if (req.method === 'GET' && url === '/sofia') {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Salvo! As próximas conversas já usam estas configurações.';
    else if (/(?:^|&)on=1/.test(q)) aviso = '🟢 SoFIA ativada — voltou a responder as alunas.';
    else if (/(?:^|&)off=1/.test(q)) aviso = '⏸️ SoFIA pausada — atenda manualmente pelo WhatsApp.';
    else if (/(?:^|&)rest=1/.test(q)) aviso = 'Restaurado para a versão anterior.';
    else if (/(?:^|&)rest=0/.test(q)) { aviso = 'Não havia versão anterior para restaurar.'; erro = true; }
    else if (/(?:^|&)ctok=1/.test(q)) aviso = 'Tags salvas.';
    else if (/(?:^|&)dcon=1/.test(q)) aviso = '🔌 Desconexão solicitada. A SoFIA vai encerrar a sessão e, em alguns segundos, mostrar um QR novo aqui para reconectar.';
    else if (/(?:^|&)okc=criada/.test(q)) aviso = '📣 Campanha criada! A IA está gerando as variações. Quando ficar “pronta”, clique em ▶️ Iniciar para começar o envio.';
    else if (/(?:^|&)okc=ok/.test(q)) aviso = '✔️ Feito.';
    else if (/(?:^|&)errc=/.test(q)) { aviso = decodeURIComponent((q.match(/errc=([^&]*)/) || [])[1] || 'Erro na campanha.'); erro = true; }
    const sp = new URLSearchParams(q);
    // Só renderiza a sub-aba que o usuário pode ver; se pediu uma sem acesso,
    // cai na primeira permitida (config → conversas → contatos).
    let view = sp.get('view') || 'config';
    if (!podeSofiaSub(sess, view)) view = SOFIA_SUBS.find(s => podeSofiaSub(sess, s)) || 'config';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (view === 'contatos') return res.end(paginaSofiaContatos(aviso, erro, { q: sp.get('q') || '', tag: sp.get('tag') || '', pagina: sp.get('pagina') || 0 }));
    if (view === 'conversas') return res.end(paginaSofiaConversas(aviso, erro));
    if (view === 'campanhas') return res.end(paginaSofiaCampanhas(aviso, erro));
    return res.end(paginaSofia(aviso, erro));
  }
  // Modelo de CSV para baixar (cabeçalho + exemplos) — ajuda a montar a planilha.
  if (req.method === 'GET' && url === '/sofia/contatos/modelo.csv') {
    const linhas = [
      'Nome,Telefone,Instruções personalizadas,Tags',
      'Maria Silva,+55 (62) 99999-0000,Prefere treinar de manhã,Aluna ou Ex Aluna',
      'Joana Souza,+55 62 98888-1111,,FX 4 - Feito;Equipe',
      'Ana,55 61 97777-2222,,',
    ];
    const csv = '﻿' + linhas.join('\r\n') + '\r\n'; // BOM p/ Excel abrir com acento certo
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="modelo-contatos-slimfit.csv"',
      'Cache-Control': 'no-store',
    });
    return res.end(csv);
  }
  // Exportar TODA a base de contatos em CSV (para migrar de plataforma / backup).
  if (req.method === 'GET' && url === '/sofia/contatos/exportar') {
    let csv = '﻿Nome,Telefone,Instruções personalizadas,Tags\r\n';
    try { csv = contatos.exportarCSV(); } catch (_) {}
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contatos-slimfit-${hoje}.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.end(csv);
  }
  // Importar contatos (CSV enviado pelo painel, lido no navegador e postado como JSON).
  if (req.method === 'POST' && url === '/sofia/contatos/importar') {
    return lerCorpo(req, 20e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const resumo = contatos.importarCSV(d.csv || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, resumo }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Volta para a lista de contatos preservando busca/filtro/página.
  const voltarContatos = (p, res) => {
    const back = new URLSearchParams(); back.set('view', 'contatos');
    if (p.get('q')) back.set('q', p.get('q')); if (p.get('tag')) back.set('tag', p.get('tag'));
    back.set('pagina', p.get('pagina') || 0); back.set('ctok', '1');
    res.writeHead(303, { Location: '/sofia?' + back.toString() }); res.end();
  };
  // Salvar (editar nome/telefone/tags) OU excluir um contato.
  if (req.method === 'POST' && url === '/sofia/contatos/salvar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        if (p.get('acao') === 'excluir') contatos.remover(p.get('telOrig'));
        else contatos.editarContato(p.get('telOrig'), { nome: p.get('nome'), telefone: p.get('telefone'), tags: p.get('tags') || '' });
      } catch (_) {}
      voltarContatos(p, res);
    });
  }
  // Bloquear / desbloquear um contato (a Sofia ignora quem está bloqueado).
  if (req.method === 'POST' && url === '/sofia/contatos/bloquear') {
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const tel = String(d.tel || '').trim();
      if (!tel) return res.end(JSON.stringify({ ok: false, erro: 'faltou o telefone' }));
      try { const bl = sofia.setBloqueio(tel, !!d.ativo); res.end(JSON.stringify({ ok: true, bloqueado: bl })); }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Renomear/excluir uma tag em TODOS os contatos.
  if (req.method === 'POST' && url === '/sofia/contatos/tag') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        if (p.get('acao') === 'excluir') contatos.excluirTag(p.get('de'));
        else contatos.renomearTag(p.get('de'), p.get('para'));
      } catch (_) {}
      voltarContatos(p, res);
    });
  }
  // Salvar a automação de uma tag (gatilho + palavras + avisar no WhatsApp).
  if (req.method === 'POST' && url === '/sofia/contatos/tagcfg') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        contatos.definirTagConfig(d.tag, { gatilho: d.gatilho || '', palavras: d.palavras || [], avisarWpp: d.avisarWpp || '', remove: d.remove || [] });
        try { publicarRegras(); } catch (_) {} // atualiza o listener na hora
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Criar uma tag nova (fica "conhecida" mesmo sem contato ainda).
  if (req.method === 'POST' && url === '/sofia/contatos/criar-tag') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const nome = contatos.criarTag(d.nome);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, nome }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Salvar/atualizar um contato direto de uma conversa (cria se novo) e DEFINE as
  // tags exatamente como vieram (permite adicionar e remover no cabeçalho do chat).
  if (req.method === 'POST' && url === '/sofia/contatos/salvar-novo') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const c = contatos.adicionar({ nome: d.nome, telefone: d.telefone }); // cria/atualiza (sem mexer nas tags)
        contatos.setTags(d.telefone, d.tags || []);                            // DEFINE as tags (substitui)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, tel: c.tel }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Inbox das conversas da Sofia (JSON) — a aba Conversas atualiza sozinha com isto.
  if (req.method === 'GET' && url === '/sofia/conversas') {
    let obj = {};
    try { obj = sofia.conversas() || {}; } catch (_) {}
    try { const cmap = contatos.carregar(); for (const k in obj) { const c = cmap[contatos.normTel(k)]; obj[k].salvo = !!c; obj[k].tagsContato = c ? (c.tags || []) : []; } } catch (_) {} // salvo? + tags do contato
    try { const hum = sofia.lerHumano(); for (const k in obj) obj[k].humano = !!hum[k]; } catch (_) {} // controle humano por conversa
    try { for (const k in obj) obj[k].bloq = sofia.estaBloqueado(k); } catch (_) {} // contato bloqueado?
    try { for (const k in obj) obj[k].enc = sofia.estaEncerrada(k, obj[k].ultimaEm); } catch (_) {} // encerrada à mão (cadeado)?
    try { for (const k in obj) obj[k].fuEspera = fuEsperando[k] || ''; } catch (_) {} // follow-up pronto, segurando pelo horário?
    let wa = ''; try { wa = (sofia.waStatus() || {}).estado || ''; } catch (_) {} // online/off-line do WhatsApp da SoFIA
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ conv: obj, wa }));
  }
  // Interações (histórico de sessões) de UM contato — aba Contatos → Interações.
  if (req.method === 'GET' && url === '/sofia/contatos/interacoes') {
    const tel = (new URLSearchParams(req.url.split('?')[1] || '')).get('tel') || '';
    const alvo = String(tel).replace(/\D/g, '');
    const ult8 = s => { const d = String(s).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : d; };
    let hist = {};
    try { hist = sofia.historico() || {}; } catch (_) {}
    let achado = null;
    for (const k in hist) { if (k.replace(/\D/g, '') === alvo || (ult8(k) && ult8(k) === ult8(alvo))) { achado = hist[k]; break; } }
    const sessoes = achado ? (achado.sessoes || []).slice().sort((a, b) => (b.inicioEm || 0) - (a.inicioEm || 0)) : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, nome: achado ? achado.nome : '', sessoes }));
  }
  // Encerrar UMA conversa à mão (mesmo efeito de esperar o tempo da sessão, só que
  // agora): marca o cadeado, a SoFIA recomeça do zero quando a aluna voltar
  // (sofia.ts lê sofia-encerradas.json) e o follow-up deixa de incomodar.
  if (req.method === 'POST' && url === '/sofia/conversas/encerrar') {
    return lerCorpo(req, 1e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'sem conversa' }));
      try { sofia.setEncerrada(chave, true); return res.end(JSON.stringify({ ok: true })); }
      catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Liga/desliga o controle humano de UMA conversa (a Sofia para de responder só ela).
  if (req.method === 'POST' && url === '/sofia/humano') {
    return lerCorpo(req, 1e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'sem conversa' }));
      try {
        const ativo = sofia.setControleHumano(chave, !!d.ativo);
        // Gatilho 'humano' (estado): ao ASSUMIR aplica a tag + avisa; ao DEVOLVER
        // à SoFIA, remove a tag (é um marcador de "sob controle humano agora").
        try {
          const autos = contatos.tagsPorGatilho('humano');
          if (autos.length) {
            if (ativo) {
              let nome = '';
              try { const c = contatos.carregar()[contatos.normTel(chave)]; if (c) nome = c.nome || ''; } catch (_) {}
              for (const a of autos) aplicarAutomacao({ telefone: chave, nome, tag: a.tag, avisarWpp: a.avisarWpp, motivo: 'humano' });
            } else {
              for (const a of autos) { try { contatos.removerTag(chave, a.tag); } catch (_) {} }
            }
          }
        } catch (_) {}
        res.end(JSON.stringify({ ok: true, ativo }));
      }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Responder uma conversa pelo painel: enfileira para o listener da Sofia enviar
  // pelo WhatsApp (e assumir a conversa, pausando a Sofia nela).
  if (req.method === 'POST' && url === '/sofia/responder') {
    return lerCorpo(req, 12e6, corpo => { // cabe a foto anexada em base64 (~10-12 MB)
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      const jid = String(d.jid || '').trim();
      const texto = String(d.texto || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'faltou destinatário' }));
      // Pode enviar só texto, só foto (com ou sem legenda), ou os dois.
      if (!texto && !d.fotoBase64) return res.end(JSON.stringify({ ok: false, erro: 'faltou texto ou foto' }));
      let fotoArquivo = '';
      if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoResposta(d.fotoBase64); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Foto: ' + e.message })); } }
      try { sofia.enfileirarResposta(chave, jid, texto, fotoArquivo); res.end(JSON.stringify({ ok: true })); }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Serve a foto que VOCÊ enviou numa resposta manual (mostrada na bolha do chat).
  // Os arquivos ficam em ChatBot/humano-fotos/ (mesma máquina do listener).
  if (req.method === 'GET' && url === '/sofia/humano-foto') {
    const arq = new URLSearchParams(req.url.split('?')[1] || '').get('arq') || '';
    if (!/^[\w.-]+$/.test(arq) || arq.includes('..')) { res.writeHead(400); return res.end('nome inválido'); }
    const caminho = path.join(sofia.DIR, 'humano-fotos', arq);
    if (!fs.existsSync(caminho)) { res.writeHead(404); return res.end('não encontrada'); }
    const ext = arq.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(caminho).pipe(res);
  }
  if (req.method === 'POST' && url === '/sofia/salvar') {
    return lerCorpo(req, 4e6, corpo => {
      const p = new URLSearchParams(corpo);
      // Seções chegam como arrays paralelos titulo[]/corpo[] (permite adicionar e
      // remover seções pelo painel). Ignora seções totalmente vazias.
      const titulos = p.getAll('titulo[]');
      const corpos = p.getAll('corpo[]');
      const secoes = [];
      for (let i = 0; i < titulos.length; i++) {
        const t = (titulos[i] || '').trim();
        const c = corpos[i] || '';
        if (!t && !c.trim()) continue; // seção vazia (card novo não preenchido) — descarta
        secoes.push({ titulo: t || ('SEÇÃO ' + (i + 1)), corpo: c });
      }
      try {
        sofia.salvar({
          secoes,
          extracao: p.get('extracao') || '',
          pausaMin: p.get('pausaMin') || '30',
          sessaoHoras: p.get('sessaoHoras') || '12',
          healthMin: p.get('healthMin') != null ? p.get('healthMin') : '3',
          agruparSeg: p.get('agruparSeg') != null ? p.get('agruparSeg') : '7',
          followup: { on: p.get('followupOn') === '1', horas: p.get('followupHoras') || '24', instrucao: p.get('followupInstrucao') || '', janelaIni: p.get('followupJanIni') || '08:00', janelaFim: p.get('followupJanFim') || '19:00' },
          modelos: { conversa: p.get('modeloConversa') || '', extracao: p.get('modeloExtracao') || '' },
          transcricaoOn: p.get('transcricaoOn') === '1',
          midias: {
            grade_imagem: (p.get('grade_imagem') || '').trim(),
            grade_link: (p.get('grade_link') || '').trim(),
            precos_imagem: (p.get('precos_imagem') || '').trim(),
            precos_link: (p.get('precos_link') || '').trim(),
          },
          ritmo: {
            humano: p.get('ritHumano') === '1',
            msPorChar: p.get('ritMsPorChar') || '45',
            delayMin: p.get('ritDelayMin') || '1200',
            delayMax: p.get('ritDelayMax') || '4500',
          },
        });
        try { const el = p.get('expLimite'); if (el != null && el !== '') gravarExpLimite(el); } catch (_) {}
        res.writeHead(303, { Location: '/sofia?ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaSofia('Não salvei: ' + e.message, true));
      }
    });
  }
  if (req.method === 'POST' && url === '/sofia/restaurar') {
    return lerCorpo(req, 1e5, () => {
      let ok = false; try { ok = sofia.restaurar(); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?rest=' + (ok ? '1' : '0') }); res.end();
    });
  }
  // Estado do WhatsApp da Sofia (JSON) — o bloco de conexão atualiza só ele,
  // sem recarregar a página (não apaga o que estiver sendo editado no prompt).
  if (req.method === 'GET' && url === '/sofia/estado') {
    const st = sofia.waStatus() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ estado: st.estado || '', qr: st.qr || '', atualizadoEm: st.atualizadoEm || '' }));
  }
  if (req.method === 'POST' && url === '/sofia/toggle') {
    return lerCorpo(req, 1e5, () => {
      let novo = true;
      try { novo = !sofia.estadoAtivo(); sofia.gravarEstado(novo); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?' + (novo ? 'on=1' : 'off=1') }); res.end();
    });
  }
  // Desconectar o WhatsApp da Sofia (envia comando ao listener → logout + reinicia → QR novo).
  if (req.method === 'POST' && url === '/sofia/desconectar') {
    return lerCorpo(req, 1e5, () => {
      try { sofia.enviarComando('logout'); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?dcon=1' }); res.end();
    });
  }
  // Criar campanha (JSON, para levar a foto em base64): resolve os contatos da tag,
  // salva a foto (se houver) e enfileira o pedido para o listener.
  if (req.method === 'POST' && url === '/sofia/campanhas/criar') {
    return lerCorpo(req, 14e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const tag = String(d.tag || '').trim();
      const textoBase = String(d.textoBase || '').trim();
      const nome = String(d.nome || '').trim() || 'Campanha';
      try {
        if (!tag || !textoBase) throw new Error('Preencha a tag e a mensagem.');
        const alvo = contatos.listar({ tag, pagina: 0, porPagina: 100000 });
        const destinatarios = (alvo.itens || []).map(c => ({ tel: c.tel, nome: c.nome || '' })).filter(x => x.tel);
        if (!destinatarios.length) throw new Error('Nenhum contato com essa tag.');
        const id = 'c' + Date.now();
        let fotoArquivo = '';
        if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoCampanha(id, d.fotoBase64); } catch (e) { throw new Error('Foto: ' + e.message); } }
        sofia.opCampanha({
          op: 'criar',
          campanha: {
            id, nome, tag, textoBase,
            limiteDia: String(d.limiteDia || '40'), delayMinSeg: String(d.delayMinSeg || '25'), delayMaxSeg: String(d.delayMaxSeg || '70'),
            janelaIni: String(d.janelaIni || '09:00'), janelaFim: String(d.janelaFim || '20:00'),
            dataInicio: String(d.dataInicio || hojeSP()),
            fotoArquivo, destinatarios,
          },
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Enviar teste da campanha (JSON): manda a mensagem+foto para um número seu.
  if (req.method === 'POST' && url === '/sofia/campanhas/teste') {
    return lerCorpo(req, 14e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const telefone = String(d.telefone || '').replace(/\D/g, '');
      const texto = String(d.texto || '').trim();
      try {
        if (telefone.length < 10) throw new Error('Número inválido.');
        if (!texto) throw new Error('Mensagem vazia.');
        let fotoArquivo = '';
        if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoCampanha('teste-' + Date.now(), d.fotoBase64); } catch (e) { throw new Error('Foto: ' + e.message); } }
        sofia.opCampanha({ op: 'teste', telefone, texto, fotoArquivo });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Fragmento HTML só da lista de campanhas — o painel busca a cada poucos segundos
  // para atualizar o progresso sem recarregar a página inteira.
  if (req.method === 'GET' && url === '/sofia/campanhas/lista') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    try { return res.end(campListHTML()); } catch (_) { return res.end(''); }
  }
  // Detalhe de UMA campanha: quem já recebeu, quem está na fila e as falhas.
  if (req.method === 'GET' && url === '/sofia/campanhas/detalhe') {
    const id = (new URLSearchParams(req.url.split('?')[1] || '')).get('id') || '';
    let campanhas = []; try { campanhas = sofia.lerCampanhas(); } catch (_) {}
    const c = campanhas.find(x => String(x.id) === String(id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!c) return res.end(JSON.stringify({ ok: false }));
    const CAP = 300;
    const env = (c.enviados || []), pen = (c.pendentes || []), fal = (c.falhas || []);
    return res.end(JSON.stringify({
      ok: true, nome: c.nome, status: c.status,
      enviadosHoje: c.enviadosHoje || 0, limiteDia: c.limiteDia || 0,
      enviadosTotal: env.length, pendentesTotal: pen.length, falhasTotal: fal.length,
      enviados: env.slice(-CAP).map(x => ({ tel: x.tel, nome: x.nome, em: x.em })),
      pendentes: pen.slice(0, CAP).map(x => ({ tel: x.tel, nome: x.nome })),
      falhas: fal.slice(-CAP).map(x => ({ tel: x.tel, nome: x.nome, erro: x.erro, em: x.em })),
    }));
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/controle') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try { sofia.opCampanha({ op: 'controle', id: p.get('id'), acao: p.get('acao') }); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=campanhas&okc=ok' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/excluir') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try { sofia.opCampanha({ op: 'excluir', id: p.get('id') }); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=campanhas&okc=ok' }); res.end();
    });
  }

  // Página do Instagram (status + liga/desliga + limite + mensagem + horário)
  if (req.method === 'GET' && url === '/instagram') {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)on=1/.test(q)) aviso = '📸 Instagram LIGADO. Vale no próximo disparo (07:00).';
    else if (/(?:^|&)off=1/.test(q)) aviso = '⏸️ Instagram pausado. Nenhuma DM automática será enviada.';
    else if (/(?:^|&)lim=1/.test(q)) aviso = '🎯 Limite salvo. Vale já no próximo disparo — sem reiniciar.';
    else if (/(?:^|&)ck=\d/.test(q)) aviso = '🍪 Cookies importados (' + (q.match(/ck=(\d+)/) || [])[1] + '). A sessão do Instagram foi renovada — vale na próxima execução.';
    else if (/(?:^|&)ok=1/.test(q)) aviso = 'Mensagem salva! Já vale no próximo envio.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horário salvo e robô reiniciado. Já vale.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horário salvo, mas não consegui reiniciar o robô. Rode: pm2 restart slimfit-exp'; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaInstagram(aviso, erro));
  }
  if (req.method === 'POST' && url === '/instagram/toggle') {
    return lerCorpo(req, 1e5, corpo => {
      const alvo = new URLSearchParams(corpo).get('alvo');
      try { igcfg.definir(alvo === 'on'); } catch (_) {}
      res.writeHead(303, { Location: alvo === 'on' ? '/instagram?on=1' : '/instagram?off=1' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/instagram/limite') {
    return lerCorpo(req, 1e5, corpo => {
      try { igcfg.definirMax(new URLSearchParams(corpo).get('max')); res.writeHead(303, { Location: '/instagram?lim=1' }); res.end(); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaInstagram('Erro ao salvar o limite: ' + e.message, true));
      }
    });
  }
  if (req.method === 'POST' && url === '/instagram/teste-dm') {
    return lerCorpo(req, 1e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const textoFinal = mensagens.renderTexto(d.texto || '', mensagens.EXEMPLOS);
        const id = testeIg.solicitar({ username: d.username, texto: textoFinal });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'GET' && url === '/instagram/teste-dm/status') {
    const id = new URLSearchParams(req.url.split('?')[1] || '').get('id');
    const p = testeIg.ler(id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(p ? { status: p.status, erro: p.erro } : { status: 'desconhecido' }));
  }
  // Forçar as boas-vindas do IG agora (o robô, que tem o navegador, executa).
  if (req.method === 'POST' && url === '/instagram/forcar') {
    try { const st = igforcar.pedir(); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: true, status: st.status })); }
    catch (e) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, erro: e.message })); }
  }
  if (req.method === 'GET' && url === '/instagram/forcar/status') {
    const st = igforcar.estado() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: st.status || 'nenhum', erro: st.erro || '' }));
  }
  if (req.method === 'POST' && url === '/instagram/cookies') {
    return lerCorpo(req, 4e6, corpo => { // cookies podem somar alguns KB
      try {
        const n = igcookies.salvar(new URLSearchParams(corpo).get('cookies') || '');
        res.writeHead(303, { Location: '/instagram?ck=' + n }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaInstagram('Erro ao importar cookies: ' + e.message, true));
      }
    });
  }

  // Estado do WhatsApp em JSON — o banner da aba Mensagens atualiza só este bloco
  // (sem recarregar a página, para não apagar o texto que está sendo editado).
  if (req.method === 'GET' && url === '/wa/estado') {
    const st = waStatus.get() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ estado: st.estado || '', qr: st.qr || '', atualizadoEm: st.atualizadoEm || '' }));
  }
  // Desconectar o WhatsApp do robô (grava comando → o robô faz logout e reinicia → QR novo).
  if (req.method === 'POST' && url === '/wa/desconectar') {
    return lerCorpo(req, 1e5, () => {
      try {
        const fs = require('fs'); const p = require('path');
        const arq = p.join(p.dirname(waStatus.ARQUIVO), 'wa-comando.json');
        fs.writeFileSync(arq, JSON.stringify({ cmd: 'logout', em: Date.now() }), 'utf8');
      } catch (_) {}
      res.writeHead(303, { Location: '/?dcon=1' }); res.end();
    });
  }
  // A conexão do WhatsApp agora vive no topo da aba Mensagens — redireciona link antigo.
  if (req.method === 'GET' && url === '/wa') {
    res.writeHead(301, { Location: '/' }); return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
});

// ── Automação por tag (gatilho → aplica tag + avisa no WhatsApp) ─────────────
// Gatilhos detectados AQUI (painel): 'agendou' (sofia-agendou.jsonl, escrito pela
// SoFIA) e 'humano' (rota /sofia/humano). Os demais ('novo', 'palavra', 'campanha',
// 'encerrou') são detectados pelo LISTENER, que lê as regras em sofia-regras.json
// (publicadas aqui) e devolve as ações em sofia-eventos.jsonl (consumidas aqui).
function fmtTelAviso(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) { const ddd = d.slice(2, 4), x = d.slice(4); return '+55 (' + ddd + ') ' + (x.length === 9 ? x.slice(0, 5) + '-' + x.slice(5) : x.slice(0, 4) + '-' + x.slice(4)); }
  return t || '';
}
const AUTO_ROTULO = {
  agendou: '🎉 Nova aula experimental agendada!',
  novo: '🆕 Nova aluna falou com a SoFIA',
  palavra: '🔑 Palavra-chave detectada — pode precisar de atendimento',
  humano: '🙋 Conversa assumida por atendente',
  encerrou: '🔒 Atendimento encerrado sem agendamento',
  campanha: '💬 Aluna respondeu a uma campanha',
};
// Aplica UMA tag a um contato e (se configurado) enfileira o aviso por WhatsApp.
function aplicarAutomacao({ telefone, nome, tag, avisarWpp, motivo, extra }) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (!tel || !tag) return;
  try { contatos.adicionarTag(tel, nome || '', tag); } catch (_) {}
  if (avisarWpp) {
    const cab = AUTO_ROTULO[motivo] || '🔔 Automação da SoFIA';
    const texto = `${cab}\n👤 ${nome || '(sem nome)'}\n📱 ${fmtTelAviso(tel)}${extra ? `\n${extra}` : ''}\n🏷️ ${tag}`;
    try { sofia.enfileirarAviso(avisarWpp, texto); } catch (_) {}
  }
}
// Publica as regras que o LISTENER precisa (só os gatilhos dele).
function publicarRegras() {
  try {
    const regras = { novo: [], palavra: [], campanha: [], encerrou: [] };
    for (const g of Object.keys(regras)) {
      for (const r of contatos.tagsPorGatilho(g)) {
        regras[g].push(g === 'palavra' ? { tag: r.tag, avisarWpp: r.avisarWpp, palavras: r.palavras } : { tag: r.tag, avisarWpp: r.avisarWpp });
      }
    }
    sofia.gravarRegras(regras);
  } catch (_) {}
}
// Estado do follow-up (arquivos co-locados com os demais da Sofia, fora do Git).
const FU_AGENDOU_FILE = path.join(sofia.DIR, 'sofia-agendaram.json');   // quem já agendou (não recebe follow-up)
const FU_FEITO_FILE = path.join(sofia.DIR, 'sofia-followup-feito.json'); // { chave: ultimoInboundSeguido }
// Leads que ESTÃO no ponto de receber follow-up, mas seguram porque agora é FORA
// da janela de horário. { chave: 'HH:MM' (horário em que vai sair) }. Recalculado
// a cada varredura; o feed das Conversas expõe p/ o painel mostrar o selo ⏳.
let fuEsperando = {};
function fuLerJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || def; } catch (_) { return def; } }
// Grava de forma ATÔMICA (temp + rename) e devolve true/false. O follow-up usa o
// retorno para só ENVIAR depois de gravar "já enviei" — assim uma falha de disco
// nunca vira follow-up repetido.
function fuSalvarJson(f, o) {
  try { fs.writeFileSync(f + '.tmp', JSON.stringify(o), 'utf8'); fs.renameSync(f + '.tmp', f); return true; }
  catch (_) { try { fs.writeFileSync(f, JSON.stringify(o), 'utf8'); return true; } catch (_) { return false; } }
}
function fuMarcarAgendou(tels) {
  const set = new Set((fuLerJson(FU_AGENDOU_FILE, []) || []).map(x => String(x).replace(/\D/g, '')));
  let mudou = false;
  for (const t of tels) { const d = String(t || '').replace(/\D/g, ''); if (d && !set.has(d)) { set.add(d); mudou = true; } }
  if (mudou) fuSalvarJson(FU_AGENDOU_FILE, Array.from(set).slice(-20000));
}

// 1) Agendamentos concluídos (gatilho 'agendou') → aplica tags + avisa.
function processarAgendamentos() {
  let evs = [];
  try { evs = sofia.consumirAgendamentos(); } catch (_) { return; }
  if (!evs.length) return;
  try { fuMarcarAgendou(evs.map(ev => ev.telefone)); } catch (_) {} // registra p/ o follow-up NÃO incomodar quem agendou
  let autos = [];
  try { autos = contatos.tagsPorGatilho('agendou'); } catch (_) {}
  if (!autos.length) return;
  for (const ev of evs) {
    const nome = ev.nome || '';
    for (const a of autos) aplicarAutomacao({ telefone: ev.telefone, nome, tag: a.tag, avisarWpp: a.avisarWpp, motivo: 'agendou', extra: ev.when ? `📅 ${ev.when}` : '' });
  }
}

// 3) Follow-up: enfileira retomada para leads que esfriaram SEM agendar.
//    A Sofia (listener) é quem GERA (IA) e ENVIA — aqui só decidimos QUEM.
function processarFollowups() {
  let cfg; try { cfg = sofia.lerFollowupCfg(); } catch (_) { fuEsperando = {}; return; }
  if (!cfg || !cfg.on) { fuEsperando = {}; return; }
  try { if (!sofia.estadoAtivo()) { fuEsperando = {}; return; } } catch (_) {} // SoFIA pausada → não faz nada
  // Estamos DENTRO da janela de horário agora? Se não, os leads no ponto de
  // receber follow-up ficam "aguardando" (não enfileira) e a próxima varredura
  // (a cada 2 min) reavalia — o que venceu de madrugada só sai no início da
  // janela (ex.: 8h). Assim nunca manda tarde da noite. (Brasília.)
  let dentroDaJanela = true;
  try {
    const _mm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : -1; };
    const hhmm = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const cur = _mm(hhmm), ini = _mm(cfg.janelaIni), fim = _mm(cfg.janelaFim);
    if (cur >= 0 && ini >= 0 && fim >= 0 && ini !== fim) {
      dentroDaJanela = ini < fim ? (cur >= ini && cur < fim) : (cur >= ini || cur < fim); // ini<fim normal; senão cruza meia-noite
    }
  } catch (_) {}
  const esperaMs = Math.max(0.25, cfg.horas) * 3600 * 1000;
  const CAP = Math.max(esperaMs * 3, 14 * 24 * 3600 * 1000); // não pinga conversas muito antigas
  const agora = Date.now();
  let inbox = {}; try { inbox = sofia.conversas() || {}; } catch (_) { return; }
  let humano = {}; try { humano = sofia.lerHumano() || {}; } catch (_) {}
  const agendaram = new Set((fuLerJson(FU_AGENDOU_FILE, []) || []).map(x => String(x).replace(/\D/g, '')));
  let tagsAgendou = []; try { tagsAgendou = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {}
  let contatosMap = {}; try { contatosMap = contatos.carregar() || {}; } catch (_) {}
  const feito = fuLerJson(FU_FEITO_FILE, {}) || {};
  const espera = {}; // leads prontos, mas segurados pelo horário (recalculado agora)
  for (const chave of Object.keys(inbox)) {
    const c = inbox[chave] || {}; const msgs = c.msgs || [];
    if (!msgs.length) continue;
    let ultimoAluna = 0;
    for (const m of msgs) if (m.autor === 'aluna' && m.em > ultimoAluna) ultimoAluna = m.em;
    if (!ultimoAluna) continue;                              // a lead nunca falou → ignora
    if (cfg.ligadoEm && ultimoAluna < cfg.ligadoEm) continue; // "só daqui pra frente": ignora o acúmulo de antes de ligar
    const idle = agora - (c.ultimaEm || ultimoAluna);
    if (idle < esperaMs || idle > CAP) continue;             // ainda quente, ou antiga demais
    if ((feito[chave] || 0) >= ultimoAluna) continue;        // já fez follow-up deste ciclo
    const d = String(chave).replace(/\D/g, '');
    if (sofia.estaBloqueado(chave)) continue;                // bloqueado
    if (humano[chave]) continue;                             // sob controle humano
    try { if (sofia.estaEncerrada(chave, c.ultimaEm)) continue; } catch (_) {} // encerrada à mão → não incomoda
    if (agendaram.has(d)) continue;                          // já agendou
    try { const ct = contatosMap[contatos.normTel(chave)]; if (ct && (ct.tags || []).some(t => tagsAgendou.includes(t))) continue; } catch (_) {}
    // Chegou aqui = está no ponto de receber a retomada. Só falta o horário:
    if (!dentroDaJanela) { espera[chave] = cfg.janelaIni; continue; } // segura p/ o próximo horário permitido
    // REGISTRA "já enviei" ANTES de enfileirar e só envia se o registro GRAVOU.
    // Assim, se a aluna não responder, o gate (feito >= ultimoAluna) barra novos
    // envios — 1 follow-up por conversa, até ela responder de novo. E como grava
    // antes, uma falha de disco nunca produz follow-up repetido.
    feito[chave] = ultimoAluna;
    if (fuSalvarJson(FU_FEITO_FILE, feito)) {
      try { sofia.enfileirarFollowup(chave, cfg.instrucao); } catch (_) {}
    } else {
      delete feito[chave]; // não gravou → não marca; tenta no próximo ciclo
    }
  }
  fuEsperando = espera; // publica p/ o painel mostrar o selo "⏳ aguardando horário"
}
// 2) Ações detectadas pelo listener (novo/palavra/campanha/encerrou).
function processarEventos() {
  let evs = [];
  try { evs = sofia.consumirEventos(); } catch (_) { return; }
  if (!evs.length) return;
  let tagsAgendou = [];
  try { tagsAgendou = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {}
  for (const ev of evs) {
    const tel = String(ev.telefone || '').replace(/\D/g, '');
    if (!tel || !ev.tag) continue;
    // "Encerrado sem agendamento" não deve marcar quem JÁ agendou (tem a tag de agendou).
    if (ev.motivo === 'encerrou') {
      try {
        const c = contatos.carregar()[contatos.normTel(tel)];
        if (c && (c.tags || []).some(t => tagsAgendou.includes(t))) continue;
      } catch (_) {}
    }
    aplicarAutomacao({ telefone: tel, nome: ev.nome, tag: ev.tag, avisarWpp: ev.avisarWpp, motivo: ev.motivo, extra: ev.extra || '' });
  }
}
publicarRegras();
try {
  setInterval(() => { try { processarAgendamentos(); } catch (_) {} try { processarEventos(); } catch (_) {} try { publicarRegras(); } catch (_) {} }, 4000);
  // Follow-up: cadência mais lenta (as leads esfriam em horas, não em segundos).
  setInterval(() => { try { processarFollowups(); } catch (_) {} }, 120000);
  setTimeout(() => { try { processarFollowups(); } catch (_) {} }, 30000);
} catch (_) {}

server.listen(PORT, HOST, () => {
  if (!SENHA) console.warn('⚠️  PAINEL_SENHA não definido no .env — o painel vai NEGAR todo acesso até você definir usuário e senha.');
  console.log(`🖥️  Painel do Studio ouvindo em ${HOST}:${PORT} (usuário: ${USER}).`);
  console.log('   Páginas: /hoje · /indicadores · /  (WhatsApp+mensagens) · /agendar · /instagram · /sofia. Exponha SEMPRE atrás de HTTPS.');
});

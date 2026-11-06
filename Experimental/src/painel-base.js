/**
 * painel-base.js — peças compartilhadas pelas telas (estilos, componentes, formatação, leitura/gravação de configurações).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');
const slimclub = require('./slimclub');
const audiosMsg = require('./audios-msg');
const histExp = require('./experimentais-hist');
const sofia = require('./sofia-editor');
const usuarios = require('./usuarios');
const config = require('./config');
const E = require('./painel-estado');

// ── Nomes dos processos no PM2 (por unidade) ────────────────────────────────
// Cada studio tem os seus: <slug>-exp, <slug>-painel, <slug>-sofia. O painel usa
// esses nomes para reiniciar/consultar o robô e a SoFIA. Antes ficavam FIXOS como
// "slimfit-exp"/"sofia-listener" (Setor Bueno) — aí, numa unidade nova (ex.: Lago
// Sul = lagosul1-exp), o botão "Reiniciar robô" e o restart pós-salvar apontavam
// para o processo ERRADO (o do Bueno) e falhavam. Agora vêm do .env:
//   PM2_SLUG=lagosul1   → deriva lagosul1-exp / lagosul1-painel / lagosul1-sofia
// ou, se precisar, os nomes exatos: PM2_APP_EXP / PM2_APP_PAINEL / PM2_APP_SOFIA.
// Sem nada no .env, mantém os nomes legados do Bueno (nada muda lá).
const _pm2Slug = (process.env.PM2_SLUG || '').trim();
const PM2_EXP = (process.env.PM2_APP_EXP || (_pm2Slug ? _pm2Slug + '-exp' : 'slimfit-exp')).trim();
const PM2_SOFIA = (process.env.PM2_APP_SOFIA || (_pm2Slug ? _pm2Slug + '-sofia' : 'sofia-listener')).trim();
// Config do job de comparecimento (lida/gravada direto do JSON — NÃO requerer
// comparecimento.js aqui, para não carregar o puppeteer/EVO no painel).
const COMP_CFG_FILE = path.resolve(__dirname, '..', 'data', 'comparecimento.json');
const COMP_PADRAO = { on: false, tagAgendou: 'FX - 3. Agendou Aula Exp', tagsAgendou: ['FX - 3. Agendou Aula Exp'], tagCompareceu: 'FX - 5. Fez Aula Experimental', tagFaltou: 'FX - 2. Encerrado com Agendamento sem Presença', numeroRelatorio: '', criarNovos: false, diasJanela: 7, intervaloHoras: 0 };
// Normaliza a lista de tags de "agendou" (aceita a lista nova ou a única antiga).
function compTagsAgendou(o) { let ta = Array.isArray(o && o.tagsAgendou) ? o.tagsAgendou.map(t => String(t || '').trim()).filter(Boolean) : []; if (!ta.length) { const one = String((o && o.tagAgendou) || COMP_PADRAO.tagAgendou).trim(); ta = [one || COMP_PADRAO.tagAgendou]; } return Array.from(new Set(ta)); }
// Janela de dias para trás (1-31). Padrão 7.
function compDias(v) { const n = parseInt(v, 10); return (Number.isFinite(n) && n >= 1 && n <= 31) ? n : 7; }
// Repetir a cada N horas (0 = desligado; 1-24).
function compIntervalo(v) { const n = parseInt(v, 10); return (Number.isFinite(n) && n >= 1 && n <= 24) ? n : 0; }
function lerCompCfg() { let o = {}; try { const p = JSON.parse(fs.readFileSync(COMP_CFG_FILE, 'utf8')); if (p && typeof p === 'object') o = p; } catch (_) {} const cfg = { ...COMP_PADRAO, ...o }; cfg.tagsAgendou = compTagsAgendou(o); cfg.tagAgendou = cfg.tagsAgendou[0]; cfg.diasJanela = compDias(o.diasJanela != null ? o.diasJanela : cfg.diasJanela); cfg.intervaloHoras = compIntervalo(o.intervaloHoras != null ? o.intervaloHoras : cfg.intervaloHoras); return cfg; }
const USER = process.env.PAINEL_USER || 'admin';
const SENHA = process.env.PAINEL_SENHA || '';

// ── Login por perfil (cookie de sessão assinado) ────────────────────────────
// O admin do .env (USER/SENHA) é o super-usuário: entra sempre, vê tudo e é o
// único que gerencia os Perfis. Os demais usuários ficam em data/usuarios.json
// (via usuarios.js) e só veem as telas marcadas. Sessão = cookie assinado com
// HMAC (não dá pra forjar), guardado no navegador; nada de senha no cookie.
const TODAS_TELAS = usuarios.TELAS_KEYS.slice();
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
function assinar(dado) { return crypto.createHmac('sha256', SEGREDO).update(dado).digest('hex'); }
// ── Sessões ativas (para listar/encerrar em Perfis → Acessos) ────────────────
// O cookie é stateless (HMAC), mas guardamos cada sessão emitida (por sid) para o
// admin ver quem está logado e ENCERRAR uma sessão (revoga o sid → o próximo
// acesso daquele cookie cai no login). Guardado em data/painel-sessoes.json.
const SESSOES_FILE = path.join(__dirname, '..', 'data', 'painel-sessoes.json');
// (estado "_sessoesDirty, _sessoesTimer" → painel-estado.js)
function _salvarSessoesJa() { try { require('fs').mkdirSync(path.dirname(SESSOES_FILE), { recursive: true }); require('fs').writeFileSync(SESSOES_FILE, JSON.stringify(E._sessoes)); E._sessoesDirty = false; } catch (_) {} }
function salvarSessoesSoon() { // usado pelo "toque" frequente (último uso) — pode esperar
  E._sessoesDirty = true; if (E._sessoesTimer) return;
  E._sessoesTimer = setTimeout(() => { E._sessoesTimer = null; if (E._sessoesDirty) _salvarSessoesJa(); }, 2500);
}
function tocarSessao(sid) { const s = E._sessoes[sid]; if (!s || s.revogadoEm) return; const agora = Date.now(); if (agora - (s.ultimoEm || 0) > 60000) { s.ultimoEm = agora; salvarSessoesSoon(); } }
function sessaoValida(sid) { const s = E._sessoes[sid]; return !!(s && !s.revogadoEm); }
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
  for (const par of raw.split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim() === nome) { try { return decodeURIComponent(par.slice(i + 1).trim()); } catch (_) { return ''; } } }
  return '';
}
function ehHttps(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
// Devolve o usuário logado (objeto {usuario, admin, telas}) ou null.
function usuarioDaReq(req) {
  const o = lerToken(lerCookie(req, 'sf_sess'));
  if (!o) return null;
  if (o.sid && !sessaoValida(o.sid)) return null; // sessão encerrada pelo admin → força novo login
  if (o.sid) tocarSessao(o.sid);
  const sid = o.sid || '';
  if (SENHA && usuarios.normU(o.u) === usuarios.normU(USER)) return { usuario: USER, admin: true, telas: TODAS_TELAS, sid };
  const u = usuarios.obter(o.u);
  if (!u) return null; // usuário apagado depois de logar
  if (u.admin) return { usuario: u.usuario, admin: true, telas: TODAS_TELAS, sid }; // admin promovido pela checkbox → vê tudo
  return { usuario: u.usuario, admin: false, telas: u.telas || [], sid };
}
const ADMIN_EMAIL = usuarios.normEmail(process.env.PAINEL_ADMIN_EMAIL || '');
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
// WhatsApp é dividido em sub-abas: Configuração, Agendamento, Express e Log.
function podeMsgSub(sess, sub) { return sess.admin || (sess.telas || []).includes('msg_' + sub); }
function temMsg(sess) { return sess.admin || ['config', 'agendar', 'express', 'hoje'].some(s => podeMsgSub(sess, s)); }
function msgHref(sess) { return podeMsgSub(sess, 'config') ? '/?view=config' : (podeMsgSub(sess, 'agendar') ? '/?view=agendar' : (podeMsgSub(sess, 'express') ? '/?view=express' : (podeMsgSub(sess, 'hoje') ? '/hoje' : '/?view=config'))); }

// Sessão do request atual, para o chrome() montar o menu só com as telas
// liberadas. O painel é de baixíssimo tráfego (um Studio), então guardar aqui
// entre o início do dispatch e a renderização síncrona da página é seguro.
// (estado "_navSess" → painel-estado.js)

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

// ── Chrome comum (cabeçalho + abas + estilo) ────────────────────────────────
const ESTILO = `
  :root{
    /* Acento: teal do SlimFit em versão profunda e sóbria (era #11abae, vivo). */
    --teal:#0e6e6b;--teal-esc:#0a5250;--teal-soft:#e4efee;
    --coral:#c0453f;--coral-esc:#a53a35;
    --tinta:#1d1d1f;--cinza:#6e6e73;--faint:#9a9aa0;--bg:#f5f5f7;--card:#fff;--linha:#e4e4e7;--linha-soft:#eeeef0;
    --ok:#1c8f52;--ok-bg:#eaf5ee;--ok-bd:#cfe7d7;
    --erro:#b23b30;--erro-bg:#f8ece9;--erro-bd:#eccfc9;
    --warn:#8a6300;--warn-bg:#f7efdc;--warn-bd:#e9d8ac;
    --avi-bg:#e6f1f0;--avi-bd:#c9e2e0;--avi-tx:#0a5250;
    /* escala de tipografia — poucos tamanhos, reaproveitados em todo o painel */
    --fs-h1:1.22rem;--fs-h2:1rem;--fs-sec:.95rem;--fs-body:.9rem;--fs-sm:.8rem;--fs-xs:.72rem;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:"Inter",-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--tinta);line-height:1.5;font-size:var(--fs-body);letter-spacing:-.011em;-webkit-font-smoothing:antialiased}
  h1,h2,h3,button,.tabs a{font-family:"Inter",-apple-system,Segoe UI,Arial,sans-serif;letter-spacing:-.02em}
  .wrap{max-width:1080px;margin:0 auto;padding:16px 24px} /* mesma largura do menu */
  @media(max-width:560px){.wrap{padding:14px 16px}}
  /* Barra superior ÚNICA e FIXA: logo + menu + login (sem a faixa branca separada). */
  .topbar{position:sticky;top:0;z-index:60;background:var(--card);border-bottom:1px solid var(--linha)}
  .topbar .in{max-width:1080px;margin:0 auto;padding:4px 24px;display:flex;align-items:center;gap:16px} /* mais largo que o conteúdo: cabem as 8 abas do admin numa linha */
  .tb-logo{height:50px;width:auto;flex:none;display:block}
  /* Menu da conta (canto superior direito): avatar → Saúde, Perfis e Sair. */
  .conta{position:relative;flex:none;margin-left:auto}
  .conta>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:4px 4px 4px 10px;border-radius:999px;border:1px solid transparent;user-select:none}
  .conta>summary::-webkit-details-marker{display:none}
  .conta>summary:hover,.conta[open]>summary{background:var(--linha-soft);border-color:var(--linha)}
  .conta>summary:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
  .conta.on>summary .av{box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--teal)}
  .conta-txt{display:flex;flex-direction:column;align-items:flex-end;line-height:1.2;white-space:nowrap}
  .conta-txt b{font-size:.82rem;color:var(--tinta);font-weight:600}
  .conta-txt small{font-size:.7rem;color:var(--faint);font-weight:500}
  .av{position:relative;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:.82rem;letter-spacing:.03em;flex:none}
  .av>img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover}
  .av-dot{position:absolute;right:-2px;top:-2px;width:13px;height:13px;border-radius:50%;border:2px solid var(--card)}
  .av-dot.warn{background:#e0a100}
  .av-dot.erro{background:#d93025}
  .conta-menu{position:absolute;right:0;top:calc(100% + 8px);width:300px;max-width:calc(100vw - 24px);background:var(--card);border:1px solid var(--linha);border-radius:14px;box-shadow:0 16px 40px -12px rgba(16,24,40,.35);padding:8px;z-index:80}
  .conta-cab{display:flex;gap:12px;align-items:center;padding:8px 8px 12px;border-bottom:1px solid var(--linha-soft);margin-bottom:6px}
  .conta-cab .av{width:46px;height:46px;font-size:.95rem}
  .conta-cab b{display:block;font-size:.95rem;color:var(--tinta)}
  .conta-cab div>span{display:block;font-size:.76rem;color:var(--cinza)}
  .conta-menu a{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;color:var(--tinta);text-decoration:none;font-weight:600;font-size:.88rem}
  .conta-menu a:hover{background:var(--linha-soft)}
  .conta-menu a.on{background:var(--teal-soft);color:var(--teal-esc)}
  .conta-menu a .sd-pill{margin-left:auto}
  .conta-menu a.sair{color:var(--erro)}
  .conta-sep{height:1px;background:var(--linha-soft);margin:6px 0}
  @media(max-width:400px){.conta-txt{display:none}}
  .tabs{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 auto;justify-content:center;margin:0;padding:0}
  .tabs a{flex:0 1 auto;display:flex;align-items:center;justify-content:center;line-height:1.1;text-decoration:none;font-weight:500;color:var(--cinza);background:transparent;border:1px solid transparent;border-radius:10px;padding:9px 12px}
  .tabs a .tic{display:none}
  .tabs a .ttx{font-size:.86rem}
  .tabs a:hover{color:var(--tinta);background:var(--linha-soft)}
  .tabs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  /* Mesma ordem no desktop E no mobile: SoFIA → WhatsApp → Instagram →
     Formulário → Indicadores → Slim Club (no HTML a SoFIA fica por último; o order
     reordena). Perfis e Saúde ficam no menu da conta (avatar). */
  .tabs .nav-sofia{order:1}
  .tabs .nav-msg{order:2}
  .tabs .nav-ig{order:3}
  .tabs .nav-ind{order:4}
  .tabs .nav-grade{order:6}
  .tabs .nav-slimclub{order:8}
  .nav-badge{display:inline-block;min-width:17px;border-radius:999px;background:#c62828;color:#fff;font-size:.68rem;font-weight:700;line-height:17px;padding:0 5px;text-align:center;margin-left:3px;vertical-align:1px}
  /* Mobile: logo + login na 1ª linha; o menu ocupa a linha inteira logo abaixo.
     A barra inteira continua fixa ao rolar. */
  @media(max-width:760px){
    .topbar .in{flex-wrap:wrap;gap:6px 12px;padding:5px 12px}
    .tb-logo{height:40px}
    .tabs{flex-basis:100%;order:3}
    .tabs a{flex:1 1 84px;padding:9px 8px}
  }
  /* Sub-menu: mesmas pílulas do menu principal, em escala menor (secundário). */
  .subtabs{position:sticky;top:var(--topbar-h,46px);z-index:55;display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;padding:9px 0;background:var(--bg);box-shadow:0 5px 6px -6px rgba(16,24,40,.16)}
  .subtabs a{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;font-family:"Inter",sans-serif;font-weight:500;font-size:.82rem;line-height:1;color:var(--cinza);background:transparent;border:1px solid var(--linha);border-radius:999px;padding:7px 15px;transition:.12s}
  .subtabs a:hover{background:var(--linha-soft);color:var(--tinta);border-color:var(--linha)}
  .subtabs a.on{background:var(--teal);color:#fff;border-color:var(--teal);font-weight:600}
  .card>summary::-webkit-details-marker{display:none}
  .u-caret{transition:transform .15s}
  details[open]>summary .u-caret{transform:rotate(90deg)}
  /* "Mais/Menos filtros" (Conversas): rótulo alterna e campos alinhados. */
  .filtros-det{margin-bottom:8px;border:1px solid var(--linha);border-radius:10px;background:var(--card);padding:0 10px}
  .filtros-sum{cursor:pointer;list-style:none;font-size:.8rem;font-weight:600;color:var(--cinza);padding:8px 0;user-select:none;display:flex;align-items:center;gap:6px}
  .filtros-sum::-webkit-details-marker{display:none}
  .filtros-sum::after{content:"▸";margin-left:auto;color:var(--faint);transition:transform .15s}
  .filtros-det[open] .filtros-sum::after{transform:rotate(90deg)}
  .filtros-det .s-menos{display:none}
  .filtros-det[open] .s-mais{display:none}
  .filtros-det[open] .s-menos{display:inline}
  .filtros-corpo{padding:2px 0 12px;display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--linha-soft);margin-top:0}
  .filtros-det[open] .filtros-corpo{margin-top:2px;padding-top:12px}
  .filtro-check{display:flex;align-items:center;gap:8px;font-size:.8rem;cursor:pointer;color:var(--tinta)}
  .filtro-check input{width:15px;height:15px;margin:0;flex:none}
  .filtro-check small{color:var(--faint)}
  .filtro-periodo{display:flex;flex-direction:column;gap:6px}
  .filtro-lbl{font-size:.72rem;font-weight:600;color:var(--cinza)}
  .filtro-datas{display:flex;gap:7px;align-items:center}
  .filtro-datas input[type=date]{flex:1 1 0;min-width:0;font-size:.78rem;padding:7px 9px;border:1px solid var(--linha);border-radius:8px;background:#fff;color:var(--tinta)}
  .filtro-datas .ate{font-size:.75rem;color:var(--cinza);flex:none}
  .filtro-limpar{flex:none;padding:6px 10px;font-size:.9rem;line-height:1}
  /* Heatmap dos Indicadores: acessos por dia × hora. */
  .hm-scroll{overflow-x:auto;padding-bottom:4px}
  .hm-grid{display:grid;grid-template-columns:34px repeat(24,minmax(22px,1fr));gap:2px;min-width:560px}
  .hm-hlbl{font-size:.56rem;color:var(--faint);text-align:center;padding-bottom:2px;font-variant-numeric:tabular-nums}
  .hm-daylbl{font-size:.7rem;color:var(--cinza);font-weight:600;display:flex;align-items:center;justify-content:flex-end;padding-right:7px}
  .hm-cell{aspect-ratio:1;min-height:22px;border-radius:4px;display:grid;place-items:center;font-size:.6rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
  .hm-zero{background:var(--linha-soft)}
  .hm-leg{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:.72rem;color:var(--cinza);flex-wrap:wrap}
  .hm-leg-bar{width:90px;height:8px;border-radius:999px;background:linear-gradient(90deg,rgba(14,110,107,.16),rgba(14,110,107,1))}
  .hm-leg-hint{color:var(--faint)}
  .hm-insight{background:var(--avi-bg);border:1px solid var(--avi-bd);color:var(--avi-tx);border-radius:10px;padding:9px 13px;margin:0 0 14px;font-size:.82rem;line-height:1.45}
  .hm-compact{display:none}
  .hm-grid-cmp{display:grid;grid-template-columns:40px repeat(4,1fr);gap:3px}
  .hm-flbl{font-size:.62rem;color:var(--faint);text-align:center;padding-bottom:2px;align-self:end}
  @media(max-width:560px){
    .hm-leg-hint{display:none}
    .hm-full{display:none}
    .hm-compact{display:block}
  }
  /* Página de Saúde */
  .sd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
  .sd-card{margin:0}
  .sd-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
  .sd-top h3{margin:0;font-size:1rem;font-weight:700}
  .sd-pill{font-size:.74rem;font-weight:700;padding:3px 11px;border-radius:999px;white-space:nowrap;border:1px solid transparent}
  .sd-pill.sd-ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd)}
  .sd-pill.sd-warn{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bd)}
  .sd-pill.sd-erro{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-bd)}
  .sd-line{font-size:.85rem;color:var(--tinta);padding:4px 0;border-top:1px solid var(--linha-soft)}
  .sd-line:first-of-type{border-top:0}
  .sd-muted{color:var(--cinza)}
  .aviso{background:var(--avi-bg);border:1px solid var(--avi-bd);color:var(--avi-tx);border-radius:10px;padding:10px 14px;margin:14px 0;font-size:var(--fs-sm)}
  .aviso.err{background:var(--erro-bg);border-color:var(--erro-bd);color:var(--erro)}
  .aviso.warn,.ui-nota.warn{background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn)}
  .aviso.ok,.ui-nota.ok{background:var(--ok-bg);border-color:var(--ok-bd);color:var(--ok)}
  .card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:15px 17px;margin:12px 0;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .chead{display:flex;align-items:center;gap:10px}
  h2{font-size:var(--fs-h2);font-weight:700;margin:0}
  h3{font-size:var(--fs-sec);font-weight:700}
  .badge{background:var(--erro-bg);color:var(--erro);border:1px solid var(--erro-bd);border-radius:999px;font-size:var(--fs-xs);font-weight:700;padding:2px 9px}
  .quando{color:var(--cinza);font-size:var(--fs-sm);margin:5px 0 8px}
  .vars{font-size:var(--fs-sm);color:var(--cinza);margin:0 0 8px}
  .var{display:inline-block;background:#eef7f7;color:var(--teal-esc);border:1px solid #cdeaea;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace;font-size:var(--fs-sm);cursor:pointer;user-select:none;transition:.12s}
  .var:hover{background:var(--teal);color:#fff;border-color:var(--teal)}
  label{display:block;font-weight:600;font-size:var(--fs-sm);margin:12px 0 4px}
  input[type=text],input[type=search],input[type=tel],input[type=email],input[type=date],input[type=time],input[type=number],textarea{width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff}
  select{width:100%;max-width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:9px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff}
  textarea{line-height:1.5;resize:vertical}
  input:focus,textarea:focus,select:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(14,110,107,.16)}
  .acts{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
  /* Botões: retângulo arredondado = AÇÃO (pílula fica para filtro/seleção).
     Principal (.save/.ui-btn) teal cheio; secundário (.reset/.tbtn/.ui-btn.sec)
     branco com contorno; perigo (.rm/.ui-btn.perigo) texto vermelho. */
  button{border:none;border-radius:10px;padding:9px 18px;font-size:var(--fs-body);font-weight:700;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s}
  .save{background:var(--teal);color:#fff;border:1px solid var(--teal)}
  .save:hover{background:var(--teal-esc);border-color:var(--teal-esc)}
  .reset,.tbtn{background:var(--card);color:var(--teal-esc);border:1px solid var(--linha)}
  .reset:hover,.tbtn:hover{border-color:var(--teal);background:var(--teal-soft)}
  .rm{background:var(--card);color:var(--erro);border:1px solid var(--erro-bd)}
  .rm:hover{background:var(--erro-bg)}
  a.save,a.reset{display:inline-block;text-decoration:none;border-radius:10px}
  button:disabled{opacity:.5;cursor:default}
  button:focus-visible,a.save:focus-visible,a.reset:focus-visible,a.ui-btn:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
  .turnos{display:flex;gap:10px;margin-top:6px}
  .turnos label{flex:1;margin:0;display:block}
  .turnos input{position:absolute;opacity:0;pointer-events:none}
  .turnos span{display:block;text-align:center;border:1.5px solid #dcdcdc;border-radius:12px;padding:11px;font-weight:700;cursor:pointer;color:var(--tinta)}
  .turnos input:checked + span{border-color:var(--teal);background:var(--teal-soft,#e4efee);color:#0c6f70}
  .fotorow{margin-top:12px}
  .foto-acc{margin-top:12px;border-top:1px dashed var(--linha);padding-top:10px}
  .foto-acc>summary{list-style:none;cursor:pointer;position:relative;display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:.9rem;padding:2px 22px 2px 0;color:inherit;user-select:none}
  .foto-acc>summary::-webkit-details-marker{display:none}
  .foto-acc>summary::after{content:"▸";position:absolute;right:2px;color:var(--teal);font-weight:900}
  .foto-acc[open]>summary::after{content:"▾"}
  .foto-acc>summary:hover{color:var(--teal)}
  .foto-status{font-weight:600;font-size:.7rem;border-radius:999px;padding:2px 9px}
  .foto-status.on{background:#e6f6ec;color:#1c8f52}
  .foto-status.off{background:#eee;color:#8a8a8a}
  .au-lista{display:flex;flex-direction:column;margin:8px 0 4px;border:1px solid var(--linha);border-radius:12px;overflow:hidden;background:var(--card)}
  .au-row{display:grid;grid-template-columns:minmax(120px,1fr) auto;gap:6px 12px;align-items:center;padding:10px 12px;border-top:1px solid var(--linha-soft)}
  .au-row:first-child{border-top:0}
  .au-nome{font-weight:700;font-size:.88rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .au-nome small{font-weight:600;font-size:.7rem;border-radius:999px;padding:1px 8px}
  .au-nome small.pn{background:#e6f6ec;color:#1c8f52}
  .au-nome small.sis{background:var(--linha-soft);color:var(--cinza)}
  .au-nome small.sem{background:#eee;color:#8a8a8a}
  .au-acts{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
  .au-row audio{grid-column:1 / -1;width:100%;max-width:360px;height:34px}
  .au-acts .tbtn,.au-acts .rm{padding:6px 11px;font-size:.78rem}
  .au-nova{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
  .au-nova input[type=text]{max-width:200px}
  @media(max-width:600px){.au-row{grid-template-columns:1fr}.au-acts{justify-content:flex-start}}
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
  .sec-t{font-family:"Inter";font-weight:700;font-size:var(--fs-sec);margin:15px 0 4px}
  /* Seções recolhíveis (<details class="acc-sec">): o cabeçalho vira um cartão
     destacado e clicável, com chevron à direita e realce quando aberto — para
     não passar despercebido como uma linha de texto. */
  .acc-sec{margin:12px 0}
  [id^="sec-"],#waBanner{scroll-margin-top:120px}
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
  /* Blocos de mensagens dentro de uma seção (WhatsApp → Configuração): agrupa por
     assunto (Confirmação, Contratos, Follow-up…), cada um recolhível. */
  .msg-bloco>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:9px 13px;border:1px solid var(--linha);border-radius:10px;background:var(--card);font-weight:800;font-size:.9rem;color:var(--teal-esc)}
  .msg-bloco>summary::-webkit-details-marker{display:none}
  .msg-bloco>summary::after{content:"▸";margin-left:auto;color:var(--teal);font-weight:900}
  .msg-bloco[open]>summary::after{content:"▾"}
  .msg-bloco>summary:hover{border-color:var(--teal)}
  .msg-bloco>summary small{font-weight:600;color:var(--cinza);font-size:.76rem}
  .msg-bloco[open]>summary{margin-bottom:10px}
  .msg-bloco>.card{background:var(--card)}
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
  .hsec-t{font-family:"Inter";font-weight:700;font-size:var(--fs-sm);color:var(--teal-esc);margin:0 0 10px}
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
  .dias input:checked + span{border-color:var(--teal);background:#e4efee;color:#0c6f70}
  .hbar{position:sticky;bottom:0;background:linear-gradient(180deg,transparent,var(--bg) 40%);padding:14px 0 6px;margin-top:6px}
  .badge-ed{background:var(--erro-bg);color:var(--erro);border:1px solid var(--erro-bd);border-radius:999px;font-size:var(--fs-xs);font-weight:700;padding:2px 8px;margin-left:6px}
  /* Switch Ativado/Desligado (canto superior direito do card) */
  .envsw{position:absolute;top:13px;right:15px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;z-index:2}
  .envsw input{position:absolute;opacity:0;width:0;height:0}
  .envsw-txt{font-family:"Inter";font-weight:800;font-size:var(--fs-xs);letter-spacing:.02em}
  .envsw.on .envsw-txt{color:#0a7d53}
  .envsw.off .envsw-txt{color:#98a2b3}
  .envsw-track{position:relative;width:46px;height:26px;border-radius:999px;background:#cfd4dc;transition:background .18s ease;flex:0 0 auto}
  .envsw.on .envsw-track{background:#2bb673}
  .envsw-thumb{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.35);transition:left .18s ease}
  .envsw.on .envsw-thumb{left:23px}
  .envsw:focus-within .envsw-track{outline:2px solid var(--teal);outline-offset:2px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
  .stat{background:var(--card);border:1px solid var(--linha);border-radius:12px;padding:14px;text-align:center}
  .stat .n{font-family:"Inter";font-weight:800;font-size:1.8rem;line-height:1}
  .stat .l{font-size:var(--fs-xs);color:var(--cinza);margin-top:4px;font-weight:600}
  .ex-tipos{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
  .ex-tipo{position:relative;cursor:pointer;margin:0}.ex-tipo input{position:absolute;opacity:0}
  .ex-tipo span{display:inline-block;padding:8px 16px;border:1px solid var(--linha);border-radius:999px;font-weight:700;font-size:var(--fs-sm);background:#fff;color:var(--tinta)}
  .ex-tipo input:checked+span{background:var(--teal);border-color:var(--teal);color:#fff}
  .ex-tipo input:disabled+span{opacity:.45;cursor:not-allowed}
  .ex-tipo input:focus-visible+span{outline:2px solid var(--teal);outline-offset:2px}
  .ex-cfg{margin:0 0 9px;background:#fff;border:1px solid var(--linha);border-radius:12px;padding:8px 14px}
  .ex-cfg summary{cursor:pointer;font-weight:700;font-size:var(--fs-sm);color:var(--tinta)}
  .rm-form{display:flex;flex-direction:column;gap:14px}
  .rm-cab{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .rm-sw{position:static}
  .rm-campo{display:flex;flex-direction:column;gap:6px;min-width:0}
  .rm-linha{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,220px));gap:12px}
  .rm-btns{display:flex;gap:10px}
  .rm-dias{display:flex;flex-wrap:wrap;gap:6px}
  .rm-dia{position:relative;cursor:pointer}.rm-dia input{position:absolute;opacity:0}
  .rm-dia span{display:inline-block;padding:6px 13px;border:1px solid var(--linha);border-radius:999px;font-weight:600;font-size:var(--fs-sm);background:var(--card)}
  .rm-dia input:checked+span{background:var(--teal);border-color:var(--teal);color:#fff}
  .rm-dia input:focus-visible+span{outline:2px solid var(--teal);outline-offset:2px}
  .rm-prev{display:grid;grid-template-columns:minmax(0,432px) minmax(0,1fr);gap:18px;align-items:start}
  .rm-img{width:100%;aspect-ratio:1080/1350;overflow:hidden;border-radius:12px;border:1px solid var(--linha);position:relative}
  .rm-img iframe{position:absolute;top:0;left:0;width:1080px;height:1350px;border:0;transform-origin:0 0;transform:scale(var(--rm-esc,.4))}
  .rm-txt{white-space:pre-wrap;font-family:inherit;font-size:var(--fs-sm);background:#e7f6ee;border-radius:12px;padding:14px 16px;margin:0;line-height:1.5;color:var(--tinta)}
  @media(max-width:760px){.rm-prev{grid-template-columns:1fr}}
  .al-filtros{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,1fr) minmax(220px,2fr);gap:10px 12px;align-items:end}
  .al-filtros label{display:flex;flex-direction:column;gap:5px;min-width:0}
  .al-filtros .al-f-larg:last-of-type{grid-column:1/-1}
  .al-busca{display:flex;gap:8px}.al-busca input{flex:1;min-width:0}
  .al-resumo{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin:0 0 10px;font-size:var(--fs-sm)}
  .al-resumo b{font-size:1.05rem;color:var(--tinta)}
  .wrap .al-tab td{vertical-align:top}
  .al-tab .al-nome{font-weight:700;color:var(--tinta)}
  .al-tab .al-nome a{color:var(--tinta);text-decoration:none}.al-tab .al-nome a:hover{color:var(--teal);text-decoration:underline}
  .al-tab .al-nome .ip-pill{margin-left:8px;vertical-align:1px}
  .al-sub{font-weight:500;font-size:var(--fs-xs);color:var(--cinza);margin-top:3px}
  .al-tab .al-contr{color:var(--cinza);font-size:var(--fs-xs);max-width:300px}
  .al-tab .al-data{white-space:nowrap}.al-rot{display:none}
  .al-tab .al-evo{text-align:right;width:1%}
  .al-pag{display:flex;align-items:center;justify-content:center;gap:10px;margin:14px 0 0;flex-wrap:wrap}
  .al-pag [aria-disabled]{opacity:.4;pointer-events:none}
  .al-nums{display:flex;gap:4px;align-items:center}
  .al-nums a,.al-nums b{min-width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-weight:700;font-size:var(--fs-sm);text-decoration:none}
  .al-nums a{color:var(--tinta)}.al-nums a:hover{background:var(--linha-soft)}
  .al-nums b{background:var(--teal);color:#fff}
  @media(max-width:640px){
    .al-filtros{grid-template-columns:1fr 1fr}.al-filtros .al-f-larg{grid-column:1/-1}
    .al-tab thead{display:none}
    .al-tab tr{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 0;border-bottom:1px solid var(--linha-soft)}
    .wrap table.al-tab td{border:0;padding:0;background:none}
    .wrap table.al-tab tbody tr:last-child{border-bottom:0}
    .al-tab .al-nome{grid-column:1}.al-tab .al-evo{grid-column:2;grid-row:1/span 3;align-self:center}
    .al-tab .al-contr,.al-tab .al-data{grid-column:1;max-width:none;font-size:var(--fs-xs);color:var(--cinza)}
    .al-rot{display:inline}
  }
  a.stat-link{display:block;color:inherit;text-decoration:none;transition:border-color .15s}
  a.stat-link:hover,a.stat-link:focus-visible{border-color:var(--teal)}
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
  .segs{position:sticky;top:var(--seg-top,var(--topbar-h,46px));z-index:54;display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px;padding:9px 0;background:var(--bg);box-shadow:0 5px 6px -6px rgba(16,24,40,.16)}
  .segs a{text-decoration:none;font-weight:700;font-size:var(--fs-sm);color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:999px;padding:6px 13px}
  .segs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  .testbar{background:var(--warn-bg);border:1px solid var(--warn-bd)}
  .testbar label{margin:0 0 4px}
  .testbar input{max-width:260px}
  .prev{margin-top:10px}
  .prev-t{font-size:var(--fs-xs);font-weight:700;color:var(--cinza);margin-bottom:4px}
  .prev-b{white-space:pre-wrap;word-break:break-word;background:#eef7f7;border:1px solid #cdeaea;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);line-height:1.5}
  .prev-b.ok{background:var(--ok-bg);border-color:var(--ok-bd);color:var(--ok)}
  .prev-b.err{background:var(--erro-bg);border-color:var(--erro-bd);color:var(--erro)}
  /* ── Peças comuns do painel (topo de tela, filtros, botões, avisos, pessoas) ── */

  .ui-topo{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:16px 18px;margin:4px 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:12px}
  .ui-tt{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .ui-tt h2{margin:0;font-size:1.08rem;font-weight:800;color:var(--tinta)}
  .ui-tt p{margin:3px 0 0;color:var(--cinza);font-size:var(--fs-sm);max-width:75ch;line-height:1.45}
  .ui-acoes{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ui-linha{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
  .ui-lbl{font-size:var(--fs-xs);font-weight:700;color:var(--cinza);text-transform:uppercase;letter-spacing:.05em;min-width:62px}
  .ui-chips{display:flex;flex-wrap:wrap;gap:6px}
  .ui-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border:1px solid var(--linha);border-radius:999px;background:var(--card);color:var(--tinta);font-weight:600;font-size:var(--fs-sm);text-decoration:none;white-space:nowrap}
  .ui-chip:hover{border-color:var(--teal);color:var(--teal-esc)}
  .ui-chip.on{background:var(--teal);border-color:var(--teal);color:#fff}
  .ui-chip .ct{opacity:.7;font-variant-numeric:tabular-nums}
  .ui-datas{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0}
  .ui-datas input[type=date]{width:150px;flex:none;padding:6px 9px;border:1px solid var(--linha);border-radius:8px;font:inherit;font-size:var(--fs-sm);background:var(--card);color:var(--tinta)}
  .ui-datas .ate{color:var(--cinza);font-size:var(--fs-sm)}
  .ui-btn{border:1px solid var(--teal);background:var(--teal);color:#fff;border-radius:9px;padding:6px 14px;font:inherit;font-weight:700;font-size:var(--fs-sm);cursor:pointer;text-decoration:none;white-space:nowrap}
  .ui-btn.sec{background:var(--card);color:var(--teal-esc);border-color:var(--linha)}
  .ui-btn.sec:hover{border-color:var(--teal);background:var(--teal-soft)}
  .ui-btn.perigo{background:var(--card);color:var(--erro);border-color:var(--erro-bd)}
  .ui-btn:not(.sec):not(.perigo):hover{background:var(--teal-esc);border-color:var(--teal-esc)}
  .ui-btn:disabled{opacity:.5;cursor:default}
  .ui-nota{background:var(--avi-bg);border:1px solid var(--avi-bd);color:var(--avi-tx);border-radius:10px;padding:9px 12px;font-size:var(--fs-sm);display:flex;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;align-items:center}
  .ui-nota.erro{background:var(--erro-bg);border-color:var(--erro-bd);color:var(--erro)}
  .ui-rodape{text-align:center;color:var(--cinza);font-size:var(--fs-xs);line-height:1.55;max-width:85ch;margin:16px auto 6px}
  /* Linha de pessoa (Funil e Professoras) */
  .ip-lista{display:flex;flex-direction:column}
  .ip-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 14px;padding:11px 6px;border-bottom:1px solid var(--linha-soft);align-items:center}
  .ip-row:last-child{border-bottom:0}
  .ip-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
  .ip-nome{font-weight:700;color:var(--tinta);text-decoration:none;font-size:.9rem}
  a.ip-nome:hover{color:var(--teal-esc);text-decoration:underline}
  .ip-pill{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid;white-space:nowrap}
  .ip-fechou{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd)}
  .ip-fez,.ip-veio{background:var(--teal-soft);color:var(--teal-esc);border-color:var(--avi-bd)}
  .ip-faltou{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-bd)}
  .ip-aguardando,.ip-agendada,.ip-jaaluna{background:var(--linha-soft);color:var(--cinza);border-color:var(--linha)}
  .ip-semreg{background:var(--warn-bg, #fdf3e1);color:var(--warn);border-color:var(--warn-bd, #f1d9a8)}
  .ip-meta{grid-column:1;grid-row:2;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.78rem;color:var(--cinza)}
  .ip-meta b{color:var(--tinta);font-weight:600}
  .ip-acao{grid-column:2;grid-row:1 / span 2;display:flex;gap:6px}
  .ip-evo{font-size:.75rem;font-weight:700;color:var(--teal-esc);border:1px solid var(--linha);border-radius:8px;padding:4px 10px;text-decoration:none;white-space:nowrap;background:var(--card)}
  .ip-evo:hover{border-color:var(--teal)}
  .ip-val{font-weight:800;color:var(--tinta);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
  .ip-val small{font-weight:600;color:var(--faint)}
  @media(max-width:600px){.ui-topo{padding:14px}.ip-row{grid-template-columns:1fr}.ip-meta{grid-row:auto}.ip-acao{grid-column:1;grid-row:auto}.ui-lbl{min-width:0;width:100%}}
  /* Tabelas: um só visual em todo o painel (cabeçalho discreto, linhas finas). */
  .ui-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .wrap :is(.ui-tab,.ct-tab,.ct-int-tab,.fm-tab,.logtab,.pf-tab) th{text-align:left;font-family:"Inter";font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--linha);background:var(--bg);white-space:nowrap}
  .wrap :is(.ui-tab,.ct-tab,.ct-int-tab,.fm-tab,.logtab,.pf-tab) td{padding:10px 12px;border-bottom:1px solid var(--linha-soft);vertical-align:middle}
  .wrap :is(.ui-tab,.ct-tab,.ct-int-tab,.fm-tab,.logtab,.pf-tab) tbody tr:last-child td{border-bottom:0}
  .wrap :is(.ui-tab,.ct-tab,.ct-int-tab,.fm-tab,.logtab,.pf-tab) tbody tr:hover td{background:var(--linha-soft)}
  .wrap :is(.ui-tab,.ct-tab,.fm-tab,.logtab,.pf-tab) td{font-variant-numeric:tabular-nums}
  /* Gráfico de barras padrão do painel: rótulo · trilho (com % dentro) · valor.
     Cores: teal = volume, verde (--ok) = sucesso, vermelho (--erro) = falta/erro,
     cinza = pendente. Usar uiBarra()/uiTrilho() — não desenhar barra à mão. */
  .ui-bar{display:flex;align-items:center;gap:10px;margin:8px 0}
  .ui-bar-rot{width:150px;flex:none;color:var(--tinta);font-weight:600;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ui-bar-val{flex:none;min-width:44px;text-align:right;font-weight:700;color:var(--tinta);font-variant-numeric:tabular-nums;font-size:.88rem;white-space:nowrap}
  .ui-bar-val small{font-weight:600;color:var(--cinza)}
  .ui-trilho{display:block;flex:1;min-width:80px;height:24px;background:var(--linha-soft);border-radius:8px;overflow:hidden;position:relative}
  .ui-trilho>i{display:block;height:100%;border-radius:8px 0 0 8px}
  .ui-trilho>em{position:absolute;top:0;bottom:0;display:flex;align-items:center;font-style:normal;font-size:.76rem;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none}
  .ui-bar.fino{margin:5px 0}
  .ui-bar.fino .ui-bar-rot{font-weight:500;color:var(--cinza);font-size:.8rem}
  .ui-bar.fino .ui-trilho{height:10px;border-radius:999px}
  .ui-bar.fino .ui-trilho>i{border-radius:999px}
  .ui-bar.fino .ui-bar-val{font-size:.8rem}
  .ui-bar.largo .ui-bar-rot{width:250px}
  .ui-bar.clic{cursor:pointer}
  .ui-bar.clic:hover .ui-trilho{box-shadow:0 0 0 2px var(--teal-soft)}
  @media(max-width:600px){.ui-bar{flex-wrap:wrap;row-gap:3px}.ui-bar-rot{width:100%}}
  footer{color:var(--cinza);font-size:var(--fs-xs);text-align:center;padding:18px}
  /* Contatos — tabela + modal */
  .ct-wrap{background:var(--card);border:1px solid var(--linha);border-radius:12px;overflow-x:auto;margin:10px 0}
  .ct-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm);table-layout:fixed}
  .ct-int-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .ct-int-tab th{text-align:left;font-family:"Inter";font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;padding:9px 8px;border-bottom:1px solid var(--linha)}
  .ct-int-tab td{padding:10px 8px;border-bottom:1px solid var(--linha);vertical-align:middle}
  .ct-int-tab tr:last-child td{border-bottom:0}
  .ct-badge{display:inline-block;font-size:.7rem;font-weight:700;padding:2px 9px;border-radius:999px}
  .ct-badge.ativa{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-bd)}
  .ct-badge.enc{background:#eef0f1;color:#6b6b70;border:1px solid #dfe1e3}
  .cpf-sec{border-top:1px solid var(--linha);margin-top:20px;padding-top:18px}
  .cpf-sec.first{border-top:0;margin-top:0;padding-top:0}
  .cpf-h{font-family:"Inter";font-weight:700;font-size:var(--fs-sec);margin:0 0 14px;display:flex;align-items:center;gap:8px}
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
  .info.aviso{background:#fbe6c2;color:#9a6512;border:1px solid #e6b357;width:17px;height:17px;border-radius:50%;font-size:.74rem;font-weight:800}
  .info.aviso:hover,.info.aviso:focus{background:#e0a53a;color:#fff;border-color:#e0a53a;outline:none}
  .info.aviso .info-pop{border-left:3px solid #e0a53a;width:300px}
  @keyframes waPulseOff{0%{box-shadow:0 0 0 0 rgba(192,57,43,.55)}70%{box-shadow:0 0 0 9px rgba(192,57,43,0)}100%{box-shadow:0 0 0 0 rgba(192,57,43,0)}}
  #waTag.wa-off{font-size:.82rem!important;padding:4px 14px!important;font-weight:800!important;border:1.5px solid currentColor;animation:waPulseOff 1.7s ease-out infinite;text-transform:uppercase;letter-spacing:.2px}
  @media(prefers-reduced-motion:reduce){ #waTag.wa-off{animation:none} }
  .cfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px 22px}
  .cfg-grid label{display:flex;align-items:center;font-weight:700;font-size:.82rem;margin:0 0 6px}
  .cfg-in{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cfg-in input[type=number]{width:92px;flex:none}
  .cfg-in .suf{color:var(--cinza);font-size:var(--fs-sm)}
  .cpf-acc{border-top:1px solid var(--linha);margin-top:6px}
  .cpf-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:"Inter";font-weight:700;font-size:var(--fs-sec);padding:16px 0}
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
  .cp-h{font-family:"Inter";font-weight:700;font-size:var(--fs-sm);margin:0 0 4px}
  .cp-list{max-height:200px;overflow-y:auto;border:1px solid var(--linha);border-radius:10px;padding:2px 12px}
  .cp-list>div:last-child{border-bottom:0}
  .ct-tab col.c-nome{width:32%}.ct-tab col.c-tel{width:21%}.ct-tab col.c-tags{width:31%}.ct-tab col.c-act{width:16%}
  .ct-tab th{text-align:left;font-family:"Inter";font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;letter-spacing:.03em;padding:11px 14px;border-bottom:1px solid var(--linha);white-space:nowrap;background:#fafbfb}
  .ct-tab td{padding:10px 14px;border-bottom:1px solid var(--linha);vertical-align:middle}
  .ct-tab tbody tr:last-child td{border-bottom:0}
  .ct-row{cursor:pointer;transition:background .12s}
  .ct-row:hover{background:#f6fbfb}
  .ct-av{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;border-radius:50%;color:#fff;font-weight:700;font-size:.78rem;font-family:"Inter"}
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
  .ct-hnome{font-family:"Inter";font-weight:700;font-size:1.05rem}
  .ct-htel{color:var(--cinza);font-size:var(--fs-sm);font-variant-numeric:tabular-nums}
  .ct-dlg label{display:block;font-weight:700;font-size:var(--fs-sm);margin:0 0 5px}
  .ct-tglist{display:flex;flex-wrap:wrap;gap:7px}
  .ct-tg{border:1px solid #e8e8ea;border-radius:999px;padding:5px 12px;font-size:.78rem;font-weight:600;cursor:pointer;transition:.12s}
  .ct-nova{display:flex;gap:8px;margin-top:10px}
  .ct-nova input{flex:1}
  .ct-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--linha)}
`;

// Menu de abas, mostrando só as telas que o usuário logado pode ver (+ Perfis p/ admin).
// A aba Instagram fica escondida (o Studio não usa). Volta com PAINEL_INSTAGRAM=1 no .env.
const IG_NO_PAINEL = /^(1|true|sim|on)$/i.test(String(process.env.PAINEL_INSTAGRAM || '').trim());
// Pagamento dos professores (porte do sf-pagamento): só nas unidades com PAGAMENTO_PROFESSORES=1 no .env.
const PAGAMENTO_ATIVO = /^(1|true|sim|on)$/i.test(String(process.env.PAGAMENTO_PROFESSORES || '').trim());
function navTabs(ativo) {
  const sess = E._navSess || { admin: true, telas: usuarios.TELAS_KEYS };
  const pode = k => sess.admin || (sess.telas || []).includes(k);
  const cel = (href, on, ic, tx, cls) => `<a href="${href}" class="nav-${cls}${on ? ' on' : ''}"><span class="tic">${ic}</span><span class="ttx">${tx}</span></a>`;
  const item = (k, href, ic, tx) => pode(k) ? cel(href, ativo === k, ic, tx, k) : '';
  // Ordem no HTML mantém a SoFIA por ÚLTIMO: no mobile ela cai sozinha na 2ª
  // linha ocupando a largura toda (destaque). No DESKTOP, o CSS (order) exibe na
  // ordem pedida: SoFIA → WhatsApp → Instagram → Formulário → Perfis.
  // Formulário = formulários de campanha (editáveis). Os números do formulário de agendamento ficam em Indicadores.
  let html = pode('formularios') ? cel('/formularios', ativo === 'formularios', '📈', 'Formulário', 'ind') : '';
  if (temMsg(sess)) html += cel(msgHref(sess), ativo === 'msg', '💬', 'WhatsApp', 'msg');
  if (IG_NO_PAINEL) html += item('ig', '/instagram', '📸', 'Instagram');
  // Indicadores = Funil + Formulário + Professoras + Grade, cada um com a sua permissão. Abre no primeiro permitido.
  const indHref = podeFunil(sess) ? '/funil' : pode('ind') ? '/indicadores' : pode('professoras') ? '/professoras' : pode('ativas') ? '/ativas' : pode('grade') ? '/grade' : (PAGAMENTO_ATIVO && pode('pagamento')) ? '/pagamento' : '';
  if (indHref) html += cel(indHref, ativo === 'grade' || ativo === 'funil' || ativo === 'ind' || ativo === 'professoras' || ativo === 'ativas' || ativo === 'pagamento', '📊', 'Indicadores', 'grade');
  if (pode('slimclub')) { // número = o que espera a recepção (cadastros, alterações, reclamações)
    const n = slimclub.pendenciasRecepcao();
    html += item('slimclub', '/clube', '🤝', 'Slim Club' + (n ? ` <span class="nav-badge" title="${n} para a recepção ver">${n}</span>` : ''));
  }
  if (temSofia(sess)) html += cel(sofiaHref(sess), ativo === 'sofia', '🤖', 'SoFIA', 'sofia');
  return html;
}

// ── Menu da conta (avatar no canto superior direito) ────────────────────────
// Foto: a do Google (gravada no login com Google); sem foto, as iniciais num
// círculo de cor fixa por usuário. A bolinha no avatar mostra a Saúde (amarelo/
// vermelho) para quem pode ver a Saúde — assim um problema aparece em qualquer tela.
const FOTOS_FILE = path.resolve(__dirname, '..', 'data', 'fotos-usuarios.json');
function fotoDe(usuario) {
  try { const m = JSON.parse(fs.readFileSync(FOTOS_FILE, 'utf8')) || {}; const f = String(m[String(usuario || '').toLowerCase()] || ''); return /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(f) ? f : ''; }
  catch (_) { return ''; }
}
function iniciais(usuario) {
  const p = String(usuario || '').trim().split(/[\s._@-]+/).filter(Boolean);
  return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] || '?').slice(0, 2)).toUpperCase();
}
const AV_CORES = ['#0e6e6b', '#495a95', '#8a6a2e', '#6f4e8f', '#a5473f', '#3c8258', '#95517a'];
function avatar(usuario, dot) {
  let h = 0; for (const ch of String(usuario || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const foto = fotoDe(usuario);
  return `<span class="av" style="background:${AV_CORES[h % AV_CORES.length]}" aria-hidden="true">${esc(iniciais(usuario))}${foto ? `<img src="${esc(foto)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${dot || ''}</span>`;
}
// Último estado geral da Saúde (calculado por paginaSaude — na visita à tela e a
// cada 3 min em segundo plano). { cor: 'ok'|'warn'|'erro', em }.
// (estado "_saudeCor" → painel-estado.js)
function menuConta(ativo) {
  const sess = E._navSess;
  const podeSaude = sess.admin || (sess.telas || []).includes('saude');
  const sc = (podeSaude && E._saudeCor && Date.now() - E._saudeCor.em < 15 * 60 * 1000) ? E._saudeCor.cor : '';
  const dot = (sc === 'warn' || sc === 'erro') ? `<span class="av-dot ${sc}" title="${sc === 'erro' ? 'Saúde: há um problema' : 'Saúde: atenção'}"></span>` : '';
  const PILL = { ok: '<span class="sd-pill sd-ok">🟢 OK</span>', warn: '<span class="sd-pill sd-warn">🟡 Atenção</span>', erro: '<span class="sd-pill sd-erro">🔴 Problema</span>' };
  const studio = esc(config.STUDIO_NOME || '');
  const papel = sess.admin ? 'Administrador' : 'Equipe';
  return `<details class="conta${ativo === 'saude' || ativo === 'perfis' ? ' on' : ''}">
    <summary aria-label="Menu da conta"><span class="conta-txt"><b>${esc(sess.usuario)}</b><small>${studio}</small></span>${avatar(sess.usuario, dot)}</summary>
    <div class="conta-menu">
      <div class="conta-cab">${avatar(sess.usuario)}<div><b>${esc(sess.usuario)}</b><span>${papel}${studio ? ' · ' + studio : ''}</span></div></div>
      ${podeSaude ? `<a href="/saude"${ativo === 'saude' ? ' class="on"' : ''}>🩺 Saúde do sistema ${sc ? PILL[sc] : ''}</a>` : ''}
      ${sess.admin ? `<a href="/perfis"${ativo === 'perfis' ? ' class="on"' : ''}>👤 Perfis e acessos</a>` : ''}
      <a href="/politicadeprivacidade" target="_blank" rel="noopener">📄 Política de privacidade <span style="margin-left:auto;color:var(--faint);font-weight:500">↗</span></a>
      <div class="conta-sep"></div>
      <a href="/logout" class="sair">↪ Sair</a>
    </div>
  </details>`;
}

function chrome(titSubtitulo, ativo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titSubtitulo.tab)} · SlimFit</title>
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>${ESTILO}</style></head><body>
<nav class="topbar"><div class="in">
  <img class="tb-logo" alt="SlimFit Studio" src="https://drive.google.com/thumbnail?id=1pl1mh709FGcitG9uHo0J6nzMUKFYqg-w&sz=w400">
  <div class="tabs">${navTabs(ativo)}</div>
  ${E._navSess ? menuConta(ativo) : ''}
</div></nav>
${corpo}
<footer>SlimFit · painel do Studio</footer>
<script>
/* Menu da conta: fecha ao clicar fora ou com Esc. */
(function(){ var c=document.querySelector('details.conta'); if(!c) return;
  document.addEventListener('click',function(e){ if(c.open && !c.contains(e.target)) c.open=false; });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && c.open){ c.open=false; c.querySelector('summary').focus(); } });
})();
</script>
<script>
/* Altura real da barra de topo (varia: no mobile ela quebra em 2 linhas) vira a
   variável --topbar-h, usada pelo submenu (.subtabs) para "grudar" logo abaixo
   dela ao rolar — no desktop e no celular. */
(function(){
  function setTBH(){ try{
    var tb=document.querySelector('.topbar'); var h=tb?Math.round(tb.getBoundingClientRect().height):46;
    document.documentElement.style.setProperty('--topbar-h', h+'px');
    // Se a tela tem submenu (.subtabs), o filtro de período (.segs) gruda ABAIXO dele.
    var st=document.querySelector('.subtabs'); var sh=st?Math.round(st.getBoundingClientRect().height):0;
    document.documentElement.style.setProperty('--seg-top', (h+sh)+'px');
  }catch(e){} }
  setTBH();
  window.addEventListener('resize', setTBH);
  window.addEventListener('load', setTBH);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(setTBH);
})();
</script>
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
      // Para no próximo cabeçalho .sec-t OU num bloco que já é uma seção recolhível
      // própria (.acc-sec) — assim uma seção não "engole" a seguinte (ex.: o
      // "Gerador de links" deixa de virar parte de "Horários de aula").
      // (um .acc-sec com data-dentro faz parte da seção de cima; a barra fixa de salvar .hbar fica de fora)
      while(el && !(el.classList && (el.classList.contains('sec-t') || el.classList.contains('hbar') || (el.classList.contains('acc-sec') && !el.hasAttribute('data-dentro'))))){ sibs.push(el); el=el.nextElementSibling; }
      if(!sibs.length) return;
      var det=document.createElement('details'); det.className='acc-sec'; if(h.id){ det.id=h.id; }
      var sum=document.createElement('summary'); sum.className='sec-t'; sum.innerHTML=h.innerHTML;
      det.appendChild(sum); sibs.forEach(function(s){ det.appendChild(s); });
      var key='sec:'+location.pathname+':'+(sum.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60);
      var aberto=true; try{ if(localStorage.getItem(key)==='0') aberto=false; }catch(e){}
      det.open=aberto;
      det.addEventListener('toggle',function(){ try{ localStorage.setItem(key, det.open?'1':'0'); }catch(e){} });
      h.parentNode.replaceChild(det,h);
    });
    // Índice "Ir para": abre a seção antes de rolar até ela.
    document.addEventListener('click',function(ev){
      var a=ev.target.closest && ev.target.closest('a[href^="#sec-"]'); if(!a) return;
      var t=document.getElementById(a.getAttribute('href').slice(1)); if(t && t.tagName==='DETAILS') t.open=true;
    });
  }catch(e){}
})();
</script>
</body></html>`;
}
// Script de pré-visualizar/enviar teste + inserir variável (compartilhado).
function scriptPreviewTeste() {
  const exemplosJson = JSON.stringify(mensagens.exemplosCompletos()).replace(/</g, '\\u003c');
  const exemplosChaveJson = JSON.stringify(mensagens.exemplosPorChave()).replace(/</g, '\\u003c');
  return `<script>
  var EXEMPLOS = ${exemplosJson};
  var EXEMPLOS_CHAVE = ${exemplosChaveJson};
  // Liga/Desliga de um envio (switch). chavesCsv = 1+ jobs separados por vírgula.
  function toggleEnvio(chavesCsv, el){
    var on = el.checked;
    var id = chavesCsv.split(',').join('_');
    var wrap = document.getElementById('envsw_'+id);
    var st = document.getElementById('envst_'+id);
    function pinta(v){ if(st) st.textContent = v ? 'Ativado' : 'Desligado'; if(wrap){ wrap.classList.toggle('on', v); wrap.classList.toggle('off', !v); }
      // avisos do cartão que dependem do liga/desliga (ex.: "Saída — não renovou")
      var card = wrap && wrap.closest('.card'); if(card) [].forEach.call(card.querySelectorAll('[data-se-desligado]'), function(n){ n.style.display = v ? 'none' : ''; }); }
    pinta(on);
    fetch('/envio/ativo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chaves:chavesCsv.split(','),ativo:on})})
      .then(function(r){return r.json();})
      .then(function(j){ if(!j||!j.ok){ el.checked=!on; pinta(!on); alert('Não consegui salvar o estado deste envio.'); } })
      .catch(function(){ el.checked=!on; pinta(!on); alert('Falha de conexão ao salvar.'); });
  }
  function inserirVar(el, token){
    var ta = el.closest('form').querySelector('textarea');
    if(!ta) return;
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length;
  }
  function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function renderEx(txt, chave){
    var ex = EXEMPLOS;
    if(chave && EXEMPLOS_CHAVE[chave]){ ex = {}; for(var g in EXEMPLOS) ex[g]=EXEMPLOS[g]; for(var o in EXEMPLOS_CHAVE[chave]) ex[o]=EXEMPLOS_CHAVE[chave][o]; }
    for(var k in ex){ txt = txt.split('{'+k+'}').join(ex[k]); } return txt;
  }
  function cardChave(card){ var i = card.querySelector('input[name="chave"]'); return i ? i.value : ''; }
  function previewMsg(btn){
    var card = btn.closest('.card'); var ta = card.querySelector('textarea'); var b = card.querySelector('.prev');
    // Flyer: se a mensagem tem foto E o "Enviar com foto" está marcado, mostra o flyer no preview.
    var chk = card.querySelector('.mfChk'); var thumb = card.querySelector('.mfThumb');
    var imgHtml = '';
    if(chk && chk.checked && thumb && thumb.getAttribute('src')){
      imgHtml = '<img src="'+thumb.getAttribute('src')+'" alt="flyer" style="max-width:200px;border-radius:9px;display:block;margin:0 0 8px">';
    }
    b.style.display='block';
    b.innerHTML = '<div class="prev-t">👁 Como a pessoa vê (valores de exemplo):</div><div class="prev-b">'+imgHtml+escHtml(renderEx(ta.value, cardChave(card)))+'</div>';
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
    // Se "Enviar com foto" está marcado, manda a chave da mensagem p/ o robô anexar o flyer salvo.
    var chaveInp = card.querySelector('input[name="chave"]');
    var comFoto = !!(card.querySelector('.mfChk') && card.querySelector('.mfChk').checked);
    var chaveMsg = chaveInp ? chaveInp.value : '';
    try{
      var r = await fetch('/teste/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:tel, texto:ta.value, chave:chaveMsg, comFoto:comFoto})});
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
  // Teste da cobrança: enfileira na fila da SoFIA (sai pelo NÚMERO dela, não o do robô).
  async function testarCobranca(btn){
    var tel = soDigTeste((_tt&&_tt.value)||'');
    var card = btn.closest('.card'); var ta = card.querySelector('textarea'); var b = card.querySelector('.prev');
    if(tel.length<10){ alert('Preencha o "Número para testes" no topo da página.'); if(_tt) _tt.focus(); return; }
    var chaveInp = card.querySelector('input[name="chave"]'); var chaveMsg = chaveInp?chaveInp.value:'';
    b.style.display='block'; b.innerHTML='<div class="prev-b">⏳ Enfileirando teste pela SoFIA…</div>'; btn.disabled=true;
    try{
      var r = await fetch('/cobranca/teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:tel, texto:ta.value, chave:chaveMsg})});
      var d = await r.json();
      if(d.ok) b.innerHTML='<div class="prev-b ok">✅ Teste enfileirado — a SoFIA envia para '+escHtml(tel)+' em instantes (pelo número dela). Confira o WhatsApp.</div>';
      else b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(d.erro||'Não foi possível enfileirar.')+'</div>';
    }catch(e){ b.innerHTML='<div class="prev-b err">⚠️ '+escHtml(e.message||'Falha.')+'</div>'; }
    finally{ btn.disabled=false; }
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
      var _fr=wrap.closest('.fotorow'), _ps=_fr&&_fr.querySelector('.foto-status'); if(_ps){_ps.textContent='✓ com foto';_ps.className='foto-status on';}
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
      var _fr=wrap.closest('.fotorow'), _ck=_fr&&_fr.querySelector('.mfChk'); if(_ck)_ck.checked=false; var _ps=_fr&&_fr.querySelector('.foto-status'); if(_ps){_ps.textContent='sem foto';_ps.className='foto-status off';}
      msg.textContent='Foto removida — volta a enviar só o texto.';
    }catch(e){ msg.textContent='⚠️ '+(e.message||'Falha.'); btn.disabled=false; }
  }
  // Áudio da professora: envia/troca/remove e recarrega o bloco aberto.
  async function auEnviar(inp, grupo){
    var box=inp.closest('.audrow'), msg=box.querySelector('.auMsg'), f=inp.files[0]; if(!f) return;
    var row=inp.closest('.au-row'), nome=row ? row.getAttribute('data-nome') : (box.querySelector('.auNovoNome').value||'').trim();
    if(!nome){ msg.textContent='Escreva o nome da professora.'; return; }
    if(f.size>16*1024*1024){ msg.textContent='Áudio muito grande (máx. 16 MB).'; inp.value=''; return; }
    msg.textContent='Enviando o áudio de '+nome+'…';
    try{
      var dataUrl=await mfLer(f);
      var r=await fetch('/mensagem/audio/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grupo:grupo, professora:nome, nome:f.name, dataUrl:dataUrl})});
      var d=await r.json();
      if(!d.ok){ msg.textContent='⚠️ '+(d.erro||'Falha ao salvar.'); inp.value=''; return; }
      location.hash=box.id; location.reload();
    }catch(e){ msg.textContent='⚠️ '+(e.message||'Falha.'); }
  }
  async function auRemover(btn, grupo){
    var row=btn.closest('.au-row'); if(!confirm('Remover o áudio de '+row.getAttribute('data-nome')+'?')) return;
    btn.disabled=true;
    try{ await fetch('/mensagem/audio/remover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grupo:grupo, slug:row.getAttribute('data-slug')})}); location.hash=btn.closest('.audrow').id; location.reload(); }
    catch(e){ btn.disabled=false; }
  }
  // Volta com o bloco de áudio aberto depois de enviar/remover.
  (function(){ var h=location.hash; if(h.indexOf('#audio-')===0){ var d=document.getElementById(h.slice(1)); if(d){ d.open=true; setTimeout(function(){ d.scrollIntoView({block:'center'}); },50); } } })();
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
    : opts.cobranca
    ? `<button type="button" class="tbtn" onclick="testarCobranca(this)">🧪 Enviar teste (pela SoFIA)</button>`
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
    </form>${audiosMsg.grupoDaChave(m.chave) ? cardAudio(audiosMsg.grupoDaChave(m.chave), m.chave) : ''}`;
}

// Professoras que aparecem na agenda de experimentais do EVO (últimos 120 dias),
// para listar no bloco de áudio. Guardado 1 min (a página monta 4 cards).
// (estado "_profsAudio" → painel-estado.js)
function professorasRecentes() {
  if (Date.now() - E._profsAudio.em < 60000) return E._profsAudio.lista;
  const desde = new Date(Date.now() - 120 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const vistos = new Map();
  try { for (const a of Object.values(histExp.ler().aulas)) if (a.prof && a.dia >= desde) { const k = audiosMsg.slugProf(a.prof); if (k && !vistos.has(k)) vistos.set(k, a.prof); } } catch (_) {}
  E._profsAudio = { em: Date.now(), lista: [...vistos.values()] };
  return E._profsAudio.lista;
}
// (estado "_ffmpegOk" → painel-estado.js)

// Bloco "🎙️ Áudio da professora" (follow-up e confirmação): um áudio por
// professora, enviado como mensagem de voz logo depois do texto.
function cardAudio(grupo, chave) {
  const G = audiosMsg.GRUPOS[grupo];
  const itens = audiosMsg.listar(grupo, professorasRecentes());
  const com = itens.filter(i => i.origem).length;
  if (E._ffmpegOk === null) E._ffmpegOk = audiosMsg.temFfmpeg();
  const outros = grupo === 'followup' ? 'Vale para os dois follow-ups (ainda não fechou e já virou aluna).' : grupo === 'confirmacao_amanha' ? 'Só para a confirmação da aula de <b>amanhã</b> (a de hoje tem os áudios dela).' : 'Só para a confirmação da aula de <b>hoje</b> (a de amanhã tem os áudios dela).';
  const linhas = itens.map(i => {
    const src = i.origem ? `/mensagem/audio?grupo=${grupo}&slug=${encodeURIComponent(i.slug)}&v=${Date.now()}` : '';
    const selo = i.origem === 'painel' ? '<small class="pn">✓ com áudio</small>' : i.origem === 'sistema' ? '<small class="sis">áudio antigo (pasta do sistema)</small>' : '<small class="sem">sem áudio</small>';
    const aviso = i.origem && !i.voz ? ' <small class="sis" title="Sem ffmpeg no servidor: só .ogg/.opus chegam como mensagem de voz">vai como arquivo</small>' : '';
    return `<div class="au-row" data-slug="${esc(i.slug)}" data-nome="${esc(i.nome)}">
        <div class="au-nome">${esc(i.nome)} ${selo}${aviso}</div>
        <div class="au-acts">
          <input type="file" class="auFile" accept="audio/*,.ogg,.opus,.mp3,.m4a,.aac,.wav" style="display:none" onchange="auEnviar(this,'${grupo}')">
          <button type="button" class="tbtn" onclick="this.parentNode.querySelector('.auFile').click()">${i.origem === 'painel' ? 'Trocar áudio' : 'Enviar áudio'}</button>
          ${i.origem === 'painel' ? `<button type="button" class="rm" onclick="auRemover(this,'${grupo}')">Remover</button>` : ''}
        </div>
        ${src ? `<audio controls preload="none" src="${src}"></audio>` : ''}
      </div>`;
  }).join('');
  return `<details class="foto-acc audrow" id="audio-${esc(chave || grupo)}">
    <summary>🎙️ Áudio da professora <span class="foto-status ${com ? 'on' : 'off'}">${com ? `✓ ${com} com áudio` : 'sem áudio'}</span></summary>
    <div class="foto-body">
      <p class="meta" style="margin:6px 0 0">Vai como <b>mensagem de voz</b> logo depois do texto, com o áudio da <b>professora da aula</b>. Quem não tem áudio recebe só o texto. ${outros}</p>
      ${E._ffmpegOk ? '' : '<p class="meta" style="margin:6px 0 0;color:var(--warn)">⚠️ Este servidor não tem o conversor de áudio (ffmpeg): só arquivos .ogg chegam como mensagem de voz; os outros vão como arquivo. Para converter qualquer formato, rode no servidor: <code>apt install -y ffmpeg</code></p>'}
      ${linhas ? `<div class="au-lista">${linhas}</div>` : ''}
      <div class="au-nova">
        <input type="text" class="auNovoNome" placeholder="Outra professora (nome)">
        <input type="file" class="auFile" accept="audio/*,.ogg,.opus,.mp3,.m4a,.aac,.wav" style="display:none" onchange="auEnviar(this,'${grupo}')">
        <button type="button" class="tbtn" onclick="var n=this.parentNode.querySelector('.auNovoNome');if(!n.value.trim()){n.focus();return;}this.parentNode.querySelector('.auFile').click()">Enviar áudio</button>
      </div>
      <div class="auMsg meta" style="margin-top:6px"></div>
    </div>
  </details>`;
}

// Bloco "enviar com foto (flyer)" para as mensagens de grupo que aceitam.
function cardFoto(m) {
  const tem = !!m.fotoNome;
  const src = tem ? `/mensagem/foto?chave=${esc(m.chave)}&v=${Date.now()}` : '';
  // Recolhido por padrão (acordeão) — o selo no título já mostra se a mensagem
  // vai com foto ou não, sem precisar abrir. A classe "fotorow" é mantida porque
  // o JS (mfToggle/mfSalvar/mfRemover) navega o DOM por ela.
  return `<details class="foto-acc fotorow">
    <summary>📎 Foto no flyer <span class="foto-status ${tem ? 'on' : 'off'}">${tem ? '✓ com foto' : 'sem foto'}</span></summary>
    <div class="foto-body">
    <label class="chk"><input type="checkbox" class="mfChk"${tem ? ' checked' : ''} onchange="mfToggle(this)"> Enviar com foto (flyer junto da mensagem)</label>
    <div class="mfWrap"${tem ? '' : ' style="display:none"'}>
      <img class="mfThumb thumb" style="${tem ? '' : 'display:none;'}width:130px;height:auto;max-height:180px;border-radius:9px;margin:8px 0" src="${src}" alt="foto">
      <div style="margin-top:6px"><input type="file" class="mfFile" accept="image/png,image/jpeg,image/webp"></div>
      <div class="acts" style="margin-top:8px">
        <button type="button" class="tbtn" onclick="mfSalvar(this,'${esc(m.chave)}')">Salvar foto</button>
        <button type="button" class="rm mfRm" onclick="mfRemover(this,'${esc(m.chave)}')"${tem ? '' : ' style="display:none"'}>Remover foto</button>
      </div>
      <div class="mfMsg meta" style="margin-top:6px"></div>
    </div>
    </div>
  </details>`;
}

// ── Horários por mensagem (embutidos nos cards da aba Mensagens) ────────────
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

// ── Página: Instagram (status + liga/desliga) ───────────────────────────────
function lerJsonData(nome) {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', nome), 'utf8')); }
  catch (_) { return null; }
}

// Sub-navegação da aba Sofia: Configuração (prompt/configs) x Conversas (inbox).
// Indicadores (menu de cima) = Funil + Formulário + Professoras + Alunas ativas + Grade. O Funil tem permissão própria
// ('funil'); quem já via o Funil pela SoFIA (Conversas) continua vendo.
function podeFunil(sess) { return !!(sess && (sess.admin || (sess.telas || []).includes('funil') || (sess.telas || []).includes('sofia_conversas'))); }
// Trilho de barra: preenchimento n/max e, dentro, o % (ou um texto). Se a barra
// for estreita, o texto vai logo depois dela. extra: 2ª informação após o %.
function uiTrilho(n, max, { cor = 'var(--teal)', texto = 'pct', extra = '' } = {}) {
  const w = (max && n > 0) ? Math.max(2, Math.min(100, Math.round(n / max * 100))) : 0;
  let t = texto === 'pct' ? (max ? String(Math.round(n * 1000 / max) / 10).replace('.', ',').replace(/,0$/, '') + '%' : '') : (texto || '');
  if (t && extra) t += ' · ' + extra;
  const dentro = w >= (extra ? 42 : 14);
  return `<span class="ui-trilho"><i style="width:${w}%;background:${cor}"></i>${t ? `<em style="${dentro ? 'left:10px;color:#fff' : `left:calc(${w}% + 8px);color:var(--cinza)`}">${t}</em>` : ''}</span>`;
}
// Linha de gráfico: rótulo · trilho · valor. fino = sub-linha discreta (ex.: por origem).
function uiBarra({ rot, n, max, cor, valor, texto, extra, fino, largo, cls, attrs, titulo }) {
  return `<div class="ui-bar${fino ? ' fino' : ''}${largo ? ' largo' : ''}${cls ? ' ' + cls : ''}${attrs && /onclick|data-filtro/.test(attrs) ? ' clic' : ''}"${attrs || ''}${titulo ? ` title="${esc(titulo)}"` : ''}><span class="ui-bar-rot">${rot}</span>${uiTrilho(n, max, { cor, texto: texto === undefined ? 'pct' : texto, extra })}<span class="ui-bar-val">${valor !== undefined ? valor : n}</span></div>`;
}
// Cartão de topo. linhas: HTML de cada linha (período, canal, datas…), vazias são puladas.
function uiTopo({ titulo, sub, acoes, linhas }) {
  return `<div class="ui-topo"><div class="ui-tt"><div><h2>${titulo}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${acoes ? `<div class="ui-acoes">${acoes}</div>` : ''}</div>`
    + (linhas || []).filter(Boolean).join('') + `</div>`;
}
// Linha rotulada de botões-pílula: itens = [[href, rótulo, ativo, contagem?], …]
function uiChips(rotulo, itens) {
  return `<div class="ui-linha">${rotulo ? `<span class="ui-lbl">${rotulo}</span>` : ''}<div class="ui-chips">${itens.map(([href, rot, on, n]) => `<a href="${href}" class="ui-chip${on ? ' on' : ''}">${rot}${n != null ? ` <span class="ct">${n}</span>` : ''}</a>`).join('')}</div></div>`;
}
// Período personalizado (de/até). extra: inputs hidden; limpar: href para tirar o filtro.
function uiDatas({ action, de, ate, extra, limpar }) {
  return `<form method="GET" action="${action}" class="ui-linha ui-datas"><span class="ui-lbl">Datas</span>${extra || ''}
      <input type="date" name="de" value="${esc(de || '')}" aria-label="De"><span class="ate">até</span><input type="date" name="ate" value="${esc(ate || '')}" aria-label="Até">
      <button class="ui-btn" type="submit">Aplicar</button>${limpar ? `<a href="${limpar}" class="ui-btn sec">Limpar</a>` : ''}</form>`;
}
// Uma pessoa numa lista: nome (link p/ Contatos), situação, detalhes e o link do EVO.
const UI_SIT = { jaaluna: '🎓 Já era aluna', fechou: '💰 Fechou contrato', fez: '✅ Fez a aula', veio: '✅ Veio', faltou: '❌ Faltou', aguardando: '⏳ Aguardando', agendada: '⏳ Agendada', semreg: '❔ Sem registro' };
function uiPessoa({ nome, href, sit, meta, evo, direita, attrs }) {
  return `<div class="ip-row"${attrs || ''}>
      <div class="ip-top">${href ? `<a class="ip-nome" href="${esc(href)}" title="Abrir em Contatos">${esc(nome)}</a>` : `<span class="ip-nome">${esc(nome)}</span>`}${sit ? `<span class="ip-pill ip-${sit}">${UI_SIT[sit] || esc(sit)}</span>` : ''}</div>
      ${(meta || []).filter(Boolean).length ? `<div class="ip-meta">${meta.filter(Boolean).map(m => `<span>${m}</span>`).join('')}</div>` : ''}
      ${evo || direita ? `<div class="ip-acao">${direita ? `<span class="ip-val">${direita}</span>` : ''}${evo ? `<a class="ip-evo" href="${esc(evo)}" target="_blank" rel="noopener">EVO ↗</a>` : ''}</div>` : ''}
    </div>`;
}
function subnavSofia(view) {
  const item = (v, rot) => `<a href="/sofia${v === 'config' ? '' : '?view=' + v}"${view === v ? ' class="on"' : ''}>${rot}</a>`;
  const sess = E._navSess || { admin: true, telas: [] };
  let its = '';
  if (podeSofiaSub(sess, 'conversas')) its += item('conversas', 'Conversas');
  if (podeSofiaSub(sess, 'config')) its += item('config', 'Configuração');
  if (podeSofiaSub(sess, 'contatos')) its += item('contatos', 'Contatos');
  if (podeSofiaSub(sess, 'contatos')) its += item('tags', 'Tags');
  if (podeSofiaSub(sess, 'campanhas')) its += item('campanhas', 'Campanhas');
  if (podeSofiaSub(sess, 'config')) its += item('cobranca', 'Cobrança');
  if (podeSofiaSub(sess, 'config')) its += item('custo', 'Custo IA');
  return `<div class="subtabs">${its}</div>`;
}

// ── Slim Club ───────────────────────────────────────────────────────────────
// Páginas PÚBLICAS: /SlimClubCadastro (a aluna empresária cadastra o negócio) e
// /slimclub (as alunas entram com nome + telefone e veem os negócios). A aba
// "Slim Club" do painel (/clube) é onde a recepção valida os cadastros.
function scIp(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || ''; }
function scBaseUrl(req) { return (ehHttps(req) ? 'https' : 'http') + '://' + String(req.headers.host || '').replace(/[^\w.:-]/g, ''); }
function scStudio() { return config.STUDIO_NOME || process.env.STUDIO_NOME || 'Studio SlimFit'; }
function scHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); }
function scJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
// POST que muda dado com a sessão da aluna: só JSON (um formulário de outro site não consegue mandar).
function scSoJson(req) { return /^application\/json\b/i.test(String(req.headers['content-type'] || '')); }

function lerCorpo(req, limite, cb) {
  let corpo = '';
  req.on('data', c => { corpo += c; if (corpo.length > limite) req.destroy(); });
  req.on('end', () => cb(corpo));
}
// Canal de cada agendamento por telefone (últimos 8 díg.) — { "81055502": "sofia" }.
// Usado SÓ pelo Funil, para NÃO contar o cadastro Express na conversão da SoFIA.
// (O sofia-agendaram.json acima segue com TODOS os telefones — inclusive Express —
//  porque quem já agendou por qualquer via também não deve receber follow-up.)
const FU_AGENDOU_CANAL_FILE = path.join(sofia.DIR, 'sofia-agendaram-canal.json');
// Leads que ESTÃO no ponto de receber follow-up, mas seguram porque agora é FORA
// da janela de horário. { chave: 'HH:MM' (horário em que vai sair) }. Recalculado
// a cada varredura; o feed das Conversas expõe p/ o painel mostrar o selo ⏳.
// (estado "fuEsperando" → painel-estado.js)
function fuLerJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || def; } catch (_) { return def; } }

// Dia/hora da AULA de cada agendamento ({ <8 díg>: { when, em, canal } }) — o
// evento traz "when" (SoFIA, Formulário e Express); o Funil mostra na lista.
const FU_AGENDOU_AULA_FILE = path.join(sofia.DIR, 'sofia-agendaram-aula.json');

module.exports = {
  _pm2Slug, PM2_EXP, PM2_SOFIA, COMP_CFG_FILE, COMP_PADRAO, compTagsAgendou, compDias, compIntervalo, lerCompCfg, USER, SENHA, TODAS_TELAS, SEGREDO, assinar, SESSOES_FILE, _salvarSessoesJa, salvarSessoesSoon, tocarSessao, sessaoValida, lerToken, lerCookie, ehHttps, usuarioDaReq, ADMIN_EMAIL, SOFIA_SUBS, podeSofiaSub, temSofia, sofiaHref, podeMsgSub, temMsg, msgHref, esc, infoI, hojeSP, fmtData, fmtTel, ESTILO, IG_NO_PAINEL, PAGAMENTO_ATIVO, navTabs, FOTOS_FILE, fotoDe, iniciais, AV_CORES, avatar, menuConta, chrome, scriptPreviewTeste, cardMensagem, professorasRecentes, cardAudio, cardFoto, DIAS, blocoHorario, lerJsonData, podeFunil, uiTrilho, uiBarra, uiTopo, uiChips, uiDatas, UI_SIT, uiPessoa, subnavSofia, scIp, scBaseUrl, scStudio, scHtml, scJson, scSoJson, lerCorpo, FU_AGENDOU_CANAL_FILE, fuLerJson, FU_AGENDOU_AULA_FILE,
};

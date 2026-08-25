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
const testeIg = require('./teste-instagram');
const indicadores = require('./indicadores');
const sofia = require('./sofia-editor');

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
function autorizado(req) {
  if (!SENHA) return false;
  const h = req.headers.authorization || '';
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  let dec = '';
  try { dec = Buffer.from(m[1], 'base64').toString('utf8'); } catch (_) { return false; }
  const i = dec.indexOf(':');
  return seguraIgual(dec.slice(0, i), USER) && seguraIgual(dec.slice(i + 1), SENHA);
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  :root{--teal:#11abae;--coral:#ff5b57;--coral-esc:#ef5a53;--tinta:#2d2a2f;--cinza:#6e6e70;--bg:#f6f7f8;--card:#fff;--linha:#e6e6e6}
  *{box-sizing:border-box}
  body{margin:0;font-family:"Open Sans",-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--tinta);line-height:1.5}
  h1,h2,h3,button,.tabs a{font-family:"Montserrat","Open Sans",Arial,sans-serif}
  header{background:var(--teal);color:#fff;padding:22px 16px}
  .wrap{max-width:820px;margin:0 auto;padding:16px}
  header .wrap{padding:0 16px;display:flex;align-items:center;gap:14px}
  header .logo-box{background:#fff;border-radius:11px;padding:7px 11px;flex:none;box-shadow:0 2px 8px rgba(0,0,0,.12)}
  header .logo-box img{height:28px;width:auto;display:block}
  header h1{margin:0;font-size:1.3rem;font-weight:800}
  header p{margin:4px 0 0;opacity:.92;font-size:.9rem}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;max-width:820px;margin:16px auto 0;padding:0 16px}
  .tabs a{flex:1 1 120px;text-align:center;text-decoration:none;font-weight:700;font-size:.9rem;color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:12px;padding:11px}
  .tabs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  .aviso{background:#e6f6f7;border:1px solid #bfe8e7;color:#0c6f70;border-radius:10px;padding:11px 14px;margin:16px 0}
  .aviso.err{background:#fdecec;border-color:#f6c9c9;color:#a12626}
  .card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:16px 18px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.04)}
  .chead{display:flex;align-items:center;gap:10px}
  h2{font-size:1.05rem;margin:0}
  .badge{background:#fff0ef;color:#c23b38;border:1px solid #f6cfcd;border-radius:999px;font-size:.7rem;font-weight:700;padding:2px 9px}
  .quando{color:var(--cinza);font-size:.85rem;margin:6px 0 8px}
  .vars{font-size:.82rem;color:var(--cinza);margin:0 0 8px}
  .var{display:inline-block;background:#eef7f7;color:#0c6f70;border:1px solid #cdeaea;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace;font-size:.82rem;cursor:pointer;user-select:none;transition:.12s}
  .var:hover{background:var(--teal);color:#fff;border-color:var(--teal)}
  label{display:block;font-weight:600;font-size:.86rem;margin:12px 0 4px}
  input[type=text],input[type=tel],input[type=date],textarea{width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:11px 12px;font-size:1rem;font-family:inherit;background:#fff}
  textarea{line-height:1.5;resize:vertical}
  input:focus,textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(17,171,174,.15)}
  .acts{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
  button{border:none;border-radius:999px;padding:11px 20px;font-size:.92rem;font-weight:700;cursor:pointer;font-family:inherit}
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
  .item{border:1px solid var(--linha);border-radius:12px;padding:12px 14px;margin:10px 0;display:flex;gap:12px;align-items:flex-start;background:#fff}
  .item .thumb{width:52px;height:52px;border-radius:9px;object-fit:cover;flex:none;border:1px solid var(--linha)}
  .item .body{flex:1;min-width:0}
  .item .tel{font-weight:700}
  .item .meta{font-size:.8rem;color:var(--cinza);margin-top:2px}
  .item .txt{font-size:.9rem;color:var(--tinta);margin-top:6px;white-space:pre-wrap;word-break:break-word}
  .pill{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--linha)}
  .st-pendente{background:#fff7e6;color:#9a6b00;border-color:#f2ddb0}
  .st-enviado{background:#eafaf0;color:#1c6b3c;border-color:#bfe8cd}
  .st-falha{background:#fdecec;color:#a12626;border-color:#f6c9c9}
  .sec-t{font-family:"Montserrat";font-weight:800;font-size:1rem;margin:22px 0 4px}
  .vazio{color:var(--cinza);font-size:.9rem}
  .wabar{border-radius:12px;padding:11px 14px;margin:16px 0 0;font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:8px}
  .wabar.ok{background:#eafaf0;border:1px solid #bfe8cd;color:#1c6b3c}
  .wabar.warn{background:#fff6f5;border:1px solid #f6cfcd;color:#a12626}
  .wabar a{color:inherit;font-weight:700;margin-left:auto;white-space:nowrap}
  .wa-card{background:var(--card);border:1px solid var(--linha);border-radius:16px;padding:26px 22px;text-align:center;margin:18px 0;box-shadow:0 1px 4px rgba(0,0,0,.05)}
  .wa-card.ok{border-color:#bfe8cd;background:#f3fbf6}
  .wa-card.warn{border-color:#f6cfcd;background:#fff6f5}
  .wa-ic{font-size:2.4rem;line-height:1}
  .wa-card h2{margin:8px 0 6px}
  .wa-card p{color:var(--cinza);margin:6px auto 0;max-width:48ch}
  .wa-card .qr{width:280px;max-width:82%;height:auto;margin:16px auto 6px;display:block;border:8px solid #fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12)}
  .wa-hint{font-size:.85rem}
  .wa-upd{text-align:center;color:var(--cinza);font-size:.8rem;margin-top:10px}
  .hsec{margin-top:14px;padding-top:14px;border-top:1px dashed var(--linha)}
  .hsec-t{font-family:"Montserrat";font-weight:800;font-size:.9rem;color:#0c6f70;margin:0 0 10px}
  .hjob{background:var(--card);border:1px solid var(--linha);border-radius:12px;padding:14px 16px;margin:12px 0}
  .hjob h3{font-size:1rem;margin:0 0 8px}
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
  .badge-ed{background:#fff0ef;color:#c23b38;border:1px solid #f6cfcd;border-radius:999px;font-size:.68rem;font-weight:700;padding:2px 8px;margin-left:6px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
  .stat{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.04)}
  .stat .n{font-family:"Montserrat";font-weight:800;font-size:2rem;line-height:1}
  .stat .l{font-size:.78rem;color:var(--cinza);margin-top:4px;font-weight:600}
  .stat.ok .n{color:#1c6b3c}.stat.err .n{color:#a12626}.stat.tot .n{color:var(--teal)}
  .jobrow{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--linha)}
  .jobrow:last-child{border-bottom:0}
  .jobrow .jn{font-weight:700;font-size:.92rem;flex:1;min-width:0}
  .jobrow .jc{font-size:.82rem;font-weight:700;color:#1c6b3c;white-space:nowrap}
  .jobrow .jc .f{color:#a12626}
  .ev{display:flex;gap:10px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--linha);font-size:.88rem}
  .ev:last-child{border-bottom:0}
  .ev .h{color:var(--cinza);font-variant-numeric:tabular-nums;font-size:.8rem;flex:none}
  .ev .d{flex:1;min-width:0}
  .ev .who{font-weight:600}
  .ev .ctx{font-size:.72rem;color:var(--cinza)}
  .ev .pv{color:var(--cinza);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}
  .ev .ic{flex:none}
  .datesel{display:flex;gap:8px;align-items:center;margin:4px 0 0}
  .datesel input{width:auto}
  .segs{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 0}
  .segs a{text-decoration:none;font-weight:700;font-size:.82rem;color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:999px;padding:7px 14px}
  .segs a.on{background:var(--teal);color:#fff;border-color:var(--teal)}
  .bar{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linha);font-size:.86rem}
  .bar:last-child{border-bottom:0}
  .bar .bd{width:64px;flex:none;color:var(--cinza);font-variant-numeric:tabular-nums}
  .bar .btrack{flex:1;background:#eef1f2;border-radius:6px;height:20px;position:relative;overflow:hidden;min-width:60px}
  .bar .bfill{position:absolute;inset:0 auto 0 0;background:var(--teal);border-radius:6px}
  .bar .bfill.ag{background:var(--coral);opacity:.85}
  .bar .bn{flex:none;width:96px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  .bar .bn small{font-weight:600;color:var(--cinza)}
  .testbar{background:#fff8f0;border:1px solid #f3dcbf}
  .testbar label{margin:0 0 4px}
  .testbar input{max-width:260px}
  .prev{margin-top:10px}
  .prev-t{font-size:.78rem;font-weight:700;color:var(--cinza);margin-bottom:4px}
  .prev-b{white-space:pre-wrap;word-break:break-word;background:#eef7f7;border:1px solid #cdeaea;border-radius:10px;padding:10px 12px;font-size:.92rem;line-height:1.5}
  .prev-b.ok{background:#eafaf0;border-color:#bfe8cd;color:#1c6b3c}
  .prev-b.err{background:#fdecec;border-color:#f6c9c9;color:#a12626}
  .tbtn{background:#fff;color:var(--cinza);border:1px solid #dcdcdc}
  footer{color:var(--cinza);font-size:.8rem;text-align:center;padding:20px}
`;

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
  <div><h1>${esc(titSubtitulo.h1)}</h1><p>${titSubtitulo.p}</p></div>
</div></header>
<nav class="tabs">
  <a href="/hoje" class="${ativo === 'hoje' ? 'on' : ''}">📊 Hoje</a>
  <a href="/indicadores" class="${ativo === 'ind' ? 'on' : ''}">📈 Indicadores</a>
  <a href="/" class="${ativo === 'msg' ? 'on' : ''}">💬 WhatsApp Mensagens</a>
  <a href="/agendar" class="${ativo === 'ag' ? 'on' : ''}">📅 Agendar envios</a>
  <a href="/instagram" class="${ativo === 'ig' ? 'on' : ''}">📸 Instagram</a>
  <a href="/sofia" class="${ativo === 'sofia' ? 'on' : ''}">🤖 Sofia</a>
</nav>
${corpo}
<footer>SlimFit · painel do Studio</footer>
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
    <div id="waBanner"></div>
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
    if(e==='conectado') return '<div class="wabar ok">✅ WhatsApp conectado — o robô envia normalmente.</div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn" style="margin:16px 0 0"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2><p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código.</p><img class="qr" src="'+st.qr+'" alt="QR do WhatsApp"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira ✅.</p></div>';
    if(e==='iniciando') return '<div class="wabar warn">⏳ WhatsApp iniciando… se precisar de QR, ele aparece aqui.</div>';
    if(e==='desconectado') return '<div class="wabar warn">⚠️ WhatsApp desconectado — tentando reconectar. Se aparecer um QR aqui, escaneie.</div>';
    return '<div class="wabar warn">❔ Sem informação do WhatsApp ainda — confira se o robô está rodando.</div>';
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

  <div class="sec-t">⏳ Pendentes (${pend.length})</div>
  ${pend.length ? pend.map(itemHtml).join('') : '<div class="vazio">Nenhum envio pendente.</div>'}

  <div class="sec-t">📜 Histórico</div>
  ${hist.length ? hist.map(itemHtml).join('') : '<div class="vazio">Sem envios recentes.</div>'}
  ${cardHorariosAgendados()}
  `;

  const corpo = `<div class="wrap">${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}${form}</div>
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
  return chrome({ tab: 'Agendar envios', h1: '📅 Agendar envios', p: `Mensagens são enviadas <b>${esc(horaAg('manha'))}</b> (manhã) e <b>${esc(horaAg('tarde'))}</b> (tarde) do dia agendado.` }, 'ag', corpo);
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
  return chrome({ tab: 'Hoje', h1: '📊 O que o robô fez', p: ehHoje ? 'Todos os envios de <b>hoje</b>, em tempo quase real.' : `Envios do dia <b>${esc(fmtData(d))}</b>.` }, 'hoje', corpo);
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
  ${scriptPreviewTeste()}`;
  return chrome({ tab: 'Instagram', h1: '📸 Instagram', p: 'Status, liga/desliga, limite, mensagem e horário — tudo do Instagram aqui.' }, 'ig', corpo);
}

// ── Página: Indicadores do formulário ───────────────────────────────────────
function paginaIndicadores(dias) {
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

  const origemBloco = r.temOrigem ? `
    <div class="sec-t">🔗 Por origem</div>
    <div class="card">
      ${r.porOrigem.map(o => `<div class="jobrow"><div class="jn">${esc(o.origem)}</div><div class="jc">${o.acessos} acesso${o.acessos === 1 ? '' : 's'} · <span style="color:var(--coral-esc)">${o.agendamentos} agend.</span></div></div>`).join('')}
    </div>` : `
    <div class="card" style="border-style:dashed">
      <p class="quando" style="margin:0">💡 <b>Quer saber de onde vêm os acessos</b> (WhatsApp, Instagram, anúncio)? É só usar links etiquetados — ex.: <code>…/?origem=instagram</code>. Peça que eu gero os links e a partir daí a origem aparece aqui.</p>
    </div>`;

  const corpo = `<div class="wrap">
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
      <div class="jobrow"><div class="jn">👀 Aberturas da página (acessos)</div><div class="jc">${r.acessos}</div></div>
      <div class="jobrow"><div class="jn">✅ Agendaram a experimental</div><div class="jc">${r.agendamentos}</div></div>
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
    <p class="quando" style="text-align:center">Coletado do formulário a cada ~2 min. ${r.primeiroDia ? `Desde ${esc(fmtData(r.primeiroDia))}.` : 'Ainda começando a coletar.'}</p>
  </div>`;
  return chrome({ tab: 'Indicadores', h1: '📈 Indicadores do formulário', p: 'Acessos, agendamentos e taxa de conversão do formulário de agendamento.' }, 'ind', corpo);
}

// ── Página: Sofia (chatbot) — prompt, configs e conexão do WhatsApp dela ─────
function blocoSofiaWa() {
  const st = sofia.waStatus();
  const quando = st.atualizadoEm ? new Date(st.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  if (st.estado === 'conectado') {
    return `<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da Sofia conectado</h2><p>A Sofia está no ar e responde as alunas neste número.</p></div>`;
  }
  if (st.estado === 'qr' && st.qr) {
    return `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da Sofia</h2>
      <p>Este é o WhatsApp <b>da Sofia</b> (número próprio, diferente do robô de mensagens). No celular do número da Sofia: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR da Sofia"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>`;
  }
  // Sem status publicado ainda (o listener da Sofia precisa gravar sofia-wa-status.json).
  return `<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da Sofia — sem informação</h2>
    <p>Para o QR da Sofia aparecer aqui, o processo dela precisa <b>publicar o estado</b> em <code>sofia-wa-status.json</code>. Enquanto isso não estiver ligado, conecte a Sofia pelo terminal como de costume.</p>
    <p class="wa-upd">Última atualização: ${esc(quando)}</p></div>`;
}

function paginaSofia(aviso, erro) {
  if (!sofia.disponivel()) {
    const corpo = `<div class="wrap">
      ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
      <div class="card"><div class="chead"><h2>Sofia não encontrada nesta máquina</h2></div>
        <p class="quando">Não achei a pasta da Sofia (<code>${esc(sofia.DIR)}</code>) ou o arquivo do prompt. Se a Sofia roda em outra pasta/servidor, aponte com a variável <code>SOFIA_DIR</code> no <code>.env</code> do painel e reinicie: <code>pm2 restart slimfit-painel --update-env</code>.</p>
      </div></div>`;
    return chrome({ tab: 'Sofia', h1: '🤖 Sofia', p: 'Prompt, configurações e conexão do chatbot.' }, 'sofia', corpo);
  }

  const e = sofia.estado();
  const cardsSecoes = e.secoes.map((s, i) => {
    const rows = Math.min(16, Math.max(4, String(s.corpo).split('\n').length + 1));
    return `<div class="card">
      <label>${esc(s.titulo)}</label>
      <input type="hidden" name="titulo_${i}" value="${esc(s.titulo)}">
      <textarea name="corpo_${i}" rows="${rows}" spellcheck="false">${esc(s.corpo)}</textarea>
    </div>`;
  }).join('');

  const inpMidia = (nome, valor, rot) => `<label>${rot}</label><input type="text" name="${nome}" value="${esc(valor)}" style="font-family:ui-monospace,monospace;font-size:.86rem">`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}

    <div class="sec-t">📱 Conexão do WhatsApp da Sofia <small style="font-weight:600;color:var(--cinza)">(número próprio, diferente do robô)</small></div>
    <div id="sofiaWa">${blocoSofiaWa()}</div>

    <div class="sec-t">⚡ Sofia</div>
    <div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <h2 style="margin:0 0 4px">${e.ativa ? '🟢 IA ativa' : '⏸️ IA pausada'}</h2>
        <p class="quando" style="margin:0">${e.ativa ? 'A Sofia está respondendo as alunas.' : 'A Sofia NÃO responde — atenda manualmente pelo WhatsApp.'}</p>
      </div>
      <form method="POST" action="/sofia/toggle" style="margin:0">
        <button type="submit" class="${e.ativa ? 'reset' : 'save'}">${e.ativa ? '⏸️ Pausar Sofia' : '▶️ Ativar Sofia'}</button>
      </form>
    </div>

    <form method="POST" action="/sofia/salvar">
      <input type="hidden" name="n" value="${e.secoes.length}">

      <div class="card">
        <label>⏳ Minutos que a Sofia fica fora ao você assumir uma conversa</label>
        <input type="number" name="pausaMin" min="1" max="1440" value="${e.pausaMin}" style="width:130px"> minutos
      </div>

      <div class="sec-t">⌨️ Jeito de responder <small style="font-weight:600;color:var(--cinza)">(deixa a Sofia mais humana — vale na hora, sem reiniciar)</small></div>
      <div class="card">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="ritHumano" value="1"${e.ritmo.humano ? ' checked' : ''} style="width:auto;margin:0">
          Modo humano — quebra respostas longas em várias mensagens e mostra “digitando…”
        </label>
        <p class="quando" style="margin:6px 0 14px">Desmarcado, a Sofia manda tudo de uma vez, sem simular digitação.</p>
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
      </div>

      <div class="sec-t">💬 Conversa da Sofia <small style="font-weight:600;color:var(--cinza)">(cada bloco é uma parte do atendimento)</small></div>
      ${cardsSecoes}

      <div class="sec-t">🔗 Script de integração <small style="font-weight:600;color:var(--cinza)">(dados enviados ao EVO)</small></div>
      <div class="card">
        <label>Extração do resumo (nome, e-mail, dia, hora)</label>
        <textarea name="extracao" rows="12" spellcheck="false">${esc(e.extracao)}</textarea>
      </div>

      <div class="sec-t">📷 Imagens <small style="font-weight:600;color:var(--cinza)">(troque as URLs quando atualizar a grade/preços)</small></div>
      <div class="card">
        ${inpMidia('precos_imagem', e.midias.precos_imagem, 'Imagem da TABELA DE PREÇOS (URL)')}
        ${inpMidia('precos_link', e.midias.precos_link, 'Link (Google Drive) da tabela de preços')}
        ${inpMidia('grade_imagem', e.midias.grade_imagem, 'Imagem da GRADE DE HORÁRIOS (URL)')}
        ${inpMidia('grade_link', e.midias.grade_link, 'Link (Google Drive) da grade')}
      </div>

      <div class="hbar">
        <div class="acts">
          <button type="submit" class="save">💾 Salvar tudo</button>
          <button type="submit" class="reset" formaction="/sofia/restaurar" onclick="return confirm('Restaurar a versão anterior de TODOS os campos?')">↩️ Restaurar anterior</button>
        </div>
        <p class="quando" style="text-align:center;margin:8px 0 0">Vale nas próximas conversas — a Sofia lê os arquivos na hora, sem reiniciar.</p>
      </div>
    </form>
  </div>
<script>
  function renderSofiaWa(st){
    var e = st && st.estado;
    if(e==='conectado') return '<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da Sofia conectado</h2><p>A Sofia está no ar e responde as alunas neste número.</p></div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da Sofia</h2><p>Este é o WhatsApp <b>da Sofia</b> (número próprio, diferente do robô de mensagens). No celular do número da Sofia: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p><img class="qr" src="'+st.qr+'" alt="QR da Sofia"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>';
    if(e==='iniciando') return '<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>Subindo a conexão da Sofia. Se precisar de QR, ele aparece aqui.</p></div>';
    if(e==='desconectado') return '<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>A Sofia caiu. Se aparecer um QR aqui, escaneie de novo.</p></div>';
    return '<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da Sofia — sem informação</h2><p>O processo da Sofia (sofia-listener) precisa estar rodando e publicando o estado.</p></div>';
  }
  function atualizaSofiaWa(){
    fetch('/sofia/estado',{cache:'no-store'}).then(function(r){return r.json();}).then(function(st){
      var el=document.getElementById('sofiaWa'); if(el) el.innerHTML=renderSofiaWa(st);
    }).catch(function(){});
  }
  atualizaSofiaWa(); setInterval(atualizaSofiaWa, 5000);
</script>`;
  return chrome({ tab: 'Sofia', h1: '🤖 Sofia', p: 'Edite o prompt, as configurações e conecte o WhatsApp da Sofia.' }, 'sofia', corpo);
}

function pedirLogin(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Painel SlimFit", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Acesso restrito.');
}
function lerCorpo(req, limite, cb) {
  let corpo = '';
  req.on('data', c => { corpo += c; if (corpo.length > limite) req.destroy(); });
  req.on('end', () => cb(corpo));
}

const server = http.createServer((req, res) => {
  if (!autorizado(req)) return pedirLogin(res);
  const url = req.url.split('?')[0];

  // Página de mensagens
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Mensagem salva! Já vale no próximo envio.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horários salvos e robô reiniciado. Já valem.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horários salvos, mas não consegui reiniciar o robô automaticamente. Rode no servidor: pm2 restart slimfit-exp'; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
    const d = new URLSearchParams(req.url.split('?')[1] || '').get('dias');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaIndicadores(d == null ? 7 : parseInt(d, 10)));
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
    else if (/(?:^|&)on=1/.test(q)) aviso = '🟢 Sofia ativada — voltou a responder as alunas.';
    else if (/(?:^|&)off=1/.test(q)) aviso = '⏸️ Sofia pausada — atenda manualmente pelo WhatsApp.';
    else if (/(?:^|&)rest=1/.test(q)) aviso = 'Restaurado para a versão anterior.';
    else if (/(?:^|&)rest=0/.test(q)) { aviso = 'Não havia versão anterior para restaurar.'; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaSofia(aviso, erro));
  }
  if (req.method === 'POST' && url === '/sofia/salvar') {
    return lerCorpo(req, 4e6, corpo => {
      const p = new URLSearchParams(corpo);
      const n = parseInt(p.get('n') || '0', 10);
      const secoes = [];
      for (let i = 0; i < n; i++) secoes.push({ titulo: p.get('titulo_' + i) || ('SEÇÃO ' + i), corpo: p.get('corpo_' + i) || '' });
      try {
        sofia.salvar({
          secoes,
          extracao: p.get('extracao') || '',
          pausaMin: p.get('pausaMin') || '30',
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
  // A conexão do WhatsApp agora vive no topo da aba Mensagens — redireciona link antigo.
  if (req.method === 'GET' && url === '/wa') {
    res.writeHead(301, { Location: '/' }); return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
});

server.listen(PORT, HOST, () => {
  if (!SENHA) console.warn('⚠️  PAINEL_SENHA não definido no .env — o painel vai NEGAR todo acesso até você definir usuário e senha.');
  console.log(`🖥️  Painel do Studio ouvindo em ${HOST}:${PORT} (usuário: ${USER}).`);
  console.log('   Páginas: /hoje · /indicadores · /  (WhatsApp+mensagens) · /agendar · /instagram · /sofia. Exponha SEMPRE atrás de HTTPS.');
});

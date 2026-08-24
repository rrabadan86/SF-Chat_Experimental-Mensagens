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
const mensagens = require('./mensagens');
const ag = require('./agendamentos');
const waStatus = require('./wa-status');

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
const TURNO_LABEL = { manha: '☀️ Manhã · 10:45', tarde: '🌇 Tarde · 15:45' };

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
  .tabs{display:flex;gap:8px;max-width:820px;margin:16px auto 0;padding:0 16px}
  .tabs a{flex:1;text-align:center;text-decoration:none;font-weight:700;font-size:.9rem;color:var(--cinza);background:#fff;border:1px solid var(--linha);border-radius:12px;padding:11px}
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
  .wa-card{background:var(--card);border:1px solid var(--linha);border-radius:16px;padding:26px 22px;text-align:center;margin:18px 0;box-shadow:0 1px 4px rgba(0,0,0,.05)}
  .wa-card.ok{border-color:#bfe8cd;background:#f3fbf6}
  .wa-card.warn{border-color:#f6cfcd;background:#fff6f5}
  .wa-ic{font-size:2.4rem;line-height:1}
  .wa-card h2{margin:8px 0 6px}
  .wa-card p{color:var(--cinza);margin:6px auto 0;max-width:48ch}
  .wa-card .qr{width:280px;max-width:82%;height:auto;margin:16px auto 6px;display:block;border:8px solid #fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12)}
  .wa-hint{font-size:.85rem}
  .wa-upd{text-align:center;color:var(--cinza);font-size:.8rem;margin-top:10px}
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
  <a href="/" class="${ativo === 'msg' ? 'on' : ''}">✏️ Mensagens</a>
  <a href="/agendar" class="${ativo === 'ag' ? 'on' : ''}">📅 Agendar envios</a>
  <a href="/wa" class="${ativo === 'wa' ? 'on' : ''}">📱 WhatsApp</a>
</nav>
${corpo}
<footer>SlimFit · painel do Studio</footer>
</body></html>`;
}

// ── Página 1: editar mensagens ──────────────────────────────────────────────
function paginaMensagens(aviso, erro) {
  const itens = mensagens.listar().map(m => {
    const vars = (m.vars || []).map(([t, d]) => `<span class="var" title="${esc(d)} — clique para inserir" onclick="inserirVar(this,'{${esc(t)}}')">{${esc(t)}}</span>`).join(' ');
    const badge = m.editado ? '<span class="badge">editada</span>' : '';
    return `
    <form class="card" method="POST" action="/salvar">
      <input type="hidden" name="chave" value="${esc(m.chave)}">
      <div class="chead"><h2>${esc(m.titulo)} ${badge}</h2></div>
      <p class="quando">${esc(m.quando)}</p>
      ${vars ? `<p class="vars">Variáveis (clique para inserir): ${vars} <small>— são trocadas automaticamente no envio; mantenha-as no texto</small></p>` : ''}
      <textarea name="texto" rows="7" spellcheck="true">${esc(m.texto)}</textarea>
      <div class="acts">
        <button type="submit" class="save">Salvar</button>
        <button type="submit" name="reset" value="1" class="reset" onclick="return confirm('Voltar esta mensagem ao texto padrão?')">Restaurar padrão</button>
      </div>
    </form>`;
  }).join('\n');
  const corpo = `<div class="wrap">${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}${itens}</div>
<script>
  function inserirVar(el, token){
    var ta = el.closest('form').querySelector('textarea');
    if(!ta) return;
    var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + token.length;
  }
</script>`;
  return chrome({ tab: 'Mensagens', h1: '✏️ Editar mensagens do robô', p: 'Altere o texto e clique em <b>Salvar</b>. Vale já no próximo envio — sem reiniciar.' }, 'msg', corpo);
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
    <div class="meta">${esc(fmtData(a.data))} · ${esc(TURNO_LABEL[a.turno] || a.turno)} · <span class="pill ${st}">${stTxt}</span></div>
    ${a.mensagem ? `<div class="txt">${esc(a.mensagem)}</div>` : (a.foto ? '<div class="txt"><i>(só foto)</i></div>' : '')}
    ${a.erro ? `<div class="meta" style="color:#a12626">${esc(a.erro)}</div>` : ''}
    ${acoes}
  </div></div>`;
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
      <label><input type="radio" name="turno" value="manha" checked><span>☀️ Manhã<br><small>10:45</small></span></label>
      <label><input type="radio" name="turno" value="tarde"><span>🌇 Tarde<br><small>15:45</small></span></label>
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
  return chrome({ tab: 'Agendar envios', h1: '📅 Agendar envios', p: 'Mensagens são enviadas <b>10:45</b> (manhã) e <b>15:45</b> (tarde) do dia agendado.' }, 'ag', corpo);
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
    const ok = /(?:\?|&)ok=1/.test(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaMensagens(ok ? 'Mensagem salva! Já vale no próximo envio.' : ''));
  }
  if (req.method === 'POST' && url === '/salvar') {
    return lerCorpo(req, 1e6, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        if (p.get('reset')) mensagens.salvarOverride(p.get('chave'), '');
        else mensagens.salvarOverride(p.get('chave'), p.get('texto') || '');
        res.writeHead(303, { Location: '/?ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaMensagens('Erro ao salvar: ' + e.message, true));
      }
    });
  }

  // Página de agendamentos
  if (req.method === 'GET' && (url === '/agendar')) {
    const ok = /(?:\?|&)ok=1/.test(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaAgendar(ok ? 'Agendamento salvo! Será enviado no dia e turno escolhidos.' : ''));
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

  // Página da conexão do WhatsApp (QR quando cai)
  if (req.method === 'GET' && url === '/wa') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaWa());
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
});

server.listen(PORT, HOST, () => {
  if (!SENHA) console.warn('⚠️  PAINEL_SENHA não definido no .env — o painel vai NEGAR todo acesso até você definir usuário e senha.');
  console.log(`🖥️  Painel do Studio ouvindo em ${HOST}:${PORT} (usuário: ${USER}).`);
  console.log('   Páginas: /  (mensagens) · /agendar  (envios) · /wa  (conexão do WhatsApp). Exponha SEMPRE atrás de HTTPS.');
});

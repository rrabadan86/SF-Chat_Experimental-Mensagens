/**
 * formularios-paginas.js — página PÚBLICA de um formulário de campanha
 * (/formulario/<endereço>), sem login. Pensada para o celular: a pessoa abre
 * pelo link do Instagram/WhatsApp, responde e recebe a confirmação na própria
 * tela. A capa, o título, o texto e as perguntas ficam num único cartão.
 *
 * Dois temas, escolhidos por formulário no painel:
 *   claro  → identidade do painel (verde-petróleo SlimFit)
 *   escuro → campanha (fundo preto e vermelho — combina com flyer de Black Friday)
 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Valor seguro dentro de <script> (um "</script>" no texto não fecha a tag).
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');

const LOGO = 'https://drive.google.com/thumbnail?id=1pl1mh709FGcitG9uHo0J6nzMUKFYqg-w&sz=w400';

const CSS = `
:root{
  color-scheme:light;
  --bg:#edf1f0;--card:#fff;--tinta:#17191a;--cinza:#585d60;--faint:#868b8e;--linha:#e1e5e4;
  --campo:#fff;--campo-bd:#cdd3d2;
  --acento:#0e6e6b;--acento-esc:#0a5250;--acento-tx:#fff;--acento-soft:#e3efee;--foco:#bcdcd9;
  --erro:#a12626;--erro-soft:#fbecec;--ok:#1a7f37;--ok-soft:#e6f4ea;
  --aviso:#7a5200;--aviso-soft:#fbf0d6;--aviso-bd:#eed9a4;
  --sombra:0 1px 2px rgba(16,24,40,.05),0 12px 32px -18px rgba(16,24,40,.22);
}
.tema-escuro{
  color-scheme:dark;
  --bg:#0b0b0c;--card:#161618;--tinta:#f5f5f6;--cinza:#b4b4bb;--faint:#85858d;--linha:#2a2a2f;
  --campo:#0f0f11;--campo-bd:#38383f;
  --acento:#e3313a;--acento-esc:#c4242c;--acento-tx:#fff;--acento-soft:rgba(227,49,58,.13);--foco:rgba(227,49,58,.45);
  --erro:#ff8a8f;--erro-soft:rgba(255,90,98,.12);--ok:#5fd38a;--ok-soft:rgba(95,211,138,.13);
  --aviso:#f3c969;--aviso-soft:rgba(243,201,105,.1);--aviso-bd:rgba(243,201,105,.35);
  --sombra:0 20px 50px -24px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--tinta);font:16px/1.55 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.pg{max-width:560px;margin:0 auto;padding:20px 16px 40px}
@media(max-width:480px){.pg{padding:12px 12px 32px}}
.camp{background:var(--card);border:1px solid var(--linha);border-radius:20px;overflow:hidden;box-shadow:var(--sombra)}
.capa{display:block;width:100%;height:auto;background:var(--linha)}
.cab{padding:22px 22px 6px}
@media(max-width:480px){.cab{padding:18px 18px 4px}}
.marca{display:flex;align-items:center;gap:10px;margin:0 0 14px;font-size:.8rem;font-weight:600;color:var(--cinza);letter-spacing:.01em}
.marca img{height:22px;width:auto;display:block}
.tema-escuro .marca img{background:#fff;border-radius:999px;padding:4px 10px;height:28px}
h1{font-family:"Archivo","Inter",system-ui,sans-serif;font-weight:800;font-size:clamp(1.65rem,6.4vw,2.15rem);line-height:1.08;letter-spacing:-.02em;margin:0 0 12px;text-wrap:balance}
.desc{color:var(--cinza);font-size:1rem}
.desc p{margin:0 0 10px}
.desc strong{color:var(--tinta);font-weight:700}
.desc ul{list-style:none;margin:4px 0 12px;padding:0;display:grid;gap:8px}
.desc li{position:relative;padding-left:26px;color:var(--tinta)}
.desc li::before{content:"";position:absolute;left:4px;top:.5em;width:10px;height:10px;border-radius:3px;background:var(--acento);transform:rotate(45deg)}
.form{padding:18px 22px 24px;display:flex;flex-direction:column;gap:20px;border-top:1px solid var(--linha);margin-top:12px}
@media(max-width:480px){.form{padding:16px 18px 20px}}
.campo{display:flex;flex-direction:column;gap:7px;border:0;margin:0;padding:0;min-width:0}
.campo legend{padding:0;margin:0 0 8px}
label.rot,.campo legend{font-weight:650;font-size:.95rem}
.ob{color:var(--acento);font-weight:800;margin-left:3px}
.opc{font-weight:400;color:var(--faint);font-size:.85rem}
input[type=text],input[type=tel],input[type=email],input[type=date],textarea{
  width:100%;font:inherit;font-size:1rem;color:var(--tinta);background:var(--campo);border:1px solid var(--campo-bd);border-radius:12px;padding:12px 14px}
input::placeholder,textarea::placeholder{color:var(--faint)}
textarea{min-height:100px;resize:vertical}
input:focus,textarea:focus,button:focus-visible,.op input:focus-visible+span{outline:3px solid var(--foco);outline-offset:1px;border-color:var(--acento)}
.ops{display:grid;gap:8px}
@media(min-width:440px){.ops.duas{grid-template-columns:1fr 1fr}}
.op{display:block;cursor:pointer;position:relative}
.op input{position:absolute;opacity:0;pointer-events:none}
.op span{display:flex;align-items:center;gap:11px;border:1px solid var(--campo-bd);border-radius:12px;padding:12px 14px;font-size:.97rem;background:var(--campo);transition:border-color .12s,background .12s}
.op:hover span{border-color:var(--acento)}
.op span::before{content:"";flex:0 0 auto;width:18px;height:18px;border:2px solid var(--campo-bd);border-radius:50%;background:var(--campo)}
.op.multi span::before{border-radius:5px}
.op input:checked+span{border-color:var(--acento);background:var(--acento-soft);box-shadow:inset 0 0 0 1px var(--acento)}
.op input:checked+span::before{border-color:var(--acento);background:var(--acento);box-shadow:inset 0 0 0 3px var(--campo)}
.op.multi input:checked+span::before{box-shadow:none;background:var(--acento) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/14px no-repeat}
.btn{display:block;width:100%;font-family:"Archivo","Inter",system-ui,sans-serif;font-weight:800;font-size:1.05rem;letter-spacing:.01em;color:var(--acento-tx);background:var(--acento);border:0;border-radius:14px;padding:16px 18px;cursor:pointer;transition:background .12s,transform .06s}
.btn:hover{background:var(--acento-esc)}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.55;cursor:not-allowed;transform:none}
.msg{border-radius:10px;padding:11px 13px;font-size:.92rem;margin:0}
.msg.erro{background:var(--erro-soft);color:var(--erro)}
.lgpd{font-size:.78rem;color:var(--faint);margin:14px 8px 0;text-align:center}
.lgpd a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.pote{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.pronto{padding:30px 22px 34px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;border-top:1px solid var(--linha);margin-top:12px}
.pronto .ic{width:60px;height:60px;border-radius:50%;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center}
.pronto h2{margin:0;font-family:"Archivo","Inter",sans-serif;font-weight:800;font-size:1.35rem}
.pronto p{margin:0;color:var(--cinza);white-space:pre-line;max-width:42ch}
.fechado{padding:18px 22px 24px;border-top:1px solid var(--linha);margin-top:12px;color:var(--cinza)}
.fechado p{margin:0}
.previa{display:flex;gap:10px;align-items:flex-start;background:var(--aviso-soft);color:var(--aviso);border:1px solid var(--aviso-bd);border-radius:14px;padding:12px 14px;font-size:.88rem;margin:0 0 14px}
.previa b{display:block;font-size:.95rem}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;

// Texto de apresentação: *negrito* (como no WhatsApp), linhas começando com
// "-" ou "•" viram lista, linha em branco separa parágrafos.
function formatar(texto) {
  const inline = s => esc(s).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  const blocos = [];
  let par = [], lista = [];
  const fechaPar = () => { if (par.length) { blocos.push('<p>' + par.map(inline).join('<br>') + '</p>'); par = []; } };
  const fechaLista = () => { if (lista.length) { blocos.push('<ul>' + lista.map(l => '<li>' + inline(l) + '</li>').join('') + '</ul>'); lista = []; } };
  for (const linha of String(texto || '').split('\n')) {
    const m = /^\s*[-•*]\s+(.+)$/.exec(linha);
    if (m && !/^\s*\*[^*\n]+\*\s*$/.test(linha)) { fechaPar(); lista.push(m[1]); }
    else if (!linha.trim()) { fechaPar(); fechaLista(); }
    else { fechaLista(); par.push(linha.trim()); }
  }
  fechaPar(); fechaLista();
  return blocos.join('');
}

function moldura(titulo, f, corpo) {
  const escuro = f && f.tema === 'escuro';
  return `<!doctype html><html lang="pt-BR"${escuro ? ' class="tema-escuro"' : ''}><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="${escuro ? '#0b0b0c' : '#edf1f0'}">
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Inter:wght@400;600;700&display=swap">
<style>${CSS}</style></head><body>
<main class="pg">${corpo}</main>
</body></html>`;
}

// Capa + marca + título + texto (o topo do cartão, igual em todas as telas).
function cabecalho({ studio, f, capaUrl }) {
  return `${capaUrl ? `<img class="capa" src="${esc(capaUrl)}" alt="">` : ''}
  <div class="cab">
    <div class="marca"><img src="${LOGO}" alt="SlimFit"><span>${esc(studio)}</span></div>
    <h1>${esc(f.titulo)}</h1>
    ${f.descricao ? `<div class="desc">${formatar(f.descricao)}</div>` : ''}
  </div>`;
}

function campoHtml(c) {
  const ob = c.obrigatorio ? '<span class="ob" aria-hidden="true">*</span>' : ' <span class="opc">(opcional)</span>';
  const req = c.obrigatorio ? ' required' : '';
  const nm = 'v_' + c.id;
  if (c.tipo === 'unica' || c.tipo === 'varias') {
    const multi = c.tipo === 'varias';
    const curtas = c.opcoes.every(o => o.length <= 18) && c.opcoes.length > 2;
    const ops = c.opcoes.map(o => `<label class="op${multi ? ' multi' : ''}"><input type="${multi ? 'checkbox' : 'radio'}" name="${nm}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('');
    return `<fieldset class="campo" data-id="${c.id}" data-tipo="${c.tipo}"${c.obrigatorio ? ' data-ob="1"' : ''}><legend>${esc(c.rotulo)}${ob}${multi ? ' <span class="opc">— pode marcar mais de uma</span>' : ''}</legend><div class="ops${curtas ? ' duas' : ''}">${ops}</div></fieldset>`;
  }
  const id = 'i_' + c.id;
  const input = c.tipo === 'paragrafo' ? `<textarea id="${id}" name="${nm}" maxlength="2000"${req}></textarea>`
    : c.tipo === 'data' ? `<input id="${id}" name="${nm}" type="date"${req}>`
    : c.tipo === 'email' ? `<input id="${id}" name="${nm}" type="email" autocomplete="email" maxlength="300"${req}>`
    : `<input id="${id}" name="${nm}" type="text" maxlength="300"${req}>`;
  return `<div class="campo" data-id="${c.id}" data-tipo="${c.tipo}"><label class="rot" for="${id}">${esc(c.rotulo)}${ob}</label>${input}</div>`;
}

// previa = 'pausado' | 'encerrado' → aberto por alguém logado no painel com o
// formulário fechado: dá para conferir o visual, mas o botão fica travado.
function paginaFormulario({ studio, f, capaUrl, acao, previa }) {
  const avisoPrevia = previa ? `<div class="previa" role="status"><div><b>Prévia: formulário ${previa === 'encerrado' ? 'encerrado (passou da data)' : 'pausado'}</b>Só quem está logado no painel vê esta página, e o botão de enviar fica desativado. Para receber respostas, abra o formulário em Formulário → Campanhas.</div></div>` : '';
  const corpo = `${avisoPrevia}
<article class="camp">
  ${cabecalho({ studio, f, capaUrl })}
  <form id="f" class="form" novalidate>
    <div class="campo"><label class="rot" for="nome">Seu nome<span class="ob" aria-hidden="true">*</span></label><input id="nome" type="text" autocomplete="name" maxlength="80" required></div>
    <div class="campo"><label class="rot" for="tel">Seu WhatsApp<span class="ob" aria-hidden="true">*</span></label><input id="tel" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(61) 99999-9999" maxlength="16" required></div>
    ${(f.campos || []).map(campoHtml).join('\n    ')}
    <div class="pote" aria-hidden="true"><label>Não preencha<input id="site" type="text" tabindex="-1" autocomplete="off"></label></div>
    <p id="erro" class="msg erro" role="alert" hidden></p>
    <button id="enviar" class="btn" type="submit"${previa ? ' disabled title="Formulário fechado: prévia"' : ''}>${previa ? 'Envio desativado na prévia' : esc(f.botao || 'Enviar')}</button>
  </form>
  <div id="ok" class="pronto" hidden role="status"><div class="ic"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h2 id="okTit">Tudo certo!</h2><p>${esc(f.msgFinal)}</p></div>
</article>
<p class="lgpd">Ao enviar, você autoriza o ${esc(studio)} a falar com você pelo WhatsApp sobre esta campanha. <a href="/politicadeprivacidade" target="_blank" rel="noopener">Política de Privacidade</a></p>
${previa ? '' : `<script>
(function(){
  var f=document.getElementById('f'), erro=document.getElementById('erro'), bt=document.getElementById('enviar'), tel=document.getElementById('tel');
  tel.addEventListener('input',function(){
    var d=tel.value.replace(/\\D/g,'').replace(/^55(?=\\d{10,11}$)/,'').slice(0,11), s=d;
    if(d.length>2) s='('+d.slice(0,2)+') '+d.slice(2);
    if(d.length>6) s='('+d.slice(0,2)+') '+d.slice(2,d.length-4)+'-'+d.slice(d.length-4);
    tel.value=s;
  });
  function falha(t, el){ erro.textContent=t; erro.hidden=false; (el||erro).scrollIntoView({block:'center',behavior:'smooth'}); if(el&&el.focus) el.focus({preventScroll:true}); }
  f.addEventListener('submit',function(ev){
    ev.preventDefault(); erro.hidden=true;
    var nome=document.getElementById('nome').value.trim();
    if(nome.length<2) return falha('Digite seu nome.', document.getElementById('nome'));
    var dig=tel.value.replace(/\\D/g,'');
    if(dig.length<10||dig.length>11) return falha('Digite seu WhatsApp com DDD. Ex.: (61) 99999-9999.', tel);
    var valores={}, campos=f.querySelectorAll('[data-id]');
    for(var i=0;i<campos.length;i++){
      var c=campos[i], id=c.getAttribute('data-id'), tipo=c.getAttribute('data-tipo'), v;
      if(tipo==='varias'){ v=[].map.call(c.querySelectorAll('input:checked'),function(x){return x.value;}); if(c.getAttribute('data-ob')&&!v.length) return falha('Responda: '+c.querySelector('legend').firstChild.textContent, c.querySelector('input')); }
      else if(tipo==='unica'){ var m=c.querySelector('input:checked'); v=m?m.value:''; if(c.getAttribute('data-ob')&&!v) return falha('Responda: '+c.querySelector('legend').firstChild.textContent, c.querySelector('input')); }
      else { var inp=c.querySelector('input,textarea'); v=inp.value.trim(); if(inp.required&&!v) return falha('Responda: '+c.querySelector('label').firstChild.textContent, inp); if(tipo==='email'&&v&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)) return falha('Confira o e-mail digitado.', inp); }
      valores[id]=v;
    }
    bt.disabled=true; bt.textContent='Enviando…';
    var origem=(location.search.match(/[?&]origem=([^&]+)/)||[])[1]||'';
    var cod=(location.search.match(/[?&]c=([A-Za-z0-9]{6})(?:&|$)/)||[])[1]||''; // código pessoal do link da campanha
    fetch(${js(acao)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome,telefone:dig,valores:valores,site:document.getElementById('site').value,c:cod,origem:(function(){ try{ return decodeURIComponent(origem); }catch(e){ return ''; } })()})})
      .then(function(r){ return r.json().catch(function(){ return {erro:'Não consegui enviar agora. Tente de novo.'}; }); })
      .then(function(j){
        if(!j||!j.ok){ bt.disabled=false; bt.textContent=${js(f.botao || 'Enviar')}; return falha((j&&j.erro)||'Não consegui enviar agora. Tente de novo.'); }
        if(j.atualizada) document.getElementById('okTit').textContent='Resposta atualizada!';
        f.hidden=true; var ok=document.getElementById('ok'); ok.hidden=false; ok.scrollIntoView({block:'center',behavior:'smooth'});
      })
      .catch(function(){ bt.disabled=false; bt.textContent=${js(f.botao || 'Enviar')}; falha('Sem conexão. Confira sua internet e tente de novo.'); });
  });
})();
</script>`}`;
  return moldura(f.titulo, f, corpo);
}

// Formulário fechado (pausado/encerrado) ou endereço que não existe.
function paginaFechada({ studio, f, capaUrl }) {
  if (!f) {
    return moldura('Formulário', null, `<article class="camp"><div class="cab"><div class="marca"><img src="${LOGO}" alt="SlimFit"><span>${esc(studio)}</span></div><h1>Formulário não encontrado</h1></div><div class="fechado"><p>Confira o link que você recebeu.</p></div></article>`);
  }
  return moldura(f.titulo, f, `<article class="camp">${cabecalho({ studio, f, capaUrl })}<div class="fechado"><p>Este formulário não está recebendo respostas no momento.</p></div></article>`);
}

module.exports = { paginaFormulario, paginaFechada, formatar };

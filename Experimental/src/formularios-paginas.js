/**
 * formularios-paginas.js — página PÚBLICA de um formulário de campanha
 * (/formulario/<endereço>), sem login. Pensada para o celular: a pessoa abre
 * pelo link do Instagram/WhatsApp, responde e recebe a mensagem de confirmação
 * na própria tela. Mesma identidade visual do painel (verde-petróleo + Inter).
 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Valor seguro dentro de <script> (um "</script>" no texto não fecha a tag).
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');

const LOGO = 'https://drive.google.com/thumbnail?id=1pl1mh709FGcitG9uHo0J6nzMUKFYqg-w&sz=w400';

const CSS = `
:root{
  color-scheme:light;
  --teal:#0e6e6b;--teal-esc:#0a5250;--teal-soft:#e4efee;--teal-linha:#c6dedc;
  --tinta:#1d1d1f;--cinza:#5f6066;--faint:#8e8e95;--bg:#f4f5f5;--card:#fff;--linha:#e2e4e4;
  --erro:#a12626;--erro-soft:#fbecec;--ok:#1a7f37;--ok-soft:#e8f5ec;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--tinta);font:16px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.topo{background:var(--card);border-bottom:1px solid var(--linha)}
.topo .in{max-width:640px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
.topo img{height:26px;width:auto}
.topo .studio{margin-left:auto;font-size:.85rem;color:var(--cinza)}
.wrap{max-width:640px;margin:0 auto;padding:20px 16px 48px}
.capa{display:block;width:100%;height:auto;border-radius:14px;margin:0 0 18px;border:1px solid var(--linha);background:var(--card)}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 8px;text-wrap:balance}
.lead{color:var(--cinza);margin:0 0 22px;white-space:pre-line;max-width:62ch}
.card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:18px 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:18px}
.campo{display:flex;flex-direction:column;gap:7px;border:0;margin:0;padding:0;min-width:0}
.campo legend{padding:0;margin:0 0 7px}
label.rot,.campo legend{font-weight:600;font-size:.93rem}
.ob{color:var(--erro);font-weight:700;margin-left:2px}
.opc{font-weight:400;color:var(--faint);font-size:.85rem}
input[type=text],input[type=tel],input[type=email],input[type=date],textarea{
  width:100%;font:inherit;font-size:1rem;color:var(--tinta);background:#fff;border:1px solid #cfd3d3;border-radius:10px;padding:11px 12px}
textarea{min-height:96px;resize:vertical}
input:focus,textarea:focus,button:focus-visible,.op input:focus-visible+span{outline:3px solid var(--teal-linha);outline-offset:1px;border-color:var(--teal)}
.ops{display:grid;gap:8px}
@media(min-width:520px){.ops.duas{grid-template-columns:1fr 1fr}}
.op{display:block;cursor:pointer;position:relative}
.op input{position:absolute;opacity:0;pointer-events:none}
.op span{display:flex;align-items:center;gap:10px;border:1px solid #cfd3d3;border-radius:12px;padding:11px 12px;font-size:.95rem;background:#fff}
.op span::before{content:"";flex:0 0 auto;width:18px;height:18px;border:2px solid #b9bebe;border-radius:50%;background:#fff}
.op.multi span::before{border-radius:5px}
.op input:checked+span{border-color:var(--teal);background:var(--teal-soft);box-shadow:inset 0 0 0 1px var(--teal)}
.op input:checked+span::before{border-color:var(--teal);background:var(--teal);box-shadow:inset 0 0 0 3px #fff}
.op.multi input:checked+span::before{box-shadow:none;background:var(--teal) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/14px no-repeat}
.btn{display:block;width:100%;font:inherit;font-weight:700;font-size:1.02rem;color:#fff;background:var(--teal);border:0;border-radius:12px;padding:15px 18px;cursor:pointer}
.btn:hover{background:var(--teal-esc)}
.btn[disabled]{opacity:.6;cursor:progress}
.msg{border-radius:10px;padding:11px 13px;font-size:.92rem;margin:0}
.msg.erro{background:var(--erro-soft);color:var(--erro)}
.lgpd{font-size:.8rem;color:var(--cinza);margin:12px 2px 0;text-align:center}
.pote{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.pronto{text-align:center;padding:30px 18px;align-items:center}
.pronto .ic{width:58px;height:58px;border-radius:50%;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center;font-size:1.7rem;font-weight:800}
.pronto h2{margin:0;font-size:1.25rem}
.pronto p{margin:0;color:var(--cinza);white-space:pre-line}
.fechado{text-align:center;padding:30px 18px;align-items:center}
.fechado p{margin:0;color:var(--cinza)}
.previa{background:#fdf3dc;color:#8a5a00;border:1px solid #f1d9a6;border-radius:10px;padding:9px 12px;font-size:.88rem;margin:0 0 16px}
`;

function moldura(titulo, studio, corpo) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<style>${CSS}</style></head><body>
<header class="topo"><div class="in"><img src="${LOGO}" alt="SlimFit"><span class="studio">${esc(studio)}</span></div></header>
<main class="wrap">${corpo}</main>
</body></html>`;
}

function campoHtml(c) {
  const ob = c.obrigatorio ? '<span class="ob" aria-hidden="true">*</span>' : ' <span class="opc">(opcional)</span>';
  const req = c.obrigatorio ? ' required' : '';
  const nm = 'v_' + c.id;
  if (c.tipo === 'unica' || c.tipo === 'varias') {
    const multi = c.tipo === 'varias';
    const curtas = c.opcoes.every(o => o.length <= 22) && c.opcoes.length > 2;
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

// previa=true → aberto pelo painel com o formulário pausado (só para conferir).
function paginaFormulario({ studio, f, capaUrl, acao, previa }) {
  const corpo = `
${previa ? '<p class="previa">Prévia: este formulário está <b>pausado ou encerrado</b>. Só quem está logado no painel vê esta página; as respostas daqui não são gravadas.</p>' : ''}
${capaUrl ? `<img class="capa" src="${esc(capaUrl)}" alt="">` : ''}
<h1>${esc(f.titulo)}</h1>
${f.descricao ? `<p class="lead">${esc(f.descricao)}</p>` : ''}
<form id="f" class="card" novalidate>
  <div class="campo"><label class="rot" for="nome">Seu nome<span class="ob" aria-hidden="true">*</span></label><input id="nome" type="text" autocomplete="name" maxlength="80" required></div>
  <div class="campo"><label class="rot" for="tel">Seu WhatsApp<span class="ob" aria-hidden="true">*</span></label><input id="tel" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(61) 99999-9999" maxlength="16" required></div>
  ${(f.campos || []).map(campoHtml).join('\n  ')}
  <div class="pote" aria-hidden="true"><label>Não preencha<input id="site" type="text" tabindex="-1" autocomplete="off"></label></div>
  <p id="erro" class="msg erro" role="alert" hidden></p>
  <button id="enviar" class="btn" type="submit">${esc(f.botao || 'Enviar')}</button>
</form>
<div id="ok" class="card pronto" hidden><div class="ic">✓</div><h2 id="okTit">Tudo certo!</h2><p>${esc(f.msgFinal)}</p></div>
<p class="lgpd">Ao enviar, você autoriza o ${esc(studio)} a falar com você pelo WhatsApp sobre esta campanha.</p>
<script>
(function(){
  var f=document.getElementById('f'), erro=document.getElementById('erro'), bt=document.getElementById('enviar'), tel=document.getElementById('tel');
  var PREVIA=${previa ? 'true' : 'false'};
  tel.addEventListener('input',function(){
    var d=tel.value.replace(/\\D/g,'').replace(/^55(?=\\d{10,11}$)/,'').slice(0,11), s=d;
    if(d.length>2) s='('+d.slice(0,2)+') '+d.slice(2);
    if(d.length>6) s='('+d.slice(0,2)+') '+d.slice(2,d.length-4)+'-'+d.slice(d.length-4);
    tel.value=s;
  });
  function falha(t, el){ erro.textContent=t; erro.hidden=false; (el||erro).scrollIntoView({block:'center',behavior:'smooth'}); if(el&&el.focus) el.focus(); }
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
    if(PREVIA){ f.hidden=true; document.getElementById('ok').hidden=false; return; }
    bt.disabled=true; bt.textContent='Enviando…';
    var origem=(location.search.match(/[?&]origem=([^&]+)/)||[])[1]||'';
    fetch(${js(acao)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome,telefone:dig,valores:valores,site:document.getElementById('site').value,origem:(function(){ try{ return decodeURIComponent(origem); }catch(e){ return ''; } })()})})
      .then(function(r){ return r.json().catch(function(){ return {erro:'Não consegui enviar agora. Tente de novo.'}; }); })
      .then(function(j){
        if(!j||!j.ok){ bt.disabled=false; bt.textContent=${js(f.botao || 'Enviar')}; return falha((j&&j.erro)||'Não consegui enviar agora. Tente de novo.'); }
        if(j.atualizada) document.getElementById('okTit').textContent='Resposta atualizada!';
        f.hidden=true; var ok=document.getElementById('ok'); ok.hidden=false; ok.scrollIntoView({block:'center',behavior:'smooth'});
      })
      .catch(function(){ bt.disabled=false; bt.textContent=${js(f.botao || 'Enviar')}; falha('Sem conexão. Confira sua internet e tente de novo.'); });
  });
})();
</script>`;
  return moldura(f.titulo, studio, corpo);
}

function paginaFechada({ studio, f }) {
  return moldura(f ? f.titulo : 'Formulário', studio, `
${f ? `<h1>${esc(f.titulo)}</h1>` : ''}
<div class="card fechado"><p>${f ? 'Este formulário não está recebendo respostas no momento.' : 'Não encontramos este formulário. Confira o link que você recebeu.'}</p></div>`);
}

module.exports = { paginaFormulario, paginaFechada };

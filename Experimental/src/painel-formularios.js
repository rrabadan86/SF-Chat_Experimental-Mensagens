/**
 * painel-formularios.js — formulários de campanha (páginas públicas e telas do painel).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const formularios = require('./formularios');
const formulariosPaginas = require('./formularios-paginas');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const auditoria = require('./auditoria');
const {
  uiTopo, esc, chrome, fmtData, uiBarra, uiPessoa, fmtTel, lerCookie, ehHttps, usuarioDaReq, scStudio, scHtml, scSoJson, scJson, scIp, lerCorpo, scBaseUrl, hojeSP,
} = require('./painel-base');

// ── Formulários de campanha (menu Formulário) ───────────────────────────────
// A recepção monta o formulário (perguntas, capa, tag) e divulga o link
// /formulario/<endereço>. As respostas ficam aqui, com planilha para baixar.
function fmLink(base, f) { return base + '/formulario/' + f.slug; }
const FM_CSS = `<style>
  .fm-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 4px}
  .fm-top h1{font-size:var(--fs-h1);margin:0}
  .fm-top .acts{margin:0 0 0 auto}
  .fm-card{display:flex;flex-direction:column;gap:8px}
  .fm-card h2{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .fm-nums{display:flex;gap:16px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--cinza)}
  .fm-nums b{color:var(--tinta);font-variant-numeric:tabular-nums}
  .fm-link{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg);border:1px solid var(--linha);border-radius:10px;padding:7px 10px;font-size:var(--fs-sm)}
  .fm-link code{overflow-wrap:anywhere;flex:1 1 220px}
  .fm-link button,.fm-btns button,.fm-btns a{padding:6px 13px;font-size:var(--fs-sm)}
  .fm-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .fm-btns a{display:inline-block;border-radius:999px;text-decoration:none;font-weight:700}
  .fm-btns a.save{color:#fff}
  .fm-btns a.reset{color:var(--cinza)}
  .fm-del{color:var(--erro)!important;border-color:var(--erro-bd)!important}
  .st-aberto{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd)}
  .st-pausado{background:#eee;color:#6e6e73}
  .st-encerrado{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bd)}
  .fm-vazio{text-align:center;padding:28px 18px}
  .fm-vazio p{max-width:52ch;margin:6px auto 14px;color:var(--cinza)}
  .fm-q{border:1px solid var(--linha);border-radius:12px;padding:12px;margin:10px 0;background:var(--bg)}
  .fm-q-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .fm-q-h .n{font-weight:800;color:var(--teal-esc);font-size:var(--fs-sm);min-width:22px}
  .fm-q-h select{width:auto;flex:0 1 210px}
  .fm-q-h .sp{flex:1}
  .fm-q-h button{padding:5px 10px;font-size:var(--fs-sm);background:#fff;color:var(--cinza);border:1px solid #dcdcdc}
  .fm-q-h button:disabled{opacity:.35;cursor:default}
  .fm-q label{margin:10px 0 4px}
  .fm-fixos{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 2px}
  .fm-fixo{border:1px dashed var(--linha);border-radius:999px;padding:4px 12px;font-size:var(--fs-sm);color:var(--cinza);background:#fff}
  .fm-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
  @media(max-width:600px){.fm-grid{grid-template-columns:1fr}}
  .fm-slug{display:flex;align-items:stretch}
  .fm-slug span{display:flex;align-items:center;padding:0 10px;border:1px solid #dcdcdc;border-right:0;border-radius:10px 0 0 10px;background:var(--bg);color:var(--cinza);font-size:var(--fs-sm);white-space:nowrap}
  .fm-slug input{border-radius:0 10px 10px 0!important}
  .fm-capa{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .fm-capa img{max-width:220px;max-height:120px;border-radius:10px;border:1px solid var(--linha);object-fit:cover}
  .fm-barra{position:sticky;bottom:0;z-index:20;background:var(--bg);padding:10px 0 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--linha)}
  .fm-barra .msg{font-size:var(--fs-sm);color:var(--cinza)}
  .fm-tabw{overflow-x:auto;border:1px solid var(--linha);border-radius:12px;background:#fff}
  .fm-tab{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .fm-grupo{border-top:1px solid var(--linha-soft);margin-top:8px;padding-top:4px}
  .fm-grupo>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:8px 2px;font-weight:600;font-size:.88rem}
  .fm-grupo>summary::-webkit-details-marker{display:none}
  .fm-grupo>summary::before{content:"▸";color:var(--teal);font-weight:900}
  .fm-grupo[open]>summary::before{content:"▾"}
  .fm-tab th,.fm-tab td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--linha-soft);vertical-align:top}
  .fm-tab th{color:var(--cinza);font-weight:700;white-space:nowrap;background:var(--bg)}
  .fm-tab td{max-width:260px;overflow-wrap:anywhere}
  .fm-tab td.nw{white-space:nowrap;font-variant-numeric:tabular-nums}
  .fm-tab td.nm{min-width:150px;font-weight:600}
  .fm-tab tr:last-child td{border-bottom:0}
  .fm-tab a{color:var(--teal-esc);font-weight:600}
  .fm-tab .x{background:none;border:0;color:var(--faint);padding:2px 6px;font-size:1rem}
  .fm-tab .x:hover{color:var(--erro)}
  .fm-busca{max-width:320px}
  .fm-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 6px}
  .fm-stats div{background:#fff;border:1px solid var(--linha);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column}
  .fm-stats b{font-size:1.35rem;font-variant-numeric:tabular-nums;color:var(--teal-esc);line-height:1.2}
  .fm-stats span{font-size:var(--fs-sm);color:var(--cinza)}
  @media(max-width:560px){.fm-stats{grid-template-columns:1fr 1fr}}
</style>`;
const FM_JS_COPIAR = `function fmCopiar(t,b){ var ok=function(){ var o=b.textContent; b.textContent='Copiado!'; setTimeout(function(){ b.textContent=o; },1500); }; if(navigator.clipboard) navigator.clipboard.writeText(t).then(ok,function(){ prompt('Copie o link:',t); }); else prompt('Copie o link:',t); }`;

function paginaFormularios(base, aviso) {
  const lista = formularios.listar();
  const ST = { aberto: 'Recebendo respostas', pausado: 'Pausado', encerrado: 'Encerrado (passou da data)' };
  const cards = lista.map(f => {
    const link = fmLink(base, f);
    const ult = formularios.respostas(f.id)[0];
    return `<div class="card fm-card">
      <h2>${esc(f.titulo)} <span class="pill st-${f.situacao}">${ST[f.situacao]}</span></h2>
      <div class="fm-nums">${(() => { const a = formularios.acessos(f.id); return `<span><b>${a.aberturas}</b> abertura${a.aberturas === 1 ? '' : 's'}</span><span><b>${a.pessoas}</b> pessoa${a.pessoas === 1 ? '' : 's'}</span><span><b>${f.total}</b> resposta${f.total === 1 ? '' : 's'}</span>${a.pessoas ? `<span>conversão <b>${String(a.conversao).replace('.', ',')}%</b></span>` : ''}`; })()}${ult ? `<span>última: ${esc(formularios.fmtQuando(ult.atualizadoEm || ult.em))}</span>` : ''}${f.tag ? `<span>tag nos contatos: <b>${esc(f.tag)}</b></span>` : ''}${f.encerraEm ? `<span>encerra em ${esc(fmtData(f.encerraEm))}</span>` : ''}</div>
      <div class="fm-link"><code>${esc(link)}</code><button type="button" class="reset" onclick="fmCopiar('${esc(link)}',this)">Copiar link</button></div>
      <div class="fm-btns">
        <a class="save" href="/formularios/respostas?id=${f.id}">Ver respostas</a>
        <a class="reset" href="/formularios/editar?id=${f.id}">Editar</a>
        <a class="reset" href="${esc(link)}" target="_blank" rel="noopener">Abrir página</a>
        <button type="button" class="reset" onclick="fmAcao('${f.id}','${f.ativo ? 'pausar' : 'abrir'}')">${f.ativo ? 'Pausar' : 'Abrir para respostas'}</button>
        <button type="button" class="reset" onclick="fmAcao('${f.id}','duplicar')">Duplicar</button>
        <button type="button" class="reset fm-del" onclick="fmAcao('${f.id}','excluir',${f.total})">Excluir</button>
      </div>
    </div>`;
  }).join('');
  const vazio = `<div class="card fm-vazio"><h2>Nenhum formulário ainda</h2>
    <p>Monte um formulário com as perguntas que quiser, divulgue o link no Instagram ou no WhatsApp e acompanhe aqui quem se interessou. Comece pelo modelo da Black Friday e ajuste o que precisar.</p>
    <div class="fm-btns" style="justify-content:center"><a class="save" href="/formularios/editar?modelo=blackfriday">Usar modelo Black Friday</a><a class="reset" href="/formularios/editar">Começar em branco</a></div></div>`;
  const corpo = `<div class="wrap">${FM_CSS}
    ${uiTopo({ titulo: 'Formulários de campanha', sub: 'Listas de interessadas para promoções e eventos. Quem responde com o mesmo WhatsApp de novo só atualiza a resposta, sem duplicar.', acoes: lista.length ? '<a class="ui-btn sec" href="/formularios/editar?modelo=blackfriday">Modelo Black Friday</a><a class="ui-btn" href="/formularios/editar">＋ Novo formulário</a>' : '' })}
    ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
    ${cards || vazio}
  </div>
  <script>
  ${FM_JS_COPIAR}
  function fmAcao(id, acao, total){
    if(acao==='excluir' && !confirm('Excluir este formulário'+(total?' e as '+total+' respostas':'')+'? O link para de funcionar. Não dá para desfazer.\\n\\nDica: se só quer parar de receber respostas, use "Pausar".')) return;
    fetch('/formularios/acao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,acao:acao})})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui concluir.')); return; } if(j.ir) location.href=j.ir; else location.reload(); })
      .catch(function(){ alert('❌ Erro de rede.'); });
  }
  </script>`;
  return chrome({ tab: 'Formulários de campanha' }, 'formularios', corpo);
}

function paginaFormularioEditar(base, f, modelo) {
  const novo = !f;
  const d = f || (modelo ? Object.assign({ ativo: true }, formularios.MODELO_BLACK_FRIDAY) : { titulo: '', descricao: '', campos: [], botao: 'Enviar', msgFinal: 'Recebemos sua resposta. Obrigada!', tag: '', ativo: true, slug: '' });
  const ini = { id: f ? f.id : '', campos: d.campos || [], capaUrl: f && f.capa ? `/formulario/${f.slug}/capa.jpg?v=${f.capaV || ''}` : '' };
  let tags = []; try { tags = contatos.tagsDistintas().map(t => t.tag).filter(Boolean); } catch (_) {}
  const tiposOpts = Object.entries(formularios.TIPOS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const corpo = `<div class="wrap">${FM_CSS}
    ${uiTopo({ titulo: novo ? 'Novo formulário' : 'Editar formulário', sub: 'Monte a página, as perguntas e o que acontece com quem responde.', acoes: '<a href="/formularios" class="ui-btn sec">← Voltar para a lista</a>' })}
    ${f ? `<div class="fm-link" style="margin:8px 0"><span>Link:</span><code>${esc(fmLink(base, f))}</code><button type="button" class="reset" onclick="fmCopiar('${esc(fmLink(base, f))}',this)">Copiar link</button><a href="${esc(fmLink(base, f))}" target="_blank" rel="noopener" style="color:var(--teal-esc);font-weight:600">Abrir</a></div>` : ''}
    ${modelo && novo ? '<div class="aviso">Modelo da Black Friday carregado. Troque os textos e as perguntas como quiser e clique em <b>Salvar</b>.</div>' : ''}
    <form id="fm" onsubmit="return false">
    <div class="card">
      <h2>Página</h2>
      <label for="titulo">Título</label>
      <input id="titulo" type="text" maxlength="120" value="${esc(d.titulo)}" placeholder="Ex.: Black Friday SlimFit">
      <label for="descricao">Texto de apresentação <span class="quando" style="font-weight:400">(opcional)</span></label>
      <textarea id="descricao" rows="5" maxlength="2000" placeholder="Explique a campanha em poucas linhas.">${esc(d.descricao)}</textarea>
      <p class="quando">Dica: <b>*texto*</b> fica em negrito (como no WhatsApp); linhas começando com <b>-</b> viram lista; linha em branco separa parágrafos.</p>
      <label for="tema">Visual da página</label>
      <select id="tema" style="max-width:340px"><option value="claro"${d.tema !== 'escuro' ? ' selected' : ''}>Claro — verde SlimFit</option><option value="escuro"${d.tema === 'escuro' ? ' selected' : ''}>Escuro — preto e vermelho (Black Friday)</option></select>
      <label>Imagem de capa <span class="quando" style="font-weight:400">(opcional — aparece no topo, ex.: o flyer da campanha)</span></label>
      <div class="fm-capa"><img id="capaImg" alt="" hidden><button type="button" class="reset" id="capaBt">Escolher imagem</button><button type="button" class="reset fm-del" id="capaRm" hidden>Remover</button><span id="capaMsg" class="quando"></span><input id="capaArq" type="file" accept="image/*" hidden></div>
      <label for="slug">Endereço do link</label>
      <div class="fm-slug"><span>${esc(base)}/formulario/</span><input id="slug" type="text" maxlength="40" value="${esc(d.slug || '')}" placeholder="blackfriday"></div>
      <p class="quando">Só letras, números e hífen. Se ficar vazio, usamos o título.</p>
    </div>
    <div class="card">
      <h2>Perguntas</h2>
      <p class="quando">Todo formulário já pede estes dois, obrigatórios:</p>
      <div class="fm-fixos"><span class="fm-fixo">Seu nome</span><span class="fm-fixo">Seu WhatsApp</span></div>
      <div id="qs"></div>
      <button type="button" class="reset" id="addQ" style="margin-top:6px">+ Adicionar pergunta</button>
    </div>
    <div class="card">
      <h2>Envio</h2>
      <div class="fm-grid">
        <div><label for="botao">Texto do botão</label><input id="botao" type="text" maxlength="40" value="${esc(d.botao)}"></div>
        <div><label for="tag">Tag nos Contatos da SoFIA <span class="quando" style="font-weight:400">(opcional)</span></label><input id="tag" type="text" maxlength="40" list="tagsLista" value="${esc(d.tag)}" placeholder="Ex.: Black Friday"><datalist id="tagsLista">${tags.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
      </div>
      <p class="quando">Com tag, quem responde entra nos Contatos da SoFIA marcado com ela. Depois é só criar uma campanha em SoFIA → Campanhas para essa tag.</p>
      <label for="msgFinal">Mensagem depois de enviar</label>
      <textarea id="msgFinal" rows="2" maxlength="500">${esc(d.msgFinal)}</textarea>
      <div class="fm-grid">
        <div><label class="chk" style="margin-top:16px"><input id="ativo" type="checkbox"${d.ativo !== false ? ' checked' : ''}> Recebendo respostas</label></div>
        <div><label for="encerraEm">Parar de receber em <span class="quando" style="font-weight:400">(opcional)</span></label><input id="encerraEm" type="date" value="${esc(d.encerraEm || '')}"></div>
      </div>
      <p class="quando">Na data escolhida o formulário ainda aceita respostas até 23h59; no dia seguinte, a página mostra "não está recebendo respostas".</p>
    </div>
    <div class="fm-barra"><button type="button" class="save" id="salvar">Salvar</button><span class="msg" id="msg"></span></div>
    </form>
  </div>
  <script>
  ${FM_JS_COPIAR}
  (function(){
    var INI=${JSON.stringify(ini).replace(/</g, '\\u003c')};
    var TIPOS_OPTS=${JSON.stringify(tiposOpts).replace(/</g, '\\u003c')};
    var COM_OPCOES={unica:1,varias:1};
    var C=INI.campos.map(function(c){ return {id:c.id||'',tipo:c.tipo,rotulo:c.rotulo,obrigatorio:!!c.obrigatorio,opcoes:(c.opcoes||[]).join('\\n')}; });
    var qs=document.getElementById('qs'), sujo=false;
    function marcarSujo(){ sujo=true; }
    document.getElementById('fm').addEventListener('input',marcarSujo);
    window.addEventListener('beforeunload',function(e){ if(sujo){ e.preventDefault(); e.returnValue=''; } });
    function el(tag,attrs,html){ var e=document.createElement(tag); for(var k in attrs) e.setAttribute(k,attrs[k]); if(html!=null) e.innerHTML=html; return e; }
    function render(){
      qs.innerHTML='';
      if(!C.length) qs.appendChild(el('p',{'class':'quando'},'Nenhuma pergunta extra. Clique em <b>+ Adicionar pergunta</b> para incluir.'));
      C.forEach(function(c,i){
        var box=el('div',{'class':'fm-q'});
        var h=el('div',{'class':'fm-q-h'});
        h.appendChild(el('span',{'class':'n'},String(i+1)));
        var sel=el('select',{'aria-label':'Tipo da pergunta'},TIPOS_OPTS); sel.value=c.tipo;
        sel.onchange=function(){ c.tipo=sel.value; marcarSujo(); render(); };
        h.appendChild(sel);
        var ob=el('label',{'class':'chk',style:'margin:0;font-size:var(--fs-sm)'}); var obi=el('input',{type:'checkbox'}); obi.checked=c.obrigatorio; obi.onchange=function(){ c.obrigatorio=obi.checked; marcarSujo(); }; ob.appendChild(obi); ob.appendChild(document.createTextNode(' Obrigatória'));
        h.appendChild(ob);
        h.appendChild(el('span',{'class':'sp'}));
        var up=el('button',{type:'button',title:'Subir','aria-label':'Subir'},'↑'); up.disabled=i===0; up.onclick=function(){ C.splice(i-1,0,C.splice(i,1)[0]); marcarSujo(); render(); };
        var dn=el('button',{type:'button',title:'Descer','aria-label':'Descer'},'↓'); dn.disabled=i===C.length-1; dn.onclick=function(){ C.splice(i+1,0,C.splice(i,1)[0]); marcarSujo(); render(); };
        var rm=el('button',{type:'button',title:'Remover pergunta'},'Remover'); rm.onclick=function(){ if(c.rotulo && !confirm('Remover a pergunta "'+c.rotulo+'"? As respostas já recebidas continuam na planilha.')) return; C.splice(i,1); marcarSujo(); render(); };
        h.appendChild(up); h.appendChild(dn); h.appendChild(rm);
        box.appendChild(h);
        var lid='q'+i;
        box.appendChild(el('label',{'for':lid},'Pergunta'));
        var inp=el('input',{type:'text',id:lid,maxlength:'200',placeholder:'Ex.: Qual plano te interessa?'}); inp.value=c.rotulo; inp.oninput=function(){ c.rotulo=inp.value; };
        box.appendChild(inp);
        if(COM_OPCOES[c.tipo]){
          box.appendChild(el('label',{'for':lid+'o'},'Opções <span class="quando" style="font-weight:400">(uma por linha)</span>'));
          var ta=el('textarea',{id:lid+'o',rows:'4',placeholder:'Opção 1\\nOpção 2'}); ta.value=c.opcoes; ta.oninput=function(){ c.opcoes=ta.value; };
          box.appendChild(ta);
        }
        qs.appendChild(box);
      });
    }
    document.getElementById('addQ').onclick=function(){ C.push({id:'',tipo:'texto',rotulo:'',obrigatorio:false,opcoes:''}); marcarSujo(); render(); var all=qs.querySelectorAll('input[type=text]'); if(all.length) all[all.length-1].focus(); };
    render();

    // Capa: reduz no navegador (JPEG, até 1200px, máx. 1 MB) antes de enviar.
    var capa='', capaImg=document.getElementById('capaImg'), capaRm=document.getElementById('capaRm'), capaMsg=document.getElementById('capaMsg'), arq=document.getElementById('capaArq');
    function mostrarCapa(src){ if(src){ capaImg.src=src; capaImg.hidden=false; capaRm.hidden=false; document.getElementById('capaBt').textContent='Trocar imagem'; } else { capaImg.hidden=true; capaRm.hidden=true; document.getElementById('capaBt').textContent='Escolher imagem'; } }
    mostrarCapa(INI.capaUrl);
    document.getElementById('capaBt').onclick=function(){ arq.click(); };
    capaRm.onclick=function(){ capa='remover'; mostrarCapa(''); capaMsg.textContent='A capa sai quando você salvar.'; marcarSujo(); };
    var MAX=500*1024; function bytes(d){ // capa leve: sobe rápido mesmo na internet do celular
     return Math.floor((d.length-d.indexOf(',')-1)*3/4); }
    arq.onchange=function(){
      var file=arq.files&&arq.files[0]; if(!file) return;
      var img=new Image(), url=URL.createObjectURL(file);
      img.onload=function(){
        URL.revokeObjectURL(url);
        var lado=1080, d='';
        for(var t=0;t<4;t++){
          var k=Math.min(1,lado/Math.max(img.naturalWidth,img.naturalHeight));
          var cv=document.createElement('canvas'); cv.width=Math.round(img.naturalWidth*k); cv.height=Math.round(img.naturalHeight*k);
          var cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height); cx.drawImage(img,0,0,cv.width,cv.height);
          for(var q=.85;q>=.45;q-=.1){ d=cv.toDataURL('image/jpeg',q); if(bytes(d)<=MAX) break; }
          if(bytes(d)<=MAX) break;
          lado=Math.round(lado*.75);
        }
        if(d.indexOf('data:image/jpeg')!==0||bytes(d)>MAX){ capaMsg.textContent='Essa imagem é grande demais mesmo reduzida. Escolha outra.'; return; }
        capa=d; mostrarCapa(d); capaMsg.textContent='Imagem pronta ('+Math.round(bytes(d)/1024)+' KB). Ela entra quando você salvar.'; marcarSujo();
      };
      img.onerror=function(){ capaMsg.textContent='Não consegui abrir essa imagem. Tente JPG ou PNG.'; };
      img.src=url;
    };

    var bt=document.getElementById('salvar'), msg=document.getElementById('msg');
    bt.onclick=function(){
      var v=function(id){ return document.getElementById(id).value; };
      var d={ id:INI.id, titulo:v('titulo'), descricao:v('descricao'), tema:v('tema'), slug:v('slug'), botao:v('botao'), tag:v('tag'), msgFinal:v('msgFinal'), encerraEm:v('encerraEm'), ativo:document.getElementById('ativo').checked,
        campos:C.map(function(c){ return {id:c.id,tipo:c.tipo,rotulo:c.rotulo,obrigatorio:c.obrigatorio,opcoes:c.opcoes.split('\\n')}; }) };
      if(capa) d.capa=capa;
      bt.disabled=true; msg.textContent=capa&&capa!=='remover' ? 'Enviando a imagem…' : 'Salvando…';
      // XHR (e não fetch) para mostrar o andamento do envio da imagem e desistir
      // com aviso claro se a conexão travar, em vez de ficar em "Salvando…".
      var x=new XMLHttpRequest();
      x.open('POST','/formularios/salvar'); x.setRequestHeader('Content-Type','application/json'); x.timeout=90000;
      if(x.upload) x.upload.onprogress=function(e){ if(e.lengthComputable && capa && capa!=='remover'){ var p=Math.round(e.loaded*100/e.total); msg.textContent=p<100 ? 'Enviando a imagem… '+p+'%' : 'Salvando…'; } };
      function erro(t){ bt.disabled=false; msg.textContent='❌ '+t; }
      x.onload=function(){
        var j=null; try{ j=JSON.parse(x.responseText); }catch(e){}
        if(!j) return erro(x.status===413 ? 'A imagem ficou grande demais para o servidor. Escolha uma menor.' : 'O servidor não respondeu direito (código '+x.status+'). Tente de novo.');
        if(!j.ok) return erro(j.erro||'Não consegui salvar.');
        sujo=false; location.href='/formularios/editar?id='+j.id+'&ok=1';
      };
      x.onerror=function(){ erro('Sem conexão com o painel. Confira a internet e tente de novo.'); };
      x.ontimeout=function(){ erro('Demorou demais e eu desisti. Confira a internet e tente de novo — se repetir, use uma imagem menor.'); };
      x.send(JSON.stringify(d));
    };
  })();
  </script>`;
  return chrome({ tab: novo ? 'Novo formulário' : 'Editar formulário' }, 'formularios', corpo);
}

// ── Formulário × campanha da SoFIA ───────────────────────────────────────────
// A SoFIA põe um código pessoal no link do formulário em cada mensagem de campanha
// e grava { c, tel, nome, slug, camp, campNome, em } em formulario-codigos.jsonl.
// Aqui cruzamos com as aberturas (por código) e as respostas: quem recebeu, quem
// abriu (quantas vezes), quem respondeu — e quem abriu e NÃO respondeu.
function fmCodigosDoForm(f) {
  let linhas = [];
  try { linhas = fs.readFileSync(path.join(sofia.DIR, 'formulario-codigos.jsonl'), 'utf8').split('\n'); } catch (_) { return []; }
  const out = [];
  for (const l of linhas) { if (!l.trim()) continue; try { const o = JSON.parse(l); if (o && o.slug === f.slug && formularios.CODIGO_OK.test(o.c || '')) out.push(o); } catch (_) {} }
  return out;
}
function fmCampanhas(f, respostas) {
  const cods = fmCodigosDoForm(f);
  if (!cods.length) return [];
  const porTel = new Map(respostas.map(r => [formularios.chaveTel(String(r.telefone).replace(/\D/g, '')), r]));
  const porCod = new Map(respostas.filter(r => r.codigo).map(r => [r.codigo, r]));
  const camps = new Map();
  for (const o of cods) {
    const cp = camps.get(o.camp) || camps.set(o.camp, { id: o.camp, nome: o.campNome || 'Campanha', em: o.em, pessoas: new Map() }).get(o.camp);
    if (o.em < cp.em) cp.em = o.em;
    const tel = String(o.tel || '').replace(/\D/g, '');
    const k = formularios.chaveTel(tel);
    const p = cp.pessoas.get(k) || cp.pessoas.set(k, { tel, nome: o.nome || '', codigos: [], enviado: o.em, n: 0, u: 0 }).get(k);
    p.codigos.push(o.c);
    const v = formularios.vezesCodigo(f.id, o.c);
    if (v) { p.n += v.n || 0; p.u = Math.max(p.u, v.u || 0); }
  }
  for (const cp of camps.values()) {
    for (const p of cp.pessoas.values()) {
      p.resp = porTel.get(formularios.chaveTel(p.tel)) || null;
      if (!p.resp) { const rc = p.codigos.map(c => porCod.get(c)).find(Boolean); if (rc) { p.resp = rc; p.encaminhado = true; } }
      p.grupo = p.resp ? 'respondeu' : (p.n ? 'abriu' : 'naoabriu');
    }
    cp.lista = [...cp.pessoas.values()];
  }
  return [...camps.values()].sort((a, b) => b.em - a.em);
}

function paginaFormularioRespostas(base, f) {
  const lista = formularios.respostas(f.id);
  const cols = formularios.colunas(f, lista);
  const link = fmLink(base, f);
  const fmQuandoCurto = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const nomeCamp = new Map(); // código → nome da campanha (p/ a coluna de visitas)
  const camps = fmCampanhas(f, lista);
  for (const cp of camps) for (const p of cp.lista) for (const c of p.codigos) nomeCamp.set(c, cp.nome);
  const visitasDe = (r) => {
    const v = r.vid ? formularios.vezesVisitante(f.id, r.vid) : null;
    const partes = [];
    if (v) partes.push(`abriu <b>${v.n}×</b>${v.p ? ` · 1º ${esc(fmQuandoCurto(v.p))}` : ''}`);
    if (r.codigo) partes.push(`📩 ${esc(nomeCamp.get(r.codigo) || 'campanha')}`);
    return partes.join('<br>') || '<span style="color:var(--faint)">—</span>';
  };
  const ROT_G = { respondeu: '✅ Responderam', abriu: '🤔 Abriram e não responderam', naoabriu: '📭 Não abriram' };
  const SIT_G = { respondeu: 'fechou', abriu: 'aguardando', naoabriu: 'agendada' };
  const blocoCampanhas = camps.map(cp => {
    const g = { respondeu: [], abriu: [], naoabriu: [] };
    for (const p of cp.lista) g[p.grupo].push(p);
    const tot = cp.lista.length, abriram = g.respondeu.filter(p => p.n).length + g.abriu.length;
    const pessoa = (p) => uiPessoa({
      nome: p.nome || fmtTel(p.tel), href: '/sofia?view=contatos&q=' + p.tel.slice(-8),
      meta: [
        `📱 ${esc(fmtTel(p.tel))}`,
        `📤 recebeu ${esc(fmQuandoCurto(p.enviado))}`,
        p.n ? `👀 abriu <b>${p.n}×</b> · última ${esc(fmQuandoCurto(p.u))}` : '👀 não abriu',
        p.resp ? (p.encaminhado ? `↪️ link encaminhado — respondeu <b>${esc(p.resp.nome)}</b> (${esc(fmtTel(p.resp.telefone))})` : `✅ respondeu ${esc(formularios.fmtQuando(p.resp.atualizadoEm || p.resp.em))}`) : '',
      ],
    });
    const grupo = (k) => g[k].length ? `<details class="fm-grupo"${k === 'abriu' ? ' open' : ''}><summary>${ROT_G[k]} <b>${g[k].length}</b>${k !== 'respondeu' ? ` <button type="button" class="ui-btn sec" style="margin-left:auto;padding:4px 10px;font-size:.76rem" onclick="event.preventDefault();fmEtiquetar(${esc(JSON.stringify(cp.id))},'${k}',${esc(JSON.stringify(f.titulo + (k === 'abriu' ? ' · abriu sem responder' : ' · não abriu')))})">🏷️ Etiquetar estes ${g[k].length}</button>` : ''}</summary><div class="ip-lista">${g[k].sort((a, b) => (b.u || 0) - (a.u || 0)).map(pessoa).join('')}</div></details>` : '';
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><b>📩 ${esc(cp.nome)}</b><span class="quando" style="margin:0">disparada ${esc(fmQuandoCurto(cp.em))}</span></div>
      ${uiBarra({ rot: 'Receberam', n: tot, max: tot, valor: tot })}
      ${uiBarra({ rot: 'Abriram', n: abriram, max: tot })}
      ${uiBarra({ rot: 'Responderam', n: g.respondeu.length, max: tot, cor: 'var(--ok)' })}
      ${uiBarra({ rot: 'Abriram, não resp.', n: g.abriu.length, max: tot, cor: '#e0a100' })}
      ${grupo('abriu')}${grupo('respondeu')}${grupo('naoabriu')}
    </div>`;
  }).join('');
  const linhas = lista.map(r => {
    const wa = 'https://wa.me/' + String(r.telefone).replace(/\D/g, '');
    const busca = [r.nome, r.telefone, formularios.fmtTel(r.telefone), ...cols.map(c => formularios.valorTexto(r, c.id))].join(' ').toLowerCase();
    return `<tr data-b="${esc(busca)}">
      <td class="nw">${esc(formularios.fmtQuando(r.atualizadoEm || r.em))}${r.vezes > 1 ? ` <span class="pill" title="Respondeu ${r.vezes} vezes; vale a última">${r.vezes}×</span>` : ''}</td>
      <td class="nm">${esc(r.nome)}</td>
      <td class="nw"><a href="${wa}" target="_blank" rel="noopener">${esc(formularios.fmtTel(r.telefone))}</a></td>
      <td class="nw" style="font-size:.78rem">${visitasDe(r)}</td>
      ${cols.map(c => `<td>${esc(formularios.valorTexto(r, c.id)) || '<span style="color:var(--faint)">—</span>'}</td>`).join('')}
      <td><button type="button" class="x" title="Apagar esta resposta" aria-label="Apagar resposta de ${esc(r.nome)}" data-id="${r.id}" data-nome="${esc(r.nome)}" onclick="fmApagar(this)">×</button></td>
    </tr>`;
  }).join('');
  const corpo = `<div class="wrap" style="max-width:1080px">${FM_CSS}
    ${uiTopo({ titulo: esc(f.titulo), sub: 'Quem respondeu, de onde veio e quantas pessoas abriram o link.', acoes: '<a href="/formularios" class="ui-btn sec">← Voltar para a lista</a>' })}
    ${(() => {
      const a = formularios.acessos(f.id);
      const pct = (n, d) => d ? String(Math.round(n * 1000 / d) / 10).replace('.', ',') + '%' : '—';
      const rotOrig = o => o ? esc(o) : '<span style="color:var(--faint)">link sem origem</span>';
      const origens = a.porOrigem.filter(o => o.aberturas || o.respostas);
      const tabOrig = (origens.length > 1 || (origens.length === 1 && origens[0].origem)) ? `<div class="fm-tabw" style="margin:10px 0 4px"><table class="fm-tab"><thead><tr><th>Origem</th><th>Aberturas</th><th>Pessoas</th><th>Respostas</th><th>Conversão</th></tr></thead><tbody>${origens.map(o => `<tr><td>${rotOrig(o.origem)}</td><td class="nw">${o.aberturas}</td><td class="nw">${o.pessoas}</td><td class="nw">${o.respostas}</td><td class="nw">${pct(o.respostas, o.pessoas)}</td></tr>`).join('')}</tbody></table></div>` : '';
      return `<div class="fm-stats"><div><b>${a.aberturas}</b><span>aberturas</span></div><div><b>${a.pessoas}</b><span>pessoas</span></div><div><b>${a.respostas}</b><span>respostas</span></div><div><b>${pct(a.respostas, a.pessoas)}</b><span>conversão</span></div></div>
      ${tabOrig}
      <p class="quando">Aberturas = vezes que a página abriu num celular/computador (recarregar em menos de 2 min não conta de novo); pessoas = celulares/computadores diferentes; conversão = respostas ÷ pessoas. Não contam: a equipe logada no painel, as prévias de link (WhatsApp, Instagram…) e os verificadores de link — só conta quem abriu a página de verdade. Veja quem foi em <b>Últimas aberturas</b>, no fim da página. Para saber de onde vieram, divulgue o link com a origem no final, ex.: <code>${esc(link)}?origem=instagram</code> ou <code>?origem=whatsapp</code>.</p>
      ${f.tag ? `<p class="quando">Todas as respostas entram nos Contatos da SoFIA com a tag <b>${esc(f.tag)}</b>.</p>` : ''}`;
    })()}
    <div class="fm-link"><code>${esc(link)}</code><button type="button" class="reset" onclick="fmCopiar('${esc(link)}',this)">Copiar link</button></div>
    <div class="fm-btns" style="margin:12px 0">
      ${lista.length ? `<a class="save" href="/formularios/exportar?id=${f.id}">Baixar planilha</a>` : ''}
      <a class="reset" href="/formularios/editar?id=${f.id}">Editar formulário</a>
      ${lista.length > 5 ? '<input id="busca" class="fm-busca" type="text" placeholder="Buscar nome, telefone ou resposta" aria-label="Buscar nas respostas">' : ''}
    </div>
    ${camps.length ? `<div class="sec-t">Pela campanha <small style="font-weight:600;color:var(--cinza)">(quem recebeu o link pela SoFIA — cada pessoa ganha um link com código próprio)</small></div>
    ${blocoCampanhas}
    <p class="quando">Etiquetar coloca uma tag nos Contatos; depois é só criar uma nova campanha para essa tag (SoFIA → Campanhas). “Link encaminhado” = a resposta veio pelo link de uma pessoa, mas de outro telefone.</p>
    <div class="sec-t">Respostas</div>` : ''}
    ${f.tag && lista.length ? `<p class="quando">Para mandar a oferta para esta lista: SoFIA → Campanhas → nova campanha para a tag <b>${esc(f.tag)}</b>.</p>` : ''}
    ${lista.length ? `<div class="fm-tabw"><table class="fm-tab"><thead><tr><th>Data</th><th>Nome</th><th>WhatsApp</th><th>Acessos</th>${cols.map(c => `<th>${esc(c.rotulo)}</th>`).join('')}<th></th></tr></thead><tbody id="tb">${linhas}</tbody></table></div>`
    : `<div class="card fm-vazio"><h2>Ainda sem respostas</h2><p>Divulgue o link acima. As respostas aparecem aqui assim que chegam (atualize a página).</p></div>`}
    ${(() => {
      // Últimas aberturas: quando, aparelho, origem e — se der para saber — quem
      // (pelo código pessoal da campanha ou porque a mesma pessoa respondeu).
      const log = formularios.ultimasAberturas(f.id);
      const porCod = new Map(fmCodigosDoForm(f).map(o => [o.c, o]));
      const porVid = new Map(lista.filter(r => r.vid).map(r => [r.vid, r]));
      const nVis = {}; for (const x of log) nVis[x.v] = (nVis[x.v] || 0) + 1;
      const rot = new Map(); let k = 0; // visitante sem nome → "Visitante 1, 2…"
      const quem = (x) => {
        const cd = x.c && porCod.get(x.c);
        if (cd) return `📩 <b>${esc(cd.nome || formularios.fmtTel(cd.tel))}</b> <span class="quando" style="margin:0">(link da campanha)</span>`;
        const r = porVid.get(x.v);
        if (r) return `✅ <b>${esc(r.nome)}</b> <span class="quando" style="margin:0">(respondeu)</span>`;
        if (!rot.has(x.v)) rot.set(x.v, ++k);
        return `<span style="color:var(--cinza)">Visitante ${rot.get(x.v)}</span>`;
      };
      const linhasLog = log.slice(0, 100).map(x => `<tr><td class="nw">${esc(formularios.fmtQuando(x.t))}</td><td>${quem(x)}</td><td class="nw">${esc(x.d || '—')}</td><td class="nw">${x.o ? esc(x.o) : '<span style="color:var(--faint)">—</span>'}</td><td class="nw">${nVis[x.v] > 1 ? nVis[x.v] + '×' : ''}</td></tr>`).join('');
      const zerado = formularios.zeradoEm(f.id);
      return `<div class="sec-t">Últimas aberturas <small style="font-weight:600;color:var(--cinza)">(${log.length})</small></div>
      <div class="card">
        ${log.length ? `<div class="fm-tabw"><table class="fm-tab"><thead><tr><th>Quando</th><th>Quem</th><th>Aparelho</th><th>Origem</th><th>Vezes</th></tr></thead><tbody>${linhasLog}</tbody></table></div>${log.length > 100 ? '<p class="quando">Mostrando as 100 mais recentes.</p>' : ''}`
          : '<div class="vazio">Nenhuma abertura registrada ainda. A lista começa a partir desta versão do painel.</div>'}
        <p class="quando" style="margin:10px 0 0">Até 30/10/2026 a contagem era feita quando o servidor entregava a página — verificadores de link e prévias de alguns aplicativos entravam como aberturas, então os números antigos podem estar acima do real.${zerado ? ` Contagem zerada em ${esc(formularios.fmtQuando(zerado))}.` : ''} Se quiser começar do zero (as respostas ficam):</p>
        <div style="margin:8px 0 0"><button type="button" class="ui-btn sec perigo" onclick="fmZerar(this)">Zerar aberturas e pessoas</button></div>
      </div>
      <script>function fmZerar(b){ if(!confirm('Zerar aberturas, pessoas e origens deste formulário? As respostas NÃO são apagadas.')) return; b.disabled=true;
        fetch('/formularios/zerar-acessos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form:${JSON.stringify(f.id)}})})
          .then(function(r){return r.json();}).then(function(j){ if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui zerar.')); b.disabled=false; return; } location.reload(); })
          .catch(function(){ alert('❌ Erro de rede.'); b.disabled=false; }); }</script>`;
    })()}
  </div>
  <script>
  ${FM_JS_COPIAR}
  var busca=document.getElementById('busca');
  if(busca) busca.oninput=function(){ var q=busca.value.trim().toLowerCase(); [].forEach.call(document.querySelectorAll('#tb tr'),function(tr){ tr.hidden=!!q && tr.getAttribute('data-b').indexOf(q)<0; }); };
  function fmEtiquetar(camp, grupo, tagPadrao){
    var tag=prompt('Nome da tag para estas pessoas (vai para os Contatos):', tagPadrao); if(!tag) return;
    fetch('/formularios/etiquetar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form:${JSON.stringify(f.id)},camp:camp,grupo:grupo,tag:tag})})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui etiquetar.')); return; } alert('✅ '+j.n+' contato(s) com a tag “'+tag+'”. Para falar com eles: SoFIA → Campanhas → nova campanha para essa tag.'); })
      .catch(function(){ alert('❌ Erro de rede.'); });
  }
  function fmApagar(b){
    if(!confirm('Apagar a resposta de '+b.getAttribute('data-nome')+'? Não dá para desfazer.')) return;
    fetch('/formularios/resposta/excluir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form:${JSON.stringify(f.id)},id:b.getAttribute('data-id')})})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui apagar.')); return; } location.reload(); })
      .catch(function(){ alert('❌ Erro de rede.'); });
  }
  </script>`;
  return chrome({ tab: 'Respostas · ' + f.titulo }, 'formularios', corpo);
}

// Conta a abertura da página pública. A página avisa pelo navegador (POST
// /formulario/<endereço>/abriu, feito pelo JavaScript dela) — robôs de prévia de
// link (WhatsApp, Instagram…) e verificadores de segurança baixam a página mas não
// rodam JavaScript, então não contam. Também não contam: a equipe logada no painel
// e recarregar a página em menos de 2 minutos.
const FM_ROBO = /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|whatsapp|telegram|discord|skype|preview|embedly|curl|wget|python|node-fetch|headless/i;
function fmCookieVisitante(req, res) {
  let vid = lerCookie(req, 'fm_v');
  if (!/^[a-f0-9]{16}$/.test(vid || '')) {
    vid = crypto.randomBytes(8).toString('hex');
    res.setHeader('Set-Cookie', `fm_v=${vid}; Path=/formulario; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}${ehHttps(req) ? '; Secure' : ''}`);
  }
  return vid;
}
function fmContarAcesso(req, res, f, d) {
  try {
    if (usuarioDaReq(req)) return;
    const ua = String(req.headers['user-agent'] || '');
    if (FM_ROBO.test(ua)) return;
    const vid = fmCookieVisitante(req, res);
    if (formularios.aberturaRecente(f.id, vid, 120e3)) return;
    formularios.registrarAcesso(f.id, vid, String(d.origem || '').slice(0, 40), String(d.c || ''), ua); // c = código pessoal do link da campanha
  } catch (e) { console.log('[formularios] contador de acesso falhou:', e.message); }
}

// Página pública /formulario[/<endereço>] — sem login. Logado no painel e com o
// formulário pausado, mostra uma prévia (não grava).
function rotaFormularioPublico(req, res, rota) {
  const studio = scStudio();
  const partes = rota.split('/').filter(Boolean); // ['formulario', slug?, 'capa.jpg'?]
  if (partes.length === 3 && partes[2] === 'capa.jpg' && req.method === 'GET') {
    const f = formularios.porSlug(partes[1]);
    const p = f && f.capa ? formularios.capaPath(f.id) : null;
    if (!p) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('não encontrada'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' });
    return fs.createReadStream(p).pipe(res);
  }
  if (partes.length === 3 && partes[2] === 'abriu' && req.method === 'POST') {
    const f = formularios.porSlug(partes[1]);
    if (!f || !formularios.estaAberto(f)) { res.writeHead(204); return res.end(); }
    if (!formularios.permitir('fma:' + scIp(req), 120, 3600e3)) { res.writeHead(204); return res.end(); }
    return lerCorpo(req, 2000, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      fmContarAcesso(req, res, f, typeof d === 'object' ? d : {});
      res.writeHead(204); res.end();
    });
  }
  if (partes.length > 2) return scHtml(res, 404, formulariosPaginas.paginaFechada({ studio, f: null }));
  const f = partes[1] ? formularios.porSlug(partes[1]) : formularios.unicoAberto();
  if (req.method === 'GET') {
    if (!f) return scHtml(res, 404, formulariosPaginas.paginaFechada({ studio, f: null }));
    const capaUrl = f.capa ? `/formulario/${f.slug}/capa.jpg?v=${f.capaV || ''}` : '';
    let previa = '';
    if (!formularios.estaAberto(f)) {
      // Fechado: o público vê o aviso; quem está logado no painel vê a prévia (botão travado).
      const s = usuarioDaReq(req);
      if (!(s && (s.admin || (s.telas || []).includes('formularios')))) return scHtml(res, 200, formulariosPaginas.paginaFechada({ studio, f, capaUrl }));
      previa = formularios.situacao(f);
    }
    if (!previa) { try { if (!usuarioDaReq(req)) fmCookieVisitante(req, res); } catch (_) {} } // a abertura é contada pelo navegador (/abriu)
    return scHtml(res, 200, formulariosPaginas.paginaFormulario({ studio, f, previa, capaUrl, acao: '/formulario/' + f.slug }));
  }
  if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('method not allowed'); }
  if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido. Recarregue a página e tente de novo.' });
  if (!f || !formularios.estaAberto(f)) return scJson(res, 410, { erro: 'Este formulário não está recebendo respostas no momento.' });
  if (!formularios.permitir('fm:' + scIp(req), 20, 3600e3)) return scJson(res, 429, { erro: 'Muitos envios seguidos. Aguarde um pouco e tente de novo.' });
  return lerCorpo(req, 6e4, corpo => {
    let d = null; try { d = JSON.parse(corpo); } catch (_) {}
    if (!d || typeof d !== 'object') return scJson(res, 400, { erro: 'Envio inválido. Recarregue a página e tente de novo.' });
    if (d.site) return scJson(res, 200, { ok: true }); // campo invisível preenchido = robô; finge que deu certo
    let r;
    try { r = formularios.responder(f, d, { vid: lerCookie(req, 'fm_v'), codigo: d.c }); } catch (e) { console.log('[formularios] erro ao salvar resposta:', e.message); r = { erro: 'Não consegui salvar agora. Tente de novo em instantes.' }; }
    if (!r.ok) return scJson(res, 400, { erro: r.erro });
    if (f.tag) { try { contatos.adicionarTag(r.telefone, r.nome, f.tag); } catch (e) { console.log('[formularios] tag no contato falhou:', e.message); } }
    console.log(`[formularios] ${r.novo ? 'nova resposta' : 'resposta atualizada'} em "${f.titulo}"`);
    return scJson(res, 200, { ok: true, atualizada: !r.novo });
  });
}

// Rotas do painel (permissão "formularios" — barrada antes de chegar aqui).
function rotaFormulariosPainel(req, res, url, sess) {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const base = scBaseUrl(req);
  if (req.method === 'GET' && url === '/formularios') return scHtml(res, 200, paginaFormularios(base, ''));
  if (req.method === 'GET' && url === '/formularios/editar') {
    const id = q.get('id');
    const f = id ? formularios.obter(id) : null;
    if (id && !f) { res.writeHead(303, { Location: '/formularios' }); return res.end(); }
    let html = paginaFormularioEditar(base, f, !f && q.get('modelo') === 'blackfriday');
    if (q.get('ok') === '1') html = html.replace('<form id="fm"', '<div class="aviso">Formulário salvo.</div><form id="fm"');
    return scHtml(res, 200, html);
  }
  if (req.method === 'GET' && url === '/formularios/respostas') {
    const f = formularios.obter(q.get('id') || '');
    if (!f) { res.writeHead(303, { Location: '/formularios' }); return res.end(); }
    return scHtml(res, 200, paginaFormularioRespostas(base, f));
  }
  if (req.method === 'GET' && url === '/formularios/exportar') {
    const f = formularios.obter(q.get('id') || '');
    const csv = f ? formularios.csv(f.id) : null;
    if (!csv) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Formulário não encontrado.'); }
    try { auditoria.registrar(sess.usuario, 'formularios.exportar', f.titulo, ''); } catch (_) {}
    const nome = (formularios.normSlug(f.titulo) || 'formulario') + '-' + hojeSP() + '.csv';
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' });
    return res.end(csv);
  }
  if (req.method === 'POST' && url === '/formularios/salvar') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    return lerCorpo(req, 2e6, corpo => {
      let d = null; try { d = JSON.parse(corpo); } catch (_) {}
      if (!d || typeof d !== 'object') return scJson(res, 400, { erro: 'Envio inválido.' });
      let r;
      try { r = formularios.salvar(d, d.id || null, sess.usuario); } catch (e) { console.log('[formularios] erro ao salvar:', e.message); r = { erro: 'Não consegui salvar agora.' }; }
      if (!r.ok) return scJson(res, 400, { erro: r.erro });
      try { auditoria.registrar(sess.usuario, d.id ? 'formularios.editar' : 'formularios.criar', r.form.titulo, ''); } catch (_) {}
      return scJson(res, 200, { ok: true, id: r.form.id });
    });
  }
  if (req.method === 'POST' && url === '/formularios/acao') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    return lerCorpo(req, 1e4, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      const f = formularios.obter(String(d.id || ''));
      if (!f) return scJson(res, 404, { erro: 'Formulário não encontrado.' });
      const acao = String(d.acao || '');
      if (acao === 'pausar' || acao === 'abrir') {
        formularios.definirAtivo(f.id, acao === 'abrir');
        try { auditoria.registrar(sess.usuario, 'formularios.' + acao, f.titulo, ''); } catch (_) {}
        return scJson(res, 200, { ok: true });
      }
      if (acao === 'duplicar') {
        const r = formularios.duplicar(f.id, sess.usuario);
        if (!r.ok) return scJson(res, 400, { erro: r.erro });
        try { auditoria.registrar(sess.usuario, 'formularios.duplicar', f.titulo, ''); } catch (_) {}
        return scJson(res, 200, { ok: true, ir: '/formularios/editar?id=' + r.form.id });
      }
      if (acao === 'excluir') {
        const n = formularios.respostas(f.id).length;
        formularios.excluir(f.id);
        try { auditoria.registrar(sess.usuario, 'formularios.excluir', f.titulo, n + ' resposta(s)'); } catch (_) {}
        return scJson(res, 200, { ok: true });
      }
      return scJson(res, 400, { erro: 'Ação desconhecida.' });
    });
  }
  if (req.method === 'POST' && url === '/formularios/zerar-acessos') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    return lerCorpo(req, 1e4, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      const f = formularios.obter(String(d.form || ''));
      if (!f) return scJson(res, 404, { erro: 'Formulário não encontrado.' });
      formularios.zerarAcessos(f.id);
      try { auditoria.registrar(sess.usuario, 'formularios.zerar-acessos', f.titulo, ''); } catch (_) {}
      return scJson(res, 200, { ok: true });
    });
  }
  if (req.method === 'POST' && url === '/formularios/etiquetar') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    return lerCorpo(req, 1e4, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      const f = formularios.obter(String(d.form || ''));
      const tag = String(d.tag || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!f || !tag || !['abriu', 'naoabriu'].includes(d.grupo)) return scJson(res, 400, { erro: 'Pedido inválido.' });
      const cp = fmCampanhas(f, formularios.respostas(f.id)).find(c => String(c.id) === String(d.camp));
      if (!cp) return scJson(res, 404, { erro: 'Campanha não encontrada.' });
      let n = 0;
      for (const p of cp.lista) if (p.grupo === d.grupo) { try { contatos.adicionarTag(p.tel, p.nome, tag); n++; } catch (_) {} }
      try { auditoria.registrar(sess.usuario, 'formularios.etiquetar', f.titulo, `${tag} (${n})`); } catch (_) {}
      return scJson(res, 200, { ok: true, n });
    });
  }
  if (req.method === 'POST' && url === '/formularios/resposta/excluir') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    return lerCorpo(req, 1e4, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      const f = formularios.obter(String(d.form || ''));
      const r = f ? formularios.excluirResposta(f.id, String(d.id || '')) : null;
      if (!r) return scJson(res, 404, { erro: 'Resposta não encontrada.' });
      try { auditoria.registrar(sess.usuario, 'formularios.apagar-resposta', f.titulo, r.nome + ' ' + fmtTel(r.telefone)); } catch (_) {}
      return scJson(res, 200, { ok: true });
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado.');
}

module.exports = {
  fmLink, FM_CSS, FM_JS_COPIAR, paginaFormularios, paginaFormularioEditar, fmCodigosDoForm, fmCampanhas, paginaFormularioRespostas, FM_ROBO, fmCookieVisitante, fmContarAcesso, rotaFormularioPublico, rotaFormulariosPainel,
};

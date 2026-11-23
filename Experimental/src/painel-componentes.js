/**
 * painel-componentes.js — peças de tela reutilizáveis do padrão visual (.claude/rules/visual.md).
 *
 *   uiTabela(...)        lista com busca, ordenação, páginas, ⓘ por coluna e CARTÃO no celular
 *                        (nada rola para o lado: no celular cada linha vira um cartão).
 *   uiErroSalvar(msg, campo)
 *                        erro de salvamento vindo do servidor (formulário clássico, 303 + ?erro=)
 *                        → abre a JANELA de erro e marca o campo ao carregar a página.
 *   No navegador (em toda tela, via chrome()):
 *     sfErroSalvar(msg, { campo, form, titulo })  abre a janela e marca o campo;
 *     sfSalvou(json, form)                          true se {ok:true}; senão abre a janela
 *                                                   com json.erro e marca json.campo.
 *
 * CSS e script entram em toda tela pelo chrome() (painel-base.js). Não depende de
 * painel-base (evita require circular).
 */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const info = (html) => `<span class="info" tabindex="0">i<span class="info-pop">${html}</span></span>`;
// JSON seguro dentro de <script> (sem fechar a tag nem abrir comentário).
const jsonScript = (v) => JSON.stringify(v == null ? null : v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Tabela padrão.
 * colunas: [{ chave, titulo, info?, num?, ordenar? (padrão true), celular? }]
 *   celular: 'titulo' (vira o título do cartão), 'oculto' (só no computador) ou omitido (linha "rótulo: valor").
 * linhas:  [{ [chave]: valor | { html, valor } , _attrs?: 'atributos extras do <tr>' }]
 *   valor simples é escapado; { html } entra como está (use esc() em dado do usuário); valor = o que ordena.
 * opções: id, busca (texto do campo; false = sem busca), porPagina (20), vazio (texto), ordem: { chave, dir: 'asc'|'desc' }.
 */
function uiTabela({ id, colunas, linhas, busca = 'Buscar…', porPagina = 20, vazio = 'Nada por aqui ainda.', ordem } = {}) {
  colunas = colunas || []; linhas = linhas || [];
  const tid = esc(id || 'tb' + Math.random().toString(36).slice(2, 8));
  const ordenaveis = colunas.filter(c => c.ordenar !== false);
  const cel = (c, v) => {
    const o = (v && typeof v === 'object' && !Array.isArray(v)) ? v : { valor: v };
    const html = o.html != null ? String(o.html) : esc(o.valor == null || o.valor === '' ? '—' : o.valor);
    const val = o.valor != null ? o.valor : (o.html != null ? String(o.html).replace(/<[^>]*>/g, '') : '');
    const cls = [c.num ? 'num' : '', c.celular === 'titulo' ? 'tb-tit' : '', c.celular === 'oculto' ? 'tb-pc' : ''].filter(Boolean).join(' ');
    // rótulo da coluna (com o ⓘ) que só aparece no celular, quando a linha vira cartão
    const rot = c.celular === 'titulo' ? '' : `<span class="tb-rot">${esc(c.titulo)}${c.info ? ' ' + info(c.info) : ''}</span>`;
    return `<td data-k="${esc(c.chave)}" data-rot="${esc(c.titulo)}" data-v="${esc(val)}"${cls ? ` class="${cls}"` : ''}>${rot}${rot ? `<span class="tb-val">${html}</span>` : html}</td>`;
  };
  const cab = colunas.map(c => {
    const i = c.info ? ' ' + info(c.info) : ''; // ⓘ fora do botão: tocar nela não reordena
    const sort = ordem && ordem.chave === c.chave ? (ordem.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    return `<th scope="col" data-k="${esc(c.chave)}"${c.num ? ' class="num"' : ''}${c.ordenar !== false ? ` aria-sort="${sort}"` : ''}>${c.ordenar !== false ? `<button type="button" class="tb-ord">${esc(c.titulo)}<span class="tb-seta" aria-hidden="true"></span></button>` : esc(c.titulo)}${i}</th>`;
  }).join('');
  const corpo = linhas.map(l => `<tr data-l${l._attrs ? ' ' + l._attrs : ''}>${colunas.map(c => cel(c, l[c.chave])).join('')}</tr>`).join('');
  const selOrdem = ordenaveis.length ? `<label class="tb-cel-ordem"><span>Ordenar</span><select class="tb-ordem" aria-label="Ordenar por">${ordenaveis.map(c => `<option value="${esc(c.chave)}:asc">${esc(c.titulo)} ↑</option><option value="${esc(c.chave)}:desc">${esc(c.titulo)} ↓</option>`).join('')}</select></label>` : '';
  return `<div class="tb" id="${tid}" data-tb data-pp="${Math.max(1, parseInt(porPagina, 10) || 20)}"${ordem ? ` data-ordem="${esc(ordem.chave)}:${ordem.dir === 'desc' ? 'desc' : 'asc'}"` : ''}>
  ${busca !== false || selOrdem ? `<div class="tb-barra">${busca !== false ? `<input type="search" class="tb-q" placeholder="${esc(busca)}" aria-label="${esc(busca)}">` : ''}${selOrdem}<span class="tb-conta" aria-live="polite">${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}</span></div>` : ''}
  <table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
  <p class="tb-vazio"${linhas.length ? ' hidden' : ''}>${linhas.length ? 'Nada encontrado com essa busca.' : esc(vazio)}</p>
  <div class="tb-pag" hidden><button type="button" class="tb-ant">← Anterior</button><span class="tb-pg"></span><button type="button" class="tb-prox">Próxima →</button></div>
</div>`;
}

// Erro de salvamento vindo do servidor numa tela comum: abre a janela ao carregar.
function uiErroSalvar(msg, campo) {
  if (!msg) return '';
  return `<script>document.addEventListener('DOMContentLoaded',function(){window.sfErroSalvar(${jsonScript(String(msg))},{campo:${jsonScript(campo || '')}});});</script>`;
}

const CSS = `
  /* ── Tabela padrão (uiTabela) ── */
  .tb{display:flex;flex-direction:column;gap:10px;min-width:0}
  .tb-barra{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
  .tb-q{flex:1 1 220px;min-width:0;max-width:360px;padding:8px 10px;border:1px solid var(--linha);border-radius:8px;font:inherit;background:var(--card);color:var(--tinta)}
  .tb-conta{color:var(--cinza);font-size:var(--fs-sm);margin-left:auto}
  .tb-cel-ordem{display:none;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--cinza)}
  .tb-cel-ordem select{font:inherit;padding:6px 8px;border:1px solid var(--linha);border-radius:8px;background:var(--card);color:var(--tinta);max-width:60vw}
  .tb table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
  .tb th{text-align:left;font-weight:700;font-size:var(--fs-xs);color:var(--cinza);text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;border-bottom:1px solid var(--linha);vertical-align:bottom}
  .tb td{padding:10px 12px;border-bottom:1px solid var(--linha-soft);vertical-align:top;overflow-wrap:anywhere}
  .tb tbody tr:last-child td{border-bottom:0}
  .tb tbody tr:hover td{background:var(--linha-soft)}
  .tb [hidden],.tb tr[hidden]{display:none!important}
  .tb :is(th,td).num{text-align:right;font-variant-numeric:tabular-nums}
  .wrap .tb-rot{display:none}
  .tb-ord{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;text-transform:inherit;letter-spacing:inherit}
  .tb-ord:focus-visible{outline:2px solid var(--teal);outline-offset:2px;border-radius:4px}
  .tb-seta::after{content:'↕';opacity:.35;font-size:.9em}
  .tb th[aria-sort=ascending] .tb-seta::after{content:'↑';opacity:1;color:var(--teal-esc)}
  .tb th[aria-sort=descending] .tb-seta::after{content:'↓';opacity:1;color:var(--teal-esc)}
  .tb tbody tr.tb-destaque td{background:var(--teal-soft)}
  .tb-acao-form{display:inline;margin:0}
  .tb-acao-perigo{color:var(--erro)!important;padding:5px 12px;white-space:nowrap;text-decoration:none}
  .tb-vazio{margin:0;padding:12px;color:var(--cinza);text-align:center;font-size:var(--fs-sm)}
  .tb-pag{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .tb-pag button{font:inherit;font-size:var(--fs-sm);font-weight:600;padding:6px 12px;border:1px solid var(--linha);border-radius:8px;background:var(--card);color:var(--tinta);cursor:pointer}
  .tb-pag button:disabled{opacity:.4;cursor:default}
  .tb-pg{color:var(--cinza);font-size:var(--fs-sm)}
  @media(max-width:640px){
    .tb-cel-ordem{display:inline-flex}
    .tb thead{display:none}
    .tb table,.tb tbody,.tb tr,.tb td{display:block;width:100%}
    .tb tbody tr{border:1px solid var(--linha);border-radius:12px;padding:8px 12px;margin:0 0 8px;background:var(--card)}
    .tb tbody tr:hover td{background:transparent}
    .tb td{border:0;padding:3px 0;display:flex;justify-content:space-between;gap:12px;text-align:right}
    .tb td .tb-rot{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:48%;text-align:left;color:var(--cinza);font-size:var(--fs-xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding-top:2px}
    .tb td.tb-tit{display:block;text-align:left;font-weight:700;font-size:var(--fs-body);padding-bottom:6px}
    .tb td.tb-pc{display:none}
    .tb tbody tr.tb-destaque{background:var(--teal-soft)}
    .tb tbody tr.tb-destaque td{background:transparent}
  }
  /* ── Tabelas antigas do painel: no celular viram cartão sozinhas (sfCartoes) — VIS-02 ── */
  @media(max-width:640px){
    .wrap table.tb-auto thead{display:none}
    .wrap table.tb-auto,.wrap table.tb-auto tbody,.wrap table.tb-auto tr,.wrap table.tb-auto td{display:block;width:100%}
    .wrap table.tb-auto tbody tr{border:1px solid var(--linha);border-radius:12px;padding:8px 12px;margin:0 0 8px;background:var(--card)}
    .wrap table.tb-auto tbody tr:hover td{background:transparent}
    .wrap table.tb-auto td{border:0!important;padding:3px 0!important;display:flex;justify-content:space-between;align-items:baseline;gap:12px;text-align:right!important;overflow-wrap:anywhere}
    .wrap table.tb-auto td .tb-rot{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:48%;text-align:left;color:var(--cinza);font-size:var(--fs-xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
    .wrap :is(table.tb-auto,.tb) td .tb-val{min-width:0;text-align:right}
    .wrap table.tb-auto td:first-child{display:block;text-align:left!important;font-weight:700;font-size:var(--fs-body);padding-bottom:6px!important}
    .wrap table.tb-auto td.so-pc,.wrap table.tb-auto td[hidden]{display:none!important}
  }
  /* ── Campo com erro (sfErroSalvar) ── */
  .campo-erro{border-color:var(--erro)!important;box-shadow:0 0 0 3px var(--erro-bg)!important}
  .sf-erro-dlg h2{color:var(--erro)}
`;

const SCRIPT = `<script>(function(){
if(window.__sfComp)return;window.__sfComp=1;
function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();}
function escT(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function numero(s){var t=String(s).replace(/\\s/g,'');if(!/^-?[\\d.,]+%?$/.test(t))return null;t=t.replace('%','');if(t.indexOf(',')>=0)t=t.replace(/\\./g,'').replace(',','.');var n=parseFloat(t);return isNaN(n)?null:n;}
function iniciar(tb){
  if(tb.__ok)return;tb.__ok=1;
  var pp=+tb.getAttribute('data-pp')||20,pag=0,q='';
  var corpo=tb.querySelector('tbody'),linhas=[].slice.call(corpo.querySelectorAll('tr[data-l]'));
  var inp=tb.querySelector('.tb-q'),conta=tb.querySelector('.tb-conta'),pagEl=tb.querySelector('.tb-pag'),vazio=tb.querySelector('.tb-vazio'),sel=tb.querySelector('.tb-ordem');
  linhas.forEach(function(tr){var c=tr.cloneNode(true);[].forEach.call(c.querySelectorAll('.tb-rot'),function(x){x.remove();});tr.__t=norm(c.textContent);});
  function desenhar(){
    var v=linhas.filter(function(tr){return !q||tr.__t.indexOf(q)>=0;}),np=Math.max(1,Math.ceil(v.length/pp));
    if(pag>=np)pag=np-1;if(pag<0)pag=0;
    linhas.forEach(function(tr){tr.hidden=true;});
    v.forEach(function(tr,i){tr.hidden=!(i>=pag*pp&&i<(pag+1)*pp);});
    if(conta)conta.textContent=(q?v.length+' de '+linhas.length:linhas.length)+(linhas.length===1?' item':' itens');
    if(vazio&&linhas.length)vazio.hidden=v.length>0;
    if(pagEl){pagEl.hidden=np<=1;pagEl.querySelector('.tb-pg').textContent='Página '+(pag+1)+' de '+np;pagEl.querySelector('.tb-ant').disabled=pag<=0;pagEl.querySelector('.tb-prox').disabled=pag>=np-1;}
  }
  function ordenar(k,dir){
    linhas.sort(function(a,b){
      var x=a.querySelector('td[data-k="'+k+'"]'),y=b.querySelector('td[data-k="'+k+'"]');
      var vx=x?x.getAttribute('data-v'):'',vy=y?y.getAttribute('data-v'):'';
      var nx=numero(vx),ny=numero(vy),r;
      if(nx!==null&&ny!==null)r=nx-ny;else r=String(vx).localeCompare(String(vy),'pt-BR',{numeric:true,sensitivity:'base'});
      return dir==='desc'?-r:r;});
    linhas.forEach(function(tr){corpo.appendChild(tr);});
    [].forEach.call(tb.querySelectorAll('th[aria-sort]'),function(th){th.setAttribute('aria-sort',th.getAttribute('data-k')===k?(dir==='desc'?'descending':'ascending'):'none');});
    if(sel)sel.value=k+':'+dir;
    pag=0;desenhar();
  }
  if(inp)inp.addEventListener('input',function(){q=norm(inp.value.trim());pag=0;desenhar();});
  [].forEach.call(tb.querySelectorAll('th[aria-sort] .tb-ord'),function(b){b.addEventListener('click',function(){var th=b.closest('th');ordenar(th.getAttribute('data-k'),th.getAttribute('aria-sort')==='ascending'?'desc':'asc');});});
  if(sel)sel.addEventListener('change',function(){var p=sel.value.split(':');ordenar(p[0],p[1]);});
  if(pagEl){pagEl.querySelector('.tb-ant').addEventListener('click',function(){pag--;desenhar();});pagEl.querySelector('.tb-prox').addEventListener('click',function(){pag++;desenhar();});}
  var o=tb.getAttribute('data-ordem');if(o){var p=o.split(':');ordenar(p[0],p[1]);}else desenhar();
}
function todas(){[].forEach.call(document.querySelectorAll('[data-tb]'),iniciar);}
window.sfTabelas=todas;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',todas);else todas();
// Erro ao salvar: JANELA (não um aviso discreto) + campo marcado. Promise ao fechar.
window.sfErroSalvar=function(msg,o){return new Promise(function(fim){
  o=o||{};var c=o.campo,f=o.form||document;
  if(c&&typeof c==='string'){var nome=c;c=null;try{c=f.querySelector('[name="'+(window.CSS&&CSS.escape?CSS.escape(nome):nome)+'"]')||document.getElementById(nome);}catch(e){}}
  if(c&&c.classList){c.classList.add('campo-erro');c.setAttribute('aria-invalid','true');
    var tira=function(){c.classList.remove('campo-erro');c.removeAttribute('aria-invalid');c.removeEventListener('input',tira);c.removeEventListener('change',tira);};
    c.addEventListener('input',tira);c.addEventListener('change',tira);}
  var velho=document.getElementById('sfErroSalvar');if(velho)velho.parentNode.removeChild(velho);
  var ov=document.createElement('div');ov.className='ct-ov';ov.id='sfErroSalvar';ov.style.display='flex';ov.style.zIndex='210';
  ov.innerHTML='<div class="ct-dlg sf-erro-dlg" role="alertdialog" aria-modal="true" aria-labelledby="sfErroT" aria-describedby="sfErroM"><div class="ct-dh"><h2 id="sfErroT">'+escT(o.titulo||'⚠️ Não foi salvo')+'</h2></div>'
    +'<p id="sfErroM" style="margin:0 0 6px;line-height:1.5">'+escT(msg||'Não foi possível salvar. Tente de novo.')+'</p>'
    +(c?'<p class="quando" style="margin:0">O campo com problema está marcado em vermelho.</p>':'')
    +'<div style="display:flex;justify-content:flex-end;margin-top:14px"><button type="button" class="save" id="sfErroOk">Entendi</button></div></div>';
  document.body.appendChild(ov);
  function sai(){if(!ov.parentNode)return;ov.parentNode.removeChild(ov);if(c&&c.focus){try{c.scrollIntoView({block:'center'});}catch(e){}c.focus();}fim();}
  ov.querySelector('#sfErroOk').onclick=sai;ov.onclick=function(e){if(e.target===ov)sai();};
  ov.addEventListener('keydown',function(e){if(e.key==='Escape')sai();});
  setTimeout(function(){var b=ov.querySelector('#sfErroOk');if(b)b.focus();},30);
});};
// Tabelas antigas (sem uiTabela): cada célula ganha o rótulo da coluna, para o
// CSS do celular mostrar a linha como cartão. Vale também para tabela criada depois.
function cartoes(){[].forEach.call(document.querySelectorAll('.wrap table'),function(t){
  if(t.__cartao||t.closest('.tb')||t.classList.contains('ct-tab')||t.hasAttribute('data-sem-cartao'))return;
  var ths=t.querySelectorAll('thead th');if(!ths.length||!t.tBodies.length)return;t.__cartao=1;
  var rot=[].map.call(ths,function(th){var c=th.cloneNode(true);var inf=c.querySelector('.info');[].forEach.call(c.querySelectorAll('.info,.tb-seta,button.ct-fil'),function(x){x.remove();});return {t:c.textContent.replace(/\\s+/g,' ').trim(),i:inf?inf.outerHTML:''};});
  [].forEach.call(t.tBodies,function(tb){[].forEach.call(tb.rows,function(tr){var i=0;[].forEach.call(tr.cells,function(td,k){var r=rot[i]||{t:'',i:''};if(!td.hasAttribute('data-rot'))td.setAttribute('data-rot',r.t);
    if(k>0&&r.t&&!td.querySelector('.tb-rot')){var v=document.createElement('span');v.className='tb-val';while(td.firstChild)v.appendChild(td.firstChild);var s=document.createElement('span');s.className='tb-rot';s.innerHTML=escT(r.t)+(r.i?' '+r.i:'');td.appendChild(s);td.appendChild(v);}
    i+=td.colSpan||1;});});});
  t.classList.add('tb-auto');});}
window.sfCartoes=cartoes;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cartoes);else cartoes();
var agCart=0;try{new MutationObserver(function(){if(agCart)return;agCart=setTimeout(function(){agCart=0;cartoes();},60);}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
window.sfSalvou=function(j,form){if(j&&j.ok)return true;window.sfErroSalvar((j&&(j.erro||j.msg))||'Não foi possível salvar. Tente de novo.',{campo:j&&j.campo,form:form});return false;};
})();</script>`;

module.exports = { uiTabela, uiErroSalvar, CSS, SCRIPT, esc };

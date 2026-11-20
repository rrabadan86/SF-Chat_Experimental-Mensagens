/**
 * painel-notificacoes.js — o painel como app instalável e a tela "Notificações".
 *
 *   /manifest.webmanifest, /sw.js, /app-icone-*.png   públicos (o navegador os
 *       busca sem login; não carregam dado nenhum da unidade além do nome)
 *   /notificacoes                                     tela de cada usuário
 *
 * O envio e as inscrições ficam em push.js.
 */
const fs = require('fs');
const path = require('path');
const push = require('./push');
const config = require('./config');
const { uiTopo, esc, chrome, HEAD_APP } = require('./painel-base');

const COR = '#0e6e6b';
const ICONES = { 'icone-192.png': 1, 'icone-512.png': 1, 'icone-mask-512.png': 1, 'icone-180.png': 1, 'icone-selo-96.png': 1 };
// Ícone do app. Uma unidade pode trocar pelos seus colocando o arquivo de mesmo
// nome em data/app-icones/ (não vai para o git); senão vale o padrão do repositório.
function icone(nome) {
  if (!ICONES[nome]) return null;
  for (const dir of [path.resolve(__dirname, '..', 'data', 'app-icones'), path.join(__dirname, 'app-icones')]) {
    try { return fs.readFileSync(path.join(dir, nome)); } catch (_) {}
  }
  return null;
}

function manifesto() {
  const studio = String(config.STUDIO_NOME || '').trim();
  return JSON.stringify({
    name: studio ? `SlimFit · ${studio}` : 'SlimFit · painel',
    short_name: (studio.replace(/^(studio\s+)?slimfit\s*/i, '').trim() || 'SlimFit').slice(0, 12),
    description: 'Painel do Studio SlimFit',
    lang: 'pt-BR', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: COR, // fundo branco: é o do logo (tela de abertura do app)
    icons: [
      { src: '/app-icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icone-mask-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}

// Service worker: só mostra a notificação e abre o painel no toque. NÃO guarda
// página nenhuma em cache (o painel é sempre o do servidor).
const SW_JS = `// SlimFit — notificações do painel
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  var op = { body: d.corpo || '', icon: '/app-icone-192.png', badge: '/app-icone-selo-96.png', data: { url: d.url || '/' } };
  if (d.tag) { op.tag = d.tag; op.renotify = true; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'SlimFit', op));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  if (url.charAt(0) !== '/' || url.charAt(1) === '/') url = '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.navigate && c.focus) return c.navigate(url).then(function (n) { return (n || c).focus(); }).catch(function () { return self.clients.openWindow(url); });
    }
    return self.clients.openWindow(url);
  }));
});
`;

const fmtQuando = (ms) => { try { return ms ? new Date(Number(ms)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (_) { return ''; } };

function paginaNotificacoes(sess) {
  const tipos = push.tiposDe(sess);
  const meus = push.doUsuario(sess.usuario);
  const demo = require('./demo-guard').ativo;
  const caixas = tipos.map(t => `<label class="nt-tipo"><input type="checkbox" name="tipo" value="${t}"${push.TIPOS[t].padrao ? ' checked' : ''}><span><b>${esc(push.TIPOS[t].rot)}</b><small>${esc(push.TIPOS[t].sub)}</small></span></label>`).join('');
  const linhas = meus.map(a => `<div class="nt-ap" data-id="${esc(a.id)}" data-tipos="${esc(a.tipos.join(','))}">
      <div><b>${esc(a.aparelho || 'aparelho')}</b> <span class="nt-este" hidden>este aparelho</span>
        <div class="quando" style="margin:2px 0 0">${a.tipos.map(t => esc((push.TIPOS[t] || {}).rot || t)).join(' · ')}</div>
        <div class="quando" style="margin:2px 0 0">ativado em ${esc(fmtQuando(a.criadoEm))}${a.ultimoOk ? ` · último aviso entregue em ${esc(fmtQuando(a.ultimoOk))}` : ''}</div></div>
      <div class="nt-ap-btn"><button type="button" class="ui-btn sec" onclick="ntTeste('${esc(a.id)}',this)">Enviar teste</button><button type="button" class="ui-btn sec" onclick="ntRemover('${esc(a.id)}',this)">Remover</button></div>
    </div>`).join('');
  const corpo = `<div class="wrap">
    ${uiTopo({ titulo: 'Notificações', sub: 'Receba os avisos do painel no celular ou no computador, mesmo com o painel fechado. Cada aparelho é ativado separadamente.' })}
    ${demo ? '<div class="ui-nota"><span>Na demonstração dá para ver a tela, mas nenhuma notificação é enviada.</span></div>' : ''}
    <div class="sec-t" data-nosec>Neste aparelho</div>
    <div class="card">
      <p class="quando" style="margin:0 0 12px">Escolha <b>quais avisos</b> este aparelho recebe. A escolha é de cada aparelho: o celular pode receber só “pediu atendente” e o computador, tudo.</p>
      <div id="ntEstado" class="nt-estado">Verificando este aparelho…</div>
      <div id="ntIos" class="ui-nota" hidden><span>📱 No iPhone e no iPad as notificações só funcionam com o painel <b>instalado</b>: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Abra o painel pelo ícone novo e volte nesta tela.</span></div>
      <form id="ntForm" onsubmit="return false" hidden>
        <div class="nt-tipos">${caixas}</div>
        <div class="ui-linha" style="margin-top:14px">
          <button type="button" class="ui-btn" id="ntAtivar" onclick="ntAtivar(this)">🔔 Ativar notificações neste aparelho</button>
          <button type="button" class="ui-btn sec" id="ntDesativar" onclick="ntDesativar(this)" hidden>Desativar neste aparelho</button>
          <span id="ntMsg" class="quando" style="margin:0"></span>
        </div>
      </form>
    </div>
    <div class="sec-t" data-nosec>Instalar o painel</div>
    <div class="card">
      <div id="ntInstalado" hidden><b>✅ Você está usando o painel instalado.</b></div>
      <div id="ntInstalar">
        <div class="ui-linha"><button type="button" class="ui-btn" id="ntBtnInstalar" onclick="ntInstalar()" hidden>📲 Instalar o painel neste aparelho</button></div>
        <p class="quando" style="margin:10px 0 0"><b>Android (Chrome):</b> menu <b>⋮</b> → <b>Instalar app</b> (ou “Adicionar à tela inicial”). <b>iPhone (Safari):</b> <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. <b>Computador (Chrome ou Edge):</b> ícone de instalar na barra de endereço. O painel passa a abrir como um aplicativo, com ícone próprio.</p>
      </div>
    </div>
    <div class="sec-t" data-nosec>Seus aparelhos ativados</div>
    <div class="card">${linhas || '<div class="vazio">Nenhum aparelho ativado ainda.</div>'}
      <p class="quando" style="margin:12px 0 0">O aviso vai cifrado até o aparelho. Se você perder a permissão de uma tela, os avisos dela param de chegar.</p>
    </div>
  </div>
  <style>
    .wrap [hidden]{display:none!important}
    .nt-estado{font-weight:600;margin:0 0 12px}
    .nt-estado.ok{color:var(--ok)}.nt-estado.nao{color:var(--erro)}
    .nt-tipos{display:grid;gap:10px}
    .nt-tipo{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
    .nt-tipo input{margin-top:3px;flex:none;width:auto}
    .nt-tipo small{display:block;color:var(--cinza);font-weight:400;font-size:var(--fs-xs);margin-top:2px}
    .nt-ap{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--linha-soft)}
    .nt-ap:last-of-type{border-bottom:0}
    .nt-ap-btn{display:flex;gap:8px;flex-wrap:wrap}
    .nt-este{font-size:var(--fs-xs);font-weight:700;color:var(--teal-esc);background:var(--teal-soft);border-radius:99px;padding:2px 9px;margin-left:6px}
  </style>
  <script>
  (function(){
    var CHAVE=${JSON.stringify(push.chavePublica())}, DEMO=${demo ? 'true' : 'false'};
    var estado=document.getElementById('ntEstado'), form=document.getElementById('ntForm'), msg=document.getElementById('ntMsg');
    var bAtivar=document.getElementById('ntAtivar'), bDes=document.getElementById('ntDesativar');
    var instalado=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
    var ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
    var suporta=('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
    var meuId='', pedidoInstalar=null;
    function diz(t,cls){ estado.textContent=t; estado.className='nt-estado'+(cls?' '+cls:''); }
    function chaveBytes(s){ var p='='.repeat((4-s.length%4)%4), b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')), a=new Uint8Array(b.length); for(var i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a; }
    function idDe(endpoint){ return crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)).then(function(h){ return Array.prototype.map.call(new Uint8Array(h),function(x){return ('0'+x.toString(16)).slice(-2);}).join('').slice(0,16); }); }
    function post(url,obj){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(obj||{})}).then(function(r){ return r.json().catch(function(){ return {ok:false,erro:'resposta inesperada do painel ('+r.status+')'}; }); }); }
    function tiposMarcados(){ return Array.prototype.map.call(document.querySelectorAll('.nt-tipo input:checked'),function(i){return i.value;}); }
    function reg(){ return navigator.serviceWorker.register('/sw.js').then(function(){ return navigator.serviceWorker.ready; }); }

    // instalar
    if(instalado){ document.getElementById('ntInstalado').hidden=false; document.getElementById('ntInstalar').hidden=true; }
    window.addEventListener('beforeinstallprompt',function(e){ e.preventDefault(); pedidoInstalar=e; document.getElementById('ntBtnInstalar').hidden=false; });
    window.ntInstalar=function(){ if(!pedidoInstalar) return; pedidoInstalar.prompt(); pedidoInstalar=null; document.getElementById('ntBtnInstalar').hidden=true; };

    function pinta(sub){
      form.hidden=false;
      if(!sub){ meuId=''; bAtivar.hidden=false; bAtivar.textContent='🔔 Ativar notificações neste aparelho'; bDes.hidden=true; diz('As notificações estão desligadas neste aparelho.'); return; }
      idDe(sub.endpoint).then(function(id){
        meuId=id;
        var linha=document.querySelector('.nt-ap[data-id="'+id+'"]');
        if(linha){ linha.querySelector('.nt-este').hidden=false; bAtivar.textContent='Salvar a escolha dos avisos'; bDes.hidden=false; diz('✅ As notificações estão ligadas neste aparelho.','ok');
          var tem=(linha.getAttribute('data-tipos')||'').split(','); // mostra o que ESTE aparelho recebe hoje
          Array.prototype.forEach.call(document.querySelectorAll('.nt-tipo input'),function(i){ i.checked=tem.indexOf(i.value)>=0; }); }
        else { bAtivar.textContent='🔔 Ativar notificações neste aparelho'; bDes.hidden=true; diz('Este aparelho ainda não está ativado para o seu usuário.'); }
      });
    }
    function inicia(){
      if(!suporta){
        if(ios&&!instalado){ document.getElementById('ntIos').hidden=false; diz('Instale o painel na Tela de Início para ligar as notificações.'); }
        else diz('Este navegador não tem notificações. Use o Chrome, o Edge ou o Safari atualizados.','nao');
        return;
      }
      if(Notification.permission==='denied'){ diz('As notificações deste site estão bloqueadas no navegador. Libere nas configurações do site e recarregue a página.','nao'); return; }
      reg().then(function(r){ return r.pushManager.getSubscription(); }).then(pinta).catch(function(e){ diz('Não consegui preparar as notificações neste aparelho ('+(e&&e.message||e)+').','nao'); });
    }
    window.ntAtivar=function(b){
      var tipos=tiposMarcados(); if(!tipos.length){ msg.textContent='Marque pelo menos um tipo de aviso.'; return; }
      if(DEMO){ msg.textContent='Na demonstração as notificações não são ativadas.'; return; }
      b.disabled=true; msg.textContent='Ativando…';
      Notification.requestPermission().then(function(p){
        if(p!=='granted') throw new Error('você não permitiu as notificações');
        return reg();
      }).then(function(r){ return r.pushManager.getSubscription().then(function(s){ return s||r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:chaveBytes(CHAVE)}); }); })
      .then(function(s){ return post('/notificacoes/inscrever',{sub:s.toJSON(),tipos:tipos}); })
      .then(function(j){ if(!j.ok) throw new Error(j.erro||'não consegui ativar'); location.reload(); })
      .catch(function(e){ b.disabled=false; msg.textContent='⚠️ '+(e&&e.message||e); });
    };
    window.ntDesativar=function(b){
      b.disabled=true;
      reg().then(function(r){ return r.pushManager.getSubscription(); }).then(function(s){ return s?s.unsubscribe():true; })
      .then(function(){ return meuId?post('/notificacoes/remover',{id:meuId}):{ok:true}; })
      .then(function(){ location.reload(); }).catch(function(e){ b.disabled=false; msg.textContent='⚠️ '+(e&&e.message||e); });
    };
    window.ntTeste=function(id,b){
      var t=b.textContent; b.disabled=true; b.textContent='Enviando…';
      post('/notificacoes/teste',{id:id}).then(function(j){ b.disabled=false; b.textContent=j.ok?'✅ Enviado':'⚠️ '+(j.erro||'falhou'); setTimeout(function(){ b.textContent=t; },6000); });
    };
    window.ntRemover=function(id,b){
      b.disabled=true;
      var fim=function(){ post('/notificacoes/remover',{id:id}).then(function(){ location.reload(); }); };
      if(id===meuId&&suporta) reg().then(function(r){ return r.pushManager.getSubscription(); }).then(function(s){ return s?s.unsubscribe():true; }).then(fim,fim); else fim();
    };
    inicia();
  })();
  </script>`;
  return chrome({ tab: 'Notificações' }, 'notificacoes', corpo);
}

module.exports = { paginaNotificacoes, manifesto, SW_JS, icone, HEAD_APP, COR };

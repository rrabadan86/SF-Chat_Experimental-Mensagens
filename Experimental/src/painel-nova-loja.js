/**
 * painel-nova-loja.js — Perfis → 🏪 Nova loja (só admin): instalar uma loja nova pelo painel,
 * sem terminal. O trabalho fica em nova-loja.js (coordena), nova-loja-remoto.js (SSH) e
 * nova-loja-duckdns.js (endereço). Aqui só o HTML e o script da tela.
 */
const remoto = require('./nova-loja-remoto');
const duck = require('./nova-loja-duckdns');
const { esc, infoI } = require('./painel-base');

const FASES = {
  'painel': ['sd-warn', '⏳ Preparando'], 'instalando': ['sd-warn', '⏳ Instalando'], 'concluida': ['sd-ok', '✓ Concluída'],
  'parou': ['sd-erro', '✗ Parou'], 'nao-iniciada': ['sd-warn', 'Não iniciada'], 'sem-contato': ['sd-warn', 'Sem contato'],
};
function faseDe(est) {
  const p = (est && est.passos) || {};
  if (p.instalacao) return p.instalacao.ok ? 'concluida' : 'parou';
  if (p.lancada) return 'instalando';
  return 'nao-iniciada';
}

function campo(nome, rotulo, { tipo = 'text', valor = '', dica = '', ph = '', extra = '', obrig = false } = {}) {
  return `<div><label for="nl_${nome}">${rotulo}${dica ? ' ' + infoI(dica) : ''}</label>
    <input id="nl_${nome}" name="${nome}" type="${tipo}" value="${esc(valor)}"${ph ? ` placeholder="${esc(ph)}"` : ''}${obrig ? ' required' : ''} autocomplete="off" spellcheck="false" ${extra} style="width:100%"></div>`;
}

/** Conteúdo da sub-aba (dentro de paginaPerfis). `demo`: só mostra, não instala. */
function secaoNovaLoja({ demo = false } = {}) {
  const contas = duck.contas();
  const lista = remoto.listar();
  const linhaConta = (c) => `<div class="cfg-grid" style="margin-top:10px">
      ${campo(`nome${c.n}`, `Apelido da conta ${c.n}`, { valor: c.nome })}
      ${campo(`token${c.n}`, `Token da conta ${c.n}`, { tipo: 'password', ph: c.guardado ? '•••••••• (guardado)' : 'cole o token do duckdns.org', dica: 'É o código comprido que aparece no topo do site duckdns.org quando você entra, na linha "token". Fica guardado só neste servidor e nunca volta para a tela. Em branco: mantém o que já está guardado.' })}
    </div>`;
  const secDuck = `<details class="card"${contas.some((c) => c.guardado) ? '' : ' open'}>
      <summary class="sec-t" style="cursor:pointer">🌐 Contas do DuckDNS <small style="font-weight:400;color:var(--cinza)">— ${contas.filter((c) => c.guardado).length} de 2 com token guardado</small></summary>
      <form method="POST" action="/perfis/novaloja/duckdns" style="margin-top:6px">
        <p class="quando" style="margin:0">Cada conta grátis do DuckDNS aceita até 5 endereços. O endereço da loja nova você cria no site <b>duckdns.org</b> (botão "add domain"); aqui o painel aponta ele para o servidor novo.</p>
        ${contas.map(linhaConta).join('')}
        <div class="ui-linha" style="margin-top:12px"><button class="ui-btn" type="submit">Salvar contas</button></div>
      </form></details>`;

  const pill = (f) => { const [c, t] = FASES[f] || FASES['nao-iniciada']; return `<span class="sd-pill ${c}">${t}</span>`; };
  const secLista = lista.length ? `<div class="sec-t">Instalações</div>${lista.map((e) => `<div class="card" data-slug="${esc(e.slug)}">
      <div class="ui-linha"><b style="overflow-wrap:anywhere">${esc(e.studio || e.slug)}</b>${pill(faseDe(e))}</div>
      <p class="quando" style="margin:6px 0 0;overflow-wrap:anywhere">${esc(e.dominio || '')} · servidor ${esc(e.host || '')} · apelido ${esc(e.slug)}</p>
      <div class="ui-linha" style="margin-top:10px"><button type="button" class="ui-btn sec" onclick="nlVer('${esc(e.slug)}')">Ver andamento</button>
        ${faseDe(e) !== 'concluida' ? `<button type="button" class="ui-btn sec" onclick='nlContinuar(${esc(JSON.stringify(e.dados || {}))})'>Continuar daqui</button>` : `<a class="ui-btn sec" href="https://${esc(e.dominio)}" target="_blank" rel="noopener">Abrir o painel da loja ↗</a>`}</div>
    </div>`).join('')}` : '';

  const opcDuck = contas.map((c) => `<option value="${c.n}"${c.guardado ? '' : ' disabled'}>${esc(c.nome)}${c.guardado ? '' : ' (sem token)'}</option>`).join('') + '<option value="">Nenhuma — eu mesmo aponto o endereço</option>';
  const form = `<div class="sec-t">Instalar uma loja nova</div>
    <form id="nlForm" class="card" onsubmit="return nlEnviar(event)" autocomplete="off">
      ${demo ? '<p class="quando" style="margin:0 0 10px">🎭 Na demonstração esta tela só mostra como é — nada é instalado.</p>' : ''}
      <h3 class="nl-t" style="margin-top:0">1. Servidor (KVM)</h3>
      <div class="cfg-grid">
        ${campo('host', 'IP do servidor', { ph: '203.0.113.10', obrig: true, dica: 'Está no painel da Hostinger, em VPS → visão geral (IPv4).' })}
        ${campo('usuario', 'Usuário', { valor: 'root', obrig: true })}
        ${campo('senha', 'Senha do servidor', { tipo: 'password', dica: 'A senha root da KVM. Só é usada para entrar a primeira vez: o painel instala uma chave própria e esquece a senha (não é gravada). No "Continuar" não precisa.' })}
      </div>
      <label class="chk" style="margin:12px 0 0"><input type="checkbox" name="segundaLoja" value="1"> <span>Este servidor já tem uma loja (instalar a <b>segunda</b>, como Lago Sul 1 e 2)</span></label>
      <h3 class="nl-t">2. Loja</h3>
      <div class="cfg-grid">
        ${campo('studio', 'Nome da loja', { ph: 'Studio SlimFit Marista', obrig: true, dica: 'Como a aluna vê (formulário, mensagens).' })}
        ${campo('slug', 'Apelido', { ph: 'marista', obrig: true, dica: 'Curto, minúsculo, sem espaço nem acento. Vira o nome dos processos (marista-exp…) e das pastas.' })}
        ${campo('painelSenha', 'Senha do painel novo', { tipo: 'password', dica: 'Escolha a senha com que você vai entrar no painel da loja nova (usuário admin). Pelo menos 8 letras ou números. No "Continuar" pode deixar em branco.' })}
      </div>
      <h3 class="nl-t">3. Endereço do painel</h3>
      <div class="cfg-grid">
        <div><label for="nl_contaDuck">Conta do DuckDNS</label><select id="nl_contaDuck" name="contaDuck" style="width:100%">${opcDuck}</select></div>
        ${campo('endereco', 'Endereço', { ph: 'painel-marista', obrig: true, dica: 'Só o nome (fica nome.duckdns.org). Crie antes no duckdns.org, na conta escolhida.' })}
      </div>
      <h3 class="nl-t">4. EVO da loja</h3>
      <div class="cfg-grid">
        ${campo('evoUrl', 'Link do EVO', { ph: 'https://…/#/app/slimfit/22/…', obrig: true, dica: 'Abra o EVO da loja no navegador e copie o endereço da barra: o painel tira dali a rede e o número da unidade.' })}
        ${campo('evoDns', 'DNS da integração', { dica: 'EVO → Configurações → Integração (API). Pode deixar para depois.' })}
        ${campo('evoToken', 'Secret Key da integração', { tipo: 'password' })}
        ${campo('evoEmail', 'E-mail do robô no EVO', { ph: 'robo@loja.com.br' })}
        ${campo('evoSenha', 'Senha do robô no EVO', { tipo: 'password' })}
      </div>
      <h3 class="nl-t">5. SoFIA e equipe <small style="font-weight:400;color:var(--cinza)">— pode deixar para depois</small></h3>
      <div class="cfg-grid">
        ${campo('iaChave', 'Chave da IA (Anthropic)', { tipo: 'password', ph: 'sk-ant-…' })}
        ${campo('grupoEquipe', 'Grupo da equipe no WhatsApp', { ph: 'nome exato do grupo' })}
      </div>
      <p class="quando" style="margin:14px 0 0">🔒 Senhas e chaves vão direto para o servidor novo e <b>nunca voltam para a tela</b>. A instalação leva de 10 a 25 minutos e continua sozinha no servidor mesmo se você fechar esta tela.</p>
      <div class="ui-linha" style="margin-top:12px"><button class="ui-btn" type="submit" id="nlBotao"${demo ? ' disabled' : ''}>Instalar a loja</button></div>
    </form>
    <div id="nlAnd" class="card" hidden>
      <div class="ui-linha"><b id="nlTit">Andamento</b><span id="nlPill" class="sd-pill sd-warn">⏳</span></div>
      <ol id="nlPassos" class="quando" style="margin:10px 0 0;padding-left:20px"></ol>
      <div id="nlConf" hidden style="margin-top:12px"></div>
      <pre id="nlLog" style="margin:10px 0 0;max-height:360px;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem;background:var(--fundo,transparent);border:1px solid var(--linha);border-radius:10px;padding:10px"></pre>
    </div>`;

  const script = `<script>(function(){
  var vez=0,timer=null,FASES=${JSON.stringify(FASES)};
  function t(id){return document.getElementById(id);}
  window.nlEnviar=function(ev){ev.preventDefault();var f=t('nlForm');var o={};new FormData(f).forEach(function(v,k){o[k]=v;});
    t('nlBotao').disabled=true;
    fetch('/perfis/novaloja/iniciar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json();}).then(function(j){
      t('nlBotao').disabled=false; if(!window.sfSalvou(j,f))return;
      ['senha','evoToken','evoSenha','iaChave','painelSenha'].forEach(function(n){var c=f.elements[n];if(c)c.value='';});
      nlVer(j.slug);
    }).catch(function(){t('nlBotao').disabled=false;window.sfErroSalvar('Sem resposta do painel. Tente de novo.',{});});
    return false;};
  window.nlContinuar=function(d){var f=t('nlForm');Object.keys(d||{}).forEach(function(k){var c=f.elements[k==='dominio'?'endereco':k];if(!c)return;if(c.type==='checkbox')c.checked=!!d[k];else c.value=(k==='dominio'?String(d[k]).replace(/\\.duckdns\\.org$/,''):d[k]);});
    if(d.evoTenant)f.elements.evoUrl.value='/app/'+d.evoTenant+'/'+d.evoBranch+'/';f.scrollIntoView({behavior:'smooth'});};
  window.nlVer=function(slug){var a=t('nlAnd');a.hidden=false;a.scrollIntoView({behavior:'smooth'});vez++;var minha=vez;if(timer)clearTimeout(timer);
    (function puxa(){fetch('/perfis/novaloja/status?slug='+encodeURIComponent(slug)).then(function(r){return r.json();}).then(function(s){if(minha!==vez)return;mostra(s);
      var fim=s.fase==='concluida'||s.fase==='parou'||s.fase==='nao-iniciada';timer=setTimeout(puxa,fim?30000:3000);}).catch(function(){if(minha===vez)timer=setTimeout(puxa,5000);});})();};
  function mostra(s){if(!s.ok){t('nlLog').textContent=s.erro||'Erro.';return;}
    t('nlTit').textContent=(s.studio||s.slug)+(s.dominio?' — '+s.dominio:'');
    var f=FASES[s.fase]||['sd-warn',s.fase];t('nlPill').className='sd-pill '+f[0];t('nlPill').textContent=f[1];
    var p=s.passos||{},itens=[['conexao','Entrou no servidor'],['diagnostico','Servidor conferido'],['chave','Chave do painel instalada (senha esquecida)'],['lancada','Instalação iniciada'],['instalacao','Instalação concluída']];
    var ol=t('nlPassos');ol.textContent='';itens.forEach(function(i){var li=document.createElement('li');var x=p[i[0]];li.textContent=(x?(x.ok===false?'✗ ':'✓ '):'· ')+i[1];ol.appendChild(li);});
    var linhas=[].concat(s.painel?s.painel.linhas:[]);if(s.remoto)linhas=linhas.concat(['— no servidor —'],s.remoto.linhas);if(s.erro&&s.fase==='sem-contato')linhas.push('⚠️ '+s.erro);
    var cf=t('nlConf');cf.hidden=s.fase!=='concluida';if(!cf.hidden){cf.textContent='';var h=document.createElement('div');h.className='ui-linha';var b=document.createElement('b');b.textContent='🔎 Conferência da loja';h.appendChild(b);
      var bt=document.createElement('button');bt.type='button';bt.className='ui-btn sec';bt.textContent=s.conferindo?'Conferindo… (até 5 min)':'Conferir de novo';bt.disabled=!!s.conferindo;bt.onclick=function(){bt.disabled=true;bt.textContent='Conferindo… (até 5 min)';fetch('/perfis/novaloja/conferir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s.slug})});};h.appendChild(bt);cf.appendChild(h);
      var it=(s.conferencia&&s.conferencia.itens)||[];if(!it.length){var p0=document.createElement('p');p0.className='quando';p0.textContent=s.conferindo?'Conferindo o painel, o EVO, a IA e os processos da loja nova…':'Ainda não conferida.';cf.appendChild(p0);}
      var ul=document.createElement('ul');ul.style.cssText='margin:8px 0 0;padding-left:0;list-style:none';it.forEach(function(i){var li=document.createElement('li');li.style.cssText='margin:6px 0;overflow-wrap:anywhere';var bb=document.createElement('b');bb.textContent=(i.ok?'✅ ':'❌ ')+i.titulo;li.appendChild(bb);var sp=document.createElement('div');sp.className='quando';sp.textContent=i.detalhe;li.appendChild(sp);ul.appendChild(li);});cf.appendChild(ul);
      if(s.dominio){var lk=document.createElement('div');lk.className='ui-linha';lk.style.marginTop='10px';[['Abrir o painel da loja ↗','/'],['QR do robô ↗','/?view=config'],['QR da SoFIA ↗','/sofia?view=config']].forEach(function(x){var a=document.createElement('a');a.className='ui-btn sec';a.target='_blank';a.rel='noopener';a.href='https://'+s.dominio+x[1];a.textContent=x[0];lk.appendChild(a);});cf.appendChild(lk);
        var dica=document.createElement('p');dica.className='quando';dica.style.margin='8px 0 0';dica.textContent='Para entrar no painel da loja: usuário admin e a senha que você escolheu aqui. Escaneie primeiro o QR do robô (número do Studio) e depois o da SoFIA, com o aquecimento ligado.';cf.appendChild(dica);}}
    var pre=t('nlLog'),embaixo=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-20;pre.textContent=linhas.join('\\n');if(embaixo)pre.scrollTop=pre.scrollHeight;}
})();</script>`;

  const css = '<style>.nl-t{font-size:1rem;font-weight:800;margin:22px 0 10px}</style>';
  return `${css}${secDuck}${secLista}${form}${script}`;
}

module.exports = { secaoNovaLoja, faseDe, FASES };

/**
 * painel-instagram.js — tela do Instagram.
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const mensagens = require('./mensagens');
const horarios = require('./horarios');
const igcfg = require('./instagram-config');
const igApi = require('./instagram-api');
const igcookies = require('./instagram-cookies');
const {
  esc, lerJsonData, cardMensagem, blocoHorario, scriptPreviewTeste, chrome,
} = require('./painel-base');

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
        <p>O robô envia boas-vindas às novas seguidoras às <b>07:00</b>, no máximo <b>${limite}/dia</b>.</p></div>
      <div style="text-align:right;margin:-4px 0 0"><form method="POST" action="/instagram/toggle" style="display:inline"><input type="hidden" name="alvo" value="off"><button class="reset" type="submit" style="padding:4px 11px;font-size:var(--fs-xs)" onclick="return confirm('Pausar o envio de boas-vindas no Instagram?')">⏸️ Pausar Instagram</button></form></div>`
    : `<div class="wa-card warn"><div class="wa-ic">📸</div><h2>Instagram pausado</h2>
        <p>As boas-vindas automáticas estão <b>desligadas</b>. Ligue só com o proxy e os cookies configurados (senão a conta pode ser bloqueada).</p></div>
      <div style="text-align:right;margin:-4px 0 0"><form method="POST" action="/instagram/toggle" style="display:inline"><input type="hidden" name="alvo" value="on"><button class="save" type="submit" style="padding:4px 13px;font-size:var(--fs-xs)" onclick="return confirm('Ligar o envio de boas-vindas no Instagram?')">▶️ Ligar Instagram</button></form></div>`;

  // ── Card da integração OFICIAL (Graph API): comentário/DM → resposta ──────
  const igOf = igApi.status();
  const ofCfg = igApi.lerCfg();
  const ibRows = [0, 1, 2, 3].map(i => {
    const it = (ofCfg.iceBreakers || [])[i] || { pergunta: '', resposta: '' };
    return `<div style="border:1px solid var(--linha);border-radius:10px;padding:10px 12px;margin:8px 0">
        <input type="text" name="ib${i}_p" value="${esc(it.pergunta || '')}" maxlength="80" placeholder="Botão ${i + 1} — ex.: Quero minha aula grátis 💚" style="width:100%;font-weight:600">
        <textarea name="ib${i}_r" rows="2" placeholder="Resposta ao tocar neste botão — use {link}" style="width:100%;margin-top:6px">${esc(it.resposta || '')}</textarea>
      </div>`;
  }).join('');
  const oficialCard = `
    <div class="card" style="border-left:4px solid ${igOf.conta ? 'var(--ok)' : 'var(--cinza)'}">
      <h2 style="margin:0 0 4px">🤖 Instagram oficial (API da Meta) <span class="badge">recomendado</span></h2>
      <p class="quando" style="margin:0 0 10px">Responde sozinho quem <b>comenta uma palavra-chave</b> num post/reel ou manda <b>DM</b> — com o link do agendamento. Estável e sem risco de bloqueio (substitui o envio por cookie abaixo).</p>
      ${igOf.conta
        ? `<p class="quando" style="margin:0 0 12px;color:var(--ok);font-weight:600">✅ Conectado: <b>${esc(igOf.conta)}</b> · Página ${esc(igOf.pagina || '—')} · enviados hoje: <b>${igOf.enviadosHoje}</b></p>`
        : `<p class="quando" style="margin:0 0 12px;color:var(--cinza)">⏳ Ainda não conectado — defina as variáveis <code>IG_*</code> no <code>.env</code> e reinicie o painel.${igOf.verifyDefinido ? '' : ' (falta <code>IG_VERIFY_TOKEN</code>)'}</p>`}
      <form method="POST" action="/instagram/oficial/salvar">
        <label class="chk"><input type="checkbox" name="enabled" ${ofCfg.enabled ? 'checked' : ''}> <b>Ligado</b> — responder automaticamente</label>
        <label style="display:block;margin:14px 0 4px;font-weight:700;font-size:.85rem">Palavras-chave <span class="sub">— separadas por vírgula; deixe vazio para responder a qualquer comentário</span></label>
        <input type="text" name="palavras" value="${esc((ofCfg.palavras || []).join(', '))}" style="width:100%" placeholder="eu, quero, experimental">
        <label style="display:block;margin:14px 0 4px;font-weight:700;font-size:.85rem">Mensagem do DM <span class="sub">— use <code>{link}</code> onde entra o link do formulário</span></label>
        <textarea name="mensagem" rows="5" style="width:100%" spellcheck="true">${esc(ofCfg.mensagem || '')}</textarea>
        <label style="display:block;margin:14px 0 4px;font-weight:700;font-size:.85rem">Link do formulário <span class="sub">— para onde a lead é levada (agenda no EVO → SoFIA)</span></label>
        <input type="text" name="link" value="${esc(ofCfg.link || '')}" style="width:100%" placeholder="https://SEU-PAINEL.duckdns.org/agendamentoexperimental/?origem=instagram">
        <label class="chk" style="margin-top:12px"><input type="checkbox" name="responderDM" ${ofCfg.responderDM ? 'checked' : ''}> Também responder quem manda <b>DM direto</b> (janela de 24h)</label>
        <div style="margin-top:16px;border-top:1px dashed var(--linha);padding-top:12px">
          <label style="display:block;font-weight:700;font-size:.85rem;margin-bottom:2px">🎉 Botões de boas-vindas (Ice Breakers)</label>
          <p class="quando" style="margin:0 0 6px">Aparecem quando alguém <b>abre a conversa</b> pela 1ª vez. A pessoa toca num botão e recebe a resposta na hora. Até 4 — deixe em branco os que não quiser.</p>
          ${ibRows}
        </div>
        <div class="acts" style="margin-top:14px"><button type="submit" class="save">💾 Salvar Instagram oficial</button></div>
      </form>
      <form method="POST" action="/instagram/oficial/icebreakers" style="margin:10px 0 0">
        <button type="submit" class="tbtn" onclick="return confirm('Publicar os botões de boas-vindas na conta do Instagram?\\n\\nSalve as alterações antes. Só funciona com o app aprovado/\\'Ao vivo\\'.')">📤 Publicar botões no Instagram</button>
        <span class="sub" style="margin-left:8px">salve primeiro; publica na conta (vale quando o app estiver "Ao vivo")</span>
      </form>
    </div>`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${oficialCard}
    <div class="sec-t" style="margin-top:22px">Envio antigo por cookie <small style="font-weight:600;color:var(--cinza)">(será desativado — use o oficial acima)</small></div>
    ${statusCard}

    <div class="card" style="border-left:4px solid ${sessCor}">
      <p class="quando" style="margin:0 0 12px;font-size:.9rem">${sessTxt}</p>
      <button type="button" class="save" onclick="forcarIg()" id="btnForcarIg" style="padding:9px 16px">▶️ Enviar boas-vindas agora</button>
      <p class="quando" style="margin:8px 0 0">Dispara o envio <b>na hora</b> (não espera as 07:00) e <b>testa a sessão</b>: se ela tiver caído, a execução coleta 0 seguidoras e avisa aqui.</p>
      <p id="forcarIgMsg" class="quando" style="margin:10px 0 0;font-weight:700"></p>
    </div>

    <div class="sec-t">Sessão do Instagram (cookies)</div>
    <div class="card">
      <p class="quando" style="margin:0 0 10px">${ckTexto}</p>
      <form method="POST" action="/instagram/cookies">
        <label style="margin:0 0 4px">Cole o JSON dos cookies (Cookie-Editor → instagram.com logada → Export)</label>
        <textarea name="cookies" rows="4" spellcheck="false" placeholder='[{"name":"sessionid","value":"..."}, ... ]' style="font-family:ui-monospace,monospace;font-size:.85rem"></textarea>
        <div class="acts"><button type="submit" class="save" onclick="return confirm('Importar estes cookies do Instagram?')">Importar cookies</button></div>
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
    <div class="sec-t">Contas puladas (${puladasArr.length})</div>
    <div class="card">
      ${puladas || '<div class="vazio">Nenhuma conta na lista de indisponíveis.</div>'}
      ${puladasArr.length ? `<p class="quando" style="margin:10px 0 0">Contas privadas/restritas que deram "Mensagem Indisponível". Após ${maxTent} tentativas o robô para de tentar (não gastam as vagas do dia). Se uma delas abrir o perfil depois, recebe normalmente.</p>` : ''}
    </div>

    <div class="sec-t">Limite de envios por dia</div>
    <div class="card">
      <form method="POST" action="/instagram/limite" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div><label style="margin:0 0 4px">Máximo de DMs por dia</label><input type="number" name="max" min="1" max="100" value="${limite}" style="width:120px" required></div>
        <button type="submit" class="save">Salvar limite</button>
      </form>
      <p class="quando" style="margin:8px 0 0">Fonte: <b>${fonteMax === 'painel' ? 'painel' : '.env (IG_MAX_DIA)'}</b>. Recomendado começar baixo (4–5) e subir aos poucos. Vale já no próximo disparo — sem reiniciar.</p>
    </div>

    <div class="sec-t">Mensagem de boas-vindas</div>
    ${msgIg ? `<div class="card">${cardMensagem(msgIg, '/instagram', { ig: true })}</div>` : ''}

    <div class="sec-t">Horário do envio</div>
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
  return chrome({ tab: 'Instagram', h1: 'Instagram', p: 'Status, liga/desliga, limite, mensagem e horário — tudo do Instagram aqui.' }, 'ig', corpo);
}

module.exports = {
  paginaInstagram,
};

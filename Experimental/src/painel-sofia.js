/**
 * painel-sofia.js — telas da SoFIA (Conversas, Contatos, Tags, Campanhas, Configuração, Custo).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const fs = require('fs');
const path = require('path');
const horarios = require('./horarios');
const autoTagAlunas = require('./auto-tag-alunas');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const https = require('https');
const E = require('./painel-estado');
const {
  _pm2Slug, esc, subnavSofia, chrome, podeSofiaSub, uiTopo, hojeSP, uiTrilho, lerCompCfg, blocoHorario, infoI, PM2_SOFIA, uiChips, uiDatas, uiBarra, uiPessoa,
} = require('./painel-base');

const PM2_PAINEL = (process.env.PM2_APP_PAINEL || (_pm2Slug ? _pm2Slug + '-painel' : 'slimfit-painel')).trim();

// ── Cotação do dólar (US$ → R$) para mostrar o custo da IA em reais ──────────
// Busca a cotação atual numa API pública (awesomeapi), com cache em memória +
// arquivo e fallback. Não bloqueia a página: usa o valor em cache e atualiza
// em segundo plano quando fica velho. Guarda o último valor em data/ p/ o boot.
const COTACAO_FILE = path.resolve(__dirname, '..', 'data', 'cotacao-usd.json');
const COTACAO_TTL = 6 * 3600 * 1000;function atualizarCotacao() {
  return new Promise((resolve) => {
    try {
      const req = https.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', { timeout: 5000 }, (res) => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const o = JSON.parse(data); const v = parseFloat(o && o.USDBRL && o.USDBRL.bid);
            if (isFinite(v) && v > 0) {
              E._cotacao = { valor: v, em: Date.now(), fonte: 'awesomeapi' };
              try { fs.mkdirSync(path.dirname(COTACAO_FILE), { recursive: true }); fs.writeFileSync(COTACAO_FILE, JSON.stringify(E._cotacao)); } catch (_) {}
            }
          } catch (_) {}
          resolve(E._cotacao.valor);
        });
      });
      req.on('error', () => resolve(E._cotacao.valor));
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(E._cotacao.valor); });
    } catch (_) { resolve(E._cotacao.valor); }
  });
}
function cotacaoUSD() { if (Date.now() - E._cotacao.em > COTACAO_TTL) atualizarCotacao().catch(() => {}); return E._cotacao.valor; }
function cotacaoInfo() { return { valor: E._cotacao.valor, em: E._cotacao.em, fonte: E._cotacao.fonte }; }

// Limite de aulas experimentais por turma — editável na aba SoFIA → Configuração.
// Gravado em data/sofia-exp-limite.txt; o cálculo da grade (Python) lê este arquivo.
const EXP_LIM_FILE = path.join(__dirname, '..', 'data', 'sofia-exp-limite.txt');
function lerExpLimite() { try { const n = parseInt(String(fs.readFileSync(EXP_LIM_FILE, 'utf8')).trim(), 10); return (Number.isFinite(n) && n >= 0) ? n : null; } catch (_) { return null; } }

// Antecedência mínima (horas) para agendar a experimental em DIA ÚTIL — editável
// na aba SoFIA → Configuração. Gravado em data/sofia-antecedencia-horas.txt; a
// grade (Python) e a SoFIA (verificar_disponibilidade) leem este arquivo.
const ANTEC_FILE = path.join(__dirname, '..', 'data', 'sofia-antecedencia-horas.txt');
function lerAntecedenciaHoras() { try { const n = parseFloat(String(fs.readFileSync(ANTEC_FILE, 'utf8')).trim().replace(',', '.')); return (Number.isFinite(n) && n >= 0) ? n : null; } catch (_) { return null; } }

// Credenciais editáveis pelo painel (admin), na tela "Credenciais da unidade":
//  - ChatBot/.env: chave da IA (ANTHROPIC_API_KEY) e de transcrição (TRANSCRICAO_API_KEY).
//  - Experimental/.env: login do robô no EVO (EVO_EMAIL / EVO_PASSWORD).
// Quem consome (SoFIA, robô, formulário) lê o .env no BOOT — a troca vale após
// reiniciar o processo certo (SoFIA para as chaves; robô para o login do EVO).
const CHATBOT_ENV_FILE = path.resolve(__dirname, '..', '..', 'ChatBot', '.env');
const EXPERIMENTAL_ENV_FILE = path.resolve(__dirname, '..', '.env');
// Lê UMA variável de um .env (sem aspas). '' se não existir. Arquivo padrão: ChatBot/.env.
function lerEnvVar(nome, arq) {
  arq = arq || CHATBOT_ENV_FILE;
  try { const m = new RegExp('^' + nome + '=(.*)$', 'm').exec(fs.readFileSync(arq, 'utf8')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; } catch (_) { return ''; }
}
function lerApiKey() { return lerEnvVar('ANTHROPIC_API_KEY'); }
function lerTranscricaoKey() { return lerEnvVar('TRANSCRICAO_API_KEY'); }
// Descobre o provedor atual pela TRANSCRICAO_URL (Groq se a URL for da Groq;
// senão OpenAI, que é o padrão do código quando a URL está vazia).
function lerTranscricaoProvedor() {
  return /groq/i.test(lerEnvVar('TRANSCRICAO_URL') || '') ? 'groq' : 'openai';
}
// Login do robô no EVO (Experimental/.env). O e-mail é pré-preenchido; a senha
// nunca volta para a tela — grava só quando vem preenchida (em branco = mantém a
// atual). Consumido pelo robô/formulário no boot → reiniciar o robô para valer.
function lerEvoEmail() { return lerEnvVar('EVO_EMAIL', EXPERIMENTAL_ENV_FILE); }
function evoSenhaDefinida() { return !!lerEnvVar('EVO_PASSWORD', EXPERIMENTAL_ENV_FILE); }
// De quantos em quantos SEGUNDOS a aba Conversas se atualiza sozinha. Editável em
// SoFIA → Configuração → "Jeito de responder". Guardado em data/painel-refresh-seg.txt.
// Limitado a 3–60s (3s é o mínimo para não pesar). Padrão 4s.
const REFRESH_SEG_FILE = path.join(__dirname, '..', 'data', 'painel-refresh-seg.txt');
function lerRefreshSeg() {
  try { const n = parseInt(require('fs').readFileSync(REFRESH_SEG_FILE, 'utf8').trim(), 10); if (n >= 3 && n <= 60) return n; } catch (_) {}
  return 4;
}
// Variante de ALERTA: badge âmbar com "!" (não usa emoji, para renderizar igual
// em qualquer sistema) e o mesmo tooltip. Para riscos, ex.: suspensão do WhatsApp.
const avisoI = html => `<span class="info aviso" tabindex="0" aria-label="atenção">!<span class="info-pop">${html}</span></span>`;

// ── Página: Sofia (chatbot) — prompt, configs e conexão do WhatsApp dela ─────
function blocoSofiaWa() {
  const st = sofia.waStatus();
  const quando = st.atualizadoEm ? new Date(st.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
  if (st.estado === 'conectado') {
    return `<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da SoFIA conectado</h2><p>A SoFIA está no ar e responde as alunas neste número.</p></div>`;
  }
  if (st.estado === 'codigo' && st.codigo) {
    return `<div class="wa-card warn"><div class="wa-ic">🔑</div><h2>Conectar a SoFIA</h2>
      <p>No celular do número da SoFIA (WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>), use <b>um</b> destes:</p>
      <p style="margin:8px 0 2px"><b>1) Por código</b> — toque em <b>Conectar com número de telefone</b> e digite:</p>
      <div style="font-family:ui-monospace,monospace;font-size:2rem;font-weight:800;letter-spacing:.18em;text-align:center;margin:6px 0;user-select:all">${esc(st.codigo)}</div>
      ${st.qr ? `<p style="margin:10px 0 2px"><b>2) Por QR</b> — ou aponte a câmera para este código:</p><img class="qr" src="${esc(st.qr)}" alt="QR da SoFIA">` : ''}
      <p class="wa-hint">O código vale alguns minutos e se renova sozinho. Assim que conectar, vira “🤖 conectado”.</p></div>`;
  }
  if (st.estado === 'qr' && st.qr) {
    return `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da SoFIA</h2>
      <p>Este é o WhatsApp <b>da SoFIA</b> (número próprio, diferente do robô de mensagens). No celular do número da SoFIA: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR da SoFIA"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>`;
  }
  // Sem status publicado ainda (o listener da Sofia precisa gravar sofia-wa-status.json).
  return `<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da SoFIA — sem informação</h2>
    <p>Para o QR da SoFIA aparecer aqui, o processo dela precisa <b>publicar o estado</b> em <code>sofia-wa-status.json</code>. Enquanto isso não estiver ligado, conecte a SoFIA pelo terminal como de costume.</p>
    <p class="wa-upd">Última atualização: ${esc(quando)}</p></div>`;
}

// Aba Sofia → Conversas: inbox das conversas da Sofia (ler e, na Parte 2, responder).
function paginaSofiaConversas(aviso, erro, meuUsuario) {
  const tagsLista = contatos.tagsDistintas().map(t => t.tag);
  let sessaoHoras = 12; try { sessaoHoras = sofia.lerSessaoHoras(); } catch (_) {}
  let lockMinIni = 60; try { lockMinIni = sofia.lerHumanoLockMin(); } catch (_) {}
  let quietoCfg = { horas: 24, dias: 4 }; try { quietoCfg = sofia.lerQuietoCfg(); } catch (_) {}
  let pausaMinIni = 30; try { pausaMinIni = sofia.lerPausaMin(); } catch (_) {} // pausa (min) ao responder pelo celular da SoFIA
  const refreshMs = lerRefreshSeg() * 1000; // intervalo do auto-refresh da lista (config em "Jeito de responder")
  const corpo =`<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('conversas')}
    <div class="sec-t" id="conv-head" data-nosec="1">Conversas da SoFIA <span id="waTag" title="Situação do WhatsApp da SoFIA" style="display:inline-block;vertical-align:middle;margin:0 6px;border-radius:999px;padding:2px 10px;font-size:.7rem;font-weight:700;background:#eee;color:#7a7a7a">⚪ …</span><button type="button" id="btnReimport" onclick="reimportarHistorico()" title="Relê o WhatsApp e repovoa as conversas no painel (recupera trechos perdidos, ex.: após um reinício da SoFIA). Pesado — faça num momento calmo." style="float:right;vertical-align:middle;font-size:.74rem;font-weight:700;padding:5px 11px;border:1px solid var(--linha);border-radius:999px;background:#fff;color:var(--cinza);cursor:pointer">↻ Reimportar histórico</button></div>
    <style>
      .inbox-grid{display:grid;grid-template-columns:288px minmax(0,1fr);gap:14px;align-items:start}
      .inbox-grid>div{min-width:0}
      /* Coluna da esquerda: mesma altura do chat; a LISTA rola por dentro (não
         empurra a página nem desalinha as duas colunas no desktop). */
      .inbox-grid>div:first-child{display:flex;flex-direction:column;max-height:calc(100vh - 190px)}
      #convLista{flex:1 1 auto;overflow-y:auto;min-height:0}
      #convChat{display:flex;flex-direction:column;min-height:360px;max-height:calc(100vh - 190px)}
      @media(max-width:760px){ .inbox-grid{grid-template-columns:minmax(0,1fr);align-items:start} .inbox-grid>div:first-child{max-height:none} #convLista{flex:none;max-height:260px;overflow:auto} #convChat{min-height:60vh;max-height:80vh;max-height:80dvh} }
      /* ── Cartões de conversa (v2): avatar + nome/hora + chips ── */
      .cv-item{display:flex;gap:10px;align-items:flex-start;padding:8px 9px;border-radius:11px;cursor:pointer;position:relative;border:1px solid transparent;margin-bottom:3px}
      .cv-item:hover{background:#f2f5f5}
      .cv-item.on{background:#eff7f6;box-shadow:inset 0 0 0 1px #0e8e91}
      .cv-item.aten{border-left:4px solid #c0392b}
      .cv-av{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.82rem;position:relative}
      .cv-badge{position:absolute;right:-1px;bottom:-1px;width:13px;height:13px;border-radius:50%;background:#0e6e6b;border:2px solid var(--card,#fff)}
      .cv-b{flex:1;min-width:0}
      .cv-r1{display:flex;align-items:baseline;gap:8px}
      .cv-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.86rem}
      .cv-tm{margin-left:auto;flex:none;color:#9a97a0;font-size:.7rem;font-variant-numeric:tabular-nums}
      .cv-ph{color:#6b6870;font-size:.72rem;margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cv-chips{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:5px}
      .cv-dot{position:absolute;right:9px;top:11px;width:9px;height:9px;border-radius:50%;background:#0e6e6b;box-shadow:0 0 0 2px var(--card,#fff)}
      #convPag{border-top:1px solid var(--linha);padding-top:8px}
      .ch-av{flex:none;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:.9rem}
      .voltar-lista{display:none}
      /* Mobile: mostra a LISTA ou a CONVERSA (master-detail), não as duas ── item 5 ── */
      @media(max-width:760px){
        #convChat{display:none}
        body.ver-conversa #convLista-col{display:none}
        body.ver-conversa #convChat{display:flex}
        body.ver-conversa .voltar-lista{display:inline-flex}
        #convLista{max-height:calc(100dvh - 300px)}
        /* Cabeçalho da conversa: botões de ação descem pra 2ª linha e o nome+telefone
           ficam com a 1ª linha inteira (senão o nome sai como "Glória …"). */
        .chat-head{flex-wrap:wrap}
        .chat-head .chat-acts{flex-basis:100%;justify-content:flex-end;margin-top:5px}
        /* Com a conversa aberta, o título "Conversas da SoFIA…" só ocupa espaço. */
        body.ver-conversa #conv-head{display:none}
      }
      /* Separador de dia na lista de conversas — chip centralizado que "gruda" no topo */
      .convDiaSep{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:9px;margin:8px 2px 7px;pointer-events:none}
      .convDiaSep::before,.convDiaSep::after{content:"";height:1px;background:var(--linha,#e7e8ea);flex:1}
      .convDiaSep span{font-size:.66rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#0b7275;background:#e4efee;border-radius:999px;padding:3px 11px;white-space:nowrap;box-shadow:0 1px 2px rgba(16,24,40,.07)}
      .convDiaSep.hoje span{background:#0e8e91;color:#fff}
    </style>
    <div class="inbox-grid">
      <div id="convLista-col">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input type="search" id="convBusca" oninput="filtrarBusca(this.value)" placeholder="🔎 Buscar nome, telefone ou palavra" style="flex:1 1 auto;min-width:0;font-size:.82rem;padding:8px 10px;border:1px solid var(--linha);border-radius:9px">
          <select id="convFiltroTag" onchange="filtrarTag(this.value)" title="Filtrar por tag" style="flex:0 0 42px;width:42px;font-size:.82rem;padding:8px 2px"><option value="">🏷️</option><option value="__sem__">🏷️ Sem tag</option>${tagsLista.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
        </div>
        <details id="convFiltrosDet" class="filtros-det" ontoggle="try{localStorage.setItem('convFiltrosOpen', this.open?'1':'0')}catch(e){}">
          <summary class="filtros-sum"><span class="s-mais">⚙️ Mais filtros</span><span class="s-menos">⚙️ Menos filtros</span></summary>
          <div class="filtros-corpo">
            <label class="filtro-check"><input type="checkbox" id="convAtencao" onchange="filtrarAtencao(this)">🔴 <b>Pediram atendimento humano</b></label>
            <label class="filtro-check"><input type="checkbox" id="convQuieto" onchange="filtrarQuieto(this)">😴 Sem resposta há <b>${esc(String(quietoCfg.horas))}h+</b> <small>(${esc(String(quietoCfg.dias))}d)</small></label>
            <label class="filtro-check"><input type="checkbox" id="convRespondeu" onchange="filtrarRespondeu(this)">💬 <b>Cliente respondeu</b> <small>(interagiu, não só recebeu)</small></label>
            <div class="filtro-periodo">
              <span class="filtro-lbl">Conversaram no período</span>
              <div class="filtro-datas">
                <input type="date" id="convDataIni" onchange="filtrarData()" title="De (dia inicial)">
                <span class="ate">até</span>
                <input type="date" id="convDataFim" onchange="filtrarData()" title="Até (dia final)">
                <button type="button" onclick="limparData()" title="Limpar datas" class="reset filtro-limpar">🧹</button>
              </div>
            </div>
          </div>
        </details>
        <div id="convLista"></div>
        <div id="convPag" style="display:flex;flex-direction:column;align-items:stretch;gap:6px;margin-top:8px"></div>
      </div>
      <div id="convChat" class="card" style="min-width:0">Selecione uma conversa à esquerda.</div>
    </div>
  </div>
  <div id="ctIntModal" class="ct-ov" onclick="if(event.target===this)fecharInteracoes()">
    <div class="ct-dlg" style="max-width:600px">
      <div class="ct-dh"><h2>Interações</h2><button type="button" class="ct-x" onclick="fecharInteracoes()">×</button></div>
      <div id="ctIntHero" class="quando" style="margin:0 0 10px"></div>
      <div id="ctIntBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <div id="ctResModal" class="ct-ov" style="z-index:60" onclick="if(event.target===this)fecharResumo()">
    <div class="ct-dlg" style="max-width:460px">
      <div class="ct-dh"><h2>Resumo do atendimento</h2><button type="button" class="ct-x" onclick="fecharResumo()">×</button></div>
      <div id="ctResData" class="quando" style="margin:0 0 8px"></div>
      <div id="ctResBody" style="font-size:var(--fs-body);line-height:1.55;white-space:pre-wrap"></div>
    </div>
  </div>
<script>
  var selecionada=null, pagina=0, POR_PAGINA=10, ultimoData={}, ultimoRender={chave:null,n:-1,humano:null}, ultimoInboxHtml='', ncSel=[], rascunhos={}, fotoPend={}, tagFiltro='', buscaTexto='', quietoFiltro=false, atencaoFiltro=false, respondeuFiltro=false, tagEdAberto=false, agAberto=false, ncNome='', ncDirty=false, ncTodas=[];
  // Atalho vindo de Contatos: ?chat=<telefone> abre a conversa correspondente.
  var alvoChat=(new URLSearchParams(location.search).get('chat')||'').replace(/\\D/g,''), alvoAplicado=false;
  function mesmoTel(a,b){ a=String(a||'').replace(/\\D/g,''); b=String(b||'').replace(/\\D/g,''); if(!a||!b) return false; if(a===b) return true; var la=a.slice(-8), lb=b.slice(-8); return la.length===8 && la===lb; }
  // ── Interações (histórico de atendimentos) — mesmo do Contatos ─────────────
  var intSessoes=[];
  function fmtDataHora(ts){ try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+'h'; }catch(e){ return ''; } }
  function abrirInteracoes(tel){
    if(!tel) return;
    var c=ultimoData[tel]||{};
    document.getElementById('ctIntHero').textContent=((c.nome||'(sem nome)')+' · '+fmtTel(tel));
    document.getElementById('ctIntBody').innerHTML='<p class="quando">Carregando…</p>';
    document.getElementById('ctIntModal').style.display='flex';
    fetch('/sofia/contatos/interacoes?tel='+encodeURIComponent(tel),{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(j){ intSessoes=(j&&j.sessoes)||[]; renderInteracoes(); })
      .catch(function(){ document.getElementById('ctIntBody').innerHTML='<p class="quando">❌ Não consegui carregar agora.</p>'; });
  }
  function renderInteracoes(){
    var box=document.getElementById('ctIntBody');
    if(!intSessoes.length){ box.innerHTML='<p class="quando">Nenhuma interação registrada ainda. O histórico começa a contar a partir de agora — cada atendimento encerrado aparece aqui.</p>'; return; }
    var linhas=intSessoes.map(function(s,idx){
      var badge=s.status==='ativa'?'<span class="ct-badge ativa">Em andamento</span>':'<span class="ct-badge enc">Encerrado</span>';
      return '<tr><td>'+badge+'</td><td>'+fmtDataHora(s.inicioEm)+'</td><td style="color:var(--cinza)">'+(s.nMsgs||0)+' msg</td><td style="text-align:right"><button type="button" class="ct-ic" title="Ver resumo" onclick="verResumo('+idx+')">📄</button></td></tr>';
    }).join('');
    box.innerHTML='<div style="overflow-x:auto"><table class="ct-int-tab"><thead><tr><th>Status</th><th>Data</th><th>Trocas</th><th style="text-align:right">Resumo</th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      +'<p class="quando" style="margin:10px 0 0">Total de '+intSessoes.length+' interaç'+(intSessoes.length===1?'ão':'ões')+'.</p>';
  }
  function fecharInteracoes(){ document.getElementById('ctIntModal').style.display='none'; }
  function verResumo(idx){
    var s=intSessoes[idx]; if(!s) return;
    document.getElementById('ctResData').textContent=fmtDataHora(s.inicioEm);
    var body=document.getElementById('ctResBody');
    if(s.status==='ativa'){ body.innerHTML='<span class="quando">Este atendimento ainda está em andamento — o resumo é gerado quando a conversa encerra.</span>'; }
    else if(!s.resumoPronto){ body.innerHTML='<span class="quando">Resumo sendo gerado… abra de novo em instantes.</span>'; }
    else if(!s.resumo){ body.innerHTML='<span class="quando">Sem resumo para este atendimento (conversa muito curta ou sem conteúdo).</span>'; }
    else { body.textContent=s.resumo; }
    document.getElementById('ctResModal').style.display='flex';
  }
  function fecharResumo(){ document.getElementById('ctResModal').style.display='none'; }
  var TAGS_EXISTENTES = ${JSON.stringify(tagsLista)};
  var MEU_USUARIO = ${JSON.stringify(String(meuUsuario || ''))}; // quem está logado (atribuição + trava de atendimento)
  var LOCK_MIN = ${Math.max(1, parseInt(lockMinIni, 10) || 60)}; // minutos que uma conversa assumida fica travada p/ outros
  var LOCK_MS = LOCK_MIN*60000;
  var SESSAO_MS = ${Math.round(sessaoHoras * 3600 * 1000)};
  var QUIETO_MS = ${Math.round(quietoCfg.horas * 3600 * 1000)}, QUIETO_MAX_MS = ${Math.round(quietoCfg.dias * 24 * 3600 * 1000)};
  var PAUSA_MIN = ${Math.max(1, parseInt(pausaMinIni, 10) || 30)}; // pausa (min) quando respondem direto pelo celular da SoFIA
  function fmtPausa(min){ min=parseInt(min,10)||0; if(min<60) return min+' min'; var h=min/60; var s=Number.isInteger(h)?String(h):h.toFixed(1).replace(/\\.0$/,''); return s+(h===1?' hora':' horas'); }
  function encerrada(c){ return !!(c && (c.enc || (c.ultimaEm && (Date.now()-c.ultimaEm > SESSAO_MS)))); }
  // Também escapa aspas: o texto vai para atributos (title="…", value="…", href do
  // link) — sem isso, uma mensagem da lead com " fechava o atributo e injetava código.
  function escH(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  // URLs viram links clicáveis (abrem em nova aba). Escapa o HTML primeiro e só
  // então linca; tira a pontuação final (ex.: o ")" ou "." logo após o link) de
  // dentro do href. Vale para links que a SoFIA manda e para os que a aluna envia.
  function linkifica(s){
    return escH(s).replace(/(https?:\\/\\/[^\\s<]+)/g, function(u){
      var tail=''; var mm=u.match(/[.,)\\]!?;:]+$/);
      if(mm){ tail=mm[0]; u=u.slice(0,u.length-tail.length); }
      return '<a href="'+u+'" target="_blank" rel="noopener noreferrer" style="color:#1a73e8;text-decoration:underline;word-break:break-all">'+u+'</a>'+tail;
    });
  }
  function fmtHora(ts){ try{return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';} }
  // Separador de dia na lista (chip "gruda no topo"): agrupa por dia de São Paulo.
  function diaKeySP(ts){ try{ return new Date(ts).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}); }catch(e){ return ''; } }
  function rotuloDiaSep(ts){ var k=diaKeySP(ts); if(!k) return ''; var hoje=diaKeySP(Date.now()), ontem=diaKeySP(Date.now()-86400000); var base=k; try{ base=new Date(ts).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'short',day:'2-digit',month:'2-digit'}).replace('.',''); }catch(e){} if(k===hoje) return 'Hoje · '+base; if(k===ontem) return 'Ontem · '+base; return base; }
  function sepDiaHtml(ts){ var ehHoje=(diaKeySP(ts)===diaKeySP(Date.now())); return '<div class="convDiaSep'+(ehHoje?' hoje':'')+'"><span>'+escH(rotuloDiaSep(ts))+'</span></div>'; }
  // Rótulo de quem enviou. Para a aluna, usa o PRIMEIRO NOME do contato quando
  // conhecido (cai em "Aluna" se o contato não tiver nome cadastrado).
  function primeiroNome(nome){ var n=String(nome||'').trim(); if(!n) return ''; return n.split(/\\s+/)[0]; }
  // Rótulo de quem enviou. Para "humano", mostra o NOME do atendente que escreveu
  // (segurança: saber quem falou). Cai em "Atendente" se a mensagem for antiga/sem
  // autor (ex.: resposta enviada direto do celular do Studio).
  function autorRot(a, nomeAluna, por, tipo){ if(tipo==='anuncio') return '📣 Boas-vindas do anúncio'; return a==='aluna'?(nomeAluna||'Aluna'):(a==='humano'?(tipo==='wpp'?'📱 Direto pelo WhatsApp':(por?('🧑 '+por):'Atendente')):'SoFIA'); }
  function fmtTel(k){ var d=String(k||'').replace(/\\D/g,''); if(/^55\\d{10,11}$/.test(d)){ var ddd=d.slice(2,4), r=d.slice(4); return '+55 ('+ddd+') '+(r.length===9?r.slice(0,5)+'-'+r.slice(5):r.slice(0,4)+'-'+r.slice(4)); } return k; }
  // Só a hora (o dia já aparece no separador de dia da lista).
  function soHora(ts){ try{ return new Date(ts).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
  function fmtTelCurto(t){ var d=String(t||'').replace(/\D/g,'').replace(/^55/,''); return d.length===11?'('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7):(d.length===10?'('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6):d); }
  // Avatar: cor estável por contato + iniciais do nome (sem nome, os últimos 2 dígitos).
  function corAv(seed){ var s=String(seed||''); var h=0; for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; } var cores=['#e07a3f','#3f9e8f','#7b61c9','#c94f8a','#4a90d9','#5aa469','#d9873f','#5b8def','#c9695a','#2fa39b','#b3792f','#8a6cd1']; return cores[h%cores.length]; }
  function iniciais(nome,key){ var n=String(nome||'').trim(); if(n){ var p=n.split(/\\s+/).filter(Boolean); var a=(p[0]||'')[0]||''; var b=(p.length>1?(p[p.length-1][0]||''):''); return (a+b).toUpperCase(); } var d=String(key||'').replace(/\\D/g,''); return d?d.slice(-2):'?'; }
  function renderChat(c,k){
    var chat=document.getElementById('convChat'); if(!chat) return;
    var msgs=c.msgs||[];
    var nomeAluna=primeiroNome(c.nome); // rótulo das mensagens da aluna (primeiro nome do contato)
    // Divisória de SESSÃO: fica PERMANENTE no histórico entre uma conversa e a
    // seguinte. Aparece quando o intervalo entre duas mensagens passa do Tempo de
    // sessão (memória) OU quando houve encerramento manual (cadeado) entre elas.
    function divisorHtml(txt, cor, corLinha){ var c=cor||'#a15a5a', l=corLinha||'#e6cfcf'; return '<div style="display:flex;align-items:center;gap:10px;margin:16px 2px 8px;color:'+c+'"><span style="flex:1;height:1px;background:'+l+'"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap">'+txt+'</span><span style="flex:1;height:1px;background:'+l+'"></span></div>'; }
    // Marcador: resposta manual DIRETO pelo celular da SoFIA (dispara a pausa por tempo).
    function wppDivisor(){ return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#f0dcc2"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#b45309;background:var(--warn-bg);border-radius:999px;padding:2px 11px">📱 Resposta manual pelo WhatsApp · SoFIA pausada por '+fmtPausa(PAUSA_MIN)+' nesta conversa</span><span style="flex:1;height:1px;background:#f0dcc2"></span></div>'; }
    var encPorTxt=(c.encPor && String(c.encPor).trim())?escH(c.encPor):'';
    // A "nova conversa" após um encerramento começa na PRÓXIMA mensagem da aluna
    // depois do fechamento — não na resposta que a SoFIA ainda mandou de despedida.
    // Achamos esse índice para pôr a divisória no lugar certo (depois da despedida).
    var idxNova=-1;
    if(c.encEm){ for(var _j=0;_j<msgs.length;_j++){ if(msgs[_j].autor==='aluna' && (msgs[_j].em||0)>c.encEm){ idxNova=_j; break; } } }
    var itensMsg = msgs.map(function(m,i){
      var sep='';
      // Esta divisória cai na PRIMEIRA mensagem da aluna depois de um encerramento
      // manual — ou seja, é exatamente o instante em que a conversa foi REABERTA (a
      // aluna voltou a escrever e o cadeado saiu sozinho). Por isso ela marca a
      // REABERTURA (não o fechamento), lembrando por quem havia sido encerrada.
      if(i===idxNova) sep=divisorHtml('🔓 Conversa reaberta · a aluna voltou a escrever (encerrada antes '+(encPorTxt?'por '+encPorTxt:'manualmente')+')', '#1f7a52', '#cfe8db');
      else if(i>0){
        var ant=msgs[i-1];
        var gap=(m.em||0)-(ant.em||0);
        if(gap>SESSAO_MS) sep=divisorHtml('⏱️ Sessão encerrada automaticamente · nova conversa');
      }
      // Início de uma resposta manual pelo celular: marca a divisória (uma vez por
      // sequência, não em cada mensagem seguida) avisando que a SoFIA foi pausada.
      var ehWpp = (m.autor==='humano' && m.tipo==='wpp');
      if(ehWpp){ var pv=i>0?msgs[i-1]:null; if(!(pv && pv.autor==='humano' && pv.tipo==='wpp')) sep+=wppDivisor(); }
      var mine = (m.autor!=='aluna');
      var ehFup = (m.tipo==='followup');
      var ehAnuncio = (m.tipo==='anuncio');
      var bg = m.autor==='aluna'?'#f1f3f4':(m.autor==='humano'?(ehWpp?'#fff4e5':'#dff5e6'):(ehAnuncio?'#eaf1fb':(ehFup?'#fff4e5':'#e4efee')));
      var selo = ehFup ? ' <span style="display:inline-block;font-size:.6rem;font-weight:700;color:#b45309;background:var(--warn-bg);border-radius:6px;padding:1px 6px;margin-left:4px">↩︎ follow-up</span>'
               : (ehAnuncio ? ' <span style="display:inline-block;font-size:.6rem;font-weight:700;color:#1d4e89;background:#dceafc;border-radius:6px;padding:1px 6px;margin-left:4px">📣 anúncio</span>' : '');
      var img = m.foto ? '<img src="/sofia/humano-foto?arq='+encodeURIComponent(m.foto)+'" alt="foto enviada" style="display:block;max-width:100%;max-height:220px;border-radius:9px;margin:'+(m.texto?'6px 0 0':'2px 0 0')+';cursor:pointer" onclick="window.open(this.src,\\'_blank\\')">' : '';
      // Mensagem citada (quando ela usa o "responder" do WhatsApp): mostra um
      // bloco de citação acima do texto, como o próprio WhatsApp faz.
      var cit = m.citacao ? '<div style="border-left:3px solid #25a06b;background:rgba(0,0,0,.05);border-radius:6px;padding:4px 8px;margin:0 0 5px;font-size:.8rem;color:#555;white-space:pre-wrap;overflow-wrap:anywhere"><span style="font-size:.62rem;font-weight:700;color:#25a06b;display:block;margin-bottom:1px">↩︎ em resposta a</span>'+escH(m.citacao)+'</div>' : '';
      var corpoMsg = cit + (m.texto?'<div style="white-space:pre-wrap">'+linkifica(m.texto)+'</div>':'') + img;
      return {em:(m.em||0), html: sep+'<div style="display:flex;justify-content:'+(mine?'flex-end':'flex-start')+';margin:4px 0"><div style="max-width:82%;background:'+bg+';padding:8px 12px;border-radius:12px;overflow-wrap:anywhere"><div style="font-size:.68rem;font-weight:700;color:#888">'+escH(autorRot(m.autor, nomeAluna, m.por, m.tipo))+' · '+fmtHora(m.em)+selo+'</div>'+corpoMsg+'</div></div>'};
    });
    // Marcadores de controle humano (assumiu/devolveu) intercalados por horário.
    var MOTIVO_TAG={ia:'🧠 intenção detectada pela SoFIA', palavra:'🔑 palavra-chave', campanha:'💬 respondeu campanha', novo:'🆕 novo contato', mensagem:'💬 mandou mensagem', encerrou:'🔒 encerramento sem agendamento', agendou:'📅 agendou', humano:'🙋 atendimento humano'};
    function evtDivisor(e){
      var quem=e.por?escH(e.por):'';
      if(e.acao==='tag'){
        var manual=(e.motivo==='manual');
        var rem=(e.tacao==='remove');
        var verbo= rem ? 'Tag removida' : (manual ? 'Tag adicionada' : 'Tag aplicada');
        var suf = manual ? (e.por?(' por '+escH(e.por)):' à mão') : (' · '+(MOTIVO_TAG[e.motivo]||'automação'));
        var cor = rem ? '#a15a5a' : '#6b3fa0';    // remoção em tom avermelhado, aplicação em roxo
        var bg  = rem ? '#f7ecec' : '#f2eaf9';
        var ln  = rem ? '#e6cfcf' : '#e3d5ef';
        return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:'+ln+'"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:'+cor+';background:'+bg+';border-radius:999px;padding:2px 11px">🏷️ '+verbo+': "'+escH(e.tag)+'"'+suf+' · '+soHora(e.em)+'</span><span style="flex:1;height:1px;background:'+ln+'"></span></div>';
      }
      if(e.acao==='aviso'){
        var dst=fmtTelCurto(e.destino);
        if(e.ok) return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#f0dcc2"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#9a5b00;background:var(--warn-bg);border-radius:999px;padding:2px 11px">🔔 Recepção avisada'+(dst?' · '+escH(dst):'')+' · '+soHora(e.em)+'</span><span style="flex:1;height:1px;background:#f0dcc2"></span></div>';
        return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#e6cfcf"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#a12626;background:#f7ecec;border-radius:999px;padding:2px 11px" title="'+escH(e.erro||'')+'">⚠️ Aviso para a recepção não saiu'+(dst?' ('+escH(dst)+')':'')+' · '+soHora(e.em)+'</span><span style="flex:1;height:1px;background:#e6cfcf"></span></div>';
      }
      if(e.acao==='assumir') return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#cdeadd"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#1f7a4d;background:#e7f6ec;border-radius:999px;padding:2px 11px">🙋 Conversa assumida por '+(quem||'atendente')+'</span><span style="flex:1;height:1px;background:#cdeadd"></span></div>';
      // Fim do prazo de pausa da resposta manual pelo celular (computado por horário).
      if(e.acao==='wpp-fim'){
        if(e.ativo) return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#f0dcc2"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#b45309;background:var(--warn-bg);border-radius:999px;padding:2px 11px">⏳ SoFIA pausada até '+soHora(e.em)+' (resposta manual pelo WhatsApp)</span><span style="flex:1;height:1px;background:#f0dcc2"></span></div>';
        return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#cfe4e3"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#0b6f72;background:#e4efee;border-radius:999px;padding:2px 11px">🤖 Prazo da pausa terminou — SoFIA voltou a responder</span><span style="flex:1;height:1px;background:#cfe4e3"></span></div>';
      }
      return '<div style="display:flex;align-items:center;gap:10px;margin:14px 2px 8px"><span style="flex:1;height:1px;background:#cfe4e3"></span><span style="flex:none;font-size:.7rem;font-weight:700;white-space:nowrap;color:#0b6f72;background:#e4efee;border-radius:999px;padding:2px 11px">🤖 Devolvida à SoFIA'+(quem?' por '+quem:(e.auto?' — trava expirou':''))+'</span><span style="flex:1;height:1px;background:#cfe4e3"></span></div>';
    }
    // Prazo da pausa (resposta pelo celular): a SoFIA volta PAUSA_MIN min após a
    // ÚLTIMA resposta manual seguida. Marca "voltou" (se já passou) ou "pausada até"
    // (se ainda corre), intercalado por horário junto dos demais eventos.
    var pauseEvts=[];
    for(var wi=0; wi<msgs.length; wi++){
      var mw=msgs[wi];
      if(!(mw.autor==='humano' && mw.tipo==='wpp')) continue;
      var prox=msgs[wi+1];
      if(prox && prox.autor==='humano' && prox.tipo==='wpp') continue; // ainda no meio da sequência
      var endEm=(mw.em||0)+PAUSA_MIN*60000;
      pauseEvts.push({em:endEm, acao:'wpp-fim', ativo:(endEm>Date.now())});
    }
    var tagEvts=(c.tagLog||[]).map(function(t){return {em:(t.em||0), acao:'tag', tag:t.tag, motivo:t.motivo, por:t.por, tacao:t.acao};});
    var avisoEvts=(c.avisos||[]).map(function(a){return {em:(a.em||0), acao:'aviso', ok:a.ok, destino:a.destino, erro:a.erro};});
    var evts=(c.humanoLog||[]).concat(pauseEvts).concat(tagEvts).concat(avisoEvts).slice().sort(function(a,b){return (a.em||0)-(b.em||0);});
    var out=[], ei=0;
    for(var mi=0; mi<itensMsg.length; mi++){
      while(ei<evts.length && (evts[ei].em||0) <= itensMsg[mi].em){ out.push(evtDivisor(evts[ei])); ei++; }
      out.push(itensMsg[mi].html);
    }
    while(ei<evts.length){ out.push(evtDivisor(evts[ei])); ei++; }
    var bolhas = out.join('');
    // Dois jeitos de uma conversa estar "encerrada": (1) cadeado EXPLÍCITO — alguém
    // clicou 🔒 (encPor = perfil) ou uma automação de tag fechou (encPor = "SoFIA");
    // fica gravado no sofia-encerradas.json. (2) TEMPO DE SESSÃO — passou da janela
    // de memória sem mensagem nova; nada foi gravado, então NÃO é "manual". Antes o
    // rótulo caía em "manualmente" nos dois casos — agora cada um tem seu texto.
    var encExplicito = !!(c && c.enc);
    var fimTxt = encExplicito
      ? ('🔒 Encerrada '+(encPorTxt?'por '+encPorTxt:'manualmente')+' · a SoFIA recomeça do zero se a aluna voltar')
      : ('🕒 Sessão encerrada por inatividade (tempo de sessão) · a SoFIA recomeça do zero se a aluna voltar');
    var fim = encerrada(c) ? '<div style="text-align:center;margin:10px 0 2px"><span style="display:inline-block;background:#f3eaea;color:#a15a5a;border:1px solid #e6cfcf;border-radius:999px;padding:3px 12px;font-size:.72rem;font-weight:700">'+fimTxt+'</span></div>' : '';
    var hum = !!c.humano;                                   // alguém no controle AGORA (trava ativa)
    var donoMeu = hum && c.humanoPor===MEU_USUARIO;          // EU assumi
    var donoOutro = hum && !donoMeu;                         // outro atendente assumiu
    var donoTxt = c.humanoPor||'';
    var restaMin = (hum && c.humanoEm) ? Math.max(1, Math.ceil((c.humanoEm+LOCK_MS-Date.now())/60000)) : 0;
    // Cabeçalho enxuto: nome + telefone à esquerda, botão de controle (compacto) à direita.
    // 🧑 assumir · 🤖 devolver à SoFIA · 🔒 (bloqueado) quando OUTRO atendente assumiu.
    var pill = donoOutro
      ? '<button type="button" disabled title="Assumida por '+escH(donoTxt)+' — livre em ~'+restaMin+' min" style="padding:5px 10px;font-size:.9rem;white-space:nowrap;opacity:.55;cursor:not-allowed">🔒</button>'
      : '<button type="button" onclick="toggleHumano()" class="'+(donoMeu?'save':'reset')+'" title="'+(donoMeu?'Devolver à SoFIA (ela volta a responder)':'Assumir a conversa (você atende — trava por '+LOCK_MIN+' min)')+'" style="padding:5px 10px;font-size:.9rem;white-space:nowrap">'+(donoMeu?'🤖':'🧑')+'</button>';
    var btnInt='<button type="button" onclick="abrirInteracoes(selecionada)" class="reset" title="Interações" style="padding:5px 10px;font-size:.9rem;white-space:nowrap">📊</button>';
    var btnAgendar='<button type="button" onclick="toggleAgendar()" class="'+(agAberto?'save':'reset')+'" title="Agendar aula experimental no EVO (cadastra + marca, igual a SoFIA)" style="padding:5px 10px;font-size:.9rem;white-space:nowrap">📅</button>';
    var encM=!!c.enc; // encerrada AGORA (cadeado à mão / automático por tag)
    // Botão alternador: 🔒 encerra (a SoFIA recomeça do zero se a aluna voltar) ·
    // 🔓 reabre (tira o cadeado, a SoFIA volta a responder). A aluna voltando a
    // escrever também reabre sozinho — o 🔓 serve para reabrir na hora, sem esperar.
    var btnEnc = encM
      ? '<button type="button" onclick="reabrirConversa()" class="reset" title="Reabrir esta conversa (tira o cadeado 🔒 — a SoFIA volta a responder)" style="padding:5px 10px;font-size:.9rem;white-space:nowrap;color:#1c8f52">🔓</button>'
      : '<button type="button" onclick="encerrarConversa()" class="reset" title="Encerrar conversa agora (cadeado — a SoFIA recomeça do zero)" style="padding:5px 10px;font-size:.9rem;white-space:nowrap">🔒</button>';
    var bloq=!!c.bloq;
    var btnBloq='<button type="button" onclick="bloquearConversa()" class="reset" title="'+(bloq?'Desbloquear contato':'Bloquear contato (a SoFIA ignora)')+'" style="padding:5px 10px;font-size:.9rem;white-space:nowrap'+(bloq?';color:#1c8f52':'')+'">'+(bloq?'✅':'🚫')+'</button>';
    var selo=bloq?'<span title="Contato bloqueado" style="background:var(--erro-bg);color:#c0392b;border:1px solid #f0c8c4;border-radius:999px;padding:1px 8px;font-size:.66rem;font-weight:700;margin-left:6px">🚫 bloqueado</span>':'';
    var agSelo=c.agendou?'<span title="Aula experimental agendada" style="display:inline-flex;align-items:center;justify-content:center;font-size:1.05rem;margin-right:2px">📅</span>':'';
    var chAv='<div class="ch-av" style="background:'+corAv(c.nome||k)+'">'+escH(iniciais(c.nome,k))+'</div>';
    var btnVoltar='<button type="button" class="voltar-lista reset" onclick="voltarLista()" title="Voltar para a lista" style="padding:6px 10px;font-size:1rem;line-height:1;align-items:center">←</button>';
    var header='<div class="chat-head" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +btnVoltar+chAv
      +'<div style="flex:1 1 auto;min-width:0"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(c.nome||'(sem nome)')+selo+'</div><div class="quando" style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escH(fmtTel(k))+'</div></div>'
      +'<div class="chat-acts" style="display:flex;gap:6px;align-items:center;flex:none">'+agSelo+btnAgendar+btnInt+btnEnc+btnBloq+pill+'</div></div>';
    // Linha de tags recolhível — o editor completo só aparece ao clicar em "editar".
    var mini=function(t){return '<span style="display:inline-block;background:#eef7f7;color:#0e8e91;border-radius:999px;padding:1px 8px;font-size:.7rem;margin:0 4px 0 0">'+escH(t)+'</span>';};
    var resumo = ncSel.length ? ncSel.map(mini).join('') : '<span class="quando" style="margin:0">sem tags</span>';
    var tagLinha='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:.82rem">'
      +'🏷️ '+(tagEdAberto?'':resumo)
      +'<a href="javascript:void(0)" onclick="toggleTagEd()" class="quando" style="margin:0;text-decoration:underline">'+(tagEdAberto?'fechar':'editar')+'</a>'
      +((!tagEdAberto && ncDirty)?'<span style="color:#9a6b00;font-weight:700">⚠️ não salvo</span>':'')+'</div>';
    var editor = tagEdAberto ? ('<div style="margin:0 0 12px;padding:10px 12px;background:#fafafa;border:1px solid #eee;border-radius:10px">'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      +'<span class="quando" style="margin:0">Nome</span>'
      +'<input id="ncNome" value="'+escH(ncNome)+'" placeholder="nome do contato" oninput="ncNome=this.value;ncMarcaSujo()" style="flex:1;min-width:150px;font-size:.85rem">'
      +'</div>'
      +'<div class="quando" style="margin:0 0 4px">Tags <small>(marque as que se aplicam)</small></div>'
      +'<div id="ncTags" style="max-height:190px;overflow:auto;border:1px solid #eee;border-radius:8px;padding:6px 10px;background:#fff;margin-bottom:8px"></div>'
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      +'<input id="ncNovaTag" placeholder="criar nova tag" style="flex:1;min-width:150px;font-size:.85rem" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();ncAddNovaTag();}">'
      +'<button type="button" class="reset" style="padding:5px 12px" onclick="ncAddNovaTag()">+ criar</button>'
      +'</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      +'<button type="button" id="ncSalvar" class="save" style="padding:5px 12px" onclick="salvarContato(\\''+k+'\\')">💾 '+(c.salvo?'Salvar tags':'Salvar contato')+'</button>'
      +'<span id="ncMsg" class="quando" style="margin:0"></span>'
      +'</div></div>') : '';
    // Só o dono da trava escreve. Placeholder explica o porquê quando bloqueado.
    var podeEscrever = donoMeu;
    var phBloq = donoOutro ? ('🔒 '+ (donoTxt||'Outro atendente') +' está atendendo (livre em ~'+restaMin+' min)') : '🔒 Clique em “assumir” para responder';
    var bannerDono = donoOutro ? ('<div style="margin-top:8px;background:var(--warn-bg);color:#8a5a00;border:1px solid #f0d9a8;border-radius:8px;padding:6px 10px;font-size:.78rem;font-weight:600">🔒 Conversa assumida por '+escH(donoTxt||'outro atendente')+' — você não pode escrever agora (livre em ~'+restaMin+' min).</div>') : '';
    var composer='<div style="display:flex;gap:8px;margin-top:10px;align-items:flex-end">'
      +'<input type="file" id="msgFoto" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="msgFotoSel()">'
      +'<button type="button" id="msgClip" title="Anexar foto" onclick="msgAbreFoto()" '+(podeEscrever?'':'disabled')+' style="padding:9px 12px;font-size:1.05rem;line-height:1;background:#fff;border:1px solid var(--linha,#ddd);border-radius:8px;cursor:pointer'+(podeEscrever?'':';opacity:.4;cursor:not-allowed')+'">📎</button>'
      +'<textarea id="msgTxt" rows="2" '+(podeEscrever?'':'disabled')+' placeholder="'+(podeEscrever?'Escreva uma mensagem…  (Enter envia)':phBloq)+'" oninput="if(selecionada)rascunhos[selecionada]=this.value" onkeydown="msgKey(event)" style="flex:1;resize:vertical;min-height:44px;font-size:.9rem'+(podeEscrever?'':';background:#f5f5f5;color:#aaa;cursor:not-allowed')+'"></textarea>'
      +'<button type="button" class="save" onclick="enviarMsg()" '+(podeEscrever?'':'disabled')+' style="padding:9px 16px;white-space:nowrap'+(podeEscrever?'':';opacity:.4;cursor:not-allowed')+'">Enviar ➤</button>'
      +'</div>'+bannerDono
      +'<div id="msgFotoPrev" style="display:none;margin-top:6px;align-items:center;gap:8px">'
      +'<img id="msgFotoImg" alt="prévia" style="max-width:64px;max-height:64px;border-radius:8px;border:1px solid var(--linha,#ddd);vertical-align:middle">'
      +'<span class="quando" style="margin:0">foto anexada</span> '
      +'<a href="javascript:void(0)" onclick="msgFotoLimpa()" class="quando" style="margin:0;text-decoration:underline">remover</a></div>'
      +'<div id="msgStatus" class="quando" style="margin-top:4px;min-height:14px;font-size:.75rem"></div>';
    var agBox = agAberto ? ('<div style="margin:0 0 12px;padding:12px;background:#f4fbfb;border:1px solid #cfe8e7;border-radius:10px">'
      +'<div style="font-weight:700;font-size:.9rem;margin-bottom:8px">📅 Agendar aula experimental no EVO</div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="agNome" placeholder="Nome completo" value="'+escH(c.nome||'')+'" style="flex:1 1 180px;min-width:0;font-size:.85rem"><input id="agEmail" type="email" placeholder="E-mail" style="flex:1 1 180px;min-width:0;font-size:.85rem"></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center"><input id="agData" type="date" style="font-size:.85rem"><input id="agHora" type="time" step="900" style="font-size:.85rem"><button type="button" class="save" onclick="enviarAgendamento()" style="padding:7px 14px">Agendar no EVO</button><a href="javascript:void(0)" onclick="toggleAgendar()" class="quando" style="margin:0;text-decoration:underline">cancelar</a></div>'
      +'<div id="agMsg" class="quando" style="margin:8px 0 0;min-height:16px"></div>'
      +'<p class="quando" style="margin:6px 0 0">Cadastra e marca no EVO, igual a SoFIA. Turma cheia → mostra alternativas.</p></div>') : '';
    chat.innerHTML = header+tagLinha+editor+agBox+'<div id="bolhas" style="flex:1;min-height:120px;overflow:auto;padding-right:4px">'+bolhas+fim+'</div>'+composer;
    if(tagEdAberto){ ncRenderTags(); ncAtualizaStatus(); }
    var ta=document.getElementById('msgTxt'); if(ta) ta.value=rascunhos[k]||'';
    msgFotoMostra(k); // reexibe a prévia se havia foto anexada nessa conversa
    var b=document.getElementById('bolhas'); if(b) b.scrollTop=b.scrollHeight;
  }
  function toggleTagEd(){ tagEdAberto=!tagEdAberto; if(selecionada){ ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[selecionada],selecionada); } }
  function toggleAgendar(){ agAberto=!agAberto; if(selecionada){ ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[selecionada],selecionada); } }
  function agDupSobrescrever(){ enviarAgendamento('sobrescrever'); }
  function agDupNovo(){ enviarAgendamento('novo'); }
  function enviarAgendamento(acaoDup){
    acaoDup=(acaoDup==='sobrescrever'||acaoDup==='novo')?acaoDup:'';
    var k=selecionada; if(!k) return;
    var nome=(document.getElementById('agNome').value||'').trim();
    var email=(document.getElementById('agEmail').value||'').trim();
    var data=(document.getElementById('agData').value||'').trim();
    var hora=(document.getElementById('agHora').value||'').trim();
    var st=document.getElementById('agMsg');
    if(!nome||!email||!data||!hora){ if(st)st.textContent='Preencha nome, e-mail, data e horário.'; return; }
    var when=data+' '+hora; // AAAA-MM-DD HH:MM (o EVO/form entende)
    if(st)st.innerHTML=acaoDup==='novo'?'⏳ Criando um cadastro novo…':(acaoDup==='sobrescrever'?'⏳ Atualizando o cadastro existente…':'⏳ Agendando no EVO…');
    fetch('/sofia/agendar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,nome:nome,email:email,when:when,origem:'painel',acao_duplicado:acaoDup})})
      .then(function(r){return r.json();}).then(function(j){
        if(!j||!j.ok||!j.id){ if(st)st.textContent='❌ '+((j&&j.erro)||'falha ao enviar'); return; }
        var n=0;
        (function poll(){
          n++;
          fetch('/sofia/agendar/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
            var res=s&&s.res;
            if(!res){ if(n>40){ if(st)st.textContent='⏳ Ainda processando… confira em instantes.'; return; } setTimeout(poll,1500); return; }
            if(res.ok){ if(st)st.innerHTML='✅ Agendada no EVO para <b>'+escH(res.when||when)+'</b>!'; setTimeout(function(){ agAberto=false; if(selecionada){ ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[selecionada],selecionada); } },2000); }
            else if(res.duplicado){
              var ex=res.existente||{};
              var quem=escH(ex.nome||'(sem nome)');
              var contato=ex.telefone?(' · '+escH(String(ex.telefone))):'';
              if(st)st.innerHTML='⚠️ Já existe um cadastro com <b>este telefone</b> em nome de <b>'+quem+'</b>'+contato+'.<br>É a <b>mesma pessoa</b> (atualizar) ou <b>outra pessoa</b> — ex.: mãe e filha (criar novo)?'
                +'<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
                +'<button type="button" onclick="agDupSobrescrever()" style="padding:8px 12px;border-radius:9px;border:1px solid var(--linha);background:var(--verde);color:#fff;cursor:pointer">Mesma pessoa — atualizar</button>'
                +'<button type="button" onclick="agDupNovo()" style="padding:8px 12px;border-radius:9px;border:1px solid var(--linha);background:#8a6100;color:#fff;cursor:pointer">Outra pessoa — criar novo</button>'
                +'</div>';
            }
            else if(res.lotada){ if(st){ var mr=(String(res.motivo||'').match(/^Turma de .*?\\d{1,2}:\\d{2}\\s*:\\s*([^.]+)/)||[])[1]||''; st.innerHTML='⚠️ Não deu para agendar nesse horário'+(mr?': <b>'+escH(mr)+'</b>.':' (turma cheia).')+'<br>Horários com vaga: '+(escH((res.alternativas||[]).join('  ·  '))||'nenhum encontrado na semana')+'.'; } }
            else { if(st)st.textContent=(/no sessions for this activity/i.test(String(res.detalhe||''))?'❌ O EVO não deixou matricular: esse horário é de outra atividade (ex.: Circuito Slim) — a aula experimental só vale para as turmas do SlimFit. Escolha outro horário.':'❌ Não consegui agendar: '+(res.detalhe||'erro no EVO')); }
          }).catch(function(){ if(n>40){ if(st)st.textContent='❌ erro de rede'; return; } setTimeout(poll,1500); });
        })();
      }).catch(function(){ if(st)st.textContent='❌ erro de rede'; });
  }
  function toggleHumano(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{};
    // Se OUTRO atendente é o dono (trava ativa), nem tenta — o servidor recusaria.
    if(c.humano && c.humanoPor!==MEU_USUARIO){ alert('🔒 Conversa assumida por '+(c.humanoPor||'outro atendente')+'. Você não pode assumir nem devolver agora.'); return; }
    var novo=!c.humano;
    fetch('/sofia/humano',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k]){ ultimoData[k].humano=novo; ultimoData[k].humanoPor=novo?(j.por||MEU_USUARIO):''; ultimoData[k].humanoEm=novo?Date.now():0; } ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[k],k); } else { alert(j.erro||'Não consegui atualizar o controle da conversa.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function bloquearConversa(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; var novo=!c.bloq;
    if(novo && !confirm('Bloquear este contato? A SoFIA vai IGNORAR por completo as mensagens dele (não responde, não registra).')) return;
    fetch('/sofia/contatos/bloquear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:k,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k])ultimoData[k].bloq=novo; ultimoRender={chave:null,n:-1,humano:null}; renderChat(ultimoData[k],k); } else { alert(j.erro||'Não consegui atualizar o bloqueio.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function encerrarConversa(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; if(c.enc) return; // já encerrada
    if(!confirm('Encerrar esta conversa agora?\\n\\nAparece o cadeado 🔒, a SoFIA recomeça do zero se a aluna voltar a escrever e o follow-up deixa de incomodar este contato.')) return;
    fetch('/sofia/conversas/encerrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k])ultimoData[k].enc=true; ultimoRender={chave:null,n:-1,humano:null}; renderInbox(ultimoData); } else { alert(j.erro||'Não consegui encerrar a conversa.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function reabrirConversa(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; if(!c.enc) return; // não está encerrada
    if(!confirm('Reabrir esta conversa?\\n\\nTira o cadeado 🔒 e a SoFIA volta a responder normalmente este contato.')) return;
    fetch('/sofia/conversas/encerrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,ativo:false})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k]){ ultimoData[k].enc=false; ultimoData[k].encEm=0; ultimoData[k].encPor=''; } ultimoRender={chave:null,n:-1,humano:null}; renderInbox(ultimoData); } else { alert(j.erro||'Não consegui reabrir a conversa.'); } })
      .catch(function(){ alert('Erro de rede.'); });
  }
  function msgKey(ev){ if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); enviarMsg(); } }
  function msgAbreFoto(){ var inp=document.getElementById('msgFoto'); if(inp) inp.click(); }
  function msgFotoSel(){
    var k=selecionada; if(!k) return;
    var inp=document.getElementById('msgFoto'); var f=inp&&inp.files&&inp.files[0]; if(!f) return;
    if(f.size>10*1024*1024){ var st=document.getElementById('msgStatus'); if(st)st.textContent='❌ imagem muito grande (máx. 10MB).'; inp.value=''; return; }
    var rd=new FileReader(); rd.onload=function(){ fotoPend[k]=rd.result; msgFotoMostra(k); }; rd.readAsDataURL(f);
  }
  function msgFotoMostra(k){
    var box=document.getElementById('msgFotoPrev'); if(!box) return;
    if(fotoPend[k]){ var img=document.getElementById('msgFotoImg'); if(img)img.src=fotoPend[k]; box.style.display='flex'; }
    else { box.style.display='none'; }
  }
  function msgFotoLimpa(){ var k=selecionada; if(k) delete fotoPend[k]; var inp=document.getElementById('msgFoto'); if(inp)inp.value=''; msgFotoMostra(k); }
  function enviarMsg(){
    var k=selecionada; if(!k) return;
    var c=ultimoData[k]||{}; var jid=c.jid||'';
    var ta=document.getElementById('msgTxt'); var txt=(ta&&ta.value||'').trim();
    var foto=fotoPend[k]||'';
    var st=document.getElementById('msgStatus');
    if(c.humano && c.humanoPor!==MEU_USUARIO){ if(st)st.textContent='🔒 Assumida por '+(c.humanoPor||'outro atendente')+' — você não pode escrever agora.'; return; }
    if(!c.humano || c.humanoPor!==MEU_USUARIO){ if(st)st.textContent='Clique em “assumir” (🧑) para responder.'; return; }
    if(!txt && !foto){ if(st)st.textContent=''; return; }
    if(st)st.textContent='Enviando…';
    fetch('/sofia/responder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:k,jid:jid,texto:txt,fotoBase64:foto})})
      .then(function(r){return r.json();}).then(function(j){
        if(j.ok){ if(ta)ta.value=''; rascunhos[k]=''; delete fotoPend[k]; var inp=document.getElementById('msgFoto'); if(inp)inp.value=''; msgFotoMostra(k); if(st)st.textContent='✓ enviada';
          if(ultimoData[k]){ ultimoData[k].humanoEm=Date.now(); ultimoData[k].humanoPor=MEU_USUARIO; ultimoData[k].humano=true; } // renova a trava (o servidor também renovou)
          setTimeout(atualizaInbox,800); setTimeout(atualizaInbox,2000); setTimeout(atualizaInbox,3600); }
        else if(st){ st.textContent='❌ '+(j.erro||'não consegui enviar'); }
      }).catch(function(){ if(st)st.textContent='❌ erro de rede'; });
  }
  function ncRenderTags(){
    var el=document.getElementById('ncTags'); if(!el) return;
    ncTodas = TAGS_EXISTENTES.slice();
    ncSel.forEach(function(t){ if(ncTodas.indexOf(t)<0) ncTodas.push(t); });
    ncTodas.sort(function(a,b){ return a.localeCompare(b,'pt-BR'); });
    el.innerHTML = ncTodas.map(function(t,i){ var on=ncSel.indexOf(t)>=0;
      return '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.85rem;cursor:pointer"><input type="checkbox" '+(on?'checked':'')+' onchange="ncToggleTagIdx('+i+',this.checked)" style="width:16px;height:16px;margin:0;flex:none"> '+escH(t)+'</label>';
    }).join('') || '<span class="quando" style="margin:0">Nenhuma tag ainda — crie a primeira em "criar nova tag".</span>';
  }
  function ncToggleTagIdx(i,checked){ var t=ncTodas[i]; if(!t) return; var idx=ncSel.indexOf(t); if(checked){ if(idx<0) ncSel.push(t); } else if(idx>=0){ ncSel.splice(idx,1); } ncMarcaSujo(); }
  function ncAddNovaTag(){ var inp=document.getElementById('ncNovaTag'); if(!inp) return; var t=(inp.value||'').trim(); inp.value=''; if(!t) return; if(ncSel.indexOf(t)<0) ncSel.push(t); ncRenderTags(); ncMarcaSujo(); }
  function ncMarcaSujo(){ ncDirty=true; ncAtualizaStatus(); }
  function ncAtualizaStatus(){
    var msg=document.getElementById('ncMsg'), btn=document.getElementById('ncSalvar'); if(!msg) return;
    if(ncDirty){ msg.innerHTML='<span style="color:#9a6b00;font-weight:700">⚠️ não salvo — clique em Salvar</span>'; if(btn)btn.style.boxShadow='0 0 0 3px rgba(255,91,87,.30)'; }
    else { var c=ultimoData[selecionada]||{}; msg.innerHTML=c.salvo?'<span style="color:#1c8f52">✓ salvo</span>':''; if(btn)btn.style.boxShadow='none'; }
  }
  function salvarContato(k){
    ncAddNovaTag(); // comita qualquer "nova tag" digitada e não adicionada
    var msg=document.getElementById('ncMsg'); if(msg)msg.textContent='Salvando…';
    var nome=(ncNome||'').trim();
    fetch('/sofia/contatos/salvar-novo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:k,nome:nome,tags:ncSel})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ if(ultimoData[k]){ultimoData[k].salvo=true; ultimoData[k].tagsContato=ncSel.slice(); if(nome)ultimoData[k].nome=nome;} ncDirty=false; ncAtualizaStatus(); } else if(msg){ msg.textContent='❌ '+(j.erro||'falha'); } })
      .catch(function(){ if(msg)msg.textContent='❌ erro'; });
  }
  function filtrarTag(t){ tagFiltro=t||''; pagina=0; renderInbox(ultimoData); }
  function filtrarBusca(v){ buscaTexto=String(v||'').trim().toLowerCase(); pagina=0; renderInbox(ultimoData); }
  function filtrarQuieto(cb){ quietoFiltro=!!cb.checked; pagina=0; renderInbox(ultimoData); }
  function filtrarAtencao(cb){ atencaoFiltro=!!cb.checked; pagina=0; renderInbox(ultimoData); }
  function filtrarRespondeu(cb){ respondeuFiltro=!!cb.checked; pagina=0; renderInbox(ultimoData); }
  // "Cliente respondeu": a pessoa MANDOU pelo menos uma mensagem (autor==='aluna').
  // Quem só recebeu campanha/follow-up da SoFIA e nunca respondeu NÃO passa. Se um
  // período estiver marcado, exige que a resposta dela tenha caído DENTRO do período
  // — assim dá pra ver "quem interagiu no mês" (não só quem recebeu algo no mês).
  function clienteRespondeu(c){
    var m=(c&&c.msgs)||[]; var usaPeriodo=!!(dataIniMs||dataFimMs);
    var lo=dataIniMs||0, hi=dataFimMs||8.64e15;
    for(var i=0;i<m.length;i++){
      if(m[i].autor!=='aluna') continue;
      if(!usaPeriodo) return true;
      var e=m[i].em||0; if(e>=lo && e<=hi) return true;
    }
    return false;
  }
  // Filtro por PERÍODO: conversas com alguma mensagem entre os dias De e Até
  // (inclusive). Só olha os horários já guardados — nenhuma chamada de IA.
  var dataIniMs=0, dataFimMs=0;
  function filtrarData(){
    var vi=document.getElementById('convDataIni').value, vf=document.getElementById('convDataFim').value;
    var a=vi?new Date(vi+'T00:00:00').getTime():0, b=vf?new Date(vf+'T23:59:59.999').getTime():0;
    if(a && b && a>b){ a=new Date(vf+'T00:00:00').getTime(); b=new Date(vi+'T23:59:59.999').getTime(); } // inverteu → arruma
    dataIniMs=a; dataFimMs=b; pagina=0; renderInbox(ultimoData);
  }
  function limparData(){ var i=document.getElementById('convDataIni'), f=document.getElementById('convDataFim'); if(i)i.value=''; if(f)f.value=''; dataIniMs=0; dataFimMs=0; pagina=0; renderInbox(ultimoData); }
  function naData(c){
    if(!dataIniMs && !dataFimMs) return true;
    var lo=dataIniMs||0, hi=dataFimMs||8.64e15, m=(c&&c.msgs)||[];
    for(var i=m.length-1;i>=0;i--){ var e=m[i].em||0; if(e>=lo && e<=hi) return true; }
    var u=(c&&c.ultimaEm)||0; return u>=lo && u<=hi;
  }
  // "Quieto": a ÚLTIMA mensagem DO CONTATO (aluna) foi há 24h+ e há no máx. 4 dias.
  // Usa só os horários já guardados (nenhuma chamada de IA). Follow-up/mensagens da
  // SoFIA não contam — olhamos só o que a própria pessoa mandou.
  function ultimaDoContato(c){ var m=(c&&c.msgs)||[]; for(var i=m.length-1;i>=0;i--){ if(m[i].autor==='aluna') return m[i].em||0; } return 0; }
  function quieto(c){ var t=ultimaDoContato(c); if(!t) return false; var dt=Date.now()-t; return dt>=QUIETO_MS && dt<=QUIETO_MAX_MS; }
  // Casa a busca com nome, telefone (só dígitos) OU o texto de qualquer mensagem.
  function casaBusca(k, c){
    if(!buscaTexto) return true;
    var q=buscaTexto, qd=q.replace(/\\D/g,'');
    if((c.nome||'').toLowerCase().indexOf(q)>=0) return true;
    if(qd && String(k||'').replace(/\\D/g,'').indexOf(qd)>=0) return true;
    var ms=c.msgs||[];
    for(var i=0;i<ms.length;i++){ if((ms[i].texto||'').toLowerCase().indexOf(q)>=0) return true; }
    return false;
  }
  function renderInbox(data){
    ultimoData = data||{};
    // Atalho de Contatos: assim que os dados chegam, seleciona a conversa alvo (uma vez).
    if(alvoChat && !alvoAplicado){
      alvoAplicado=true;
      var alvoK=Object.keys(ultimoData).filter(function(k){return mesmoTel(k,alvoChat);})[0];
      if(alvoK){ selecionada=alvoK; ncSel=(ultimoData[alvoK].tagsContato||[]).slice(); ncNome=ultimoData[alvoK].nome||''; ncDirty=false; ultimoRender={chave:null,n:-1,humano:null}; }
    }
    var chaves = Object.keys(ultimoData).sort(function(a,b){return (ultimoData[b].ultimaEm||0)-(ultimoData[a].ultimaEm||0);});
    if(tagFiltro==='__sem__') chaves = chaves.filter(function(k){ return !((ultimoData[k].tagsContato||[]).length); });
    else if(tagFiltro) chaves = chaves.filter(function(k){ return (ultimoData[k].tagsContato||[]).indexOf(tagFiltro)>=0; });
    if(buscaTexto) chaves = chaves.filter(function(k){ return casaBusca(k, ultimoData[k]||{}); });
    if(atencaoFiltro) chaves = chaves.filter(function(k){ return !!(ultimoData[k]||{}).atencao; });
    if(quietoFiltro) chaves = chaves.filter(function(k){ return quieto(ultimoData[k]||{}); });
    if(respondeuFiltro) chaves = chaves.filter(function(k){ return clienteRespondeu(ultimoData[k]||{}); });
    if(dataIniMs || dataFimMs) chaves = chaves.filter(function(k){ return naData(ultimoData[k]||{}); });
    var total=chaves.length;
    var lista=document.getElementById('convLista'), pag=document.getElementById('convPag');
    if(!total){ if(lista)lista.innerHTML='<p class="quando" style="padding:12px">'+(atencaoFiltro?'Nenhuma conversa pedindo atendimento humano agora. 🎉':(respondeuFiltro?('Nenhum cliente respondeu'+((dataIniMs||dataFimMs)?' no período escolhido.':' ainda.')):((dataIniMs||dataFimMs)?'Nenhuma conversa no período escolhido.':(quietoFiltro?'Nenhum contato quieto há 24h+ (dentro dos últimos 4 dias). 🎉':(buscaTexto?'Nada encontrado para “'+escH(buscaTexto)+'” (nome, telefone ou palavra na conversa).':(tagFiltro==='__sem__'?'Nenhuma conversa sem tag.':(tagFiltro?'Nenhuma conversa com a tag “'+escH(tagFiltro)+'”.':'Nenhuma conversa ainda. Assim que a SoFIA receber mensagens, elas aparecem aqui.')))))))+'</p>'; ultimoInboxHtml=''; if(pag)pag.innerHTML=''; return; }
    // Lista COMPLETA (sem paginação) — só o #convLista rola; a janela da conversa fica fixa.
    var fatia=chaves;
    var grupos=[], gAtual=null;
    fatia.forEach(function(k){
      var c=ultimoData[k]; var ult=c.msgs&&c.msgs.length?c.msgs[c.msgs.length-1]:null;
      var on=(k===selecionada);
      var pendente = !!(ult && ult.autor==='aluna'); // última foi da aluna → esperando resposta
      var dot = pendente ? '<span title="aguardando resposta" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0e6e6b;flex:none"></span>' : '';
      var tgs=(c.tagsContato||[]).map(function(t){return '<span style="display:inline-block;background:#eef7f7;color:#0e8e91;border-radius:999px;padding:0 7px;font-size:.64rem;margin-left:5px">'+escH(t)+'</span>';}).join('');
      var enc=encerrada(c)?'<span style="display:inline-block;background:#f3eaea;color:#a15a5a;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">🔒 encerrada</span>':'';
      var hbMeu=c.humano&&c.humanoPor===MEU_USUARIO;
      var hb=c.humano?('<span title="'+(hbMeu?'Você assumiu esta conversa':'Assumida por '+escH(c.humanoPor||'atendente'))+'" style="display:inline-block;background:'+(hbMeu?'#e6f6ec;color:#1f8f52':'#fdf2e0;color:#8a5a00')+';border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">'+(hbMeu?'🙋 você':'🔒 '+escH(c.humanoPor||'atendente'))+'</span>'):'';
      var fu=c.fuEspera?'<span title="Follow-up pronto, aguardando o horário permitido" style="display:inline-block;background:var(--warn-bg);color:#b8770a;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">⏳ follow-up '+escH(c.fuEspera)+'</span>':'';
      var at=c.atencao?'<span title="A aluna pediu atendimento humano" style="display:inline-block;background:#c0392b;color:#fff;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">🙋 pediu humano</span>':'';
      var agMini=c.agendou?'<span title="Aula experimental agendada" style="font-size:.8rem;flex:none">📅</span>':'';
      var blq=c.bloq?'<span title="Contato bloqueado" style="display:inline-block;background:var(--erro-bg);color:#c0392b;border:1px solid #f0c8c4;border-radius:999px;padding:0 7px;font-size:.62rem;font-weight:700;margin-left:5px">🚫 bloqueado</span>':'';
      // Cartão v2: avatar (iniciais) + nome/hora + telefone + chips de status/tag numa linha.
      var chips=[blq,at,tgs,hb,enc,fu].join(''); // já vêm como <span>…</span> estilizados
      var cls='cv-item'+(on?' on':'')+((c.atencao&&!on)?' aten':'');
      var av='<div class="cv-av" style="background:'+corAv(c.nome||k)+'">'+escH(iniciais(c.nome,k))+(pendente?'<span class="cv-badge" title="aguardando resposta"></span>':'')+'</div>';
      var itemHtml='<div class="'+cls+'" onclick="abrir(\\''+k+'\\')">'+av
        +'<div class="cv-b">'
        +  '<div class="cv-r1"><span class="cv-nm" style="font-weight:'+(pendente?'700':'600')+'">'+escH(c.nome||fmtTel(k))+'</span>'+agMini+'<span class="cv-tm">'+soHora(c.ultimaEm)+'</span></div>'
        +  '<div class="cv-ph">'+escH(fmtTel(k))+'</div>'
        +  (chips?('<div class="cv-chips">'+chips+'</div>'):'')
        +'</div>'
        +'</div>';
      var dk=diaKeySP(c.ultimaEm);
      if(!gAtual || gAtual.dk!==dk){ gAtual={dk:dk, ts:c.ultimaEm, itens:[]}; grupos.push(gAtual); }
      gAtual.itens.push(itemHtml);
    });
    // Cada dia num container próprio: o separador é sticky DENTRO do grupo, então o do
    // dia anterior sai da tela quando o próximo dia chega (não empilha no topo).
    var novoHtml = grupos.map(function(g){ return '<div class="diaGrupo">'+sepDiaHtml(g.ts)+g.itens.join('')+'</div>'; }).join('');
    // Só troca o DOM quando algo muda — e preserva a rolagem da lista (o refresh de 4s
    // não joga a lista de volta pro topo enquanto você está olhando).
    if(novoHtml!==ultimoInboxHtml){ var _sc=lista.scrollTop; lista.innerHTML=novoHtml; ultimoInboxHtml=novoHtml; try{ lista.scrollTop=_sc; }catch(e){} }
    if(pag){ pag.innerHTML='<span class="quando" style="text-align:center;margin:0">'+total+' conversa'+(total>1?'s':'')+'</span>'; }
    if(selecionada && ultimoData[selecionada]){
      var cc=ultimoData[selecionada], nn=(cc.msgs?cc.msgs.length:0);
      // Só re-renderiza o chat quando muda de conversa, chega mensagem nova ou muda
      // o controle humano — assim o refresh de 4s não apaga o que você está digitando.
      if(!agAberto && (ultimoRender.chave!==selecionada || ultimoRender.n!==nn || ultimoRender.humano!==!!cc.humano)){ renderChat(cc, selecionada); ultimoRender={chave:selecionada,n:nn,humano:!!cc.humano}; }
    }
  }
  function mudarPag(d){ pagina+=d; renderInbox(ultimoData); }
  function irPag(n){ pagina=Math.max(0,n); renderInbox(ultimoData); }
  function celPag(p, cur){ return p===cur ? '<span class="save" style="padding:4px 9px;border-radius:7px;font-size:.72rem;pointer-events:none">'+(p+1)+'</span>' : '<a class="reset" style="padding:4px 9px;font-size:.72rem;cursor:pointer" onclick="irPag('+p+')">'+(p+1)+'</a>'; }
  function setaPag(txt, dest, off, tit){ var t=tit?' title="'+tit+'"':''; return off ? '<span class="reset" style="padding:4px 9px;font-size:.72rem;opacity:.35"'+t+'>'+txt+'</span>' : '<a class="reset" style="padding:4px 9px;font-size:.72rem;cursor:pointer"'+t+' onclick="irPag('+dest+')">'+txt+'</a>'; }
  // Números com janela (±2) + 1ª/última + reticências; buraco de 1 vira o número.
  function pagNumsHtml(cur, paginas){
    var last=paginas-1, nums={};
    [0,last,cur-2,cur-1,cur,cur+1,cur+2].forEach(function(x){ if(x>=0&&x<=last)nums[x]=1; });
    if(cur<=3)[1,2,3,4].forEach(function(x){ if(x<=last)nums[x]=1; });
    if(cur>=last-3)[last-1,last-2,last-3,last-4].forEach(function(x){ if(x>=0)nums[x]=1; });
    var arr=Object.keys(nums).map(Number).sort(function(a,b){return a-b;});
    var out=[], ant=-1;
    arr.forEach(function(p){
      if(p-ant===2) out.push(celPag(ant+1,cur));
      else if(p-ant>1) out.push('<span class="quando" style="padding:0 1px">…</span>');
      out.push(celPag(p,cur)); ant=p;
    });
    return out.join('');
  }
  function abrir(k){ selecionada=k; ncSel=(ultimoData[k]&&ultimoData[k].tagsContato?ultimoData[k].tagsContato.slice():[]); ncNome=(ultimoData[k]&&ultimoData[k].nome)||''; ncDirty=false; tagEdAberto=false; ultimoRender={chave:null,n:-1,humano:null}; try{document.body.classList.add('ver-conversa');}catch(e){} renderInbox(ultimoData); }
  // Mobile: volta da conversa para a lista (no desktop as duas ficam lado a lado).
  function voltarLista(){ try{document.body.classList.remove('ver-conversa');}catch(e){} }
  function atualizaWa(e){
    var b=document.getElementById('waTag'); if(!b) return;
    var m={conectado:['🟢','online','#1c8f52','#e6f6ec'],desconectado:['🔴','off-line','#c0392b','#fdeaea'],qr:['🟠','reconectar','#b8770a','#fdf2e0'],codigo:['🔑','código','#b8770a','#fdf2e0'],iniciando:['🟡','conectando','#b8770a','#fdf2e0']};
    var s=m[e]||['⚪','—','#7a7a7a','#eee'];
    b.textContent=s[0]+' '+s[1]; b.style.color=s[2]; b.style.background=s[3];
    // Fora do ar (qualquer estado que não seja 'conectado') ganha destaque: maior,
    // com borda e pulso, para o Studio perceber de longe que precisa de ação.
    if(e==='conectado'){ b.classList.remove('wa-off'); } else { b.classList.add('wa-off'); }
  }
  function atualizaInbox(){ fetch('/sofia/conversas',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ j=j||{}; if(j.lockMin){ LOCK_MIN=j.lockMin; LOCK_MS=LOCK_MIN*60000; } atualizaWa(j.wa); renderInbox(j.conv||{}); }).catch(function(){}); }
  // Reimportar histórico: pede ao listener para reler o WhatsApp e repovoar o inbox
  // (recupera trechos perdidos, ex.: após um reinício da SoFIA). Pesado — por isso confirma.
  function reimportarHistorico(){
    var b=document.getElementById('btnReimport'); if(!b) return;
    if(b.dataset.busy==='1') return;
    if(!confirm('Reimportar o histórico do WhatsApp para o painel?\\n\\nRelê as mensagens de cada conversa (das mais recentes para as mais antigas) e completa o que faltar no painel, sem duplicar. Pode levar alguns minutos — o botão mostra o andamento.')) return;
    var txt=b.textContent; b.dataset.busy='1'; b.disabled=true; b.textContent='↻ Começando…';
    function restaura(){ b.dataset.busy='0'; b.disabled=false; b.textContent=txt; }
    var inicio=Date.now(), viuRodando=false;
    function acompanha(){
      fetch('/sofia/importar/status').then(function(r){return r.json();}).then(function(j){
        var st=(j&&j.status)||{};
        if(st.rodando){ viuRodando=true; b.textContent='↻ Lendo '+(st.total?((st.feitos||0)+'/'+st.total):'conversas')+'…'; if(st.feitos && st.feitos%120<40) { try{atualizaInbox();}catch(e){} } return setTimeout(acompanha, 3000); }
        var terminou = st.terminadoEm && st.terminadoEm>=inicio-5000;
        var falhou = st.erro && (st.em||0)>=inicio-5000;
        if(terminou){ try{atualizaInbox();}catch(e){} restaura(); return alert('✅ Histórico reimportado: '+(st.feitos||0)+' conversas lidas.'); }
        if(falhou){ restaura(); return alert('❌ A reimportação parou: '+st.erro); }
        if(!viuRodando && Date.now()-inicio>60000){ restaura(); return alert('A SoFIA não respondeu ao pedido em 1 minuto. Ela está ligada? Tente de novo.'); }
        setTimeout(acompanha, 3000);
      }).catch(function(){ setTimeout(acompanha, 5000); });
    }
    fetch('/sofia/importar',{method:'POST'}).then(function(r){return r.json();}).then(function(j){
      if(j && j.ok){ setTimeout(acompanha, 2000); }
      else { restaura(); alert('Não consegui disparar: '+((j&&j.erro)||'erro')); }
    }).catch(function(e){ restaura(); alert('Falha ao disparar: '+e); });
  }
  atualizaInbox(); setInterval(atualizaInbox, ${refreshMs});
  try { if(localStorage.getItem('convFiltrosOpen')==='1'){ var _d=document.getElementById('convFiltrosDet'); if(_d)_d.open=true; } } catch(e){}
</script>`;
  return chrome({ tab: 'SoFIA', h1: 'SoFIA', p: 'Conversas da SoFIA — leia o histórico de cada atendimento.' }, 'sofia', corpo);
}

// Aba Sofia → Contatos: CRM leve (importar CSV, etiquetar, filtrar por tag).
function paginaSofiaContatos(aviso, erro, params) {
  params = params || {};
  const q = params.q || '';
  const tagSel = params.tag || '';
  const bloqSel = ['sim', 'nao'].includes(params.bloq) ? params.bloq : '';
  let bloqueados = []; try { bloqueados = sofia.lerBloqueios(); } catch (_) {}
  // Sem paginação: uma lista única que rola (igual às Conversas da SoFIA). Um
  // porPagina enorme traz todos os contatos do filtro numa página só, então o
  // bloco de paginação (r.paginas > 1) nunca aparece.
  const r = contatos.listar({ q, tag: tagSel, pagina: 0, porPagina: 1000000, bloq: bloqSel, bloqueados });
  const tags = contatos.tagsDistintas();
  const total = contatos.totalContatos();

  const fmtTelP = (t) => { const d = String(t || '').replace(/\D/g, ''); if (/^55\d{10,11}$/.test(d)) { const ddd = d.slice(2, 4), x = d.slice(4); return '+55 (' + ddd + ') ' + (x.length === 9 ? x.slice(0, 5) + '-' + x.slice(5) : x.slice(0, 4) + '-' + x.slice(4)); } return t || ''; };
  const optBloq = (v, rot) => `<option value="${v}"${bloqSel === v ? ' selected' : ''}>${rot}</option>`;

  // Cores estáveis por texto (mesma tag/nome → mesma cor, no servidor e no navegador).
  const _hash = (s) => { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  // Tags: fundo claro + texto/hue mais discretos (menos neon), mantendo a
  // distinção de cor entre categorias.
  const PAL_TAG = [['#e7f0ef', '#0e6e6b', '#cbe3e2'], ['#f6eae8', '#a5473f', '#e6cec9'], ['#eaf3ec', '#3c8258', '#d0e4d6'], ['#f6efe1', '#8a6a2e', '#e6d8bd'], ['#eceff7', '#495a95', '#d5dcee'], ['#efe9f3', '#6f4e8f', '#ddcfe6'], ['#f4e9ef', '#95517a', '#e6cfdc']];
  // Avatares: paleta sóbria e dessaturada (família teal/pedra), harmônica com o
  // acento do painel — mantém variação para leitura rápida sem "gritar".
  const PAL_AV = ['#5f8a87', '#6b7f9e', '#8a7f9c', '#9a8778', '#7a9b86', '#7d8b96', '#9c7f86', '#88836f'];
  const corTag = (t) => PAL_TAG[_hash(t) % PAL_TAG.length];
  const corAv = (s) => PAL_AV[_hash(s) % PAL_AV.length];
  const iniciais = (nome, tel) => {
    const nm = String(nome || '').trim();
    if (nm) { const p = nm.split(/\s+/); return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
    return '#';
  };
  const chipTag = (t) => { const [bg, fg, bd] = corTag(t); return `<span style="display:inline-block;background:${bg};color:${fg};border:1px solid ${bd};border-radius:6px;padding:2px 8px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;line-height:1.35">${esc(t)}</span>`; };
  const podeConversa = podeSofiaSub(E._navSess || { admin: true, telas: [] }, 'conversas');

  const linhas = r.itens.map(c => {
    const nm = c.nome || '';
    const jc = esc(JSON.stringify(c.tel));
    const btnConversa = podeConversa ? `<button type="button" class="ct-ic" title="Ir para a conversa" onclick='irConversa(${jc})'>💬</button>` : '';
    const bloq = sofia.estaBloqueado(c.tel);
    return `<tr class="ct-row" data-nome="${esc((nm || '').toLowerCase())}" data-tel="${esc(c.tel)}" data-bloq="${bloq ? '1' : '0'}" onclick='abrirModal(${jc})'>
      <td>
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <input type="checkbox" class="ct-chk" value="${esc(c.tel)}" onclick="event.stopPropagation();atualizarSel()" title="Selecionar" style="flex:none;width:16px;height:16px;margin:0;cursor:pointer">
          <span class="ct-av" style="background:${corAv(nm || c.tel)}">${esc(iniciais(nm, c.tel))}</span>
          <span class="ct-nm">${esc(nm || '(sem nome)')}${c.nomeAgendado ? `<span class="quando" style="display:block;font-size:.72rem;margin:0" title="Nome informado no agendamento — não substituiu o nome do contato (outro primeiro nome ou nome editado pela equipe)">📅 agendou como ${esc(c.nomeAgendado)}</span>` : ''}</span>
          ${bloq ? '<span title="Contato bloqueado" style="flex:none;color:#c0392b;font-size:.9rem">🚫</span>' : ''}
        </div>
      </td>
      <td class="ct-tel">${esc(fmtTelP(c.tel))}</td>
      <td>${(c.tags || []).map(chipTag).join('') || '<span class="quando" style="font-size:.74rem">—</span>'}</td>
      <td class="ct-acts" onclick="event.stopPropagation()">
        <button type="button" class="ct-ic" title="Interações" onclick='abrirInteracoes(${jc})'>📊</button>
        ${btnConversa}
        <button type="button" class="ct-ic" title="Editar" onclick='abrirModal(${jc})'>✏️</button>
        <button type="button" class="ct-ic ct-del" title="Excluir" onclick='excluirContato(${jc})'>🗑️</button>
      </td>
    </tr>`;
  }).join('');

  const opcoes = ['<option value="">Todas as tags</option>', `<option value="__sem__"${tagSel === '__sem__' ? ' selected' : ''}>Sem tag</option>`]
    .concat(tags.map(t => `<option value="${esc(t.tag)}"${t.tag === tagSel ? ' selected' : ''}>${esc(t.tag)} (${t.n})</option>`)).join('');

  // Ação em lote: marque contatos na lista (checkbox) e adicione/remova uma tag
  // nos SELECIONADOS; se nada estiver marcado, age em todos os do filtro atual.
  const tagReal = tags.some(t => t.tag === tagSel) ? tagSel : '';
  const optAdd = ['<option value="">— não adicionar —</option>']
    .concat(tags.map(t => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`)).join('');
  const optRm = ['<option value="">— não remover —</option>']
    .concat(tags.map(t => `<option value="${esc(t.tag)}"${t.tag === tagReal ? ' selected' : ''}>${esc(t.tag)} (${t.n})</option>`)).join('');
  const loteBar = (r.total && tags.length) ? `
    <details class="card" style="padding:10px 15px">
      <summary style="cursor:pointer;font-weight:700;user-select:none">🏷️ Alterar tags em lote <small style="font-weight:400;color:#5c5960">— marque contatos na lista, ou aplique a todos do filtro</small></summary>
      <form method="POST" action="/sofia/contatos/lote" data-total="${r.total}" onsubmit="return confirmarLote(this)" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <input type="hidden" name="q" value="${esc(q)}"><input type="hidden" name="tag_filtro" value="${esc(tagSel)}"><input type="hidden" name="bloq" value="${esc(bloqSel)}">
        <input type="hidden" name="tels" id="loteTels" value="">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label style="flex:1 1 200px;min-width:0;margin:0;font-size:.82rem;display:flex;flex-direction:column;gap:3px"><span>➕ Adicionar tag</span><select name="add" style="width:100%">${optAdd}</select></label>
          <label style="flex:1 1 200px;min-width:0;margin:0;font-size:.82rem;display:flex;flex-direction:column;gap:3px"><span>➖ Remover tag</span><select name="rm" style="width:100%">${optRm}</select></label>
        </div>
        <button type="submit" class="save" style="padding:8px 14px;align-self:flex-start"><span id="loteBtnTxt">Aplicar ao filtro (${r.total})</span></button>
      </form>
      <p class="quando" id="loteHint" style="margin:8px 0 0">Nenhum marcado — vai aplicar aos <b>${r.total} contato(s) do filtro atual</b>. Marque as caixinhas na lista para agir só nos escolhidos. Ao <b>adicionar</b>, as regras de transição de funil da tag também valem.</p>
    </details>` : '';

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('contatos')}
    ${uiTopo({ titulo: 'Contatos', sub: `<b>${total}</b> contato${total === 1 ? '' : 's'} no total. Importe por CSV, etiquete com tags e filtre — é daqui que saem as campanhas e as automações.` })}

    <details class="card" style="padding:10px 15px">
      <summary style="cursor:pointer;font-weight:700">⬆️ Importar CSV <small style="font-weight:400;color:#5c5960">(colunas: Nome, Telefone, Instruções personalizadas, Tags)</small></summary>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <input type="file" id="csvFile" accept=".csv,text/csv">
        <button type="button" class="save" onclick="importarCsv()" style="padding:8px 14px">Importar arquivo</button>
        <span id="impMsg" class="quando"></span>
      </div>
      <p class="quando" style="margin:8px 0 0">📄 <a href="/sofia/contatos/modelo.csv" download style="color:var(--teal-esc);font-weight:700">Baixar modelo de CSV</a> — preencha por cima e reimporte. Várias tags no mesmo contato: separe por <code>;</code>.</p>
      <p class="quando" style="margin:4px 0 0">A importação <b>mescla</b> (não apaga): contatos existentes ganham as tags novas; telefones repetidos não duplicam.</p>
    </details>

    <details class="card" style="padding:10px 15px">
      <summary style="cursor:pointer;font-weight:700">⬇️ Exportar CSV <small style="font-weight:400;color:#5c5960">(baixar toda a base)</small></summary>
      <div style="margin-top:10px">
        <a href="/sofia/contatos/exportar" download class="save" style="display:inline-block;padding:8px 16px;text-decoration:none">📥 Baixar contatos (${total})</a>
      </div>
      <p class="quando" style="margin:8px 0 0">Gera um <b>CSV</b> com <b>Nome, Telefone, Instruções personalizadas e Tags</b> de todos os contatos — abre no Excel/Google Planilhas e serve para <b>migrar de plataforma</b> ou guardar backup. O próprio arquivo pode ser reimportado aqui.</p>
    </details>

    <form method="GET" action="/sofia" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="hidden" name="view" value="contatos">
      <div style="display:flex;gap:8px;flex:1 1 320px;min-width:0">
        <input type="text" name="q" value="${esc(q)}" placeholder="Buscar por nome ou telefone" style="flex:1 1 auto;min-width:0">
        <select id="ctTagSel" name="tag" style="flex:0 0 190px;max-width:50%" onchange="this.form.submit()">${opcoes}</select>
      </div>
      <select id="ctBloqSel" name="bloq" style="flex:0 0 210px" onchange="this.form.submit()" title="Filtrar por bloqueio">
        ${optBloq('', '👥 Todos os contatos')}
        ${optBloq('nao', '✅ Não bloqueados')}
        ${optBloq('sim', '🚫 Bloqueados')}
      </select>
      <button type="submit" class="save" style="padding:8px 14px">Filtrar</button>
      ${(q || tagSel || bloqSel) ? `<a href="/sofia?view=contatos" class="reset" style="padding:8px 14px">Limpar</a>` : ''}
    </form>

    ${loteBar}

    ${r.itens.length ? `<div id="ctSelBar" style="display:none;align-items:center;gap:10px;margin:2px 2px 8px;padding:8px 14px;background:#e7f0ef;border:1px solid #cbe3e2;border-radius:10px;font-weight:700;color:#0e6e6b;font-size:.86rem">
      <span>✅ <span id="ctSelNum">0</span> selecionado(s)</span>
      <button type="button" class="reset" style="padding:3px 10px;font-size:.78rem;margin-left:auto" onclick="limparSelecao()">Limpar seleção</button>
      <button type="button" id="ctExcLote" onclick="excluirSelecionados()" style="padding:3px 10px;font-size:.78rem;border:1px solid #e3b4b4;background:#fbeeee;color:#a12626;border-radius:8px;font-weight:700;cursor:pointer">🗑️ Excluir selecionados</button>
    </div>` : ''}

    ${r.itens.length ? `<div class="ct-wrap">
      <table class="ct-tab">
        <colgroup><col class="c-nome"><col class="c-tel"><col class="c-tags"><col class="c-act"></colgroup>
        <thead><tr>
          <th><span style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" id="ctChkAll" onclick="marcarTodos(this)" title="Selecionar todos" style="width:16px;height:16px;margin:0;cursor:pointer"><button type="button" class="ct-sort" title="Ordenar por nome" onclick="ordenarContatos()">Nome <span id="ctSortArr" style="opacity:.4">↕</span></button></span></th>
          <th>Telefone</th>
          <th>Tags <button type="button" class="ct-fil" title="Filtrar por tag" onclick="abrirFiltroTag()">▾</button></th>
          <th style="text-align:right">Ações</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>` : '<div class="card"><p class="quando">Nenhum contato encontrado. Importe um CSV acima ou ajuste o filtro.</p></div>'}
    ${r.itens.length ? `<p class="quando" style="text-align:center;margin:10px 0 0">${r.total} contato(s) no filtro atual.</p>` : ''}
  </div>

  <div id="ctIntModal" class="ct-ov" onclick="if(event.target===this)fecharInteracoes()">
    <div class="ct-dlg" style="max-width:600px">
      <div class="ct-dh"><h2>Interações</h2><button type="button" class="ct-x" onclick="fecharInteracoes()">×</button></div>
      <div id="ctIntHero" class="quando" style="margin:0 0 10px"></div>
      <div id="ctIntBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <div id="ctResModal" class="ct-ov" style="z-index:60" onclick="if(event.target===this)fecharResumo()">
    <div class="ct-dlg" style="max-width:460px">
      <div class="ct-dh"><h2>Resumo do atendimento</h2><button type="button" class="ct-x" onclick="fecharResumo()">×</button></div>
      <div id="ctResData" class="quando" style="margin:0 0 8px"></div>
      <div id="ctResBody" style="font-size:var(--fs-body);line-height:1.55;white-space:pre-wrap"></div>
    </div>
  </div>

  <div id="tgModal" class="ct-ov" onclick="if(event.target===this)fecharTagCfg()">
    <div class="ct-dlg" style="max-width:520px">
      <div class="ct-dh"><h2>Automação da tag</h2><button type="button" class="ct-x" onclick="fecharTagCfg()">×</button></div>
      <p class="quando" style="margin:0 0 14px">Tag: <b id="tgNome" style="color:var(--teal-esc)"></b></p>
      <label>Aplicar esta tag automaticamente quando…</label>
      <select id="tgGatilho" onchange="tgSync()">
        <option value="">— não automatizar (só uso manual) —</option>
        <option value="novo">🆕 a aluna mandar a 1ª mensagem (lead novo)</option>
        <option value="mensagem">💬 a pessoa mandar qualquer mensagem (novo ou retorno)</option>
        <option value="palavra">🔑 a aluna escrever uma palavra-chave</option>
        <option value="ia">🧠 a SoFIA entender uma intenção (você descreve)</option>
        <option value="agendou">📅 agendar uma aula experimental (a SoFIA ou você pelo botão)</option>
        <option value="humano">🙋 você assumir a conversa (controle humano)</option>
        <option value="encerrou">🔒 a conversa encerrar sem agendamento</option>
        <option value="campanha">💬 a aluna responder a uma campanha</option>
        <option value="anuncio">📣 o lead vier de um anúncio (patrocinado)</option>
      </select>
      <div id="tgPalBox" style="margin-top:14px;display:none">
        <label>Palavras-chave <span class="sub" style="font-weight:400;color:var(--cinza)">— separadas por vírgula (ex.: cancelar, valor, reclamação, endereço)</span></label>
        <input type="text" id="tgPalavras" placeholder="cancelar, valor, endereço">
        <p class="quando" style="margin:6px 0 0">Dispara quando a mensagem da aluna <b>contém</b> qualquer uma delas (não diferencia maiúsculas/acentos simples).</p>
      </div>
      <div id="tgIaBox" style="margin-top:14px;display:none">
        <label>Instrução <span class="sub" style="font-weight:400;color:var(--cinza)">— descreva a intenção, em português (ex.: quando a aluna perguntar sobre preço, valores ou planos)</span></label>
        <textarea id="tgInstrucao" rows="6" maxlength="2000" placeholder="Ex.: quando a aluna perguntar sobre preço, valores, mensalidade ou planos." style="width:100%;resize:vertical"></textarea>
        <p class="quando" style="margin:6px 0 0">A SoFIA <b>lê a conversa</b> e aplica a tag quando entende essa intenção — mesmo sem a palavra exata. Dispara <b>uma vez por conversa</b>. Usa a IA (custo pequeno por mensagem).</p>
      </div>
      <div id="tgCampBox" style="margin-top:14px;display:none">
        <label>De qual campanha? <span class="sub" style="font-weight:400;color:var(--cinza)">— a tag só entra para quem respondeu ESTA campanha</span></label>
        <select id="tgCampanha" style="width:100%"></select>
        <p class="quando" style="margin:6px 0 0">Escolha a campanha. A tag só é aplicada a quem <b>recebeu e respondeu</b> a ela. <b>"Qualquer campanha"</b> é o comportamento antigo (vale para quem respondeu qualquer campanha — inclusive testes).</p>
      </div>
      <div id="tgWppBox" style="margin-top:16px;display:none">
        <label>Avisar no WhatsApp <span class="sub" style="font-weight:400;color:var(--cinza)">— número que recebe o recado (nome + telefone)</span></label>
        <input type="tel" id="tgWpp" placeholder="(62) 99999-9999" inputmode="tel">
        <p class="quando" style="margin:6px 0 0">Deixe em branco para só etiquetar, sem avisar ninguém.</p>
      </div>
      <div id="tgExigeBox" style="margin-top:16px;display:none">
        <label>Só para quem já tem a tag <span class="sub" style="font-weight:400;color:var(--cinza)">— opcional; vale se tiver qualquer uma das marcadas</span></label>
        <div id="tgExige" class="ct-tglist" style="max-height:150px;overflow:auto"></div>
        <p class="quando" style="margin:6px 0 0">Sem nenhuma marcada, vale para qualquer pessoa. Ex.: marque <b>0. Aluna</b> e <b>0. Ex Aluna</b> para avisar a recepção só quando uma aluna escrever (com o gatilho "qualquer mensagem").</p>
      </div>
      <div id="tgEncBox" style="margin-top:16px;display:none">
        <label class="chk" style="margin:0"><input type="checkbox" id="tgEncerrar"> 🔒 Encerrar a conversa ao aplicar esta tag</label>
        <p class="quando" style="margin:6px 0 0">A SoFIA <b>fecha a conversa</b> (como o cadeado): o <b>follow-up para de incomodar</b> e, se a aluna voltar a escrever, a SoFIA <b>recomeça do zero</b>. Ideal para "Sem interesse", "Já treina em outro lugar" etc.</p>
      </div>
      <div style="margin-top:16px">
        <label>Ao aplicar esta tag, remover <span class="sub" style="font-weight:400;color:var(--cinza)">— transição de funil (ex.: entrar em "Agendou" tira "Contato inicial")</span></label>
        <div id="tgRemove" class="ct-tglist" style="max-height:150px;overflow:auto"></div>
      </div>
      <div class="ct-foot">
        <button type="button" class="reset" onclick="fecharTagCfg()" style="padding:9px 16px">Cancelar</button>
        <button type="button" class="save" id="tgSalvar" onclick="salvarTagCfg()" style="padding:9px 18px">Salvar</button>
      </div>
    </div>
  </div>

  <div id="ctModal" class="ct-ov" onclick="if(event.target===this)fecharModal()">
    <div class="ct-dlg">
      <div class="ct-dh"><h2>Editar contato</h2><button type="button" class="ct-x" onclick="fecharModal()">×</button></div>
      <div class="ct-hero"><span id="ctAv" class="ct-av ct-av-lg"></span><div id="ctHnome" class="ct-hnome"></div><div id="ctHtel" class="ct-htel"></div><div id="ctBloqTag" style="display:none;margin-top:6px"><span style="background:var(--erro-bg);color:#c0392b;border:1px solid #f0c8c4;border-radius:999px;padding:2px 12px;font-size:.74rem;font-weight:700">🚫 Contato bloqueado</span></div></div>
      <label>Nome</label>
      <input type="text" id="ctNome" placeholder="Nome do contato">
      <label style="margin-top:12px">Tags</label>
      <div id="ctTags" class="ct-tglist"></div>
      <div class="ct-nova"><input type="text" id="ctNovaTag" placeholder="Nova tag" onkeydown="if(event.key==='Enter'){event.preventDefault();addNovaTag();}"><button type="button" class="reset" onclick="addNovaTag()" style="padding:7px 12px">＋ Adicionar</button></div>
      <div class="ct-foot">
        ${podeConversa ? `<button type="button" class="reset" id="ctConversa" onclick="irConversaModal()" style="padding:9px 16px;margin-right:auto">💬 Ver conversa</button>` : ''}
        <button type="button" class="reset" id="ctBloq" onclick="alternarBloqueio()" style="padding:9px 16px${podeConversa ? '' : ';margin-right:auto'}">🚫 Bloquear</button>
        <button type="button" class="reset" onclick="fecharModal()" style="padding:9px 16px">Cancelar</button>
        <button type="button" class="save" id="ctSalvar" onclick="salvarContato()" style="padding:9px 18px">Salvar</button>
      </div>
    </div>
  </div>
<script>
  var CONTATOS = ${JSON.stringify(r.itens.map(c => ({ tel: c.tel, telFmt: fmtTelP(c.tel), nome: c.nome || '', tags: c.tags || [], ini: iniciais(c.nome, c.tel), cor: corAv(c.nome || c.tel), bloq: sofia.estaBloqueado(c.tel) })))};
  var TAGS_CFG = ${JSON.stringify(tags.map(t => { const c = contatos.tagConfig(t.tag); return { tag: t.tag, gatilho: c.gatilho, palavras: c.palavras, instrucao: c.instrucao, camp: c.campanhaId, wpp: c.avisarWpp, remove: c.remove, exige: c.exige, enc: c.encerrar }; }))};
  var TODAS_TAGS_LISTA = ${JSON.stringify(tags.map(t => t.tag))};
  var CAMPS_LISTA = ${JSON.stringify((() => { try { return sofia.lerCampanhas().map(c => ({ id: String(c.id), nome: String(c.nome || 'Campanha') })); } catch (_) { return []; } })())};
  var tgRemove = [], tgExige = [];
  var tgSel=null;
  function abrirTagCfg(i){
    var c=TAGS_CFG[i]; if(!c) return; tgSel=c;
    document.getElementById('tgNome').textContent=c.tag;
    document.getElementById('tgGatilho').value=c.gatilho||'';
    document.getElementById('tgPalavras').value=(c.palavras||[]).join(', ');
    document.getElementById('tgInstrucao').value=c.instrucao||'';
    document.getElementById('tgWpp').value=c.wpp||'';
    document.getElementById('tgEncerrar').checked=!!c.enc;
    tgFillCamps(c.camp||'');
    tgRemove=(c.remove||[]).slice();
    tgRenderRemove();
    tgExige=(c.exige||[]).slice();
    tgRenderExige();
    tgSync();
    document.getElementById('tgModal').style.display='flex';
  }
  function tgRenderRemove(){
    var box=document.getElementById('tgRemove');
    var outras=TODAS_TAGS_LISTA.filter(function(t){return !tgSel||t!==tgSel.tag;});
    if(!outras.length){ box.innerHTML='<span class="quando">Nenhuma outra tag ainda.</span>'; return; }
    box.innerHTML=outras.map(function(t){
      var on=tgRemove.indexOf(t)>=0;
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" style="'+(on?'background:var(--erro-bg);color:#c0392b;border-color:#f5c6cb':'background:#fff;color:#5c5960;border-color:#e8e8ea')+'" onclick="tgToggleRemove(this,\\''+t.replace(/'/g,"\\\\'")+'\\')">'+(on?'✕ ':'')+esc(t)+'</button>';
    }).join('');
  }
  function tgToggleRemove(btn,t){ var i=tgRemove.indexOf(t); if(i>=0)tgRemove.splice(i,1); else tgRemove.push(t); tgRenderRemove(); }
  function tgRenderExige(){
    var box=document.getElementById('tgExige');
    var outras=TODAS_TAGS_LISTA.filter(function(t){return !tgSel||t!==tgSel.tag;});
    if(!outras.length){ box.innerHTML='<span class="quando">Nenhuma outra tag ainda.</span>'; return; }
    box.innerHTML=outras.map(function(t,i){
      var on=tgExige.indexOf(t)>=0;
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" data-i="'+i+'" style="'+(on?'background:var(--teal-soft);color:var(--teal-esc);border-color:var(--teal)':'background:#fff;color:#5c5960;border-color:#e8e8ea')+'">'+(on?'✓ ':'')+esc(t)+'</button>';
    }).join('');
    [].forEach.call(box.querySelectorAll('button'),function(b){ b.onclick=function(){ var t=outras[+b.getAttribute('data-i')], k=tgExige.indexOf(t); if(k>=0)tgExige.splice(k,1); else tgExige.push(t); tgRenderExige(); }; });
  }
  function tgFillCamps(sel){
    var s=document.getElementById('tgCampanha'); if(!s) return;
    var opts='<option value="">— qualquer campanha (comportamento antigo) —</option>';
    (CAMPS_LISTA||[]).forEach(function(c){ opts+='<option value="'+esc(c.id)+'">'+esc(c.nome)+'</option>'; });
    // Campanha amarrada que já não está na lista (foi excluída): mantém a opção.
    if(sel && !(CAMPS_LISTA||[]).some(function(c){return String(c.id)===String(sel);})) opts+='<option value="'+esc(sel)+'">campanha removida ('+esc(sel)+')</option>';
    s.innerHTML=opts; s.value=sel||'';
  }
  function tgSync(){
    var g=document.getElementById('tgGatilho').value;
    document.getElementById('tgPalBox').style.display=(g==='palavra')?'block':'none';
    document.getElementById('tgIaBox').style.display=(g==='ia')?'block':'none';
    document.getElementById('tgCampBox').style.display=(g==='campanha')?'block':'none';
    document.getElementById('tgWppBox').style.display=g?'block':'none';
    document.getElementById('tgEncBox').style.display=g?'block':'none';
    document.getElementById('tgExigeBox').style.display=g?'block':'none';
  }
  function fecharTagCfg(){ document.getElementById('tgModal').style.display='none'; tgSel=null; }
  function salvarTagCfg(){
    if(!tgSel) return;
    var g=document.getElementById('tgGatilho').value;
    if(g==='palavra' && !document.getElementById('tgPalavras').value.trim()){ alert('Informe ao menos uma palavra-chave.'); return; }
    if(g==='ia' && !document.getElementById('tgInstrucao').value.trim()){ alert('Descreva a intenção na instrução (ex.: quando a aluna perguntar sobre preço).'); return; }
    var b=document.getElementById('tgSalvar'); b.disabled=true; b.textContent='Salvando…';
    var pals=document.getElementById('tgPalavras').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
    var d={ tag:tgSel.tag, gatilho:g, palavras:pals, instrucao:document.getElementById('tgInstrucao').value, campanhaId:(g==='campanha'?document.getElementById('tgCampanha').value:''), avisarWpp:document.getElementById('tgWpp').value, remove:tgRemove, exige:tgExige, encerrar:document.getElementById('tgEncerrar').checked };
    fetch('/sofia/contatos/tagcfg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { b.disabled=false; b.textContent='Salvar'; alert('❌ '+(j.erro||'falha ao salvar')); } })
      .catch(function(){ b.disabled=false; b.textContent='Salvar'; alert('❌ erro de rede'); });
  }
  function criarTagNova(){
    var nome=prompt('Nome da nova tag:'); if(nome==null) return;
    nome=nome.trim(); if(!nome) return;
    fetch('/sofia/contatos/criar-tag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { alert('❌ '+(j.erro||'falha ao criar')); } })
      .catch(function(){ alert('❌ erro de rede'); });
  }
  var TODAS_TAGS = ${JSON.stringify(tags.map(t => t.tag))};
  var PAL_TAG = ${JSON.stringify(PAL_TAG)};
  function _hash(s){var h=0;s=String(s||'');for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
  function corTagJs(t){return PAL_TAG[_hash(t)%PAL_TAG.length];}
  var ctSel=null, ctTags=[];
  function abrirFiltroTag(){var s=document.getElementById('ctTagSel');if(s){s.focus();if(s.showPicker)try{s.showPicker();}catch(e){}}}
  function contatosMarcados(){ return Array.prototype.slice.call(document.querySelectorAll('.ct-chk:checked')).map(function(c){return c.value;}); }
  function loteForm(){ return document.querySelector('form[action="/sofia/contatos/lote"]'); }
  function atualizarSel(){
    var sel=contatosMarcados().length;
    var f=loteForm(); var total=f?(f.getAttribute('data-total')||'0'):'0';
    var txt=document.getElementById('loteBtnTxt'), hint=document.getElementById('loteHint');
    if(sel>0){
      if(txt)txt.textContent='Aplicar aos '+sel+' selecionado(s)';
      if(hint)hint.innerHTML='<b>'+sel+' contato(s) selecionado(s)</b> — a ação vale só para eles.';
    } else {
      if(txt)txt.textContent='Aplicar ao filtro ('+total+')';
      if(hint)hint.innerHTML='Nenhum marcado — vai aplicar aos <b>'+total+' contato(s) do filtro atual</b>. Marque as caixinhas na lista para agir só nos escolhidos.';
    }
    // Barra visível de "X selecionado(s)" — aparece só quando há algum marcado.
    var bar=document.getElementById('ctSelBar'), num=document.getElementById('ctSelNum');
    if(num)num.textContent=sel;
    if(bar)bar.style.display=sel>0?'flex':'none';
    var all=document.getElementById('ctChkAll');
    if(all){ var boxes=document.querySelectorAll('.ct-chk'); all.checked=boxes.length>0 && sel===boxes.length; all.indeterminate=sel>0 && sel<boxes.length; }
  }
  function marcarTodos(cb){ Array.prototype.slice.call(document.querySelectorAll('.ct-chk')).forEach(function(c){c.checked=cb.checked;}); atualizarSel(); }
  function limparSelecao(){ Array.prototype.slice.call(document.querySelectorAll('.ct-chk')).forEach(function(c){c.checked=false;}); atualizarSel(); }
  function confirmarLote(f){
    var add=f.add.value, rm=f.rm.value;
    if(!add && !rm){ alert('Escolha uma tag para adicionar e/ou remover.'); return false; }
    if(add && add===rm){ alert('Adicionar e remover a mesma tag não faz sentido.'); return false; }
    var sel=contatosMarcados();
    f.tels.value=sel.join(',');
    var alvo = sel.length>0 ? (sel.length+' contato(s) selecionado(s)') : ('TODOS os '+(f.getAttribute('data-total')||'0')+' contato(s) do filtro atual');
    var acoes=[]; if(add)acoes.push('adicionar a tag "'+add+'"'); if(rm)acoes.push('remover a tag "'+rm+'"');
    return confirm('Confirmar: '+acoes.join(' e ')+' em '+alvo+'?');
  }
  var ctSoBloq=false;
  function filtrarBloqueados(){
    ctSoBloq=!ctSoBloq;
    var btn=document.getElementById('ctBloqFil');
    if(btn){ btn.classList.toggle('save',ctSoBloq); btn.classList.toggle('reset',!ctSoBloq); btn.textContent=ctSoBloq?'✅ Ver todos':'🚫 Bloqueados'; }
    var linhas=document.querySelectorAll('.ct-tab tbody tr');
    var n=0;
    linhas.forEach(function(tr){ var bl=tr.getAttribute('data-bloq')==='1'; var mostra=!ctSoBloq||bl; tr.style.display=mostra?'':'none'; if(mostra&&bl)n++; });
    var av=document.getElementById('ctBloqAviso');
    if(ctSoBloq&&!n&&!av){ var tb=document.querySelector('.ct-tab tbody'); if(tb){ var tr=document.createElement('tr'); tr.id='ctBloqAviso'; tr.innerHTML='<td colspan="4" style="text-align:center;color:var(--cinza);padding:18px">Nenhum contato bloqueado.</td>'; tb.appendChild(tr); } }
    else if(av){ av.style.display=(ctSoBloq&&!n)?'':'none'; }
  }
  var ctOrdemNome=0; // 0=original, 1=crescente (A→Z), 2=decrescente (Z→A)
  function ordenarContatos(){
    var tb=document.querySelector('.ct-tab tbody'); if(!tb) return;
    ctOrdemNome=(ctOrdemNome+1)%3; // alterna: original → crescente → decrescente
    var arr=document.querySelector('#ctSortArr');
    if(ctOrdemNome===0){ if(arr){arr.textContent='↕';arr.style.opacity='.4';} location.reload(); return; }
    var asc=(ctOrdemNome===1);
    if(arr){ arr.textContent=asc?'▲':'▼'; arr.style.opacity='1'; }
    var linhas=Array.prototype.slice.call(tb.querySelectorAll('tr'));
    linhas.sort(function(a,b){
      var na=a.getAttribute('data-nome')||'', nb=b.getAttribute('data-nome')||'';
      if(!na&&nb) return 1; if(na&&!nb) return -1; // sem nome sempre por último
      var c=na.localeCompare(nb,'pt-BR',{sensitivity:'base',numeric:true});
      return asc?c:-c;
    });
    linhas.forEach(function(tr){ tb.appendChild(tr); });
  }
  function abrirModal(tel){
    var c=null; for(var i=0;i<CONTATOS.length;i++){if(CONTATOS[i].tel===tel){c=CONTATOS[i];break;}}
    if(!c) return;
    ctSel=c; ctTags=(c.tags||[]).slice();
    var av=document.getElementById('ctAv'); av.textContent=c.ini; av.style.background=c.cor;
    document.getElementById('ctHnome').textContent=c.nome||'(sem nome)';
    document.getElementById('ctHtel').textContent=c.telFmt;
    document.getElementById('ctNome').value=c.nome||'';
    document.getElementById('ctNovaTag').value='';
    renderTags();
    ctPintaBloqueio(!!c.bloq);
    document.getElementById('ctModal').style.display='flex';
  }
  function ctPintaBloqueio(bl){
    var b=document.getElementById('ctBloq'), tag=document.getElementById('ctBloqTag');
    if(b){ b.textContent=bl?'✅ Desbloquear':'🚫 Bloquear'; b.style.color=bl?'#1c8f52':'#c0392b'; }
    if(tag) tag.style.display=bl?'block':'none';
  }
  function alternarBloqueio(){
    if(!ctSel) return;
    var novo=!ctSel.bloq;
    var b=document.getElementById('ctBloq'); if(b){ b.disabled=true; b.textContent='…'; }
    fetch('/sofia/contatos/bloquear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:ctSel.tel,ativo:novo})})
      .then(function(r){return r.json();}).then(function(j){
        if(b) b.disabled=false;
        if(j.ok){ ctSel.bloq=novo; ctPintaBloqueio(novo);
          for(var i=0;i<CONTATOS.length;i++){ if(CONTATOS[i].tel===ctSel.tel){ CONTATOS[i].bloq=novo; break; } }
          var row=document.querySelector('.ct-row[data-tel="'+ctSel.tel.replace(/"/g,'')+'"]'); if(row) row.setAttribute('data-bloq',novo?'1':'0');
        } else { ctPintaBloqueio(ctSel.bloq); alert(j.erro||'Não consegui atualizar o bloqueio.'); }
      }).catch(function(){ if(b) b.disabled=false; ctPintaBloqueio(ctSel.bloq); alert('Erro de rede.'); });
  }
  function fecharModal(){document.getElementById('ctModal').style.display='none';ctSel=null;}
  function renderTags(){
    var todas=TODAS_TAGS.slice();
    for(var i=0;i<ctTags.length;i++) if(todas.indexOf(ctTags[i])<0) todas.push(ctTags[i]);
    var box=document.getElementById('ctTags');
    if(!todas.length){box.innerHTML='<span class="quando">Nenhuma tag ainda — crie uma abaixo.</span>';return;}
    box.innerHTML=todas.map(function(t){
      var on=ctTags.indexOf(t)>=0, c=corTagJs(t);
      var st=on?('background:'+c[0]+';color:'+c[1]+';border-color:'+c[2]):'background:#fff;color:#5c5960;border-color:#e8e8ea';
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" style="'+st+'" onclick="toggleTag(this,\\''+t.replace(/'/g,"\\\\'")+'\\')">'+(on?'✓ ':'')+esc(t)+'</button>';
    }).join('');
  }
  function esc(s){return String(s).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function toggleTag(btn,t){var i=ctTags.indexOf(t);if(i>=0)ctTags.splice(i,1);else ctTags.push(t);renderTags();}
  function addNovaTag(){
    var inp=document.getElementById('ctNovaTag'), t=(inp.value||'').trim();
    if(!t) return;
    if(ctTags.indexOf(t)<0) ctTags.push(t);
    if(TODAS_TAGS.indexOf(t)<0) TODAS_TAGS.push(t);
    inp.value=''; renderTags();
  }
  function salvarContato(){
    if(!ctSel) return;
    var b=document.getElementById('ctSalvar'); b.disabled=true; b.textContent='Salvando…';
    fetch('/sofia/contatos/salvar-novo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:ctSel.tel,nome:document.getElementById('ctNome').value,tags:ctTags})})
      .then(function(r){return r.json();}).then(function(j){
        if(j.ok){ location.reload(); }
        else { b.disabled=false; b.textContent='Salvar'; alert('❌ '+(j.erro||'falha ao salvar')); }
      }).catch(function(){ b.disabled=false; b.textContent='Salvar'; alert('❌ erro de rede'); });
  }
  function irConversa(tel){ location.href='/sofia?view=conversas&chat='+encodeURIComponent(tel); }
  function irConversaModal(){ if(ctSel) irConversa(ctSel.tel); }
  var intSessoes=[];
  function fmtDataHora(ts){ try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})+'h'; }catch(e){ return ''; } }
  function abrirInteracoes(tel){
    var c=null; for(var i=0;i<CONTATOS.length;i++){if(CONTATOS[i].tel===tel){c=CONTATOS[i];break;}}
    document.getElementById('ctIntHero').textContent=c?((c.nome||'(sem nome)')+' · '+c.telFmt):'';
    document.getElementById('ctIntBody').innerHTML='<p class="quando">Carregando…</p>';
    document.getElementById('ctIntModal').style.display='flex';
    fetch('/sofia/contatos/interacoes?tel='+encodeURIComponent(tel),{cache:'no-store'})
      .then(function(r){return r.json();}).then(function(j){
        intSessoes=(j&&j.sessoes)||[];
        renderInteracoes();
      }).catch(function(){ document.getElementById('ctIntBody').innerHTML='<p class="quando">❌ Não consegui carregar agora.</p>'; });
  }
  function renderInteracoes(){
    var box=document.getElementById('ctIntBody');
    if(!intSessoes.length){ box.innerHTML='<p class="quando">Nenhuma interação registrada ainda. O histórico começa a contar a partir de agora — quando a aluna conversar com a SoFIA, cada atendimento aparece aqui.</p>'; return; }
    var linhas=intSessoes.map(function(s,idx){
      var badge=s.status==='ativa'?'<span class="ct-badge ativa">Em andamento</span>':'<span class="ct-badge enc">Encerrado</span>';
      return '<tr><td>'+badge+'</td><td>'+fmtDataHora(s.inicioEm)+'</td><td style="color:var(--cinza)">'+(s.nMsgs||0)+' msg</td><td style="text-align:right"><button type="button" class="ct-ic" title="Ver resumo" onclick="verResumo('+idx+')">📄</button></td></tr>';
    }).join('');
    box.innerHTML='<div style="overflow-x:auto"><table class="ct-int-tab"><thead><tr><th>Status</th><th>Data</th><th>Trocas</th><th style="text-align:right">Resumo</th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      +'<p class="quando" style="margin:10px 0 0">Total de '+intSessoes.length+' interaç'+(intSessoes.length===1?'ão':'ões')+'.</p>';
  }
  function fecharInteracoes(){ document.getElementById('ctIntModal').style.display='none'; }
  function verResumo(idx){
    var s=intSessoes[idx]; if(!s) return;
    document.getElementById('ctResData').textContent=fmtDataHora(s.inicioEm);
    var body=document.getElementById('ctResBody');
    if(s.status==='ativa'){ body.innerHTML='<span class="quando">Este atendimento ainda está em andamento — o resumo é gerado quando a conversa encerra.</span>'; }
    else if(!s.resumoPronto){ body.innerHTML='<span class="quando">Resumo sendo gerado… abra de novo em instantes.</span>'; }
    else if(!s.resumo){ body.innerHTML='<span class="quando">Sem resumo para este atendimento (conversa muito curta ou sem conteúdo).</span>'; }
    else { body.textContent=s.resumo; }
    document.getElementById('ctResModal').style.display='flex';
  }
  function fecharResumo(){ document.getElementById('ctResModal').style.display='none'; }
  // Exclusão em LOTE: só os marcados. Muitos de uma vez (20+) pede para digitar
  // a quantidade — evita apagar a base inteira num clique errado.
  function excluirSelecionados(){
    var sel=contatosMarcados(); if(!sel.length){ alert('Marque os contatos que quer excluir.'); return; }
    var n=sel.length;
    if(!confirm('Excluir '+n+' contato(s) de vez?\\n\\nSaem da lista de Contatos (tags e instruções junto). As conversas da SoFIA não são apagadas. Não dá para desfazer — se quiser, use antes o "Exportar CSV" para guardar uma cópia.')) return;
    if(n>=20){ var dig=prompt('Para confirmar, digite a quantidade de contatos que serão excluídos ('+n+'):'); if(dig===null) return; if(String(dig).trim()!==String(n)){ alert('Número diferente de '+n+' — nada foi excluído.'); return; } }
    var b=document.getElementById('ctExcLote'); if(b){ b.disabled=true; b.textContent='Excluindo…'; }
    fetch('/sofia/contatos/excluir-lote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tels:sel})})
      .then(function(r){return r.json();}).then(function(j){
        if(j && j.ok){ alert('✅ '+j.excluidos+' contato(s) excluído(s).'); location.reload(); }
        else { if(b){ b.disabled=false; b.textContent='🗑️ Excluir selecionados'; } alert('❌ '+((j&&j.erro)||'não consegui excluir')); }
      }).catch(function(){ if(b){ b.disabled=false; b.textContent='🗑️ Excluir selecionados'; } alert('❌ erro de rede'); });
  }
  function excluirContato(tel){
    if(!confirm('Excluir este contato de vez?')) return;
    fetch('/sofia/contatos/salvar',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'acao=excluir&telOrig='+encodeURIComponent(tel)})
      .then(function(){ location.reload(); }).catch(function(){ alert('❌ erro de rede'); });
  }
  function importarCsv(){
    var f=document.getElementById('csvFile'), msg=document.getElementById('impMsg');
    if(!f.files||!f.files[0]){ msg.textContent='Escolha um arquivo .csv primeiro.'; return; }
    msg.textContent='Importando…';
    var rd=new FileReader();
    rd.onload=function(){
      fetch('/sofia/contatos/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:rd.result})})
        .then(function(r){return r.json();}).then(function(j){
          if(j.ok){ msg.textContent='✅ '+j.resumo.novos+' novos, '+j.resumo.atualizados+' atualizados, '+j.resumo.ignorados+' ignorados.'; setTimeout(function(){location.href='/sofia?view=contatos';},1000); }
          else { msg.textContent='❌ '+(j.erro||'falha ao importar'); }
        }).catch(function(){ msg.textContent='❌ erro de rede'; });
    };
    rd.readAsText(f.files[0],'utf-8');
  }
</script>`;
  return chrome({ tab: 'Contatos', h1: 'SoFIA', p: 'Contatos — importe, etiquete e filtre por tag.' }, 'sofia', corpo);
}

// Estimativa de término de uma campanha, a partir do que falta e das configs.
function estimarCampanha(c) {
  const restantes = (c.pendentes || []).length;
  if (!restantes) return null;
  const mm = (h) => { const p = String(h || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
  const avg = Math.max(1, ((Number(c.delayMinSeg) || 1) + (Number(c.delayMaxSeg) || 1)) / 2);
  const win = mm(c.janelaFim) - mm(c.janelaIni);
  const maxWin = win > 0 ? Math.max(1, Math.floor(win * 60 / avg)) : 1;
  const porDia = Math.max(1, Math.min(Number(c.limiteDia) || 1, maxWin));
  const dias = Math.max(1, Math.ceil(restantes / porDia));
  const hoje = hojeSP();
  const iniStr = (c.dataInicio && c.dataInicio > hoje) ? c.dataInicio : hoje;
  // Avança contando só os dias da semana permitidos (vazio/7 = todos).
  const sel = Array.isArray(c.dias) ? c.dias.map(Number).filter(x => x >= 0 && x <= 6) : [];
  const d = new Date(iniStr + 'T12:00:00');
  if (sel.length && sel.length < 7) {
    let contados = 0, guarda = 0;
    while (guarda < 3660) { if (sel.indexOf(d.getDay()) >= 0) { contados++; if (contados >= dias) break; } d.setDate(d.getDate() + 1); guarda++; }
  } else { d.setDate(d.getDate() + (dias - 1)); }
  const fim = `${('0' + d.getDate()).slice(-2)}/${('0' + (d.getMonth() + 1)).slice(-2)}/${d.getFullYear()}`;
  return { porDia, dias, fim };
}
const fmtDataBR = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (s || ''); };

// Só a LISTA de campanhas (usada tanto na página quanto no fragmento que o painel
// busca a cada poucos segundos para atualizar o progresso SEM recarregar a página).
function campListHTML(filtro = {}) {
  let campanhas = []; try { campanhas = sofia.lerCampanhas(); } catch (_) {}
  const rotStatus = { gerando: '⏳ gerando variações', pronta: '✅ pronta p/ iniciar', enviando: '📤 enviando', pausada: '⏸️ pausada', concluida: '✔️ concluída', cancelada: '🚫 cancelada' };
  if (!campanhas.length) return '<p class="vazio">Nenhuma campanha ainda.</p>';
  // Filtro por período de início (data no formato AAAA-MM-DD; comparação lexicográfica).
  // Data de referência = dataInicio (o "início" mostrado no card); se faltar, cai no dia
  // da criação (criadoEm). de/ate vazios = sem limite naquele lado.
  const de = String(filtro.de || '').trim(), ate = String(filtro.ate || '').trim();
  if (de || ate) {
    const totalAntes = campanhas.length;
    campanhas = campanhas.filter(c => {
      let d = String(c.dataInicio || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { try { d = new Date(c.criadoEm || 0).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (_) { d = ''; } }
      if (!d) return false;
      if (de && d < de) return false;
      if (ate && d > ate) return false;
      return true;
    });
    if (!campanhas.length) return `<p class="vazio">Nenhuma campanha iniciada nesse período${totalAntes ? ` (de ${totalAntes} no total)` : ''}.</p>`;
  }
  return campanhas.map(c => {
    const total = (c.enviados ? c.enviados.length : 0) + (c.pendentes ? c.pendentes.length : 0) + (c.falhas ? c.falhas.length : 0);
    const enviados = c.enviados ? c.enviados.length : 0;
    const pct = total ? Math.round((enviados + (c.falhas ? c.falhas.length : 0)) / total * 100) : 0;
    const est = (c.status === 'pronta' || c.status === 'pausada' || c.status === 'enviando') ? estimarCampanha(c) : null;
    const podeIniciar = (c.status === 'pronta' || c.status === 'pausada') && (c.pendentes || []).length;
    const podePausar = c.status === 'enviando';
    const variacoes = (c.variacoes || []).slice(0, 12).map((v, i) => `<div class="varItem" data-cid="${esc(c.id)}" data-idx="${i}" style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--linha);font-size:var(--fs-sm)"><b style="color:var(--teal-esc);flex:none">#${i + 1}</b><span class="varTxt" style="flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere">${esc(v)}</span><a href="javascript:void(0)" class="varEdit" onclick="editarVar(this)" title="Editar esta variação" style="flex:none;text-decoration:none;font-size:.95rem">✏️</a><a href="javascript:void(0)" class="varDel" onclick="excluirVar(this)" title="Excluir esta variação" style="flex:none;text-decoration:none;font-size:.95rem">🗑️</a></div>`).join('');
    const btn = (acao, rot, cls) => `<form method="POST" action="/sofia/campanhas/${acao === 'excluir' ? 'excluir' : 'controle'}"${acao === 'cancelar' || acao === 'excluir' ? ` onsubmit="return confirm('${acao === 'excluir' ? 'Excluir esta campanha do painel?' : 'Cancelar o envio desta campanha?'}')"` : ''} style="display:inline"><input type="hidden" name="id" value="${esc(c.id)}">${acao !== 'excluir' ? `<input type="hidden" name="acao" value="${acao}">` : ''}<button type="submit" class="${cls}" style="padding:5px 12px;font-size:var(--fs-sm)">${rot}</button></form>`;
    return `<div class="card">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <a href="javascript:void(0)" onclick="abrirCampDetalhe('${esc(c.id)}')" style="font-weight:700;font-size:var(--fs-h2);color:var(--teal-esc);text-decoration:none;cursor:pointer" title="Ver detalhes do envio">${esc(c.nome)}</a>
        <span class="pill" style="border-color:var(--linha)">🏷️ ${esc(c.tag)}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 0">
        ${c.fotoArquivo ? '<span class="pill" style="border-color:var(--linha)">📷 com foto</span>' : ''}
        <span class="quando" style="margin:0">${rotStatus[c.status] || c.status}${(c.status === 'pausada' && (c.falhasSeguidas || 0) >= 3) ? ' <span style="color:var(--erro)">(pausada por falhas — verifique a conexão)</span>' : ''}</span>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${podeIniciar ? btn('iniciar', '▶️ Iniciar', 'save') : ''}
          ${((c.pendentes || []).length && c.status !== 'cancelada') ? `<button type="button" class="save" style="padding:5px 12px;font-size:var(--fs-sm);background:var(--coral,#c0453f)" title="Disparar N mensagens agora, ignorando o teto do dia e o horário" onclick="cpEnviarAgora('${esc(c.id)}',${(c.pendentes || []).length})">🚀 Enviar agora</button>` : ''}
          ${podePausar ? btn('pausar', '⏸️ Pausar', 'reset') : ''}
          ${(c.status !== 'concluida' && c.status !== 'cancelada') ? btn('cancelar', '🚫 Cancelar', 'reset') : ''}
          ${btn('excluir', '🗑️ Excluir', 'reset')}
          ${(c.variacoes || []).length ? `<a href="javascript:void(0)" onclick="var d=this.closest('.card').querySelector('.vars-'+'${esc(c.id)}');if(d)d.style.display=d.style.display==='none'?'block':'none'" class="quando" style="margin:0;text-decoration:underline">ver variações (${(c.variacoes || []).length})</a>` : ''}
        </div>
      </div>
      <div style="margin:8px 0 0">
        ${uiTrilho(pct, 100, { cor: 'var(--ok)' })}
        <div class="quando" style="margin:4px 0 0">${enviados} enviadas · ${(c.pendentes || []).length} na fila · ${(c.falhas || []).length} falha(s) · ${total} no total · hoje: ${c.enviadosHoje || 0}/${c.limiteDia}</div>
        <div class="quando" style="margin:2px 0 0">📅 início ${esc(fmtDataBR(c.dataInicio))} · das ${esc(c.janelaIni)} às ${esc(c.janelaFim)} · ${c.delayMinSeg}–${c.delayMaxSeg}s entre envios${est ? ` · <b>término previsto ${est.fim}</b> (~${est.dias} dia${est.dias > 1 ? 's' : ''}, ~${est.porDia}/dia)` : ''} ${(c.status !== 'concluida' && c.status !== 'cancelada') ? `· <a href="javascript:void(0)" onclick="toggleRitmo('${esc(c.id)}')" style="text-decoration:underline">⚙️ ajustar ritmo</a>` : ''}</div>
      </div>
      <div class="ritmoBox-${esc(c.id)}" style="display:none;margin:8px 0 0;background:var(--bg);border:1px solid var(--linha);border-radius:10px;padding:10px 12px">
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
          <div><label style="margin:0 0 3px;font-size:.72rem;font-weight:700;color:var(--cinza)">Entre envios (seg) ${avisoI('<b>Risco de suspensão.</b> Intervalo curto demais é o principal motivo de bloqueio do número. Mantenha <b>120 a 180s ou mais</b> para imitar o ritmo de uma pessoa e proteger a conta.')}</label><div style="display:flex;gap:6px;align-items:center"><input type="number" min="1" max="3600" value="${c.delayMinSeg}" id="rmin-${esc(c.id)}" style="width:72px"><span class="quando" style="margin:0">a</span><input type="number" min="1" max="3600" value="${c.delayMaxSeg}" id="rmax-${esc(c.id)}" style="width:72px"></div></div>
          <div><label style="margin:0 0 3px;font-size:.72rem;font-weight:700;color:var(--cinza)">Máx. por dia</label><input type="number" min="1" max="1000" value="${c.limiteDia}" id="rlim-${esc(c.id)}" style="width:84px"></div>
          <div><label style="margin:0 0 3px;font-size:.72rem;font-weight:700;color:var(--cinza)">Janela</label><div style="display:flex;gap:6px;align-items:center"><input type="time" value="${esc(c.janelaIni)}" id="rji-${esc(c.id)}" style="width:auto"><span class="quando" style="margin:0">às</span><input type="time" value="${esc(c.janelaFim)}" id="rjf-${esc(c.id)}" style="width:auto"></div></div>
          <button type="button" class="save" style="padding:6px 13px" onclick="salvarRitmo('${esc(c.id)}')">Salvar ritmo</button>
          <a href="javascript:void(0)" onclick="toggleRitmo('${esc(c.id)}')" class="quando" style="margin:0;text-decoration:underline">cancelar</a>
        </div>
        <div class="quando" style="margin:7px 0 0">💡 Intervalo maior ou teto/dia menor é <b>mais seguro</b> para o número — e aumenta o término previsto. Vale para os próximos envios.</div>
      </div>
      <div class="vars-${esc(c.id)}" style="display:none;margin-top:8px">${variacoes}</div>
    </div>`;
  }).join('');
}

// Aba SoFIA → Tags: criar, renomear, excluir e automatizar tags (antes ficava
// como card dentro de Contatos; virou sub-aba própria entre Contatos e Campanhas).
function paginaSofiaTags(aviso, erro) {
  const tags = contatos.tagsDistintas();
  // Presença da experimental (troca de tags): mora nesta aba (Tags) por ser sobre tags.
  const cmp = lerCompCfg();
  const atCfg = autoTagAlunas.ler(); // auto-tag Aluna/Ex-aluna (roda junto da planilha)
  let cmpH = null; try { cmpH = horarios.listar().find(j => j.chave === 'comparecimento'); } catch (_) {}
  const cmpHoraBloco = cmpH ? `<div class="hsec"><div class="hsec-t">Quando roda ${cmpH.editado ? '<span class="badge-ed">alterado</span>' : ''}</div>${blocoHorario(cmpH, '', 'formCmp')}</div>` : '';
  const cmpTags = tags.map(t => t.tag);
  const cmpSel = (val) => { const opts = ['<option value="">— escolha —</option>'].concat(cmpTags.map(t => `<option value="${esc(t)}"${t === val ? ' selected' : ''}>${esc(t)}</option>`)); if (val && !cmpTags.includes(val)) opts.push(`<option value="${esc(val)}" selected>${esc(val)} (atual)</option>`); return opts.join(''); };
  // Lista de checkboxes p/ escolher VÁRIAS tags de origem ("agendou").
  const cmpChecks = (sel) => { const arr = Array.isArray(sel) ? sel : (sel ? [sel] : []); const selL = new Set(arr.map(x => String(x).trim().toLowerCase())); let opts = cmpTags.slice(); for (const s of arr) { if (!opts.some(x => x.toLowerCase() === String(s).toLowerCase())) opts = [s].concat(opts); } return opts.length ? opts.map(t => `<label class="chk" style="margin:0;font-weight:500"><input type="checkbox" name="tagsAgendou" value="${esc(t)}"${selL.has(String(t).trim().toLowerCase()) ? ' checked' : ''}> ${esc(t)}</label>`).join('') : '<span class="quando" style="margin:0">Nenhuma tag no CRM ainda.</span>'; };
  const lista = tags.length
    ? tags.map((t, i) => { const cfg = contatos.tagConfig(t.tag); const on = (cfg.gatilho || cfg.remove.length); return `<div class="tagrow">
      <form method="POST" action="/sofia/contatos/tag">
        <input type="hidden" name="de" value="${esc(t.tag)}"><input type="hidden" name="voltar" value="tags">
        <input type="text" name="para" value="${esc(t.tag)}">
        <span class="tagn">${t.n}</span>
        <button type="submit" class="tagbtn ren" name="acao" value="renomear">Renomear</button>
        <button type="submit" class="tagbtn rm" name="acao" value="excluir" onclick="return confirm('Excluir a tag em TODOS os contatos?')">Excluir</button>
      </form>
      <button type="button" class="tagbtn aut${on ? ' on' : ''}" onclick="abrirTagCfg(${i})" title="Automação desta tag">⚙️ Automação${on ? ' ⚡' : ''}</button>
    </div>`; }).join('')
    : '<p class="quando" style="margin:0">Nenhuma tag ainda. Crie uma acima ou etiquete um contato na aba Contatos.</p>';

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('tags')}
    ${uiTopo({ titulo: 'Tags', sub: 'Criar, renomear, excluir ou automatizar as etiquetas dos contatos (ex.: aplicar sozinha quando a aluna agenda e avisar a recepção).', acoes: '<button type="button" class="ui-btn" onclick="criarTagNova()">＋ Criar tag</button>' })}
    <div class="sec-t">Suas tags</div>
    <div class="card">
      ${lista}
    </div>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">Alunas / Ex-alunas automáticas <small style="font-weight:400;color:var(--cinza)">— junto da planilha (1x/dia), etiqueta pelo EVO</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Toda vez que a <b>planilha de aniversários</b> roda (1x/dia), o robô também <b>etiqueta o CRM da SoFIA</b> pela situação no EVO: quem tem <b>contrato vigente</b> (aluna ativa — "SIM" na planilha) recebe a tag de <b>aluna</b> (<b>cadastra o contato</b> se ainda não existir); quem <b>saiu</b> (perdeu o vínculo) recebe a de <b>ex-aluna</b>. Casa por <b>telefone</b>. <b>Trava de segurança:</b> se a leitura do EVO vier suspeita, <b>não rebaixa</b> ninguém para ex-aluna. Só age <b>daqui pra frente</b> (quem já saiu antes e nunca teve a tag de aluna não é mexido).</p>
        <form method="POST" action="/sofia/auto-tag-alunas">
          <label class="chk" style="margin:0 0 12px"><input type="checkbox" name="on" value="1"${atCfg.on ? ' checked' : ''}> Ligado</label>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Aluna ativa (contrato vigente) → tag</label><select name="tagAluna">${cmpSel(atCfg.tagAluna)}</select></div>
            <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Sem vínculo (saiu) → tag</label><select name="tagExAluna">${cmpSel(atCfg.tagExAluna)}</select></div>
          </div>
          <div class="acts" style="margin-top:12px"><button type="submit" class="save">Salvar</button></div>
        </form>
        <p class="quando" style="margin:10px 0 0">🧪 Para <b>testar antes</b> sem gravar nada, rode na VPS, em <code>~/SF-Chat_Experimental-Mensagens/Experimental</code>: <code>xvfb-run -a node src/planilha-aniversarios.js --dry</code> — no fim ele mostra quantas viraram "0. Aluna"/"0. Ex Aluna" (SIMULAÇÃO).</p>
      </div>
    </details>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">Presença da experimental (troca de tags) <small style="font-weight:400;color:var(--cinza)">— 1x/semana, cruza a presença no EVO e atualiza as tags</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">No <b>dia/horário definidos abaixo</b>, o robô lê a <b>presença/falta</b> das aulas experimentais no <b>EVO</b> e troca as tags de quem estava com a tag de <b>agendou</b>: quem <b>compareceu</b> vira "fez aula" e quem <b>faltou</b> vira "encerrado sem presença". As outras tags (manuais) não são tocadas.</p>
        <form method="POST" action="/sofia/comparecimento" id="formCmp">
          <label class="chk" style="margin:0 0 12px"><input type="checkbox" name="on" value="1"${cmp.on ? ' checked' : ''}> Ligado</label>
          <div style="margin-bottom:12px">
            <label style="margin:0 0 4px">Tags de "agendou" (origem) <small style="font-weight:400;color:var(--cinza)">— pode marcar <b>várias</b>; o robô age em quem tem <b>qualquer uma</b> delas</small></label>
            <div class="cfg-in" style="flex-direction:column;align-items:flex-start;gap:6px;max-height:180px;overflow:auto;padding:8px 10px">${cmpChecks(cmp.tagsAgendou)}</div>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Compareceu → vira</label><select name="tagCompareceu">${cmpSel(cmp.tagCompareceu)}</select></div>
            <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Faltou → vira</label><select name="tagFaltou">${cmpSel(cmp.tagFaltou)}</select></div>
          </div>
          <label class="chk" style="margin:14px 0 0"><input type="checkbox" name="criarNovos" value="1"${cmp.criarNovos ? ' checked' : ''}> Cadastrar na SoFIA quem fez a experimental e ainda não existe <small style="font-weight:400;color:var(--cinza)">(entrou por outro canal — assim pode receber campanhas)</small></label>
          <label style="margin:14px 0 4px">Olhar quantos dias para trás ${infoI('Quantos dias de presença o robô lê no EVO a cada rodada. Se roda <b>todo dia</b>, 2 já basta (menos consulta ao EVO). Se roda <b>1x/semana</b>, use 7. (1 a 31)')}</label>
          <div style="display:flex;align-items:center;gap:8px"><input type="number" name="diasJanela" min="1" max="31" value="${esc(cmp.diasJanela)}" style="max-width:90px"><span class="quando" style="margin:0">dia(s) — dica: diário → 2 · semanal → 7</span></div>
          <label style="margin:14px 0 4px">Número que recebe o relatório <small style="font-weight:400;color:var(--cinza)">(opcional — resumo do que foi trocado)</small></label>
          <input type="tel" name="numeroRelatorio" value="${esc(cmp.numeroRelatorio)}" placeholder="Ex.: 62998887777" style="max-width:220px">
          ${cmpHoraBloco}
          <label style="margin:14px 0 4px">Repetir várias vezes ao dia ${infoI('0 = roda só no horário acima. Se quiser <b>mais de uma vez por dia</b>, ponha de quantas em quantas horas: <b>8</b> = 3x/dia · <b>6</b> = 4x/dia · <b>4</b> = 6x/dia · <b>2</b> = 12x/dia. Mantém o minuto e os dias do horário acima.')}</label>
          <div style="display:flex;align-items:center;gap:8px"><span class="quando" style="margin:0">a cada</span><input type="number" name="intervaloHoras" min="0" max="24" value="${esc(cmp.intervaloHoras)}" style="max-width:80px"><span class="quando" style="margin:0">horas — <b>0 = só no horário acima</b>; 8 = 3x/dia; 6 = 4x/dia</span></div>
          <div class="acts" style="margin-top:14px"><button type="submit" class="save">Salvar</button></div>
        </form>
        <p class="quando" style="margin:12px 0 0">🧪 Para <b>testar antes</b> sem alterar nada (só mostra o que faria), rode na VPS, em <code>~/SF-Chat_Experimental-Mensagens/Experimental</code>: <code>HEADLESS=true node src/comparecimento.js --dry</code>. Se o EVO bloquear o modo sem tela, use <code>xvfb-run -a node src/comparecimento.js --dry</code>. Trocar <code>--dry</code> por <code>--run</code> executa de verdade. (O robô agendado não precisa disso — já roda com tela virtual.)</p>
      </div>
    </details>
  </div>

  <div id="tgModal" class="ct-ov" onclick="if(event.target===this)fecharTagCfg()">
    <div class="ct-dlg" style="max-width:520px">
      <div class="ct-dh"><h2>Automação da tag</h2><button type="button" class="ct-x" onclick="fecharTagCfg()">×</button></div>
      <p class="quando" style="margin:0 0 14px">Tag: <b id="tgNome" style="color:var(--teal-esc)"></b></p>
      <label>Aplicar esta tag automaticamente quando…</label>
      <select id="tgGatilho" onchange="tgSync()">
        <option value="">— não automatizar (só uso manual) —</option>
        <option value="novo">🆕 a aluna mandar a 1ª mensagem (lead novo)</option>
        <option value="mensagem">💬 a pessoa mandar qualquer mensagem (novo ou retorno)</option>
        <option value="palavra">🔑 a aluna escrever uma palavra-chave</option>
        <option value="ia">🧠 a SoFIA entender uma intenção (você descreve)</option>
        <option value="agendou">📅 agendar uma aula experimental (a SoFIA ou você pelo botão)</option>
        <option value="humano">🙋 você assumir a conversa (controle humano)</option>
        <option value="encerrou">🔒 a conversa encerrar sem agendamento</option>
        <option value="campanha">💬 a aluna responder a uma campanha</option>
        <option value="anuncio">📣 o lead vier de um anúncio (patrocinado)</option>
      </select>
      <div id="tgPalBox" style="margin-top:14px;display:none">
        <label>Palavras-chave <span class="sub" style="font-weight:400;color:var(--cinza)">— separadas por vírgula (ex.: cancelar, valor, reclamação, endereço)</span></label>
        <input type="text" id="tgPalavras" placeholder="cancelar, valor, endereço">
        <p class="quando" style="margin:6px 0 0">Dispara quando a mensagem da aluna <b>contém</b> qualquer uma delas (não diferencia maiúsculas/acentos simples).</p>
      </div>
      <div id="tgIaBox" style="margin-top:14px;display:none">
        <label>Instrução <span class="sub" style="font-weight:400;color:var(--cinza)">— descreva a intenção, em português (ex.: quando a aluna perguntar sobre preço, valores ou planos)</span></label>
        <textarea id="tgInstrucao" rows="6" maxlength="2000" placeholder="Ex.: quando a aluna perguntar sobre preço, valores, mensalidade ou planos." style="width:100%;resize:vertical"></textarea>
        <p class="quando" style="margin:6px 0 0">A SoFIA <b>lê a conversa</b> e aplica a tag quando entende essa intenção — mesmo sem a palavra exata. Dispara <b>uma vez por conversa</b>. Usa a IA (custo pequeno por mensagem).</p>
      </div>
      <div id="tgCampBox" style="margin-top:14px;display:none">
        <label>De qual campanha? <span class="sub" style="font-weight:400;color:var(--cinza)">— a tag só entra para quem respondeu ESTA campanha</span></label>
        <select id="tgCampanha" style="width:100%"></select>
        <p class="quando" style="margin:6px 0 0">Escolha a campanha. A tag só é aplicada a quem <b>recebeu e respondeu</b> a ela. <b>"Qualquer campanha"</b> é o comportamento antigo (vale para quem respondeu qualquer campanha — inclusive testes).</p>
      </div>
      <div id="tgWppBox" style="margin-top:16px;display:none">
        <label>Avisar no WhatsApp <span class="sub" style="font-weight:400;color:var(--cinza)">— número que recebe o recado (nome + telefone)</span></label>
        <input type="tel" id="tgWpp" placeholder="(62) 99999-9999" inputmode="tel">
        <p class="quando" style="margin:6px 0 0">Deixe em branco para só etiquetar, sem avisar ninguém.</p>
      </div>
      <div id="tgExigeBox" style="margin-top:16px;display:none">
        <label>Só para quem já tem a tag <span class="sub" style="font-weight:400;color:var(--cinza)">— opcional; vale se tiver qualquer uma das marcadas</span></label>
        <div id="tgExige" class="ct-tglist" style="max-height:150px;overflow:auto"></div>
        <p class="quando" style="margin:6px 0 0">Sem nenhuma marcada, vale para qualquer pessoa. Ex.: marque <b>0. Aluna</b> e <b>0. Ex Aluna</b> para avisar a recepção só quando uma aluna escrever (com o gatilho "qualquer mensagem").</p>
      </div>
      <div id="tgEncBox" style="margin-top:16px;display:none">
        <label class="chk" style="margin:0"><input type="checkbox" id="tgEncerrar"> 🔒 Encerrar a conversa ao aplicar esta tag</label>
        <p class="quando" style="margin:6px 0 0">A SoFIA <b>fecha a conversa</b> (como o cadeado): o <b>follow-up para de incomodar</b> e, se a aluna voltar a escrever, a SoFIA <b>recomeça do zero</b>. Ideal para "Sem interesse", "Já treina em outro lugar" etc.</p>
      </div>
      <div style="margin-top:16px">
        <label>Ao aplicar esta tag, remover <span class="sub" style="font-weight:400;color:var(--cinza)">— transição de funil (ex.: entrar em "Agendou" tira "Contato inicial")</span></label>
        <div id="tgRemove" class="ct-tglist" style="max-height:150px;overflow:auto"></div>
      </div>
      <div class="ct-foot">
        <button type="button" class="reset" onclick="fecharTagCfg()" style="padding:9px 16px">Cancelar</button>
        <button type="button" class="save" id="tgSalvar" onclick="salvarTagCfg()" style="padding:9px 18px">Salvar</button>
      </div>
    </div>
  </div>
<script>
  function esc(s){return String(s).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  var TAGS_CFG = ${JSON.stringify(tags.map(t => { const c = contatos.tagConfig(t.tag); return { tag: t.tag, gatilho: c.gatilho, palavras: c.palavras, instrucao: c.instrucao, camp: c.campanhaId, wpp: c.avisarWpp, remove: c.remove, exige: c.exige, enc: c.encerrar }; }))};
  var TODAS_TAGS_LISTA = ${JSON.stringify(tags.map(t => t.tag))};
  var CAMPS_LISTA = ${JSON.stringify((() => { try { return sofia.lerCampanhas().map(c => ({ id: String(c.id), nome: String(c.nome || 'Campanha') })); } catch (_) { return []; } })())};
  var tgRemove = [], tgExige = [];
  var tgSel=null;
  function abrirTagCfg(i){
    var c=TAGS_CFG[i]; if(!c) return; tgSel=c;
    document.getElementById('tgNome').textContent=c.tag;
    document.getElementById('tgGatilho').value=c.gatilho||'';
    document.getElementById('tgPalavras').value=(c.palavras||[]).join(', ');
    document.getElementById('tgInstrucao').value=c.instrucao||'';
    document.getElementById('tgWpp').value=c.wpp||'';
    document.getElementById('tgEncerrar').checked=!!c.enc;
    tgFillCamps(c.camp||'');
    tgRemove=(c.remove||[]).slice();
    tgRenderRemove();
    tgExige=(c.exige||[]).slice();
    tgRenderExige();
    tgSync();
    document.getElementById('tgModal').style.display='flex';
  }
  function tgRenderRemove(){
    var box=document.getElementById('tgRemove');
    var outras=TODAS_TAGS_LISTA.filter(function(t){return !tgSel||t!==tgSel.tag;});
    if(!outras.length){ box.innerHTML='<span class="quando">Nenhuma outra tag ainda.</span>'; return; }
    box.innerHTML=outras.map(function(t){
      var on=tgRemove.indexOf(t)>=0;
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" style="'+(on?'background:var(--erro-bg);color:#c0392b;border-color:#f5c6cb':'background:#fff;color:#5c5960;border-color:#e8e8ea')+'" onclick="tgToggleRemove(this,\\''+t.replace(/'/g,"\\\\'")+'\\')">'+(on?'✕ ':'')+esc(t)+'</button>';
    }).join('');
  }
  function tgToggleRemove(btn,t){ var i=tgRemove.indexOf(t); if(i>=0)tgRemove.splice(i,1); else tgRemove.push(t); tgRenderRemove(); }
  function tgRenderExige(){
    var box=document.getElementById('tgExige');
    var outras=TODAS_TAGS_LISTA.filter(function(t){return !tgSel||t!==tgSel.tag;});
    if(!outras.length){ box.innerHTML='<span class="quando">Nenhuma outra tag ainda.</span>'; return; }
    box.innerHTML=outras.map(function(t,i){
      var on=tgExige.indexOf(t)>=0;
      return '<button type="button" class="ct-tg'+(on?' on':'')+'" data-i="'+i+'" style="'+(on?'background:var(--teal-soft);color:var(--teal-esc);border-color:var(--teal)':'background:#fff;color:#5c5960;border-color:#e8e8ea')+'">'+(on?'✓ ':'')+esc(t)+'</button>';
    }).join('');
    [].forEach.call(box.querySelectorAll('button'),function(b){ b.onclick=function(){ var t=outras[+b.getAttribute('data-i')], k=tgExige.indexOf(t); if(k>=0)tgExige.splice(k,1); else tgExige.push(t); tgRenderExige(); }; });
  }
  function tgFillCamps(sel){
    var s=document.getElementById('tgCampanha'); if(!s) return;
    var opts='<option value="">— qualquer campanha (comportamento antigo) —</option>';
    (CAMPS_LISTA||[]).forEach(function(c){ opts+='<option value="'+esc(c.id)+'">'+esc(c.nome)+'</option>'; });
    // Campanha amarrada que já não está na lista (foi excluída): mantém a opção.
    if(sel && !(CAMPS_LISTA||[]).some(function(c){return String(c.id)===String(sel);})) opts+='<option value="'+esc(sel)+'">campanha removida ('+esc(sel)+')</option>';
    s.innerHTML=opts; s.value=sel||'';
  }
  function tgSync(){
    var g=document.getElementById('tgGatilho').value;
    document.getElementById('tgPalBox').style.display=(g==='palavra')?'block':'none';
    document.getElementById('tgIaBox').style.display=(g==='ia')?'block':'none';
    document.getElementById('tgCampBox').style.display=(g==='campanha')?'block':'none';
    document.getElementById('tgWppBox').style.display=g?'block':'none';
    document.getElementById('tgEncBox').style.display=g?'block':'none';
    document.getElementById('tgExigeBox').style.display=g?'block':'none';
  }
  function fecharTagCfg(){ document.getElementById('tgModal').style.display='none'; tgSel=null; }
  function salvarTagCfg(){
    if(!tgSel) return;
    var g=document.getElementById('tgGatilho').value;
    if(g==='palavra' && !document.getElementById('tgPalavras').value.trim()){ alert('Informe ao menos uma palavra-chave.'); return; }
    if(g==='ia' && !document.getElementById('tgInstrucao').value.trim()){ alert('Descreva a intenção na instrução (ex.: quando a aluna perguntar sobre preço).'); return; }
    var b=document.getElementById('tgSalvar'); b.disabled=true; b.textContent='Salvando…';
    var pals=document.getElementById('tgPalavras').value.split(',').map(function(s){return s.trim();}).filter(Boolean);
    var d={ tag:tgSel.tag, gatilho:g, palavras:pals, instrucao:document.getElementById('tgInstrucao').value, campanhaId:(g==='campanha'?document.getElementById('tgCampanha').value:''), avisarWpp:document.getElementById('tgWpp').value, remove:tgRemove, exige:tgExige, encerrar:document.getElementById('tgEncerrar').checked };
    fetch('/sofia/contatos/tagcfg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { b.disabled=false; b.textContent='Salvar'; alert('❌ '+(j.erro||'falha ao salvar')); } })
      .catch(function(){ b.disabled=false; b.textContent='Salvar'; alert('❌ erro de rede'); });
  }
  function criarTagNova(){
    var nome=prompt('Nome da nova tag:'); if(nome==null) return;
    nome=nome.trim(); if(!nome) return;
    fetch('/sofia/contatos/criar-tag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome:nome})})
      .then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.reload(); } else { alert('❌ '+(j.erro||'falha ao criar')); } })
      .catch(function(){ alert('❌ erro de rede'); });
  }
</script>`;
  return chrome({ tab: 'Tags', h1: 'SoFIA', p: 'Tags — crie, renomeie, exclua e automatize as etiquetas dos contatos.' }, 'sofia', corpo);
}

// Aba SoFIA → Campanhas: envio em massa por tag (com variações da IA e limites).
function paginaSofiaCampanhas(aviso, erro) {
  const tags = contatos.tagsDistintas();

  const opcoesTag = tags.length
    ? '<option value="" disabled selected>— escolha uma tag —</option>' + tags.map(t => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`).join('')
    : '';
  // Modelos de IA (mesma lista da Configuração) para escolher no "Gerar frase".
  let modelosIA = []; try { modelosIA = sofia.MODELOS_VALIDOS || []; } catch (_) {}
  let modeloPadraoFrase = ''; try { const h = (modelosIA.find(m => /haiku/i.test(m.id)) || {}).id; modeloPadraoFrase = h || (sofia.lerModelos() || {}).extracao || ''; } catch (_) {}
  const optModelosFrase = modelosIA.map(m => `<option value="${esc(m.id)}"${m.id === modeloPadraoFrase ? ' selected' : ''}>${esc(m.rot)}</option>`).join('');

  const novo = `
    <div class="sec-t">Nova campanha</div>
    <div class="card">
      ${tags.length ? `<form id="cpForm" onsubmit="return enviarCampanha(event)">
        <div class="cpf-sec first">
          <div class="cpf-h">Mensagem</div>
          <div class="cpf-grid">
            <div class="cpf-field"><label>Nome da campanha</label><input type="text" name="nome" placeholder="ex.: Reativação outubro" required></div>
            <div class="cpf-field"><label>Enviar para a tag</label><select name="tag" required style="text-overflow:ellipsis">${opcoesTag}</select></div>
          </div>
          <details class="cpf-acc" style="margin-top:14px">
            <summary class="cpf-sum">✨ Deixe a SoFIA escrever <span class="sub quando" style="margin:0">— diga o que você quer e ela cria a frase para você revisar</span></summary>
            <div class="cpf-body">
              <textarea id="cpInstr" rows="2" placeholder="Ex.: quero uma campanha promocional enfatizando o nosso treino — uma excelente oportunidade para vivenciar o SlimFit!"></textarea>
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
                <button type="button" id="cpGerarBtn" class="reset" onclick="gerarFraseCampanha()" style="padding:9px 16px;flex:none">✨ Gerar frase</button>
                <select id="cpFraseModelo" title="Modelo da IA usado para gerar a frase" style="flex:1;min-width:170px;padding:7px 9px">${optModelosFrase}</select>
                <span id="cpGerarMsg" class="quando" style="margin:0;flex-basis:100%"></span>
              </div>
              <p class="quando" style="margin:8px 0 0">A frase gerada cai no campo <b>Mensagem base</b> para você <b>ajustar antes de criar</b>. Depois, a IA ainda cria ~10 variações naturais dela no envio.</p>
            </div>
          </details>
          <div class="cpf-field" style="margin-top:14px">
            <label>Mensagem base <span class="sub">— a IA cria ~10 variações naturais a partir dela</span></label>
            <textarea name="textoBase" rows="4" placeholder="Escreva como você mandaria para uma aluna…  Use {nome} para personalizar (ex.: Oi, {nome}!)" required></textarea>
            <p class="quando" style="margin:6px 0 0">💡 <b>{nome}</b> vira o primeiro nome do contato. Quem não tem nome salvo recebe a versão sem o nome.</p>
          </div>
          <div class="cpf-field" style="margin-top:14px">
            <label>Foto <span class="sub">— opcional, enviada junto com a mensagem como legenda</span></label>
            <input type="file" id="cpFoto" accept="image/*" onchange="prevFoto()" style="padding:8px">
            <div id="cpFotoPrev" style="display:none;margin-top:8px"><img id="cpFotoImg" alt="prévia" style="max-width:180px;max-height:180px;border-radius:10px;border:1px solid var(--linha)"><br><a href="javascript:void(0)" onclick="limpaFoto()" class="quando" style="text-decoration:underline">remover foto</a></div>
          </div>
        </div>

        <details class="cpf-acc">
          <summary class="cpf-sum">Ritmo e limites ${avisoI('<b>Risco de suspensão do WhatsApp.</b> Enviar muitas mensagens, rápido demais ou para quem nunca te respondeu pode fazer o número ser bloqueado (24h ou até em definitivo). Para reduzir o risco: mantenha o intervalo alto (<b>120 a 180s ou mais</b>), um <b>máximo por dia baixo</b>, use as variações da IA e envie de preferência só para quem já falou com você.')} <span class="sub quando" style="margin:0">— já vem com um ritmo seguro; abra para ajustar</span></summary>
          <div class="cpf-body">
          <div class="cpf-grid-lim">
            <div class="cpf-field"><label>Começar em</label><input type="date" id="cpIni" name="dataInicio" value="${esc(hojeSP())}" min="${esc(hojeSP())}" oninput="estCamp()"></div>
            <div class="cpf-field"><label>Máx. por dia</label><div class="cpf-range"><input type="number" id="cpMax" name="limiteDia" min="1" max="1000" value="40" oninput="estCamp()"><span class="cpf-suf">msg</span></div></div>
            <div class="cpf-field"><label>Horário de envio</label><div class="cpf-range"><input type="time" id="cpJi" name="janelaIni" value="09:00" oninput="estCamp()"><span class="cpf-suf">até</span><input type="time" id="cpJf" name="janelaFim" value="20:00" oninput="estCamp()"></div></div>
            <div class="cpf-field"><label>Intervalo entre envios ${avisoI('<b>Não deixe muito curto.</b> Um intervalo baixo é o principal motivo de o WhatsApp bloquear o número. O padrão <b>120 a 180s</b> imita o tempo de digitação de uma pessoa e é bem mais seguro.')}</label><div class="cpf-range"><input type="number" id="cpDmin" name="delayMinSeg" min="1" max="3600" value="120" oninput="estCamp()"><span class="cpf-suf">a</span><input type="number" id="cpDmax" name="delayMaxSeg" min="1" max="3600" value="180" oninput="estCamp()"><span class="cpf-suf">s</span></div></div>
          </div>
          <div class="cpf-field" style="margin-top:14px">
            <label>Dias da semana <span class="sub">— só envia nos dias marcados</span></label>
            <div class="dias" id="cpDias">
              <label><input type="checkbox" class="cpDia" value="0" checked onchange="estCamp()"><span>Dom</span></label>
              <label><input type="checkbox" class="cpDia" value="1" checked onchange="estCamp()"><span>Seg</span></label>
              <label><input type="checkbox" class="cpDia" value="2" checked onchange="estCamp()"><span>Ter</span></label>
              <label><input type="checkbox" class="cpDia" value="3" checked onchange="estCamp()"><span>Qua</span></label>
              <label><input type="checkbox" class="cpDia" value="4" checked onchange="estCamp()"><span>Qui</span></label>
              <label><input type="checkbox" class="cpDia" value="5" checked onchange="estCamp()"><span>Sex</span></label>
              <label><input type="checkbox" class="cpDia" value="6" checked onchange="estCamp()"><span>Sáb</span></label>
            </div>
          </div>
          <p class="quando" style="margin:10px 0 0">Intervalo aleatório entre cada mensagem — quanto maior, mais natural e seguro.</p>
          </div>
        </details>
        <div id="cpEst" class="aviso" style="margin:14px 0 0;display:none"></div>

        <details class="cpf-acc">
          <summary class="cpf-sum">Variações da mensagem <span class="sub quando" style="margin:0">— veja e edite as ~10 versões antes de criar</span></summary>
          <div class="cpf-body">
            <p class="quando" style="margin:0 0 10px">A IA cria variações da <b>mensagem base</b> para o envio não parecer robô — cada aluna recebe uma versão. Gere aqui para <b>ver e ajustar</b> exatamente o que será enviado. Se você não gerar, a IA cria as variações sozinha ao criar a campanha.</p>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <button type="button" id="cpVarBtn" class="reset" onclick="gerarVariacoesCampanha()" style="padding:9px 16px;flex:none">✨ Gerar variações</button>
              <span id="cpVarMsg" class="quando" style="margin:0"></span>
            </div>
            <div id="cpVars" style="margin-top:12px;display:flex;flex-direction:column;gap:10px"></div>
            <button type="button" id="cpVarAdd" onclick="addVariacao('')" class="reset" style="display:none;padding:7px 14px;margin-top:10px;align-self:flex-start">＋ adicionar variação</button>
          </div>
        </details>

        <details class="cpf-acc">
          <summary class="cpf-sum">Testar e criar</summary>
          <div class="cpf-body">
          <p class="quando" style="margin:0 0 10px">Mande a mensagem (e a foto) para um número seu antes, pra conferir como chega.</p>
          <div class="cpf-range" style="flex-wrap:wrap">
            <input type="tel" id="cpTesteTel" placeholder="(62) 99999-9999" style="max-width:220px">
            <button type="button" class="reset" onclick="testarCampanha()" style="padding:9px 16px;flex:none">Enviar teste</button>
            <span id="cpTesteMsg" class="quando" style="margin:0"></span>
          </div>
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px">
            <button type="submit" class="save" style="padding:11px 24px">Criar campanha</button>
            <span class="quando" style="margin:0;flex:1;min-width:220px">⚠️ Só envia depois de você clicar em <b>Iniciar</b>. Comece com poucos por dia e delays altos — envio em massa pode bloquear o número.</span>
          </div>
          </div>
        </details>
        <script>
          var TAGN = ${JSON.stringify(Object.fromEntries(tags.map(t => [t.tag, t.n])))};
          function selTagEl(){ return document.querySelector('select[name=tag]'); }
          function mm(h){ var p=String(h||'').split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
          function fmtD(d){ return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear(); }
          function estCamp(){
            var el=document.getElementById('cpEst'); if(!el) return;
            var tag=selTagEl()?selTagEl().value:''; var n=TAGN[tag]||0;
            if(!n){ el.style.display='none'; return; }
            var maxd=Math.max(1,parseInt(document.getElementById('cpMax').value,10)||1);
            var dmin=Math.max(1,parseInt(document.getElementById('cpDmin').value,10)||1);
            var dmax=Math.max(dmin,parseInt(document.getElementById('cpDmax').value,10)||dmin);
            var avg=(dmin+dmax)/2;
            var win=mm(document.getElementById('cpJf').value)-mm(document.getElementById('cpJi').value);
            if(win<=0){ el.style.display='block'; el.className='aviso err'; el.textContent='O horário "até" precisa ser depois do "das".'; return; }
            var maxWin=Math.max(1,Math.floor(win*60/avg));
            var porDia=Math.max(1,Math.min(maxd,maxWin));
            var sel=Array.prototype.map.call(document.querySelectorAll('.cpDia:checked'),function(e){return +e.value;});
            if(!sel.length){ el.style.display='block'; el.className='aviso err'; el.textContent='Escolha ao menos um dia da semana.'; return; }
            var envioDias=Math.max(1,Math.ceil(n/porDia)); // dias EM QUE haverá envio
            var ini=document.getElementById('cpIni').value; var d=ini?new Date(ini+'T12:00:00'):new Date();
            var contados=0,guarda=0;
            while(guarda<3660){ if(sel.indexOf(d.getDay())>=0){ contados++; if(contados>=envioDias) break; } d.setDate(d.getDate()+1); guarda++; }
            var restr=sel.length<7?' <span style="opacity:.8">('+sel.length+' dia'+(sel.length>1?'s':'')+'/semana)</span>':'';
            el.className='aviso'; el.style.display='block';
            el.innerHTML='📊 <b>'+n+' contatos</b> nesta tag · ~<b>'+porDia+'/dia</b> · <b>'+envioDias+' dia'+(envioDias>1?'s':'')+'</b> de envio · término previsto: <b>'+fmtD(d)+'</b>'+restr+(porDia<maxd?' <span style="opacity:.8">(a janela de horário limita a '+porDia+'/dia)</span>':'');
          }
          document.addEventListener('DOMContentLoaded',estCamp);
          var _st=selTagEl(); if(_st) _st.addEventListener('change',estCamp);
          function prevFoto(){ var f=document.getElementById('cpFoto').files[0]; var box=document.getElementById('cpFotoPrev'); if(!f){box.style.display='none';return;} var rd=new FileReader(); rd.onload=function(){ document.getElementById('cpFotoImg').src=rd.result; box.style.display='block'; }; rd.readAsDataURL(f); }
          var _gerando=false;
          function gerarFraseCampanha(){
            if(_gerando) return;
            var instr=(document.getElementById('cpInstr').value||'').trim();
            var msg=document.getElementById('cpGerarMsg'); var btn=document.getElementById('cpGerarBtn');
            if(!instr){ if(msg){msg.className='quando';msg.style.margin='0';msg.textContent='Escreva o que você quer que a SoFIA fale.';} return; }
            var mdlEl=document.getElementById('cpFraseModelo'); var mdl=mdlEl?mdlEl.value:'';
            _gerando=true; if(btn){btn.disabled=true;} if(msg){msg.textContent='✨ gerando… (uns segundos)';}
            fetch('/sofia/campanhas/rascunho',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instrucao:instr,model:mdl})})
              .then(function(r){return r.json();}).then(function(j){
                if(!j.ok){ throw new Error(j.erro||'falha'); }
                var tentativas=0;
                function poll(){
                  tentativas++;
                  if(tentativas>40){ fim('❌ demorou demais — tente de novo.'); return; }
                  fetch('/sofia/campanhas/rascunho?id='+encodeURIComponent(j.id),{cache:'no-store'})
                    .then(function(r){return r.json();}).then(function(rr){
                      if(rr && rr.pronto){
                        if(rr.texto){ document.querySelector('textarea[name=textoBase]').value=rr.texto; fim('✓ frase gerada — revise e ajuste abaixo.'); }
                        else { fim('❌ a SoFIA não conseguiu gerar. Tente reescrever o pedido.'); }
                      } else { setTimeout(poll,1200); }
                    }).catch(function(){ setTimeout(poll,1500); });
                }
                setTimeout(poll,1200);
              }).catch(function(e){ fim('❌ '+((e&&e.message)||'erro de rede')); });
            function fim(t){ _gerando=false; if(btn){btn.disabled=false;} if(msg){msg.textContent=t;} }
          }
          function renumVariacoes(){ var it=document.querySelectorAll('#cpVars .cpVarItem'); for(var i=0;i<it.length;i++){ var l=it[i].querySelector('.cpVarLbl'); if(l) l.textContent='Variação '+(i+1); } document.getElementById('cpVarAdd').style.display=it.length?'inline-block':'none'; }
          function addVariacao(t){
            var box=document.getElementById('cpVars'); if(!box) return;
            var wrap=document.createElement('div'); wrap.className='cpVarItem'; wrap.style.cssText='border:1px solid var(--linha);border-radius:10px;padding:8px 10px;background:#fff';
            var top=document.createElement('div'); top.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;gap:8px';
            var lbl=document.createElement('span'); lbl.className='quando cpVarLbl'; lbl.style.margin='0';
            var rm=document.createElement('a'); rm.href='javascript:void(0)'; rm.className='quando'; rm.style.cssText='text-decoration:underline;margin:0;flex:none'; rm.textContent='remover'; rm.onclick=function(){ wrap.parentNode.removeChild(wrap); renumVariacoes(); };
            top.appendChild(lbl); top.appendChild(rm);
            var ta=document.createElement('textarea'); ta.className='cpVarTa'; ta.rows=3; ta.style.cssText='width:100%;font-size:.9rem'; ta.value=t||'';
            wrap.appendChild(top); wrap.appendChild(ta); box.appendChild(wrap); renumVariacoes();
          }
          var _gerVars=false;
          function gerarVariacoesCampanha(){
            if(_gerVars) return;
            var texto=(document.querySelector('textarea[name=textoBase]').value||'').trim();
            var msg=document.getElementById('cpVarMsg'); var btn=document.getElementById('cpVarBtn');
            if(!texto){ if(msg)msg.textContent='Escreva (ou gere) a mensagem base primeiro.'; return; }
            var atuais=document.querySelectorAll('#cpVars .cpVarItem').length;
            if(atuais && !confirm('Gerar novas variações vai substituir as '+atuais+' que estão aí. Continuar?')) return;
            _gerVars=true; if(btn){btn.disabled=true;} if(msg){msg.textContent='✨ gerando ~10 variações… (uns segundos)';}
            fetch('/sofia/campanhas/variacoes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:texto})})
              .then(function(r){return r.json();}).then(function(j){
                if(!j.ok){ throw new Error(j.erro||'falha'); }
                var tentativas=0;
                function poll(){
                  tentativas++;
                  if(tentativas>50){ fim('❌ demorou demais — tente de novo.'); return; }
                  fetch('/sofia/campanhas/rascunho?id='+encodeURIComponent(j.id),{cache:'no-store'})
                    .then(function(r){return r.json();}).then(function(rr){
                      if(rr && rr.pronto){
                        var vs=(rr.variacoes||[]).filter(function(s){return String(s||'').trim();});
                        if(vs.length){ document.getElementById('cpVars').innerHTML=''; vs.forEach(function(v){ addVariacao(v); }); fim('✓ '+vs.length+' variações — revise e ajuste. Elas serão usadas no envio.'); }
                        else { fim('❌ a SoFIA não conseguiu gerar. Tente de novo.'); }
                      } else { setTimeout(poll,1200); }
                    }).catch(function(){ setTimeout(poll,1500); });
                }
                setTimeout(poll,1200);
              }).catch(function(e){ fim('❌ '+((e&&e.message)||'erro de rede')); });
            function fim(t){ _gerVars=false; if(btn){btn.disabled=false;} if(msg){msg.textContent=t;} }
          }
          function testarCampanha(){
            var tel=document.getElementById('cpTesteTel').value.replace(/\\D/g,''); var msg=document.getElementById('cpTesteMsg');
            var texto=document.querySelector('textarea[name=textoBase]').value.trim();
            if(!tel || tel.length<10){ if(msg)msg.textContent='Informe um número válido.'; return; }
            if(!texto){ if(msg)msg.textContent='Escreva a mensagem primeiro.'; return; }
            if(msg)msg.textContent='Enviando teste…';
            var d={ telefone:tel, texto:texto };
            function post(){ fetch('/sofia/campanhas/teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json();}).then(function(j){ if(msg)msg.textContent=j.ok?'✓ teste enviado (confira o WhatsApp).':'❌ '+(j.erro||'falha'); }).catch(function(){ if(msg)msg.textContent='❌ erro de rede'; }); }
            var file=document.getElementById('cpFoto').files[0];
            if(file){ if(file.size>10*1024*1024){ if(msg)msg.textContent='Imagem muito grande (máx. 10MB).'; return; } var rd=new FileReader(); rd.onload=function(){ d.fotoBase64=rd.result; post(); }; rd.readAsDataURL(file); }
            else post();
          }
          function limpaFoto(){ document.getElementById('cpFoto').value=''; document.getElementById('cpFotoPrev').style.display='none'; }
          function enviarCampanha(ev){
            ev.preventDefault();
            var f=ev.target;
            if(!f.tag.value){ alert('Escolha a tag para quem a campanha vai ser enviada.'); f.tag.focus(); return false; }
            var dias=Array.prototype.map.call(document.querySelectorAll('.cpDia:checked'),function(e){return +e.value;});
            if(!dias.length){ alert('Escolha ao menos um dia da semana para o envio.'); return false; }
            var variacoes=Array.prototype.map.call(document.querySelectorAll('#cpVars .cpVarTa'),function(e){return e.value.trim();}).filter(Boolean);
            if(!confirm('Criar a campanha e preparar o envio? Nada é enviado até você clicar em Iniciar.')) return false;
            var d={ nome:f.nome.value, tag:f.tag.value, textoBase:f.textoBase.value, limiteDia:f.limiteDia.value, delayMinSeg:f.delayMinSeg.value, delayMaxSeg:f.delayMaxSeg.value, janelaIni:f.janelaIni.value, janelaFim:f.janelaFim.value, dataInicio:f.dataInicio.value, dias:dias, variacoes:variacoes };
            var btn=f.querySelector('button[type=submit]'); if(btn){btn.disabled=true;btn.textContent='Criando…';}
            function post(){ fetch('/sofia/campanhas/criar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json();}).then(function(j){ if(j.ok){ location.href='/sofia?view=campanhas&okc=criada'; } else { alert(j.erro||'Erro ao criar campanha'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} } }).catch(function(){ alert('Erro de rede'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} }); }
            var file=document.getElementById('cpFoto').files[0];
            if(file){ if(file.size>10*1024*1024){ alert('Imagem muito grande (máx. 10MB).'); if(btn){btn.disabled=false;btn.textContent='Criar campanha';} return false; } var rd=new FileReader(); rd.onload=function(){ d.fotoBase64=rd.result; post(); }; rd.readAsDataURL(file); }
            else post();
            return false;
          }
        </script>
      </form>`
      : `<p class="vazio">Você ainda não tem contatos com tags. Vá em <b>Contatos</b>, importe e etiquete primeiro — as campanhas são enviadas por tag.</p>`}
    </div>`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('campanhas')}
    ${uiTopo({ titulo: 'Campanhas', sub: 'Mensagens em massa pela SoFIA para um grupo de contatos (por tag), com variações de texto e limite por dia para não arriscar o número.' })}
    ${novo}
    <div class="sec-t">Campanhas</div>
    <div class="card" style="padding:11px 17px;margin:12px;background:var(--card);box-shadow:0 1px 2px rgba(16,24,40,.04);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="filtro-lbl" style="margin:0">📅 Início no período:</span>
      <input type="date" id="campDe" onchange="campFiltrar()" title="De (início a partir de)" style="width:150px;font-size:.82rem;padding:7px 9px;border:1px solid var(--linha);border-radius:8px;background:#fff;color:var(--tinta)">
      <span class="ate" style="font-size:.8rem;color:var(--cinza)">até</span>
      <input type="date" id="campAte" onchange="campFiltrar()" title="Até (início até)" style="width:150px;font-size:.82rem;padding:7px 9px;border:1px solid var(--linha);border-radius:8px;background:#fff;color:var(--tinta)">
      <button type="button" id="campLimpar" onclick="campLimparFiltro()" title="Limpar datas" class="reset filtro-limpar" style="display:none">🧹</button>
    </div>
    <div id="campList">${campListHTML()}</div>
  </div>
  <div id="cpModal" class="ct-ov" onclick="if(event.target===this)fecharCampDet()">
    <div class="ct-dlg" style="max-width:640px">
      <div class="ct-dh"><h2 id="cpTit">Detalhes do envio</h2><button type="button" class="ct-x" onclick="fecharCampDet()">×</button></div>
      <div id="cpStats" class="quando" style="margin:0 0 10px"></div>
      <div id="cpBody"><p class="quando">Carregando…</p></div>
    </div>
  </div>
  <script>
    // Filtro por período (início da campanha). Os valores viajam no fetch do poll,
    // então o auto-refresh mantém o filtro. Mudar as datas força um refresh na hora.
    function campFiltroQS(){ var de=(document.getElementById('campDe')||{}).value||'', ate=(document.getElementById('campAte')||{}).value||''; var p=[]; if(de)p.push('de='+encodeURIComponent(de)); if(ate)p.push('ate='+encodeURIComponent(ate)); var b=document.getElementById('campLimpar'); if(b)b.style.display=(de||ate)?'inline-flex':'none'; return p.length?('?'+p.join('&')):''; }
    function campFiltrar(){ if(window.campForcar) window.campForcar(); }
    function campLimparFiltro(){ var de=document.getElementById('campDe'), ate=document.getElementById('campAte'); if(de)de.value=''; if(ate)ate.value=''; campFiltrar(); }
    (function(){
      var box=document.getElementById('campList'); if(!box) return;
      var ultimo=box.innerHTML;
      window.campForcar=function(){ ultimo='\\u0000'; poll(); }; // invalida o cache p/ aplicar o filtro já
      function poll(){ if(window.campEditando) return; fetch('/sofia/campanhas/lista'+campFiltroQS(),{cache:'no-store'}).then(function(r){return r.text();}).then(function(h){ if(window.campEditando) return; if(h && h!==ultimo){
        // Guarda o que o usuário estava vendo ANTES de trocar o DOM: variações abertas
        // e a rolagem da página. Sem isto, uma campanha "enviando" (contadores mudando)
        // recolhe o "ver variações" e volta a lista pro topo a cada poll.
        var abertas=[]; try{ box.querySelectorAll('div[class^="vars-"]').forEach(function(d){ if(d.style.display && d.style.display!=='none') abertas.push(d.className); }); }catch(e){}
        var sy=window.scrollY||window.pageYOffset||0;
        ultimo=h; box.innerHTML=h;
        try{ abertas.forEach(function(cls){ var d=box.querySelector('div.'+cls); if(d) d.style.display='block'; }); }catch(e){}
        try{ window.scrollTo(0, sy); }catch(e){}
      } }).catch(function(){}); }
      var n=0, iv=setInterval(function(){ n++; poll(); if(n>=3){ clearInterval(iv); setInterval(poll,6000); } },1200);
    })();
    // Editar uma variação de uma campanha já criada (inline; pausa o auto-refresh).
    window.campEditando=false;
    // Excluir uma variação: a campanha passa a trabalhar com as restantes.
    function excluirVar(a){
      if(window.campEditando) return;
      var item=a.closest('.varItem'); if(!item) return;
      var cid=item.getAttribute('data-cid'), idx=item.getAttribute('data-idx');
      var box=item.parentNode; var total=box?box.querySelectorAll('.varItem').length:0;
      if(total<=1){ alert('A campanha precisa de pelo menos 1 variação.'); return; }
      if(!confirm('Excluir esta variação? A campanha passa a usar '+(total-1)+' variações.')) return;
      window.campEditando=true; // pausa o auto-refresh enquanto exclui
      fetch('/sofia/campanhas/variacao-excluir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:cid,index:+idx})})
        .then(function(r){return r.json();}).then(function(j){ window.campEditando=false; if(j&&j.ok){ if(window.campForcar) window.campForcar(); } else { alert('❌ '+((j&&j.erro)||'falha ao excluir')); } })
        .catch(function(){ window.campEditando=false; alert('❌ erro de rede'); });
    }
    function editarVar(a){
      if(window.campEditando) return;
      var item=a.closest('.varItem'); if(!item) return;
      var cid=item.getAttribute('data-cid'), idx=item.getAttribute('data-idx');
      var atual=(item.querySelector('.varTxt')||{}).textContent||'';
      window.campEditando=true;
      var orig=item.innerHTML;
      item.innerHTML='';
      var ta=document.createElement('textarea'); ta.rows=4; ta.style.cssText='width:100%;font-size:.9rem'; ta.value=atual;
      var bar=document.createElement('div'); bar.style.cssText='display:flex;gap:10px;align-items:center;margin-top:6px';
      var sv=document.createElement('button'); sv.type='button'; sv.className='save'; sv.style.cssText='padding:6px 14px;font-size:.82rem'; sv.textContent='Salvar';
      var cc=document.createElement('a'); cc.href='javascript:void(0)'; cc.className='quando'; cc.style.cssText='margin:0;text-decoration:underline'; cc.textContent='cancelar';
      var st=document.createElement('span'); st.className='quando'; st.style.margin='0';
      bar.appendChild(sv); bar.appendChild(cc); bar.appendChild(st);
      item.appendChild(ta); item.appendChild(bar); ta.focus();
      function restaurar(html){ item.innerHTML=html; window.campEditando=false; }
      cc.onclick=function(){ restaurar(orig); };
      sv.onclick=function(){
        var novo=(ta.value||'').trim();
        if(!novo){ st.textContent='Não pode ficar vazia.'; return; }
        sv.disabled=true; st.textContent='salvando…';
        fetch('/sofia/campanhas/variacao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:cid,index:+idx,texto:novo})})
          .then(function(r){return r.json();}).then(function(j){
            if(j.ok){
              var novoHtml='<b style="color:var(--teal-esc);flex:none">#'+(+idx+1)+'</b><span class="varTxt" style="flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere">'+cpEsc(novo)+'</span><a href="javascript:void(0)" class="varEdit" onclick="editarVar(this)" title="Editar esta variação" style="flex:none;text-decoration:none;font-size:.95rem">✏️</a>';
              restaurar(novoHtml);
            } else { sv.disabled=false; st.textContent='❌ '+(j.erro||'falha'); }
          }).catch(function(){ sv.disabled=false; st.textContent='❌ erro de rede'; });
      };
    }
    var cpId=null, cpTimer=null, cpLastBody='', CP_CONV=${podeSofiaSub(E._navSess || { admin: true, telas: [] }, 'conversas') ? 'true' : 'false'};
    function irConversaCamp(tel){ location.href='/sofia?view=conversas&chat='+encodeURIComponent(tel); }
    function cpEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }
    function cpFmtTel(k){ var d=String(k||'').replace(/\\D/g,''); if(/^55\\d{10,11}$/.test(d)){ var ddd=d.slice(2,4), r=d.slice(4); return '+55 ('+ddd+') '+(r.length===9?r.slice(0,5)+'-'+r.slice(5):r.slice(0,4)+'-'+r.slice(4)); } return k||''; }
    function cpFmtHora(ts){ if(!ts) return ''; try{ return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
    // "Enviar agora": dispara N mensagens já, ignorando o teto do dia e a janela de
    // horário (mas mantém o espaçamento de 35–70s entre cada, p/ proteger o número).
    function cpEnviarAgora(id, naFila){
      naFila = parseInt(naFila,10)||0; if(!naFila){ alert('Não há ninguém na fila desta campanha.'); return; }
      var sug = Math.min(naFila, 20);
      var v = prompt('Quantas mensagens você quer disparar AGORA?\\n\\n• Saem já, ignorando o teto do dia e o horário.\\n• Uma a cada 35–70s, para proteger o número.\\n\\nNa fila: '+naFila, String(sug));
      if(v===null) return;
      var n = parseInt(v,10);
      if(!(n>0)){ alert('Informe um número maior que zero.'); return; }
      if(n>naFila) n=naFila;
      fetch('/sofia/campanhas/enviar-agora',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(id)+'&n='+n})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok){ alert('🚀 Disparando '+n+' mensagem(ns) agora! Elas saem uma a cada 35–70s — acompanhe a barra da campanha.'); } else { alert('❌ '+((j&&j.erro)||'falha')); } })
        .catch(function(){ alert('❌ erro de rede'); });
    }
    // Ajustar o ritmo/limites de uma campanha JÁ criada. Pausa o auto-refresh
    // enquanto o formulário está aberto (window.campEditando) para não sumir.
    function toggleRitmo(id){
      var box=document.querySelector('.ritmoBox-'+id); if(!box) return;
      var abrir = (box.style.display==='none' || !box.style.display);
      box.style.display = abrir ? 'block' : 'none';
      window.campEditando = abrir;
    }
    function salvarRitmo(id){
      function val(p){ var e=document.getElementById(p+'-'+id); return e?e.value:''; }
      var mn=parseInt(val('rmin'),10), mx=parseInt(val('rmax'),10), lim=parseInt(val('rlim'),10);
      if(!(mn>0)||!(mx>0)){ alert('Preencha o intervalo entre envios (segundos).'); return; }
      if(mx<mn){ alert('O tempo máximo deve ser maior ou igual ao mínimo.'); return; }
      if(!(lim>0)){ alert('Preencha o máximo por dia.'); return; }
      var d={ id:id, delayMinSeg:mn, delayMaxSeg:mx, limiteDia:lim, janelaIni:val('rji'), janelaFim:val('rjf') };
      fetch('/sofia/campanhas/ritmo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok){ window.campEditando=false; var b=document.querySelector('.ritmoBox-'+id); if(b)b.style.display='none'; alert('✅ Ritmo atualizado! O término previsto vai recalcular.'); } else { alert('❌ '+((j&&j.erro)||'falha')); } })
        .catch(function(){ alert('❌ erro de rede'); });
    }
    function abrirCampDetalhe(id){
      cpId=id; cpLastBody='';
      document.getElementById('cpBody').innerHTML='<p class="quando">Carregando…</p>';
      document.getElementById('cpStats').textContent='';
      document.getElementById('cpModal').style.display='flex';
      cpCarregar();
      if(cpTimer) clearInterval(cpTimer);
      cpTimer=setInterval(cpCarregar, 5000); // acompanha ao vivo enquanto aberto
    }
    function cpCarregar(){
      if(!cpId) return;
      fetch('/sofia/campanhas/detalhe?id='+encodeURIComponent(cpId),{cache:'no-store'})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok) cpRender(j); })
        .catch(function(){});
    }
    function cpRender(j){
      var tEnv=j.enviadosTotal!=null?j.enviadosTotal:j.enviados.length, tPen=j.pendentesTotal!=null?j.pendentesTotal:j.pendentes.length, tFal=j.falhasTotal!=null?j.falhasTotal:j.falhas.length;
      document.getElementById('cpTit').textContent='Envio · '+(j.nome||'');
      document.getElementById('cpStats').innerHTML='<b style="color:var(--ok)">'+tEnv+'</b> enviadas · <b>'+tPen+'</b> na fila · <b style="color:var(--erro)">'+tFal+'</b> falha(s) · hoje '+(j.enviadosHoje||0)+'/'+(j.limiteDia||0);
      function linha(nome,tel,dir,extra){ var ir=CP_CONV?('<button type="button" class="ct-ic" title="Ir para a conversa" style="margin:0" onclick="irConversaCamp(\\''+cpEsc(String(tel).replace(/[^0-9]/g,''))+'\\')">💬</button>'):''; var dirTxt=String(dir).replace(/<[^>]*>/g,'').replace(/"/g,'&quot;'); return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linha)"><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>'+cpEsc(nome||'(sem nome)')+'</b> <span class="quando">'+cpEsc(cpFmtTel(tel))+'</span></span><span class="quando" title="'+dirTxt+'" style="margin:0;flex:0 1 auto;min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+dir+'</span><span style="flex:none;display:flex;align-items:center;gap:8px">'+(extra||'')+ir+'</span></div>'; }
      function maisN(mostrados,total){ return total>mostrados?('<div class="quando" style="padding:7px 0">…e mais '+(total-mostrados)+'</div>'):''; }
      var env=j.enviados.slice().reverse().map(function(x){ return linha(x.nome,x.tel,'✅ '+cpFmtHora(x.em)); }).join('')+maisN(j.enviados.length,tEnv) || '<p class="quando">Ninguém ainda.</p>';
      var fila=j.pendentes.map(function(x){ return linha(x.nome,x.tel,'⏳ na fila','<button type="button" class="ct-ic" title="Remover da fila (não recebe a campanha)" style="margin:0;color:#c0392b" onclick="cpRemoverFila(\\''+cpEsc(String(x.tel).replace(/[^0-9]/g,''))+'\\')">🗑️</button>'); }).join('')+maisN(j.pendentes.length,tPen) || '<p class="quando">Fila vazia.</p>';
      // "No LID for user …" = o WhatsApp não achou esse número (quase sempre: número sem WhatsApp ou errado)
      var cpErroTxt=function(e){ e=String(e||''); return /No LID for user|sem WhatsApp/i.test(e) ? 'Número sem WhatsApp (ou errado) — confira o número no cadastro' : e.slice(0,200); };
      var fal=j.falhas.slice().reverse().map(function(x){ return linha(x.nome,x.tel,'<span style="color:var(--erro)" title="'+cpEsc(x.erro||'')+'">⚠️ '+cpEsc(cpErroTxt(x.erro))+'</span>','<button type="button" class="ct-ic" title="Reenviar este número (volta pra fila)" style="margin:0" onclick="cpReenviar(\\''+cpEsc(String(x.tel).replace(/[^0-9]/g,''))+'\\')">↻</button>'); }).join('') || '<p class="quando">Nenhuma falha. 🎉</p>';
      var cpBodyEl=document.getElementById('cpBody');
      var html=
        '<div class="cp-sec"><div class="cp-h">Enviadas ('+tEnv+')</div><div class="cp-list">'+env+'</div></div>'+
        '<div class="cp-sec"><div class="cp-h">Na fila ('+tPen+')</div><div class="cp-list">'+fila+'</div></div>'+
        (tFal?('<div class="cp-sec"><div class="cp-h">Falhas ('+tFal+')</div><div class="cp-list">'+fal+'</div></div>'):'');
      // Nada mudou desde o último refresh → NÃO redesenha (senão a rolagem das listas
      // volta pro topo a cada 5s enquanto o usuário está olhando).
      if(html===cpLastBody) return;
      // Mudou (enviou mais, etc.): guarda a rolagem de cada lista e restaura após trocar o DOM.
      var scr=[]; try{ cpBodyEl.querySelectorAll('.cp-list').forEach(function(l){ scr.push(l.scrollTop); }); }catch(e){}
      cpLastBody=html; cpBodyEl.innerHTML=html;
      try{ cpBodyEl.querySelectorAll('.cp-list').forEach(function(l,i){ if(scr[i]!=null) l.scrollTop=scr[i]; }); }catch(e){}
    }
    function cpRemoverFila(tel){
      if(!cpId||!tel) return;
      if(!confirm('Remover '+cpFmtTel(tel)+' da fila?\\n\\nEssa pessoa NÃO vai receber a mensagem da campanha.')) return;
      fetch('/sofia/campanhas/remover-fila',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(cpId)+'&tel='+encodeURIComponent(tel)})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok){ setTimeout(cpCarregar,500); } else { alert('❌ '+((j&&j.erro)||'falha ao remover')); } })
        .catch(function(){ alert('❌ erro de rede'); });
    }
    function cpReenviar(tel){
      if(!cpId||!tel) return;
      if(!confirm('Reenviar para '+cpFmtTel(tel)+'?\\n\\nO número volta para a fila e a campanha tenta de novo. (Se a falha for "sem WhatsApp", vai falhar de novo.)')) return;
      fetch('/sofia/campanhas/reenviar',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(cpId)+'&tel='+encodeURIComponent(tel)})
        .then(function(r){return r.json();}).then(function(j){ if(j&&j.ok){ setTimeout(cpCarregar,600); } else { alert('❌ '+((j&&j.erro)||'falha ao reenviar')); } })
        .catch(function(){ alert('❌ erro de rede'); });
    }
    function fecharCampDet(){ document.getElementById('cpModal').style.display='none'; cpId=null; if(cpTimer){ clearInterval(cpTimer); cpTimer=null; } }
  </script>`;
  return chrome({ tab: 'Campanhas', h1: 'SoFIA', p: 'Campanhas — envio em massa por tag, com variações e limites.' }, 'sofia', corpo);
}

function paginaSofia(aviso, erro) {
  if (!sofia.disponivel()) {
    const corpo = `<div class="wrap">
      ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
      <div class="card"><div class="chead"><h2>SoFIA não encontrada nesta máquina</h2></div>
        <p class="quando">Não achei a pasta da SoFIA (<code>${esc(sofia.DIR)}</code>) ou o arquivo do prompt. Se a SoFIA roda em outra pasta/servidor, aponte com a variável <code>SOFIA_DIR</code> no <code>.env</code> do painel e reinicie: <code>pm2 restart ${esc(PM2_PAINEL)} --update-env</code>.</p>
      </div></div>`;
    return chrome({ tab: 'SoFIA', h1: 'SoFIA', p: 'Prompt, configurações e conexão do chatbot.' }, 'sofia', corpo);
  }

  const e = sofia.estado();
  const refreshSeg = lerRefreshSeg(); // atualização automática da aba Conversas (segundos)
  let avh = { on: false, numero: '' }; try { avh = sofia.lerAvisoHumano(); } catch (_) {}
  let naoResp = []; try { naoResp = sofia.lerNaoResponder(); } catch (_) {} // números que a SoFIA nunca responde sozinha
  let msgsAnuncioTxt = ''; try { msgsAnuncioTxt = sofia.lerMsgsAnuncioTexto(); } catch (_) {} // boas-vindas do anúncio que não pausam a SoFIA
  let alu = { ativo: true, janelaIni: '05:45', janelaFim: '16:30', recepcaoNumero: '', tag: 'alunas', tags: ['alunas'] };
  try { alu = sofia.lerAlunas(); } catch (_) {}
  // Etiquetas que existem de verdade no CRM, para o Studio MARCAR quais a SoFIA
  // NÃO deve responder (aluna, ex-aluna, etc.). Antes era uma tag só; virou lista.
  let tagsAlu = [];
  try { tagsAlu = contatos.tagsDistintas().map(t => t.tag); } catch (_) {}
  const tagsSel = (Array.isArray(alu.tags) && alu.tags.length) ? alu.tags : [String(alu.tag || 'alunas')];
  // Garante que toda tag JÁ SELECIONADA apareça na lista, mesmo que não exista
  // mais no CRM (senão sumiria do painel e o Studio não conseguiria desmarcá-la).
  for (const t of tagsSel) { if (!tagsAlu.some(x => x.toLowerCase() === String(t).toLowerCase())) tagsAlu = [t].concat(tagsAlu); }
  const selLower = new Set(tagsSel.map(t => String(t).trim().toLowerCase()));
  const tagsTxt = tagsSel.map(t => esc(t)).join(', ') || 'alunas';
  // Cada seção é um card recolhível (começa MINIMIZADA — só o título aparece) e
  // reordenável (↑ ↓). A ordem no DOM = ordem salva no prompt. O textarea, mesmo
  // recolhido (display:none), continua sendo enviado no POST.
  const cardSecao = (titulo, corpo) => {
    const rows = Math.min(16, Math.max(4, String(corpo || '').split('\n').length + 1));
    return `<div class="card sec-card">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
        <button type="button" class="reset secTog" onclick="toggleSecao(this)" title="Expandir/recolher" style="padding:6px 9px;flex:none">▸</button>
        <input type="text" name="titulo[]" value="${esc(titulo)}" placeholder="TÍTULO DA SEÇÃO" style="flex:1;min-width:0;font-weight:700;font-family:"Inter",sans-serif;font-size:.9rem">
        <button type="button" class="reset" onclick="moverSecao(this,-1)" title="Subir" style="padding:6px 9px;flex:none">↑</button>
        <button type="button" class="reset" onclick="moverSecao(this,1)" title="Descer" style="padding:6px 9px;flex:none">↓</button>
        <button type="button" class="reset" onclick="removerSecao(this)" title="Remover esta seção" style="padding:6px 10px;flex:none">🗑️</button>
      </div>
      <textarea name="corpo[]" rows="${rows}" spellcheck="false" style="display:none">${esc(corpo)}</textarea>
    </div>`;
  };
  const cardsSecoes = e.secoes.map(s => cardSecao(s.titulo, s.corpo)).join('');

  const inpMidia = (nome, valor, rot) => `<label>${rot}</label><input type="text" name="${nome}" value="${esc(valor)}" style="font-family:ui-monospace,monospace;font-size:.86rem">`;
  // Campo de IMAGEM (a SoFIA anexa no WhatsApp): aceita colar URL OU anexar arquivo
  // (o upload salva no VPS e preenche o campo). Mostra miniatura do que está publicado.
  const inpMidiaImg = (nome, valor, rot) => `<label>${rot}</label>
    <input type="text" name="${nome}" id="mi_${nome}" value="${esc(valor)}" placeholder="cole uma URL ou anexe um arquivo abaixo" style="font-family:ui-monospace,monospace;font-size:.86rem">
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0 2px">
      <input type="file" accept="image/*" id="mf_${nome}" style="display:none" onchange="subirMidia('${nome}', this)">
      <button type="button" class="reset" onclick="document.getElementById('mf_${nome}').click()" style="padding:6px 12px;flex:none">📎 Anexar / Trocar imagem</button>
      <span class="quando" id="ms_${nome}" style="margin:0"></span>
    </div>
    <img id="mt_${nome}" src="/sofia/midia?campo=${nome}&t=${Date.now()}" alt="" onerror="this.style.display='none'" style="max-width:220px;max-height:160px;border-radius:8px;border:1px solid #ddd;display:block;margin:4px 0 10px">`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('config')}
    ${uiTopo({ titulo: 'Configuração da SoFIA', sub: 'O WhatsApp dela, como ela conversa, o que ela sabe sobre o Studio e quando passa a conversa para a recepção.' })}

    <div class="sec-t">Conexão do WhatsApp da SoFIA <small style="font-weight:600;color:var(--cinza)">(número próprio, diferente do robô)</small></div>
    <div id="sofiaWa">${blocoSofiaWa()}</div>
    <div style="margin:8px 0 6px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <form method="POST" action="/sofia/toggle" style="margin:0;display:inline"><button type="submit" class="${e.ativa ? 'reset' : 'save'}" style="padding:4px 11px;font-size:var(--fs-xs)">${e.ativa ? '⏸️ Pausar SoFIA' : '▶️ Ativar SoFIA'}</button></form>
        <form method="POST" action="/sofia/reiniciar" onsubmit="return confirm('Reiniciar a SoFIA agora?\\n\\nEla fica cerca de 1 minuto fora do ar enquanto reconecta o WhatsApp — sem perder as conversas. Passa a valer o que precisa de reinício (modelo de IA, transcrição).')" style="margin:0;display:inline"><button type="submit" class="reset" style="padding:4px 11px;font-size:var(--fs-xs)">🔄 Reiniciar SoFIA</button></form>
        <form id="sofiaBtnDesc" method="POST" action="/sofia/desconectar" onsubmit="return confirm('Desconectar o WhatsApp da SoFIA?\\n\\nA SoFIA para de responder e será preciso reescanear o QR (aqui mesmo) para reconectar.')" style="margin:0;display:none" title="Só disponível quando o WhatsApp está conectado"><button type="submit" class="reset" style="padding:4px 11px;font-size:var(--fs-xs)">Desconectar</button></form>
      </div>
    </div>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">🔢 Conectar a SoFIA por código (sem QR)</summary>
      <div class="card">
        <p class="quando" style="margin:0 0 10px">Não conseguiu ler o QR? Conecte digitando um <b>código de 8 dígitos</b> no celular da SoFIA. Informe o <b>número do WhatsApp da SoFIA</b> (DDI + DDD + número, só dígitos) e clique em <b>Gerar código</b> — ele aparece no quadro de conexão acima em ~20s. (Funciona quando a SoFIA está <b>desconectada</b>/pedindo QR.)</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="sofPairNum" type="tel" inputmode="numeric" placeholder="5561999998010" autocomplete="off" style="max-width:220px">
          <button type="button" class="save" id="sofPairBtn" onclick="pedirCodigoSofia()" style="padding:8px 18px">Gerar código</button>
          <span id="sofPairMsg" class="quando" style="margin:0"></span>
        </div>
        <p class="quando" style="margin:10px 0 0">Depois, no celular da SoFIA: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → <b>Conectar com número de telefone</b> → digite o código que aparecer acima.</p>
      </div>
    </details>

    ${(E._navSess && E._navSess.admin) ? `
    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">🔑 Credenciais da unidade <small style="font-weight:400;color:var(--cinza)">— login do EVO e chaves de IA (só admin), sem abrir o .env</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 14px">Preencha aqui as credenciais <b>desta unidade</b> — assim não precisa editar o <code>.env</code> no servidor. Cada bloco diz <b>qual processo reiniciar</b> para valer: o <b>robô</b> lê o login do EVO no boot; a <b>SoFIA</b> lê as chaves de IA no boot.</p>

        <label>Login do robô no EVO ${infoI('É o <b>usuário e senha</b> com que o robô entra no EVO (o mesmo que você usa no site do EVO) — a <b>EVO_EMAIL</b> e a <b>EVO_PASSWORD</b>. <b>Sem eles, os jobs diários do EVO falham</b> (confirmações, presença, aniversários, planilha…). Grava no <code>Experimental/.env</code>; vale <b>após reiniciar o robô</b>. Não é o mesmo que o <i>token</i> da API do EVO (esse fica no .env, montado pelo script).')}</label>
        <input type="email" id="evoEmailInput" value="${esc(lerEvoEmail())}" placeholder="email@dominio.com" autocomplete="off" spellcheck="false" style="max-width:600px;padding:9px;margin:0 0 8px">
        <div style="display:flex;gap:8px;align-items:center;max-width:600px">
          <input type="password" id="evoSenhaInput" value="" placeholder="${evoSenhaDefinida() ? '•••••••• (senha salva — deixe em branco p/ manter)' : 'senha do EVO'}" autocomplete="new-password" spellcheck="false" style="flex:1;padding:9px;font-family:monospace">
          <button type="button" title="Mostrar/ocultar" onclick="var i=document.getElementById('evoSenhaInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" style="padding:8px 11px">👁</button>
          <button type="button" class="save" style="width:auto;padding:9px 14px" onclick="salvarEvoCred()">Salvar login</button>
        </div>
        <p class="quando" id="evoCredMsg" style="margin:6px 0 0">Grava em <code>Experimental/.env</code>. Depois clique em <b>🔄 Reiniciar robô</b> (abaixo). Confira o resultado do login em <a href="/?view=saude">Saúde → EVO</a>.</p>

        <hr style="border:0;border-top:1px solid var(--linha);margin:16px 0">

        <label>Chave da IA (Anthropic) ${infoI('É a chave que dá acesso ao Claude (a <b>ANTHROPIC_API_KEY</b>) — o que tem <b>custo por conversa</b>. Cole a chave nova e salve, sem mexer no .env. Fica oculta; clique no 👁 para ver. A troca vale <b>após reiniciar a SoFIA</b>.')}</label>
        <div style="display:flex;gap:8px;align-items:center;max-width:600px">
          <input type="password" id="apiKeyInput" value="${esc(lerApiKey())}" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" style="flex:1;padding:9px;font-family:monospace">
          <button type="button" title="Mostrar/ocultar" onclick="var i=document.getElementById('apiKeyInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" style="padding:8px 11px">👁</button>
          <button type="button" class="save" style="width:auto;padding:9px 14px" onclick="salvarApiKey()">Salvar chave</button>
        </div>
        <p class="quando" id="apiKeyMsg" style="margin:6px 0 0">Fica no servidor (<code>ChatBot/.env</code>). Depois de salvar, clique em <b>🔄 Reiniciar SoFIA</b> (abaixo) para a chave nova valer.</p>

        <hr style="border:0;border-top:1px solid var(--linha);margin:16px 0">

        <label>Transcrição de áudio — provedor e chave ${infoI('Faz a SoFIA <b>entender áudios</b> (fala→texto). Escolha o <b>provedor</b> e cole a <b>chave</b> dele — o painel grava sozinho a URL e o modelo certos, <b>sem mexer no .env</b>.<br><br><b>OpenAI</b> (Whisper): chave <code>sk-…</code>, paga (~US$ 0,006/min, precisa de crédito no Billing).<br><b>Groq</b>: chave <code>gsk_…</code>, tem <b>camada gratuita</b> — costuma sair de graça para o volume de um studio.<br><br><b>Deixe a chave em branco e salve</b> para <b>desligar</b> a transcrição. Vale <b>após reiniciar a SoFIA</b>. Passo a passo de como obter a chave: <b>/implantacao</b> Fase 9.2.')}</label>
        <div style="display:flex;gap:8px;align-items:center;max-width:600px;flex-wrap:wrap">
          <select id="transProvInput" style="padding:9px;min-width:200px">
            <option value="openai"${lerTranscricaoProvedor() === 'openai' ? ' selected' : ''}>OpenAI (Whisper) — pago</option>
            <option value="groq"${lerTranscricaoProvedor() === 'groq' ? ' selected' : ''}>Groq — grátis p/ uso normal</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;max-width:600px;margin-top:8px">
          <input type="password" id="transKeyInput" value="${esc(lerTranscricaoKey())}" placeholder="sk-… (OpenAI) ou gsk_… (Groq)" autocomplete="off" spellcheck="false" style="flex:1;padding:9px;font-family:monospace">
          <button type="button" title="Mostrar/ocultar" onclick="var i=document.getElementById('transKeyInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" style="padding:8px 11px">👁</button>
          <button type="button" class="save" style="width:auto;padding:9px 14px" onclick="salvarTransKey()">Salvar</button>
        </div>
        <label class="chk" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:10px 0 0;font-weight:500">
          <input type="checkbox" id="transOnInput"${e.transcricaoOn ? ' checked' : ''} style="width:auto;margin:0">
          🎤 Transcrever áudios das alunas ${infoI('Quando a aluna manda <b>áudio</b>, a SoFIA transcreve (fala→texto) e responde ao conteúdo — aparece como “🎤 …” no painel. <b>Desligado</b>, a SoFIA pede educadamente para a aluna mandar por <b>texto</b>. Marque e clique em <b>Salvar</b> (o botão acima).')}
        </label>
        <p class="quando" id="transKeyMsg" style="margin:6px 0 0">O <b>Salvar</b> acima grava o provedor + a chave + o liga/desliga. Ao <b>trocar de provedor</b>, cole a chave do <b>novo</b> provedor. Depois clique em <b>🔄 Reiniciar SoFIA</b> (abaixo).</p>

        <hr style="border:0;border-top:1px solid var(--linha);margin:16px 0">

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button type="button" class="reset" style="padding:6px 13px" onclick="if(confirm('Reiniciar o robô agora?\\n\\nEle fica alguns segundos fora do ar e reconecta sozinho. Aplica o login do EVO recém-salvo.'))reinicCred('robo')">🔄 Reiniciar robô</button>
          <button type="button" class="reset" style="padding:6px 13px" onclick="if(confirm('Reiniciar a SoFIA agora?\\n\\nEla fica cerca de 1 minuto fora do ar enquanto reconecta o WhatsApp — sem perder as conversas. Aplica as chaves de IA recém-salvas.'))reinicCred('sofia')">🔄 Reiniciar SoFIA</button>
          <span class="quando" id="credRestartMsg" style="margin:0">Robô = login do EVO · SoFIA = chaves de IA.</span>
        </div>

        <script>
        function salvarEvoCred(){
          var e=document.getElementById('evoEmailInput'), s=document.getElementById('evoSenhaInput'), m=document.getElementById('evoCredMsg');
          m.textContent='Salvando…';
          fetch('/sofia/evo-credenciais',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:(e.value||'').trim(), senha:(s.value||'')})})
            .then(function(r){return r.json();}).then(function(j){
              if(j&&j.ok){ s.value=''; m.innerHTML='✅ Login salvo! Agora clique em <b>🔄 Reiniciar robô</b> (abaixo) para valer.'; }
              else { m.textContent='❌ '+((j&&j.erro)||'não consegui salvar'); }
            }).catch(function(){ m.textContent='❌ erro de rede'; });
        }
        function salvarApiKey(){
          var i=document.getElementById('apiKeyInput'), m=document.getElementById('apiKeyMsg');
          var k=(i.value||'').trim();
          m.textContent='Salvando…';
          fetch('/sofia/api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k})})
            .then(function(r){return r.json();}).then(function(j){
              if(j&&j.ok){ m.innerHTML='✅ Chave salva! Agora clique em <b>🔄 Reiniciar SoFIA</b> (abaixo) para a chave nova valer.'; }
              else { m.textContent='❌ '+((j&&j.erro)||'não consegui salvar'); }
            }).catch(function(){ m.textContent='❌ erro de rede'; });
        }
        function salvarTransKey(){
          var i=document.getElementById('transKeyInput'), pv=document.getElementById('transProvInput'), on=document.getElementById('transOnInput'), m=document.getElementById('transKeyMsg');
          var k=(i.value||'').trim(), prov=(pv&&pv.value)||'openai', lig=!!(on&&on.checked);
          m.textContent='Salvando…';
          fetch('/sofia/transcricao-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k, provedor:prov, on:lig})})
            .then(function(r){return r.json();}).then(function(j){
              if(j&&j.ok){ m.innerHTML=(k? ('✅ Salvo ('+(j.provedor==='groq'?'Groq':'OpenAI')+', '+(lig?'ligada':'desligada')+').') : '✅ Transcrição desligada (chave em branco).')+' Agora clique em <b>🔄 Reiniciar SoFIA</b> (abaixo) para valer.'; }
              else { m.textContent='❌ '+((j&&j.erro)||'não consegui salvar'); }
            }).catch(function(){ m.textContent='❌ erro de rede'; });
        }
        function reinicCred(proc){
          var m=document.getElementById('credRestartMsg');
          m.textContent=(proc==='robo'?'Reiniciando o robô':'Reiniciando a SoFIA')+'… (até ~25s, não feche a página)';
          fetch(proc==='robo'?'/wa/reiniciar':'/sofia/reiniciar',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:''})
            .then(function(){ m.innerHTML='✅ '+(proc==='robo'?'Robô reiniciado — confira em <a href="/?view=saude">Saúde → EVO</a>.':'SoFIA reiniciada.'); })
            .catch(function(){ m.textContent='❌ erro de rede ao reiniciar'; });
        }
        </script>
      </div>
    </details>
    ` : ''}

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">Avisar quando precisar de humano <small style="font-weight:400;color:var(--cinza)">— manda um WhatsApp quando a aluna pede um atendente</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Se a aluna pedir para <b>falar com uma pessoa</b> (ou demonstrar irritação), a SoFIA manda <b>uma</b> mensagem de aviso para o número abaixo — assim a recepção entra na conversa rápido. A SoFIA continua respondendo normalmente.</p>
        <form method="POST" action="/sofia/aviso-humano">
          <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
            <label class="chk" style="margin:0"><input type="checkbox" name="on" value="1"${avh.on ? ' checked' : ''}> Ligado</label>
            <div style="flex:1;min-width:200px"><label style="margin:0 0 4px">Número que recebe o aviso (com DDD)</label>
            <input type="tel" name="numero" value="${esc(avh.numero)}" placeholder="Ex.: 62998887777" style="max-width:220px"></div>
          </div>
          <label style="margin:14px 0 4px">Palavras/expressões que disparam o aviso <small style="font-weight:400;color:var(--cinza)">(uma por linha; ignora acento e maiúsculas)</small></label>
          <textarea name="palavras" rows="6" spellcheck="false" style="font-size:.86rem">${esc((avh.palavras && avh.palavras.length ? avh.palavras : (sofia.PALAVRAS_HUMANO_PADRAO || [])).join('\n'))}</textarea>
          <div class="acts" style="margin-top:12px"><button type="submit" class="save">Salvar</button></div>
        </form>
      </div>
    </details>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">🔕 Números que a SoFIA não responde <small style="font-weight:400;color:var(--cinza)">— ela recebe e pode mandar campanha, mas nunca responde sozinha</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Coloque aqui os números que a SoFIA <b>nunca deve responder sozinha</b>. As mensagens dessas pessoas <b>continuam aparecendo nas Conversas</b> (e você responde à mão, se quiser), as <b>tags e automações seguem valendo</b> e elas <b>ainda podem receber campanhas</b> — a SoFIA só <b>não responde automaticamente</b> nem manda follow-up para elas. Um número por linha, com DDD (pode colar com ou sem formatação).</p>
        <form method="POST" action="/sofia/nao-responder">
          <textarea name="numeros" rows="6" spellcheck="false" placeholder="Ex.:&#10;62998887777&#10;11991234567" style="font-size:.9rem;font-family:ui-monospace,monospace">${esc(naoResp.join('\n'))}</textarea>
          <div class="acts" style="margin-top:12px;align-items:center"><button type="submit" class="save">Salvar lista</button><span class="quando" style="margin:0 0 0 10px">${naoResp.length} número(s) na lista</span></div>
        </form>
      </div>
    </details>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">📣 Boas-vindas do anúncio (não pausar a SoFIA) <small style="font-weight:400;color:var(--cinza)">— cole a saudação automática do Patrocinado</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Quando um lead vem de um <b>anúncio (click-to-WhatsApp)</b>, o próprio anúncio manda uma <b>mensagem de boas-vindas automática</b> do número. Como ela "sai" do número da SoFIA, sem isto a SoFIA achava que <b>um humano respondeu</b> e se <b>pausava por engano</b>. Cole aqui o <b>texto exato</b> dessa boas-vindas (uma por linha, se tiver mais de um anúncio) — a SoFIA vai <b>ignorá-la</b> e responder o lead normalmente. <small>(Compara sem ligar para acento, maiúscula ou pontuação.)</small></p>
        <form method="POST" action="/sofia/msgs-anuncio">
          <textarea name="msgs" rows="4" spellcheck="false" placeholder="Ex.:&#10;Olá, o treino no Studio Slim Fit combina força e cardio! Quer agendar uma aula experimental gratuita?" style="font-size:.9rem">${esc(msgsAnuncioTxt)}</textarea>
          <div class="acts" style="margin-top:12px"><button type="submit" class="save">Salvar</button></div>
        </form>
      </div>
    </details>

    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">🎓 Alunas contratadas <small style="font-weight:400;color:var(--cinza)">— horário da recepção e aviso de atendimento</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Regras para quem tem <b>qualquer uma</b> das etiquetas marcadas abaixo (${tagsTxt}) — quem já é <b>aluna/ex-aluna</b>, não é lead. <b>Dentro do horário da recepção</b> a SoFIA fica <b>calada</b> para essas pessoas — quem responde é a recepcionista. <b>Fora desse horário</b>, a SoFIA cobre (remarcação, dúvidas). Se a aluna pedir remarcação e <b>não houver reposição disponível</b>, a SoFIA avisa a aluna e manda um WhatsApp para o número abaixo. <small>Dica: para a SoFIA <b>nunca</b> responder essas etiquetas (24h), use a janela <b>00:02 às 00:01</b>.</small></p>
        <form method="POST" action="/sofia/alunas">
          <label class="chk"><input type="checkbox" name="ativo"${alu.ativo ? ' checked' : ''}> <b>Ligado</b> — aplicar estas regras para as etiquetas marcadas abaixo</label>
          <div class="cfg-grid" style="margin-top:14px">
            <div style="grid-column:1 / -1">
              <label>Etiquetas que a SoFIA NÃO responde ${infoI('Marque as etiquetas do CRM de quem <b>não é lead</b> (aluna, ex-aluna…). A SoFIA fica calada para quem tem <b>qualquer uma</b> delas, no horário da recepção. Compara sem ligar para acento, maiúscula, numeração ou plural — <b>0. Aluna</b>, <b>Aluna</b> e <b>alunas</b> valem a mesma coisa.')}</label>
              <div class="cfg-in" style="flex-direction:column;align-items:flex-start;gap:6px;max-height:200px;overflow:auto;padding:8px 10px">${tagsAlu.length ? tagsAlu.map(t => `<label class="chk" style="margin:0;font-weight:500"><input type="checkbox" name="tags" value="${esc(t)}"${selLower.has(String(t).trim().toLowerCase()) ? ' checked' : ''}> ${esc(t)}</label>`).join('') : '<span class="quando" style="margin:0">Nenhuma etiqueta encontrada no CRM (a sincronização de contatos precisa estar ativa).</span>'}</div>
            </div>
            <div>
              <label>Horário da recepção ${infoI('Nesse intervalo a SoFIA <b>não responde</b> quem tem a tag de aluna — a recepcionista atende. Fora dele, a SoFIA assume. Pode virar a meia-noite (ex.: 17:00 às 07:00).')}</label>
              <div class="cfg-in"><input type="time" name="janelaIni" value="${esc(alu.janelaIni)}"><span class="suf">às</span><input type="time" name="janelaFim" value="${esc(alu.janelaFim)}"></div>
            </div>
            <div>
              <label>WhatsApp da recepção ${infoI('Recebe o aviso <b>"a aluna precisa de atendimento"</b> quando a SoFIA não consegue resolver sozinha (ex.: remarcação sem reposição disponível). Com DDD.')}</label>
              <div class="cfg-in"><input type="text" name="recepcaoNumero" value="${esc(alu.recepcaoNumero || '')}" placeholder="62999998888" style="width:100%"></div>
            </div>
          </div>
          <div class="acts" style="margin-top:14px"><button type="submit" class="save">Salvar regras das alunas</button></div>
        </form>
      </div>
    </details>

    <form id="formSalvar" method="POST" action="/sofia/salvar">

      <details class="acc-sec">
        <summary class="sec-t" style="cursor:pointer;padding:4px 0">Jeito de responder <small style="font-weight:400;color:var(--cinza)">— IA, ritmo da conversa, memória e operação</small></summary>

      <!-- Grupo 1 · Inteligência (modelo de IA + transcrição) -->
      <div class="card">
        <div style="font-family:"Inter",sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">Inteligência</div>
        <p class="quando" style="margin:0 0 12px">Qual Claude a SoFIA usa e se ela entende áudios.</p>
        ${(E._navSess && E._navSess.admin) ? `<p class="quando" style="margin:0 0 12px">🔑 A <b>chave da IA (Anthropic)</b> e a <b>chave de transcrição</b> agora ficam em <b>🔑 Credenciais da unidade</b> (no topo desta aba Configuração), junto com o login do EVO.</p>` : ''}
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <label>Modelo da conversa ${infoI('É o cérebro que <b>fala com as alunas</b> e escreve o <b>follow-up</b> — a parte mais importante, porque a qualidade aqui vira agendamento.<br><br><b>Recomendado: Sonnet 5</b> (equilíbrio).<br><b>Opus 5:</b> qualidade máxima para conversas difíceis, mas mais caro.<br><b>Haiku 4.5:</b> mais barato, porém pode soar mais robótico e escorregar nas regras — só use se topar <b>testar e medir a conversão no Funil</b>.<br><br>Padrão: Sonnet 5.')}</label>
            <select name="modeloConversa" style="width:100%;padding:9px">${e.modelosValidos.map(m => `<option value="${esc(m.id)}"${m.id === e.modelos.conversa ? ' selected' : ''}>${esc(m.rot)}</option>`).join('')}</select>
          </div>
          <div style="flex:1;min-width:240px">
            <label>Modelo de extração/resumos ${infoI('Tarefa <b>simples e nos bastidores</b>: só <b>extrai dados</b> do agendamento (nome, e-mail, dia, hora) e gera os <b>resumos</b> das interações. A aluna não vê.<br><br><b>Melhor lugar para economizar: use Haiku 4.5</b> — é seguro aqui e corta custo, sem perda perceptível.<br><br>Padrão: Sonnet 5.')}</label>
            <select name="modeloExtracao" style="width:100%;padding:9px">${e.modelosValidos.map(m => `<option value="${esc(m.id)}"${m.id === e.modelos.extracao ? ' selected' : ''}>${esc(m.rot)}</option>`).join('')}</select>
          </div>
        </div>
        <p class="quando" style="margin:8px 0 0">Modelos maiores custam mais por conversa. A troca vale <b>após reiniciar a SoFIA</b> (<code>pm2 restart ${esc(PM2_SOFIA)}</code>).</p>
        <hr style="border:0;border-top:1px solid var(--linha);margin:14px 0 12px">
        <p class="quando" style="margin:0">🎤 A <b>transcrição de áudio</b> — ligar/desligar, provedor (OpenAI/Groq) e chave — fica toda em <b>🔑 Credenciais da unidade → Transcrição</b>, no topo desta aba.</p>
      </div>

      <!-- Grupo 2 · Ritmo da conversa (humano/velocidade + agrupar + pausa celular) -->
      <div class="card">
        <div style="font-family:"Inter",sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">Ritmo da conversa</div>
        <p class="quando" style="margin:0 0 12px">Como ela fala e o tempo até responder.</p>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="ritHumano" value="1"${e.ritmo.humano ? ' checked' : ''} style="width:auto;margin:0">
          Modo humano — quebra respostas longas em várias mensagens e mostra “digitando…”
        </label>
        <p class="quando" style="margin:6px 0 12px">Desmarcado, a SoFIA manda tudo de uma vez, sem simular digitação.</p>
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
        <hr style="border:0;border-top:1px solid var(--linha);margin:14px 0 12px">
        <div class="cfg-grid">
          <div>
            <label>Agrupar mensagens da aluna${infoI('A aluna às vezes manda <b>várias mensagens seguidas</b>. A SoFIA espera esse tempo após a última e responde <b>uma vez só</b>, juntando tudo — evita respostas cruzadas/confusas. Padrão: 7 segundos. 0 = responder na hora. As mensagens aparecem no painel na hora.')}</label>
            <div class="cfg-in"><input type="number" name="agruparSeg" min="0" max="120" step="1" value="${e.agruparSeg}"><span class="suf">segundos (0 = na hora)</span></div>
          </div>
          <div>
            <label>Pausa ao responder pelo celular${infoI('Se você responder uma aluna <b>direto pelo WhatsApp</b> (no celular da SoFIA), ela se cala nessa conversa por esse tempo, pra não falar por cima de você. É <b>diferente</b> do botão “assumir” do painel, que deixa a SoFIA fora <b>até você devolver</b>.')}</label>
            <div class="cfg-in"><input type="number" name="pausaMin" min="1" max="1440" value="${e.pausaMin}"><span class="suf">minutos</span></div>
          </div>
        </div>
      </div>

      <!-- Grupo 3 · Memória e operação (sessão + verificação + limite) -->
      <div class="card">
        <div style="font-family:"Inter",sans-serif;font-weight:700;font-size:.95rem;margin:0 0 4px">Memória e operação</div>
        <p class="quando" style="margin:0 0 12px">Duração da memória, saúde da conexão e limite de vagas por turma.</p>
        <div class="cfg-grid">
          <div>
            <label>Tempo de sessão (memória)${infoI('Depois desse tempo <b>sem mensagens</b>, a próxima mensagem da aluna começa uma conversa <b>nova</b> — a SoFIA não lembra do que foi dito antes. Na aba Conversas aparece como <b>“Sessão encerrada”</b>. Padrão: 12 horas.')}</label>
            <div class="cfg-in"><input type="number" name="sessaoHoras" min="1" max="720" step="1" value="${e.sessaoHoras}"><span class="suf">horas</span></div>
          </div>
          <div>
            <label>Atualizar as Conversas a cada${infoI('De quantos em quantos segundos a aba <b>Conversas</b> se atualiza sozinha (a lista e as bolhas). Menor = mais “ao vivo”, porém pesa um pouco mais. Mínimo 3s. Padrão: 4 segundos.')}</label>
            <div class="cfg-in"><input type="number" name="refreshSeg" min="3" max="60" step="1" value="${refreshSeg}"><span class="suf">segundos</span></div>
          </div>
          <div>
            <label>Verificação de conexão${infoI('De tempos em tempos a SoFIA confere se o WhatsApp dela ainda está <b>de verdade</b> conectado. Se travar (parar de responder sem cair o QR), ela <b>te avisa no celular</b> e <b>reinicia sozinha</b>. Padrão: 3 minutos. Vale na hora, sem reiniciar.')}</label>
            <div class="cfg-in">checar a cada <input type="number" name="healthMin" min="0" max="120" step="1" value="${e.healthMin}"><span class="suf">min (0 = off)</span></div>
          </div>
          <div>
            <label>Máx. experimentais por turma${infoI('Quando uma turma já tem esse número de experimentais marcadas, a SoFIA <b>para de oferecer</b> aquele horário (mesmo com vaga normal). Aumente para aceitar mais. Padrão: 2. Vale na próxima atualização da grade. <b>Atenção:</b> a checagem final roda no formulário (Render) — se aumentar muito aqui, ajuste o EVO_MAX_EXPERIMENTAIS lá também.')}</label>
            <div class="cfg-in"><input type="number" name="expLimite" min="0" max="50" step="1" value="${lerExpLimite() == null ? 2 : lerExpLimite()}"><span class="suf">por turma (0 = sem limite)</span></div>
          </div>
          <div>
            <label>Antecedência mínima da experimental${infoI('Em <b>dia útil</b>, a experimental só pode ser marcada com pelo menos este número de <b>horas de antecedência</b> — os horários "em cima da hora" <b>somem da grade</b> (formulário, Cadastro Express e SoFIA) e a SoFIA recusa se pedirem. No <b>fim de semana</b> a regra é fixa: só a partir de <b>segunda-feira à tarde</b>. Padrão: 4 horas. Vale por unidade; a grade aplica na próxima atualização.')}</label>
            <div class="cfg-in"><input type="number" name="antecedenciaHoras" min="0" max="168" step="1" value="${lerAntecedenciaHoras() == null ? 4 : lerAntecedenciaHoras()}"><span class="suf">horas antes (dia útil)</span></div>
          </div>
          <div>
            <label>Trava de atendimento humano${infoI('Quando um atendente clica em <b>assumir</b> (🧑) uma conversa, ela fica <b>travada só para ele</b> por este tempo — os outros veem cadeado 🔒 e não conseguem escrever (evita dois atendentes na mesma conversa). Cada mensagem enviada <b>renova</b> a trava. Passado o tempo <b>sem atividade</b>, a trava libera e a <b>SoFIA reassume sozinha</b> a conversa. Padrão: 60 minutos. Vale na hora.')}</label>
            <div class="cfg-in"><input type="number" name="humanoLockMin" min="1" max="1440" step="1" value="${(function(){try{return sofia.lerHumanoLockMin();}catch(_){return 60;}})()}"><span class="suf">min</span></div>
          </div>
          <div>
            <label>"Sem resposta" — silêncio mínimo${infoI('Na aba <b>Conversas</b> existe um filtro que mostra só os contatos que <b>pararam de responder</b>. Aqui você define o <b>silêncio mínimo</b>: só entra quem não manda mensagem há pelo menos esse tempo. Só afeta a listagem do painel — não o robô nem o follow-up. Padrão: 24 horas.')}</label>
            <div class="cfg-in"><input type="number" name="quietoHoras" min="1" max="720" step="1" value="${e.quieto.horas}"><span class="suf">horas</span></div>
          </div>
          <div>
            <label>"Sem resposta" — janela${infoI('Idade <b>máxima</b> da última mensagem do contato para ele aparecer no filtro. Ex.: 4 dias mostra só quem sumiu nos últimos 4 dias (não desenterra conversas antigas). Padrão: 4 dias.')}</label>
            <div class="cfg-in">últimos <input type="number" name="quietoDias" min="1" max="60" step="1" value="${e.quieto.dias}"><span class="suf">dias</span></div>
          </div>
          <div>
            <label>Guardar histórico das conversas${infoI('Por quanto tempo o painel guarda o histórico das conversas na aba Conversas. Depois disso, as conversas paradas somem da lista (o WhatsApp da aluna não é afetado). <b>0 = nunca apagar</b> (guarda tudo). Padrão: 365 dias. Vale para a SoFIA na próxima limpeza — não precisa reiniciar.')}</label>
            <div class="cfg-in"><input type="number" name="inboxDias" min="0" max="36500" step="1" value="${e.inboxDias}"><span class="suf">dias (0 = sempre)</span></div>
          </div>
        </div>
      </div>

      </details>

      <details class="acc-sec">
        <summary class="sec-t" style="cursor:pointer;padding:4px 0">Follow-up de leads <small style="font-weight:400;color:var(--cinza)">— a SoFIA retoma sozinha quem esfriou sem agendar</small></summary>
      <div class="card">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" name="followupOn" value="1"${e.followup.on ? ' checked' : ''} style="width:auto;margin:0">
          Ativar follow-up automático${infoI('Quando uma lead conversa e <b>para de responder sem agendar</b>, a SoFIA espera o tempo abaixo e manda <b>uma</b> mensagem de retomada, escrita pela IA com base nas últimas mensagens daquela conversa. Nunca incomoda quem <b>já agendou</b>, quem está <b>bloqueado</b>, sob <b>controle humano</b> ou com a conversa <b>encerrada à mão</b> (🔒), e manda <b>só uma vez</b> por conversa (até a lead responder de novo).')}
        </label>
        <p class="quando" style="margin:6px 0 14px">Desativado, a SoFIA não faz retomada nenhuma. Ao <b>ligar</b>, vale <b>só daqui pra frente</b> — o acúmulo de conversas antigas não recebe (evita disparo em massa).</p>
        <div style="max-width:420px">
          <label>Esperar sem resposta</label>
          <div class="cfg-in"><input type="number" name="followupHoras" min="0.25" max="720" step="0.25" value="${e.followup.horas}"><span class="suf">horas (ex.: 24 = 1 dia)</span></div>
        </div>
        <div style="margin-top:14px;max-width:420px">
          <label>Só enviar entre${infoI('Horário permitido para a retomada. Se o prazo acima vencer <b>fora</b> desta janela (ex.: 19h50), a SoFIA <b>não manda de madrugada</b> — espera e envia no <b>próximo horário permitido</b> (ex.: 8h do dia seguinte). Nesse meio-tempo, a conversa aparece na aba <b>Conversas</b> com o selo <b>⏳ follow-up &lt;hora&gt;</b>. Horário de Brasília.')}</label>
          <div class="cfg-in" style="gap:8px"><input type="time" name="followupJanIni" value="${esc(e.followup.janelaIni)}" style="width:auto"><span class="suf">e</span><input type="time" name="followupJanFim" value="${esc(e.followup.janelaFim)}" style="width:auto"></div>
        </div>
        ${(function(){ var ks=Object.keys(E.fuEsperando||{}); var n=ks.length; if(!n) return ''; var h=esc(E.fuEsperando[ks[0]]||e.followup.janelaIni); return '<div style="margin-top:12px;background:var(--warn-bg);border:1px solid #f0d9a8;border-radius:10px;padding:10px 12px"><p class="quando" style="margin:0;color:#8a6100">⏳ <b>'+n+' lead'+(n>1?'s':'')+' aguardando o horário</b> — '+(n>1?'saem':'sai')+' a partir das <b>'+h+'</b>. Venceram fora da janela; a SoFIA segura para não enviar tarde da noite. (Na aba <b>Conversas</b> aparecem com o selo ⏳.)</p></div>'; })()}
        <div style="margin-top:14px">
          <label>Instrução para a IA gerar a mensagem</label>
          <textarea name="followupInstrucao" rows="3" maxlength="1000" placeholder="Ex.: Pergunte se ela ainda tem interesse e retome o convite para a aula experimental gratuita, de forma calorosa." style="width:100%;resize:vertical">${esc(e.followup.instrucao)}</textarea>
          <p class="quando" style="margin:6px 0 0">A IA escreve a mensagem no tom da SoFIA, usando o contexto da conversa + essa orientação.</p>
        </div>
        <div style="margin-top:14px">
          <label>Não enviar follow-up para estas tags ${infoI('Marque as etiquetas do CRM cujos contatos <b>não</b> devem receber a retomada. Um contato com <b>qualquer uma</b> delas fica de fora. Útil para quem <b>já agendou</b> (ex.: <b>FX - 3. Agendou Aula Exp</b>) ou já foi <b>encerrado</b> no funil (ex.: <b>FX - 2. Encerrado com Agendamento sem Presença</b>). Compara sem ligar para acento/maiúscula/pontuação. Quem tem <b>"Sem interesse"</b> já é pulado sozinho.')}</label>
          ${(function () {
            let fuTags = []; try { fuTags = contatos.tagsDistintas().map(t => t.tag); } catch (_) {}
            const sel = Array.isArray(e.followup.tagsExcluir) ? e.followup.tagsExcluir : [];
            for (const t of sel) { if (!fuTags.some(x => x.toLowerCase() === String(t).toLowerCase())) fuTags = [t].concat(fuTags); }
            const selL = new Set(sel.map(t => String(t).trim().toLowerCase()));
            return '<div class="cfg-in" style="flex-direction:column;align-items:flex-start;gap:6px;max-height:180px;overflow:auto;padding:8px 10px">'
              + (fuTags.length
                  ? fuTags.map(t => `<label class="chk" style="margin:0;font-weight:500"><input type="checkbox" name="followupTagExcl" value="${esc(t)}"${selL.has(String(t).trim().toLowerCase()) ? ' checked' : ''}> ${esc(t)}</label>`).join('')
                  : '<span class="quando" style="margin:0">Nenhuma etiqueta no CRM ainda.</span>')
              + '</div>';
          })()}
        </div>
      </div>

      </details>

      <details class="acc-sec" open>
        <summary class="sec-t">Prompt da SoFIA <small style="font-weight:400;color:var(--cinza)">— o roteiro (cada bloco é uma parte do atendimento; clique no título p/ abrir, ↑↓ reordenam)</small></summary>
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px">
            <button type="button" class="reset" onclick="expandirTodas(true)" style="padding:6px 12px">▾ Expandir todas</button>
            <button type="button" class="reset" onclick="expandirTodas(false)" style="padding:6px 12px">▸ Recolher todas</button>
          </div>
          <div id="secoes">${cardsSecoes}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 0">
            <button type="button" class="reset" onclick="adicionarSecao()">➕ Nova seção</button>
            <button type="button" class="reset" title="Salva um .txt com o roteiro que está valendo agora — bom fazer antes de mexer" onclick="location.href='/sofia/prompt/download'">⬇️ Baixar prompt atual</button>
            <button type="button" class="reset" title="Troca o prompt inteiro por um .txt (mostra antes o que muda)" onclick="document.getElementById('impFile').click()">⬆️ Importar prompt</button>
            <input type="file" id="impFile" accept=".txt,text/plain" style="display:none" onchange="impLer(this)">
          </div>
          <div id="impBox" style="display:none;margin-top:10px;border:1px solid var(--linha);border-radius:12px;padding:12px 14px;background:var(--card)"></div>
        </div>
      </details>

      <details class="acc-sec">
        <summary class="sec-t">Script de integração <small style="font-weight:400;color:var(--cinza)">— dados enviados ao EVO</small></summary>
      <div class="card">
        <label>Extração do resumo (nome, e-mail, dia, hora)</label>
        <textarea name="extracao" rows="12" spellcheck="false">${esc(e.extracao)}</textarea>
      </div>
      </details>

      <details class="acc-sec">
        <summary class="sec-t">Imagens <small style="font-weight:400;color:var(--cinza)">— anexe a imagem (a SoFIA envia no WhatsApp) e cole o link do Drive</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">A <b>Imagem</b> é o arquivo que a SoFIA <b>anexa na conversa</b> (foto). O <b>Link (Drive)</b> é a URL que ela manda em texto pra aluna abrir. Em cada imagem você pode <b>colar uma URL</b> ou <b>anexar um arquivo</b> (o anexo substitui o anterior).</p>
        ${inpMidiaImg('precos_imagem', e.midias.precos_imagem, 'Imagem da TABELA DE PREÇOS')}
        ${inpMidia('precos_link', e.midias.precos_link, 'Link (Google Drive) da tabela de preços')}
        ${inpMidiaImg('grade_imagem', e.midias.grade_imagem, 'Imagem da GRADE DE HORÁRIOS')}
        ${inpMidia('grade_link', e.midias.grade_link, 'Link (Google Drive) da grade')}
        <script>
        function subirMidia(campo, input){
          var f = input.files && input.files[0]; if(!f) return;
          var st = document.getElementById('ms_'+campo); if(st) st.textContent='enviando…';
          var rd = new FileReader();
          rd.onload = function(){
            fetch('/sofia/midia-upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({campo:campo,dataUrl:rd.result})})
              .then(function(r){return r.json();})
              .then(function(j){
                if(j && j.ok){
                  var mi=document.getElementById('mi_'+campo); if(mi) mi.value=j.path;
                  var t=document.getElementById('mt_'+campo); if(t){ t.style.display='block'; t.src='/sofia/midia?campo='+campo+'&t='+Date.now(); }
                  // preenche o campo de LINK (Drive) com a URL pública da própria imagem
                  var msg='✅ imagem anexada';
                  if(j.publicUrl){ var campoLink=campo.replace('_imagem','_link'); var li=document.querySelector('input[name="'+campoLink+'"]'); if(li){ li.value=j.publicUrl; msg+=' · 🔗 link público preenchido (clique em Salvar para confirmar)'; } }
                  if(st) st.textContent=msg;
                }
                else { if(st) st.textContent='❌ '+((j&&j.erro)||'falhou'); }
              })
              .catch(function(e){ if(st) st.textContent='❌ '+e; });
            input.value='';
          };
          rd.readAsDataURL(f);
        }
        </script>
      </div>
      </details>

      <details class="acc-sec">
        <summary class="sec-t">📋 Regras de Negócio da SoFIA <small style="font-weight:400;color:var(--cinza)">— como ela decide o que fazer (só leitura)</small></summary>
      <div class="card">
        <p class="quando" style="margin:0 0 12px">Um resumo, em português claro, do que a SoFIA faz <b>sozinha</b> em cada situação. Nada aqui é editável — é só para consulta. O que dá para ajustar fica nas abas <b>Configuração</b>, <b>Conversas</b>, <b>Tags</b> e <b>Campanhas</b>.</p>

        <div style="display:grid;gap:12px">
          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">🔕 Quando ela NÃO responde (fica calada)</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Quando a SoFIA está <b>pausada</b> (botão ⏸️) — atendimento 100% manual.</li>
              <li>Números na lista <b>"Não responder"</b>.</li>
              <li>Conversa sob <b>controle humano</b> (interruptor na aba Conversas).</li>
              <li>Logo depois de <b>você responder</b> pelo celular ou pelo painel — ela sai por alguns minutos e depois reassume sozinha.</li>
              <li><b>Aluna dentro do horário da recepção</b> — quem atende é a recepcionista.</li>
              <li><b>Saudação automática de outra empresa</b> (WhatsApp Business) — ela não conversa com o robô do outro lado.</li>
            </ul>
            <p class="quando" style="margin:5px 0 0">Em todos esses casos a mensagem <b>ainda aparece</b> nas Conversas, para a equipe ver.</p>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">🧠 Memória e encerramento</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Depois de um tempo <b>sem falar</b>, a conversa "zera" e ela recomeça do zero (refaz a saudação).</li>
              <li><b>Encerrar</b> a conversa (🔒) fecha na hora e já aplica a <b>automação de tag de encerramento</b> (se configurada, ex.: "Encerrado sem agendamento"); a próxima mensagem começa uma conversa nova.</li>
              <li>Se der uma <b>instabilidade</b>, a aluna recebe um "reenvie, por favor" — nunca um erro técnico.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">💬 Follow-up (retomar quem sumiu)</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Só para quem <b>conversou e sumiu sem agendar</b>, e só dentro do horário que você definir.</li>
              <li>Abre com uma <b>saudação pelo horário</b> (Bom dia/Boa tarde/Boa noite) e o <b>nome</b> da lead — como costuma cair em outro dia, fica natural.</li>
              <li><b>Uma vez</b> por conversa — para de insistir se ela responder.</li>
              <li>Não incomoda quem <b>já agendou</b> nem quem tem a tag <b>"Sem interesse"</b>.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">📅 Agendamento da aula experimental</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>No começo do agendamento, <b>envia a grade de horários</b> como referência (uma vez) e pergunta a preferência.</li>
              <li><b>Nunca confirma um horário</b> sem checar a vaga de verdade na grade.</li>
              <li>Só oferece horários <b>com vaga</b> — deixa claro que é a "disponibilidade" do dia; a imagem mostra tudo, mas a vaga real vem do sistema na hora.</li>
              <li>Antecedência: dia útil <b>mín. 4h</b>; fim de semana só a partir de <b>segunda à tarde</b>.</li>
              <li>Pede <b>nome completo e e-mail</b> antes de agendar.</li>
              <li>Só diz "agendado" se o sistema <b>confirmar</b> de verdade; se der problema, manda falar com a secretária.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">💲 Preço e informações</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Ao perguntarem preço, ela <b>sempre dá o valor de entrada primeiro</b> — nada de "varia/depende".</li>
              <li><b>Nunca inventa</b>: o que não está no roteiro, ela diz que "a secretária confirma".</li>
              <li>A <b>tabela de preços</b> vai sempre por imagem, nunca digitada.</li>
              <li>Só fala do SlimFit e é <b>exclusivo para mulheres</b>.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">🎓 Alunas contratadas</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Reconhece pela <b>etiqueta de aluna</b> e não oferece experimental nem preço para ela.</li>
              <li><b>Remarca</b> só com um "sim" claro; regra de <b>1 aula por dia</b>.</li>
              <li><b>Valores e cobrança</b> são sempre encaminhados para a recepção.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">🏷️ Etiquetas e pedido de atendente</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Etiqueta sozinha por <b>palavra-chave</b>, <b>intenção da conversa</b> e <b>resposta a campanhas</b>.</li>
              <li>Quando a aluna <b>pede uma pessoa/atendente</b>, avisa um WhatsApp e <b>pinta a conversa de vermelho</b> no painel.</li>
            </ul>
          </div>

          <div class="rn-bloco" style="border-left:3px solid var(--teal,#2a9d8f);padding:2px 0 2px 12px">
            <div style="font-weight:800;font-size:.92rem;margin:0 0 4px">📣 Campanhas</div>
            <ul style="margin:0;padding-left:18px;line-height:1.55;color:var(--cinza)">
              <li>Respeita o <b>intervalo entre envios</b> (padrão 120–180s) — inclusive no "Enviar agora".</li>
              <li><b>Pausa sozinha</b> se der muitas falhas seguidas, para proteger o número.</li>
            </ul>
          </div>
        </div>
      </div>
      </details>

      <div class="hbar">
        <div class="acts">
          <button type="submit" class="save">💾 Salvar tudo</button>
          <button type="submit" class="reset" formaction="/sofia/restaurar" onclick="return confirm('Restaurar a versão anterior de TODOS os campos?')">↩️ Restaurar anterior</button>
        </div>
        <p class="quando" style="text-align:center;margin:8px 0 0">Vale nas próximas conversas — a SoFIA lê os arquivos na hora, sem reiniciar.</p>
      </div>
    </form>
  </div>
<script>
  function renderSofiaWa(st){
    var e = st && st.estado;
    if(e==='conectado') return '<div class="wa-card ok"><div class="wa-ic">🤖</div><h2>WhatsApp da SoFIA conectado</h2><p>A SoFIA está no ar e responde as alunas neste número.</p></div>';
    if(e==='codigo' && st.codigo) return '<div class="wa-card warn"><div class="wa-ic">🔑</div><h2>Conectar a SoFIA</h2><p>No celular do número da SoFIA (WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>), use <b>um</b> destes:</p><p style="margin:8px 0 2px"><b>1) Por código</b> — toque em <b>Conectar com número de telefone</b> e digite:</p><div style="font-family:ui-monospace,monospace;font-size:2rem;font-weight:800;letter-spacing:.18em;text-align:center;margin:6px 0;user-select:all">'+st.codigo+'</div>'+(st.qr?'<p style="margin:10px 0 2px"><b>2) Por QR</b> — ou aponte a câmera para este código:</p><img class="qr" src="'+st.qr+'" alt="QR da SoFIA">':'')+'<p class="wa-hint">O código vale alguns minutos e se renova sozinho. Assim que conectar, vira “🤖 conectado”.</p></div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR da SoFIA</h2><p>Este é o WhatsApp <b>da SoFIA</b> (número próprio, diferente do robô de mensagens). No celular do número da SoFIA: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte para o código.</p><img class="qr" src="'+st.qr+'" alt="QR da SoFIA"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira “🤖 conectado”.</p></div>';
    if(e==='iniciando') return '<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>Subindo a conexão da SoFIA. Se precisar de QR, ele aparece aqui.</p></div>';
    if(e==='desconectado') return '<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>A SoFIA caiu. Se aparecer um QR aqui, escaneie de novo.</p></div>';
    return '<div class="wa-card"><div class="wa-ic">❔</div><h2>Conexão da SoFIA — sem informação</h2><p>O processo da SoFIA (${PM2_SOFIA}) precisa estar rodando e publicando o estado.</p></div>';
  }
  function atualizaSofiaWa(){
    fetch('/sofia/estado',{cache:'no-store'}).then(function(r){return r.json();}).then(function(st){
      var el=document.getElementById('sofiaWa'); if(el) el.innerHTML=renderSofiaWa(st);
      var d=document.getElementById('sofiaBtnDesc'); if(d) d.style.display=(st&&st.estado==='conectado')?'inline':'none';
    }).catch(function(){});
  }
  atualizaSofiaWa(); setInterval(atualizaSofiaWa, 5000);

  // Conectar a SoFIA por CÓDIGO (sem QR): manda o número; o código sai no quadro acima.
  function pedirCodigoSofia(){
    var inp=document.getElementById('sofPairNum'), msg=document.getElementById('sofPairMsg'), btn=document.getElementById('sofPairBtn');
    var num=(inp.value||'').replace(/\\D/g,'');
    if(num.length<10){ msg.style.color='#c0392b'; msg.textContent='Informe o número completo (DDI+DDD+número).'; return; }
    btn.disabled=true; msg.style.color=''; msg.textContent='gerando…';
    fetch('/sofia/parear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({numero:num})})
      .then(function(r){return r.json();}).then(function(j){
        btn.disabled=false;
        if(j&&j.ok){ msg.style.color='#0a7a52'; msg.textContent='Pedido enviado — o código aparece acima em ~20s.'; atualizaSofiaWa(); }
        else { msg.style.color='#c0392b'; msg.textContent=(j&&j.erro)||'Não consegui pedir o código.'; }
      }).catch(function(){ btn.disabled=false; msg.style.color='#c0392b'; msg.textContent='Falha de conexão.'; });
  }

  // Editar seções do prompt: recolher/expandir, reordenar (↑↓), remover, adicionar.
  function toggleSecao(btn){
    var card = btn.closest('.sec-card'); if(!card) return;
    var ta = card.querySelector('textarea'); if(!ta) return;
    var aberto = ta.style.display !== 'none';
    ta.style.display = aberto ? 'none' : 'block';
    btn.textContent = aberto ? '▸' : '▾';
  }
  function moverSecao(btn, dir){
    var card = btn.closest('.sec-card'); if(!card || !card.parentNode) return;
    var wrap = card.parentNode;
    if(dir < 0){ var prev = card.previousElementSibling; if(prev) wrap.insertBefore(card, prev); }
    else { var next = card.nextElementSibling; if(next) wrap.insertBefore(next, card); }
    card.scrollIntoView({block:'nearest'});
  }
  function expandirTodas(abrir){
    var cards = document.querySelectorAll('#secoes .sec-card');
    for(var i=0;i<cards.length;i++){
      var ta = cards[i].querySelector('textarea'), tog = cards[i].querySelector('.secTog');
      if(ta){ ta.style.display = abrir ? 'block' : 'none'; }
      if(tog){ tog.textContent = abrir ? '▾' : '▸'; }
    }
  }
  function removerSecao(btn){
    if(!confirm('Remover esta seção inteira? (título e conteúdo)')) return;
    var card = btn.closest('.sec-card'); if(card && card.parentNode) card.parentNode.removeChild(card);
  }
  // Importar prompt: lê o .txt, mostra o que muda e só grava depois de confirmar.
  var impTexto='';
  function impEsc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function impFechar(){ document.getElementById('impBox').style.display='none'; impTexto=''; }
  function impLer(inp){
    var f=inp.files[0], box=document.getElementById('impBox'); if(!f) return;
    var r=new FileReader();
    r.onload=function(){
      impTexto=String(r.result||''); inp.value='';
      box.style.display='block'; box.innerHTML='⏳ Lendo o arquivo…';
      fetch('/sofia/prompt/previa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:impTexto})}).then(function(x){return x.json();}).then(function(d){
        if(!d.ok){ box.innerHTML='⚠️ '+impEsc(d.erro||'não consegui ler o arquivo'); return; }
        if(d.valido){ box.innerHTML='<b>'+impEsc(f.name)+'</b><div style="color:#a12626;margin-top:6px">⚠️ '+impEsc(d.valido)+'</div><div style="margin-top:10px"><button type="button" class="reset" onclick="impFechar()">Fechar</button></div>'; return; }
        var cont={alterada:0,nova:0,removida:0,igual:0}; d.secoes.forEach(function(s){ cont[s.status]++; });
        var rot={alterada:['✏️ muda','#8a6300'],nova:['➕ nova','#1c8f52'],removida:['🗑️ sai','#a12626']};
        var linhas=d.secoes.filter(function(s){ return s.status!=='igual'; }).map(function(s){ return '<div style="padding:5px 0;border-top:1px solid var(--linha-soft)"><b style="color:'+rot[s.status][1]+'">'+rot[s.status][0]+'</b> · '+impEsc(s.titulo)+'</div>'; }).join('');
        box.innerHTML='<b>'+impEsc(f.name)+'</b> — '+d.total+' seções: '+cont.alterada+' mudam, '+cont.nova+' novas, '+cont.removida+' saem, '+cont.igual+' iguais.'
          +(d.valido?'<div style="color:#a12626;margin-top:8px">⚠️ '+impEsc(d.valido)+'</div>':'')
          +(linhas?'<div style="margin-top:8px;font-size:.88rem">'+linhas+'</div>':'<div style="margin-top:8px">Nada muda — o arquivo é igual ao prompt atual.</div>')
          +'<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'+((d.valido||!linhas)?'':'<button type="button" class="save" onclick="impConfirmar(this)">Importar e salvar</button>')+'<button type="button" class="reset" onclick="impFechar()">Cancelar</button></div>'
          +'<div class="quando" style="margin-top:8px">O prompt atual fica guardado: dá para voltar com “Restaurar anterior”. O que você mudou nesta tela e ainda não salvou será descartado.</div>';
      }).catch(function(){ box.innerHTML='❌ erro de rede — tente de novo.'; });
    };
    r.readAsText(f,'utf-8');
  }
  function impConfirmar(b){
    var box=document.getElementById('impBox'); b.disabled=true;
    fetch('/sofia/prompt/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:impTexto})}).then(function(x){return x.json();}).then(function(d){
      if(!d.ok){ b.disabled=false; box.insertAdjacentHTML('beforeend','<div style="color:#a12626;margin-top:6px">⚠️ '+impEsc(d.erro||'não consegui importar')+'</div>'); return; }
      box.innerHTML='✅ Prompt importado ('+d.secoes+' seções) — vale na próxima mensagem. Recarregando…';
      window.onbeforeunload=null; setTimeout(function(){ location.reload(); },900);
    }).catch(function(){ b.disabled=false; });
  }
  function adicionarSecao(){
    var wrap = document.getElementById('secoes'); if(!wrap) return;
    var div = document.createElement('div');
    div.className = 'card sec-card';
    // Nova seção já ENTRA ABERTA (o textarea visível) para você digitar de cara.
    div.innerHTML = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">'
      + '<button type="button" class="reset secTog" onclick="toggleSecao(this)" title="Expandir/recolher" style="padding:6px 9px;flex:none">▾</button>'
      + '<input type="text" name="titulo[]" value="" placeholder="TÍTULO DA SEÇÃO" style="flex:1;min-width:0;font-weight:700;font-family:"Inter",sans-serif;font-size:.9rem">'
      + '<button type="button" class="reset" onclick="moverSecao(this,-1)" title="Subir" style="padding:6px 9px;flex:none">↑</button>'
      + '<button type="button" class="reset" onclick="moverSecao(this,1)" title="Descer" style="padding:6px 9px;flex:none">↓</button>'
      + '<button type="button" class="reset" onclick="removerSecao(this)" title="Remover esta seção" style="padding:6px 10px;flex:none">🗑️</button>'
      + '</div><textarea name="corpo[]" rows="6" spellcheck="false" style="display:block"></textarea>';
    wrap.appendChild(div);
    var inp = div.querySelector('input'); if(inp) inp.focus();
  }
</script>`;
  return chrome({ tab: 'SoFIA', h1: 'SoFIA', p: 'Edite o prompt, as configurações e conecte o WhatsApp da SoFIA.' }, 'sofia', corpo);
}

// ── Página: SoFIA → Custo IA ────────────────────────────────────────────────
function paginaSofiaCusto(aviso, erro, params) {
  params = params || {};
  const c = sofia.lerCusto(100000); // todos os dias agregados; filtramos abaixo
  const janelas = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['0', 'Tudo']];
  const custom = !!(params.de || params.ate);
  const per = custom ? '' : (['hoje', '7', '30', '0'].includes(params.per) ? params.per : '7');
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const menosDias = (base, n) => { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  let ini = '', fim = hojeStr, rotulo = '';
  if (custom) { ini = params.de || ''; fim = params.ate || hojeStr; rotulo = `${params.de || 'início'} até ${fim}`; }
  else if (per === 'hoje') { ini = hojeStr; fim = hojeStr; rotulo = 'hoje'; }
  else if (per === '7') { ini = menosDias(hojeStr, 6); rotulo = 'últimos 7 dias'; }
  else if (per === '30') { ini = menosDias(hojeStr, 29); rotulo = 'últimos 30 dias'; }
  else { ini = ''; rotulo = 'todo o período'; }
  const dentro = (dia) => (!ini || dia >= ini) && (!fim || dia <= fim);
  const dias = c.porDia.filter(d => dentro(d.dia)).sort((a, b) => a.dia < b.dia ? -1 : 1);
  const tot = dias.reduce((a, d) => ({ usd: a.usd + d.usd, convs: a.convs + d.convs, inTok: a.inTok + d.inTok, outTok: a.outTok + d.outTok }), { usd: 0, convs: 0, inTok: 0, outTok: 0 });
  const usd = (v) => 'US$ ' + (v || 0).toFixed(2);
  const cot = cotacaoUSD();
  const brl = (v) => 'R$ ' + ((v || 0) * cot).toFixed(2).replace('.', ',');
  const ci = cotacaoInfo();
  const cotHora = ci.em ? new Date(ci.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const cotLinha = `<p class="quando" style="text-align:center;margin:8px 0 0">💱 Convertido a US$ 1 = R$ ${cot.toFixed(2).replace('.', ',')}${ci.fonte === 'awesomeapi' && cotHora ? ` · cotação de ${cotHora}` : ' · cotação aproximada'}</p>`;
  const ktok = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v || 0);
  const fmtDiaC = (s) => { const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  const maxU = Math.max(0.0001, ...dias.map(d => d.usd));
  const barras = dias.length
    ? dias.slice().reverse().map(d => uiBarra({ rot: fmtDiaC(d.dia), n: d.usd, max: maxU, texto: '', valor: `${brl(d.usd)} <small>(${usd(d.usd)}) · ${d.convs} conv.</small>` })).join('')
    : '<div class="vazio">Sem gasto registrado no período.</div>';
  // Gasto por conversa (telefone) no mesmo período. Só entram os turnos que já
  // trazem o telefone (registrados após ativar este detalhamento).
  let porConv = { linhas: [], semTel: 0 };
  try { porConv = sofia.lerCustoPorConversa(ini, fim || hojeStr); } catch (_) {}
  let cmap = {}; try { cmap = contatos.carregar() || {}; } catch (_) {}
  const nomeDe = (tel) => { try { const ct = cmap[contatos.normTel(tel)]; return ct && ct.nome ? ct.nome : ''; } catch (_) { return ''; } };
  const fmtTel = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') || d; };
  const convRows = porConv.linhas.slice(0, 60).map(x => {
    const nm = nomeDe(x.tel);
    const d8 = String(x.tel || '').replace(/\D/g, '').slice(-8);
    return uiPessoa({
      nome: nm || fmtTel(String(x.tel || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')) || '(sem telefone)', href: d8 ? '/sofia?view=contatos&q=' + d8 : '',
      meta: [nm ? `📱 ${fmtTel(String(x.tel || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''))}` : '', `💬 <b>${x.turnos}</b> msg`, `🔤 ${ktok(x.inTok + x.outTok)} tokens`],
      direita: `${brl(x.usd)} <small>${usd(x.usd)}</small>`,
    });
  }).join('');
  const convNota = [];
  if (porConv.linhas.length > 60) convNota.push(`Mostrando as 60 conversas de maior gasto (de ${porConv.linhas.length}).`);
  if (porConv.semTel > 0.005) convNota.push(`Conversas anteriores à ativação deste detalhamento somam ${brl(porConv.semTel)} (${usd(porConv.semTel)}) sem separar por aluna.`);
  const convBloco = convRows
    ? `<div class="ip-lista">${convRows}</div>` + (convNota.length ? `<p class="quando" style="margin:12px 0 0">${convNota.join(' ')}</p>` : '')
    : `<div class="vazio">Nenhuma conversa com gasto por aluna neste período ainda.${porConv.semTel > 0.005 ? ` (Há ${brl(porConv.semTel)} de conversas anteriores à ativação, sem separar por aluna.)` : ''}</div>`;
  // Gasto por TIPO (tudo que gasta token: conversas, gerador de frases, resumos,
  // tags por intenção, follow-up).
  let porTipo = []; try { porTipo = sofia.lerCustoPorTipo(ini, fim || hojeStr); } catch (_) {}
  const rotTipo = { conversa: '💬 Conversas', gerador: '✨ Gerador de frases', resumo: '📝 Resumos de interações', tags: '🏷️ Tags por intenção', followup: '🔁 Follow-up' };
  const totTipo = porTipo.reduce((a, t) => a + (t.usd || 0), 0);
  const tipoRows = porTipo.map(t => uiBarra({ largo: true, rot: `${rotTipo[t.tipo] || esc(t.tipo)} <small style="color:var(--faint);font-weight:600">· ${t.n}×</small>`, n: t.usd, max: totTipo, valor: `${brl(t.usd)} <small>· ${ktok(t.inTok + t.outTok)} tok</small>` })).join('');
  const tipoBloco = tipoRows
    ? tipoRows + `<p class="quando" style="margin:12px 0 0">A barra é a parte de cada tipo no gasto do período. As <b>Conversas</b> usam o custo real da IA. O restante (gerador, resumos, tags, follow-up) é <b>estimado</b> por tokens × preço do modelo.</p>`
    : '<div class="vazio">Sem uso de IA registrado no período.</div>';
  const segs = uiChips('Período', janelas.map(([v, l]) => [`/sofia?view=custo&per=${v}`, l, !custom && per === v]));
  const limite = c.limite;
  const alerta = (limite > 0 && c.hoje.usd >= limite) ? `<div class="aviso err">⚠️ O gasto de <b>hoje</b> (${brl(c.hoje.usd)} · ${usd(c.hoje.usd)}) atingiu o limite de ${usd(limite)}.</div>` : '';
  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavSofia('custo')}
    ${uiTopo({
      titulo: 'Custo da IA',
      sub: 'Quanto a SoFIA gastou de inteligência artificial: conversas, gerador de frases, resumos, tags por intenção e follow-up.',
      linhas: [segs, uiDatas({ action: '/sofia', de: params.de, ate: params.ate, extra: '<input type="hidden" name="view" value="custo">', limpar: custom ? '/sofia?view=custo&per=7' : '' })],
    })}
    ${alerta}
    <div class="stats">
      <div class="stat tot"><div class="n">${brl(tot.usd)}</div><div class="l">gasto · ${esc(rotulo)}</div><div class="l" style="opacity:.6;margin-top:2px">${usd(tot.usd)}</div></div>
      <div class="stat"><div class="n" style="color:var(--cinza)">${tot.convs}</div><div class="l">conversas</div></div>
      <div class="stat"><div class="n" style="color:var(--cinza)">${ktok(tot.inTok + tot.outTok)}</div><div class="l">tokens</div></div>
      <div class="stat ok"><div class="n">${tot.convs ? brl(tot.usd / tot.convs) : brl(0)}</div><div class="l">média/conversa</div><div class="l" style="opacity:.6;margin-top:2px">${tot.convs ? usd(tot.usd / tot.convs) : usd(0)}</div></div>
    </div>
    ${cotLinha}
    <div class="ui-secoes">
    <div class="sec-t">Gasto por dia</div>
    <div class="card">${barras}</div>
    <div class="sec-t">Gasto por tipo <small style="font-weight:600;color:var(--cinza)">(tudo que consome token)</small></div>
    <div class="card">${tipoBloco}</div>
    <div class="sec-t">Gasto por conversa <small style="font-weight:600;color:var(--cinza)">(quanto a IA custou com cada aluna no período)</small></div>
    <div class="card">${convBloco}</div>
    <div class="sec-t">Alerta de gasto diário</div>
    <div class="card">
      <form method="POST" action="/sofia/custo-limite" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Avisar quando o gasto de um dia passar de (US$)</label>
        <input type="number" step="0.5" min="0" name="limite" value="${limite || ''}" placeholder="0 = sem alerta" style="max-width:200px"></div>
        <button class="save" type="submit">Salvar</button>
      </form>
      <p class="quando" style="margin:10px 0 0">Mostra um aviso nesta tela quando o gasto do dia atingir o valor. Deixe <b>0</b> para não alertar.</p>
    </div>
    </div>
    <p class="ui-rodape">Inclui <b>tudo que consome token</b>: conversas, gerador de frases, resumos, tags por intenção e follow-up. As conversas usam o custo real da IA; o restante é estimado por tokens × preço do modelo.</p>
  </div>`;
  return chrome({ tab: 'Custo IA', h1: 'SoFIA', p: 'Custo da IA — gasto das conversas por período.' }, 'sofia', corpo);
}

module.exports = {
  PM2_PAINEL, COTACAO_FILE, COTACAO_TTL, atualizarCotacao, cotacaoUSD, cotacaoInfo, EXP_LIM_FILE, lerExpLimite, ANTEC_FILE, lerAntecedenciaHoras, CHATBOT_ENV_FILE, EXPERIMENTAL_ENV_FILE, lerEnvVar, lerApiKey, lerTranscricaoKey, lerTranscricaoProvedor, lerEvoEmail, evoSenhaDefinida, REFRESH_SEG_FILE, lerRefreshSeg, avisoI, blocoSofiaWa, paginaSofiaConversas, paginaSofiaContatos, estimarCampanha, fmtDataBR, campListHTML, paginaSofiaTags, paginaSofiaCampanhas, paginaSofia, paginaSofiaCusto,
};

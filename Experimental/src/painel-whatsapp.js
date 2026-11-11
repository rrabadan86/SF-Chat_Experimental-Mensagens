/**
 * painel-whatsapp.js — telas da aba WhatsApp (Configuração, Cadastro Express, Hoje/Log, Cobrança).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');
const ag = require('./agendamentos');
const waStatus = require('./wa-status');
const horarios = require('./horarios');
const renovacaoConfig = require('./renovacao-config');
const anivExcluir = require('./aniversario-excluir');
const atividade = require('./atividade');
const jobsAtivos = require('./jobs-ativos');
const inadConfig = require('./inadimplentes-config');
const freeCfg = require('./free-antecedencia-config');
const grupos = require('./grupos');
const config = require('./config');
const E = require('./painel-estado');
const {
  esc, PM2_EXP, podeMsgSub, uiTopo, uiChips, infoI, scriptPreviewTeste, chrome, blocoHorario, fmtTel, fmtData, hojeSP, cardMensagem, uiBarra, subnavSofia,
} = require('./painel-base');

// Aula experimental do CIRCUITO SLIM pelo Cadastro Express: id do serviço no EVO
// (cada unidade tem o seu — ex.: 316 no Lago Sul 2). Gravado em
// data/circuito-servico.txt; o agendamento (Python) lê este arquivo. Vazio = desligado.
const CIRC_SERV_FILE = path.join(__dirname, '..', 'data', 'circuito-servico.txt');
function lerCircuitoServico() { try { const v = String(fs.readFileSync(CIRC_SERV_FILE, 'utf8')).trim(); return /^\d+$/.test(v) && +v > 0 ? +v : null; } catch (_) { return null; } }
// Horários dos envios agendados vêm dos jobs (podem ter sido editados no painel).
function horaAg(turno) { return horaTurno(turno === 'manha' ? 'agendadosManha' : 'agendadosTarde') || (turno === 'manha' ? '10:45' : '15:45'); }
function turnoLabel(turno) { return (turno === 'manha' ? '☀️ Manhã · ' : '🌇 Tarde · ') + horaAg(turno); }

// Barra "número para testes" (compartilhada por Mensagens e Instagram).
function barraTeste() {
  return `<div class="card testbar">
    <label>Número para testes</label>
    <input id="telTeste" type="tel" inputmode="numeric" placeholder="(62) 99999-9999" maxlength="16">
    <p class="quando" style="margin:6px 0 0">Usado pelos botões <b>Enviar teste</b>. Fica salvo só neste navegador. A prévia usa valores de exemplo (ex.: nome → <i>Maria</i>).</p>
  </div>`;
}

// Card "Código do EVO (2FA)" — plano B da autenticação em duas etapas do EVO.
// Fica DISCRETO quando não há nada pendente; ACENDE quando o robô está tentando
// entrar no EVO e o código veio por e-mail. A recepção digita o código aqui e o
// robô o recebe (via arquivo compartilhado data/evo-2fa-codigo.json). O caminho
// principal (autenticador/TOTP) é automático — este campo é só a rede de segurança.
function card2FA() {
  return `<div class="card" id="card2fa" style="border-left:4px solid #d7d2cb">
    <div class="chead" style="margin-bottom:2px"><h2 style="font-size:.98rem">🔐 Código do EVO (2FA)</h2><span id="c2faSt" class="pill" style="margin-left:auto;font-size:var(--fs-xs)">nada pendente</span></div>
    <p class="quando" id="c2faHint" style="margin:2px 0 8px">Só é usado quando o robô precisa entrar no EVO e o código vem por <b>e-mail</b>. Quando isso acontecer, aparece um aviso aqui (e no seu celular): pegue o código no e-mail do usuário do robô e digite abaixo. No dia a dia o robô resolve o 2FA sozinho (pelo autenticador) e este campo fica quieto.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="c2faInp" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" maxlength="8" style="max-width:160px;letter-spacing:3px;font-size:1.15rem;text-align:center">
      <button type="button" class="save" id="c2faBtn" onclick="enviar2FA()" style="padding:8px 18px">Enviar</button>
      <span id="c2faMsg" class="quando" style="margin:0"></span>
    </div>
  </div>`;
}

// ── Página 1: editar mensagens (texto + horário de cada uma) ────────────────
// Conexão do WhatsApp do ROBÔ, no MESMO leiaute (wa-card) da aba Sofia.
function blocoWaRobo() {
  const st = waStatus.get() || {};
  if (st.pairingCode) {
    return `<div class="wa-card warn"><div class="wa-ic">🔢</div><h2>Conectando por código</h2><p>Veja o <b>código</b> no quadro "Conectar por código" abaixo e digite no celular do chip.</p></div>`;
  }
  if (st.estado === 'conectado') {
    return `<div class="wa-card ok"><div class="wa-ic">✅</div><h2>WhatsApp conectado</h2><p>A sessão está ativa — o robô envia normalmente.</p></div>`;
  }
  if (st.estado === 'qr' && st.qr) {
    return `<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2>
      <p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código.</p>
      <img class="qr" src="${esc(st.qr)}" alt="QR do WhatsApp"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira ✅.</p></div>`;
  }
  if (st.estado === 'iniciando') {
    return `<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>O robô está subindo a conexão. Se precisar de QR, ele aparece aqui.</p></div>`;
  }
  if (st.estado === 'desconectado') {
    return `<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>O robô está tentando reconectar sozinho. Se aparecer um QR aqui, escaneie.</p></div>`;
  }
  return `<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>Confira se o robô (<code>${esc(PM2_EXP)}</code>) está rodando.</p></div>`;
}

// Sub-navegação da aba WhatsApp Mensagens: Configuração (mensagens/horários),
// Agendamento (envios pontuais), Express (cadastro rápido → agenda no EVO) e Log.
function subnavMensagens(view) {
  const href = (v) => v === 'agendar' ? '/?view=agendar' : (v === 'express' ? '/?view=express' : (v === 'hoje' ? '/hoje' : '/?view=config'));
  const item = (v, rot) => `<a href="${href(v)}"${view === v ? ' class="on"' : ''}>${rot}</a>`;
  const sess = E._navSess || { admin: true, telas: [] };
  let its = '';
  if (podeMsgSub(sess, 'config')) its += item('config', 'Configuração');
  // "Express" = tela unificada (Cadastro Express + Agendar mensagem). Aparece p/
  // quem tem QUALQUER uma das duas permissões (cada seção é gated lá dentro).
  if (podeMsgSub(sess, 'express') || podeMsgSub(sess, 'agendar')) its += item('express', '📅 Express');
  if (podeMsgSub(sess, 'hoje')) its += item('hoje', 'Log');
  return `<div class="subtabs">${its}</div>`;
}

// Card "Grupos do WhatsApp": nomes dos grupos (equipe/circuito) editáveis no
// painel. O robô usa exatamente o texto salvo aqui para achar o grupo — precisa
// bater com o nome real do grupo no WhatsApp.
function cardGrupos() {
  const g = grupos.ler();
  const eqp = grupos.equipe();
  const circ = grupos.circuito();
  return `
  <details class="acc-sec" data-nosec="1" data-dentro="1">
    <summary>👥 Grupos do WhatsApp</summary>
    <div class="card">
      <p class="quando" style="margin:0 0 10px">Nome <b>exato</b> de cada grupo no WhatsApp (com emojis, se tiver). O robô procura o grupo por esse nome — se não bater certinho, ele não encontra o grupo e a mensagem não é enviada.</p>
      <form method="POST" action="/grupos/salvar" onsubmit="var b=this.querySelector('button[type=submit]');if(b){b.disabled=true;b.textContent='Salvando…';}">
        <label style="margin:0 0 4px">Grupo da equipe (professoras)</label>
        <input type="text" name="equipe" value="${esc(eqp)}" placeholder="SlimFit Equipe 💪" autocomplete="off" style="width:100%">
        <small class="quando" style="display:block;margin:4px 0 0">Usado em: <b>Ausentes/faltantes</b>, <b>Aniversariantes do mês</b>, <b>Resumo do dia</b>, resumo da semana e <b>Planos FREE (antecedência)</b>.</small>
        <label style="margin:14px 0 4px">Grupo do Circuito (alunas)</label>
        <input type="text" name="circuito" value="${esc(circ)}" placeholder="Circuito Slim" autocomplete="off" style="width:100%">
        <small class="quando" style="display:block;margin:4px 0 0">Usado em: <b>Circuito — convocatória</b> e <b>Circuito — lembrete</b>.</small>
        <div class="acts" style="margin-top:14px"><button type="submit" class="save">💾 Salvar nomes dos grupos</button></div>
        <p class="quando" style="margin:8px 0 0">Vale na hora, sem reiniciar o robô. ${g && (g.equipe || g.circuito) ? '' : '<i>Enquanto não salvar, vale o valor padrão / do .env.</i>'}</p>
      </form>
    </div>
  </details>`;
}

function paginaMensagens(aviso, erro) {
  // Índice dos horários por chave de job, para embutir em cada mensagem.
  const hmap = {};
  horarios.listar().forEach(j => { hmap[j.chave] = j; });

  // Monta o card de UMA mensagem (texto + bloco de horário embutido no form #fh).
  const cardDe = (m) => cardDeMsg(m, hmap);

  // Mensagens que vão para GRUPOS do WhatsApp (o resto é individual, 1 para 1).
  // A do Instagram é editada na aba "📸 Instagram" (fica tudo do IG lá).
  const MSGS_GRUPO = new Set(['ausentes', 'aniversariantes_mes', 'renovacoes_mes', 'aniversario', 'circuito_convocacao', 'circuito_lembrete']);
  // 'instagram' fica na aba Instagram; as cobranças ficam na aba SoFIA → Cobrança.
  const COBRANCA_MSGS = new Set(['cobranca_recorrente', 'cobranca_boleto', 'cobranca_boleto_hoje', 'cobranca_saldo', 'cobranca_app_reativado']);
  const listaMsgs = mensagens.listar().filter(m => m.chave !== 'instagram' && !COBRANCA_MSGS.has(m.chave));
  // Individuais (1 p/ 1): "Aniversário — ex-alunas" (reativação, direto no WhatsApp)
  // aparece no TOPO, acima de "Confirmação — aula de hoje".
  const indiv = listaMsgs.filter(m => !MSGS_GRUPO.has(m.chave));
  const indivOrdenado = [
    ...indiv.filter(m => m.chave === 'aniversario_ex'),
    ...indiv.filter(m => m.chave !== 'aniversario_ex'),
  ];
  // Agrupa os cards por ASSUNTO, em blocos recolhíveis. O que não estiver em
  // nenhum bloco (mensagem nova) cai em "Outras", para nunca sumir da tela.
  const emBlocos = (lista, defs) => {
    const usados = new Set();
    const html = defs.map(([id, rot, desc, chaves]) => {
      const ms = chaves.map(k => lista.find(m => m.chave === k)).filter(Boolean);
      ms.forEach(m => usados.add(m.chave));
      if (!ms.length) return '';
      return `<details class="msg-bloco" id="blk-${id}"><summary>${rot} <small>· ${ms.length} mensage${ms.length === 1 ? 'm' : 'ns'}${desc ? ' — ' + desc : ''}</small></summary>${ms.map(cardDe).join('\n')}</details>`;
    }).join('\n');
    const resto = lista.filter(m => !usados.has(m.chave));
    return html + (resto.length ? `<details class="msg-bloco" id="blk-outras"><summary>🗂️ Outras <small>· ${resto.length}</small></summary>${resto.map(cardDe).join('\n')}</details>` : '');
  };
  const itensIndividuais = emBlocos(indivOrdenado, [
    ['leads', '💬 Leads da SoFIA', 'quem conversou com a SoFIA e parou de responder', ['retomada_sofia']],
    ['alunas-novas', '🎉 Alunas novas', 'boas-vindas, renovação e indicação', ['boasvindas_nova', 'boasvindas_retorno', 'boasvindas_renovacao', 'indicacao_30d']],
    ['confirmacao', '📅 Confirmação de aula', 'lembrete antes da aula', ['confirmacao_hoje', 'confirmacao_amanha', 'confirmacao_sem_resposta', 'confirmacao_sem_resposta_equipe', 'confirmacao_experimental', 'confirmacao_experimental_express']],
    ['contratos', '📄 Contratos e renovação', 'vencimento, renovação e saída', ['renovacao', 'vence_hoje', 'assinatura_contrato', 'saida_grupos']],
    ['followup', '🔁 Follow-up e remarcação', 'depois da aula experimental', ['followup', 'followup_encerramento', 'followup_aluna', 'no_show', 'noshow_encerramento']],
    ['sentimos', '💛 Sentimos sua falta', 'alunas ativas que pararam de vir', ['sentimos_falta_1', 'sentimos_falta_2']],
    ['aniv-ind', '🎂 Aniversário', '', ['aniversario_ex']],
  ]);
  const itensGrupo = emBlocos(listaMsgs.filter(m => MSGS_GRUPO.has(m.chave)), [
    ['relatorios', '📊 Relatórios para a equipe', 'no grupo da Equipe', ['ausentes', 'aniversariantes_mes', 'renovacoes_mes']],
    ['aniv-grp', '🎂 Aniversário', 'nos grupos das turmas', ['aniversario']],
    ['circuito', '🏃 Circuito', '', ['circuito_convocacao', 'circuito_lembrete']],
  ]);

  // Seção final: jobs sem texto editável (só horário).
  const outros = OUTROS_JOBS.map(chave => hmap[chave]).filter(Boolean).map(j => {
    const badgeH = j.editado ? '<span class="badge-ed">alterado</span>' : '';
    return `<div class="card" style="position:relative">${switchEnvio([j.chave])}<div class="chead"><h2 style="font-size:.98rem">${esc(j.titulo)} ${badgeH}</h2></div>
      <div class="hsec" style="border:0;margin:8px 0 0;padding:0">${blocoHorario(j, '')}</div>${j.chave === 'resumoSemana' ? '<p class="quando" style="margin:8px 0 0">Grupos, o que vai na mensagem, prévia e envio de teste: <a href="/ativas/resumo?t=semana">Indicadores → Alunas ativas → Resumos no WhatsApp</a>.</p>' : ''}</div>`;
  }).join('\n');

  const corpo = `<div class="wrap" data-sempre-fechado>
    ${subnavMensagens('config')}
    ${uiTopo({ titulo: 'WhatsApp do robô', sub: 'Conexão do número do robô, o texto de cada mensagem automática, fotos, horários e quem recebe. Clique no título de uma seção para abrir ou fechar.',
      linhas: [uiChips('Ir para', [['#waBanner', '📶 Conexão'], ['#sec-indiv', '👤 Mensagens individuais'], ['#sec-grupo', '👥 Mensagens em grupo'], ['#sec-outros', '⚙️ Outros envios'], ['#sec-free', '🆓 Planos FREE']])] })}
    <div id="waBanner">${blocoWaRobo()}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin:-4px 0 0">
      <form method="POST" action="/wa/reiniciar" onsubmit="return confirm('Reiniciar o robô agora?\\n\\nEle fica cerca de 1 minuto fora do ar enquanto reconecta o WhatsApp. Evite reiniciar bem em cima de um horário de disparo.')" style="display:inline"><button type="submit" class="reset" style="padding:4px 11px;font-size:var(--fs-xs)">🔄 Reiniciar robô</button></form>
      <form id="waBtnDesc" method="POST" action="/wa/desconectar" onsubmit="return confirm('Desconectar o WhatsApp do robô?\\n\\nO robô para de enviar e será preciso reescanear o QR (aqui mesmo) para reconectar.')" style="display:none" title="Só disponível quando o WhatsApp está conectado"><button type="submit" class="reset" style="padding:4px 11px;font-size:var(--fs-xs)">Desconectar</button></form>
    </div>
    <details class="acc-sec" id="pairSec" data-nosec="1" style="margin-top:8px">
      <summary>🔢 Conectar por código (sem QR)</summary>
      <div class="card">
        <p class="quando" style="margin:0 0 10px">Não conseguiu ler o QR? Conecte digitando um <b>código de 8 dígitos</b> no celular do chip. Informe o <b>número do WhatsApp do robô</b> (DDI + DDD + número, só dígitos) e clique em <b>Gerar código</b> — ele aparece aqui em ~20s.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="pairNum" type="tel" inputmode="numeric" placeholder="5562999998010" autocomplete="off" style="max-width:220px">
          <button type="button" class="save" id="pairBtn" onclick="pedirCodigo()" style="padding:8px 18px">Gerar código</button>
          <span id="pairMsg" class="quando" style="margin:0"></span>
        </div>
        <div id="pairCodeBox" style="display:none;margin-top:14px;text-align:center">
          <div style="font-size:.82rem;color:var(--cinza);margin-bottom:4px">Digite este código no celular do chip:</div>
          <div id="pairCode" style="font-size:1.9rem;font-weight:800;letter-spacing:5px;font-family:monospace;color:#0f766e"></div>
          <div class="quando" style="margin:10px auto 0;max-width:470px">No <b>celular do chip</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → <b>Conectar com número de telefone</b> → digite o código acima. Vale por poucos minutos — se expirar, clique em "Gerar outro código".</div>
        </div>
      </div>
    </details>
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${barraTeste()}
    ${card2FA()}
    <form id="fh" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnH');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"></form>
    <details class="acc-sec" id="fotosPac" data-nosec="1" style="margin-top:8px">
      <summary>🖼️ Imagens de todas as mensagens — levar para outra unidade</summary>
      <div class="card">
        <p class="quando" style="margin:0 0 10px">Baixe <b>um arquivo</b> com as imagens de todas as mensagens desta unidade e importe no painel de outra unidade — sem subir uma por uma.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="tbtn" href="/mensagem/fotos/exportar" style="text-decoration:none">⬇️ Baixar as imagens desta unidade</a>
          <input type="file" id="fpArq" accept=".json,application/json" style="display:none" onchange="fpImportar(this)">
          <button type="button" class="tbtn" onclick="document.getElementById('fpArq').click()">⬆️ Importar imagens de outra unidade</button>
          <label class="chk" style="margin:0;font-weight:500"><input type="checkbox" id="fpSubst" checked> substituir as imagens que já existem aqui</label>
        </div>
        <p id="fpMsg" class="quando" style="margin:8px 0 0"></p>
      </div>
    </details>
    <script>
    function fpImportar(inp){
      var f=inp.files&&inp.files[0]; if(!f) return; var msg=document.getElementById('fpMsg');
      msg.style.color=''; msg.textContent='⏳ Lendo o arquivo…';
      var rd=new FileReader(); rd.onload=function(){
        var pac; try{ pac=JSON.parse(rd.result); }catch(e){ msg.style.color='var(--erro)'; msg.textContent='❌ Este arquivo não é um pacote de imagens (.json baixado de outro painel).'; inp.value=''; return; }
        var n=Object.keys((pac&&pac.fotos)||{}).length;
        if(!confirm('Importar '+n+' imagem(ns)'+(pac&&pac.unidade?' de '+pac.unidade:'')+'?')){ inp.value=''; msg.textContent=''; return; }
        msg.textContent='⏳ Importando '+n+' imagem(ns)…';
        fetch('/mensagem/fotos/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pacote:pac, substituir:document.getElementById('fpSubst').checked})})
          .then(function(r){return r.json();}).then(function(j){
            if(!j.ok){ msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'falhou'); return; }
            msg.style.color='var(--ok)'; msg.textContent='✅ '+j.importadas.length+' importada(s)'+(j.puladas.length?' · '+j.puladas.length+' pulada(s)':'')+(j.erros.length?' · '+j.erros.length+' com erro':'')+'. Recarregando…';
            setTimeout(function(){ location.reload(); },1500);
          }).catch(function(){ msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
        inp.value='';
      }; rd.readAsText(f);
    }
    </script>
    ${(E._navSess || { admin: true }).admin ? (() => {
      const ult = (() => { try { return require('./config-unidade').ultimoBackup(); } catch (_) { return null; } })();
      const dataUlt = ult && ult.em ? new Date(ult.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      return `<details class="acc-sec" id="cfgPac" data-nosec="1" style="margin-top:8px">
      <summary>📦 Copiar a configuração para outra unidade</summary>
      <div class="card">
        <p class="quando" style="margin:0 0 6px">Um arquivo com <b>textos das mensagens, imagens, horários dos envios, tags e automações, roteiro da SoFIA, script de integração e follow-up</b>. Baixe aqui e importe no painel da outra unidade; lá você escolhe o que trazer e confere antes.</p>
        <p class="quando" style="margin:0 0 10px">Não vão no arquivo: números de WhatsApp de aviso, campanhas, áudios das professoras, grupos, dados do EVO, contatos e conversas. As tags são <b>somadas</b> às que já existem na outra unidade, e cada tag mantém o número de aviso de lá.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="ui-btn" href="/config-unidade/exportar" style="text-decoration:none">⬇️ Baixar a configuração desta unidade</a>
          <a class="ui-btn sec" href="/config-unidade/exportar?fotos=0" style="text-decoration:none">sem as imagens (arquivo menor)</a>
          <input type="file" id="cuArq" accept=".json,application/json" style="display:none" onchange="cuLer(this)">
          <button type="button" class="tbtn" onclick="document.getElementById('cuArq').click()">⬆️ Importar de outra unidade</button>
          ${ult ? `<button type="button" class="reset" onclick="cuDesfazer()" style="padding:8px 12px" title="Volta ao que estava antes da importação${ult.origem ? ' de ' + esc(ult.origem) : ''}">↩️ Desfazer a última importação (${dataUlt})</button>` : ''}
        </div>
        <div id="cuBox" style="display:none;margin-top:12px;border:1px solid var(--linha);border-radius:12px;padding:12px 14px;background:var(--card)"></div>
        <p id="cuMsg" class="quando" style="margin:8px 0 0"></p>
      </div>
    </details>
    <script>
    var cuPac=null;
    function cuEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    function cuLer(inp){
      var f=inp.files&&inp.files[0]; if(!f) return; var msg=document.getElementById('cuMsg'), box=document.getElementById('cuBox');
      msg.style.color=''; msg.textContent='⏳ Lendo o arquivo…'; box.style.display='none';
      var rd=new FileReader(); rd.onload=function(){
        inp.value='';
        try{ cuPac=JSON.parse(rd.result); }catch(e){ msg.style.color='var(--erro)'; msg.textContent='❌ Este arquivo não é um pacote de configuração.'; return; }
        fetch('/config-unidade/previa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pacote:cuPac})}).then(function(r){return r.json();}).then(function(j){
          if(!j.ok){ msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'arquivo inválido'); return; }
          msg.textContent='';
          var linhas=j.partes.map(function(p){ return '<label class="chk" style="margin:0 0 8px;font-weight:500;align-items:flex-start'+(p.tem?'':';opacity:.5')+'"><input type="checkbox" name="cuParte" value="'+p.chave+'"'+(p.tem?' checked':' disabled')+'> <span><b>'+cuEsc(p.rotulo)+'</b><br><span class="quando" style="margin:0">no arquivo: '+cuEsc(p.pacote||'nada')+' · aqui hoje: '+cuEsc(p.aqui)+'</span></span></label>'; }).join('');
          box.innerHTML='<div style="font-weight:700;margin:0 0 8px">Arquivo '+(j.unidade?'de <b>'+cuEsc(j.unidade)+'</b>':'')+(j.em?' · gerado em '+cuEsc(new Date(j.em).toLocaleString('pt-BR')):'')+'</div>'
            +'<p class="quando" style="margin:0 0 10px">Marque o que trazer. O que estiver marcado <b>substitui</b> o desta unidade (as tags são somadas). Antes, o painel guarda uma cópia do que existe hoje para você poder desfazer.</p>'
            +linhas+'<div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="tbtn" onclick="cuImportar()">📥 Importar o que está marcado</button><button type="button" class="reset" onclick="document.getElementById(\\'cuBox\\').style.display=\\'none\\'">Cancelar</button></div>';
          box.style.display='block';
        }).catch(function(){ msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
      }; rd.readAsText(f);
    }
    function cuImportar(){
      var partes=[].map.call(document.querySelectorAll('input[name=cuParte]:checked'),function(i){return i.value;}), msg=document.getElementById('cuMsg');
      if(!partes.length){ alert('Marque pelo menos uma parte.'); return; }
      if(!confirm('Substituir nesta unidade: '+partes.length+' parte(s)? Dá para desfazer depois.')) return;
      msg.style.color=''; msg.textContent='⏳ Importando…'+(partes.indexOf('horarios')>=0?' (o robô reinicia para valer os horários)':'');
      fetch('/config-unidade/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pacote:cuPac,partes:partes})}).then(function(r){return r.json();}).then(function(j){
        if(!j.ok){ msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'falhou'); return; }
        msg.style.color='var(--ok)'; msg.textContent='✅ Importado: '+j.feito.join(', ')+'.'+(j.horarios?(j.reiniciou?' Robô reiniciado com os novos horários.':' ⚠️ Não consegui reiniciar o robô — reinicie para valer os horários.'):'')+' Confira os textos que citam a unidade (nome, endereço, link do mapa).';
        document.getElementById('cuBox').style.display='none'; setTimeout(function(){ location.reload(); },4000);
      }).catch(function(){ msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
    }
    function cuDesfazer(){
      if(!confirm('Voltar a configuração para como estava antes da última importação?')) return;
      var msg=document.getElementById('cuMsg'); msg.style.color=''; msg.textContent='⏳ Desfazendo…';
      fetch('/config-unidade/desfazer',{method:'POST'}).then(function(r){return r.json();}).then(function(j){
        if(!j.ok){ msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'falhou'); return; }
        msg.style.color='var(--ok)'; msg.textContent='✅ Voltou a configuração de antes da importação.'; setTimeout(function(){ location.reload(); },2500);
      }).catch(function(){ msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
    }
    </script>`;
    })() : ''}
    <div class="sec-t" id="sec-indiv">Mensagens individuais <small style="font-weight:600;color:var(--cinza)">(enviadas 1 para 1, direto para a aluna)</small></div>
    ${itensIndividuais}
    <div class="sec-t" id="sec-grupo">Mensagens em grupo <small style="font-weight:600;color:var(--cinza)">(enviadas nos grupos do WhatsApp)</small></div>
    ${cardGrupos()}
    ${(() => {
      const offs = config.jobsDesativadosLabels();
      if (!offs.length) return '';
      return `<div class="card" style="border-left:4px solid #b0a99f;background:#faf7f2">
        <div class="chead" style="margin:0"><h2 style="font-size:.98rem">🚫 Envios desativados nesta unidade</h2></div>
        <p class="quando" style="margin:6px 0 0">Estes envios estão <b>desligados</b> por configuração (<code>JOBS_OFF</code> no <code>.env</code>) e <b>não são disparados</b> aqui:</p>
        <ul style="margin:6px 0 0;padding-left:20px">${offs.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      </div>`;
    })()}
    ${itensGrupo}
    <div class="sec-t" id="sec-outros">Outros envios em grupo <small style="font-weight:600;color:var(--cinza)">(automáticos, sem texto editável)</small></div>
    ${outros}
    <div class="sec-t" id="sec-free">Planos FREE — desmarcação por antecedência <small style="font-weight:600;color:var(--cinza)">(robô desmarca quem marcou cedo demais e avisa a Equipe)</small></div>
    <div class="card" style="position:relative;border-left:4px solid var(--teal);background:#f6fbf9">
      ${switchEnvio(['freeAntecedencia'])}
      <p class="quando" style="margin:0 0 10px;padding-right:100px">As alunas de plano <b>FREE … GRUPO 2</b> só podem marcar a aula com, no máximo, <b>1 dia de antecedência</b>. O robô varre a grade em <b>horas fixas, no minuto :02</b> (a cada N horas, o dia todo — ex.: 6h → 00:02, 06:02, 12:02, 18:02), <b>desmarca</b> quem marcou com <b>2+ dias</b> (falta justificada — libera a vaga e a aluna pode remarcar) e <b>avisa no grupo da Equipe</b>. Só conta plano FREE com <b>contrato ativo</b>. A aluna <b>não</b> recebe mensagem direta. Ligue/desligue no <b>botão acima</b>.</p>
      <form method="POST" action="/free/config" style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
        <label style="font-weight:700">Verificar a cada
          <input type="number" name="freeHoras" min="${freeCfg.HORAS_MIN}" max="${freeCfg.HORAS_MAX}" step="1" value="${(function(){try{return freeCfg.lerHoras();}catch(_){return freeCfg.HORAS_PADRAO;}})()}" style="width:64px;margin:0 6px;padding:6px;border:1px solid var(--linha);border-radius:8px;text-align:center"> horas
          <span class="quando" style="display:block;margin:3px 0 0;font-weight:400">em horas fixas no minuto :02 — mudar aqui exige reiniciar o robô</span>
        </label>
        <label style="font-weight:700">Janela
          <input type="number" name="freeDias" min="${freeCfg.DIAS_MIN}" max="${freeCfg.DIAS_MAX}" step="1" value="${(function(){try{return freeCfg.lerDias();}catch(_){return freeCfg.DIAS_PADRAO;}})()}" style="width:64px;margin:0 6px;padding:6px;border:1px solid var(--linha);border-radius:8px;text-align:center"> dias (a partir de hoje+2)
        </label>
        <div style="flex-basis:100%;max-width:560px">
          <label style="font-weight:700">Planos que entram${infoI('<b>Uma regra por linha.</b> Os termos de cada linha são separados por <b>vírgula</b>. O plano entra se o nome do contrato (ativo) contém <b>TODOS</b> os termos de <b>alguma</b> linha. Não liga para maiúscula/minúscula. Exemplos:<br>• <code>free, 3x, grupo 2</code> → só os planos FREE <b>3X</b> GRUPO 2 (padrão) — exclui os FREE <b>5X</b>.<br>• <code>free, grupo 2</code> → qualquer FREE/GRUPO 2 (incluindo os 5X).<br>• Uma linha por família (entra quem bate em <b>qualquer</b> uma), ex.:<br><code>free, 3x, grupo 2</code><br><code>copa slim, grupo 2</code><br>• Para um plano exato, escreva o nome quase inteiro numa linha.')}</label>
          <textarea name="freePlanos" rows="3" maxlength="4000" placeholder="free, 3x, grupo 2" style="width:100%;resize:vertical;padding:8px;border:1px solid var(--linha);border-radius:8px;font-family:monospace;font-size:.9rem">${esc((function(){try{return freeCfg.lerPlanos();}catch(_){return freeCfg.PLANOS_PADRAO;}})())}</textarea>
          <p class="quando" style="margin:4px 0 0">Uma regra por linha; termos separados por vírgula (padrão: <code>free, 3x, grupo 2</code> — só os FREE 3X). Deixe vazio para voltar ao padrão.</p>
        </div>
        <div style="flex-basis:100%;max-width:560px">
          <label style="font-weight:700">Mensagem no grupo da Equipe${infoI('Texto postado no grupo da Equipe quando o robô desmarca. Use as <b>variáveis</b> (o robô troca na hora):<br>• <code>{studio}</code> — nome da loja<br>• <code>{lista}</code> — as alunas desmarcadas (data, horário, nome e plano) — <b>deixe esta no texto</b><br>• <code>{qtd}</code> — quantas foram desmarcadas<br>• <code>{falhas}</code> — bloco de falhas (vazio se não houver)<br>O <code>*negrito*</code> do WhatsApp funciona. Deixe vazio para voltar ao padrão.')}</label>
          <textarea name="freeTexto" rows="8" maxlength="4000" style="width:100%;resize:vertical;padding:8px;border:1px solid var(--linha);border-radius:8px;font-size:.9rem">${esc((function(){try{return freeCfg.lerTexto();}catch(_){return freeCfg.TEXTO_PADRAO;}})())}</textarea>
          <p class="quando" style="margin:4px 0 0">Variáveis: <code>{studio}</code>, <code>{lista}</code>, <code>{qtd}</code>, <code>{falhas}</code>. Mantenha o <code>{lista}</code> para os nomes aparecerem.</p>
        </div>
        <button type="submit" class="save" style="padding:8px 16px">Salvar</button>
      </form>
      <p class="quando" style="margin:10px 0 0">Vale <b>sem reiniciar</b> o robô — na próxima verificação (de hora em hora).</p>
    </div>
    <div class="hbar">
      <div class="acts"><button type="submit" form="fh" id="btnH" class="save">🕒 Salvar horários e reiniciar o robô</button></div>
      <p class="quando" style="text-align:center;margin:8px 0 0">O <b>texto</b> é salvo na hora (sem reiniciar). Já mudanças de <b>horário</b> só valem depois que o robô reinicia — alguns segundos. Evite salvar bem em cima de um horário de disparo.</p>
    </div>
  </div>
${scriptPreviewTeste()}
<script>
  (function(){ // blocos de mensagens: começam SEMPRE fechados (não memoriza o que foi aberto)
    try{ for(var i=localStorage.length-1;i>=0;i--){ var kk=localStorage.key(i); if(kk && kk.indexOf('blk2:')===0) localStorage.removeItem(kk); } }catch(e){} // limpa a memória antiga
    // Link para um card (#msg-…) dentro de um bloco fechado: abre o bloco.
    function abrirAlvo(){ try{ var h=location.hash; if(!h) return; var t=document.querySelector(h); var b=t&&t.closest&&t.closest('details.msg-bloco'); if(b) b.open=true; }catch(e){} }
    abrirAlvo(); window.addEventListener('hashchange', abrirAlvo);
  })();
  function renderWa(st){
    var e = st && st.estado;
    if(st && st.pairingCode) return '<div class="wa-card warn"><div class="wa-ic">🔢</div><h2>Conectando por código</h2><p>Veja o <b>código</b> no quadro "Conectar por código" abaixo e digite no celular do chip.</p></div>';
    if(e==='conectado') return '<div class="wa-card ok"><div class="wa-ic">✅</div><h2>WhatsApp conectado</h2><p>A sessão está ativa — o robô envia normalmente.</p></div>';
    if(e==='qr' && st.qr) return '<div class="wa-card warn"><div class="wa-ic">📲</div><h2>Escaneie o QR para reconectar</h2><p>A sessão caiu. No <b>celular do Studio</b>: WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para o código.</p><img class="qr" src="'+st.qr+'" alt="QR do WhatsApp"><p class="wa-hint">Atualiza sozinho — assim que conectar, vira ✅.</p></div>';
    if(e==='iniciando') return '<div class="wa-card"><div class="wa-ic">⏳</div><h2>Iniciando…</h2><p>O robô está subindo a conexão. Se precisar de QR, ele aparece aqui.</p></div>';
    if(e==='desconectado') return '<div class="wa-card warn"><div class="wa-ic">⚠️</div><h2>Desconectado</h2><p>O robô está tentando reconectar sozinho. Se aparecer um QR aqui, escaneie.</p></div>';
    return '<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>Confira se o robô (${PM2_EXP}) está rodando.</p></div>';
  }
  function atualizaWa(){
    fetch('/wa/estado').then(function(r){return r.json();}).then(function(st){
      var el=document.getElementById('waBanner'); if(el) el.innerHTML=renderWa(st);
      var d=document.getElementById('waBtnDesc'); if(d) d.style.display=(st&&st.estado==='conectado')?'inline':'none';
      var box=document.getElementById('pairCodeBox'), code=document.getElementById('pairCode'), sec=document.getElementById('pairSec'), pbtn=document.getElementById('pairBtn');
      if(st && st.pairingCode && st.estado!=='conectado'){
        if(code) code.textContent=st.pairingCode;
        if(box) box.style.display='block';
        if(sec && !sec.open) sec.open=true;
        if(pbtn){ pbtn.disabled=false; pbtn.textContent='Gerar outro código'; }
      } else if(box){ box.style.display='none'; }
    }).catch(function(){});
  }
  atualizaWa(); setInterval(atualizaWa, 7000);
  function pedirCodigo(){
    var inp=document.getElementById('pairNum'), msg=document.getElementById('pairMsg'), btn=document.getElementById('pairBtn');
    var num=(inp.value||'').replace(/\\D/g,'');
    if(num.length<10){ msg.textContent='Informe o número com DDI+DDD (ex.: 5562999998010).'; msg.style.color='#a12626'; inp.focus(); return; }
    btn.disabled=true; msg.style.color=''; msg.textContent='Pedindo o código ao WhatsApp… (uns 20s)';
    fetch('/wa/parear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({numero:num})})
      .then(function(r){return r.json();}).then(function(d){
        if(d.ok){ msg.textContent='⏳ Gerando… o código aparece abaixo em instantes.'; msg.style.color='#1a7f37'; }
        else { msg.textContent='⚠️ '+(d.erro||'Falha.'); msg.style.color='#a12626'; btn.disabled=false; }
      }).catch(function(){ msg.textContent='⚠️ Falha de rede.'; msg.style.color='#a12626'; btn.disabled=false; });
  }

  // ── Código do EVO (2FA) — plano B: acende quando o robô está esperando ──────
  function pintar2fa(p){
    var card=document.getElementById('card2fa'), st=document.getElementById('c2faSt'), hint=document.getElementById('c2faHint');
    if(!card) return;
    if(p && p.pedido){
      card.style.borderLeftColor='#e05a2b'; card.style.background='#fff7f2';
      st.textContent='⏳ o robô está esperando'; st.style.background='#ffd9c7'; st.style.color='#a12626';
      hint.innerHTML='⚠️ <b>O robô está tentando entrar no EVO e precisa do código.</b> '+(p.motivo==='email'?'O EVO mandou por <b>e-mail</b> do usuário do robô — abra o e-mail, copie o código de 6 dígitos e digite abaixo.':'Digite o código de verificação do EVO abaixo.');
      var inp=document.getElementById('c2faInp'); if(inp && document.activeElement!==inp){ try{inp.focus();}catch(_){}}
    } else {
      card.style.borderLeftColor='#d7d2cb'; card.style.background='';
      st.textContent='nada pendente'; st.style.background=''; st.style.color='';
      hint.innerHTML='Só é usado quando o robô precisa entrar no EVO e o código vem por <b>e-mail</b>. Quando isso acontecer, aparece um aviso aqui (e no seu celular): pegue o código no e-mail do usuário do robô e digite abaixo. No dia a dia o robô resolve o 2FA sozinho (pelo autenticador) e este campo fica quieto.';
    }
  }
  function atualiza2fa(){ fetch('/wa/2fa/estado').then(function(r){return r.json();}).then(pintar2fa).catch(function(){}); }
  async function enviar2FA(){
    var inp=document.getElementById('c2faInp'), msg=document.getElementById('c2faMsg'), btn=document.getElementById('c2faBtn');
    var cod=(inp.value||'').replace(/\D/g,'');
    if(cod.length<4){ msg.textContent='Digite o código (4 a 8 dígitos).'; msg.style.color='#a12626'; inp.focus(); return; }
    btn.disabled=true; msg.style.color=''; msg.textContent='Enviando ao robô…';
    try{
      var r=await fetch('/wa/2fa/codigo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigo:cod})});
      var d=await r.json();
      if(d.ok){ msg.textContent='✅ Código enviado — o robô vai usar em instantes.'; msg.style.color='#1a7f37'; inp.value=''; }
      else { msg.textContent='⚠️ '+(d.erro||'Falha ao enviar.'); msg.style.color='#a12626'; }
    }catch(e){ msg.textContent='⚠️ '+(e.message||'Falha.'); msg.style.color='#a12626'; }
    finally{ btn.disabled=false; }
  }
  window.enviar2FA=enviar2FA;
  atualiza2fa(); setInterval(atualiza2fa, 5000);
</script>`;
  return chrome({ tab: 'WhatsApp Mensagens', h1: 'WhatsApp — mensagens do robô', p: 'Conexão, texto e horário de cada envio no mesmo lugar.' }, 'msg', corpo);
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
  <div class="sec-t">Horários de disparo</div>
  <div class="card">
    <form id="fhAg" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnHAg');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"><input type="hidden" name="voltar" value="/agendar"></form>
    <p class="quando" style="margin:0 0 6px">Quando os envios agendados de cada turno são disparados ${badge}. Vale para <b>todos</b> os agendamentos.</p>
    ${linhas}
    <div class="acts" style="margin-top:14px"><button type="submit" form="fhAg" id="btnHAg" class="save">🕒 Salvar horários e reiniciar o robô</button></div>
    <p class="quando" style="margin:8px 0 0">Só vale depois que o robô reinicia — alguns segundos. Evite salvar bem em cima de um horário de disparo.</p>
  </div>`;
}

// Bloco "Agendar mensagem no WhatsApp" (form + pendentes/histórico + script),
// usado dentro da tela unificada paginaExpress. Devolve { form, script } — sem
// wrap/subnav/chrome. As mensagens são enviadas nos horários dos turnos.
function blocoAgendarMsg() {
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
    <div style="position:relative;margin:6px 0 2px">
      <button type="button" id="emojiBtn" class="reset" onclick="toggleEmoji()" style="padding:5px 12px;font-size:.95rem" title="Inserir emoji">😊 Emoji</button>
      <div id="emojiPop" style="display:none;position:absolute;z-index:60;top:40px;left:0;background:#fff;border:1px solid var(--linha);border-radius:12px;box-shadow:0 10px 28px -10px rgba(0,0,0,.30);padding:8px;width:min(340px,92vw);max-height:230px;overflow:auto;flex-wrap:wrap;gap:1px"></div>
    </div>
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

  <details class="acc-sec"${pend.length ? ' open' : ''}>
    <summary class="sec-t" style="cursor:pointer;padding:4px 0">Pendentes (${pend.length})<small style="font-weight:400;color:var(--cinza)"> — clique para ${pend.length ? 'recolher' : 'abrir'}</small></summary>
    ${pend.length ? pend.map(itemHtml).join('') : '<div class="vazio">Nenhum envio pendente.</div>'}
  </details>

  <details class="acc-sec">
    <summary class="sec-t" style="cursor:pointer;padding:4px 0">Histórico <small style="font-weight:400;color:var(--cinza)">(${hist.length} envio${hist.length === 1 ? '' : 's'} — clique para abrir)</small></summary>
    ${hist.length ? hist.map(itemHtml).join('') : '<div class="vazio">Sem envios recentes.</div>'}
  </details>
  ${cardHorariosAgendados()}
  `;

  const script = `<script>
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
  // Seletor de emoji (offline, sem dependências): grade de emojis comuns; clicar
  // insere no cursor da Mensagem. Fica aberto p/ escolher vários; fecha ao clicar fora.
  var EMOJIS='😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 😎 🤩 🥳 🤗 🤔 😅 😂 🤣 😌 😋 😇 🙃 😴 🥲 😢 😭 🥺 😳 🙄 😬 🤫 😮 👍 👎 👌 🙏 👏 🙌 💪 🤝 👋 🤙 ✌️ 💃 🕺 🏃 🎉 🎊 🎈 🎁 ✨ ⭐ 🌟 💫 🔥 💯 ✅ ❌ ❤️ 🧡 💛 💚 💙 💜 🤍 💖 💕 💞 💗 😻 🥇 🏆 🎯 📅 📆 ⏰ ⏳ 📍 📌 📎 📞 📱 💬 💡 ☀️ 🌇 🌈 🌸 🌺 🌻 💐 🏋️ 🧘 🚴 🏊 🥊 🏅 💧 🍏'.split(' ');
  function inserirEmoji(e){ var ta=document.getElementById('mensagem'); if(!ta) return; var s=ta.selectionStart==null?ta.value.length:ta.selectionStart, en=ta.selectionEnd==null?ta.value.length:ta.selectionEnd; ta.value=ta.value.slice(0,s)+e+ta.value.slice(en); var pos=s+e.length; ta.selectionStart=ta.selectionEnd=pos; ta.focus(); }
  function toggleEmoji(){
    var p=document.getElementById('emojiPop'); if(!p) return;
    if(!p.dataset.done){
      p.innerHTML=EMOJIS.map(function(e){return '<button type="button" class="emj" style="border:0;background:transparent;font-size:1.3rem;line-height:1;cursor:pointer;padding:4px 5px;border-radius:8px">'+e+'</button>';}).join('');
      p.addEventListener('click',function(ev){ var b=ev.target.closest?ev.target.closest('.emj'):null; if(b) inserirEmoji(b.textContent); });
      p.dataset.done='1';
    }
    p.style.display=(p.style.display==='none'||!p.style.display)?'flex':'none';
  }
  document.addEventListener('click',function(ev){ var p=document.getElementById('emojiPop'), b=document.getElementById('emojiBtn'); if(!p||p.style.display==='none') return; if((p.contains&&p.contains(ev.target))||(b&&b.contains(ev.target))) return; p.style.display='none'; });
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
  return { form, script };
}

// ── Sub-aba "Express" (tela unificada) ───────────────────────────────────────
// Junta, numa tela só, o Cadastro Express (agenda a aula no EVO — topo) e o
// Agendamento de mensagens do WhatsApp (abaixo). Cada bloco é uma SEÇÃO com banda
// de cabeçalho própria (cores diferentes) pra deixar claro que são funções
// distintas. Permissões: Express = msg_express; Agendar mensagem = msg_agendar.
function paginaExpress(aviso, erro) {
  const sess = E._navSess || { admin: true, telas: [] };
  // Permissão UNIFICADA: quem pode ver a tela vê as duas seções. Aceita a chave
  // antiga msg_agendar (migra sozinha ao salvar o perfil).
  const podeTela = podeMsgSub(sess, 'express') || podeMsgSub(sess, 'agendar');
  const podeExpress = podeTela, podeAgendar = podeTela;
  const hoje = hojeSP();
  const circId = lerCircuitoServico();
  // Cabeçalho de seção (ícone + título + subtítulo) — fica DENTRO do painel colorido.
  const cab = (ic, tit, sub) => `<div style="display:flex;align-items:center;gap:12px;margin:2px 2px 12px"><span style="font-size:1.5rem;line-height:1;flex:none">${ic}</span><div style="min-width:0"><div style="font-family:'Manrope','Inter',sans-serif;font-weight:800;font-size:1.05rem;color:var(--tinta);line-height:1.15">${tit}</div><div style="font-size:.82rem;color:var(--cinza)">${sub}</div></div></div>`;

  // ── Seção 1 · Cadastro express (agenda no EVO) — painel TEAL, um bloco só ──
  const secExpress = !podeExpress ? '' : `
    <section style="margin:4px 0 24px">
      <div style="border:1px solid var(--linha);border-left:5px solid var(--teal);border-radius:14px;background:var(--teal-soft);padding:13px 13px 4px">
      ${cab('📅', 'Cadastro express', 'Agenda a aula experimental no EVO — sem precisar de conversa')}
      <div class="card" style="margin:0 0 9px">
        <div style="margin:0 0 14px;font-size:.86rem;color:var(--cinza)">Para quem chegou <b>por telefone ou no balcão</b>. Marca no <b>EVO</b>, envia a <b>confirmação no WhatsApp</b> e aplica a tag <b>“agendou”</b> — igual quando a SoFIA agenda.</div>
        <label>Aula experimental de</label>
        <div class="ex-tipos" role="radiogroup" aria-label="Aula experimental de">
          <label class="ex-tipo"><input type="radio" name="exTipo" value="" checked><span>💪 SlimFit</span></label>
          <label class="ex-tipo"${circId ? '' : ' title="Configure o id do serviço do Circuito no EVO (abaixo)"'}><input type="radio" name="exTipo" value="circuito"${circId ? '' : ' disabled'}><span>🔁 Circuito Slim</span></label>
        </div>
        ${circId ? '' : '<p class="quando" style="margin:-4px 0 12px">Circuito Slim: falta informar o <b>id do serviço</b> da aula experimental do circuito no EVO (no fim deste quadro).</p>'}
        <label>Nome completo</label>
        <input id="exNome" type="text" placeholder="Nome da aluna" autocomplete="off">
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div style="flex:1 1 200px;min-width:0"><label>Telefone (WhatsApp)</label><input id="exTel" type="tel" inputmode="numeric" placeholder="(62) 99999-9999" maxlength="16"></div>
          <div style="flex:1 1 200px;min-width:0"><label>E-mail <small style="font-weight:400;color:#c0392b">(obrigatório)</small></label><input id="exEmail" type="email" placeholder="email@exemplo.com" autocomplete="off" required></div>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div style="flex:1 1 170px;min-width:0"><label>Data</label><input type="date" id="exData" value="${hoje}" min="${hoje}"></div>
          <div style="flex:1 1 160px;min-width:0"><label style="display:flex;align-items:center;justify-content:space-between;gap:8px">Horário <button type="button" id="exRefresh" onclick="exAtualizarGrade()" title="Buscar a grade atualizada no EVO agora" style="border:1px solid var(--linha);background:#fff;color:var(--teal);border-radius:8px;padding:2px 9px;font-size:.74rem;font-weight:600;cursor:pointer;line-height:1.5">🔄 atualizar</button></label><select id="exHora"><option value="">carregando horários…</option></select></div>
        </div>
        <div class="acts" style="margin-top:18px"><button type="button" class="save" id="exBtn" onclick="exAgendar()" style="width:100%;padding:12px 20px;font-size:1rem;font-weight:600">📅 Agendar no EVO</button></div>
        <div id="exMsg" class="aviso" style="display:none"></div>
      </div>
      ${sess.admin ? `<details class="ex-cfg"${circId ? '' : ' open'}><summary>⚙️ Circuito Slim — serviço da aula experimental no EVO</summary>
        <form method="POST" action="/agendar/circuito-servico" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:8px 0 4px">
          <div><label style="margin:0 0 4px">Id do serviço no EVO</label><input type="text" name="id" inputmode="numeric" value="${circId || ''}" placeholder="ex.: 316" style="width:140px"></div>
          <button type="submit" class="save" style="width:auto;padding:9px 16px">Salvar</button>
        </form>
        <p class="quando" style="margin:4px 0 6px">É o serviço que o EVO vende na experimental do circuito — <b>cada unidade tem o seu número</b>. Deixe vazio para desligar a opção Circuito Slim.</p>
      </details>` : ''}
      </div>
    </section>`;
  const scriptExpress = !podeExpress ? '' : `<script>
  function exEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function exSoDig(s){ return (s||'').replace(/\\D/g,''); }
  document.getElementById('exTel').addEventListener('input',function(e){
    var v=exSoDig(e.target.value).slice(0,11);
    if(v.length>=7)e.target.value=v.replace(/(\\d{2})(\\d{4,5})(\\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
    else if(v.length>=3)e.target.value=v.replace(/(\\d{2})(\\d{0,5})/,'($1) $2'); else e.target.value=v;
  });
  // Normaliza p/ DDI 55 (o EVO e a confirmação por WhatsApp esperam o número cheio).
  function exNormTel(s){ var d=exSoDig(s); if(d.length===10||d.length===11) d='55'+d; return d; }
  function exBtnOn(on){ var b=document.getElementById('exBtn'); if(b){ b.disabled=!on; b.textContent=on?'Agendar no EVO':'Agendando…'; } }
  // Erros conhecidos do EVO em português claro (o original fica entre parênteses).
  function exErroEvo(d){
    d=String(d||'erro no EVO');
    if(/no sessions for this activity/i.test(d)) return exTipo()==='circuito'
      ? '❌ O EVO não deixou matricular na turma do circuito: <b>o serviço vendido não dá direito a essa atividade</b>. Confira se o id do serviço da experimental do Circuito (abaixo) está certo — no EVO, o serviço precisa liberar a atividade do Circuito Slim.<br><small style="opacity:.75">('+exEsc(d)+')</small>'
      : '❌ O EVO não deixou matricular: <b>esse horário é de outra atividade</b> (ex.: Circuito Slim) — a aula experimental do SlimFit só vale para as turmas do SlimFit. Escolha outro horário.<br><small style="opacity:.75">('+exEsc(d)+')</small>';
    return '❌ Não consegui agendar: '+exEsc(d);
  }
  // Motivo real da recusa (vem do EVO) em português claro.
  function exMotivoLotada(res){
    var m=String(res.motivo||''), r=(m.match(/^Turma de .*?\\d{1,2}:\\d{2}\\s*:\\s*([^.]+)/)||[])[1]||'';
    var alt=(res.alternativas||[]).join('  ·  ');
    var dica='';
    if(/experimenta/i.test(r)) dica=' O limite de experimentais por turma fica em <b>SoFIA → Configuração</b>.';
    else if(/fechada/i.test(r)) dica=' A turma está fechada (cadeado) no EVO.';
    else if(/janela/i.test(r)) dica=' O EVO ainda não abriu a agenda dessa data — o cadastro e a venda foram feitos; matricule à mão no EVO.';
    else if(/não há turma/i.test(r)) dica=' Não existe turma nesse dia/horário no EVO.';
    return '⚠️ Não deu para agendar nesse horário'+(r?': <b>'+exEsc(r)+'</b>.':' (turma cheia).')+dica+'<br>Horários com vaga: '+(alt?exEsc(alt):'nenhum encontrado na semana')+'.';
  }
  function exStatus(html,cls){ var m=document.getElementById('exMsg'); if(!m)return; m.className='aviso'+(cls?(' '+cls):''); m.innerHTML=html; m.style.display='block'; }
  // Combobox de horários: só os do dia escolhido que TÊM vaga (grade do form).
  var exSlots=null;
  function exTipo(){ var r=document.querySelector('input[name=exTipo]:checked'); return r?r.value:''; }
  document.querySelectorAll('input[name=exTipo]').forEach(function(r){ r.addEventListener('change',function(){ exSlots=null; exPreencherHoras(); exCarregarSlots(); }); });
  function exCarregarSlots(forcar){
    var circ=exTipo()==='circuito';
    fetch('/agendar/slots'+(circ?'?tipo=circuito'+(forcar?'&forcar=1':''):''),{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
      if(circ!==(exTipo()==='circuito')) return; // trocou de aula no meio do caminho
      if(circ&&j&&j.aviso) exStatus('⚠️ '+exEsc(j.aviso),'err');
      exSlots=(j&&j.dias)||{}; exPreencherHoras();
    }).catch(function(){ exSlots={}; exPreencherHoras(); });
  }
  function exPreencherHoras(){
    var sel=document.getElementById('exHora'); if(!sel) return;
    var data=(document.getElementById('exData').value||'').trim();
    if(exSlots===null){ sel.innerHTML='<option value="">carregando horários…</option>'; return; }
    var lista=(exSlots[data]||[]).filter(function(s){return s.disponivel;});
    var atual=sel.value;
    if(!lista.length){ sel.innerHTML='<option value="">sem horário disponível nesse dia</option>'; return; }
    sel.innerHTML='<option value="">Selecione…</option>'+lista.map(function(s){
      var v=(s.freeSpots!=null?' · '+s.freeSpots+(s.freeSpots===1?' vaga':' vagas'):'');
      return '<option value="'+exEsc(s.time)+'">'+exEsc(s.time)+v+'</option>';
    }).join('');
    if(atual){ sel.value=atual; }
  }
  document.getElementById('exData').addEventListener('change',exPreencherHoras);
  exCarregarSlots();
  // 🔄 Atualizar grade AGORA: recalcula no EVO e reenvia (push_slots), depois recarrega
  // os horários. Evita o "turma cheia" por grade defasada (o envio automático é a cada ~30 min).
  function exAtualizarGrade(){
    var b=document.getElementById('exRefresh'), sel=document.getElementById('exHora');
    if(b){ b.disabled=true; b.textContent='⏳ atualizando…'; }
    if(sel){ sel.innerHTML='<option value="">atualizando a grade…</option>'; }
    if(exTipo()==='circuito'){ exSlots=null; exCarregarSlots(true); setTimeout(function(){ if(b){ b.disabled=false; b.textContent='🔄 atualizar'; } },1500); return; }
    fetch('/agendar/slots/atualizar',{method:'POST'}).then(function(r){return r.json();}).then(function(j){
      exSlots=null; exCarregarSlots();
      if(b){ b.disabled=false; b.textContent='🔄 atualizar'; }
      if(j&&j.ok){ exStatus('✅ Grade atualizada agora.',''); setTimeout(function(){ var m=document.getElementById('exMsg'); if(m)m.style.display='none'; },2500); }
      else { exStatus('⚠️ '+exEsc((j&&j.erro)||'não consegui atualizar a grade agora — tente de novo em instantes.'),'err'); }
    }).catch(function(){ if(b){ b.disabled=false; b.textContent='🔄 atualizar'; } exSlots=null; exCarregarSlots(); });
  }
  window.exAtualizarGrade=exAtualizarGrade;
  function exDupSobrescrever(){ exAgendar('sobrescrever'); }
  function exDupNovo(){ exAgendar('novo'); }
  function exAgendar(acaoDup){
    acaoDup=(acaoDup==='sobrescrever'||acaoDup==='novo')?acaoDup:'';
    var nome=(document.getElementById('exNome').value||'').trim();
    var tel=exNormTel(document.getElementById('exTel').value||'');
    var email=(document.getElementById('exEmail').value||'').trim();
    var data=(document.getElementById('exData').value||'').trim();
    var hora=(document.getElementById('exHora').value||'').trim();
    if(!nome){ exStatus('Preencha o nome.','err'); return; }
    if(tel.length<12){ exStatus('Telefone inválido — inclua o DDD.','err'); return; }
    if(!email||email.indexOf('@')<1){ exStatus('E-mail é obrigatório — o EVO exige para cadastrar.','err'); return; } // o EVO passou a exigir e-mail
    if(!data||!hora){ exStatus('Escolha a data e o horário.','err'); return; }
    var when=data+' '+hora; // AAAA-MM-DD HH:MM (o EVO/form entende)
    exBtnOn(false);
    exStatus(acaoDup==='novo'?'⏳ Criando um cadastro novo…':(acaoDup==='sobrescrever'?'⏳ Atualizando o cadastro existente…':'⏳ Agendando no EVO…'));
    fetch('/sofia/agendar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave:tel,nome:nome,email:email,when:when,origem:'express',acao_duplicado:acaoDup,tipo:exTipo()})})
      .then(function(r){return r.json();}).then(function(j){
        if(!j||!j.ok||!j.id){ exStatus('❌ '+exEsc((j&&j.erro)||'falha ao enviar'),'err'); exBtnOn(true); return; }
        var n=0;
        (function poll(){
          n++;
          fetch('/sofia/agendar/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
            var res=s&&s.res;
            if(!res){ if(n>40){ exStatus('⏳ Ainda processando… confira em instantes.'); exBtnOn(true); return; } setTimeout(poll,1500); return; }
            exBtnOn(true);
            if(res.ok){
              exStatus('✅ Agendada no EVO'+(exTipo()==='circuito'?' (<b>Circuito Slim</b>)':'')+' para <b>'+exEsc(res.when||when)+'</b>! A confirmação foi para a fila do WhatsApp.'+(res.aviso?'<br><small>⚠️ '+exEsc(res.aviso)+'</small>':''));
              document.getElementById('exNome').value=''; document.getElementById('exTel').value='';
              document.getElementById('exEmail').value=''; document.getElementById('exHora').value=''; exCarregarSlots();
              document.getElementById('exNome').focus();
            }
            else if(res.duplicado){
              var ex=res.existente||{};
              var quem=exEsc(ex.nome||'(sem nome)');
              var contato=ex.telefone?(' · '+exEsc(String(ex.telefone))):(ex.email?(' · '+exEsc(String(ex.email))):'');
              exStatus('⚠️ Já existe um cadastro com <b>este telefone</b> em nome de <b>'+quem+'</b>'+contato+'.<br>É a <b>mesma pessoa</b> (atualizar) ou <b>outra pessoa</b> — ex.: mãe e filha (criar novo)?'
                +'<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
                +'<button type="button" class="save" style="width:auto;padding:9px 14px" onclick="exDupSobrescrever()">Mesma pessoa — atualizar</button>'
                +'<button type="button" class="save" style="width:auto;padding:9px 14px;background:#8a6100" onclick="exDupNovo()">Outra pessoa — criar novo</button>'
                +'</div>','err');
            }
            else if(res.lotada){ exStatus(exMotivoLotada(res),'err'); exSlots=null; exCarregarSlots(); }
            else { exStatus(exErroEvo(res.detalhe),'err'); }
          }).catch(function(){ if(n>40){ exStatus('❌ erro de rede','err'); exBtnOn(true); return; } setTimeout(poll,1500); });
        })();
      }).catch(function(){ exStatus('❌ erro de rede','err'); exBtnOn(true); });
  }
</script>`;

  // ── Seção 2 · Agendar mensagem no WhatsApp ──
  const ag = podeAgendar ? blocoAgendarMsg() : { form: '', script: '' };
  const secAgendar = !podeAgendar ? '' : `
    <section style="margin:4px 0 8px">
      <div style="border:1px solid var(--linha);border-left:5px solid var(--coral);border-radius:14px;background:var(--erro-bg);padding:13px 13px 6px">
        ${cab('💬', 'Agendar mensagem no WhatsApp', 'Envio pontual pela linha do robô — não tem relação com o agendamento do EVO')}
        ${ag.form}
      </div>
    </section>`;

  const vazio = (!podeExpress && !podeAgendar) ? '<div class="card"><p class="quando" style="margin:0">Você não tem acesso a estas funções.</p></div>' : '';

  const corpo = `<div class="wrap">${subnavMensagens('express')}${uiTopo({ titulo: 'Cadastro Express e envios agendados', sub: 'Cadastre a aluna e marque a aula experimental direto no EVO, e agende mensagens do WhatsApp para um dia e turno.' })}${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    <div style="max-width:720px;margin:0 auto">${secExpress}${secAgendar}${vazio}</div>
  </div>${scriptExpress}${podeAgendar ? ag.script : ''}`;
  return chrome({ tab: 'Express', h1: 'Express & agendamentos', p: 'Cadastro express (agenda no EVO) e agendamento de mensagens do WhatsApp — no mesmo lugar.' }, 'msg', corpo);
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
    bloco = `<div class="wa-card"><div class="wa-ic">❔</div><h2>Sem informação ainda</h2><p>O robô ainda não gravou o estado. Verifique se o <code>${esc(PM2_EXP)}</code> está rodando (<code>pm2 status</code>).</p></div>`;
  }
  const reload = st.estado === 'conectado' ? '' : '<script>setTimeout(function(){location.reload()},6000)</script>';
  const corpo = `<div class="wrap">${bloco}<p class="wa-upd">Última atualização do robô: ${esc(quando)}</p></div>${reload}`;
  return chrome({ tab: 'WhatsApp', h1: 'Conexão do WhatsApp', p: 'Veja se a sessão está ativa — e escaneie o QR aqui se ela cair.' }, 'wa', corpo);
}

// mensagem (chave em mensagens.js) → jobs de horário (chave em horarios.js).
// [chave, sublabel]. Sublabel '' = envio único; senão distingue os dois turnos.
const HORARIOS_DA_MSG = {
  confirmacao_hoje:    [['morning', '']],
  confirmacao_amanha:  [['afternoon', '']],
  confirmacao_sem_resposta:        [['semResposta2', 'aulas da MANHÃ (confirmadas na véspera à tarde)'], ['semResposta1', 'aulas da TARDE/NOITE (confirmadas no mesmo dia de manhã)']],
  confirmacao_sem_resposta_equipe: [['semRespostaEquipe1', 'aulas da MANHÃ (sai no dia da aula, antes da 1ª aula)'], ['semRespostaEquipe2', 'aulas da TARDE/NOITE (sai antes da 1ª aula da tarde)']],
  followup:            [['followupMorning', 'Manhã'], ['followupAfternoon', 'Tarde']],
  followup_aluna:      'compartilha:followup', // mesmo job do follow-up — só nota
  no_show:             [['noShowMorning', 'Manhã'], ['noShowAfternoon', 'Tarde']],
  followup_encerramento: [['encerramentoManha', 'para o follow-up da manhã (de ontem)'], ['encerramentoTarde', 'para o follow-up da tarde (de ontem)']],
  retomada_sofia:        [['retomadaSofia', '']],
  boasvindas_nova:       [['boasVindas', '']],
  boasvindas_retorno:    'compartilha:boasvindas',
  boasvindas_renovacao:  'compartilha:boasvindas',
  indicacao_30d:         [['indicacao30', '']],
  noshow_encerramento:   [['noShowEncerraManha', 'para a falta da manhã (de ontem)'], ['noShowEncerraTarde', 'para a falta da tarde/noite (de ontem)']],
  renovacao:           [['renewal', '']],
  saida_grupos:        [['saidaGrupos', '']],
  sentimos_falta_1:    [['sentimosFalta', '']],
  sentimos_falta_2:    'compartilha:sentimos', // mesmo disparo de segunda da 1ª — só nota
  vence_hoje:          [['venceHoje', '']],
  assinatura_contrato: [['assinaturas', '']],
  aniversario:         [['aniversariantes', '']],
  aniversario_ex:      [['aniversarioEx', '']],
  instagram:           [['instagram', '']],
  circuito_convocacao: [['circuitoConvoca', '']],
  circuito_lembrete:   [['circuitoLembrete', '']],
  cobranca_recorrente: [['inadimplentes', '']],
  cobranca_boleto:      'compartilha:cobranca', // mesmo disparo da cobrança (recorrente) — só nota
  cobranca_saldo:       'compartilha:cobranca', // idem (saldo devedor sem boleto/recorrente)
  cobranca_boleto_hoje: [['inadimplentesHoje', '']], // horário/dias PRÓPRIOS (independentes das outras cobranças)
  cobranca_app_reativado: 'compartilha:bloqueioapp', // sai quando o robô reativa o app (Bloqueio do app ligado)
};
// Mensagens de GRUPO que têm job agendado próprio (não estão no HORARIOS_DA_MSG
// porque o horário delas é dia-do-mês/semana fixo, não editável aqui) — mas o
// switch Ativado/Desligado vale. mensagem (mensagens.js) → job(s) (config/scheduler).
const TOGGLE_EXTRA_DA_MSG = {
  ausentes:            ['ausentes10'],
  aniversariantes_mes: ['aniversMesGrupo'],
  renovacoes_mes:      ['renovacoesMesGrupo'],
  presentes:           ['presentesPend'],
  // Confirmações de experimental: não têm cron (disparam no agendamento), então
  // a chave do switch é a própria mensagem; o envio consulta jobsAtivos.ativo(chave).
  confirmacao_experimental:         ['confirmacao_experimental'],
  confirmacao_experimental_express: ['confirmacao_experimental_express'],
};
// Jobs que este card controla com o switch (vazio = sem switch).
function jobsDoCard(chave) {
  const m = HORARIOS_DA_MSG[chave];
  if (Array.isArray(m)) return m.map(([c]) => c);
  if (TOGGLE_EXTRA_DA_MSG[chave]) return TOGGLE_EXTRA_DA_MSG[chave];
  return [];
}

// Card de UMA mensagem (texto + horário + switch). hmap = horarios.listar() por chave.
// Módulo (não só dentro de paginaConfig) para ser reusado na aba SoFIA → Cobrança.
function cardDeMsg(m, hmap, voltar) {
  const mapa = HORARIOS_DA_MSG[m.chave];
  let hbloco = '';
  if (mapa === 'compartilha:followup') {
    hbloco = `<div class="hsec"><div class="hsec-t">Horário</div>
      <p class="quando" style="margin:0">Segue o <b>mesmo horário do Follow-up pós-aula (ainda não fechou)</b>, logo acima — é o mesmo disparo, muda só o texto conforme a lead.</p></div>`;
  } else if (mapa === 'compartilha:sentimos') {
    hbloco = `<div class="hsec"><div class="hsec-t">Horário</div>
      <p class="quando" style="margin:0">Sai no <b>mesmo disparo de segunda da 1ª mensagem</b>, logo acima (o botão Ativado de lá vale para as duas). Os dias entre a 1ª e a 2ª ficam no cartão da 1ª.</p></div>`;
  } else if (mapa === 'compartilha:cobranca') {
    hbloco = `<div class="hsec"><div class="hsec-t">Horário</div>
      <p class="quando" style="margin:0">Segue o <b>mesmo horário da Cobrança — recorrente</b>, logo acima — é o mesmo disparo, muda só o texto conforme o caso (recorrente = link de pagamento; boleto vencido = boleto; saldo devedor sem boleto = este texto, sem link). A <b>"boleto vence HOJE"</b> tem horário/dias próprios (no card dela).</p></div>`;
  } else if (mapa === 'compartilha:boasvindas') {
    hbloco = `<div class="hsec"><div class="hsec-t">Horário</div>
      <p class="quando" style="margin:0">Sai no <b>mesmo disparo das Boas-vindas — aluna nova</b>, logo acima (o horário e o botão Ativado de lá valem para todas). Cada tipo pode ser ligado/desligado no quadro "Para quem" de lá.</p></div>`;
  } else if (mapa === 'compartilha:bloqueioapp') {
    hbloco = `<div class="hsec"><div class="hsec-t">Quando sai</div>
      <p class="quando" style="margin:0">Não tem horário próprio: sai <b>na hora em que o robô recria o acesso ao app</b> (na cobrança do dia seguinte ao pagamento), só com o <b>Bloqueio do app ligado</b>.</p></div>`;
  } else if (Array.isArray(mapa)) {
    const linhas = mapa.map(([chave, sub]) => hmap[chave] ? blocoHorario(hmap[chave], sub) : '').join('');
    const editouHora = mapa.some(([chave]) => hmap[chave] && hmap[chave].editado);
    const badgeH = editouHora ? '<span class="badge-ed">alterado</span>' : '';
    hbloco = `<div class="hsec"><div class="hsec-t">Horário deste envio ${badgeH}</div>${linhas}</div>`;
  }
  const sw = switchEnvio(jobsDoCard(m.chave));
  const opts = /^cobranca_/.test(m.chave) ? { cobranca: true } : undefined;
  const extra = (m.chave === 'renovacao') ? blocoRenovDias() : (m.chave === 'aniversario') ? blocoAnivExcluir() : (m.chave === 'saida_grupos') ? blocoSaidas() : (m.chave === 'vence_hoje') ? blocoVenceHoje() : (m.chave === 'assinatura_contrato') ? blocoAssinaturas() : (m.chave === 'confirmacao_sem_resposta') ? blocoTesteSemResposta() : (m.chave === 'retomada_sofia') ? blocoRetomada() : (m.chave === 'boasvindas_nova') ? blocoBoasVindas() : (m.chave === 'indicacao_30d') ? blocoIndicacao() : (m.chave === 'followup_encerramento') ? blocoTesteEncerramento('followup') : (m.chave === 'noshow_encerramento') ? blocoTesteEncerramento('noshow') : (m.chave === 'sentimos_falta_1') ? blocoSentimos() : '';
  return `<div class="card" style="position:relative">${sw}${cardMensagem(m, voltar, opts)}${hbloco}${extra}</div>`;
}

// Campo "dias de antecedência" da Renovação (editável no painel; vale sem reiniciar).
// Aniversário (nos grupos): grupos que NÃO recebem o parabéns. Mostra também os
// grupos em comum vistos no último envio (clique para adicionar à lista).
function blocoAnivExcluir() {
  const lista = anivExcluir.listar();
  const vistos = new Map();
  try {
    const rel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'aniversariantes-envios.json'), 'utf8'));
    for (const r of (rel && rel.resultados) || []) {
      for (const g of [].concat(r.grupos || [], r.pulados || [])) {
        const nome = String(typeof g === 'object' ? (g && g.grupo) || '' : g).trim();
        if (nome && !/@g\.us$/.test(nome)) vistos.set(anivExcluir.norm(nome), nome);
      }
    }
  } catch (_) {}
  const chips = [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 30).map(n => {
    const fora = !!anivExcluir.bloqueadoPor(n, lista);
    return `<button type="button" class="var${fora ? ' ae-fora' : ''}" title="${fora ? 'Já não recebe' : 'Clique para não enviar neste grupo'}" onclick="aeAdd(this)" data-g="${esc(n)}"${fora ? ' disabled' : ''}>${fora ? '🚫 ' : '+ '}${esc(n)}</button>`;
  }).join(' ');
  return `<div class="hsec" id="aniv-excluir"><div class="hsec-t">Grupos que não recebem ${lista.length ? `<span class="badge-ed">${lista.length}</span>` : ''}</div>
    <form method="POST" action="/aniversario/excluir">
      <div class="lbl">Um grupo por linha. O parabéns vai em todos os grupos em comum com a aniversariante, <b>menos</b> nestes.</div>
      <textarea name="grupos" rows="3" placeholder="Ex.: Equipe SlimFit&#10;Circuito Slim" style="min-height:0">${esc(lista.join('\n'))}</textarea>
      ${chips ? `<p class="vars" style="margin:8px 0 0">Grupos do último envio (clique para adicionar): ${chips}</p>` : ''}
      <div class="acts" style="margin-top:8px"><button type="submit" class="save">Salvar grupos</button></div>
    </form>
    <p class="quando" style="margin:6px 0 0">Não diferencia maiúsculas nem acentos, e vale também para parte do nome: <b>"Equipe"</b> pula "Equipe SlimFit Bueno". Vale no próximo envio, sem reiniciar o robô.</p>
    <style>.ae-fora{opacity:.55;cursor:default}</style>
    <script>function aeAdd(b){ var t=b.closest('form').querySelector('textarea[name=grupos]'); var v=t.value.replace(/\\s+$/,''); t.value=(v?v+'\\n':'')+b.getAttribute('data-g'); b.disabled=true; b.classList.add('ae-fora'); b.textContent='🚫 '+b.getAttribute('data-g'); t.focus(); }</script></div>`;
}

// Saída — não renovou: quem entra hoje (sem WhatsApp, pelos dados do EVO), quem
// fica de fora e por quê, a última execução e a simulação (com os grupos).
function blocoSaidas() {
  let c = null, reg = { ultimo: null, ultimoSim: null };
  try { const sg = require('./saidas-grupos'); c = sg.candidatas(); reg = sg.lerRegistro(); } catch (_) {}
  const ligado = jobsAtivos.ativo('saidaGrupos');
  const fmtD = (d) => d ? d.split('-').reverse().join('/') : '';
  const linha = (x) => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome || 'sem nome')}</b> <span class="quando" style="margin:0">${x.rescindido ? 'rescindiu em' : 'venceu'} ${fmtD(x.fim)}${x.contrato ? ' · ' + esc(x.contrato) : ''}</span>${x.motivo ? `<div class="quando" style="margin:2px 0 0">⏭️ ${esc(x.motivo)}</div>` : ''}</div>`;
  const vai = c ? c.lista.filter(x => !x.motivo) : [], fora = c ? c.lista.filter(x => x.motivo) : [];
  const fotoOk = c && c.fotoDia === c.hoje;
  const ult = reg.ultimo, sim = reg.ultimoSim;
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const resumoExec = (r, sim) => !r ? '' : `<div class="sg-ult"><b>${sim ? '🧪 Simulação' : 'Última execução'} (${quando(r.em)}):</b> ${r.tratadas.length ? r.tratadas.map(t => `${esc(t.nome)} — ${t.motivo === 'sem grupo' ? 'não estava em grupo (sem mensagem)' : sim ? 'sairia de: ' + esc(t.grupos.join(', ')) : (t.grupos.length ? 'saiu de: ' + esc(t.grupos.join(', ')) : 'não saiu de nenhum grupo') + (t.ficou && t.ficou.length ? ' · continua em: ' + esc(t.ficou.join(', ')) : '') + (t.enviou ? ' · ✉️ mensagem enviada' : '')}`).join('<br>') : 'ninguém para tratar.'}</div>`;
  return `<div class="hsec" id="saidas"><div class="hsec-t">Quem entra no próximo disparo ${vai.length ? `<span class="badge-ed">${vai.length}</span>` : ''}</div>
    <p class="quando" style="margin:0 0 8px">Lista de quem o robô vai <b>retirar dos grupos e mandar a mensagem</b> no próximo horário deste cartão. Quem já foi tratada não aparece de novo.</p>
    <p class="quando" data-se-desligado style="margin:0 0 8px;color:var(--warn)${ligado ? ';display:none' : ''}">⏸️ Desligado: nada é feito até você ligar o botão <b>Ativado</b> no topo deste cartão.</p>
    <form method="POST" action="/saidas/dias" class="hrow" style="align-items:flex-end;margin:0 0 10px">
      <div><div class="lbl">Dias depois do vencimento</div>
        <input type="number" name="dias" min="1" max="60" value="${c ? c.dias : 7}" required style="width:92px">
      </div>
      <button type="submit" class="save">Salvar</button>
      <span class="quando" style="margin:0 0 8px">Renovação com até esse atraso ainda conta como “renovou”. Vale no próximo disparo, sem reiniciar.</span>
    </form>
    <p class="quando" style="margin:0 0 8px">Contrato SlimFit vencido entre <b>${c ? fmtD(c.de) : '?'}</b> e <b>${c ? fmtD(c.ate) : '?'}</b> (${c ? c.dias : 7} a ${c ? c.dias + 10 : 17} dias atrás) e não renovou. Contrato <b>rescindido</b> entra já no dia seguinte ao cancelamento. Trancada, contrato na fila e Circuito/VIP vigente não entram. O número do Studio precisa ser <b>administrador</b> dos grupos para conseguir retirar.</p>
    ${c && !fotoOk ? `<p class="quando" style="margin:0 0 8px;color:var(--warn)">⚠️ A leitura das alunas ativas de hoje (05:25) ainda não rodou${c.fotoDia ? ` — última: ${fmtD(c.fotoDia)}` : ''}. Sem ela o robô não mexe em ninguém.</p>` : ''}
    <div class="sg-lista">${vai.length ? vai.map(linha).join('') : '<div class="quando" style="margin:0">Ninguém para retirar hoje.</div>'}</div>
    ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(linha).join('')}</details>` : ''}
    ${resumoExec(sim, true)}${reg.ultimaAcao && ult && reg.ultimaAcao.em !== ult.em ? resumoExec(reg.ultimaAcao, false) + `<div class="sg-ult">Última execução: ${quando(ult.em)} — ninguém para tratar.</div>` : resumoExec(ult, false)}
    <form method="POST" action="/saidas/simular" style="margin-top:10px"><button type="submit" class="tbtn">🧪 Simular agora (ver os grupos de cada uma, sem mexer)</button></form>
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}.sg-fora{margin-top:8px}.sg-fora summary{cursor:pointer;font-weight:700;font-size:.85rem;color:var(--teal)}.sg-ult{margin-top:10px;font-size:.84rem;color:var(--cinza);line-height:1.5}.sg-ult b{color:var(--tinta)}</style>
  </div>`;
}

// Vence hoje — sem renovação: quem recebe no próximo disparo (pelos dados do EVO).
function blocoVenceHoje() {
  let c = null, reg = {};
  try { const vh = require('./vence-hoje'); c = vh.candidatas(); reg = vh.lerRegistro(); } catch (_) {}
  const ligado = jobsAtivos.ativo('venceHoje');
  const fmtD = (d) => d ? d.split('-').reverse().join('/') : '';
  const linha = (x) => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome || 'sem nome')}</b> <span class="quando" style="margin:0">${esc(x.vencimento)} (${fmtD(x.fim)})${x.contrato ? ' · ' + esc(x.contrato) : ''}</span>${x.motivo ? `<div class="quando" style="margin:2px 0 0">⏭️ ${esc(x.motivo)}</div>` : ''}</div>`;
  const vai = c ? c.lista.filter(x => !x.motivo) : [], fora = c ? c.lista.filter(x => x.motivo) : [];
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const ult = reg.ultimaAcao;
  const ultHtml = ult ? `<div class="sg-ult"><b>Último envio (${quando(ult.em)}):</b> ${ult.enviados.map(t => esc(t.nome) + (t.ok ? ' ✉️' : ' ⚠️ ' + esc(t.erro || 'falhou'))).join(' · ')}</div>` : '';
  const cobre = c && c.datas.length > 1 ? ` e quem venceu em ${c.datas.slice(1).map(fmtD).join(', ')} (dia sem disparo)` : '';
  return `<div class="hsec" id="vencehoje"><div class="hsec-t">Quem recebe no próximo disparo ${vai.length ? `<span class="badge-ed">${vai.length}</span>` : ''}</div>
    <p class="quando" data-se-desligado style="margin:0 0 8px;color:var(--warn)${ligado ? ';display:none' : ''}">⏸️ Desligado: nada é enviado até você ligar o botão <b>Ativado</b> no topo deste cartão.</p>
    <p class="quando" style="margin:0 0 8px">Contrato SlimFit que vence <b>hoje</b>${cobre} e ainda não tem contrato na fila. Trancada e Circuito/VIP não recebem. Cada contrato recebe uma vez só.</p>
    ${c && c.fotoDia !== c.hoje ? `<p class="quando" style="margin:0 0 8px;color:var(--warn)">⚠️ A leitura das alunas ativas de hoje (05:25) ainda não rodou${c.fotoDia ? ` — última: ${fmtD(c.fotoDia)}` : ''}. Sem ela o robô não envia.</p>` : ''}
    <div class="sg-lista">${vai.length ? vai.map(linha).join('') : '<div class="quando" style="margin:0">Ninguém para avisar hoje.</div>'}</div>
    ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(linha).join('')}</details>` : ''}
    ${ultHtml}
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}.sg-fora{margin-top:8px}.sg-fora summary{cursor:pointer;font-weight:700;font-size:.85rem;color:var(--teal)}.sg-ult{margin-top:10px;font-size:.84rem;color:var(--cinza);line-height:1.5}.sg-ult b{color:var(--tinta)}</style>
  </div>`;
}

// Contrato sem assinatura: quem recebe no próximo disparo (última leitura do
// EVO), com "Não enviar" por aluna e o botão de ler o EVO de novo.
// 🧪 Teste da "Confirmação sem resposta" com o Número para testes (sem esperar os horários).
function blocoTesteSemResposta() {
  return `<div class="hsec"><div class="hsec-t">🧪 Testar com o seu número</div>
    <p class="quando" style="margin:0 0 8px">Usa o <b>Número para testes</b> (lá em cima). Nada vai para leads nem para o grupo. Funciona mesmo com o envio desligado.</p>
    <ol class="quando" style="margin:0 0 8px;padding-left:18px;line-height:1.6">
      <li>Mande uma confirmação de teste para o seu celular.</li>
      <li>No celular: <b>responda</b>, <b>reaja</b> (❤️ 👍), ou <b>não faça nada</b>. Depois clique em <b>Conferir agora</b> — se você não respondeu, chega a 2ª mensagem; se respondeu, nada é enviado.</li>
      <li><b>Lista da equipe</b>: se continuou sem responder, a lista que iria para o grupo chega no seu celular.</li>
    </ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="tbtn" onclick="srTeste('confirmar',this)">1) Mandar confirmação de teste</button>
      <button type="button" class="tbtn" onclick="srTeste('conferir',this)">2) Conferir agora</button>
      <button type="button" class="tbtn" onclick="srTeste('lista',this)">3) Lista da equipe</button>
    </div>
    <p id="srMsg" class="quando" style="margin:8px 0 0"></p>
    <script>
    function srTeste(etapa,btn){
      var msg=document.getElementById('srMsg'), tel=(document.getElementById('telTeste')||{}).value||'';
      msg.style.color=''; msg.textContent='⏳ Pedido enviado ao robô…'; btn.disabled=true;
      fetch('/confirmacao/sem-resposta/teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({etapa:etapa,tel:tel})}).then(function(r){return r.json();}).then(function(j){
        if(!j.ok){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'falhou'); return; }
        var ini=Date.now();
        (function poll(){ fetch('/confirmacao/sem-resposta/teste/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
          if(s.estado==='ok'){ btn.disabled=false; msg.style.color='var(--ok)'; msg.textContent='✅ '+(s.msg||'feito'); return; }
          if(s.estado==='erro'){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ '+(s.msg||'falhou'); return; }
          if(Date.now()-ini>180000){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='⚠️ O robô não respondeu em 3 min — ele está rodando?'; return; }
          msg.textContent=s.estado==='esperando'?'⏳ '+s.msg:'⏳ O robô está conferindo…'; setTimeout(poll,2500);
        }).catch(function(){ setTimeout(poll,4000); }); })();
      }).catch(function(){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
    }
    </script>
  </div>`;
}

// 🧪 Teste do encerramento do follow-up com o Número para testes.
function blocoTesteEncerramento(origem) {
  const ns = origem === 'noshow', id = ns ? 'feMsgNs' : 'feMsg', oque = ns ? 'mensagem de falta' : 'follow-up';
  return `<div class="hsec"><div class="hsec-t">🧪 Testar com o seu número</div>
    <p class="quando" style="margin:0 0 8px">Usa o <b>Número para testes</b> (lá em cima). Nada vai para leads. Funciona mesmo com o envio desligado.</p>
    <ol class="quando" style="margin:0 0 8px;padding-left:18px;line-height:1.6">
      <li>Mande ${ns ? 'uma' : 'um'} ${oque} de teste para o seu celular.</li>
      <li>No celular: <b>responda</b>, <b>reaja</b> (❤️ 👍), ou <b>não faça nada</b>. Depois clique em <b>Conferir agora</b> — se você não respondeu, chega o encerramento; se respondeu, nada é enviado.</li>
    </ol>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="tbtn" onclick="feTeste('enviar',this,'${origem}','${id}')">1) Mandar ${oque} de teste</button>
      <button type="button" class="tbtn" onclick="feTeste('conferir',this,'${origem}','${id}')">2) Conferir agora</button>
    </div>
    <p id="${id}" class="quando" style="margin:8px 0 0"></p>
    <script>
    function feTeste(etapa,btn,origem,idMsg){
      var msg=document.getElementById(idMsg), tel=(document.getElementById('telTeste')||{}).value||'';
      msg.style.color=''; msg.textContent='⏳ Pedido enviado ao robô…'; btn.disabled=true;
      fetch('/followup/encerramento/teste',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({etapa:etapa,tel:tel,origem:origem})}).then(function(r){return r.json();}).then(function(j){
        if(!j.ok){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ '+(j.erro||'falhou'); return; }
        var ini=Date.now();
        (function poll(){ fetch('/confirmacao/sem-resposta/teste/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
          if(s.estado==='ok'){ btn.disabled=false; msg.style.color='var(--ok)'; msg.textContent='✅ '+(s.msg||'feito'); return; }
          if(s.estado==='erro'){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ '+(s.msg||'falhou'); return; }
          if(Date.now()-ini>180000){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='⚠️ O robô não respondeu em 3 min — ele está rodando?'; return; }
          msg.textContent=s.estado==='esperando'?'⏳ '+s.msg:'⏳ O robô está conferindo…'; setTimeout(poll,2500);
        }).catch(function(){ setTimeout(poll,4000); }); })();
      }).catch(function(){ btn.disabled=false; msg.style.color='var(--erro)'; msg.textContent='❌ erro de rede'; });
    }
    </script>
  </div>`;
}

// Boas-vindas: tipos ligados + quem entrou nos últimos dias (prévia pela leitura do EVO).
function blocoBoasVindas() {
  let cfg = { nova: true, retorno: true, renovacao: true, equipe: true, desde: '' }, lista = [];
  try { const bv = require('./boas-vindas'); cfg = bv.lerCfg(); lista = bv.entradas(); } catch (_) {}
  const TIPO = { nova: '🎉 aluna nova', retorno: '💚 voltou', renovacao: '🔁 renovou' };
  const br = (d) => d ? d.split('-').reverse().join('/') : '';
  const chk = (k, rot) => `<label class="chk" style="margin:0;font-weight:500"><input type="checkbox" name="${k}" value="1"${cfg[k] ? ' checked' : ''}> ${rot}</label>`;
  const linha = (x) => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome)}</b> <span class="quando" style="margin:0">${TIPO[x.tipo]} · ${esc(x.plano)} · começou ${br(x.inicio)}${x.motivo ? ' — ' + esc(x.motivo) : ''}</span></div>`;
  const vai = lista.filter(x => !x.motivo), fora = lista.filter(x => x.motivo);
  return `<div class="hsec" id="boasvindas"><div class="hsec-t">Para quem</div>
    <form method="POST" action="/boasvindas/cfg" style="margin:0">
      <div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 8px">${chk('nova', 'Aluna nova')}${chk('retorno', 'Ex-aluna voltando')}${chk('renovacao', 'Renovação')}${chk('equipe', 'Listar no Resumo do dia (para colocar nos grupos)')}</div>
      <button type="submit" class="save">Salvar</button>
    </form>
    <p class="quando" style="margin:8px 0 0">O robô lê os contratos no EVO de manhã (05:25). Aluna <b>nova</b> = primeiro contrato no Studio; <b>voltou</b> = já foi aluna, ficou um tempo fora e voltou; <b>renovou</b> = contrato novo emendado no anterior. Se o contrato ainda não foi assinado, a mensagem leva o link de assinatura ({assinatura}). As novas e as que voltaram aparecem no <b>Resumo do dia</b> do grupo da equipe, no bloco "Alunas novas — colocar nos grupos". ${cfg.desde ? `Vale para contratos a partir de <b>${br(cfg.desde)}</b>.` : 'Só vale <b>daqui pra frente</b>: a partir do dia em que rodar pela primeira vez.'}</p>
  </div>
  <div class="hsec"><div class="hsec-t">Contratos novos (últimos 3 dias)</div>
    <div class="sg-ult"><b>${vai.length}</b> receberia(m) se rodasse agora · ${fora.length} fora</div>
    ${vai.length ? `<div class="sg-lista">${vai.map(linha).join('')}</div>` : ''}
    ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(linha).join('')}</details>` : ''}
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}</style>
  </div>`;
}
function blocoIndicacao() {
  let lista = [];
  try { lista = require('./boas-vindas').paraIndicacao(); } catch (_) {}
  const br = (d) => d ? d.split('-').reverse().join('/') : '';
  return `<div class="hsec"><div class="hsec-t">Completando 30 dias agora</div>
    ${lista.length ? lista.map(x => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome)}</b> <span class="quando" style="margin:0">começou ${br(x.inicio)}${x.motivo ? ' — ' + esc(x.motivo) : ''}</span></div>`).join('') : '<p class="quando" style="margin:0">Ninguém completando 30 dias nos próximos envios.</p>'}
  </div>`;
}

// Retomada (SoFIA → Studio): quem está no ponto AGORA (prévia — a conversa do Studio
// é conferida na hora do envio: quem a recepção já chamou fica de fora).
function blocoRetomada() {
  let lista = [], cfg = { horas: 24, dias: 3 }, reg = {}, rtCfg = { tags: [] }, todasTags = [];
  try { lista = require('./retomada-sofia').candidatas(); } catch (_) {}
  try { rtCfg = require('./retomada-sofia').lerCfg(); } catch (_) {}
  try { todasTags = require('./contatos').tagsDistintas().map(x => x.tag); } catch (_) {}
  for (const t of rtCfg.tags) if (!todasTags.includes(t)) todasTags.unshift(t);
  const marcadas = new Set(rtCfg.tags);
  try { cfg = require('./sofia-editor').lerQuietoCfg(); } catch (_) {}
  try { reg = require('./retomada-sofia').ler(); } catch (_) {}
  const vai = lista.filter(x => !x.motivo), fora = lista.filter(x => x.motivo);
  const quando = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''); } catch (_) { return ''; } };
  const linha = (x) => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome || x.chave)}</b> <span class="quando" style="margin:0">última mensagem dela ${quando(x.ultimaContato)}${x.motivo ? ' — ' + esc(x.motivo) : ''}</span></div>`;
  const enviadas = Object.values(reg).filter(r => r.enviadoEm).sort((a, b) => b.enviadoEm - a.enviadoEm).slice(0, 8);
  return `<div class="hsec" id="retomada"><div class="hsec-t">Para quem</div>
    <form method="POST" action="/retomada/cfg" style="margin:0 0 6px">
      <p class="quando" style="margin:0 0 6px">Só para quem tem <b>alguma</b> destas tags (nenhuma marcada = qualquer tag). Ex.: <b>FX - 2. Encerrado sem agendamento</b>.</p>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;max-height:180px;overflow:auto;padding:6px 0">${todasTags.map(t => `<label class="chk" style="margin:0;font-weight:500"><input type="checkbox" name="tag" value="${esc(t)}"${marcadas.has(t) ? ' checked' : ''}> ${esc(t)}</label>`).join('') || '<span class="quando">Nenhuma tag cadastrada.</span>'}</div>
      <button type="submit" class="save">Salvar</button>
      <span class="quando" style="margin-left:8px">${rtCfg.tags.length ? `Hoje: só <b>${rtCfg.tags.map(esc).join('</b>, <b>')}</b>` : 'Hoje: <b>qualquer tag</b>'}</span>
    </form>
  </div>
  <div class="hsec"><div class="hsec-t">Quem está no ponto agora</div>
    <p class="quando" style="margin:0 0 8px">Mesma lista do filtro <b>😴 Sem resposta há ${esc(String(cfg.horas))}h+ (${esc(String(cfg.dias))}d)</b> das Conversas da SoFIA (ajuste em SoFIA → Configuração). Na hora do envio o robô ainda confere a conversa do <b>Studio</b>: quem a recepção já chamou por lá, ou que escreveu para o Studio, fica de fora.</p>
    <div class="sg-ult"><b>${vai.length}</b> receberia(m) se rodasse agora · ${fora.length} fora da regra</div>
    ${vai.length ? `<div class="sg-lista">${vai.slice(0, 40).map(linha).join('')}</div>` : ''}
    ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(linha).join('')}</details>` : ''}
    ${enviadas.length ? `<details class="sg-fora"><summary>Últimas retomadas enviadas (${enviadas.length})</summary>${enviadas.map(r => `<div class="sg-row"><b>${esc(r.nome || '')}</b> <span class="quando" style="margin:0">${quando(r.enviadoEm)}</span></div>`).join('')}</details>` : ''}
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}</style>
  </div>`;
}

function blocoAssinaturas() {
  let c = null, reg = {};
  try { const as = require('./assinaturas'); c = as.candidatas(); reg = as.lerRegistro(); } catch (_) {}
  const ligado = jobsAtivos.ativo('assinaturas');
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const btn = (x, remover) => `<form method="POST" action="/assinaturas/excluir" style="display:inline;margin:0 0 0 8px"><input type="hidden" name="id" value="${esc(x.id)}"><input type="hidden" name="nome" value="${esc(x.nome)}">${remover ? '<input type="hidden" name="remover" value="1">' : ''}<button type="submit" class="tbtn" style="padding:2px 9px;font-size:.76rem">${remover ? 'Voltar a enviar' : 'Não enviar'}</button></form>`;
  const linha = (x) => `<div class="sg-row${x.motivo ? ' fora' : ''}"><b>${esc(x.nome || 'sem nome')}</b> <span class="quando" style="margin:0">${esc(x.plano || '')}${x.envios ? ` · ${x.envios} lembrete(s), último em ${quando(x.ultimo)}` : ''}</span>${x.motivo === 'marcada para não receber' ? btn(x, true) : (!x.motivo || x.motivo === 'já recebeu hoje') ? btn(x, false) : ''}${x.motivo ? `<div class="quando" style="margin:2px 0 0">⏭️ ${esc(x.motivo)}</div>` : ''}</div>`;
  // uma linha por aluna (duas pendências da mesma aluna recebem um lembrete só)
  const vistos = new Set(); const lista = c ? c.lista.filter(x => { const k = x.id + '|' + (x.motivo ? 'f' : 'v'); if (vistos.has(k)) return false; vistos.add(k); return true; }) : [];
  const vai = lista.filter(x => !x.motivo), fora = lista.filter(x => x.motivo);
  const ult = reg.ultimaAcao;
  const ultHtml = ult ? `<div class="sg-ult"><b>Último envio (${quando(ult.em)}):</b> ${ult.enviados.map(t => esc(t.nome) + (t.ok ? ' ✉️' : ' ⚠️ ' + esc(t.erro || 'falhou'))).join(' · ')}</div>` : '';
  return `<div class="hsec" id="assinaturas"><div class="hsec-t">Quem recebe no próximo disparo ${vai.length ? `<span class="badge-ed">${vai.length}</span>` : ''}</div>
    <p class="quando" data-se-desligado style="margin:0 0 8px;color:var(--warn)${ligado ? ';display:none' : ''}">⏸️ Desligado: nada é enviado até você ligar o botão <b>Ativado</b> no topo deste cartão.</p>
    <p class="quando" style="margin:0 0 8px">Alunas ativas com contrato vigente que ainda <b>não foi assinado</b> no EVO. Cada uma recebe no máximo uma vez por dia, nos dias/horário acima; quando assina, sai da lista sozinha. ${c && c.em ? `Lista lida no EVO em <b>${quando(c.em)}</b> (o robô lê de novo a cada disparo).` : 'A lista ainda não foi lida no EVO.'}</p>
    <div class="sg-lista">${vai.length ? vai.map(linha).join('') : '<div class="quando" style="margin:0">Ninguém para lembrar.</div>'}</div>
    ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(linha).join('')}</details>` : ''}
    ${ultHtml}
    <form method="POST" action="/assinaturas/atualizar" style="margin-top:10px" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='⏳ Lendo o EVO…';"><button type="submit" class="tbtn">🔄 Ler o EVO agora (não envia nada)</button></form>
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}.sg-fora{margin-top:8px}.sg-fora summary{cursor:pointer;font-weight:700;font-size:.85rem;color:var(--teal)}.sg-ult{margin-top:10px;font-size:.84rem;color:var(--cinza);line-height:1.5}.sg-ult b{color:var(--tinta)}</style>
  </div>`;
}

// Sentimos sua falta: dias configuráveis, quem está esperando a 2ª, a última
// simulação/execução e o botão de simular (lê o EVO; não envia).
function blocoSentimos() {
  let cfg = { diasAusente: 14, diasEntre: 10 }, reg = { alunas: {} }, LIM = { diasAusente: [7, 120], diasEntre: [3, 60] };
  try { const sf = require('./sentimos-falta'); cfg = sf.lerCfg(); reg = sf.lerRegistro(); LIM = sf.LIM; } catch (_) {}
  const ligado = jobsAtivos.ativo('sentimosFalta');
  const br = (iso) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const soma = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const al = Object.values(reg.alunas || {});
  const esperando = al.filter(a => a.m1 && !a.m2 && !a.invalido).sort((a, b) => String(a.m1).localeCompare(String(b.m1)));
  const ambas = al.filter(a => a.m2).length;
  const linhaRes = (x, sim) => `<div class="sg-row${x.etapa ? '' : ' fora'}"><b>${esc(x.nome)}</b> <span class="quando" style="margin:0">sem vir há ${x.dias != null ? x.dias : '?'} dias${x.ultima ? ' (última presença ' + esc(x.ultima) + ')' : ''}</span>${x.etapa ? `<div class="quando" style="margin:2px 0 0">${sim ? '🧪 receberia' : (x.ok ? '✉️ recebeu' : '⚠️ não saiu' + (x.erro ? ': ' + esc(x.erro) : ''))} a <b>${x.etapa}ª mensagem</b></div>` : `<div class="quando" style="margin:2px 0 0">⏭️ ${esc(x.motivo || '')}</div>`}</div>`;
  const resumo = (r, sim) => {
    if (!r) return '';
    const vai = (r.itens || []).filter(x => x.etapa), fora = (r.itens || []).filter(x => !x.etapa);
    return `<div class="sg-ult"><b>${sim ? '🧪 Simulação' : 'Último envio'} (${quando(r.em)}):</b> ${r.total || 0} ausente(s) ativa(s)${r.trancadas ? `, ${r.trancadas} trancada(s) fora` : ''} — ${vai.filter(x => x.etapa === 1).length} na 1ª, ${vai.filter(x => x.etapa === 2).length} na 2ª.</div>
      ${vai.length ? `<div class="sg-lista">${vai.map(x => linhaRes(x, sim)).join('')}</div>` : ''}
      ${fora.length ? `<details class="sg-fora"><summary>Ficaram de fora (${fora.length})</summary>${fora.map(x => linhaRes(x, sim)).join('')}</details>` : ''}`;
  };
  return `<div class="hsec" id="sentimos"><div class="hsec-t">Regras e acompanhamento</div>
    <p class="quando" data-se-desligado style="margin:0 0 8px;color:var(--warn)${ligado ? ';display:none' : ''}">⏸️ Desligado: nada é enviado até você ligar o botão <b>Ativado</b> no topo deste cartão.</p>
    <form method="POST" action="/sentimos/cfg" class="hrow" style="align-items:flex-end;margin:0 0 10px;flex-wrap:wrap;gap:12px">
      <div><div class="lbl">Sem treinar há (dias)</div><input type="number" name="diasAusente" min="${LIM.diasAusente[0]}" max="${LIM.diasAusente[1]}" value="${cfg.diasAusente}" required style="width:92px"></div>
      <div><div class="lbl">2ª mensagem depois de (dias)</div><input type="number" name="diasEntre" min="${LIM.diasEntre[0]}" max="${LIM.diasEntre[1]}" value="${cfg.diasEntre}" required style="width:92px"></div>
      <button type="submit" class="save">Salvar</button>
    </form>
    <p class="quando" style="margin:0 0 8px">Toda segunda o robô lê no EVO (CRM → Faltantes) as alunas <b>ativas</b> sem presença há <b>${cfg.diasAusente}+ dias</b>. <b>Trancada não recebe.</b> Quem nunca recebeu vai na <b>1ª</b>; quem recebeu a 1ª há <b>${cfg.diasEntre}+ dias</b> e continua sem nenhuma presença nova vai na <b>2ª</b>. Depois da 2ª, nada mais até ela voltar a treinar — se voltar e sumir de novo, recomeça pela 1ª. Como o envio é só às segundas, a 2ª sai na primeira segunda depois desse prazo.</p>
    <div class="sg-ult"><b>Agora:</b> ${esperando.length} aluna(s) receberam a 1ª e podem receber a 2ª · ${ambas} já receberam as duas.</div>
    ${esperando.length ? `<details class="sg-fora"><summary>Esperando a 2ª (${esperando.length})</summary>${esperando.map(a => `<div class="sg-row"><b>${esc(a.nome)}</b> <span class="quando" style="margin:0">1ª em ${br(a.m1)} · 2ª a partir de ${br(soma(a.m1, cfg.diasEntre))}, se continuar sem vir</span></div>`).join('')}</details>` : ''}
    ${resumo(reg.ultimoSim, true)}
    ${resumo(reg.ultimaAcao, false)}
    <form method="POST" action="/sentimos/simular" style="margin-top:10px"><button type="submit" class="tbtn">🧪 Simular agora (lê o EVO e mostra quem receberia — não envia)</button></form>
    <style>.sg-row{padding:7px 0;border-top:1px solid var(--linha-soft);font-size:.88rem}.sg-row:first-child{border-top:0}.sg-row.fora{opacity:.75}.sg-fora{margin-top:8px}.sg-fora summary{cursor:pointer;font-weight:700;font-size:.85rem;color:var(--teal)}.sg-ult{margin-top:10px;font-size:.84rem;color:var(--cinza);line-height:1.5}.sg-ult b{color:var(--tinta)}</style>
  </div>`;
}

function blocoRenovDias() {
  const d = renovacaoConfig.diasAntes();
  return `<div class="hsec"><div class="hsec-t">Antecedência do aviso</div>
    <form method="POST" action="/renovacao/dias" class="hrow" style="align-items:flex-end">
      <div><div class="lbl">Dias antes do vencimento</div>
        <input type="number" name="dias" min="${renovacaoConfig.MIN}" max="${renovacaoConfig.MAX}" value="${d}" required style="width:92px">
      </div>
      <button type="submit" class="save">Salvar</button>
    </form>
    <p class="quando" style="margin:6px 0 0">Avisa a aluna cujo plano vence daqui a <b>${d}</b> dia(s). Vale na hora, <b>sem reiniciar</b> o robô.</p></div>`;
}

// Jobs sem texto editável, na seção "Outros envios" da aba Mensagens.
// (os agendados manhã/tarde ficam na aba "Agendar envios", pois são dela.)
const OUTROS_JOBS = ['resumoDia', 'resumoSemana', 'planilhaAniv'];

// Switch Ativado/Desligado (deslizante) para o canto superior direito do card.
// chaves = jobs que este envio controla (1 ou mais). Padrão ligado.
function switchEnvio(chaves) {
  const lista = (Array.isArray(chaves) ? chaves : [chaves]).filter(Boolean);
  if (!lista.length) return '';
  const on = lista.every(c => jobsAtivos.ativo(c));
  const id = lista.join('_');
  return `<label class="envsw ${on ? 'on' : 'off'}" title="Ligar/desligar este envio" id="envsw_${esc(id)}">
    <span class="envsw-txt" id="envst_${esc(id)}">${on ? 'Ativado' : 'Desligado'}</span>
    <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleEnvio('${esc(lista.join(','))}', this)">
    <span class="envsw-track"><span class="envsw-thumb"></span></span>
  </label>`;
}

// Hora 'HH:MM' de um job (override ou padrão) — usada nos rótulos do /agendar.
function horaTurno(chave) { try { return horarios.parse(horarios.cronDe(chave)).hora; } catch (_) { return ''; } }

// Foto (flyer) que foi — ou iria — junto com um envio do Log. Registros novos trazem
// a chave; nos antigos (antes disso), deduz pelo tipo de envio. Só devolve se a
// foto ainda existe no painel.
const FOTO_POR_CONTEXTO = {
  'Manhã (hoje)': 'confirmacao_experimental', 'Tarde (amanhã)': 'confirmacao_experimental',
  'Renovação de contrato': 'renovacao', 'Aniversário ex-alunas': 'aniversario_ex',
};
// Qual job do robô refaz uma falha do Log (pelo nome gravado em "contexto").
// seguro = o job não repete para quem já recebeu (pode rodar mesmo que algo já
// tenha saído); senão, só se nada desse envio tinha saído antes da falha.
const JOBS_DO_LOG = [
  [/^Manhã \(hoje\)|^Confirmação HOJE/i, 'confirmacaoHoje', false, 'Confirmação das aulas de hoje'],
  [/^Tarde \(amanhã\)|^Confirmação AMANHÃ/i, 'confirmacaoAmanha', false, 'Confirmação das aulas de amanhã'],
  [/^Follow-up \(manhã|^Follow-up MANHÃ/i, 'followupMorning', false, 'Follow-up da manhã'],
  [/^Follow-up \(tarde|^Follow-up TARDE/i, 'followupAfternoon', false, 'Follow-up da tarde'],
  [/^Faltas \/ no-show \(manhã|^Faltas MANHÃ/i, 'noShowMorning', false, 'Faltas da manhã'],
  [/^Faltas \/ no-show \(tarde|^Faltas TARDE/i, 'noShowAfternoon', false, 'Faltas da tarde e noite'],
  [/^Aniversário \(grupos|^Aniversariantes/i, 'aniversariantes', false, 'Parabéns nos grupos'],
  [/^Aniversário ex-alunas/i, 'aniversarioEx', false, 'Aniversário das ex-alunas'],
  [/^Renovação/i, 'renovacao', false, 'Aviso de renovação'],
  [/^Vence hoje — sem renovação/i, 'venceHoje', true, 'Avisa quem vence hoje sem renovação (quem já recebeu não repete)'],
  [/^Contrato sem assinatura/i, 'assinaturas', true, 'Lembrete de assinatura: quem já recebeu hoje não repete'],
  [/^Saída — não renovou/i, 'saidaGrupos', true, 'Retira dos grupos e manda a mensagem (quem já foi tratada não repete)'],
  [/^Sentimos sua falta/i, 'sentimosFalta', true, 'Sentimos sua falta: quem já recebeu não repete'],
  [/^Resumo do dia/i, 'resumoDia', false, 'Resumo do dia'],
  [/^Cobrança de inadimplentes/i, 'inadimplentes', true, 'Cobrança: manda só para quem ainda não foi cobrada hoje'],
  [/^Cobrança — boleto vence hoje/i, 'inadimplentesHoje', true, 'Boleto vence hoje: manda só para quem ainda não recebeu hoje'],
  [/^Planos FREE/i, 'freeAntecedencia', true, 'Planos FREE'],
  [/^Leitura das alunas ativas|^Planilha/i, 'planilha', true, 'Leitura das alunas ativas (tags + planilha)'],
  [/^Boas-vindas \(simulação/i, 'boasVindasDry', true, 'Simulação das boas-vindas (não envia)'],
  [/^Boas-vindas/i, 'boasVindas', true, 'Boas-vindas: só manda para quem ainda não recebeu'],
  [/^Indicação 30 dias/i, 'indicacao', true, 'Indicação: só manda para quem ainda não recebeu'],
  [/^Retomada SoFIA \(simulação/i, 'retomadaDry', true, 'Simulação da retomada (não envia)'],
  [/^Retomada SoFIA/i, 'retomada', true, 'Retomada: só manda para quem ainda não recebeu neste período'],
  [/^Follow-up encerramento \(simulação/i, 'encerramentoDry', true, 'Simulação do encerramento (não envia)'],
  [/^Follow-up encerramento|^Faltou encerramento/i, 'encerramento', true, 'Encerramento: só manda para quem ainda não recebeu'],
  [/^Confirmação sem resposta \(2ª mensagem\)|^Confirmação sem resposta \(simulação/i, 'semResposta', true, 'Confirmação sem resposta: só manda para quem ainda não recebeu a 2ª mensagem'],
  [/^Confirmação sem resposta \(lista da equipe\)/i, 'semRespostaEquipe', true, 'Confirmação sem resposta: cada pessoa entra na lista uma vez'],
  [/^Grade→formulário/i, 'slotsPush', true, 'Atualiza os horários do formulário'],
  [/^Grade de fixas/i, 'gradeFixas', true, 'Atualiza a grade de matrículas'],
  [/^Alunas ativas \(EVO\)/i, 'ativasFoto', true, 'Relê as alunas ativas no EVO'],
  [/^Histórico de experimentais/i, 'historicoExperimentais', true, 'Relê as experimentais no EVO'],
];
function jobDoLog(contexto) {
  const c = String(contexto || '').replace(/\s*\[(manual|RECUPERAÇÃO)\]\s*$/i, '').trim();
  const j = JOBS_DO_LOG.find(([re]) => re.test(c));
  return j ? { key: j[1], seguro: j[2], dica: j[3] } : null;
}
const RODAR_JOB_ST = path.resolve(__dirname, '..', 'data', 'rodar-job-status.json');
function statusRodarJob(id) {
  try {
    const o = JSON.parse(fs.readFileSync(RODAR_JOB_ST, 'utf8'));
    if (o && o.id === id) return o;            // formato antigo (um pedido só)
    if (o && o[id]) return o[id];             // { id: { job, estado, msg, em } }
  } catch (_) {}
  return null;
}
// Falhas do Log que alguém mandou refazer: { "<ts>|<contexto>": { job, id, por, em } }.
const LOG_REFEITOS = path.resolve(__dirname, '..', 'data', 'log-refeitos.json');
function lerRefeitos() { try { const o = JSON.parse(fs.readFileSync(LOG_REFEITOS, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
const hhmm = (ms) => { try { return new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

function fotoDoEnvio(e) {
  let ch = String(e.chaveFoto || '');
  if (!ch) {
    ch = FOTO_POR_CONTEXTO[String(e.contexto || '').replace(/ · reenvio$/, '')] || '';
  }
  try { return ch && mensagens.fotoPath(ch) ? ch : ''; } catch (_) { return ''; }
}

// ── Página: o que o robô fez hoje ───────────────────────────────────────────
function paginaHoje(dia) {
  const d = dia || atividade.hojeSP();
  const r = atividade.resumoHoje(d);
  const evs = atividade.listarHoje(d, 150);
  const ehHoje = d === atividade.hojeSP();

  const maxJob = Math.max(1, ...r.jobs.map(j => j.sent + j.failed));
  const jobs = r.jobs.map(j => uiBarra({
    largo: true, rot: esc(j.contexto), titulo: j.contexto, n: j.sent, max: maxJob, cor: 'var(--ok)', texto: '',
    valor: `${j.sent} <small>enviada${j.sent === 1 ? '' : 's'}</small>${j.failed ? ` · <span style="color:var(--erro)">${j.failed} falha${j.failed === 1 ? '' : 's'}</span>` : ''}`,
  })).join('');

  // "↻ Rodar de novo" em falha de JOB (e na cobrança que falhou): pede ao robô para
  // rodar o job outra vez. Só aparece quando é seguro — o job não manda em dobro
  // (pula quem já recebeu) OU nada tinha saído desse job antes da falha.
  const ctxBase = (c) => String(c || '').replace(/\s*\[(manual|RECUPERAÇÃO)\]\s*$/i, '').trim();
  const enviouAntes = (e) => {
    const t = Date.parse(e.ts) || 0, c = ctxBase(e.contexto);
    return evs.filter(x => x.ok && ctxBase(x.contexto) === c && (Date.parse(x.ts) || 0) <= t && t - (Date.parse(x.ts) || 0) < 3 * 3600000).length;
  };
  const refeitos = lerRefeitos();
  const lista = evs.map(e => {
    const ic = e.pulado ? '⏭️' : (e.ok ? '✅' : '⚠️'); // ⏭️ = a SoFIA decidiu não enviar (ex.: follow-up de quem encerrou)
    const who = e.grupo ? esc(e.destino || 'grupo') : esc(fmtTel(e.destino));
    const pvText = e.preview || (e.midia ? '📎 mídia' : '');
    // Se guardamos a mensagem inteira e ela é maior que a prévia, mostra "+ ver tudo".
    const full = (e.texto && e.texto.replace(/\s+/g, ' ').trim().length > pvText.length) ? e.texto : '';
    let pvNode;
    if (e.erro) {
      pvNode = `<span class="pv"><span style="color:#a12626">${esc(e.erro)}</span></span>`;
    } else if (full) {
      pvNode = `<details class="pvmore"><summary>${esc(pvText)} <span class="mais">＋ ver tudo</span></summary><div class="tudo">${esc(full)}</div></details>`;
    } else {
      pvNode = `<span class="pv">${esc(pvText)}</span>`;
    }
    // Falha de envio individual do robô (ex.: número errado/sem WhatsApp): ↻ Reenviar
    // abre o número (editável) e a mensagem original, e manda só essa de novo.
    // (falha de JOB — destino "—", ex.: EVO fora do ar — não é mensagem: sem reenviar)
    const podeReenviar = !e.ok && !e.grupo && !e.sofia && e.destino !== '—' && /\d{8}/.test(String(e.destino || '').replace(/\D/g, '')) && String(e.texto || '').trim();
    const chFoto = podeReenviar ? fotoDoEnvio(e) : '';
    const reenviar = podeReenviar ? `<details class="hj-re"><summary title="Corrigir o número e reenviar só esta mensagem">↻ Reenviar</summary>
        <div class="hj-re-f">
          <label>Número (WhatsApp)<input type="tel" class="hj-tel" value="${esc(fmtTel(e.destino))}" placeholder="(61) 99999-9999"></label>
          <label>Mensagem<textarea class="hj-txt" rows="4">${esc(e.texto)}</textarea></label>
          <input type="hidden" class="hj-ctx" value="${esc(e.contexto || '')}">
          ${chFoto ? `<label class="hj-foto"><input type="checkbox" class="hj-chf" value="${esc(chFoto)}" checked> <span>📎 Enviar com a foto da mensagem</span></label>` : ''}
          <div class="hj-re-a"><button type="button" class="ui-btn" onclick="hjReenviar(this)">Enviar</button><span class="hj-st quando" style="margin:0"></span></div>
        </div></details>` : '';
    let refazer = '';
    const jd = !e.ok && (e.destino === '—' || e.sofia) ? jobDoLog(e.contexto) : null;
    if (jd && (e.destino === '—' || jd.seguro)) {
      const antes = jd.seguro ? 0 : enviouAntes(e);
      const linha = `${e.ts}|${ctxBase(e.contexto)}`;
      // Já mandaram refazer esta falha? Mostra quem, quando e o resultado.
      const rf = refeitos[linha];
      const rst = rf ? statusRodarJob(rf.id) : null;
      const quem = rf && rf.por ? ` por ${esc(rf.por)}` : '';
      let selo = '';
      if (rf && rst && rst.estado === 'ok') selo = `<span class="hj-st quando" style="margin:0;color:var(--ok)">✅ Refeito às ${hhmm(rst.em || rf.em)}${quem}${rst.msg ? ' — ' + esc(rst.msg) : ''}</span>`;
      else if (rf && rst && rst.estado === 'erro') selo = `<span class="hj-st quando" style="margin:0;color:var(--erro)">❌ Tentativa às ${hhmm(rf.em)}${quem} falhou: ${esc(rst.msg || 'erro')}</span>`;
      else if (rf && Date.now() - rf.em < 25 * 60000) selo = `<span class="hj-st quando" style="margin:0">⏳ Pedido às ${hhmm(rf.em)}${quem} — rodando…</span>`;
      const feito = rst && rst.estado === 'ok';
      refazer = antes
        ? `<div class="quando" style="margin:6px 0 0">Não dá para rodar de novo: ${antes} mensagem(ns) deste envio já tinham saído — repetir mandaria em dobro.</div>`
        : feito
          ? `<div class="hj-rj">${selo}</div>`
          : `<div class="hj-rj"><button type="button" class="ui-btn sec" data-linha="${esc(linha)}" onclick="hjRodarJob(this,'${jd.key}')" title="${esc(jd.dica)}">↻ Rodar de novo</button>${selo || '<span class="hj-st quando" style="margin:0"></span>'}</div>`;
    }
    return `<div class="ev"><span class="h">${esc(e.quando)}</span><span class="ic">${ic}</span>
      <div class="d"><span class="who">${who}</span> <span class="ctx">· ${esc(e.contexto)}</span>${pvNode}${reenviar}${refazer}</div></div>`;
  }).join('');

  const corpo = `<div class="wrap">
    <style>
      .pvmore{margin-top:2px}
      .pvmore summary{cursor:pointer;list-style:none;color:var(--texto,#333)}
      .pvmore summary::-webkit-details-marker{display:none}
      .pvmore .mais{color:var(--teal);font-weight:700;font-size:.82rem;white-space:nowrap}
      .pvmore[open] summary .mais{opacity:.55}
      .pvmore .tudo{white-space:pre-wrap;word-break:break-word;margin-top:6px;padding:8px 10px;border:1px solid var(--linha);border-radius:8px;font-size:.9rem;line-height:1.45}
      .hj-re{margin-top:6px}
      .hj-rj{margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
      .hj-rj .ui-btn{padding:5px 12px;font-size:.82rem}
      .hj-re summary{display:inline-block;cursor:pointer;list-style:none;font-weight:700;font-size:.82rem;color:var(--teal);border:1px solid var(--linha);border-radius:999px;padding:3px 11px;background:#fff}
      .hj-re summary::-webkit-details-marker{display:none}
      .hj-re[open] summary{background:var(--teal);color:#fff;border-color:var(--teal)}
      .hj-re-f{display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:10px 12px;border:1px solid var(--linha);border-radius:10px;background:var(--bg);max-width:560px}
      .hj-re-f label{display:flex;flex-direction:column;gap:4px;font-size:.8rem;font-weight:700;color:var(--cinza)}
      .hj-re-f textarea{font-size:.88rem}
      .hj-re-a{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .hj-re-f .hj-foto{flex-direction:row;align-items:center;gap:8px;font-weight:600;color:var(--tinta)}
    </style>
    ${subnavMensagens('hoje')}
    ${uiTopo({
      titulo: 'Log de envios',
      sub: ehHoje ? 'Tudo o que o robô enviou <b>hoje</b>, em tempo quase real (a página atualiza sozinha a cada minuto).' : `Tudo o que o robô enviou no dia <b>${esc(fmtData(d))}</b>.`,
      linhas: [`<form method="GET" action="/hoje" class="ui-linha ui-datas"><span class="ui-lbl">Dia</span>
        <input type="date" name="dia" value="${esc(d)}" max="${esc(atividade.hojeSP())}" onchange="this.form.submit()" aria-label="Dia">
        ${ehHoje ? '' : '<a href="/hoje" class="ui-btn sec">Voltar para hoje</a>'}</form>`],
    })}
    <div class="stats">
      <div class="stat tot"><div class="n">${r.total}</div><div class="l">total de envios</div></div>
      <div class="stat ok"><div class="n">${r.enviados}</div><div class="l">✅ enviados</div></div>
      <div class="stat err"><div class="n">${r.falhas}</div><div class="l">⚠️ falhas</div></div>
    </div>
    <div class="ui-secoes">
    <div class="sec-t">Por tipo de envio</div>
    <div class="card">
      ${jobs || '<div class="vazio">Nenhum envio registrado ' + (ehHoje ? 'hoje' : 'neste dia') + ' ainda.</div>'}
    </div>
    <div class="sec-t">Envios ${ehHoje ? 'de hoje' : 'do dia'} (${evs.length})</div>
    <div class="card">${lista || '<div class="vazio">Sem envios para mostrar.</div>'}</div>
    </div>
    <p class="ui-rodape">Registrado automaticamente a cada envio do robô.</p>
  </div>
  <script>
  // Reenvio: pede ao robô (fila de envio do painel) e acompanha o resultado.
  var hjOcupado=false;
  function hjReenviar(b){
    var f=b.closest('.hj-re-f'), st=f.querySelector('.hj-st');
    var tel=(f.querySelector('.hj-tel').value||'').replace(/\\D/g,''), txt=f.querySelector('.hj-txt').value||'';
    if(tel.length===10||tel.length===11) tel='55'+tel;
    if(tel.length<12){ st.textContent='⚠️ Número inválido — inclua o DDD.'; return; }
    if(!txt.trim()){ st.textContent='⚠️ Mensagem vazia.'; return; }
    b.disabled=true; hjOcupado=true; st.textContent='⏳ Enviando…';
    fetch('/hoje/reenviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telefone:tel,texto:txt,contexto:f.querySelector('.hj-ctx').value,chaveFoto:(function(c){return c&&c.checked?c.value:'';})(f.querySelector('.hj-chf'))})})
      .then(function(r){return r.json();}).then(function(j){
        if(!j||!j.ok){ st.textContent='❌ '+((j&&j.erro)||'não consegui pedir o envio'); b.disabled=false; hjOcupado=false; return; }
        var n=0;(function poll(){ n++;
          fetch('/teste/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
            if(s.status==='enviado'){ st.textContent='✅ Reenviada!'; hjOcupado=false; return; }
            if(s.status==='falha'){ st.textContent='❌ '+(s.erro||'falhou'); b.disabled=false; hjOcupado=false; return; }
            if(n>45){ st.textContent='⏳ O robô ainda não enviou — confira no Log em instantes.'; hjOcupado=false; return; }
            setTimeout(poll,2000);
          }).catch(function(){ setTimeout(poll,2000); });
        })();
      }).catch(function(){ st.textContent='❌ erro de rede'; b.disabled=false; hjOcupado=false; });
  }
  // ↻ Rodar de novo: pede ao robô para rodar o job outra vez (o resultado aparece no Log).
  function hjRodarJob(b, job){
    var st=b.parentNode.querySelector('.hj-st');
    if(!confirm('Rodar este envio de novo agora?')) return;
    b.disabled=true; hjOcupado=true; st.textContent='⏳ Pedindo ao robô…'; st.style.color='';
    var fimOk=function(m){ hjOcupado=false; st.style.color='var(--ok)'; st.textContent='✅ Refeito agora'+(m?' — '+m:'')+'.'; b.style.display='none'; };
    var fimErro=function(m){ hjOcupado=false; b.disabled=false; st.style.color='var(--erro)'; st.textContent='❌ Falhou de novo: '+(m||'erro')+' — pode tentar outra vez.'; };
    fetch('/hoje/rodar-job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:job, linha:b.getAttribute('data-linha')||''})})
      .then(function(r){return r.json();}).then(function(j){
        if(!j||!j.ok||!j.id){ hjOcupado=false; st.textContent='⚠️ '+((j&&j.erro)||'não consegui pedir'); b.disabled=false; return; }
        var n=0;(function poll(){ n++;
          fetch('/hoje/rodar-job/status?id='+encodeURIComponent(j.id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
            if(s.estado==='ok') return fimOk(s.msg);
            if(s.estado==='erro') return fimErro(s.msg);
            st.textContent= s.estado==='rodando' ? '⏳ Rodando… (se o EVO estiver instável, o robô tenta de novo sozinho e pode levar alguns minutos)'
              : s.estado==='esperando' ? '⏳ '+(s.msg||'aguardando a vez')
              : '⏳ Pedido enviado — o robô começa em alguns segundos…';
            if(n>400){ hjOcupado=false; st.textContent='⏳ Ainda rodando — o resultado aparece no Log.'; return; }
            setTimeout(poll,3000);
          }).catch(function(){ setTimeout(poll,3000); });
        })();
      }).catch(function(){ st.textContent='❌ erro de rede'; b.disabled=false; hjOcupado=false; });
  }
  </script>${ehHoje ? '<script>setInterval(function(){ if(!hjOcupado && !document.querySelector(\'.hj-re[open]\')) location.reload(); },60000)</script>' : ''}`;
  return chrome({ tab: 'Log', h1: 'Log — o que o robô fez', p: ehHoje ? 'Todos os envios de <b>hoje</b>, em tempo quase real.' : `Envios do dia <b>${esc(fmtData(d))}</b>.` }, 'msg', corpo);
}

// ── Bloqueio do app por inadimplência (bloqueio-app.js) ─────────────────────
function blocoBloqueioApp() {
  let cfg, est;
  try { const ba = require('./bloqueio-app'); cfg = ba.lerConfig(); est = ba.lerEstado(); } catch (e) { return `<div class="card">Bloqueio do app indisponível: ${esc(e.message)}</div>`; }
  const dt = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const TIPO = { recorrente: 'cartão recorrente', boleto: 'boleto', saldo: 'saldo devedor' };
  const btnEx = (id, nome, rot) => `<form method="POST" action="/cobranca/bloqueio-app/excecao" style="display:inline;margin:0"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="nome" value="${esc(nome)}"><button type="submit" class="ba-btn" title="Esta aluna não é bloqueada (ex.: acordo de pagamento)">${rot || '🛡️ Não bloquear'}</button></form>`;
  const cobrancaOn = jobsAtivos.ativo('inadimplentes') && config.jobAtivo('inadimplentes');
  const MODO_TXT = { desligado: 'Desligado', teste: '🧪 Modo teste — só lista, não bloqueia', ligado: '📵 Ligado — bloqueia e reativa de verdade' };
  const u = est.ultima;
  let ultimaHtml = '<p class="quando" style="margin:0">Ainda não rodou. Roda junto com a cobrança (logo depois da leitura dos débitos no EVO).</p>';
  if (u) {
    const ST = { seria: '🧪 seria bloqueada', bloqueada: '📵 bloqueada', 'sem-acesso': '— já sem acesso ao app', erro: '⚠️ erro', fila: '⏳ fica para amanhã (limite do dia)' };
    const cand = (u.candidatas || []).map(c => `<tr><td>${esc(c.nome)}</td><td class="num">${esc(c.dias)}d</td><td>${esc(TIPO[c.tipo] || c.tipo || '')}</td><td>${esc(ST[c.status] || c.status)}${c.motivo ? `<br><small style="color:var(--cinza)">${esc(c.motivo)}</small>` : ''}</td><td>${c.status === 'seria' || c.status === 'erro' || c.status === 'fila' ? btnEx(c.id, c.nome) : ''}</td></tr>`).join('');
    const reat = [...(u.reativadas || []).map(r => `<li>✅ <b>${esc(r.nome)}</b> — ${esc(r.motivo)}${r.avisou ? ' · SoFIA avisou' : ''}</li>`), ...(u.seriamReativadas || []).map(r => `<li>🧪 <b>${esc(r.nome)}</b> seria reativada — ${esc(r.motivo)}</li>`)].join('');
    ultimaHtml = `<p class="quando" style="margin:0 0 8px">Em <b>${esc(dt(u.em))}</b> · modo <b>${esc(u.modo)}</b> · a partir de <b>${esc(u.dias)}</b> dias${u.completa ? '' : ' · <span style="color:var(--erro)">a leitura do EVO veio incompleta — quem quitou só é reativada na próxima leitura completa</span>'}</p>
      ${cand ? `<div style="overflow-x:auto"><table class="ba-tab"><thead><tr><th>Aluna</th><th>Atraso</th><th>Tipo</th><th>Situação</th><th></th></tr></thead><tbody>${cand}</tbody></table></div>` : '<p class="quando" style="margin:0">Ninguém novo com atraso para bloquear.</p>'}
      ${reat ? `<ul class="ba-lista">${reat}</ul>` : ''}
      ${(u.erros || []).length ? `<p class="quando" style="color:var(--erro);margin:6px 0 0">${u.erros.map(esc).join('<br>')}</p>` : ''}`;
  }
  const bloq = Object.values(est.bloqueadas || {});
  const bloqHtml = bloq.length ? `<div style="overflow-x:auto"><table class="ba-tab"><thead><tr><th>Aluna</th><th>Bloqueada em</th><th>Atraso</th><th></th></tr></thead><tbody>${bloq.map(b => `<tr><td>${esc(b.nome)}${b.falha ? `<br><small style="color:var(--erro)">⚠️ não reativei: ${esc(b.falha)}</small>` : ''}</td><td>${esc(dt(b.em))}</td><td class="num">${esc(b.dias)}d</td><td style="white-space:nowrap">${btnEx(b.id, b.nome, '🛡️ Reativar (exceção)')} <form method="POST" action="/cobranca/bloqueio-app/esquecer" style="display:inline;margin:0" onsubmit="return confirm('Tirar da lista do robô? Ele não vai mais reativar esta aluna sozinho — use se a recepção já resolveu à mão.')"><input type="hidden" name="id" value="${esc(b.id)}"><button type="submit" class="ba-btn">Tirar da lista</button></form></td></tr>`).join('')}</tbody></table></div>` : '<p class="quando" style="margin:0">Nenhuma aluna bloqueada pelo robô agora.</p>';
  const exc = Object.entries(cfg.excecoes || {});
  const excHtml = exc.length ? `<ul class="ba-lista">${exc.map(([id, x]) => `<li><b>${esc(x.nome || id)}</b> <small style="color:var(--cinza)">desde ${esc(dt(x.em))}${x.por ? ' · ' + esc(x.por) : ''}</small> <form method="POST" action="/cobranca/bloqueio-app/excecao" style="display:inline;margin:0"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="remover" value="1"><button type="submit" class="ba-btn">Remover</button></form></li>`).join('')}</ul>` : '<p class="quando" style="margin:0">Nenhuma. Use <b>🛡️ Não bloquear</b> na lista acima (ex.: aluna com acordo de pagamento).</p>';
  return `<style>.ba-tab{width:100%;border-collapse:collapse;font-size:.88rem}.ba-tab th,.ba-tab td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--linha);vertical-align:top}.ba-tab th{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--cinza)}.ba-tab .num{font-variant-numeric:tabular-nums;white-space:nowrap}.ba-btn{font:inherit;font-size:.8rem;padding:4px 10px;border:1px solid var(--linha);border-radius:8px;background:transparent;color:inherit;cursor:pointer}.ba-btn:hover{border-color:var(--cinza)}.ba-lista{margin:8px 0 0;padding-left:18px;font-size:.9rem;line-height:1.6}.ba-sub{font-weight:700;font-size:.85rem;margin:14px 0 6px}</style>
    <div class="sec-t" id="sec-app">Bloqueio do app <small style="font-weight:600;color:var(--cinza)">(login do app da aluna inadimplente)</small></div>
    <div class="card">
      <div class="chead" style="margin:0"><h2 style="font-size:.98rem">📵 Excluir o login do app de quem está devendo</h2></div>
      <p class="quando" style="margin:6px 0 10px">Quem está com pagamento vencido há <b>${esc(cfg.dias)} dias ou mais</b> tem o login do app excluído no EVO (Cadastro → Área do aluno → Excluir) e não consegue agendar pelo app. Quando quitar, o robô clica em <b>Criar acesso</b> e a SoFIA avisa a aluna (senha volta à padrão — mensagem abaixo). Roda junto com a cobrança, logo depois da leitura dos débitos. Só reativa quem <b>o robô</b> bloqueou.</p>
      ${cobrancaOn ? '' : '<p class="quando" style="color:var(--erro);margin:0 0 10px">⚠️ A cobrança está desligada nesta unidade — o bloqueio só roda junto com ela.</p>'}
      <form method="POST" action="/cobranca/bloqueio-app" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <select name="modo" style="padding:7px;border:1px solid var(--linha);border-radius:8px;font:inherit">${['desligado', 'teste', 'ligado'].map(m => `<option value="${m}"${cfg.modo === m ? ' selected' : ''}>${MODO_TXT[m]}</option>`).join('')}</select>
        <label style="font-weight:700">a partir de
          <input type="number" name="dias" min="3" max="90" value="${esc(cfg.dias)}" required style="width:64px;margin:0 6px;padding:6px;border:1px solid var(--linha);border-radius:8px;text-align:center">
          dias de atraso
        </label>
        <label style="display:flex;gap:6px;align-items:center;flex-basis:100%"><input type="hidden" name="temGrupo" value="1"><input type="checkbox" name="avisarGrupo" value="1"${cfg.avisarGrupo ? ' checked' : ''}> Avisar no grupo da Equipe quem foi bloqueada/reativada (só com o bloqueio ligado)</label>
        <button type="submit" class="save" style="padding:8px 16px">Salvar</button>
      </form>
      <div class="ba-sub">${u && u.modo === 'teste' ? 'Último teste — quem seria bloqueada' : 'Última execução'}</div>
      ${ultimaHtml}
      <div class="ba-sub">Bloqueadas pelo robô agora (${bloq.length})</div>
      ${bloqHtml}
      <div class="ba-sub">Exceções — nunca bloquear (${exc.length})</div>
      ${excHtml}
    </div>`;
}

// ── Página: SoFIA → Cobrança ────────────────────────────────────────────────
// As mensagens de cobrança de inadimplentes, enviadas PELO número da SoFIA.
// Reaproveita o render dos cards (texto + horário + switch) da aba Mensagens.
function paginaCobranca(aviso, erro) {
  const hmap = {};
  horarios.listar().forEach(j => { hmap[j.chave] = j; });
  const VOLTAR = '/sofia?view=cobranca';
  const cards = ['cobranca_recorrente', 'cobranca_boleto', 'cobranca_saldo', 'cobranca_boleto_hoje', 'cobranca_app_reativado']
    .map(ch => mensagens.listar().find(m => m.chave === ch))
    .filter(Boolean).map(m => cardDeMsg(m, hmap, VOLTAR)).join('\n');
  const corpo = `<div class="wrap">
    ${subnavSofia('cobranca')}
    ${uiTopo({ titulo: 'Cobrança', sub: `Mensagens enviadas <b>pelo número da SoFIA</b> para alunas com débito <b>vencido há ${inadConfig.lerDias()}+ dia(s)</b>. O robô lê os débitos no EVO, gera o link e a SoFIA envia. Use o botão no canto de cada cartão para ligar ou desligar.` })}
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${barraTeste()}
    <form id="fh" method="POST" action="/horarios/salvar" onsubmit="var b=document.getElementById('btnH');if(b){b.disabled=true;b.textContent='Salvando e reiniciando o robô…';}"><input type="hidden" name="voltar" value="${esc(VOLTAR)}"></form>
    <div class="sec-t" id="sec-regra">Regra de atraso</div>
    <div class="card">
      <div class="chead" style="margin:0"><h2 style="font-size:.98rem">⏱️ A partir de quantos dias de atraso cobrar?</h2></div>
      <p class="quando" style="margin:6px 0 10px">Só entra na cobrança quem está vencido há <b>este número de dias ou mais</b>. Ex.: <b>2</b> → cobra a partir de 2 dias de atraso; <b>4</b> → só a partir de 4.</p>
      <form method="POST" action="/cobranca/config" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-weight:700">Vencido há
          <input type="number" name="dias" min="${inadConfig.MIN}" max="${inadConfig.MAX}" value="${inadConfig.lerDias()}" required style="width:70px;margin:0 6px;padding:6px;border:1px solid var(--linha);border-radius:8px;text-align:center">
          + dia(s)
        </label>
        <button type="submit" class="save" style="padding:8px 16px">Salvar</button>
      </form>
    </div>
    ${blocoBloqueioApp()}
    <div class="sec-t" id="sec-msgs">Mensagens de cobrança <small style="font-weight:600;color:var(--cinza)">(texto, horário e dias de cada tipo)</small></div>
    ${cards || '<div class="card">Mensagens de cobrança não encontradas no catálogo.</div>'}
    <div class="hbar">
      <div class="acts"><button type="submit" form="fh" id="btnH" class="save">🕒 Salvar horário e reiniciar o robô</button></div>
      <p class="quando" style="text-align:center;margin:8px 0 0">O <b>texto</b> salva na hora. Mudança de <b>horário/dias</b> vale depois que o robô reinicia — alguns segundos.</p>
    </div>
  </div>
${scriptPreviewTeste()}`;
  return chrome({ tab: 'Cobrança', h1: 'SoFIA — Cobrança', p: 'Cobrança de inadimplentes, enviada pelo número da SoFIA.' }, 'sofia', corpo);
}

module.exports = {
  CIRC_SERV_FILE, lerCircuitoServico, horaAg, turnoLabel, barraTeste, card2FA, blocoWaRobo, subnavMensagens, cardGrupos, paginaMensagens, itemHtml, cardHorariosAgendados, blocoAgendarMsg, paginaExpress, paginaWa, HORARIOS_DA_MSG, TOGGLE_EXTRA_DA_MSG, jobsDoCard, cardDeMsg, blocoAnivExcluir, blocoSaidas, blocoVenceHoje, blocoSentimos, blocoRenovDias, OUTROS_JOBS, switchEnvio, horaTurno, FOTO_POR_CONTEXTO, JOBS_DO_LOG, jobDoLog, RODAR_JOB_ST, statusRodarJob, LOG_REFEITOS, lerRefeitos, hhmm, fotoDoEnvio, paginaHoje, paginaCobranca,
};

/**
 * painel-indicadores.js — telas de Indicadores (Indicadores, Funil, Grade, Alunas ativas, Resumos, Professoras, Saúde).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const fs = require('fs');
const path = require('path');
const waStatus = require('./wa-status');
const igcfg = require('./instagram-config');
const indicadores = require('./indicadores');
const histExp = require('./experimentais-hist');
const bookings = require('./bookings');
const autoTagAlunas = require('./auto-tag-alunas');
const origens = require('./origens');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const config = require('./config');
const ativasDados = require('./ativas-dados');
const E = require('./painel-estado');
const {
  uiChips, uiTopo, esc, uiBarra, fmtData, chrome, fmtTel, podeFunil, PAGAMENTO_ATIVO, uiDatas, UI_SIT, fuLerJson, FU_AGENDOU_CANAL_FILE, lerCompCfg, FU_AGENDOU_AULA_FILE, uiPessoa, uiTrilho, PM2_EXP, PM2_SOFIA, lerJsonData, IG_NO_PAINEL,
} = require('./painel-base');

// ── Página: Indicadores do formulário ───────────────────────────────────────
function paginaIndicadores(dias, aviso) {
  const janelas = [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [0, 'Tudo']];
  const jan = janelas.some(([d]) => d === dias) ? dias : 7;
  const r = indicadores.resumo(jan);

  const segs = uiChips('Período', janelas.map(([d, l]) => [`/indicadores?dias=${d}`, l, d === jan]));

  // Barras por dia (mais recente primeiro), escala pelo maior nº de PESSOAS.
  const maxP = Math.max(1, ...r.porDia.map(d => d.pessoas));
  const fmtDia = s => { const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  const barras = r.porDia.filter(d => d.pessoas || d.agendamentos).map(d => uiBarra({
    rot: fmtDia(d.dia), n: d.pessoas, max: maxP, texto: '',
    valor: `${d.pessoas} <small>pessoa${d.pessoas === 1 ? '' : 's'}</small> · <span style="color:var(--ok)">${d.agendamentos}</span> <small>agend.</small>`,
  })).join('');

  const maxA = Math.max(1, ...r.horariosAula.map(a => a.n));
  const aulaHtml = r.horariosAula.slice(0, 12).map(a => uiBarra({ rot: esc(a.hora), n: a.n, max: maxA, cor: 'var(--ok)', texto: '' })).join('');

  // Heatmap (gráfico único): acessos por dia da semana × hora. Cor teal cresce
  // com o nº de acessos; célula vazia fica cinza-clara. Tooltip no hover.
  const DIAS_HM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DIAS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const hmMax = Math.max(1, r.mapaMax || 0);
  const temMapa = (r.mapaCalor || []).some(row => row.some(v => v > 0));
  const celCor = (n, max) => {
    const ratio = n / max;
    const alpha = (0.16 + 0.84 * ratio).toFixed(3);
    const cor = ratio > 0.5 ? '#fff' : 'var(--teal-esc)';
    return `background:rgba(14,110,107,${alpha});color:${cor}`;
  };
  // Insight: célula de pico (dia + hora) — transforma o gráfico em ação.
  let pkWd = -1, pkH = -1, pkN = 0;
  for (let wd = 0; wd < 7; wd++) for (let h = 0; h < 24; h++) { const n = (r.mapaCalor[wd] || [])[h] || 0; if (n > pkN) { pkN = n; pkWd = wd; pkH = h; } }
  const insight = pkN > 0
    ? `<div class="hm-insight">💡 Pico de acessos: <b>${DIAS_LONG[pkWd]} às ${pkH}h</b> (${pkN} acesso${pkN === 1 ? '' : 's'}). Bom horário para postar e disparar campanhas.</div>`
    : '';
  // Grade completa (desktop): 7 × 24.
  let hmHead = '<div class="hm-corner"></div>';
  for (let h = 0; h < 24; h++) hmHead += `<div class="hm-hlbl">${h}</div>`;
  let hmRows = '';
  for (let wd = 0; wd < 7; wd++) {
    let cells = '';
    for (let h = 0; h < 24; h++) {
      const n = (r.mapaCalor[wd] || [])[h] || 0;
      if (!n) { cells += '<div class="hm-cell hm-zero"></div>'; continue; }
      cells += `<div class="hm-cell" style="${celCor(n, hmMax)}" title="${DIAS_HM[wd]} ${h}h · ${n} acesso${n === 1 ? '' : 's'}">${n}</div>`;
    }
    hmRows += `<div class="hm-daylbl">${DIAS_HM[wd]}</div>${cells}`;
  }
  // Grade compacta (mobile): 7 × 4 faixas do dia (madrugada/manhã/tarde/noite).
  const FAIXAS = [['Madrugada', 0, 6], ['Manhã', 6, 12], ['Tarde', 12, 18], ['Noite', 18, 24]];
  const mapaFaixa = r.mapaCalor.map(row => FAIXAS.map(([, ini, fim]) => { let s = 0; for (let h = ini; h < fim; h++) s += row[h] || 0; return s; }));
  const faixaMax = Math.max(1, ...mapaFaixa.map(row => Math.max(...row)));
  let cmpHead = '<div class="hm-corner"></div>' + FAIXAS.map(([rot]) => `<div class="hm-flbl">${rot}</div>`).join('');
  let cmpRows = '';
  for (let wd = 0; wd < 7; wd++) {
    let cells = '';
    for (let fi = 0; fi < 4; fi++) {
      const n = mapaFaixa[wd][fi];
      if (!n) { cells += '<div class="hm-cell hm-zero"></div>'; continue; }
      cells += `<div class="hm-cell" style="${celCor(n, faixaMax)}" title="${DIAS_HM[wd]} · ${FAIXAS[fi][0]} · ${n} acesso${n === 1 ? '' : 's'}">${n}</div>`;
    }
    cmpRows += `<div class="hm-daylbl">${DIAS_HM[wd]}</div>${cells}`;
  }
  const heatHtml = temMapa
    ? `${insight}
       <div class="hm-scroll hm-full"><div class="hm-grid">${hmHead}${hmRows}</div></div>
       <div class="hm-compact"><div class="hm-grid-cmp">${cmpHead}${cmpRows}</div></div>
       <div class="hm-leg"><span>menos</span><span class="hm-leg-bar"></span><span>mais</span><span class="hm-leg-hint">— passe o mouse numa célula para ver o dia, a hora e o total</span></div>`
    : '<div class="vazio">Sem acessos no período.</div>';

  // Gerador de links por origem: um link etiquetado por canal + botão "Copiar".
  const FORM_BASE = (process.env.FORM_CLOUD_URL || '').replace(/\/+$/, '');
  let CANAIS = []; try { CANAIS = origens.listar(); } catch (_) {}
  // Casa os contadores já registrados (r.porOrigem) com cada canal, sem diferenciar maiúsculas.
  const origMap = {};
  (r.porOrigem || []).forEach(o => { origMap[String(o.origem || '').trim().toLowerCase()] = o; });
  const usados = new Set(CANAIS.map(c => c.slug));
  const semTag = origMap['(sem etiqueta)'] || null;
  const outras = (r.porOrigem || []).filter(o => {
    const k = String(o.origem || '').trim().toLowerCase();
    return k && k !== '(sem etiqueta)' && !usados.has(k);
  });

  const cardCanal = c => {
    const o = origMap[c.slug] || { acessos: 0, agendamentos: 0 };
    const url = `${FORM_BASE}/?origem=${c.slug}`;
    const cont = (o.acessos || o.agendamentos)
      ? `<b style="color:var(--teal-esc)">${o.acessos}</b> acesso${o.acessos === 1 ? '' : 's'} · <span style="color:var(--coral-esc)">${o.agendamentos} agend.</span>`
      : `<span style="color:var(--cinza)">ainda sem acessos</span>`;
    return `<div class="card" style="display:flex;flex-direction:column;gap:9px">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${esc(c.rot)}</div>
          <div class="quando" style="margin:2px 0 0">${esc(c.desc || '')}</div>
        </div>
        <form method="POST" action="/origens/excluir" style="margin:0;flex:none" onsubmit="return confirm('Excluir o canal “${esc(c.rot)}”? (os acessos já registrados continuam no histórico)')">
          <input type="hidden" name="slug" value="${esc(c.slug)}">
          <button type="submit" class="tagbtn rm" title="Excluir canal" style="width:auto">🗑️</button>
        </form>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <code style="flex:1 1 220px;min-width:0;background:var(--bg);border:1px solid var(--linha);border-radius:8px;padding:8px 10px;font-size:var(--fs-sm);word-break:break-all">${esc(url)}</code>
        <button type="button" class="save" style="flex:none" onclick="copiarLink(this,'${esc(url)}')">📋 Copiar</button>
      </div>
      <div class="quando" style="margin:0">${cont}</div>
    </div>`;
  };

  const outrasHtml = outras.length ? `
    <div class="sec-t">Outras etiquetas registradas</div>
    <div class="card">
      ${outras.map(o => `<div class="jobrow"><div class="jn">${esc(o.origem)}</div><div class="jc">${o.acessos} acesso${o.acessos === 1 ? '' : 's'} · <span style="color:var(--coral-esc)">${o.agendamentos} agend.</span></div></div>`).join('')}
    </div>` : '';

  const semTagHtml = (semTag && (semTag.acessos || semTag.agendamentos)) ? `
    <div class="card" style="border-style:dashed">
      <p class="quando" style="margin:0">Além desses, <b>${semTag.acessos} acesso${semTag.acessos === 1 ? '' : 's'}</b> chegaram por um endereço <b>sem etiqueta</b> — entram como “Direto ou app”. Trocar os links já divulgados pelos de cima faz esses acessos passarem a aparecer por canal.</p>
    </div>` : '';

  const origemBloco = `
    <details class="acc-sec">
      <summary class="sec-t" style="cursor:pointer;padding:4px 0">Gerador de links por origem <small style="font-weight:400;color:var(--cinza)">(${CANAIS.length} cana${CANAIS.length === 1 ? 'l' : 'is'} — clique para abrir)</small></summary>
    <div class="card" style="border-style:dashed">
      <p class="quando" style="margin:0">De onde vem cada pessoa? Use um <b>link diferente em cada lugar</b> — Instagram, WhatsApp, indicação, anúncio. Quem acessar por ele já entra etiquetado e a conversão de cada canal aparece aqui embaixo. Copie o link do canal e use no lugar do link comum.</p>
    </div>
    ${CANAIS.map(cardCanal).join('')}
    <details class="card"><summary style="cursor:pointer;font-weight:700">＋ Criar canal</summary>
      <form method="POST" action="/origens/criar" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:160px"><label style="margin:0 0 4px">Nome do canal</label><input type="text" name="rot" placeholder="ex.: Facebook, Panfleto, TikTok" required></div>
        <div style="flex:2;min-width:180px"><label style="margin:0 0 4px">Descrição <small style="color:var(--cinza)">(opcional)</small></label><input type="text" name="desc" placeholder="onde você vai usar este link"></div>
        <button type="submit" class="save" style="padding:9px 16px">Criar</button>
      </form>
      <p class="quando" style="margin:8px 0 0">O link vira <code>…/?origem=&lt;nome&gt;</code> (sem acento/espaço). Os 4 canais iniciais também podem ser excluídos.</p>
    </details>
    ${semTagHtml}
    ${outrasHtml}
    </details>`;

  // Log completo dos agendamentos (dados da aluna). Mostra os mais recentes; o
  // conteúdo completo fica num <details> para não pesar a página.
  let LOG = []; try { LOG = bookings.listar(300); } catch (_) {}
  const fmtQuando = ts => { try { const d = new Date(ts); return isNaN(d) ? esc(ts || '—') : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return esc(ts || '—'); } };
  const cadCelula = b => {
    if (b.cadastroNovo) return '<span class="pill" style="border-color:var(--teal)">cadastro novo</span>';
    const a = b.atualizacao;
    let extra = '';
    if (a && a.ok === true) extra = ' <span class="pill" style="border-color:var(--teal)">✓ dados atualizados</span>';
    else if (a && a.ok === false) extra = ' <span class="pill" style="border-color:var(--coral)" title="' + esc(String(a.erro || '')) + '">⚠ não atualizado</span>';
    return '<span class="pill" style="border-color:var(--linha)">já existia</span>' + extra;
  };
  const logRows = LOG.map(b => `<tr>
      <td style="white-space:nowrap">${fmtQuando(b.ts)}</td>
      <td>${esc(b.nome || '—')}</td>
      <td style="white-space:nowrap">${esc(fmtTel ? fmtTel(b.telefone) : b.telefone)}</td>
      <td style="white-space:nowrap">${esc(b.cpf || '—')}</td>
      <td>${esc(b.email || '—')}</td>
      <td style="white-space:nowrap">${esc(b.nascimento || '—')}</td>
      <td style="white-space:nowrap">${esc(b.when || '—')}</td>
      <td>${esc(b.origem || '—')}</td>
      <td>${cadCelula(b)}</td>
    </tr>`).join('');
  const logBloco = `
    <div class="sec-t">Agendamentos pelo formulário (dados completos)</div>
    <details class="card"${LOG.length ? '' : ' open'}>
      <summary style="cursor:pointer;font-weight:700">${LOG.length ? `Ver os ${LOG.length} agendamento${LOG.length === 1 ? '' : 's'} registrado${LOG.length === 1 ? '' : 's'}` : 'Nenhum agendamento registrado ainda'}</summary>
      <p class="quando" style="margin:10px 0">Tudo o que a aluna digitou no formulário (nome, CPF, telefone, e-mail e nascimento), o horário da aula e o que o EVO fez com o cadastro. Serve para conferir os dados quando o cadastro do EVO veio incompleto (ex.: cadastro antigo). Atualiza a cada ~2 min.</p>
      ${LOG.length ? `<div style="overflow-x:auto"><table class="logtab">
        <thead><tr><th>Quando</th><th>Nome</th><th>Telefone</th><th>CPF</th><th>E-mail</th><th>Nascimento</th><th>Aula</th><th>Origem</th><th>Cadastro no EVO</th></tr></thead>
        <tbody>${logRows}</tbody></table></div>` : '<div class="vazio">Assim que alguém agendar pelo formulário, os dados aparecem aqui.</div>'}
    </details>`;

  // Quebra do funil "de onde vieram": nome amigável do canal (usa o rótulo do
  // Gerador de links quando existe; senão a própria etiqueta) e mini-pílulas com
  // a contagem por origem. `campo` = 'pessoas' (visitantes) ou 'agendamentos'.
  const rotDe = {}; CANAIS.forEach(c => { rotDe[c.slug] = c.rot; });
  const nomeOrigem = k => {
    const kl = String(k || '').trim().toLowerCase();
    if (kl === '(sem etiqueta)') return 'Direto/app';
    return rotDe[kl] || k;
  };
  const funilPorOrigem = (campo) => {
    const its = (r.porOrigem || []).filter(o => o[campo] > 0).sort((a, b) => b[campo] - a[campo]);
    if (!its.length) return '';
    const tot = its.reduce((s, o) => s + o[campo], 0) || 1;
    const rows = its.map(o => uiBarra({ fino: true, rot: `<span title="${esc(nomeOrigem(o.origem))}">${esc(nomeOrigem(o.origem))}</span>`, n: o[campo], max: tot, cor: campo === 'agendamentos' ? 'var(--ok)' : 'var(--teal)', texto: '' })).join('');
    return `<div style="padding:0 0 6px 22px">${rows}</div>`;
  };
  const funilPessoasOrig = funilPorOrigem('pessoas');
  const funilAgendOrig = funilPorOrigem('agendamentos');

  const corpo = `<div class="wrap">
    ${subnavIndicadores('formulario')}
    ${uiTopo({
      titulo: 'Formulário de agendamento',
      sub: 'Quem abriu o link de agendamento, quantas agendaram a aula experimental, quando acessam e de onde vieram.',
      linhas: [segs, aviso ? `<div class="ui-nota erro">${esc(aviso)}</div>` : ''],
    })}
    <div class="stats">
      <div class="stat tot"><div class="n">${r.pessoas}</div><div class="l">👥 pessoas</div></div>
      <div class="stat"><div class="n" style="color:var(--cinza)">${r.acessos}</div><div class="l">aberturas (acessos)</div></div>
      <div class="stat ok"><div class="n">${r.agendamentos}</div><div class="l">agendaram</div></div>
      <div class="stat"><div class="n" style="color:var(--coral-esc)">${String(r.conversao).replace('.', ',')}%</div><div class="l">conversão (por pessoa)</div></div>
    </div>
    <div class="ui-secoes">
    <div class="sec-t">Funil</div>
    <div class="card">
      ${r.pessoas ? uiBarra({ rot: 'Visitaram', n: r.pessoas, max: r.pessoas })
        + funilPessoasOrig
        + uiBarra({ rot: 'Agendaram', n: r.agendamentos, max: r.pessoas, cor: 'var(--ok)' })
        + funilAgendOrig
        + uiBarra({ rot: 'Não agendaram', n: r.naoAgendaram, max: r.pessoas, cor: 'var(--faint)' })
        + `<p class="quando" style="margin:10px 0 0">👀 <b>${r.acessos}</b> abertura${r.acessos === 1 ? '' : 's'} da página no período — a mesma pessoa pode abrir mais de uma vez. Embaixo de cada etapa: de onde vieram (link por origem).</p>`
        : '<div class="vazio">Ninguém abriu o formulário neste período.</div>'}
    </div>
    <div class="sec-t">Por dia (pessoas ▮ · agendamentos)</div>
    <div class="card">${barras || '<div class="vazio">Sem dados ainda neste período. Os números aparecem conforme as pessoas acessam o formulário.</div>'}</div>

    <div class="sec-t">Quando acessam &nbsp;·&nbsp; dia da semana × hora</div>
    <div class="card">
      <p class="quando" style="margin:0 0 12px">Cada quadradinho é um <b>dia + hora</b>. Quanto mais escuro, <b>mais acessos</b> — assim dá pra ver o pico real (ex.: <b>terça às 19h</b>), não só o melhor dia e a melhor hora separados.</p>
      ${heatHtml}
    </div>

    <div class="sec-t">Horários de aula mais escolhidos</div>
    <div class="card">
      ${aulaHtml || '<div class="vazio">Ainda sem agendamentos com horário registrado neste período — passa a contar a partir dos próximos agendamentos.</div>'}
    </div>
    ${origemBloco}
    ${logBloco}
    </div>
    <p class="ui-rodape">Coletado do formulário a cada ~2 min. ${r.primeiroDia ? `Desde ${esc(fmtData(r.primeiroDia))}.` : 'Ainda começando a coletar.'}</p>
  </div>
  <style>
  .logtab{width:100%;border-collapse:collapse;font-size:var(--fs-sm,.85rem)}
  .logtab th,.logtab td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--linha)}
  .logtab th{color:var(--cinza);font-weight:700;white-space:nowrap}
  .logtab tbody tr:hover{background:var(--bg)}
  </style>
  <script>
  function copiarLink(btn, url){
    var ok=function(){var t=btn.textContent;btn.textContent='✅ Copiado';btn.disabled=true;setTimeout(function(){btn.textContent=t;btn.disabled=false;},1500);};
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(ok).catch(function(){fallback();});
    } else { fallback(); }
    function fallback(){
      try{var ta=document.createElement('textarea');ta.value=url;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');document.body.removeChild(ta);ok();}
      catch(e){window.prompt('Copie o link:',url);}
    }
  }
  </script>`;
  return chrome({ tab: 'Formulário', h1: 'Formulário', p: 'Acessos, agendamentos e taxa de conversão do formulário de agendamento.' }, 'ind', corpo);
}
function subnavIndicadores(view) {
  const sess = E._navSess || { admin: true, telas: [] };
  const pode = k => sess.admin || (sess.telas || []).includes(k);
  let its = '';
  if (podeFunil(sess)) its += `<a href="/funil"${view === 'funil' ? ' class="on"' : ''}>Funil</a>`;
  if (pode('ind')) its += `<a href="/indicadores"${view === 'formulario' ? ' class="on"' : ''}>Formulário</a>`;
  if (pode('professoras')) its += `<a href="/professoras"${view === 'professoras' ? ' class="on"' : ''}>Professoras</a>`;
  if (pode('ativas')) its += `<a href="/ativas"${view === 'ativas' ? ' class="on"' : ''}>Alunas ativas</a>`;
  if (pode('grade')) its += `<a href="/grade"${view === 'grade' ? ' class="on"' : ''}>Grade</a>`;
  if (PAGAMENTO_ATIVO && pode('pagamento')) its += `<a href="/pagamento"${view === 'pagamento' ? ' class="on"' : ''}>💰 Pagamento</a>`;
  return IND_CSS + (its ? `<div class="subtabs">${its}</div>` : '');
}

// ── Indicadores: peças de layout comuns às 4 subabas ─────────────────────────
// Todas seguem a mesma ordem: subabas → cartão de topo (título, ações, período,
// filtros) → números (.stats) → seções recolhíveis (.sec-t) → nota de rodapé.
const IND_CSS = '';
function _gradeSnapshot(off) {
  off = parseInt(off, 10) || 0;
  const base = (off === 0) ? 'grade-fixas.json' : `grade-fixas.s${off}.json`;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', base), 'utf8')); }
  catch (_) { return null; }
}
function paginaGrade(off) {
  off = Math.max(-2, Math.min(2, parseInt(off, 10) || 0));
  const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // nome normalizado (sem acento, minúsculo) para a busca de aluna
  const nrmFx = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // R$ com separador de milhar (sem depender de toLocaleString/ICU no servidor)
  const fmtBRL = (v) => (v == null) ? '—' : ('R$ ' + String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
  const snap = _gradeSnapshot(off);
  const g = E._gradeGerando;
  // navegação de semanas: ‹ ‹ -2 … 0 … +2 › ›. Rótulo = período da semana vista.
  const semLabel = (off === 0) ? 'Esta semana' : (off === -1 ? 'Semana passada' : off === 1 ? 'Próxima semana' : (off < 0 ? `${-off} semanas atrás` : `Em ${off} semanas`));
  const navSem = (() => {
    const btn = (o, txt, tit) => (o < -2 || o > 2)
      ? `<span class="gr-wk-b off">${txt}</span>`
      : `<a class="gr-wk-b" href="/grade?semana=${o}" title="${tit}">${txt}</a>`;
    const per = snap ? `${(snap.inicio || '').split('-').reverse().slice(0, 2).join('/')}–${(snap.fim || '').split('-').reverse().slice(0, 2).join('/')}` : '';
    return `<div class="gr-wk">${btn(off - 1, '‹', 'semana anterior')}<span class="gr-wk-lbl">${semLabel}${per ? ` · ${per}` : ''}</span>${btn(off + 1, '›', 'próxima semana')}</div>`;
  })();
  const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const fmtDia = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : (d || ''); };
  const tierOf = (t) => {
    const cap = t.capacity, nf = t.nFixas, vagas = t.vagas;
    if (cap == null) return { k: 'nd', txt: nf + ' fixas', tip: nf + ' matrículas fixas' };
    const base = `Vaga de matrícula fixa: ${nf} de ${cap} ocupadas`;
    if (nf >= cap || vagas === 0) return { k: 'cheia', txt: 'lotada', tip: `${base}. Lotada — sem vaga para nova aluna fixa.` };
    if (vagas <= 2) return { k: 'quase', txt: vagas + (vagas === 1 ? ' vaga' : ' vagas'), tip: `${base}. ${vagas} ${vagas === 1 ? 'vaga livre' : 'vagas livres'} para nova matrícula fixa (quase cheia).` };
    return { k: 'livre', txt: vagas + ' vagas', tip: `${base}. ${vagas} vagas livres para nova matrícula fixa.` };
  };
  const icPres = { foi: '✓', faltou: '✗', justif: '⚠', trancada: '🔒' };
  const titPres = { foi: 'foi à aula', faltou: 'faltou (sem justificar)', justif: 'falta justificada', trancada: 'trancada/suspensa' };
  // todos os nomes da turma (fixa + reposição + FREE), normalizados → busca
  const fxData = (t) => escH([].concat((t.fixas || []).map(x => (x && x.nome != null) ? x.nome : x),
    t.reposicao || [], t.free || []).map(nrmFx).join('|'));
  const conteudo = (t) => {
    const cap = t.capacity, nf = t.nFixas;
    const nReal = (t.nReal != null) ? t.nReal : nf;
    const nRepo = t.nRepo || 0, nFree = t.nFree || 0;
    const occF = Math.max(0, nReal - nRepo - nFree);     // fixas que de fato ocuparam
    const pctF = (cap && cap > 0) ? Math.min(100, Math.round(occF / cap * 100)) : 0;
    const pctR = (cap && cap > 0) ? Math.max(0, Math.min(100 - pctF, Math.round((nRepo + nFree) / cap * 100))) : 0;
    const titBar = `Ocupação real da aula (de ${cap}): verde = ${occF} fixa(s) presente(s); listrado azul = ${nRepo + nFree} reposição/FREE. Total na aula: ${nReal}.`;
    const bar = (cap != null)
      ? `<div class="gr-bar" title="${escH(titBar)}"><span class="fx" style="width:${pctF}%"></span><span class="rp" style="width:${pctR}%"></span></div>`
      : '';
    const prof = t.professora ? `<div class="gr-prof" title="Professora da turma">${escH(t.professora)}</div>` : '';
    const extraNum = ` · <span class="gr-real">${nReal} presença</span>`;
    const titDet = `Fixas = ${nf} matrícula(s) fixa(s) da turma (vaga de matrícula). Presença = ${nReal} na aula = quem de fato ocupou a vaga (fixas presentes + reposição + FREE). Clique para ver os nomes.`;
    const liFix = (t.fixas || []).map(x => {
      const nome = (x && x.nome != null) ? x.nome : x, p = x && x.pres;
      const ic = p ? `<span class="pres pres-${p}" title="${titPres[p] || ''}">${icPres[p] || ''}</span>` : '';
      const tk = (x && x.ticket != null) ? `<span class="gr-tk" title="${escH(x.plano || '')}">${fmtBRL(x.ticket)}/mês</span>` : '';
      return `<li>${ic}${escH(nome)}${tk}</li>`;
    }).join('');
    const cab = (t.aconteceu && t.presentes != null)
      ? ` · <span class="pres-foi">${t.presentes} ${t.presentes === 1 ? 'foi' : 'foram'}</span>${t.faltas ? ` · <span class="pres-faltou">${t.faltas} ${t.faltas === 1 ? 'faltou' : 'faltaram'}</span>` : ''}`
      : '';
    const grpFix = `<div class="gr-grp"><div class="gr-grp-t">Fixas (${nf})${cab}</div><ul>${liFix || '<li class="gr-vazio2">sem fixas</li>'}</ul></div>`;
    const grpRepo = (t.reposicao || []).length ? `<div class="gr-grp"><div class="gr-grp-t gr-grp-repo">↻ Reposição (${t.reposicao.length})</div><ul>${t.reposicao.map(n => `<li>${escH(n)}</li>`).join('')}</ul></div>` : '';
    const grpFree = (t.free || []).length ? `<div class="gr-grp"><div class="gr-grp-t gr-grp-free">◇ FREE (${t.free.length})</div><ul>${t.free.map(n => `<li>${escH(n)}</li>`).join('')}</ul></div>` : '';
    const det = `<details class="gr-det"><summary title="${escH(titDet)}">👥 ${nf} fixas${extraNum}</summary>${grpFix}${grpRepo}${grpFree}</details>`;
    return { bar, prof, det };
  };

  let corpo;
  if (!snap || !Array.isArray(snap.turmas) || !snap.turmas.length) {
    corpo = `<div class="gr-wk-center">${navSem}</div><div class="card" style="text-align:center;padding:34px 20px">
      <div style="font-size:1.6rem;margin-bottom:6px">📋</div>
      <p style="margin:0 0 4px;font-weight:600">${off === 0 ? 'Nenhuma grade gerada ainda.' : 'Esta semana ainda não foi gerada.'}</p>
      <p class="quando" style="margin:0">${off === 0
        ? 'Clique em <b>💰 Atualizar tudo</b> para montar a grade e calcular o TKM/faturamento a partir do EVO.<br>Na primeira vez demora alguns minutos (lê a matrícula e o contrato de cada aluna).'
        : 'Clique em <b>🔄 Atualizar grade</b> para gerar esta semana (reaproveita o TKM/faturamento — rápido).'}</p>
    </div>`;
  } else {
    const turmas = snap.turmas, r = snap.resumo || {};
    // KPIs
    const alunasFixas = (r.alunas_fixas != null) ? r.alunas_fixas : null;
    const ocupPct = (r.ocupacao_pct != null) ? r.ocupacao_pct : null;
    const presPct = (r.presenca_pct != null) ? r.presenca_pct : null;
    const tkmMed = (r.tkm_medio != null) ? r.tkm_medio : null;
    const fatMes = (r.fatura_mes != null) ? r.fatura_mes : null;
    const semCont = Array.isArray(r.sem_contrato) ? r.sem_contrato : [];
    const fatIt = Array.isArray(r.fatura_itens) ? r.fatura_itens : [];
    // Total de alunas ATIVAS: do EVO (status=1) quando o financeiro rodou — mesma
    // fonte das fixas, evita o >100%. Senão, cai pra contagem da tag "0. Aluna" no CRM.
    let totalAlunas = (r.ativas != null) ? r.ativas : null;
    if (totalAlunas == null) {
      try {
        const tagAl = (autoTagAlunas.ler().tagAluna || '0. Aluna');
        const nrm = (s) => String(s || '').trim().toLowerCase();
        const found = contatos.tagsDistintas().find(x => nrm(x.tag) === nrm(tagAl));
        if (found) totalAlunas = found.n;
      } catch (_) {}
    }
    const pctAlunasFixas = (totalAlunas && alunasFixas != null) ? Math.min(100, Math.round(alunasFixas / totalAlunas * 100)) : null;
    const porProf = Array.isArray(snap.por_professora) ? snap.por_professora : [];
    const profTier = (pc) => (pc == null ? 'nd' : (pc >= 90 ? 'cheia' : (pc >= 70 ? 'quase' : 'livre')));
    // DESKTOP — grade semanal (colunas = dias; linhas = horários)
    const diaPorWd = {};
    for (const t of turmas) if (!(t.weekday in diaPorWd)) diaPorWd[t.weekday] = t.data;
    const wds = [0, 1, 2, 3, 4, 5, 6].filter(w => w in diaPorWd);
    const horas = [...new Set(turmas.map(t => t.hora))].sort();
    const cel = {};
    for (const t of turmas) cel[t.hora + '|' + t.weekday] = t;
    const th = wds.map(w => `<th>${WD[w]}<span class="gr-th-d">${fmtDia(diaPorWd[w])}</span></th>`).join('');
    const linhas = horas.map(h => {
      const tds = wds.map(w => {
        const t = cel[h + '|' + w];
        if (!t) return '<td class="gr-empty"></td>';
        const ti = tierOf(t), c = conteudo(t);
        return `<td class="gr-cel t-${ti.k}" data-fx="${fxData(t)}" data-prof="${nrmFx(t.professora || '')}"><span class="gr-vg" title="${escH(ti.tip || '')}">${ti.txt}</span>${c.bar}${c.prof}${c.det}</td>`;
      }).join('');
      return `<tr><th class="h">${escH(h)}</th>${tds}</tr>`;
    }).join('');
    const desk = `<div class="gr-desk gr-wrap"><table class="gr"><thead><tr><th class="h">Horário</th>${th}</tr></thead><tbody>${linhas}</tbody></table></div>`;
    // MOBILE — lista por dia (as turmas já vêm ordenadas por data/hora)
    const byDay = []; const idxD = {};
    for (const t of turmas) { if (!(t.data in idxD)) { idxD[t.data] = []; byDay.push([t.data, t.weekday, idxD[t.data]]); } idxD[t.data].push(t); }
    const mob = `<div class="gr-mob">` + byDay.map(([data, wd, arr]) => {
      const items = arr.map(t => {
        const ti = tierOf(t), c = conteudo(t);
        return `<div class="gr-item t-${ti.k}" data-fx="${fxData(t)}" data-prof="${nrmFx(t.professora || '')}"><div class="gr-item-h"><span class="gr-hora">${escH(t.hora)}</span><span class="gr-vg" title="${escH(ti.tip || '')}">${ti.txt}</span></div>${c.prof}${c.bar}${c.det}</div>`;
      }).join('');
      return `<div class="gr-day"><div class="gr-day-h">${WD[wd]} · ${fmtDia(data)}</div>${items}</div>`;
    }).join('') + `</div>`;

    const profRows = porProf.length ? porProf.map(p => {
      const tier = profTier(p.pct);
      const presPc = (p.pres_pct != null) ? p.pres_pct : null;
      const linhaFix = `<div class="gr-prof-ln">
        <span class="gr-prof-cap">Fixas</span>
        <div class="gr-prof-bar"><span class="t-${tier}" style="width:${p.pct != null ? Math.min(100, p.pct) : 0}%"></span></div>
        <span class="gr-prof-pc t-${tier}">${p.pct != null ? p.pct + '%' : '—'}</span>
      </div>`;
      const linhaPres = `<div class="gr-prof-ln">
        <span class="gr-prof-cap">Presença</span>
        <div class="gr-prof-bar"><span class="prez" style="width:${presPc != null ? Math.min(100, presPc) : 0}%"></span></div>
        <span class="gr-prof-pc prez">${presPc != null ? presPc + '%' : '—'}</span>
      </div>`;
      return `<div class="gr-prof-row" data-prof="${nrmFx(p.professora || '')}">
        <div class="gr-prof-nm">${escH(p.professora)}<span class="gr-prof-sub">${p.turmas} turma${p.turmas === 1 ? '' : 's'} · ${p.fixas}/${p.vagas} vagas fixas${p.pres_turmas ? ` · ${p.pres_turmas} realizada${p.pres_turmas === 1 ? '' : 's'}` : ''}</span></div>
        <div class="gr-prof-bars">${linhaFix}${linhaPres}</div>
      </div>`;
    }).join('') : '<p class="quando" style="margin:0">Clique em <b>🔄 Atualizar</b> para gerar a ocupação por professora.</p>';

    // Modal do FATURAMENTO (lançamentos do mês) e do TKM (ativas sem contrato)
    const sitLbl = (s) => { s = String(s || '').toLowerCase();
      if (s === 'pago' || s.indexOf('receiv') >= 0) return 'pago';
      if (s === 'vencido' || s.indexOf('expir') >= 0 || s.indexOf('over') >= 0) return 'vencido';
      if (s === 'a receber' || s.indexOf('open') >= 0 || s.indexOf('pend') >= 0 || s.indexOf('provision') >= 0) return 'a receber';
      return s || '—'; };
    const fatRows = fatIt.map(it => `<tr><td data-s="${nrmFx(it.aluna)}">${escH(it.aluna)}</td><td data-s="${nrmFx(it.contrato || '')}">${escH(it.contrato || '—')}</td><td data-s="${escH(it.venc || '')}">${fmtDia(it.venc)}</td><td class="v" data-s="${Number(it.valor) || 0}">${fmtBRL(it.valor)}</td><td class="v" data-s="${it.pago != null ? Number(it.pago) : -1}">${it.pago != null ? fmtBRL(it.pago) : '—'}</td><td data-s="${escH(sitLbl(it.sit))}"><span class="gr-sit">${escH(sitLbl(it.sit))}</span></td></tr>`).join('');
    const fatTotPago = fatIt.reduce((a, it) => a + (Number(it.pago) || 0), 0);
    const mFat = (fatMes == null) ? '' : `<div class="gr-ov" id="ov-fat" onclick="if(event.target===this)fecharM('fat')"><div class="gr-md">
      <div class="gr-md-h"><b>Faturamento do mês</b><span>${r.fatura_n || 0} lançamentos</span><button type="button" onclick="fecharM('fat')" aria-label="Fechar">✕</button></div>
      <div class="gr-md-b"><table class="gr-md-t gr-md-sort"><thead><tr><th data-type="t">Aluna</th><th data-type="t">Contrato</th><th data-type="d">Vence</th><th class="v" data-type="n">Cobrado</th><th class="v" data-type="n">Pago</th><th data-type="t">Situação</th></tr></thead><tbody>${fatRows || '<tr><td colspan="6" class="gr-md-vz">sem lançamentos no mês</td></tr>'}<tr class="gr-md-tot"><td colspan="3">Total do mês</td><td class="v">${fmtBRL(fatMes)}</td><td class="v">${fmtBRL(fatTotPago)}</td><td></td></tr></tbody></table></div>
      <div class="gr-md-foot"><span>Cobrado no mês</span><span>${fmtBRL(fatMes)} · pago ${fmtBRL(fatTotPago)}</span></div></div></div>`;
    const scRows = semCont.map(x => `<tr><td>${escH(x.nome)}${x.trancada ? ' <span class="gr-trc">🔒 trancada</span>' : ''}</td><td>${escH(x.plano || '—')}</td></tr>`).join('');
    const mTkm = (tkmMed == null) ? '' : `<div class="gr-ov" id="ov-tkm" onclick="if(event.target===this)fecharM('tkm')"><div class="gr-md" style="max-width:520px">
      <div class="gr-md-h"><b>Ativas sem valor de contrato</b><span>${semCont.length} de ${r.ativas || 0}</span><button type="button" onclick="fecharM('tkm')" aria-label="Fechar">✕</button></div>
      <div class="gr-md-b"><table class="gr-md-t"><thead><tr><th>Aluna</th><th>Plano</th></tr></thead><tbody>${scRows || '<tr><td colspan="2" class="gr-md-vz">Todas as ativas têm valor de contrato 🎉</td></tr>'}</tbody></table></div>
      <p class="gr-md-nota">Ficam fora da média do TKM — <b>trancada</b> (plano congelado) ou contrato sem venda casável no EVO. <b>VIP/cortesia</b> (R$ 0) já são excluídas da base de alunas.</p></div></div>`;

    corpo = `<div class="stats">
      <div class="stat tot" title="Total de turmas na semana (Seg a Sáb)."><div class="n">${r.turmas != null ? r.turmas : turmas.length}</div><div class="l">turmas</div></div>
      <div class="stat" title="Alunas com matrícula FIXA (recorrente) em alguma turma da semana, e o quanto representam das alunas ativas do EVO."><div class="n">${alunasFixas != null ? alunasFixas : '—'}</div><div class="l">alunas fixas</div><div class="gr-sub">${alunasFixas == null ? 'atualize a grade' : (pctAlunasFixas != null ? `${pctAlunasFixas}% de ${totalAlunas} alunas` : (r.fixas != null ? `${r.fixas} matrículas fixas` : ''))}</div></div>
      <div class="stat ok" title="Ocupação por matrículas fixas = fixas ÷ vagas (sem sábado/escala). Mede quanto da agenda já está vendida."><div class="n">${ocupPct != null ? ocupPct + '%' : '—'}</div><div class="l">taxa de ocupação FIXAS</div><div class="gr-sub">${ocupPct == null ? 'atualize a grade' : (r.ocupacao_vagas ? `${r.ocupacao_fixas}/${r.ocupacao_vagas} vagas · sem sáb` : '')}</div></div>
      <div class="stat prez" title="Presença real média = quem de fato ocupou a aula (fixas presentes + reposição + FREE) ÷ vagas, só nas aulas já realizadas da semana. Sem sábado (escala)."><div class="n">${presPct != null ? presPct + '%' : '—'}</div><div class="l">presença na turma</div><div class="gr-sub">${presPct == null ? 'aulas já realizadas' : (r.presenca_vagas ? `${r.presenca_real}/${r.presenca_vagas} vagas · realizadas` : '')}</div></div>
      ${tkmMed != null ? `<div class="stat tkm gr-click" onclick="abrirM('tkm')" title="Ticket médio mensal = média do valor mensalizado do contrato vigente de cada aluna ativa (valor do contrato ÷ meses de duração). Inclui trancadas; exclui VIP/cortesia. Clique para ver quem está sem valor de contrato."><div class="n">${fmtBRL(tkmMed)}</div><div class="l">TKM médio</div><div class="gr-sub">contrato mensalizado · ${r.tkm_alunas || 0}${r.ativas ? ` de ${r.ativas}` : ''} ativas${r.trancadas ? ` · ${r.trancadas} trancada${r.trancadas === 1 ? '' : 's'}` : ''}${semCont.length ? ` <span class="gr-md-hint">▸ ${semCont.length} sem contrato</span>` : ''}</div></div>` : ''}
      ${fatMes != null ? `<div class="stat fat gr-click" onclick="abrirM('fat')" title="Soma dos recebíveis a vencer no mês (todas as alunas). Clique para ver linha a linha: aluna, contrato, cobrado, pago (só o que já caiu) e situação."><div class="n">${fmtBRL(fatMes)}</div><div class="l">faturamento do mês</div><div class="gr-sub">a vencer no mês${r.fatura_n ? ` · ${r.fatura_n} lançamentos` : ''} <span class="gr-md-hint">▸ ver lista</span></div></div>` : ''}
    </div>
    <div class="sec-t" data-nosec>Ocupação &amp; presença por professora</div>
    <p class="quando" style="margin:0 0 6px">
      <b>Fixas</b> = matrículas fixas ÷ vagas (quanto da agenda dela está vendida). <b>Presença</b> = quem de fato ocupou a aula (fixas presentes + reposição + FREE) ÷ vagas, só nas aulas já realizadas. Sem sábado (escala).</p>
    <div class="card" style="padding:10px 15px">${profRows}</div>
    <p class="quando" style="display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;margin:4px 0 8px">
      <span>Período <b>${fmtDia(snap.inicio)}–${fmtDia(snap.fim)}</b></span>
      <span class="gr-fresh">🕒 grade gerada <b>${escH(snap.gerado_em || '')}</b></span>
      <span class="gr-fresh gr-fresh-fin">${snap.financeiro_em ? `💰 TKM/faturamento de <b>${escH(snap.financeiro_em)}</b>` : '💰 TKM/faturamento: clique “Atualizar tudo”'}</span>
      <span class="gr-leg"><i><b class="lg-livre"></b>vaga matríc.</i><i><b class="lg-quase"></b>quase (1-2)</i><i><b class="lg-cheia"></b>lotada</i><i><b class="lg-repo"></b>repô/FREE</i></span>
    </p>
    <div class="gr-search">
      ${(() => {
        const nomes = [...new Set(turmas.map(t => t.professora).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
        if (!nomes.length) return '';
        const ops = ['<option value="">👩‍🏫 Todas as professoras</option>']
          .concat(nomes.map(p => `<option value="${escH(nrmFx(p))}">${escH(p)}</option>`)).join('');
        return `<select id="grProf" class="gr-sel" title="Filtrar a grade e o card por professora">${ops}</select>`;
      })()}
      <input id="grBusca" type="search" placeholder="🔍 Buscar aluna — ver em quais turmas ela está (fixa, repô ou FREE)" autocomplete="off">
      <span id="grBuscaInfo" class="gr-busca-info"></span>
    </div>
    <div class="gr-wk-center">${navSem}</div>
    ${desk}${mob}${mFat}${mTkm}`;
  }

  const corpoWrap = `<div class="wrap">
    ${subnavIndicadores('grade')}
    <style>
    .gr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin:4px 0 2px}
    .gr-btns{display:flex;gap:8px;flex-wrap:wrap}
    #btnAt{white-space:nowrap}
    .gr-btns-wrap{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
    .gr-wk{display:flex;align-items:center;gap:5px}
    .gr-wk-b{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--linha);border-radius:8px;color:var(--teal);font-weight:800;text-decoration:none;font-size:1.15rem;line-height:1;background:var(--card)}
    .gr-wk-b:hover{background:var(--teal-soft);border-color:var(--teal)}
    .gr-wk-b.off{opacity:.35;pointer-events:none;color:var(--faint)}
    .gr-wk-lbl{font-size:var(--fs-xs);font-weight:700;color:var(--cinza);min-width:140px;text-align:center;font-variant-numeric:tabular-nums}
    .gr-wk-center{display:flex;justify-content:center;margin:10px 0 6px}
    .gr-fresh{display:inline-flex;align-items:center;gap:5px;color:var(--teal-esc);background:var(--teal-soft);border:1px solid var(--teal);border-radius:999px;padding:3px 11px;font-size:var(--fs-xs);font-weight:600;white-space:nowrap}
    .gr-fresh b{font-weight:800;font-variant-numeric:tabular-nums}
    .gr-fresh-fin{color:#9a6b00;background:#fdf5e6;border-color:#e9d8ac}
    .gr-leg{display:inline-flex;gap:12px;align-items:center;flex-wrap:wrap}
    .gr-leg i{display:inline-flex;align-items:center;gap:5px;font-style:normal;color:var(--cinza);font-weight:600;font-size:var(--fs-xs)}
    .gr-leg b{width:10px;height:10px;border-radius:3px;display:inline-block}
    .lg-livre{background:var(--ok)}.lg-quase{background:var(--warn)}.lg-cheia{background:var(--erro)}
    .lg-repo{background:#5b7cc2;opacity:.75;background-image:repeating-linear-gradient(45deg,transparent,transparent 2px,rgba(255,255,255,.6) 2px,rgba(255,255,255,.6) 4px)}
    .gr-vg{display:inline-block;font-size:var(--fs-xs);font-weight:800;border-radius:999px;padding:3px 10px;border:1px solid transparent;white-space:nowrap}
    .t-livre .gr-vg{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-bd)}
    .t-quase .gr-vg{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bd)}
    .t-cheia .gr-vg{background:var(--erro-bg);color:var(--erro);border-color:var(--erro-bd)}
    .t-nd .gr-vg{background:var(--linha-soft);color:var(--cinza)}
    .gr-bar{height:6px;border-radius:3px;background:var(--linha-soft);margin:7px 0 6px;overflow:hidden;display:flex}
    .gr-bar span{display:block;height:100%}
    .t-livre .gr-bar .fx{background:var(--ok)}.t-quase .gr-bar .fx{background:var(--warn)}.t-cheia .gr-bar .fx{background:var(--erro)}.t-nd .gr-bar .fx{background:var(--faint)}
    .gr-bar .rp{background:#5b7cc2;opacity:.62;background-image:repeating-linear-gradient(45deg,transparent,transparent 2px,rgba(255,255,255,.5) 2px,rgba(255,255,255,.5) 4px)}
    .gr-real{color:#3f5e9e;font-weight:800}
    /* grupos no "expandir": fixas (com presença ✓/✗/⚠), reposição, FREE */
    .gr-grp{margin-top:7px}.gr-grp:first-child{margin-top:3px}
    .gr-grp-t{font-size:var(--fs-xs);font-weight:800;color:var(--tinta);margin-bottom:1px}
    .gr-grp-repo{color:#3f5e9e}.gr-grp-free{color:var(--warn)}
    .gr-grp ul{margin:1px 0 0;padding-left:16px}
    .gr-grp li{font-size:var(--fs-xs);color:var(--tinta);line-height:1.5}
    .pres{display:inline-block;width:1.15em;font-weight:800;margin-left:-2px}
    .pres-foi{color:var(--ok)}.pres-faltou{color:var(--erro)}.pres-justif{color:var(--warn)}.pres-trancada{color:var(--cinza);font-size:.82em}
    .gr-vazio2{color:var(--faint);list-style:none;margin-left:-16px}
    .gr-th-d{display:block;font-size:.64rem;font-weight:600;opacity:.82;letter-spacing:0;text-transform:none;margin-top:1px}
    .gr-prof{font-size:var(--fs-xs);color:var(--cinza);margin-bottom:3px}
    .gr-det summary{cursor:pointer;font-size:var(--fs-xs);font-weight:700;color:var(--tinta);list-style:none;user-select:none}
    .gr-det summary::-webkit-details-marker{display:none}
    .gr-det summary:hover{color:var(--teal)}
    .gr-det ul{margin:5px 0 0;padding-left:16px}
    .gr-det li{font-size:var(--fs-xs);color:var(--tinta);line-height:1.45}
    .gr-semf{font-size:var(--fs-xs);color:var(--faint)}
    /* nesta página a grade precisa de mais largura (Seg→Sáb) do que o padrão 900px */
    .wrap{max-width:1080px}
    /* desktop: grade semanal (colunas = dia da semana; a estrutura fixa vale toda semana) */
    .gr-wrap{overflow:auto;border:1px solid var(--linha);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(16,24,40,.04);max-height:78vh}
    table.gr{border-collapse:separate;border-spacing:0;width:100%}
    table.gr th,table.gr td{border-bottom:1px solid var(--linha-soft);border-right:1px solid var(--linha-soft)}
    table.gr thead th{background:var(--teal);color:#fff;font-size:var(--fs-xs);font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:9px 8px;position:sticky;top:0;z-index:3;text-align:center}
    table.gr th.h{background:var(--teal-soft);color:var(--teal-esc);font-weight:700;white-space:nowrap;text-align:center;font-size:var(--fs-sm);position:sticky;left:0;z-index:2;padding:8px 10px;font-variant-numeric:tabular-nums}
    table.gr thead th.h{z-index:4}
    .gr-cel{min-width:132px;vertical-align:top;padding:8px 10px;background:var(--card)}
    .gr-cel.t-quase{background:#fdfaf2}.gr-cel.t-cheia{background:#fcf2f1}
    td.gr-empty{background:#fafafa}
    /* mobile: lista por dia */
    .gr-mob{display:none}
    .gr-day{margin:16px 0 8px}
    .gr-day-h{font-weight:700;font-size:var(--fs-sm);color:var(--teal-esc);background:var(--teal-soft);border-radius:999px;padding:5px 14px;display:inline-block;font-variant-numeric:tabular-nums}
    .gr-item{background:var(--card);border:1px solid var(--linha);border-left-width:4px;border-radius:12px;padding:11px 13px;margin:8px 0;box-shadow:0 1px 2px rgba(16,24,40,.04)}
    .gr-item.t-livre{border-left-color:var(--ok)}.gr-item.t-quase{border-left-color:var(--warn)}.gr-item.t-cheia{border-left-color:var(--erro)}.gr-item.t-nd{border-left-color:var(--linha)}
    .gr-item-h{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .gr-hora{font-weight:800;font-size:1.04rem;color:var(--tinta);font-variant-numeric:tabular-nums}
    /* busca de aluna */
    .gr-search{display:flex;align-items:center;gap:10px;margin:6px 0 10px;flex-wrap:wrap}
    .gr-search input{flex:1 1 300px;max-width:480px;border:1px solid #dcdcdc;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff}
    .gr-search input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(14,110,107,.16)}
    .gr-sel{border:1px solid #dcdcdc;border-radius:10px;padding:10px 12px;font-size:var(--fs-body);font-family:inherit;background:#fff;color:var(--tinta);max-width:280px;cursor:pointer}
    .gr-sel:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(14,110,107,.16)}
    /* filtro por professora: esconde linhas/células/itens que não são dela */
    .gr-prof-hide{display:none !important}
    td.gr-cel.gr-off{background:#fafafa}
    td.gr-cel.gr-off>*{visibility:hidden}
    .gr-busca-info{font-size:var(--fs-xs);color:var(--cinza);font-weight:700;white-space:nowrap}
    .gr-dim{opacity:.24;transition:opacity .12s}
    .gr-cel.gr-hit{box-shadow:inset 0 0 0 2px var(--teal)}
    .gr-item.gr-hit{outline:2px solid var(--teal);outline-offset:-2px}
    .gr-liht{background:var(--ok-bg);border-radius:4px;padding:0 3px;font-weight:800}
    /* KPI: subtexto abaixo do número */
    .gr-sub{font-size:.66rem;color:var(--cinza);margin-top:4px;font-weight:600;line-height:1.3}
    /* ocupação & presença por professora */
    .gr-prof-row{display:flex;align-items:center;gap:14px;padding:9px 0;border-top:1px solid var(--linha-soft)}
    .gr-prof-row:first-child{border-top:0}
    .gr-prof-nm{flex:1 1 38%;min-width:0;font-weight:700;font-size:var(--fs-sm);color:var(--tinta);display:flex;flex-direction:column}
    .gr-prof-sub{font-weight:500;font-size:var(--fs-xs);color:var(--cinza);margin-top:1px}
    .gr-prof-bars{flex:1 1 56%;display:flex;flex-direction:column;gap:5px;min-width:160px}
    .gr-prof-ln{display:flex;align-items:center;gap:8px}
    .gr-prof-cap{flex:none;width:58px;font-size:var(--fs-xs);font-weight:700;color:var(--cinza);text-transform:uppercase;letter-spacing:.02em}
    .gr-prof-bar{flex:1 1 auto;height:8px;border-radius:5px;background:var(--linha-soft);overflow:hidden;min-width:56px}
    .gr-prof-bar span{display:block;height:100%;border-radius:5px;background:var(--teal)}
    .gr-prof-bar span.t-livre{background:var(--ok)}.gr-prof-bar span.t-quase{background:var(--warn)}.gr-prof-bar span.t-cheia{background:var(--erro)}
    .gr-prof-bar span.prez{background:#5b7cc2}
    .gr-prof-pc{flex:none;width:44px;text-align:right;font-weight:800;font-size:var(--fs-sm);font-variant-numeric:tabular-nums;color:var(--tinta)}
    .gr-prof-pc.t-livre{color:var(--ok)}.gr-prof-pc.t-quase{color:var(--warn)}.gr-prof-pc.t-cheia{color:var(--erro)}
    .gr-prof-pc.prez{color:#3f5e9e}
    /* KPI presença na turma + financeiro (TKM / faturamento) */
    .stat.prez .n{color:#3f5e9e}
    .stat.tkm .n{color:var(--teal)}
    .stat.fat .n{color:#9a6b00}
    .stat[title]:not(.gr-click){cursor:help}
    /* valor mensal por aluna no expandir */
    .gr-tk{margin-left:7px;font-size:.66rem;font-weight:700;color:var(--teal);font-variant-numeric:tabular-nums}
    /* KPIs clicáveis + modais (faturamento / sem contrato) */
    .gr-click{cursor:pointer;transition:border-color .12s,box-shadow .12s}
    .gr-click:hover{border-color:var(--teal);box-shadow:0 2px 10px rgba(14,110,107,.14)}
    .gr-md-hint{display:inline-block;color:var(--teal);font-weight:800;white-space:nowrap}
    .gr-ov{display:none;position:fixed;inset:0;background:rgba(16,24,40,.5);z-index:120;align-items:flex-start;justify-content:center;padding:36px 14px;overflow:auto}
    .gr-ov.open{display:flex}
    .gr-md{background:var(--card);border:1px solid var(--linha);border-radius:16px;width:100%;max-width:740px;box-shadow:0 18px 50px rgba(16,24,40,.35);display:flex;flex-direction:column;max-height:86vh}
    .gr-md-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--linha)}
    .gr-md-h b{font-size:1rem;color:var(--tinta)}
    .gr-md-h span{color:var(--cinza);font-size:var(--fs-xs);font-weight:700}
    .gr-md-h button{margin-left:auto;border:none;background:var(--linha-soft);color:var(--tinta);border-radius:9px;width:32px;height:32px;cursor:pointer;font-size:1rem;line-height:1}
    .gr-md-h button:hover{background:var(--erro-bg);color:var(--erro)}
    .gr-md-b{overflow:auto}
    .gr-md-t{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
    .gr-md-t th{position:sticky;top:0;background:var(--teal-soft);color:var(--teal-esc);text-align:left;padding:9px 16px;font-size:var(--fs-xs);font-weight:800;text-transform:uppercase;letter-spacing:.03em;z-index:1}
    .gr-md-t th.v,.gr-md-t td.v{text-align:right;font-variant-numeric:tabular-nums}
    .gr-md-t td{padding:8px 16px;border-top:1px solid var(--linha-soft);color:var(--tinta)}
    .gr-md-t td.v{font-weight:700}
    .gr-md-t tbody tr:hover{background:var(--teal-soft)}
    .gr-md-vz{color:var(--faint);text-align:center;padding:20px}
    .gr-sit{font-size:var(--fs-xs);font-weight:700;color:var(--cinza)}
    .gr-md-t tr.gr-md-tot td{border-top:2px solid var(--linha);font-weight:800;background:var(--teal-soft);position:sticky;bottom:0}
    .gr-md-sort th{cursor:pointer;user-select:none;white-space:nowrap}
    .gr-md-sort th:hover{filter:brightness(.96)}
    .gr-md-sort th.up::after{content:" ▲";font-size:.7em;opacity:.85}
    .gr-md-sort th.down::after{content:" ▼";font-size:.7em;opacity:.85}
    .gr-md-foot{display:flex;justify-content:space-between;padding:12px 18px;border-top:1px solid var(--linha);font-weight:800;font-size:1rem;color:var(--tinta)}
    .gr-md-nota{margin:0;padding:12px 18px;color:var(--cinza);font-size:var(--fs-xs);border-top:1px solid var(--linha-soft)}
    .gr-trc{font-size:.66rem;font-weight:700;color:var(--cinza)}
    @media(max-width:760px){ .gr-desk{display:none} .gr-mob{display:block} }
    </style>
    ${uiTopo({
      titulo: 'Grade de matrículas fixas',
      sub: 'Visão da <b>semana</b>. O selo é a <b>vaga de matrícula</b> (fixas, contadas mesmo faltando); a <b>presença</b> é a ocupação real da aula (fixas presentes + reposição/FREE — falta, falta justificada e trancado liberam a vaga). Clique numa turma para ver os nomes: <b>✓ foi</b> · <b>✗ faltou</b> · <b>⚠ falta justificada</b> · <b>🔒 trancada</b>. O <b>sábado</b> não entra na taxa de ocupação (escala).',
      acoes: `<button id="btnAt" class="ui-btn" onclick="atualizar('/grade/atualizar')"${g ? ' disabled' : ''} title="Atualiza a grade da semana vista (presença/ocupação) reaproveitando o TKM/faturamento da última geração completa. Rápido — poucas chamadas ao EVO.">${g ? '⏳ gerando…' : '🔄 Atualizar grade'}</button>
        <button id="btnAtTudo" class="ui-btn sec" onclick="atualizar('/grade/atualizar-tudo')"${g ? ' disabled' : ''} title="Recalcula também o TKM e o faturamento lendo o contrato de cada aluna no EVO. Mais demorado (vários minutos).">💰 Atualizar tudo</button>`,
    })}
    <div id="aviso" class="aviso" style="display:${g ? 'block' : 'none'}">⏳ Gerando a grade a partir do EVO… pode levar alguns minutos. A página recarrega sozinha ao terminar.</div>
    ${corpo}
    <script>
      var gerando = ${g ? 'true' : 'false'};
      var grSemana = ${off};
      function atualizar(path){var b=document.getElementById('btnAt'),b2=document.getElementById('btnAtTudo');
        b.disabled=true;b2.disabled=true;b.textContent='⏳ gerando…';document.getElementById('aviso').style.display='block';
        fetch(path+'?semana='+grSemana,{method:'POST'}).then(function(r){return r.json();}).then(function(){gerando=true;setTimeout(poll,4000);}).catch(function(){b.disabled=false;b2.disabled=false;b.textContent='🔄 Atualizar grade';});}
      function poll(){fetch('/grade/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){if(s.gerando){setTimeout(poll,4000);}else{location.reload();}}).catch(function(){setTimeout(poll,5000);});}
      if(gerando) setTimeout(poll,4000);
      // Modais do faturamento / TKM (ativas sem contrato)
      function abrirM(id){var e=document.getElementById('ov-'+id);if(e)e.classList.add('open');}
      function fecharM(id){var e=document.getElementById('ov-'+id);if(e)e.classList.remove('open');}
      document.addEventListener('keydown',function(e){if(e.key==='Escape'){fecharM('fat');fecharM('tkm');}});
      // Filtro por PROFESSORA: mostra só as turmas dela na grade e a linha dela no card.
      (function(){
        var sel=document.getElementById('grProf'); if(!sel) return;
        function qa(s){return [].slice.call(document.querySelectorAll(s));}
        function aplicar(){
          var v=sel.value;
          qa('td.gr-cel[data-prof]').forEach(function(td){ td.classList.toggle('gr-off', !!v && td.getAttribute('data-prof')!==v); });
          qa('table.gr tbody tr').forEach(function(tr){
            var tem=[].slice.call(tr.querySelectorAll('td.gr-cel[data-prof]')).some(function(td){ return !v||td.getAttribute('data-prof')===v; });
            tr.classList.toggle('gr-prof-hide', !!v && !tem);
          });
          qa('.gr-item[data-prof]').forEach(function(it){ it.classList.toggle('gr-prof-hide', !!v && it.getAttribute('data-prof')!==v); });
          qa('.gr-day').forEach(function(d){
            var vis=[].slice.call(d.querySelectorAll('.gr-item[data-prof]')).some(function(it){ return !it.classList.contains('gr-prof-hide'); });
            d.classList.toggle('gr-prof-hide', !!v && !vis);
          });
          qa('.gr-prof-row[data-prof]').forEach(function(r){ r.classList.toggle('gr-prof-hide', !!v && r.getAttribute('data-prof')!==v); });
        }
        sel.addEventListener('change', aplicar);
      })();
      // Ordenar colunas do popup de faturamento ao clicar no cabeçalho.
      (function(){
        [].slice.call(document.querySelectorAll('table.gr-md-sort')).forEach(function(tbl){
          if(!tbl.tHead) return;
          var ths=[].slice.call(tbl.tHead.rows[0].cells);
          ths.forEach(function(th,idx){
            th.addEventListener('click', function(){
              var type=th.getAttribute('data-type')||'t';
              var asc=th.getAttribute('data-dir')!=='asc';
              ths.forEach(function(h){ h.removeAttribute('data-dir'); h.classList.remove('up','down'); });
              th.setAttribute('data-dir', asc?'asc':'desc'); th.classList.add(asc?'up':'down');
              var tb=tbl.tBodies[0]; var tot=tb.querySelector('tr.gr-md-tot');
              var rows=[].slice.call(tb.rows).filter(function(r){ return r!==tot && r.cells.length>idx; });
              rows.sort(function(a,b){
                var va=a.cells[idx].getAttribute('data-s'); if(va==null) va=a.cells[idx].textContent;
                var vb=b.cells[idx].getAttribute('data-s'); if(vb==null) vb=b.cells[idx].textContent;
                if(type==='n') return asc?(parseFloat(va)||0)-(parseFloat(vb)||0):(parseFloat(vb)||0)-(parseFloat(va)||0);
                return asc?String(va).localeCompare(String(vb),'pt'):String(vb).localeCompare(String(va),'pt');
              });
              rows.forEach(function(r){ tb.appendChild(r); });
              if(tot) tb.appendChild(tot);
            });
          });
        });
      })();
      // Busca de aluna: destaca as turmas em que ela é fixa e esmaece as demais.
      (function(){
        var inp=document.getElementById('grBusca'); if(!inp) return;
        var info=document.getElementById('grBuscaInfo');
        var cells=[].slice.call(document.querySelectorAll('[data-fx]'));
        function nrm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();}
        function run(){
          var q=nrm(inp.value);
          if(q.length<2){
            cells.forEach(function(c){ c.classList.remove('gr-dim','gr-hit'); var d=c.querySelector('details'); if(d) d.open=false; [].forEach.call(c.querySelectorAll('li'),function(li){li.classList.remove('gr-liht');}); });
            info.textContent = q.length===1 ? 'digite ao menos 2 letras' : '';
            return;
          }
          var n=0;
          cells.forEach(function(c){
            var fx=c.getAttribute('data-fx')||'';
            var hit = fx.split('|').some(function(x){ return x && x.indexOf(q)>=0; });
            c.classList.toggle('gr-hit',hit); c.classList.toggle('gr-dim',!hit);
            var d=c.querySelector('details'); if(d) d.open=hit;
            [].forEach.call(c.querySelectorAll('li'),function(li){ li.classList.toggle('gr-liht', hit && nrm(li.textContent).indexOf(q)>=0); });
            if(hit && c.offsetParent!==null) n++;
          });
          info.textContent = n ? (n+' turma'+(n===1?'':'s')) : 'nenhuma turma encontrada';
        }
        inp.addEventListener('input', run);
      })();
    </script>
  </div>`;
  return chrome({ tab: 'Grade' }, 'grade', corpoWrap);
}

// ── Página: SoFIA → Funil ───────────────────────────────────────────────────
// Conversas → Agendaram → Não agendaram, por período. "Agendou" = telefone na
// lista de quem agendou pela SoFIA (sofia-agendaram.json) OU contato com uma tag
// de gatilho 'agendou'. A data da conversa é a última atividade dela na inbox.
function paginaSofiaFunil(params) {
  params = params || {};
  const janelas = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['0', 'Tudo']];
  const custom = !!(params.de || params.ate);
  const per = custom ? '' : (['hoje', '7', '30', '0'].includes(params.per) ? params.per : '7');
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const menosDias = (base, n) => { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  let iniD = '', fimD = hojeStr, rotulo = '';
  if (custom) { iniD = params.de || ''; fimD = params.ate || hojeStr; rotulo = `${params.de || 'início'} até ${fimD}`; }
  else if (per === 'hoje') { iniD = hojeStr; rotulo = 'hoje'; }
  else if (per === '7') { iniD = menosDias(hojeStr, 6); rotulo = 'últimos 7 dias'; }
  else if (per === '30') { iniD = menosDias(hojeStr, 29); rotulo = 'últimos 30 dias'; }
  else { iniD = ''; rotulo = 'todo o período'; }
  const diaDe = (ms) => { try { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  const dentro = (dia) => dia && (!iniD || dia >= iniD) && (!fimD || dia <= fimD);
  let inbox = {}; try { inbox = sofia.conversas() || {}; } catch (_) {}
  // Canal por telefone (últimos 8) — FALLBACK. O canal confiável vem do evento de
  // agendamento no tagLog (abaixo); este mapa por telefone só é usado quando o
  // evento não tem canal gravado (agendamentos de antes dessa melhoria).
  let canalMap = {}; try { const m = fuLerJson(FU_AGENDOU_CANAL_FILE, {}); if (m && typeof m === 'object' && !Array.isArray(m)) canalMap = m; } catch (_) {}
  let agTags = []; try { agTags = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {}
  const agTagsLc = agTags.map(t => String(t || '').trim());
  let tagLogMap = {}; try { tagLogMap = sofia.lerTagLog() || {}; } catch (_) {}
  let contatosMap = {}; try { contatosMap = contatos.carregar() || {}; } catch (_) {}
  const last8 = (k) => String(k).replace(/\D/g, '').slice(-8);
  const canalDe = (k) => String(canalMap[last8(k)] || '').trim();
  // Nome: usa o da conversa; se vier vazio, busca no CRM (tolerante ao 9º dígito).
  // Nome: prefere o do CRM (quem vira aluna ganha o nome COMPLETO do EVO); se não
  // houver, o da conversa (perfil do WhatsApp).
  const nomeDe = (k, c) => {
    try { const r = contatos.acharPorTel(k, contatosMap); if (r && r.contato && r.contato.nome) return String(r.contato.nome).trim(); } catch (_) {}
    const n = (c && c.nome || '').trim(); if (n) return n;
    return last8(k);
  };
  // Instante + CANAL do agendamento DENTRO do período. Lê o tagLog e pega a ÚLTIMA
  // aplicação (acao add) de uma tag de agendamento. Conta por DATA DO AGENDAMENTO
  // (quem agendou em outra data não entra hoje) e usa o canal DAQUELE evento — não
  // um valor fixo por telefone (que misturava um Express com um SoFIA anterior).
  const agendouEmNoPeriodo = (k) => {
    const evs = tagLogMap[last8(k)] || [];
    let ult = 0, canal = '', por = '';
    for (const e of evs) {
      const ehAg = e.acao === 'add' && (e.motivo === 'agendou' || agTagsLc.includes(String(e.tag || '').trim()));
      if (ehAg && e.em && e.em > ult) {
        ult = e.em; canal = String(e.canal || '').trim(); por = '';
        // Tag de "agendou" posta À MÃO em Contatos (na ficha ou em lote): não
        // veio de um agendamento do sistema — mostra como "Manual" e por quem.
        if (!canal && e.motivo === 'manual') { canal = 'manual'; por = String(e.por || '').trim(); }
      }
    }
    if (!ult || !dentro(diaDe(ult))) return null;
    return { em: ult, canal, por };
  };
  const rotCanal = (c, por) => c === 'manual' ? `✍️ Tag posta à mão${por ? ' por ' + esc(por) : ''}` : ({ sofia: '🤖 SoFIA', formulario: '📲 Formulário', express: '🏪 Express' }[c] || '— sem canal');
  // Canal escolhido no filtro: todos | sofia | formulario | express.
  const canalSel = ['sofia', 'formulario', 'express'].includes(params.canal) ? params.canal : 'todos';
  // Conversas reais com a SoFIA no período (a pessoa escreveu) — base do funil da SoFIA.
  const conversou = (c) => Array.isArray(c && c.msgs) && c.msgs.some(m => m && m.autor === 'aluna');
  const inbox8 = {};
  let convs = 0;
  for (const k in inbox) {
    const c = inbox[k] || {};
    inbox8[last8(k)] = { k, c };
    if (!conversou(c)) continue; // card sem conversa (ex.: criado pelo Express) não é conversa
    const ult = c.ultimaEm || (c.msgs && c.msgs.length ? c.msgs[c.msgs.length - 1].em : 0);
    if (dentro(diaDe(ult))) convs++;
  }
  const cont8 = {};
  for (const t in contatosMap) { const l = last8(t); if (l && !cont8[l]) cont8[l] = t; }
  // Agendamentos do período, de QUALQUER canal: cada agendamento (SoFIA, Formulário
  // ou Express) aplica a tag de "agendou" e fica no histórico de tags com o canal.
  const todosAg = [];
  // Quem foi EXCLUÍDO da aba Contatos (ex.: testes) sai do funil — o histórico
  // de tags continua guardado, mas não conta mais. (Se o CRM não carregar, não filtra.)
  const temCrm = Object.keys(cont8).length > 0;
  for (const l8 in tagLogMap) {
    const ag = agendouEmNoPeriodo(l8);
    if (!ag) continue;
    if (temCrm && !cont8[l8]) continue;
    const ib = inbox8[l8];
    const canal = ag.canal || canalDe(l8) || (ib && conversou(ib.c) ? 'sofia' : '');
    const tel = (ib && ib.k) || cont8[l8] || l8;
    todosAg.push({ nome: nomeDe(tel, ib && ib.c), canal, por: canal === 'manual' ? ag.por : '', em: ag.em, tel });
  }
  const porCanal = { sofia: 0, formulario: 0, express: 0, manual: 0, outro: 0 };
  for (const d of todosAg) porCanal[porCanal[d.canal] != null ? d.canal : 'outro']++;
  const detAg = canalSel === 'todos' ? todosAg : todosAg.filter(d => d.canal === canalSel);
  const agend = detAg.length;
  const agSofia = porCanal.sofia;
  // Filtro Formulário: a etapa de cima é quem VISITOU o link de agendamento no
  // período (pessoas únicas, os mesmos números da subaba Formulário).
  let visitas = 0;
  if (canalSel === 'formulario') {
    try {
      const vids = new Set(); let semVid = 0;
      for (const e of indicadores.carregar()) { if (e.tipo !== 'acesso' || !dentro(e.dia)) continue; if (e.vid) vids.add(e.vid); else semVid++; }
      visitas = vids.size + semVid;
    } catch (_) {}
  }
  // Etapa de cima do funil: conversas (SoFIA) ou visitas (Formulário). Nos outros filtros, não há.
  const topo = canalSel === 'sofia' ? { n: convs, rot: 'Conversaram', stat: 'conversas', de: 'das conversas', vazio: 'Sem conversas no período.' }
    : (canalSel === 'formulario' && visitas) ? { n: Math.max(visitas, porCanal.formulario), rot: 'Visitaram o formulário', stat: 'visitaram o formulário', de: 'de quem visitou' } : null;
  const naoAg = topo ? Math.max(0, topo.n - (canalSel === 'sofia' ? agSofia : porCanal.formulario)) : 0;
  const conv = topo && topo.n ? Math.round(((canalSel === 'sofia' ? agSofia : porCanal.formulario) / topo.n) * 1000) / 10 : 0;
  // Depois do agendamento: fez a aula? fechou contrato? Lido das TAGS atuais do
  // contato — "Presença da experimental" troca para Fez aula / Sem presença (lendo
  // o EVO) e a sincronização de alunas põe "0. Aluna" em quem tem contrato ativo.
  // Quem fechou conta também como "fez a aula" (a tag de aluna pode ter tirado a de presença).
  let compCfg = {}; try { compCfg = lerCompCfg(); } catch (_) {}
  let atCfg = {}; try { atCfg = autoTagAlunas.ler(); } catch (_) {}
  const tFez = String(compCfg.tagCompareceu || '').trim(), tFaltou = String(compCfg.tagFaltou || '').trim(), tAluna = String(atCfg.tagAluna || '0. Aluna').trim();
  // Link do perfil da aluna no EVO (contratos) — o código vem da sincronização de alunas.
  const EVO_LINK = (process.env.EVO_LINK_URL || 'https://evo5.w12app.com.br').replace(/\/+$/, '');
  // Ficha da pessoa na aba Contatos (busca pelos 8 últimos dígitos: tolera o 9º dígito).
  const linkContato = (tel) => tel ? '/sofia?view=contatos&q=' + last8(tel) : '';
  const linkEvo = (id) => id ? `${EVO_LINK}/${config.evo.appBase}/clientes/cadastro/${id}//perfil` : '';
  const situacaoDe = (d) => {
    let tags = [];
    try { const r = contatos.acharPorTel(d.tel, contatosMap); tags = (r && r.contato && r.contato.tags) || []; d.evo = linkEvo(r && r.contato && r.contato.idEvo); } catch (_) {}
    if (tAluna && tags.includes(tAluna)) return 'fechou';
    if (tFez && tags.includes(tFez)) return 'fez';
    if (tFaltou && tags.includes(tFaltou)) return 'faltou';
    return 'aguardando';
  };
  // Aula de cada agendamento: dia/hora que ela marcou (gravado no agendamento) e a
  // experimental no EVO (professora, presença, contrato) — casada pelo nome.
  let aulaMap = {}; try { const m = fuLerJson(FU_AGENDOU_AULA_FILE, {}); if (m && typeof m === 'object' && !Array.isArray(m)) aulaMap = m; } catch (_) {}
  let idxExp = new Map(); try { idxExp = histExp.indicePorNome(); } catch (_) {}
  // "2026-11-05 08:15" / "05/11/2026 08:15" → { dia: '2026-11-05', hora: '08:15' } ({} se não der).
  const quandoDe = (w) => {
    const t = String(w || '').trim(); let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t))) return { dia: `${m[1]}-${m[2]}-${m[3]}`, hora: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '' };
    if ((m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{1,2})[:h](\d{2}))?/.exec(t))) return { dia: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '' };
    return {};
  };
  for (const d of detAg) {
    const am = aulaMap[last8(d.tel)];
    if (am && am.when && Math.abs((am.em || 0) - d.em) < 3 * 86400000) d.when = am.when;
    // Dia/hora que ela marcou (quando foi gravado): ajuda a achar a aula no EVO
    // mesmo com o nome diferente (ex.: CRM "Luciana Carvalho" × EVO com o nome todo).
    const quando = quandoDe(d.when);
    try { d.exp = histExp.acharAula(idxExp, d.nome, diaDe(d.em), quando.dia ? quando : null); } catch (_) {}
  }
  let fez = 0, fechou = 0, faltou = 0, aguardando = 0, semreg = 0;
  const hojeFu = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const somaDiasFu = (dia, n) => { const x = new Date(dia + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  for (const d of detAg) {
    d.sit = situacaoDe(d);
    // A tag não mudou (o job de presença só pareia pelo TELEFONE e só olha os
    // últimos dias), mas a aula já passou: usa a presença do histórico do EVO.
    // Sem presença lançada no EVO → continua aguardando, com um aviso na linha.
    if (d.sit === 'aguardando' && d.exp && d.exp.dia && d.exp.dia < hojeFu) {
      const s = histExp.situacao(d.exp.status);
      if (s === 'veio') d.sit = 'fez';
      else if (s === 'faltou') d.sit = 'faltou';
      else d.semPresenca = true;
    }
    // Agendou há mais de 14 dias, a aula que ela marcou (se gravada) já passou e
    // não há experimental dela no EVO perto do agendamento: avisa na linha. (O
    // histórico só conhece até 7 dias à frente — antes de 14 dias a aula pode
    // simplesmente ainda não ter sido lida.)
    // A aula que ela marcou (gravada no agendamento) já passou e não está no EVO
    // também conta, mesmo antes dos 14 dias.
    if (d.sit === 'aguardando' && !d.exp) {
      const diaAula = quandoDe(d.when).dia;
      if (diaAula ? diaAula < hojeFu : hojeFu > somaDiasFu(diaDe(d.em), 14)) d.semAulaEvo = true;
    }
    // "Aguardando" é só quem ainda VAI fazer a aula. A aula já passou sem presença
    // no EVO, ou a experimental não está no EVO → "Sem registro" (barra própria).
    if (d.sit === 'aguardando' && (d.semPresenca || d.semAulaEvo)) d.sit = 'semreg';
    // fechou só circuito/VIP → conta como "fez a aula", não como contrato fechado
    if (d.sit === 'fechou' && d.exp && contratoIgnorado(d.exp.contrato)) d.sit = 'fez';
    if (d.sit === 'fechou') { fechou++; fez++; }
    else if (d.sit === 'fez') fez++;
    else if (d.sit === 'faltou') faltou++;
    else if (d.sit === 'semreg') semreg++;
    else aguardando++;
  }
  const pct = (n, d) => d ? String(Math.round(n * 1000 / d) / 10).replace('.', ',') + '%' : '—';
  const FU_FILTROS = { agendou: () => true, fez: (s) => s === 'fez' || s === 'fechou', fechou: (s) => s === 'fechou', faltou: (s) => s === 'faltou', aguardando: (s) => s === 'aguardando', semreg: (s) => s === 'semreg' };
  const FU_ROT = { agendou: 'agendaram', fez: 'fizeram a aula', fechou: 'fecharam contrato', faltou: 'faltaram', aguardando: 'ainda aguardando', semreg: 'sem registro no EVO' };
  const SIT = { fechou: ['💰 fechou contrato', 'var(--ok)'], fez: ['✅ fez a aula', 'var(--teal-esc)'], faltou: ['❌ faltou', 'var(--erro)'], aguardando: ['⏳ aguardando', 'var(--cinza)'], semreg: ['❔ sem registro', 'var(--warn)'] };
  // filtro (opcional): passar o mouse mostra os nomes; clicar abre a lista só com eles.
  const FU_DADOS = {};
  for (const f of Object.keys(FU_FILTROS)) FU_DADOS[f] = detAg.filter(d => FU_FILTROS[f](d.sit)).sort((a, b) => b.em - a.em).map(d => ({ n: d.nome, u: d.evo || '', c: linkContato(d.tel), k: d.canal || '', s: d.sit || '' }));
  const fuNum = (n, f) => n ? `<a href="#fuDet" class="fu-pop-alvo" data-filtro="${f}" onclick="fuFiltrar('${f}');return false" style="font-weight:700;color:var(--teal-esc)">${n}</a>` : `<b>${n}</b>`;
  // Trilho da barra com o % (da primeira barra do funil = largura da barra) escrito
  // DENTRO da cor; se a barra for estreita demais para caber, o % vai logo depois dela.
  // extra (opcional): uma segunda taxa, da etapa anterior (ex.: "25% de quem fez a aula").
  // Barras do funil (peça padrão uiBarra). Com filtro: passar o mouse mostra os nomes; clicar filtra a lista.
  // extra (opcional): uma segunda taxa, da etapa anterior (ex.: "25% de quem fez a aula").
  const barra = (rot, n, max, cor, filtro, extra) => uiBarra({ rot, n, max, cor, extra, cls: filtro ? 'fu-bar fu-pop-alvo' : '', attrs: filtro ? ` data-filtro="${filtro}" onclick="fuFiltrar('${filtro}')"` : '' });
  const qCanal = canalSel === 'todos' ? '' : `&canal=${canalSel}`;
  const qPer = custom ? `&de=${encodeURIComponent(params.de || '')}&ate=${encodeURIComponent(params.ate || '')}` : `&per=${per}`;
  const segs = uiChips('Período', janelas.map(([v, l]) => [`/funil?per=${v}${qCanal}`, l, !custom && per === v]));
  const CANAIS_ROT = [['todos', 'Todos', todosAg.length], ['sofia', '🤖 SoFIA', porCanal.sofia], ['formulario', '📲 Formulário', porCanal.formulario], ['express', '🏪 Express', porCanal.express]];
  const segsCanal = uiChips('Canal', CANAIS_ROT.map(([v, l, n]) => [`/funil?${qPer.slice(1)}${v === 'todos' ? '' : '&canal=' + v}`, l, canalSel === v, n]));
  const rotSel = { todos: 'todos os canais', sofia: 'SoFIA', formulario: 'Formulário', express: 'Cadastro Express' }[canalSel];
  // Link para a subaba Formulário (detalhes), no mesmo período quando dá.
  const sessF = E._navSess || { admin: true, telas: [] };
  const podeVerInd = sessF.admin || (sessF.telas || []).includes('ind');
  const diasInd = custom ? 7 : ({ hoje: 1, '7': 7, '30': 30, '0': 0 }[per]);
  // Lista de quem agendou no período (com canal) + os Express que ficaram de fora —
  // ajuda a conferir quem contou e por quê.
  const fmtDtCurta = (ms) => { try { return new Date(Number(ms)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  // "2026-10-31 07:00" / "31/10/2026 07:00" → "sex 31/10 às 07:00" (outro formato: como veio).
  const fmtWhen = (w) => {
    const t = String(w || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(t), y, mo, da, hh, mi;
    if (m) [, y, mo, da, hh, mi] = m;
    else if ((m = /^(\d{2})\/(\d{2})\/(\d{4})\D+(\d{1,2})[:h](\d{2})/.exec(t))) [, da, mo, y, hh, mi] = m;
    else return esc(t);
    const dw = new Date(`${y}-${mo}-${da}T12:00:00`).getDay();
    return `${DS[dw] || ''} ${da}/${mo} às ${String(hh).padStart(2, '0')}:${mi}`;
  };
  const fmtAulaExp = (a) => { const dw = new Date(a.dia + 'T12:00:00').getDay(); const p = a.dia.split('-'); return `${DS[dw]} ${p[2]}/${p[1]}${a.hora ? ' às ' + esc(a.hora) : ''}`; };
  const linhaDet = (d) => {
    const ex = d.exp;
    const aula = d.when ? fmtWhen(d.when) : (ex ? fmtAulaExp(ex) : '');
    return uiPessoa({
      nome: d.nome, href: d.tel ? linkContato(d.tel) : '', sit: d.sit, evo: d.evo,
      attrs: d.sit ? ` data-sit="${d.sit}"` : '',
      meta: [
        `📅 Agendou <b>${esc(fmtDtCurta(d.em))}</b>`,
        rotCanal(d.canal, d.por),
        aula ? `🏋️ Aula <b>${aula}</b>` : '',
        ex && ex.prof ? `👩‍🏫 <b>${esc(ex.prof)}</b>` : '',
        d.semPresenca ? `<span style="color:var(--warn)">⚠️ A aula já passou e a presença não foi lançada no EVO</span>` : '',
        d.semAulaEvo ? `<span style="color:var(--warn)">⚠️ Não achei esta experimental no EVO (desmarcada, ou marcada com outro nome)</span>` : '',
        d.sit === 'fechou' && ex && ex.contrato ? `📄 ${esc(ex.contrato)}` : '',
      ],
    });
  };
  const detalheHtml = detAg.length ? `<div class="sec-t">Quem agendou no período <small style="font-weight:600;color:var(--cinza)">(${detAg.length}${canalSel === 'todos' ? '' : ' · ' + rotSel})</small></div>
    <div class="card" id="fuDet"><div id="fuFiltroInfo" class="ui-nota" style="margin:0 0 6px;display:none"></div><div class="ip-lista">${detAg.sort((a, b) => b.em - a.em).map(linhaDet).join('')}</div></div>` : '';
  const corpo = `<div class="wrap">
    ${subnavIndicadores('funil')}
    ${uiTopo({
      titulo: 'Funil de agendamentos',
      sub: 'Quem agendou a aula experimental pela SoFIA, pelo Formulário ou pelo Cadastro Express — e quantas fizeram a aula e fecharam contrato.',
      linhas: [segs, segsCanal, uiDatas({ action: '/funil', de: params.de, ate: params.ate, extra: canalSel === 'todos' ? '' : `<input type="hidden" name="canal" value="${canalSel}">`, limpar: custom ? `/funil?per=7${qCanal}` : '' })],
    })}
    <div class="stats">
      ${topo ? `<div class="stat tot"><div class="n">${topo.n}</div><div class="l">${topo.stat} · ${esc(rotulo)}</div></div>
      <div class="stat ok"><div class="n">${agend}</div><div class="l">agendaram · <b style="color:var(--coral-esc)">${String(conv).replace('.', ',')}%</b> ${topo.de}</div></div>`
      : `<div class="stat ok"><div class="n">${agend}</div><div class="l">agendaram · ${esc(rotulo)}${canalSel === 'todos' ? `<br><span style="font-size:.72rem">🤖 ${porCanal.sofia} · 📲 ${porCanal.formulario} · 🏪 ${porCanal.express}${porCanal.manual ? ` · ✍️ ${porCanal.manual} à mão` : ''}${porCanal.outro ? ` · ${porCanal.outro} sem canal` : ''}</span>` : ''}</div></div>`}
      <div class="stat"><div class="n" style="color:var(--teal-esc)">${fez}</div><div class="l">fizeram a aula · ${pct(fez, agend)} das agendadas</div></div>
      <div class="stat ok"><div class="n">${fechou}</div><div class="l">fecharam contrato · ${pct(fechou, fez)} de quem fez</div></div>
    </div>
    <div class="ui-secoes">
    <div class="sec-t">Funil</div>
    <div class="card">
      ${topo
        ? (topo.n ? barra(topo.rot, topo.n, topo.n, 'var(--teal)') + barra('Agendaram', agend, topo.n, 'var(--ok)', agend ? 'agendou' : '') + barra('Fizeram a aula', fez, topo.n, 'var(--teal-esc)', fez ? 'fez' : '', agend ? `${pct(fez, agend).replace(/,0%$/, '%')} das agendadas` : '') + barra('Fecharam contrato', fechou, topo.n, '#0b5e33', fechou ? 'fechou' : '', fez ? `${pct(fechou, fez).replace(/,0%$/, '%')} de quem fez<span class="fu-l">&nbsp;a aula</span>` : '') + barra('Não agendaram', naoAg, topo.n, 'var(--cinza)')
          : `<div class="vazio">${topo.vazio}</div>`)
        : (agend ? barra('Agendaram', agend, agend, 'var(--ok)', 'agendou') + barra('Fizeram a aula', fez, agend, 'var(--teal-esc)', fez ? 'fez' : '') + barra('Fecharam contrato', fechou, agend, '#0b5e33', fechou ? 'fechou' : '', fez ? `${pct(fechou, fez).replace(/,0%$/, '%')} de quem fez<span class="fu-l">&nbsp;a aula</span>` : '') + barra('Faltaram', faltou, agend, 'var(--erro)', faltou ? 'faltou' : '') + barra('Aguardando', aguardando, agend, 'var(--cinza)', aguardando ? 'aguardando' : '') + (semreg ? barra('Sem registro', semreg, agend, 'var(--warn)', 'semreg') : '')
          : `<div class="vazio">Ninguém agendou ${canalSel === 'todos' ? '' : 'pelo ' + rotSel + ' '}neste período.</div>`)}
      ${agend ? `<p class="quando" style="margin:10px 0 0">Das <b>${agend}</b> que agendaram: ${fuNum(fez, 'fez')} fizeram a aula (${fuNum(fechou, 'fechou')} já ${fechou === 1 ? 'fechou' : 'fecharam'} contrato), ${fuNum(faltou, 'faltou')} ${faltou === 1 ? 'faltou' : 'faltaram'}${semreg ? ',' : ' e'} ${fuNum(aguardando, 'aguardando')} ainda ${aguardando === 1 ? 'aguarda' : 'aguardam'} a aula${semreg ? ` e ${fuNum(semreg, 'semreg')} ${semreg === 1 ? 'está' : 'estão'} sem registro no EVO (a aula já passou sem presença lançada, ou a experimental não está no EVO)` : ''}. <span style="color:var(--faint)">Passe o mouse nas barras para ver os nomes; clique para filtrar a lista.</span></p>` : ''}
      ${(!compCfg.on || !atCfg.on) ? `<p class="quando" style="margin:8px 0 0;color:var(--warn)">⚠️ ${!compCfg.on ? '“Presença da experimental” está desligada (SoFIA → Tags) — sem ela, ninguém sai de “aguardando”. ' : ''}${!atCfg.on ? '“Alunas / Ex-alunas automáticas” está desligado (SoFIA → Tags) — sem ele, o fechamento de contrato não aparece.' : ''}</p>` : ''}
      ${canalSel === 'formulario' && podeVerInd ? `<p style="margin:12px 0 0;text-align:right"><a href="/indicadores?dias=${diasInd}" class="ui-btn sec" style="display:inline-block;white-space:normal;text-align:center">Ver detalhes do formulário (por dia, horários de pico, origens e links) →</a></p>` : ''}
    </div>
    ${detalheHtml}
    </div>
    <style>
      #fuPop{position:absolute;z-index:80;display:none;width:340px;max-width:calc(100vw - 16px);max-height:380px;overflow:auto;background:var(--card);border:1px solid var(--linha);border-radius:14px;box-shadow:0 14px 36px -12px rgba(16,24,40,.35);font-size:.84rem}
      #fuPop .fp-t{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:11px 14px 9px;background:var(--card);border-bottom:1px solid var(--linha)}
      #fuPop .fp-t b{font-weight:800;color:var(--tinta);font-size:.9rem}
      #fuPop .fp-t span{color:var(--cinza);font-size:.76rem;font-weight:600}
      #fuPop .fp-g{padding:4px 14px 6px}
      #fuPop .fp-g + .fp-g{border-top:1px solid var(--linha-soft)}
      #fuPop .fp-gt{display:flex;justify-content:space-between;align-items:center;margin:6px 0 2px;font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--cinza)}
      #fuPop .fp-gt em{font-style:normal;background:var(--linha-soft);border-radius:999px;padding:1px 8px;color:var(--tinta);letter-spacing:0}
      #fuPop .fp-r{display:flex;align-items:center;gap:8px;padding:5px 0;min-width:0}
      #fuPop .fp-n{flex:1;min-width:0;font-weight:600;color:var(--tinta);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #fuPop a.fp-n:hover{color:var(--teal-esc);text-decoration:underline}
      #fuPop .ip-pill{font-size:.66rem;padding:1px 7px}
      #fuPop .ip-evo{font-size:.7rem;padding:2px 8px}
      #fuPop .fp-d{padding:8px 14px 10px;border-top:1px solid var(--linha);color:var(--faint);font-size:.74rem}
      /* celular: o nome da etapa vai para cima da barra — a barra usa a largura toda */
      @media(max-width:600px){.fu-l{display:none}}
    </style>
    <script>
    var FU_ROT=${JSON.stringify(FU_ROT)};
    var FU_SIT=${JSON.stringify({ fechou: UI_SIT.fechou, fez: UI_SIT.fez, faltou: UI_SIT.faltou, aguardando: UI_SIT.aguardando, semreg: UI_SIT.semreg })};
    var FU_CANAIS=[['sofia','🤖 SoFIA'],['formulario','📲 Formulário'],['express','🏪 Express'],['manual','✍️ Tag posta à mão'],['','Sem canal']];
    var FU_DADOS=${JSON.stringify(FU_DADOS).replace(/</g, '\\u003c')};
    // Passar o mouse numa barra (ou num número do resumo) abre a lista com o nome
    // completo e o link do perfil no EVO; dá para mover o mouse até ela e clicar.
    (function(){
      var pop=document.createElement('div'); pop.id='fuPop'; document.body.appendChild(pop);
      var t=null, esc=function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
      function esconder(){ t=setTimeout(function(){ pop.style.display='none'; },250); }
      function mostrar(el){
        clearTimeout(t);
        var f=el.getAttribute('data-filtro'), l=FU_DADOS[f]||[]; if(!l.length) return;
        // Agrupado por canal; a etiqueta de situação só aparece onde ela varia
        // (em "fecharam", "faltaram" e "aguardando" todas são iguais).
        var comSit=(f==='agendou'||f==='fez'), max=30;
        var linha=function(x){
          var nome=x.c?'<a class="fp-n" href="'+esc(x.c)+'" title="Abrir em Contatos">'+esc(x.n)+'</a>':'<span class="fp-n">'+esc(x.n)+'</span>';
          var sit=comSit&&FU_SIT[x.s]?'<span class="ip-pill ip-'+x.s+'">'+FU_SIT[x.s]+'</span>':'';
          var evo=x.u?'<a class="ip-evo" href="'+esc(x.u)+'" target="_blank" rel="noopener" title="Abrir no EVO">EVO ↗</a>':'';
          return '<div class="fp-r">'+nome+sit+evo+'</div>';
        };
        var grupos=FU_CANAIS.map(function(c){
          var g=l.filter(function(x){ return c[0] ? x.k===c[0] : !(x.k==='sofia'||x.k==='formulario'||x.k==='express'||x.k==='manual'); });
          if(!g.length) return '';
          var vis=g.slice(0,max);
          return '<div class="fp-g"><div class="fp-gt">'+c[1]+'<em>'+g.length+'</em></div>'+vis.map(linha).join('')+(vis.length<g.length?'<div class="fp-r" style="color:var(--faint)">…e mais '+(g.length-vis.length)+' — clique na barra para ver todas</div>':'')+'</div>';
        }).join('');
        pop.innerHTML='<div class="fp-t"><b>'+esc(FU_ROT[f].charAt(0).toUpperCase()+FU_ROT[f].slice(1))+'</b><span>'+l.length+(l.length===1?' pessoa':' pessoas')+'</span></div>'+grupos
          +'<div class="fp-d">Clique no nome para abrir em Contatos · clique na barra para filtrar a lista abaixo.</div>';
        var r=el.getBoundingClientRect(); pop.style.display='block';
        var left=Math.min(r.left+window.scrollX+(el.classList.contains('fu-bar')?150:0), window.scrollX+document.documentElement.clientWidth-pop.offsetWidth-12);
        pop.style.left=Math.max(window.scrollX+8,left)+'px'; pop.style.top=(r.bottom+window.scrollY+4)+'px';
      }
      [].forEach.call(document.querySelectorAll('.fu-pop-alvo'),function(el){ el.addEventListener('mouseenter',function(){ mostrar(el); }); el.addEventListener('mouseleave',esconder); });
      pop.addEventListener('mouseenter',function(){ clearTimeout(t); }); pop.addEventListener('mouseleave',esconder);
    })();
    function fuFiltrar(f){
      var det=document.getElementById('fuDet'); if(!det) return;
      var acc=det.closest('details'); if(acc) acc.open=true;
      var ok={agendou:function(){return true},fez:function(s){return s==='fez'||s==='fechou'},fechou:function(s){return s==='fechou'},faltou:function(s){return s==='faltou'},aguardando:function(s){return s==='aguardando'},semreg:function(s){return s==='semreg'}}[f]||function(){return true};
      var n=0; [].forEach.call(det.querySelectorAll('[data-sit]'),function(r){ var v=!f||ok(r.getAttribute('data-sit')); r.style.display=v?'':'none'; if(v) n++; });
      var exp=document.getElementById('fuExp'); if(exp) exp.style.display=(f&&f!=='agendou')?'none':'';
      var info=document.getElementById('fuFiltroInfo');
      if(f&&f!=='agendou'){ info.style.display='block'; info.innerHTML='Mostrando: <b>'+FU_ROT[f]+'</b> ('+n+') · <a href="#" onclick="fuFiltrar(\\'\\');return false" style="color:inherit;font-weight:700">mostrar todas</a>'; }
      else info.style.display='none';
      (acc||det).scrollIntoView({behavior:'smooth',block:'start'});
    }
    </script>
    <p class="ui-rodape">Conta quem agendou <b>dentro do período</b> (pela data do agendamento), por canal: <b>SoFIA</b> (conversa no WhatsApp), <b>Formulário</b> (link de agendamento) e <b>Cadastro Express</b> (feito pela recepção). No filtro SoFIA, a base são as <b>conversas reais</b> (a pessoa escreveu); no Formulário, as <b>pessoas que abriram o link</b> de agendamento. <b>Fez a aula</b> vem da “Presença da experimental” (lê o EVO e troca a tag) e <b>fechou contrato</b> = ganhou a tag <b>${esc(tAluna)}</b> (aluna com contrato ativo no EVO).</p>
  </div>`;
  return chrome({ tab: 'Funil' }, 'funil', corpo);
}
const { MESES_CURTO, MESES_LONGO, rotuloPeriodo, contratoIgnorado } = ativasDados;
const lerAtivasHist = ativasDados.ler, ativasSerie = ativasDados.serie, ativasPeriodos = ativasDados.periodos;

// Lista de alunas de um recorte: ativas num dia (fim de cada mês, ou hoje), ou quem
// entrou / saiu num mês ou período. Filtros no servidor (tipo, mês, contrato, nome)
// e páginas de 50. Usa "pessoas" (intervalos e contratos de cada uma) do run_ativas_foto.py.
const ATIVAS_POR_PAG = 50;
function paginaAtivasLista(params) {
  const h = lerAtivasHist();
  const serie = ativasSerie(h.reconstruido);
  const hojeIso = serie.length ? serie[serie.length - 1].dia : '';
  const iso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
  const tipo = ['entraram', 'sairam'].includes(params.tipo) ? params.tipo : 'ativas';
  const meses = serie.length ? ativasPeriodos(serie, 'mes') : [];
  const mesSel = meses.find(m => m.k === params.m);
  let dia = iso(params.dia) && iso(params.dia) <= hojeIso ? params.dia : hojeIso;
  let de = iso(params.de) || '', ate = iso(params.ate) || '';
  if (mesSel) { dia = mesSel.ate; de = mesSel.de; ate = mesSel.ate; }
  else if (tipo !== 'ativas' && (!de || !ate)) { const ult = meses[meses.length - 1]; de = ult ? ult.de : hojeIso; ate = ult ? ult.ate : hojeIso; }
  // qual opção do seletor de mês está valendo
  const mesDoRecorte = tipo === 'ativas'
    ? (dia === hojeIso ? 'hoje' : (meses.find(m => m.ate === dia) || {}).k)
    : (meses.find(m => m.de === de && m.ate === ate) || {}).k;
  const fmtD = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ''; };
  const maisUm = (d) => new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const pessoas = h.pessoas || {};
  const voltarUrl = params.voltar && /^\/ativas(\?|$)/.test(params.voltar) ? params.voltar : '/ativas';
  const voltar = `<a class="ui-btn sec" href="${esc(voltarUrl)}">← Voltar</a>`;
  const nomeMes = (k) => { const m = meses.find(x => x.k === k); return m ? rotuloPeriodo(m, 'mes', true) : ''; };
  const titulo = tipo === 'ativas'
    ? (dia === hojeIso ? 'Alunas ativas hoje' : mesDoRecorte ? `Alunas ativas no fim de ${nomeMes(mesDoRecorte)}` : `Alunas ativas em ${fmtD(dia)}`)
    : `${tipo === 'entraram' ? 'Entraram' : 'Saíram'} ${mesDoRecorte ? 'em ' + nomeMes(mesDoRecorte) : de === ate ? 'em ' + fmtD(de) : `de ${fmtD(de)} a ${fmtD(ate)}`}`;
  const ign = h.ignorados || {};
  const regra = (ign.regra || []).map(r => `<b>${esc(String(r).toUpperCase())}</b>`).join(' ou ');
  const nIgn = Object.values(ign.so_ignorado || {}).reduce((a, b) => a + b, 0);
  const atualHoje = tipo === 'ativas' && dia === hojeIso;
  const notaIgn = regra ? `<p class="quando" style="margin:0">Não contam: contratos ${regra}${atualHoje && nIgn ? ` (${nIgn} pessoa${nIgn === 1 ? '' : 's'} hoje)` : ''} e renovação ainda na fila${atualHoje && ign.so_fila ? ` (${ign.so_fila} hoje)` : ''}.</p>` : '';
  const topo = (linhas) => uiTopo({ titulo, sub: 'Toque no nome para abrir o contato; <b>EVO ↗</b> abre o cadastro.', acoes: voltar, linhas });
  if (!serie.length || !h.pessoas) {
    return chrome({ tab: 'Alunas ativas' }, 'ativas', `<div class="wrap">${subnavIndicadores('ativas')}${topo([])}
      <div class="card"><div class="vazio">A lista de alunas aparece depois da próxima atualização. Volte e clique em <b>Atualizar agora</b>.</div></div></div>`);
  }
  // nome/telefone do CRM pelo id do EVO
  const porEvo = {};
  try { for (const [tel, c] of Object.entries(contatos.carregar() || {})) if (c && c.idEvo) porEvo[String(c.idEvo)] = { nome: c.nome, tel }; } catch (_) {}
  const EVO_LINK = (process.env.EVO_LINK_URL || 'https://evo5.w12app.com.br').replace(/\/+$/, '');
  // contrato que valia numa data (o mais recente que já tinha começado)
  const contratoEm = (p, d) => {
    const cs = (p.cs || []).filter(c => c[0] <= d);
    const vig = cs.filter(c => c[1] >= d);
    const c = (vig.length ? vig : cs)[(vig.length ? vig : cs).length - 1];
    return (c && c[2]) || (atualHoje ? p.c : '') || '';
  };
  const todos = [];
  for (const [id, p] of Object.entries(pessoas)) {
    const iv = p.iv || [];
    if (tipo === 'ativas') {
      const k = iv.findIndex(([a, b]) => a <= dia && dia <= b);
      if (k < 0) continue;
      todos.push({ id, p, data: iv[k][0], nova: k === 0, contrato: atualHoje && p.c ? p.c : contratoEm(p, dia) });
    } else {
      iv.forEach(([a, b], k) => {
        if (tipo === 'entraram' && a >= de && a <= ate) todos.push({ id, p, data: a, nova: k === 0, contrato: contratoEm(p, a) });
        if (tipo === 'sairam' && b < hojeIso && maisUm(b) >= de && maisUm(b) <= ate) todos.push({ id, p, data: b, contrato: contratoEm(p, b) });
      });
    }
  }
  // nome: o completo do EVO > o do CRM > o 1º nome
  const nomeDe = (x) => (x.p.nc && x.p.n) || (porEvo[x.id] && porEvo[x.id].nome) || x.p.n || ('id ' + x.id);
  todos.forEach(x => { x.nome = nomeDe(x); x.c = x.contrato || 'sem contrato'; });
  todos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const nNome = {}; for (const x of todos) { const k = x.nome.toLowerCase(); nNome[k] = (nNome[k] || 0) + 1; }
  const porContrato = {};
  for (const x of todos) porContrato[x.c] = (porContrato[x.c] || 0) + 1;
  const contrOrd = Object.entries(porContrato).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cSel = porContrato[params.c] ? params.c : '';
  const normQ = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = String(params.q || '').trim().slice(0, 60);
  const lista = todos.filter(x => (!cSel || x.c === cSel) && (!q || normQ(x.nome).includes(normQ(q))));
  const paginas = Math.max(1, Math.ceil(lista.length / ATIVAS_POR_PAG));
  const pag = Math.min(paginas, Math.max(1, parseInt(params.p, 10) || 1));
  const naPag = lista.slice((pag - 1) * ATIVAS_POR_PAG, pag * ATIVAS_POR_PAG);

  // link mantendo o recorte atual
  const base = { tipo, m: mesDoRecorte && mesDoRecorte !== 'hoje' ? mesDoRecorte : '', dia: mesDoRecorte ? '' : (tipo === 'ativas' ? dia : ''), de: !mesDoRecorte && tipo !== 'ativas' ? de : '', ate: !mesDoRecorte && tipo !== 'ativas' ? ate : '', c: cSel, q, voltar: voltarUrl };
  const url = (over) => { const o = Object.assign({}, base, over); return '/ativas/lista?' + Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); };

  // ── filtros ──
  const optMes = (tipo === 'ativas' ? [`<option value="hoje"${mesDoRecorte === 'hoje' ? ' selected' : ''}>Hoje</option>`] : [])
    .concat(mesDoRecorte ? [] : [`<option value="" selected>${tipo === 'ativas' ? fmtD(dia) : `${fmtD(de)} a ${fmtD(ate)}`}</option>`])
    .concat(meses.slice().reverse().map(m => `<option value="${m.k}"${m.k === mesDoRecorte ? ' selected' : ''}>${rotuloPeriodo(m, 'mes', true)}${m.k === meses[meses.length - 1].k && tipo === 'ativas' ? ' (até hoje)' : ''}</option>`)).join('');
  const optContr = `<option value="">Todos os contratos (${todos.length})</option>` + contrOrd.map(([c, n]) => `<option value="${esc(c)}"${c === cSel ? ' selected' : ''}>${esc(c)} (${n})</option>`).join('');
  const ocultos = (mesDoRecorte ? '' : (tipo === 'ativas' ? `<input type="hidden" name="dia" value="${dia}">` : `<input type="hidden" name="de" value="${de}"><input type="hidden" name="ate" value="${ate}">`))
    + `<input type="hidden" name="voltar" value="${esc(voltarUrl)}">`;
  const filtros = `<form method="GET" action="/ativas/lista" class="al-filtros">
      <label><span class="ui-lbl">Ver</span><select name="tipo" onchange="this.form.submit()">
        <option value="ativas"${tipo === 'ativas' ? ' selected' : ''}>Alunas ativas</option>
        <option value="entraram"${tipo === 'entraram' ? ' selected' : ''}>Quem entrou</option>
        <option value="sairam"${tipo === 'sairam' ? ' selected' : ''}>Quem saiu</option></select></label>
      <label><span class="ui-lbl">${tipo === 'ativas' ? 'Quando' : 'Mês'}</span><select name="m" onchange="this.form.submit()">${optMes}</select></label>
      <label class="al-f-larg"><span class="ui-lbl">Contrato</span><select name="c" onchange="this.form.submit()">${optContr}</select></label>
      <label class="al-f-larg"><span class="ui-lbl">Nome</span><span class="al-busca"><input type="search" name="q" value="${esc(q)}" placeholder="Buscar pelo nome…"><button class="ui-btn" type="submit">Buscar</button></span></label>
      ${ocultos}
    </form>`;

  // ── resumo ──
  const nTranc = atualHoje ? lista.filter(x => x.p.t).length : 0;
  const nNovas = lista.filter(x => x.nova).length;
  const resumo = `<div class="al-resumo"><span><b>${lista.length}</b> aluna${lista.length === 1 ? '' : 's'}${cSel || q ? ` <span class="quando" style="margin:0">de ${todos.length}</span>` : ''}</span>
      ${nTranc ? `<span>🔒 <b>${nTranc}</b> trancada${nTranc === 1 ? '' : 's'}</span>` : ''}
      ${tipo === 'entraram' ? `<span><b>${nNovas}</b> nova${nNovas === 1 ? '' : 's'}</span><span><b>${lista.length - nNovas}</b> ${lista.length - nNovas === 1 ? 'voltou' : 'voltaram'}</span>` : ''}
      ${cSel || q ? `<a href="${esc(url({ c: '', q: '' }))}" class="ui-btn sec" style="padding:4px 12px">Limpar filtros</a>` : ''}</div>`;

  // ── tabela ──
  const colData = tipo === 'ativas' ? 'Aluna desde' : tipo === 'entraram' ? 'Entrou em' : 'Último dia';
  const linhas = naPag.map(x => {
    const ct = porEvo[x.id];
    const href = ct ? '/sofia?view=contatos&q=' + String(ct.tel).replace(/\D/g, '').slice(-8) : '';
    const tags = [
      atualHoje && x.p.t ? '<span class="ip-pill ip-aguardando">🔒 Trancada</span>' : '',
      tipo === 'entraram' ? (x.nova ? '<span class="ip-pill ip-fechou">Nova</span>' : '<span class="ip-pill ip-aguardando">Voltou</span>') : '',
    ].join('');
    const sub = [
      atualHoje && Array.isArray(x.p.f) ? `⏭️ Renovação na fila a partir de ${fmtD(x.p.f[1])}` : '',
      nNome[x.nome.toLowerCase()] > 1 ? `Cadastro EVO nº ${esc(x.id)}` : '',
    ].filter(Boolean).join(' · ');
    return `<tr>
        <td class="al-nome">${href ? `<a href="${esc(href)}" title="Abrir em Contatos">${esc(x.nome)}</a>` : `<span>${esc(x.nome)}</span>`}${tags}${sub ? `<div class="al-sub">${sub}</div>` : ''}</td>
        <td class="al-contr">${esc(x.contrato || '—')}</td>
        <td class="al-data"><span class="al-rot">${colData} </span>${fmtD(x.data)}</td>
        <td class="al-evo"><a class="ip-evo" href="${esc(`${EVO_LINK}/${config.evo.appBase}/clientes/cadastro/${x.id}//perfil`)}" target="_blank" rel="noopener">EVO ↗</a></td>
      </tr>`;
  }).join('');
  const nums = []; for (let i = 1; i <= paginas; i++) if (i === 1 || i === paginas || Math.abs(i - pag) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  const paginacao = paginas > 1 ? `<nav class="al-pag" aria-label="Páginas">
      ${pag > 1 ? `<a class="ui-btn sec" href="${esc(url({ p: pag - 1 }))}">← Anterior</a>` : '<span class="ui-btn sec" aria-disabled="true">← Anterior</span>'}
      <span class="al-nums">${nums.map(n => n === '…' ? '<span class="quando" style="margin:0">…</span>' : n === pag ? `<b aria-current="page">${n}</b>` : `<a href="${esc(url({ p: n }))}">${n}</a>`).join('')}</span>
      ${pag < paginas ? `<a class="ui-btn sec" href="${esc(url({ p: pag + 1 }))}">Próxima →</a>` : '<span class="ui-btn sec" aria-disabled="true">Próxima →</span>'}
    </nav>
    <p class="quando" style="margin:6px 0 0;text-align:center">${(pag - 1) * ATIVAS_POR_PAG + 1}–${Math.min(pag * ATIVAS_POR_PAG, lista.length)} de ${lista.length}</p>` : '';
  const semNome = todos.filter(x => !x.p.nc && !porEvo[x.id]).length;
  const corpo = `<div class="wrap">${subnavIndicadores('ativas')}
    ${topo([filtros, notaIgn].filter(Boolean))}
    <div class="card">
      ${resumo}
      ${lista.length ? `<div style="overflow-x:auto"><table class="ui-tab al-tab"><thead><tr><th>Aluna</th><th>Contrato</th><th>${colData}</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>${paginacao}`
        : `<div class="vazio">Ninguém ${cSel || q ? 'com esse filtro' : 'neste recorte'}.</div>`}
      ${semNome ? `<p class="quando" style="margin:10px 0 0">${semNome} nome${semNome === 1 ? '' : 's'} ainda só com o 1º nome — o nome completo vem do EVO aos poucos (a cada <b>Atualizar agora</b> e de madrugada).</p>` : ''}
    </div></div>`;
  return chrome({ tab: 'Alunas ativas' }, 'ativas', corpo);
}

// ── Indicadores → Alunas ativas → Resumo mensal no WhatsApp ───────────────────
// Configura o envio automático (resumo-mensal.js, rodado pelo robô), mostra a
// prévia (texto + imagem) e permite mandar agora.
function paginaResumoMensal(params, aviso) {
  const rm = require('./resumo-mensal');
  const cfg = rm.lerCfg();
  const h = lerAtivasHist();
  const meses = ativasPeriodos(ativasSerie(h.reconstruido), 'mes');
  const padrao = rm.mesAnterior(rm.agoraSP().dia.slice(0, 7));
  const mes = meses.some(m => m.k === params.mes) ? params.mes : (meses.some(m => m.k === padrao) ? padrao : (meses.length ? meses[meses.length - 1].k : ''));
  let d = null; try { d = mes ? rm.dadosDoMes(mes, cfg) : null; } catch (e) { console.log('[resumo mensal] prévia falhou:', e.message); }
  const fmtQ = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const proxEnvio = (() => {
    const a = rm.agoraSP(); const [y, m] = a.dia.split('-').map(Number);
    const jaEsteMes = a.d > cfg.dia || (a.d === cfg.dia && a.hora >= cfg.hora) || cfg.enviados[rm.mesAnterior(a.dia.slice(0, 7))];
    const ym = jaEsteMes ? (m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`) : `${y}-${String(m).padStart(2, '0')}`;
    return `dia ${String(cfg.dia).padStart(2, '0')}/${ym.slice(5)}/${ym.slice(0, 4)} às ${cfg.hora} (resumo de ${rm.nomeMes(rm.mesAnterior(ym))})`;
  })();
  const ult = cfg.ultimo;
  const status = !cfg.ativo ? '<div class="ui-nota"><span>Envio automático <b>desligado</b>. Ligue abaixo e salve.</span></div>'
    : !cfg.grupos.length ? '<div class="ui-nota warn"><span>Ligado, mas <b>sem grupo</b> — escreva o nome do grupo abaixo.</span></div>'
    : `<div class="ui-nota ok"><span>✅ Ligado. Próximo envio: <b>${esc(proxEnvio)}</b>, em ${cfg.grupos.map(g => `<b>${esc(g)}</b>`).join(', ')}.</span></div>`;
  const ultHtml = ult ? `<div class="ui-nota ${ult.ok ? '' : 'erro'}"><span>${ult.ok ? '📤' : '⚠️'} Último envio${ult.teste ? ' (manual)' : ''}: ${esc(fmtQ(ult.em))} — resumo de ${esc(rm.nomeMes(ult.mes))}. ${esc(ult.msg || '')}</span></div>` : '';
  const sw = `<label class="envsw rm-sw ${cfg.ativo ? 'on' : 'off'}"><span class="envsw-txt">${cfg.ativo ? 'Ativado' : 'Desligado'}</span>
      <input type="checkbox" name="ativo" value="1"${cfg.ativo ? ' checked' : ''} onchange="var l=this.parentNode;l.className='envsw rm-sw '+(this.checked?'on':'off');l.firstElementChild.textContent=this.checked?'Ativado':'Desligado'">
      <span class="envsw-track"><span class="envsw-thumb"></span></span></label>`;
  const optDia = Array.from({ length: 28 }, (_, i) => i + 1).map(n => `<option value="${n}"${n === cfg.dia ? ' selected' : ''}>dia ${n}</option>`).join('');
  const optMes = meses.slice().reverse().slice(0, 24).map(m => `<option value="${m.k}"${m.k === mes ? ' selected' : ''}>${rm.nomeMes(m.k)}</option>`).join('');
  const corpo = `<div class="wrap">${subnavIndicadores('ativas')}
    ${uiTopo({ titulo: 'Resumos no WhatsApp', sub: 'Resumo do <b>mês</b>: todo mês, no dia e horário escolhidos, o robô manda nos grupos o resumo do mês que fechou: alunas ativas comparadas com o mês anterior (entradas e saídas) e com o mesmo mês do ano anterior — em texto e numa imagem. Usa os números atualizados no dia (leitura das 05:25); se ainda não houver, relê o EVO antes.', acoes: '<a class="ui-btn sec" href="/ativas">← Alunas ativas</a>', linhas: [uiChips('Resumo', [['/ativas/resumo', 'Mensal', true], ['/ativas/resumo?t=semana', 'Semanal', false]]), aviso || '', status, ultHtml].filter(Boolean) })}
    <form method="POST" action="/ativas/resumo/salvar" class="card rm-form">
      <div class="rm-cab"><b>Envio automático</b>${sw}</div>
      <label class="rm-campo"><span class="ui-lbl">Grupo(s) do WhatsApp</span>
        <textarea name="grupos" rows="3" placeholder="Nome do grupo, exatamente como aparece no WhatsApp (um por linha)">${esc(cfg.grupos.join('\n'))}</textarea>
        <small class="quando" style="margin:0">Até 5 grupos, um por linha. O WhatsApp do robô precisa estar no grupo.</small></label>
      <div class="rm-linha">
        <label class="rm-campo"><span class="ui-lbl">Dia do mês</span><select name="dia">${optDia}</select></label>
        <label class="rm-campo"><span class="ui-lbl">Horário</span><input type="time" name="hora" value="${esc(cfg.hora)}"></label>
      </div>
      <label class="chk"><input type="checkbox" name="experimentais" value="1"${cfg.experimentais ? ' checked' : ''}> <span>Incluir as <b>aulas experimentais</b> do mês (vieram, fecharam e conversão)</span></label>
      <label class="chk"><input type="checkbox" name="nomesSaida" value="1"${cfg.nomesSaida ? ' checked' : ''}> <span>Incluir os <b>nomes de quem saiu</b> (para a equipe tentar recuperar) — atenção a quem está no grupo</span></label>
      <div class="rm-btns"><button class="ui-btn" type="submit">Salvar</button></div>
    </form>
    <div class="sec-t">Prévia</div>
    <div class="card">
      <form method="GET" action="/ativas/resumo" class="ui-linha" style="margin:0 0 12px"><span class="ui-lbl">Mês</span><select name="mes" onchange="this.form.submit()" style="width:auto">${optMes}</select>
        <span class="quando" style="margin:0">Salve antes de ver a prévia, se mudou as opções.</span></form>
      ${d ? `<div class="rm-prev">
        <div class="rm-img"><iframe src="/ativas/resumo/imagem?mes=${esc(mes)}" title="Imagem do resumo" loading="lazy" scrolling="no"></iframe></div>
        <pre class="rm-txt">${esc(rm.texto(d))}</pre>
      </div>
      <form method="POST" action="/ativas/resumo/enviar" class="ui-linha" style="margin:14px 0 0" onsubmit="return confirm('Enviar agora o resumo de ${esc(rm.nomeMes(mes))} em: ${esc(cfg.grupos.join(', ') || '(nenhum grupo)')}?')">
        <input type="hidden" name="mes" value="${esc(mes)}">
        <button class="ui-btn" type="submit"${cfg.grupos.length ? '' : ' disabled title="Escreva o nome do grupo e salve"'}>📤 Enviar agora nos grupos</button>
        <span class="quando" style="margin:0">O robô gera a imagem e envia em cerca de 1 minuto (se os números ainda não foram atualizados hoje, relê o EVO antes: mais 1–3 min). Não muda o envio automático.</span>
      </form>` : '<div class="vazio">Ainda sem histórico de alunas ativas. Em <b>Alunas ativas</b>, clique em <b>Atualizar agora</b>.</div>'}
    </div>
    <script>(function(){ function ajusta(){ document.querySelectorAll('.rm-img').forEach(function(c){ c.style.setProperty('--rm-esc', (c.clientWidth/1080).toFixed(4)); }); } ajusta(); window.addEventListener('resize', ajusta); })();</script>
    <p class="ui-rodape">O texto vai como <b>legenda da imagem</b> (uma mensagem só); se a lista de quem saiu deixar o texto longo demais para legenda, ela vai numa 2ª mensagem. No texto aparecem em <b>negrito</b> os trechos entre *asteriscos* (formato do WhatsApp). Se o robô estiver desligado no horário, ele envia quando voltar (até 3 dias depois). Se falhar (ex.: nome do grupo errado), tenta de novo em 1 hora, até 4 vezes.</p>
  </div>`;
  return chrome({ tab: 'Resumo mensal' }, 'ativas', corpo);
}

// ── … → Resumos no WhatsApp → Semanal ────────────────────────────────────────
// Resumo da semana no grupo da equipe (resumo-semanal.js). Liga/desliga e
// dias/horário são os do job resumoSemana (os mesmos de WhatsApp → Outros envios).
function paginaResumoSemanal(params, aviso) {
  const rs = require('./resumo-semanal');
  const rmx = require('./resumo-mensal');
  const cfg = rs.lerCfg();
  const ontem = rmx.somaDias(rmx.agoraSP().dia, -1);
  const semanas = Array.from({ length: 8 }, (_, i) => rmx.somaDias(ontem, -7 * i));
  const ate = semanas.includes(params.ate) ? params.ate : ontem;
  let d = null; try { d = rs.dadosDaSemana(ate, cfg); } catch (e) { console.log('[resumo semanal] prévia falhou:', e.message); }
  const fmtQ = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const diasTxt = (cfg.dias || []).map(x => rs.DIAS_LONGO[x]).join(', ').replace(/, ([^,]+)$/, ' e $1');
  const ult = cfg.ultimo;
  const status = !cfg.ativo ? '<div class="ui-nota"><span>Envio automático <b>desligado</b>. Ligue abaixo e salve.</span></div>'
    : !cfg.grupos.length ? '<div class="ui-nota warn"><span>Ligado, mas <b>sem grupo</b> — escreva o nome do grupo abaixo.</span></div>'
    : `<div class="ui-nota ok"><span>✅ Ligado: envia <b>${esc(diasTxt)}</b> às <b>${esc(cfg.hora)}</b> (semana = 7 dias até a véspera), em ${cfg.grupos.map(g => `<b>${esc(g)}</b>`).join(', ')}.</span></div>`;
  const ultHtml = ult ? `<div class="ui-nota ${ult.ok ? '' : 'erro'}"><span>${ult.ok ? '📤' : '⚠️'} Último envio${ult.teste ? ' (manual)' : ''}: ${esc(fmtQ(ult.em))}. ${esc(ult.msg || '')}</span></div>` : '';
  const sw = `<label class="envsw rm-sw ${cfg.ativo ? 'on' : 'off'}"><span class="envsw-txt">${cfg.ativo ? 'Ativado' : 'Desligado'}</span>
      <input type="checkbox" name="ativo" value="1"${cfg.ativo ? ' checked' : ''} onchange="var l=this.parentNode;l.className='envsw rm-sw '+(this.checked?'on':'off');l.firstElementChild.textContent=this.checked?'Ativado':'Desligado'">
      <span class="envsw-track"><span class="envsw-thumb"></span></span></label>`;
  const chkDia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((n, i) => `<label class="rm-dia"><input type="checkbox" name="dias" value="${i}"${(cfg.dias || []).includes(i) ? ' checked' : ''}><span>${n}</span></label>`).join('');
  const fmtD = (x) => { const p = String(x).split('-'); return `${p[2]}/${p[1]}`; };
  const optSem = semanas.map(s => `<option value="${s}"${s === ate ? ' selected' : ''}>${fmtD(rmx.somaDias(s, -6))} a ${fmtD(s)}${s === ontem ? ' (a mais recente)' : ''}</option>`).join('');
  const corpo = `<div class="wrap">${subnavIndicadores('ativas')}
    ${uiTopo({ titulo: 'Resumos no WhatsApp', sub: 'Resumo da <b>semana</b> no grupo da equipe: agendamentos por canal, aulas experimentais (vieram, faltaram, fecharam), por professora, alunas ativas e quem veio e ainda não fechou — em texto (como legenda) e numa imagem. Não abre mais o EVO no navegador: usa o que o robô já leu.', acoes: '<a class="ui-btn sec" href="/ativas">← Alunas ativas</a>',
      linhas: [uiChips('Resumo', [['/ativas/resumo', 'Mensal', false], ['/ativas/resumo?t=semana', 'Semanal', true]]), aviso || '', status, ultHtml].filter(Boolean) })}
    <form method="POST" action="/ativas/resumo/semana/salvar" class="card rm-form">
      <div class="rm-cab"><b>Envio automático</b>${sw}</div>
      <label class="rm-campo"><span class="ui-lbl">Grupo(s) do WhatsApp</span>
        <textarea name="grupos" rows="2" placeholder="Nome do grupo, exatamente como aparece no WhatsApp (um por linha)">${esc(cfg.grupos.join('\n'))}</textarea></label>
      <div class="rm-campo"><span class="ui-lbl">Dias</span><div class="rm-dias">${chkDia}</div></div>
      <label class="rm-campo" style="max-width:220px"><span class="ui-lbl">Horário</span><input type="time" name="hora" value="${esc(cfg.hora)}"></label>
      <label class="chk"><input type="checkbox" name="porProfessora" value="1"${cfg.porProfessora ? ' checked' : ''}> <span>Incluir <b>por professora</b> (quantas fecharam de quem veio)</span></label>
      <label class="chk"><input type="checkbox" name="ativas" value="1"${cfg.ativas ? ' checked' : ''}> <span>Incluir <b>alunas ativas</b> (entradas e saídas na semana × semana anterior)</span></label>
      <label class="chk"><input type="checkbox" name="pendentes" value="1"${cfg.pendentes ? ' checked' : ''}> <span>Incluir <b>quem veio e ainda não fechou</b> (nomes, para a recepção ligar)</span></label>
      <div class="rm-btns"><button class="ui-btn" type="submit">Salvar</button></div>
      <p class="quando" style="margin:0">Liga/desliga e dias/horário são os mesmos de <b>WhatsApp → Outros envios → Resumo da semana</b>. Mudanças valem sem reiniciar o robô.</p>
    </form>
    <div class="sec-t">Prévia</div>
    <div class="card">
      <form method="GET" action="/ativas/resumo" class="ui-linha" style="margin:0 0 12px"><input type="hidden" name="t" value="semana"><span class="ui-lbl">Semana</span><select name="ate" onchange="this.form.submit()" style="width:auto">${optSem}</select>
        <span class="quando" style="margin:0">Salve antes de ver a prévia, se mudou as opções.</span></form>
      ${d && !d.vazio ? `<div class="rm-prev">
        <div class="rm-img"><iframe src="/ativas/resumo/imagem-semana?ate=${esc(ate)}" title="Imagem do resumo da semana" loading="lazy" scrolling="no"></iframe></div>
        <pre class="rm-txt">${esc(rs.texto(d))}</pre>
      </div>
      <form method="POST" action="/ativas/resumo/semana/enviar" class="ui-linha" style="margin:14px 0 0" onsubmit="return confirm('Enviar agora o resumo da semana em: ${esc(cfg.grupos.join(', ') || '(nenhum grupo)')}?')">
        <input type="hidden" name="ate" value="${esc(ate)}">
        <button class="ui-btn" type="submit"${cfg.grupos.length ? '' : ' disabled title="Escreva o nome do grupo e salve"'}>📤 Enviar agora nos grupos</button>
        <span class="quando" style="margin:0">Chega em cerca de 1 minuto. Não muda o envio automático.</span>
      </form>` : '<div class="vazio">Nenhum agendamento nem aula experimental nesta semana — nada a enviar.</div>'}
    </div>
    <script>(function(){ function ajusta(){ document.querySelectorAll('.rm-img').forEach(function(c){ c.style.setProperty('--rm-esc', (c.clientWidth/1080).toFixed(4)); }); } ajusta(); window.addEventListener('resize', ajusta); })();</script>
    <p class="ui-rodape">A <b>semana</b> são os 7 dias que terminam na véspera do envio (a presença do dia ainda não foi lida no EVO). <b>Agendaram</b> = agendamentos feitos na semana (SoFIA, Formulário, Express), como no Funil; <b>aulas</b> = experimentais com data na semana, com a regra da tela Professoras. O texto vai como legenda da imagem; se a lista de quem não fechou for longa, ela vai numa 2ª mensagem. Semana sem nenhum agendamento nem aula não é enviada.</p>
  </div>`;
  return chrome({ tab: 'Resumo da semana' }, 'ativas', corpo);
}

function paginaAtivas(params) {
  params = params || {};
  const h = lerAtivasHist();
  const serie = ativasSerie(h.reconstruido);
  const vis = params.vis === 'semana' ? 'semana' : 'mes';
  const opcoesRange = vis === 'mes' ? [['12', '12 meses'], ['24', '24 meses'], ['0', 'Tudo']] : [['13', '3 meses'], ['26', '6 meses'], ['52', '1 ano']];
  const range = opcoesRange.some(([v]) => v === params.r) ? params.r : opcoesRange[0][0];
  const fmtN = (n) => String(n);
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : String(Math.round(v * 10) / 10).replace('.', ',') + '%';
  const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  const ultimo = h.ultimo && h.ultimo.dia;
  const fotoHoje = ultimo && h.dias && h.dias[ultimo];
  const btnAtualizar = `<form method="POST" action="/ativas/atualizar" style="margin:0"><button class="ui-btn sec" type="submit"${E._ativasGerando ? ' disabled' : ''}>${E._ativasGerando ? '⏳ Calculando…' : '🔄 Atualizar agora'}</button></form>`;
  const avisoCalc = E._ativasGerando ? '<div class="ui-nota">⏳ Calculando no EVO… os números ficam prontos em ~1 minuto; os nomes completos, em até 3. Atualize a página (F5).</div>'
    : (E._ativasUltimo && !E._ativasUltimo.ok && Date.now() - E._ativasUltimo.fim < 6 * 3600e3) ? `<div class="ui-nota erro">⚠️ O último cálculo falhou: ${esc(E._ativasUltimo.msg)}</div>` : '';
  const topoBase = (linhas) => uiTopo({
    titulo: 'Alunas ativas',
    sub: 'Quantas alunas têm contrato vigente — <b>trancada conta como ativa</b> — mês a mês ou semana a semana, quem entrou, quem saiu e a comparação com o mesmo período do ano anterior.',
    acoes: `<div class="ui-acoes"><a class="ui-btn sec" href="/ativas/resumo">📤 Resumos no WhatsApp</a>${btnAtualizar}</div>`, linhas: (linhas || []).concat(avisoCalc ? [avisoCalc] : []),
  });
  if (!serie.length) {
    return chrome({ tab: 'Alunas ativas' }, 'ativas', `<div class="wrap">${subnavIndicadores('ativas')}${topoBase([])}
      <div class="card"><div class="vazio">${E._ativasGerando ? 'Calculando o histórico no EVO… atualize a página em 1 minuto.' : 'Ainda sem histórico. Clique em <b>Atualizar agora</b> (leva de 1 a 3 minutos) ou espere a atualização das 05:25.'}</div></div></div>`);
  }

  const periodos = ativasPeriodos(serie, vis);
  const n = range === '0' ? periodos.length : Math.min(periodos.length, parseInt(range, 10));
  const vistos = periodos.slice(-n);
  const atual = periodos[periodos.length - 1];
  const hoje = serie[serie.length - 1];

  // ── comparação entre dois meses ──
  const meses = ativasPeriodos(serie, 'mes');
  const okMes = (k) => meses.some(m => m.k === k);
  const mA = okMes(params.a) ? params.a : meses[meses.length - 1].k;
  const anoAnt = (+mA.slice(0, 4) - 1) + mA.slice(4);
  const mB = okMes(params.b) ? params.b : (okMes(anoAnt) ? anoAnt : meses[0].k);
  const PA = meses.find(m => m.k === mA), PB = meses.find(m => m.k === mB);
  const diaria = (k) => { const v = Array(31).fill(null); for (const p of serie) if (p.dia.slice(0, 7) === k) v[+p.dia.slice(8) - 1] = p.a; return v; };
  const optsMes = (sel) => meses.slice().reverse().map(m => `<option value="${m.k}"${m.k === sel ? ' selected' : ''}>${rotuloPeriodo(m, 'mes', true)}</option>`).join('');
  const taxa = (p) => p.ini ? p.s * 100 / p.ini : null;
  const tile = (rot, va, vb, fmt, menorMelhor) => {
    const d = (va == null || vb == null) ? null : va - vb;
    const bom = d == null || d === 0 ? null : (menorMelhor ? d < 0 : d > 0);
    return `<div class="stat"><div class="l" style="margin:0 0 6px">${rot}</div><div class="n" style="color:var(--tinta)">${fmt(va)}</div>
      <div class="l">${esc(rotuloPeriodo(PB, 'mes', true))}: <b>${fmt(vb)}</b>${d == null ? '' : ` · <b style="color:${bom == null ? 'var(--cinza)' : bom ? 'var(--ok)' : 'var(--erro)'}">${fmt === fmtPct ? (d > 0 ? '+' : '') + String(Math.round(d * 10) / 10).replace('.', ',') + ' p.p.' : sinal(d)}</b>`}</div></div>`;
  };
  const mesAtual = mA === meses[meses.length - 1].k;
  const voltarQ = encodeURIComponent(`/ativas?vis=${vis}&r=${range}`);
  const lnk = (q, html, titulo) => `<a href="/ativas/lista?${q}&voltar=${voltarQ}" title="${esc(titulo || 'Ver as alunas')}" style="color:inherit;text-decoration:none;border-bottom:1px dashed currentColor">${html}</a>`;
  const qPer = (tipo, p) => `tipo=${tipo}&de=${p.de}&ate=${p.ate}`;

  const linhasTab = vistos.slice().reverse().map(p => `<tr>
      <td>${lnk(vis === 'mes' ? `tipo=ativas&m=${p.k}` : `tipo=ativas&dia=${p.ate}`, `<b>${esc(rotuloPeriodo(p, vis, true))}</b>`, 'Ver as alunas ativas')}${p === atual ? ' <span class="quando" style="margin:0">(até hoje)</span>' : ''}</td>
      <td>${p.ini}</td>
      <td>${p.e ? lnk(qPer('entraram', p), `<b style="color:var(--ok)">+${p.e}</b>`, 'Ver quem entrou') : '<b style="color:var(--ok)">+0</b>'} <span class="quando" style="margin:0">(${p.n} nova${p.n === 1 ? '' : 's'} · ${p.e - p.n} ${p.e - p.n === 1 ? 'voltou' : 'voltaram'})</span></td>
      <td>${p.s ? lnk(qPer('sairam', p), `<b style="color:var(--erro)">−${p.s}</b>`, 'Ver quem saiu') : '<b style="color:var(--erro)">−0</b>'}</td>
      <td>${lnk(`tipo=ativas&dia=${p.ate}`, `<b>${p.fim}</b>`, 'Ver as alunas ativas neste dia')}</td>
      <td><b style="color:${p.fim > p.ini ? 'var(--ok)' : p.fim < p.ini ? 'var(--erro)' : 'var(--cinza)'}">${sinal(p.fim - p.ini)}</b></td>
      <td>${fmtPct(taxa(p))}</td>
    </tr>`).join('');

  const dadosEvol = { rotulos: vistos.map(p => rotuloPeriodo(p, vis, false)), longos: vistos.map(p => rotuloPeriodo(p, vis, true) + (p === atual ? ' (até hoje)' : '')),
    series: [{ nome: 'Ativas', cor: '#00918a', valores: vistos.map(p => p.fim) }],
    extra: vistos.map(p => `+${p.e} entraram · −${p.s} saíram`), area: true };
  const dadosComp = { rotulos: Array.from({ length: 31 }, (_, i) => String(i + 1)), longos: Array.from({ length: 31 }, (_, i) => 'dia ' + (i + 1)),
    series: [{ nome: rotuloPeriodo(PA, 'mes', true), cor: '#00918a', valores: diaria(mA) }, { nome: rotuloPeriodo(PB, 'mes', true), cor: '#c2660f', valores: diaria(mB) }] };
  const js = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

  const corpo = `<div class="wrap">
    ${subnavIndicadores('ativas')}
    ${topoBase([
      uiChips('Ver por', [['/ativas?vis=mes', 'Mês', vis === 'mes'], ['/ativas?vis=semana', 'Semana', vis === 'semana']]),
      uiChips('Período', opcoesRange.map(([v, l]) => [`/ativas?vis=${vis}&r=${v}`, l, range === v])),
    ])}
    <div class="stats">
      <a class="stat tot stat-link" href="/ativas/lista?voltar=${voltarQ}"><div class="n">${hoje.a}</div><div class="l">alunas ativas hoje${fotoHoje && fotoHoje.trancadas ? ` · ${fotoHoje.trancadas} trancada${fotoHoje.trancadas === 1 ? '' : 's'}` : ''} · <u>ver lista</u></div></a>
      <a class="stat ok stat-link" href="/ativas/lista?${qPer('entraram', atual)}&voltar=${voltarQ}"><div class="n">+${atual.e}</div><div class="l">entraram ${vis === 'mes' ? 'neste mês' : 'nesta semana'} · <u>ver</u></div></a>
      <a class="stat err stat-link" href="/ativas/lista?${qPer('sairam', atual)}&voltar=${voltarQ}"><div class="n">−${atual.s}</div><div class="l">saíram ${vis === 'mes' ? 'neste mês' : 'nesta semana'} · <u>ver</u></div></a>
      <div class="stat"><div class="n" style="color:${hoje.a - atual.ini >= 0 ? 'var(--ok)' : 'var(--erro)'}">${sinal(hoje.a - atual.ini)}</div><div class="l">saldo ${vis === 'mes' ? 'do mês' : 'da semana'}</div></div>
    </div>
    <div class="ui-secoes">
    <div class="sec-t">Evolução <small style="font-weight:600;color:var(--cinza)">(alunas ativas no fim de cada ${vis === 'mes' ? 'mês' : 'semana'})</small></div>
    <div class="card"><div class="ui-graf" data-graf="evol"></div></div>
    <div class="sec-t">Comparar dois meses</div>
    <div class="card">
      <form method="GET" action="/ativas" class="ui-linha" style="margin:0 0 6px">
        <input type="hidden" name="vis" value="${vis}"><input type="hidden" name="r" value="${range}">
        <select name="a" onchange="this.form.submit()" aria-label="Mês" style="width:auto">${optsMes(mA)}</select>
        <span class="quando" style="margin:0">comparado com</span>
        <select name="b" onchange="this.form.submit()" aria-label="Mês de comparação" style="width:auto">${optsMes(mB)}</select>
      </form>
      <div class="stats" style="margin:10px 0">
        ${tile(`Ativas no fim de ${esc(rotuloPeriodo(PA, 'mes', true))}${mesAtual ? ' (até hoje)' : ''}`, PA.fim, PB.fim, fmtN, false)}
        ${tile('Entraram', PA.e, PB.e, fmtN, false)}
        ${tile('Saíram', PA.s, PB.s, fmtN, true)}
        ${tile('Taxa de saída', taxa(PA), taxa(PB), fmtPct, true)}
      </div>
      <div class="ui-graf" data-graf="comp"></div>
      <p class="quando" style="margin:8px 0 0">Alunas ativas em cada dia do mês.${mesAtual ? ' O mês atual vai até hoje.' : ''}</p>
    </div>
    <div class="sec-t">${vis === 'mes' ? 'Mês a mês' : 'Semana a semana'}</div>
    <div class="card" style="overflow-x:auto">
      <table class="ui-tab"><thead><tr><th>${vis === 'mes' ? 'Mês' : 'Semana de'}</th><th>Início</th><th>Entraram</th><th>Saíram</th><th>Fim</th><th>Variação</th><th>Taxa de saída</th></tr></thead><tbody>${linhasTab}</tbody></table>
    </div>
    </div>
    <p class="ui-rodape"><b>Ativa</b> = contrato vigente no EVO; <b>trancada conta</b>; contrato ${((h.ignorados && h.ignorados.regra) || ['circuito', 'vip']).map(r => esc(String(r).toUpperCase())).join(' ou ')} e renovação ainda na fila <b>não contam</b>. Calculado pelos contratos (início, fim e cancelamento) de todas as clientes, inclusive ex-alunas — por isso dá para comparar com o passado. Renovação com até ${(h.reconstruido && h.reconstruido.tolerancia) || 7} dias de atraso não conta como saída. <b>Nova</b> = primeiro contrato; <b>voltou</b> = ex-aluna que voltou. <b>Taxa de saída</b> = saíram ÷ ativas no início. Atualizado todo dia às 05:25${ultimo ? ` (última: ${esc(fmtData(ultimo))})` : ''}.</p>
  </div>
  <style>
    .ui-graf{position:relative;width:100%}
    .ui-graf svg{display:block;width:100%;overflow:visible}
    .ui-graf .gt{position:absolute;pointer-events:none;background:var(--card);border:1px solid var(--linha);border-radius:10px;box-shadow:0 8px 24px -10px rgba(16,24,40,.35);padding:8px 10px;font-size:.8rem;min-width:150px;display:none;z-index:5}
    .ui-graf .gt .r{display:flex;align-items:center;gap:8px;margin-top:3px}
    .ui-graf .gt .k{width:14px;height:2px;border-radius:2px;flex:none}
    .ui-graf .gt b{font-variant-numeric:tabular-nums;color:var(--tinta)}
    .ui-graf .lg{display:flex;gap:16px;flex-wrap:wrap;font-size:.8rem;color:var(--cinza);margin:0 0 6px}
    .ui-graf .lg span{display:inline-flex;align-items:center;gap:6px}
    .ui-graf .lg i{width:16px;height:2px;border-radius:2px;display:inline-block}
  </style>
  <script>
  var DADOS={evol:${js(dadosEvol)},comp:${js(dadosComp)}};
  // Gráfico de linha desenhado na largura real (legível no celular) + cursor que
  // segue o mouse/dedo e mostra os valores de todas as séries naquele ponto.
  function grafLinha(el, d){
    var W=el.clientWidth||600, H=W<520?220:260, L=36, R=W<520?40:52, T=14, B=26, NS='http://www.w3.org/2000/svg';
    var n=d.rotulos.length, todos=[]; d.series.forEach(function(s){ s.valores.forEach(function(v){ if(v!=null) todos.push(v); }); });
    if(!todos.length){ el.textContent='Sem dados.'; return; }
    var mn=Math.min.apply(null,todos), mx=Math.max.apply(null,todos), span=Math.max(4,mx-mn);
    var passo=[1,2,5,10,20,25,50,100,200,500].find(function(p){ return span/p<=4; })||1000;
    var y0=Math.max(0,Math.floor((mn-span*.15)/passo)*passo), y1=Math.ceil((mx+span*.1)/passo)*passo; if(y1===y0) y1=y0+passo;
    var X=function(i){ return n<2?(L+W-R)/2:L+i*(W-L-R)/(n-1); }, Y=function(v){ return T+(y1-v)/(y1-y0)*(H-T-B); };
    el.innerHTML='';
    if(d.series.length>1){ var lg=document.createElement('div'); lg.className='lg'; d.series.forEach(function(s){ var sp=document.createElement('span'), k=document.createElement('i'); k.style.background=s.cor; sp.appendChild(k); sp.appendChild(document.createTextNode(s.nome)); lg.appendChild(sp); }); el.appendChild(lg); }
    var svg=document.createElementNS(NS,'svg'); svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('height',H); svg.setAttribute('role','img');
    svg.setAttribute('aria-label', d.series.map(function(s){ var u=null; s.valores.forEach(function(v){ if(v!=null) u=v; }); return s.nome+': '+u; }).join('; '));
    function add(tag, at){ var e=document.createElementNS(NS,tag); for(var k in at) e.setAttribute(k,at[k]); svg.appendChild(e); return e; }
    for(var v=y0; v<=y1; v+=passo){ add('line',{x1:L,x2:W-R,y1:Y(v),y2:Y(v),stroke:'#eeeef0','stroke-width':1}); var t=add('text',{x:L-8,y:Y(v)+4,'text-anchor':'end','font-size':11,fill:'#6e6e73'}); t.textContent=v; }
    var cada=Math.max(1,Math.ceil(n/(W<520?6:12)));
    for(var i=0;i<n;i++){ if(i%cada && i!==n-1) continue; var tx=add('text',{x:X(i),y:H-8,'text-anchor':'middle','font-size':11,fill:'#6e6e73'}); tx.textContent=d.rotulos[i]; }
    d.series.forEach(function(s){
      var pts=[]; s.valores.forEach(function(v,i){ if(v!=null) pts.push([X(i),Y(v),v]); }); if(!pts.length) return;
      var dd=pts.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1); }).join(' ');
      if(d.area && d.series.length===1) add('path',{d:dd+' L'+pts[pts.length-1][0].toFixed(1)+' '+(H-B)+' L'+pts[0][0].toFixed(1)+' '+(H-B)+' Z',fill:s.cor,'fill-opacity':.1});
      add('path',{d:dd,fill:'none',stroke:s.cor,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'});
      var u=pts[pts.length-1]; add('circle',{cx:u[0],cy:u[1],r:4.5,fill:s.cor,stroke:'#fff','stroke-width':2});
      var lb=add('text',{x:u[0]+8,y:u[1]+4,'font-size':12,'font-weight':700,fill:'#1d1d1f'}); lb.textContent=u[2];
    });
    var cruz=add('line',{x1:0,x2:0,y1:T,y2:H-B,stroke:'#9a9aa0','stroke-width':1,visibility:'hidden'});
    el.appendChild(svg);
    var tip=document.createElement('div'); tip.className='gt'; el.appendChild(tip);
    function mostra(cx){
      var r=svg.getBoundingClientRect(), x=(cx-r.left)*W/r.width, i=n<2?0:Math.round((x-L)/((W-L-R)/(n-1))); i=Math.max(0,Math.min(n-1,i));
      cruz.setAttribute('x1',X(i)); cruz.setAttribute('x2',X(i)); cruz.setAttribute('visibility','visible');
      tip.innerHTML=''; var tt=document.createElement('div'); tt.style.cssText='font-weight:700;margin-bottom:2px'; tt.textContent=d.longos[i]; tip.appendChild(tt);
      d.series.forEach(function(s){ var row=document.createElement('div'); row.className='r'; var k=document.createElement('span'); k.className='k'; k.style.background=s.cor; var b=document.createElement('b'); b.textContent=s.valores[i]==null?'—':s.valores[i]; var nm=document.createElement('span'); nm.style.color='#6e6e73'; nm.textContent=s.nome; row.appendChild(k); row.appendChild(b); row.appendChild(nm); tip.appendChild(row); });
      if(d.extra){ var ex=document.createElement('div'); ex.style.cssText='margin-top:4px;color:#6e6e73'; ex.textContent=d.extra[i]; tip.appendChild(ex); }
      tip.style.display='block'; var px=X(i)*r.width/W, lw=tip.offsetWidth; tip.style.left=Math.max(0,Math.min(r.width-lw, px+12 + (px+12+lw>r.width ? -lw-24 : 0)))+'px'; tip.style.top=(r.top-el.getBoundingClientRect().top+8)+'px';
    }
    svg.addEventListener('pointermove',function(e){ mostra(e.clientX); });
    svg.addEventListener('pointerleave',function(){ tip.style.display='none'; cruz.setAttribute('visibility','hidden'); });
  }
  function desenhar(){ [].forEach.call(document.querySelectorAll('.ui-graf[data-graf]'),function(el){ if(el.offsetParent!==null) grafLinha(el, DADOS[el.getAttribute('data-graf')]); }); }
  desenhar(); var tr; window.addEventListener('resize',function(){ clearTimeout(tr); tr=setTimeout(desenhar,150); });
  document.addEventListener('toggle',function(e){ if(e.target.tagName==='DETAILS' && e.target.open) desenhar(); },true);
  </script>`;
  return chrome({ tab: 'Alunas ativas' }, 'ativas', corpo);
}

function paginaProfessoras(params) {
  params = params || {};
  const h = histExp.ler();
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const menosDias = (n) => { const d = new Date(hojeStr + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };
  const custom = !!(params.de || params.ate);
  const per = custom ? '' : (['30', '90', 'ano', '0'].includes(params.per) ? params.per : '30');
  let iniD = '', fimD = hojeStr, rotulo = '';
  if (custom) { iniD = params.de || ''; fimD = params.ate || hojeStr; rotulo = `${params.de || 'início'} até ${fimD}`; }
  else if (per === '30') { iniD = menosDias(29); rotulo = 'últimos 30 dias'; }
  else if (per === '90') { iniD = menosDias(89); rotulo = 'últimos 90 dias'; }
  else if (per === 'ano') { iniD = hojeStr.slice(0, 4) + '-01-01'; rotulo = 'em ' + hojeStr.slice(0, 4); }
  else rotulo = 'todo o histórico';
  const dentro = (dia) => dia && (!iniD || dia >= iniD) && (!fimD || dia <= fimD);

  // Cada aluna do EVO ↔ contato do CRM (pelo nome inteiro; ou 1º + último nome se
  // for uma pessoa só). Do contato vêm: a tag de aluna (fechou depois que a linha
  // saiu da janela relida no EVO), o link de Contatos e quando/onde agendou.
  let tAluna = '0. Aluna'; try { tAluna = String(autoTagAlunas.ler().tagAluna || tAluna).trim(); } catch (_) {}
  let cs = {}; try { cs = contatos.carregar() || {}; } catch (_) {}
  const porNome = new Map();
  for (const t in cs) { const c = cs[t]; if (!c || !c.nome) continue; histExp.chavesNome(c.nome).forEach((k, i) => { const kk = (i ? '~' : '=') + k; (porNome.get(kk) || porNome.set(kk, new Set()).get(kk)).add(t); }); }
  const acharContato = (nome) => {
    const ks = histExp.chavesNome(nome);
    let set = ks.length ? porNome.get('=' + ks[0]) : null;
    if (!set && ks[1]) set = porNome.get('~' + ks[1]);
    if (!set || set.size !== 1) return null;
    const tel = [...set][0];
    return { tel, c: cs[tel] };
  };
  let tagLogMap = {}; try { tagLogMap = sofia.lerTagLog() || {}; } catch (_) {}
  let agTags = []; try { agTags = contatos.tagsPorGatilho('agendou').map(a => String(a.tag || '').trim()); } catch (_) {}
  // Último agendamento (tag de "agendou") ANTES ou no dia da aula → { em, canal }.
  const agendouAntes = (tel, dia) => {
    let ult = null;
    for (const e of (tagLogMap[String(tel).replace(/\D/g, '').slice(-8)] || [])) {
      if (e.acao !== 'add' || !(e.motivo === 'agendou' || agTags.includes(String(e.tag || '').trim())) || !e.em) continue;
      const d = new Date(e.em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      if (d <= dia && (!ult || e.em > ult.em)) ult = { em: e.em, canal: e.canal };
    }
    return ult;
  };

  // Contratos de cada cliente no EVO (gravados pela tela Alunas ativas, sem
  // circuito/VIP): mostram QUAL contrato ela fechou depois da aula e pegam quem
  // JÁ ERA aluna (contrato vigente antes da aula, lançada como experimental).
  const pessoasEvo = (() => { try { return lerAtivasHist().pessoas || null; } catch (_) { return null; } })();
  const evoPorNome = new Map();
  if (pessoasEvo) for (const [id, pe] of Object.entries(pessoasEvo)) {
    if (!pe || !pe.n || (!pe.nc && !/\s/.test(pe.n.trim()))) continue; // só o 1º nome não identifica ninguém
    histExp.chavesNome(pe.n).forEach((k, i) => { const kk = (i ? '~' : '=') + k; (evoPorNome.get(kk) || evoPorNome.set(kk, new Set()).get(kk)).add(id); });
  }
  const acharEvo = (nome, ct) => {
    const id = ct && ct.c && ct.c.idEvo ? String(ct.c.idEvo) : '';
    if (id && pessoasEvo[id]) return { id, pe: pessoasEvo[id] };
    const ks = histExp.chavesNome(nome);
    let set = ks.length ? evoPorNome.get('=' + ks[0]) : null;
    if (!set && ks[1]) set = evoPorNome.get('~' + ks[1]);
    if (!set || set.size !== 1) return id ? { id, pe: null } : null;
    const k = [...set][0];
    return { id: k, pe: pessoasEvo[k] };
  };
  const somaDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  // → { sit: 'fechou' | 'jaaluna' | null (segue a presença), contrato, idEvo }
  const resultado = (a, sit, ct) => {
    const agendaOk = !!a.contrato && !contratoIgnorado(a.contrato);
    const ev = pessoasEvo ? acharEvo(a.nome, ct) : null;
    if (ev && ev.pe && (ev.pe.cs || []).length) {
      const cs = ev.pe.cs, D = a.dia, tol = somaDias(D, -3);
      const antes = cs.find(c => c[0] < tol && c[1] >= D);       // contrato rodando no dia da aula
      if (antes) return { sit: 'jaaluna', contrato: antes[2], idEvo: ev.id };
      const novo = cs.find(c => c[0] >= tol && c[0] <= somaDias(D, 120)); // começou depois da aula
      if (novo && sit === 'veio') return { sit: 'fechou', contrato: novo[2], idEvo: ev.id };
      return { sit: sit === 'veio' && agendaOk ? 'fechou' : null, contrato: sit === 'veio' && agendaOk ? a.contrato : '', idEvo: ev.id };
    }
    if (ev && pessoasEvo) {
      // está no EVO mas nunca teve contrato do método: só a agenda decide
      return { sit: sit === 'veio' && agendaOk ? 'fechou' : null, contrato: sit === 'veio' && agendaOk ? a.contrato : '', idEvo: ev.id };
    }
    // sem histórico de contratos: agenda do EVO ou a tag de aluna no CRM
    const fechou = sit === 'veio' && !contratoIgnorado(a.contrato) && (!!a.contrato || !!(ct && ct.c && (ct.c.tags || []).includes(tAluna)));
    return { sit: fechou ? 'fechou' : null, contrato: fechou ? a.contrato : '', idEvo: '' };
  };

  // Professora lançada como aluna na agenda de experimentais (ex.: testando a aula):
  // quem tem o nome de uma professora não entra na lista nem na conta.
  const chavesProf = new Set();
  for (const a of Object.values(h.aulas)) if (a.prof) histExp.chavesNome(a.prof).forEach(k => chavesProf.add(k));
  const profsCompletos = [...new Set(Object.values(h.aulas).map(a => (histExp.chavesNome(a.prof)[0] || '')).filter(k => k.includes(' ')))];
  const ehProfessora = (nome) => {
    const ks = histExp.chavesNome(nome);
    if (!ks.length || !ks[0].includes(' ')) return false; // só o 1º nome não basta
    return ks.some(k => chavesProf.has(k)) || profsCompletos.some(pk => pk.startsWith(ks[0] + ' ') || ks[0].startsWith(pk + ' '));
  };
  let profComoAluna = 0;

  const SEM = '— sem professora';
  const profs = {}, horas = {};
  const tot = { exp: 0, veio: 0, faltou: 0, agendada: 0, fechou: 0, jaaluna: 0 };
  for (const a of Object.values(h.aulas)) {
    if (!dentro(a.dia)) continue;
    const sit = histExp.situacao(a.status);
    if (sit === 'cancelada') continue;
    if (ehProfessora(a.nome)) { profComoAluna++; continue; }
    const ct = acharContato(a.nome);
    const res = resultado(a, sit, ct);
    const fechou = res.sit === 'fechou';
    const p = a.prof || SEM;
    // já era aluna (contrato vigente no dia — ex.: aula de evento): não é
    // experimental de verdade — não aparece nem entra na conta
    if (res.sit === 'jaaluna') { tot.jaaluna++; continue; }
    const r = profs[p] || (profs[p] = { prof: p, exp: 0, veio: 0, faltou: 0, agendada: 0, fechou: 0, alunas: [] });
    const idEvo = res.idEvo || (ct && ct.c ? ct.c.idEvo : '');
    r.alunas.push({ nome: a.nome, dia: a.dia, hora: a.hora, sit: res.sit || sit, contrato: res.contrato, tel: ct ? ct.tel : '', idEvo });
    r.exp++; r[sit]++; if (fechou) r.fechou++;
    tot.exp++; tot[sit]++; if (fechou) tot.fechou++;
    if (sit === 'veio' && a.hora) {
      const hr = horas[a.hora] || (horas[a.hora] = { hora: a.hora, veio: 0, fechou: 0, profs: {} });
      hr.veio++; if (fechou) hr.fechou++; hr.profs[p] = (hr.profs[p] || 0) + 1;
    }
  }
  const POUCAS = 5; // menos que isso de aulas feitas: o % ainda não diz muito
  const taxa = (n, d) => d ? Math.round(n * 1000 / d) / 10 : null;
  const fmtPct = (v) => v == null ? '—' : String(v).replace('.', ',').replace(/,0$/, '') + '%';
  const lista = Object.values(profs).sort((a, b) => (b.veio >= POUCAS) - (a.veio >= POUCAS) || (taxa(b.fechou, b.veio) || 0) - (taxa(a.fechou, a.veio) || 0) || b.veio - a.veio);
  const fmtDia = (d) => { const p = String(d).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : d; };
  const DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const fmtAula = (x) => `${DS[new Date(x.dia + 'T12:00:00').getDay()]} ${fmtDia(x.dia)}${x.hora ? ' às ' + esc(x.hora) : ''}`;
  const fmtDtCurta = (ms) => { try { return new Date(Number(ms)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const ROT_CANAL = { sofia: '🤖 SoFIA', formulario: '📲 Formulário', express: '🏪 Express' };
  const EVO_LINK = (process.env.EVO_LINK_URL || 'https://evo5.w12app.com.br').replace(/\/+$/, '');
  const ordemSit = { fechou: 0, veio: 1, faltou: 2, agendada: 3, jaaluna: 4 };

  const barraConv = (r) => uiTrilho(r.fechou, r.veio, { cor: r.veio < POUCAS ? 'var(--faint)' : 'var(--ok)' });
  const linhaAluna = (x) => {
    const ag = x.tel ? agendouAntes(x.tel, x.dia) : null;
    return uiPessoa({
      nome: x.nome, sit: x.sit,
      href: x.tel ? '/sofia?view=contatos&q=' + String(x.tel).replace(/\D/g, '').slice(-8) : '/sofia?view=contatos&q=' + encodeURIComponent(x.nome),
      evo: x.idEvo ? `${EVO_LINK}/${config.evo.appBase}/clientes/cadastro/${x.idEvo}//perfil` : '',
      meta: [
        ag ? `📅 Agendou <b>${esc(fmtDtCurta(ag.em))}</b>` : '',
        ag && ROT_CANAL[ag.canal] ? ROT_CANAL[ag.canal] : '',
        `🏋️ Aula <b>${fmtAula(x)}</b>`,
        x.contrato ? `📄 ${esc(x.contrato)}` : '',
      ],
    });
  };
  const linhaProf = (r) => {
    const poucas = r.veio < POUCAS;
    const alunas = r.alunas.sort((a, b) => ordemSit[a.sit] - ordemSit[b.sit] || b.dia.localeCompare(a.dia)).map(linhaAluna).join('');
    return `<details class="pf-item">
      <summary class="pf-row">
        <span class="pf-nome"><span class="pf-seta">▸</span>${esc(r.prof)}${poucas ? ' <span class="pf-poucas">poucas aulas</span>' : ''}</span>
        ${barraConv(r)}
        <span class="pf-nums"><b>${r.fechou}</b> de <b>${r.veio}</b> <span>fecharam</span></span>
      </summary>
      <div class="pf-det">
        <div class="pf-resumo"><span>📋 <b>${r.exp}</b> experimenta${r.exp === 1 ? 'l' : 'is'}</span><span>✅ <b>${r.veio}</b> vieram</span><span>❌ <b>${r.faltou}</b> faltaram</span>${r.agendada ? `<span>⏳ <b>${r.agendada}</b> agendada${r.agendada === 1 ? '' : 's'}</span>` : ''}<span>presença <b>${fmtPct(taxa(r.veio, r.veio + r.faltou))}</b></span><span>💰 <b>${r.fechou}</b> fecharam</span></div>
        <div class="ip-lista">${alunas}</div>
      </div>
    </details>`;
  };
  const horasLista = Object.values(horas).sort((a, b) => a.hora.localeCompare(b.hora));
  const tabHoras = horasLista.length ? `<div class="card" style="overflow-x:auto"><table class="pf-tab"><thead><tr><th>Horário</th><th>Vieram</th><th>Fecharam</th><th>Conversão</th><th>Professoras</th></tr></thead><tbody>${horasLista.map(x => `<tr><td><b>${esc(x.hora)}</b></td><td>${x.veio}</td><td>${x.fechou}</td><td><b style="color:${x.veio < POUCAS ? 'var(--cinza)' : 'var(--ok)'}">${fmtPct(taxa(x.fechou, x.veio))}</b></td><td class="quando">${Object.entries(x.profs).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${esc(p === SEM ? 'sem professora' : p.split(' ')[0])} (${n})`).join(', ')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card"><div class="vazio">Sem aulas feitas no período.</div></div>';

  // Situação da leitura no EVO.
  const st = h.status || {};
  const lidos = Object.keys(h.lidos || {}).sort();
  const rodando = st.estado === 'executando' && Date.now() - (st.inicio || 0) < 60 * 60 * 1000;
  const fmtQuando = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const fmtBR = (iso) => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };
  const situacaoLeitura = rodando ? `⏳ Lendo a agenda no EVO agora (começou ${esc(fmtQuando(st.inicio))}) — leva uns 15 a 20 min. Atualize a página depois.`
    : st.estado === 'erro' ? `⚠️ A última leitura falhou (${esc(fmtQuando(st.fim))}): ${esc(st.msg || '')}`
    : lidos.length ? `📚 Histórico de <b>${esc(fmtBR(lidos[0]))}</b> até <b>${esc(fmtBR(lidos[lidos.length - 1]))}</b>${st.fim ? ` · última leitura ${esc(fmtQuando(st.fim))}` : ''}. O robô relê a agenda toda madrugada.`
    : 'Ainda sem dados. Toda madrugada o robô copia a agenda de experimentais do EVO. Para não esperar, clique em “Ler agora no EVO”.';
  const btnAtualizar = `<form method="POST" action="/professoras/atualizar" style="margin:0"><button class="ui-btn sec" type="submit" ${rodando ? 'disabled' : ''}>🔄 Ler agora no EVO</button></form>`;
  // Até onde buscar para trás (padrão 90 dias): 60 dias antigos por madrugada; "Ler agora" adianta 30.
  const desde = h.cfg.desde || '';
  const pend = histExp.antigosPendentes(h).length;
  const inicioPadrao = menosDias(histExp.HISTORICO_PADRAO - 1);
  const noites = Math.ceil(pend / 60);
  const blocoDesde = `<form method="POST" action="/professoras/desde" class="ui-linha ui-datas"><span class="ui-lbl">Histórico</span>
      <span class="ate">buscar no EVO desde</span><input type="date" name="desde" value="${esc(desde || inicioPadrao)}" max="${esc(hojeStr)}" min="2020-01-01" aria-label="Buscar desde">
      <button class="ui-btn sec" type="submit">Salvar</button>
      <span class="quando">${pend ? `Faltam <b>${pend}</b> dia${pend === 1 ? '' : 's'} antigo${pend === 1 ? '' : 's'} — o robô lê 60 por madrugada (≈ ${noites} noite${noites === 1 ? '' : 's'}); “Ler agora” adianta 30.` : `Completo desde ${esc(fmtBR(desde || inicioPadrao))}.`}</span></form>`;

  const corpo = `<div class="wrap">
    ${subnavIndicadores('professoras')}
    ${uiTopo({
      titulo: 'Conversão por professora',
      sub: 'Das alunas que fizeram a aula experimental com cada professora, quantas fecharam contrato. Vem da agenda de experimentais do EVO.',
      acoes: btnAtualizar,
      linhas: [
        uiChips('Período', [['30', '30 dias'], ['90', '90 dias'], ['ano', hojeStr.slice(0, 4)], ['0', 'Tudo']].map(([v, l]) => [`/professoras?per=${v}`, l, !custom && per === v])),
        uiDatas({ action: '/professoras', de: params.de, ate: params.ate, limpar: custom ? '/professoras' : '' }),
        blocoDesde,
        `<div class="ui-nota${st.estado === 'erro' && !rodando ? ' erro' : ''}"><span>${situacaoLeitura}</span></div>`,
      ],
    })}
    ${tot.exp ? `<div class="stats">
      <div class="stat tot"><div class="n">${tot.exp}</div><div class="l">experimentais · ${esc(rotulo)}</div></div>
      <div class="stat"><div class="n" style="color:var(--teal-esc)">${tot.veio}</div><div class="l">vieram · presença ${fmtPct(taxa(tot.veio, tot.veio + tot.faltou))}</div></div>
      <div class="stat ok"><div class="n">${tot.fechou}</div><div class="l">fecharam contrato</div></div>
      <div class="stat"><div class="n" style="color:var(--coral-esc)">${fmtPct(taxa(tot.fechou, tot.veio))}</div><div class="l">conversão do Studio (de quem veio)</div></div>
    </div>
    <div class="ui-secoes">
    <div class="sec-t">Por professora</div>
    <div class="card">
      ${lista.map(linhaProf).join('')}
      <p class="quando" style="margin:12px 0 0">A barra é a <b>conversão</b>: de quem fez a aula com ela, quantas fecharam. Clique na professora para ver as alunas. Em cinza: menos de ${POUCAS} aulas no período — o % ainda muda muito com uma aluna a mais ou a menos.</p>
    </div>
    <div class="sec-t">Por horário da aula</div>
    ${tabHoras}
    </div>
    <p class="ui-rodape">A conversão não depende só da professora: horário, quem atendeu na recepção e preço também pesam. Use o número para conversar, não para julgar. <b>Fechou</b> = começou um contrato no EVO depois da aula (até 120 dias; pelos contratos lidos em Alunas ativas) ou “Nome do contrato” preenchido na agenda de experimentais${pessoasEvo ? '' : `, ou a aluna já tem a tag <b>${esc(tAluna)}</b>`}. Contratos ${esc(String(process.env.ATIVAS_IGNORAR_CONTRATOS || 'circuito,vip').toUpperCase().split(',').join(' e '))} não contam. Quem <b>já era aluna</b> no dia da aula (contrato vigente — ex.: aula de evento) não aparece nem entra na conta. Aulas canceladas não entram, nem professora lançada como aluna${profComoAluna ? ` (${profComoAluna} no período)` : ''}.</p>`
    : `<div class="card"><div class="vazio">${lidos.length ? 'Nenhuma aula experimental registrada neste período.' : 'Ainda sem histórico. Clique em “Ler agora no EVO” ou espere a leitura desta madrugada.'}</div></div>`}
    <style>
      .pf-item{border-bottom:1px solid var(--linha-soft)}
      .pf-item:last-of-type{border-bottom:0}
      .pf-row{display:flex;align-items:center;gap:14px;padding:12px 6px;cursor:pointer;list-style:none;border-radius:10px}
      .pf-row::-webkit-details-marker{display:none}
      .pf-row:hover{background:var(--linha-soft)}
      .pf-row:focus{outline:none}
      .pf-row:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
      .pf-seta{display:inline-block;width:14px;color:var(--teal);font-weight:900;transition:transform .15s}
      .pf-item[open] .pf-seta{transform:rotate(90deg)}
      .pf-nome{width:200px;flex:none;font-weight:700;color:var(--tinta);font-size:.92rem}
      .pf-poucas{display:inline-block;font-size:.66rem;font-weight:700;color:var(--cinza);border:1px solid var(--linha);border-radius:999px;padding:1px 7px;margin-left:4px;vertical-align:middle}
      .pf-nums{width:150px;flex:none;text-align:right;font-variant-numeric:tabular-nums;font-size:.86rem;color:var(--tinta)}
      .pf-nums span{color:var(--cinza)}
      .pf-det{margin:0 6px 12px 20px;padding:4px 14px;border-left:3px solid var(--teal-soft)}
      .pf-resumo{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.8rem;color:var(--cinza);padding:6px 0 8px;border-bottom:1px solid var(--linha-soft)}
      .pf-resumo b{color:var(--tinta)}
      .pf-tab{width:100%;border-collapse:collapse;font-size:.86rem;font-variant-numeric:tabular-nums}
      .pf-tab th{text-align:left;font-size:.74rem;color:var(--cinza);font-weight:700;padding:6px 8px;border-bottom:1px solid var(--linha)}
      .pf-tab td{padding:7px 8px;border-bottom:1px solid var(--linha-soft)}
      @media(max-width:600px){.pf-row{flex-wrap:wrap;row-gap:6px}.pf-nome{width:100%}.pf-nums{width:auto}.pf-det{margin-left:6px;padding:4px 8px}}
    </style>
  </div>`;
  return chrome({ tab: 'Professoras' }, 'professoras', corpo);
}

// ── Página: Saúde do sistema (admin) ────────────────────────────────────────
// Reúne num só lugar o estado de cada serviço: robô, SoFIA, painel, Instagram e
// formulário — cada um com um selo (OK / atenção / problema) e quando foi visto.
function fmtIdadeSaude(ts) {
  if (!ts) return { txt: 'sem registro', min: Infinity };
  const ms = Date.now() - new Date(ts).getTime();
  if (!isFinite(ms) || ms < 0) return { txt: 'agora mesmo', min: 0 };
  const min = Math.round(ms / 60000);
  if (min < 1) return { txt: 'agora mesmo', min: 0 };
  if (min < 60) return { txt: 'há ' + min + ' min', min };
  if (min < 1440) return { txt: 'há ' + Math.round(min / 60) + 'h', min };
  return { txt: 'há ' + Math.round(min / 1440) + ' dia' + (min < 2880 ? '' : 's'), min };
}
function paginaSaude(list, extra = {}) {
  const proc = (n) => {
    if (!Array.isArray(list)) return null;
    const p = list.find(x => x && x.name === n);
    if (!p) return { existe: false };
    const e = p.pm2_env || {};
    return { existe: true, online: e.status === 'online', status: e.status || '?', restarts: e.restart_time || 0, uptime: e.pm_uptime ? Date.now() - e.pm_uptime : 0 };
  };
  const upTxt = (ms) => { if (!ms || ms < 0) return '—'; const h = ms / 3600000; return h < 1 ? Math.round(ms / 60000) + ' min' : (h < 48 ? h.toFixed(1) + 'h' : Math.round(h / 24) + ' dias'); };
  const procLinha = (pr) => !pr ? '<span class="sd-muted">não consegui consultar o PM2 (pm2 jlist)</span>'
    : !pr.existe ? '<span class="sd-muted">não aparece no PM2 — rode <code>pm2 resurrect</code></span>'
      : `processo <b>${pr.online ? 'online' : pr.status}</b> · no ar há ${upTxt(pr.uptime)} · ${pr.restarts} reinício${pr.restarts === 1 ? '' : 's'}`;
  const procCor = (pr) => (!pr || !pr.existe || !pr.online) ? 'erro' : 'ok';

  const card = (nome, cor, pill, linhas) => `<div class="card sd-card">
      <div class="sd-top"><h3>${esc(nome)}</h3><span class="sd-pill sd-${cor}">${pill}</span></div>
      ${linhas.filter(Boolean).map(l => `<div class="sd-line">${l}</div>`).join('')}
    </div>`;
  const pior = (a, b) => (a === 'erro' || b === 'erro') ? 'erro' : ((a === 'warn' || b === 'warn') ? 'warn' : 'ok');
  const pillTxt = { ok: '🟢 OK', warn: '🟡 Atenção', erro: '🔴 Problema' };

  // Robô de mensagens (slimfit-exp) + WhatsApp do robô.
  const pExp = proc(PM2_EXP);
  const waR = (() => { try { return waStatus.get() || {}; } catch (_) { return {}; } })();
  const waRid = fmtIdadeSaude(waR.atualizadoEm);
  const waRcor = waR.estado === 'conectado' ? 'ok' : (waR.estado === 'qr' || waR.estado === 'desconectado') ? 'erro' : 'warn';
  const corExp = pior(procCor(pExp), procCor(pExp) === 'ok' ? waRcor : 'ok');
  const cardExp = card('Robô de mensagens', corExp, pillTxt[corExp], [
    procLinha(pExp),
    `WhatsApp do robô: <b>${esc(waR.estado || 'sem informação')}</b> <span class="sd-muted">(atualizado ${waRid.txt})</span>`,
  ]);

  // SoFIA (sofia-listener) + WhatsApp da SoFIA.
  const pSof = proc(PM2_SOFIA);
  const waS = (() => { try { return sofia.waStatus() || {}; } catch (_) { return {}; } })();
  const waSid = fmtIdadeSaude(waS.atualizadoEm);
  const waScor = waS.estado === 'conectado' ? 'ok' : (waS.estado === 'qr' || waS.estado === 'desconectado') ? 'erro' : 'warn';
  const corSof = pior(procCor(pSof), procCor(pSof) === 'ok' ? waScor : 'ok');
  const cardSof = card('SoFIA (chatbot)', corSof, pillTxt[corSof], [
    procLinha(pSof),
    `WhatsApp da SoFIA: <b>${esc(waS.estado || 'sem informação')}</b> <span class="sd-muted">(atualizado ${waSid.txt})</span>`,
  ]);

  // (O próprio painel não entra aqui: se estivesse fora do ar, esta página nem
  // carregaria — então mostrá-lo seria redundante.)

  // Instagram — ligado/pausado + saúde da sessão na última execução.
  let igLig = false; try { igLig = igcfg.ligado(); } catch (_) {}
  const sessIg = lerJsonData('instagram-sessao.json');
  const igId = fmtIdadeSaude(sessIg && sessIg.em);
  const corIg = !igLig ? 'warn' : (sessIg ? (sessIg.ok ? 'ok' : 'erro') : 'warn');
  const cardIg = card('Instagram', corIg, !igLig ? '🟡 Pausado' : pillTxt[corIg], [
    igLig ? 'Envio de boas-vindas <b>ligado</b>.' : 'Envio de boas-vindas <b>pausado</b>.',
    sessIg ? `Sessão ${sessIg.ok ? '<b>ativa</b>' : '<b>caiu</b> (reimporte os cookies)'} <span class="sd-muted">(verificada ${igId.txt})</span>` : '<span class="sd-muted">sessão ainda não verificada por uma execução</span>',
  ]);

  // Formulário (Render) — não dá para medir o Render daqui; usamos o último
  // acesso registrado como sinal de vida do fluxo.
  let ultAcesso = null; try { const rr = indicadores.resumo(0); ultAcesso = rr.ultimoAcesso || null; } catch (_) {}
  const fId = fmtIdadeSaude(ultAcesso);
  // Grade viva no formulário (checada com timeout curto na rota /saude).
  const grade = extra.grade || null;
  const gradeLinha = !grade ? '<span class="sd-muted">Grade: não verificada nesta carga.</span>'
    : grade.timeout ? '<span class="sd-muted">Grade: não deu para verificar agora (o formulário pode estar “dormindo” no Render).</span>'
      : grade.presente ? '✅ Grade do VPS <b>presente</b> no formulário.'
        : grade.respondeu ? `⚠️ Formulário respondeu, mas <b>sem a grade do VPS</b> (fonte: ${esc(grade.fonte || 'nenhuma')}) — o VPS reenvia sozinho em até 2 min.`
          : '<span class="sd-muted">Grade: o formulário não respondeu.</span>';
  const corForm = (grade && grade.respondeu && !grade.presente) ? 'warn' : 'ok';
  const cardForm = card('Formulário de agendamento', corForm, corForm === 'warn' ? '🟡 Atenção' : '🟢 Publicado', [
    'Hospedado no Render (deploy automático pelo GitHub).',
    gradeLinha,
    ultAcesso ? `Último acesso registrado <b>${fId.txt}</b>.` : '<span class="sd-muted">ainda sem acessos registrados no período.</span>',
    '<span class="sd-muted">Obs.: o status do servidor do Render é consultado no painel do Render, não aqui.</span>',
  ]);

  // Termômetro da migração LID do WhatsApp (número × LID). Fica verde enquanto
  // todo LID atendido tem o telefone recuperável; amarelo se aparecerem LIDs sem
  // telefone (sinal de que o WhatsApp começou a esconder o número).
  let lidS = null; try { lidS = sofia.lerLidStats(); } catch (_) {}
  // Atenção só quando os LIDs sem telefone CRESCEM (5+ e algum nas últimas 2 semanas).
  // Um caso isolado (ex.: 1 entre centenas) é normal e não acende o alerta.
  const LID_ALERTA = 5;
  const lidRecente = !!(lidS && lidS.ultimoSemTelEm && Date.now() - lidS.ultimoSemTelEm < 14 * 86400000);
  const corLid = (lidS && lidS.semTel >= LID_ALERTA && lidRecente) ? 'warn' : 'ok';
  const lidId = (lidS && lidS.ultimoSemTelEm) ? fmtIdadeSaude(lidS.ultimoSemTelEm) : null;
  const cardLid = card('Identidade WhatsApp (número × LID)', corLid, corLid === 'warn' ? '🟡 Atenção' : '🟢 OK', [
    lidS ? `📇 Contatos com telefone <b>recuperado a partir do LID</b>: <b>${lidS.mapeados}</b>.` : '<span class="sd-muted">ainda sem dados — a SoFIA registra conforme atende.</span>',
    lidS && lidS.semTel > 0 && corLid === 'ok'
      ? `ℹ️ ${lidS.semTel} LID${lidS.semTel === 1 ? '' : 's'} sem telefone recuperável${lidId ? ` <span class="sd-muted">(último ${lidId.txt})</span>` : ''} — ${lidS.semTel < LID_ALERTA ? 'caso isolado' : 'nenhum nas últimas 2 semanas'}, não preocupa. O alerta acende com ${LID_ALERTA}+ casos e algum recente.`
      : lidS && lidS.semTel > 0
      ? `⚠️ LIDs <b>sem telefone recuperável</b>: <b>${lidS.semTel}</b>${lidId ? ` <span class="sd-muted">(último ${lidId.txt})</span>` : ''}. Se este número <b>crescer</b>, é sinal de que o WhatsApp começou a esconder o telefone no 1‑a‑1.`
      : (lidS ? '✅ Todo LID atendido teve o telefone recuperado.' : ''),
    '<span class="sd-muted">A SoFIA já lê e envia com o formato LID; aqui é só o termômetro dessa transição.</span>',
  ]);

  // ── EVO — login / 2FA ────────────────────────────────────────────────────
  const totp = !!(process.env.EVO_TOTP_SECRET || '').trim();
  const painelFb = String(process.env.EVO_2FA_PAINEL || '').toLowerCase() === 'true' || totp;
  // Só é "código pendente" se o robô está esperando AGORA: o pedido tem uma janela
  // (expiraEm). Arquivo velho/expirado é resquício (ex.: teste antigo) → não alarma.
  let pend2fa = false;
  try {
    const evott = require('./evo-totp');
    if (fs.existsSync(evott.PEDIDO_FILE)) {
      const ped = JSON.parse(fs.readFileSync(evott.PEDIDO_FILE, 'utf8'));
      pend2fa = !!(ped && ped.expiraEm && ped.expiraEm > Date.now());
    }
  } catch (_) {}
  const corEvo = pend2fa ? 'erro' : 'ok';
  const cardEvo = card('EVO — login / 2FA', corEvo, pend2fa ? '🔴 Ação necessária' : (totp ? '🟢 Automático' : (painelFb ? '🟡 Manual' : '🟢 OK')), [
    pend2fa
      ? '⚠️ <b>O robô está pedindo o código do EVO</b> — abra <b>WhatsApp → Configuração</b> e informe o código que chegou por e-mail.'
      : totp ? '2FA <b>automático</b> (autenticador/TOTP) configurado — o robô resolve sozinho, inclusive nos jobs de madrugada.'
        : painelFb ? '2FA <b>pelo painel</b> (sem autenticador): quando o EVO pedir, informe o código em WhatsApp → Configuração.'
          : '2FA <b>não configurado</b> — ok se o EVO desta unidade ainda não exige MFA.',
  ]);

  // ── Servidor (disco + backup) ────────────────────────────────────────────
  let disco = null;
  try { const st = fs.statfsSync(path.resolve(__dirname, '..')); const free = st.bavail * st.bsize, tot = st.blocks * st.bsize; if (tot > 0) disco = { pct: free / tot, freeGB: free / 1e9 }; } catch (_) {}
  let bkp = null;
  try {
    const dir = path.resolve(__dirname, '..', 'backups');
    const arr = fs.readdirSync(dir).filter(f => f.endsWith('.tar.gz')).map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    if (arr.length) bkp = { quando: arr[0].m, n: arr.length };
  } catch (_) {}
  const discoCor = !disco ? 'warn' : (disco.pct < 0.10 ? 'erro' : disco.pct < 0.20 ? 'warn' : 'ok');
  const diasBkp = bkp ? (Date.now() - bkp.quando) / 86400000 : Infinity;
  const bkpCor = !bkp ? 'warn' : (diasBkp > 2 ? 'warn' : 'ok');
  const corServ = pior(discoCor, bkpCor);
  const bId = bkp ? fmtIdadeSaude(bkp.quando) : null;
  const cardServ = card('Servidor', corServ, pillTxt[corServ], [
    disco ? `💾 Disco livre: <b>${(disco.pct * 100).toFixed(0)}%</b> (${disco.freeGB.toFixed(1)} GB)${disco.pct < 0.20 ? ' — <b>atenção</b>, libere espaço (caches/backups antigos).' : '.'}` : '<span class="sd-muted">💾 Não consegui medir o disco.</span>',
    bkp ? `🗄️ Último backup dos dados <b>${bId.txt}</b> (${bkp.n} cópia${bkp.n === 1 ? '' : 's'} guardada${bkp.n === 1 ? '' : 's'}).${diasBkp > 2 ? ' <b>Faz mais de 2 dias</b> — confira o cron do backup.' : ''}` : '<span class="sd-muted">🗄️ Sem backup em <code>backups/</code> — configure o cron do <code>backup-dados.js</code>.</span>',
  ]);

  // ── Envios automáticos: cada job agendado rodou no horário? falhou? ─────
  // O robô registra cada disparo/falha em data/jobs-disparos.json (jobs-batimento.js).
  const TIT_EXTRA = {
    aniversMesGrupo: 'Aniversariantes do mês (grupo da equipe)', renovacoesMesGrupo: 'Contratos a vencer no mês (grupo da equipe)',
    presentesPend: 'Presentes de tempo de casa pendentes', ausentes10: 'Ausentes há mais de 10 dias (grupo)',
    histExperimentais: 'Histórico de experimentais (professoras)', ativasFoto: 'Alunas ativas (leitura do EVO)',
    gradeFixas: 'Grade de fixas', slotsPushDia: 'Horários do formulário (dia)', slotsPushNoite: 'Horários do formulário (noite)',
    pagamentoSync: 'Pagamento dos professores (leitura do EVO)', freeAntecedencia: 'Planos FREE — antecedência',
  };
  let corJobs = 'ok', cardJobs = '';
  try {
    const titulos = Object.fromEntries(require('./horarios').CATALOGO.map(j => [j.chave, j.titulo]));
    const jobsAtv = require('./jobs-ativos');
    const sit = require('./jobs-batimento').situacao();
    const dh = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''); } catch (_) { return ''; } };
    if (!sit) {
      corJobs = 'warn';
      cardJobs = card('Envios automáticos', 'warn', '🟡 Sem dados', ['<span class="sd-muted">O robô ainda não registrou os horários dos envios. Depois de atualizar, reinicie o robô (<code>slimfit-atualizar</code> já faz isso).</span>']);
    } else {
      const nomeDe = (k) => titulos[k] || TIT_EXTRA[k] || k;
      const itens = sit.itens.filter(i => { try { return jobsAtv.ativo(i.chave); } catch (_) { return true; } })
        .sort((x, y) => nomeDe(x.chave).localeCompare(nomeDe(y.chave), 'pt-BR'));
      const falhas = itens.filter(i => i.estado === 'falhou'), perdidos = itens.filter(i => i.estado === 'perdeu');
      corJobs = falhas.length ? 'erro' : perdidos.length ? 'warn' : 'ok';
      const pill = falhas.length ? `🔴 ${falhas.length} com falha` : perdidos.length ? `🟡 ${perdidos.length} não rodou` : '🟢 Em dia';
      const linhaProb = (i) => i.estado === 'falhou'
        ? `🔴 <b>${esc(nomeDe(i.chave))}</b> — falhou em ${dh(i.falha.em)}: <span class="sd-muted">${esc(i.falha.msg)}</span>`
        : `🟡 <b>${esc(nomeDe(i.chave))}</b> — deveria ter rodado em <b>${dh(i.previsto)}</b> e não rodou${i.disparo ? ` <span class="sd-muted">(último disparo: ${dh(i.disparo)})</span>` : ''}`;
      const tabela = itens.map(i => `<tr><td>${i.estado === 'falhou' ? '🔴' : i.estado === 'perdeu' ? '🟡' : i.estado === 'aguardando' ? '⚪' : '🟢'} ${esc(nomeDe(i.chave))}</td><td class="sd-muted">${i.previsto ? dh(i.previsto) : '—'}</td><td class="sd-muted">${i.disparo ? dh(i.disparo) : 'ainda não'}</td></tr>`).join('');
      cardJobs = card('Envios automáticos', corJobs, pill, [
        `${itens.length} envio(s) ligado(s) conferido(s): ${itens.length - falhas.length - perdidos.length} em dia${perdidos.length ? `, <b>${perdidos.length} não rodou</b>` : ''}${falhas.length ? `, <b>${falhas.length} falhou</b>` : ''}.`,
        ...falhas.map(linhaProb), ...perdidos.map(linhaProb),
        (falhas.length || perdidos.length) ? '<span class="sd-muted">"Não rodou" = o robô estava fora do ar, travado ou reiniciou depois do horário. Para rodar agora, use <b>↻ Rodar de novo</b> no <a href="/hoje">Log</a> ou o envio de teste. Falhas somem do cartão no próximo horário do envio (ou depois de 24h).</span>' : '',
        `<details><summary class="sd-muted" style="cursor:pointer">Ver todos os horários</summary><div style="overflow-x:auto"><table style="width:100%;font-size:.84rem;margin-top:6px"><tr><th style="text-align:left">Envio</th><th style="text-align:left">Último horário previsto</th><th style="text-align:left">Último disparo</th></tr>${tabela}</table></div><span class="sd-muted">Conferindo desde ${dh(sit.desde)} · robô iniciado em ${dh(sit.boot)}.</span></details>`,
      ]);
    }
  } catch (_) { cardJobs = ''; corJobs = 'ok'; }
  cardJobs = cardJobs.replace('class="card sd-card"', 'class="card sd-card" style="grid-column:1/-1"'); // cartão largo (lista de envios)

  E._saudeCor = { cor: [corExp, corSof, corEvo, corForm, corServ, corLid, corJobs].concat(IG_NO_PAINEL ? [corIg] : []).reduce(pior, 'ok'), em: Date.now() };
  const corpo = `<div class="wrap">
    ${uiTopo({ titulo: 'Saúde do sistema', sub: 'O estado de cada parte da automação num lugar só: verde funcionando, amarelo atenção, vermelho com problema.', acoes: '<a href="/saude" class="ui-btn sec">↻ Atualizar</a>' })}
    <div class="sd-grid">${cardExp}${cardSof}${cardEvo}${IG_NO_PAINEL ? cardIg : ''}${cardForm}${cardServ}${cardLid}${cardJobs}</div>
  </div>`;
  return chrome({ tab: 'Saúde', h1: 'Saúde', p: 'Estado de robô, SoFIA, painel e formulário.' }, 'saude', corpo);
}

module.exports = {
  paginaIndicadores, subnavIndicadores, IND_CSS, _gradeSnapshot, paginaGrade, paginaSofiaFunil, MESES_CURTO, MESES_LONGO, rotuloPeriodo, contratoIgnorado, lerAtivasHist, ativasSerie, ativasPeriodos, ATIVAS_POR_PAG, paginaAtivasLista, paginaResumoMensal, paginaResumoSemanal, paginaAtivas, paginaProfessoras, fmtIdadeSaude, paginaSaude,
};

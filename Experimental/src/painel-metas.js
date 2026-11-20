/**
 * painel-metas.js — Indicadores → Metas (ritmo do mês e meses fechados) e
 * Indicadores → Dicionário (o que significa cada número).
 *
 * As contas e os arquivos ficam em metas.js; os números vêm das mesmas funções
 * das outras telas (Alunas ativas, Funil, Grade), para não existir uma segunda
 * versão de cada indicador.
 */
const metas = require('./metas');
const ativasDados = require('./ativas-dados');
const finResumo = require('./financeiro-resumo');
const dicionario = require('./dicionario-indicadores');
const atendimento = require('./atendimento');
const sofia = require('./sofia-editor');
const E = require('./painel-estado');
const { uiTopo, esc, chrome, infoI } = require('./painel-base');
const ind = require('./painel-indicadores');

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtInt = (n) => n == null || !isFinite(n) ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtBRL = (n) => n == null || !isFinite(n) ? '—' : 'R$ ' + fmtInt(n);
const fmtPct = (n) => n == null || !isFinite(n) ? '—' : String(Math.round(n * 10) / 10).replace('.', ',') + '%';
const fmtCampo = (c, v) => c.moeda ? fmtBRL(v) : c.pct ? fmtPct(v) : fmtInt(v);
const fmtDia = (iso) => { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ''; };
const nomeMes = (k, longo) => ativasDados.rotuloPeriodo({ k }, 'mes', longo !== false);
const taxaSaida = (p) => p && p.ini ? Math.round(p.s * 1000 / p.ini) / 10 : null;

// Números do Funil de um intervalo (todos os canais). null se o histórico de tags
// não cobre o começo do intervalo — "0 agendaram" seria falta de registro.
function funilDe(de, ate) {
  let n = null;
  const nav = E._navSess;
  try { n = ind.paginaSofiaFunil({ de, ate, _numeros: true }); } catch (_) { n = null; }
  E._navSess = nav;
  if (!n) return null;
  const ini = Date.parse(de + 'T23:59:59-03:00');
  if (!n.primeiroEvento || n.primeiroEvento > ini) return null;
  return { agendaram: n.agendaram, fez: n.fez, faltou: n.faltou, fechou: n.fechou, comparecimentoPct: n.comparecimentoPct, porCanal: n.porCanal, leads: n.leads };
}

// Custo de aquisição de um mês: anúncios (digitado em Metas) + IA (medido, em R$
// pela cotação guardada). `novas` = alunas com primeiro contrato no mês.
function custoDoMes(mes, funil, novas) {
  let usd = 0;
  try { for (const d of (sofia.lerCusto(100000).porDia || [])) if (String(d.dia).slice(0, 7) === mes) usd += d.usd || 0; } catch (_) {}
  const cot = (E._cotacao && E._cotacao.valor) || 5.4;
  return metas.custoAquisicao({ anuncios: metas.investimentoDoMes(mes), ia: usd * cot, leads: funil ? funil.leads : null, agendaram: funil ? funil.agendaram : null, novas });
}

// Guarda a leitura mais recente dos recebimentos e da grade no mês em que foi feita.
function guardarPosicao() {
  const snap = ind._gradeSnapshot(0);
  if (!snap || !snap.resumo) return;
  const r = snap.resumo;
  const iso = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v) : '';
  // (na demonstração a data vem como "20/11 06:10": vale o mês de hoje)
  const finEm = iso(snap.financeiro_em) || (snap.financeiro_em ? hojeSP() : '');
  if (finEm && Array.isArray(r.fatura_itens)) {
    const f = finResumo.resumir(r.fatura_itens, finEm.slice(0, 10));
    if (f.n) metas.registrarPosicao(finEm.slice(0, 7), 'fin', { previsto: f.previsto, recebido: f.recebido, atraso: f.atraso, aCair: f.aCair, aVencer: f.aVencer, inadPct: f.inadPct, vencAteHoje: f.vencAteHoje, tkm: r.tkm_medio != null ? r.tkm_medio : null }, finEm);
  }
  const grEm = iso(snap.gerado_em) || (snap.gerado_em ? hojeSP() : '');
  if (grEm && r.ocupacao_pct != null) metas.registrarPosicao(grEm.slice(0, 7), 'grade', { ocupacaoPct: r.ocupacao_pct, presencaPct: r.presenca_pct != null ? r.presenca_pct : null, alunasFixas: r.alunas_fixas != null ? r.alunas_fixas : null }, grEm);
}

// Fecha (tira a foto de) os meses que já podem fechar e ainda não têm foto.
// Chamado ao abrir a tela e por um relógio do painel — nunca apaga nem refaz foto.
let _rotinaEm = 0;
function rotina(forcar) {
  if (!forcar && Date.now() - _rotinaEm < 30 * 60 * 1000) return;
  _rotinaEm = Date.now();
  try { guardarPosicao(); } catch (_) {}
  try {
    const h = ativasDados.ler();
    const serie = ativasDados.serie(h.reconstruido);
    if (!serie.length) return;
    const hojeIso = serie[serie.length - 1].dia;
    const tol = (h.reconstruido && h.reconstruido.tolerancia) || 7;
    const meses = ativasDados.periodos(serie, 'mes');
    const fech = metas.fechamentos(), pos = metas.posicoes();
    // só meses inteiros no histórico (o primeiro pode começar no meio) e no máximo 12 para trás
    for (const p of meses.slice(1, -1).slice(-12)) {
      if (fech[p.k] || !metas.podeFechar(p.k, hojeIso, tol)) continue;
      const fim = `${p.k}-${String(metas.diasNoMes(p.k)).padStart(2, '0')}`;
      const fu = funilDe(`${p.k}-01`, fim);
      metas.fechar(p.k, {
        ativas: { ini: p.ini, fim: p.fim, entraram: p.e, novas: p.n, sairam: p.s, taxaSaida: taxaSaida(p) },
        funil: fu,
        custo: custoDoMes(p.k, fu, p.n),
        fin: (pos[p.k] && pos[p.k].fin) || null,
        grade: (pos[p.k] && pos[p.k].grade) || null,
        metas: metas.metasDoMes(p.k).valores,
      });
    }
  } catch (e) { console.log('[metas] fechamento do mês falhou:', e && e.message); }
}

// ── Página: Metas ───────────────────────────────────────────────────────────
function paginaMetas(params) {
  params = params || {};
  rotina();
  const h = ativasDados.ler();
  const serie = ativasDados.serie(h.reconstruido);
  const hojeIso = serie.length ? serie[serie.length - 1].dia : hojeSP();
  const mes = hojeIso.slice(0, 7), dia = +hojeIso.slice(8), dias = metas.diasNoMes(mes);
  const tol = (h.reconstruido && h.reconstruido.tolerancia) || 7;
  const meses = serie.length ? ativasDados.periodos(serie, 'mes') : [];
  const atual = meses.length && meses[meses.length - 1].k === mes ? meses[meses.length - 1] : null;
  const emRen = atual ? ativasDados.emRenovacao(h.pessoas, hojeIso, tol).filter(x => x.saiu >= atual.de).length : 0;
  const funil = funilDe(`${mes}-01`, hojeIso);
  const pos = metas.posicoes()[mes] || {};
  const fin = pos.fin || null, grade = pos.grade || null;
  const m = metas.metasDoMes(mes);
  const fracaoMes = dia / dias;
  const fracaoFin = fin && fin.previsto > 0 ? fin.vencAteHoje / fin.previsto : fracaoMes;

  // realizado, fração do mês e ponto de partida de cada meta
  const REAL = {
    ativas: { real: atual ? atual.fim : null, ini: atual ? atual.ini : null, fracao: fracaoMes, falta: 'Sem o histórico de alunas ativas (Alunas ativas → Atualizar agora).', href: '/ativas' },
    entradas: { real: atual ? atual.e : null, fracao: fracaoMes, falta: 'Sem o histórico de alunas ativas.', href: '/ativas' },
    agendamentos: { real: funil ? funil.agendaram : null, fracao: fracaoMes, falta: 'O histórico de agendamentos ainda não cobre o mês inteiro.', href: `/funil?de=${mes}-01&ate=${hojeIso}` },
    recebido: { real: fin ? fin.recebido : null, fracao: fracaoFin, falta: 'Sem leitura dos recebimentos neste mês (Grade → 💰 Atualizar tudo).', href: '/grade', lido: fin && fin.lidoEm },
    ocupacao: { real: grade ? grade.ocupacaoPct : null, fracao: fracaoMes, falta: 'Sem a grade deste mês (Grade → Atualizar grade).', href: '/grade', lido: grade && grade.lidoEm },
  };
  const ST = { batida: ['Meta batida', 'ok'], ritmo: ['No ritmo', 'ritmo'], abaixo: ['Abaixo do ritmo', 'abaixo'], sem: ['Sem meta', 'sem'] };
  const cartao = (c) => {
    const d = REAL[c.k], meta = m.valores[c.k];
    const r = metas.ritmo({ tipo: c.tipo, meta, real: d.real, fracao: d.fracao, ini: d.ini });
    const [rot, cls] = d.real == null ? ['Sem dado', 'sem'] : ST[r.status];
    const larg = meta && d.real != null ? Math.max(0, Math.min(100, d.real * 100 / meta)) : 0;
    const marca = r.esperado != null && meta ? Math.max(0, Math.min(100, r.esperado * 100 / meta)) : null;
    let linha = '';
    if (d.real == null) linha = esc(d.falta);
    else if (r.status === 'sem') linha = 'Defina uma meta abaixo para acompanhar o ritmo.';
    else if (r.status === 'batida') linha = `Meta de <b>${fmtCampo(c, meta)}</b> alcançada.`;
    else {
      const falta = meta - d.real;
      linha = `Faltam <b>${fmtCampo(c, falta)}</b>${c.pct ? ' pontos' : ''} para a meta de ${fmtCampo(c, meta)}.`
        + (c.tipo === 'soma' || d.ini != null ? ` Esperado até hoje: <b>${fmtCampo(c, r.esperado)}</b>.` : '')
        + (r.projecao != null && (c.tipo === 'soma' || d.ini != null) ? ` Nesse ritmo o mês fecha em <b>${fmtCampo(c, r.projecao)}</b>.` : '');
    }
    return `<a class="mt-card ${cls}" href="${d.href}">
      <div class="mt-topo"><span class="mt-rot">${esc(c.curto)}</span><span class="mt-st">${rot}</span></div>
      <div class="mt-num"><b>${fmtCampo(c, d.real)}</b>${meta ? `<span>de ${fmtCampo(c, meta)}</span>` : ''}</div>
      <div class="mt-trilho"><i style="width:${larg}%"></i>${marca != null && r.status !== 'sem' && (c.tipo === 'soma' || d.ini != null) ? `<u style="left:${marca}%" title="esperado até hoje"></u>` : ''}</div>
      <div class="mt-txt">${linha}${d.lido ? ` <span class="mt-lido">Leitura de ${esc(fmtDia(d.lido))}.</span>` : ''}</div>
    </a>`;
  };

  // outros números do mês (sem meta): saídas, comparecimento, inadimplência
  const outros = `<div class="stats">
      <a class="stat stat-link${atual && atual.fim < atual.ini ? ' alerta' : ''}" href="/ativas"><div class="n">${atual ? (atual.fim - atual.ini > 0 ? '+' : atual.fim - atual.ini < 0 ? '−' : '±') + Math.abs(atual.fim - atual.ini) : '—'}</div><div class="l">saldo de alunas no mês${atual ? `<br><span style="font-size:.72rem">+${atual.e} entraram · −${atual.s} saíram${emRen ? ` (${emRen} ainda ${emRen === 1 ? 'pode' : 'podem'} renovar)` : ''}</span>` : ''}</div></a>
      <a class="stat stat-link" href="/ativas"><div class="n">${fmtPct(taxaSaida(atual))}</div><div class="l">taxa de saída do mês${infoI('<b>Saíram ÷ ativas no começo do mês.</b> No mês em andamento ainda vai subir até o fim.')}</div></a>
      <a class="stat stat-link" href="/funil?de=${mes}-01&ate=${hojeIso}"><div class="n">${funil ? fmtPct(funil.comparecimentoPct) : '—'}</div><div class="l">comparecimento às experimentais${funil ? `<br><span style="font-size:.72rem">${funil.fez} fizeram · ${funil.faltou} faltaram</span>` : ''}</div></a>
      <a class="stat stat-link${fin && fin.atraso ? ' alerta' : ''}" href="/grade"><div class="n">${fin ? fmtPct(fin.inadPct) : '—'}</div><div class="l">inadimplência do mês${fin ? `<br><span style="font-size:.72rem">${fmtBRL(fin.atraso)} em atraso</span>` : ''}</div></a>
    </div>`;

  // atendimento: quanto a lead espera e quem está esperando agora
  const sess = E._navSess || { admin: true, telas: [] };
  const veConversas = !!(sess.admin || (sess.telas || []).includes('sofia_conversas'));
  let conv = {}; try { conv = sofia.conversas() || {}; } catch (_) {}
  const agora = Date.now();
  const t7 = atendimento.tempos(conv, agora - 7 * 86400e3, agora);
  let sessaoH = 12; try { sessaoH = sofia.lerSessaoHoras() || 12; } catch (_) {}
  const esp = atendimento.esperando(conv, { agora, sessaoMs: sessaoH * 3600e3, encerrada: (k, c) => sofia.estaEncerrada(k, sofia.ultimaAlunaEm(c)) });
  const hrefEsp = veConversas ? '/sofia?view=conversas&sit=aguardando' : '';
  const tagEsp = (html, cls) => hrefEsp ? `<a class="stat stat-link${cls}" href="${hrefEsp}">${html}</a>` : `<div class="stat${cls}">${html}</div>`;
  const atendimentoHtml = `<div class="stats" style="margin:0">
      ${tagEsp(`<div class="n">${esp.length}</div><div class="l">esperando resposta agora${esp.length ? `<br><span style="font-size:.72rem">a mais antiga há ${atendimento.fmtEspera(esp[0].min * 60)}${hrefEsp ? ' · <u>ver</u>' : ''}</span>` : ''}</div>`, esp.length && esp[0].min >= 60 ? ' alerta' : '')}
      <div class="stat"><div class="n">${atendimento.fmtEspera(t7.medianaSeg)}</div><div class="l">espera típica por uma resposta${infoI('<b>Mediana</b> das ' + t7.n + ' respostas dos últimos 7 dias: metade das pessoas esperou menos que isso, metade esperou mais. Conta da primeira mensagem dela até a resposta da SoFIA ou da equipe.')}</div></div>
      <div class="stat"><div class="n">${fmtPct(t7.ate5minPct)}</div><div class="l">respondidas em até 5 minutos</div></div>
      <div class="stat"><div class="n">${atendimento.fmtEspera(t7.equipe.medianaSeg)}</div><div class="l">espera quando a equipe responde<br><span style="font-size:.72rem">${t7.equipe.n} da equipe · ${t7.sofia.n} da SoFIA (${atendimento.fmtEspera(t7.sofia.medianaSeg)})</span></div></div>
    </div>
    ${esp.length && veConversas ? `<div class="mt-esp">${esp.slice(0, 5).map(x => `<span><b>${esc(x.nome || 'sem nome')}</b> há ${atendimento.fmtEspera(x.min * 60)}</span>`).join('')}${esp.length > 5 ? `<span>e mais ${esp.length - 5}</span>` : ''}</div>` : ''}
    <p class="quando" style="margin:10px 0 0">“Esperando” = a última mensagem é da pessoa, há mais de 15 minutos, e a conversa não foi encerrada. Nem toda mensagem pede resposta (um “obrigada” também aparece aqui).</p>`;

  // custo para trazer uma lead, um agendamento e uma aluna nova
  const custo = custoDoMes(mes, funil, atual ? atual.n : null);
  const fmtBRL2 = (n) => n == null ? '—' : 'R$ ' + (n >= 100 ? fmtInt(n) : String(Math.round(n * 100) / 100).replace('.', ','));
  const custoHtml = `<div class="stats" style="margin:0">
      <div class="stat"><div class="n">${fmtBRL(custo.total)}</div><div class="l">gasto no mês até hoje<br><span style="font-size:.72rem">anúncios ${custo.anuncios == null ? 'não informado' : fmtBRL(custo.anuncios)} · IA ${fmtBRL2(custo.ia)}</span></div></div>
      <div class="stat"><div class="n">${fmtBRL2(custo.porLead)}</div><div class="l">por lead atendida${infoI('Gasto ÷ <b>leads atendidas</b> no mês: quem agendou (por qualquer canal) + quem escreveu para a SoFIA e não é aluna.')}<br><span style="font-size:.72rem">${custo.leads == null ? 'sem histórico do mês' : custo.leads + ' leads'}</span></div></div>
      <div class="stat"><div class="n">${fmtBRL2(custo.porAgendamento)}</div><div class="l">por experimental agendada<br><span style="font-size:.72rem">${custo.agendaram == null ? 'sem histórico do mês' : custo.agendaram + ' agendadas'}</span></div></div>
      <div class="stat"><div class="n">${fmtBRL2(custo.porMatricula)}</div><div class="l">por aluna nova${infoI('Gasto ÷ <b>alunas com primeiro contrato</b> no mês, venham de onde vierem (inclusive indicação e quem passou na porta). Por isso tende a ficar menor que o custo real do anúncio.')}<br><span style="font-size:.72rem">${custo.novas == null ? 'sem histórico' : custo.novas + ' novas'}</span></div></div>
    </div>
    ${custo.anuncios == null ? '<p class="quando" style="margin:10px 0 0">⚠️ Só o custo da IA está na conta. Informe o <b>investimento em anúncios</b> do mês em “Definir as metas” para ver o custo completo.</p>' : ''}`;

  // formulário das metas
  const campos = metas.CAMPOS.map(c => `<label class="mt-campo"><span>${esc(c.rot)}</span>
      <input type="text" inputmode="decimal" name="${c.k}" value="${m.valores[c.k] != null ? String(m.valores[c.k]).replace('.', ',') : ''}" placeholder="sem meta" autocomplete="off"></label>`).join('');
  const aviso = params.ok === 'salvo' ? '<div class="ui-nota ok"><span>✅ Metas salvas.</span></div>'
    : params.ok === 'erro' ? `<div class="ui-nota erro"><span>⚠️ Não salvei: ${esc(params.msg || '')}</span></div>` : '';
  const form = `<form method="POST" action="/metas/salvar" class="mt-form">
      <input type="hidden" name="mes" value="${mes}">
      <div class="mt-campos">${campos}</div>
      <div class="mt-campos" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--linha-soft)"><label class="mt-campo"><span>Investimento em anúncios em ${esc(nomeMes(mes))} (R$)${infoI('Quanto foi (ou vai ser) gasto em anúncios <b>neste mês</b>. Entra no custo por lead e por aluna nova. Não passa para o mês seguinte.')}</span>
        <input type="text" inputmode="decimal" name="anuncios" value="${metas.investimentoDoMes(mes) != null ? String(metas.investimentoDoMes(mes)).replace('.', ',') : ''}" placeholder="não informado" autocomplete="off"></label></div>
      <div class="ui-linha" style="margin-top:12px"><button class="ui-btn" type="submit">Salvar metas de ${esc(nomeMes(mes))}</button>
      <span class="quando" style="margin:0">${m.herdada ? `Hoje valem as metas de <b>${esc(nomeMes(m.de))}</b>. ` : ''}Campo vazio = sem meta. As metas valem para os meses seguintes até você mudar.</span></div>
    </form>`;

  // meses: o atual (em andamento), o anterior se ainda não fechou (prévia) e os fechados
  const fech = metas.fechamentos();
  const marcaMeta = (v, meta, menorMelhor) => meta == null || v == null ? '' : ` <span class="mt-m ${(menorMelhor ? v <= meta : v >= meta) ? 'ok' : 'nao'}" title="meta: ${meta}">${(menorMelhor ? v <= meta : v >= meta) ? '✓' : '✗'}</span>`;
  const linhaMes = (k, d, selo, mt) => `<tr>
      <td><b>${esc(nomeMes(k))}</b><div class="quando" style="margin:0;font-size:.72rem">${selo}</div></td>
      <td class="num"><b>${d.ativas ? d.ativas.fim : '—'}</b>${marcaMeta(d.ativas && d.ativas.fim, mt.ativas)}</td>
      <td class="num">${d.ativas ? '+' + d.ativas.entraram : '—'}${marcaMeta(d.ativas && d.ativas.entraram, mt.entradas)}</td>
      <td class="num">${d.ativas ? '−' + d.ativas.sairam : '—'}</td>
      <td class="num so-pc">${fmtPct(d.ativas && d.ativas.taxaSaida)}</td>
      <td class="num">${d.funil ? d.funil.agendaram : '—'}${marcaMeta(d.funil && d.funil.agendaram, mt.agendamentos)}</td>
      <td class="num so-pc">${d.funil ? fmtPct(d.funil.comparecimentoPct) : '—'}</td>
      <td class="num so-pc">${d.funil ? d.funil.fechou : '—'}</td>
      <td class="num">${d.fin ? fmtBRL(d.fin.recebido) : '—'}${marcaMeta(d.fin && d.fin.recebido, mt.recebido)}</td>
      <td class="num so-pc">${d.fin ? fmtPct(d.fin.inadPct) : '—'}</td>
      <td class="num so-pc">${d.grade ? fmtPct(d.grade.ocupacaoPct) : '—'}${marcaMeta(d.grade && d.grade.ocupacaoPct, mt.ocupacao)}</td>
      <td class="num so-pc">${d.custo && d.custo.porMatricula != null ? fmtBRL(d.custo.porMatricula) + (d.custo.anuncios == null ? '<span title="só o custo da IA: o investimento em anúncios do mês não foi informado" style="color:var(--warn)"> *</span>' : '') : '—'}</td>
    </tr>`;
  const linhas = [];
  if (atual) linhas.push(linhaMes(mes, { ativas: { fim: atual.fim, entraram: atual.e, sairam: atual.s, taxaSaida: taxaSaida(atual) }, funil, fin, grade, custo }, `⏳ em andamento · dia ${dia} de ${dias}`, {}));
  const ant = metas.mesAnterior(mes), pAnt = meses.find(x => x.k === ant);
  if (pAnt && !fech[ant]) {
    const posAnt = metas.posicoes()[ant] || {};
    const fuAnt = funilDe(`${ant}-01`, `${ant}-${String(metas.diasNoMes(ant)).padStart(2, '0')}`);
    linhas.push(linhaMes(ant, { ativas: { fim: pAnt.fim, entraram: pAnt.e, sairam: pAnt.s, taxaSaida: taxaSaida(pAnt) }, funil: fuAnt, fin: posAnt.fin || null, grade: posAnt.grade || null, custo: custoDoMes(ant, fuAnt, pAnt.n) },
      `prévia · fecha em ${fmtDia(metas.diaDeFechar(ant, tol))}`, metas.metasDoMes(ant).valores));
  }
  for (const k of Object.keys(fech).filter(metas.ehMes).sort().reverse().slice(0, 12)) linhas.push(linhaMes(k, fech[k], `🔒 fechado em ${fmtDia(fech[k].fechadoEm)}`, fech[k].metas || {}));
  const tabela = linhas.length ? `<div class="card" style="overflow-x:auto"><table class="ui-tab mt-tab"><thead><tr>
      <th>Mês</th><th class="num">Ativas${infoI('Alunas ativas no <b>último dia</b> do mês.')}</th><th class="num">Entraram</th><th class="num">Saíram</th><th class="num so-pc">Saída %${infoI('<b>Taxa de saída</b> = saíram ÷ ativas no começo do mês.')}</th>
      <th class="num">Agendaram${infoI('Experimentais agendadas no mês, todos os canais. “—” = o histórico de agendamentos não cobre o mês inteiro.')}</th><th class="num so-pc">Comparec.${infoI('<b>Comparecimento</b> às experimentais = fez ÷ (fez + faltou).')}</th><th class="num so-pc">Fecharam</th>
      <th class="num">Recebido${infoI('O que já tinha caído na <b>última leitura do EVO dentro do mês</b>. “—” = o mês não teve leitura guardada.')}</th><th class="num so-pc">Inadimp.</th><th class="num so-pc">Ocup.</th><th class="num so-pc">Custo/aluna${infoI('<b>Gasto do mês ÷ alunas novas</b> (anúncios informados + IA). Com * = só a IA, sem os anúncios.')}</th>
    </tr></thead><tbody>${linhas.join('')}</tbody></table></div>`
    : '<div class="card"><div class="vazio">Ainda sem histórico. Abra <b>Alunas ativas</b> e clique em <b>Atualizar agora</b>.</div></div>';

  const corpo = `<div class="wrap">
    ${ind.subnavIndicadores('metas')}
    ${uiTopo({
      titulo: 'Metas do mês',
      sub: `Onde ${esc(nomeMes(mes))} está em relação às metas, se o ritmo dá para chegar lá, e os meses já fechados.`,
      acoes: `<div class="ui-acoes"><a class="ui-btn sec" href="/dicionario">📖 Dicionário dos números</a></div>`,
      linhas: [aviso, `<div class="mt-mes"><span><b>Dia ${dia} de ${dias}</b> · ${Math.round(fracaoMes * 100)}% do mês</span><span class="mt-mes-b"><i style="width:${Math.round(fracaoMes * 100)}%"></i></span></div>`],
    })}
    <div class="mt-grade">${metas.CAMPOS.map(cartao).join('')}</div>
    ${outros}
    <div class="ui-secoes">
    <div class="sec-t" data-nosec>Atendimento no WhatsApp <small style="font-weight:600;color:var(--cinza)">(últimos 7 dias)</small></div>
    <div class="card">${atendimentoHtml}</div>
    <div class="sec-t" data-nosec>Custo para trazer uma aluna <small style="font-weight:600;color:var(--cinza)">(${esc(nomeMes(mes))})</small></div>
    <div class="card">${custoHtml}</div>
    <div class="sec-t"${Object.keys(m.valores).length ? ' data-fechado' : ''}>Definir as metas</div>
    <div class="card">${form}</div>
    <div class="sec-t">Mês a mês</div>
    ${tabela}
    </div>
    <details class="ui-rodape"><summary>ⓘ Como estes números são calculados</summary><p><b>No ritmo</b> = o realizado está dentro de 5% do <b>esperado até hoje</b> (meta × parte do mês que já passou; em “Recebido”, a parte do previsto que já venceu). <b>Alunas ativas</b> anda do número do começo do mês até a meta. O traço na barra marca o esperado até hoje. <b>Mês fechado 🔒</b> é uma foto tirada no dia ${tol + 2} do mês seguinte — depois dos ${tol} dias em que uma renovação atrasada ainda desfaz uma saída — e não muda mais; ✓ e ✗ comparam com a meta que valia no mês. Recebido e ocupação de um mês fechado são da última leitura do EVO feita dentro dele. O que cada número significa está no <a href="/dicionario">Dicionário</a>.</p></details>
  </div>
  <style>
    .mt-mes{display:flex;align-items:center;gap:12px;font-size:var(--fs-sm);color:var(--cinza);flex:1 1 260px}
    .mt-mes b{color:var(--tinta)}
    .mt-mes-b{flex:1;max-width:260px;height:6px;border-radius:99px;background:var(--linha-soft);overflow:hidden}
    .mt-mes-b i{display:block;height:100%;background:var(--teal)}
    .mt-grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:14px 0}
    .mt-card{display:block;background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:14px 16px;text-decoration:none;color:inherit;transition:border-color .12s}
    .mt-card:hover{border-color:var(--teal)}
    .mt-topo{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .mt-rot{font-size:var(--fs-sm);color:var(--cinza);font-weight:600}
    .mt-st{font-size:var(--fs-xs);font-weight:700;border-radius:99px;padding:2px 9px;white-space:nowrap;background:var(--linha-soft);color:var(--cinza)}
    .mt-card.ok .mt-st{background:var(--ok-bg);color:var(--ok)}
    .mt-card.ritmo .mt-st{background:var(--avi-bg);color:var(--avi-tx)}
    .mt-card.abaixo .mt-st{background:var(--erro-bg);color:var(--erro)}
    .mt-num{display:flex;align-items:baseline;gap:8px;margin:8px 0 10px}
    .mt-num b{font-size:1.7rem;line-height:1;color:var(--tinta);font-variant-numeric:tabular-nums}
    .mt-num span{font-size:var(--fs-sm);color:var(--cinza)}
    .mt-trilho{position:relative;height:8px;border-radius:99px;background:var(--linha-soft)}
    .mt-trilho i{display:block;height:100%;border-radius:99px;background:var(--cinza)}
    .mt-card.ok .mt-trilho i{background:var(--ok)}.mt-card.ritmo .mt-trilho i{background:var(--teal)}.mt-card.abaixo .mt-trilho i{background:var(--erro)}
    .mt-trilho u{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:var(--tinta);border-radius:2px}
    .mt-txt{font-size:var(--fs-xs);color:var(--cinza);margin-top:10px;line-height:1.45}
    .mt-txt b{color:var(--tinta)}
    .mt-lido{white-space:nowrap}
    .mt-esp{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:12px}
    .mt-esp span{font-size:var(--fs-xs);color:var(--cinza);background:var(--linha-soft);border-radius:99px;padding:3px 10px}.mt-esp b{color:var(--tinta)}
    .mt-campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .mt-campo{display:flex;flex-direction:column;gap:5px;font-size:var(--fs-sm);font-weight:600;color:var(--tinta)}
    .mt-campo input{width:100%}
    .wrap .mt-tab th,.wrap .mt-tab td{padding-left:8px;padding-right:8px}
    .mt-tab td:first-child{white-space:nowrap}
    .ui-rodape a{color:var(--teal-esc)}
    .mt-m{font-weight:800;font-size:.78rem}.mt-m.ok{color:var(--ok)}.mt-m.nao{color:var(--erro)}
    @media(max-width:700px){.mt-grade{grid-template-columns:1fr}.mt-num b{font-size:1.5rem}}
  </style>`;
  return chrome({ tab: 'Metas' }, 'metas', corpo);
}

// ── Página: Dicionário ──────────────────────────────────────────────────────
function paginaDicionario() {
  const blocos = dicionario.GRUPOS.map(g => `<div class="sec-t">${esc(g.tela)} <a class="dc-ir" href="${g.href}">abrir a tela →</a></div>
    <div class="card dc-card">${g.itens.map(i => `<div class="dc-item" data-t="${esc((i.nome + ' ' + i.conta + ' ' + (i.atencao || '')).replace(/<[^>]+>/g, '').toLowerCase())}">
      <div class="dc-nome">${esc(i.nome)}</div>
      <div class="dc-txt"><p>${i.conta}</p>${i.atencao ? `<p class="dc-at">⚠️ ${i.atencao}</p>` : ''}<p class="dc-fonte">De onde vem: ${i.fonte}</p></div>
    </div>`).join('')}</div>`).join('');
  const corpo = `<div class="wrap">
    ${ind.subnavIndicadores('dicionario')}
    ${uiTopo({
      titulo: 'Dicionário dos números',
      sub: 'O que cada número do painel significa, como é calculado e de onde vem. Onde dois números têm nome parecido e regra diferente, isso está marcado com ⚠️.',
      linhas: ['<div class="ui-linha" style="flex:1 1 280px"><input id="dcBusca" type="search" placeholder="🔍 Procurar um número (ex.: taxa de saída, TKM, conversão)" autocomplete="off" style="flex:1;min-width:0"></div>'],
    })}
    <div id="dcVazio" class="card" style="display:none"><div class="vazio">Nenhum número com esse nome.</div></div>
    <div class="ui-secoes" id="dcLista">${blocos}</div>
  </div>
  <style>
    .dc-ir{font-size:var(--fs-xs);font-weight:600;color:var(--teal-esc);text-decoration:none;margin-left:8px}
    .dc-ir:hover{text-decoration:underline}
    .dc-card{padding:4px 16px}
    .dc-item{display:grid;grid-template-columns:minmax(150px,230px) 1fr;gap:6px 20px;padding:13px 0;border-bottom:1px solid var(--linha-soft)}
    .dc-item:last-child{border-bottom:0}
    .dc-nome{font-weight:700;color:var(--tinta)}
    .dc-txt p{margin:0 0 5px;font-size:var(--fs-sm);line-height:1.5;max-width:70ch}
    .dc-txt p:last-child{margin:0}
    .dc-at{color:var(--warn)}.dc-at b{color:inherit}
    .dc-fonte{color:var(--cinza);font-size:var(--fs-xs)!important}
    @media(max-width:700px){.dc-item{grid-template-columns:1fr}}
  </style>
  <script>
    (function(){
      var b=document.getElementById('dcBusca'); if(!b) return;
      var norm=function(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');};
      b.addEventListener('input',function(){
        var q=norm(b.value.trim()), algum=false;
        document.querySelectorAll('#dcLista .dc-item').forEach(function(it){ var ok=!q||norm(it.getAttribute('data-t')).indexOf(q)>=0; it.style.display=ok?'':'none'; if(ok) algum=true; });
        document.querySelectorAll('#dcLista .dc-card').forEach(function(c){
          var tem=Array.prototype.some.call(c.querySelectorAll('.dc-item'),function(i){return i.style.display!=='none';});
          var sec=c.closest('details')||c; sec.style.display=tem?'':'none';
          if(q&&tem&&sec.tagName==='DETAILS') sec.open=true;
          var t=c.previousElementSibling; if(t&&t.classList&&t.classList.contains('sec-t')) t.style.display=tem?'':'none';
        });
        document.getElementById('dcVazio').style.display=algum?'none':'';
      });
    })();
  </script>`;
  return chrome({ tab: 'Dicionário' }, 'dicionario', corpo);
}

module.exports = { paginaMetas, paginaDicionario, rotina, funilDe, guardarPosicao, custoDoMes };

/**
 * pagamento/painel.js — telas do Pagamento dos professores (Indicadores →
 * 💰 Pagamento). Recebe as peças de layout do painel (esc, uiTopo, uiChips,
 * subnav) para seguir o mesmo visual das outras abas.
 */
const sync = require('./sync');
const pcfg = require('./config');
const calc = require('./calculo');

const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const rotMes = (ym) => `${MESES[+ym.slice(5, 7) - 1]}/${ym.slice(0, 4)}`;
const br = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';
const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
function mesAtualSP() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7); }
function somaMes(ym, n) { let a = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; while (m < 1) { m += 12; a--; } while (m > 12) { m -= 12; a++; } return `${a}-${String(m).padStart(2, '0')}`; }

const CSS = `<style>
.pg-prof{display:flex;align-items:center;gap:12px;padding:11px 4px;border-top:1px solid var(--linha-soft);flex-wrap:wrap}
.pg-prof:first-child{border-top:0}
.pg-prof .nm{font-weight:800;color:var(--tinta);text-decoration:none;min-width:180px}
.pg-prof .nm:hover{color:var(--teal-esc)}
.pg-prof .meta{color:var(--cinza);font-size:.84rem;flex:1}
.pg-prof .tot{font-weight:800;font-variant-numeric:tabular-nums;font-size:1.02rem}
.pg-pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.72rem;font-weight:700;background:var(--avi-bg);color:var(--teal-esc);margin-left:6px}
.pg-pill.warn{background:var(--warn-bg);color:#8a5a00}
.pg-tab{width:100%;border-collapse:collapse;font-size:.86rem}
.pg-tab th{text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--cinza);padding:6px 6px;border-bottom:1px solid var(--linha)}
.pg-tab td{padding:7px 6px;border-bottom:1px solid var(--linha-soft);vertical-align:top}
.pg-tab td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pg-tab tr.fut td{color:var(--cinza)}
.pg-al{margin:6px 0 2px;font-size:.82rem;color:var(--cinza)}
.pg-al div{padding:2px 0}
.pg-al b{color:var(--tinta)}
.pg-wrap{overflow-x:auto}
.pg-reg{font-size:.72rem;font-weight:700;border-radius:6px;padding:1px 6px;background:var(--avi-bg);color:var(--teal-esc)}
.pg-reg.teto{background:#fbeeee;color:#a12626}
.pg-av{color:#8a5a00;font-size:.78rem;margin-top:3px}
.pg-form{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.pg-form label{display:flex;flex-direction:column;gap:3px;font-size:.8rem;font-weight:700;color:var(--cinza)}
.pg-form input{width:110px}
.pg-mz{width:100%;border-collapse:collapse;font-size:.82rem}
.pg-mz th{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--cinza);padding:7px 6px;border-bottom:1px solid var(--linha);text-align:center}
.pg-mz td{text-align:center;padding:8px 6px;border-bottom:1px solid var(--linha-soft);vertical-align:top}
.pg-mz th.pg-mz-h{text-align:left;color:var(--tinta);font-size:.86rem;white-space:nowrap;letter-spacing:0;text-transform:none;border-bottom:1px solid var(--linha-soft)}
.pg-mz-a{font-weight:800;font-variant-numeric:tabular-nums}
.pg-mz-t{font-variant-numeric:tabular-nums;color:var(--tinta)}
.pg-mz-p{font-size:.66rem;color:var(--cinza);letter-spacing:.04em;margin-top:2px}
.pg-mz-v{color:var(--cinza)}
.pg-x{border:1px solid #e3b4b4;background:#fbeeee;color:#a12626;border-radius:6px;font-weight:800;cursor:pointer;padding:0 7px;line-height:1.5}
.pg-lnk{border:0;background:none;color:var(--teal-esc);font-weight:700;cursor:pointer;text-decoration:underline;padding:0;font-size:.78rem}
.pg-res-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.pg-res-l{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--linha-soft);font-size:.9rem}
.pg-res-l b{font-variant-numeric:tabular-nums}
.pg-sub{font-weight:800;margin:0 0 8px;color:var(--tinta)}
.pg-sub2{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--cinza);font-weight:700;margin:0 0 4px}
.pg-pc>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pg-pc>summary::-webkit-details-marker{display:none}
.pg-pc[open]>summary{border-bottom:1px solid var(--linha-soft);padding-bottom:12px;margin-bottom:12px}
.pg-av-ini{width:36px;height:36px;border-radius:50%;background:var(--avi-bg);color:var(--teal-esc);display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}
.pg-pc-n{flex:1;min-width:160px}
.pg-pc-t{text-align:right;font-variant-numeric:tabular-nums}
.pg-pc-t b{font-size:1.15rem;color:var(--teal-esc)}
.pg-turma,.pg-dia,.pg-ses{border:1px solid var(--linha);border-radius:10px;margin:10px 0 0;background:var(--card)}
.pg-dia{margin:8px 12px}
.pg-ses{margin:6px 12px;border-color:var(--linha-soft)}
.pg-turma>summary,.pg-dia>summary,.pg-ses>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap}
.pg-turma>summary::-webkit-details-marker,.pg-dia>summary::-webkit-details-marker,.pg-ses>summary::-webkit-details-marker{display:none}
.pg-ses>summary{padding:7px 10px;font-size:.85rem}
.pg-ses-v{text-align:right;font-variant-numeric:tabular-nums}
.pg-somat{text-align:right;padding:8px 12px;color:var(--cinza);font-size:.85rem}
.pg-somat b{color:var(--teal-esc);font-variant-numeric:tabular-nums}
.pg-alr{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding:4px 10px;border-top:1px solid var(--linha-soft)}
.pg-alr.exc{opacity:.6}
.pg-al-sv{padding:6px 10px 2px;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.pg-ins{display:flex;gap:6px;padding:8px 10px;flex-wrap:wrap}
.pg-ins select{max-width:280px}
.pg-exc{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:var(--warn-bg);font-size:.84rem;line-height:1.6}
.pg-tag{display:inline-block;border:1px solid var(--linha);border-radius:6px;padding:0 6px;font-size:.74rem;margin:1px 0}
#pgGcTab tr.exc td{opacity:.6}
dialog#pgDlg{border:1px solid var(--linha);border-radius:12px;padding:18px;max-width:440px;width:92vw;background:var(--card);color:var(--tinta)}
dialog#pgDlg::backdrop{background:rgba(0,0,0,.35)}
@media print{nav,.subtabs,.ui-acoes,.ui-linha,.no-print,.hbar{display:none!important}.card{box-shadow:none;border:0}}
</style>`;

function situacaoSync(st) {
  if (st.rodando) return `⏳ Lendo o EVO (${st.mes ? rotMes(st.mes) : ''}): ${st.etapa || 'começando'}… atualize a página em alguns minutos.`;
  if (st.ok === false) return `⚠️ A última leitura falhou${st.fim ? ' (' + quando(st.fim) + ')' : ''}: ${st.erro || ''}`;
  if (st.fim) return `Última leitura do EVO: ${quando(st.fim)}${st.mes ? ' · ' + rotMes(st.mes) : ''}${st.segundos ? ' · ' + st.segundos + ' s' : ''}. O robô relê toda madrugada.`;
  return 'Ainda não houve leitura do EVO. Clique em "Atualizar dados do EVO".';
}

const DSEM = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const primeiro = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const avg = (tot, n) => n ? tot / n : 0;
const pagas = (p) => p.turmas.reduce((s, t) => s + t.aulas.filter(a => !/já contada/.test(a.regra || '')).length, 0); // aulas que entram na média

// Filtra as aulas do professor pelo dia da semana (wd) e recalcula os totais.
function filtrarDia(p, wd) {
  if (wd === null) return p;
  const turmas = p.turmas.map(t => { const aulas = t.aulas.filter(a => a.wd === wd); return Object.assign({}, t, { aulas, total: aulas.reduce((s, a) => s + a.valor, 0) }); }).filter(t => t.aulas.length);
  return Object.assign({}, p, { turmas, total: turmas.reduce((s, t) => s + t.total, 0), nAulas: turmas.reduce((s, t) => s + t.aulas.length, 0) });
}

// Matriz horário × dia: cada célula = R$/aula médio, total e professor(es).
function matriz(esc, aulasCom, dias, { comX = false, ocultos = [], ym = '' } = {}) {
  const horas = [...new Set(aulasCom.filter(x => dias.includes(x.a.wd)).map(x => x.a.hora))].sort(); // só horários dos dias da matriz
  const linha = (h) => {
    const cels = dias.map(wd => {
      const cel = aulasCom.filter(x => x.a.hora === h && x.a.wd === wd);
      if (!cel.length) return '<td class="pg-mz-v">—</td>';
      const tot = cel.reduce((s, x) => s + x.a.valor, 0);
      const profs = [...new Set(cel.map(x => primeiro(x.p).toUpperCase()))].join(' · ');
      return `<td><div class="pg-mz-a">${brl(avg(tot, cel.length))}/aula</div><div class="pg-mz-t">${brl(tot)}</div>${comX ? `<div class="pg-mz-p">${esc(profs)}</div>` : ''}</td>`;
    }).join('');
    const x = comX && !dias.includes(6) ? `<button type="button" class="pg-x no-print" title="Tirar o horário ${h} (seg a sex) do cálculo" data-oculto="${esc(h)}">×</button>` : '';
    return `<tr><th class="pg-mz-h">${esc(h)} ${x}</th>${cels}</tr>`;
  };
  const oc = ocultos.length ? `<div class="quando" style="margin:8px 0 0">Tirados do cálculo: ${ocultos.map(o => `<b>${esc(o.h)}</b> (${esc(o.por || '')} ${quando(o.em)}) <button type="button" class="pg-lnk no-print" data-oculto="${esc(o.h)}">voltar</button>`).join(' · ')}</div>` : '';
  return `<div class="pg-wrap"><table class="pg-mz"><thead><tr><th>Horário</th>${dias.map(d => `<th>${DSEM[d]}</th>`).join('')}</tr></thead><tbody>${horas.map(linha).join('') || `<tr><td colspan="${dias.length + 1}" class="quando">Sem aulas.</td></tr>`}</tbody></table></div>${oc}`;
}

function linhaAluna(esc, x, ctx) {
  const pag = x.pagou === false ? ' · <span style="color:#a12626">não pagou o mês</span>' : '';
  const calc = x.tipo === 'fixo' && x.aulasMes && !x.excluida ? ` <span class="quando" title="mensalidade (já com o desconto) ÷ aulas dela no mês × %">(${brl(x.mensalidade)} ÷ ${x.aulasMes} × ${ctx.pct}%)</span>` : '';
  const acao = x.excluida
    ? `<button type="button" class="pg-lnk no-print" data-desfazer="${esc(x.excluida.id)}">desfazer exclusão</button>`
    : x.inserida ? `<button type="button" class="pg-lnk no-print" data-desfazer="${esc(x.inserida.id)}">tirar inclusão</button>`
    : `<button type="button" class="pg-x no-print" title="Excluir do cálculo (com motivo)" data-exc="${x.m}" data-nome="${esc(x.nome)}" data-prof="${esc(ctx.prof)}" data-profnome="${esc(ctx.profNome)}" data-s="${esc(String(ctx.s))}" data-sdesc="${esc(ctx.sDesc)}">×</button>`;
  return `<div class="pg-alr${x.excluida ? ' exc' : ''}"><span><b>${esc(x.nome)}</b> · ${x.tipo === 'fixo' ? 'fixa' : 'free'} · ${esc(x.presenca)}${x.contrib > 0 ? ` · <b>${brl(x.contrib)}</b>` : ''}${calc} · <span class="quando">${esc(x.plano)}</span>${pag}${x.nota ? ` · <i>${esc(x.nota)}</i>` : ''}</span>${acao}</div>`;
}

function cartaoProf(esc, p, ctx) {
  const media = avg(p.total, pagas(p));
  const todasAulas = p.turmas.flatMap(t => t.aulas.map(a => ({ a, p: p.nome })));
  const dias = [1, 2, 3, 4, 5, 6];
  const turmas = p.turmas.map(t => {
    const porDia = new Map();
    for (const a of t.aulas) (porDia.get(a.wd) || porDia.set(a.wd, []).get(a.wd)).push(a);
    const diasTxt = [...porDia.keys()].sort().map(d => DIAS_LONGOS[d]).join(', ');
    const blocos = [...porDia.entries()].sort((u, w) => u[0] - w[0]).map(([wd, aulas]) => {
      const tot = aulas.reduce((s, a) => s + a.valor, 0);
      const nPiso = aulas.filter(a => a.regra === 'piso').length, nTeto = aulas.filter(a => a.regra === 'teto').length;
      const sess = aulas.map(a => {
        const sDesc = `${br(a.data)} ${a.hora} ${t.nome}`;
        const conta = a.alunas.filter(x => x.contrib > 0), outras = a.alunas.filter(x => !(x.contrib > 0));
        const sel = `<div class="pg-ins no-print"><select data-ins-sel="${esc(String(a.s))}"><option value="">+ incluir aluna nesta aula…</option>${ctx.todas.filter(x => !a.alunas.some(y => y.m === x.m)).map(x => `<option value="${x.m}" data-nome="${esc(x.nome)}">${esc(x.nome)}</option>`).join('')}</select><button type="button" class="ui-btn sec" data-ins="${esc(String(a.s))}" data-prof="${esc(p.chave)}" data-sdesc="${esc(sDesc)}">Incluir</button></div>`;
        return `<details class="pg-ses" data-k="ses-${esc(String(a.s))}"><summary><span><b>${br(a.data)}</b> ${esc(a.hora)}${a.futura ? ' <span class="pg-pill">previsão</span>' : ''} · ${a.presencas} presença${a.presencas === 1 ? '' : 's'} · ${conta.length} contam</span><span class="pg-ses-v">${a.regra ? `<span class="pg-reg${a.regra === 'teto' ? ' teto' : ''}">${esc(a.regra)}</span> ` : ''}<b>${brl(a.valor)}</b> <span class="quando">(soma ${brl(a.bruto)})</span></span></summary>
          ${a.avisos.map(v => `<div class="pg-av">⚠️ ${esc(v)}</div>`).join('')}
          <div class="pg-al">${conta.map(x => linhaAluna(esc, x, { pct: p.pct, prof: p.chave, profNome: p.nome, s: a.s, sDesc })).join('')}${outras.length ? `<div class="pg-al-sv">Sem valor nesta aula:</div>${outras.map(x => linhaAluna(esc, x, { pct: p.pct, prof: p.chave, profNome: p.nome, s: a.s, sDesc })).join('')}` : ''}${sel}</div></details>`;
      }).join('');
      return `<details class="pg-dia" data-k="dia-${esc(p.chave)}-${esc(t.nome)}-${wd}"><summary><span><b>${DIAS_LONGOS[wd]}</b><span class="quando" style="display:block;margin:0">${aulas.length} ${aulas.length === 1 ? 'sessão' : 'sessões'} · ${brl(avg(tot, aulas.length))}/aula médio</span></span><span class="pg-ses-v">${nPiso === aulas.length ? '<span class="pg-reg">Piso</span> ' : nTeto === aulas.length ? '<span class="pg-reg teto">Teto</span> ' : ''}<b>${brl(tot)}</b><span class="quando" style="display:block;margin:0;text-align:right">total ${DSEM[wd]}</span></span></summary>${sess}</details>`;
    }).join('');
    return `<details class="pg-turma" data-k="tur-${esc(p.chave)}-${esc(t.nome)}"><summary><span><b>${esc(t.nome)}</b><span class="quando" style="display:block;margin:0">${esc(diasTxt)} · ${t.aulas.length} aula${t.aulas.length === 1 ? '' : 's'} no mês</span></span><span class="pg-ses-v"><b>${brl(t.total)}</b><span class="quando" style="display:block;margin:0;text-align:right">total no mês</span></span></summary>${blocos}<div class="pg-somat">Somatório da turma <b>${brl(t.total)}</b></div></details>`;
  }).join('');
  const exc = (p.exclusoes || []).length || (p.insercoes || []).length ? `<div class="pg-exc"><b>Ajustes manuais deste professor</b>${(p.exclusoes || []).map(x => `<div>✕ <b>${esc(x.nome)}</b> excluída ${x.escopo === 'global' ? 'de todas as aulas do mês' : x.escopo === 'prof' ? 'de todas as aulas deste professor' : 'da aula ' + esc(x.sDesc)} — <i>${esc(x.motivo)}</i> <span class="quando">(${esc(x.por || '')} ${quando(x.em)})</span> <button type="button" class="pg-lnk no-print" data-desfazer="${esc(x.id)}">desfazer</button></div>`).join('')}${(p.insercoes || []).map(x => `<div>＋ <b>${esc(x.nome)}</b> incluída na aula ${esc(x.sDesc)}${x.motivo ? ' — <i>' + esc(x.motivo) + '</i>' : ''} <span class="quando">(${esc(x.por || '')} ${quando(x.em)})</span> <button type="button" class="pg-lnk no-print" data-desfazer="${esc(x.id)}">desfazer</button></div>`).join('')}</div>` : '';
  return `<details class="card pg-pc" id="prof-${esc(p.chave)}" data-k="prof-${esc(p.chave)}"><summary>
      <span class="pg-av-ini">${esc((p.nome || '?').charAt(0).toUpperCase())}</span>
      <span class="pg-pc-n"><b>${esc(p.nome)}</b><span class="quando" style="display:block;margin:0">${p.pct}% · piso ${brl(p.piso)} · teto ${brl(p.teto)} · ${p.turmas.length} turma${p.turmas.length === 1 ? '' : 's'}${p.configurado ? '' : ' <span class="pg-pill warn">padrão</span>'}</span></span>
      <span class="pg-pc-t"><b>${brl(p.total)}</b><span class="quando" style="display:block;margin:0">total no mês · ${brl(media)}/aula médio</span></span>
      <a class="ui-btn sec no-print" href="/pagamento/relatorio?m=${esc(ctx.ym)}&prof=${encodeURIComponent(p.chave)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄 PDF</a>
    </summary>
    <div class="pg-sub">Matriz de horários — ${esc(primeiro(p.nome))}</div>
    ${matriz(esc, todasAulas, dias)}
    ${turmas}
    ${exc}
    <div class="pg-somat">Total geral do mês <b style="font-size:1.15rem">${brl(p.total)}</b></div>
  </details>`;
}
const DIAS_LONGOS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function gestaoCentral(esc, alunas) {
  const semPag = alunas.filter(a => a.pagou === false).length, semDados = alunas.filter(a => a.pagou === null).length;
  const pagTxt = (a) => a.pagou === true ? '<span style="color:var(--teal-esc);font-weight:700">Pago</span>' : a.pagou === false ? '<span style="color:#a12626;font-weight:700">Sem pagamento</span>' : '<span style="color:#8a5a00;font-weight:700">Sem dados</span>';
  const linha = (a) => `<tr data-pag="${a.pagou === true ? 'ok' : 'nao'}"${a.excluidaGlobal ? ' class="exc"' : ''}><td><b>${esc(a.nome)}</b>${a.excluidaGlobal ? `<div class="quando" style="margin:0">excluída do mês: <i>${esc(a.excluidaGlobal.motivo)}</i></div>` : ''}</td><td>${a.tipo === 'fixo' ? 'Fixa' : 'Free'}</td><td class="quando" style="margin:0">${esc(a.plano)}</td><td class="quando" style="margin:0">${esc((a.dias || []).join(', ') || '—')}</td><td>${a.profs.map(n => `<span class="pg-tag">${esc(primeiro(n))}</span>`).join(' ')}</td><td>${pagTxt(a)}</td><td style="text-align:center">${a.excluidaGlobal ? `<button type="button" class="pg-lnk no-print" data-desfazer="${esc(a.excluidaGlobal.id)}">desfazer</button>` : `<button type="button" class="pg-x no-print" title="Excluir de TODAS as aulas do mês" data-exc="${a.m}" data-nome="${esc(a.nome)}" data-global="1">×</button>`}</td></tr>`;
  return `<div class="sec-t">Gestão Central: alunas do mês</div>
  <div class="card" id="pgGestao">
    <p class="quando" style="margin:0 0 8px">Todas as alunas que entraram no cálculo. Excluir aqui tira a aluna de <b style="color:#a12626">todas as aulas do mês</b>, de todos os professores (com motivo, fica registrado).</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.84rem;font-weight:700;margin:0 0 8px"><span>${alunas.length} alunas no total</span><span id="pgGcN">${alunas.length} exibidas</span><span style="color:#a12626">${semPag} sem pagamento no mês</span><span style="color:#8a5a00">${semDados} sem dados de pagamento</span></div>
    <label class="no-print" style="display:flex;gap:8px;align-items:center;font-size:.85rem;font-weight:700;margin:0 0 8px"><input type="checkbox" id="pgSoSemPag"> Mostrar só alunas sem pagamento identificado</label>
    <div class="pg-wrap"><table class="pg-tab" id="pgGcTab"><thead><tr><th>Nome</th><th>Tipo</th><th>Plano / contrato</th><th>Dias avaliados</th><th>Professores</th><th>Pagamento no mês</th><th>Excluir</th></tr></thead><tbody>${alunas.map(linha).join('')}</tbody></table></div>
  </div>`;
}

function pagina({ esc, uiTopo, uiChips, subnav, ym, prof, dia, aviso }) {
  ym = /^\d{4}-\d{2}$/.test(ym || '') ? ym : mesAtualSP();
  const wd = /^[1-6]$/.test(String(dia || '')) ? +dia : null;
  const st = sync.lerStatus();
  const r = calc.calcularMes(+ym.slice(0, 4), +ym.slice(5, 7));
  const atual = mesAtualSP();
  const qs = (o) => '/pagamento?' + new URLSearchParams(Object.assign({ m: ym }, wd !== null ? { d: wd } : {}, o)).toString();
  const meses = [somaMes(atual, -3), somaMes(atual, -2), somaMes(atual, -1), atual].map(m => [`/pagamento?m=${m}${wd !== null ? '&d=' + wd : ''}`, rotMes(m), m === ym]);
  const diasChips = [['', 'Todos'], ['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb']].map(([v, l]) => [`/pagamento?m=${ym}${v ? '&d=' + v : ''}`, l, String(wd === null ? '' : wd) === v]);
  const acoes = `<form method="POST" action="/pagamento/sync" style="margin:0" class="no-print"><input type="hidden" name="m" value="${esc(ym)}"><button class="ui-btn sec" type="submit"${st.rodando ? ' disabled' : ''}>🔄 Atualizar grade e presença (EVO)</button></form>
    <a class="ui-btn sec no-print" href="/pagamento/config">⚙️ Regras e percentuais</a>`;
  const linhaAtual = r.ok ? `<div class="ui-nota"><span>Grade atualizada em: <b>${quando(r.atualizadoEm)}</b> · Presença atualizada em: <b>${r.listasEm ? quando(r.listasEm) : '—'}</b></span></div>` : '';
  const topo = uiTopo({
    titulo: 'Cálculo de remuneração',
    sub: `Pagamento dos professores de ${esc(rotMes(ym))}, pelas listas de presença do EVO. Aulas que ainda vão acontecer entram como previsão.`,
    acoes,
    linhas: [uiChips('Mês', meses), uiChips('Dia da semana', diasChips), linhaAtual, (st.rodando || st.ok === false || !r.ok) ? `<div class="ui-nota${st.ok === false ? ' erro' : ''}"><span>${esc(situacaoSync(st))}</span></div>` : ''],
  });
  if (!r.ok) return `<div class="wrap">${subnav}${CSS}${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}${topo}<div class="card"><p class="quando" style="margin:0">${esc(r.erro)}</p></div></div>`;

  const profs = r.professores.map(p => filtrarDia(p, wd)).filter(p => p.nAulas);
  const total = profs.reduce((s, p) => s + p.total, 0);
  const nTurmas = new Set(profs.flatMap(p => p.turmas.map(t => t.nome))).size;
  const ativas = r.alunas.filter(a => !/vip/i.test(a.plano) && !a.excluidaGlobal).length;
  const stats = `<div class="stats">
    <div class="stat"><div class="n">${profs.length}</div><div class="l">professores</div></div>
    <div class="stat"><div class="n">${nTurmas}</div><div class="l">total de turmas</div></div>
    <div class="stat"><div class="n" style="color:#b7791f">${ativas}</div><div class="l">alunas no cálculo</div></div>
    <div class="stat tot"><div class="n">${brl(total)}</div><div class="l">total geral${wd !== null ? ' · ' + DSEM[wd] : ''}</div></div>
  </div>`;
  const avisos = r.avisos.length ? `<details class="card" style="border-left:4px solid var(--warn)"><summary style="cursor:pointer;font-weight:800">⚠️ Para conferir (${r.avisos.length})</summary>${r.avisos.slice(0, 40).map(a => `<div class="quando" style="margin:4px 0 0">${esc(a)}</div>`).join('')}</details>` : '';
  const aulasCom = profs.flatMap(p => p.turmas.flatMap(t => t.aulas.map(a => ({ a, p: p.nome }))));
  const diasMz = wd !== null ? [wd] : [1, 2, 3, 4, 5];
  const resumo = `<div class="card pg-res"><div class="pg-sub">Resumo global</div><div class="pg-res-g">
      <div><div class="pg-sub2">Taxa média / aula</div>${profs.map(p => `<div class="pg-res-l"><span>${esc(primeiro(p.nome))}</span><b>${brl(avg(p.total, pagas(p)))}</b></div>`).join('')}</div>
      <div><div class="pg-sub2">Total no mês</div>${profs.map(p => `<div class="pg-res-l"><span>${esc(primeiro(p.nome))}</span><b>${brl(p.total)}</b></div>`).join('')}</div></div></div>`;
  const todas = r.alunas.filter(a => !a.excluidaGlobal).map(a => ({ m: a.m, nome: a.nome }));

  return `<div class="wrap">${subnav}${CSS}
    ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
    ${topo}
    ${stats}
    ${avisos}
    <div class="sec-t">Matriz de remuneração por grade horária</div>
    <div class="card">${matriz(esc, aulasCom, diasMz, { comX: true, ocultos: r.ajustes.ocultos || [], ym })}
      <p class="quando" style="margin:8px 0 0">Cada célula: valor médio por aula, total do mês e professor. O <b>×</b> tira o horário (de segunda a sexta) do cálculo do mês — fica registrado e dá para voltar.${(r.professores.some(p => p.turmas.some(t => t.aulas.some(a => a.wd === 6)))) ? ' Sábado (diária fixa) aparece no cartão de cada professor.' : ''}</p></div>
    ${resumo}
    <div class="sec-t">Professores</div>
    ${profs.map(p => cartaoProf(esc, p, { ym, todas })).join('') || '<div class="card"><p class="quando" style="margin:0">Nenhuma aula.</p></div>'}
    ${gestaoCentral(esc, r.alunas)}
    <dialog id="pgDlg"><form method="dialog" id="pgDlgF">
      <h3 style="margin:0 0 6px">Excluir do cálculo</h3>
      <p class="quando" style="margin:0 0 10px" id="pgDlgNome"></p>
      <div id="pgDlgEsc" style="display:flex;flex-direction:column;gap:6px;margin:0 0 10px;font-size:.88rem">
        <label><input type="radio" name="esc" value="sessao" checked> Só desta aula</label>
        <label><input type="radio" name="esc" value="prof"> De todas as aulas deste professor no mês</label>
        <label><input type="radio" name="esc" value="global"> De todas as aulas do mês (todos os professores)</label>
      </div>
      <label style="font-size:.82rem;font-weight:700">Motivo (obrigatório)<textarea id="pgDlgMot" rows="3" style="width:100%;margin-top:4px" placeholder="Ex.: trancou no meio do mês; aluna de cortesia; lançamento errado no EVO"></textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="ui-btn sec" id="pgDlgCancel">Cancelar</button><button type="button" class="save" id="pgDlgOk">Excluir</button></div>
    </form></dialog>
    ${scriptPagina(ym)}
  </div>`;
}

function scriptPagina(ym) {
  return `<script>(function(){
  var YM=${JSON.stringify(ym)};
  function post(url,dados){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({m:YM},dados))}).then(function(r){return r.json();});}
  function guardarAbertos(){try{var ks=[].map.call(document.querySelectorAll('details[data-k][open]'),function(d){return d.getAttribute('data-k');});sessionStorage.setItem('pgAbertos',JSON.stringify(ks));sessionStorage.setItem('pgScroll',String(window.scrollY));}catch(e){}}
  function recarregar(){guardarAbertos();location.reload();}
  try{var ks=JSON.parse(sessionStorage.getItem('pgAbertos')||'[]');ks.forEach(function(k){var d=document.querySelector('details[data-k="'+k.replace(/"/g,'')+'"]');if(d)d.open=true;});var sy=+sessionStorage.getItem('pgScroll')||0;sessionStorage.removeItem('pgAbertos');sessionStorage.removeItem('pgScroll');if(sy)window.scrollTo(0,sy);}catch(e){}
  var dlg=document.getElementById('pgDlg'),atual=null;
  document.addEventListener('click',function(ev){
    var b=ev.target.closest&&ev.target.closest('[data-exc],[data-desfazer],[data-oculto],[data-ins]'); if(!b) return;
    ev.preventDefault(); ev.stopPropagation();
    if(b.hasAttribute('data-exc')){
      atual={m:b.getAttribute('data-exc'),nome:b.getAttribute('data-nome'),prof:b.getAttribute('data-prof')||'',profNome:b.getAttribute('data-profnome')||'',s:b.getAttribute('data-s')||'',sDesc:b.getAttribute('data-sdesc')||''};
      var glob=b.getAttribute('data-global')==='1';
      document.getElementById('pgDlgNome').textContent=atual.nome+(atual.sDesc?' — aula '+atual.sDesc:'')+(atual.profNome?' · '+atual.profNome:'');
      [].forEach.call(document.querySelectorAll('#pgDlgEsc input'),function(i){var so=i.value==='global';i.parentNode.style.display=(glob&&!so)?'none':'';i.checked=glob?so:i.value==='sessao';});
      document.getElementById('pgDlgMot').value=''; dlg.showModal(); return;
    }
    if(b.hasAttribute('data-desfazer')){ if(!confirm('Desfazer este ajuste? O cálculo volta a considerar a aluna como antes.')) return; post('/pagamento/desfazer',{id:b.getAttribute('data-desfazer')}).then(function(j){ if(j.ok) recarregar(); else alert('❌ '+(j.erro||'falhou')); }); return; }
    if(b.hasAttribute('data-oculto')){ var h=b.getAttribute('data-oculto'); var tirar=b.classList.contains('pg-x'); if(!confirm(tirar?('Tirar o horário '+h+' (segunda a sexta) do cálculo deste mês?'):('Voltar o horário '+h+' para o cálculo?'))) return; post('/pagamento/oculto',{h:h}).then(function(j){ if(j.ok) recarregar(); else alert('❌ '+(j.erro||'falhou')); }); return; }
    if(b.hasAttribute('data-ins')){ var s=b.getAttribute('data-ins'); var sel=document.querySelector('select[data-ins-sel="'+s+'"]'); if(!sel||!sel.value){ alert('Escolha a aluna na lista.'); return; } var op=sel.options[sel.selectedIndex]; var mot=prompt('Motivo da inclusão (opcional):','')||''; post('/pagamento/inserir',{m2:sel.value,nome:op.getAttribute('data-nome'),s:s,prof:b.getAttribute('data-prof'),sDesc:b.getAttribute('data-sdesc'),motivo:mot}).then(function(j){ if(j.ok) recarregar(); else alert('❌ '+(j.erro||'falhou')); }); return; }
  });
  document.getElementById('pgDlgCancel').onclick=function(){dlg.close();};
  document.getElementById('pgDlgOk').onclick=function(){
    var mot=document.getElementById('pgDlgMot').value.trim(); if(mot.length<3){ alert('Informe o motivo da exclusão.'); return; }
    var esc=(document.querySelector('#pgDlgEsc input:checked')||{}).value||'sessao';
    post('/pagamento/excluir',{m2:atual.m,nome:atual.nome,escopo:esc,prof:atual.prof,profNome:atual.profNome,s:atual.s,sDesc:atual.sDesc,motivo:mot}).then(function(j){ if(j.ok){ dlg.close(); recarregar(); } else alert('❌ '+(j.erro||'falhou')); });
  };
  var cb=document.getElementById('pgSoSemPag');
  if(cb) cb.onchange=function(){ var n=0; [].forEach.call(document.querySelectorAll('#pgGcTab tbody tr'),function(tr){ var mostra=!cb.checked||tr.getAttribute('data-pag')!=='ok'; tr.style.display=mostra?'':'none'; if(mostra)n++; }); var e=document.getElementById('pgGcN'); if(e) e.textContent=n+' exibidas'; };
})();</script>`;
}

// Relatório de UM professor para imprimir / salvar em PDF (página própria, sem o menu).
function relatorio({ esc, ym, prof, studio }) {
  const r = calc.calcularMes(+ym.slice(0, 4), +ym.slice(5, 7));
  const p = r.ok && r.professores.find(x => x.chave === prof);
  if (!p) return `<!doctype html><meta charset="utf-8"><p>Professor ou mês sem dados.</p>`;
  const aulasCom = p.turmas.flatMap(t => t.aulas.map(a => ({ a, p: p.nome })));
  const linhasT = p.turmas.map(t => {
    const porDia = new Map(); for (const a of t.aulas) (porDia.get(a.wd) || porDia.set(a.wd, []).get(a.wd)).push(a);
    return `<tr class="t"><td colspan="4"><b>${esc(t.nome)}</b></td><td class="n"><b>${brl(t.total)}</b></td></tr>` + [...porDia.entries()].sort((u, w) => u[0] - w[0]).map(([wd, aulas]) => aulas.map(a => `<tr><td>${br(a.data)} ${DSEM[wd].slice(0, 3)}</td><td>${esc(a.hora)}</td><td>${a.alunas.filter(x => x.contrib > 0).map(x => esc(primeiro(x.nome)) + ' ' + brl(x.contrib)).join(', ') || '—'}</td><td>${esc(a.regra || '')}</td><td class="n">${brl(a.valor)}</td></tr>`).join('')).join('');
  }).join('');
  const exc = (p.exclusoes || []).map(x => `<li><b>${esc(x.nome)}</b> excluída ${x.escopo === 'global' ? 'de todas as aulas do mês' : x.escopo === 'prof' ? 'das aulas deste professor' : 'da aula ' + esc(x.sDesc)} — ${esc(x.motivo)}</li>`).concat((p.insercoes || []).map(x => `<li><b>${esc(x.nome)}</b> incluída na aula ${esc(x.sDesc)}${x.motivo ? ' — ' + esc(x.motivo) : ''}</li>`)).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remuneração — ${esc(p.nome)} — ${esc(rotMes(ym))}</title>
  <style>body{font-family:Inter,system-ui,sans-serif;color:#1d2b2b;background:#fff;margin:0;padding:28px;font-size:13px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 6px}.sub{color:#5e6b6b;margin:4px 0 0}.box{display:flex;gap:24px;flex-wrap:wrap;border:1px solid #d8e4e3;border-radius:10px;padding:12px 16px;margin:16px 0}.box b{display:block;font-size:17px}table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #e6eeed;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#5e6b6b}td.n,th.n{text-align:right;white-space:nowrap}tr.t td{background:#f1f7f6}.pg-mz td,.pg-mz th{text-align:center;font-size:12px}.pg-mz-a{font-weight:700}.pg-mz-t{color:#5e6b6b}.pg-mz-v{color:#b9c4c3}.tot{font-size:18px;text-align:right;margin-top:14px}.acts{margin:0 0 16px}@media print{.acts{display:none}body{padding:0}}</style></head><body>
  <div class="acts"><button onclick="window.print()">🖨️ Imprimir / salvar em PDF</button></div>
  <h1>Relatório de remuneração — ${esc(p.nome)}</h1><p class="sub">${esc(studio || 'Studio SlimFit')} · ${esc(rotMes(ym))} · gerado em ${quando(new Date().toISOString())}</p>
  <div class="box"><span>Percentual<b>${p.pct}%</b></span><span>Piso / teto por aula<b>${brl(p.piso)} / ${brl(p.teto)}</b></span><span>Aulas<b>${p.nAulas}</b></span><span>Média por aula<b>${brl(avg(p.total, pagas(p)))}</b></span><span>Total do mês<b>${brl(p.total)}</b></span></div>
  <h2>Matriz de horários</h2>${matriz(esc, aulasCom, [1, 2, 3, 4, 5, 6])}
  <h2>Aulas do mês</h2><table><thead><tr><th>Data</th><th>Hora</th><th>Alunas que contam (valor por aula)</th><th>Regra</th><th class="n">Valor</th></tr></thead><tbody>${linhasT}</tbody></table>
  ${exc ? `<h2>Ajustes manuais</h2><ul>${exc}</ul>` : ''}
  <div class="tot">Total do mês: <b>${brl(p.total)}</b></div>
  </body></html>`;
}

function paginaConfig({ esc, uiTopo, subnav, aviso, erro }) {
  const cfg = pcfg.ler(); const R = cfg.regras;
  // Professores: os da grade dos últimos meses lidos + os já configurados.
  const vistos = new Map();
  for (let k = 0; k < 4; k++) {
    const ym = somaMes(mesAtualSP(), -k); const d = sync.lerMes(+ym.slice(0, 4), +ym.slice(5, 7));
    for (const a of (d && d.aulas) || []) { const ch = a.pi ? a.pi : 'nome:' + pcfg.norm(a.p || 'sem professor'); if (!vistos.has(ch)) vistos.set(ch, a.p || ch); }
  }
  for (const [ch, p] of Object.entries(cfg.professores)) if (!vistos.has(ch)) vistos.set(ch, p.nome || ch);
  const num = (k, rot, passo = '0.01') => `<label>${rot}<input type="number" step="${passo}" name="${k}" value="${esc(String(R[k]))}" min="${pcfg.LIMITES[k][0]}" max="${pcfg.LIMITES[k][1]}" required></label>`;
  const linhaP = ([ch, nome]) => {
    const p = cfg.professores[ch]; const hist = (p && p.hist) || [];
    const orfa = ch.startsWith('nome:') ? ' <span class="pg-pill warn" title="Veio do Supabase pelo nome e não casou com um professor da grade do EVO">sem código do EVO</span>' : '';
    return `<div class="card"><div style="font-weight:800">${esc(nome)}${orfa} <small style="font-weight:600;color:var(--cinza)">${ch.startsWith('nome:') ? '' : 'código EVO ' + esc(ch)}</small></div>
      ${hist.length ? `<div class="pg-wrap"><table class="pg-tab" style="margin:6px 0"><thead><tr><th>Desde</th><th class="n">%</th><th class="n">Piso</th><th class="n">Teto</th><th></th></tr></thead><tbody>${hist.slice().reverse().map(h => `<tr><td>${esc(rotMes(h.desde))}</td><td class="n">${h.pct}%</td><td class="n">${brl(h.piso)}</td><td class="n">${brl(h.teto)}</td><td class="n"><form method="POST" action="/pagamento/professor/remover" style="margin:0" onsubmit="return confirm('Remover esta vigência?')"><input type="hidden" name="chave" value="${esc(ch)}"><input type="hidden" name="desde" value="${esc(h.desde)}"><button class="ui-btn sec" style="padding:2px 9px;font-size:.75rem">remover</button></form></td></tr>`).join('')}</tbody></table></div>` : `<p class="quando" style="margin:4px 0">Sem percentual próprio — usa o padrão (${R.pctPadrao}% · piso ${brl(R.pisoPadrao)} · teto ${brl(R.tetoPadrao)}).</p>`}
      <form method="POST" action="/pagamento/professor" class="pg-form" style="margin-top:6px"><input type="hidden" name="chave" value="${esc(ch)}"><input type="hidden" name="nome" value="${esc(nome)}">
        <label>Vale desde<input type="month" name="desde" value="${esc(mesAtualSP())}" required style="width:150px"></label>
        <label>%<input type="number" step="0.1" name="pct" value="${hist.length ? hist[hist.length - 1].pct : R.pctPadrao}" required></label>
        <label>Piso (R$)<input type="number" step="0.01" name="piso" value="${hist.length ? hist[hist.length - 1].piso : R.pisoPadrao}" required></label>
        <label>Teto (R$)<input type="number" step="0.01" name="teto" value="${hist.length ? hist[hist.length - 1].teto : R.tetoPadrao}" required></label>
        <button class="save" type="submit">Salvar</button></form></div>`;
  };
  return `<div class="wrap">${subnav}${CSS}
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${uiTopo({ titulo: 'Regras e percentuais', sub: 'Valores usados no cálculo do pagamento. Mudou o percentual de alguém? Salve com o mês em que passa a valer — os meses anteriores continuam com o valor antigo.', acoes: '<a class="ui-btn sec" href="/pagamento">← Voltar ao pagamento</a>' })}
    <div class="ui-secoes">
    <div class="sec-t">Regras gerais</div>
    <div class="card"><form method="POST" action="/pagamento/regras">
      <div class="pg-form">${num('freeValor', 'Free/avulsa por presença (R$)')}${num('sabadoValor', 'Diária do sábado (R$)')}${num('descontoFixoPct', 'Desconto na mensalidade das fixas (%)')}${num('capacidade', 'Presenças máximas por aula', '1')}</div>
      <div class="pg-form" style="margin-top:10px">${num('pctPadrao', '% padrão')}${num('pisoPadrao', 'Piso padrão (R$)')}${num('tetoPadrao', 'Teto padrão (R$)')}</div>
      <label style="display:block;margin-top:10px;font-size:.8rem;font-weight:700;color:var(--cinza)">Alunas VIP que não contam (uma por linha; vale parte do nome)
        <textarea name="vipZero" rows="4" style="width:100%;margin-top:4px">${esc((R.vipZero || []).join('\n'))}</textarea></label>
      <div class="acts" style="margin-top:8px"><button class="save" type="submit">Salvar regras</button></div></form></div>
    <div class="sec-t">Professores</div>
    ${[...vistos].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(linhaP).join('') || '<div class="card"><p class="quando" style="margin:0">Nenhum professor ainda — atualize os dados do EVO na tela do pagamento.</p></div>'}
    <div class="sec-t">Trazer do sistema antigo (Supabase)</div>
    <div class="card"><p class="quando" style="margin:0 0 8px">No Supabase: Table Editor → <b>ProfessorPercentual</b> → Export → CSV. Escolha o arquivo aqui: os percentuais, pisos e tetos entram casados pelo nome do professor. Pode repetir — não duplica.</p>
      <form method="POST" action="/pagamento/importar" enctype="text/plain" id="pgImp"><input type="file" accept=".csv,text/csv" id="pgImpArq"><input type="hidden" name="csv" id="pgImpCsv"><button type="button" class="ui-btn" onclick="pgImportar()">Importar</button> <span class="quando" id="pgImpMsg"></span></form>
      <script>function pgImportar(){var f=document.getElementById('pgImpArq').files[0],m=document.getElementById('pgImpMsg');if(!f){m.textContent='Escolha o arquivo .csv.';return;}var r=new FileReader();r.onload=function(){m.textContent='Importando…';fetch('/pagamento/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:r.result})}).then(function(x){return x.json();}).then(function(j){if(j.ok){m.textContent='✅ '+j.importados+' registro(s) importado(s)'+(j.semPar&&j.semPar.length?' · sem par na grade do EVO: '+j.semPar.join(', '):'');setTimeout(function(){location.reload();},1800);}else m.textContent='❌ '+(j.erro||'falhou');}).catch(function(){m.textContent='❌ erro de rede';});};r.readAsText(f);}</script></div>
    </div></div>`;
}

module.exports = { pagina, paginaConfig, relatorio, mesAtualSP };

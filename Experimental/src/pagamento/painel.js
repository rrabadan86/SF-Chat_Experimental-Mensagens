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
@media print{nav,.subtabs,.ui-acoes,.ui-linha,.no-print,.hbar{display:none!important}.card{box-shadow:none;border:0}}
</style>`;

function situacaoSync(st) {
  if (st.rodando) return `⏳ Lendo o EVO (${st.mes ? rotMes(st.mes) : ''}): ${st.etapa || 'começando'}… atualize a página em alguns minutos.`;
  if (st.ok === false) return `⚠️ A última leitura falhou${st.fim ? ' (' + quando(st.fim) + ')' : ''}: ${st.erro || ''}`;
  if (st.fim) return `Última leitura do EVO: ${quando(st.fim)}${st.mes ? ' · ' + rotMes(st.mes) : ''}${st.segundos ? ' · ' + st.segundos + ' s' : ''}. O robô relê toda madrugada.`;
  return 'Ainda não houve leitura do EVO. Clique em "Atualizar dados do EVO".';
}

function pagina({ esc, uiTopo, uiChips, subnav, ym, prof, aviso }) {
  ym = /^\d{4}-\d{2}$/.test(ym || '') ? ym : mesAtualSP();
  const st = sync.lerStatus();
  const r = calc.calcularMes(+ym.slice(0, 4), +ym.slice(5, 7));
  const atual = mesAtualSP();
  const meses = [somaMes(atual, -3), somaMes(atual, -2), somaMes(atual, -1), atual].map(m => [`/pagamento?m=${m}`, rotMes(m), m === ym]);
  const acoes = `<form method="POST" action="/pagamento/sync" style="margin:0" class="no-print"><input type="hidden" name="m" value="${esc(ym)}"><button class="ui-btn sec" type="submit"${st.rodando ? ' disabled' : ''}>🔄 Atualizar dados do EVO</button></form>
    <a class="ui-btn sec no-print" href="/pagamento/config">⚙️ Regras e percentuais</a>
    <button type="button" class="ui-btn sec no-print" onclick="window.print()">🖨️ Imprimir</button>`;
  const topo = uiTopo({
    titulo: 'Pagamento dos professores',
    sub: `Valor de cada aula de ${esc(rotMes(ym))}, calculado pelas listas do EVO: fixas matriculadas (mesmo com falta) + presentes de Free/reposição; piso e teto por aula; sábado com diária fixa. Aulas que ainda vão acontecer entram como previsão.`,
    acoes,
    linhas: [uiChips('Mês', meses), `<div class="ui-nota${st.ok === false ? ' erro' : ''}"><span>${esc(situacaoSync(st))}</span></div>`],
  });
  if (!r.ok) return `<div class="wrap">${subnav}${CSS}${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}${topo}<div class="card"><p class="quando" style="margin:0">${esc(r.erro)}</p></div></div>`;

  const nAulas = r.professores.reduce((s, p) => s + p.nAulas, 0);
  const todas = r.professores.flatMap(p => p.turmas.flatMap(t => t.aulas));
  const nPiso = todas.filter(a => a.regra === 'piso').length, nTeto = todas.filter(a => a.regra === 'teto').length;
  const stats = `<div class="stats">
    <div class="stat tot"><div class="n">${brl(r.total)}</div><div class="l">total de ${esc(rotMes(ym))}</div></div>
    <div class="stat"><div class="n">${r.professores.length}</div><div class="l">professores</div></div>
    <div class="stat"><div class="n">${nAulas}</div><div class="l">aulas no mês</div></div>
    <div class="stat"><div class="n">${nPiso} · ${nTeto}</div><div class="l">aulas no piso · no teto</div></div>
  </div>`;
  const avisos = r.avisos.length ? `<div class="card" style="border-left:4px solid var(--warn)"><div style="font-weight:800;margin-bottom:6px">⚠️ Para conferir (${r.avisos.length})</div>${r.avisos.slice(0, 30).map(a => `<div class="quando" style="margin:2px 0">${esc(a)}</div>`).join('')}</div>` : '';

  const linhaProf = (p) => `<div class="pg-prof">
      <a class="nm" href="/pagamento?m=${esc(ym)}&prof=${encodeURIComponent(p.chave)}#det">${esc(p.nome)}</a>
      <span class="meta">${p.pct}% · piso ${brl(p.piso)} · teto ${brl(p.teto)}${p.configurado ? '' : '<span class="pg-pill warn">padrão</span>'} · ${p.nAulas} aula${p.nAulas === 1 ? '' : 's'}</span>
      <span class="tot">${brl(p.total)}</span></div>`;

  let det = '';
  const P = prof ? r.professores.find(p => p.chave === prof) : null;
  if (P) {
    det = `<div class="sec-t" id="det">${esc(P.nome)} — ${brl(P.total)} <small style="font-weight:600;color:var(--cinza)">(${P.pct}% · piso ${brl(P.piso)} · teto ${brl(P.teto)})</small></div>` + P.turmas.map(t => `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-weight:800;margin-bottom:6px"><span>${esc(t.nome)}</span><span style="font-variant-numeric:tabular-nums">${brl(t.total)}</span></div>
      <div class="pg-wrap"><table class="pg-tab"><thead><tr><th>Aula</th><th>Alunas que contam</th><th class="n">Soma</th><th class="n">Valor</th></tr></thead><tbody>
      ${t.aulas.map(a => {
        const conta = a.alunas.filter(x => x.contrib > 0);
        const outras = a.alunas.filter(x => !(x.contrib > 0));
        const linhaAl = (x) => `<div><b>${esc(x.nome)}</b> · ${x.tipo === 'fixo' ? 'fixa' : 'free'} · ${esc(x.presenca)}${x.contrib > 0 ? ` · <b>${brl(x.contrib)}</b>` : ''}${x.tipo === 'fixo' && x.aulasMes ? ` <span title="mensalidade (já com o desconto) ÷ aulas dela no mês × %">(${brl(x.mensalidade)} ÷ ${x.aulasMes} aulas × ${P.pct}%)</span>` : ''} · ${esc(x.plano)}${x.pagou === false ? ' · <span style="color:#a12626">não pagou o mês</span>' : ''}${x.nota ? ' · ' + esc(x.nota) : ''}</div>`;
        return `<tr${a.futura ? ' class="fut"' : ''}><td style="white-space:nowrap"><b>${br(a.data)}</b> ${esc(a.dia.slice(0, 3))} ${esc(a.hora)}${a.futura ? '<div class="quando" style="margin:0">previsão</div>' : ''}<div class="quando" style="margin:0">${a.presencas} presença${a.presencas === 1 ? '' : 's'}</div></td>
          <td><details><summary style="cursor:pointer">${conta.length} contam${outras.length ? ` · ${outras.length} sem valor` : ''}</summary><div class="pg-al">${conta.map(linhaAl).join('')}${outras.length ? `<div style="margin-top:4px;opacity:.8">${outras.map(linhaAl).join('')}</div>` : ''}</div></details>${a.avisos.map(v => `<div class="pg-av">⚠️ ${esc(v)}</div>`).join('')}</td>
          <td class="n">${brl(a.bruto)}</td>
          <td class="n"><b>${brl(a.valor)}</b>${a.regra ? `<div><span class="pg-reg${a.regra === 'teto' ? ' teto' : ''}">${esc(a.regra)}</span></div>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>`).join('');
  }

  return `<div class="wrap">${subnav}${CSS}
    ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
    ${topo}
    ${stats}
    ${avisos}
    <div class="ui-secoes">
    <div class="sec-t">Por professor</div>
    <div class="card">${r.professores.map(linhaProf).join('') || '<p class="quando" style="margin:0">Nenhuma aula no mês.</p>'}
      <p class="quando" style="margin:10px 0 0">Clique no professor para ver aula por aula e quem contou. <b>padrão</b> = professor sem percentual próprio (configure em ⚙️ Regras e percentuais). Dados do EVO de ${quando(r.atualizadoEm)}.</p></div>
    ${det}
    </div>
  </div>`;
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

module.exports = { pagina, paginaConfig, mesAtualSP };

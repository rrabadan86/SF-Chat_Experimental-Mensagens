/**
 * financeiro-resumo.js — separa os lançamentos do mês (recebíveis do EVO, lidos
 * pelo agendamento_evo/evo_agendamento/financeiro.py) em quatro grupos que não se
 * misturam: RECEBIDO, EM ATRASO, CARTÃO A CAIR e A VENCER.
 *
 * O número antigo, "faturamento do mês", era a soma de tudo o que VENCE no mês —
 * pago ou não, atrasado ou não. Lido como "dinheiro que entrou", enganava. O nome
 * certo é "previsto para receber"; o que entrou de fato é o "recebido".
 *
 * Usado pela Grade (indicadores), pelas Metas e pelo fechamento do mês — todos
 * mostram os mesmos números.
 */

// itens: [{ valor, pago, venc:'AAAA-MM-DD', sit:'pago'|'vencido'|'a receber', prov? }]
// hojeIso: o dia em que o EVO foi lido (a situação de cada lançamento vale para esse dia).
function resumir(itens, hojeIso) {
  const r = { n: 0, previsto: 0, recebido: 0, atraso: 0, aCair: 0, aVencer: 0, nAtraso: 0, jaVenceu: 0, vencAteHoje: 0, inadPct: null, temProv: false };
  if (!Array.isArray(itens)) return r;
  const hoje = /^\d{4}-\d{2}-\d{2}/.test(String(hojeIso || '')) ? String(hojeIso).slice(0, 10) : '';
  for (const it of itens) {
    const v = Number(it && it.valor);
    if (!it || !isFinite(v)) continue;
    const sit = String(it.sit || '').toLowerCase();
    r.n++; r.previsto += v;
    // tudo o que tinha vencimento até hoje (pago ou não): o "esperado até hoje" das Metas
    if (!hoje || !it.venc || String(it.venc).slice(0, 10) <= hoje) r.vencAteHoje += v;
    if (it.prov != null) r.temProv = true;
    if (sit === 'pago') {
      const pg = Number(it.pago);
      r.recebido += isFinite(pg) && it.pago != null ? pg : v;
      // base da inadimplência: o que já devia ter sido pago até hoje
      if (!hoje || !it.venc || String(it.venc).slice(0, 10) <= hoje) r.jaVenceu += v;
    } else if (it.prov) {
      // cartão já passado: a operadora ainda vai repassar — não é atraso da aluna
      r.aCair += v;
    } else if (sit === 'vencido') {
      r.atraso += v; r.nAtraso++; r.jaVenceu += v;
    } else {
      r.aVencer += v;
    }
  }
  for (const k of ['previsto', 'recebido', 'atraso', 'aCair', 'aVencer', 'jaVenceu', 'vencAteHoje']) r[k] = Math.round(r[k] * 100) / 100;
  // Inadimplência = em atraso ÷ tudo o que já venceu (pago + em atraso). O que
  // ainda vai vencer e o cartão a cair ficam fora das duas pontas.
  r.inadPct = r.jaVenceu > 0 ? Math.round(r.atraso * 1000 / r.jaVenceu) / 10 : null;
  return r;
}

module.exports = { resumir };

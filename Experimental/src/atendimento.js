/**
 * atendimento.js — quanto tempo a lead espera por uma resposta no WhatsApp da
 * SoFIA, e quem está esperando agora (Indicadores → Metas → Atendimento).
 *
 * Lê só o que já está nas conversas (autor e horário de cada mensagem). Uma
 * "espera" começa na primeira mensagem da pessoa depois de uma resposta (ou no
 * começo da conversa) e termina na próxima mensagem da SoFIA ou da equipe.
 * Resposta automática do WhatsApp da própria pessoa não abre espera.
 *
 * Limite: a conversa guarda as últimas mensagens (padrão 60) — serve para os
 * últimos dias, não para o ano inteiro.
 */
const mediana = (v) => { if (!v.length) return null; const o = v.slice().sort((a, b) => a - b), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };

// Esperas RESPONDIDAS que começaram entre `desde` e `ate` (ms).
// → { n, medianaSeg, ate5minPct, sofia: {n, medianaSeg}, equipe: {n, medianaSeg} }
function tempos(conversas, desde, ate) {
  const todas = [], por = { sofia: [], humano: [] };
  for (const k in (conversas || {})) {
    const msgs = (conversas[k] && Array.isArray(conversas[k].msgs)) ? conversas[k].msgs : [];
    let aberta = 0;
    for (const m of msgs) {
      if (!m || !m.em) continue;
      if (m.autor === 'aluna') { if (!aberta && m.tipo !== 'automatica') aberta = Number(m.em); continue; }
      if (!aberta) continue; // mensagem da SoFIA/equipe sem ninguém esperando (campanha, follow-up)
      const espera = (Number(m.em) - aberta) / 1000;
      if (espera >= 0 && aberta >= desde && aberta <= ate) { todas.push(espera); (por[m.autor === 'humano' ? 'humano' : 'sofia']).push(espera); }
      aberta = 0;
    }
  }
  const bloco = (v) => ({ n: v.length, medianaSeg: v.length ? Math.round(mediana(v)) : null });
  return { ...bloco(todas), ate5minPct: todas.length ? Math.round(todas.filter(x => x <= 300).length * 1000 / todas.length) / 10 : null, sofia: bloco(por.sofia), equipe: bloco(por.humano) };
}

// Quem está esperando AGORA: a última mensagem é da pessoa, há mais de `minMin`
// minutos, e a conversa não foi encerrada (à mão, ou sozinha depois de `sessaoMs`
// sem movimento). `encerrada(chave, conversa)` vem de quem chama.
// → [{ chave, nome, desde, min }] da espera mais antiga para a mais nova.
function esperando(conversas, { agora, minMin = 15, sessaoMs = 12 * 3600e3, encerrada } = {}) {
  const t = agora || Date.now(), out = [];
  for (const k in (conversas || {})) {
    const c = conversas[k] || {}, msgs = Array.isArray(c.msgs) ? c.msgs : [];
    if (!msgs.length) continue;
    const ult = msgs[msgs.length - 1];
    if (!ult || ult.autor !== 'aluna' || ult.tipo === 'automatica') continue;
    // começo da espera: a primeira mensagem dela depois da última resposta
    let desde = Number(ult.em) || 0;
    for (let i = msgs.length - 1; i >= 0 && msgs[i] && msgs[i].autor === 'aluna'; i--) if (msgs[i].tipo !== 'automatica') desde = Number(msgs[i].em) || desde;
    if (!desde || t - Number(ult.em) > sessaoMs) continue;
    if (t - desde < minMin * 60000) continue;
    try { if (encerrada && encerrada(k, c)) continue; } catch (_) {}
    out.push({ chave: k, nome: String(c.nome || '').trim(), desde, min: Math.round((t - desde) / 60000) });
  }
  return out.sort((a, b) => a.desde - b.desde);
}

// "42 s", "7 min", "2 h 10 min", "1 d 3 h"
function fmtEspera(seg) {
  if (seg == null || !isFinite(seg)) return '—';
  if (seg < 90) return `${Math.round(seg)} s`;
  const min = Math.round(seg / 60);
  if (min < 90) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 36) return `${h} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}`;
  return `${Math.floor(h / 24)} d${h % 24 ? ' ' + (h % 24) + ' h' : ''}`;
}

module.exports = { tempos, esperando, fmtEspera };

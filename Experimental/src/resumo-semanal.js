/**
 * resumo-semanal.js — RESUMO DA SEMANA no WhatsApp (grupo da equipe).
 *
 * Substitui o resumo antigo, que abria o EVO no navegador para ler 4 cartões. Agora
 * usa o que o robô já guarda e manda texto + imagem (texto como legenda), igual ao
 * resumo mensal (resumo-mensal.js, de onde vêm as peças em comum):
 *   • agendamentos da semana por canal (SoFIA, Formulário, Express) — como no Funil;
 *   • aulas experimentais: vieram, faltaram, fecharam (regra da tela Professoras);
 *   • por professora (opcional);
 *   • alunas ativas: entradas e saídas na semana × semana anterior (opcional);
 *   • quem veio e ainda não fechou, para a recepção ligar (opcional);
 *   • imagem com mini gráfico das últimas 8 semanas.
 * A semana = os 7 dias que terminam ONTEM (a presença de hoje ainda não foi lida).
 *
 * Liga/desliga e dia/horário são os de sempre ("Resumo da semana (equipe)" em
 * WhatsApp → Outros envios, chave resumoSemana); grupos e opções em
 * data/resumo-semanal.json. O robô confere a cada 5 min — mudar não pede reinício.
 *
 * Uso à mão (na pasta Experimental):  node src/resumo-semanal.js --previa
 */
const fs = require('fs');
const path = require('path');
const ativasDados = require('./ativas-dados');
const rm = require('./resumo-mensal');
const { somaDias, fmtD, pct, sinal, esc } = rm;

const CHAVE = 'resumoSemana'; // liga/desliga (jobs-ativos) e horário (horarios.js)
const ARQ_CFG = path.resolve(__dirname, '..', 'data', 'resumo-semanal.json');
const ARQ_IMG = path.resolve(__dirname, '..', 'data', 'resumo-semanal.png');
const PADRAO = { grupos: null, porProfessora: true, pendentes: true, ativas: true, enviados: {}, ultimo: null, tentativa: null };
const DS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function grupoEquipe() { try { return require('./grupos').equipe(); } catch (_) { return ''; } }
function lerCfg() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(ARQ_CFG, 'utf8')) || {}; } catch (_) {}
  const c = Object.assign({}, PADRAO, o, { enviados: Object.assign({}, o.enviados || {}) });
  // sem grupo salvo ainda: o grupo da equipe (onde o resumo antigo chegava)
  if (!Array.isArray(c.grupos)) c.grupos = [grupoEquipe()].filter(Boolean);
  try { c.ativo = require('./jobs-ativos').ativo(CHAVE); } catch (_) { c.ativo = true; }
  try { const hr = require('./horarios'); Object.assign(c, hr.parse(hr.cronDe(CHAVE))); } catch (_) { c.hora = '16:30'; c.dias = [5]; }
  return c;
}
function salvarCfg(mudar) {
  const atual = lerCfg();
  const o = {};
  for (const k of Object.keys(PADRAO)) o[k] = atual[k];
  Object.assign(o, mudar || {});
  o.grupos = (Array.isArray(o.grupos) ? o.grupos : String(o.grupos || '').split('\n')).map(g => String(g).trim()).filter(Boolean).slice(0, 5);
  o.porProfessora = !!o.porProfessora; o.pendentes = !!o.pendentes; o.ativas = !!o.ativas;
  // liga/desliga e horário moram onde sempre moraram
  if (mudar && 'ativo' in mudar) { try { require('./jobs-ativos').setAtivo(CHAVE, !!mudar.ativo); } catch (_) {} }
  if (mudar && mudar.hora && Array.isArray(mudar.dias)) require('./horarios').salvar(CHAVE, mudar.hora, mudar.dias);
  delete o.ativo; delete o.hora; delete o.dias;
  if (!fs.existsSync(path.dirname(ARQ_CFG))) fs.mkdirSync(path.dirname(ARQ_CFG), { recursive: true });
  const tmp = ARQ_CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, ARQ_CFG);
  return lerCfg();
}

// ── agendamentos por canal (mesma fonte do Funil: o histórico de tags) ───────
function agendamentosPorJanela(janelas) {
  let tagLog = {}, agTags = [], canalMap = {};
  try { tagLog = require('./sofia-editor').lerTagLog() || {}; } catch (_) {}
  try { agTags = require('./contatos').tagsPorGatilho('agendou').map(a => String(a.tag || '').trim()); } catch (_) {}
  try { canalMap = JSON.parse(fs.readFileSync(path.join(require('./sofia-editor').DIR, 'sofia-agendaram-canal.json'), 'utf8')) || {}; } catch (_) {}
  const diaDe = (ms) => { try { return new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  return janelas.map(([de, ate]) => {
    const r = { total: 0, sofia: 0, formulario: 0, express: 0, outro: 0 };
    for (const l8 in tagLog) {
      // último agendamento da pessoa DENTRO da janela (e o canal daquele evento)
      let ult = null;
      for (const e of tagLog[l8]) {
        const ehAg = e.acao === 'add' && (e.motivo === 'agendou' || agTags.includes(String(e.tag || '').trim()));
        if (!ehAg || !e.em) continue;
        const d = diaDe(e.em);
        if (d >= de && d <= ate && (!ult || e.em > ult.em)) ult = e;
      }
      if (!ult) continue;
      const canal = ult.canal || String(canalMap[l8] || '').trim();
      r.total++; r[r[canal] != null ? canal : 'outro']++;
    }
    return r;
  });
}

// ── números da semana ────────────────────────────────────────────────────────
// ate = último dia da semana (padrão: ontem). A semana são os 7 dias até ele.
function dadosDaSemana(ate, cfg) {
  cfg = cfg || lerCfg();
  const hoje = rm.agoraSP().dia;
  ate = /^\d{4}-\d{2}-\d{2}$/.test(ate || '') && ate < hoje ? ate : somaDias(hoje, -1);
  const de = somaDias(ate, -6);
  const h = ativasDados.ler();
  const janelas = Array.from({ length: 8 }, (_, i) => [somaDias(de, -7 * (7 - i)), somaDias(ate, -7 * (7 - i))]);
  const ags = agendamentosPorJanela(janelas);
  const exps = janelas.map(([a, b]) => rm.experimentaisPeriodo(h, a, b));
  const ag = ags[7], exp = exps[7];
  // alunas ativas: fim de ontem × fim da semana anterior
  let ativas = null;
  if (cfg.ativas) {
    const ser = ativasDados.serie(h.reconstruido);
    const idx = (d) => { let k = -1; for (let i = 0; i < ser.length; i++) if (ser[i].dia <= d) k = i; else break; return k; };
    const iF = idx(ate), iI = idx(somaDias(de, -1));
    if (iF >= 0 && iI >= 0) {
      let e = 0, n = 0, s = 0;
      for (let i = iI + 1; i <= iF; i++) { e += ser[i].e; n += ser[i].n; s += ser[i].s; }
      ativas = { fim: ser[iF].a, ini: ser[iI].a, entraram: e, novas: n, sairam: s };
    }
  }
  const profs = exp && cfg.porProfessora ? Object.entries(exp.profs).map(([nome, p]) => Object.assign({ nome }, p)).filter(p => p.exp)
    .sort((a, b) => b.fechou - a.fechou || b.veio - a.veio || a.nome.localeCompare(b.nome)) : null;
  return {
    de, ate, rotulo: `${fmtD(de)} a ${fmtD(ate)}`,
    ag, exp, ativas, profs,
    pendentes: exp && cfg.pendentes ? exp.pendentes : null,
    historico: janelas.map(([a, b], i) => ({ rot: fmtD(b), ag: ags[i].total, veio: exps[i] ? exps[i].veio : 0, fechou: exps[i] ? exps[i].fechou : 0 })),
    vazio: !ag.total && !exp,
  };
}

// ── texto ────────────────────────────────────────────────────────────────────
const nomeCurto = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : p.join(' '); };
function textoPendentes(d) {
  if (!d.pendentes || !d.pendentes.length) return '';
  const L = ['📞 *Vieram e ainda não fecharam* (para a recepção ligar):'];
  d.pendentes.slice(0, 30).forEach(p => L.push(`• ${p.nome} — aula ${DS[new Date(p.dia + 'T12:00:00Z').getUTCDay()]} ${fmtD(p.dia)}${p.prof ? ` (${nomeCurto(p.prof).split(' ')[0]})` : ''}`));
  if (d.pendentes.length > 30) L.push(`• … e mais ${d.pendentes.length - 30}`);
  return L.join('\n');
}
function texto(d, semPendentes) {
  const L = [`📊 *Resumo da semana — ${d.rotulo}*`, ''];
  const ag = d.ag, e = d.exp;
  const canais = [['sofia', '🤖 SoFIA'], ['formulario', '📲 Formulário'], ['express', '🏪 Express'], ['outro', 'outros']].filter(([k]) => ag[k]).map(([k, r]) => `${r} ${ag[k]}`).join(' · ');
  L.push('🏋️ *Aulas experimentais*');
  L.push(`• Agendaram na semana: *${ag.total}*${canais ? ` (${canais})` : ''}`);
  if (e) {
    L.push(`• Aulas: *${e.exp}* · vieram *${e.veio}* · faltaram *${e.faltou}* (presença ${pct(e.veio, e.veio + e.faltou, 0)})`);
    L.push(`• Fecharam contrato: *${e.fechou}* de ${e.veio} (conversão ${pct(e.fechou, e.veio, 0)})`);
  } else L.push('• Nenhuma aula experimental lida no EVO nesta semana.');
  if (d.profs && d.profs.length) {
    L.push('', '👩‍🏫 *Por professora* (fecharam de quem veio)');
    d.profs.forEach(p => L.push(`• ${nomeCurto(p.nome)}: ${p.fechou} de ${p.veio}${p.exp > p.veio ? ` · ${p.exp} aula${p.exp === 1 ? '' : 's'}` : ''}`));
  }
  if (d.ativas) {
    const a = d.ativas;
    L.push('', `👥 *Alunas ativas:* *${a.fim}* (+${a.entraram} · −${a.sairam} na semana)`);
    L.push(`vs. semana anterior: ${a.ini} → ${a.fim} (${sinal(a.fim - a.ini)})`);
  }
  if (!semPendentes && d.pendentes && d.pendentes.length) L.push('', textoPendentes(d));
  L.push('', '_Não contam: aula de evento (já era aluna), professora lançada como aluna e contratos CIRCUITO/VIP._');
  return L.join('\n');
}

// ── imagem 1080×1350 ─────────────────────────────────────────────────────────
function imagemHtml(d, studio) {
  const e = d.exp || { exp: 0, veio: 0, faltou: 0, fechou: 0 };
  // barras agrupadas: vieram × fecharam nas últimas 8 semanas
  const W = 920, H = 380, pl = 10, pr = 10, pt = 34, pb = 44;
  const mx = Math.max(4, ...d.historico.map(x => Math.max(x.veio, x.fechou)));
  const n = d.historico.length, gw = (W - pl - pr) / n, bw = Math.min(34, gw * 0.32);
  const Y = (v) => pt + (H - pt - pb) * (1 - v / mx);
  const barra = (x, v, cor) => v ? `<path d="M${x},${H - pb} V${(Y(v) + 4).toFixed(1)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - pb} Z" fill="${cor}"/>` : '';
  const barras = d.historico.map((s, i) => {
    const cx = pl + gw * i + gw / 2, x1 = cx - bw - 1, x2 = cx + 1;
    const ult = i === n - 1;
    return `${barra(x1, s.veio, '#00918a')}${barra(x2, s.fechou, '#c2660f')}
      ${ult ? `<text x="${x1 + bw / 2}" y="${Y(s.veio) - 8}" font-size="22" font-weight="800" fill="#1d1d1f" text-anchor="middle">${s.veio}</text><text x="${x2 + bw / 2}" y="${Y(s.fechou) - 8}" font-size="22" font-weight="800" fill="#1d1d1f" text-anchor="middle">${s.fechou}</text>` : ''}
      <text x="${cx}" y="${H - 12}" font-size="19" fill="${ult ? '#1d1d1f' : '#6e6e73'}" font-weight="${ult ? 700 : 500}" text-anchor="middle">${esc(s.rot)}</text>`;
  }).join('');
  const graf = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="#e4e4e7" stroke-width="2"/>${barras}</svg>`;
  const a = d.ativas;
  const tile = (n0, rot, cor, sub) => `<div class="t"><b style="color:${cor}">${n0}</b><span>${rot}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const profs = (d.profs || []).slice(0, 4);
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1080px;height:1350px;background:#f3f6f6;font-family:Inter,"DejaVu Sans","Liberation Sans",Arial,sans-serif;color:#1d1d1f;padding:60px 70px;display:flex;flex-direction:column;gap:26px}
  .top{display:flex;justify-content:space-between;align-items:baseline}
  .eyebrow{font-size:26px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0b6f6b}
  .studio{font-size:24px;font-weight:600;color:#6e6e73}
  h1{font-size:56px;font-weight:800;letter-spacing:-.02em;line-height:1.05;margin-top:6px}
  .cx{background:#fff;border-radius:26px;padding:28px 32px;box-shadow:0 2px 0 #e4e4e7}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center}
  .t b{display:block;font-size:78px;font-weight:800;line-height:1;letter-spacing:-.03em}
  .t span{display:block;font-size:24px;font-weight:700;margin-top:8px}
  .t small{display:block;font-size:21px;color:#6e6e73;font-weight:600;margin-top:4px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .rot{font-size:22px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
  .at{display:flex;align-items:baseline;gap:16px}.at b{font-size:76px;font-weight:800;color:#00918a;letter-spacing:-.03em;line-height:1}
  .at span{font-size:26px;font-weight:700}
  .at-s{font-size:24px;color:#6e6e73;font-weight:600;margin-top:10px}
  .pf{display:flex;justify-content:space-between;font-size:26px;padding:6px 0;border-bottom:1px solid #eeeef0}.pf:last-child{border:0}
  .pf b{font-weight:800}
  .leg{display:flex;gap:26px;font-size:22px;font-weight:600;color:#6e6e73;margin-bottom:4px}
  .leg i{display:inline-block;width:18px;height:18px;border-radius:5px;margin-right:8px;vertical-align:-2px}
  .rod{font-size:20px;color:#6e6e73;margin-top:auto}
</style></head><body>
  <div><div class="top"><div class="eyebrow">Resumo da semana</div><div class="studio">${esc(studio || '')}</div></div><h1>Experimentais — ${esc(d.rotulo)}</h1></div>
  <div class="cx tiles">
    ${tile(d.ag.total, 'agendaram', '#1d1d1f', 'na semana')}
    ${tile(e.veio, 'vieram', '#00918a', `de ${e.exp} aula${e.exp === 1 ? '' : 's'}`)}
    ${tile(e.faltou, 'faltaram', '#b23b2e', `presença ${pct(e.veio, e.veio + e.faltou, 0)}`)}
    ${tile(e.fechou, 'fecharam', '#c2660f', `conversão ${pct(e.fechou, e.veio, 0)}`)}
  </div>
  <div class="row">
    ${a ? `<div class="cx" style="${profs.length ? '' : 'grid-column:1/-1'}"><div class="rot">Alunas ativas</div><div class="at"><b>${a.fim}</b><span style="color:${a.fim > a.ini ? '#1c8f52' : a.fim < a.ini ? '#b23b2e' : '#6e6e73'}">${a.fim > a.ini ? '▲' : a.fim < a.ini ? '▼' : '■'} ${sinal(a.fim - a.ini)}</span></div><div class="at-s">+${a.entraram} entraram · −${a.sairam} saíram</div></div>` : ''}
    ${profs.length ? `<div class="cx" style="${a ? '' : 'grid-column:1/-1'}"><div class="rot">Fecharam por professora</div>${profs.map(p => `<div class="pf"><span>${esc(nomeCurto(p.nome))}</span><span><b>${p.fechou}</b> de ${p.veio}</span></div>`).join('')}</div>` : ''}
  </div>
  <div class="cx"><div class="rot">Últimas 8 semanas</div><div class="leg"><span><i style="background:#00918a"></i>vieram</span><span><i style="background:#c2660f"></i>fecharam</span></div>${graf}</div>
  <div class="rod">Semana = 7 dias até ontem. Não contam: aula de evento (já era aluna), professora lançada como aluna e contratos CIRCUITO/VIP.</div>
</body></html>`;
}

// ── envio ────────────────────────────────────────────────────────────────────
async function enviar({ ate, teste = false, log = console.log } = {}) {
  const cfg = lerCfg();
  const chave = ate || somaDias(rm.agoraSP().dia, -1);
  if (!teste) {
    const t = cfg.tentativa && cfg.tentativa.chave === chave ? cfg.tentativa : { chave, n: 0 };
    salvarCfg({ tentativa: { chave, n: t.n + 1, em: Date.now() } });
  }
  if (!cfg.grupos.length) throw new Error('Nenhum grupo configurado (Indicadores → Alunas ativas → Resumos no WhatsApp → Semanal).');
  if (cfg.ativas && ((ativasDados.ler().ultimo) || {}).dia !== rm.agoraSP().dia) {
    const at = await rm.atualizarAtivas();
    log(`📊 Resumo da semana: alunas ativas relidas no EVO — ${at.ok ? 'ok' : 'falhou (uso o último cálculo)'}`);
  }
  const d = dadosDaSemana(ate, cfg);
  if (d.vazio) {
    log('📊 Resumo da semana: nenhum agendamento nem aula experimental na semana — NÃO enviei.');
    salvarCfg({ ultimo: { em: Date.now(), chave: d.ate, teste, ok: false, msg: 'nada a enviar (semana sem agendamentos nem aulas)' } });
    return [];
  }
  const completo = texto(d);
  const legenda = completo.length <= rm.LIMITE_LEGENDA ? completo : texto(d, true);
  let img = null, studio = '';
  try { studio = require('./config').STUDIO_NOME || ''; } catch (_) {}
  try { img = await rm.gerarPng(imagemHtml(d, studio || process.env.STUDIO_NOME || ''), ARQ_IMG); } catch (e) { log(`📊 Resumo da semana: não consegui gerar a imagem (${e.message}) — vai só o texto.`); }
  const res = await rm.enviarNosGrupos({ grupos: cfg.grupos, img, legenda, resto: legenda === completo ? '' : textoPendentes(d), contexto: 'Resumo da semana', rotulo: `Resumo da semana (${d.rotulo})`, log });
  const algum = res.some(r => r.okTxt);
  const mudar = { ultimo: { em: Date.now(), chave: d.ate, teste, ok: algum, msg: res.map(r => `${r.grupo}: ${r.okTxt ? 'enviado' : 'falhou'}${r.erro ? ` (${r.erro})` : ''}`).join(' · ') } };
  if (algum && !teste) mudar.enviados = Object.assign({}, cfg.enviados, { [rm.agoraSP().dia]: Date.now() });
  salvarCfg(mudar);
  if (!algum) throw new Error('Não consegui enviar em nenhum grupo: ' + res.map(r => r.erro).join(' · '));
  return res;
}

// Hora de enviar? Dias e horário do job resumoSemana; tenta até o fim do dia.
function estaNaHora(cfg) {
  cfg = cfg || lerCfg();
  if (!cfg.ativo || !cfg.grupos.length) return false;
  const a = rm.agoraSP();
  const dow = new Date(a.dia + 'T12:00:00Z').getUTCDay();
  if (!(cfg.dias || []).includes(dow) || a.hora < cfg.hora || cfg.enviados[a.dia]) return false;
  const t = cfg.tentativa;
  const chave = somaDias(a.dia, -1);
  if (t && t.chave === chave && (t.n >= 4 || Date.now() - (t.em || 0) < 3600e3)) return false;
  return true;
}

module.exports = { lerCfg, salvarCfg, dadosDaSemana, texto, imagemHtml, enviar, estaNaHora, DIAS_LONGO, ARQ_IMG };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  if (process.argv.includes('--previa')) {
    const i = process.argv.indexOf('--previa');
    const d = dadosDaSemana(process.argv[i + 1]);
    console.log(d.vazio ? 'Semana sem agendamentos nem aulas experimentais.' : texto(d));
  } else console.log('Uso: node src/resumo-semanal.js --previa [AAAA-MM-DD do último dia]');
}

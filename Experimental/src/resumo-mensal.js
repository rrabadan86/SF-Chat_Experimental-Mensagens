/**
 * resumo-mensal.js — RESUMO DO MÊS no WhatsApp (Indicadores → Alunas ativas).
 *
 * No dia escolhido (padrão: dia 1, 08:00) o robô manda nos grupos configurados o
 * resumo do mês que fechou: alunas ativas × mês anterior (entraram / saíram) ×
 * mesmo mês do ano anterior — em texto e numa imagem (card com mini gráfico).
 * Opcional: nomes de quem saiu e as aulas experimentais do mês.
 *
 * Antes de montar, se os números ainda não foram atualizados hoje (leitura das
 * 05:25 ou "Atualizar agora"), relê as alunas no EVO (run_ativas_foto.py). Config e último envio em data/resumo-mensal.json.
 *
 * Uso à mão (na pasta Experimental):
 *   node src/resumo-mensal.js --previa [AAAA-MM]   → só imprime o texto
 */
const fs = require('fs');
const path = require('path');
const ativasDados = require('./ativas-dados');

const ARQ_CFG = path.resolve(__dirname, '..', 'data', 'resumo-mensal.json');
const ARQ_IMG = path.resolve(__dirname, '..', 'data', 'resumo-mensal.png');
const PADRAO = { ativo: false, grupos: [], dia: 1, hora: '08:00', nomesSaida: false, experimentais: true, enviados: {}, ultimo: null };

function lerCfg() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(ARQ_CFG, 'utf8')) || {}; } catch (_) {}
  return Object.assign({}, PADRAO, o, { enviados: Object.assign({}, o.enviados || {}) });
}
function salvarCfg(mudar) {
  const o = Object.assign(lerCfg(), mudar || {});
  o.grupos = (Array.isArray(o.grupos) ? o.grupos : String(o.grupos || '').split('\n')).map(g => String(g).trim()).filter(Boolean).slice(0, 5);
  o.dia = Math.min(28, Math.max(1, parseInt(o.dia, 10) || 1));
  o.hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(o.hora || '') ? o.hora : '08:00';
  o.ativo = !!o.ativo; o.nomesSaida = !!o.nomesSaida; o.experimentais = !!o.experimentais;
  if (!fs.existsSync(path.dirname(ARQ_CFG))) fs.mkdirSync(path.dirname(ARQ_CFG), { recursive: true });
  const tmp = ARQ_CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, ARQ_CFG);
  return o;
}

// ── datas (Brasília) ─────────────────────────────────────────────────────────
function agoraSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, d: +p.day };
}
function mesAnterior(k) { const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
function nomeMes(k, longo = true) { const [y, m] = k.split('-'); return longo ? `${ativasDados.MESES_LONGO[+m - 1]}/${y}` : `${ativasDados.MESES_CURTO[+m - 1]}/${y.slice(2)}`; }
const somaDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtD = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : ''; };
const pct = (n, d, casas = 1) => d ? (Math.round(n * 100 * 10 ** casas / d) / 10 ** casas).toFixed(casas).replace('.', ',').replace(/,0$/, '') + '%' : '—';
const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);

// Nome de cada pessoa do histórico: completo do EVO > o do CRM > 1º nome.
function nomeador(h) {
  const porEvo = {};
  try { for (const c of Object.values(require('./contatos').carregar() || {})) if (c && c.idEvo && c.nome) porEvo[String(c.idEvo)] = c.nome; } catch (_) {}
  return (id) => { const p = (h.pessoas || {})[id] || {}; return (p.nc && p.n) || porEvo[id] || p.n || `id ${id}`; };
}

// ── aulas experimentais do mês (mesma regra da tela Professoras) ─────────────
function experimentaisDoMes(h, k) {
  let hist;
  try { hist = require('./experimentais-hist'); } catch (_) { return null; }
  const he = hist.ler();
  const aulas = Object.values(he.aulas || {}).filter(a => String(a.dia || '').slice(0, 7) === k);
  if (!aulas.length) return null;
  const pessoas = h.pessoas || null;
  // professora lançada como aluna não conta
  const chavesProf = new Set();
  for (const a of Object.values(he.aulas || {})) if (a.prof) hist.chavesNome(a.prof).forEach(x => chavesProf.add(x));
  const profsCompletos = [...chavesProf].filter(x => x.includes(' '));
  const ehProfessora = (nome) => {
    const ks = hist.chavesNome(nome);
    if (!ks.length || !ks[0].includes(' ')) return false;
    return ks.some(x => chavesProf.has(x)) || profsCompletos.some(pk => pk.startsWith(ks[0] + ' ') || ks[0].startsWith(pk + ' '));
  };
  // pessoa do EVO pelo nome (CRM → idEvo, ou nome completo do histórico)
  const porNome = new Map();
  const add = (nome, id) => hist.chavesNome(nome).forEach((x, i) => { const kk = (i ? '~' : '=') + x; (porNome.get(kk) || porNome.set(kk, new Set()).get(kk)).add(String(id)); });
  try { for (const c of Object.values(require('./contatos').carregar() || {})) if (c && c.idEvo && c.nome) add(c.nome, c.idEvo); } catch (_) {}
  if (pessoas) for (const [id, p] of Object.entries(pessoas)) if (p && p.n && (p.nc || /\s/.test(p.n.trim()))) add(p.n, id);
  const acharEvo = (nome) => {
    const ks = hist.chavesNome(nome);
    let set = ks.length ? porNome.get('=' + ks[0]) : null;
    if (!set && ks[1]) set = porNome.get('~' + ks[1]);
    return set && set.size === 1 ? pessoas && pessoas[[...set][0]] : null;
  };
  const r = { exp: 0, veio: 0, faltou: 0, fechou: 0 };
  for (const a of aulas) {
    const sit = hist.situacao(a.status);
    if (sit === 'cancelada' || ehProfessora(a.nome)) continue;
    const pe = acharEvo(a.nome);
    const cs = (pe && pe.cs) || [];
    const tol = somaDias(a.dia, -3);
    if (cs.some(c => c[0] < tol && c[1] >= a.dia)) continue; // já era aluna (ex.: aula de evento)
    const fechou = sit === 'veio' && (cs.some(c => c[0] >= tol && c[0] <= somaDias(a.dia, 120)) || (!!a.contrato && !ativasDados.contratoIgnorado(a.contrato)));
    r.exp++; if (sit === 'veio') r.veio++; if (sit === 'faltou') r.faltou++; if (fechou) r.fechou++;
  }
  return r.exp ? r : null;
}

// ── números do mês ───────────────────────────────────────────────────────────
// mes = 'AAAA-MM' (padrão: o mês que acabou). null se ainda não há histórico.
function dadosDoMes(mes, cfg) {
  cfg = cfg || lerCfg();
  const h = ativasDados.ler();
  const ser = ativasDados.serie(h.reconstruido);
  if (!ser.length) return null;
  const meses = ativasDados.periodos(ser, 'mes');
  const k = mes || mesAnterior(agoraSP().dia.slice(0, 7));
  const P = meses.find(m => m.k === k);
  if (!P) return null;
  const Pant = meses.find(m => m.k === mesAnterior(k));
  const Pano = meses.find(m => m.k === `${+k.slice(0, 4) - 1}${k.slice(4)}`);
  const hojeIso = ser[ser.length - 1].dia;
  const tranc = (h.dias && h.dias[P.ate] && h.dias[P.ate].trancadas) || null;
  const nome = nomeador(h);
  let saidas = [];
  if (cfg.nomesSaida) {
    for (const [id, p] of Object.entries(h.pessoas || {})) for (const [, b] of (p.iv || [])) {
      const saiu = somaDias(b, 1);
      if (b < hojeIso && saiu >= P.de && saiu <= P.ate) saidas.push({ nome: nome(id), ultimo: b });
    }
    saidas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  const ultimos = meses.slice(Math.max(0, meses.indexOf(P) - 11), meses.indexOf(P) + 1).map(m => ({ k: m.k, rot: nomeMes(m.k, false), v: m.fim }));
  const ign = (h.ignorados && h.ignorados.regra) || ['circuito', 'vip'];
  return {
    k, nome: nomeMes(k), nomeCurto: nomeMes(k, false), ativas: P.fim, inicio: P.ini, trancadas: tranc,
    entraram: P.e, novas: P.n, voltaram: P.e - P.n, sairam: P.s, taxaSaida: P.ini ? P.s * 100 / P.ini : null,
    ant: Pant ? { nome: nomeMes(Pant.k), fim: Pant.fim } : null,
    ano: Pano ? { nome: nomeMes(Pano.k), fim: Pano.fim } : null,
    incompleto: P.ate < somaDias(`${k}-01`, 27) || (k === hojeIso.slice(0, 7)),
    saidas: cfg.nomesSaida ? saidas : null,
    exp: cfg.experimentais ? experimentaisDoMes(h, k) : null,
    ultimos, ignorados: ign,
  };
}

// ── texto ────────────────────────────────────────────────────────────────────
const LIMITE_LEGENDA = 1000; // legenda de foto no WhatsApp (~1.024 caracteres)
function textoSaidas(d) {
  if (!d.saidas || !d.saidas.length) return '🙌 Ninguém saiu no mês.';
  const L = [`📋 *Quem saiu em ${d.nome}* (último dia do contrato):`];
  d.saidas.slice(0, 40).forEach(s => L.push(`• ${s.nome} — ${fmtD(s.ultimo)}`));
  if (d.saidas.length > 40) L.push(`• … e mais ${d.saidas.length - 40}`);
  return L.join('\n');
}
function texto(d) {
  const L = [];
  L.push(`📊 *Resumo de ${d.nome} — Alunas ativas*`);
  L.push('');
  L.push(`👥 *${d.ativas} alunas ativas* no fim do mês${d.trancadas ? ` (${d.trancadas} trancada${d.trancadas === 1 ? '' : 's'})` : ''}`);
  L.push('');
  L.push(`*vs. ${d.ant ? d.ant.nome : 'início do mês'}:* ${d.inicio} → ${d.ativas} (${sinal(d.ativas - d.inicio)})`);
  L.push(`• Entraram: *+${d.entraram}* (${d.novas} nova${d.novas === 1 ? '' : 's'} · ${d.voltaram} ${d.voltaram === 1 ? 'voltou' : 'voltaram'})`);
  L.push(`• Saíram: *−${d.sairam}* · taxa de saída ${d.taxaSaida == null ? '—' : pct(d.sairam, d.inicio)}`);
  if (d.ano) {
    L.push('');
    L.push(`*vs. ${d.ano.nome}:* ${d.ano.fim} → ${d.ativas} (*${sinal(d.ativas - d.ano.fim)}*${d.ano.fim ? `, ${d.ativas >= d.ano.fim ? '+' : '−'}${pct(Math.abs(d.ativas - d.ano.fim), d.ano.fim)}` : ''})`);
  }
  if (d.exp) {
    L.push('');
    L.push(`🏋️ *Aulas experimentais:* ${d.exp.exp}`);
    L.push(`• Vieram: *${d.exp.veio}* (presença ${pct(d.exp.veio, d.exp.veio + d.exp.faltou, 0)})`);
    L.push(`• Fecharam contrato: *${d.exp.fechou}* (conversão ${pct(d.exp.fechou, d.exp.veio, 0)})`);
  }
  if (d.saidas) { L.push(''); L.push(textoSaidas(d)); }
  L.push('');
  L.push(`_Não contam: contratos ${d.ignorados.map(x => String(x).toUpperCase()).join('/')} e renovação na fila. Trancada conta como ativa._`);
  return L.join('\n');
}

// ── imagem (card 1080×1350, feito em HTML e fotografado pelo Chromium) ──────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function imagemHtml(d, studio) {
  const comp = (rot, de, ate) => {
    const dif = ate - de;
    const cor = dif > 0 ? '#1c8f52' : dif < 0 ? '#b23b2e' : '#6e6e73';
    const seta = dif > 0 ? '▲' : dif < 0 ? '▼' : '■';
    return `<div class="comp"><div class="c-rot">${esc(rot)}</div><div class="c-val">${de} <span class="arr">→</span> ${ate}</div><div class="c-dif" style="color:${cor}">${seta} ${sinal(dif)}${de ? ` · ${dif >= 0 ? '+' : '−'}${pct(Math.abs(dif), de)}` : ''}</div></div>`;
  };
  // mini gráfico (últimos 12 meses)
  const W = 920, H = 270, pl = 10, pr = 60, pt = 24, pb = 40;
  const vs = d.ultimos.map(u => u.v);
  let mn = Math.min(...vs), mx = Math.max(...vs);
  if (mx - mn < 6) { const c = (mx + mn) / 2; mn = c - 3; mx = c + 3; }
  const pad = (mx - mn) * 0.15; mn -= pad; mx += pad;
  const n = d.ultimos.length;
  const X = (i) => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1));
  const Y = (v) => pt + (H - pt - pb) * (1 - (v - mn) / (mx - mn));
  const pts = d.ultimos.map((u, i) => `${X(i).toFixed(1)},${Y(u.v).toFixed(1)}`);
  const area = `M${X(0).toFixed(1)},${H - pb} L${pts.join(' L')} L${X(n - 1).toFixed(1)},${H - pb} Z`;
  const ult = d.ultimos[n - 1];
  const graf = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" stroke="#e4e4e7" stroke-width="2"/>
    <path d="${area}" fill="#00918a" fill-opacity=".12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#00918a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(n - 1)}" cy="${Y(ult.v)}" r="8" fill="#00918a" stroke="#fff" stroke-width="3"/>
    <text x="${X(n - 1) + 14}" y="${Y(ult.v) + 8}" font-size="26" font-weight="800" fill="#1d1d1f">${ult.v}</text>
    ${d.ultimos.map((u, i) => (i % (n > 8 ? 2 : 1) === (n - 1) % (n > 8 ? 2 : 1)) ? `<text x="${X(i)}" y="${H - 8}" font-size="20" fill="#6e6e73" text-anchor="middle">${esc(u.rot)}</text>` : '').join('')}
  </svg>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1080px;height:1350px;background:#f3f6f6;font-family:Inter,"DejaVu Sans","Liberation Sans",Arial,sans-serif;color:#1d1d1f;padding:64px 70px;display:flex;flex-direction:column;gap:30px}
  .top{display:flex;justify-content:space-between;align-items:baseline}
  .eyebrow{font-size:26px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0b6f6b}
  .studio{font-size:24px;font-weight:600;color:#6e6e73}
  h1{font-size:58px;font-weight:800;letter-spacing:-.02em;line-height:1.05;margin-top:6px}
  .hero{background:#fff;border-radius:28px;padding:40px 44px;display:flex;align-items:center;gap:36px;box-shadow:0 2px 0 #e4e4e7}
  .big{font-size:170px;font-weight:800;line-height:.9;color:#00918a;letter-spacing:-.04em}
  .hero-l{font-size:32px;font-weight:700}.hero-s{font-size:26px;color:#6e6e73;margin-top:8px;font-weight:600}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .comp,.mov{background:#fff;border-radius:24px;padding:28px 32px;box-shadow:0 2px 0 #e4e4e7}
  .c-rot{font-size:24px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.06em}
  .c-val{font-size:54px;font-weight:800;margin-top:10px}.arr{color:#9a9aa0;font-weight:600}
  .c-dif{font-size:30px;font-weight:800;margin-top:6px}
  .mov{display:flex;justify-content:space-around;text-align:center}
  .mov b{display:block;font-size:56px;font-weight:800}.mov span{font-size:24px;color:#6e6e73;font-weight:600}
  .graf{background:#fff;border-radius:24px;padding:24px 32px 10px;box-shadow:0 2px 0 #e4e4e7}
  .g-t{font-size:24px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .rod{font-size:21px;color:#6e6e73;margin-top:auto}
</style></head><body>
  <div><div class="top"><div class="eyebrow">Resumo do mês</div><div class="studio">${esc(studio || '')}</div></div><h1>Alunas ativas — ${esc(d.nome)}</h1></div>
  <div class="hero"><div class="big">${d.ativas}</div><div><div class="hero-l">alunas ativas<br>no fim do mês</div>${d.trancadas ? `<div class="hero-s">${d.trancadas} trancada${d.trancadas === 1 ? '' : 's'} (contam como ativas)</div>` : ''}</div></div>
  <div class="row">${comp(d.ant ? 'vs. ' + d.ant.nome : 'vs. início do mês', d.inicio, d.ativas)}${d.ano ? comp('vs. ' + d.ano.nome, d.ano.fim, d.ativas) : '<div class="comp"><div class="c-rot">vs. ano anterior</div><div class="c-val" style="color:#9a9aa0">—</div><div class="c-dif" style="color:#9a9aa0">sem histórico</div></div>'}</div>
  <div class="mov">
    <div><b style="color:#1c8f52">+${d.entraram}</b><span>entraram</span></div>
    <div><b>${d.novas}</b><span>novas</span></div>
    <div><b>${d.voltaram}</b><span>voltaram</span></div>
    <div><b style="color:#b23b2e">−${d.sairam}</b><span>saíram</span></div>
    ${d.exp ? `<div><b style="color:#0b6f6b">${d.exp.fechou}/${d.exp.veio}</b><span>experimentais<br>que fecharam</span></div>` : ''}
  </div>
  <div class="graf"><div class="g-t">Últimos ${d.ultimos.length} meses</div>${graf}</div>
  <div class="rod">Trancada conta como ativa. Não contam contratos ${esc(d.ignorados.map(x => String(x).toUpperCase()).join('/'))} nem renovação na fila.</div>
</body></html>`;
}
async function gerarImagem(d, studio) {
  const html = imagemHtml(d, studio);
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}); // sem internet: segue com a fonte do sistema
    await page.screenshot({ path: ARQ_IMG, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1350 } });
    return ARQ_IMG;
  } finally { try { if (browser) await browser.close(); } catch (_) {} }
}

// Relê as alunas ativas no EVO (mesmo script da foto diária).
function atualizarAtivas() {
  return new Promise((resolve) => {
    const dir = path.resolve(__dirname, 'agendamento_evo');
    const venv = path.join(dir, '.venv', 'bin', 'python');
    let py = process.env.PYTHON_BIN || 'python3';
    try { if (fs.existsSync(venv)) py = venv; } catch (_) {}
    require('child_process').execFile(py, [path.join(dir, 'run_ativas_foto.py'), '--nomes', '100', '--tempo', '180'], { cwd: dir, timeout: 420000 }, (err, stdout, stderr) => {
      const out = String((stdout || '') + (stderr || '')).trim().split('\n').filter(Boolean).slice(-1)[0] || '';
      resolve({ ok: !err, msg: out || (err && err.message) || '' });
    });
  });
}

// Monta e envia nos grupos. teste=true: manda agora sem marcar o mês como enviado.
async function enviar({ mes, teste = false, log = console.log } = {}) {
  const cfg = lerCfg();
  if (!teste) { // envio automático: guarda a tentativa (se falhar, tenta de novo em 1 h, no máx. 4 vezes)
    const t = cfg.tentativa && cfg.tentativa.mes === mes ? cfg.tentativa : { mes, n: 0 };
    salvarCfg({ tentativa: { mes, n: t.n + 1, em: Date.now() } });
  }
  if (!cfg.grupos.length) throw new Error('Nenhum grupo configurado (Indicadores → Alunas ativas → Resumo mensal).');
  // Só relê o EVO se os números ainda não foram atualizados HOJE (a leitura da
  // madrugada, 05:25, ou um "Atualizar agora" já deixam tudo em dia).
  const ultimaLeitura = ((ativasDados.ler().ultimo) || {}).dia;
  if (ultimaLeitura === agoraSP().dia) log(`📊 Resumo mensal: alunas ativas já atualizadas hoje — sem reler o EVO.`);
  else {
    const at = await atualizarAtivas();
    log(`📊 Resumo mensal: alunas ativas relidas no EVO — ${at.ok ? 'ok' : 'falhou (uso o último cálculo)'}${at.msg ? ': ' + at.msg : ''}`);
  }
  const d = dadosDoMes(mes, cfg);
  if (!d) throw new Error('Ainda não há histórico de alunas ativas para esse mês.');
  const txt = texto(d);
  let img = null;
  let studio = '';
  try { studio = require('./config').STUDIO_NOME || ''; } catch (_) {}
  try { img = await gerarImagem(d, studio || process.env.STUDIO_NOME || ''); } catch (e) { log(`📊 Resumo mensal: não consegui gerar a imagem (${e.message}) — vai só o texto.`); }
  const wa = require('./wa-client');
  await wa.initWhatsApp();
  const res = [];
  for (const g of cfg.grupos) {
    let okImg = false, okTxt = false, erro = '';
    // Imagem com o texto como LEGENDA (uma mensagem só). A legenda do WhatsApp tem
    // limite (~1.000 caracteres): se a lista de quem saiu for longa, ela vai numa
    // 2ª mensagem. Se a foto falhar, o wa-client manda a legenda como texto.
    const legenda = txt.length <= LIMITE_LEGENDA ? txt : texto(Object.assign({}, d, { saidas: null }));
    const resto = legenda === txt ? '' : textoSaidas(d);
    if (img) {
      try { await wa.sendGrupoMidia(g, img, legenda, 'Resumo mensal'); okImg = true; okTxt = true; } catch (e) { erro = 'imagem: ' + e.message; }
    }
    if (!okTxt) { try { await wa.sendGrupo(g, legenda, 'Resumo mensal'); okTxt = true; } catch (e) { erro = (erro ? erro + ' · ' : '') + 'texto: ' + e.message; } }
    if (okTxt && resto) { try { await wa.sendGrupo(g, resto, 'Resumo mensal'); } catch (e) { erro = (erro ? erro + ' · ' : '') + 'lista de quem saiu: ' + e.message; } }
    res.push({ grupo: g, okImg, okTxt, erro });
    log(`📊 Resumo mensal (${d.nome}) → "${g}": ${okTxt ? 'texto ✅' : 'texto ❌'}${img ? (okImg ? ' · imagem ✅' : ' · imagem ❌') : ''}${erro ? ' — ' + erro : ''}`);
  }
  const algum = res.some(r => r.okTxt);
  const mudar = { ultimo: { em: Date.now(), mes: d.k, teste, ok: algum, msg: res.map(r => `${r.grupo}: ${r.okTxt ? 'enviado' : 'falhou'}${r.erro ? ` (${r.erro})` : ''}`).join(' · ') } };
  if (algum && !teste) mudar.enviados = Object.assign({}, cfg.enviados, { [d.k]: Date.now() });
  salvarCfg(mudar);
  if (!algum) throw new Error('Não consegui enviar em nenhum grupo: ' + res.map(r => r.erro).join(' · '));
  return res;
}

// Chamado de tempos em tempos pelo robô: está na hora do resumo deste mês?
// Envia no dia/horário escolhidos; se o robô estava fora, tenta até 3 dias depois.
function estaNaHora(cfg) {
  cfg = cfg || lerCfg();
  if (!cfg.ativo || !cfg.grupos.length) return null;
  const a = agoraSP();
  if (a.d < cfg.dia || a.d > cfg.dia + 3 || (a.d === cfg.dia && a.hora < cfg.hora)) return null;
  const mes = mesAnterior(a.dia.slice(0, 7));
  if (cfg.enviados[mes]) return null;
  const t = cfg.tentativa;
  if (t && t.mes === mes && (t.n >= 4 || Date.now() - (t.em || 0) < 3600e3)) return null;
  return mes;
}

module.exports = { lerCfg, salvarCfg, dadosDoMes, texto, imagemHtml, gerarImagem, enviar, estaNaHora, mesAnterior, nomeMes, agoraSP, ARQ_IMG };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  const i = process.argv.indexOf('--previa');
  if (i >= 0) {
    const d = dadosDoMes(process.argv[i + 1] && /^\d{4}-\d{2}$/.test(process.argv[i + 1]) ? process.argv[i + 1] : undefined);
    console.log(d ? texto(d) : 'Sem histórico de alunas ativas para esse mês.');
  } else console.log('Uso: node src/resumo-mensal.js --previa [AAAA-MM]');
}

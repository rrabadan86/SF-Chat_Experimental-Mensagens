/**
 * demo-acessos.js — contador de acessos do PAINEL DE DEMONSTRAÇÃO (PAINEL_DEMO=1).
 *
 * Cada página aberta (não conta imagens, chamadas internas nem robôs) vira uma
 * linha em data/demo-acessos.jsonl: quando, qual tela, de onde veio (link do
 * Instagram, WhatsApp…) e um código de visitante. O código é um resumo (hash) do
 * IP + navegador + o dia — dá para contar PESSOAS DIFERENTES sem guardar o IP.
 *
 * Ver os números:
 *   - no navegador: https://<demonstração>/acessos?k=<chave>   (a chave sai no comando abaixo)
 *   - no servidor:  cd /root/slimfit-exemplo/Experimental && node src/demo-acessos.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.resolve(__dirname, '..', 'data');
const ARQ = path.join(DATA, 'demo-acessos.jsonl');
const ARQ_CHAVE = path.join(DATA, 'demo-acessos-chave.txt');
const TZ = 'America/Sao_Paulo';
const diaSP = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });

function chave() {
  try { const k = fs.readFileSync(ARQ_CHAVE, 'utf8').trim(); if (k) return k; } catch (_) {}
  const k = crypto.randomBytes(9).toString('base64url');
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(ARQ_CHAVE, k); } catch (_) {}
  return k;
}
const ROBO = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|lighthouse|monitor|uptime/i;
const IGNORA = /^\/(sofia\/humano-foto|slimclub\/foto|favicon|acessos|.*\.(png|jpe?g|webp|svg|ico|css|js|map|json|txt))/i;

// Chamado para todo GET do painel de demonstração.
function registrar(req, url) {
  try {
    if (req.method !== 'GET' || IGNORA.test(url)) return;
    const h = req.headers || {};
    if (!/text\/html/i.test(String(h.accept || ''))) return;          // só páginas (não fetch/imagens)
    if (String(h['sec-fetch-dest'] || '') === 'iframe') return;        // telas dentro de outra tela
    const ua = String(h['user-agent'] || '');
    const robo = !ua || ROBO.test(ua);
    const ip = String(h['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    const agora = Date.now();
    const vis = crypto.createHash('sha256').update(ip + '|' + ua + '|' + diaSP(agora) + '|' + chave()).digest('hex').slice(0, 12);
    let origem = '';
    try { const r = new URL(String(h.referer || '')); if (r.host && r.host !== String(h.host || '')) origem = r.host.replace(/^www\./, ''); } catch (_) {}
    const q = new URLSearchParams(String(req.url || '').split('?')[1] || '');
    if (q.get('utm_source')) origem = q.get('utm_source');
    const cel = /mobile|android|iphone/i.test(ua);
    fs.appendFile(ARQ, JSON.stringify({ em: agora, tela: url, vis, origem, cel, robo }) + '\n', () => {});
  } catch (_) {}
}

function ler() {
  try { return fs.readFileSync(ARQ, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; }
}
const NOMES_TELA = { '/hoje': 'Início', '/sofia': 'SoFIA', '/': 'WhatsApp', '/visao-cliente': 'Visão do cliente', '/funil': 'Funil', '/indicadores': 'Formulário', '/professoras': 'Professoras', '/ativas': 'Alunas ativas', '/grade': 'Grade', '/clube': 'Slim Club', '/saude': 'Saúde', '/log': 'Log', '/formularios': 'Formulários' };

function resumo() {
  const todos = ler(), pessoas = todos.filter(a => !a.robo);
  const hoje = diaSP(Date.now());
  const desde = (dias) => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - dias + 1); return d.toISOString().slice(0, 10); };
  const bloco = (lista) => ({ visitas: lista.length, pessoas: new Set(lista.map(a => diaSP(a.em) + a.vis)).size });
  const porDia = [];
  for (let i = 29; i >= 0; i--) { const d = desde(i + 1 - 1 + 1 - 1); porDia.push(d); }
  const dias = []; for (let i = 0; i < 30; i++) { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i); dias.unshift(d.toISOString().slice(0, 10)); }
  const conta = (arr, f) => { const m = new Map(); for (const a of arr) { const k = f(a); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  return {
    hoje: bloco(pessoas.filter(a => diaSP(a.em) === hoje)),
    semana: bloco(pessoas.filter(a => diaSP(a.em) >= desde(7))),
    mes: bloco(pessoas.filter(a => diaSP(a.em) >= desde(30))),
    total: bloco(pessoas),
    primeiro: pessoas.length ? pessoas[0].em : 0,
    ultimo: pessoas.length ? pessoas[pessoas.length - 1].em : 0,
    porDia: dias.map(d => ({ dia: d, ...bloco(pessoas.filter(a => diaSP(a.em) === d)) })),
    telas: conta(pessoas, a => NOMES_TELA[a.tela] || a.tela).slice(0, 12),
    origens: conta(pessoas, a => a.origem || 'link direto').slice(0, 10),
    celular: pessoas.filter(a => a.cel).length,
    previas: todos.filter(a => a.robo).length,
  };
}

function pagina() {
  const r = resumo();
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const max = Math.max(1, ...r.porDia.map(d => d.pessoas));
  const fmt = (ms) => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const card = (t, b) => `<div class="c"><div class="n">${b.pessoas}</div><div class="l">${t}</div><div class="s">${b.visitas} página${b.visitas === 1 ? '' : 's'} aberta${b.visitas === 1 ? '' : 's'}</div></div>`;
  const lista = (arr) => arr.length ? arr.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="v">${n}</td></tr>`).join('') : '<tr><td colspan="2" class="vz">Ainda nada</td></tr>';
  const barras = r.porDia.map(d => `<div class="b" title="${d.dia.split('-').reverse().join('/')}: ${d.pessoas} pessoa(s), ${d.visitas} página(s)"><span style="height:${Math.round(d.pessoas / max * 100)}%"></span><i>${d.dia.slice(8)}</i></div>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Acessos da demonstração</title>
<style>
:root{--fundo:#f4f6f5;--card:#fff;--tx:#14211e;--cz:#5d6b67;--ac:#0e6e6b;--ln:#e2e8e6}
@media (prefers-color-scheme:dark){:root{--fundo:#101615;--card:#18201f;--tx:#e6eeec;--cz:#9fb0ab;--ac:#4fc2b6;--ln:#2a3533}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--tx);font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.w{max-width:980px;margin:0 auto;padding:22px 16px 40px}h1{font-size:1.35rem;margin:0 0 4px}.sub{color:var(--cz);margin:0 0 18px;font-size:.9rem}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.c{background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:14px 16px}.n{font-size:2rem;font-weight:800;color:var(--ac);font-variant-numeric:tabular-nums}.l{font-weight:600}.s{color:var(--cz);font-size:.82rem}
.box{background:var(--card);border:1px solid var(--ln);border-radius:12px;padding:14px 16px;margin-bottom:16px}.box h2{font-size:1rem;margin:0 0 10px}
.ch{display:flex;align-items:flex-end;gap:3px;height:150px;overflow-x:auto}.b{flex:1;min-width:16px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}
.b span{display:block;width:100%;background:var(--ac);border-radius:4px 4px 0 0;min-height:2px}.b i{font-style:normal;font-size:.68rem;color:var(--cz);margin-top:3px}
.d{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media (max-width:700px){.d{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid var(--ln)}td.v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.vz{color:var(--cz)}
.nota{color:var(--cz);font-size:.82rem}
</style></head><body><div class="w">
<h1>Acessos da demonstração</h1>
<p class="sub">Pessoas diferentes por dia (cada pessoa conta uma vez por dia) e páginas abertas. Primeiro acesso ${fmt(r.primeiro)} · último ${fmt(r.ultimo)}.</p>
<div class="g">${card('pessoas hoje', r.hoje)}${card('últimos 7 dias', r.semana)}${card('últimos 30 dias', r.mes)}${card('desde o início', r.total)}</div>
<div class="box"><h2>Pessoas por dia · últimos 30 dias</h2><div class="ch">${barras}</div></div>
<div class="d"><div class="box"><h2>Telas mais abertas</h2><table>${lista(r.telas)}</table></div>
<div class="box"><h2>De onde vieram</h2><table>${lista(r.origens)}</table><p class="nota">"link direto" = digitaram o endereço ou abriram um link sem origem (o WhatsApp não informa). Para saber de qual post veio, divulgue o link com <b>?utm_source=instagram</b> (ou whatsapp, email…).</p></div></div>
<p class="nota">${r.total.visitas ? Math.round(r.celular / r.total.visitas * 100) : 0}% das páginas abertas pelo celular · ${r.previas} prévia(s) de link/robôs não entraram na conta. O IP não é guardado.</p>
</div></body></html>`;
}

module.exports = { registrar, resumo, pagina, chave };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  const r = resumo();
  const linha = (t, b) => console.log(`  ${t.padEnd(16)} ${String(b.pessoas).padStart(5)} pessoa(s) · ${b.visitas} página(s)`);
  console.log('Acessos da demonstração:');
  linha('hoje', r.hoje); linha('últimos 7 dias', r.semana); linha('últimos 30 dias', r.mes); linha('desde o início', r.total);
  console.log(`\nVer no navegador: https://<endereço da demonstração>/acessos?k=${chave()}`);
}

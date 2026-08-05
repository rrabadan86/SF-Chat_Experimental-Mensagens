require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════
//  DIAGNÓSTICO da tela Gerencial > Suspensões (trancamentos).
//  Só LÊ e despeja o que encontrou — não envia nada, não muda nada.
//
//  Objetivo: descobrir a estrutura do grid (tem NOME da aluna? colunas? formato
//  de data?) para depois cruzar com a lista de ausentes e marcar as trancadas.
//
//  Uso (headless, no VPS):
//    HEADLESS=true node src/diag-suspensoes.js
//
//  Saídas em data/: suspensoes-diag.txt (texto + linhas), suspensoes-debug.png,
//  suspensoes-grid.html
// ═══════════════════════════════════════════════════════════════════════════

const SUSP_HASH = process.env.EVO_SUSPENSOES_HASH
  || '#/app/slimfit/15/gerencial/suspensoes';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'suspensoes-diag.txt');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(page) {
  console.log('🔐 Fazendo login no EVO...');
  await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
  await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
  await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
  await page.click('input#senha, input[type="password"]', { clickCount: 3 });
  await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
    }
    document.querySelector('button[type="submit"], button.primary')?.click();
  });
  await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
  await sleep(3000);
  console.log('✅ Login OK\n');
}

/** Pontua um frame pela cara da tela de Suspensões. */
async function pontuar(f) {
  try {
    return await f.evaluate(() => {
      const t = (document.body && document.body.innerText || '').toLowerCase();
      let s = 0;
      if (/suspens/.test(t)) s += 4;
      if (/dias\s*suspens/.test(t)) s += 4;
      if (/vigente|finalizad|programad/.test(t)) s += 3;
      if (/motivo/.test(t)) s += 1;
      if (/in[íi]cio/.test(t) && /\bfim\b/.test(t)) s += 3;
      if (document.querySelector('table')) s += 2;
      return s;
    });
  } catch (_) { return -1; }
}

async function acharFrame(page) {
  let melhor = page.mainFrame(), mx = -1;
  for (const f of page.frames()) {
    const s = await pontuar(f);
    if (s > mx) { mx = s; melhor = f; }
  }
  return { frame: melhor, score: mx };
}

/** Lê genericamente qualquer <table> com cabeçalho: retorna headers + linhas. */
async function lerTabela(frame) {
  return frame.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let best = null, mx = -1;
    for (const t of document.querySelectorAll('table')) {
      const n = t.querySelectorAll('tr').length;
      if (n > mx) { mx = n; best = t; }
    }
    if (!best) return { headers: [], rows: [] };
    const headers = Array.from(best.querySelectorAll('thead th, tr:first-child th'))
      .map(x => norm(x.textContent));
    const trs = Array.from(best.querySelectorAll('tbody tr'))
      .filter(tr => tr.querySelectorAll('td').length);
    const rows = trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => norm(td.innerText)));
    return { headers, rows };
  });
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const linhasOut = [];
  const P = (s) => { console.log(s); linhasOut.push(s); };

  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === 'false' ? false : 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1600,950'],
    defaultViewport: { width: 1600, height: 950 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  try {
    await login(page);

    P('📂 Abrindo Gerencial > Suspensões...');
    await page.evaluate((h) => { location.hash = h; }, SUSP_HASH);
    await sleep(8000);

    // Acha o frame com a tela (pode ser o main frame Angular ou um iframe legado).
    let alvo = page.mainFrame(), score = -1;
    for (let i = 0; i < 10; i++) {
      const r = await acharFrame(page);
      alvo = r.frame; score = r.score;
      if (score >= 8) break;
      await sleep(1500);
    }
    P(`   🖼️  Frame alvo: ${alvo.url() || '(main)'}  (score=${score})`);

    // Lista TODAS as frames (para eu saber onde a tela vive).
    P('\n─── FRAMES ───');
    for (const f of page.frames()) {
      let txt = '';
      try { txt = await f.evaluate(() => (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200)); }
      catch (e) { txt = '(inacessível: ' + e.message + ')'; }
      P(`• ${f.url() || '(main)'} → ${txt}`);
    }

    // Lê o grid como está (filtro padrão "Hoje", conforme sua tela).
    const { headers, rows } = await lerTabela(alvo);
    P('\n─── GRID (filtro padrão) ───');
    P('CABEÇALHOS: ' + (headers.join(' | ') || '(nenhum <th> encontrado)'));
    P(`LINHAS: ${rows.length}`);
    rows.slice(0, 30).forEach((r, i) => P(`  [${i}] ` + r.join('  ||  ')));

    // Texto cru da área (ajuda a ver rótulos/nome que não estejam em <td>).
    let cru = '';
    try { cru = await alvo.evaluate(() => (document.body.innerText || '').replace(/\n{2,}/g, '\n').trim().slice(0, 4000)); } catch (_) {}
    P('\n─── TEXTO CRU (4000 chars) ───\n' + cru);

    // Artefatos.
    try {
      await page.screenshot({ path: path.join(DATA_DIR, 'suspensoes-debug.png'), fullPage: true }).catch(() => {});
      let gridHtml = '';
      try { gridHtml = await alvo.evaluate(() => { const t = document.querySelector('table'); return t ? t.outerHTML.slice(0, 40000) : '(sem <table>)'; }); } catch (_) {}
      fs.writeFileSync(path.join(DATA_DIR, 'suspensoes-grid.html'), gridHtml, 'utf8');
    } catch (_) {}

    fs.writeFileSync(OUT, linhasOut.join('\n'), 'utf8');
    console.log(`\n🔬 Diagnóstico salvo em:\n   ${OUT}\n   ${path.join(DATA_DIR, 'suspensoes-debug.png')}\n   ${path.join(DATA_DIR, 'suspensoes-grid.html')}\n`);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('\n❌ Erro fatal:', err && err.message); if (err && err.stack) console.error(err.stack); process.exit(1); });

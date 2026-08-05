require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════
//  DIAGNÓSTICO do FILTRO de período da tela Suspensões.
//  Abre o dropdown "Período da suspensão", depois "Período personalizado", e
//  despeja o DOM (menu, inputs, calendário) para eu descobrir como preencher
//  De = hoje-30 e Até = hoje de forma automática. Só lê, não muda nada.
//
//  Uso:  HEADLESS=true node src/diag-suspensoes-filtro.js
//  Saída: data/suspensoes-filtro.txt  +  data/susp-filtro-*.png
// ═══════════════════════════════════════════════════════════════════════════

const SUSP_HASH = process.env.EVO_SUSPENSOES_HASH || '#/app/slimfit/15/gerencial/suspensoes';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUT = path.join(DATA_DIR, 'suspensoes-filtro.txt');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = [];
const P = (s) => { console.log(s); out.push(s); };

async function login(page) {
  await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
  await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
  await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
  await page.click('input#senha, input[type="password"]', { clickCount: 3 });
  await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
    }
    document.querySelector('button[type="submit"], button.primary')?.click();
  });
  await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
  await sleep(3000);
}

/** Lista todos os inputs visíveis (id, name, placeholder, value, tipo). */
async function dumpInputs(page, tag) {
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
      .filter(el => el.offsetParent !== null)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
        value: el.value || '',
        cls: (el.className || '').toString().slice(0, 80),
      }));
  });
  P(`\n─── INPUTS (${tag}) — ${inputs.length} ───`);
  inputs.forEach((i, n) => P(`  [${n}] <${i.tag} type=${i.type}> id="${i.id}" name="${i.name}" ph="${i.placeholder}" aria="${i.aria}" val="${i.value}" cls="${i.cls}"`));
}

/** Texto visível dos menus/overlays abertos (cdk-overlay, menu, dialog). */
async function dumpOverlays(page, tag) {
  const txt = await page.evaluate(() => {
    const sel = '.cdk-overlay-container, [role="menu"], [role="listbox"], [role="dialog"], .mat-menu-panel, .mat-mdc-menu-panel, .p-datepicker, .mat-calendar';
    const nodes = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    return nodes.map(n => (n.innerText || '').replace(/\n{2,}/g, '\n').trim()).join('\n----\n').slice(0, 3000);
  });
  P(`\n─── OVERLAYS (${tag}) ───\n${txt || '(nenhum overlay visível)'}`);
}

async function shot(page, nome) {
  try { await page.screenshot({ path: path.join(DATA_DIR, nome), fullPage: false }).catch(() => {}); } catch (_) {}
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
    P('🔐 Login...');
    await login(page);
    P('📂 Suspensões...');
    await page.evaluate((h) => { location.hash = h; }, SUSP_HASH);
    await sleep(7000);
    await shot(page, 'susp-filtro-0-inicial.png');

    // Descreve o "chip" do período (o que clicar).
    const chip = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
        .find(e => /per[íi]odo da suspens/i.test(e.textContent || '') && e.offsetParent !== null);
      if (!el) return null;
      const clk = el.closest('button, [role="button"], a') || el;
      return { text: (el.textContent || '').trim().slice(0, 60), tag: clk.tagName.toLowerCase(), cls: (clk.className || '').toString().slice(0, 100), outer: clk.outerHTML.slice(0, 400) };
    });
    P('\n─── CHIP período ───\n' + (chip ? JSON.stringify(chip, null, 2) : '(não achei o chip)'));

    // 1) abre o dropdown
    const abriu = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
        .find(e => /per[íi]odo da suspens/i.test(e.textContent || '') && e.offsetParent !== null);
      if (!el) return false;
      (el.closest('button, [role="button"], a') || el).click();
      return true;
    });
    P(`\n1) abriu dropdown? ${abriu}`);
    await sleep(1200);
    await shot(page, 'susp-filtro-1-dropdown.png');
    await dumpOverlays(page, 'dropdown aberto');

    // 2) clica "Período personalizado"
    const clicouPers = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('[role="menuitem"], button, li, a, span, div'))
        .filter(el => el.offsetParent !== null);
      const alvo = opts.find(el => /per[íi]odo personalizado/i.test((el.textContent || '').trim()));
      if (!alvo) return false;
      (alvo.closest('[role="menuitem"], button, li, a') || alvo).click();
      return true;
    });
    P(`\n2) clicou "Período personalizado"? ${clicouPers}`);
    await sleep(1500);
    await shot(page, 'susp-filtro-2-personalizado.png');
    await dumpOverlays(page, 'personalizado');
    await dumpInputs(page, 'após personalizado');

    fs.writeFileSync(OUT, out.join('\n'), 'utf8');
    console.log(`\n🔬 Salvo em ${OUT} + screenshots susp-filtro-*.png em data/`);
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error('\n❌ Erro:', err && err.message); if (err && err.stack) console.error(err.stack); process.exit(1); });

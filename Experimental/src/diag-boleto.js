/**
 * DIAGNÓSTICO (não envia/cobra/apaga nada) — capturar a REQUISIÇÃO que a tela de
 * boletos faz (CarregarListaBoletos) para podermos repeti-la com um período amplo,
 * sem depender de clicar no grid (que é customizado).
 *
 * Captura: método, URL, corpo (postData) e headers do CarregarListaBoletos; e um
 * dump dos <input>/botões do topo (outerHTML) para referência.
 *
 * ⚠️ Rode no VPS da unidade certa (BUENO).
 * Uso: node src/diag-boleto.js
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(__dirname, '..', 'data', 'diag-boleto.json');
const ROTA = 'app/slimfit/15/evo3/-Financeiro-Boletos-IntegracaoBancaria';

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🧾 DIAG — capturar a requisição CarregarListaBoletos');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);

  const resultado = { geradoEm: new Date().toISOString(), requisicoes: [], respostas: [] };

  page.on('request', (req) => {
    try {
      const url = req.url();
      if (!/CarregarListaBoletos|Boletos\/Carregar|Boletos\/Listar|ContasReceber\/Carregar/i.test(url)) return;
      const r = { url, method: req.method(), postData: req.postData() || null, headers: req.headers() };
      resultado.requisicoes.push(r);
      console.log(`\n📤 REQUISIÇÃO ${r.method} ${url}`);
      console.log(`   content-type: ${r.headers['content-type'] || '(sem)'}`);
      console.log(`   postData: ${r.postData ? r.postData.slice(0, 1500) : '(vazio — talvez GET com query)'}`);
    } catch (_) {}
  });
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!/CarregarListaBoletos/i.test(url)) return;
      const txt = await res.text();
      let n = null; try { const d = JSON.parse(txt); n = Array.isArray(d) ? d.length : (d.$values ? d.$values.length : null); } catch (_) {}
      resultado.respostas.push({ url, status: res.status(), registros: n, amostra: txt.slice(0, 500) });
      console.log(`📥 RESPOSTA ${res.status()} — ${n != null ? n + ' registro(s)' : 'não-array'} — ${txt.slice(0, 300)}`);
    } catch (_) {}
  });

  try {
    console.log('🔐 Login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(4000);
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } } document.querySelector('button[type="submit"], button.primary')?.click(); });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    console.log('✅ Login OK');

    console.log('\n🧭 Abrindo a tela de boletos (Integração Bancária)...');
    await page.evaluate((h) => { location.hash = '#/' + h; }, ROTA);
    await sleep(12000); await fecharPopupNovaTela(page);
    await sleep(3000);
    console.log(`   🌐 ${page.url()}`);

    // Dump dos inputs e botões do topo (outerHTML) para achar data/lupa.
    const dom = await page.evaluate(() => {
      const inputs = [];
      for (const el of document.querySelectorAll('input')) {
        if (!(el.offsetWidth > 0 || el.offsetHeight > 0)) continue;
        inputs.push({ value: el.value || '', ph: el.placeholder || '', type: el.type || '', cls: (el.className || '').slice(0, 60), html: el.outerHTML.slice(0, 160) });
      }
      const botoes = [];
      for (const el of document.querySelectorAll('button, [role="button"], a.btn, a[class*="btn"]')) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 60 || rect.top > 500) continue;
        if (!(el.offsetWidth > 0 || el.offsetHeight > 0)) continue;
        botoes.push({ top: Math.round(rect.top), left: Math.round(rect.left), txt: (el.textContent || '').trim().slice(0, 24), cls: (el.className || '').slice(0, 50), html: el.outerHTML.slice(0, 160) });
      }
      // conta "linhas" de grid por vários seletores comuns
      const grids = {};
      for (const sel of ['table tbody tr', '[role="row"]', '.dx-data-row', '.k-grid tr', '.ag-row', '.ui-grid-row', 'tr']) grids[sel] = document.querySelectorAll(sel).length;
      return { inputs: inputs.slice(0, 30), botoes: botoes.slice(0, 40), grids };
    });
    resultado.dom = dom;

    console.log('\n🔎 INPUTS visíveis:');
    dom.inputs.forEach((i, n) => console.log(`   [${n}] value="${i.value}" ph="${i.ph}" type=${i.type} cls="${i.cls}"`));
    console.log('\n🔘 BOTÕES/ÍCONES no topo (top 60–500px):');
    dom.botoes.forEach((b, n) => console.log(`   [${n}] top=${b.top} txt="${b.txt}" cls="${b.cls}"`));
    console.log('\n🧱 contagem de linhas por seletor de grid:');
    Object.entries(dom.grids).forEach(([k, v]) => console.log(`   ${k}: ${v}`));

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-boleto.html'), await page.content(), 'utf8'); } catch (_) {}
  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}
  console.log(`\n✅ Detalhes em data/diag-boleto.json (requisições: ${resultado.requisicoes.length}, respostas: ${resultado.respostas.length})\n`);
}

main();

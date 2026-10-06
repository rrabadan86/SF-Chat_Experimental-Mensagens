/**
 * DIAGNÓSTICO v11 (não cobra nada) — pegar o LINK DE PAGAMENTO da aluna.
 *
 * Fluxo (igual ao manual): Perfil → Financeiro → Saldo devedor → "ENVIAR
 * COBRANÇA" (que SÓ ABRE o popup e GERA o link; não cobra). Capturamos o link
 * (https://evo-totem...) do popup e o endpoint que o gerou. NUNCA clicamos em
 * CONFIRMAR.
 *
 * SEGURANÇA: só clica em "ENVIAR COBRANÇA" (gera link) e depois CANCELAR.
 * Jamais clica CONFIRMAR / Receber / Cobrar. Não envia WhatsApp.
 *   node src/diag-debito.js
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(__dirname, '..', 'data', 'diag-debito.json');
const ID = 7650; // Daiene (vencida) — alvo fixo do diagnóstico

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v11 — link de pagamento (NÃO cobra nada)');
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

  const resultado = { geradoEm: new Date().toISOString(), id: ID, endpointsCobranca: [], linksNoDOM: [] };
  let capturarCobranca = false;
  page.on('response', async (res) => {
    try {
      if (!capturarCobranca || res.status() !== 200) return;
      const url = res.url();
      if (/intercom|instatus|signalr|google|gstatic|clarity|traducao/i.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text(); if (!txt || txt.length > 4_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const urls = urlsEmObj(data);
      const temTotem = /evo-totem|\/sl\//i.test(txt) || urls.some(([, v]) => /evo-totem/i.test(v));
      if (urls.length || temTotem) {
        resultado.endpointsCobranca.push({ url: url.split('?')[0], urls, trechoTotem: temTotem ? (txt.match(/https?:\/\/[^"'\\\s]*evo-totem[^"'\\\s]*/i) || [null])[0] : null });
        console.log(`   🔗 ${url.split('?')[0]}${temTotem ? '  ← TEM link evo-totem!' : ''}`);
        urls.forEach(([k, v]) => console.log(`        ${k} = ${v}`));
      }
    } catch (_) {}
  });

  const clicarTxt = (alvos, { exato = true } = {}) => page.evaluate(({ alvos, exato }) => {
    const quer = alvos.map(s => s.toLowerCase());
    for (const el of document.querySelectorAll('a,button,[role="tab"],[role="menuitem"],span,div,li')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const ok = exato ? quer.includes(t) : quer.some(q => t.includes(q));
      if (ok && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return t; }
    }
    return null;
  }, { alvos, exato });

  try {
    // LOGIN
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

    // Vai direto para a ficha completa da aluna (rota descoberta no v10)
    console.log(`\n🧾 Abrindo ficha completa da aluna ${ID}...`);
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/cadastro/${ID}//perfil`);
    await sleep(8000); await fecharPopupNovaTela(page);
    console.log(`   🌐 ${page.url()}`);

    // Aba "Financeiro"
    console.log(`   Financeiro: ${await clicarTxt(['financeiro']) || 'não achei'}`);
    await sleep(5000);
    // Sub-aba "Saldo devedor"
    console.log(`   Saldo devedor: ${await clicarTxt(['saldo devedor']) || 'não achei'}`);
    await sleep(5000);

    // Marca a linha do débito (checkbox), se houver
    await page.evaluate(() => { const cb = document.querySelector('table input[type="checkbox"], [role="row"] input[type="checkbox"]'); if (cb && !cb.checked) cb.click(); }).catch(() => {});
    await sleep(800);

    // Clica "ENVIAR COBRANÇA" — SÓ ABRE o popup e gera o link (não cobra)
    capturarCobranca = true;
    console.log(`\n💳 Clicando "ENVIAR COBRANÇA" (só gera o link; NÃO confirma)...`);
    const clicou = await clicarTxt(['enviar cobrança', 'enviar cobranca'], { exato: false });
    console.log(`   ${clicou ? 'clicado: ' + clicou : '⚠️  não achei o botão'}`);
    await sleep(7000);

    // Lê o link direto do popup/DOM (evo-totem...)
    resultado.linksNoDOM = await page.evaluate(() => {
      const out = new Set();
      const add = (s) => { if (s && /^https?:\/\//i.test(s)) out.add(s); };
      for (const a of document.querySelectorAll('a[href]')) add(a.getAttribute('href'));
      for (const el of document.querySelectorAll('input,textarea')) add(el.value);
      // texto visível com http
      const m = (document.body.innerText || '').match(/https?:\/\/[^\s"'<>]+/g) || [];
      m.forEach(add);
      return [...out].filter(u => /evo-totem|\/sl\/|pag|checkout|cobr/i.test(u)).slice(0, 10);
    }).catch(() => []);

    // SEGURANÇA: fecha o popup SEM confirmar (Cancelar / X / Esc)
    await clicarTxt(['cancelar']).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-cobranca.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`\n🔗 Links achados no popup/DOM (${resultado.linksNoDOM.length}):`);
  resultado.linksNoDOM.forEach(u => console.log(`   ${u}`));
  console.log(`\n🛰️  Endpoints que retornaram URL durante "ENVIAR COBRANÇA" (${resultado.endpointsCobranca.length}):`);
  for (const e of resultado.endpointsCobranca) {
    console.log(`   ${e.url}${e.trechoTotem ? '  ← ' + e.trechoTotem : ''}`);
    e.urls.forEach(([k, v]) => console.log(`      ${k} = ${v}`));
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-cobranca.html');
  console.log('   Me manda os links e o endpoint — é o que a automação vai usar pra pegar o link sem cobrar.\n');
}

main();

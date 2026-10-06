/**
 * DIAGNÓSTICO v9 (não envia nada) — mapear os elementos CLICÁVEIS da ficha/drawer
 * da aluna (incluindo ícones e aria-labels) e interceptar as chamadas da API,
 * para achar como chegar no financeiro (parcelas/cobranças/link).
 *
 * NÃO escreve no EVO, NÃO manda WhatsApp, NÃO toca na planilha.
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
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|sentry|hotjar|clarity/i;
const RE_FIN = /financ|receb|parcela|cobran|debito|d[eé]bito|saldo|fatura|pagamento|titulo|t[ií]tulo|venda|contrato/i;

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v9 — mapa de cliques da ficha (não envia nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], cliqueaveis: [], endpointsPorFase: {} };
  let listaDevedoras = null, fase = 'inicial';
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      if (/clientes-segmentacao\/obter-clientes/i.test(url)) {
        const d = JSON.parse(await res.text()); const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l; return;
      }
      if (RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const u = url.split('?')[0];
      (resultado.endpointsPorFase[fase] = resultado.endpointsPorFase[fase] || new Set()).add(u);
      if (RE_FIN.test(u)) console.log(`   💰 [${fase}] ${u}`);
    } catch (_) {}
  });

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
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    await fecharPopupNovaTela(page);
    console.log('✅ Login OK');

    // Abre "Com débito" e devedoras
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000);
    await fecharPopupNovaTela(page);
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => { for (const el of document.querySelectorAll('a,li,span,div,p')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } } return false; });
      if (ok) break; await sleep(1500);
    }
    await sleep(5000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome }));
    resultado.devedoras = devs;
    if (!devs.length) throw new Error('sem devedoras');

    // Abre a ficha/drawer da 1ª devedora
    fase = 'ficha';
    console.log(`\n🖱️  Abrindo ficha de ${devs[0].nome}...`);
    await page.evaluate((nome) => { const n = nome.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } }, devs[0].nome);
    await sleep(7000);
    await fecharPopupNovaTela(page);

    // Mapeia TODOS os elementos clicáveis: tag, texto, aria-label, title, ícone.
    resultado.cliqueaveis = await page.evaluate(() => {
      const out = [];
      const sel = 'a,button,[role="tab"],[role="button"],[role="menuitem"],[onclick],mat-icon,i,.mat-icon,li';
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        const aria = (el.getAttribute('aria-label') || '').trim().slice(0, 40);
        const title = (el.getAttribute('title') || '').trim().slice(0, 40);
        const icon = el.classList && (el.classList.contains('material-icons') || el.classList.contains('mat-icon') || el.tagName.toLowerCase() === 'mat-icon') ? (el.textContent || '').trim().slice(0, 24) : '';
        const label = [txt, aria && 'aria=' + aria, title && 'title=' + title, icon && 'icon=' + icon].filter(Boolean).join(' | ');
        if (label && !out.some(o => o.label === label)) out.push({ tag: el.tagName.toLowerCase(), label, x: Math.round(r.left), y: Math.round(r.top) });
      }
      return out.slice(0, 120);
    }).catch(() => []);

    // Dá uma fuçada: clica em coisas que cheiram a financeiro e vê o que carrega.
    for (const alvo of ['contratos', 'financeiro', 'contas a receber', 'cobranças', 'cobrancas', 'pagamentos', 'faturas', 'parcelas', 'histórico financeiro']) {
      fase = `clique:${alvo}`;
      const ok = await page.evaluate((nome) => {
        for (const el of document.querySelectorAll('a,button,[role="tab"],[role="menuitem"],span,div,li')) {
          if (el.children.length > 1) continue;
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          if ((t === nome || aria === nome) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        return false;
      }, alvo);
      if (ok) { console.log(`   ↳ cliquei "${alvo}"`); await sleep(4000); }
    }

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-ficha.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  // normaliza Sets -> arrays
  const eps = {};
  for (const [f, s] of Object.entries(resultado.endpointsPorFase)) eps[f] = [...s];
  resultado.endpointsPorFase = eps;
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log('🧩 Elementos clicáveis na ficha (tag | rótulo):');
  for (const c of resultado.cliqueaveis) console.log(`   ${c.tag.padEnd(8)} ${c.label}`);
  console.log('\n🌐 Endpoints por fase (💰 = cheiro de financeiro):');
  for (const [f, arr] of Object.entries(resultado.endpointsPorFase)) {
    console.log(`\n  ■ ${f}:`);
    for (const u of arr) console.log(`     ${RE_FIN.test(u) ? '💰' : '  '} ${u}`);
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-ficha.html');
  console.log('   Me manda a lista de CLICÁVEIS e os endpoints 💰 — aí eu sei onde clicar pro financeiro.\n');
}

main();

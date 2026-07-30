require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

puppeteer.use(StealthPlugin());

async function listarContratosVencendo() {
  console.log('\n═══════════════════════════════════════');
  console.log('📋 Contratos vencendo na semana atual');
  console.log('═══════════════════════════════════════\n');

  // Leitura transparente (igual à confirmação/follow-up/renovação): o browser
  // roda em modo headless — NENHUMA janela é aberta na tela para "ler" os
  // contratos no EVO.
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,900',
    ],
    defaultViewport: { width: 1366, height: 900 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  try {
    console.log('🔐 Fazendo login...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 15000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 80 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 80 });
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (['ENTRAR','LOGIN','ACESSAR'].includes(btn.textContent?.trim().toUpperCase())) { btn.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    await page.waitForFunction(() => window.location.hash.includes('/inicio/') || window.location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    console.log('✅ Login OK\n');

    console.log('📂 Navegando para Segmentação...');
    await page.evaluate(() => {
      window.location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes';
    });
    await sleep(5000);
    await page.screenshot({ path: 'debug-segmentacao.png' });

    console.log('🔍 Procurando segmento "Vencimento de Contrato Semana Atual"...');
    const segmentoClicado = await page.evaluate(() => {
      const candidates = document.querySelectorAll('a, li, span');
      for (const el of candidates) {
        const text = el.textContent?.trim() || '';
        if (
          text.toLowerCase().includes('vencimento de contrato semana') &&
          el.offsetWidth > 0 &&
          el.offsetHeight > 0
        ) {
          el.scrollIntoView();
          el.click();
          return text.substring(0, 80);
        }
      }
      // Fallback: elemento folha (sem filhos) com "vencimento de contrato"
      const all = document.querySelectorAll('span, div');
      for (const el of all) {
        if (
          el.children.length === 0 &&
          el.textContent?.trim().toLowerCase().includes('vencimento de contrato') &&
          el.offsetWidth > 0
        ) {
          el.scrollIntoView();
          el.click();
          return el.textContent.trim().substring(0, 80);
        }
      }
      return null;
    });

    if (!segmentoClicado) {
      console.log('⚠️  Segmento não encontrado. Verifique debug-segmentacao.png');
    } else {
      console.log(`✅ Clicado: "${segmentoClicado}"`);
    }

    await sleep(6000);
    await page.screenshot({ path: 'debug-contratos.png' });

    console.log('\n📊 Extraindo dados...');
    const clientes = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, tr.mat-row, tr[class*="row"]');
      const dados = [];
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(c => c.textContent?.trim() || '');
        if (cells.length < 2) return;
        let id = '', nome = '', contrato = '', data = '';
        for (const cell of cells) {
          const idNomeMatch = cell.match(/^(\d+)\s+(.+)/s);
          if (idNomeMatch && !id) { id = idNomeMatch[1]; nome = idNomeMatch[2].replace(/\s+/g, ' ').trim(); continue; }
          const dataMatch = cell.match(/\d{2}\/\d{2}\/\d{4}/);
          if (dataMatch && !data) { data = dataMatch[0]; continue; }
          if (!contrato && cell.length > 5 && !cell.match(/^\d+$/) && cell !== nome) contrato = cell;
        }
        if (nome || cells[0]) dados.push({ id, nome: nome || cells[0], contrato, data });
      });
      return dados;
    });

    console.log('\n═══════════════════════════════════════');
    if (clientes.length === 0) {
      console.log('⚠️  Nenhum cliente encontrado. Verifique debug-contratos.png');
    } else {
      console.log(`✅ ${clientes.length} cliente(s) com contrato vencendo:\n`);
      clientes.forEach((c, i) => {
        console.log(`${i + 1}. ${c.nome}`);
        console.log(`   Contrato: ${c.contrato}`);
        console.log(`   Data:     ${c.data}`);
        console.log('');
      });
    }
    console.log('═══════════════════════════════════════');
    await page.screenshot({ path: 'debug-resultado-contratos.png' });

  } catch (err) {
    console.error('❌ Erro:', err.message);
    await page.screenshot({ path: 'debug-erro-contratos.png' }).catch(() => {});
  } finally {
    await sleep(3000);
    await browser.close();
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

listarContratosVencendo();

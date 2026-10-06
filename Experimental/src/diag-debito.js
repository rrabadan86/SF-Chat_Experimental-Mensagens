/**
 * DIAGNÓSTICO v5 (não envia nada) — mapear o relatório "Contas a Receber" do EVO.
 *
 * O v4 revelou que o menu Financeiro tem "Contas a Receber": um relatório global
 * de recebíveis. É a melhor fonte para inadimplência vencida (cliente + vencimento
 * + valor + status, todos numa lista só).
 *
 * Este script:
 *   1. Loga no EVO.
 *   2. Abre Financeiro → Contas a Receber (clicando no menu; com fallback por hash).
 *   3. Captura TODO JSON (sem ruído) e destaca o endpoint com campos de parcela
 *      (vencimento/valor/status/situação), despejando os campos + algumas linhas.
 *   4. Grava data/diag-debito.json e data/diag-receber.html.
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
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|sentry|hotjar|clarity|obter-filtros|montar-filtro|verificar-filtro|listar-conexoes|qtde-requisicoes|obterBasico|permissoes/i;
const RE_PARCELA = /venc|valor|status|situac|situaç|pago|quita|baixa|parcela|aberto|recebi|cobran|desconto|multa|juros|competenc|atras/i;

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['retorno', 'data', 'items', 'rows', 'lista', 'result', 'results', 'content', 'parcelas', 'lancamentos', 'contas', 'receber', 'registros']) {
      if (Array.isArray(data[k])) return data[k];
    }
    // objeto paginado { totalRegistros, ... , lista:[...] } já coberto acima
  }
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v5 — Contas a Receber (não envia nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  const resultado = { geradoEm: new Date().toISOString(), capturas: [] };
  let capturar = false;
  page.on('response', async (res) => {
    try {
      if (!capturar || res.status() !== 200) return;
      const url = res.url();
      if (RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text();
      if (!txt || txt.length > 6_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      const campoParcela = chaves.filter(k => RE_PARCELA.test(k));
      resultado.capturas.push({
        url: url.split('?')[0],
        registros: lista ? lista.length : null,
        chaves,
        chavesParcela: campoParcela,
        ehParcela: campoParcela.length >= 2,
        exemplos: lista ? lista.slice(0, 15) : [amostra],
      });
      const marca = campoParcela.length >= 2 ? '💰' : '  ';
      console.log(`   ${marca} ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'obj'})`);
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
      for (const b of document.querySelectorAll('button')) {
        if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    await fecharPopupNovaTela(page);
    console.log('✅ Login OK\n');

    capturar = true;

    // 1) Tenta pelo MENU: abre "Financeiro" e clica "Contas a Receber".
    console.log('🧭 Abrindo Financeiro → Contas a Receber (via menu)...');
    const clicarTexto = (alvos) => page.evaluate((alvos) => {
      const quer = alvos.map(s => s.toLowerCase());
      for (const el of document.querySelectorAll('a, li, span, div, button, [role="menuitem"], [role="tab"]')) {
        if (el.children.length > 1) continue;
        const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (quer.includes(t) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return t; }
      }
      return null;
    }, alvos);

    const abriuMenu = await clicarTexto(['financeiro']);
    console.log(abriuMenu ? '   ✓ menu "Financeiro" aberto' : '   ⚠️  não achei o menu "Financeiro"');
    await sleep(1800);
    const clicouCR = await clicarTexto(['contas a receber']);
    console.log(clicouCR ? '   ✓ "Contas a Receber" clicado' : '   ⚠️  não achei "Contas a Receber" no menu');
    await sleep(8000);
    await fecharPopupNovaTela(page);

    // 2) Fallback por hash, caso o menu não tenha navegado.
    if (!resultado.capturas.some(c => c.ehParcela)) {
      console.log('🧭 Fallback: tentando rotas de hash para Contas a Receber...');
      const rotas = [
        'financeiro/contas-a-receber', 'financeiro/contas-receber', 'financeiro/receber',
        'financeiro/contas/receber', 'contas-a-receber', 'financeiro/contasReceber',
      ];
      for (const r of rotas) {
        await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/${r}`);
        await sleep(6000);
        await fecharPopupNovaTela(page);
        console.log(`   • tentei rota ${r}`);
        if (resultado.capturas.some(c => c.ehParcela)) { console.log(`   ✓ parcelas apareceram na rota ${r}`); break; }
      }
    }

    // 3) Se há uma grade/filtro de data, tenta uma busca ampla (clica lupa/buscar).
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (b.textContent || '').trim().toUpperCase();
        if (['BUSCAR', 'PESQUISAR', 'FILTRAR', 'APLICAR'].includes(t) && (b.offsetWidth > 0 || b.offsetHeight > 0)) { b.click(); return; }
      }
    }).catch(() => {});
    await sleep(6000);

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-receber.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  const parcelas = resultado.capturas.filter(c => c.ehParcela);
  console.log(`Respostas JSON capturadas: ${resultado.capturas.length} | com cara de parcela: ${parcelas.length}`);
  const mostrar = parcelas.length ? parcelas : resultado.capturas;
  for (const c of mostrar) {
    console.log(`\n${c.ehParcela ? '💰' : '  '} ${c.url}  (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
    console.log(`   campos de parcela: ${c.chavesParcela.join(', ') || '(nenhum pelo nome)'}`);
    console.log(`   todos os campos: ${c.chaves.join(', ')}`);
    (c.exemplos || []).slice(0, 5).forEach((e, i) => {
      const r = {};
      for (const k of Object.keys(e)) if (RE_PARCELA.test(k) || /nome|cliente/i.test(k)) r[k] = e[k];
      console.log(`   linha ${i + 1}: ${JSON.stringify(r)}`);
    });
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-receber.html');
  console.log('   Me manda o RESUMO: com os campos de vencimento/valor/status eu fecho o corte "vencido e em aberto".\n');
}

main();

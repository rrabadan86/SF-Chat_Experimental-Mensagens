/**
 * DIAGNÓSTICO v6 (não envia nada) — mapear "Contas a Receber", que o EVO ABRE EM
 * NOVA ABA. Agora capturamos o JSON de TODAS as abas (inclusive a que abrir).
 *
 *   1. Loga no EVO.
 *   2. Menu Financeiro → Contas a Receber (abre nova aba).
 *   3. Captura TODO JSON (sem ruído) de qualquer aba, destaca o endpoint com
 *      campos de parcela (vencimento/valor/status) e despeja algumas linhas.
 *      Tenta clicar "Buscar/Filtrar" na aba do relatório.
 *   4. Grava data/diag-debito.json e o HTML de cada aba aberta.
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
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|sentry|hotjar|clarity|obter-filtros|montar-filtro|verificar-filtro|listar-conexoes|qtde-requisicoes|obterBasico|permissoes|verificar-personal/i;
const RE_PARCELA = /venc|valor|status|situac|situaç|pago|quita|baixa|parcela|aberto|recebi|cobran|desconto|multa|juros|competenc|atras|titulo|t[ií]tulo|devedor/i;

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['retorno', 'data', 'items', 'rows', 'lista', 'result', 'results', 'content', 'parcelas', 'lancamentos', 'contas', 'receber', 'registros', 'titulos']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v6 — Contas a Receber (multi-aba, não envia nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });

  const resultado = { geradoEm: new Date().toISOString(), capturas: [] };
  let capturar = false;
  const abas = []; // todas as páginas (abas) vistas

  const anexar = (p) => {
    if (!p || abas.includes(p)) return;
    abas.push(p);
    p.on('response', async (res) => {
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
          ehParcela: campoParcela.length >= 2 && (lista ? lista.length : 1) >= 1,
          exemplos: lista ? lista.slice(0, 15) : [amostra],
        });
        console.log(`   ${campoParcela.length >= 2 ? '💰' : '  '} ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'obj'})`);
      } catch (_) {}
    });
  };

  // Captura abas futuras (nova aba do Financeiro) e as atuais.
  browser.on('targetcreated', async (t) => { try { if (t.type() === 'page') anexar(await t.page()); } catch (_) {} });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  anexar(page);

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

    // Menu Financeiro → Contas a Receber (abre nova aba)
    console.log('🧭 Abrindo Financeiro → Contas a Receber...');
    const clicar = (alvos) => page.evaluate((alvos) => {
      const quer = alvos.map(s => s.toLowerCase());
      for (const el of document.querySelectorAll('a, li, span, div, button, [role="menuitem"]')) {
        if (el.children.length > 1) continue;
        const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (quer.includes(t) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return t; }
      }
      return null;
    }, alvos);

    console.log(await clicar(['financeiro']) ? '   ✓ "Financeiro" aberto' : '   ⚠️  menu "Financeiro" não achado');
    await sleep(1800);
    console.log(await clicar(['contas a receber']) ? '   ✓ "Contas a Receber" clicado' : '   ⚠️  "Contas a Receber" não achado');
    await sleep(9000); // dá tempo da nova aba abrir e carregar

    // Vai pra aba do relatório (a última aberta) e tenta "Buscar/Filtrar".
    const alvo = abas[abas.length - 1] || page;
    try { await alvo.bringToFront(); } catch (_) {}
    try { await fecharPopupNovaTela(alvo); } catch (_) {}
    console.log(`   🗂️  Abas abertas: ${abas.length}. URL da última: ${alvo.url()}`);
    try {
      await alvo.evaluate(() => {
        for (const b of document.querySelectorAll('button, a, [role="button"]')) {
          const t = (b.textContent || '').trim().toUpperCase();
          if (['BUSCAR', 'PESQUISAR', 'FILTRAR', 'APLICAR'].includes(t) && (b.offsetWidth > 0 || b.offsetHeight > 0)) { b.click(); return; }
        }
      });
    } catch (_) {}
    await sleep(8000);

    // Salva o HTML de cada aba para inspeção.
    for (let i = 0; i < abas.length; i++) {
      try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', `diag-aba-${i}.html`), await abas[i].content(), 'utf8'); } catch (_) {}
    }

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  const parcelas = resultado.capturas.filter(c => c.ehParcela);
  console.log(`Respostas JSON: ${resultado.capturas.length} | com cara de parcela: ${parcelas.length}`);
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
  if (!parcelas.length) console.log('\n⚠️  Sem parcelas. Veja data/diag-aba-*.html (uma por aba) para achar a tela/endpoint certo.');
  console.log('\n✅ Detalhes em data/diag-debito.json\n');
}

main();

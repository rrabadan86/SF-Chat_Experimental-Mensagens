/**
 * DIAGNÓSTICO v7 (não envia nada) — descobrir a ROTA REAL da ficha da aluna e os
 * endpoints JSON que ela chama, clicando no NOME da devedora na segmentação.
 *
 *   1. Loga no EVO, abre a segmentação salva "Com débito".
 *   2. Clica no NOME da 1ª devedora (link) → abre a ficha.
 *   3. Registra a URL real da ficha, lista TODOS os endpoints JSON (não-ruído)
 *      com seus campos, e as abas reais da ficha. Tenta clicar uma aba
 *      "Financeiro" e captura de novo.
 *   4. Grava data/diag-debito.json + data/diag-ficha.html.
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
const RE_PARCELA = /venc|valor|status|situac|situaç|pago|quita|baixa|parcela|aberto|recebi|cobran|desconto|multa|juros|competenc|atras|titulo|t[ií]tulo|devedor|debito|d[eé]bito/i;

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
  console.log('🔎 DIAGNÓSTICO v7 — ficha da devedora (não envia nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });

  const resultado = { geradoEm: new Date().toISOString(), urlFicha: null, devedoras: [], fases: {} };
  let faseAtual = null;           // rótulo da fase de captura atual
  let listaDevedoras = null;
  const pagRef = {};              // guarda a page principal

  const anexar = (p) => {
    p.on('response', async (res) => {
      try {
        if (res.status() !== 200) return;
        const url = res.url();
        if (/clientes-segmentacao\/obter-clientes/i.test(url)) {
          try { const d = JSON.parse(await res.text()); const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []); if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l; } catch (_) {}
          return;
        }
        if (!faseAtual || RE_RUIDO.test(url)) return;
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
        (resultado.fases[faseAtual] = resultado.fases[faseAtual] || []).push({
          url: url.split('?')[0], registros: lista ? lista.length : null, chaves,
          chavesParcela: campoParcela, ehParcela: campoParcela.length >= 2,
          exemplo: amostra,
        });
        console.log(`   ${campoParcela.length >= 2 ? '💰' : '  '} [${faseAtual}] ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'obj'})`);
      } catch (_) {}
    });
  };
  browser.on('targetcreated', async (t) => { try { if (t.type() === 'page') anexar(await t.page()); } catch (_) {} });

  const page = (await browser.pages())[0] || await browser.newPage();
  pagRef.page = page;
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

    // Abre "Com débito" e pega devedoras
    console.log('📂 Abrindo "Com débito"...');
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000);
    await fecharPopupNovaTela(page);
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => {
        for (const el of document.querySelectorAll('a, li, span, div, p')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        return false;
      });
      if (ok) break; await sleep(1500);
    }
    await sleep(6000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome }));
    resultado.devedoras = devs;
    console.log(`   Devedoras: ${devs.map(d => `${d.idCliente}:${d.nome}`).join(' | ') || '(não capturei)'}`);
    if (!devs.length) throw new Error('não capturei a lista de devedoras');

    // Clica no NOME da 1ª devedora (link da tabela) → abre a ficha
    const alvoNome = devs[0].nome;
    console.log(`\n🖱️  Clicando no nome "${alvoNome}" para abrir a ficha...`);
    faseAtual = 'ficha';
    const clicou = await page.evaluate((nome) => {
      const n = nome.trim().toLowerCase();
      // procura um link/elemento clicável cujo texto seja o nome
      for (const el of document.querySelectorAll('a, span, div, td')) {
        const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
      }
      return false;
    }, alvoNome);
    console.log(clicou ? '   ✓ nome clicado' : '   ⚠️  não achei o nome na tabela');
    await sleep(8000);
    await fecharPopupNovaTela(page);
    resultado.urlFicha = page.url();
    console.log(`   🌐 URL da ficha: ${resultado.urlFicha}`);

    // Lista as abas REAIS da ficha (dentro do painel da aluna, texto curto).
    const abas = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('a, li, span, div, button, [role="tab"]')) {
        if (el.children.length > 1) continue;
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length <= 22 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !out.includes(t)) out.push(t);
      }
      return out.slice(0, 60);
    }).catch(() => []);
    resultado.abasFicha = abas;
    console.log(`   🗂️  Abas na ficha: ${abas.join(' | ')}`);

    // Tenta clicar uma aba financeira dentro da ficha
    faseAtual = 'ficha-financeiro';
    for (const alvo of ['financeiro', 'contas a receber', 'contas', 'pagamentos', 'cobranças', 'cobrancas', 'lançamentos', 'lancamentos']) {
      const ok = await page.evaluate((nome) => {
        for (const el of document.querySelectorAll('a, li, span, div, button, [role="tab"]')) {
          if (el.children.length > 1) continue;
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === nome && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        return false;
      }, alvo);
      if (ok) { console.log(`   ↳ aba "${alvo}" clicada`); await sleep(5000); }
      if ((resultado.fases['ficha-financeiro'] || []).some(c => c.ehParcela)) break;
    }

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-ficha.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`URL da ficha: ${resultado.urlFicha}`);
  console.log(`Abas da ficha: ${(resultado.abasFicha || []).join(' | ')}`);
  for (const [fase, caps] of Object.entries(resultado.fases)) {
    console.log(`\n■ Fase "${fase}" — ${caps.length} endpoint(s) JSON:`);
    for (const c of caps) {
      console.log(`   ${c.ehParcela ? '💰' : '  '} ${c.url} (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
      console.log(`      campos: ${c.chaves.join(', ')}`);
      if (c.ehParcela) {
        const r = {};
        for (const k of Object.keys(c.exemplo)) if (RE_PARCELA.test(k) || /nome|cliente/i.test(k)) r[k] = c.exemplo[k];
        console.log(`      exemplo: ${JSON.stringify(r)}`);
      }
    }
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-ficha.html');
  console.log('   Me manda: a URL da ficha, as abas, e os endpoints 💰 (ou a lista toda se não houver 💰).\n');
}

main();

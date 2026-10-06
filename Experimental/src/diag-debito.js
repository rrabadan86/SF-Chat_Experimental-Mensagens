/**
 * DIAGNÓSTICO (não envia nada) — lê a segmentação SALVA "Com débito" no EVO e
 * mostra os campos financeiros das devedoras REAIS, para sabermos de onde tirar
 * o "saldo devedor".
 *
 * O que faz:
 *   1. Loga no EVO (mesmo login/2FA dos outros jobs).
 *   2. Abre a Segmentação e clica na segmentação salva "Com débito" (lateral).
 *   3. Intercepta a resposta de `obter-clientes` (filtrada) e imprime, de cada
 *      devedora, os campos financeiros (inadimplente, vencimentoDebito,
 *      valorContrato, statusContrato, sessoesPendentes, categoriaContratos…).
 *   4. Grava tudo em data/diag-debito.json + o HTML da tela.
 *
 * NÃO escreve no EVO, NÃO manda WhatsApp, NÃO toca na planilha.
 *
 * Uso (no VPS):
 *   cd ~/SF-Chat_Experimental-Mensagens/Experimental
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

// Campos que, pelo NOME, parecem carregar saldo/pendência financeira.
const RE_FINANCEIRO = /saldo|d[eé]bito|divida|d[ií]vida|valor|pendenc|pend[eê]nc|aberto|receber|atras|venc|parcela|cobran|inadimpl/i;
// Campos que queremos ver explícitos de cada devedora (quando existirem).
const CAMPOS_VER = ['idCliente', 'nome', 'celular', 'telefone', 'contrato', 'status', 'statusCliente',
  'inadimplente', 'vencimentoDebito', 'valorContrato', 'dataVencimentoContrato', 'statusContrato',
  'categoriaContratos', 'sessoesPendentes', 'statusTreino', 'dtFimContrato', 'mesesContrato'];

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO — segmentação salva "Com débito" (não envia nada)');
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

  // ── Captura das respostas de obter-clientes (cada chamada = um snapshot) ──
  let fase = 'inicial';
  const snapshots = [];
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      if (!/clientes-segmentacao\/obter-clientes/i.test(url)) return;
      const txt = await res.text();
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = Array.isArray(data) ? data : (data.retorno || data.data || data.lista || []);
      if (!Array.isArray(lista)) return;
      const chaves = new Set();
      for (const r of lista.slice(0, 3)) if (r && typeof r === 'object') Object.keys(r).forEach(k => chaves.add(k));
      // Subconjunto financeiro de CADA registro (até 10), para olharmos os valores.
      const registrosFin = lista.slice(0, 10).map(r => {
        const o = {};
        for (const k of CAMPOS_VER) if (k in (r || {})) o[k] = r[k];
        // qualquer OUTRO campo financeiro com valor não-nulo que escape da lista acima
        for (const k of Object.keys(r || {})) {
          if (RE_FINANCEIRO.test(k) && !(k in o) && r[k] != null && r[k] !== '') o[k] = r[k];
        }
        return o;
      });
      snapshots.push({ fase, registros: lista.length, chaves: [...chaves], registrosFin });
      console.log(`   📸 obter-clientes [${fase}] → ${lista.length} registro(s)`);
    } catch (_) {}
  });

  try {
    // 1) LOGIN
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

    // 2) SEGMENTAÇÃO de clientes
    console.log('📂 Abrindo Segmentação de clientes...');
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000);
    await fecharPopupNovaTela(page);

    // 3) Clica na segmentação SALVA "Com débito" (lista da lateral, grupo SALVOS)
    fase = 'com-debito';
    console.log('🧮 Abrindo a segmentação salva "Com débito"...');
    let abriu = false;
    for (let i = 0; i < 12 && !abriu; i++) {
      abriu = await page.evaluate(() => {
        for (const el of document.querySelectorAll('a, li, span, div, p')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
            el.scrollIntoView({ block: 'center' }); el.click(); return true;
          }
        }
        return false;
      });
      if (!abriu) await sleep(1500);
    }
    if (!abriu) {
      // Diagnóstico: lista os itens clicáveis da lateral para acharmos o nome certo.
      const itens = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('a, li, span, div, p')) {
          const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 45 && el.children.length === 0 && el.offsetWidth > 0 && !out.includes(t)) out.push(t);
        }
        return out.slice(0, 60);
      }).catch(() => []);
      console.log('   ⚠️  Não achei "Com débito" na lateral. Itens visíveis:');
      itens.forEach(t => console.log(`      • ${t}`));
    } else {
      console.log('   ✓ Segmentação "Com débito" clicada');
    }
    await sleep(7000);

    const totalTxt = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/(\d+)\s+resultado/i);
      return m ? m[1] : null;
    }).catch(() => null);
    console.log(`   🔢 EVO mostra: ${totalTxt || '?'} resultado(s)`);

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-debito.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  // ── RESUMO ──────────────────────────────────────────────────────────────
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify({ geradoEm: new Date().toISOString(), snapshots }, null, 2), 'utf8'); } catch (_) {}

  // O snapshot que interessa é o da fase "com-debito" com MENOS registros
  // (a lista filtrada; o EVO também chama obter-clientes com a base inteira).
  const comDeb = snapshots.filter(s => s.fase === 'com-debito');
  const alvo = comDeb.length ? comDeb.reduce((a, b) => (b.registros < a.registros ? b : a)) : null;

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`Snapshots de obter-clientes: ${snapshots.length} (fase com-debito: ${comDeb.length})`);
  if (!alvo) {
    console.log('⚠️  Nenhum snapshot filtrado capturado. Veja data/diag-debito.html para achar o seletor certo.');
  } else {
    console.log(`\n💰 Lista FILTRADA (com débito): ${alvo.registros} devedora(s). Campos de cada uma:\n`);
    alvo.registrosFin.forEach((r, i) => {
      console.log(`  ── Devedora ${i + 1} ──`);
      for (const [k, v] of Object.entries(r)) console.log(`     ${k} = ${JSON.stringify(v)}`);
      console.log('');
    });
    console.log('Campos disponíveis no registro (todos): veja "chaves" no diag-debito.json');
  }
  console.log('\n✅ Detalhes completos em: data/diag-debito.json  |  HTML em: data/diag-debito.html');
  console.log('   Me manda o RESUMO acima que eu te digo se dá pra mostrar o VALOR do saldo ou só quem/ quando.\n');
}

main();

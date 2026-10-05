/**
 * DIAGNÓSTICO (não envia nada) — descobre de ONDE sai o "saldo devedor" no EVO.
 *
 * O que faz:
 *   1. Loga no EVO (mesmo login/2FA dos outros jobs).
 *   2. Abre a Segmentação de clientes.
 *   3. Aplica o filtro "+ FILTRO" → "Com débito".
 *   4. Intercepta TODAS as respostas JSON do EVO e registra, para cada uma:
 *      a URL, quantos registros voltaram, a LISTA DE CAMPOS e UM registro de
 *      exemplo. Destaca os campos que parecem financeiros (saldo/valor/débito…).
 *   5. Escreve tudo em data/diag-debito.json e imprime um resumo no console.
 *
 * NÃO escreve no EVO, NÃO manda WhatsApp, NÃO toca na planilha. Só leitura + 1 arquivo local.
 *
 * Uso (no VPS):
 *   cd ~/SF-Chat_Experimental-Mensagens/Experimental
 *   node src/diag-debito.js
 *   # depois me manda o resumo do console (ou o arquivo data/diag-debito.json)
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

// Campos que, pelo NOME, parecem carregar o saldo/pendência financeira.
const RE_FINANCEIRO = /saldo|d[eé]bito|divida|d[ií]vida|valor|pendenc|pend[eê]nc|aberto|receber|atras|venc|parcela|cobran|inadimpl/i;

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO "Com débito" — lendo campos do EVO (não envia nada)');
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

  // ── Captura de TODAS as respostas JSON (o tesouro está aqui) ──────────────
  // Para cada resposta: URL (sem querystring), nº de registros, união de chaves
  // e UM registro de exemplo (fica só no arquivo local do VPS). Marcamos a
  // "fase" (antes/depois do filtro) para sabermos o que o filtro trouxe de novo.
  let fase = 'antes-do-filtro';
  const capturas = [];
  const extrairLista = (data) => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      for (const k of ['retorno', 'data', 'items', 'rows', 'lista', 'result', 'results', 'content']) {
        if (Array.isArray(data[k])) return data[k];
      }
    }
    return null;
  };
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      const pareceInteressante = /obter-clientes|debito|d[eé]bito|saldo|financ|receber|pendenc|cliente/i.test(url);
      if (!ct.includes('json') && !pareceInteressante) return;
      const txt = await res.text();
      if (!txt || txt.length > 4_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0]
                     : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      // União das chaves dos 3 primeiros registros (alguns campos só aparecem
      // quando preenchidos, então olhar mais de um registro ajuda).
      const chaves = new Set();
      const base = lista && lista.length ? lista.slice(0, 3) : [amostra];
      for (const r of base) if (r && typeof r === 'object') Object.keys(r).forEach(k => chaves.add(k));
      const chavesArr = [...chaves];
      const financeiras = chavesArr.filter(k => RE_FINANCEIRO.test(k));
      capturas.push({
        fase,
        url: url.split('?')[0],
        comQueryString: url.includes('?'),
        registros: lista ? lista.length : null,
        chaves: chavesArr,
        chavesFinanceiras: financeiras,
        exemplo: amostra, // registro completo (dado pessoal — fica só no VPS)
      });
    } catch (_) { /* resposta não-JSON ou já consumida */ }
  });

  try {
    // 1) LOGIN ──────────────────────────────────────────────────────────────
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

    // 2) SEGMENTAÇÃO de clientes ───────────────────────────────────────────
    console.log('📂 Abrindo Segmentação de clientes...');
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000);
    await fecharPopupNovaTela(page);
    console.log(`   📸 Snapshots capturados até aqui (antes do filtro): ${capturas.length}`);

    // 3) "+ FILTRO" → "Com débito" ─────────────────────────────────────────
    fase = 'depois-do-filtro';
    console.log('🧮 Abrindo "+ FILTRO"...');
    const abriu = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span, div')) {
        const t = (el.textContent || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if ((t === '+ FILTRO' || t === '+FILTRO' || t === 'FILTRO') && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          (el.closest('button, a, [role="button"]') || el).click(); return true;
        }
      }
      return false;
    });
    console.log(abriu ? '   ✓ "+ FILTRO" clicado' : '   ⚠️  Não achei o botão "+ FILTRO" (seguindo mesmo assim)');
    await sleep(1500);

    // Digita "débito" no campo de busca do menu de filtros (placeholder "Pesquisar").
    try {
      await page.waitForSelector('input[placeholder*="esquisar" i], input[placeholder*="Pesquis"]', { timeout: 6000 });
      const campo = await page.$('input[placeholder*="esquisar" i], input[placeholder*="Pesquis"]');
      if (campo) { await campo.click(); await campo.type('débito', { delay: 70 }); console.log('   ✓ Digitei "débito" na busca de filtros'); }
    } catch (_) { console.log('   ℹ️  Campo de busca do filtro não apareceu — vou procurar a opção direto'); }
    await sleep(1200);

    // Clica na opção "Com débito".
    const marcou = await page.evaluate(() => {
      const alvo = ['com débito', 'com debito'];
      for (const el of document.querySelectorAll('li, div, span, a, md-option, [role="option"], label')) {
        if (el.children.length > 2) continue;
        const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (alvo.includes(t) && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          el.scrollIntoView({ block: 'center' }); el.click(); return t;
        }
      }
      return null;
    });
    console.log(marcou ? `   ✓ Opção "${marcou}" selecionada` : '   ⚠️  Não achei a opção "Com débito" no menu');
    await sleep(2500);

    // Alguns filtros do EVO exigem um "Aplicar/Filtrar/Buscar" ou um Enter.
    const aplicou = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button, a, [role="button"]')) {
        const t = (b.textContent || '').trim().toUpperCase();
        if (['APLICAR', 'FILTRAR', 'BUSCAR', 'PESQUISAR', 'CONFIRMAR'].includes(t) && (b.offsetWidth > 0 || b.offsetHeight > 0)) {
          b.click(); return t;
        }
      }
      return null;
    });
    if (aplicou) console.log(`   ✓ Botão "${aplicou}" clicado`);
    await sleep(6000); // dá tempo da lista filtrada (e de um possível endpoint financeiro) chegar

    // Lê quantos resultados o EVO mostra agora (ex.: "12 resultados").
    const totalTxt = await page.evaluate(() => {
      const m = (document.body.innerText || '').match(/(\d+)\s+resultado/i);
      return m ? m[1] : null;
    }).catch(() => null);
    console.log(`   🔢 EVO mostra agora: ${totalTxt || '?'} resultado(s) com débito`);

    // Salva o HTML pós-filtro (ajuda se a gente precisar achar a coluna do valor).
    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-debito.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  // ── RESUMO ────────────────────────────────────────────────────────────────
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify({ geradoEm: new Date().toISOString(), capturas }, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`Respostas JSON capturadas: ${capturas.length}`);
  for (const c of capturas) {
    const marca = c.chavesFinanceiras.length ? '💰' : '  ';
    console.log(`\n${marca} [${c.fase}] ${c.url}  (${c.registros != null ? c.registros + ' reg.' : 'objeto'})`);
    if (c.chavesFinanceiras.length) {
      console.log(`     ↳ CAMPOS FINANCEIROS: ${c.chavesFinanceiras.join(', ')}`);
      for (const k of c.chavesFinanceiras) console.log(`         ex.: ${k} = ${JSON.stringify(c.exemplo[k])}`);
    }
    console.log(`     campos: ${c.chaves.join(', ')}`);
  }
  console.log('\n✅ Detalhes completos (com um registro de exemplo) em: data/diag-debito.json');
  console.log('   HTML da tela filtrada em: data/diag-debito.html');
  console.log('   Me manda o RESUMO acima (ou o diag-debito.json) que eu te digo de onde tirar o saldo.\n');
}

main();

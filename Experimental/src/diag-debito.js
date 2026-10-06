/**
 * DIAGNÓSTICO v8 (não envia nada) — falar DIRETO com a API do EVO.
 *
 * Captura o header de Authorization de uma chamada real e sonda endpoints
 * financeiros da aluna (contas a receber / parcelas / link de pagamento),
 * listando status e campos de cada um — inclusive qualquer valor que seja URL
 * (o link de pagamento). Base da futura automação (que falará com a API, não
 * com a tela).
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
const G = 'https://evo-abc-api-gerencial.w12app.com.br/api/v1';
const A = 'https://evo-abc-api.w12app.com.br/api/v1';
const A2 = 'https://evo-abc-api.w12app.com.br/api/v2';

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v8 — API direta do EVO (não envia nada)');
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

  // Captura o Authorization (e headers afins) de chamadas reais à API do EVO.
  const authHeaders = {};
  let idFilial = null;
  page.on('request', (req) => {
    try {
      const u = req.url();
      if (!/evo-abc-api/i.test(u)) return;
      const h = req.headers();
      for (const k of Object.keys(h)) {
        const kl = k.toLowerCase();
        if (['authorization', 'x-access-token', 'x-token', 'tokenacesso', 'idfilial', 'x-filial'].includes(kl) && h[k] && !authHeaders[kl]) {
          authHeaders[kl] = h[k];
        }
      }
    } catch (_) {}
  });
  let listaDevedoras = null;
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      if (/clientes-segmentacao\/obter-clientes/i.test(res.url())) {
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l;
      }
    } catch (_) {}
  });

  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], authKeys: [], probes: [] };

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
    console.log('✅ Login OK');

    // Abre "Com débito" (gera chamadas gerenciais → captura auth + devedoras)
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
    await sleep(5000);
    // Clica no nome da 1ª devedora (gera chamadas /clientes/{id}/... → mais auth)
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome, celular: r.celular, contrato: r.contrato }));
    resultado.devedoras = devs;
    if (devs.length) {
      await page.evaluate((nome) => {
        const n = nome.trim().toLowerCase();
        for (const el of document.querySelectorAll('a, span, div, td')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; }
        }
      }, devs[0].nome);
      await sleep(6000);
      await fecharPopupNovaTela(page);
    }
    resultado.authKeys = Object.keys(authHeaders);
    console.log(`   🔑 headers de auth capturados: ${resultado.authKeys.join(', ') || '(nenhum!)'}`);
    console.log(`   👥 devedoras: ${devs.map(d => d.idCliente + ':' + d.nome).join(' | ')}`);

    // SONDA endpoints financeiros, via fetch DENTRO da página (herda CORS/sessão),
    // com os headers de auth capturados. Para a 1ª devedora (id).
    const id = devs.length ? devs[0].idCliente : 7650;
    const candidatos = [
      `${G}/clientes/${id}/contas-receber`,
      `${G}/clientes/${id}/financeiro`,
      `${G}/clientes/${id}/recebiveis`,
      `${G}/clientes/${id}/debitos`,
      `${G}/clientes/${id}/parcelas`,
      `${G}/clientes/${id}/saldo`,
      `${G}/clientes/${id}/cobrancas`,
      `${A}/clientesContratos/${id}/parcelas`,
      `${A}/clientes/${id}/contas-receber`,
      `${A}/clientes/${id}/financeiro`,
      `${A}/contas-receber?idCliente=${id}`,
      `${A}/financeiro/contas-receber?idCliente=${id}`,
      `${A}/recebiveis?idCliente=${id}`,
      `${A}/contas-receber/cliente/${id}`,
      `${A2}/financeiro/contas-receber?idCliente=${id}`,
    ];
    console.log(`\n🛰️  Sondando ${candidatos.length} endpoints para id ${id}...`);
    resultado.probes = await page.evaluate(async (urls, headers) => {
      const out = [];
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers, credentials: 'include' });
          const ct = (r.headers.get('content-type') || '').toLowerCase();
          let info = { url, status: r.status, ct };
          if (r.ok && ct.includes('json')) {
            const txt = await r.text();
            try {
              const data = JSON.parse(txt);
              const lista = Array.isArray(data) ? data : (data.retorno || data.data || data.lista || data.registros || data.parcelas || data.content || null);
              const amostra = (lista && lista.length) ? lista[0] : (typeof data === 'object' && !Array.isArray(data) ? data : null);
              info.registros = Array.isArray(lista) ? lista.length : null;
              info.chaves = amostra ? Object.keys(amostra) : [];
              info.amostra = amostra;
            } catch (_) { info.corpo = txt.slice(0, 300); }
          }
          out.push(info);
        } catch (e) { out.push({ url, erro: String(e && e.message || e) }); }
      }
      return out;
    }, candidatos, authHeaders);

  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`Headers de auth: ${resultado.authKeys.join(', ') || '(nenhum)'}`);
  for (const p of resultado.probes) {
    if (p.erro) { console.log(`\n   ❌ ${p.url} → erro: ${p.erro}`); continue; }
    const temDados = p.chaves && p.chaves.length;
    const marca = p.status === 200 && temDados ? '✅' : (p.status === 200 ? '· ' : '✗ ');
    console.log(`\n   ${marca} [${p.status}] ${p.url}${p.registros != null ? ' (' + p.registros + ' reg.)' : ''}`);
    if (temDados) {
      console.log(`      campos: ${p.chaves.join(', ')}`);
      const urls = urlsEmObj(p.amostra);
      urls.forEach(([k, v]) => console.log(`      🔗 ${k} = ${v}`));
    } else if (p.corpo) {
      console.log(`      corpo: ${p.corpo}`);
    }
  }
  console.log('\n✅ Detalhes em data/diag-debito.json');
  console.log('   Me manda os endpoints ✅ (com campos/🔗). É daí que sai a parcela vencida + o link.\n');
}

main();

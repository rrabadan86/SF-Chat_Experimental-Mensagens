/**
 * DIAGNÓSTICO v4 (não envia nada) — achar o endpoint do financeiro da ficha com
 * as PARCELAS (vencimento + valor + status), comparando uma devedora VENCIDA com
 * uma de débito FUTURO (Carol), para sabermos qual campo cortar por data < hoje.
 *
 * Estratégia:
 *   1. Abre a segmentação salva "Com débito" e pega as devedoras (id + nome).
 *   2. Para CADA devedora: abre a ficha, CAPTURA TODO JSON (não filtra por URL),
 *      lista as abas clicáveis, clica em "Financeiro" (e variações) e guarda as
 *      respostas cujos campos parecem de parcela (vencimento/valor/status/pago).
 *   3. Grava data/diag-debito.json com, por devedora, as parcelas encontradas.
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
// URLs de telemetria/ruído que não interessam.
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|sentry|hotjar|clarity/i;
// Campos que caracterizam uma parcela/conta a receber.
const RE_PARCELA = /venc|valor|status|pago|quita|baixa|parcela|aberto|recebi|cobran|desconto|multa|juros|competenc/i;

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['retorno', 'data', 'items', 'rows', 'lista', 'result', 'results', 'content', 'parcelas', 'lancamentos', 'contas', 'receber']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v4 — parcelas do financeiro (não envia nada)');
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

  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], fichas: {} };
  let capturaAtiva = null; // nome da devedora cuja ficha estamos lendo
  let listaDevedoras = null;

  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      // Sempre tenta pegar a lista filtrada da segmentação.
      if (/clientes-segmentacao\/obter-clientes/i.test(url)) {
        try {
          const d = JSON.parse(await res.text());
          const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
          if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l;
        } catch (_) {}
        return;
      }
      if (!capturaAtiva) return;
      if (RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text();
      if (!txt || txt.length > 4_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      const pareceParcela = chaves.filter(k => RE_PARCELA.test(k)).length >= 2; // 2+ campos de parcela
      const reg = resultado.fichas[capturaAtiva];
      reg.todasRespostas.push({ url: url.split('?')[0], registros: lista ? lista.length : null, chaves });
      if (pareceParcela) {
        reg.financeiro.push({
          url: url.split('?')[0],
          registros: lista ? lista.length : null,
          chaves,
          exemplos: (lista ? lista.slice(0, 12) : [amostra]),
        });
        console.log(`   💰 [${capturaAtiva}] parcelas em ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'objeto'})`);
      }
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
      if (ok) break;
      await sleep(1500);
    }
    await sleep(6000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome, celular: r.celular }));
    resultado.devedoras = devs;
    console.log(`   Devedoras: ${devs.map(d => `${d.idCliente}:${d.nome}`).join(' | ') || '(não capturei)'}`);

    // Para cada devedora: abre ficha, lista abas, clica Financeiro, captura
    for (const dev of devs) {
      console.log(`\n🧾 Ficha de ${dev.nome} (id ${dev.idCliente})...`);
      resultado.fichas[dev.nome] = { idCliente: dev.idCliente, celular: dev.celular, abas: [], financeiro: [], todasRespostas: [] };
      capturaAtiva = dev.nome;

      await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/ficha-cliente/${dev.idCliente}`);
      await sleep(6000);
      await fecharPopupNovaTela(page);

      // Lista as abas/menus clicáveis da ficha (texto curto, folha).
      resultado.fichas[dev.nome].abas = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('a, li, span, div, button, [role="tab"]')) {
          if (el.children.length > 1) continue;
          const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if (t && t.length <= 24 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !out.includes(t)) out.push(t);
        }
        return out.slice(0, 50);
      }).catch(() => []);

      // Clica em abas financeiras possíveis (uma de cada vez, com espera).
      for (const alvo of ['financeiro', 'contas a receber', 'contas', 'lançamentos', 'lancamentos', 'contratos', 'pagamentos', 'fluxo']) {
        const clicou = await page.evaluate((nome) => {
          for (const el of document.querySelectorAll('a, li, span, div, button, [role="tab"]')) {
            if (el.children.length > 1) continue;
            const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (t === nome && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
          }
          return false;
        }, alvo);
        if (clicou) { console.log(`   ↳ aba "${alvo}" clicada`); await sleep(4500); }
        if (resultado.fichas[dev.nome].financeiro.length) break;
      }

      // salva o HTML da ficha da 1ª devedora para inspeção, se não achou nada
      if (!resultado.fichas[dev.nome].financeiro.length) {
        console.log(`   ⚠️  Sem parcelas capturadas para ${dev.nome}. Abas vistas: ${resultado.fichas[dev.nome].abas.join(' | ')}`);
        try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', `diag-ficha-${dev.idCliente}.html`), await page.content(), 'utf8'); } catch (_) {}
      }
      capturaAtiva = null;
    }

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  for (const [nome, f] of Object.entries(resultado.fichas)) {
    console.log(`\n👤 ${nome} (id ${f.idCliente})`);
    console.log(`   abas: ${f.abas.join(' | ')}`);
    if (!f.financeiro.length) {
      console.log('   ⚠️  nenhuma parcela capturada (veja diag-ficha-<id>.html). Endpoints JSON vistos:');
      for (const r of f.todasRespostas.slice(0, 20)) console.log(`       - ${r.url} (${r.registros != null ? r.registros + ' reg.' : 'obj'}) campos: ${r.chaves.slice(0, 12).join(', ')}`);
    } else {
      for (const fin of f.financeiro) {
        console.log(`   💰 ${fin.url} (${fin.registros != null ? fin.registros + ' reg.' : 'obj'})`);
        console.log(`      campos: ${fin.chaves.join(', ')}`);
        (fin.exemplos || []).slice(0, 6).forEach((e, i) => {
          const resumo = {};
          for (const k of Object.keys(e)) if (RE_PARCELA.test(k)) resumo[k] = e[k];
          console.log(`      parcela ${i + 1}: ${JSON.stringify(resumo)}`);
        });
      }
    }
  }
  console.log('\n✅ Detalhes completos em data/diag-debito.json');
  console.log('   Compare Daiene (provável vencida) x Carol (futura): o campo de data que difere é o nosso corte.\n');
}

main();

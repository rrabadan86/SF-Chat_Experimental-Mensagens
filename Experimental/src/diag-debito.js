/**
 * DIAGNÓSTICO v3 (não envia nada) — descobrir como listar SÓ inadimplência
 * VENCIDA (vencimento < hoje), excluindo débito futuro.
 *
 * Checa DOIS caminhos num run só:
 *   A) Opções do "+ FILTRO": procura um filtro tipo "Inadimplente / Vencido /
 *      Em atraso" (que já significaria vencido) — se existir, basta salvar uma
 *      segmentação com ele.
 *   B) Financeiro da devedora: abre a ficha de uma devedora da segmentação
 *      "Com débito" e captura o endpoint de contas a receber (vencimento +
 *      valor + status), para nós mesmos cortarmos por data.
 *
 * Grava tudo em data/diag-debito.json + HTML das telas. NÃO escreve no EVO,
 * NÃO manda WhatsApp, NÃO toca na planilha.
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
const RE_FIN_URL = /financeiro|receber|parcela|lancamento|lançamento|debito|d[eé]bito|cobranca|cobran[çc]a|saldo|fatura|recebivel|receb[ií]vel|contas/i;
const RE_FIN_FIELD = /saldo|d[eé]bito|divida|d[ií]vida|valor|pendenc|aberto|receber|atras|venc|parcela|cobran|inadimpl|status|pag/i;

function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['retorno', 'data', 'items', 'rows', 'lista', 'result', 'results', 'content', 'parcelas', 'lancamentos']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v3 — inadimplência vencida (não envia nada)');
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

  const resultado = { geradoEm: new Date().toISOString(), opcoesFiltro: {}, devedoras: [], capturasFinanceiro: [] };
  let capturarFin = false; // só liga quando entrarmos na ficha da devedora
  page.on('response', async (res) => {
    try {
      if (!capturarFin || res.status() !== 200) return;
      const url = res.url();
      if (!RE_FIN_URL.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text();
      if (!txt || txt.length > 4_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      resultado.capturasFinanceiro.push({
        url: url.split('?')[0],
        registros: lista ? lista.length : null,
        chaves,
        chavesFinanceiras: chaves.filter(k => RE_FIN_FIELD.test(k)),
        exemplos: (lista ? lista.slice(0, 8) : [amostra]),
      });
      console.log(`   💰 financeiro capturado: ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'objeto'})`);
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

    // 2) SEGMENTAÇÃO
    console.log('📂 Abrindo Segmentação de clientes...');
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000);
    await fecharPopupNovaTela(page);

    // 3) PROBE "+ FILTRO": procura um filtro de inadimplência/vencido ────────
    console.log('🧪 Caminho A — procurando um filtro de inadimplência/vencido no "+ FILTRO"...');
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, span, div')) {
        const t = (el.textContent || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if ((t === '+ FILTRO' || t === '+FILTRO' || t === 'FILTRO') && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          (el.closest('button, a, [role="button"]') || el).click(); return true;
        }
      }
      return false;
    });
    await sleep(1500);
    for (const termo of ['inad', 'vencid', 'atras', 'débito', 'aberto', 'pend']) {
      try {
        const campo = await page.$('input[placeholder*="esquisar" i], input[placeholder*="Pesquis"]');
        if (campo) { await campo.click({ clickCount: 3 }); await campo.type(termo, { delay: 50 }); }
      } catch (_) {}
      await sleep(900);
      const opcoes = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('li, md-option, [role="option"], .option, div, span, label')) {
          if (el.children.length > 1) continue;
          const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 50 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !out.includes(t)) out.push(t);
        }
        return out.slice(0, 40);
      }).catch(() => []);
      resultado.opcoesFiltro[termo] = opcoes;
      console.log(`   • "${termo}" → ${opcoes.length ? opcoes.join(' | ') : '(nada)'}`);
    }
    // fecha o menu de filtro (Esc)
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(800);

    // 4) Abre a segmentação salva "Com débito" e pega as devedoras ──────────
    console.log('\n📂 Caminho B — abrindo "Com débito" para pegar as devedoras...');
    let listaDevedoras = null;
    const onObter = async (res) => {
      try {
        if (res.status() !== 200 || !/clientes-segmentacao\/obter-clientes/i.test(res.url())) return;
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l; // a filtrada é a pequena
      } catch (_) {}
    };
    page.on('response', onObter);
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
    await sleep(6000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome, celular: r.celular }));
    resultado.devedoras = devs;
    console.log(`   Devedoras: ${devs.map(d => `${d.idCliente}:${d.nome}`).join(' | ') || '(não capturei)'}`);

    // 5) Abre a FICHA da 1ª devedora e tenta o FINANCEIRO (captura endpoints) ─
    if (devs.length) {
      const alvo = devs[0];
      console.log(`\n🧾 Abrindo a ficha de ${alvo.nome} (id ${alvo.idCliente}) para ver o financeiro...`);
      capturarFin = true;
      // tenta rotas conhecidas da ficha do cliente; captura o que responder
      const rotas = [
        `clientes/ficha-cliente/${alvo.idCliente}`,
        `clientes/ficha/${alvo.idCliente}`,
        `clientes/${alvo.idCliente}`,
      ];
      for (const r of rotas) {
        await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/${r}`);
        await sleep(5000);
        await fecharPopupNovaTela(page);
        // tenta clicar numa aba/menu "Financeiro"
        const foiFin = await page.evaluate(() => {
          for (const el of document.querySelectorAll('a, li, span, div, button')) {
            const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if ((t === 'financeiro' || t === 'contas a receber' || t === 'contas') && (el.offsetWidth > 0 || el.offsetHeight > 0) && el.children.length <= 1) {
              el.scrollIntoView({ block: 'center' }); el.click(); return true;
            }
          }
          return false;
        });
        if (foiFin) { console.log(`   ✓ Aba "Financeiro" clicada (rota ${r})`); await sleep(5000); }
        if (resultado.capturasFinanceiro.length) break; // já pegamos algo
      }
      if (!resultado.capturasFinanceiro.length) console.log('   ⚠️  Não capturei endpoint financeiro — veja o HTML salvo.');
      try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-ficha.html'), await page.content(), 'utf8'); } catch (_) {}
    }

  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  // ── Grava e resume ────────────────────────────────────────────────────────
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log('A) Opções de filtro encontradas por termo:');
  for (const [t, ops] of Object.entries(resultado.opcoesFiltro)) console.log(`   "${t}": ${ops.join(' | ') || '(nada)'}`);
  console.log(`\nB) Devedoras (${resultado.devedoras.length}): ${resultado.devedoras.map(d => d.nome).join(', ') || '(nenhuma)'}`);
  console.log(`\nEndpoints financeiros capturados: ${resultado.capturasFinanceiro.length}`);
  for (const c of resultado.capturasFinanceiro) {
    console.log(`\n   ${c.url}  (${c.registros != null ? c.registros + ' reg.' : 'objeto'})`);
    console.log(`     campos financeiros: ${c.chavesFinanceiras.join(', ') || '(nenhum pelo nome)'}`);
    console.log(`     todos os campos: ${c.chaves.join(', ')}`);
    if (c.exemplos && c.exemplos[0]) console.log(`     exemplo[0]: ${JSON.stringify(c.exemplos[0])}`);
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML da ficha em data/diag-ficha.html');
  console.log('   Me manda esse RESUMO que eu defino como cortar por "vencimento < hoje".\n');
}

main();

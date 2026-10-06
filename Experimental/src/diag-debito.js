/**
 * DIAGNÓSTICO v13 (não cobra nada) — pegar o LINK DE PAGAMENTO da aluna.
 *
 * Fluxo robusto (o que funciona de verdade):
 *   segmentação "Com débito" → clica no nome → drawer → "Ver perfil" (ficha
 *   completa) → aba "Financeiro" (a da FICHA, na mesma linha da aba "Cadastro",
 *   para não pegar o menu lateral) → sub-aba "Saldo devedor" → "ENVIAR COBRANÇA"
 *   (que SÓ gera o link; não cobra). Captura o link evo-totem e o endpoint.
 *
 * SEGURANÇA: nunca clica CONFIRMAR / Receber / Cobrar. Não envia WhatsApp.
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

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v13 — link de pagamento (NÃO cobra nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);

  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], subabas: [], endpointsCobranca: [], linksNoDOM: [] };
  let listaDevedoras = null, capturarCobranca = false;
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      if (/clientes-segmentacao\/obter-clientes/i.test(url)) { try { const d = JSON.parse(await res.text()); const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []); if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l; } catch (_) {} return; }
      if (!capturarCobranca) return;
      if (/intercom|instatus|signalr|google|gstatic|clarity|traducao/i.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text(); if (!txt || txt.length > 4_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const urls = urlsEmObj(data);
      const totem = (txt.match(/https?:\/\/[^"'\\\s]*(evo-totem|\/sl\/)[^"'\\\s]*/i) || [null])[0];
      if (urls.length || totem) {
        resultado.endpointsCobranca.push({ url: url.split('?')[0], urls, totem });
        console.log(`   🔗 ${url.split('?')[0]}${totem ? '  ← ' + totem : ''}`);
        urls.forEach(([k, v]) => console.log(`        ${k} = ${v}`));
      }
    } catch (_) {}
  });

  const clicarTxt = (alvos, { exato = true } = {}) => page.evaluate(({ alvos, exato }) => {
    const quer = alvos.map(s => s.toLowerCase());
    for (const el of document.querySelectorAll('a,button,[role="tab"],[role="menuitem"],span,div,li')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const ok = exato ? quer.includes(t) : quer.some(q => t.includes(q));
      if (ok && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return t; }
    }
    return null;
  }, { alvos, exato });

  // Clica um alvo que esteja NA MESMA LINHA (mesmo y) de uma âncora (p/ pegar a aba da ficha)
  const clicarMesmaLinha = (ancora, alvo) => page.evaluate(({ ancora, alvo }) => {
    const leaf = (el) => el.children.length <= 1 && (el.offsetWidth > 0 || el.offsetHeight > 0);
    let y = null;
    for (const el of document.querySelectorAll('a,div,span,li,button,[role="tab"]')) { if (leaf(el) && (el.textContent || '').trim().toLowerCase() === ancora) { y = el.getBoundingClientRect().top; break; } }
    if (y == null) return 'sem-ancora';
    for (const el of document.querySelectorAll('a,div,span,li,button,[role="tab"]')) { if (leaf(el) && (el.textContent || '').trim().toLowerCase() === alvo && Math.abs(el.getBoundingClientRect().top - y) < 28) { el.scrollIntoView({ block: 'center' }); el.click(); return 'ok'; } }
    return 'sem-alvo-na-linha';
  }, { ancora, alvo });

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
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } } document.querySelector('button[type="submit"], button.primary')?.click(); });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    console.log('✅ Login OK');

    // Com débito → devedoras → abre ficha da 1ª (Daiene)
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000); await fecharPopupNovaTela(page);
    for (let i = 0; i < 12; i++) { if (await clicarTxt(['com débito'])) break; await sleep(1500); }
    await sleep(5000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome }));
    resultado.devedoras = devs;
    if (!devs.length) throw new Error('sem devedoras');
    console.log(`🖱️  Abrindo ficha de ${devs[0].nome}...`);
    await page.evaluate((nome) => { const n = nome.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } }, devs[0].nome);
    await sleep(6000); await fecharPopupNovaTela(page);
    console.log(`   Ver perfil: ${await clicarTxt(['ver perfil', 'person ver perfil']) || 'não achei'}`);
    await sleep(8000); await fecharPopupNovaTela(page);
    console.log(`   🌐 ${page.url()}`);

    // Agora o app já tem o contexto do cliente → navega DIRETO ao Saldo devedor
    // (rota exata confirmada: .../clientes/cadastro/{id}//financeiro/saldodevedor)
    const id = devs[0].idCliente;
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/cadastro/${id}//financeiro/saldodevedor`);
    await sleep(7000); await fecharPopupNovaTela(page);
    console.log(`   🌐 Saldo devedor: ${page.url()}`);
    resultado.subabas = await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('a,button,[role="tab"],span,div,li')) { if (el.children.length > 1) continue; const t = (el.textContent || '').trim().replace(/\s+/g, ' '); if (t && t.length <= 22 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !out.includes(t)) out.push(t); } return out.slice(0, 60); }).catch(() => []);
    console.log(`   🗂️  visíveis: ${resultado.subabas.join(' | ')}`);

    // marca a linha (checkbox) se houver
    await page.evaluate(() => { const cb = document.querySelector('table input[type="checkbox"], [role="row"] input[type="checkbox"]'); if (cb && !cb.checked) cb.click(); }).catch(() => {});
    await sleep(800);

    // ENVIAR COBRANÇA — só gera o link
    capturarCobranca = true;
    console.log(`\n💳 "ENVIAR COBRANÇA" (só gera; NÃO confirma)...`);
    console.log(`   ${await clicarTxt(['enviar cobrança', 'enviar cobranca'], { exato: false }) || '⚠️  botão não achado'}`);
    await sleep(7000);

    resultado.linksNoDOM = await page.evaluate(() => {
      const out = new Set();
      const add = (s) => { if (s && /^https?:\/\//i.test(s)) out.add(s); };
      for (const a of document.querySelectorAll('a[href]')) add(a.getAttribute('href'));
      for (const el of document.querySelectorAll('input,textarea')) add(el.value);
      (document.body.innerText.match(/https?:\/\/[^\s"'<>]+/g) || []).forEach(add);
      return [...out].filter(u => /evo-totem|\/sl\/|pag|checkout|cobr/i.test(u)).slice(0, 10);
    }).catch(() => []);

    // SEGURANÇA: cancela/fecha sem confirmar
    await clicarTxt(['cancelar']).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-cobranca.html'), await page.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`🗂️  sub-abas do Financeiro: ${resultado.subabas.join(' | ')}`);
  console.log(`\n🔗 Links achados (${resultado.linksNoDOM.length}):`);
  resultado.linksNoDOM.forEach(u => console.log(`   ${u}`));
  console.log(`\n🛰️  Endpoints com URL durante ENVIAR COBRANÇA (${resultado.endpointsCobranca.length}):`);
  for (const e of resultado.endpointsCobranca) { console.log(`   ${e.url}${e.totem ? '  ← ' + e.totem : ''}`); e.urls.forEach(([k, v]) => console.log(`      ${k} = ${v}`)); }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-cobranca.html\n');
}

main();

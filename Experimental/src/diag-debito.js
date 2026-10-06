/**
 * DIAGNÓSTICO v10 (não envia nada) — abrir "Pendências" e "Ver perfil" da aluna,
 * mapear a ficha completa e capturar o CORPO das respostas financeiras (parcelas
 * em aberto + link de pagamento).
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
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|sentry|hotjar|clarity|traducao|possui-integracao|status-envio|tiposmarketing|\/passos|\/interesses|obterBasico|verificar-personal|qtde-requisicoes|total-notificacoes|listar-conexoes|obter-filtros|montar-filtro|verificar-filtro|obter-etiquetas|obter-fluxos|filiais-basico|conexoes-colaboradores|historicoPresencas|historicoTreinos|crm\/templates|listarContatosTipos|notificacaoPush/i;
const RE_FIN = /financ|receb|parcela|cobran|debito|d[eé]bito|saldo|fatura|pagamento|titulo|t[ií]tulo|venda|contrato|pendencia|pend[eê]ncia/i;

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}
function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') for (const k of ['retorno', 'data', 'lista', 'registros', 'parcelas', 'content', 'result', 'items', 'contas', 'pendencias', 'titulos']) if (Array.isArray(data[k])) return data[k];
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🔎 DIAGNÓSTICO v10 — Pendências + Ver perfil (não envia nada)');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const anexados = [];
  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], financeiro: [], clicaveisPerfil: [] };
  let listaDevedoras = null, fase = 'inicial';

  const anexar = (p) => {
    if (!p || anexados.includes(p)) return; anexados.push(p);
    p.on('response', async (res) => {
      try {
        if (res.status() !== 200) return;
        const url = res.url();
        if (/clientes-segmentacao\/obter-clientes/i.test(url)) { try { const d = JSON.parse(await res.text()); const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []); if (Array.isArray(l) && l.length && l.length <= 50) listaDevedoras = l; } catch (_) {} return; }
        if (RE_RUIDO.test(url)) return;
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        if (!ct.includes('json')) return;
        const u = url.split('?')[0];
        const txt = await res.text(); if (!txt || txt.length > 6_000_000) return;
        let data; try { data = JSON.parse(txt); } catch { return; }
        const lista = extrairLista(data);
        const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
        if (!amostra || typeof amostra !== 'object') return;
        const chaves = Object.keys(amostra);
        const urls = []; for (const r of (lista ? lista.slice(0, 15) : [amostra])) for (const par of urlsEmObj(r)) if (!urls.some(x => x[0] === par[0])) urls.push(par);
        const interessa = RE_FIN.test(u) || urls.length > 0 || chaves.some(k => /venc|valor|parcela|situac|pago|aberto|link/i.test(k));
        if (!interessa) return;
        resultado.financeiro.push({ fase, url: u, registros: lista ? lista.length : null, chaves, camposUrl: urls, amostras: (lista ? lista.slice(0, 6) : [amostra]) });
        console.log(`   ${urls.length ? '🔗' : '💰'} [${fase}] ${u} (${lista ? lista.length + ' reg.' : 'obj'})${urls.length ? ' — TEM URL' : ''}`);
      } catch (_) {}
    });
  };
  browser.on('targetcreated', async (t) => { try { if (t.type() === 'page') anexar(await t.page()); } catch (_) {} });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);
  anexar(page);

  const clicar = (p, alvos) => p.evaluate((alvos) => {
    const quer = alvos.map(s => s.toLowerCase());
    for (const el of document.querySelectorAll('a,button,[role="tab"],[role="menuitem"],span,div,li')) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      if ((quer.includes(t) || quer.some(q => aria === q || aria === 'abrir: ' + q)) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return t || aria; }
    }
    return null;
  }, alvos);

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

    // Com débito → devedoras → abre ficha da 1ª
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000); await fecharPopupNovaTela(page);
    for (let i = 0; i < 12; i++) { if (await clicar(page, ['com débito'])) break; await sleep(1500); }
    await sleep(5000);
    const devs = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome }));
    resultado.devedoras = devs;
    if (!devs.length) throw new Error('sem devedoras');
    console.log(`🖱️  Abrindo ficha de ${devs[0].nome}...`);
    await page.evaluate((nome) => { const n = nome.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } }, devs[0].nome);
    await sleep(7000); await fecharPopupNovaTela(page);

    // 1) Clica "Pendências"
    fase = 'pendencias';
    console.log(`\n🔸 Clicando "Pendências"... (${await clicar(page, ['pendências 1', 'pendências', 'pendencias']) || 'não achei'})`);
    await sleep(5000);

    // 2) Clica "Ver perfil" (abre ficha completa)
    fase = 'perfil';
    console.log(`🔸 Clicando "Ver perfil"... (${await clicar(page, ['ver perfil', 'person ver perfil']) || 'não achei'})`);
    await sleep(9000);
    const alvo = anexados[anexados.length - 1] || page;
    try { await alvo.bringToFront(); } catch (_) {}
    try { await fecharPopupNovaTela(alvo); } catch (_) {}
    console.log(`   🌐 URL agora: ${alvo.url()}`);

    // Mapeia clicáveis da ficha completa
    resultado.clicaveisPerfil = await alvo.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('a,button,[role="tab"],mat-icon,li')) {
        const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        const aria = (el.getAttribute('aria-label') || '').trim().slice(0, 34);
        const lbl = [t, aria && 'aria=' + aria].filter(Boolean).join(' | ');
        if (lbl && !out.includes(lbl)) out.push(lbl);
      }
      return out.slice(0, 90);
    }).catch(() => []);

    // 3) Na ficha completa, tenta abas financeiras
    for (const a of ['financeiro', 'contas a receber', 'cobranças', 'cobrancas', 'pagamentos', 'faturas', 'parcelas', 'contratos']) {
      fase = `perfil:${a}`;
      const ok = await clicar(alvo, [a]);
      if (ok) { console.log(`   ↳ perfil: cliquei "${a}"`); await sleep(4500); }
    }

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-ficha.html'), await alvo.content(), 'utf8'); } catch (_) {}

  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`\n🧩 Clicáveis da ficha completa:\n   ${(resultado.clicaveisPerfil || []).join('\n   ')}`);
  console.log(`\n💰 Endpoints financeiros capturados: ${resultado.financeiro.length}`);
  for (const c of resultado.financeiro) {
    console.log(`\n   ${c.camposUrl.length ? '🔗' : '💰'} [${c.fase}] ${c.url} (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
    console.log(`      campos: ${c.chaves.join(', ')}`);
    c.camposUrl.forEach(([k, v]) => console.log(`      🔗 ${k} = ${v}`));
    (c.amostras || []).slice(0, 3).forEach((e, i) => {
      const r = {};
      for (const k of Object.keys(e)) if (/venc|valor|situac|status|pago|aberto|parcela|link|url|nome|cliente|descr/i.test(k)) r[k] = e[k];
      console.log(`      amostra ${i + 1}: ${JSON.stringify(r)}`);
    });
  }
  console.log('\n✅ Detalhes em data/diag-debito.json | HTML em data/diag-ficha.html\n');
}

main();

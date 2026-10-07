/**
 * DIAGNÓSTICO (não envia/cobra/apaga nada) — achar o LINK do boleto da aluna.
 *
 * Abre a aluna pela BUSCA (não depende da segmentação "Com débito"), vai em
 * Financeiro → Boletos e clica na LUPA da linha (🔍) para abrir o boleto,
 * capturando o link/PDF/linha digitável. NUNCA clica na lixeira.
 *
 * ⚠️ Rode no VPS da unidade certa (as ids 3550/5047 são do BUENO).
 *
 * Uso: node src/diag-boleto.js
 *      node src/diag-boleto.js --nomes="Bianca de Castro,Paula Renata Camargo Braga"
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(__dirname, '..', 'data', 'diag-boleto.json');
const RE_RUIDO = /intercom|instatus|signalr|informativo|launcher_settings|\/ping|versao-aplicacao|wehelpsoftware|google|gstatic|clarity|traducao|possui-integracao|status-envio|tiposmarketing|\/passos|\/interesses|obterBasico|verificar-personal|qtde-requisicoes|total-notificacoes|listar-conexoes|obter-filtros|montar-filtro|verificar-filtro|filiais-basico|conexoes-colaboradores|historicoPresencas|historicoTreinos|crm\/templates|listarContatosTipos|notificacaoPush/i;
const RE_BOLETO = /boleto|linha.?digit|nosso.?numero|nossoNumero|codigo.?barra|codigoBarra|2.?via|segunda.?via|pdf|url|link|pix|qr/i;

const argNomes = (process.argv.find(a => a.startsWith('--nomes=')) || '').split('=')[1];
const ALVOS = (argNomes || 'Bianca de Castro,Paula Renata Camargo Braga').split(',').map(s => s.trim()).filter(Boolean);

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}
function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') for (const k of ['retorno', 'data', 'lista', 'registros', 'boletos', 'content', 'result', 'items', 'parcelas']) if (Array.isArray(data[k])) return data[k];
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🧾 DIAGNÓSTICO — link do boleto (não envia/apaga nada)');
  console.log(`   Alvos: ${ALVOS.join(' | ')}`);
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

  const resultado = { geradoEm: new Date().toISOString(), fichas: {} };
  let capturaAtual = null;
  page.on('response', async (res) => {
    try {
      if (!capturaAtual || res.status() !== 200) return;
      const url = res.url();
      if (RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text(); if (!txt || txt.length > 6_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      const urls = []; for (const r of (lista ? lista.slice(0, 10) : [amostra])) for (const par of urlsEmObj(r)) if (!urls.some(x => x[0] === par[0])) urls.push(par);
      const temBoleto = chaves.some(k => RE_BOLETO.test(k)) || urls.length > 0 || /boleto|recebimentos|financ|parcela|titulo/i.test(url);
      if (!temBoleto) return;
      const reg = resultado.fichas[capturaAtual];
      if (reg) reg.capturas.push({ url: url.split('?')[0], registros: lista ? lista.length : null, chaves, camposUrl: urls, amostras: (lista ? lista.slice(0, 6) : [amostra]) });
      console.log(`   ${urls.length ? '🔗' : '💰'} [${capturaAtual}] ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'obj'})${urls.length ? ' — TEM URL' : ''}`);
      urls.forEach(([k, v]) => console.log(`        ${k} = ${v}`));
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

    for (const nome of ALVOS) {
      console.log(`\n🧾 Aluna: ${nome}`);
      resultado.fichas[nome] = { nome, idNaUrl: null, abas: [], capturas: [] };

      // Abre a Segmentação de clientes e BUSCA pelo nome (a busca cobre toda a base).
      await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
      await sleep(6000); await fecharPopupNovaTela(page);
      try {
        const campo = await page.$('input[placeholder*="esquise" i], input[placeholder*="Pesquis" i], input[placeholder*="nome" i]');
        if (campo) { await campo.click({ clickCount: 3 }); await campo.type(nome, { delay: 55 }); }
        else console.log('   ⚠️  não achei o campo de busca.');
      } catch (_) {}
      await sleep(5000);
      // clica no resultado (nome exato → senão por primeiro+último nome)
      const partes = nome.toLowerCase().split(/\s+/);
      const clicou = await page.evaluate(({ alvo, partes }) => {
        for (const el of document.querySelectorAll('a,td,span,div')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === alvo && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        for (const el of document.querySelectorAll('a,td,span')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t.includes(partes[0]) && t.includes(partes[partes.length - 1]) && el.offsetWidth > 0) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        return false;
      }, { alvo: nome.toLowerCase(), partes });
      if (!clicou) { console.log('   ⚠️  não achei o nome na busca — confira a grafia.'); continue; }
      await sleep(5000); await fecharPopupNovaTela(page);
      await clicarTxt(['ver perfil', 'person ver perfil']);
      await sleep(7000); await fecharPopupNovaTela(page);
      resultado.fichas[nome].idNaUrl = page.url();
      console.log(`   🌐 ${page.url()}`);

      capturaAtual = nome;
      // Vai para a aba Boletos. A URL atual já tem o id do cliente — derivamos a rota.
      const m = /cadastro\/(\d+)\//.exec(page.url());
      if (m) { await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/cadastro/${m[1]}//financeiro/boletos`); await sleep(6000); await fecharPopupNovaTela(page); }
      else { await clicarTxt(['financeiro']); await sleep(3000); await clicarTxt(['boletos'], { exato: false }); await sleep(4000); }

      resultado.fichas[nome].abas = await page.evaluate(() => { const o = []; for (const el of document.querySelectorAll('a,button,[role="tab"],span,div,li')) { if (el.children.length > 1) continue; const t = (el.textContent || '').trim().replace(/\s+/g, ' '); if (t && t.length <= 24 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !o.includes(t)) o.push(t); } return o.slice(0, 50); }).catch(() => []);

      // Clica a LUPA da 1ª linha de boleto (🔍) — NUNCA a lixeira.
      const acao = await page.evaluate(() => {
        const linha = document.querySelector('table tbody tr, [role="row"]');
        const scope = linha || document.body;
        for (const el of scope.querySelectorAll('button, a, i, mat-icon, [role="button"], span')) {
          const t = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const blob = `${t} ${aria} ${title}`;
          if (/delete|excluir|lixeir|remov|trash|cancelar/.test(blob)) continue; // SEGURANÇA
          if (/search|zoom|visib|pageview|lupa|visualiz|detalh|ver\b|abrir|boleto/.test(blob) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return blob.trim().slice(0, 30) || '(icone)'; }
        }
        return null;
      });
      console.log(acao ? `   🔍 lupa/ação clicada: "${acao}"` : '   ⚠️  não achei a lupa na linha do boleto.');
      await sleep(6000);
      // lê links visíveis no modal/tela
      const linksDom = await page.evaluate(() => {
        const out = new Set();
        const add = s => { if (s && /^https?:\/\//i.test(s)) out.add(s); };
        for (const a of document.querySelectorAll('a[href]')) add(a.getAttribute('href'));
        for (const el of document.querySelectorAll('input,textarea')) add(el.value);
        (document.body.innerText.match(/https?:\/\/[^\s"'<>]+/g) || []).forEach(add);
        return [...out].slice(0, 15);
      }).catch(() => []);
      resultado.fichas[nome].linksDom = linksDom;
      if (linksDom.length) { console.log('   🔗 links na tela:'); linksDom.forEach(u => console.log('        ' + u)); }

      try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', `diag-boleto-${nome.replace(/\s+/g, '_')}.html`), await page.content(), 'utf8'); } catch (_) {}
      capturaAtual = null;
    }
  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  for (const [nome, f] of Object.entries(resultado.fichas)) {
    console.log(`\n👤 ${nome}`);
    console.log(`   abas: ${f.abas.join(' | ')}`);
    if (f.linksDom && f.linksDom.length) { console.log('   🔗 links na tela:'); f.linksDom.forEach(u => console.log('      ' + u)); }
    for (const c of (f.capturas || [])) {
      console.log(`   ${c.camposUrl.length ? '🔗' : '💰'} ${c.url} (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
      console.log(`      campos: ${c.chaves.join(', ')}`);
      c.camposUrl.forEach(([k, v]) => console.log(`      🔗 ${k} = ${v}`));
    }
    if (!(f.capturas || []).length && !(f.linksDom || []).length) console.log('   ⚠️  nada capturado (veja diag-boleto-' + nome.replace(/\s+/g, '_') + '.html).');
  }
  console.log('\n✅ Detalhes em data/diag-boleto.json\n');
}

main();

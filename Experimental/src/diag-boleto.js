/**
 * DIAGNÓSTICO (não envia/cobra nada) — achar de onde o EVO expõe o BOLETO
 * (link/PDF/linha digitável) de uma aluna com débito em boleto.
 *
 * Fluxo: segmentação "Com débito" → clica no nome da aluna-alvo → "Ver perfil"
 * → Financeiro → aba "Boletos" (e Saldo devedor). Captura TODO JSON (não-ruído)
 * e qualquer campo cujo valor seja URL. Também tenta clicar "2ª via"/boleto.
 *
 * Uso (ids separados por vírgula; padrão Bianca 3550 e Paula 5047):
 *   node src/diag-boleto.js
 *   node src/diag-boleto.js --ids=3550,5047
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

const argIds = (process.argv.find(a => a.startsWith('--ids=')) || '').split('=')[1];
const ALVOS = (argIds || '3550,5047').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);

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
  console.log('🧾 DIAGNÓSTICO — boleto da aluna (não envia nada)');
  console.log(`   Alvos (id): ${ALVOS.join(', ')}`);
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

  const resultado = { geradoEm: new Date().toISOString(), devedoras: [], fichas: {} };
  let listaDevedoras = null, capturaAtual = null;
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      if (/clientes-segmentacao\/obter-clientes/i.test(url)) { try { const d = JSON.parse(await res.text()); const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []); if (Array.isArray(l) && l.length && l.length <= 80) listaDevedoras = l; } catch (_) {} return; }
      if (!capturaAtual || RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      const txt = await res.text(); if (!txt || txt.length > 6_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      const urls = []; for (const r of (lista ? lista.slice(0, 10) : [amostra])) for (const par of urlsEmObj(r)) if (!urls.some(x => x[0] === par[0])) urls.push(par);
      const temBoleto = chaves.some(k => RE_BOLETO.test(k)) || urls.length > 0 || /boleto|recebimentos|financ|parcela/i.test(url);
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

    // Com débito → devedoras (para achar o nome pelo id)
    const abrirComDebito = async () => {
      await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
      await sleep(6000); await fecharPopupNovaTela(page);
      for (let i = 0; i < 12; i++) { if (await clicarTxt(['com débito'])) break; await sleep(1500); }
      await sleep(4000);
    };
    await abrirComDebito();
    resultado.devedoras = (listaDevedoras || []).map(r => ({ idCliente: r.idCliente, nome: r.nome, contrato: r.contrato }));
    console.log(`\n👥 "Com débito": ${resultado.devedoras.map(d => d.idCliente + ':' + d.nome).join(' | ')}`);

    for (const id of ALVOS) {
      const dev = resultado.devedoras.find(d => Number(d.idCliente) === id);
      const nome = dev ? dev.nome : null;
      console.log(`\n🧾 Alvo id ${id}${nome ? ' (' + nome + ')' : ' — NÃO está na segmentação "Com débito"'}`);
      resultado.fichas[id] = { idCliente: id, nome, capturas: [], abas: [] };
      if (!nome) { console.log('   ⏭️  pulando (não achei na lista; me diga o nome ou se está em outra segmentação).'); continue; }

      await abrirComDebito();
      // clica no nome
      const clicou = await page.evaluate((n) => { const alvo = n.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === alvo && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return true; } } return false; }, nome);
      if (!clicou) { console.log('   ⚠️  não achei o nome na tabela.'); continue; }
      await sleep(5000); await fecharPopupNovaTela(page);
      await clicarTxt(['ver perfil', 'person ver perfil']);
      await sleep(7000); await fecharPopupNovaTela(page);

      capturaAtual = String(id);
      // Navega direto às sub-rotas financeiras do cliente (contexto já carregado)
      for (const sub of ['financeiro/boletos', 'financeiro/saldodevedor']) {
        await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/cadastro/${id}//${sub}`);
        await sleep(6000); await fecharPopupNovaTela(page);
      }
      // abas visíveis + tenta ações de boleto (2ª via / imprimir / gerar) — não cobram
      resultado.fichas[id].abas = await page.evaluate(() => { const o = []; for (const el of document.querySelectorAll('a,button,[role="tab"],span,div,li')) { if (el.children.length > 1) continue; const t = (el.textContent || '').trim().replace(/\s+/g, ' '); if (t && t.length <= 24 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !o.includes(t)) o.push(t); } return o.slice(0, 50); }).catch(() => []);
      for (const alvo of ['2ª via', '2a via', 'segunda via', 'imprimir boleto', 'boleto', 'copiar linha digitável', 'linha digitável', 'ver boleto', 'gerar boleto']) {
        const ok = await clicarTxt([alvo], { exato: false });
        if (ok) { console.log(`   ↳ cliquei "${alvo}"`); await sleep(4000); }
      }
      try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', `diag-boleto-${id}.html`), await page.content(), 'utf8'); } catch (_) {}
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
  for (const [id, f] of Object.entries(resultado.fichas)) {
    console.log(`\n👤 id ${id} — ${f.nome || '(?)'}`);
    console.log(`   abas: ${f.abas.join(' | ')}`);
    if (!f.capturas.length) { console.log('   ⚠️  nada com cara de boleto/URL capturado (veja diag-boleto-' + id + '.html).'); continue; }
    for (const c of f.capturas) {
      console.log(`   ${c.camposUrl.length ? '🔗' : '💰'} ${c.url} (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
      console.log(`      campos: ${c.chaves.join(', ')}`);
      c.camposUrl.forEach(([k, v]) => console.log(`      🔗 ${k} = ${v}`));
      (c.amostras || []).slice(0, 2).forEach((e, i) => {
        const r = {};
        for (const k of Object.keys(e)) if (RE_BOLETO.test(k) || /venc|valor|status|nome/i.test(k)) r[k] = e[k];
        console.log(`      amostra ${i + 1}: ${JSON.stringify(r)}`);
      });
    }
  }
  console.log('\n✅ Detalhes em data/diag-boleto.json');
  console.log('   Me manda o RESUMO: com o link/PDF do boleto eu monto as mensagens de boleto.\n');
}

main();

/**
 * DIAGNÓSTICO (não envia/cobra/apaga nada) — mapear a tela GLOBAL de boletos
 * (Financeiro → Boletos → Integração Bancária), que lista TODOS os boletos de
 * todas as alunas. É daqui que o robô vai tirar quem está vencido / vence hoje.
 *
 * Rota informada pela unidade:
 *   #/app/slimfit/15/evo3/-Financeiro-Boletos-IntegracaoBancaria
 *
 * Captura: respostas JSON da API (lista de boletos + campos: nome, vencimento,
 * valor, status, link/linha digitável), estrutura da tabela (cabeçalhos + 1ªs
 * linhas), filtros (inputs/selects) e a ação de 2ª via/lupa de uma linha.
 * NUNCA clica em excluir/lixeira/cancelar.
 *
 * ⚠️ Rode no VPS da unidade certa (BUENO).
 * Uso: node src/diag-boleto.js
 *      node src/diag-boleto.js --rota="app/slimfit/15/evo3/-Financeiro-Boletos-IntegracaoBancaria"
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

const argRota = (process.argv.find(a => a.startsWith('--rota=')) || '').split('=')[1];
const ROTA = argRota || 'app/slimfit/15/evo3/-Financeiro-Boletos-IntegracaoBancaria';

function urlsEmObj(obj, prefixo = '', prof = 0) {
  const out = [];
  if (!obj || typeof obj !== 'object' || prof > 5) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) out.push([prefixo + k, v]);
    else if (v && typeof v === 'object') out.push(...urlsEmObj(v, prefixo + k + '.', prof + 1));
  }
  return out;
}
function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['retorno', 'data', 'lista', 'registros', 'boletos', 'content', 'result', 'items', 'parcelas', 'rows']) if (Array.isArray(data[k])) return data[k];
    // às vezes vem {data:{content:[...]}}
    for (const v of Object.values(data)) { const l = (v && typeof v === 'object') ? extrairLista(v) : null; if (l) return l; }
  }
  return null;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🧾 DIAGNÓSTICO — tela GLOBAL de boletos (não envia/apaga nada)');
  console.log(`   Rota: #/${ROTA}`);
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

  const resultado = { geradoEm: new Date().toISOString(), rota: ROTA, urlFinal: null, capturas: [], pdfs: [] };
  let gravando = false;
  page.on('response', async (res) => {
    try {
      if (!gravando || res.status() !== 200) return;
      const url = res.url();
      if (RE_RUIDO.test(url)) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      // PDFs / downloads de boleto
      if (ct.includes('pdf') || /\.pdf(\?|$)/i.test(url)) { resultado.pdfs.push(url.split('?')[0]); console.log(`   📄 PDF: ${url.split('?')[0]}`); return; }
      if (!ct.includes('json')) return;
      const txt = await res.text(); if (!txt || txt.length > 8_000_000) return;
      let data; try { data = JSON.parse(txt); } catch { return; }
      const lista = extrairLista(data);
      const amostra = (lista && lista.length) ? lista[0] : (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
      if (!amostra || typeof amostra !== 'object') return;
      const chaves = Object.keys(amostra);
      // só interessa se parece boleto/financeiro (pela url ou pelos campos)
      const ehFin = /boleto|financ|receb|parcela|titulo|cobranca|integracao|banc/i.test(url) ||
        chaves.some(k => /boleto|venc|valor|nome|cliente|aluno|nosso|digit|barra|linha|pdf|url|link|status|situac/i.test(k));
      if (!ehFin) return;
      const urls = []; for (const r of (lista ? lista.slice(0, 15) : [amostra])) for (const par of urlsEmObj(r)) if (!urls.some(x => x[0] === par[0])) urls.push(par);
      resultado.capturas.push({ url: url.split('?')[0], registros: lista ? lista.length : null, chaves, camposUrl: urls, amostras: (lista ? lista.slice(0, 4) : [amostra]) });
      console.log(`   ${urls.length ? '🔗' : '📦'} ${url.split('?')[0]} (${lista ? lista.length + ' reg.' : 'obj'})`);
      console.log(`        campos: ${chaves.join(', ')}`);
      urls.forEach(([k, v]) => console.log(`        🔗 ${k} = ${v}`));
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
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } } document.querySelector('button[type="submit"], button.primary')?.click(); });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    console.log('✅ Login OK\n');

    // Vai para a tela global de boletos
    gravando = true;
    console.log('🧭 Abrindo a tela de boletos (Integração Bancária)...');
    await page.evaluate((h) => { location.hash = '#/' + h; }, ROTA);
    await sleep(9000); await fecharPopupNovaTela(page);
    resultado.urlFinal = page.url();
    console.log(`   🌐 ${page.url()}`);
    if (!/boleto|integracao|financ/i.test(page.url())) console.log('   ⚠️  a URL não parece a de boletos — pode ter redirecionado (host/permissão?).');

    // Dump da estrutura: filtros (inputs/selects), cabeçalhos e 1ªs linhas da tabela.
    const estrutura = await page.evaluate(() => {
      const inputs = [];
      for (const el of document.querySelectorAll('input,select,textarea')) {
        if (el.type === 'hidden' || !(el.offsetWidth > 0 || el.offsetHeight > 0)) continue;
        inputs.push({ tag: el.tagName.toLowerCase(), ph: el.placeholder || '', name: el.name || '', id: el.id || '', aria: el.getAttribute('aria-label') || '' });
      }
      const cabecalhos = [...document.querySelectorAll('table thead th, [role="columnheader"]')].map(th => (th.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 25);
      const linhas = [];
      for (const tr of document.querySelectorAll('table tbody tr, [role="row"]')) {
        const t = (tr.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && !linhas.includes(t)) linhas.push(t.slice(0, 200));
        if (linhas.length >= 12) break;
      }
      // botões/ações visíveis (pra achar a 2ª via / lupa)
      const acoes = [];
      for (const el of document.querySelectorAll('button,a,[role="button"],i,mat-icon')) {
        const blob = `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim().replace(/\s+/g, ' ');
        if (blob && blob.length <= 40 && (el.offsetWidth > 0 || el.offsetHeight > 0) && !acoes.includes(blob)) acoes.push(blob);
        if (acoes.length >= 40) break;
      }
      return { inputs: inputs.slice(0, 25), cabecalhos, linhas, acoes };
    }).catch(() => ({ inputs: [], cabecalhos: [], linhas: [], acoes: [] }));
    resultado.estrutura = estrutura;

    console.log('\n   🔎 filtros/inputs na tela:');
    estrutura.inputs.forEach((i, n) => console.log(`      [${n}] <${i.tag}> ph="${i.ph}" name="${i.name}" id="${i.id}" aria="${i.aria}"`));
    console.log('\n   🧱 cabeçalhos da tabela:');
    console.log('      ' + (estrutura.cabecalhos.join(' | ') || '(nenhum — veja o HTML salvo)'));
    console.log('\n   📄 primeiras linhas:');
    estrutura.linhas.slice(0, 8).forEach(l => console.log(`      • ${l}`));
    console.log('\n   🔘 ações/botões visíveis:');
    console.log('      ' + (estrutura.acoes.join(' | ') || '(nenhum)'));

    // Clica o botão de BUSCA/filtro (lupa azul no topo) para carregar a lista.
    // NUNCA é "excluir"/"cancelar". Procura no topo da tela (fora de linhas da tabela).
    const buscou = await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        if (el.closest('table tbody')) continue; // ignora ações de linha
        const blob = `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`.toLowerCase();
        if (/excluir|lixeir|remov|cancelar|export|email|e-mail|imprimir/.test(blob)) continue;
        const rect = el.getBoundingClientRect();
        if (/pesquis|buscar|consultar|filtrar|search|lupa|magnif/.test(blob) && rect.top < 320 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return blob.trim().slice(0, 30) || '(botão)'; }
      }
      // fallback: botão azul/primário no topo
      for (const el of document.querySelectorAll('button')) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 320 && rect.top > 120 && (el.offsetWidth > 0) && /btn-primary|primary|azul|search/i.test(el.className || '')) { el.click(); return '(primário topo)'; }
      }
      return null;
    });
    console.log(buscou ? `   🔎 botão de busca clicado: "${buscou}"` : '   ⚠️  não achei o botão de busca (a lista pode já ter carregado).');
    await sleep(7000);
    const linhasApos = await page.evaluate(() => { const o = []; for (const tr of document.querySelectorAll('table tbody tr, [role="row"]')) { const t = (tr.textContent || '').trim().replace(/\s+/g, ' '); if (t && !o.includes(t)) o.push(t.slice(0, 200)); if (o.length >= 12) break; } return o; }).catch(() => []);
    resultado.estrutura.linhasApos = linhasApos;
    console.log('   📄 linhas após a busca:');
    linhasApos.slice(0, 8).forEach(l => console.log(`      • ${l}`));

    // Tenta clicar a 2ª via / lupa da 1ª linha (NUNCA excluir/lixeira).
    const acao = await page.evaluate(() => {
      const linha = document.querySelector('table tbody tr, [role="row"]');
      const scope = linha || document.body;
      for (const el of scope.querySelectorAll('button, a, i, mat-icon, [role="button"], span')) {
        const blob = `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase();
        if (/delete|excluir|lixeir|remov|trash|cancelar|estornar|baixar.?manual/.test(blob)) continue; // SEGURANÇA
        if (/2.?via|segunda.?via|boleto|visualiz|detalh|imprimir|pdf|lupa|search|download|baixar/.test(blob) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return blob.trim().slice(0, 30) || '(icone)'; }
      }
      return null;
    });
    console.log(acao ? `\n   🔍 ação de boleto clicada: "${acao}"` : '\n   ⚠️  não achei uma ação de 2ª via/boleto na linha.');
    await sleep(7000);

    const linksDom = await page.evaluate(() => {
      const out = new Set();
      const add = s => { if (s && /^https?:\/\//i.test(s)) out.add(s); };
      for (const a of document.querySelectorAll('a[href]')) add(a.getAttribute('href'));
      for (const el of document.querySelectorAll('input,textarea')) add(el.value);
      (document.body.innerText.match(/https?:\/\/[^\s"'<>]+/g) || []).forEach(add);
      return [...out].slice(0, 20);
    }).catch(() => []);
    resultado.linksDom = linksDom;
    if (linksDom.length) { console.log('   🔗 links na tela:'); linksDom.forEach(u => console.log('        ' + u)); }

    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'diag-boleto.html'), await page.content(), 'utf8'); } catch (_) {}
  } catch (e) {
    console.error('❌ Erro:', e && e.message);
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(OUT, JSON.stringify(resultado, null, 2), 'utf8'); } catch (_) {}

  console.log('\n────────────────────────── RESUMO ──────────────────────────');
  console.log(`URL final: ${resultado.urlFinal}`);
  console.log(`Capturas de API: ${resultado.capturas.length} | PDFs: ${resultado.pdfs.length}`);
  for (const c of resultado.capturas) {
    console.log(`\n${c.camposUrl.length ? '🔗' : '📦'} ${c.url} (${c.registros != null ? c.registros + ' reg.' : 'obj'})`);
    console.log(`   campos: ${c.chaves.join(', ')}`);
    c.camposUrl.forEach(([k, v]) => console.log(`   🔗 ${k} = ${v}`));
    if (c.amostras && c.amostras[0]) console.log(`   📋 amostra: ${JSON.stringify(c.amostras[0]).slice(0, 600)}`);
  }
  if (resultado.pdfs.length) { console.log('\n📄 PDFs:'); resultado.pdfs.forEach(u => console.log('   ' + u)); }
  if (resultado.linksDom && resultado.linksDom.length) { console.log('\n🔗 links na tela:'); resultado.linksDom.forEach(u => console.log('   ' + u)); }
  if (!resultado.capturas.length && !resultado.pdfs.length) console.log('\n⚠️  nada capturado — veja data/diag-boleto.html (a tela pode estar noutro host/permissão).');
  console.log('\n✅ Detalhes em data/diag-boleto.json\n');
}

main();

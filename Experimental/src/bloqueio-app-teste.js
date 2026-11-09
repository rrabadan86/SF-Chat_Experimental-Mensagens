/**
 * Teste MANUAL do Bloqueio do app numa ficha específica (sem mexer na lista do
 * robô nem mandar mensagem para a aluna).
 *
 *   node src/bloqueio-app-teste.js <idCliente> ver      → só mostra o quadro "Área do aluno"
 *   node src/bloqueio-app-teste.js <idCliente> excluir  → clica em EXCLUIR (apaga o login do app)
 *   node src/bloqueio-app-teste.js <idCliente> criar    → CRIAR ACESSO + CONFIRMAR (senha padrão)
 *
 * Usa o mesmo login do EVO do robô (.env). Rode fora do horário da cobrança.
 */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');
const ba = require('./bloqueio-app');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function nomeDaApi(id) {
  try {
    const evo = require('./pagamento/evo-api');
    if (!evo.configurado()) return '';
    const m = await evo.chamar(`/api/v2/members/${id}`);
    const o = Array.isArray(m) ? m[0] : m;
    return o ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : '';
  } catch (e) { return ''; }
}

(async () => {
  const id = String(process.argv[2] || '').trim();
  const acao = String(process.argv[3] || 'ver').toLowerCase();
  if (!/^\d+$/.test(id) || !['ver', 'excluir', 'criar'].includes(acao)) {
    console.log('Uso: node src/bloqueio-app-teste.js <idCliente> ver|excluir|criar');
    process.exit(1);
  }
  const nome = await nomeDaApi(id);
  console.log(`👤 Ficha ${id}${nome ? ` — ${nome}` : ' (não consegui o nome pela API; vou só mostrar a ficha)'}`);

  const browser = await puppeteer.launch({
    headless: 'new', executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'], defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);
  const irPara = async (rota, ms = 6000) => { await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/${rota}`); await sleep(ms); await fecharPopupNovaTela(page); };
  try {
    console.log('🔐 Login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(4000);
    await require('./evo-login').esperarFormLogin(page);
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } } document.querySelector('button[type="submit"], button.primary')?.click(); });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    console.log('✅ Login OK');

    const ctx = { page, irPara };
    const f = await ba._abrirFicha(ctx, id, nome || 'x');
    console.log(`📄 Ficha abriu: ${f.fichaOk ? 'sim' : 'NÃO'} · nome confere: ${nome ? (f.nomeOk ? 'sim' : 'NÃO') : '(sem nome para conferir)'} · quadro "Área do aluno": ${f.quadro ? 'achei' : 'NÃO achei'}`);
    console.log(`   Situação: ${f.temAcesso ? 'TEM acesso ao app (login + botão Excluir)' : f.semAcesso ? 'SEM acesso ao app (botão Criar acesso)' : 'não identificada'}${f.texto ? `\n   Texto do quadro: "${f.texto}"` : ''}`);
    if (!f.fichaOk || !f.quadro) throw new Error('não abri a ficha / não achei o quadro — nada foi feito');
    if (nome && !f.nomeOk) throw new Error('o nome na ficha não confere com o da API — nada foi feito');

    if (acao === 'excluir') {
      if (!f.temAcesso) { console.log('ℹ️  Já está sem acesso — nada a excluir.'); }
      else { const r = await ba._excluirAcesso(ctx); console.log(r.ok ? '📵 Login do app EXCLUÍDO.' : `❌ ${r.motivo}`); }
    } else if (acao === 'criar') {
      if (f.temAcesso) { console.log('ℹ️  Já tem acesso — nada a criar.'); }
      else { const r = await ba._criarAcesso(ctx); console.log(r.ok ? '✅ Acesso ao app CRIADO (senha padrão: 3 letras do nome + nascimento ddmmaaaa).' : `❌ ${r.motivo}`); }
    }
  } catch (e) {
    console.log('❌ ' + (e && e.message));
  } finally {
    try { await browser.close(); } catch (_) {}
    process.exit(0);
  }
})();

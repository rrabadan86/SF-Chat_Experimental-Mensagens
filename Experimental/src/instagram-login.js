/**
 * Login do Instagram no VPS (Linux/headless), INTERATIVO.
 *
 * Abre o Chromium com o perfil dedicado (instagram-chrome-data), faz login com
 * IG_USERNAME / IG_PASSWORD do .env e, se o Instagram pedir um código de
 * verificação, PERGUNTA o código aqui no terminal (na mesma sessão) e continua.
 * Tira prints (instagram-login-*.png) para acompanhar via `scp`.
 *
 * Uso:  xvfb-run -a node src/instagram-login.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const readline = require('readline');
const { launchInstagramChromium, sleep } = require('./instagram-seguidores');

const IG_USERNAME = process.env.IG_USERNAME || '';
const IG_PASSWORD = process.env.IG_PASSWORD || '';
const SHOT_DIR = path.resolve(__dirname, '..');

const SEL_USER = 'input[name="username"], input[name="email"]';
const SEL_PASS = 'input[name="password"], input[name="pass"]';
const SEL_CODE = 'input[name="verificationCode"], input[name="security_code"], ' +
  'input[autocomplete="one-time-code"], input[aria-label*="código" i], ' +
  'input[aria-label*="code" i], input[name="confirmationCode"]';

function shot(page, nome) {
  return page.screenshot({ path: path.join(SHOT_DIR, nome) }).catch(() => {});
}

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(texto, ans => { rl.close(); res(ans.trim()); }));
}

async function clicarPorTexto(page, textos) {
  return page.evaluate((alvos) => {
    const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const els = Array.from(document.querySelectorAll('button, div[role="button"], a, span'));
    for (const el of els) {
      if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
      const t = norm(el.textContent);
      if (alvos.some(a => t === a || t.includes(a))) {
        (el.closest('button, [role="button"], a') || el).click();
        return true;
      }
    }
    return false;
  }, textos);
}

async function estaLogado(page) {
  return page.evaluate(() => {
    if (location.href.includes('/accounts/login')) return false;
    if (document.querySelector('input[name="username"], input[name="email"], input[name="pass"]')) return false;
    const temNav = document.querySelector('svg[aria-label="Página inicial"], svg[aria-label="Home"], a[href="/"] svg');
    const body = (document.body.innerText || '').toLowerCase();
    const pedeLogin = body.includes('entrar com o facebook') || body.includes('log in with facebook');
    return !!temNav && !pedeLogin;
  });
}

async function temCampoCodigo(page) {
  return page.$(SEL_CODE).then(Boolean);
}

(async () => {
  if (!IG_USERNAME || !IG_PASSWORD) {
    console.log('❌ Defina IG_USERNAME e IG_PASSWORD no .env antes de rodar.');
    process.exit(1);
  }

  console.log(`\n🔐 Login do Instagram como @${IG_USERNAME}...\n`);
  const browser = await launchInstagramChromium();
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  // User-Agent real (o Chromium pré-instalado às vezes reporta "HeadlessChrome",
  // que a Meta bloqueia com 429). Força um UA de Chrome desktop normal.
  const UA_REAL = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  await page.setUserAgent(UA_REAL);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' });

  try {
    // Diagnóstico do navegador (offline): mostra o UA real e webdriver.
    try {
      await page.goto('about:blank');
      const nav = await page.evaluate(() => ({ ua: navigator.userAgent, wd: navigator.webdriver }));
      console.log('   🧭 UA do navegador:', nav.ua);
      console.log('   🧭 navigator.webdriver:', nav.wd);
    } catch (_) { /* segue */ }

    // 1) Já logado?
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    if (await estaLogado(page)) {
      console.log('✅ Já está logado no Instagram! Nada a fazer.');
      return;
    }

    // 2) Tela de login
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    await clicarPorTexto(page, ['permitir todos os cookies', 'allow all cookies', 'aceitar', 'accept']);
    await sleep(2000);

    // Diagnóstico: mostra em que página caímos (sem depender de print).
    const diag = await page.evaluate(() => ({
      temUser: !!document.querySelector('input[name="username"], input[name="email"]'),
      inputs: Array.from(document.querySelectorAll('input')).map(i => i.name || i.getAttribute('aria-label') || i.type).slice(0, 12),
      corpo: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }));
    console.log('   🔎 URL:', page.url());
    console.log('   🔎 Campo usuário?', diag.temUser, '| inputs:', JSON.stringify(diag.inputs));
    console.log('   🔎 Texto da página:', diag.corpo);

    // 3) Preenche e envia credenciais
    await page.waitForSelector(SEL_USER, { timeout: 40000 });
    await page.type(SEL_USER, IG_USERNAME, { delay: 60 });
    await page.type(SEL_PASS, IG_PASSWORD, { delay: 60 });
    await clicarPorTexto(page, ['entrar', 'log in', 'iniciar sesion']);
    await page.keyboard.press('Enter').catch(() => {});
    console.log('⏳ Enviando credenciais...');

    // 4) Aguarda o resultado: logado, pedido de código, ou botão de challenge.
    let precisaCodigo = false;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if (await estaLogado(page)) break;
      // botões intermediários do desafio (ex.: "Enviar código", "Foi você")
      await clicarPorTexto(page, ['enviar codigo', 'send code', 'foi voce', 'this was me', 'continuar', 'continue']);
      if (await temCampoCodigo(page)) { precisaCodigo = true; break; }
    }
    await shot(page, 'instagram-login-3-pos-login.png');

    // 5) Se pediu código, pergunta AQUI no terminal e envia (mesma sessão)
    if (precisaCodigo && !(await estaLogado(page))) {
      console.log('\n📩 O Instagram enviou um CÓDIGO de verificação (e-mail/telefone/app).');
      const codigo = await perguntar('   👉 Digite o código e tecle Enter: ');
      if (codigo) {
        await page.click(SEL_CODE).catch(() => {});
        await page.type(SEL_CODE, codigo, { delay: 100 });
        await clicarPorTexto(page, ['confirmar', 'confirm', 'continuar', 'continue', 'enviar', 'submit', 'avancar', 'next']);
        await page.keyboard.press('Enter').catch(() => {});
        console.log('⏳ Validando código...');
        for (let i = 0; i < 15; i++) { await sleep(2000); if (await estaLogado(page)) break; }
      }
      await shot(page, 'instagram-login-4-pos-codigo.png');
    }

    // 6) Diálogos finais ("Salvar informações", "Ativar notificações")
    for (let i = 0; i < 3; i++) { await clicarPorTexto(page, ['agora nao', 'not now', 'ahora no']); await sleep(2000); }
    await shot(page, 'instagram-login-5-final.png');

    // 7) Resultado
    if (await estaLogado(page)) {
      console.log('\n✅ LOGIN OK! Sessão do Instagram salva no perfil do VPS.');
    } else {
      const url = page.url();
      console.log('\n⚠️  Ainda não logado. Veja os prints instagram-login-*.png.');
      console.log(`   URL atual: ${url}`);
    }
  } catch (e) {
    console.error('\n❌ Erro no login:', e.message);
    try {
      console.error('   URL:', page.url());
      const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500));
      console.error('   Texto da página:', t);
    } catch (_) { /* página pode estar inacessível */ }
    await shot(page, 'instagram-login-ERRO.png');
  } finally {
    await browser.disconnect();
  }
})();

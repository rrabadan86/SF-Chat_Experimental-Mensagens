/**
 * Login do Instagram no VPS (Linux/headless).
 *
 * Abre o Chromium com o perfil dedicado do Instagram (instagram-chrome-data),
 * verifica se já está logado e, se não estiver, faz login com IG_USERNAME /
 * IG_PASSWORD do .env. Tira prints em cada etapa (instagram-login*.png) para
 * você acompanhar via `scp`, e trata os diálogos "Salvar informações" e
 * "Ativar notificações".
 *
 * Uso:
 *   xvfb-run -a node src/instagram-login.js
 *   # se o IG pedir um código de verificação (2FA/challenge):
 *   xvfb-run -a node src/instagram-login.js --code=123456
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const { launchInstagramChromium, sleep } = require('./instagram-seguidores');

const IG_USERNAME = process.env.IG_USERNAME || '';
const IG_PASSWORD = process.env.IG_PASSWORD || '';
const CODE = (process.argv.find(a => a.startsWith('--code=')) || '').split('=')[1] || '';
const SHOT_DIR = path.resolve(__dirname, '..');

function shot(page, nome) {
  return page.screenshot({ path: path.join(SHOT_DIR, nome) }).catch(() => {});
}

// Clica num botão/elemento visível cujo texto casa (sem acento, minúsculo).
async function clicarPorTexto(page, textos) {
  return page.evaluate((alvos) => {
    const norm = (s) => (s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
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
    if (document.querySelector('input[name="username"]')) return false;
    // Ícones/elementos que só aparecem logado
    const temNav = document.querySelector('svg[aria-label="Página inicial"], svg[aria-label="Home"], a[href="/"] svg');
    const body = (document.body.innerText || '').toLowerCase();
    const pedeLogin = body.includes('entrar com o facebook') || body.includes('log in with facebook');
    return !!temNav && !pedeLogin;
  });
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

  try {
    // 1) Já logado?
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    await shot(page, 'instagram-login-1-inicio.png');

    if (await estaLogado(page)) {
      console.log('✅ Já está logado no Instagram! Nada a fazer.');
      await shot(page, 'instagram-login-OK.png');
      return;
    }

    // 2) Vai para a tela de login
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    // Aceita cookies se aparecer
    await clicarPorTexto(page, ['permitir todos os cookies', 'allow all cookies', 'permitir todos']);
    await sleep(1500);

    // Se pediram um código de verificação (2FA/challenge) numa execução anterior:
    if (CODE) {
      const campoCodigo = await page.$('input[name="verificationCode"], input[name="security_code"], input[autocomplete="one-time-code"]');
      if (campoCodigo) {
        console.log('🔢 Enviando código de verificação...');
        await campoCodigo.type(CODE, { delay: 100 });
        await clicarPorTexto(page, ['confirmar', 'confirm', 'continuar', 'continue', 'enviar', 'submit']);
        await sleep(8000);
        await shot(page, 'instagram-login-4-pos-codigo.png');
      } else {
        console.log('⚠️  --code informado, mas não achei o campo de código nesta tela.');
      }
    } else {
      // 3) Preenche usuário e senha
      await page.waitForSelector('input[name="username"]', { timeout: 30000 });
      await page.type('input[name="username"]', IG_USERNAME, { delay: 60 });
      await page.type('input[name="password"]', IG_PASSWORD, { delay: 60 });
      await shot(page, 'instagram-login-2-preenchido.png');

      await clicarPorTexto(page, ['entrar', 'log in', 'iniciar sesion']);
      // fallback: submit
      await page.keyboard.press('Enter').catch(() => {});
      console.log('⏳ Enviando credenciais...');
      await sleep(9000);
      await shot(page, 'instagram-login-3-pos-login.png');
    }

    // 4) Diálogos pós-login: "Salvar informações", "Ativar notificações"
    for (let i = 0; i < 3; i++) {
      await clicarPorTexto(page, ['agora nao', 'not now', 'ahora no']);
      await sleep(2000);
    }
    await sleep(3000);
    await shot(page, 'instagram-login-5-final.png');

    // 5) Diagnóstico final
    const url = page.url();
    const logado = await estaLogado(page);
    const precisaCodigo = await page.evaluate(() =>
      !!document.querySelector('input[name="verificationCode"], input[name="security_code"], input[autocomplete="one-time-code"]') ||
      /challenge|two_factor|codeentry|auth_platform/i.test(location.href)
    );

    if (logado) {
      console.log('\n✅ LOGIN OK! Sessão do Instagram salva no perfil do VPS.');
    } else if (precisaCodigo) {
      console.log('\n📩 O Instagram pediu um CÓDIGO de verificação (enviado ao seu e-mail/telefone).');
      console.log('   Pegue o código e rode:  xvfb-run -a node src/instagram-login.js --code=SEUCODIGO');
    } else {
      console.log('\n⚠️  Ainda não logado. Veja os prints instagram-login-*.png para entender.');
      console.log(`   URL atual: ${url}`);
    }
  } catch (e) {
    console.error('\n❌ Erro no login:', e.message);
    await shot(page, 'instagram-login-ERRO.png');
  } finally {
    await browser.disconnect();
  }
})();

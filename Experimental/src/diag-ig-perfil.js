/**
 * Diagnóstico: abre um perfil do Instagram (com a sessão dos cookies) e LISTA os
 * botões/links visíveis + tira um screenshot. Serve para descobrir como está o
 * botão "Mensagem" hoje (o Instagram muda essa tela com frequência).
 *
 * Uso:  xvfb-run -a node src/diag-ig-perfil.js --user=algum_perfil
 *   ou:  HEADLESS=true node src/diag-ig-perfil.js --user=algum_perfil
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const {
  launchInstagramChromium,
  aplicarCookiesSalvos,
  sleep,
} = require('./instagram-seguidores');

(async () => {
  const alvo = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1]
    || process.argv[2];
  if (!alvo) { console.log('Informe: --user=perfil'); process.exit(1); }

  const browser = await launchInstagramChromium();
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await aplicarCookiesSalvos(page);
    console.log(`🌐 Abrindo @${alvo}...`);
    await page.goto(`https://www.instagram.com/${alvo}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    const info = await page.evaluate(() => {
      const vis = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
      const out = [];
      for (const el of document.querySelectorAll('div[role="button"], button, a[role="link"], a, [role="button"]')) {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        const al = el.getAttribute('aria-label') || '';
        if (!vis(el)) continue;
        if (!t && !al) continue;
        if (t.length > 40) continue;
        out.push({ tag: el.tagName, text: t, aria: al });
      }
      const seen = new Set(); const u = [];
      for (const o of out) { const k = o.tag + '|' + o.text + '|' + o.aria; if (!seen.has(k)) { seen.add(k); u.push(o); } }
      const body = (document.body.innerText || '').toLowerCase();
      return {
        url: location.href,
        titulo: document.title,
        pediuLogin: location.href.includes('/accounts/login') || !!document.querySelector('input[name="username"]'),
        temMensagemNoTexto: body.includes('mensagem') || body.includes('message'),
        botoes: u.slice(0, 80),
      };
    });

    console.log('\n===== RESULTADO =====');
    console.log('URL   :', info.url);
    console.log('Título:', info.titulo);
    console.log('Pediu login/checkpoint?', info.pediuLogin);
    console.log('Botões/links visíveis:');
    info.botoes.forEach(b => console.log(`  [${b.tag}] text="${b.text}"  aria="${b.aria}"`));

    const shot = path.resolve(__dirname, '..', 'debug-ig-perfil.png');
    try { await page.screenshot({ path: shot }); console.log('\n📸 Screenshot salvo em:', shot); } catch (_) {}
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
})().catch(e => { console.error('❌ erro:', e.message); process.exit(1); });

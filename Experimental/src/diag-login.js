/**
 * Diagnóstico de sessão do EVO.
 * Mostra exatamente onde/como a autenticação é perdida entre o login e a
 * navegação para a página de aulas experimentais.
 *
 * Uso:  node src/diag-login.js
 */
const config = require('./config');
const EvoScraper = require('./evo-scraper');

async function snapshot(page, rotulo) {
  const info = await page.evaluate(() => {
    const txt = document.body ? (document.body.innerText || '') : '';
    const temSenha = !!document.querySelector('input[type="password"]');
    const telaLogin = temSenha || /Que bom ter voc|Esqueci a senha/i.test(txt);
    // Chaves de storage (sem expor valores dos tokens)
    const ls = [];
    try { for (let i = 0; i < localStorage.length; i++) ls.push(localStorage.key(i)); } catch (_) {}
    const ss = [];
    try { for (let i = 0; i < sessionStorage.length; i++) ss.push(sessionStorage.key(i)); } catch (_) {}
    return {
      url: location.href,
      hash: location.hash,
      telaLogin,
      localStorageKeys: ls,
      sessionStorageKeys: ss,
    };
  });
  const cookies = await page.cookies();
  console.log(`\n──────── ${rotulo} ────────`);
  console.log('URL     :', info.url);
  console.log('hash    :', info.hash);
  console.log('É login?:', info.telaLogin ? '❌ SIM (caiu no login)' : '✅ não');
  console.log('cookies :', cookies.map(c => c.name).join(', ') || '(nenhum)');
  console.log('localStorage keys :', info.localStorageKeys.join(', ') || '(vazio)');
  console.log('sessionStorage keys:', info.sessionStorageKeys.join(', ') || '(vazio)');
}

(async () => {
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();
    await snapshot(scraper.page, 'DEPOIS DO LOGIN');

    // Repete a MESMA navegação que o fluxo real faz
    const url = `${config.evo.url}/${config.evo.experimentalPath}`;
    console.log(`\n➡️  Navegando (page.goto) para: ${url}`);
    await scraper.page.goto(url, { waitUntil: 'networkidle2' });
    await scraper.sleep(4000);
    await snapshot(scraper.page, 'DEPOIS DE IR PARA EXPERIMENTAIS');

    await scraper.page.screenshot({ path: 'debug-diag-experimentais.png' });
    console.log('\n📸 Screenshot: debug-diag-experimentais.png');
  } catch (e) {
    console.error('❌ Erro no diagnóstico:', e.message);
  } finally {
    await scraper.close();
  }
})();

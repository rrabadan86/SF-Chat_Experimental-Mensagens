/**
 * evo-login.js — espera a tela de login do EVO ficar pronta.
 *
 * Os jobs que abrem um navegador próprio (cobrança, renovação, aniversários,
 * ausentes…) esperavam o campo de usuário por só 15–20 s, sem recarregar. Quando
 * o EVO demora (Angular lento, Cloudflare checando), o job morria com
 * "Waiting for selector `input#usuario, …` failed" e nada era enviado. Aqui
 * esperamos até 30 s, recarregamos a página até 3 vezes e, se ainda assim não
 * aparecer, registramos no log o que está na tela antes de desistir.
 */
const SELETOR = 'input#usuario, input[type="email"], input[type="text"]';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function campoVisivel(page) {
  try {
    return await page.evaluate((sel) => [...document.querySelectorAll(sel)].some(el => el.offsetWidth > 0 && el.offsetHeight > 0), SELETOR);
  } catch (_) { return false; } // "Execution context was destroyed": o EVO ainda está redirecionando
}

async function esperarFormLogin(page, { tentativas = 3, esperaMs = 30000 } = {}) {
  for (let t = 1; t <= tentativas; t++) {
    const ate = Date.now() + esperaMs;
    while (Date.now() < ate) {
      if (await campoVisivel(page)) return SELETOR;
      await sleep(1000);
    }
    if (t < tentativas) {
      console.log(`   ⏳ Tela de login do EVO não carregou, recarregando (${t}/${tentativas - 1})...`);
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (_) {}
      await sleep(4000);
    }
  }
  // Diagnóstico: onde estamos e o que aparece (sem campos de formulário).
  try {
    const info = await page.evaluate(() => ({ url: location.href, titulo: document.title, texto: (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
    console.log(`   🔎 Tela do EVO sem o login: ${info.url} | "${info.titulo}" | ${info.texto || '(página vazia)'}`);
  } catch (_) {}
  throw new Error(`Waiting for selector \`${SELETOR}\` failed (tela de login do EVO não carregou em ${tentativas} tentativas)`);
}

module.exports = { esperarFormLogin, SELETOR };

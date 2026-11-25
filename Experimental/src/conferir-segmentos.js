/**
 * conferir-segmentos.js — confere no EVO se a loja tem os 3 segmentos que o robô usa (NOV-03).
 * SÓ LÊ: entra no EVO, abre Clientes → Segmentação e lista os nomes. Não cria nem muda nada.
 * Respeita a trava de login (EVO-01): senha recusada antes → nem tenta.
 *
 * Os nomes conferidos são os mesmos que os jobs procuram:
 *   • "Vencimento de contrato seman…" (renovar-contratos.js / renovacoes-mes-grupo.js)
 *   • "Aniversariantes"               (aniversariantes.js / aniversario-ex.js / planilha-aniversarios.js)
 *   • "Com débito" (nome exato)       (inadimplentes.js / bloqueio do app)
 * Os FILTROS de cada segmento não são lidos aqui — a tela mostra quais usar.
 *
 * Uso (no servidor da loja): node src/conferir-segmentos.js → última linha SEGMENTOS_JSON={...}
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const SEGMENTOS = [
  { id: 'vencimento', nome: 'Vencimento de contrato semana atual', casa: (t) => t.includes('vencimento de contrato seman'), uso: 'aviso de renovação e contratos a vencer no mês', filtros: 'Status: Ativos, Suspensos e Restritos · Contratos ativos: Todos · Vencimento do contrato: Este mês' },
  { id: 'aniversariantes', nome: 'Aniversariantes', casa: (t) => t.includes('aniversariante'), uso: 'parabéns, aniversário de ex-alunas e planilha', filtros: 'já vem nos Modelos do EVO (Status: Ativos · Mês de aniversário: Este mês)' },
  { id: 'debito', nome: 'Com débito', casa: (t) => t === 'com débito', uso: 'cobrança das recorrentes e bloqueio do app', filtros: 'Status: Ativos, Suspensos e Restritos · Com débito: Sim' },
];
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Nomes vistos na tela → [{ id, nome, achado, comoEsta?, uso, filtros }] */
function avaliar(nomesVistos) {
  const vistos = [...new Set((nomesVistos || []).map(norm).filter(Boolean))];
  return SEGMENTOS.map((s) => { const v = vistos.find((t) => s.casa(t)); return { id: s.id, nome: s.nome, achado: !!v, comoEsta: v || '', uso: s.uso, filtros: s.filtros }; });
}

async function ler() {
  const config = require('./config');
  const estado = require('./evo-login-estado');
  estado.conferir(); // EVO-01: senha recusada antes → para aqui (lança)
  if (!config.evo.email || !config.evo.password) throw new Error('O login do robô no EVO ainda não foi preenchido.');
  const puppeteer = require('puppeteer-extra');
  puppeteer.use(require('puppeteer-extra-plugin-stealth')());
  const { fecharPopupNovaTela } = require('./evo-popup');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'], defaultViewport: { width: 1366, height: 900 } });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);
    await require('./evo-login').esperarFormLogin(page);
    const campo = 'input#usuario, input[type="email"], input[type="text"]';
    await page.click(campo, { clickCount: 3 });
    require('./evo-login-estado').conferir(); // EVO-01: confere de novo logo antes de digitar
    await page.type(campo, config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes((b.textContent || '').trim().toUpperCase())) { b.click(); return; }
      const s = document.querySelector('button[type="submit"], button.primary'); if (s) s.click();
    });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {} // MFA (e anota senha recusada — EVO-01)
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(5000); await fecharPopupNovaTela(page);
    let vistos = [];
    for (let i = 0; i < 15; i++) { // a lista do EVO às vezes demora (até ~45 s)
      vistos = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('md-list-item, li, a, span, div')) {
          const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 60 && el.offsetWidth > 0 && el.children.length <= 2 && !out.includes(t)) out.push(t);
        }
        return out.slice(0, 300);
      }).catch(() => []);
      if (avaliar(vistos).every((s) => s.achado) || (i >= 4 && vistos.some((t) => /segmenta/i.test(t)))) break;
      await sleep(3000);
    }
    return avaliar(vistos);
  } finally { try { await browser.close(); } catch (_) {} }
}

if (require.main === module) {
  ler().then((r) => { console.log('SEGMENTOS_JSON=' + JSON.stringify({ ok: true, segmentos: r })); process.exit(0); })
    .catch((e) => { console.log('SEGMENTOS_JSON=' + JSON.stringify({ ok: false, erro: String(e && e.message || e).slice(0, 200) })); process.exit(0); });
}

module.exports = { avaliar, SEGMENTOS };

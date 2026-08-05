require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════
//  LEITOR de Gerencial > Suspensões (trancamentos) do EVO.
//
//  Retorna os trancamentos que SOBREPÕEM a janela [hoje - dias, hoje], cobrindo
//  os 3 casos que interessam ao win-back de ausentes:
//    • vigente (início ≤ hoje ≤ fim)
//    • começou dentro do período
//    • terminou dentro do período (aluna destrancou faz poucos dias)
//
//  A tela é Angular (frame principal, evo-abc-sec). Colunas do grid:
//    Nome(id+nome) | Contrato | Suspenso por | Tipo | Incluída em |
//    Início | Fim | Dias suspensos | Motivo | Status
//
//  O filtro padrão da tela é "Hoje" (só Vigentes). Para pegar também as
//  Finalizadas recentes, trocamos o período para "Mês passado" e "Este mês" e
//  juntamos tudo (mais robusto que automatizar o calendário do "personalizado").
//
//  Uso standalone (teste):
//    HEADLESS=true node src/suspensoes.js            → lista trancamentos (dias=10)
//    HEADLESS=true node src/suspensoes.js --dias=15
// ═══════════════════════════════════════════════════════════════════════════

const SUSP_HASH = process.env.EVO_SUSPENSOES_HASH
  || '#/app/slimfit/15/gerencial/suspensoes';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const norm = (s) => (s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

/** Normaliza o nome da aluna p/ cruzar (tira ID no começo, acento e caixa). */
function normNome(s) {
  return norm(String(s || '').replace(/^\s*\d+\s*[-–—]?\s*/, ''));
}

/** DD/MM/AAAA → Date (00:00 local) ou null. */
function parseData(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

async function login(page) {
  await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
  await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
  await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
  await page.click('input#senha, input[type="password"]', { clickCount: 3 });
  await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
    }
    document.querySelector('button[type="submit"], button.primary')?.click();
  });
  await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
  await sleep(3000);
}

/** Lê o grid da tela (a maior <table>): retorna linhas como arrays de células. */
async function lerGrid(page) {
  return page.evaluate(() => {
    const n = (s) => (s || '').replace(/\s+/g, ' ').trim();
    let best = null, mx = -1;
    for (const t of document.querySelectorAll('table')) {
      const c = t.querySelectorAll('tbody tr').length;
      if (c > mx) { mx = c; best = t; }
    }
    if (!best) return [];
    const trs = Array.from(best.querySelectorAll('tbody tr')).filter(tr => tr.querySelectorAll('td').length);
    return trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => n(td.innerText)));
  });
}

/** Tenta ir para a próxima página do grid; retorna true se avançou. */
async function proximaPagina(page) {
  const antes = await page.evaluate(() =>
    (document.body.innerText.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/) || []).slice(1).join(','));
  const clicou = await page.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('button, a, [role="button"], span, i'));
    for (const el of cand) {
      if (el.offsetParent === null) continue;
      const meta = ((el.getAttribute && ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''))) + ' ' + (el.className || '') + ' ' + (el.textContent || '')).toLowerCase();
      const isNext = /pr[óo]xim|next|chevron_right|chevron-right|caret-right|arrow_forward|angle-right|›|>/.test(meta);
      if (!isNext) continue;
      const disabled = el.disabled || /disabled|k-state-disabled/i.test(el.className || '') || (el.closest && el.closest('[disabled],[aria-disabled="true"],.disabled'));
      if (disabled) return false;
      (el.closest('button, a, [role="button"]') || el).click();
      return true;
    }
    return false;
  });
  if (!clicou) return false;
  await sleep(2000);
  const depois = await page.evaluate(() =>
    (document.body.innerText.match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/) || []).slice(1).join(','));
  return !!(depois && depois !== antes);
}

/** Lê o grid em TODAS as páginas (acumula linhas). */
async function lerGridTodasPaginas(page) {
  const acc = [];
  for (let p = 0; p < 20; p++) {
    acc.push(...await lerGrid(page));
    const foi = await proximaPagina(page);
    if (!foi) break;
  }
  return acc;
}

/** Troca o período do filtro (ex.: "Este mês", "Mês passado"). Best-effort. */
async function selecionarPeriodo(page, label) {
  try {
    // 1) abre o dropdown "Período da suspensão: ..."
    const abriu = await page.evaluate(() => {
      const alvo = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
        .find(el => /per[íi]odo da suspens/i.test(el.textContent || '') && el.offsetParent !== null);
      if (!alvo) return false;
      (alvo.closest('button, [role="button"], a') || alvo).click();
      return true;
    });
    if (!abriu) return false;
    await sleep(900);
    // 2) clica a opção pelo texto exato
    const clicou = await page.evaluate((lbl) => {
      const opts = Array.from(document.querySelectorAll('[role="menuitem"], button, li, a, span, div'));
      const alvo = opts.find(el => (el.textContent || '').trim().toLowerCase() === lbl.toLowerCase() && el.offsetParent !== null);
      if (!alvo) return false;
      (alvo.closest('[role="menuitem"], button, li, a') || alvo).click();
      return true;
    }, label);
    if (!clicou) return false;
    await sleep(2600); // espera o grid recarregar
    return true;
  } catch (_) { return false; }
}

/** Parseia uma linha do grid em { id, nome, inicio, fim, dias, motivo, status }. */
function parseLinha(cols) {
  if (!cols || cols.length < 7) return null;
  const nomeCell = cols[0] || '';
  const mId = /^\s*(\d+)/.exec(nomeCell);
  const id = mId ? mId[1] : '';
  const nome = nomeCell.replace(/^\s*\d+\s*/, '').trim();
  // Índices fixos do grid; validamos as datas p/ tolerar pequenas variações.
  let inicio = cols[5], fim = cols[6], dias = cols[7], motivo = cols[8], status = cols[9];
  if (!parseData(inicio) || !parseData(fim)) {
    // fallback: procura as 2 últimas datas antes do status
    const datas = cols.map(c => (/(\d{2}\/\d{2}\/\d{4})/.exec(c) || [])[1]).filter(Boolean);
    if (datas.length >= 2) { inicio = datas[datas.length - 2]; fim = datas[datas.length - 1]; }
  }
  return {
    id, nome,
    inicio: (parseData(inicio) ? inicio : '').trim(),
    fim: (parseData(fim) ? fim : '').trim(),
    dias: (dias || '').trim(),
    motivo: (motivo || '').trim(),
    status: (status || '').trim(),
  };
}

/**
 * Coleta os trancamentos que sobrepõem [hoje - dias, hoje].
 * Se `page` for passada, reaproveita a sessão logada; senão, abre browser e loga.
 * Retorna array de { id, nome, nomeNorm, inicio, fim, dias, motivo, status }.
 */
async function coletarTrancamentos(dias = 10, page = null) {
  let browser = null, ownPage = page;
  if (!ownPage) {
    browser = await puppeteer.launch({
      headless: process.env.HEADLESS === 'false' ? false : 'new',
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1600,950'],
      defaultViewport: { width: 1600, height: 950 },
    });
    ownPage = await browser.newPage();
    await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    ownPage.setDefaultTimeout(60000);
    ownPage.setDefaultNavigationTimeout(60000);
    await login(ownPage);
  }

  try {
    console.log('🔒 Lendo Gerencial > Suspensões...');
    await ownPage.evaluate((h) => { location.hash = h; }, SUSP_HASH);
    await sleep(7000);

    // Junta o período padrão (Vigentes/Hoje) + "Este mês" + "Mês passado".
    const linhasBrutas = [];
    linhasBrutas.push(...await lerGridTodasPaginas(ownPage)); // default (Hoje = vigentes)
    for (const periodo of ['Mês passado', 'Este mês']) {
      const ok = await selecionarPeriodo(ownPage, periodo);
      if (ok) { linhasBrutas.push(...await lerGridTodasPaginas(ownPage)); }
      else console.log(`   ⚠️  não consegui trocar o período p/ "${periodo}" (sigo com o que tenho).`);
    }

    // Parseia + dedup por id|início|fim.
    const vistos = new Set();
    const todos = [];
    for (const cols of linhasBrutas) {
      const t = parseLinha(cols);
      if (!t || !t.nome) continue;
      const k = `${t.id}|${t.inicio}|${t.fim}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      todos.push(t);
    }

    // Janela [hoje - dias, hoje] (00:00 → 23:59).
    const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    hoje.setHours(23, 59, 59, 999);
    const ini = new Date(hoje); ini.setDate(ini.getDate() - dias); ini.setHours(0, 0, 0, 0);

    const overlaps = (t) => {
      const di = parseData(t.inicio), df = parseData(t.fim);
      if (!di || !df) return false;
      df.setHours(23, 59, 59, 999);
      return di <= hoje && df >= ini; // sobrepõe a janela
    };

    const filtrados = todos.filter(overlaps).map(t => ({ ...t, nomeNorm: normNome(t.nome) }));
    console.log(`   🔒 ${filtrados.length} trancamento(s) sobrepõem os últimos ${dias} dias (de ${todos.length} lidos).`);
    return filtrados;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { coletarTrancamentos, normNome };

// ─── Standalone (teste) ──────────────────────────────────────────────────────
if (require.main === module) {
  const argDias = (process.argv.find(a => a.startsWith('--dias=')) || '').split('=')[1];
  const dias = parseInt(argDias || '10', 10);
  coletarTrancamentos(dias)
    .then(list => {
      console.log(`\n═══ ${list.length} trancamento(s) na janela de ${dias} dias ═══`);
      list.forEach(t => console.log(`• ${t.nome} — ${t.inicio} → ${t.fim} (${t.dias}d) — ${t.status} — ${t.motivo}`));
      process.exit(0);
    })
    .catch(err => { console.error('\n❌ Erro:', err && err.message); if (err && err.stack) console.error(err.stack); process.exit(1); });
}

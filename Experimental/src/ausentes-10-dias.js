require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════
//  AUSENTES 10 DIAS → grupo da equipe
//
//  Toda segunda 06:10: abre o CRM > Faltantes no EVO, define "Sem presença nos
//  últimos N dias", marca "Contabilizar Inadimplentes", pesquisa (lupa), e lê a
//  grid (Nome | Últ. freq.) em TODAS as páginas. Para cada aluna, clica na linha
//  e confere no painel de detalhes se ela tem "Contrato ativo" — só entram as
//  ATIVAS. Depois manda a lista no grupo da equipe (mesmo do resumo-semana.js).
//
//  Grid tem só 2 colunas (Nome, Últ. freq.); o status do contrato aparece no
//  painel lateral ("Contrato ativo") ao clicar na aluna.
//
//  Uso:
//    node src/ausentes-10-dias.js           → monta e ENVIA no grupo
//    node src/ausentes-10-dias.js --dry     → só monta e imprime (não envia)
//    node src/ausentes-10-dias.js --dias=7  → muda o corte de dias (padrão 10)
//
//  Standalone requer o scheduler PARADO (pm2 stop slimfit-exp): o envio usa a
//  mesma sessão do WhatsApp (cliente persistente).
// ═══════════════════════════════════════════════════════════════════════════

const GRUPO = process.env.GRUPO_EQUIPE || 'SlimFit Equipe 💪';
// Rota do CRM > Faltantes (legado "evo3", normalmente dentro de um iframe).
const FALTANTES_HASH = process.env.EVO_FALTANTES_HASH
  || '#/app/slimfit/15/evo3/-CRM-Faltantes-Faltantes';

const DRY = process.argv.includes('--dry');
// --diag: despeja o TEXTO COMPLETO do painel de cada aluna em data/ausentes-diag.txt
// (para descobrir onde o EVO mostra trancamento + telefone). Não envia nada.
const DIAG = process.argv.includes('--diag');
const argDias = (process.argv.find(a => a.startsWith('--dias=')) || '').split('=')[1];
const DIAS_MIN = parseInt(argDias || process.env.AUSENTES_DIAS || '10', 10);

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Login no EVO (mesmo padrão que já funciona no aniversariantes.js) ───────
async function login(page) {
  console.log('🔐 Fazendo login no EVO...');
  await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
  await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
  await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
  await page.click('input#senha, input[type="password"]', { clickCount: 3 });
  await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
    }
    document.querySelector('button[type="submit"], button.primary')?.click();
  });
  await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
  await sleep(3000);
  console.log('✅ Login OK\n');
}

/** Pontua um frame pela presença dos elementos característicos da tela Faltantes. */
async function pontuarFrame(f) {
  try {
    return await f.evaluate(() => {
      const t = (document.body && document.body.innerText || '').toLowerCase();
      let s = 0;
      if (/sem presen[çc]a/.test(t)) s += 5;
      if (/inadimplente/.test(t)) s += 4;
      if (/contabilizar/.test(t)) s += 2;
      if (/últ\.?\s*freq|ult\.?\s*freq|última\s*frequ|ultima\s*frequ/.test(t)) s += 4;
      if (/contrato ativo/.test(t)) s += 3;
      if (Array.from(document.querySelectorAll('input[type="checkbox"]')).some(cb =>
        (((cb.id || '') + (cb.name || '') + (cb.getAttribute('aria-label') || ''))).toLowerCase().includes('inadimpl'))) s += 3;
      const temGridNome = Array.from(document.querySelectorAll('table th'))
        .some(th => (th.textContent || '').trim().toLowerCase().includes('nome'));
      if (temGridNome) s += 4;
      return s;
    });
  } catch (_) { return -1; } // cross-origin ou ainda carregando
}

/** Acha o frame com maior pontuação (a tela de Faltantes vive num iframe legado). */
async function acharFrameFaltantes(page) {
  let melhor = null, melhorScore = 0;
  for (const f of page.frames()) {
    const s = await pontuarFrame(f);
    if (s > melhorScore) { melhorScore = s; melhor = f; }
  }
  return melhor; // pode ser null se nada bateu ainda
}

/** Espera o iframe da tela de Faltantes carregar (poll até timeout). */
async function esperarFrameFaltantes(page, timeoutMs = 40000) {
  const inicio = Date.now();
  let ultimo = null;
  while (Date.now() - inicio < timeoutMs) {
    const f = await acharFrameFaltantes(page);
    if (f) { ultimo = f; return f; }
    await sleep(1500);
  }
  return ultimo;
}

/** Lista todas as frames (url + trecho de texto) num arquivo de debug. */
async function dumpFrames(page) {
  const linhas = [];
  for (const f of page.frames()) {
    let txt = '', score = await pontuarFrame(f);
    try { txt = await f.evaluate(() => (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300)); } catch (e) { txt = '(inacessível: ' + e.message + ')'; }
    linhas.push(`--- FRAME (score=${score}) ${f.url()}\n${txt}\n`);
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'ausentes-frames.txt'), linhas.join('\n'), 'utf8');
  } catch (_) { /* ignore */ }
  return linhas.join('\n');
}

/** Preenche o campo "Sem presença nos últimos [N] dias". */
async function setDiasSemPresenca(frame, dias) {
  const ok = await frame.evaluate((dias) => {
    let inp = null;
    const node = document.evaluate("//*[contains(translate(text(),'ÇÃ','ca'),'Sem presen')]",
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (node) {
      let cont = node.parentElement;
      for (let i = 0; i < 4 && cont && !inp; i++) {
        inp = cont.querySelector('input[type="text"],input[type="number"],input:not([type])');
        cont = cont.parentElement;
      }
    }
    if (!inp) {
      const inputs = Array.from(document.querySelectorAll('input'));
      inp = inputs.find(x => /^\d{1,3}$/.test((x.value || '').trim()));
    }
    if (!inp) return false;
    inp.focus(); inp.value = '';
    inp.value = String(dias);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    return true;
  }, dias);
  console.log(ok ? `   🔢 "Sem presença nos últimos" = ${dias} dias` : '   ⚠️  Campo de dias não encontrado (usando o padrão da tela)');
  return ok;
}

/** Marca o checkbox "Contabilizar Inadimplentes". */
async function marcarInadimplentes(frame) {
  const ok = await frame.evaluate(() => {
    const alvo = 'inadimplente';
    for (const lb of Array.from(document.querySelectorAll('label'))) {
      if ((lb.textContent || '').toLowerCase().includes(alvo)) {
        let cb = null;
        const forId = lb.getAttribute('for');
        if (forId) cb = document.getElementById(forId);
        if (!cb) cb = lb.querySelector('input[type="checkbox"]');
        if (!cb) {
          const prev = lb.previousElementSibling, next = lb.nextElementSibling;
          if (prev && prev.matches && prev.matches('input[type="checkbox"]')) cb = prev;
          else if (next && next.matches && next.matches('input[type="checkbox"]')) cb = next;
        }
        if (cb) { if (!cb.checked) cb.click(); return true; }
      }
    }
    for (const cb of Array.from(document.querySelectorAll('input[type="checkbox"]'))) {
      const meta = ((cb.id || '') + ' ' + (cb.name || '') + ' ' + (cb.getAttribute('aria-label') || '')).toLowerCase();
      if (meta.includes('inadimpl')) { if (!cb.checked) cb.click(); return true; }
    }
    return false;
  });
  console.log(ok ? '   ☑️  "Contabilizar Inadimplentes" marcado' : '   ⚠️  Checkbox de inadimplentes não encontrado');
  return ok;
}

/** Clica na LUPA (botão de pesquisar). */
async function clicarLupa(frame) {
  const ok = await frame.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], i, span, img, [role="button"]'));
    const bate = (el) => {
      const meta = (((el.getAttribute && (
        (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' +
        (el.getAttribute('alt') || '') + ' ' + (el.className || '') + ' ' + (el.value || '')
      )) || '') + ' ' + (el.textContent || '')).toLowerCase();
      return /pesquis|buscar|search|lupa|fa-search|glyphicon-search|mdi-magnify|k-i-search/.test(meta);
    };
    for (const el of cand) {
      if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
      if (bate(el)) { (el.closest('button, a, [role="button"], input') || el).click(); return true; }
    }
    return false;
  });
  console.log(ok ? '   🔍 Lupa clicada (pesquisando)...' : '   ⚠️  Botão de pesquisa (lupa) não encontrado');
  return ok;
}

/** Lê as linhas da grid atual: [{ nome, ultima }] + a string "Exibindo itens…". */
async function lerLinhas(frame) {
  return frame.evaluate(() => {
    const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let best = null, mx = -1;
    for (const t of document.querySelectorAll('table')) {
      const hs = Array.from(t.querySelectorAll('th')).map(x => norm(x.textContent));
      if (!hs.some(h => h.includes('nome'))) continue;
      const n = t.querySelectorAll('tbody tr, tr').length;
      if (n > mx) { mx = n; best = t; }
    }
    if (!best) return { rows: [], info: '', headers: [] };
    const ths = Array.from(best.querySelectorAll('th')).map(x => (x.textContent || '').trim());
    const hn = ths.map(norm);
    const iNome = hn.findIndex(h => h.includes('nome'));
    const iFreq = hn.findIndex(h => /freq|presen/.test(h));
    const body = best.querySelector('tbody') || best;
    const trs = Array.from(body.querySelectorAll('tr')).filter(tr => tr.querySelectorAll('td').length);
    const rows = trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim());
      let nome = iNome >= 0 && tds[iNome] ? tds[iNome] : tds[0];
      let ultima = iFreq >= 0 ? tds[iFreq] : '';
      if (!/\d{2}\/\d{2}\/\d{2,4}/.test(ultima)) {
        const m = tds.join(' | ').match(/\d{2}\/\d{2}\/\d{4}/);
        if (m) ultima = m[0];
      }
      nome = (nome || '').replace(/^\s*\d+\s*[-–—]\s*/, '').trim(); // remove "5616 - "
      const md = (ultima || '').match(/\d{2}\/\d{2}\/\d{4}/);
      return { nome, ultima: md ? md[0] : (ultima || '') };
    }).filter(r => r.nome);
    const info = (document.body.innerText.match(/Exibindo\s+itens?\s+\d+\s*-\s*\d+\s+de\s+\d+/i) || [''])[0];
    return { rows, info, headers: ths };
  });
}

/** Clica na linha i da grid e lê, no painel, se há "Contrato ativo". */
async function lerContratoDaLinha(frame, i, nomeEsperado) {
  await frame.evaluate((i) => {
    const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let best = null, mx = -1;
    for (const t of document.querySelectorAll('table')) {
      const hs = Array.from(t.querySelectorAll('th')).map(x => norm(x.textContent));
      if (!hs.some(h => h.includes('nome'))) continue;
      const n = t.querySelectorAll('tbody tr, tr').length;
      if (n > mx) { mx = n; best = t; }
    }
    if (!best) return;
    const body = best.querySelector('tbody') || best;
    const trs = Array.from(body.querySelectorAll('tr')).filter(tr => tr.querySelectorAll('td').length);
    if (trs[i]) { const c = trs[i].querySelector('td'); (c || trs[i]).click(); }
  }, i);

  const primeiros = (nomeEsperado || '').split(/\s+/).slice(0, 2).join(' ');
  await frame.waitForFunction((nm) => {
    const t = document.body.innerText || '';
    return (!nm || t.includes(nm)) && /(contrato ativo|[úu]ltim.\s*presen)/i.test(t);
  }, { timeout: 8000 }, primeiros).catch(() => {});
  await sleep(300);

  return frame.evaluate(() => {
    const txt = document.body.innerText || '';
    const pega = (labels, stops) => {
      const re = new RegExp('(?:' + labels + ')\\s*[:\\n]+\\s*([\\s\\S]*?)\\s*(?:' + stops + ')', 'i');
      const m = re.exec(txt);
      return m ? m[1].trim().split('\n')[0].trim() : '';
    };
    const contrato = pega('Contrato ativo', '[úu]ltimo contrato|[úu]ltim.\\s*presen|Tipo do contato|Novo contato|$');
    const ultimaPres = pega('[úu]ltim.\\s*presen[çc]a|[úu]ltim.\\s*presen', 'Tipo do contato|Novo contato|Liga[çc]|$');
    // Telefone (para a futura mensagem direta) — pega o 1º padrão de celular BR.
    const mTel = txt.match(/(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/);
    const telefone = mTel ? mTel[0].trim() : '';
    // Painel inteiro (só usado no modo --diag): ajuda a achar onde está o trancamento.
    const painel = txt.replace(/\n{2,}/g, '\n').trim();
    return { contrato, ultimaPres, telefone, painel };
  });
}

/** Tenta ir para a próxima página; confirma pela mudança do "Exibindo itens…". */
async function proximaPagina(frame) {
  const range = () => frame.evaluate(() =>
    ((document.body.innerText.match(/Exibindo\s+itens?\s+(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/i) || []).slice(1).join(',')));
  const antes = await range();
  const clicou = await frame.evaluate(() => {
    const cand = Array.from(document.querySelectorAll('a, button, span, li, i, [role="button"]'));
    for (const el of cand) {
      if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
      const t = (el.textContent || '').trim();
      const cls = ((el.className || '') + ' ' + (el.getAttribute && (el.getAttribute('title') || '') || '')).toLowerCase();
      const isNext = t === '›' || t === '>' || /(\bnext\b|proxim|page-next|caret-right|chevron-right|k-i-arrow-e|glyphicon-chevron-right|fa-angle-right|fa-chevron-right)/.test(cls);
      if (!isNext) continue;
      const disabled = /disabled|k-state-disabled/i.test(cls) || (el.closest && el.closest('.disabled, .k-state-disabled, [aria-disabled="true"]'));
      if (disabled) return false;
      (el.closest('a, button, [role="button"], li') || el).click();
      return true;
    }
    return false;
  });
  if (!clicou) return false;
  await sleep(2500);
  const depois = await range();
  return !!(depois && depois !== antes);
}

/** Salva screenshot + HTML para depuração. */
async function salvarDebug(page, frame) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    await page.screenshot({ path: path.join(DATA_DIR, 'ausentes-debug.png'), fullPage: true }).catch(() => {});
    let gridHtml = '';
    try { gridHtml = await frame.evaluate(() => { const t = document.querySelector('table'); return t ? t.outerHTML.slice(0, 20000) : '(sem <table>)'; }); } catch (_) {}
    fs.writeFileSync(path.join(DATA_DIR, 'ausentes-grid.html'), gridHtml, 'utf8');
    console.log(`   🧷 Debug salvo em ${DATA_DIR} (ausentes-debug.png, ausentes-grid.html)`);
  } catch (_) { /* ignore */ }
}

/** (--diag) Anexa o painel completo de uma aluna no arquivo de diagnóstico. */
const DIAG_FILE = path.join(DATA_DIR, 'ausentes-diag.txt');
function dumpPainel(nome, ultima, painel) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const bloco = `\n═══════════════════════════════════════════════════\n`
      + `ALUNA: ${nome}  |  última presença: ${ultima}\n`
      + `───────────────────────────────────────────────────\n`
      + (painel || '(painel vazio)') + '\n';
    fs.appendFileSync(DIAG_FILE, bloco, 'utf8');
  } catch (_) { /* ignore */ }
}

/** Contrato considerado ATIVO? */
function ehAtivo(contrato) {
  const s = (contrato || '').trim();
  if (!s || s.length < 3) return false;
  if (/(nenhum|sem contrato|inativ|cancel|tranc|encerr|suspens|vencid|expirad)/i.test(s)) return false;
  return true;
}

// ─── Coleta as ausentes no EVO ───────────────────────────────────────────────
async function coletarAusentes() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`🚶 Buscando ausentes há ${DIAS_MIN} dias ou mais no EVO...`);
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === 'false' ? false : 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1500,950'],
    defaultViewport: { width: 1500, height: 950 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  try {
    await login(page);

    console.log('📂 Abrindo CRM > Faltantes...');
    await page.evaluate((h) => { location.hash = h; }, FALTANTES_HASH);
    await sleep(6000);

    // A tela vive num iframe legado (evo3) que carrega devagar → espera por ele.
    let frame = await esperarFrameFaltantes(page, 45000);
    await dumpFrames(page);
    if (!frame) {
      await salvarDebug(page, page.mainFrame());
      throw new Error('Não encontrei o iframe da tela de Faltantes (veja data/ausentes-frames.txt e ausentes-debug.png).');
    }
    console.log(`   🖼️  Frame alvo: ${frame.url() || '(main)'}`);

    await setDiasSemPresenca(frame, DIAS_MIN);
    await marcarInadimplentes(frame);
    await sleep(800);
    await clicarLupa(frame);

    // Espera a grid popular (legado carrega async): até ~20s por linhas ou "Exibindo itens".
    for (let i = 0; i < 14; i++) {
      await sleep(1500);
      frame = await acharFrameFaltantes(page) || frame;
      const { rows, info } = await lerLinhas(frame);
      if (rows.length > 0 || /Exibindo/i.test(info)) break;
    }
    await salvarDebug(page, frame);

    const coletadas = [];
    let pagina = 1;
    const MAX_PAGINAS = 30;
    while (pagina <= MAX_PAGINAS) {
      const { rows, info, headers } = await lerLinhas(frame);
      if (pagina === 1) console.log(`   📋 Colunas: ${headers.join(' | ') || '(?)'}`);
      console.log(`   📄 Página ${pagina}: ${rows.length} linha(s) ${info ? '(' + info + ')' : ''}`);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let contrato = '', telefone = '', painel = '';
        try { ({ contrato, telefone, painel } = await lerContratoDaLinha(frame, i, r.nome)); }
        catch (_) { /* segue sem status */ }
        if (DIAG) dumpPainel(r.nome, r.ultima, painel);
        const ativo = ehAtivo(contrato);
        console.log(`      ${ativo ? '✅' : '⛔'} ${r.nome} — ${r.ultima} ${contrato ? '[' + contrato + ']' : '[sem contrato ativo]'}${DIAG && telefone ? ' 📞 ' + telefone : ''}`);
        if (ativo) coletadas.push({ nome: r.nome, ultima: r.ultima, telefone });
      }

      const foi = await proximaPagina(frame);
      if (!foi) break;
      frame = await acharFrameFaltantes(page);
      pagina++;
    }

    // dedup por nome+data
    const vistos = new Set();
    const unicas = [];
    for (const r of coletadas) {
      const k = `${r.nome.toLowerCase()}|${r.ultima}`;
      if (vistos.has(k)) continue;
      vistos.add(k); unicas.push(r);
    }
    // ordena por data de última presença (mais antiga primeiro)
    unicas.sort((a, b) => {
      const pa = (a.ultima.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []);
      const pb = (b.ultima.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []);
      const da = pa.length ? new Date(+pa[3], +pa[2] - 1, +pa[1]) : 0;
      const db = pb.length ? new Date(+pb[3], +pb[2] - 1, +pb[1]) : 0;
      return da - db;
    });

    console.log(`\n   ✅ ${unicas.length} aluna(s) ATIVA(s) ausente(s) há ${DIAS_MIN}+ dias\n`);

    // ── Cruza com os TRANCAMENTOS (Gerencial > Suspensões) ──────────────────
    // Reaproveita a MESMA sessão logada (page). Aluna cujo trancamento sobrepõe
    // a janela de N dias NÃO é "ausente de verdade" — separa em outra lista.
    let trancamentos = [];
    try {
      const { coletarTrancamentos } = require('./suspensoes');
      trancamentos = await coletarTrancamentos(DIAS_MIN, page);
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler suspensões (sigo sem excluir trancadas): ${e.message}`);
    }

    const normNome = (s) => (s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\s*\d+\s*[-–—]?\s*/, '').replace(/\s+/g, ' ');
    const trancMap = new Map();
    for (const t of trancamentos) trancMap.set(t.nomeNorm || normNome(t.nome), t);

    const ausentesReais = [];
    const trancadas = [];
    for (const a of unicas) {
      const t = trancMap.get(normNome(a.nome));
      if (t) trancadas.push({ ...a, fim: t.fim, motivo: t.motivo, status: t.status });
      else ausentesReais.push(a);
    }
    console.log(`   🔒 ${trancadas.length} trancada(s) removida(s) da lista de ausentes; ${ausentesReais.length} ausente(s) real(is).\n`);

    return { ausentes: ausentesReais, trancadas };
  } finally {
    await browser.close();
  }
}

/** Monta o texto para o grupo (formato pedido pela dona). */
function montarMensagem(ausentes, trancadas = []) {
  const intro = 'Professoras, segue abaixo a listagem de alunas faltantes a mais de '
    + `${DIAS_MIN} dias, com a data da última presença dela. Por favor, entrem em contato no privado `
    + 'para entender o que está acontecendo e incentivar a retomada às aulas:';
  const linhas = ausentes.length
    ? ausentes.map(a => `* ${a.nome} - ${a.ultima}`).join('\n')
    : '_nenhuma ausente (fora as trancadas abaixo)_';
  let msg = `${intro}\n${linhas}`;

  // Seção informativa: alunas que estão/estavam TRANCADAS no período — não cobrar.
  if (trancadas && trancadas.length) {
    const lt = trancadas.map(a => {
      const ate = a.fim ? ` (trancamento até ${a.fim})` : '';
      const mot = a.motivo ? ` — ${a.motivo}` : '';
      return `* ${a.nome} - ${a.ultima}${ate}${mot}`;
    });
    msg += `\n\n🔒 *Trancadas no período (não cobrar):*\n${lt.join('\n')}`;
  }
  return msg;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function runAusentes10Dias() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   AUSENTES 10 DIAS → Grupo da Equipe              ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  const modo = DIAG ? '🔬 DIAG (dump do painel, não envia)' : (DRY ? '🧪 DRY (não envia)' : '🚀 ENVIO');
  console.log(`   Grupo: ${GRUPO} | dias: ${DIAS_MIN}+ | ${modo}\n`);

  if (DIAG) { try { fs.writeFileSync(DIAG_FILE, `Diagnóstico ausentes ${DIAS_MIN}+ dias — ${new Date().toLocaleString('pt-BR')}\n`, 'utf8'); } catch (_) {} }

  const { ausentes, trancadas } = await coletarAusentes();
  if (DIAG) { console.log(`\n🔬 DIAG pronto — veja o painel completo de cada aluna em:\n   ${DIAG_FILE}\n`); return { total: ausentes.length, diag: true }; }

  if (ausentes.length === 0 && trancadas.length === 0) {
    console.log('📭 Nenhuma aluna ativa ausente no período. Nada a enviar.\n');
    return { total: 0 };
  }
  if (ausentes.length === 0) {
    console.log('📭 Todas as ausentes estão trancadas — nada a cobrar. Não enviei.\n');
    return { total: 0, trancadas: trancadas.length };
  }

  const msg = montarMensagem(ausentes, trancadas);
  console.log('─── Mensagem ─────────────────────────────────────');
  console.log(msg);
  console.log('──────────────────────────────────────────────────\n');

  if (DRY) { console.log('🧪 DRY — não enviei nada.\n'); return { total: ausentes.length, trancadas: trancadas.length, dry: true }; }

  const wa = require('./wa-client');
  await wa.initWhatsApp();
  await wa.sendGrupo(GRUPO, msg);
  console.log(`✅ Lista enviada no grupo "${GRUPO}".\n`);
  return { total: ausentes.length, trancadas: trancadas.length };
}

module.exports = { runAusentes10Dias, coletarAusentes, montarMensagem };

if (require.main === module) {
  runAusentes10Dias()
    .then(() => { if (DRY || DIAG) process.exit(0); })
    .catch(err => { console.error('\n❌ Erro fatal:', err && err.message); if (err && err.stack) console.error(err.stack); process.exit(1); });
}

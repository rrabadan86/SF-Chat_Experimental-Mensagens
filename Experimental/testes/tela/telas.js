#!/usr/bin/env node
/**
 * Teste de TELA: sobe o painel de DEMONSTRAÇÃO (dados fictícios, PAINEL_DEMO=1)
 * numa pasta temporária e abre cada tela no computador e no celular.
 *
 * Reprova (sai com erro):  tela que não abre (HTTP 4xx/5xx) ou erro de JavaScript na página.
 * Avisa (lista no relatório; com --estrito também reprova):
 *   - "undefined", "null" ou "NaN" aparecendo no texto da tela;
 *   - rolagem para o lado no celular (algo mais largo que a tela).
 *
 *   node testes/tela/telas.js              (precisa do pacote playwright)
 *   node testes/tela/telas.js --estrito
 *   SAIDA=/pasta node testes/tela/telas.js  (prints das telas com problema)
 *
 * Nada aqui toca os dados de verdade: tudo roda numa cópia em pasta temporária.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ESTRITO = process.argv.includes('--estrito');
const EXP = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(EXP, '..');
const SAIDA = process.env.SAIDA || fs.mkdtempSync(path.join(os.tmpdir(), 'sf-telas-saida-'));
fs.mkdirSync(SAIDA, { recursive: true });

const TELAS = [
  '/hoje', '/?view=config', '/?view=express', '/visao-cliente',
  '/sofia?view=conversas', '/sofia?view=config', '/sofia?view=contatos', '/sofia?view=tags',
  '/sofia?view=campanhas', '/sofia?view=cobranca', '/sofia?view=custo',
  '/indicadores', '/funil', '/professoras', '/ativas', '/grade', // (/pagamento só existe com PAGAMENTO_ATIVO)
  '/clube?view=pendentes', '/clube?view=aprovados', '/clube?view=reclamacoes', '/clube?view=config',
  '/formularios', '/saude', '/perfis', '/perfis?view=auditoria',
];

// ── 1. instalação de demonstração numa pasta temporária ─────────────────────
function montar() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-telas-'));
  const exp = path.join(raiz, 'Experimental');
  fs.cpSync(path.join(EXP, 'src'), path.join(exp, 'src'), { recursive: true, filter: (s) => !/[\\/]agendamento_evo[\\/](\.venv|__pycache__)/.test(s) });
  fs.mkdirSync(path.join(exp, 'data'), { recursive: true });
  fs.symlinkSync(path.join(EXP, 'node_modules'), path.join(exp, 'node_modules'), 'dir');
  // arquivos-base da SoFIA (o demo-dados copia de ../ChatBot)
  fs.mkdirSync(path.join(raiz, 'ChatBot'));
  for (const f of fs.readdirSync(path.join(REPO, 'ChatBot'))) if (/\.default\./.test(f)) fs.copyFileSync(path.join(REPO, 'ChatBot', f), path.join(raiz, 'ChatBot', f));
  const porta = 18000 + Math.floor(Math.random() * 2000);
  fs.writeFileSync(path.join(exp, '.env'), [
    'PAINEL_DEMO=1', `PAINEL_PORT=${porta}`, 'PAINEL_HOST=127.0.0.1', 'PM2_SLUG=exemplo',
    `SOFIA_DIR=${path.join(raiz, 'sofia-demo')}`, 'STUDIO_NOME=Studio SlimFit Demonstração',
  ].join('\n') + '\n');
  return { raiz, exp, porta };
}
const esperarNoAr = (porta, ms = 30000) => new Promise((ok, erro) => {
  const ini = Date.now();
  (function tenta() {
    http.get({ host: '127.0.0.1', port: porta, path: '/hoje', timeout: 2000 }, (r) => { r.resume(); ok(); })
      .on('error', () => (Date.now() - ini > ms ? erro(new Error('o painel não subiu')) : setTimeout(tenta, 500)));
  })();
});

(async () => {
  const { chromium, devices } = require('playwright');
  const inst = montar();
  const env = { ...process.env };
  for (const k of ['SOFIA_DIR', 'PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_HOST', 'PM2_SLUG']) delete env[k]; // o .env da demonstração manda
  execFileSync(process.execPath, ['src/demo-dados.js'], { cwd: inst.exp, env, stdio: 'inherit' });
  const painel = spawn(process.execPath, ['src/painel-mensagens.js'], { cwd: inst.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logPainel = '';
  painel.stdout.on('data', d => { logPainel += d; }); painel.stderr.on('data', d => { logPainel += d; });

  const reprovas = [], avisos = [];
  let navegador;
  try {
    await esperarNoAr(inst.porta);
    navegador = await chromium.launch();
    const aparelhos = [
      ['computador', { viewport: { width: 1280, height: 900 } }],
      ['celular', { ...devices['iPhone 13'] }],
    ];
    for (const [nomeAp, opcoes] of aparelhos) {
      const ctx = await navegador.newContext(opcoes);
      for (const tela of TELAS) {
        const page = await ctx.newPage();
        const errosJs = [];
        page.on('pageerror', (e) => errosJs.push(String(e && e.message || e).slice(0, 200)));
        let resp;
        try { resp = await page.goto(`http://127.0.0.1:${inst.porta}${tela}`, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
        catch (e) { reprovas.push(`${tela} (${nomeAp}): não abriu — ${e.message.split('\n')[0]}`); await page.close(); continue; }
        await page.waitForTimeout(700);
        const st = resp ? resp.status() : 0;
        if (st >= 400) reprovas.push(`${tela} (${nomeAp}): HTTP ${st}`);
        for (const e of errosJs) reprovas.push(`${tela} (${nomeAp}): erro de JavaScript — ${e}`);
        const r = await page.evaluate(() => {
          const txt = document.body ? document.body.innerText : '';
          const ruins = [];
          const re = /(^|[\s(:$R])(undefined|NaN|null)(?=[\s).,:%]|$)/g; let m;
          while ((m = re.exec(txt)) && ruins.length < 3) ruins.push(txt.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ').trim());
          const largura = window.innerWidth, total = document.documentElement.scrollWidth;
          const largos = [];
          if (total > largura + 2) {
            for (const el of document.querySelectorAll('body *')) {
              const b = el.getBoundingClientRect();
              if (b.right > largura + 2 && b.width > 0 && getComputedStyle(el).position !== 'fixed') {
                const pai = el.parentElement && el.parentElement.getBoundingClientRect();
                if (!pai || pai.right <= largura + 2) largos.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} (${Math.round(b.right)}px)`);
                if (largos.length >= 3) break;
              }
            }
          }
          return { ruins, largura, total, largos, tamTexto: txt.length, titulo: document.title };
        });
        const marca = (txt) => avisos.push(`${tela} (${nomeAp}): ${txt}`);
        if (process.env.DETALHE) console.log(`   ${nomeAp.padEnd(10)} ${tela.padEnd(26)} HTTP ${st} · ${r.tamTexto} letras · largura ${r.total}/${r.largura} · "${r.titulo}"`);
        if (/^Entrar/.test(r.titulo)) reprovas.push(`${tela} (${nomeAp}): caiu na tela de login (o modo demonstração não ligou)`);
        else if (r.tamTexto < 150) reprovas.push(`${tela} (${nomeAp}): tela quase vazia (${r.tamTexto} letras)`);
        if (r.ruins.length) marca(`aparece "undefined/null/NaN" — ${r.ruins.map(x => `«${x}»`).join(' · ')}`);
        if (nomeAp === 'celular' && r.total > r.largura + 2) marca(`rola para o lado (${r.total}px numa tela de ${r.largura}px) — ${r.largos.join(', ') || 'elemento não identificado'}`);
        if (r.ruins.length || (nomeAp === 'celular' && r.total > r.largura + 2) || errosJs.length || st >= 400) {
          try { await page.screenshot({ path: path.join(SAIDA, `${nomeAp}-${tela.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true }); } catch (_) {}
        }
        await page.close();
      }
      await ctx.close();
    }
    // Sem internet: a tela que se atualiza sozinha (Conversas) mostra o aviso e ele some quando a conexão volta.
    {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (e) => errosJs.push(String(e && e.message || e)));
      await page.goto(`http://127.0.0.1:${inst.porta}/sofia?view=conversas`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await ctx.setOffline(true);
      const apareceu = await page.waitForSelector('#sfRede', { state: 'visible', timeout: 20000 }).then(() => true, () => false);
      await ctx.setOffline(false);
      const sumiu = apareceu && await page.waitForSelector('#sfRede', { state: 'hidden', timeout: 20000 }).then(() => true, () => false);
      if (!apareceu) reprovas.push('sem internet: o aviso "Sem conexão com o painel" não apareceu nas Conversas');
      else if (!sumiu) reprovas.push('sem internet: o aviso não sumiu quando a conexão voltou');
      for (const e of errosJs) reprovas.push('sem internet: erro de JavaScript — ' + e.slice(0, 160));
      await ctx.close();
    }
    // Celular: o VOLTAR fecha a conversa/janela aberta (não sai da tela); ações em massa passam
    // pela janela de revisão; a explicação do ⓘ fica dentro da tela.
    {
      const ctx = await navegador.newContext({ ...devices['iPhone 13'] });
      const page = await ctx.newPage();
      const errosJs = []; page.on('pageerror', (e) => errosJs.push(String(e && e.message || e)));
      const url = `http://127.0.0.1:${inst.porta}`;
      const falha = (t) => reprovas.push('celular: ' + t);
      // Conversas: abre uma conversa e volta.
      await page.goto(url + '/sofia?view=conversas', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cv-item', { timeout: 20000 }).catch(() => {});
      await page.click('.cv-item').catch(() => {});
      await page.waitForTimeout(1800);
      if (!(await page.evaluate(() => document.body.classList.contains('ver-conversa')))) falha('a conversa não abriu ao tocar na lista');
      else {
        await page.goBack().catch(() => {}); await page.waitForTimeout(600);
        const r = await page.evaluate(() => ({ aberta: document.body.classList.contains('ver-conversa'), url: location.pathname + location.search }));
        if (r.aberta) falha('o voltar não fechou a conversa aberta');
        if (r.url !== '/sofia?view=conversas') falha('o voltar saiu da tela de Conversas (foi para ' + r.url + ')');
      }
      // Contatos: janela do contato fecha com o voltar; excluir em lote pede revisão.
      await page.goto(url + '/sofia?view=contatos', { waitUntil: 'domcontentloaded' });
      await page.click('tr.ct-row .ct-nm').catch(() => {});
      await page.waitForTimeout(1800);
      if (!(await page.evaluate(() => { const m = document.getElementById('ctModal'); return !!m && getComputedStyle(m).display !== 'none'; }))) falha('a janela do contato não abriu');
      else {
        await page.goBack().catch(() => {}); await page.waitForTimeout(600);
        const r = await page.evaluate(() => { const m = document.getElementById('ctModal'); return { aberta: !!m && getComputedStyle(m).display !== 'none', url: location.pathname + location.search }; });
        if (r.aberta) falha('o voltar não fechou a janela do contato');
        if (r.url !== '/sofia?view=contatos') falha('o voltar saiu da tela de Contatos (foi para ' + r.url + ')');
      }
      await page.evaluate(() => { const c = document.querySelectorAll('.ct-chk'); for (let i = 0; i < 2 && i < c.length; i++) c[i].checked = true; excluirSelecionados(); });
      const rev = await page.waitForSelector('#sfRevisar', { state: 'visible', timeout: 5000 }).then(() => true, () => false);
      if (!rev) falha('excluir contatos em lote não mostrou a janela de revisão');
      else {
        const nomes = await page.$$eval('#sfRevisar .ct-dlg div[style*="max-height"] > div', d => d.length);
        if (nomes !== 2) falha(`a revisão deveria listar os 2 contatos marcados (listou ${nomes})`);
        await page.click('#sfRevNao'); await page.waitForTimeout(300);
        if (await page.$('#sfRevisar')) falha('o "Voltar" da revisão não fechou a janela');
      }
      // ⓘ dentro da tela (tabela com rolagem lateral em Alunas ativas).
      await page.goto(url + '/ativas', { waitUntil: 'domcontentloaded' });
      const info = await page.locator('table .info:visible').first().elementHandle({ timeout: 5000 }).catch(() => null); // o 1º ⓘ VISÍVEL (no celular algumas colunas somem)
      if (!info) falha('Alunas ativas: sem ⓘ nas colunas da tabela');
      else {
        await info.scrollIntoViewIfNeeded(); await info.tap().catch(() => info.click());
        await page.waitForTimeout(300);
        const b = await page.evaluate(() => { const p = document.querySelector('table .info:focus .info-pop, table .info:hover .info-pop'); if (!p) return null; const r = p.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, vis: r.width > 0 }; });
        if (!b || !b.vis) falha('Alunas ativas: a explicação do ⓘ não abriu ao tocar');
        else if (b.l < 0 || b.r > b.w) falha(`Alunas ativas: a explicação do ⓘ sai da tela (${Math.round(b.l)}–${Math.round(b.r)} de ${b.w}px)`);
      }
      for (const e of errosJs) falha('erro de JavaScript — ' + e.slice(0, 160));
      await ctx.close();
    }
  } catch (e) {
    reprovas.push('o teste não conseguiu rodar: ' + e.message);
    console.log(logPainel.slice(-3000));
  } finally {
    try { if (navegador) await navegador.close(); } catch (_) {}
    painel.kill();
    try { fs.rmSync(inst.raiz, { recursive: true, force: true }); } catch (_) {}
  }

  const linhas = [`## Teste de telas (${TELAS.length} telas × computador e celular)`, ''];
  linhas.push(reprovas.length ? `### ❌ Reprovado (${reprovas.length})` : '### ✅ Todas as telas abriram sem erro');
  reprovas.forEach(x => linhas.push('- ' + x));
  linhas.push('', avisos.length ? `### ⚠️ Avisos (${avisos.length})` : '### ✅ Sem avisos');
  avisos.forEach(x => linhas.push('- ' + x));
  if (reprovas.length || avisos.length) linhas.push('', `Prints das telas com problema: ${SAIDA}`);
  const rel = linhas.join('\n');
  console.log('\n' + rel);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rel + '\n');
  process.exit(reprovas.length || (ESTRITO && avisos.length) ? 1 : 0);
})();

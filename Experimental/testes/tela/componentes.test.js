// Peças do padrão visual no NAVEGADOR (Playwright), no computador (1366 px) e no
// celular (390 px): a tabela padrão busca, ordena e pagina; no celular vira cartão;
// nada rola para o lado; a janela de erro ao salvar abre e marca o campo.
// Precisa do pacote playwright (no CI: job "Telas"). Roda numa cópia temporária.
//   node --test testes/tela/componentes.test.js
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

const NOMES = ['Ana Souza', 'Bia Lima', 'Carla Dias', 'Débora Reis', 'Érica Melo', 'Fernanda Luz', 'Gabi Rocha', 'Helena Paz', 'Íris Costa', 'Júlia Neves'];
function paginaDeTeste(amb) {
  const { chrome, esc } = amb.req('painel-base');
  const { uiTabela, uiErroSalvar } = amb.req('painel-componentes');
  const linhas = [];
  for (let i = 0; i < 30; i++) linhas.push({ nome: `${NOMES[i % 10]} ${i + 1}`, n: { html: `<b>${(i * 7) % 31}</b>`, valor: (i * 7) % 31 }, obs: i === 3 ? 'observação-muito-longa-sem-espaço-'.repeat(8) : 'ok', acao: { html: '<button type="button" class="reset">Abrir</button>' } });
  const tabela = uiTabela({ id: 'tbT', porPagina: 10, colunas: [
    { chave: 'nome', titulo: 'Nome', celular: 'titulo' },
    { chave: 'n', titulo: 'Aulas', num: true, info: 'Quantas aulas no mês.' },
    { chave: 'obs', titulo: 'Observação' },
    { chave: 'acao', titulo: 'Ação', ordenar: false },
  ], linhas });
  const form = `<form id="fT" class="card" onsubmit="event.preventDefault();sfSalvou({ok:false,erro:'Telefone inválido: use DDD + número.',campo:'telefone'},this)">
    <label>Telefone <input name="telefone" value="123"></label> <button type="submit" class="save" id="btSalvar">Salvar</button></form>`;
  return chrome({ tab: 'Teste' }, '', `<div class="wrap"><div class="card">${tabela}</div>${form}</div>`) + (amb._comErro ? uiErroSalvar('Data inválida.', 'telefone') : '');
}

// Clique só em elemento à vista (nunca em escondido): rola até ele e confere que aparece na tela.
async function clicar(page, alvo) {
  const el = typeof alvo === 'string' ? page.locator(alvo) : alvo;
  await el.scrollIntoViewIfNeeded();
  assert.ok(await el.isVisible(), `clique em elemento escondido: ${alvo}`);
  const b = await el.boundingBox(); const vp = page.viewportSize();
  assert.ok(b && b.y >= 0 && b.y + b.height <= vp.height + 1 && b.x >= 0 && b.x + b.width <= vp.width + 1, `elemento fora da tela: ${alvo}`);
  await el.click();
}
// Nada rola para o lado: a página e cada cartão/tabela.
async function semRolagemLateral(page) {
  return page.evaluate(() => {
    const ruins = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) ruins.push(`página (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    for (const el of document.querySelectorAll('.card, .tb, .tb table, .tb tr, .tb td')) {
      if (el.offsetParent === null) continue;
      if (el.scrollWidth > el.clientWidth + 1) ruins.push(`${el.tagName.toLowerCase()}.${el.className} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return ruins;
  });
}
const textoRuim = (page) => page.evaluate(() => (document.body.innerText.match(/(^|\s)(undefined|null|NaN)(\s|$)/) || [])[0] || '');

async function abrir(navegador, opcoes, html) {
  const ctx = await navegador.newContext(opcoes);
  const page = await ctx.newPage();
  const errosJs = [];
  page.on('pageerror', (e) => errosJs.push(String(e && e.message || e)));
  await page.route('**/*', (r) => r.abort()); // nada sai para a rede (fontes, logo)
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errosJs };
}
const linhasVisiveis = (page) => page.$$eval('#tbT tbody tr[data-l]', (trs) => trs.filter(t => !t.hidden).map(t => t.querySelector('td[data-k="nome"]').textContent.trim()));

test('VIS-02/03/06 tabela padrão e janela de erro — computador (1366 px) e celular (390 px)', { timeout: 120000 }, async () => {
  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { assert.fail('pacote playwright ausente (no CI ele é instalado no job "Telas")'); }
  const amb = ambienteIsolado();
  const navegador = await chromium.launch();
  try {
    const html = paginaDeTeste(amb);
    for (const [aparelho, opcoes] of [['computador', { viewport: { width: 1366, height: 900 } }], ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
      const { ctx, page, errosJs } = await abrir(navegador, opcoes, html);
      const msg = (m) => `[${aparelho}] ${m}`;
      // páginas: 30 itens, 10 por página
      assert.strictEqual((await linhasVisiveis(page)).length, 10, msg('10 por página'));
      assert.match(await page.textContent('#tbT .tb-pg'), /Página 1 de 3/, msg('página 1 de 3'));
      await clicar(page, '#tbT .tb-prox');
      assert.match(await page.textContent('#tbT .tb-pg'), /Página 2 de 3/, msg('próxima página'));
      // busca (sem acento acha com acento)
      await page.fill('#tbT .tb-q', 'debora');
      assert.deepStrictEqual(await linhasVisiveis(page), ['Débora Reis 4', 'Débora Reis 14', 'Débora Reis 24'], msg('busca ignora acento e volta à página 1'));
      assert.match(await page.textContent('#tbT .tb-conta'), /3 de 30 itens/, msg('contador da busca'));
      assert.strictEqual(await page.isVisible('#tbT .tb-pag'), false, msg('com uma página só, a barra de páginas some'));
      assert.strictEqual(await page.isVisible('#tbT .tb-vazio'), false, msg('com resultado, o aviso de vazio não aparece'));
      await page.fill('#tbT .tb-q', 'ninguém-com-esse-nome');
      assert.strictEqual(await page.isVisible('#tbT .tb-vazio'), true, msg('busca sem resultado avisa'));
      await page.fill('#tbT .tb-q', '');
      // ordenação por número
      if (aparelho === 'computador') {
        await clicar(page, '#tbT th[data-k="n"] .tb-ord');
        assert.strictEqual(await page.getAttribute('#tbT th[data-k="n"]', 'aria-sort'), 'ascending');
        await clicar(page, '#tbT th[data-k="n"] .tb-ord');
        assert.strictEqual(await page.getAttribute('#tbT th[data-k="n"]', 'aria-sort'), 'descending');
        await clicar(page, '#tbT th[data-k="n"] .info');
        assert.strictEqual(await page.getAttribute('#tbT th[data-k="n"]', 'aria-sort'), 'descending', msg('tocar no ⓘ não reordena'));
      } else {
        assert.strictEqual(await page.isVisible('#tbT thead'), false, msg('no celular o cabeçalho some (cartões)'));
        await page.selectOption('#tbT .tb-ordem', 'n:desc');
      }
      const valores = await page.$$eval('#tbT tbody tr[data-l]', (trs) => trs.filter(t => !t.hidden).map(t => +t.querySelector('td[data-k="n"]').getAttribute('data-v')));
      assert.deepStrictEqual(valores, [...valores].sort((a, b) => b - a), msg('maior primeiro'));
      assert.strictEqual(valores[0], 30, msg('o maior valor no topo'));
      // nada rola para o lado, mesmo com texto longo sem espaço
      await page.fill('#tbT .tb-q', 'Débora Reis 4');
      assert.deepStrictEqual(await semRolagemLateral(page), [], msg('nada rola para o lado'));
      // janela de erro ao salvar: abre, marca o campo e devolve o foco
      await clicar(page, '#btSalvar');
      await page.waitForSelector('#sfErroSalvar', { state: 'visible' });
      assert.match(await page.textContent('#sfErroSalvar'), /Telefone inválido: use DDD \+ número\./);
      assert.ok(await page.$eval('[name=telefone]', (i) => i.classList.contains('campo-erro') && i.getAttribute('aria-invalid') === 'true'), msg('campo marcado'));
      await clicar(page, '#sfErroOk');
      assert.strictEqual(await page.$('#sfErroSalvar'), null, msg('a janela fecha'));
      assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.name), 'telefone', msg('o foco volta ao campo'));
      await page.type('[name=telefone]', '4');
      assert.strictEqual(await page.$eval('[name=telefone]', (i) => i.classList.contains('campo-erro')), false, msg('ao corrigir, a marca sai'));
      assert.strictEqual(await textoRuim(page), '', msg('sem undefined/null/NaN na tela'));
      assert.deepStrictEqual(errosJs, [], msg('sem erro de JavaScript'));
      await ctx.close();
    }
    // erro vindo do servidor (formulário clássico): a janela abre sozinha ao carregar
    amb._comErro = true;
    const { ctx, page, errosJs } = await abrir(navegador, { viewport: { width: 390, height: 844 }, isMobile: true }, paginaDeTeste(amb));
    await page.waitForSelector('#sfErroSalvar', { state: 'visible' });
    assert.match(await page.textContent('#sfErroSalvar'), /Data inválida\./);
    assert.ok(await page.$eval('[name=telefone]', (i) => i.classList.contains('campo-erro')));
    assert.deepStrictEqual(errosJs, []);
    await ctx.close();
  } finally { await navegador.close(); amb.limpar(); }
});

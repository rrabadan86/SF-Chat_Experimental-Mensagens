// Peças do padrão visual (painel-componentes.js): o HTML que a tabela padrão e a
// janela de erro geram. O comportamento no navegador (buscar, ordenar, páginas,
// cartão no celular, janela) é conferido em testes/tela/componentes.test.js.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const C = require(path.resolve(__dirname, '..', '..', 'src', 'painel-componentes.js'));

const colunas = [
  { chave: 'nome', titulo: 'Nome', celular: 'titulo' },
  { chave: 'n', titulo: 'Aulas', num: true, info: 'Quantas aulas no mês.' },
  { chave: 'obs', titulo: 'Obs', celular: 'oculto', ordenar: false },
];

test('VIS-03 tabela padrão: busca, ordenação, páginas e rótulo de cada coluna para o cartão do celular', () => {
  const h = C.uiTabela({ id: 'tb1', colunas, linhas: [{ nome: 'Ana', n: 3, obs: 'x' }], porPagina: 10, ordem: { chave: 'n', dir: 'desc' } });
  assert.match(h, /data-tb data-pp="10" data-ordem="n:desc"/);
  assert.match(h, /class="tb-q"/, 'tem busca');
  assert.match(h, /<td data-k="nome" data-rot="Nome" data-v="Ana" class="tb-tit">Ana<\/td>/, 'nome vira o título do cartão');
  assert.match(h, /data-k="obs" data-rot="Obs" data-v="x" class="tb-pc"/, 'coluna só do computador');
  assert.match(h, /<th scope="col" data-k="n" class="num" aria-sort="descending"><button type="button" class="tb-ord">Aulas<span class="tb-seta" aria-hidden="true"><\/span><\/button> <span class="info"/, 'ⓘ fora do botão de ordenar');
  assert.doesNotMatch(h, /data-k="obs"[^>]*aria-sort/, 'coluna que não ordena não tem botão');
  assert.match(h, /<select class="tb-ordem"[^>]*><option value="nome:asc">Nome ↑<\/option>/, 'no celular ordena por um seletor');
});

test('VIS-03 tabela padrão: texto vindo de fora é escapado; html só quando a tela pede', () => {
  const h = C.uiTabela({ colunas, linhas: [{ nome: '<img src=x onerror=alert(1)>', n: { html: '<b>7</b>', valor: 7 }, obs: '' }] });
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /data-k="n" data-rot="Aulas" data-v="7" class="num"><span class="tb-rot">Aulas <span class="info"[^]*?<\/span><\/span><span class="tb-val"><b>7<\/b><\/span>/, 'no celular o rótulo leva o ⓘ junto');
  assert.match(h, /data-k="obs"[^>]*><span class="tb-rot">Obs<\/span><span class="tb-val">—<\/span><\/td>/, 'vazio vira travessão');
});

test('VIS-03 tabela vazia mostra o texto de vazio; sem busca quando pedido', () => {
  const h = C.uiTabela({ colunas, linhas: [], vazio: 'Ninguém ainda.', busca: false });
  assert.match(h, /<p class="tb-vazio">Ninguém ainda\.<\/p>/);
  assert.doesNotMatch(h, /class="tb-q"/);
});

test('VIS-06 erro ao salvar vindo do servidor abre a janela e não quebra o script com texto malicioso', () => {
  const h = C.uiErroSalvar('Telefone inválido </script><script>alert(1)</script>', 'telefone');
  assert.match(h, /window\.sfErroSalvar\(/);
  assert.match(h, /\{campo:"telefone"\}/);
  assert.strictEqual((h.match(/<\/script>/g) || []).length, 1, 'só o fechamento do próprio script');
  assert.strictEqual(C.uiErroSalvar(''), '');
});

test('VIS-02 a tabela não usa rolagem lateral; no celular vira cartão', () => {
  assert.doesNotMatch(C.CSS, /overflow-x:\s*auto/);
  assert.match(C.CSS, /@media\(max-width:640px\)\{[^]*\.tb thead\{display:none\}/);
  assert.match(C.CSS, /\.tb \[hidden\],\.tb tr\[hidden\]\{display:none!important\}/, 'o que a tabela esconde (linha, páginas, vazio) não reaparece pelo CSS');
});

test('VIS-02 o script que vai para o navegador mantém as barras das expressões (\\s, acentos)', () => {
  // dentro do texto do servidor, "\\s" vira "s" se faltar barra — e os rótulos perderiam as letras "s"
  assert.match(C.SCRIPT, /textContent\.replace\(\/\\s\+\/g,' '\)/);
  assert.match(C.SCRIPT, /\[\\u0300-\\u036f\]/);
});

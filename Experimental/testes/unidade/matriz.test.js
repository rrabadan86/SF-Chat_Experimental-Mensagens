// A matriz docs/rastreabilidade.md não pode mentir: cada regra de .claude/rules/ tem uma
// linha; cada teste citado existe; cada teste com código no nome está na linha do código;
// o resumo está em dia. Quem confere é scripts/matriz.js (o mesmo do "npm run matriz").
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const M = require(path.resolve(__dirname, '..', '..', '..', 'scripts', 'matriz.js'));

const { erros, linhas, testes } = M.conferir();
const tipo = (re) => erros.filter(e => re.test(e));

test('TST-02 a matriz tem uma linha para cada código das regras, e só para eles', () => {
  assert.ok(linhas.length >= 90, 'matriz vazia ou fora do formato');
  assert.deepStrictEqual(tipo(/não tem linha|não existe em \.claude|mais de uma linha|definido mais de uma vez|cobertura/), []);
});

test('TST-02 a matriz só cita testes e arquivos que existem', () => {
  assert.deepStrictEqual(tipo(/não tem o teste|serve para|fora do formato|coluna Onde|sem teste citado|está ❌/), []);
});

test('TST-02 a matriz: todo teste com código no nome está na linha do seu código', () => {
  assert.ok(testes.some(t => t.codigos.length), 'nenhum teste com código no nome?');
  assert.deepStrictEqual(tipo(/no nome mas não está|não existe nas regras/), []);
  // o leitor de códigos entende as formas curtas usadas nos títulos
  assert.deepStrictEqual(M.codigosDoTitulo('PAI-01..04 cada perfil'), ['PAI-01', 'PAI-02', 'PAI-03', 'PAI-04']);
  assert.deepStrictEqual(M.codigosDoTitulo('VIS-02/03/06 tabela'), ['VIS-02', 'VIS-03', 'VIS-06']);
  assert.deepStrictEqual(M.codigosDoTitulo('FUP-03 ENV-01 manda'), ['FUP-03', 'ENV-01']);
  assert.deepStrictEqual(M.codigosDoTitulo('telefone com o 9 e 62-99999'), []);
});

test('TST-02 a matriz: o resumo está em dia (cd Experimental && npm run matriz)', () => {
  assert.ok(M.resumoEmDia(), 'resumo velho — rode: cd Experimental && npm run matriz');
  assert.deepStrictEqual(erros, [], 'a matriz tem problemas:\n' + erros.join('\n'));
});

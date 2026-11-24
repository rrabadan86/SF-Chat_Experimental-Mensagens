// Toda chamada das telas (fetch e formulário) precisa ter uma rota no servidor. Em
// 23/11/2026 a limpeza do Instagram (#433) apagou sem querer a rota /envio/ativo: os
// botões "Ativado/Desligado" dos envios (WhatsApp e Cobrança da SoFIA) passaram a dar
// "Falha de conexão ao salvar" e ninguém conseguia desligar uma cobrança.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');

test('PAI-02 todo fetch e formulário das telas chama uma rota que existe no servidor', () => {
  const arqs = fs.readdirSync(SRC).filter(f => /^(painel-.*|slimclub-paginas|formularios-paginas)\.js$/.test(f));
  const src = arqs.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const rotas = new Set(), prefixos = [];
  for (const m of src.matchAll(/\b(?:url|u|p|path|rota)\s*===\s*'(\/[^']*)'/g)) rotas.add(m[1]);
  for (const m of src.matchAll(/\b(?:url|u|p|path|rota)\.startsWith\('(\/[^']*)'\)/g)) prefixos.push(m[1]);
  const chamadas = new Set();
  for (const m of src.matchAll(/fetch\(\s*['"](\/[a-zA-Z0-9_\-/.]*)/g)) chamadas.add(m[1]);
  for (const m of src.matchAll(/action=\\?["'](\/[a-zA-Z0-9_\-/.]*)/g)) chamadas.add(m[1]);
  assert.ok(chamadas.size > 50 && rotas.size > 100, `leitura do código falhou (${chamadas.size} chamadas, ${rotas.size} rotas)`);
  const semRota = [...chamadas].filter(c => !rotas.has(c) && !prefixos.some(p => c.startsWith(p))).sort();
  assert.deepStrictEqual(semRota, [], 'a tela chama uma rota que o servidor não tem');
});

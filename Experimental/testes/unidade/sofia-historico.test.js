// SOF-13: quem já fez aula experimental (etiqueta do painel) — a SoFIA não volta a
// perguntar da aula antiga e convida para uma "aula para relembrar" (gratuita).
// A instrução fica no TypeScript (contextoHistorico em ChatBot/sofia.ts): conferida pelo texto.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..', '..');

function blocoFezExp() {
  const sofia = fs.readFileSync(path.join(RAIZ, 'ChatBot', 'sofia.ts'), 'utf8');
  const ini = sofia.indexOf('if (h === "fezexp") return `');
  assert.ok(ini > 0, 'contextoHistorico tem o bloco de quem já fez experimental');
  return sofia.slice(ini, sofia.indexOf('`;', ini));
}

test('SOF-13 já fez experimental: não pergunta da aula antiga, convida para a aula para relembrar (gratuita) e vai direto se ela quer marcar', () => {
  const b = blocoFezExp();
  assert.match(b, /NUNCA pergunte como foi \/ o que ela achou da aula experimental/);
  assert.doesNotMatch(b, /Pergunte com leveza o que ela achou/, 'a instrução antiga não pode voltar');
  assert.match(b, /\*aula para relembrar\* é \*gratuita\*/);
  assert.match(b, /Chame sempre de "aula para relembrar"/);
  assert.match(b, /JÁ disse que quer marcar[^\n]*DIRETO ao agendamento na mesma mensagem/);
  assert.match(b, /numa mensagem só \(sem "tudo bem com você\?" em balão separado\)/);
  // o painel descreve o mesmo comportamento
  const painel = fs.readFileSync(path.join(RAIZ, 'Experimental', 'src', 'painel-sofia.js'), 'utf8');
  assert.match(painel, /<b>Já fez experimental:<\/b> não volta a perguntar da aula antiga; convida para uma <b>aula para relembrar<\/b> \(gratuita\)/);
});

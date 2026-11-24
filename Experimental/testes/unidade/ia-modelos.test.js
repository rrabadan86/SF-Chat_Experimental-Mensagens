// SOF-11: modelos da IA escolhidos no painel. Haiku 5.5 só para extração (resumos,
// tags, ficha, frases) — nunca para a conversa — e sempre sem "pensar" antes, porque
// as chamadas curtas (120–300 tokens) ficariam sem resposta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambienteIsolado } = require('../ajuda');
const CHATBOT = path.resolve(__dirname, '..', '..', '..', 'ChatBot');

test('SOF-11 modelos: Haiku 5.5 vale para extração e é recusado na conversa (painel grava, lista da conversa não mostra)', () => {
  const amb = ambienteIsolado();
  try {
    const ed = amb.req('sofia-editor');
    assert.deepStrictEqual(ed.gravarModelos({ conversa: 'claude-haiku-5-5', extracao: 'claude-haiku-5-5' }), { conversa: 'claude-sonnet-5', extracao: 'claude-haiku-5-5' });
    assert.deepStrictEqual(ed.lerModelos(), { conversa: 'claude-sonnet-5', extracao: 'claude-haiku-5-5' });
    amb.gravarSofia('sofia-modelo.json', { conversa: 'claude-haiku-5-5', extracao: 'claude-haiku-4-5-20251001' }); // editado à mão
    assert.deepStrictEqual(ed.lerModelos(), { conversa: 'claude-sonnet-5', extracao: 'claude-haiku-4-5-20251001' });
    assert.strictEqual(ed.gravarModelos({ conversa: 'claude-opus-5', extracao: 'inventado' }).extracao, 'claude-sonnet-5');
    const painel = fs.readFileSync(path.join(amb.exp, 'src', 'painel-sofia.js'), 'utf8');
    assert.match(painel, /name="modeloConversa"[^\n]*modelosValidos\.filter\(m => !m\.soExtracao\)/);
  } finally { amb.limpar(); }
});

test('SOF-11 SoFIA: mesma lista que o painel, Haiku 5.5 fora da conversa e todas as chamadas da API com semPensar', () => {
  const sofia = fs.readFileSync(path.join(CHATBOT, 'sofia.ts'), 'utf8');
  const lista = JSON.parse((/const MODELOS_VALIDOS = (\[[^\]]*\]);/.exec(sofia) || [])[1] || '[]');
  const amb = ambienteIsolado();
  try {
    const doPainel = amb.req('sofia-editor').MODELOS_VALIDOS.map((m) => m.id);
    assert.deepStrictEqual(lista.slice().sort(), doPainel.slice().sort(), 'sofia.ts e sofia-editor.js com a mesma lista');
  } finally { amb.limpar(); }
  assert.match(sofia, /const SO_EXTRACAO = \["claude-haiku-5-5"\];/);
  assert.match(sofia, /!\(qual === "conversa" && SO_EXTRACAO\.includes\(m\)\)/);
  const chamadas = sofia.split('anthropic.messages.create({').slice(1);
  assert.ok(chamadas.length >= 8);
  for (const c of chamadas) assert.match(c.slice(0, 160), /^\s*model: (\w+),\n\s*\.\.\.semPensar\(\1\),/, 'chamada sem semPensar: ' + c.slice(0, 80));
  assert.match(sofia, /haiku55: \{ in: 0\.1, out: 0\.5 \}/, 'custo estimado com o preço do Haiku 5.5');
});

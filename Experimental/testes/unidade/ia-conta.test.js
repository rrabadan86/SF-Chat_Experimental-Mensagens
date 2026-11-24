// SOF-09: IA sem crédito / chave recusada (ia-conta.js, usado pela SoFIA).
// SOF-10: a SoFIA só leva as ferramentas dela para a IA (sofia.ts: tools: []).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { motivoDeConta, criarAvisoConta } = require(path.resolve(__dirname, '..', '..', 'src', 'ia-conta.js'));
const CHATBOT = path.resolve(__dirname, '..', '..', '..', 'ChatBot');

test('SOF-09 IA parada: reconhece falta de crédito e chave recusada (do Agent SDK e da API), e não confunde com erro passageiro', () => {
  // como apareceu no log do Park Sul em 23–24/11/2026
  assert.strictEqual(motivoDeConta(new Error('Claude Code returned an error result: Credit balance is too low')), 'sem-credito');
  assert.strictEqual(motivoDeConta({ status: 400, message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}' }), 'sem-credito');
  assert.strictEqual(motivoDeConta({ status: 401, error: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }), 'chave-recusada');
  for (const passageiro of [{ status: 529, message: 'Overloaded' }, { status: 429, message: 'rate_limit_error' }, new Error('Agent SDK result de erro: error_max_turns'), null, undefined, '']) {
    assert.strictEqual(motivoDeConta(passageiro), '', JSON.stringify(passageiro && (passageiro.message || passageiro)));
  }
});

test('SOF-09 IA parada: avisa a equipe uma vez por episódio; depois que a IA volta, um novo episódio avisa de novo', async () => {
  const avisos = [];
  const conta = criarAvisoConta((titulo, corpo, motivo) => { avisos.push({ titulo, corpo, motivo }); });
  const semCredito = new Error('Claude Code returned an error result: Credit balance is too low');
  assert.strictEqual(conta.falhou(semCredito), 'sem-credito');
  conta.falhou(semCredito); conta.falhou(semCredito);
  assert.strictEqual(conta.falhou({ status: 529, message: 'Overloaded' }), '', 'erro passageiro não é da conta');
  assert.strictEqual(avisos.length, 1, 'um aviso só no episódio');
  assert.match(avisos[0].titulo, /sem credito/i);
  assert.match(avisos[0].corpo, /console\.anthropic\.com/);
  conta.ok(); // a IA voltou a responder
  conta.falhou(semCredito);
  assert.strictEqual(avisos.length, 2, 'parou de novo depois de voltar: avisa de novo');
  // aviso que falha não derruba a SoFIA
  const quebrado = criarAvisoConta(() => { throw new Error('ntfy fora'); });
  assert.strictEqual(quebrado.falhou(semCredito), 'sem-credito');
  const rejeitado = criarAvisoConta(async () => { throw new Error('ntfy fora'); });
  assert.strictEqual(rejeitado.falhou(semCredito), 'sem-credito');
  await new Promise((r) => setImmediate(r));
});

test('SOF-09 SoFIA: não repete a chamada quando a conta está parada e o listener manda o aviso pelo celular', () => {
  const sofia = fs.readFileSync(path.join(CHATBOT, 'sofia.ts'), 'utf8');
  const listener = fs.readFileSync(path.join(CHATBOT, 'sofia-listener.ts'), 'utf8');
  const retry = sofia.slice(sofia.indexOf('async function comRetry'), sofia.indexOf('async function comRetry') + 900);
  assert.match(retry, /contaIA\.falhou\(err\)/, 'comRetry confere o erro');
  assert.match(retry, /if \(motivoConta\)[^\n]*throw err/, 'e desiste na hora');
  assert.match(retry, /contaIA\.ok\(\)/, 'chamada que funcionou encerra o episódio');
  assert.match(listener, /definirAvisoContaIA\([^)]*\)\s*=>[^\n]*enviarNtfy\(/, 'o listener liga o aviso ao push (ntfy)');
});

test('SOF-10 SoFIA: só as ferramentas dela vão para a IA (sem as do Claude Code), na conversa e no simulador', () => {
  const sofia = fs.readFileSync(path.join(CHATBOT, 'sofia.ts'), 'utf8');
  const ini = sofia.indexOf('const options: ClaudeAgentOptions = {');
  const bloco = sofia.slice(ini, sofia.indexOf('\n};', ini));
  assert.match(bloco, /\n\s*tools: \[\],/, 'options da conversa com tools: []');
  assert.match(bloco, /mcpServers: \{ slimfit: servidor \}/);
  // simulador e conversa partem do mesmo options (não podem redefinir tools)
  assert.match(sofia, /const opc: ClaudeAgentOptions = \{ \.\.\.options,/);
  assert.match(sofia, /\? \{ \.\.\.options, resume:/);
  assert.doesNotMatch(sofia.replace(bloco, ''), /\btools: \[\s*"|tools: \{ type: ['"]preset/, 'ninguém liga as ferramentas do Claude Code de volta');
});

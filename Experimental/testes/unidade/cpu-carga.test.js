// Alerta de CPU alta do vigia (watchdog): só avisa com CPU alta por várias rodadas
// seguidas, conta o "steal" (CPU tirada pela hospedagem) e não fica liga-desliga.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ler, avaliar } = require('../../src/cpu-carga');

// amostra fictícia: a cada rodada passam 1000 "ticks"; `ocup`% ocupados e `steal`% roubados.
let t = 0, oc = 0, st = 0, em = 0;
const rodada = (ocup, steal = 0) => { t += 1000; st += steal * 10; oc += (100 - ocup - steal) * 10; em += 5 * 60000; return { total: t, ocioso: oc, steal: st, em }; };
const cfg = { limite: 85, rodadas: 3, cpus: 2, carga: [1.9, 1.8, 1.5] };

test('lê a linha "cpu" do /proc/stat', () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-cpu-')), 'stat');
  fs.writeFileSync(arq, 'cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3\n');
  const a = ler(arq);
  assert.strictEqual(a.total, 1000); assert.strictEqual(a.ocioso, 850); assert.strictEqual(a.steal, 0);
  assert.strictEqual(ler(arq + '-nao-existe'), null);
});

test('pico curto não alerta; 3 rodadas altas alertam; resolve só bem abaixo do limite', () => {
  let e = avaliar({}, rodada(10), cfg).estado;          // 1ª rodada: sem base de comparação
  let r = avaliar(e, rodada(95), cfg); e = r.estado;     // 1 alta
  assert.strictEqual(r.problema, null);
  r = avaliar(e, rodada(20), cfg); e = r.estado;         // caiu → zera
  assert.strictEqual(e.seguidas, 0);
  for (let i = 0; i < 2; i++) { r = avaliar(e, rodada(90), cfg); e = r.estado; assert.strictEqual(r.problema, null); }
  r = avaliar(e, rodada(60, 30), cfg); e = r.estado;     // 3ª alta, metade "roubada" pela hospedagem
  assert.ok(r.problema, 'deveria alertar na 3ª rodada alta');
  assert.deepStrictEqual(r.uso, { ocupada: 60, roubada: 30 });
  assert.match(r.problema.msg, /90%/); assert.match(r.problema.msg, /hospedagem/);
  r = avaliar(e, rodada(78), cfg); e = r.estado;         // um pouco abaixo de 85: continua avisando
  assert.ok(r.problema, 'não deveria "resolver" com 78%');
  r = avaliar(e, rodada(40), cfg); e = r.estado;         // bem abaixo → resolvido
  assert.strictEqual(r.problema, null); assert.strictEqual(e.seguidas, 0);
});

test('sem /proc/stat (outro sistema) não quebra nem alerta', () => {
  const r = avaliar({}, null, cfg);
  assert.strictEqual(r.problema, null); assert.strictEqual(r.uso, null);
});

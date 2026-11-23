// Início do WhatsApp do robô (wa-client.js). Em 11/2026, no Lago Sul 1, o WhatsApp não
// conectou depois de uma atualização ("Waiting failed: 30000ms exceeded") e não voltou
// mais sozinho: cada tentativa deixava um navegador aberto no mesmo perfil.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

// Roda o wa-client de verdade num processo à parte, com uma biblioteca de WhatsApp de
// mentira: as 2 primeiras tentativas falham como no servidor; a 3ª conecta.
const ROTEIRO = `
const path = require('path');
const fake = { criados: [], destruidos: 0, mortos: 0 };
class Client {
  constructor(opts) { this.options = opts; this.n = fake.criados.push(opts); this.ev = {};
    this.pupBrowser = { process: () => ({ exitCode: null, killed: false, kill: () => { fake.mortos++; } }) };
    this.pupPage = { evaluate: async () => ({ versao: '2.3000.1', socket: 'OPENING', stream: 'CONNECTING', online: true }) }; }
  on(e, f) { this.ev[e] = f; }
  async initialize() {
    if (this.n <= 2) throw new Error('Waiting failed: 30000ms exceeded');
    setTimeout(() => this.ev.ready && this.ev.ready(), 5);
  }
  async destroy() { fake.destruidos++; }
  async getState() { return 'CONNECTED'; }
}
const por = (m, exp) => { const f = require.resolve(m); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
por('whatsapp-web.js', { Client, LocalAuth: class { constructor(o) { this.o = o; } }, MessageMedia: class {} });
por(path.resolve('src/patch-wwebjs.js'), {});
por(path.resolve('src/notificar.js'), { alertar: async () => true, alertarResumo: async () => false });
const wa = require(path.resolve('src/wa-client.js'));
(async () => {
  const erros = [];
  for (let i = 0; i < 2; i++) { try { await wa.initWhatsApp(); } catch (e) { erros.push(e.message); } }
  const antes = { destruidos: fake.destruidos, pronto: wa.isReady() };
  await wa.initWhatsApp();
  console.log('RESULTADO' + JSON.stringify({ erros, antes, pronto: wa.isReady(), criados: fake.criados.length, destruidos: fake.destruidos, espera: fake.criados[0].authTimeoutMs }));
  process.exit(0);
})().catch((e) => { console.log('FALHOU ' + (e && e.stack)); process.exit(1); });
`;

test('WhatsApp do robô: espera 2 min para conectar e fecha o navegador de cada tentativa que falhou', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    fs.writeFileSync(path.join(amb.exp, 'roteiro.js'), ROTEIRO);
    const env = { ...process.env }; for (const k of ['WA_AUTH_TIMEOUT_MS', 'PAINEL_DEMO', 'WA_WEB_VERSION_FILE', 'WA_WEB_VERSION_URL']) delete env[k];
    const saida = execFileSync(process.execPath, ['roteiro.js'], { cwd: amb.exp, env, encoding: 'utf8', timeout: 50000 });
    const r = JSON.parse((/RESULTADO(.*)/.exec(saida) || [])[1] || 'null');
    assert.ok(r, 'o roteiro não terminou:\n' + saida);
    assert.deepStrictEqual(r.erros, ['Waiting failed: 30000ms exceeded', 'Waiting failed: 30000ms exceeded']);
    assert.strictEqual(r.antes.destruidos, 2, 'o navegador de cada tentativa que falhou foi fechado antes da seguinte');
    assert.strictEqual(r.antes.pronto, false);
    assert.strictEqual(r.pronto, true, 'a tentativa seguinte conecta');
    assert.strictEqual(r.criados, 3);
    assert.strictEqual(r.destruidos, 2, 'o cliente que conectou continua aberto');
    assert.strictEqual(r.espera, 120000, 'a biblioteca esperava só 30 s — pouco para servidor com várias unidades');
    assert.match(saida, /estado do WhatsApp Web na falha: página abriu \(versão 2\.3000\.1\) · conexão: OPENING · fluxo: CONNECTING · rede do navegador: ok/, 'o log diz em que ponto o WhatsApp parou');
  } finally { amb.limpar(); }
});

test('tela virtual: se o Xvfb morreu e deixou o arquivo para trás, o robô percebe (e abre o navegador sem tela)', () => {
  const amb = ambienteIsolado();
  try {
    const { servidorDeTelaVivo } = amb.req('tela');
    const procs = ['node\0src/scheduler.js\0', 'Xvfb\0:342\0-screen\0000\0001366x900x24\0-nolisten\0tcp\0', '/usr/bin/Xvfb\0:517\0-screen\0000\0001366x900x24\0', '/snap/chromium/chrome\0--display=:999\0'];
    assert.strictEqual(servidorDeTelaVivo('342', () => procs), true);
    assert.strictEqual(servidorDeTelaVivo('517', () => procs), true);
    assert.strictEqual(servidorDeTelaVivo('99', () => procs), false, 'o arquivo da tela existe, mas não há mais servidor para ela');
    assert.strictEqual(servidorDeTelaVivo('999', () => procs), false, 'navegador apontando para a tela não é o servidor da tela');
    assert.strictEqual(servidorDeTelaVivo('34', () => procs), false, ':34 não é :342');
    assert.strictEqual(servidorDeTelaVivo('342', () => { throw new Error('sem /proc'); }), null, 'sem conseguir conferir, não diz que morreu');
    assert.strictEqual(servidorDeTelaVivo('342', () => []), null);
  } finally { amb.limpar(); }
});

// Versão RESERVA do WhatsApp Web (wa-versao-reserva.js + wa-client.js). Em 23/11/2026 o
// WhatsApp Web mudou e a biblioteca deixou de perceber o QR: a página abria, mostrava o
// QR, mas a "conexão" ficava sem estado e tudo terminava em "Waiting failed". Todo QR
// novo (troca de número, login perdido) falhava, em todas as lojas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

// Robô de verdade com uma biblioteca de WhatsApp de mentira. FALHAS = quantas tentativas
// falham; SOCKET = o estado da conexão que a página mostra na falha.
const ROTEIRO = `
const path = require('path');
const fake = { criados: [] };
const FALHAS = +process.env.FALHAS, SOCKET = process.env.SOCKET;
class Client {
  constructor(opts) { this.options = opts; this.n = fake.criados.push(opts); this.ev = {};
    this.pupBrowser = { process: () => ({ exitCode: 0, killed: true, kill: () => {} }) };
    this.pupPage = { evaluate: async () => ({ versao: '2.3000.1055865300', socket: SOCKET, stream: '', online: true }) }; }
  on(e, f) { this.ev[e] = f; }
  async initialize() { if (this.n <= FALHAS) throw new Error('Waiting failed'); setTimeout(() => this.ev.ready && this.ev.ready(), 5); }
  async destroy() {}
  async getState() { return 'CONNECTED'; }
}
const por = (m, exp) => { const f = require.resolve(m); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
por('whatsapp-web.js', { Client, LocalAuth: class { constructor(o) { this.o = o; } }, MessageMedia: class {} });
por(path.resolve('src/patch-wwebjs.js'), {});
por(path.resolve('src/notificar.js'), { alertar: async () => true, alertarResumo: async () => false });
const wa = require(path.resolve('src/wa-client.js'));
(async () => {
  for (let i = 0; i < 4 && !wa.isReady(); i++) { try { await wa.initWhatsApp(); } catch (_) {} }
  console.log('RESULTADO' + JSON.stringify({ pronto: wa.isReady(), caches: fake.criados.map(o => o.webVersionCache) }));
  process.exit(0);
})().catch((e) => { console.log('FALHOU ' + (e && e.stack)); process.exit(1); });
`;
function rodar(amb, extra) {
  fs.writeFileSync(path.join(amb.exp, 'roteiro.js'), ROTEIRO);
  const env = { ...process.env, ...extra };
  for (const k of ['PAINEL_DEMO', 'WA_WEB_VERSION_FILE', 'WA_WEB_VERSION_URL', 'WA_WEB_VERSION_RESERVA']) if (!(k in extra)) delete env[k];
  const saida = execFileSync(process.execPath, ['roteiro.js'], { cwd: amb.exp, env, encoding: 'utf8', timeout: 50000 });
  const r = JSON.parse((/RESULTADO(.*)/.exec(saida) || [])[1] || 'null');
  assert.ok(r, 'o roteiro não terminou:\n' + saida);
  return { r, saida, marcador: path.join(amb.data, 'wa-versao-reserva.json') };
}

test('robô: a versão ao vivo abre mas a conexão fica sem estado → a tentativa seguinte usa a versão reserva', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    const { r, saida, marcador } = rodar(amb, { FALHAS: '1', SOCKET: '' });
    assert.strictEqual(r.pronto, true);
    assert.strictEqual(r.caches[0].type, 'none', '1ª tentativa: ao vivo');
    assert.deepStrictEqual(r.caches[1], { type: 'remote', remotePath: amb.req('wa-versao-reserva').URL_PADRAO }, '2ª tentativa: reserva');
    assert.match(saida, /abriu mas não chegou no QR — a próxima tentativa usa a versão reserva/);
    assert.ok(fs.existsSync(marcador), 'o marcador vale para as próximas subidas também');
  } finally { amb.limpar(); }
});

test('robô: conexão presa em "abrindo" não é culpa da versão — continua na ao vivo', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    const { r, marcador } = rodar(amb, { FALHAS: '1', SOCKET: 'OPENING' });
    assert.deepStrictEqual(r.caches.map(c => c.type), ['none', 'none']);
    assert.ok(!fs.existsSync(marcador));
  } finally { amb.limpar(); }
});

test('robô: nem a reserva funcionou → volta para a ao vivo; versão fixa no .env manda mais que a reserva', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    const { r, saida } = rodar(amb, { FALHAS: '2', SOCKET: '' });
    assert.deepStrictEqual(r.caches.map(c => c.type), ['none', 'remote', 'none']);
    assert.match(saida, /nem a versão reserva do WhatsApp Web chegou no QR/);
    // desligada no .env: nunca usa a reserva
    const d = rodar(amb, { FALHAS: '1', SOCKET: '', WA_WEB_VERSION_RESERVA: 'off' });
    assert.deepStrictEqual(d.r.caches.map(c => c.type), ['none', 'none']);
  } finally { amb.limpar(); }
});

test('reserva: o marcador vale 7 dias e a URL pode ser trocada', () => {
  const amb = ambienteIsolado();
  try {
    const R = amb.req('wa-versao-reserva');
    const arq = path.join(amb.data, 'marcador.json');
    assert.strictEqual(R.ativa(arq), null);
    R.marcar(arq, '2.3000.9', 1000);
    assert.strictEqual(R.ativa(arq, 1000 + 6 * 86400000).versao, '2.3000.9');
    assert.strictEqual(R.ativa(arq, 1000 + 7 * 86400000), null, 'depois de 7 dias tenta a ao vivo de novo');
    assert.strictEqual(R.url({}), R.URL_PADRAO);
    assert.strictEqual(R.url({ WA_WEB_VERSION_RESERVA: 'https://exemplo/x.html' }), 'https://exemplo/x.html');
    assert.strictEqual(R.url({ WA_WEB_VERSION_RESERVA: 'off' }), '');
    assert.strictEqual(R.falhaDeVersao({ versao: '2.3000.1', socket: '' }), true);
    assert.strictEqual(R.falhaDeVersao({ versao: '', socket: '' }), false, 'a página nem abriu: é outra coisa');
    assert.strictEqual(R.falhaDeVersao({ versao: '2.3000.1', socket: 'OPENING' }), false);
  } finally { amb.limpar(); }
});

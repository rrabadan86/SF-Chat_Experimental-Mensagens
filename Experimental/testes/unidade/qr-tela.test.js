// SOF-08: QR pela tela. Desde o WhatsApp Web 2.3000.1055969240 (24/11/2026) quem está sem
// login cai na tela nova de entrada; o QR está na página, mas a biblioteca não avisa.
// wa-qr-tela.js copia o QR da página para o painel e percebe quando escanearam.
// (A leitura da página em si, num navegador de verdade: testes/tela/qr-tela.test.js.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');
const { esperarQrPelaTela } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-qr-tela.js'));

// Página de mentira: cada leitura devolve o próximo item (Error = página trocando).
function pagina(leituras) {
  let i = 0;
  return { evaluate: async () => { const r = leituras[Math.min(i++, leituras.length - 1)]; if (r instanceof Error) throw r; return r; } };
}
function relogio() { let t = 0; return { agora: () => t, dormir: async (ms) => { t += ms; } }; }
const naEntrada = (img) => ({ img, naTelaDeLogin: true, conexao: '', caminho: '/login/' });
const entrou = { img: '', naTelaDeLogin: false, conexao: '', caminho: '/' };

test('SOF-08 QR pela tela: copia o QR da página para o painel (só quando muda) e percebe quando escanearam', async () => {
  const qrs = [], r = relogio();
  const res = await esperarQrPelaTela(pagina([
    new Error('Execution context was destroyed'), naEntrada('A'), naEntrada('A'), naEntrada('B'),
    naEntrada(''), // QR sendo redesenhado: não é login
    naEntrada('B'), entrou, entrou,
  ]), { aoQr: (img) => qrs.push(img), ...r });
  assert.strictEqual(res, 'entrou');
  assert.deepStrictEqual(qrs, ['A', 'B']);
});

test('SOF-08 QR pela tela: uma leitura sem QR fora da entrada não basta; sem QR nenhum desiste em 45 s; página muda depois do QR → sobe de novo', async () => {
  let r = relogio();
  const umaSo = await esperarQrPelaTela(pagina([naEntrada('A'), entrou, naEntrada('A'), entrou, { ...entrou, conexao: 'CONNECTED' }]), { aoQr: () => {}, ...r });
  assert.strictEqual(umaSo, 'entrou', 'só com 2 leituras seguidas fora da entrada');
  r = relogio();
  assert.strictEqual(await esperarQrPelaTela(pagina([naEntrada('')]), { aoQr: () => {}, ...r }), 'sem-qr');
  assert.ok(r.agora() > 45000 && r.agora() < 60000);
  r = relogio();
  assert.strictEqual(await esperarQrPelaTela(pagina([naEntrada('A'), new Error('Target closed')]), { aoQr: () => {}, ...r }), 'entrou', 'a página parou depois do QR: fecha e sobe de novo');
  r = relogio();
  assert.strictEqual(await esperarQrPelaTela(pagina([new Error('Target closed')]), { aoQr: () => {}, ...r }), 'sem-qr');
  // só entra no QR pela tela quando a falha foi na tela de entrada (página "oca" sem ela segue o caminho normal)
  const { ehTelaDeEntrada } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-qr-tela.js'));
  assert.strictEqual(ehTelaDeEntrada({ versao: '2.3000.1055969240', socket: '', tela: 'Scan to log in Link with phone number instead' }), true);
  assert.strictEqual(ehTelaDeEntrada({ versao: '2.3000.1055969240', socket: '', tela: 'WhatsApp End-to-end encrypted' }), false);
  assert.strictEqual(ehTelaDeEntrada({ versao: '2.3000.1055969240', socket: 'CONNECTED', tela: 'Scan to log in' }), false);
});

// Robô de verdade com WhatsApp de mentira: a 1ª subida cai na tela nova de entrada.
const ROTEIRO = `
const path = require('path');
const fake = { criados: 0, status: [], alertas: [], leituras: JSON.parse(process.env.LEITURAS) };
class Client {
  constructor() { this.n = ++fake.criados; this.ev = {};
    this.pupBrowser = { process: () => ({ exitCode: 0, killed: true, kill: () => {} }) };
    this.pupPage = { evaluate: async (fn) => {
      if (fn && fn.name === 'lerTela') return fake.leituras.length > 1 ? fake.leituras.shift() : fake.leituras[0];
      return { versao: '2.3000.1055969240', socket: '', stream: '', online: true, tela: 'Scan to log in Link with phone number instead' };
    } }; }
  on(e, f) { this.ev[e] = f; }
  async initialize() { if (this.n === 1) throw new Error('Waiting failed: 120000ms exceeded'); setTimeout(() => this.ev.ready && this.ev.ready(), 5); }
  async destroy() {}
  async getState() { return 'CONNECTED'; }
}
const por = (m, exp) => { const f = require.resolve(m); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
por('whatsapp-web.js', { Client, LocalAuth: class { constructor(o) { this.o = o; } }, MessageMedia: class {} });
por(path.resolve('src/patch-wwebjs.js'), {});
por(path.resolve('src/notificar.js'), { alertar: async (t) => { fake.alertas.push(t); return true; }, alertarResumo: async () => false });
por(path.resolve('src/wa-status.js'), { set: (e, qr) => fake.status.push(qr ? e + ':' + qr : e), get: () => ({}), ARQUIVO: '' });
const wa = require(path.resolve('src/wa-client.js'));
(async () => {
  await wa.initWhatsApp();
  console.log('RESULTADO' + JSON.stringify({ pronto: wa.isReady(), criados: fake.criados, status: fake.status, alertas: fake.alertas }));
  process.exit(0);
})().catch((e) => { console.log('FALHOU ' + (e && e.stack)); process.exit(1); });
`;

test('SOF-08 robô: na tela nova de entrada mostra o QR da página no painel, avisa uma vez e, escaneado, sobe de novo com o login salvo', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    fs.writeFileSync(path.join(amb.exp, 'roteiro.js'), ROTEIRO);
    const leituras = [naEntrada('data:image/png;base64,QR1'), naEntrada('data:image/png;base64,QR2'), entrou, entrou];
    const env = { ...process.env, LEITURAS: JSON.stringify(leituras), WA_QR_TELA_GRAVAR_MS: '10' };
    for (const k of ['PAINEL_DEMO', 'WA_WEB_VERSION_FILE', 'WA_WEB_VERSION_URL', 'WA_WEB_VERSION_RESERVA']) delete env[k];
    const saida = execFileSync(process.execPath, ['roteiro.js'], { cwd: amb.exp, env, encoding: 'utf8', timeout: 50000 });
    const r = JSON.parse((/RESULTADO(.*)/.exec(saida) || [])[1] || 'null');
    assert.ok(r, 'o roteiro não terminou:\n' + saida);
    assert.strictEqual(r.pronto, true, 'conectou na 2ª subida');
    assert.strictEqual(r.criados, 2);
    assert.deepStrictEqual(r.status.filter(s => s.startsWith('qr:')), ['qr:data:image/png;base64,QR1', 'qr:data:image/png;base64,QR2']);
    assert.deepStrictEqual(r.alertas, ['WhatsApp CAIU — precisa de QR'], 'um aviso só');
    assert.match(saida, /QR pela tela: login feito/);
  } finally { amb.limpar(); }
});

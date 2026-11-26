// ENV-09: WhatsApp do robô "oco" (a página abriu sem as peças internas). Em 23/11/2026 o
// robô da Lago Sul 2 passou horas assim — "keep-alive falhou: ... (reading 'Socket')" a
// cada 15 min, parecendo online, sem enviar nada e sem avisar ninguém — e perdeu o login.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

// Robô de verdade com uma biblioteca de WhatsApp de mentira. O relógio do keep-alive
// (15 min) é capturado e disparado à mão. OCO = quantas verificações falham; ERRO = a falha.
const ROTEIRO = `
const path = require('path');
const fake = { criados: 0, alertas: [], oco: +process.env.OCO, pecas: !process.env.CARGA_FALHA, cargaFalha: +(process.env.CARGA_FALHA || 0) };
// a página: "tem as peças?" responde fake.pecas; carregar (LoadUtils) falha CARGA_FALHA vezes
const avaliarPagina = async (fn) => {
  if (fn === LoadUtils) { if (fake.cargaFalha > 0) { fake.cargaFalha--; throw new Error('x is not a function'); } fake.pecas = true; return; }
  if (/WWebJS\.sendMessage/.test(String(fn))) return fake.pecas;
  return { versao: '2.3000.1055865300', socket: 'CONNECTED', stream: '', online: true };
};
function LoadUtils() {}
const ERRO = process.env.ERRO;
class Client {
  constructor() { fake.criados++; this.ev = {};
    this.pupBrowser = { process: () => ({ exitCode: 0, killed: true, kill: () => {} }) };
    this.pupPage = { evaluate: avaliarPagina }; }
  on(e, f) { this.ev[e] = f; }
  async initialize() { setTimeout(() => this.ev.ready && this.ev.ready(), 5); }
  async destroy() {}
  async getState() { if (fake.oco > 0) { fake.oco--; throw new Error(ERRO); } return 'CONNECTED'; }
}
const por = (m, exp) => { const f = require.resolve(m); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
por('whatsapp-web.js', { Client, LocalAuth: class { constructor(o) { this.o = o; } }, MessageMedia: class {} });
por(path.resolve('src/patch-wwebjs.js'), {});
for (const m of [require.resolve('whatsapp-web.js/src/util/Injected/Utils')]) require.cache[m] = { id: m, filename: m, loaded: true, exports: { LoadUtils } };
por(path.resolve('src/notificar.js'), { alertar: async (t) => { fake.alertas.push(t); return true; }, alertarResumo: async () => false });
let verificar = null;
const setIntervalReal = global.setInterval;
global.setInterval = (fn, ms, ...a) => {
  if (ms === 15 * 60 * 1000 && !verificar) { verificar = fn; return { unref() {} }; }
  return setIntervalReal(fn, ms, ...a);
};
const wa = require(path.resolve('src/wa-client.js'));
(async () => {
  await wa.initWhatsApp();
  const passos = [];
  for (let i = 0; i < +process.env.RODADAS; i++) {
    const antes = { clientes: fake.criados, alertas: fake.alertas.length };
    await verificar();
    passos.push({ religou: fake.criados > antes.clientes, avisou: fake.alertas.length > antes.alertas });
  }
  console.log('RESULTADO' + JSON.stringify({ passos, alertas: fake.alertas, pronto: wa.isReady() }));
  process.exit(0);
})().catch((e) => { console.log('FALHOU ' + (e && e.stack)); process.exit(1); });
`;
function rodar(amb, env) {
  fs.writeFileSync(path.join(amb.exp, 'roteiro.js'), ROTEIRO);
  const e = { ...process.env, ...env };
  for (const k of ['PAINEL_DEMO', 'WA_WEB_VERSION_FILE', 'WA_WEB_VERSION_URL', 'WA_WEB_VERSION_RESERVA']) delete e[k];
  const saida = execFileSync(process.execPath, ['roteiro.js'], { cwd: amb.exp, env: e, encoding: 'utf8', timeout: 50000 });
  const r = JSON.parse((/RESULTADO(.*)/.exec(saida) || [])[1] || 'null');
  assert.ok(r, 'o roteiro não terminou:\n' + saida);
  return { r, saida };
}

test('ENV-09 WhatsApp oco: na 2ª verificação seguida avisa a equipe UMA vez e religa; depois tenta de hora em hora; voltou → registra', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    // 7 verificações falham (cerca de 1h45) e a 8ª responde
    const { r, saida } = rodar(amb, { OCO: '7', ERRO: "Cannot read properties of null (reading 'Socket')", RODADAS: '8' });
    assert.deepStrictEqual(r.passos.map(p => p.avisou), [false, true, false, false, false, false, false, false], 'um aviso só, na 2ª falha');
    assert.deepStrictEqual(r.passos.map(p => p.religou), [false, true, false, false, false, true, false, false], 'religa no aviso e 1 h depois');
    assert.deepStrictEqual(r.alertas, ['WhatsApp do robo parou de responder']);
    assert.match(saida, /WhatsApp voltou a responder/);
    assert.strictEqual(r.pronto, true);
  } finally { amb.limpar(); }
});

test('ENV-09 conectado sem as peças da biblioteca (window.WWebJS): recarrega sozinho; sem conseguir, conta como falha e avisa na 2ª', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    // a carga falha nas 2 primeiras verificações e dá certo na 3ª
    const { r, saida } = rodar(amb, { OCO: '0', CARGA_FALHA: '2', RODADAS: '3' });
    assert.deepStrictEqual(r.passos.map(p => p.avisou), [false, true, false], 'aviso só na 2ª falha');
    assert.deepStrictEqual(r.alertas, ['WhatsApp do robo parou de responder']);
    assert.match(saida, /sem as peças do whatsapp-web\.js \(carregar as peças falhou: x is not a function\)/);
    assert.match(saida, /peças do whatsapp-web\.js faltavam na página — recarregadas/);
    assert.match(saida, /WhatsApp voltou a responder/);
  } finally { amb.limpar(); }
  // a peça em si, com uma página de mentira
  const { garantirPecas } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-client.js'));
  const pagina = (tem, falha) => { const p = { cargas: 0, evaluate: async (fn) => { if (fn === carregar) { p.cargas++; if (falha) throw new Error('quebrou'); tem = true; return; } return tem; } }; return p; };
  function carregar() {}
  return (async () => {
    const ja = pagina(true); assert.deepStrictEqual(await garantirPecas(ja, carregar), { ok: true }); assert.strictEqual(ja.cargas, 0, 'já tem: não recarrega');
    const falta = pagina(false); assert.deepStrictEqual(await garantirPecas(falta, carregar), { ok: true, recarregou: true });
    const ruim = await garantirPecas(pagina(false, true), carregar); assert.strictEqual(ruim.ok, false); assert.match(ruim.erro, /carregar as peças falhou: quebrou/);
    assert.match((await garantirPecas(null, carregar)).erro, /indisponível/);
  })();
});

test('ENV-09 uma falha solta só registra; erro passageiro religa na hora, sem alarme', { timeout: 60000 }, () => {
  const amb = ambienteIsolado();
  try {
    const solta = rodar(amb, { OCO: '1', ERRO: "Cannot read properties of null (reading 'Socket')", RODADAS: '3' }).r;
    assert.ok(solta.passos.every(p => !p.avisou && !p.religou), 'uma falha e volta: ninguém é acordado');
    const passageiro = rodar(amb, { OCO: '1', ERRO: 'Execution context was destroyed', RODADAS: '2' }).r;
    assert.deepStrictEqual(passageiro.passos.map(p => p.religou), [true, false]);
    assert.deepStrictEqual(passageiro.alertas, []);
  } finally { amb.limpar(); }
  // a decisão em si, sem robô
  const { avaliarKeepAlive: av } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-client.js'));
  let est = {}; const acoes = [];
  for (const ok of [false, false, true, false, false]) { const r = av(est, ok, false); est = r.est; acoes.push(r.acao); }
  assert.deepStrictEqual(acoes, ['nada', 'avisar', 'voltou', 'nada', 'avisar'], 'novo episódio, novo aviso');
});

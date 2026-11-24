// SOF-12: número em aquecimento + calma depois de conectar (sofia-aquecimento.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aq = require(path.resolve(__dirname, '..', '..', 'src', 'sofia-aquecimento.js'));
const CHATBOT = path.resolve(__dirname, '..', '..', '..', 'ChatBot');
const MEIO_DIA = (d) => Date.parse(d + 'T12:00:00-03:00');

test('SOF-12 aquecimento: liga por N dias (contando hoje), vale até o último dia e desliga', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teste-aquec-'));
  try {
    assert.strictEqual(aq.ativo(dir), false, 'sem arquivo: desligado');
    const st = aq.gravar(dir, 7, MEIO_DIA('2026-11-24'));
    assert.deepStrictEqual([st.desde, st.ate, st.dias], ['2026-11-24', '2026-11-30', 7]);
    assert.strictEqual(aq.ativo(dir, MEIO_DIA('2026-11-30')), true, 'último dia ainda vale');
    assert.strictEqual(aq.ativo(dir, MEIO_DIA('2026-12-01')), false, 'no dia seguinte acaba sozinho');
    assert.strictEqual(aq.gravar(dir, 99, MEIO_DIA('2026-11-24')).dias, 30, 'no máximo 30 dias');
    aq.gravar(dir, 0);
    assert.strictEqual(aq.ativo(dir, MEIO_DIA('2026-11-24')), false);
    fs.writeFileSync(path.join(dir, aq.ARQ), '{quebrado');
    assert.strictEqual(aq.ativo(dir), false, 'arquivo estragado = desligado');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SOF-12 envios que a SoFIA inicia: bloqueados em aquecimento e nos primeiros 30 min depois de conectar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teste-aquec-'));
  try {
    const agora = MEIO_DIA('2026-11-24');
    assert.strictEqual(aq.bloqueio({ dir, prontaDesde: 0, agora }), 'acabou-de-conectar', 'sem conexão registrada: espera');
    assert.strictEqual(aq.bloqueio({ dir, prontaDesde: agora - 29 * 60000, agora }), 'acabou-de-conectar');
    assert.strictEqual(aq.bloqueio({ dir, prontaDesde: agora - 31 * 60000, agora }), '');
    assert.strictEqual(aq.bloqueio({ dir, prontaDesde: agora - 31 * 60000, agora, quietoMin: 60 }), 'acabou-de-conectar', 'minutos ajustáveis');
    aq.gravar(dir, 3, agora);
    assert.strictEqual(aq.bloqueio({ dir, prontaDesde: agora - 5 * 3600e3, agora }), 'aquecimento');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SOF-12 SoFIA: cobrança, follow-up e campanha passam pela trava; responder quem escreve não', () => {
  const s = fs.readFileSync(path.join(CHATBOT, 'sofia-listener.ts'), 'utf8');
  const corpo = (nome) => { const i = s.indexOf(`async function ${nome}(`); return s.slice(i, i + 900); };
  assert.match(s, /client\.on\("ready", \(\) => \{ pronta = true; prontaDesde = Date\.now\(\);/);
  assert.match(corpo('processarCobranca'), /bloqueioEnvioAtivo\("cobrança"\)/);
  assert.match(corpo('processarCobranca'), /descartarCobrancasEmAquecimento\(\)/);
  assert.match(corpo('processarFollowups'), /bloqueioEnvioAtivo\("follow-up"\)/);
  assert.match(corpo('tickCampanha'), /bloqueioEnvioAtivo\(`campanha/);
  for (const livre of ['processarRespostas', 'processarAvisos']) assert.doesNotMatch(corpo(livre), /bloqueioEnvioAtivo/, `${livre} continua livre`);
  // descartada no aquecimento: fica no Log como não enviada e NÃO é marcada como avisada (o robô repõe)
  const desc = s.slice(s.indexOf('function descartarCobrancasEmAquecimento'), s.indexOf('function descartarCobrancasEmAquecimento') + 900);
  assert.match(desc, /registrarAtividadeCobranca\(ent, tel, .*, false, "não enviada/);
  assert.doesNotMatch(desc, /marcarCobrancaEnviada/);
});

test('SOF-08 SoFIA: depois do QR (ou do código), se já conectou NÃO reinicia; se reiniciar, fecha o navegador antigo de verdade', () => {
  const s = fs.readFileSync(path.join(CHATBOT, 'sofia-listener.ts'), 'utf8');
  const qr = s.slice(s.lastIndexOf('if (res === "entrou")'), s.lastIndexOf('if (res === "entrou")') + 1400); // o do QR
  const cod = s.slice(s.indexOf('if (res === "entrou")'), s.indexOf('if (res === "entrou")') + 600); // o do código
  assert.match(cod, /if \(pronta\) \{ log\("Código: conectada neste mesmo processo/);
  assert.match(qr, /while \(!pronta && Date\.now\(\) < ate\)/);
  assert.match(qr, /if \(pronta\) \{ log\("QR pela tela: conectada neste mesmo processo/);
  assert.match(qr, /await fecharNavegador\(\);\s*log\("subindo de novo/);
  const fn = s.slice(s.indexOf('async function fecharNavegador'), s.indexOf('async function fecharNavegador') + 500);
  assert.match(fn, /kill\("SIGKILL"\)/);
  assert.match(s, /qrTela\.pedirCodigoPelaTela\(pg, PAIR_BOOT\)/, 'código pela página no modo "conectar por código"');
});

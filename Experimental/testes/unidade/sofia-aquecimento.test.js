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
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'desligar apaga o arquivo e não deixa resto');
    aq.gravar(dir, 3, MEIO_DIA('2026-11-24'));
    assert.deepStrictEqual(fs.readdirSync(dir), [aq.ARQ], 'grava de uma vez (arquivo ao lado + troca): sem .tmp sobrando');
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
  assert.match(s, /aquecimento\.separarFila\(linhas\)/, 'a fila passa pelo separarFila');
  assert.match(s, /if \(r\.guardar\.length\) \{ try \{ fs\.appendFileSync\(COBRANCA_OUTBOX, r\.guardar\.join/, 'o que é para guardar volta para a fila');
  assert.match(corpo('processarFollowups'), /bloqueioEnvioAtivo\("follow-up"\)/);
  assert.match(corpo('tickCampanha'), /bloqueioEnvioAtivo\(`campanha/);
  for (const livre of ['processarRespostas', 'processarAvisos']) assert.doesNotMatch(corpo(livre), /bloqueioEnvioAtivo/, `${livre} continua livre`);
  // descartada no aquecimento: fica no Log como não enviada e NÃO é marcada como avisada (o robô repõe)
  const desc = s.slice(s.indexOf('function descartarCobrancasEmAquecimento'), s.indexOf('function descartarCobrancasEmAquecimento') + 1500);
  assert.match(desc, /registrarAtividadeCobranca\(ent, tel, .*, false, "não enviada/);
  assert.doesNotMatch(desc, /marcarCobrancaEnviada/);
});

test('SOF-08 SoFIA: depois do QR (ou do código), se já conectou NÃO reinicia; se reiniciar, fecha o navegador antigo de verdade', () => {
  const s = fs.readFileSync(path.join(CHATBOT, 'sofia-listener.ts'), 'utf8');
  const qr = s.slice(s.lastIndexOf('if (res === "entrou")'), s.lastIndexOf('if (res === "entrou")') + 1400); // o do QR
  const cod = s.slice(s.indexOf('if (res === "entrou")'), s.indexOf('if (res === "entrou")') + 600); // o do código
  assert.match(cod, /if \(await conexaoAposLogin\(\) === "pronto"\) \{ log\("Código: conectada neste mesmo processo/);
  assert.match(qr, /if \(await conexaoAposLogin\(\) === "pronto"\) \{ log\("QR pela tela: conectada neste mesmo processo/);
  assert.match(s, /qrTela\.esperarConexaoAposLogin\(\{\s*estaPronto: \(\) => pronta, autenticou: \(\) => autenticadaEm >= desde - 30000/);
  assert.match(qr, /await fecharNavegador\(\);\s*log\("subindo de novo/);
  const fn = s.slice(s.indexOf('async function fecharNavegador'), s.indexOf('async function fecharNavegador') + 500);
  assert.match(fn, /kill\("SIGKILL"\)/);
  assert.match(s, /qrTela\.pedirCodigoPelaTela\(pg, PAIR_BOOT\)/, 'código pela página no modo "conectar por código"');
});

test('SOF-12 fila de cobrança em aquecimento: cobrança é descartada (o robô repõe), aviso de "app reativado" fica guardado', () => {
  const cob = JSON.stringify({ idCliente: 7, telefone: '5561999990001', texto: 'boleto', tipo: 'boleto' });
  const app = JSON.stringify({ id: 'app-9-1', telefone: '5561999990002', texto: 'acesso reativado', tipo: 'app', chaveMsg: 'cobranca_app_reativado' });
  const r = aq.separarFila([cob, app, '{linha estragada', '']);
  assert.deepStrictEqual(r.guardar, [app], 'o robô grava esse aviso uma vez só: não pode se perder');
  assert.deepStrictEqual(r.descartar.map((e) => e.idCliente), [7]);
  assert.deepStrictEqual(aq.separarFila([app]).descartar, [], 'só avisos guardados: nada a descartar (não regrava o arquivo)');
  assert.deepStrictEqual(aq.separarFila(null), { guardar: [], descartar: [] });
});

test('SOF-12 bloqueio do app: com a SoFIA em aquecimento, o grupo da equipe é avisado de que precisa falar com a aluna', () => {
  const { textoGrupo } = require(path.resolve(__dirname, '..', '..', 'src', 'bloqueio-app.js'));
  const u = { dias: 11, bloqueadas: [], reativadas: [{ nome: 'ANA LUIZA COSTA', motivo: 'pagou', avisou: true }] };
  assert.match(textoGrupo(u, [], false), /a SoFIA avisou a aluna/);
  assert.match(textoGrupo(u, [], true), /SoFIA em aquecimento: o aviso dela só sai depois — avise a aluna/);
  assert.doesNotMatch(textoGrupo(u, [], true), /a SoFIA avisou a aluna/);
});

test('SOF-12 follow-up segurado pelo aquecimento fica anotado para a recepção: uma linha por pessoa, zera num aquecimento novo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teste-aquec-'));
  try {
    const t0 = MEIO_DIA('2026-11-24');
    aq.gravar(dir, 7, t0);
    const fila = (tel) => JSON.stringify({ tel, instrucao: 'retome', em: 1 });
    assert.strictEqual(aq.anotarFollowups(dir, [fila('5561999990001'), fila('(61) 99999-0002'), '{estragada', JSON.stringify({ instrucao: 'sem telefone' })], t0), 2);
    assert.strictEqual(aq.anotarFollowups(dir, [fila('5561999990001')], t0 + 3600e3), 1, 'a mesma pessoa de novo, mais tarde');
    assert.strictEqual(aq.anotarFollowups(dir, [], t0), 0);
    const lista = aq.lerFollowups(dir);
    assert.deepStrictEqual(lista.map((f) => [f.tel, f.vezes]), [['5561999990001', 2], ['61999990002', 1]], 'uma linha por telefone, a mais recente primeiro');
    assert.strictEqual(lista[0].em, t0 + 3600e3);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [aq.ARQ, aq.ARQ_FUP].sort(), 'sem arquivo temporário sobrando');
    aq.gravar(dir, 0, t0);
    assert.strictEqual(aq.lerFollowups(dir).length, 2, 'desligar NÃO apaga: é quando a recepção vai retomar');
    aq.gravar(dir, 3, t0 + 86400e3);
    assert.deepStrictEqual(aq.lerFollowups(dir), [], 'aquecimento novo começa com a lista vazia');
    // ligado e salvo de novo (estendendo): a lista continua
    aq.anotarFollowups(dir, [fila('5561999990003')], t0 + 86400e3);
    aq.gravar(dir, 14, t0 + 86400e3);
    assert.strictEqual(aq.lerFollowups(dir).length, 1);
    assert.deepStrictEqual(aq.lerFollowups(path.join(dir, 'nao-existe')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SOF-12 painel: o quadro do aquecimento lista quem ficou sem follow-up, com o nome do contato e o atalho para a conversa', () => {
  const { ambienteIsolado } = require('../ajuda');
  const amb = ambienteIsolado();
  try {
    const aqI = amb.req('sofia-aquecimento');
    amb.gravarData('contatos.json', { '5561999990001': { tel: '5561999990001', nome: 'Marina <b>Teste</b>', tags: [] } });
    amb.gravarSofia('sofia-prompt.txt', 'Você é a SoFIA, assistente do Studio. '.repeat(5)); // sem o roteiro a tela diz "SoFIA não encontrada"
    aqI.gravar(amb.sofia, 7);
    aqI.anotarFollowups(amb.sofia, [JSON.stringify({ tel: '5561999990001' }), JSON.stringify({ tel: '5561988880002' })]);
    const html = amb.req('painel-sofia').paginaSofia('', false);
    const quadro = html.slice(html.indexOf('id="aquecimento"'), html.indexOf('id="aquecimento"') + 6000);
    assert.match(quadro, /2 follow-ups não enviados neste aquecimento/);
    assert.match(quadro, /href="\/sofia\?view=conversas&chat=5561999990001"[^>]*>Marina &lt;b&gt;Teste&lt;\/b&gt;<\/a>/, 'nome escapado (PAI-07) e link para a conversa');
    assert.match(quadro, /\(sem nome\)/, 'quem não está nos contatos aparece pelo telefone');
    assert.match(quadro, /\(61\) 98888-0002/);
    const s = fs.readFileSync(path.join(CHATBOT, 'sofia-listener.ts'), 'utf8');
    assert.match(s, /aquecimento\.anotarFollowups\(DIR, linhasA\)[\s\S]{0,200}fs\.rmSync\(tmpA/, 'a SoFIA anota antes de apagar a fila');
  } finally { amb.limpar(); }
});

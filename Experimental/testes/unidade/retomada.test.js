// Retomada pelo Studio de quem parou de responder a SoFIA (retomada-sofia.js).
// Regras de quem recebe, e as travas: não mandar em dobro, não mandar sem ler a
// conversa, parar quando o WhatsApp não responde.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, semEsperas, HORA, DIA } = require('../ajuda');

const conversa = (nome, ultimaAluna) => ({ nome, ultimaEm: ultimaAluna, msgs: [{ autor: 'sofia', texto: 'Oi!', em: ultimaAluna - 60e3 }, { autor: 'aluna', texto: 'Vou ver', em: ultimaAluna }] });

function cenario() {
  const amb = ambienteIsolado();
  const agora = Date.now();
  amb.gravarSofia('sofia-conversas.json', {
    '5562981110001': conversa('Ana', agora - 30 * HORA),          // na janela → recebe
    '5562981110002': conversa('Bia', agora - 10 * HORA),          // falou há pouco → fora
    '5562981110003': conversa('Carla', agora - 5 * DIA),          // faz tempo demais → fora
    '5562981110004': conversa('Duda', agora - 40 * HORA),         // é aluna
    '5562981110005': conversa('Eva', agora - 36 * HORA),          // já recebeu neste período
    '123456789012345@lid': conversa('Fê', agora - 30 * HORA),     // sem telefone
    '5562981110007': conversa('Gi', agora - 30 * HORA),           // tag sem interesse
  });
  amb.gravarData('contatos.json', {
    '5562981110004': { tel: '5562981110004', nome: 'Duda', tags: ['0. Aluna'] },
    '5562981110007': { tel: '5562981110007', nome: 'Gi', tags: ['FX - 0. Sem interesse'] },
  });
  const eva = JSON.parse(require('fs').readFileSync(amb.sofia + '/sofia-conversas.json', 'utf8'))['5562981110005'];
  amb.gravarData('retomada-sofia.json', { '81110005': { ultimaContato: eva.msgs[1].em, enviadoEm: agora - 20 * HORA, nome: 'Eva' } });
  return amb;
}

test('RET-01 escolhe só quem está na janela e sem impedimento', () => {
  const amb = cenario();
  try {
    const lista = amb.req('retomada-sofia').candidatas();
    const motivo = Object.fromEntries(lista.map(x => [x.nome, x.motivo]));
    assert.deepStrictEqual(Object.keys(motivo).sort(), ['Ana', 'Duda', 'Eva', 'Fê', 'Gi']);   // Bia e Carla fora da janela
    assert.strictEqual(motivo.Ana, '');
    assert.match(motivo.Duda, /aluna/);
    assert.match(motivo.Eva, /já recebeu/);
    assert.match(motivo['Fê'], /sem telefone/);
    assert.match(motivo.Gi, /sem interesse/);
  } finally { amb.limpar(); }
});

test('RET-01 ENV-01 envia uma vez só, anota na hora e não repete na rodada seguinte', async () => {
  const amb = cenario(); const volta = semEsperas();
  try {
    const wa = amb.whatsappFalso();
    const r = amb.req('retomada-sofia');
    await r.runRetomada({ log: () => {} });
    assert.deepStrictEqual(wa.enviados.map(e => e.tel), ['5562981110001']);
    assert.ok(amb.lerData('retomada-sofia.json')['81110001'].enviadoEm, 'o envio ficou anotado');
    await r.runRetomada({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 1, 'a segunda rodada não manda de novo');
  } finally { volta(); amb.limpar(); }
});

test('RET-01 se a recepção já falou com ela pelo Studio, não envia', async () => {
  const amb = cenario(); const volta = semEsperas();
  try {
    const wa = amb.whatsappFalso({ conferir: async () => ({ respondeu: false, humano: true }) });
    await amb.req('retomada-sofia').runRetomada({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 0);
    assert.strictEqual(amb.lerData('retomada-sofia.json')['81110001'].pulado, 'recepcao');
  } finally { volta(); amb.limpar(); }
});

test('RET-01 ENV-02 sem conseguir ler a conversa não envia, e para depois de 3 falhas seguidas', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    const agora = Date.now(), conv = {};
    for (let i = 1; i <= 6; i++) conv['55629811100' + String(i).padStart(2, '0')] = conversa('P' + i, agora - (30 + i) * HORA);
    amb.gravarSofia('sofia-conversas.json', conv);
    const wa = amb.whatsappFalso({ conferir: async () => { throw new Error('a leitura da conversa passou de 60 s'); } });
    const res = await amb.req('retomada-sofia').runRetomada({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 0);
    assert.strictEqual(wa.leituras, 3, 'parou depois de 3 leituras com falha');
    assert.strictEqual(res.erros, 3);
  } finally { volta(); amb.limpar(); }
});

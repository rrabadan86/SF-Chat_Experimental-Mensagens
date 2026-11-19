// Encerramento ("dia seguinte, sem resposta") do follow-up, da falta e da retomada
// (followup-encerramento.js): só para quem ficou em silêncio, uma vez só.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, semEsperas, HORA, DIA } = require('../ajuda');

function registro(amb, itens) {
  const o = {};
  for (const [tel, nome, haQuanto, origem] of itens) o[`${tel.slice(-8)}|dia|${origem}`] = { tel, nome, professora: 'Bia', periodo: 'manha', origem, enviadoEm: Date.now() - haQuanto };
  amb.gravarData('followups-enviados.json', o);
}

test('manda o encerramento só para quem não respondeu, uma vez só', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    registro(amb, [
      ['5562981110001', 'Ana', 20 * HORA, 'followup'],    // silêncio → recebe
      ['5562981110002', 'Bia', 20 * HORA, 'noshow'],      // respondeu → não recebe
      ['5562981110003', 'Carla', 10 * HORA, 'followup'],  // cedo demais (menos de 18 h)
      ['5562981110004', 'Duda', 5 * DIA, 'followup'],     // velho demais (mais de 4 dias)
    ]);
    const wa = amb.whatsappFalso({ conferir: async (tel) => ({ respondeu: tel.endsWith('0002'), humano: false }) });
    const fe = amb.req('followup-encerramento');
    await fe.runEncerramento({ log: () => {} });
    assert.deepStrictEqual(wa.enviados.map(e => e.tel), ['5562981110001']);
    const reg = amb.lerData('followups-enviados.json');
    assert.ok(Object.values(reg).find(r => r.nome === 'Ana').encerrado, 'envio anotado');
    assert.strictEqual(Object.values(reg).find(r => r.nome === 'Bia').resolvido.motivo, 'respondeu');
    await fe.runEncerramento({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 1, 'não manda de novo');
  } finally { volta(); amb.limpar(); }
});

test('quem virou aluna não recebe encerramento', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    registro(amb, [['5562981110001', 'Ana', 20 * HORA, 'followup']]);
    amb.gravarData('contatos.json', { '5562981110001': { tel: '5562981110001', nome: 'Ana', tags: ['0. Aluna'] } });
    const wa = amb.whatsappFalso();
    await amb.req('followup-encerramento').runEncerramento({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 0);
  } finally { volta(); amb.limpar(); }
});

test('sem conseguir ler a conversa, não envia', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    registro(amb, [['5562981110001', 'Ana', 20 * HORA, 'followup']]);
    const wa = amb.whatsappFalso({ conferir: async () => { throw new Error('timeout'); } });
    const res = await amb.req('followup-encerramento').runEncerramento({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 0);
    assert.strictEqual(res.erros, 1);
  } finally { volta(); amb.limpar(); }
});

// Confirmação sem resposta (confirmacao-sem-resposta.js): a 2ª mensagem e a lista da
// equipe. Travas: só 1h30+ depois da confirmação, nunca em cima da hora da aula, nunca
// para quem respondeu ou já foi atendida, nunca sem ler a conversa, nunca em dobro.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, semEsperas, HORA } = require('../ajuda');

const MIN = 60e3;
const diaHoraSP = (ms) => { const d = new Date(ms - 3 * HORA); return { dataAula: d.toISOString().slice(0, 10), horario: d.toISOString().slice(11, 16) }; };
function registro(agora) {
  const r = (tel, nome, enviadaHa, aulaEm) => ({ tel, nome, ...diaHoraSP(agora + aulaEm), chave: 'confirmacao_amanha', enviadoEm: agora - enviadaHa });
  return {
    '90000001|a': r('5562990000001', 'ANA SOUZA', 2 * HORA, 5 * HORA),   // silêncio → recebe
    '90000002|b': r('5562990000002', 'Bia Lima', 60 * MIN, 5 * HORA),    // só 1h: ainda não
    '90000003|c': r('5562990000003', 'Carla Dias', 3 * HORA, 30 * MIN),  // aula em 30 min: não incomoda
    '90000004|d': r('5562990000004', 'Duda Reis', 3 * HORA, 6 * HORA),   // respondeu
    '90000005|e': r('5562990000005', 'Eva Melo', 3 * HORA, 6 * HORA),    // a recepção já falou
    '90000006|f': r('5562990000006', 'Fê Luz', 3 * HORA, 6 * HORA),      // conversa não abre
  };
}
const leitura = async (tel) => {
  if (tel.endsWith('04')) return { respondeu: true, reagiu: false, humano: false };
  if (tel.endsWith('05')) return { respondeu: false, reagiu: false, humano: true };
  if (tel.endsWith('06')) throw new Error('conversa não abriu');
  return { respondeu: false, reagiu: false, humano: false };
};

test('CONF-02 2ª mensagem: só quem ficou em silêncio 1h30+, com a aula ainda longe — e uma vez só', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    amb.gravarData('confirmacoes-enviadas.json', registro(Date.now()));
    const wa = amb.whatsappFalso({ conferir: leitura });
    const c = amb.req('confirmacao-sem-resposta');
    const r = await c.runSegundaMensagem({ log: () => {} });
    assert.deepStrictEqual(wa.enviados.map(e => e.tel), ['5562990000001'], 'só a Ana recebe');
    assert.match(wa.enviados[0].texto, /Ana/, 'primeiro nome sem ficar em maiúsculas');
    assert.strictEqual(wa.enviados[0].contexto, c.CONTEXTO_2A);
    assert.deepStrictEqual([r.enviadas, r.puladas, r.erros], [1, 2, 1]);
    const reg = amb.lerData('confirmacoes-enviadas.json');
    assert.ok(reg['90000001|a'].segunda, 'anotado na hora');
    assert.strictEqual(reg['90000004|d'].resolvido.motivo, 'respondeu');
    assert.strictEqual(reg['90000005|e'].resolvido.motivo, 'recepcao');
    assert.ok(!reg['90000006|f'].segunda && !reg['90000006|f'].resolvido, 'sem ler a conversa: não envia e tenta de novo depois');
    await c.runSegundaMensagem({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 1, 'rodar de novo não manda em dobro');
  } finally { volta(); amb.limpar(); }
});

test('CONF-03 lista da equipe: quem recebeu a 2ª e continua sem responder entra UMA vez; quem respondeu sai', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  try {
    const agora = Date.now(), reg = registro(agora);
    reg['90000001|a'].segunda = { em: agora - HORA };        // 2ª há 1h, sem resposta → lista
    reg['90000004|d'].segunda = { em: agora - HORA };        // respondeu depois da 2ª → sai
    reg['90000002|b'].segunda = { em: agora - 10 * MIN };    // 2ª há pouco → ainda não
    amb.gravarData('confirmacoes-enviadas.json', reg);
    const wa = amb.whatsappFalso({ conferir: leitura });
    const c = amb.req('confirmacao-sem-resposta');
    const r = await c.runListaEquipe({ log: () => {} });
    assert.strictEqual(r.listadas, 1);
    assert.strictEqual(wa.enviados.length, 1);
    assert.ok(wa.enviados[0].grupo, 'vai para o grupo da equipe');
    assert.match(wa.enviados[0].texto, /Ana Souza — \(62\) 99000-0001/);
    assert.doesNotMatch(wa.enviados[0].texto, /Duda|Bia/);
    await c.runListaEquipe({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 1, 'cada pessoa entra na lista uma vez');
  } finally { volta(); amb.limpar(); }
});

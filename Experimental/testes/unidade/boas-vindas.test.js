// Boas-vindas e indicação (boas-vindas.js): cada contrato recebe UMA vez; o tipo (nova,
// voltou, renovou) vem dos períodos da aluna; tipo desligado no card não envia; sem
// telefone não envia. "Hoje" fixo pelo relógio único (NODE_ENV=test + SF_AGORA).
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, semEsperas } = require('../ajuda');

function comHoje(iso) { process.env.NODE_ENV = 'test'; process.env.SF_AGORA = iso + 'T10:07:00-03:00'; return () => { delete process.env.SF_AGORA; }; }
const ATIVAS = {
  ultimo: { ids: ['1', '2', '3', '4', '5', '6'] },
  pessoas: {
    1: { n: 'ANA SOUZA', tel: '62990000001', cs: [['2026-11-22', '2027-02-22', 'TRIMESTRAL']], iv: [['2026-11-22', '2027-02-22']] },                                            // nova
    2: { n: 'BIA LIMA', tel: '62990000002', cs: [['2026-05-21', '2026-11-21', 'SEMESTRAL'], ['2026-11-21', '2027-05-21', 'SEMESTRAL']], iv: [['2026-05-21', '2027-05-21']] }, // renovou
    3: { n: 'CARLA DIAS', tel: '62990000003', cs: [['2025-01-10', '2025-06-10', 'MENSAL'], ['2026-11-22', '2026-12-22', 'MENSAL']], iv: [['2025-01-10', '2025-06-10'], ['2026-11-22', '2026-12-22']] }, // voltou
    4: { n: 'DUDA REIS', tel: '', cs: [['2026-11-22', '2027-02-22', 'TRIMESTRAL']], iv: [['2026-11-22', '2027-02-22']] },                                                       // sem telefone
    5: { n: 'EVA MELO', tel: '62990000005', cs: [['2026-10-01', '2027-01-01', 'TRIMESTRAL']], iv: [['2026-10-01', '2027-01-01']] },                                            // contrato antigo
    6: { n: 'FÊ LUZ', tel: '62990000006', cs: [['2026-10-22', '2027-01-22', 'TRIMESTRAL']], iv: [['2026-10-22', '2027-01-22']] },                                              // 32 dias de aluna
  },
};

test('ALU-03 boas-vindas: nova, voltou e renovou recebem a mensagem do seu tipo — e cada contrato uma vez só', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas(); const relogio = comHoje('2026-11-23');
  try {
    amb.gravarData('alunas-ativas-historico.json', ATIVAS);
    amb.gravarData('boas-vindas-cfg.json', { desde: '2026-11-15' });
    const wa = amb.whatsappFalso();
    const b = amb.req('boas-vindas');
    const tipos = Object.fromEntries(b.entradas().map(x => [x.nome, [x.tipo, x.motivo]]));
    assert.deepStrictEqual(tipos, { 'Ana Souza': ['nova', ''], 'Bia Lima': ['renovacao', ''], 'Carla Dias': ['retorno', ''], 'Duda Reis': ['nova', 'sem telefone ainda (a leitura de amanhã tenta de novo)'] }, 'Eva (contrato antigo) e Fê (fora da janela) não entram');
    const r = await b.runBoasVindas({ log: () => {} });
    assert.strictEqual(r.enviadas, 3);
    const por = Object.fromEntries(wa.enviados.map(e => [e.chave, e.tel]));
    assert.deepStrictEqual(por, { boasvindas_nova: '62990000001', boasvindas_renovacao: '62990000002', boasvindas_retorno: '62990000003' }, 'cada uma com a mensagem do seu tipo');
    assert.match(wa.enviados.find(e => e.chave === 'boasvindas_nova').texto, /Ana/);
    await b.runBoasVindas({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 3, 'rodar de novo não manda em dobro');
    // tipo desligado no card não envia (contrato novo de outra aluna)
    b.salvarCfg({ renovacao: false });
    const ativas2 = JSON.parse(JSON.stringify(ATIVAS));
    ativas2.pessoas[2].cs.push(['2026-11-23', '2027-05-23', 'SEMESTRAL']);
    amb.gravarData('alunas-ativas-historico.json', ativas2);
    assert.match(b.entradas().find(x => x.nome === 'Bia Lima').motivo, /renovação: desligado no card/);
  } finally { relogio(); volta(); amb.limpar(); }
});

test('ALU-04 indicação: aos 30 dias do início do período, uma vez só', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas(); const relogio = comHoje('2026-11-23');
  try {
    amb.gravarData('alunas-ativas-historico.json', ATIVAS);
    const wa = amb.whatsappFalso();
    const b = amb.req('boas-vindas');
    assert.deepStrictEqual(b.paraIndicacao().map(x => x.nome), ['Fê Luz'], 'só quem começou há 30–33 dias');
    await b.runIndicacao({ log: () => {} });
    await b.runIndicacao({ log: () => {} });
    assert.strictEqual(wa.enviados.length, 1);
    assert.strictEqual(wa.enviados[0].chave, 'indicacao_30d');
  } finally { relogio(); volta(); amb.limpar(); }
});

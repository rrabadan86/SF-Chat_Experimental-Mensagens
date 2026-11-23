// Fila dos jobs que ficaram sem rodar (jobs-batimento.js). Em 19/11/2026 o robô do
// Bueno travou das 10:07 às 10:55 e reiniciou: Follow-up Manhã, encerramento e
// envios agendados estavam ESPERANDO a vez e se perderam. Agora ficam anotados e
// rodam depois — mas um job que já tinha COMEÇADO não é repetido (mandaria em dobro).
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

const cronFalso = { schedule: (expr, fn) => ({ fn }) };
function carregar(amb, env = {}) {
  for (const k of ['FILA_JOBS_HORA_INI', 'FILA_JOBS_HORA_FIM', 'FILA_JOBS_MAX_HORAS']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[amb.arq('jobs-batimento')]; // "reinicia o robô": módulo novo, mesmo data/
  return amb.req('jobs-batimento');
}
const TODO_DIA = { FILA_JOBS_HORA_INI: '0', FILA_JOBS_HORA_FIM: '24' };

test('ENV-04 ENV-05 job que esperava a vez quando o robô reiniciou roda depois; o que já tinha começado não repete', async () => {
  const amb = ambienteIsolado();
  try {
    // Robô 1: Follow-up Manhã fica esperando; Renovação estava rodando.
    let b = carregar(amb, TODO_DIA);
    const followup = b.agendar(cronFalso, 'followupMorning', '30 10 * * 1-6', () => b.esperando('Follow-up Manhã'));
    const renov = b.agendar(cronFalso, 'renewal', '32 14 * * *', () => b.pegouVez('Renovação'));
    renov.fn(); followup.fn();
    assert.ok(amb.lerData('jobs-fila.json').esperando.followupMorning, 'o job que espera ficou anotado');
    assert.strictEqual(b.proximo(), null, 'no mesmo robô, quem espera continua no esperarVez — a fila não dispara em dobro');

    // Robô 2 (reiniciou).
    b = carregar(amb, TODO_DIA);
    const rodou = [];
    b.agendar(cronFalso, 'followupMorning', '30 10 * * 1-6', () => rodou.push('followupMorning'));
    b.agendar(cronFalso, 'renewal', '32 14 * * *', () => rodou.push('renewal'));
    const inter = b.interrompido();
    assert.strictEqual(inter && inter.nome, 'Renovação', 'avisa do job interrompido no meio');
    assert.strictEqual(b.interrompido(), null, 'avisa uma vez só');
    const item = b.proximo();
    assert.strictEqual(item && item.chave, 'followupMorning');
    b.disparar(item);
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(rodou, ['followupMorning'], 'roda o que esperava; a Renovação interrompida NÃO repete sozinha');
    assert.strictEqual(b.proximo(), null, 'saiu da fila');
  } finally { amb.limpar(); }
});

test('ENV-03 ENV-04 job que desistiu de esperar (robô ocupado 40 min) roda quando o robô liberar', () => {
  const amb = ambienteIsolado();
  try {
    const b = carregar(amb, TODO_DIA);
    const j = b.agendar(cronFalso, 'boasVindas', '7 10 * * *', () => { b.esperando('Boas-vindas'); b.desistiu('Boas-vindas'); });
    j.fn();
    const item = b.proximo();
    assert.strictEqual(item && item.nome, 'Boas-vindas');
    assert.ok(item.desistiu);
  } finally { amb.limpar(); }
});

test('ENV-04 de noite não manda nada atrasado; atrasado demais sai da fila (com aviso)', () => {
  const amb = ambienteIsolado();
  try {
    const hora = new Date(Date.now() - 3 * 3600e3).getUTCHours(); // hora de Brasília agora
    let b = carregar(amb, { FILA_JOBS_HORA_INI: String(hora), FILA_JOBS_HORA_FIM: String(hora) }); // janela fechada agora
    const j = b.agendar(cronFalso, 'resumoDia', '45 19 * * *', () => b.esperando('Resumo do dia'));
    j.fn();
    b = carregar(amb, { FILA_JOBS_HORA_INI: String(hora), FILA_JOBS_HORA_FIM: String(hora) });
    b.agendar(cronFalso, 'resumoDia', '45 19 * * *', () => {});
    assert.strictEqual(b.proximo(), null, 'fora do horário: espera');
    assert.ok(amb.lerData('jobs-fila.json').esperando.resumoDia, 'continua na fila');
    const depois = b.proximo(Date.now() + 4 * 3600e3);
    assert.strictEqual(depois, null);
    assert.strictEqual((b.proximo.descartados || []).map(d => d.chave).join(), 'resumoDia', 'passou de 3 h: descartado e avisado');
    assert.ok(!amb.lerData('jobs-fila.json').esperando.resumoDia);
  } finally { amb.limpar(); }
});

test('ENV-04 job sem etiqueta (manual pelo painel) não entra na fila', () => {
  const amb = ambienteIsolado();
  try {
    const b = carregar(amb, TODO_DIA);
    b.esperando('Boas-vindas [manual]'); b.pegouVez('Boas-vindas [manual]');
    const f = amb.lerData('jobs-fila.json');
    assert.ok(!f || (!Object.keys(f.esperando || {}).length && !f.rodando));
  } finally { amb.limpar(); }
});

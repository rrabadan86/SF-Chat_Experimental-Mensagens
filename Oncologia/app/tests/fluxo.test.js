require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

/* --------------------------------------------------------------------------
 * Google Agenda e WhatsApp de mentira, injetados antes de carregar o serviço.
 * Assim o fluxo inteiro — disponibilidade, criação do evento, aviso, resposta
 * da recepcionista — roda sem tocar em rede nenhuma.
 * ------------------------------------------------------------------------ */

const agendaFalsa = {
  criados: [],
  ocupadosExtras: [],
  reset() { this.criados = []; this.ocupadosExtras = []; },

  // freeBusy das OUTRAS agendas
  async ocupados() {
    return [...this.ocupadosExtras];
  },
  // listagem da agenda do próprio local, para contar as vagas
  async eventos(calendarId) {
    return {
      consultas: this.criados
        .filter((e) => e.calendarId === calendarId)
        .map((e) => ({ inicio: e.start.dateTime, fim: e.end.dateTime, id: e.id })),
      bloqueios: [],
    };
  },
  async criarPreAgendamento({ calendarId, titulo, inicioRFC, fimRFC, descricao, protocolo }) {
    const evento = {
      id: `evt-${this.criados.length + 1}`,
      calendarId,
      summary: titulo,
      description: descricao,
      status: 'tentative',
      created: new Date().toISOString(),
      start: { dateTime: inicioRFC },
      end: { dateTime: fimRFC },
      extendedProperties: { private: { protocolo, origem: 'formulario-web' } },
    };
    this.criados.push(evento);
    return evento;
  },
  async buscarPorProtocolo(_ids, protocolo) {
    const evento = this.criados.find((e) => e.extendedProperties.private.protocolo === protocolo);
    return evento ? { calendarId: evento.calendarId, evento } : null;
  },
  async confirmar(_calendarId, evento) {
    evento.summary = evento.summary.replace(/^PRÉ\s·\s/, '');
    evento.status = 'confirmed';
    return evento;
  },
  async liberar(_calendarId, eventoId) {
    this.criados = this.criados.filter((e) => e.id !== eventoId);
  },
  async pendentes(calendarId) {
    // filtra por agenda como o Google faz — senão o mesmo evento apareceria
    // uma vez para cada hospital no laço da cobrança
    return this.criados.filter((e) => e.calendarId === calendarId && e.status === 'tentative');
  },
};

const waFalso = {
  nome: 'log',
  enviadas: [],
  reset() { this.enviadas = []; },
  async iniciar() {},
  async enviar(numero, texto) { this.enviadas.push({ numero, texto }); },
  aoReceber() {},
  paraRecepcao() { return this.enviadas.filter((m) => m.numero === process.env.WA_RECEPCAO); },
  paraPaciente() { return this.enviadas.filter((m) => m.numero !== process.env.WA_RECEPCAO); },
};

function injetar(caminhoRelativo, exports) {
  const caminho = require.resolve(caminhoRelativo);
  require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports, children: [], paths: [] };
}
injetar('../src/google-agenda', agendaFalsa);
injetar('../src/whatsapp', waFalso);

const servico = require('../src/agendamento');
const config = require('../src/config');
const dados = require('../src/dados');

const RECEPCAO = process.env.WA_RECEPCAO;
const AGORA = new Date('2026-08-20T10:00:00-03:00');   // quinta
const PEDIDO = {
  hospital: 'h1', data: '2026-08-24', hora: '08:40',   // segunda, hospital 1
  nome: 'Maria Aparecida de Souza', nascimento: '1962-03-12',
  telefone: '(62) 99123-4567', tipo: 'Segunda opinião',
  pagamento: 'Convênio — Unimed', carteirinha: '0123',
  motivo: 'Nódulo em mama esquerda.', consentimento: true,
};

beforeEach(() => {
  agendaFalsa.reset();
  waFalso.reset();
  // a configuração é compartilhada e alguns testes mexem nela (vagas por
  // horário, faixas): sem voltar ao estado inicial, um teste contamina o outro
  require('node:fs').rmSync(process.env.DADOS_ARQUIVO, { force: true });
  dados.gravar(dados.semente());
});

test('agendar cria o evento provisório na agenda do hospital escolhido', async () => {
  const r = await servico.agendar(PEDIDO, AGORA);

  assert.match(r.protocolo, /^PA-2026-\d{4}$/);
  assert.equal(r.hospital.nome, 'Hospital 1');
  assert.equal(r.fim, '09:20');                       // 40 minutos depois

  assert.equal(agendaFalsa.criados.length, 1);
  const evento = agendaFalsa.criados[0];
  assert.equal(evento.calendarId, process.env.CAL_H1);
  assert.equal(evento.status, 'tentative');           // provisório até a recepção confirmar
  assert.ok(evento.summary.startsWith('PRÉ · Maria Aparecida de Souza'));
  assert.equal(evento.extendedProperties.private.protocolo, r.protocolo);
  assert.ok(evento.description.includes('5562991234567'));  // telefone normalizado
});

test('a recepcionista recebe a mensagem com o protocolo', async () => {
  const r = await servico.agendar(PEDIDO, AGORA);
  const msgs = waFalso.paraRecepcao();
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].texto.includes(r.protocolo));
  assert.ok(msgs[0].texto.includes('Maria Aparecida de Souza'));
  assert.ok(msgs[0].texto.includes(`CONFIRMAR ${r.protocolo}`));
});

test('o mesmo horário não é vendido duas vezes', async () => {
  await servico.agendar(PEDIDO, AGORA);
  await assert.rejects(
    () => servico.agendar({ ...PEDIDO, nome: 'João Carlos Lima' }, AGORA),
    (e) => e.codigo === 'horario_ocupado'
  );
  assert.equal(agendaFalsa.criados.length, 1);
});

test('compromisso já existente na agenda bloqueia o horário', async () => {
  agendaFalsa.ocupadosExtras = [
    { inicio: '2026-08-24T08:40:00-03:00', fim: '2026-08-24T09:20:00-03:00' },
  ];
  await assert.rejects(() => servico.agendar(PEDIDO, AGORA), (e) => e.codigo === 'horario_ocupado');
});

test('formulário inválido não chega a criar evento', async () => {
  await assert.rejects(
    () => servico.agendar({ ...PEDIDO, consentimento: false }, AGORA),
    (e) => e.codigo === 'validacao' && Boolean(e.erros.consentimento)
  );
  assert.equal(agendaFalsa.criados.length, 0);
  assert.equal(waFalso.enviadas.length, 0);
});

test('CONFIRMAR da recepção reflete na agenda do Google', async () => {
  const r = await servico.agendar(PEDIDO, AGORA);
  waFalso.reset();

  const res = await servico.tratarRespostaRecepcao({ de: RECEPCAO, texto: `Confirmar ${r.protocolo}` });

  assert.equal(res.resultado, 'confirmado');
  const evento = agendaFalsa.criados[0];
  assert.equal(evento.status, 'confirmed');
  assert.ok(!evento.summary.startsWith('PRÉ ·'));      // deixou de ser provisório
  assert.ok(waFalso.paraPaciente().some((m) => m.numero === '5562991234567'));
});

test('REMARCAR devolve o horário para a grade', async () => {
  const r = await servico.agendar(PEDIDO, AGORA);
  await servico.tratarRespostaRecepcao({ de: RECEPCAO, texto: `remarcar ${r.protocolo}` });

  assert.equal(agendaFalsa.criados.length, 0);
  // e o horário volta a aparecer para outro paciente
  const nova = await servico.agendar({ ...PEDIDO, nome: 'João Carlos Lima' }, AGORA);
  assert.ok(nova.protocolo);
});

test('comando vindo de outro número é ignorado', async () => {
  const r = await servico.agendar(PEDIDO, AGORA);
  const res = await servico.tratarRespostaRecepcao({ de: '5562988887777', texto: `CANCELAR ${r.protocolo}` });

  assert.equal(res, null);
  assert.equal(agendaFalsa.criados[0].status, 'tentative');   // nada mudou
});

test('protocolo inexistente devolve resposta amigável, não erro', async () => {
  const res = await servico.tratarRespostaRecepcao({ de: RECEPCAO, texto: 'CONFIRMAR PA-2026-0000' });
  assert.equal(res.resultado, 'nao_encontrado');
  assert.ok(waFalso.paraRecepcao()[0].texto.includes('PA-2026-0000'));
});

test('conversa normal da recepção não dispara nada', async () => {
  assert.equal(await servico.tratarRespostaRecepcao({ de: RECEPCAO, texto: 'bom dia, doutor' }), null);
  assert.equal(waFalso.enviadas.length, 0);
});

test('a grade oferecida já vem sem os horários ocupados', async () => {
  await servico.agendar(PEDIDO, AGORA);
  const { dias } = await servico.horariosDisponiveis('h1', 4, AGORA);
  const segunda = dias.find((d) => d.data === '2026-08-24');
  assert.equal(segunda.slots.find((s) => s.inicio === '08:40').livre, false);
  assert.equal(segunda.slots.find((s) => s.inicio === '09:20').livre, true);
});

test('ocupação no Hospital 1 tira o horário do Hospital 2', async () => {
  // terça 25/08 é dia do H2; o compromisso está na agenda do H1
  agendaFalsa.ocupadosExtras = [
    { inicio: '2026-08-25T14:00:00-03:00', fim: '2026-08-25T14:40:00-03:00' },
  ];
  const { dias } = await servico.horariosDisponiveis('h2', 4, AGORA);
  const terca = dias.find((d) => d.data === '2026-08-25');
  assert.equal(terca.slots.find((s) => s.inicio === '14:00').livre, false);
});

test('falha ao avisar a recepção não desfaz o agendamento', async () => {
  const original = waFalso.enviar;
  waFalso.enviar = async () => { throw new Error('WhatsApp fora do ar'); };
  try {
    const r = await servico.agendar(PEDIDO, AGORA);
    assert.equal(r.avisoPendente, true);
    assert.equal(agendaFalsa.criados.length, 1);      // o horário continua reservado
  } finally {
    waFalso.enviar = original;
  }
});

test('com 2 vagas, dois pacientes cabem no mesmo horário', async () => {
  dados.alterar((c) => { c.hospitais.find((h) => h.id === 'h1').vagasPorHorario = 2; });

  const primeiro = await servico.agendar(PEDIDO, AGORA);
  const segundo = await servico.agendar({ ...PEDIDO, nome: 'João Carlos Lima' }, AGORA);

  assert.equal(primeiro.posicaoNoHorario, 1);
  assert.equal(segundo.posicaoNoHorario, 2);
  assert.equal(segundo.vagasNoHorario, 2);
  assert.equal(agendaFalsa.criados.length, 2);

  // o terceiro não entra
  await assert.rejects(
    () => servico.agendar({ ...PEDIDO, nome: 'Ana Paula Reis' }, AGORA),
    (e) => e.codigo === 'horario_ocupado'
  );
  assert.equal(agendaFalsa.criados.length, 2);
});

test('a recepção é avisada de que é a segunda consulta do horário', async () => {
  dados.alterar((c) => { c.hospitais.find((h) => h.id === 'h1').vagasPorHorario = 2; });

  await servico.agendar(PEDIDO, AGORA);
  waFalso.reset();
  await servico.agendar({ ...PEDIDO, nome: 'João Carlos Lima' }, AGORA);

  assert.match(waFalso.paraRecepcao()[0].texto, /2ª de 2 consultas neste horário/);
});

test('com 1 vaga, a mensagem não fala de posição no horário', async () => {
  await servico.agendar(PEDIDO, AGORA);
  assert.ok(!waFalso.paraRecepcao()[0].texto.includes('consultas neste horário'));
});

test('médico com horário diferente em cada dia', async () => {
  dados.alterar((c) => {
    const h = c.hospitais.find((x) => x.id === 'h1');
    h.expediente = [
      { dias: [1, 2, 3], inicio: '07:30', fim: '12:00' },   // seg/ter/qua de manhã
      { dias: [4], inicio: '14:00', fim: '17:00' },          // quinta à tarde
    ];
  });

  const { dias } = await servico.horariosDisponiveis('h1', 5, AGORA);
  const porData = Object.fromEntries(dias.map((d) => [d.data, d.slots.map((s) => s.inicio)]));

  assert.equal(porData['2026-08-24'][0], '07:30');          // segunda, manhã
  assert.equal(porData['2026-08-27'][0], '14:00');          // quinta, tarde
  assert.equal(porData['2026-08-28'], undefined);           // sexta não atende
});

test('cobrança das 24h só pega o que está parado além do prazo', async () => {
  await servico.agendar(PEDIDO, AGORA);
  agendaFalsa.criados[0].created = new Date(Date.now() - 30 * 3600000).toISOString();
  await servico.agendar({ ...PEDIDO, hora: '09:20', nome: 'João Carlos Lima' }, AGORA);
  waFalso.reset();

  const cobrados = await servico.cobrarPendentes(new Date());
  assert.equal(cobrados.length, 1);
  assert.ok(waFalso.paraRecepcao()[0].texto.includes('PENDENTE'));
});

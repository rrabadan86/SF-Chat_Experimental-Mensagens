require('./ambiente');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

process.env.ADMIN_SENHA_HASH = require('../src/auth').gerarHash('senha-do-painel');

/* Google de mentira: o painel testa acesso a agenda, e isso não pode sair para a rede. */
const agendaFalsa = {
  respostaTeste: { ok: true, papel: 'writer', nome: 'Consultas — Santa Clara', mensagem: 'Conectado.' },
  async testarAcesso() { return this.respostaTeste; },
  async contaDeServico() { return 'marcacao@agenda-onco.iam.gserviceaccount.com'; },
  async ocupados() { return []; },
  async eventos() { return { consultas: [], bloqueios: [] }; },
};
const caminho = require.resolve('../src/google-agenda');
require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: agendaFalsa, children: [], paths: [] };

const { app } = require('../src/server');
const dados = require('../src/dados');

let servidor, base;
before(async () => {
  await new Promise((r) => { servidor = app.listen(0, r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

beforeEach(() => {
  fs.rmSync(process.env.DADOS_ARQUIVO, { force: true });
  dados.gravar(dados.semente());
});

/** cliente que guarda o cookie de sessão, como o navegador faria */
function navegador() {
  let cookie = null;
  return async function (caminho, opcoes = {}) {
    const r = await fetch(base + caminho, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opcoes.headers || {}) },
    });
    const bruto = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of bruto) cookie = c.split(';')[0];
    return { status: r.status, corpo: await r.json().catch(() => ({})) };
  };
}

async function entrar(nav) {
  const r = await nav('/admin/api/entrar', { method: 'POST', body: JSON.stringify({ senha: 'senha-do-painel' }) });
  assert.equal(r.status, 200);
  return nav;
}

const LOCAL = {
  nome: 'Hospital Santa Clara',
  calendarId: 'c_novo@group.calendar.google.com',
  expediente: [{ dias: [2, 4], inicio: '14:00', fim: '18:00' }],
  duracaoMin: 30, intervaloMin: 0, vagasPorHorario: 1,
  antecedenciaMinHoras: 12, janelaDias: 45,
};

test('sem senha o painel não abre', async () => {
  const nav = navegador();
  assert.equal((await nav('/admin/api/config')).status, 401);
  assert.equal((await nav('/admin/api/hospitais', { method: 'POST', body: JSON.stringify(LOCAL) })).status, 401);
});

test('senha errada é recusada', async () => {
  const nav = navegador();
  const r = await nav('/admin/api/entrar', { method: 'POST', body: JSON.stringify({ senha: 'chute' }) });
  assert.equal(r.status, 401);
  assert.equal((await nav('/admin/api/config')).status, 401);
});

test('com senha certa, entra e enxerga a configuração', async () => {
  const nav = await entrar(navegador());
  const { corpo } = await nav('/admin/api/config');
  assert.equal(corpo.config.hospitais.length, 2);
  assert.equal(corpo.contaDeServico, 'marcacao@agenda-onco.iam.gserviceaccount.com');
});

test('médico cadastra um local novo e ele aparece para o paciente', async () => {
  const nav = await entrar(navegador());
  const antes = await nav('/api/hospitais');
  assert.equal(antes.corpo.hospitais.length, 2);

  const criado = await nav('/admin/api/hospitais', { method: 'POST', body: JSON.stringify(LOCAL) });
  assert.equal(criado.status, 200);
  assert.equal(criado.corpo.hospital.id, 'hospital-santa-clara');

  // sem reiniciar nada, o formulário já oferece o local novo
  const depois = await nav('/api/hospitais');
  assert.equal(depois.corpo.hospitais.length, 3);
  const novo = depois.corpo.hospitais.find((h) => h.id === 'hospital-santa-clara');
  assert.deepEqual(novo.expediente, [{ dias: [2, 4], inicio: '14:00', fim: '18:00' }]);
  assert.equal(novo.duracaoMin, 30);
});

test('a grade do local novo já sai com os horários configurados', async () => {
  const nav = await entrar(navegador());
  await nav('/admin/api/hospitais', { method: 'POST', body: JSON.stringify(LOCAL) });
  const { corpo } = await nav('/api/horarios?hospital=hospital-santa-clara&dias=2');
  const horarios = corpo.dias[0].slots.map((s) => s.inicio);
  assert.equal(horarios[0], '14:00');
  assert.equal(horarios[1], '14:30');            // duração de 30 min
  assert.equal(horarios[horarios.length - 1], '17:30');
});

test('desligar tira do formulário sem apagar o cadastro', async () => {
  const nav = await entrar(navegador());
  await nav('/admin/api/hospitais/h1/ativo', { method: 'POST', body: JSON.stringify({ ativo: false }) });

  const paciente = await nav('/api/hospitais');
  assert.equal(paciente.corpo.hospitais.some((h) => h.id === 'h1'), false);

  const painel = await nav('/admin/api/config');
  assert.equal(painel.corpo.config.hospitais.some((h) => h.id === 'h1'), true);

  // e religar traz de volta
  await nav('/admin/api/hospitais/h1/ativo', { method: 'POST', body: JSON.stringify({ ativo: true }) });
  assert.equal((await nav('/api/hospitais')).corpo.hospitais.some((h) => h.id === 'h1'), true);
});

test('editar horários muda a grade na hora', async () => {
  const nav = await entrar(navegador());
  const atual = (await nav('/admin/api/config')).corpo.config.hospitais.find((h) => h.id === 'h1');
  await nav('/admin/api/hospitais/h1', {
    method: 'PUT',
    body: JSON.stringify({
      ...atual,
      expediente: [{ dias: [1, 3], inicio: '09:00', fim: '11:00' }],
      duracaoMin: 60,
    }),
  });
  const { corpo } = await nav('/api/horarios?hospital=h1&dias=2');
  assert.deepEqual(corpo.dias[0].slots.map((s) => s.inicio), ['09:00', '10:00']);
});

test('excluir remove de vez', async () => {
  const nav = await entrar(navegador());
  await nav('/admin/api/hospitais/h2', { method: 'DELETE' });
  assert.equal((await nav('/admin/api/config')).corpo.config.hospitais.some((h) => h.id === 'h2'), false);
});

test('dados inválidos voltam com o erro no campo certo', async () => {
  const nav = await entrar(navegador());
  const r = await nav('/admin/api/hospitais', {
    method: 'POST',
    body: JSON.stringify({
      ...LOCAL, nome: '',
      expediente: [{ dias: [], inicio: '14:00', fim: '10:00' }],
    }),
  });
  assert.equal(r.status, 400);
  assert.ok(r.corpo.erros.nome);
  assert.ok(r.corpo.erros['expediente.0.dias']);
  assert.ok(r.corpo.erros['expediente.0.fim']);
  assert.equal((await nav('/admin/api/config')).corpo.config.hospitais.length, 2);   // nada foi gravado
});

test('teste de agenda repassa o veredito do Google', async () => {
  const nav = await entrar(navegador());
  agendaFalsa.respostaTeste = { ok: false, motivo: 'permissao', mensagem: 'só leitura' };
  const r = await nav('/admin/api/testar-agenda', {
    method: 'POST', body: JSON.stringify({ calendarId: 'x@group.calendar.google.com' }),
  });
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.mensagem, /leitura/);
  agendaFalsa.respostaTeste = { ok: true, papel: 'writer', nome: 'ok', mensagem: 'Conectado.' };
});

test('trocar o WhatsApp da recepção passa a valer para os avisos', async () => {
  const nav = await entrar(navegador());
  await nav('/admin/api/config', {
    method: 'PUT',
    body: JSON.stringify({
      medico: { nome: 'Dr. Felipe Oliveira' },
      recepcao: { nome: 'Ana', whatsapp: '5562988887777' },
      agendasDeBloqueio: [],
    }),
  });
  delete require.cache[require.resolve('../src/config')];
  assert.equal(require('../src/config').whatsapp.recepcao, '5562988887777');
});

test('sair encerra a sessão', async () => {
  const nav = await entrar(navegador());
  assert.equal((await nav('/admin/api/config')).status, 200);
  await nav('/admin/api/sair', { method: 'POST' });
  assert.equal((await nav('/admin/api/config')).status, 401);
});

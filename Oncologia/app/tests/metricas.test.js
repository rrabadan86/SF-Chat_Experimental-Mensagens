require('./ambiente');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metricas-')), 'metricas.json');
process.env.METRICAS_ARQUIVO = arquivo;
const metricas = require('../src/metricas');

/** requisição de mentira: só o que o módulo olha. */
const visitante = (ip, navegador = 'Mozilla/5.0 (iPhone)') => ({
  headers: { 'user-agent': navegador, 'x-forwarded-for': ip },
  socket: { remoteAddress: ip },
});

const DIA = new Date('2026-08-24T15:00:00Z');       // 12:00 em Brasília

beforeEach(() => {
  metricas._limpar();
  try { fs.unlinkSync(arquivo); } catch { /* ainda não existe */ }
});

test('visita conta, e a mesma pessoa voltando não vira visitante novo', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas.registrarVisita(visitante('2.2.2.2'), DIA);

  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 3);
  assert.equal(hoje.unicos, 2);
});

test('o mesmo IP com navegador diferente é outra pessoa', () => {
  // é o caso do consultório: várias pessoas atrás da mesma internet
  metricas.registrarVisita(visitante('1.1.1.1', 'Chrome/1'), DIA);
  metricas.registrarVisita(visitante('1.1.1.1', 'Safari/2'), DIA);
  assert.equal(metricas.resumo(1, DIA).hoje.unicos, 2);
});

test('robô não entra na conta', () => {
  metricas.registrarVisita(visitante('3.3.3.3', 'Googlebot/2.1'), DIA);
  metricas.registrarVisita(visitante('4.4.4.4', 'WhatsApp/2.23'), DIA);
  metricas.registrarVisita(visitante('5.5.5.5', 'facebookexternalhit/1.1'), DIA);
  metricas.registrarVisita(visitante('6.6.6.6'), DIA);

  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 1, 'só a pessoa de verdade');
  assert.equal(hoje.unicos, 1);
});

test('o funil separa quem entrou, quem olhou horários e quem agendou', () => {
  const ana = visitante('1.1.1.1', 'Chrome/ana');
  const bia = visitante('2.2.2.2', 'Chrome/bia');
  const caio = visitante('3.3.3.3', 'Chrome/caio');

  [ana, bia, caio].forEach((v) => metricas.registrarVisita(v, DIA));
  metricas.registrarInteresse(ana, DIA);
  metricas.registrarInteresse(ana, DIA);          // clicou em vários dias
  metricas.registrarInteresse(bia, DIA);
  metricas.registrarAgendamento('h1', {}, DIA);

  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.unicos, 3);
  assert.equal(hoje.interessados, 2, 'ana e bia, ana uma vez só');
  assert.equal(hoje.agendamentos, 1);
});

test('conversão é sobre visitantes, não sobre visitas', () => {
  const ana = visitante('1.1.1.1', 'Chrome/ana');
  metricas.registrarVisita(ana, DIA);
  metricas.registrarVisita(ana, DIA);
  metricas.registrarVisita(ana, DIA);
  metricas.registrarVisita(visitante('2.2.2.2', 'Chrome/bia'), DIA);
  metricas.registrarAgendamento('h1', {}, DIA);

  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 4);
  assert.equal(hoje.unicos, 2);
  assert.equal(hoje.conversao, 50, '1 agendamento para 2 pessoas');
});

test('agendamentos são separados por local', () => {
  metricas.registrarAgendamento('h1', {}, DIA);
  metricas.registrarAgendamento('h2', {}, DIA);
  metricas.registrarAgendamento('h1', {}, DIA);
  assert.deepEqual(metricas.resumo(1, DIA).dias[0].porLocal, { h1: 2, h2: 1 });
});

test('dia sem movimento aparece zerado, não some da série', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), new Date('2026-08-22T15:00:00Z'));
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);

  const { dias } = metricas.resumo(3, DIA);
  assert.deepEqual(dias.map((d) => d.dia), ['2026-08-22', '2026-08-23', '2026-08-24']);
  assert.equal(dias[1].visitas, 0, 'o dia 23 existe e está zerado');
});

test('cada dia tem a sua própria conta de visitantes', () => {
  const ana = visitante('1.1.1.1', 'Chrome/ana');
  metricas.registrarVisita(ana, new Date('2026-08-23T15:00:00Z'));
  metricas.registrarVisita(ana, DIA);

  const { dias, total } = metricas.resumo(2, DIA);
  assert.equal(dias[0].unicos, 1);
  assert.equal(dias[1].unicos, 1);
  assert.equal(total.visitas, 2);
});

test('o que foi contado sobrevive ao reinício do servidor', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas.registrarAgendamento('h1', {}, DIA);
  metricas._gravarAgora();

  metricas._limpar();                              // como se o processo tivesse caído
  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 1);
  assert.equal(hoje.agendamentos, 1);
});

test('arquivo corrompido não derruba o servidor', () => {
  fs.writeFileSync(arquivo, '{ isto não é json', 'utf8');
  metricas._limpar();
  assert.doesNotThrow(() => metricas.registrarVisita(visitante('1.1.1.1'), DIA));
  assert.equal(metricas.resumo(1, DIA).hoje.visitas, 1);
});

test('nem o IP nem o navegador ficam gravados', () => {
  metricas.registrarVisita(visitante('187.45.200.13', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), DIA);
  metricas._gravarAgora();

  const bruto = fs.readFileSync(arquivo, 'utf8');
  assert.ok(!bruto.includes('187.45.200.13'), 'IP não pode estar no arquivo');
  assert.ok(!bruto.includes('iPhone'), 'navegador não pode estar no arquivo');
});

test('o que estava para gravar não se perde no restart do pm2', () => {
  // a gravação é adiada 1s e o timer é unref: sem o descarregar(), todo
  // `pm2 restart` jogaria fora as contagens do último segundo
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  assert.ok(!fs.existsSync(arquivo), 'ainda não foi para o disco');

  metricas.descarregar();
  assert.ok(fs.existsSync(arquivo), 'o desligamento força a gravação');

  metricas._limpar();
  assert.equal(metricas.resumo(1, DIA).hoje.visitas, 1);
});

test('descarregar sem nada pendente não faz nada', () => {
  assert.doesNotThrow(() => metricas.descarregar());
  assert.ok(!fs.existsSync(arquivo));
});

test('dias anteriores ao início da contagem são marcados como não medidos', () => {
  // é a diferença entre "ninguém entrou" e "não estávamos contando" — sem
  // ela, a tela afirma um mês de movimento zero que nunca foi observado
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);

  const { dias, desde } = metricas.resumo(30, DIA);
  assert.equal(desde, '2026-08-24');
  assert.equal(dias.filter((d) => d.medido).length, 1);
  assert.equal(dias.filter((d) => !d.medido).length, 29);
  assert.equal(dias[dias.length - 1].medido, true, 'hoje é medido');
});

test('arquivo antigo, sem o marco, adota o dia mais velho que tem', () => {
  fs.writeFileSync(arquivo, JSON.stringify({
    '2026-08-20': { visitas: 3, unicos: 2, interessados: 1, agendamentos: 0, porLocal: {}, digitais: [], viramGrade: [] },
    '2026-08-24': { visitas: 1, unicos: 1, interessados: 0, agendamentos: 0, porLocal: {}, digitais: [], viramGrade: [] },
  }), 'utf8');
  metricas._limpar();

  const { dias, desde } = metricas.resumo(10, DIA);
  assert.equal(desde, '2026-08-20');
  assert.equal(dias.find((d) => d.dia === '2026-08-19').medido, false);
  assert.equal(dias.find((d) => d.dia === '2026-08-22').medido, true, 'dia sem visita, mas já medido');
});

test('o marco não é confundido com um dia', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas._gravarAgora();
  metricas._limpar();

  const { dias, total } = metricas.resumo(3, DIA);
  assert.equal(dias.length, 3, 'a chave "desde" não vira uma coluna');
  assert.equal(total.visitas, 1);
});

test('dia gravado por versão anterior recebe os campos novos', () => {
  // sem isto o primeiro acesso do dia estoura somando num mapa inexistente —
  // e quem chama é a página do paciente, então o site inteiro cai
  fs.writeFileSync(arquivo, JSON.stringify({
    desde: '2026-08-24',
    '2026-08-24': { visitas: 14, unicos: 2, interessados: 2, agendamentos: 0, porLocal: {} },
  }), 'utf8');
  metricas._limpar();

  assert.doesNotThrow(() => metricas.registrarVisita(visitante('9.9.9.9'), DIA));
  assert.doesNotThrow(() => metricas.registrarConfirmacao(30, DIA));

  const { hoje, origens } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 15, 'o que já estava contado continua lá');
  assert.equal(hoje.confirmados, 1);
  assert.deepEqual(origens, [{ chave: 'Direto ou app', n: 1 }]);
});

test('o preenchimento vai para o arquivo, não para uma cópia', () => {
  fs.writeFileSync(arquivo, JSON.stringify({
    desde: '2026-08-24',
    '2026-08-24': { visitas: 1, unicos: 1, interessados: 0, agendamentos: 0, porLocal: {} },
  }), 'utf8');
  metricas._limpar();

  metricas.registrarAgendamento('h1', { data: '2026-08-27', hora: '08:00', tipo: 'Retorno' }, DIA);
  metricas._gravarAgora();
  metricas._limpar();

  const { escolhas, hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.agendamentos, 1);
  assert.deepEqual(escolhas.tipo, [{ chave: 'Retorno', n: 1 }]);
});

test('a origem é classificada, e só conta uma vez por pessoa', () => {
  const daBusca = (ip, ref) => ({
    headers: { 'user-agent': 'Chrome/' + ip, referer: ref, host: 'drfelipe.exemplo' },
    socket: { remoteAddress: ip }, query: {},
  });
  metricas.registrarVisita(daBusca('1.1.1.1', 'https://www.google.com/search?q=oncologista'), DIA);
  metricas.registrarVisita(daBusca('1.1.1.1', 'https://www.google.com/'), DIA);   // recarregou
  metricas.registrarVisita(daBusca('2.2.2.2', 'https://l.instagram.com/'), DIA);
  metricas.registrarVisita(daBusca('3.3.3.3', ''), DIA);

  assert.deepEqual(metricas.resumo(1, DIA).origens, [
    { chave: 'Google', n: 1 },
    { chave: 'Instagram', n: 1 },
    { chave: 'Direto ou app', n: 1 },
  ]);
});

test('navegação dentro do próprio site não vira origem', () => {
  metricas.registrarVisita({
    headers: { 'user-agent': 'Chrome/x', referer: 'https://drfelipe.exemplo/manual', host: 'drfelipe.exemplo' },
    socket: { remoteAddress: '1.1.1.1' }, query: {},
  }, DIA);
  const r = metricas.resumo(1, DIA);
  assert.equal(r.hoje.unicos, 1, 'a pessoa conta');
  assert.deepEqual(r.origens, [], 'mas não como origem externa');
});

test('o rótulo ?de= vence o cabeçalho — é o que funciona no WhatsApp', () => {
  metricas.registrarVisita({
    headers: { 'user-agent': 'Chrome/x', host: 'drfelipe.exemplo' },
    socket: { remoteAddress: '1.1.1.1' }, query: { de: 'cartao-de-visita' },
  }, DIA);
  assert.deepEqual(metricas.resumo(1, DIA).origens, [{ chave: 'cartao-de-visita', n: 1 }]);
});

test('o funil vai do pedido à confirmação, com a espera', () => {
  metricas.registrarAgendamento('h1', { data: '2026-08-27', hora: '08:00', tipo: 'Primeira consulta' }, DIA);
  metricas.registrarAgendamento('h1', { data: '2026-08-27', hora: '08:40', tipo: 'Retorno' }, DIA);
  metricas.registrarAgendamento('h2', { data: '2026-08-28', hora: '14:00', tipo: 'Retorno' }, DIA);
  metricas.registrarConfirmacao(12, DIA);
  metricas.registrarConfirmacao(48, DIA);
  metricas.registrarLiberacao(DIA);

  const { hoje, escolhas } = metricas.resumo(1, DIA);
  assert.equal(hoje.agendamentos, 3);
  assert.equal(hoje.confirmados, 2);
  assert.equal(hoje.remarcados, 1);
  assert.equal(hoje.parados, 0, '3 pedidos, 2 confirmados, 1 remarcado');
  assert.equal(hoje.esperaMedia, 30);
  assert.equal(hoje.esperaMax, 48, 'a pior espera não some na média');
  assert.deepEqual(escolhas.tipo, [{ chave: 'Retorno', n: 2 }, { chave: 'Primeira consulta', n: 1 }]);
  assert.deepEqual(escolhas.hora, [{ chave: '08', n: 2 }, { chave: '14', n: 1 }]);
});

test('pedido sem resposta da recepção aparece como parado', () => {
  metricas.registrarAgendamento('h1', {}, DIA);
  metricas.registrarAgendamento('h1', {}, DIA);
  metricas.registrarConfirmacao(20, DIA);
  assert.equal(metricas.resumo(1, DIA).hoje.parados, 1);
});

test('confirmação de pedido de ontem não deixa "parados" negativo', () => {
  metricas.registrarConfirmacao(600, DIA);         // o pedido foi ontem
  assert.equal(metricas.resumo(1, DIA).hoje.parados, 0);
});

test('confirmação sem hora de criação não estraga a média', () => {
  metricas.registrarConfirmacao(20, DIA);
  metricas.registrarConfirmacao(null, DIA);        // o Google não devolveu o carimbo
  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.confirmados, 2, 'conta como confirmada');
  assert.equal(hoje.esperaMedia, 20, 'mas fica fora da média');
});

test('reiniciar o servidor não transforma a mesma pessoa em duas', () => {
  // 21 reinícios num dia de implantação viraram 3 pessoas em 29: o sal vivia
  // só na memória e cada reinício recomeçava a identificação do zero
  const ana = visitante('1.1.1.1', 'Chrome/ana');
  metricas.registrarVisita(ana, DIA);
  metricas._gravarAgora();

  metricas._limpar();                    // exatamente o que o pm2 restart faz
  metricas.registrarVisita(ana, DIA);
  metricas._gravarAgora();

  metricas._limpar();
  metricas.registrarVisita(ana, DIA);

  const { hoje } = metricas.resumo(1, DIA);
  assert.equal(hoje.visitas, 3);
  assert.equal(hoje.unicos, 1, 'três reinícios, uma pessoa só');
});

test('a virada do dia sobrescreve o sal, e ontem fica irreversível', () => {
  const ontem = new Date('2026-08-23T15:00:00Z');
  metricas.registrarVisita(visitante('1.1.1.1'), ontem);
  metricas._gravarAgora();
  const salDeOntem = JSON.parse(fs.readFileSync(arquivo, 'utf8')).sal;
  assert.equal(salDeOntem.dia, '2026-08-23');

  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas._gravarAgora();
  const guardado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

  assert.equal(guardado.sal.dia, '2026-08-24', 'só existe o sal do dia corrente');
  assert.notEqual(guardado.sal.valor, salDeOntem.valor);
  // as duas visitas contam separado: cada dia tem a sua própria identificação
  assert.equal(guardado['2026-08-23'].unicos, 1);
  assert.equal(guardado['2026-08-24'].unicos, 1);
});

test('o sal não vira uma coluna do gráfico', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  const { dias, total } = metricas.resumo(3, DIA);
  assert.equal(dias.length, 3);
  assert.equal(total.visitas, 1);
});

test('os canais divulgados chegam ao painel com nome de gente', () => {
  const comRotulo = (rotulo, ip) => ({
    headers: { 'user-agent': 'Chrome/' + ip, 'x-forwarded-for': ip },
    socket: { remoteAddress: ip }, query: { de: rotulo },
  });
  metricas.registrarVisita(comRotulo('whatsapp', '1.1.1.1'), DIA);
  metricas.registrarVisita(comRotulo('indicacao', '2.2.2.2'), DIA);
  metricas.registrarVisita(comRotulo('INDICAÇÃO', '3.3.3.3'), DIA);   // acento e maiúscula
  metricas.registrarVisita(comRotulo('propaganda', '4.4.4.4'), DIA);

  const origens = {};
  metricas.resumo(1, DIA).origens.forEach((o) => { origens[o.chave] = o.n; });
  assert.equal(origens.WhatsApp, 1);
  assert.equal(origens['Indicação'], 2, 'as duas grafias contam no mesmo canal');
  assert.equal(origens.Propaganda, 1);
});

test('rótulo fora da lista continua valendo, como foi escrito', () => {
  metricas.registrarVisita({
    headers: { 'user-agent': 'Chrome/x', 'x-forwarded-for': '9.9.9.9' },
    socket: {}, query: { de: 'feira-de-saude' },
  }, DIA);
  const origens = metricas.resumo(1, DIA).origens.map((o) => o.chave);
  assert.ok(origens.includes('feira-de-saude'));
});

test('sem rótulo e sem procedência, a visita é "Direto ou app"', () => {
  metricas.registrarVisita(visitante('5.5.5.5'), DIA);
  const origens = metricas.resumo(1, DIA).origens.map((o) => o.chave);
  assert.ok(origens.includes('Direto ou app'));
});

test('zerar apaga a contagem e guarda uma cópia antes', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas.registrarAgendamento('h1', {}, DIA);
  metricas._gravarAgora();

  const { copia } = metricas.zerar(DIA);
  assert.ok(copia, 'devolve o caminho da cópia');
  assert.ok(fs.existsSync(copia), 'a cópia existe no disco');

  const guardado = JSON.parse(fs.readFileSync(copia, 'utf8'));
  assert.equal(guardado['2026-08-24'].visitas, 1, 'a cópia tem o que havia antes');

  const depois = metricas.resumo(1, DIA);
  assert.equal(depois.hoje.visitas, 0);
  assert.equal(depois.hoje.agendamentos, 0);
  assert.equal(depois.desde, null, 'a medição recomeça sem marco');

  fs.unlinkSync(copia);
});

test('zerar sobrevive ao reinício: não é só memória', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas._gravarAgora();
  const { copia } = metricas.zerar(DIA);

  metricas._limpar();                              // como se o pm2 reiniciasse
  assert.equal(metricas.resumo(1, DIA).hoje.visitas, 0);
  if (copia) fs.unlinkSync(copia);
});

test('zerar com o arquivo já vazio não inventa cópia', () => {
  const { copia } = metricas.zerar(DIA);
  assert.equal(copia, null);
});

test('depois de zerar, a contagem recomeça normalmente', () => {
  metricas.registrarVisita(visitante('1.1.1.1'), DIA);
  metricas._gravarAgora();
  const { copia } = metricas.zerar(DIA);

  metricas.registrarVisita(visitante('2.2.2.2'), DIA);
  const r = metricas.resumo(1, DIA);
  assert.equal(r.hoje.visitas, 1);
  assert.equal(r.desde, '2026-08-24', 'o marco nasce de novo na primeira visita');
  if (copia) fs.unlinkSync(copia);
});

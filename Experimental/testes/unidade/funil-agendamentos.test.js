// De onde o Funil tira os agendamentos (agendou-registro.js). Cada teste trava um jeito
// de o Funil "perder" agendamentos de verdade — em 11/2026 uma unidade com dezenas de
// agendamentos mostrava 1 em "Tudo".
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, DIA } = require('../ajuda');

const diaSP = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const meioDia = (n) => Date.parse(diaSP(Date.now() - n * DIA) + 'T12:00:00-03:00'); // meio-dia de n dias atrás
const tel = (i) => '55629822' + String(i).padStart(5, '0');
const evTag = (i, em, extra) => JSON.stringify({ chave: tel(i), tag: 'FX - 3. Agendou Aula Exp', motivo: 'agendou', acao: 'add', em, canal: 'sofia', ...(extra || {}) });
const contatosDe = (n) => { const c = {}; for (let i = 1; i <= n; i++) c[tel(i)] = { tel: tel(i), nome: 'Lead ' + i, tags: [] }; return c; };
const base = (amb, n) => { amb.gravarSofia('sofia-conversas.json', {}); amb.gravarSofia('sofia-historico.json', {}); amb.gravarData('contatos.json', contatosDe(n)); };
const funil = (amb, params) => amb.req('painel-indicadores').paginaSofiaFunil({ _numeros: true, ...params });

test('IND-02 funil: etiqueta trocada em lote em milhares de contatos não esconde os agendamentos antigos', () => {
  const amb = ambienteIsolado();
  try {
    base(amb, 12);
    const linhas = [];
    for (let i = 1; i <= 10; i++) linhas.push(evTag(i, meioDia(40 + i)));          // 10 agendamentos antigos
    // depois, alguém põe e tira uma etiqueta em 4.500 contatos pela aba Contatos (9.000 linhas)
    for (let i = 0; i < 4500; i++) {
      const chave = '5562977' + String(i).padStart(6, '0'), em = meioDia(3) + i;
      linhas.push(JSON.stringify({ chave, tag: 'Campanha', motivo: 'manual', por: 'ana', acao: 'add', em }));
      linhas.push(JSON.stringify({ chave, tag: 'Campanha', motivo: 'manual', por: 'ana', acao: 'remove', em: em + 1 }));
    }
    linhas.push(evTag(11, meioDia(1)));                                           // 1 agendamento depois
    amb.gravarSofia('sofia-tag-log.jsonl', linhas.join('\n') + '\n');
    // a linha do tempo da conversa continua lendo só o fim do arquivo (é lida o tempo todo)
    assert.ok(!amb.req('sofia-editor').lerTagLog()[tel(1).slice(-8)], 'a leitura rápida não alcança o começo');
    assert.strictEqual(funil(amb, { per: '0' }).agendaram, 11);
    assert.strictEqual(funil(amb, { per: '7' }).agendaram, 1);
    // a comparação com o período anterior e as Metas sabem que o histórico alcança lá atrás
    assert.ok(funil(amb, { per: '0' }).primeiroEvento <= meioDia(50));
  } finally { amb.limpar(); }
});

test('IND-02 funil: quem tem mais de 30 trocas de etiqueta depois de agendar continua contando', () => {
  const amb = ambienteIsolado();
  try {
    base(amb, 2);
    const linhas = [evTag(1, meioDia(20))];
    for (let i = 0; i < 40; i++) linhas.push(JSON.stringify({ chave: tel(1), tag: 'Qualquer', motivo: 'manual', por: 'ana', acao: i % 2 ? 'remove' : 'add', em: meioDia(10) + i }));
    amb.gravarSofia('sofia-tag-log.jsonl', linhas.join('\n') + '\n');
    assert.strictEqual(funil(amb, { per: '30' }).agendaram, 1);
  } finally { amb.limpar(); }
});

test('IND-02 funil: agendamento conta mesmo sem nenhuma etiqueta com o gatilho "agendou"', () => {
  const amb = ambienteIsolado();
  try {
    base(amb, 3);
    amb.gravarData('tags-config.json', { 'FX - 1. Contato inicial': { gatilho: 'mensagem' } }); // unidade sem etiqueta de "agendou"
    const agora = Date.now();
    amb.gravarSofia('sofia-agendou.jsonl', [
      { telefone: tel(1), nome: 'Ana Souza', when: '2026-12-01 07:00', canal: 'sofia', em: agora - 3000 },
      { telefone: tel(2), nome: 'Bia Lima', when: '2026-12-02 08:00', canal: 'formulario', em: agora - 2000 },
      { telefone: tel(3), nome: 'Carla Dias', when: '2026-12-03 09:00', canal: 'express', em: agora - 1000 },
    ].map(o => JSON.stringify(o)).join('\n') + '\n');
    amb.req('painel-automacao').processarAgendamentos();
    const reg = amb.req('agendou-registro');
    assert.strictEqual(reg.lerRegistro().length, 3, 'os três foram anotados na hora');
    const r = funil(amb, { per: 'hoje' });
    assert.strictEqual(r.agendaram, 3);
    assert.deepStrictEqual([r.porCanal.sofia, r.porCanal.formulario, r.porCanal.express], [1, 1, 1]);
    // o encerramento do follow-up enxerga que ela agendou de novo (antes dependia da etiqueta)
    assert.strictEqual(amb.req('followup-encerramento').agendouDepois(tel(1), agora - 60000), true);
    assert.strictEqual(amb.req('followup-encerramento').agendouDepois(tel(1), agora + 60000), false);
  } finally { amb.limpar(); }
});

test('IND-02 funil: o mesmo agendamento visto no registro, na etiqueta e no arquivo da aula conta UMA vez', () => {
  const amb = ambienteIsolado();
  try {
    base(amb, 2);
    amb.gravarData('tags-config.json', { 'FX - 3. Agendou Aula Exp': { gatilho: 'agendou' } });
    const agora = Date.now();
    amb.gravarSofia('sofia-agendou.jsonl', JSON.stringify({ telefone: tel(1), nome: 'Ana Souza', when: '2026-12-01 07:00', canal: 'sofia', em: agora - 5000 }) + '\n');
    amb.req('painel-automacao').processarAgendamentos(); // anota no registro, na etiqueta e no arquivo da aula
    const noLog = require('fs').readFileSync(require('path').join(amb.sofia, 'sofia-tag-log.jsonl'), 'utf8');
    assert.match(noLog, /"motivo":"agendou"/, 'a etiqueta foi aplicada e anotada');
    const ev = amb.req('agendou-registro').de(tel(1));
    assert.strictEqual(ev.length, 1);
    assert.strictEqual(ev[0].canal, 'sofia');
    assert.strictEqual(ev[0].when, '2026-12-01 07:00');
    assert.strictEqual(ev[0].em, agora - 5000, 'vale o instante do agendamento, não o de quando o painel processou');
    // remarcou 5 dias antes também? então são DOIS agendamentos, cada um no seu período
    amb.gravarSofia('sofia-tag-log.jsonl', evTag(1, meioDia(5)) + '\n' + noLog);
    assert.strictEqual(amb.req('agendou-registro').de(tel(1)).length, 2);
    assert.strictEqual(funil(amb, { per: '7' }).agendaram, 1, 'uma pessoa conta uma vez no período');
  } finally { amb.limpar(); }
});

test('IND-02 IND-04 funil: agendamento antigo sem etiqueta entra pela data gravada com a aula; sem data nenhuma, só em "Tudo"', () => {
  const amb = ambienteIsolado();
  try {
    base(amb, 4);
    amb.gravarSofia('sofia-tag-log.jsonl', evTag(1, meioDia(2)) + '\n');
    // 2: agendou há 12 dias numa época sem etiqueta — só sobrou o arquivo da aula
    amb.gravarSofia('sofia-agendaram-aula.json', { [tel(2).slice(-8)]: { when: '2026-11-12 07:00', em: meioDia(12), canal: 'formulario' } });
    // 3: está na lista de quem agendou (a do follow-up), sem data em lugar nenhum
    amb.gravarSofia('sofia-agendaram.json', [tel(1), tel(2), tel(3)]);
    amb.gravarSofia('sofia-agendaram-canal.json', { [tel(3).slice(-8)]: 'express' });
    assert.strictEqual(funil(amb, { per: '7' }).agendaram, 1);
    const mes = funil(amb, { per: '30' });
    assert.strictEqual(mes.agendaram, 2);
    assert.strictEqual(mes.porCanal.formulario, 1);
    const tudo = funil(amb, { per: '0' });
    assert.strictEqual(tudo.agendaram, 3, 'em "Tudo" entra também quem agendou sem data registrada');
    assert.strictEqual(tudo.porCanal.express, 1);
    // um período escolhido à mão não recebe quem não tem data
    assert.strictEqual(funil(amb, { de: diaSP(Date.now() - 400 * DIA), ate: diaSP(Date.now()) }).agendaram, 2);
  } finally { amb.limpar(); }
});

test('IND-06 metas: mês fechado sem funil recebe o funil quando o histórico passa a alcançar o mês — e só isso', () => {
  const amb = ambienteIsolado();
  try {
    const metas = amb.req('metas');
    metas.fechar('2026-10', { ativas: { fim: 200, novas: 9 }, funil: null, custo: { porAgendamento: null }, fin: { recebido: 1000 } }, '2026-11-09T10:00:00Z');
    assert.strictEqual(metas.completar('2026-10', { funil: { agendaram: 30 }, fin: { recebido: 9 } }, () => ({ custo: { porAgendamento: 12 } })), true);
    const f = metas.fechamentos()['2026-10'];
    assert.strictEqual(f.funil.agendaram, 30);
    assert.strictEqual(f.custo.porAgendamento, 12);
    assert.strictEqual(f.fin.recebido, 1000, 'o que já tinha número não muda');
    // já completo: nada muda mais
    assert.strictEqual(metas.completar('2026-10', { funil: { agendaram: 99 } }, () => ({ custo: { porAgendamento: 1 } })), false);
    assert.strictEqual(metas.fechamentos()['2026-10'].funil.agendaram, 30);
    assert.strictEqual(metas.completar('2026-09', { funil: { agendaram: 5 } }), false, 'mês que nunca fechou não é criado aqui');
  } finally { amb.limpar(); }
});

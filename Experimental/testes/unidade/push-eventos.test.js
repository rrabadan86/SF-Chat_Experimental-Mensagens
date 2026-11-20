// O que vira notificação do painel (push-eventos.js): pediu atendente, agendou,
// outros avisos à recepção e alertas da Saúde — cada um só para quem escolheu,
// sem repetir, e sem mexer no aviso por WhatsApp que já existia.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambienteIsolado, aparelhoPush } = require('../ajuda');

function cenario() {
  const amb = ambienteIsolado();
  process.env.PAINEL_USER = 'dono';
  delete process.env.NTFY_TOPIC;
  const usuarios = amb.req('usuarios');
  usuarios.criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'] });
  const push = amb.req('push');
  const enviados = [], aparelhos = {};
  push.usarTransporte(async (endpoint, headers, corpo) => { enviados.push({ endpoint, headers, msg: aparelhos[endpoint].abrir(corpo) }); return { status: 201 }; });
  const inscreve = (usuario, n, tipos) => { const ap = aparelhoPush(n); aparelhos[ap.sub.endpoint] = ap; push.inscrever(push.sessDe(usuario), ap.sub, tipos, '', ''); return ap.sub.endpoint; };
  return { amb, push, enviados, inscreve, ev: amb.req('push-eventos') };
}

test('pediu atendente: avisa só a marca nova, uma vez, com o nome e o link da conversa', async () => {
  const { amb, enviados, inscreve, ev } = cenario();
  try {
    inscreve('recepcao', 1, ['atendente']);
    const t0 = Date.now();
    amb.gravarSofia('sofia-conversas.json', { '5562981110001': { nome: 'Ana Souza', msgs: [] }, '5562981110002': { nome: 'Bia Lima', msgs: [] } });
    // marca antiga, de antes de as notificações existirem: não é novidade
    amb.gravarSofia('sofia-atencao.json', { '5562981110001': t0 - 3600e3 });
    await ev.vigiarAtencao(t0);
    assert.strictEqual(enviados.length, 0, 'na primeira vez não avisa o que já estava marcado');
    // nada mudou: continua sem avisar
    await ev.vigiarAtencao(t0 + 4000);
    assert.strictEqual(enviados.length, 0);
    // a Bia pede atendente
    amb.gravarSofia('sofia-atencao.json', { '5562981110001': t0 - 3600e3, '5562981110002': t0 + 5000 });
    const r = await ev.vigiarAtencao(t0 + 8000);
    assert.strictEqual(r.enviados, 1);
    assert.deepStrictEqual(enviados[0].msg, { titulo: '🙋 Pediu atendente', corpo: 'Bia Lima', url: '/sofia?view=conversas&chat=5562981110002', tag: 'atendente-81110002' });
    assert.strictEqual(enviados[0].headers.Urgency, 'high');
    // a mesma marca não avisa de novo
    await ev.vigiarAtencao(t0 + 12000);
    await ev.vigiarAtencao(t0 + 16000);
    assert.strictEqual(enviados.length, 1);
    // a recepção assume (a marca some) e depois a Ana pede de novo: avisa
    amb.gravarSofia('sofia-atencao.json', { '5562981110001': t0 + 20000 });
    await ev.vigiarAtencao(t0 + 24000);
    assert.strictEqual(enviados.length, 2);
    assert.strictEqual(enviados[1].msg.corpo, 'Ana Souza');
  } finally { amb.limpar(); }
});

test('pediu atendente: se o envio falhar, não fica repetindo o mesmo aviso', async () => {
  const { amb, push, inscreve, ev } = cenario();
  try {
    inscreve('recepcao', 1, ['atendente']);
    const t0 = Date.now();
    amb.gravarSofia('sofia-atencao.json', {});
    await ev.vigiarAtencao(t0);
    let tentativas = 0;
    push.usarTransporte(async () => { tentativas++; throw new Error('sem rede'); });
    amb.gravarSofia('sofia-atencao.json', { '5562981110001': t0 + 1000 });
    assert.deepStrictEqual(await ev.vigiarAtencao(t0 + 4000), { enviados: 0, falhas: 1, removidos: 0 });
    await ev.vigiarAtencao(t0 + 8000);
    assert.strictEqual(tentativas, 1, 'a marca já foi anotada como vista');
  } finally { amb.limpar(); }
});

test('agendou e outros avisos: cada aparelho recebe só o que escolheu', async () => {
  const { amb, enviados, inscreve, ev } = cenario();
  try {
    const soAgendou = inscreve('recepcao', 1, ['agendou']);
    const tudo = inscreve('dono', 2, ['atendente', 'agendou', 'recepcao', 'saude']);
    await ev.agendou({ telefone: '5562981110003', nome: 'Carla Dias', when: 'qui 26/11 às 07:00', canal: 'formulario' });
    assert.deepStrictEqual(enviados.map(e => e.endpoint).sort(), [soAgendou, tudo].sort());
    assert.deepStrictEqual(enviados[0].msg, { titulo: '🎉 Aula experimental agendada', corpo: 'Carla Dias · qui 26/11 às 07:00 · pelo Formulário', url: '/sofia?view=conversas&chat=5562981110003', tag: 'agendou-81110003' });
    // Cadastro Express é a própria recepção cadastrando: não notifica
    enviados.length = 0;
    await ev.agendou({ telefone: '5562981110004', nome: 'Duda', canal: 'express' });
    assert.strictEqual(enviados.length, 0);
    // "outros avisos" vem desmarcado: só quem marcou recebe
    await ev.avisoRecepcao({ rotulo: '🔑 Palavra-chave detectada — pode precisar de atendimento', nome: 'Eva', tel: '5562981110005', tag: 'FX - Reclamação' });
    assert.deepStrictEqual(enviados.map(e => e.endpoint), [tudo]);
    assert.strictEqual(enviados[0].msg.corpo, 'Eva · FX - Reclamação');
    // conversa sem telefone (número oculto): o link vai para a lista de conversas
    assert.strictEqual(ev.linkConversa('123456789012345@lid'), '/sofia?view=conversas');
  } finally { amb.limpar(); }
});

test('a automação continua avisando a recepção por WhatsApp e passa a notificar o painel', async () => {
  const { amb, enviados, inscreve } = cenario();
  try {
    inscreve('dono', 1, ['recepcao', 'agendou']);
    amb.gravarData('contatos.json', {});
    const auto = amb.req('painel-automacao');
    auto.aplicarAutomacao({ telefone: '5562981110006', nome: 'Fê', tag: 'FX - Reclamação', avisarWpp: '5562999990000', motivo: 'palavra' });
    await new Promise(r => setTimeout(r, 100));
    const fila = fs.readFileSync(path.join(amb.sofia, 'sofia-avisos.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.strictEqual(fila.length, 1, 'o aviso por WhatsApp continua sendo enfileirado, uma vez');
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(enviados[0].msg.titulo, '🔑 Palavra-chave detectada — pode precisar de atendimento');
    // sem número de aviso configurado na tag: nem WhatsApp nem notificação
    auto.aplicarAutomacao({ telefone: '5562981110007', nome: 'Gi', tag: 'FX - Outra', avisarWpp: '', motivo: 'ia' });
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(enviados.length, 1);
    // o 'agendou' não sai por aqui (tem notificação própria, uma por agendamento)
    auto.aplicarAutomacao({ telefone: '5562981110008', nome: 'Hebe', tag: 'FX - 3. Agendou Aula Exp', avisarWpp: '5562999990000', motivo: 'agendou', canal: 'sofia' });
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(enviados.length, 1);
  } finally { amb.limpar(); }
});

test('alerta da Saúde: chega ao painel mesmo sem ntfy, sem repetir o mesmo alerta', async () => {
  const { amb, enviados, inscreve } = cenario();
  try {
    inscreve('recepcao', 1, ['atendente']);       // a recepção não vê a Saúde
    const dono = inscreve('dono', 2, ['saude']);
    const notif = amb.req('notificar');
    assert.strictEqual(await notif.alertar('WhatsApp do Studio desconectado', 'Escaneie o QR no painel.', { prioridade: 'urgent' }), true);
    assert.deepStrictEqual(enviados.map(e => e.endpoint), [dono]);
    assert.strictEqual(enviados[0].msg.titulo, 'WhatsApp do Studio desconectado');
    assert.strictEqual(enviados[0].msg.url, '/saude');
    assert.strictEqual(enviados[0].headers.Urgency, 'high');
    // o mesmo alerta dentro de 30 min não sai de novo (regra que já existia)
    assert.strictEqual(await notif.alertar('WhatsApp do Studio desconectado', 'Escaneie o QR no painel.'), false);
    assert.strictEqual(enviados.length, 1);
    assert.strictEqual(await notif.alertar('Backup atrasado', 'Último há 3 dias.', { prioridade: 'default' }), true);
    assert.strictEqual(enviados[1].headers.Urgency, 'normal');
  } finally { amb.limpar(); }
});

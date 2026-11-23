// Envio da confirmação da aula experimental (whatsapp-sender.js, usado pelo job de
// confirmação hoje/amanhã): sem telefone não envia; cada envio que deu certo é anotado
// NA HORA para a "2ª mensagem" (CONF-02); envio que falhou não é anotado.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, semEsperas } = require('../ajuda');

test('CONF-01 confirmação: envia a cada aluna com telefone, anota na hora quem recebeu e não anota quem falhou', async () => {
  const amb = ambienteIsolado(); const volta = semEsperas();
  const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
  try {
    const wa = amb.whatsappFalso();
    const enviar = wa.sendTexto;
    wa.sendTexto = async (tel, ...r) => { if (tel === '62990000003') throw new Error('número sem WhatsApp'); return enviar(tel, ...r); };
    const Sender = amb.req('whatsapp-sender');
    const s = new Sender();
    const alunas = [
      { name: 'ANA SOUZA', phone: '62990000001', time: '07:00', professor: 'Bia' },
      { name: 'Bia Lima', phone: 'N/A', time: '08:00' },
      { name: 'Carla Dias', phone: '62990000003', time: '18:00' },
      { name: 'Duda Reis', phone: '62990000004', time: '19:00' },
    ];
    const r = await s.sendBulkMessages(alunas, (nome, hora) => `Oi ${nome}! Sua aula é amanhã às ${hora}.`, 'confirmacao_amanha');
    assert.deepStrictEqual([r.sent, r.skipped, r.failed], [2, 1, 1]);
    assert.deepStrictEqual(wa.enviados.map(e => e.tel), ['62990000001', '62990000004']);
    assert.match(wa.enviados[0].texto, /às 07:00/);
    const reg = amb.lerData('confirmacoes-enviadas.json') || {};
    const anotadas = Object.values(reg).map(x => x.tel).sort();
    assert.deepStrictEqual(anotadas, ['62990000001', '62990000004'], 'só quem recebeu fica registrado para a 2ª mensagem');
    assert.ok(Object.values(reg).every(x => x.chave === 'confirmacao_amanha' && x.horario));
  } finally { console.log = log; console.error = err; volta(); amb.limpar(); }
});

// "↻ Rodar de novo" do Resumo da semana (Log): refaz o envio automático que falhou.
// Tem de valer como o envio do dia — senão o automático mandava OUTRO mais tarde —
// e não pode repetir um resumo que já saiu hoje.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado, DIA } = require('../ajuda');

const diaSP = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function preparar(amb) {
  amb.gravarSofia('sofia-conversas.json', {}); amb.gravarSofia('sofia-historico.json', {});
  // 2 agendamentos na semana (senão não há o que resumir)
  const em = Date.parse(diaSP(Date.now() - 2 * DIA) + 'T12:00:00-03:00');
  amb.gravarSofia('sofia-agendamentos.jsonl', ['5562982200001', '5562982200002'].map(tel => JSON.stringify({ tel, nome: 'Lead', when: '', canal: 'sofia', em })).join('\n') + '\n');
  amb.gravarData('resumo-semanal.json', { grupos: ['Equipe Teste'], ativas: false });
  const wa = amb.whatsappFalso();
  wa.grupos = [];
  wa.initWhatsApp = async () => {};
  wa.sendGrupo = async (grupo, texto, contexto) => { wa.grupos.push({ grupo, texto, contexto }); return true; };
  wa.sendGrupoMidia = async (grupo, img, legenda, contexto) => { wa.grupos.push({ grupo, texto: legenda, contexto, img }); return true; };
  amb.req('resumo-mensal').gerarPng = async () => { throw new Error('sem navegador no teste'); }; // vai só o texto
  return wa;
}

test('resumo da semana: rodar de novo manda nos grupos, vale como o envio do dia e não repete', async () => {
  const amb = ambienteIsolado();
  try {
    const wa = preparar(amb);
    const rs = amb.req('resumo-semanal');
    const hoje = diaSP(Date.now());
    assert.ok(!rs.lerCfg().enviados[hoje]);

    const res = await rs.refazerHoje({ log: () => {} });
    assert.strictEqual(res.length, 1);
    assert.strictEqual(wa.grupos.length, 1);
    assert.strictEqual(wa.grupos[0].grupo, 'Equipe Teste');
    assert.strictEqual(wa.grupos[0].contexto, 'Resumo da semana');
    assert.match(wa.grupos[0].texto, /2/, 'o resumo traz os agendamentos da semana');
    assert.ok(rs.lerCfg().enviados[hoje], 'ficou marcado como enviado hoje: o automático não manda outro');
    assert.strictEqual(rs.estaNaHora(Object.assign(rs.lerCfg(), { ativo: true, dias: [0, 1, 2, 3, 4, 5, 6], hora: '00:00' })), false);

    // clicar de novo (ou o automático já ter enviado): não manda outro
    assert.deepStrictEqual(await rs.refazerHoje({ log: () => {} }), []);
    assert.strictEqual(wa.grupos.length, 1);
  } finally { amb.limpar(); }
});

test('resumo da semana: se o WhatsApp falhar de novo, dá erro e não marca como enviado', async () => {
  const amb = ambienteIsolado();
  try {
    const wa = preparar(amb);
    wa.sendGrupo = async () => { throw new Error('Waiting failed: 30000ms exceeded'); };
    const rs = amb.req('resumo-semanal');
    await assert.rejects(() => rs.refazerHoje({ log: () => {} }), /Não consegui enviar em nenhum grupo/);
    assert.ok(!rs.lerCfg().enviados[diaSP(Date.now())], 'pode tentar de novo depois');
  } finally { amb.limpar(); }
});

test('o Log oferece "Rodar de novo" para o Resumo da semana que falhou, e o robô conhece esse job', () => {
  const amb = ambienteIsolado();
  try {
    const fs = require('fs');
    const painel = fs.readFileSync(amb.arq('painel-whatsapp'), 'utf8'), robo = fs.readFileSync(amb.arq('scheduler'), 'utf8');
    const linha = /\[\/\^Resumo da semana\/i, '(\w+)', (true|false),/.exec(painel);
    assert.ok(linha, 'o Resumo da semana está na lista de jobs que o Log refaz');
    assert.strictEqual(linha[2], 'true', 'é seguro: não manda em dobro');
    assert.ok(new RegExp(`\\b${linha[1]}:\\s*\\{[^\\n]*refazerHoje`).test(robo), 'o robô tem o job com esse nome, usando o envio que vale como o do dia');
    assert.ok(/^Resumo da semana/i.test('Resumo da semana no WhatsApp'), 'casa com o nome que aparece na falha do Log');
  } finally { amb.limpar(); }
});

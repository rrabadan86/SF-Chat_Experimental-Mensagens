// Visão do cliente (WhatsApp → Visão do cliente): mostra TODAS as mensagens automáticas.
// Mensagem nova no catálogo (mensagens.js) sem lugar numa jornada faz este teste falhar.
const test = require('node:test');
const assert = require('node:assert');
const { ambienteIsolado } = require('../ajuda');

test('Visão do cliente: toda mensagem do catálogo aparece em alguma jornada, e os resumos montados no código também', () => {
  const amb = ambienteIsolado();
  try {
    const v = amb.req('painel-visao-cliente'), m = amb.req('mensagens');
    const { catalogo, geradas } = v.chavesMostradas();
    const faltam = m.CATALOGO.map(x => x.chave).filter(k => !catalogo.includes(k));
    assert.deepStrictEqual(faltam, [], 'mensagens do catálogo fora da Visão do cliente');
    assert.deepStrictEqual(geradas.slice().sort(), Object.keys(v.GERADO).sort(), 'toda mensagem gerada no código aparece numa jornada');
    for (const k of Object.keys(v.GERADO)) {
      const g = v.GERADO[k]();
      const txt = typeof g === 'object' ? g.legenda + g.html : g;
      assert.ok(txt && txt.length > 60, `${k}: montou a mensagem`);
      assert.doesNotMatch(txt, /undefined|NaN|\[object Object\]/, k);
    }
  } finally { amb.limpar(); }
});

test('Visão do cliente: cada jornada abre com as bolhas preenchidas (sem variável sobrando nem "undefined")', () => {
  const amb = ambienteIsolado();
  try {
    const v = amb.req('painel-visao-cliente');
    for (const j of v.JORNADAS) {
      const html = v.paginaVisaoCliente(j.k);
      const chat = html.slice(html.indexOf('id="vcChat"'), html.indexOf('class="vc-rod"'));
      const bolhas = (chat.match(/class="vc-b in/g) || []).length;
      const esperadas = j.passos.filter(([t]) => t === 'in' || t === 'gerado' || t === 'audio').length;
      assert.strictEqual(bolhas, esperadas, `${j.k}: uma bolha por mensagem`);
      assert.doesNotMatch(chat.replace(/srcdoc="[^"]*"/g, ''), /undefined|NaN|\{[a-z_]+\}/, `${j.k}: variável sem preencher`);
    }
  } finally { amb.limpar(); }
});

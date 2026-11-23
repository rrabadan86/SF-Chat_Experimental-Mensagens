// Cobrança (inadimplentes.js → fila da SoFIA) e a trava do aniversário (aniversariantes.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambienteIsolado } = require('../ajuda');

const silencio = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const pessoa = (id, extra) => ({ idCliente: id, nome: 'ALUNA ' + id, celular: '6299000' + String(id).padStart(4, '0'), tipo: 'boleto', vencimento: '2026-11-10', vencimentoFmt: '10/11/2026', valor: 199.9, link: 'https://pag.exemplo/' + id, ...extra });

test('COB-01 cobrança: no máximo 1 vez por dia, sem duplicar a fila, e só a SoFIA marca como cobrada', () => {
  const amb = ambienteIsolado();
  try {
    const inad = amb.req('inadimplentes');
    const fila = inad.OUTBOX_FILE;
    // 2 já cobrada hoje (confirmado pela SoFIA); 3 cobrada ontem → cobra de novo; 4 já está na fila
    amb.gravarData('inadimplentes-enviados.json', { 2: { em: new Date().toISOString() }, 3: { em: new Date(Date.now() - 86400e3).toISOString() } });
    fs.writeFileSync(fila, JSON.stringify({ id: '4-x', idCliente: 4, telefone: '62990000004' }) + '\n');
    const lista = [pessoa(1), pessoa(2), pessoa(3), pessoa(4), pessoa(5, { celular: '' }), pessoa(6, { link: '' }), pessoa(7, { tipo: 'recorrente', link: '' })];
    const r = silencio(() => inad.enfileirar(lista));
    const linhas = fs.readFileSync(fila, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepStrictEqual(linhas.slice(1).map(l => l.idCliente), [1, 3], 'entram só a 1 (nova) e a 3 (cobrada ontem)');
    assert.strictEqual(r.enfileirados, 2);
    const motivo = Object.fromEntries(r.details.filter(d => d.reason).map(d => [d.name, d.reason]));
    assert.strictEqual(motivo['ALUNA 2'], 'já cobrada hoje');
    assert.strictEqual(motivo['ALUNA 4'], 'já na fila da SoFIA');
    assert.strictEqual(motivo['ALUNA 5'], 'sem telefone');
    assert.strictEqual(motivo['ALUNA 6'], 'boleto não gerado', 'sem link não enfileira');
    assert.strictEqual(motivo['ALUNA 7'], 'link não gerado');
    assert.deepStrictEqual(Object.keys(amb.lerData('inadimplentes-enviados.json')).sort(), ['2', '3'], 'enfileirar não marca ninguém como cobrada');
    // rodar de novo no mesmo dia: 1 e 3 já estão na fila → não duplica
    silencio(() => inad.enfileirar(lista));
    assert.strictEqual(fs.readFileSync(fila, 'utf8').trim().split('\n').length, 3);
  } finally { amb.limpar(); }
});

test('COB-02 cobrança: o boleto que vence hoje só sai no disparo "vence hoje", e o vencido só no regular', () => {
  const amb = ambienteIsolado();
  try {
    const inad = amb.req('inadimplentes');
    const lista = [pessoa(1, { venceHoje: true }), pessoa(2)];
    const ler = () => { try { return fs.readFileSync(inad.OUTBOX_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (_) { return []; } };
    silencio(() => inad.enfileirar(lista, { modo: 'regular' }));
    assert.deepStrictEqual(ler().map(l => [l.idCliente, l.chaveMsg]), [[2, 'cobranca_boleto']]);
    silencio(() => inad.enfileirar(lista, { modo: 'hoje' }));
    assert.deepStrictEqual(ler().map(l => [l.idCliente, l.chaveMsg]), [[2, 'cobranca_boleto'], [1, 'cobranca_boleto_hoje']]);
  } finally { amb.limpar(); }
});

test('ALU-09 aniversário: não manda quando o celular do cadastro é de OUTRA aluna', () => {
  const amb = ambienteIsolado();
  try {
    amb.gravarData('contatos.json', {
      5562990001111: { tel: '5562990001111', nome: 'Mariana Alves', idEvo: 501, tags: [] },
      5562990002222: { tel: '5562990002222', nome: 'Natália Souza', idEvo: 502, tags: [] },
      5562990003333: { tel: '5562990003333', nome: 'Apelido do WhatsApp', tags: [] },     // sem código do EVO: não serve de prova
    });
    const a = amb.req('aniversariantes');
    assert.deepStrictEqual(a.donoDoTelefone('62990001111', 'Natália Souza'), { nome: 'Mariana Alves', idEvo: 501 }, 'o celular é da Mariana');
    assert.strictEqual(a.donoDoTelefone('62990001111', 'MARIANA ALVES'), null, 'é da própria aniversariante');
    assert.strictEqual(a.donoDoTelefone('62990003333', 'Natália Souza'), null, 'contato sem código do EVO não barra');
    assert.strictEqual(a.donoDoTelefone('62990009999', 'Natália Souza'), null, 'número desconhecido não barra');
    assert.deepStrictEqual(a.celularPeloNome('natalia souza'), { tel: '5562990002222', idEvo: 502 }, 'celular pelo nome completo, sem acento');
    assert.strictEqual(a.celularPeloNome('Natália'), null, 'só com nome completo');
  } finally { amb.limpar(); }
});

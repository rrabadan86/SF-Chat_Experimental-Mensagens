// PAG-01: pagamento dos professores — sábado por aula (R$ 35 para quem deu cada aula)
// a partir do mês escolhido nas Regras; antes dele, a diária antiga (R$ 70 por sábado
// para cada professor). Aula de feriado / sem ninguém também paga.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ambienteIsolado } = require('../ajuda');

// Novembro/2026: sábados 07 e 14. No dia 07, uma aula de cada professora; no 14, a
// Ana dá as duas. Nenhuma lista de presença (como num feriado ou aula vazia).
const AULAS = [
  { s: 1, d: '2026-11-07', h: '08:00', n: 'SLIMFIT', p: 'Ana', pi: '1' },
  { s: 2, d: '2026-11-07', h: '09:00', n: 'SLIMFIT', p: 'Bia', pi: '2' },
  { s: 3, d: '2026-11-14', h: '08:00', n: 'SLIMFIT', p: 'Ana', pi: '1' },
  { s: 4, d: '2026-11-14', h: '09:00', n: 'SLIMFIT', p: 'Ana', pi: '1' },
];

function calcular(regras) {
  const amb = ambienteIsolado();
  try {
    const dir = path.join(amb.data, 'pagamento');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mes-2026-11.json'), JSON.stringify({ aulas: AULAS, listas: {} }));
    const pcfg = amb.req('pagamento/config');
    if (regras) pcfg.salvarRegras(regras);
    const r = amb.req('pagamento/calculo').calcularMes(2026, 11);
    assert.ok(r.ok, r.erro);
    const por = Object.fromEntries(r.professores.map((p) => [p.nome, p.total]));
    return { por, total: r.total, regras: r.regras, aulas: r.professores.flatMap((p) => p.turmas.flatMap((t) => t.aulas.map((a) => ({ prof: p.nome, data: a.data, hora: a.hora, valor: a.valor, regra: a.regra })))) };
  } finally { try { fs.rmSync(amb.raiz, { recursive: true, force: true }); } catch (_) {} }
}

test('PAG-01 sábado por aula: R$ 35 para quem deu cada aula — duas professoras no mesmo sábado recebem 35 cada; a mesma nas duas, 70', () => {
  const r = calcular({ sabadoAulaValor: '35', sabadoPorAulaDesde: '2026-11' });
  assert.deepStrictEqual(r.por, { Ana: 105, Bia: 35 });
  assert.strictEqual(r.total, 140, 'dois sábados × 2 aulas × R$ 35');
  assert.ok(r.aulas.every((a) => a.valor === 35 && a.regra === 'sábado por aula'), JSON.stringify(r.aulas));
});

test('PAG-01 sábado por aula: antes do mês escolhido (ou sem mês) continua a diária antiga', () => {
  const semMes = calcular(null);
  assert.deepStrictEqual(semMes.por, { Ana: 140, Bia: 70 }, 'diária de R$ 70 por sábado para cada professora');
  assert.strictEqual(semMes.regras.sabadoPorAulaDesde, '');
  const depois = calcular({ sabadoAulaValor: '35', sabadoPorAulaDesde: '2026-12' });
  assert.deepStrictEqual(depois.por, { Ana: 140, Bia: 70 }, 'novembro fica como estava');
});

test('PAG-01 sábado por aula: mês inválido é recusado e em branco desliga', () => {
  const amb = ambienteIsolado();
  try {
    const pcfg = amb.req('pagamento/config');
    assert.throws(() => pcfg.salvarRegras({ sabadoPorAulaDesde: '2026-13' }), /inválido/);
    assert.throws(() => pcfg.salvarRegras({ sabadoAulaValor: '-1' }), /inválido/);
    assert.strictEqual(pcfg.salvarRegras({ sabadoPorAulaDesde: '2026-12' }).sabadoPorAulaDesde, '2026-12');
    assert.strictEqual(pcfg.salvarRegras({ sabadoPorAulaDesde: '' }).sabadoPorAulaDesde, '');
    assert.strictEqual(pcfg.sabadoPorAula({ sabadoPorAulaDesde: '2026-12' }, '2026-11'), false);
    assert.strictEqual(pcfg.sabadoPorAula({ sabadoPorAulaDesde: '2026-12' }, '2027-01'), true);
  } finally { try { fs.rmSync(amb.raiz, { recursive: true, force: true }); } catch (_) {} }
});

// Leitura da Segmentação "Aniversariantes" do EVO (jobs de aniversário e planilha).
// Em 11/2026 a coluna "Data de aniversário" passou a vir só com dia/mês ("19/11") e
// o robô pegava a "Última presença" (11/11/2026) no lugar — a aniversariante do dia
// não recebia o parabéns. Precisa de navegador (playwright); sem ele, o teste é pulado.
const test = require('node:test');
const assert = require('node:assert');
const { lerLinhasAniversario, diaMes, conferirMes } = require('../../src/evo-tabela-aniversario');

let playwright = null;
try { playwright = require('playwright'); } catch (_) {}

const cel = (t) => `<td>${t}</td>`;
const linha = (id, nome, aniv, presenca) => `<tr><td><input type="checkbox"></td>
  <td><div><span>${id}</span><span>CL</span></div><a href="#">${nome}</a></td>
  ${cel(aniv)}${cel('Juliana')}${cel('36')}${cel('-')}${cel(presenca)}${cel('SLIMFIT 2X FIXA')}${cel('62991500000')}</tr>`;
// Igual à tela de 19/11/2026: dia/mês sem ano e "Última presença" com ano.
const NOVO = `<table><thead><tr><th></th><th>Nome</th><th>Data de aniversário</th><th>Colaborador</th><th>Idade</th>
  <th>Interesse</th><th>Última presença</th><th>Contrato ativo</th><th>Celular</th></tr></thead><tbody>
  ${linha('5860', 'Ana Cristina de Assis Portilho', '01/11', '08/01/2025')}
  ${linha('5572', 'Ana Beatriz Ribeiro Reges', '05/11', '-')}
  ${linha('3554', 'Monise Ariane Damas da Costa', '18/11', '-')}
  ${linha('5415', 'Paula Gabriella da Silva Chaga', '19/11', '11/11/2026')}
  ${linha('5411', 'Darcy Teixeira da Silva Ferreira', '20/11', '-')}
  </tbody></table>`;
// Formato antigo: linhas de <div>, data completa de nascimento.
const ANTIGO = `<div class="lista">
  <div class="row"><span>4669</span> <a href="#">Márcia Marolina Dias Ferreira</a> <span>10/11/1981</span> <span>Juliana</span></div>
  <div class="row"><span>5415</span> <a href="#">Paula Gabriella da Silva Chaga</a> <span>19/11/1990</span> <span>Juliana</span></div>
  </div>`;

test('EVO-02 ALU-09 lê a data pela coluna "Data de aniversário" (dia/mês), nunca a última presença', { skip: !playwright && 'sem playwright' }, async () => {
  const nav = await playwright.chromium.launch();
  try {
    const page = await nav.newPage();
    await page.setContent(NOVO);
    const r = await page.evaluate(lerLinhasAniversario);
    assert.strictEqual(r.length, 5);
    const paula = r.find(x => /Paula/.test(x.nome));
    assert.deepStrictEqual(paula, { id: '5415', nome: 'Paula Gabriella da Silva Chaga', nascimento: '19/11', celular: '62991500000' }); // celular da coluna "Celular"
    assert.deepStrictEqual(r.map(x => x.nascimento), ['01/11', '05/11', '18/11', '19/11', '20/11']);
    assert.ok(r.every(x => /^\d{4}$/.test(x.id)), 'pegou o código de cada aluna');

    await page.setContent(ANTIGO);
    const a = await page.evaluate(lerLinhasAniversario);
    assert.deepStrictEqual(a.map(x => [x.id, x.nome, x.nascimento]), [
      ['4669', 'Márcia Marolina Dias Ferreira', '10/11/1981'], ['5415', 'Paula Gabriella da Silva Chaga', '19/11/1990']]);
  } finally { await nav.close(); }
});

test('EVO-02 dia/mês com e sem ano', () => {
  assert.deepStrictEqual(diaMes('19/11'), { dia: 19, mes: 11 });
  assert.deepStrictEqual(diaMes('19/11/1990'), { dia: 19, mes: 11 });
  assert.deepStrictEqual(diaMes('1990-11-19'), { dia: 19, mes: 11 });
  assert.strictEqual(diaMes('-'), null);
});

test('EVO-02 trava: datas de outros meses (coluna errada) param o job em vez de dizer "ninguém hoje"', () => {
  const certas = ['01/11', '05/11', '18/11', '19/11', '20/11'].map(n => ({ nascimento: n }));
  assert.doesNotThrow(() => conferirMes(certas, 11));
  // o que o robô leu em 19/11/2026: a última presença de cada uma
  const erradas = ['08/01/2025', '19/11/2026', '18/08/2026', '18/12/2024', '18/11/2026', '31/05/2025', '22/09/2026'].map(n => ({ nascimento: n }));
  assert.throws(() => conferirMes(erradas, 11), /não batem com o mês/);
  assert.doesNotThrow(() => conferirMes(erradas.slice(0, 3), 11), 'com poucas linhas não dá para concluir');
});

// O mapa docs/REGRAS-DE-ENVIO.md não pode mentir: todo teste citado lá precisa
// existir com o mesmo título, e todo arquivo citado precisa existir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MAPA = path.join(REPO, 'docs', 'REGRAS-DE-ENVIO.md');
const UNIDADE = __dirname;

function linhas() {
  return fs.readFileSync(MAPA, 'utf8').split('\n')
    .filter(l => /^\|/.test(l) && !/^\|\s*(Regra|---)/.test(l))
    .map(l => { const c = l.split('|').slice(1, -1).map(x => x.trim()); return { regra: c[0], onde: c[1], teste: c[2] }; });
}

test('o mapa das regras de envio só cita testes e arquivos que existem', () => {
  const ls = linhas();
  assert.ok(ls.length >= 20, 'mapa vazio ou mal formatado');
  const erros = [];
  let comTeste = 0;
  for (const l of ls) {
    for (const a of (l.onde.match(/`([^`]+)`/g) || []).map(x => x.slice(1, -1))) {
      const ok = [path.join(REPO, 'Experimental', 'src', a), path.join(REPO, a)].some(f => fs.existsSync(f));
      if (!ok) erros.push(`"${l.regra}": arquivo ${a} não existe`);
    }
    if (/falta teste/i.test(l.teste)) continue;
    const m = /^`([^`]+\.test\.js)`\s*›\s*(.+)$/.exec(l.teste);
    if (!m) { erros.push(`"${l.regra}": coluna Teste fora do formato (\`arquivo.test.js\` › título)`); continue; }
    const arq = path.join(UNIDADE, m[1]);
    if (!fs.existsSync(arq)) { erros.push(`"${l.regra}": ${m[1]} não existe`); continue; }
    if (!fs.readFileSync(arq, 'utf8').includes(m[2].trim())) erros.push(`"${l.regra}": ${m[1]} não tem o teste "${m[2].trim()}"`);
    comTeste++;
  }
  console.log(`   ${comTeste} regra(s) com teste · ${ls.length - comTeste} sem teste ainda (marcadas "falta teste")`);
  assert.deepStrictEqual(erros, []);
});

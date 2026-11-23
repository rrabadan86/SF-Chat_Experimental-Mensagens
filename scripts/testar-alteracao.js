#!/usr/bin/env node
/**
 * Testa primeiro o que a alteração pode ter quebrado.
 *
 *   cd Experimental && npm run testar-alteracao            arquivos mexidos desde a main
 *   cd Experimental && npm run testar-alteracao -- --so    roda só os testes das regras mexidas
 *
 * 1. Lista os arquivos mexidos (commits desde a origin/main + o que ainda não foi commitado).
 * 2. Pela coluna "Onde" da matriz (docs/rastreabilidade.md), acha as regras desses arquivos.
 * 3. Roda primeiro os testes dessas regras (e os arquivos de teste mexidos).
 * 4. Avisa as regras mexidas que não têm teste (❌) ou têm só em parte.
 * 5. Sem --so, roda depois o resto dos testes de unidade.
 * Os testes rodam como sempre: em cópia temporária, sem tocar dado real.
 */
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const M = require('./matriz');

const so = process.argv.includes('--so');
const sh = (c) => { try { return execSync(c, { cwd: M.REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return ''; } };

function mexidos() {
  const base = sh('git merge-base origin/main HEAD').trim();
  const lista = [
    ...(base ? sh(`git diff --name-only ${base} HEAD`) : '').split('\n'),
    ...sh('git diff --name-only HEAD').split('\n'),
    ...sh('git ls-files --others --exclude-standard').split('\n'),
  ];
  return [...new Set(lista.filter(Boolean))].filter(f => fs.existsSync(path.join(M.REPO, f)));
}

const arquivos = mexidos();
if (!arquivos.length) { console.log('Nada mexido em relação à origin/main.'); process.exit(0); }

const { erros, linhas } = M.conferir();
const abs = (f) => path.join(M.REPO, f);
const afetadas = linhas.filter(l => l.onde.some(o => arquivos.some(a => M.acharArquivo(o) === abs(a))));
const semRegra = arquivos.filter(a => /\.(js|ts|py)$/.test(a) && !/testes?\//.test(a) && !linhas.some(l => l.onde.some(o => M.acharArquivo(o) === abs(a))));

const jsPrimeiro = new Set(), outros = new Set();
let python = false, telas = false;
for (const l of afetadas) for (const r of l.testes) {
  if (!r.alvo) continue;
  if (r.alvo.telas) telas = true;
  else if (r.alvo.python) python = true;
  else jsPrimeiro.add(r.alvo.caminho);
}
for (const a of arquivos) if (/\.test\.js$/.test(a)) jsPrimeiro.add(abs(a));
if (arquivos.some(a => /^Experimental\/src\/agendamento_evo\//.test(a))) python = true;
if (arquivos.some(a => /painel-|testes\/tela\//.test(a))) telas = true;

console.log(`Arquivos mexidos: ${arquivos.length}`);
console.log(afetadas.length ? `Regras desses arquivos: ${afetadas.map(l => l.codigo).join(', ')}` : 'Nenhuma regra da matriz aponta para esses arquivos.');
const sem = afetadas.filter(l => l.cobertura === '❌'), parte = afetadas.filter(l => l.cobertura === 'parcial');
if (sem.length) console.log(`\n⚠️  Regras mexidas SEM teste — confira à mão ou escreva o teste:\n${sem.map(l => `   ${l.codigo} ${l.regra}`).join('\n')}`);
if (parte.length) console.log(`\n⚠️  Regras mexidas com teste só em parte:\n${parte.map(l => `   ${l.codigo} ${l.coberturaTexto.replace(/^parcial:?\s*/, 'falta: ')}`).join('\n')}`);
if (semRegra.length) console.log(`\nℹ️  Arquivos de código sem regra na matriz: ${semRegra.join(', ')}`);
if (erros.length) console.log(`\n⚠️  A matriz tem ${erros.length} problema(s) — rode: npm run matriz`);

let falhou = false;
const rodar = (titulo, cmd, args, cwd) => {
  console.log(`\n▶ ${titulo}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) falhou = true;
};
const rel = (f) => path.relative(M.EXP, f);
const unidade = path.join(M.EXP, 'testes', 'unidade');
const tela = path.join(M.EXP, 'testes', 'tela');
const primeiro = [...jsPrimeiro].filter(f => fs.existsSync(f));
const primeiroUnidade = primeiro.filter(f => f.startsWith(unidade));
const primeiroTela = primeiro.filter(f => f.startsWith(tela));
if (primeiroUnidade.length) rodar(`Testes das regras mexidas (${primeiroUnidade.length} arquivo(s))`, process.execPath, ['--test', ...primeiroUnidade.map(rel)], M.EXP);
if (primeiroTela.length) rodar('Peças de tela no navegador', process.execPath, ['--test', ...primeiroTela.map(rel)], M.EXP);
if (python) rodar('EVO (Python, offline)', 'python3', ['-m', 'tests.test_offline'], path.join(M.EXP, 'src', 'agendamento_evo'));
if (!so) {
  const resto = fs.readdirSync(unidade).filter(f => f.endsWith('.test.js')).map(f => path.join(unidade, f)).filter(f => !jsPrimeiro.has(f));
  if (resto.length) rodar(`Resto dos testes de unidade (${resto.length} arquivo(s))`, process.execPath, ['--test', ...resto.map(rel)], M.EXP);
}
if (telas) console.log('\nℹ️  Mexeu em tela: rode também  node testes/tela/telas.js --estrito');
console.log(falhou ? '\n❌ Algum teste falhou.' : '\n✅ Testes passaram.');
process.exit(falhou ? 1 : 0);

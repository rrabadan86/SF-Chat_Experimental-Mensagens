/**
 * Executa a suíte de testes.
 *
 * Por que não `node --test` direto: sem argumento ele varre a pasta inteira em
 * busca de arquivos de teste, e acaba entrando em `wwebjs_auth/` — a sessão do
 * WhatsApp, cheia de links do Chromium que quebram a varredura. Passar um
 * curinga também não serve: a expansão pelo próprio Node só existe a partir da
 * versão 22, e a expansão pelo shell não acontece no Windows.
 *
 * Então listamos os arquivos aqui, o que funciona igual em qualquer sistema e
 * em qualquer versão suportada.
 */
const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const pasta = path.join(raiz, 'tests');

const arquivos = readdirSync(pasta)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));

if (!arquivos.length) {
  console.error('Nenhum arquivo de teste encontrado em tests/.');
  process.exit(1);
}

const resultado = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...arquivos],
  { stdio: 'inherit', cwd: raiz }
);

process.exit(resultado.status === null ? 1 : resultado.status);

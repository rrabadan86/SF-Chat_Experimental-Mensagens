#!/usr/bin/env node
/**
 * Hook (PostToolUse/Bash) — DEP-07. Lembretes depois de "git commit" e "git push".
 *
 * - commit: diz quais regras de .claude/rules/ valem para os arquivos do commit (pelos
 *   `paths:` de cada arquivo de regra) e quais regras desses arquivos, na matriz
 *   (docs/rastreabilidade.md), não têm teste ou têm só em parte.
 * - push: lembra de conferir o PR (skill conferir-pr) antes do merge.
 *
 * Só avisa (nunca bloqueia). As regras e a matriz vêm desta instalação (pasta do hook);
 * a lista de arquivos vem do git da pasta onde o comando rodou.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

// glob dos `paths:` → expressão regular ("**" = qualquer pasta, "*" = parte de um nome)
function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function regrasDaArea() {
  const dir = path.join(REPO, '.claude', 'rules');
  const lista = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(txt);
    const paths = fm ? [...fm[1].matchAll(/^\s*-\s*"([^"]+)"/gm)].map(m => m[1]) : [];
    const codigos = [...new Set([...txt.matchAll(/\*\*([A-Z]{2,4})-\d{2}\*\*/g)].map(m => m[1]))];
    lista.push({ arquivo: f, res: paths.map(globRe), codigos });
  }
  return lista;
}

function lembreteCommit(arquivos) {
  if (!arquivos.length) return '';
  const areas = regrasDaArea().filter(a => arquivos.some(f => a.res.some(re => re.test(f))));
  const linhas = [];
  if (areas.length) linhas.push(`Regras da área dos arquivos deste commit: ${areas.map(a => `.claude/rules/${a.arquivo} (${a.codigos.join(', ')})`).join('; ')}. Confira se o commit segue essas regras.`);
  try {
    const M = require(path.join(REPO, 'scripts', 'matriz.js'));
    const linhasM = M.lerMatriz();
    const abs = (f) => path.join(REPO, f);
    const afetadas = linhasM.filter(l => l.onde.some(o => arquivos.some(f => M.acharArquivo(o) === abs(f))));
    const sem = afetadas.filter(l => l.cobertura === '❌').map(l => l.codigo);
    const parte = afetadas.filter(l => l.cobertura === 'parcial').map(l => l.codigo);
    if (sem.length) linhas.push(`Regras destes arquivos SEM teste: ${sem.join(', ')} — confira à mão ou escreva o teste (docs/rastreabilidade.md).`);
    if (parte.length) linhas.push(`Regras com teste só em parte: ${parte.join(', ')}.`);
  } catch (_) { /* sem matriz: só o lembrete da área */ }
  if (arquivos.some(f => /^Experimental\/src\/painel-|^Experimental\/testes\/tela\//.test(f))) linhas.push('Mexeu em tela: rode a skill conferir-celular antes do PR.');
  return linhas.length ? '📌 ' + linhas.join('\n📌 ') : '';
}

// O comando roda mesmo "git <sub>"? (texto de heredoc, echo ou mensagem não conta)
function rodou(cmd, sub) {
  const semHeredoc = String(cmd).replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, '');
  return semHeredoc.split(/&&|\|\||[;|\n]/).some(parte => {
    const p = parte.trim().replace(/^(\w+=\S*\s+)*/, '');
    const m = /^git((?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*)\s+(\S+)/.exec(p);
    return !!m && m[2] === sub;
  });
}

let entrada = '';
if (require.main === module) process.stdin.on('data', d => (entrada += d)).on('end', () => {
  let cmd = '';
  try { cmd = String((JSON.parse(entrada).tool_input || {}).command || ''); } catch (_) { process.exit(0); }
  const commit = rodou(cmd, 'commit'), push = rodou(cmd, 'push');
  if (!commit && !push) process.exit(0);
  const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; } };
  const msgs = [];
  if (commit) {
    // só se o commit aconteceu agora (o comando pode ter falhado)
    const quando = Number(sh('git log -1 --format=%ct')) * 1000;
    if (quando && Date.now() - quando < 5 * 60 * 1000) {
      const arquivos = sh('git diff-tree --root --no-commit-id --name-only -r HEAD').split('\n').filter(Boolean);
      const m = lembreteCommit(arquivos);
      if (m) msgs.push(m);
    }
  }
  if (push) {
    const local = sh('git rev-parse HEAD'), remoto = sh('git rev-parse @{u}');
    if (local && local === remoto) msgs.push('📌 Push feito. Antes do merge, rode a skill conferir-pr (CI ✓, matriz, Novidades, nada de dado ou segredo no PR).');
  }
  if (!msgs.length) process.exit(0);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msgs.join('\n') } }));
  process.exit(0);
});

module.exports = { globRe, regrasDaArea, lembreteCommit, rodou };

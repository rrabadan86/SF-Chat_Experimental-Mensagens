#!/usr/bin/env node
/**
 * Hook (PreToolUse/Bash): antes de "git commit" ou "git push", procura segredos no
 * que vai entrar no repositório e BLOQUEIA (exit 2) se achar.
 *
 * - commit: alterações já marcadas + alterações em arquivos rastreados + arquivos
 *   novos não ignorados (o comando pode ter um "git add" junto, que roda depois do hook).
 * - push: os commits que ainda não estão no remoto.
 * Procura: chaves conhecidas (Anthropic, OpenAI, Groq, GitHub, Google, AWS, Slack,
 * Fitily), chaves privadas, "SENHA/TOKEN/SECRET/API_KEY=<valor>", e arquivos que não
 * podem subir (.env, Experimental/data/, sessões do WhatsApp, conversas reais da demo).
 */
const { execSync } = require('child_process');

let entrada = '';
process.stdin.on('data', d => (entrada += d)).on('end', () => {
  let cmd = '';
  try { cmd = String((JSON.parse(entrada).tool_input || {}).command || ''); } catch (_) { process.exit(0); }
  const commit = /\bgit\b[^;&|]*\bcommit\b/.test(cmd), push = /\bgit\b[^;&|]*\bpush\b/.test(cmd);
  if (!commit && !push) process.exit(0);

  const raiz = (() => { try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); } catch (_) { return ''; } })();
  if (!raiz) process.exit(0);
  const sh = (c) => { try { return execSync(c, { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return ''; } };

  let diff = '', arquivos = [];
  if (commit) {
    diff += sh('git diff --cached -U0') + sh('git diff -U0');
    const novos = sh('git ls-files --others --exclude-standard').split('\n').filter(Boolean);
    arquivos.push(...sh('git diff --cached --name-only').split('\n'), ...sh('git diff --name-only').split('\n'), ...novos);
    for (const f of novos) { try { if (require('fs').statSync(require('path').join(raiz, f)).size < 2e6) diff += `+++ b/${f}\n` + require('fs').readFileSync(require('path').join(raiz, f), 'utf8').split('\n').map(l => '+' + l).join('\n') + '\n'; } catch (_) {} }
  }
  if (push) {
    const base = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}').trim() || 'origin/main';
    diff += sh(`git log -p -U0 --format= ${base}..HEAD`);
    arquivos.push(...sh(`git diff --name-only ${base}...HEAD`).split('\n'));
  }
  arquivos = [...new Set(arquivos.filter(Boolean))];

  const achados = [];
  const PROIBIDOS = [
    [/(^|\/)\.env$|(^|\/)[^/]+\.env$/, 'arquivo .env'],
    [/^Experimental\/data\//, 'dados da unidade (Experimental/data/)'],
    [/(^|\/)\.?wwebjs_auth\//, 'sessão do WhatsApp'],
    [/(^|\/)sofia-demo\/|demo-conversas-reais[^/]*\.json$/, 'conversas reais da demonstração'],
  ];
  for (const f of arquivos) for (const [re, o] of PROIBIDOS) if (re.test(f) && !/\.example$|env\.example|\.env\.example$/.test(f)) achados.push(`${f} — ${o}`);

  const CHAVES = [
    [/sk-ant-[A-Za-z0-9_-]{20,}/, 'chave da Anthropic'],
    [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'chave da OpenAI'],
    [/\bgsk_[A-Za-z0-9]{20,}/, 'chave da Groq'],
    [/\bffk_[A-Za-z0-9_-]{16,}/, 'chave do Fitily'],
    [/\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'token do GitHub'],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, 'chave do Google'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'chave da AWS'],
    [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'token do Slack'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  ];
  // "SENHA=valor" etc. com valor de verdade (não exemplo/variável/vazio)
  const ATRIB = /\b([A-Z0-9_]*(SENHA|PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|APIKEY|ACCESS_KEY))\s*[:=]\s*['"]?([^\s'"`,;)]{8,})/;
  const EXEMPLO = /^(\$|\{|<|process\.env|xxx|sua|seu|exemplo|example|changeme|placeholder|dummy|\*+|\.\.\.)|xxxx|exemplo|example/i;
  let arqAtual = '';
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { arqAtual = l.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    const linha = l.slice(1);
    for (const [re, o] of CHAVES) if (re.test(linha)) achados.push(`${arqAtual} — ${o}`);
    const m = ATRIB.exec(linha);
    if (m && !EXEMPLO.test(m[3]) && !/\.(md|html)$/.test(arqAtual) && !/process\.env|lerEnv|\$\{/.test(linha)) achados.push(`${arqAtual} — ${m[1]} com valor`);
  }
  if (!achados.length) process.exit(0);
  process.stderr.write(`🔒 Bloqueado: possível segredo no que vai para o repositório:\n${[...new Set(achados)].slice(0, 15).map(a => '  - ' + a).join('\n')}\n`
    + 'Tire o segredo (ou o arquivo) do commit. Se for falso alarme, mostre ao usuário e peça confirmação antes de seguir.\n');
  process.exit(2);
});

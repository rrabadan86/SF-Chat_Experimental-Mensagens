#!/usr/bin/env node
/**
 * atualizar.js — atualiza TODAS as unidades deste servidor com um comando.
 *
 * Descobre sozinho o que roda aqui: lê os processos do PM2, vê de qual pasta
 * cada um vem e agrupa por repositório git (painel, robô, SoFIA e formulário de
 * cada unidade — inclusive 2 unidades no mesmo servidor, como o Lago Sul).
 * Para cada repositório nosso (github.com/rrabadan86/…):
 *   1. baixa a versão nova do main (git fetch + reset --hard, como sempre);
 *   2. se mudou package.json/package-lock.json, roda npm install na pasta;
 *   3. reinicia os processos daquele repositório (só se o código mudou);
 * e no fim mostra se todos voltaram "online".
 *
 * Uso (no servidor, como root):
 *   node /root/SF-Chat_Experimental-Mensagens/scripts/atualizar.js
 *     --painel   reinicia só os painéis (mudança só de tela; robô e SoFIA seguem)
 *     --forcar   reinicia mesmo se o código já estava atualizado
 *     --simular  só mostra o que faria, sem mudar nada
 *     --instalar cria o atalho "slimfit-atualizar" (depois é só digitar isso)
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const SO_PAINEL = args.has('--painel');
const FORCAR = args.has('--forcar');
const SIMULAR = args.has('--simular');
const NOSSO = /github\.com[:/]rrabadan86\//i;

const cor = (c, t) => process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t;
const ok = (t) => cor('32', t), aviso = (t) => cor('33', t), erro = (t) => cor('31', t), neg = (t) => cor('1', t);

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
}
function git(dir, ...a) { return sh('git', ['-C', dir, ...a]); }
// pm2 jlist às vezes imprime avisos antes do JSON (ex.: "[PM2] …") — começa na lista de verdade.
function pm2Lista() {
  const t = sh('pm2', ['jlist']);
  const m = /\[\s*(\{|\])/.exec(t);
  return JSON.parse(m ? t.slice(m.index) : t);
}

// ── atalho ──────────────────────────────────────────────────────────────────
if (args.has('--instalar')) {
  const alvo = '/usr/local/bin/slimfit-atualizar';
  const corpo = `#!/bin/sh\n# Atualiza todas as unidades SlimFit deste servidor (scripts/atualizar.js).\nexec node "${path.resolve(__filename)}" "$@"\n`;
  try { fs.writeFileSync(alvo, corpo, { mode: 0o755 }); console.log(ok(`✅ Atalho criado: agora é só digitar ${neg('slimfit-atualizar')}`)); }
  catch (e) { console.log(erro(`❌ Não consegui criar ${alvo}: ${e.message}`)); process.exit(1); }
  process.exit(0);
}

// ── 1. o que roda neste servidor ────────────────────────────────────────────
let procs;
try { procs = pm2Lista(); }
catch (e) { console.log(erro('❌ Não consegui ler o PM2 (pm2 jlist). Ele está instalado e rodando como este usuário?')); process.exit(1); }

const repos = new Map(); // raiz do git → { raiz, procs: [nome…] }
const fora = [];
for (const p of procs) {
  const env = p.pm2_env || {};
  const nome = p.name;
  if (!nome || env.pmx_module) continue; // módulos do PM2 (ex.: pm2-logrotate)
  const pasta = env.pm_cwd || (env.pm_exec_path ? path.dirname(env.pm_exec_path) : '');
  let raiz = '';
  try { if (pasta && fs.existsSync(pasta)) raiz = git(pasta, 'rev-parse', '--show-toplevel'); } catch (_) {}
  let url = '';
  try { if (raiz) url = git(raiz, 'remote', 'get-url', 'origin'); } catch (_) {}
  if (!raiz || !NOSSO.test(url)) { fora.push(nome); continue; }
  if (!repos.has(raiz)) repos.set(raiz, { raiz, procs: [] });
  repos.get(raiz).procs.push(nome);
}

if (!repos.size) { console.log(aviso('Nenhum processo do SlimFit encontrado no PM2 deste servidor.')); process.exit(0); }
console.log(neg(`\n🔄 Atualizando ${repos.size} pasta(s) do SlimFit neste servidor${SIMULAR ? ' (SIMULAÇÃO — nada será alterado)' : ''}\n`));
if (fora.length) console.log(`   (fora do SlimFit, não mexo: ${fora.join(', ')})\n`);

// ── 2. atualiza o código de cada repositório ────────────────────────────────
const reiniciar = [];
let falhou = false;
for (const r of repos.values()) {
  console.log(neg(`📁 ${r.raiz}`) + `  →  ${r.procs.join(', ')}`);
  let antes = '', depois = '';
  try {
    antes = git(r.raiz, 'rev-parse', 'HEAD');
    if (!SIMULAR) {
      git(r.raiz, 'fetch', 'origin', 'main');
      git(r.raiz, 'reset', '--hard', 'FETCH_HEAD');
      depois = git(r.raiz, 'rev-parse', 'HEAD');
    } else {
      git(r.raiz, 'fetch', 'origin', 'main');
      depois = git(r.raiz, 'rev-parse', 'FETCH_HEAD');
    }
  } catch (e) {
    falhou = true;
    console.log(erro(`   ❌ Não consegui baixar a atualização: ${(e.stderr || e.message || '').toString().split('\n')[0]}`));
    continue;
  }
  const mudou = antes !== depois;
  if (mudou) {
    let n = '?', titulos = [];
    try { n = git(r.raiz, 'rev-list', '--count', `${antes}..${depois}`); } catch (_) {}
    try { titulos = git(r.raiz, 'log', '--format=%s', '-8', `${antes}..${depois}`).split('\n').filter(Boolean); } catch (_) {}
    console.log(ok(`   ✅ ${n} atualização(ões) nova(s):`));
    titulos.forEach(t => console.log(`      • ${t.replace(/\s*\(#\d+\)$/, '')}`));
    if (Number(n) > titulos.length) console.log(`      • … e mais ${Number(n) - titulos.length}`);
    // Dependências novas? (package.json / package-lock.json de alguma subpasta)
    let arquivos = [];
    try { arquivos = git(r.raiz, 'diff', '--name-only', antes, depois).split('\n'); } catch (_) {}
    const pastasNpm = [...new Set(arquivos.filter(f => /(^|\/)package(-lock)?\.json$/.test(f)).map(f => path.join(r.raiz, path.dirname(f))))];
    for (const d of pastasNpm) {
      if (!fs.existsSync(path.join(d, 'package.json'))) continue;
      console.log(`   📦 Dependências mudaram em ${path.relative(r.raiz, d) || '.'} — npm install${SIMULAR ? ' (simulado)' : '…'}`);
      if (!SIMULAR) {
        const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: d, encoding: 'utf8' });
        if (res.status !== 0) { falhou = true; console.log(erro(`   ❌ npm install falhou em ${d}:\n${(res.stderr || '').split('\n').slice(-6).join('\n')}`)); }
      }
    }
    if (arquivos.some(f => /requirements\.txt$/.test(f))) console.log(aviso('   ⚠️  requirements.txt mudou (Python) — me avise que eu passo o comando de instalação.'));
  } else {
    console.log('   já estava atualizado.');
  }
  if (mudou || FORCAR) {
    const alvo = SO_PAINEL ? r.procs.filter(n => /painel/.test(n)) : r.procs;
    reiniciar.push(...alvo);
  }
}

// ── 3. reinicia e confere ───────────────────────────────────────────────────
console.log('');
if (!reiniciar.length) {
  console.log(ok('Nada para reiniciar — tudo já estava na versão mais nova.') + (FORCAR ? '' : ' (use --forcar para reiniciar mesmo assim)'));
  process.exit(falhou ? 1 : 0);
}
console.log(neg(`♻️  Reiniciando: ${reiniciar.join(', ')}${SIMULAR ? ' (simulado)' : ''}`));
if (SIMULAR) process.exit(0);
for (const nome of reiniciar) {
  try { sh('pm2', ['restart', nome]); }
  catch (e) { falhou = true; console.log(erro(`   ❌ ${nome}: não reiniciou (${(e.stderr || e.message || '').toString().split('\n')[0]})`)); }
}

// Espera os processos subirem e confere o estado.
spawnSync('sleep', ['8']);
let depois = [];
try { depois = pm2Lista(); } catch (_) {}
console.log('');
for (const nome of reiniciar) {
  const p = depois.find(x => x.name === nome);
  const st = p && p.pm2_env ? p.pm2_env.status : '?';
  if (st === 'online') console.log(ok(`   🟢 ${nome}: online`));
  else { falhou = true; console.log(erro(`   🔴 ${nome}: ${st} — veja com: pm2 logs ${nome} --lines 40`)); }
}
console.log(falhou ? erro('\n⚠️  Terminou com problemas — veja as linhas em vermelho acima.') : ok('\n✅ Tudo atualizado e no ar. Dê F5 no painel.'));
process.exit(falhou ? 1 : 0);

#!/usr/bin/env node
/**
 * caddy-compressao.js — liga a compressão (zstd/gzip) nos sites do SlimFit do Caddy
 * deste servidor. As páginas do painel são grandes (HTML com o JS dentro) e chegam
 * bem menores no celular comprimidas.
 *
 * Só mexe nos blocos do Caddyfile que levam ao painel de uma unidade SlimFit (porta
 * do PAINEL_PORT de cada pasta do SlimFit que roda no PM2). Outros sites do servidor
 * (ex.: Teashop) ficam como estão. Guarda uma cópia, valida com "caddy validate" e
 * desfaz sozinho se der erro; só então recarrega o Caddy (sem derrubar nada).
 *
 *   node /root/SF-Chat_Experimental-Mensagens/scripts/caddy-compressao.js --simular
 *   node /root/SF-Chat_Experimental-Mensagens/scripts/caddy-compressao.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SIMULAR = process.argv.includes('--simular');
const ARQ = process.env.CADDYFILE || '/etc/caddy/Caddyfile';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lerEnv = (arq) => { const o = {}; try { for (const l of fs.readFileSync(arq, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (_) {} return o; };

if (!fs.existsSync(ARQ)) { console.log(`Não achei ${ARQ} — este servidor não usa Caddy.`); process.exit(0); }

// 1. portas dos painéis SlimFit deste servidor
const portas = new Set();
try {
  const t = sh('pm2', ['jlist']); const m = /\[\s*(\{|\])/.exec(t);
  for (const p of JSON.parse(m ? t.slice(m.index) : t)) {
    const cwd = (p.pm2_env || {}).pm_cwd || '';
    for (const exp of [cwd, path.join(cwd, '..', 'Experimental')]) {
      if (!fs.existsSync(path.join(exp, 'src', 'painel-mensagens.js'))) continue;
      portas.add(String(lerEnv(path.join(exp, '.env')).PAINEL_PORT || '8080'));
    }
  }
} catch (e) { console.log('❌ Não consegui ler o PM2: ' + e.message); process.exit(1); }
if (!portas.size) { console.log('Nenhum painel SlimFit encontrado no PM2.'); process.exit(0); }
console.log(`Painéis SlimFit neste servidor: porta(s) ${[...portas].join(', ')}`);

// 2. acha os blocos de site (nível 0) que apontam para essas portas e não têm "encode"
const linhas = fs.readFileSync(ARQ, 'utf8').split('\n');
const blocos = [];
let nivel = 0, ini = -1;
linhas.forEach((l, i) => {
  const semComent = l.replace(/#.*$/, '');
  if (nivel === 0 && /\{\s*$/.test(semComent) && !/^\s*\(/.test(semComent) && semComent.trim() !== '{') ini = i;
  nivel += (semComent.match(/\{/g) || []).length - (semComent.match(/\}/g) || []).length;
  if (nivel === 0 && ini >= 0 && /\}/.test(semComent)) { blocos.push([ini, i]); ini = -1; }
});
const mudar = [];
for (const [a, b] of blocos) {
  const corpo = linhas.slice(a, b + 1).join('\n');
  const nosso = [...portas].some(p => new RegExp(`reverse_proxy\\s+(127\\.0\\.0\\.1|localhost):${p}\\b`).test(corpo));
  const nome = linhas[a].replace(/\{\s*$/, '').trim();
  if (!nosso) { console.log(`   · ${nome}: não é do SlimFit — não mexo`); continue; }
  if (/^\s*encode\b/m.test(corpo)) { console.log(`   ✔ ${nome}: já comprime`); continue; }
  mudar.push(a); console.log(`   + ${nome}: vou ligar a compressão`);
}
if (!mudar.length) { console.log('\n✅ Nada a fazer.'); process.exit(0); }
if (SIMULAR) { console.log('\n(simulação — nada foi alterado)'); process.exit(0); }

// 3. grava com cópia, valida e recarrega
const copia = `${ARQ}.antes-compressao-${Date.now()}`;
fs.copyFileSync(ARQ, copia);
for (const a of mudar.sort((x, y) => y - x)) linhas.splice(a + 1, 0, '    encode zstd gzip');
fs.writeFileSync(ARQ, linhas.join('\n'));
try { sh('caddy', ['validate', '--config', ARQ, '--adapter', 'caddyfile']); }
catch (e) {
  fs.copyFileSync(copia, ARQ);
  console.log('❌ O Caddy não aceitou a mudança — voltei o arquivo como estava.\n' + String(e.stderr || e.message).split('\n').slice(-5).join('\n'));
  process.exit(1);
}
try { sh('systemctl', ['reload', 'caddy']); }
catch (e) { console.log('⚠️  Arquivo válido, mas não consegui recarregar o Caddy: rode  systemctl reload caddy'); process.exit(1); }
console.log(`\n✅ Compressão ligada em ${mudar.length} site(s). Cópia do arquivo anterior: ${copia}`);

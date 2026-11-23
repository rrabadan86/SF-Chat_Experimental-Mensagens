#!/usr/bin/env node
/**
 * sofia.js — comando "slimfit-sofia": destrava a SoFIA de qualquer unidade deste
 * servidor quando ela não conecta / não mostra o QR.
 *
 * Acha sozinho as SoFIAs do PM2 (inclusive 2 unidades no mesmo servidor, como o
 * Lago Sul), mostra o estado de cada uma e deixa escolher:
 *   1) Reconectar (mantém o login): zera o contador de falhas, tira a trava do
 *      Chromium, limpa o cache do WhatsApp Web e reinicia. Se em 3 min não conectar,
 *      passa SOZINHO para o QR novo (5 s para cancelar com Ctrl+C).
 *   2) QR novo: faz o mesmo e ainda descarta o login salvo do WhatsApp da SoFIA
 *      (precisa escanear o QR de novo). Conversas, tags e configurações NÃO são apagadas.
 * Depois espera até 3 min e diz se apareceu o QR / se conectou.
 * O mesmo procedimento está no painel: SoFIA → Configuração → "🔧 Reconectar a SoFIA"
 * (os passos ficam em Experimental/src/sofia-destravar.js, usados pelos dois).
 *
 * Uso:
 *   slimfit-sofia                       pergunta a unidade e o que fazer
 *   slimfit-sofia lagosul2              escolhe a unidade pelo nome/pasta
 *   slimfit-sofia lagosul2 --auto       sem perguntas: reconecta e, se não der, QR novo
 *   slimfit-sofia lagosul2 --qr-novo    sem perguntas (ou --reconectar = só reconectar / --status)
 *   node scripts/sofia.js --instalar    cria o atalho (o slimfit-atualizar já cria)
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const filtro = (argv.find(a => !a.startsWith('--')) || '').toLowerCase();
const cor = (c, t) => process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t;
const ok = (t) => cor('32', t), aviso = (t) => cor('33', t), erro = (t) => cor('31', t), neg = (t) => cor('1', t);
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const dormir = (s) => spawnSync('sleep', [String(s)]);

if (flags.has('--instalar')) {
  const alvo = '/usr/local/bin/slimfit-sofia';
  try {
    fs.writeFileSync(alvo, `#!/bin/sh\n# Destrava/reconecta a SoFIA das unidades SlimFit deste servidor (scripts/sofia.js).\nexec node "${path.resolve(__filename)}" "$@"\n`, { mode: 0o755 });
    console.log(ok(`✅ Atalho criado: agora é só digitar ${neg('slimfit-sofia')}`));
  } catch (e) { console.log(erro(`❌ Não consegui criar ${alvo}: ${e.message}`)); process.exit(1); }
  process.exit(0);
}

// ── acha as SoFIAs ───────────────────────────────────────────────────────────
function pm2Lista() { const t = sh('pm2', ['jlist']); const m = /\[\s*(\{|\])/.exec(t); return JSON.parse(m ? t.slice(m.index) : t); }
const lerEnv = (arq) => { const o = {}; try { for (const l of fs.readFileSync(arq, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (_) {} return o; };
const lerJson = (a) => { try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch (_) { return null; } };

let procs;
try { procs = pm2Lista(); } catch (_) { console.log(erro('❌ Não consegui ler o PM2 (pm2 jlist).')); process.exit(1); }
const sofias = [];
for (const p of procs) {
  const e = p.pm2_env || {};
  const cwd = e.pm_cwd || '';
  const args = [].concat(e.args || []).join(' ');
  const ehListener = /sofia-listener/.test(String(e.pm_exec_path || '')) || /\blistener\b/.test(args);
  if (!ehListener || !fs.existsSync(path.join(cwd, 'sofia-listener.ts'))) continue;
  const raiz = path.resolve(cwd, '..');
  const envBot = lerEnv(path.join(cwd, '.env')), envPainel = lerEnv(path.join(raiz, 'Experimental', '.env'));
  const procEnv = e.env || {};
  const dir = path.resolve(procEnv.SOFIA_DIR || e.SOFIA_DIR || envBot.SOFIA_DIR || cwd);
  const auth = path.resolve(procEnv.SOFIA_WA_AUTH || envBot.SOFIA_WA_AUTH || path.join(dir, '.wwebjs_auth'));
  const unidade = envPainel.STUDIO_NOME || envPainel.PM2_SLUG || path.basename(raiz);
  sofias.push({ nome: p.name, id: p.pm_id, status: e.status, reinicios: e.restart_time, raiz, dir, auth, unidade });
}
if (!sofias.length) { console.log(aviso('Nenhuma SoFIA encontrada no PM2 deste servidor.')); process.exit(0); }

const estadoWa = (s) => { const o = lerJson(path.join(s.dir, 'sofia-wa-status.json')) || {}; return { estado: o.estado || '?', em: o.atualizadoEm || '' }; };
const falhas = (s) => { try { return parseInt(fs.readFileSync(path.join(s.dir, '.sofia-boot-fails'), 'utf8'), 10) || 0; } catch (_) { return 0; } };
const ROT = { conectado: ok('🟢 conectada'), qr: aviso('📱 esperando QR'), codigo: aviso('🔢 esperando código'), iniciando: aviso('⏳ iniciando'), desconectado: erro('🔴 desconectada') };

console.log(neg('\n🤖 SoFIAs deste servidor\n'));
sofias.forEach((s, i) => {
  const w = estadoWa(s), f = falhas(s);
  console.log(`  ${neg(String(i + 1))}) ${neg(s.unidade)}  ·  pm2 "${s.nome}" (${s.status})  ·  WhatsApp: ${ROT[w.estado] || w.estado}${f ? erro(`  ·  ${f} falha(s) seguidas`) : ''}`);
  console.log(`     pasta: ${s.dir}`);
});
console.log('');

function perguntar(q) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, (resp) => { rl.close(); r(String(resp || '').trim()); }));
}

(async () => {
  // 1. qual unidade
  let alvo = null;
  if (filtro) alvo = sofias.find(s => [s.nome, s.unidade, path.basename(s.raiz), s.dir].some(x => String(x).toLowerCase().includes(filtro)));
  else if (sofias.length === 1) alvo = sofias[0];
  else {
    const r = await perguntar(`Qual SoFIA? (1-${sofias.length}): `);
    alvo = sofias[parseInt(r, 10) - 1];
  }
  if (!alvo) { console.log(erro(filtro ? `Não achei uma SoFIA com "${filtro}".` : 'Nenhuma escolhida — nada foi feito.')); process.exit(1); }
  if (flags.has('--status')) { mostrarLog(alvo); process.exit(0); }

  // 2. o que fazer
  let modo = flags.has('--qr-novo') ? 'qr' : (flags.has('--reconectar') || flags.has('--auto')) ? 'reconectar' : '';
  // Só reconectar e parar (sem passar para o QR novo): apenas com --reconectar explícito.
  const escalar = !flags.has('--reconectar');
  if (!modo) {
    console.log(`O que fazer com a SoFIA de ${neg(alvo.unidade)}?`);
    console.log(`  1) ${neg('Reconectar')} — mantém o login do WhatsApp; se não conectar em 3 min, passo sozinho para o QR novo`);
    console.log(`  2) ${neg('QR novo')} — descarta o login salvo e mostra um QR para escanear`);
    console.log('     (conversas, tags e configurações NÃO são apagadas)');
    console.log('  3) Só ver o log');
    const r = await perguntar('Escolha (1/2/3): ');
    modo = r === '1' ? 'reconectar' : r === '2' ? 'qr' : r === '3' ? 'log' : '';
  }
  if (modo === 'log') { mostrarLog(alvo); process.exit(0); }
  if (!modo) { console.log('Nada foi feito.'); process.exit(0); }

  // 3. destrava e espera (os passos são os mesmos do painel: sofia-destravar.js)
  const D = require(path.join(__dirname, '..', 'Experimental', 'src', 'sofia-destravar.js'));
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  const rodar = async (m) => {
    console.log(neg(`\n🔧 ${m === 'qr' ? 'Gerando QR novo' : 'Reconectando'} — SoFIA de ${alvo.unidade}`));
    let ultimo = '';
    return D.tentar({
      modo: m, pm2Id: alvo.id, dir: alvo.dir, auth: alvo.auth,
      pm2: async (a) => { sh('pm2', a); },
      dormir: async (ms) => { await espera(ms); const w = D.estadoWa(alvo.dir); if (w.estado !== ultimo) { ultimo = w.estado; console.log(`   … ${ROT[w.estado] || w.estado || '?'}`); } },
      aoPasso: (t) => { console.log(`   ${t === 'parada' ? '⏸ ' : t === 'iniciada' ? '▶ ' : '✔'} ${t}`); if (t === 'iniciada') console.log('\n   aguardando o WhatsApp (até 3 min)…'); },
    });
  };
  // QR novo com rede de segurança: se o QR não aparecer, o login salvo volta para o lugar.
  let ultimoQr = '';
  const rodarQr = async () => {
    console.log(neg(`\n🔧 Gerando QR novo — SoFIA de ${alvo.unidade}`));
    const q = await D.qrNovo({
      pm2Id: alvo.id, dir: alvo.dir, auth: alvo.auth,
      pm2: async (a) => { sh('pm2', a); },
      dormir: async (ms) => { await espera(ms); const w = D.estadoWa(alvo.dir); if (w.estado !== ultimoQr) { ultimoQr = w.estado; console.log(`   … ${ROT[w.estado] || w.estado || '?'}`); } },
    }, (t) => { console.log(`   ${t === 'parada' ? '⏸ ' : t === 'iniciada' ? '▶ ' : '✔'} ${t}`); if (t === 'iniciada') console.log('\n   aguardando o WhatsApp (até 3 min)…'); });
    loginDevolvido = q.devolvido;
    return q.estado;
  };
  let r = '', loginDevolvido = false;
  try {
    if (modo === 'qr') r = await rodarQr();
    else {
      r = await rodar('reconectar');
      if (!r && escalar) {
        console.log(aviso('\n⚠️  Não conectou mantendo o login. Vou gerar um QR novo em 5 segundos (Ctrl+C cancela)…'));
        await espera(5000);
        modo = 'qr';
        r = await rodarQr();
      }
    }
  } catch (e) { console.log(erro(`   ❌ não consegui iniciar: pm2 start ${alvo.id} (${(e && e.message || '').split('\n')[0]})`)); process.exit(1); }
  if (r === 'conectado') { console.log(ok(`\n✅ SoFIA de ${alvo.unidade} conectada.`)); process.exit(0); }
  if (r === 'qr') { console.log(ok(`\n✅ QR pronto. Abra o painel de ${alvo.unidade} → SoFIA → Configuração e escaneie com o celular da SoFIA`) + '\n   (WhatsApp → Dispositivos conectados → Conectar dispositivo).'); process.exit(0); }
  if (r === 'codigo') { console.log(ok('\n✅ Código de pareamento pronto — veja no painel (SoFIA → Configuração).')); process.exit(0); }
  console.log(erro('\n⚠️  Em 3 min não apareceu QR nem conexão.') + (modo === 'reconectar' ? ` Rode de novo e escolha ${neg('2) QR novo')}.`
    : ` O problema NÃO é o login${loginDevolvido ? ' (ele foi devolvido ao lugar)' : ''}: o WhatsApp não abriu nem com o perfil limpo.\n   O mais comum é o WhatsApp segurar a conexão depois de muitas tentativas seguidas — deixe a SoFIA quieta por algumas horas antes de tentar de novo.`));
  mostrarLog(alvo);
  process.exit(1);
})();

function mostrarLog(s) {
  console.log(neg(`\n📜 Últimas linhas do log (${s.nome}):`));
  try { console.log(sh('pm2', ['logs', String(s.id), '--lines', '20', '--nostream', '--raw'])); }
  catch (e) { console.log(String(e.stdout || e.message || '').slice(-3000)); }
  console.log(`\nSe não resolver, mande estas linhas para o suporte.`);
}

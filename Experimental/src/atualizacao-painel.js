/**
 * Atualizar o sistema pelo painel (Saúde do sistema → Versão do sistema).
 *
 *   verificar() → git fetch do main e lista o que vem na versão nova (só lê).
 *   iniciar()   → roda scripts/atualizar.js (o mesmo "slimfit-atualizar") como
 *                 processo INDEPENDENTE do painel: a atualização reinicia o
 *                 próprio painel no meio, e o processo precisa sobreviver a isso.
 *                 Saída em data/atualizacao.log; código de saída em
 *                 data/atualizacao.exit quando termina.
 *   status()    → andamento (para a tela acompanhar ao vivo).
 *
 * Atualiza TODAS as unidades deste servidor (ex.: Lago Sul 1 e 2), igual ao comando.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'atualizar.js');
const DATA = path.resolve(__dirname, '..', 'data');
const CACHE = path.join(DATA, 'versao-cache.json');
const INFO = path.join(DATA, 'atualizacao.json');
const LOG = path.join(DATA, 'atualizacao.log');
const EXIT = path.join(DATA, 'atualizacao.exit');
const MAX_MS = 20 * 60 * 1000; // passou disso sem terminar: considera travada

function git(...a) { return execFileSync('git', ['-C', RAIZ, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim(); }
function lerJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
const limpa = (t) => String(t || '').replace(/\s*\(#\d+\)\s*$/, '').trim();

function versaoAtual() {
  try { const [titulo, ct] = git('log', '-1', '--format=%s|%ct', 'HEAD').split('|'); return { titulo: limpa(titulo), em: (+ct || 0) * 1000 }; }
  catch (_) { return null; }
}

// Baixa a informação do GitHub (não muda nada no código) e lista as novidades.
function verificar() {
  git('fetch', 'origin', 'main');
  let linhas = [];
  try { linhas = git('log', '--format=%s|%ct', 'HEAD..FETCH_HEAD').split('\n').filter(l => l && !/^Merge /.test(l)); } catch (_) {}
  const r = {
    verificadoEm: Date.now(),
    atual: versaoAtual(),
    novas: linhas.map(l => { const i = l.lastIndexOf('|'); return { titulo: limpa(l.slice(0, i)), em: (+l.slice(i + 1) || 0) * 1000 }; }),
  };
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(r)); } catch (_) {}
  return r;
}
function ultimaVerificacao() {
  const c = lerJson(CACHE) || {};
  // Se já atualizou depois da verificação, as "novas" já estão aplicadas.
  const atual = versaoAtual();
  if (c.atual && atual && atual.em > (c.atual.em || 0)) return { verificadoEm: c.verificadoEm, atual, novas: [], desatualizada: true };
  return Object.assign({ atual }, c, { atual });
}

function status() {
  const info = lerJson(INFO);
  if (!info) return { estado: 'nunca' };
  let log = '';
  try { const t = fs.readFileSync(LOG, 'utf8'); log = t.length > 6000 ? '…' + t.slice(-6000) : t; } catch (_) {}
  let codigo = null;
  try { codigo = parseInt(fs.readFileSync(EXIT, 'utf8').trim(), 10); } catch (_) {}
  const estado = codigo === null
    ? (Date.now() - (info.inicio || 0) > MAX_MS ? 'travada' : 'rodando')
    : (codigo === 0 ? 'ok' : 'erro');
  return { estado, inicio: info.inicio, por: info.por || '', codigo, log };
}

function iniciar(usuario) {
  if (!fs.existsSync(SCRIPT)) throw new Error('não achei o scripts/atualizar.js neste servidor');
  const st = status();
  if (st.estado === 'rodando') throw new Error('já tem uma atualização em andamento');
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of [LOG, EXIT]) { try { fs.unlinkSync(f); } catch (_) {} }
  fs.writeFileSync(INFO, JSON.stringify({ inicio: Date.now(), por: String(usuario || '') }));
  // Subshell em segundo plano: o "sh" sai na hora e o node fica órfão (pai = init),
  // fora da árvore de processos do painel — o pm2 restart do painel não o derruba.
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const cmd = `(node ${q(SCRIPT)} > ${q(LOG)} 2>&1; echo $? > ${q(EXIT)}) < /dev/null > /dev/null 2>&1 &`;
  const ch = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore', cwd: RAIZ, env: process.env });
  ch.unref();
  return status();
}

module.exports = { verificar, ultimaVerificacao, status, iniciar, versaoAtual };

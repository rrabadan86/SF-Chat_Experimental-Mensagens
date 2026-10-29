/**
 * limpar-perfis-temp.js — apaga perfis temporários de navegador que sobraram.
 *
 * Cada job do EVO abre um Chromium com perfil temporário (puppeteer_dev_profile-…,
 * ~150 MB). O puppeteer apaga a pasta ao fechar o navegador — mas com o Chromium
 * do SNAP (ex.: Guará) o navegador grava no /tmp PARTICULAR do snap
 * (/tmp/snap-private-tmp/snap.chromium/tmp), que o puppeteer não vê nem apaga.
 * Como /tmp fica na RAM (tmpfs), cada job deixava ~150 MB de memória presos —
 * no Guará chegou a 1,7 GB. Jobs que travam no meio também deixam a pasta.
 *
 * Aqui apagamos as pastas com mais de 30 min que NENHUM processo está usando
 * (conferindo a linha de comando dos navegadores abertos). O WhatsApp do robô e
 * o da SoFIA guardam o login em outras pastas, fora do /tmp — não são tocados.
 */
const fs = require('fs');
const path = require('path');

const DIRS = ['/tmp', '/tmp/snap-private-tmp/snap.chromium/tmp'];
const NOME = /^puppeteer_dev_(chrome_)?profile-/;
const IDADE_MIN_MS = 30 * 60 * 1000;

// Nomes de perfis que algum processo aberto está usando (--user-data-dir=…).
function perfisEmUso() {
  const usados = new Set();
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d)); } catch (_) { return null; }
  for (const pid of pids) {
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (_) { continue; }
    const m = cmd.match(/puppeteer_dev_(?:chrome_)?profile-[A-Za-z0-9]+/g);
    if (m) for (const n of m) usados.add(n);
  }
  return usados;
}

function limparPerfisTemp(log = () => {}, { dirs = DIRS } = {}) {
  if (process.platform !== 'linux') return { apagados: 0, mb: 0 };
  const emUso = perfisEmUso();
  if (!emUso) return { apagados: 0, mb: 0 }; // sem /proc: não arrisca
  let apagados = 0, bytes = 0;
  const agora = Date.now();
  for (const dir of dirs) {
    let nomes = [];
    try { nomes = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of nomes) {
      if (!NOME.test(n) || emUso.has(n)) continue;
      const p = path.join(dir, n);
      let st; try { st = fs.statSync(p); } catch (_) { continue; }
      if (!st.isDirectory() || agora - st.mtimeMs < IDADE_MIN_MS) continue;
      try { bytes += tamanho(p); } catch (_) {}
      try { fs.rmSync(p, { recursive: true, force: true }); apagados++; } catch (_) {}
    }
  }
  const mb = Math.round(bytes / 1048576);
  if (apagados) log(`🧹 ${apagados} perfil(is) temporário(s) de navegador apagado(s) (${mb} MB liberados).`);
  return { apagados, mb };
}

function tamanho(p) {
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) t += tamanho(f);
    else { try { t += fs.lstatSync(f).size; } catch (_) {} }
  }
  return t;
}

module.exports = { limparPerfisTemp };

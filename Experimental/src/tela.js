/**
 * tela.js — o navegador do robô abre "com tela" (HEADLESS=false) ou sem tela?
 *
 * No VPS rodamos com HEADLESS=false dentro de uma tela virtual (xvfb-run, pelo
 * scheduler-vps.sh). Se o processo subiu SEM a tela virtual (ex.: pm2 start direto
 * no node, ou o Xvfb não instalado), o Chromium "com tela" não abre e todo job do
 * EVO falha com "Missing X server". Aqui, nesse caso, cai para o modo sem tela
 * (com um aviso no log) — o job roda em vez de falhar. O mesmo se a tela virtual
 * caiu depois (DISPLAY definido, mas sem o socket /tmp/.X11-unix/X<n>).
 */
let avisou = '';
function querTela() {
  if (process.env.HEADLESS !== 'false') return false;
  if (process.platform !== 'linux' || process.env.WAYLAND_DISPLAY) return true;
  const disp = process.env.DISPLAY || '';
  let motivo = '';
  if (!disp) motivo = 'este processo não tem tela virtual (DISPLAY vazio)';
  else {
    // A tela virtual (Xvfb) pode ter caído ou não ter subido (ex.: duas unidades no
    // mesmo VPS reiniciando juntas): o DISPLAY existe, mas o socket do X não.
    const m = /^[^:]*:(\d+)/.exec(disp);
    if (m && !disp.split(':')[0]) {
      try { require('fs').statSync('/tmp/.X11-unix/X' + m[1]); } catch (_) { motivo = `a tela virtual ${disp} não está no ar (o Xvfb caiu?)`; }
    }
  }
  if (motivo) {
    // avisa uma vez por motivo (o Xvfb pode cair depois de já ter funcionado)
    if (avisou !== motivo) {
      avisou = motivo;
      console.log(`⚠️  HEADLESS=false, mas ${motivo} — abrindo o navegador SEM tela. `
        + 'Para voltar ao normal: pm2 restart <unidade>-exp (sobe uma tela virtual nova pelo scheduler-vps.sh).');
    }
    return false;
  }
  return true;
}
module.exports = { querTela };

/**
 * tela.js — o navegador do robô abre "com tela" (HEADLESS=false) ou sem tela?
 *
 * No VPS rodamos com HEADLESS=false dentro de uma tela virtual (xvfb-run, pelo
 * scheduler-vps.sh). Se o processo subiu SEM a tela virtual (ex.: pm2 start direto
 * no node, ou o Xvfb não instalado), o Chromium "com tela" não abre e todo job do
 * EVO falha com "Missing X server". Aqui, nesse caso, cai para o modo sem tela
 * (com um aviso no log) — o job roda em vez de falhar.
 */
let avisou = false;
function querTela() {
  if (process.env.HEADLESS !== 'false') return false;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (!avisou) {
      avisou = true;
      console.log('⚠️  HEADLESS=false, mas este processo não tem tela virtual (DISPLAY vazio) — abrindo o navegador SEM tela. '
        + 'Para voltar ao normal, suba o robô pelo scheduler-vps.sh (xvfb-run) e confira: apt install -y xvfb');
    }
    return false;
  }
  return true;
}
module.exports = { querTela };

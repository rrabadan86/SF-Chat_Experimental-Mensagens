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

// Há um servidor de tela (Xvfb/Xorg) rodando para o display :<n>? → true | false |
// null (não deu para saber — sem /proc legível; aí não arrisca dizer que morreu).
function servidorDeTelaVivo(n, lerCmdlines) {
  let cmds;
  try {
    cmds = lerCmdlines ? lerCmdlines() : (() => {
      const fs = require('fs');
      return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (_) { return ''; } });
    })();
  } catch (_) { return null; }
  if (!Array.isArray(cmds) || !cmds.length) return null;
  const alvo = ':' + n;
  return cmds.some((c) => { const p = String(c).split('\0'); return /(^|\/)(Xvfb|Xorg|X|Xwayland|Xephyr|Xvnc|Xtigervnc)$/.test(p[0] || '') && p.includes(alvo); });
}

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
      // O arquivo da tela pode ficar para trás depois de o Xvfb morrer (ex.: falta de
      // memória): confere se ainda há um servidor de tela rodando para esse número.
      if (!motivo && servidorDeTelaVivo(m[1]) === false) motivo = `a tela virtual ${disp} não está mais rodando (o Xvfb morreu e deixou o arquivo)`;
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
module.exports = { querTela, servidorDeTelaVivo };

/**
 * QR pela tela (SOF-08) — usado pelo robô (wa-client.js) e pela SoFIA (sofia-listener.ts).
 *
 * Desde o WhatsApp Web 2.3000.1055969240 (24/11/2026), quem está SEM login vai para a
 * tela nova de entrada (/login/). O QR está desenhado na página, mas a biblioteca
 * (whatsapp-web.js 1.34.x) espera um estado de conexão que essa tela não tem e nunca
 * avisa o QR: o painel ficava sem QR e a conexão terminava em "Waiting failed".
 * Login JÁ salvo não passa por essa tela e continua funcionando.
 *
 * Aqui copiamos a imagem do QR da própria página para o painel (o QR se renova sozinho),
 * deixamos marcado "continuar conectado neste navegador" e percebemos quando alguém
 * escaneou. Aí quem chamou fecha o navegador com calma e sobe de novo — já com o login
 * salvo, que é o caminho que funciona.
 */

// Roda DENTRO da página do WhatsApp Web (puppeteer: page.evaluate(lerTela)).
// Não pode usar nada de fora desta função.
function lerTela() {
  const d = document;
  const corpo = String((d.body && d.body.innerText) || '');
  const naTelaDeLogin = /\/login/.test(String(location.pathname || ''))
    || /scan to log in|link with phone|escaneie|conectar com (o )?n[uú]mero/i.test(corpo);
  // "Stay logged in on this browser": marcado, para o login ficar salvo no perfil.
  try {
    const caixas = Array.prototype.slice.call(d.querySelectorAll('input[type="checkbox"]'));
    if (naTelaDeLogin && caixas.length === 1 && !caixas[0].checked
      && /stay logged in|manter conectad|continuar conectad/i.test(corpo)) caixas[0].click();
  } catch (_) {}
  // Depois de alguns minutos o WhatsApp pede um clique para gerar QR novo.
  try {
    const botoes = Array.prototype.slice.call(d.querySelectorAll('button, [role="button"]'));
    const recarregar = botoes.find((b) => /reload|recarregar|gerar novo/i.test(String(b.innerText || b.getAttribute('aria-label') || '')));
    if (naTelaDeLogin && recarregar) recarregar.click();
  } catch (_) {}
  // O QR é o maior canvas quadrado da tela. Vai para o painel com fundo branco e margem
  // (a câmera precisa da "zona quieta" em volta, e o painel pode estar no tema escuro).
  let img = '';
  try {
    const telas = Array.prototype.slice.call(d.querySelectorAll('canvas'))
      .filter((c) => c.width >= 100 && c.height >= 100 && Math.abs(c.width - c.height) <= c.width * 0.1)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const c = telas[0];
    if (c && naTelaDeLogin) {
      const m = Math.round(c.width * 0.08);
      const o = d.createElement('canvas');
      o.width = c.width + 2 * m; o.height = c.height + 2 * m;
      const x = o.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, o.width, o.height);
      x.drawImage(c, m, m);
      img = o.toDataURL('image/png');
    }
  } catch (_) { img = ''; }
  let conexao = '';
  try { const w = window; const mod = w.require && w.require('WAWebSocketModel'); conexao = String((mod && mod.Socket && mod.Socket.state) || ''); } catch (_) {}
  return { img, naTelaDeLogin, conexao, caminho: String(location.pathname || '') };
}

/**
 * Mostra o QR da tela no painel até alguém escanear.
 * @param pg       página do puppeteer (client.pupPage)
 * @param aoQr     (dataUrl) => void — grava o QR para o painel (chamado só quando muda)
 * Sem prazo enquanto o QR estiver na tela (como o QR da biblioteca, que também se renova
 * até alguém escanear).
 * @returns 'entrou' (escanearam, ou a página parou depois do QR: feche e suba de novo),
 *          'sem-qr' (a tela não mostra QR — siga o caminho de falha normal)
 */
async function esperarQrPelaTela(pg, { aoQr, log = () => {}, dormir, pausaMs = 3000, agora = Date.now } = {}) {
  const espera = dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ini = agora();
  let viu = false, ultimo = '', foraDoLogin = 0, ultimaLeitura = ini;
  for (;;) {
    let r = null;
    try { r = await Promise.race([pg.evaluate(lerTela), espera(10000).then(() => null)]); } catch (_) { r = null; } // trocando de página
    const t = agora();
    if (r) {
      ultimaLeitura = t;
      if (r.img) {
        foraDoLogin = 0;
        if (!viu) log('QR pela tela: o WhatsApp Web mostra o QR na página nova de entrada — copiando para o painel. Escaneie com o celular do número.');
        viu = true;
        if (r.img !== ultimo) { ultimo = r.img; try { await aoQr(r.img); } catch (_) {} }
      } else if (viu) {
        // Saiu da tela de entrada (ou a conexão ficou CONNECTED) por 2 leituras seguidas:
        // escanearam. Uma leitura só pode ser o QR sendo redesenhado.
        foraDoLogin = (!r.naTelaDeLogin || r.conexao === 'CONNECTED') ? foraDoLogin + 1 : 0;
        if (foraDoLogin >= 2) { log('QR pela tela: login feito — fecho o navegador e subo de novo com o login salvo.'); return 'entrou'; }
      } else if (t - ini > 45000) return 'sem-qr';
    } else if (t - ultimaLeitura > 90000) { // página não responde há 1,5 min
      if (!viu) return 'sem-qr';
      log('QR pela tela: a página parou de responder depois do QR — fecho e subo de novo (se o login entrou, ele vem salvo).');
      return 'entrou';
    }
    await espera(pausaMs);
  }
}

// A falha foi na tela nova de entrada? (texto lido da página por quem chamou)
const TELA_DE_ENTRADA = /scan to log in|link with phone|escaneie o qr|conectar com (o )?n[uú]mero/i;
function ehTelaDeEntrada(info) { return !!(info && info.versao && !info.socket && TELA_DE_ENTRADA.test(String(info.tela || ''))); }

module.exports = { lerTela, esperarQrPelaTela, ehTelaDeEntrada };

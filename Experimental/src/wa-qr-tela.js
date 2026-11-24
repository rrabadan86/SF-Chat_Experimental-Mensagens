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
    || /scan to log in|link with phone|escaneie|conectar com (o )?n[uú]mero|enter code|digite o c[oó]digo|insira o c[oó]digo/i.test(corpo);
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
  return { img, naTelaDeLogin, conexao, caminho: String(location.pathname || ''), texto: corpo.slice(0, 1500) };
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

// ── Conectar por CÓDIGO na tela nova de entrada (SOF-08) ────────────────────
// A biblioteca também não entrega o código de 8 letras nessa tela. Aqui pedimos o
// código nós mesmos: primeiro pelo módulo interno do WhatsApp Web (o mesmo que a
// biblioteca usava); se não der, pela tela ("Conectar com número de telefone" →
// digita o número → lê o código mostrado).
// Roda DENTRO da página (page.evaluate). Não pode usar nada de fora desta função.
async function pedirCodigoNaPagina(numero) {
  const d = document, dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  const so = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const textoDe = (el) => String((el && (el.innerText || el.textContent)) || '');
  // O código aparece depois de um aviso tipo "Digite o código no celular"; letras e
  // números em 2 blocos de 4 (às vezes cada letra numa caixinha separada).
  function lerCodigo() {
    const el = d.querySelector('[data-link-code]');
    if (el) { const v = so(el.getAttribute('data-link-code')); if (v.length === 8) return v; }
    const corpo = textoDe(d.body);
    const i = corpo.search(/enter code|enter the code|digite o c[oó]digo|insira o c[oó]digo|c[oó]digo no (seu )?celular|code on (your )?phone/i);
    if (i < 0) return '';
    const depois = corpo.slice(i, i + 400).split('\n').slice(1).join('\n');
    const m = depois.match(/([A-Z0-9](?:[\s-]*[A-Z0-9]){7})/);
    if (!m) return '';
    const v = so(m[1]);
    return v.length === 8 ? v : '';
  }
  let erroApi = '';
  // 1) módulo interno
  try {
    const api = window.require && window.require('WAWebAltDeviceLinkingApi');
    if (api && typeof api.startAltLinkingFlow === 'function') {
      try { if (api.setPairingType) await api.setPairingType('ALT_DEVICE_LINKING'); } catch (_) {}
      try { if (api.initializeAltDeviceLinking) await api.initializeAltDeviceLinking(); } catch (_) {}
      const c = so(await api.startAltLinkingFlow(numero, true));
      if (c.length === 8) return { codigo: c, via: 'interno' };
    } else erroApi = 'módulo interno ausente';
  } catch (e) { erroApi = String((e && e.message) || e).slice(0, 120); }
  // 2) pela tela
  const ehBotao = (el) => (/^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button' ? 1 : 0);
  const clicavel = (re) => Array.prototype.slice.call(d.querySelectorAll('button, [role="button"], a, span, div'))
    .filter((el) => re.test(textoDe(el).trim()) && textoDe(el).trim().length < 80)
    // botão/link de verdade antes da caixa em volta (as duas têm o mesmo texto)
    .sort((a, b) => (ehBotao(b) - ehBotao(a)) || (textoDe(a).length - textoDe(b).length))[0];
  const link = clicavel(/link with phone|log in with phone|conectar com (o )?n[uú]mero|entrar com (o )?n[uú]mero|usar (o )?n[uú]mero de telefone/i);
  if (link) { link.click(); await dorme(1500); }
  const campos = Array.prototype.slice.call(d.querySelectorAll('input')).filter((x) => /tel|text|number/.test(String(x.type || 'text')) && x.offsetParent !== null);
  const campo = campos.find((x) => /phone|telefone|n[uú]mero/i.test(String(x.getAttribute('aria-label') || '') + String(x.placeholder || ''))) || campos[0];
  if (campo) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    campo.focus(); setter.call(campo, ''); campo.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(campo, '+' + String(numero)); campo.dispatchEvent(new Event('input', { bubbles: true }));
    await dorme(600);
    const prox = clicavel(/^(next|avan[cç]ar|seguinte|pr[oó]ximo|continuar)$/i);
    if (prox) prox.click(); else campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  for (let i = 0; i < 25; i++) { const c = lerCodigo(); if (c) return { codigo: c, via: 'tela' }; await dorme(800); }
  return { codigo: '', via: '', erro: (erroApi ? erroApi + ' · ' : '') + (link ? '' : 'sem o link "Conectar com número" · ') + (campo ? '' : 'sem campo de telefone'), tela: textoDe(d.body).replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/** Pede o código de conexão por número (8 letras) na tela de entrada. → { codigo: 'ABCD-EFGH' | '', via, erro, tela } */
async function pedirCodigoPelaTela(pg, numero, { tempoMs = 45000 } = {}) {
  const num = String(numero || '').replace(/\D/g, '');
  if (num.length < 10) return { codigo: '', via: '', erro: 'número inválido' };
  let r = null;
  try { r = await Promise.race([pg.evaluate(pedirCodigoNaPagina, num), new Promise((ok) => setTimeout(() => ok(null), tempoMs))]); }
  catch (e) { r = { codigo: '', via: '', erro: String((e && e.message) || e).slice(0, 160) }; }
  if (!r) return { codigo: '', via: '', erro: 'a página não respondeu' };
  const c = String(r.codigo || '');
  return Object.assign({}, r, { codigo: c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : '' });
}

/**
 * Espera alguém digitar o código no celular: sai da tela de entrada (2 leituras seguidas,
 * e o código não está mais na tela) ou a conexão fica CONNECTED. → 'entrou' | 'tempo'
 */
async function esperarEntrada(pg, codigo, { log = () => {}, dormir, pausaMs = 3000, agora = Date.now, limiteMs = 10 * 60 * 1000 } = {}) {
  const espera = dormir || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ini = agora(), so = String(codigo || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  let fora = 0;
  while (agora() - ini < limiteMs) {
    let r = null;
    try { r = await Promise.race([pg.evaluate(lerTela), espera(10000).then(() => null)]); } catch (_) { r = null; }
    if (r) {
      const aindaCodigo = so && String(r.texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(so);
      fora = (r.conexao === 'CONNECTED' || (!r.naTelaDeLogin && !aindaCodigo && !r.img)) ? fora + 1 : 0;
      if (fora >= 2) { log('Código: login feito — fecho o navegador e subo de novo com o login salvo.'); return 'entrou'; }
    }
    await espera(pausaMs);
  }
  return 'tempo';
}

// A falha foi na tela nova de entrada? (texto lido da página por quem chamou)
const TELA_DE_ENTRADA = /scan to log in|link with phone|escaneie o qr|conectar com (o )?n[uú]mero/i;
function ehTelaDeEntrada(info) { return !!(info && info.versao && !info.socket && TELA_DE_ENTRADA.test(String(info.tela || ''))); }

module.exports = { lerTela, esperarQrPelaTela, ehTelaDeEntrada, pedirCodigoNaPagina, pedirCodigoPelaTela, esperarEntrada };

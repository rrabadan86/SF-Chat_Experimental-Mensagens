// SOF-08 no NAVEGADOR (Playwright): a leitura da tela nova de entrada do WhatsApp Web
// (wa-qr-tela.js → lerTela) acha o QR desenhado na página, devolve a imagem com fundo
// branco, deixa marcado "continuar conectado" e pede QR novo quando o WhatsApp para.
// Página de mentira, sem rede.   node --test testes/tela/qr-tela.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { lerTela } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-qr-tela.js'));

const ENTRADA = `<body style="background:#111">
  <h1>Scan to log in</h1><p>Link with phone number instead</p>
  <canvas id="qr" width="264" height="264"></canvas>
  <label><input type="checkbox" id="ficar"> Stay logged in on this browser</label>
  <button id="rec" onclick="window.recarregou=true">Click to reload QR code</button>
  <canvas id="logo" width="40" height="40"></canvas>
  <script>const x=document.getElementById('qr').getContext('2d');for(let i=0;i<33;i++)for(let j=0;j<33;j++)if((i*7+j*3)%5<2){x.fillRect(i*8,j*8,8,8);}</script></body>`;
const CONVERSAS = `<body><h1>Chats</h1><canvas width="300" height="300"></canvas><input type="checkbox"></body>`;

test('SOF-08 tela nova de entrada: lê o QR da página (fundo branco), marca "continuar conectado" e pede QR novo', { timeout: 60000 }, async () => {
  const { chromium } = require('playwright');
  const navegador = await chromium.launch();
  try {
    const page = await navegador.newPage();
    await page.setContent(ENTRADA);
    const r = await page.evaluate(lerTela);
    assert.strictEqual(r.naTelaDeLogin, true);
    assert.match(r.img, /^data:image\/png;base64,/);
    assert.strictEqual(await page.$eval('#ficar', (c) => c.checked), true, 'continuar conectado fica marcado');
    assert.strictEqual(await page.evaluate(() => window.recarregou), true, 'pediu QR novo');
    // a imagem tem margem branca (zona quieta) e o tamanho do QR + margem
    const pix = await page.evaluate(async (src) => {
      const im = new Image(); im.src = src; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      return { w: im.width, canto: Array.from(x.getImageData(2, 2, 1, 1).data) };
    }, r.img);
    assert.ok(pix.w > 264 && pix.w < 320, `largura ${pix.w}`);
    assert.deepStrictEqual(pix.canto, [255, 255, 255, 255]);
    // já dentro das conversas (logado): não há QR para mostrar e nada é clicado
    await page.setContent(CONVERSAS);
    const dentro = await page.evaluate(lerTela);
    assert.strictEqual(dentro.naTelaDeLogin, false);
    assert.strictEqual(dentro.img, '');
    assert.strictEqual(await page.$eval('input', (c) => c.checked), false);
  } finally { await navegador.close(); }
});

// Conectar por CÓDIGO na tela nova (a biblioteca também não entrega o código ali).
const TELA_CODIGO = `<body>
  <h1>Scan to log in</h1><a href="#" id="lk" onclick="mostrar();return false">Link with phone number instead</a>
  <div id="fone" style="display:none"><input type="text" aria-label="Type your phone number" id="tel"><button id="nx" onclick="codigo()">Next</button></div>
  <div id="cod" style="display:none"><p>Enter code on phone</p><div><span>W</span><span>9</span><span>K</span><span>2</span> - <span>X</span><span>F</span><span>7</span><span>Q</span></div></div>
  <script>
    function mostrar(){ document.getElementById('fone').style.display='block'; }
    function codigo(){ window.numeroDigitado=document.getElementById('tel').value; document.getElementById('fone').style.display='none'; setTimeout(function(){ document.getElementById('cod').style.display='block'; }, 400); }
  </script></body>`;

test('SOF-08 código pela tela: pelo módulo interno do WhatsApp Web, ou clicando em "conectar com número" e lendo o código mostrado', { timeout: 60000 }, async () => {
  const { pedirCodigoPelaTela } = require(path.resolve(__dirname, '..', '..', 'src', 'wa-qr-tela.js'));
  const { chromium } = require('playwright');
  const navegador = await chromium.launch();
  try {
    const page = await navegador.newPage();
    // 1) módulo interno disponível
    await page.setContent('<body><h1>Scan to log in</h1></body>');
    await page.evaluate(() => { window.require = (m) => (m === 'WAWebAltDeviceLinkingApi' ? { startAltLinkingFlow: async (n) => { window.pedidoPara = n; return 'ab12cd34'; } } : null); });
    let r = await pedirCodigoPelaTela(page, '55 61 98428-0000');
    assert.strictEqual(r.codigo, 'AB12-CD34');
    assert.strictEqual(r.via, 'interno');
    assert.strictEqual(await page.evaluate(() => window.pedidoPara), '5561984280000');
    // 2) sem o módulo: pela tela
    await page.evaluate(() => { delete window.require; });
    await page.setContent(TELA_CODIGO);
    r = await pedirCodigoPelaTela(page, '5561984280000');
    assert.strictEqual(r.codigo, 'W9K2-XF7Q', JSON.stringify(r));
    assert.strictEqual(r.via, 'tela');
    assert.strictEqual(await page.evaluate(() => window.numeroDigitado), '+5561984280000');
    // 3) tela sem nada disso: devolve vazio com o motivo e o texto da tela (para o log)
    await page.setContent('<body><h1>Algo diferente</h1></body>');
    r = await pedirCodigoPelaTela(page, '5561984280000', { tempoMs: 30000 });
    assert.strictEqual(r.codigo, '');
    assert.match(r.erro, /conectar com número|campo/);
    assert.match(r.tela, /Algo diferente/);
    assert.strictEqual((await pedirCodigoPelaTela(page, '123')).erro, 'número inválido');
  } finally { await navegador.close(); }
});

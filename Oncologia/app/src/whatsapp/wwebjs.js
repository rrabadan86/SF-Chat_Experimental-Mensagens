/**
 * Driver "wwebjs" — WhatsApp Web não-oficial (whatsapp-web.js).
 *
 * Usa o número que o consultório já tem: escaneia o QR uma vez e a sessão fica
 * salva em disco. Sem custo por mensagem. Em compensação depende do WhatsApp
 * Web continuar logado, e a Meta não dá nenhuma garantia sobre isso.
 *
 * Serve bem para falar com a recepcionista (uma pessoa, sempre a mesma, que já
 * tem conversa aberta). Para escrever ao PACIENTE, que nunca escreveu antes,
 * o caminho correto é o driver "cloud".
 */
const path = require('path');

let Client, LocalAuth, qrcodeTerminal;
let cliente = null;
let pronto = false;
const escutas = [];

function carregarDependencias() {
  try {
    ({ Client, LocalAuth } = require('whatsapp-web.js'));
    qrcodeTerminal = require('qrcode-terminal');
  } catch (e) {
    throw new Error(
      'WA_DRIVER=wwebjs precisa das dependências opcionais. Rode: npm install whatsapp-web.js qrcode-terminal'
    );
  }
}

async function iniciar() {
  if (cliente) return;
  carregarDependencias();

  cliente = new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WA_AUTH_DIR || path.resolve(__dirname, '..', '..', 'wwebjs_auth'),
    }),
    puppeteer: {
      headless: process.env.WA_HEADLESS !== 'false',
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  cliente.on('qr', (qr) => {
    console.log('[wa] escaneie o QR abaixo com o WhatsApp do consultório (uma vez só):');
    qrcodeTerminal.generate(qr, { small: true });
  });
  cliente.on('ready', () => { pronto = true; console.log('[wa] conectado'); });
  cliente.on('disconnected', (m) => { pronto = false; console.error(`[wa] desconectado: ${m}`); });
  cliente.on('message', async (msg) => {
    const de = String(msg.from || '').replace(/\D/g, '');
    for (const cb of escutas) {
      try { await cb({ de, texto: msg.body, responder: (t) => msg.reply(t) }); }
      catch (e) { console.error('[wa] erro tratando mensagem recebida:', e.message); }
    }
  });

  await cliente.initialize();
  await esperarPronto();
}

function esperarPronto(timeoutMs = 120000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pronto) return resolve();
      if (Date.now() - inicio > timeoutMs) return reject(new Error('WhatsApp não ficou pronto a tempo'));
      setTimeout(tick, 1000);
    };
    tick();
  });
}

async function enviar(numero, texto) {
  if (!pronto) await esperarPronto();
  const destino = `${String(numero).replace(/\D/g, '')}@c.us`;
  return cliente.sendMessage(destino, texto);
}

module.exports = { nome: 'wwebjs', iniciar, enviar, aoReceber: (cb) => escutas.push(cb) };

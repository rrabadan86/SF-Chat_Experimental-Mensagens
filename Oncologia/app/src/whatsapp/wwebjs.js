/**
 * Driver "wwebjs" — WhatsApp Web não-oficial (whatsapp-web.js).
 *
 * Usa o número que o consultório já tem: escaneia o QR uma vez e a sessão fica
 * salva em disco. Sem custo por mensagem. Em compensação depende do WhatsApp
 * Web continuar logado, e a Meta não dá garantia nenhuma sobre isso.
 *
 * Duas decisões que valem estar explícitas:
 *
 *   - `iniciar()` NÃO bloqueia. Antes ele esperava a conexão ficar pronta, e um
 *     servidor sem sessão salva simplesmente não subia. Agora o site entra no ar
 *     de qualquer jeito e o WhatsApp conecta em paralelo — agendamento gravado
 *     na agenda vale mais do que o aviso, que fica registrado como pendente.
 *
 *   - O estado (QR, conectado, erro) fica exposto para o painel poder mostrar o
 *     QR na tela e desconectar sem ninguém precisar abrir um terminal.
 */
const path = require('path');

let Client, LocalAuth, qrcodeTerminal, gerarQrImagem;
let cliente = null;
const escutas = [];

/**
 * Ids das mensagens que nós mesmos enviamos.
 *
 * Precisamos ouvir também as mensagens marcadas como "minhas": quando a
 * recepcionista usa o PRÓPRIO WhatsApp do consultório — o mesmo que está
 * conectado aqui —, a resposta dela chega como mensagem própria e não como
 * mensagem recebida. Sem isso, o CONFIRMAR dela nunca seria visto.
 *
 * O risco disso é o sistema reagir ao que ele mesmo escreveu: o aviso de
 * pré-agendamento contém o texto "CONFIRMAR PA-...", e seria confirmado
 * sozinho. Por isso guardamos os ids do que enviamos e os ignoramos.
 */
const enviadasPorNos = new Set();
function lembrarEnviada(id) {
  if (!id) return;
  enviadasPorNos.add(id);
  if (enviadasPorNos.size > 500) {
    enviadasPorNos.delete(enviadasPorNos.values().next().value);
  }
}

const estado = {
  situacao: 'desligado',   // desligado | iniciando | qr | conectado | erro
  qr: null,                // texto do QR, quando situacao === 'qr'
  erro: null,
  desde: null,
};

function anotar(situacao, extra) {
  estado.situacao = situacao;
  estado.desde = new Date().toISOString();
  Object.assign(estado, extra || {});
}

function carregarDependencias() {
  try {
    ({ Client, LocalAuth } = require('whatsapp-web.js'));
    qrcodeTerminal = require('qrcode-terminal');
  } catch {
    throw new Error(
      'WA_DRIVER=wwebjs precisa das dependências opcionais. Rode: npm install whatsapp-web.js qrcode-terminal'
    );
  }
  try { gerarQrImagem = require('qrcode'); } catch { gerarQrImagem = null; }
}

const AUTH_DIR = () => process.env.WA_AUTH_DIR || path.resolve(__dirname, '..', '..', 'wwebjs_auth');

function montar() {
  carregarDependencias();

  cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR() }),
    puppeteer: {
      headless: process.env.WA_HEADLESS !== 'false',
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  cliente.on('qr', (qr) => {
    anotar('qr', { qr, erro: null });
    console.log('[wa] QR gerado — escaneie pelo painel em /admin ou pelo terminal abaixo:');
    if (qrcodeTerminal) qrcodeTerminal.generate(qr, { small: true });
  });
  cliente.on('authenticated', () => anotar('iniciando', { qr: null }));
  cliente.on('ready', () => { anotar('conectado', { qr: null, erro: null }); console.log('[wa] conectado'); });
  cliente.on('auth_failure', (m) => { anotar('erro', { erro: String(m), qr: null }); console.error(`[wa] falha de autenticação: ${m}`); });
  cliente.on('disconnected', (m) => {
    anotar('desligado', { qr: null, erro: String(m) });
    console.error(`[wa] desconectado: ${m}`);
    cliente = null;                       // permite reconectar sem reiniciar o processo
  });

  // 'message_create' cobre as duas origens: o que chega de fora e o que sai do
  // próprio aparelho conectado. 'message' sozinho perderia o segundo caso.
  cliente.on('message_create', async (msg) => {
    const id = msg.id && msg.id._serialized;
    if (msg.fromMe && enviadasPorNos.has(id)) return;    // é o nosso próprio aviso

    // O endereço da conversa nem sempre é um telefone: em conta migrada vem um
    // identificador interno. O contato traz o número de verdade, quando existe.
    let de = '';
    if (!msg.fromMe) {
      try {
        const contato = await msg.getContact();
        de = String((contato && contato.number) || '').replace(/\D/g, '');
      } catch { /* segue com o endereço cru */ }
    }
    if (!de) de = String(msg.fromMe ? (msg.to || '') : (msg.from || '')).replace(/\D/g, '');
    for (const cb of escutas) {
      try { await cb({ de, texto: msg.body, propria: Boolean(msg.fromMe), responder: (t) => msg.reply(t) }); }
      catch (e) { console.error('[wa] erro tratando mensagem:', e.message); }
    }
  });
}

/** Sobe o cliente sem travar quem chamou. */
async function iniciar() {
  if (cliente) return;
  anotar('iniciando', { qr: null, erro: null });
  try {
    montar();
    cliente.initialize().catch((e) => {
      anotar('erro', { erro: e.message });
      console.error('[wa] não consegui iniciar:', e.message);
      cliente = null;
    });
  } catch (e) {
    anotar('erro', { erro: e.message });
    throw e;
  }
}

/** Chamado pelo painel: força uma nova tentativa (e um QR novo). */
async function conectar() {
  if (estado.situacao === 'conectado') return estadoAtual();
  if (!cliente) await iniciar();
  return estadoAtual();
}

/**
 * Desconecta. `apagarSessao` faz logout de verdade — o número sai de
 * "Dispositivos conectados" no celular e o próximo acesso pede QR novo.
 */
async function desconectar({ apagarSessao = true } = {}) {
  const atual = cliente;
  cliente = null;
  anotar('desligado', { qr: null, erro: null });
  if (!atual) return estadoAtual();
  try {
    if (apagarSessao) await atual.logout();
    else await atual.destroy();
  } catch (e) {
    console.error('[wa] erro ao desconectar:', e.message);
    try { await atual.destroy(); } catch { /* já foi */ }
  }
  return estadoAtual();
}

function estadoAtual() {
  return {
    driver: 'wwebjs',
    situacao: estado.situacao,
    conectado: estado.situacao === 'conectado',
    temQr: Boolean(estado.qr),
    erro: estado.erro,
    desde: estado.desde,
  };
}

/** QR em imagem, para o painel mostrar. */
async function qrImagem() {
  if (!estado.qr) return null;
  if (!gerarQrImagem) {
    try { gerarQrImagem = require('qrcode'); } catch { return null; }
  }
  return gerarQrImagem.toDataURL(estado.qr, { margin: 1, width: 320 });
}

function esperarPronto(timeoutMs = 60000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (estado.situacao === 'conectado') return resolve();
      if (Date.now() - inicio > timeoutMs) {
        return reject(new Error(
          estado.situacao === 'qr'
            ? 'WhatsApp não está conectado: falta escanear o QR no painel (/admin).'
            : `WhatsApp não ficou pronto a tempo (situação: ${estado.situacao}).`
        ));
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

/**
 * Descobre o endereço real do número no WhatsApp.
 *
 * Montar `numero@c.us` na mão não funciona de forma confiável: o WhatsApp passou
 * a usar um identificador interno (LID) e o envio falha com "No LID for user".
 * No Brasil ainda tem o nono dígito — muita linha antiga está registrada sem
 * ele, e o número que a recepção informou pode ser a variante que não existe.
 * `getNumberId` resolve as duas coisas: devolve o endereço certo, ou nada, se o
 * número não tiver WhatsApp.
 */
async function enderecoDe(numero) {
  const digitos = String(numero).replace(/\D/g, '');
  if (!digitos) throw new Error('Número de WhatsApp vazio.');

  let achado = null;
  try {
    achado = await cliente.getNumberId(digitos);
  } catch (e) {
    console.error(`[wa] não consegui resolver o número ${digitos}: ${e.message}`);
  }

  // linha brasileira antiga: tenta a variante sem o nono dígito
  if (!achado && /^55\d{2}9\d{8}$/.test(digitos)) {
    const semNove = digitos.slice(0, 4) + digitos.slice(5);
    try { achado = await cliente.getNumberId(semNove); } catch { /* segue */ }
  }

  if (!achado) {
    throw new Error(
      `O número ${digitos} não foi encontrado no WhatsApp. Confira se está certo, ` +
      'com 55 + DDD + número, e se essa linha realmente tem WhatsApp.'
    );
  }
  return achado._serialized;
}

async function enviar(numero, texto) {
  if (estado.situacao !== 'conectado') {
    if (!cliente) await iniciar();
    await esperarPronto();
  }
  const enviada = await cliente.sendMessage(await enderecoDe(numero), texto);
  lembrarEnviada(enviada && enviada.id && enviada.id._serialized);
  return enviada;
}

module.exports = {
  nome: 'wwebjs',
  iniciar, enviar, conectar, desconectar, qrImagem, enderecoDe,
  /** só para teste: troca o cliente do WhatsApp por um de mentira */
  _usarCliente(falso) { cliente = falso; anotar('conectado'); },
  estado: estadoAtual,
  aoReceber: (cb) => escutas.push(cb),
};

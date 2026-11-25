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

/**
 * O texto do que acabamos de mandar, para não obedecermos a nós mesmos.
 *
 * Guardar só o id não basta: quando o aparelho da recepção é o mesmo da
 * sessão, o WhatsApp devolve a nossa própria mensagem por `message_create`, e
 * esse eco pode chegar antes de o envio resolver e nos dar o id. Por isso o
 * texto é anotado ANTES de enviar.
 *
 * Sem isso o sistema entra em laço: a resposta "não entendi" contém
 * "CONFIRMAR PA-0000-0000", ela mesma é lida como um comando de confirmar, e
 * cada volta gera outra mensagem — para sempre.
 */
const textosNossos = new Set();
function lembrarTexto(texto) {
  const chave = String(texto || '').trim();
  if (!chave) return;
  textosNossos.add(chave);
  if (textosNossos.size > 200) {
    textosNossos.delete(textosNossos.values().next().value);
  }
}
const ehTextoNosso = (texto) => textosNossos.has(String(texto || '').trim());

/**
 * A mensagem saiu de nós? Pelo id, ou pelo texto quando o eco chega primeiro.
 * Separado numa função para poder ser testado sem WhatsApp nenhum.
 */
function nossa(msg) {
  if (!msg || !msg.fromMe) return false;
  const id = msg.id && msg.id._serialized;
  return enviadasPorNos.has(id) || ehTextoNosso(msg.body);
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
    if (nossa(msg)) return;                          // não obedecemos a nós mesmos

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
      const responder = async (texto) => {
        lembrarTexto(texto);                    // antes de enviar: o eco é rápido
        const enviada = await msg.reply(texto);
        lembrarEnviada(enviada && enviada.id && enviada.id._serialized);
        return enviada;
      };
      try { await cb({ de, texto: msg.body, propria: Boolean(msg.fromMe), responder }); }
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
    numero: numeroConectado(),
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
/** O número em que a sessão está conectada, só dígitos ('' se não conectado). */
function numeroConectado() {
  const wid = cliente && cliente.info && cliente.info.wid;
  return wid ? String(wid.user || '').replace(/\D/g, '') : '';
}

/**
 * As formas em que o mesmo telefone brasileiro pode aparecer.
 *
 * Duas coisas variam conforme quem digitou: o código do país, que muita gente
 * omite ao cadastrar, e o nono dígito, que linhas antigas não têm. (62)
 * 8171-8205, (62) 98171-8205 e +55 62 98171-8205 são o mesmo telefone.
 *
 * O comprimento desfaz a ambiguidade do 55 ser também um DDD válido: 11
 * dígitos é DDD + celular; 13 é país + DDD + celular.
 */
function variantes(digitos) {
  const formas = new Set([digitos]);
  if (/^\d{10,11}$/.test(digitos)) formas.add(`55${digitos}`);
  for (const n of [...formas]) {
    if (/^55\d{2}9\d{8}$/.test(n)) formas.add(n.slice(0, 4) + n.slice(5));
    if (/^55\d{2}[5-9]\d{7}$/.test(n)) formas.add(`${n.slice(0, 4)}9${n.slice(4)}`);
  }
  return formas;
}

function mesmoTelefone(a, b) {
  if (!a || !b) return false;
  const doB = variantes(b);
  return [...variantes(a)].some((v) => doB.has(v));
}

async function enderecoDe(numero) {
  const digitos = String(numero).replace(/\D/g, '');
  if (!digitos) throw new Error('Número de WhatsApp vazio.');

  // Mandar para o próprio número conectado é caso legítimo: o consultório pode
  // ter um aparelho só, que é ao mesmo tempo a sessão e o telefone da recepção.
  // O getNumberId não resolve o próprio wid — devolve nulo, como se a linha não
  // existisse —, então usa o wid da sessão direto.
  if (mesmoTelefone(digitos, numeroConectado())) return cliente.info.wid._serialized;

  let achado = null;
  for (const tentativa of variantes(digitos)) {
    try {
      achado = await cliente.getNumberId(tentativa);
    } catch (e) {
      console.error(`[wa] não consegui resolver o número ${tentativa}: ${e.message}`);
    }
    if (achado) break;
  }

  // A consulta não achou. Isso NÃO prova que o número não existe: o
  // `getNumberId` conversa com o servidor do WhatsApp e devolve nulo também
  // quando a sessão ainda está sincronizando, quando o contato não está na
  // agenda do aparelho, ou por mudança de protocolo do lado deles.
  //
  // Recusar o envio por causa disso é pior do que tentar: a consulta é para
  // acertar o endereço, não para autorizar. Sem ela, monta-se o endereço
  // padrão e deixa-se o próprio envio dizer se falha.
  if (!achado) {
    console.warn(`[wa] ${digitos} não apareceu na consulta; enviando mesmo assim`);
    return `${digitos}@c.us`;
  }
  return achado._serialized;
}

/**
 * Diz se uma linha responde no WhatsApp, sem enviar nada.
 *
 * Serve ao botão "Testar número" do painel: descobrir dígito trocado na hora
 * de cadastrar, e não quando um paciente já agendou e a mensagem não chegou.
 */
async function verificar(numero) {
  const digitos = String(numero).replace(/\D/g, '');
  if (!digitos) return { ok: false, motivo: 'vazio', mensagem: 'Informe um número.' };
  if (!/^\d{10,15}$/.test(digitos)) {
    return { ok: false, motivo: 'formato',
      mensagem: 'Use 55 + DDD + número, só dígitos. Ex.: 5562991234567' };
  }
  if (!cliente) {
    return { ok: false, motivo: 'desconectado',
      mensagem: 'Conecte o WhatsApp antes de testar um número.' };
  }

  if (mesmoTelefone(digitos, numeroConectado())) {
    return { ok: true, mensagem: 'É o próprio número conectado. As mensagens vão para ele.' };
  }

  for (const tentativa of variantes(digitos)) {
    let achado = null;
    try {
      achado = await cliente.getNumberId(tentativa);
    } catch (e) {
      return { ok: false, motivo: 'erro',
        mensagem: `Não consegui consultar agora: ${e.message}` };
    }
    if (achado) {
      const igual = tentativa === digitos;
      return { ok: true, encontrado: tentativa,
        mensagem: igual
          ? 'Número confirmado no WhatsApp.'
          : `Confirmado, mas o WhatsApp registra como ${tentativa}. Vamos usar esse.` };
    }
  }

  // Mesmo aqui não afirmamos que o número não existe — só que não deu para
  // confirmar. O envio continua sendo tentado quando chegar um agendamento.
  return { ok: false, motivo: 'nao_confirmado',
    mensagem: 'Não consegui confirmar este número. Pode ser dígito trocado, linha sem '
      + 'WhatsApp, ou a consulta do WhatsApp falhando. O sistema vai tentar enviar '
      + 'assim mesmo — teste com uma mensagem de verdade para ter certeza.' };
}

async function enviar(numero, texto) {
  if (estado.situacao !== 'conectado') {
    if (!cliente) await iniciar();
    await esperarPronto();
  }
  lembrarTexto(texto);                          // antes de enviar: o eco é rápido
  const enviada = await cliente.sendMessage(await enderecoDe(numero), texto);
  lembrarEnviada(enviada && enviada.id && enviada.id._serialized);
  return enviada;
}

module.exports = {
  nome: 'wwebjs',
  iniciar, enviar, conectar, desconectar, qrImagem, enderecoDe, verificar,
  /** só para teste: a barreira que impede o sistema de obedecer a si mesmo */
  _nossa: nossa, _lembrarTexto: lembrarTexto,
  /** só para teste: troca o cliente do WhatsApp por um de mentira */
  _usarCliente(falso) { cliente = falso; anotar('conectado'); },
  estado: estadoAtual,
  aoReceber: (cb) => escutas.push(cb),
};

/**
 * Escolhe o driver de WhatsApp pelo .env (WA_DRIVER).
 *
 * Os três expõem a mesma interface — iniciar / enviar / aoReceber — então trocar
 * de não-oficial para API oficial é mudar uma linha do .env, não reescrever o
 * sistema. Essa decisão pode ficar para depois sem travar o resto.
 */
const drivers = {
  log: () => require('./log'),
  wwebjs: () => require('./wwebjs'),
  cloud: () => require('./cloud'),
};

const escolhido = process.env.WA_DRIVER || 'log';
if (!drivers[escolhido]) {
  throw new Error(`WA_DRIVER inválido: "${escolhido}". Use log, wwebjs ou cloud.`);
}

module.exports = drivers[escolhido]();

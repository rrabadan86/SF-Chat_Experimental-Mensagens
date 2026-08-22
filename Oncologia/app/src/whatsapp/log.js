/**
 * Driver "log" — não envia nada, só imprime. É o padrão em desenvolvimento:
 * dá para rodar o sistema inteiro, ver a mensagem exata que sairia e testar a
 * confirmação sem depender de WhatsApp nenhum.
 */
const escutas = [];

module.exports = {
  nome: 'log',
  async iniciar() { console.log('[wa:log] driver de desenvolvimento — nada será enviado de verdade'); },
  async enviar(numero, texto) {
    console.log(`\n[wa:log] ---> ${numero}\n${texto}\n`);
    return { simulado: true };
  },
  aoReceber(cb) { escutas.push(cb); },
  /** Só existe no driver de log: simula uma resposta chegando. */
  async simularEntrada(numero, texto) {
    for (const cb of escutas) await cb({ de: numero, texto });
  },
};

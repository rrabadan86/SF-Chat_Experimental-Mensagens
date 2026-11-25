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
  estado() {
    return {
      driver: 'log', situacao: 'teste', conectado: false, temQr: false,
      erro: null, desde: null,
    };
  },
  async qrImagem() { return null; },
  /**
   * Confere só o formato: sem WhatsApp de verdade não há a quem perguntar.
   * Diz isso em vez de aprovar em silêncio — aprovar daria uma confiança que
   * este driver não tem como sustentar.
   */
  async verificar(numero) {
    const digitos = String(numero).replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(digitos)) {
      return { ok: false, motivo: 'formato',
        mensagem: 'Use 55 + DDD + número, só dígitos. Ex.: 5562991234567' };
    }
    return { ok: false, motivo: 'nao_confirmado',
      mensagem: 'O formato está certo, mas este é o driver de desenvolvimento: '
        + 'ele não pergunta nada ao WhatsApp. Só dá para confirmar de verdade '
        + 'com o WhatsApp conectado.' };
  },
  async conectar() { return this.estado(); },
  async desconectar() { return this.estado(); },
  /** Só existe no driver de log: simula uma resposta chegando. */
  async simularEntrada(numero, texto) {
    for (const cb of escutas) await cb({ de: numero, texto });
  },
};

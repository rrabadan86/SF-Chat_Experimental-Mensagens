/**
 * config.js — a configuração viva do sistema.
 *
 * O que o médico edita pela tela (locais, horários, agendas, recepção) vem de
 * dados/config.json e é lido a cada acesso, então salvar no painel vale na hora
 * — sem reiniciar servidor. O que é infraestrutura (porta, fuso, credencial,
 * driver de WhatsApp) continua no .env, porque não é assunto dele.
 *
 * As propriedades abaixo são getters de propósito: quem faz `config.hospitais`
 * recebe sempre o estado atual, não uma cópia congelada na hora do boot.
 */
try { require('dotenv').config(); } catch { /* dotenv é opcional: em teste o ambiente já vem pronto */ }

const dados = require('./dados');

const config = {
  porta: Number(process.env.PORT || 3000),
  fuso: process.env.FUSO || 'America/Sao_Paulo',
  offset: process.env.TZ_OFFSET || '-03:00',

  /** Só os locais ligados aparecem para o paciente. */
  get hospitais() {
    return dados.ler().hospitais.filter((h) => h.ativo && h.calendarId);
  },
  /** Inclui os desligados — o painel precisa ver todos. */
  get todosHospitais() {
    return dados.ler().hospitais;
  },
  get agendasDeBloqueio() {
    return dados.ler().agendasDeBloqueio || [];
  },
  /**
   * Tudo que é consultado antes de oferecer um horário: as agendas de todos os
   * locais ativos mais as de bloqueio. O médico é um só — estar ocupado num
   * hospital tem que sumir com o horário no outro.
   */
  get agendasParaConsultar() {
    return [...new Set([...this.hospitais.map((h) => h.calendarId), ...this.agendasDeBloqueio])];
  },
  get medico() {
    return dados.ler().medico;
  },
  get whatsapp() {
    return {
      driver: process.env.WA_DRIVER || 'log',
      recepcao: (dados.ler().recepcao || {}).whatsapp || '',
      avisarPaciente: process.env.AVISAR_PACIENTE !== 'false',
    };
  },
  get confirmacaoPrazoHoras() {
    return Number(process.env.CONFIRMACAO_PRAZO_HORAS || 24);
  },

  hospitalPorId(id) {
    return this.hospitais.find((h) => h.id === id) || null;
  },
  /** Usado pelo painel e pela confirmação, que precisam achar até o desligado. */
  qualquerHospitalPorId(id) {
    return this.todosHospitais.find((h) => h.id === id) || null;
  },
};

module.exports = config;

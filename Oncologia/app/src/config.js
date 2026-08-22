/**
 * config.js — junta o arquivo de hospitais com os segredos do ambiente.
 *
 * A grade de atendimento fica em config/hospitais.json (o médico pode pedir
 * mudança sem mexer em código). Os IDs de agenda e as chaves ficam no .env,
 * porque não vão para o repositório.
 */
try { require('dotenv').config(); } catch { /* dotenv é opcional: em teste o ambiente já vem pronto */ }
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function carregarHospitais() {
  const arquivo = process.env.HOSPITAIS_JSON || path.join(RAIZ, 'config', 'hospitais.json');
  const lista = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return lista.map((h) => {
    const calendarId = process.env[`CAL_${h.id.toUpperCase()}`];
    if (!calendarId) {
      throw new Error(
        `Falta a variável CAL_${h.id.toUpperCase()} no .env — é o ID da agenda do Google do "${h.nome}".`
      );
    }
    return { ...h, calendarId };
  });
}

const hospitais = carregarHospitais();

/** Agendas que só entram na checagem de disponibilidade e nunca recebem evento. */
const agendasDeBloqueio = (process.env.CAL_BLOQUEIOS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** Todas as agendas consultadas antes de oferecer um horário. */
const agendasParaConsultar = [...hospitais.map((h) => h.calendarId), ...agendasDeBloqueio];

const config = {
  porta: Number(process.env.PORT || 3000),
  fuso: process.env.FUSO || 'America/Sao_Paulo',
  offset: process.env.TZ_OFFSET || '-03:00',
  hospitais,
  agendasDeBloqueio,
  agendasParaConsultar,
  medico: {
    nome: process.env.MEDICO_NOME || 'o médico',
    crm: process.env.MEDICO_CRM || '',
  },
  whatsapp: {
    driver: process.env.WA_DRIVER || 'log',
    recepcao: (process.env.WA_RECEPCAO || '').replace(/\D/g, ''),
    avisarPaciente: process.env.AVISAR_PACIENTE !== 'false',
  },
  confirmacaoPrazoHoras: Number(process.env.CONFIRMACAO_PRAZO_HORAS || 24),
  hospitalPorId(id) {
    return hospitais.find((h) => h.id === id) || null;
  },
};

module.exports = config;

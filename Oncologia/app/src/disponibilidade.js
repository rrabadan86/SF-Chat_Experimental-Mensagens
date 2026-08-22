/**
 * disponibilidade.js — a regra de quais horários podem ser oferecidos.
 *
 * Função pura: recebe a grade do hospital e os períodos ocupados (que vêm do
 * freeBusy do Google) e devolve o que sobra. Não fala com a rede — é isso que
 * torna essa parte testável de verdade.
 *
 * Duas decisões que valem estar explícitas:
 *   - A grade (dias e horas de ambulatório) vem da configuração, NÃO do Google.
 *     Assim um compromisso pessoal na agenda nunca vira "horário de consulta".
 *   - O "ocupado" é a soma das DUAS agendas de hospital mais as agendas de
 *     bloqueio. O médico é um só: se ele está no Hospital 1 às 9h, o Hospital 2
 *     não pode oferecer 9h.
 */
const t = require('./tempo');

/** Todos os slots teóricos de um dia, ignorando ocupação. */
function gradeDoDia(hospital, dataISO) {
  if (!hospital.dias.includes(t.diaDaSemana(dataISO))) return [];
  const passo = hospital.duracaoMin + (hospital.intervaloMin || 0);
  const fim = t.emMinutos(hospital.fim);
  const slots = [];
  for (let m = t.emMinutos(hospital.inicio); m + hospital.duracaoMin <= fim; m += passo) {
    slots.push({ inicio: t.emHora(m), fim: t.emHora(m + hospital.duracaoMin) });
  }
  return slots;
}

/** Dois intervalos [aIni,aFim) e [bIni,bFim) se sobrepõem? */
function colide(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

/**
 * Slots livres de um dia.
 * @param ocupados  [{ inicio: <RFC3339>, fim: <RFC3339> }] vindos do freeBusy
 * @param agora     Date — para respeitar a antecedência mínima
 */
function slotsLivres(hospital, dataISO, ocupados = [], agora = new Date()) {
  const limite = agora.getTime() + (hospital.antecedenciaMinHoras || 0) * 3600000;
  const janelas = ocupados.map((o) => [Date.parse(o.inicio), Date.parse(o.fim)]);

  return gradeDoDia(hospital, dataISO)
    .map((slot) => {
      const ini = t.ms(dataISO, slot.inicio);
      const fim = t.ms(dataISO, slot.fim);
      const cedoDemais = ini < limite;
      const batendo = janelas.some(([bi, bf]) => colide(ini, fim, bi, bf));
      return { ...slot, livre: !cedoDemais && !batendo, motivo: cedoDemais ? 'antecedencia' : (batendo ? 'ocupado' : null) };
    });
}

/** Próximas datas de ambulatório do hospital, a partir de (e incluindo) `de`. */
function proximosDias(hospital, de, quantidade = 8) {
  const dias = [];
  let data = de;
  for (let i = 0; i < (hospital.janelaDias || 60) && dias.length < quantidade; i++) {
    if (hospital.dias.includes(t.diaDaSemana(data))) dias.push(data);
    data = t.somarDias(data, 1);
  }
  return dias;
}

/** Um horário específico está livre? Usado na recontagem no momento do envio. */
function horarioEstaLivre(hospital, dataISO, hora, ocupados, agora = new Date()) {
  const slot = slotsLivres(hospital, dataISO, ocupados, agora).find((s) => s.inicio === hora);
  return Boolean(slot && slot.livre);
}

module.exports = { gradeDoDia, slotsLivres, proximosDias, horarioEstaLivre, colide };

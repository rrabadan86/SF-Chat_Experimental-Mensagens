/**
 * disponibilidade.js — a regra de quais horários podem ser oferecidos.
 *
 * Função pura: recebe a grade do hospital e os períodos ocupados (que vêm do
 * freeBusy do Google) e devolve o que sobra. Não fala com a rede — é isso que
 * torna essa parte testável de verdade.
 *
 * Duas decisões que valem estar explícitas:
 *   - A grade (as faixas de atendimento) vem da configuração, NÃO do Google.
 *     Assim um compromisso pessoal na agenda nunca vira "horário de consulta".
 *   - O "ocupado" é a soma das DUAS agendas de hospital mais as agendas de
 *     bloqueio. O médico é um só: se ele está no Hospital 1 às 9h, o Hospital 2
 *     não pode oferecer 9h.
 */
const t = require('./tempo');

/**
 * As faixas de atendimento que valem num dia específico.
 *
 * O expediente é uma lista de faixas — cada uma com seus dias e seu horário —
 * porque o médico não atende o mesmo horário em todos os dias: pode ser
 * segunda de manhã e quinta à tarde, ou até manhã e tarde no mesmo dia.
 */
function faixasDoDia(hospital, dataISO) {
  const diaSemana = t.diaDaSemana(dataISO);
  return (hospital.expediente || []).filter((f) => f.dias.includes(diaSemana));
}

/** Todos os slots teóricos de um dia, somando as faixas, ignorando ocupação. */
function gradeDoDia(hospital, dataISO) {
  const passo = hospital.duracaoMin + (hospital.intervaloMin || 0);
  const slots = [];
  for (const faixa of faixasDoDia(hospital, dataISO)) {
    const fim = t.emMinutos(faixa.fim);
    for (let m = t.emMinutos(faixa.inicio); m + hospital.duracaoMin <= fim; m += passo) {
      slots.push({ inicio: t.emHora(m), fim: t.emHora(m + hospital.duracaoMin) });
    }
  }
  return slots.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** União dos dias de todas as faixas. */
function diasAtendidos(hospital) {
  const dias = new Set();
  for (const f of hospital.expediente || []) for (const d of f.dias) dias.add(d);
  return [...dias].sort();
}

/** Dois intervalos [aIni,aFim) e [bIni,bFim) se sobrepõem? */
function colide(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

/**
 * Slots de um dia, dizendo quais estão livres.
 *
 * Duas coisas diferentes ocupam um horário, e a distinção importa:
 *
 *   consultas — o que já está marcado NESTE local. Contam contra as vagas:
 *               se o médico atende dois pacientes por horário, uma consulta
 *               marcada ainda deixa a segunda vaga aberta.
 *   bloqueios — o que impede o horário de existir: compromisso em outro
 *               hospital, agenda pessoal, evento de dia inteiro. Um só já
 *               fecha o horário, independentemente de vaga.
 *
 * @param agora  Date — para respeitar a antecedência mínima
 */
function slotsLivres(hospital, dataISO, ocupacao = {}, agora = new Date()) {
  const { consultas = [], bloqueios = [] } = ocupacao;
  const vagas = Math.max(1, Number(hospital.vagasPorHorario) || 1);
  const limite = agora.getTime() + (hospital.antecedenciaMinHoras || 0) * 3600000;

  const janelasBloqueio = bloqueios.map((o) => [Date.parse(o.inicio), Date.parse(o.fim)]);
  const janelasConsulta = consultas.map((o) => [Date.parse(o.inicio), Date.parse(o.fim)]);

  return gradeDoDia(hospital, dataISO).map((slot) => {
    const ini = t.ms(dataISO, slot.inicio);
    const fim = t.ms(dataISO, slot.fim);

    const cedoDemais = ini < limite;
    const bloqueado = janelasBloqueio.some(([bi, bf]) => colide(ini, fim, bi, bf));
    const ocupadas = janelasConsulta.filter(([bi, bf]) => colide(ini, fim, bi, bf)).length;
    const lotado = ocupadas >= vagas;

    let motivo = null;
    if (cedoDemais) motivo = 'antecedencia';
    else if (bloqueado) motivo = 'bloqueado';
    else if (lotado) motivo = 'lotado';

    return { ...slot, livre: !motivo, motivo, ocupadas, vagas };
  });
}

/** Próximas datas de ambulatório do hospital, a partir de (e incluindo) `de`. */
function proximosDias(hospital, de, quantidade = 8) {
  const atende = diasAtendidos(hospital);
  const dias = [];
  let data = de;
  for (let i = 0; i < (hospital.janelaDias || 60) && dias.length < quantidade; i++) {
    if (atende.includes(t.diaDaSemana(data))) dias.push(data);
    data = t.somarDias(data, 1);
  }
  return dias;
}

/** Um horário específico está livre? Usado na recontagem no momento do envio. */
function horarioEstaLivre(hospital, dataISO, hora, ocupacao, agora = new Date()) {
  const slot = slotsLivres(hospital, dataISO, ocupacao, agora).find((s) => s.inicio === hora);
  return Boolean(slot && slot.livre);
}

/** Quantas consultas já existem naquele horário — usado no aviso à recepção. */
function ocupacaoDoHorario(hospital, dataISO, hora, ocupacao = {}) {
  const slot = slotsLivres(hospital, dataISO, ocupacao, new Date(0)).find((s) => s.inicio === hora);
  return slot ? { ocupadas: slot.ocupadas, vagas: slot.vagas } : { ocupadas: 0, vagas: 1 };
}

module.exports = {
  gradeDoDia, faixasDoDia, diasAtendidos, slotsLivres, proximosDias,
  horarioEstaLivre, ocupacaoDoHorario, colide,
};

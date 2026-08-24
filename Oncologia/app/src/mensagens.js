/**
 * mensagens.js — todo texto que sai pelo WhatsApp mora aqui.
 *
 * Junto num arquivo só porque quem vai querer mudar isso é o médico, não o
 * programador. O negrito do WhatsApp é *asterisco*.
 */
const t = require('./tempo');

function linhaIdade(nascimento, hojeISO) {
  const anos = t.idade(nascimento, hojeISO);
  return anos === null ? t.brasileira(nascimento) : `${t.brasileira(nascimento)} (${anos} anos)`;
}

/** Vai para a recepcionista assim que o paciente envia o formulário. */
function paraRecepcao(ag, hospital, hojeISO = t.hoje()) {
  const l = [];
  l.push(`*NOVO PRÉ-AGENDAMENTO* ${ag.protocolo}`);
  l.push(`${hospital.nome} · ${t.curta(ag.data)} às ${ag.hora}`);
  if (ag.vagasNoHorario > 1) {
    l.push(`_${ag.posicaoNoHorario}ª de ${ag.vagasNoHorario} consultas neste horário_`);
  }
  l.push('');
  l.push(`*Paciente:* ${ag.nome}`);
  l.push(`*Nascimento:* ${linhaIdade(ag.nascimento, hojeISO)}`);
  l.push(`*WhatsApp:* ${ag.telefone}`);
  l.push(`*Tipo:* ${ag.tipo}`);
  l.push(`*Pagamento:* ${ag.pagamento}${ag.carteirinha ? ` — carteirinha ${ag.carteirinha}` : ''}`);
  if (ag.encaminhamento) l.push(`*Encaminhado por:* ${ag.encaminhamento}`);
  if (ag.motivo) l.push(`*Motivo:* ${ag.motivo}`);
  l.push('');
  l.push(`Já lancei na agenda do ${hospital.nome} como pré-agendamento.`);
  l.push(`Responda *CONFIRMAR ${ag.protocolo}* depois de falar com o paciente, ou *REMARCAR ${ag.protocolo}*.`);
  return l.join('\n');
}

/** Cobrança da recepcionista quando o prazo passou sem confirmação. */
function lembreteRecepcao(ag, hospital, horas) {
  return [
    `*PENDENTE HÁ ${horas}H* ${ag.protocolo}`,
    `${ag.nome} — ${hospital.nome}, ${t.curta(ag.data)} às ${ag.hora}`,
    '',
    `O horário segue bloqueado na agenda do ${hospital.nome}. Responda *CONFIRMAR ${ag.protocolo}* ou *REMARCAR ${ag.protocolo}*.`,
  ].join('\n');
}

/** Vai para o paciente quando a recepção confirma. */
function confirmacaoPaciente(ag, hospital, medico) {
  const l = [];
  l.push(`Olá, ${primeiroNome(ag.nome)}! Sua consulta com ${medico.nome} está *confirmada*.`);
  l.push('');
  l.push(`📅 ${t.porExtenso(ag.data)}, às ${ag.hora}`);
  l.push(`📍 ${hospital.nome}${hospital.endereco && hospital.endereco !== 'a definir' ? ` — ${hospital.endereco}` : ''}`);
  l.push('');
  l.push('Leve documento com foto, carteirinha do convênio e todos os exames e laudos que já tiver, inclusive os antigos.');
  l.push('Chegue com 15 minutos de antecedência. Se precisar remarcar, é só responder esta mensagem.');
  return l.join('\n');
}

/** Vai para o paciente quando a recepção precisa remarcar. */
function remarcacaoPaciente(ag, hospital, medico) {
  return [
    `Olá, ${primeiroNome(ag.nome)}. Sobre a consulta com ${medico.nome} em ${t.curta(ag.data)} às ${ag.hora}, no ${hospital.nome}:`,
    '',
    'precisamos remarcar. Nossa recepção vai entrar em contato por aqui para escolher um novo horário com você.',
    '',
    'Desculpe o transtorno.',
  ].join('\n');
}

function primeiroNome(nome = '') {
  return String(nome).trim().split(/\s+/)[0] || '';
}

module.exports = { paraRecepcao, lembreteRecepcao, confirmacaoPaciente, remarcacaoPaciente, primeiroNome };

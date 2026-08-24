/**
 * agendamento.js — a orquestração: disponibilidade, criação do evento e aviso.
 *
 * Sequência do POST /api/agendar, e a ordem importa:
 *   1. valida o que veio do navegador;
 *   2. RECONSULTA o Google — entre abrir a tela e enviar o formulário passaram
 *      minutos, e o horário pode ter sido tomado;
 *   3. cria o evento provisório (é isso que trava o horário);
 *   4. avisa a recepcionista.
 *
 * Se o passo 4 falhar, o agendamento continua de pé: o evento está na agenda e
 * o erro vai para o log. O contrário — avisar e não marcar — é que seria ruim.
 */
const config = require('./config');
const t = require('./tempo');
const disp = require('./disponibilidade');
const agenda = require('./google-agenda');
const protocolo = require('./protocolo');
const mensagens = require('./mensagens');
const wa = require('./whatsapp');
const { validar } = require('./validacao');

class ErroDeAgendamento extends Error {
  constructor(mensagem, codigo = 'erro', extra = {}) {
    super(mensagem);
    this.codigo = codigo;
    Object.assign(this, extra);
  }
}

/**
 * Levanta a ocupação de um período, separando o que conta vaga do que bloqueia.
 *
 * A agenda DESTE local é listada evento a evento, porque é preciso CONTAR
 * quantas consultas há em cada horário — o freeBusy funde os sobrepostos e não
 * serviria. As outras agendas (o outro hospital, a pessoal) vêm por freeBusy
 * mesmo: ali só interessa saber se está ocupado, não quantos.
 */
async function levantarOcupacao(hospital, deISO, ateISO) {
  const inicioRFC = t.rfc3339(deISO, '00:00');
  const fimRFC = t.rfc3339(ateISO, '00:00');
  const outras = config.agendasParaConsultar.filter((id) => id !== hospital.calendarId);

  const [proprio, deOutras] = await Promise.all([
    agenda.eventos(hospital.calendarId, inicioRFC, fimRFC, config.fuso),
    outras.length ? agenda.ocupados(outras, inicioRFC, fimRFC, config.fuso) : Promise.resolve([]),
  ]);

  return {
    consultas: proprio.consultas,
    bloqueios: [...proprio.bloqueios, ...deOutras],
  };
}

/** Grade dos próximos dias de um hospital, já descontando o que está ocupado. */
async function horariosDisponiveis(hospitalId, quantidadeDeDias = 8, agora = new Date()) {
  const hospital = config.hospitalPorId(hospitalId);
  if (!hospital) throw new ErroDeAgendamento('Hospital desconhecido.', 'hospital_invalido');

  const dias = disp.proximosDias(hospital, t.hoje(agora), quantidadeDeDias);
  if (!dias.length) return { hospital: resumoHospital(hospital), dias: [] };

  const ocupacao = await levantarOcupacao(hospital, dias[0], t.somarDias(dias[dias.length - 1], 1));

  return {
    hospital: resumoHospital(hospital),
    dias: dias.map((data) => {
      const slots = disp.slotsLivres(hospital, data, ocupacao, agora);
      return { data, livres: slots.filter((s) => s.livre).length, slots };
    }),
  };
}

async function agendar(corpo, agora = new Date()) {
  const { ok, erros, dados } = validar(corpo);
  if (!ok) throw new ErroDeAgendamento('Confira os campos destacados.', 'validacao', { erros });

  const hospital = config.hospitalPorId(dados.hospital);
  if (!hospital) throw new ErroDeAgendamento('Hospital desconhecido.', 'hospital_invalido');

  // 2. reconsulta antes de gravar — a tela pode estar aberta há meia hora
  const ocupacao = await levantarOcupacao(hospital, dados.data, t.somarDias(dados.data, 1));
  if (!disp.horarioEstaLivre(hospital, dados.data, dados.hora, ocupacao, agora)) {
    throw new ErroDeAgendamento(
      'Esse horário acabou de ser ocupado. Escolha outro, por favor.',
      'horario_ocupado'
    );
  }
  // quantos já estavam nesse horário: a recepção precisa saber que é a 2ª
  const antes = disp.ocupacaoDoHorario(hospital, dados.data, dados.hora, ocupacao);

  // 3. grava o pré-agendamento
  const numero = protocolo.gerar(Number(dados.data.slice(0, 4)));
  const fim = t.emHora(t.emMinutos(dados.hora) + hospital.duracaoMin);
  const evento = await agenda.criarPreAgendamento({
    calendarId: hospital.calendarId,
    titulo: `PRÉ · ${dados.nome} — ${dados.tipo}`,
    inicioRFC: t.rfc3339(dados.data, dados.hora),
    fimRFC: t.rfc3339(dados.data, fim),
    fuso: config.fuso,
    local: hospital.endereco && hospital.endereco !== 'a definir' ? hospital.endereco : hospital.nome,
    descricao: descricaoDoEvento(dados, hospital, numero),
    protocolo: numero,
  });

  const registro = {
    ...dados, protocolo: numero, eventoId: evento.id, calendarId: hospital.calendarId,
    posicaoNoHorario: antes.ocupadas + 1, vagasNoHorario: antes.vagas,
  };

  // 4. avisa a recepcionista (falha aqui não desfaz o agendamento)
  try {
    await avisarRecepcao(registro, hospital, agora);
  } catch (e) {
    console.error(`[agendamento] ${numero} criado, mas o aviso à recepção falhou: ${e.message}`);
    registro.avisoPendente = true;
  }

  return {
    protocolo: numero,
    hospital: resumoHospital(hospital),
    data: dados.data,
    hora: dados.hora,
    fim,
    posicaoNoHorario: registro.posicaoNoHorario,
    vagasNoHorario: registro.vagasNoHorario,
    avisoPendente: Boolean(registro.avisoPendente),
  };
}

/** Resposta da recepcionista chegando pelo WhatsApp. */
async function tratarRespostaRecepcao({ de, texto: corpoDaMensagem }) {
  const comando = protocolo.interpretar(corpoDaMensagem);
  if (!comando) return null;                       // conversa normal, ignora
  if (de && config.whatsapp.recepcao && de.replace(/\D/g, '') !== config.whatsapp.recepcao) {
    console.warn(`[wa] comando ${comando.protocolo} veio de ${de}, que não é a recepção. Ignorado.`);
    return null;
  }

  const achado = await agenda.buscarPorProtocolo(config.hospitais.map((h) => h.calendarId), comando.protocolo);
  if (!achado) {
    await wa.enviar(de, `Não achei o protocolo ${comando.protocolo}. Confira o número.`);
    return { comando: comando.comando, protocolo: comando.protocolo, resultado: 'nao_encontrado' };
  }

  const hospital = config.hospitais.find((h) => h.calendarId === achado.calendarId);
  const dadosDoEvento = lerEvento(achado.evento, hospital);

  if (comando.comando === 'CONFIRMAR') {
    await agenda.confirmar(achado.calendarId, achado.evento);
    if (config.whatsapp.avisarPaciente && dadosDoEvento.telefone) {
      await avisarPaciente(dadosDoEvento, hospital, 'confirmacao');
    }
    await wa.enviar(de, `Feito. ${comando.protocolo} confirmado na ${hospital.agenda}` +
      (config.whatsapp.avisarPaciente ? ' e o paciente já foi avisado.' : '.'));
    return { comando: 'CONFIRMAR', protocolo: comando.protocolo, resultado: 'confirmado' };
  }

  if (comando.comando === 'REMARCAR' || comando.comando === 'CANCELAR') {
    await agenda.liberar(achado.calendarId, achado.evento.id);
    if (comando.comando === 'REMARCAR' && config.whatsapp.avisarPaciente && dadosDoEvento.telefone) {
      await avisarPaciente(dadosDoEvento, hospital, 'remarcacao');
    }
    await wa.enviar(de, `Horário de ${comando.protocolo} liberado na ${hospital.agenda}.`);
    return { comando: comando.comando, protocolo: comando.protocolo, resultado: 'liberado' };
  }

  await wa.enviar(de, `Recebi ${comando.protocolo}, mas não entendi o que fazer. ` +
    `Responda *CONFIRMAR ${comando.protocolo}* ou *REMARCAR ${comando.protocolo}*.`);
  return { comando: null, protocolo: comando.protocolo, resultado: 'comando_desconhecido' };
}

/** Cobra da recepcionista os pré-agendamentos parados além do prazo. */
async function cobrarPendentes(agora = new Date()) {
  const limite = agora.getTime() - config.confirmacaoPrazoHoras * 3600000;
  const cobrados = [];
  for (const hospital of config.hospitais) {
    const eventos = await agenda.pendentes(
      hospital.calendarId, agora.toISOString(), new Date(agora.getTime() + 90 * 86400000).toISOString()
    );
    for (const evento of eventos) {
      if (Date.parse(evento.created) > limite) continue;
      const dados = lerEvento(evento, hospital);
      await wa.enviar(config.whatsapp.recepcao,
        mensagens.lembreteRecepcao(dados, hospital, config.confirmacaoPrazoHoras));
      cobrados.push(dados.protocolo);
    }
  }
  return cobrados;
}

// ---------------------------------------------------------------- auxiliares

function resumoHospital(h) {
  return {
    id: h.id, nome: h.nome, agenda: h.agenda, endereco: h.endereco,
    duracaoMin: h.duracaoMin, expediente: h.expediente || [],
    vagasPorHorario: h.vagasPorHorario || 1,
  };
}

/**
 * A descrição do evento é o prontuário mínimo que o médico vê no celular, e é
 * de onde o sistema relê os dados quando a recepcionista responde. Por isso o
 * formato "Campo: valor", uma por linha — legível para pessoa e para código.
 */
function descricaoDoEvento(d, hospital, numero) {
  const linhas = [
    `Protocolo: ${numero}`,
    `Paciente: ${d.nome}`,
    `Nascimento: ${t.brasileira(d.nascimento)}`,
    `Telefone: ${d.telefone}`,
    `Tipo: ${d.tipo}`,
    `Pagamento: ${d.pagamento}${d.carteirinha ? ` — carteirinha ${d.carteirinha}` : ''}`,
  ];
  if (d.encaminhamento) linhas.push(`Encaminhado por: ${d.encaminhamento}`);
  if (d.motivo) linhas.push(`Motivo: ${d.motivo}`);
  linhas.push('', `Origem: formulário do site · ${hospital.nome}`);
  return linhas.join('\n');
}

/** Caminho inverso de descricaoDoEvento. */
function lerEvento(evento, hospital) {
  const campos = {};
  for (const linha of String(evento.description || '').split('\n')) {
    const m = linha.match(/^([^:]+):\s*(.+)$/);
    if (m) campos[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const inicio = evento.start?.dateTime || '';
  return {
    protocolo: evento.extendedProperties?.private?.protocolo || campos.protocolo || '',
    nome: campos.paciente || String(evento.summary || '').replace(/^PRÉ\s·\s/, '').split(' — ')[0],
    telefone: (campos.telefone || '').replace(/\D/g, ''),
    tipo: campos.tipo || '',
    pagamento: campos.pagamento || '',
    motivo: campos.motivo || '',
    nascimento: campos.nascimento || '',
    data: inicio.slice(0, 10),
    hora: inicio.slice(11, 16),
    hospital: hospital?.id,
  };
}

async function avisarRecepcao(registro, hospital, agora) {
  if (!config.whatsapp.recepcao) {
    throw new Error('WA_RECEPCAO não configurado — ninguém para avisar.');
  }
  const texto = mensagens.paraRecepcao(registro, hospital, t.hoje(agora));
  await wa.enviar(config.whatsapp.recepcao, texto);
}

async function avisarPaciente(dados, hospital, tipo) {
  const texto = tipo === 'confirmacao'
    ? mensagens.confirmacaoPaciente(dados, hospital, config.medico)
    : mensagens.remarcacaoPaciente(dados, hospital, config.medico);

  // Na API oficial, iniciar conversa com o paciente exige template aprovado.
  if (wa.nome === 'cloud' && process.env.WA_TEMPLATE_PACIENTE) {
    return wa.enviarTemplate(dados.telefone, process.env.WA_TEMPLATE_PACIENTE, [
      mensagens.primeiroNome(dados.nome),
      config.medico.nome,
      `${t.porExtenso(dados.data)} às ${dados.hora}`,
      hospital.nome,
    ]);
  }
  return wa.enviar(dados.telefone, texto);
}

module.exports = {
  horariosDisponiveis, agendar, tratarRespostaRecepcao, cobrarPendentes, levantarOcupacao,
  ErroDeAgendamento, descricaoDoEvento, lerEvento, resumoHospital,
};

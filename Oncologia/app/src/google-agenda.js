/**
 * google-agenda.js — a conversa com o Google Calendar.
 *
 * Autentica com uma CONTA DE SERVIÇO: o médico compartilha cada agenda com o
 * e-mail dessa conta, com permissão de "Fazer alterações nos eventos". Não usa
 * OAuth de usuário, então não existe tela de login para expirar nem token para
 * renovar na mão.
 *
 * O protocolo (PA-2026-0000) é gravado em extendedProperties.private, que é o
 * campo indexado e pesquisável do Google — é assim que a resposta da
 * recepcionista no WhatsApp reencontra o evento certo.
 */
const { google } = require('googleapis');

const OFFSET = process.env.TZ_OFFSET || '-03:00';

const ESCOPOS = ['https://www.googleapis.com/auth/calendar.events'];
const ESCOPOS_LEITURA = ['https://www.googleapis.com/auth/calendar.readonly'];

let clienteCache = null;

function credenciais() {
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    return { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) };
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS };
  }
  throw new Error(
    'Faltou a credencial do Google: defina GOOGLE_APPLICATION_CREDENTIALS (caminho do json) ' +
    'ou GOOGLE_CREDENTIALS_JSON (o json inteiro) no .env.'
  );
}

function cliente() {
  if (!clienteCache) {
    const auth = new google.auth.GoogleAuth({
      ...credenciais(),
      scopes: [...ESCOPOS, ...ESCOPOS_LEITURA],
    });
    clienteCache = google.calendar({ version: 'v3', auth });
  }
  return clienteCache;
}

/**
 * Períodos ocupados em várias agendas de uma vez.
 * @returns [{ inicio, fim }] já achatado — não importa de qual agenda veio,
 *          o médico é um só.
 */
async function ocupados(calendarIds, inicioRFC, fimRFC, fuso) {
  if (!calendarIds.length) return [];
  const { data } = await cliente().freebusy.query({
    requestBody: {
      timeMin: inicioRFC,
      timeMax: fimRFC,
      timeZone: fuso,
      items: calendarIds.map((id) => ({ id })),
    },
  });

  const fora = [];
  const periodos = [];
  for (const [id, info] of Object.entries(data.calendars || {})) {
    if (info.errors && info.errors.length) {
      fora.push(`${id}: ${info.errors.map((e) => e.reason).join(', ')}`);
      continue;
    }
    for (const b of info.busy || []) periodos.push({ inicio: b.start, fim: b.end });
  }

  // Uma agenda inacessível não pode virar "tudo livre" — seria marcar consulta
  // em cima de compromisso existente. Melhor falhar alto.
  if (fora.length) {
    throw new Error(
      `O Google recusou a consulta a estas agendas: ${fora.join(' | ')}. ` +
      'Confira se cada uma foi compartilhada com a conta de serviço.'
    );
  }
  return periodos;
}

/** Cria o evento provisório (pré-agendamento) na agenda do hospital escolhido. */
async function criarPreAgendamento({ calendarId, titulo, inicioRFC, fimRFC, fuso, descricao, local, protocolo }) {
  const { data } = await cliente().events.insert({
    calendarId,
    sendUpdates: 'none',
    requestBody: {
      summary: titulo,
      description: descricao,
      location: local,
      start: { dateTime: inicioRFC, timeZone: fuso },
      end: { dateTime: fimRFC, timeZone: fuso },
      status: 'tentative',
      transparency: 'opaque',
      extendedProperties: { private: { protocolo, origem: 'formulario-web' } },
    },
  });
  return data;
}

/** Acha um evento pelo protocolo, procurando em todas as agendas informadas. */
async function buscarPorProtocolo(calendarIds, protocolo) {
  for (const calendarId of calendarIds) {
    const { data } = await cliente().events.list({
      calendarId,
      privateExtendedProperty: `protocolo=${protocolo}`,
      showDeleted: false,
      maxResults: 5,
      singleEvents: true,
    });
    const evento = (data.items || [])[0];
    if (evento) return { calendarId, evento };
  }
  return null;
}

/** Tira o prefixo "PRÉ · " e passa o evento para confirmado. */
async function confirmar(calendarId, evento) {
  const { data } = await cliente().events.patch({
    calendarId,
    eventId: evento.id,
    requestBody: {
      summary: String(evento.summary || '').replace(/^PRÉ\s·\s/, ''),
      status: 'confirmed',
    },
  });
  return data;
}

/** Libera o horário. O evento sai da agenda; o histórico fica no log. */
async function liberar(calendarId, eventoId) {
  await cliente().events.delete({ calendarId, eventId: eventoId, sendUpdates: 'none' });
}

/** Pré-agendamentos ainda provisórios — usado pela cobrança das 24h. */
async function pendentes(calendarId, deRFC, ateRFC) {
  const { data } = await cliente().events.list({
    calendarId,
    timeMin: deRFC,
    timeMax: ateRFC,
    privateExtendedProperty: 'origem=formulario-web',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (data.items || []).filter((e) => e.status === 'tentative');
}

/**
 * Confere se a conta de serviço enxerga a agenda E consegue escrever nela.
 *
 * Não dá para usar calendarList aqui: conta de serviço NÃO recebe a agenda na
 * sua lista quando alguém compartilha — ao contrário de uma conta de pessoa,
 * onde ela aparece em "Outras agendas". O calendarList.get devolvia 404 mesmo
 * com o compartilhamento certo, e o médico via "não encontrei esta agenda"
 * depois de ter feito tudo direito.
 *
 * Então o teste é o próprio ato: lê os dados da agenda e, se conseguir, cria um
 * evento e apaga em seguida. É a única forma de saber que dá para marcar
 * consulta ali — permissão de leitura passa no primeiro passo e falha no
 * segundo, que é exatamente o engano mais comum no compartilhamento.
 */
async function testarAcesso(calendarId) {
  const id = String(calendarId || '').trim();
  if (!id) return { ok: false, motivo: 'vazio', mensagem: 'Informe o ID da agenda.' };

  let nome = id;
  try {
    const { data } = await cliente().calendars.get({ calendarId: id });
    nome = data.summary || id;
  } catch (e) {
    const status = e.code || e.status;
    if (status === 404) {
      return {
        ok: false, motivo: 'nao_compartilhada',
        mensagem: 'Não encontrei esta agenda. Confira se o ID está certo e se ela foi '
          + 'compartilhada com a conta de serviço.',
      };
    }
    if (status === 403) {
      return {
        ok: false, motivo: 'sem_permissao',
        mensagem: 'O Google recusou o acesso a esta agenda. Refaça o compartilhamento '
          + 'com a conta de serviço.',
      };
    }
    return { ok: false, motivo: 'erro', mensagem: `Erro ao consultar o Google: ${e.message}` };
  }

  // agora o que interessa: dá para escrever?
  const inicio = new Date(Date.now() + 400 * 86400000);
  inicio.setUTCHours(6, 0, 0, 0);
  const fim = new Date(inicio.getTime() + 15 * 60000);

  let eventoId;
  try {
    const { data } = await cliente().events.insert({
      calendarId: id,
      sendUpdates: 'none',
      requestBody: {
        summary: 'Teste de conexão do site de agendamento (será apagado)',
        description: 'Evento criado pelo botão "Testar acesso" do painel. Pode apagar.',
        start: { dateTime: inicio.toISOString() },
        end: { dateTime: fim.toISOString() },
        transparency: 'transparent',      // não conta como ocupado
        status: 'tentative',
      },
    });
    eventoId = data.id;
  } catch (e) {
    const status = e.code || e.status;
    if (status === 403 || status === 401) {
      return {
        ok: false, motivo: 'permissao', nome,
        mensagem: `Enxergo a agenda "${nome}", mas não consigo criar consultas nela. `
          + 'No Google Agenda, mude o compartilhamento para "Fazer alterações nos eventos".',
      };
    }
    return { ok: false, motivo: 'erro', nome, mensagem: `Erro ao testar a escrita: ${e.message}` };
  }

  try {
    await cliente().events.delete({ calendarId: id, eventId: eventoId, sendUpdates: 'none' });
  } catch {
    return {
      ok: true, nome, papel: 'writer', limpezaFalhou: true,
      mensagem: `Conectado a "${nome}" e com permissão para marcar consultas. `
        + 'Só não consegui apagar o evento de teste — apague à mão na agenda.',
    };
  }

  return {
    ok: true, nome, papel: 'writer',
    mensagem: `Conectado a "${nome}". Permissão correta para marcar consultas.`,
  };
}

/** E-mail da conta de serviço, para o painel mostrar o que o médico deve autorizar. */
async function contaDeServico() {
  try {
    const auth = new google.auth.GoogleAuth({ ...credenciais(), scopes: ESCOPOS });
    const c = await auth.getClient();
    return c.email || (await auth.getCredentials()).client_email || null;
  } catch {
    return null;
  }
}

/**
 * Eventos de UMA agenda, para poder CONTAR quantas consultas há num horário.
 *
 * Por que não usar o freeBusy aqui: ele funde períodos sobrepostos num bloco
 * só. Duas consultas marcadas às 9h voltam como um único "ocupado das 9h às
 * 9h40", e não haveria como saber se ainda cabe alguém. Listar os eventos é a
 * única forma de contar.
 *
 * Evento de dia inteiro entra como bloqueio, não como consulta: é férias,
 * congresso, feriado — não um paciente.
 */
async function eventos(calendarId, inicioRFC, fimRFC, fuso) {
  const { data } = await cliente().events.list({
    calendarId,
    timeMin: inicioRFC,
    timeMax: fimRFC,
    timeZone: fuso,
    singleEvents: true,          // expande as recorrências
    showDeleted: false,
    orderBy: 'startTime',
    maxResults: 2500,
  });

  const consultas = [];
  const bloqueios = [];
  for (const e of data.items || []) {
    if (e.status === 'cancelled') continue;
    if (e.transparency === 'transparent') continue;      // marcado como "disponível"
    if (e.start?.date) {                                  // dia inteiro
      bloqueios.push({
        inicio: `${e.start.date}T00:00:00${OFFSET}`,
        fim: `${e.end.date}T00:00:00${OFFSET}`,
      });
      continue;
    }
    if (!e.start?.dateTime) continue;
    consultas.push({ inicio: e.start.dateTime, fim: e.end.dateTime, id: e.id });
  }
  return { consultas, bloqueios };
}

module.exports = {
  ocupados, eventos, criarPreAgendamento, buscarPorProtocolo, confirmar, liberar,
  pendentes, cliente, testarAcesso, contaDeServico,
};

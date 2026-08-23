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
 * Confere se a conta de serviço enxerga a agenda e com qual permissão.
 *
 * Usa calendarList.get em vez de tentar criar um evento de teste: compartilhar
 * uma agenda já a coloca na lista da conta de serviço, e a resposta traz o
 * accessRole exato. Assim o médico descobre que errou a permissão sem que nada
 * seja escrito na agenda dele.
 */
async function testarAcesso(calendarId) {
  const id = String(calendarId || '').trim();
  if (!id) return { ok: false, motivo: 'vazio', mensagem: 'Informe o ID da agenda.' };

  try {
    const { data } = await cliente().calendarList.get({ calendarId: id });
    const papel = data.accessRole;
    if (papel === 'owner' || papel === 'writer') {
      return {
        ok: true, papel, nome: data.summary,
        mensagem: `Conectado a "${data.summary}". Permissão correta para marcar consultas.`,
      };
    }
    return {
      ok: false, papel, nome: data.summary, motivo: 'permissao',
      mensagem: `A agenda "${data.summary}" foi compartilhada, mas só com permissão de leitura. ` +
        'No Google Agenda, mude para "Fazer alterações nos eventos".',
    };
  } catch (e) {
    const status = e.code || e.status;
    if (status === 404) {
      return {
        ok: false, motivo: 'nao_compartilhada',
        mensagem: 'Não encontrei esta agenda. Confira se o ID está certo e se ela foi ' +
          'compartilhada com a conta de serviço, com permissão de "Fazer alterações nos eventos".',
      };
    }
    if (status === 403) {
      return {
        ok: false, motivo: 'sem_permissao',
        mensagem: 'O Google recusou o acesso a esta agenda. Refaça o compartilhamento com a conta de serviço.',
      };
    }
    return { ok: false, motivo: 'erro', mensagem: `Erro ao consultar o Google: ${e.message}` };
  }
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

module.exports = { ocupados, criarPreAgendamento, buscarPorProtocolo, confirmar, liberar, pendentes, cliente, testarAcesso, contaDeServico };

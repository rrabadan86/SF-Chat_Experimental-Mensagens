/**
 * dados.js — a configuração que o médico edita pela tela, gravada em disco.
 *
 * Antes isto morava em config/hospitais.json + variáveis do .env, e mudar
 * qualquer coisa exigia programador. Agora o arquivo é escrito pelo painel:
 *
 *   dados/config.json   <- fonte da verdade, editável pela tela
 *   config/hospitais.json + .env  <- só a semente da primeira execução
 *
 * Escrita atômica (grava num temporário e renomeia) porque um agendamento pode
 * estar acontecendo no mesmo instante em que ele salva: renomear é operação
 * indivisível, então ninguém nunca lê um arquivo pela metade.
 */
const fs = require('fs');
const path = require('path');
const pagina = require('./pagina');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVO = process.env.DADOS_ARQUIVO || path.join(RAIZ, 'dados', 'config.json');

const DIAS_VALIDOS = [0, 1, 2, 3, 4, 5, 6];
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

let cache = null;
let cacheMtime = 0;

// ------------------------------------------------------------------ semente

/** Primeira execução: monta o config.json a partir do que existia no .env. */
function semente() {
  let base = [];
  try {
    base = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'hospitais.json'), 'utf8'));
  } catch { /* sem arquivo de exemplo, começa vazio */ }

  const hospitais = base.map((h) => ({
    ...migrarHospital(h),
    calendarId: process.env[`CAL_${h.id.toUpperCase()}`] || '',
    ativo: Boolean(process.env[`CAL_${h.id.toUpperCase()}`]),
  }));

  const inicial = {
    versao: 1,
    medico: {
      nome: process.env.MEDICO_NOME || '',
      crm: process.env.MEDICO_CRM || '',
      especialidade: process.env.MEDICO_ESPECIALIDADE || 'Oncologia Clínica',
    },
    recepcao: {
      nome: process.env.RECEPCAO_NOME || 'Recepção',
      whatsapp: (process.env.WA_RECEPCAO || '').replace(/\D/g, ''),
    },
    agendasDeBloqueio: (process.env.CAL_BLOQUEIOS || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    hospitais,
    pagina: pagina.padrao(),
    atualizadoEm: null,
  };
  // o WA_RECEPCAO do .env descreve um consultório com uma recepção só; cada
  // local começa com esse número e o médico ajusta os que forem diferentes
  inicial.hospitais = inicial.hospitais.map((h) => herdarRecepcao(h, inicial));
  return inicial;
}

// ------------------------------------------------------------- ler e gravar

/**
 * Antes, cada local tinha um horário só, válido para todos os dias marcados
 * (`dias`, `inicio`, `fim`). Não servia: médico atende segunda de manhã e
 * quinta à tarde. Agora são FAIXAS — cada uma com seus dias e seu horário —,
 * o que também cobre dia partido (manhã e tarde no mesmo dia).
 *
 * Esta função converte o formato antigo ao ler, então instalação existente
 * continua funcionando sem ninguém precisar recadastrar nada.
 */
/**
 * Desce o número antigo, único do consultório, para os locais que não têm o seu.
 *
 * Antes existia um "WhatsApp da recepção" geral, e o do local era opcional.
 * Virou por local, porque o médico atende em mais de um lugar e quem atende o
 * telefone é outra pessoa em cada um. Sem esta herança, quem já usava o campo
 * geral ficaria com os locais mudos na primeira atualização.
 */
function herdarRecepcao(h, config) {
  const geral = ((config.recepcao || {}).whatsapp || '').replace(/\D/g, '');
  if (h.whatsappRecepcao || !geral) return h;
  return { ...h, whatsappRecepcao: geral };
}

function migrarHospital(h) {
  if (Array.isArray(h.expediente) && h.expediente.length) {
    return h.vagasPorHorario ? h : { ...h, vagasPorHorario: 1 };
  }
  const { dias, inicio, fim, ...resto } = h;
  return {
    ...resto,
    vagasPorHorario: h.vagasPorHorario || 1,
    expediente: (dias && dias.length && inicio && fim)
      ? [{ dias: [...dias].sort(), inicio, fim }]
      : [],
  };
}

function ler() {
  try {
    const stat = fs.statSync(ARQUIVO);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const lido = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    lido.hospitais = (lido.hospitais || []).map(migrarHospital).map((h) => herdarRecepcao(h, lido));
    lido.pagina = completarPagina(lido.pagina);
    cache = lido;
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const inicial = semente();
    gravar(inicial);
    return inicial;
  }
}

function gravar(config) {
  config.atualizadoEm = new Date().toISOString();
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const temporario = `${ARQUIVO}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(temporario, ARQUIVO);      // troca atômica
  cache = config;
  cacheMtime = fs.statSync(ARQUIVO).mtimeMs;
  return config;
}

function alterar(fn) {
  const atual = JSON.parse(JSON.stringify(ler()));
  const novo = fn(atual) || atual;
  return gravar(novo);
}

/**
 * Garante que a configuração tem todos os campos da página.
 *
 * Preenche só o que falta, um nível abaixo da raiz: quem já editou um texto
 * mantém o texto; quem nunca viu um campo novo (porque atualizou o sistema)
 * recebe o padrão em vez de um buraco na tela.
 */
function completarPagina(atual) {
  const base = pagina.padrao();
  if (!atual || typeof atual !== 'object') return base;

  const completa = { ...base, ...atual };
  for (const chave of ['hero', 'destaque', 'sobre', 'locais', 'agendar', 'duvidas']) {
    completa[chave] = { ...base[chave], ...(atual[chave] || {}) };
  }
  // seções novas entram no fim da ordem em vez de sumirem da página
  const ordem = Array.isArray(atual.ordem) ? atual.ordem.filter((id) => base.ordem.includes(id)) : [];
  completa.ordem = [...ordem, ...base.ordem.filter((id) => !ordem.includes(id))];
  completa.ocultas = Array.isArray(atual.ocultas)
    ? atual.ocultas.filter((id) => base.ordem.includes(id))
    : [];
  return completa;
}

// ---------------------------------------------------------------- validação

const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Campo numérico opcional: em branco assume o padrão, mas um valor esquisito
 * (0, negativo, texto) segue adiante para a validação reclamar. Um `|| padrao`
 * aqui transformaria 0 em 60 caladamente, e o médico nunca saberia por que a
 * agenda não abriu como ele pediu.
 */
const numeroOu = (v, padrao) => (v === '' || v == null ? padrao : Number(v));

/** Valida o que veio da tela. Devolve o hospital já normalizado. */
const minutos = (s) => Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3));

const DIA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Normaliza a lista de faixas que veio da tela, descartando o que é lixo. */
function normalizarExpediente(bruto) {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((f) => ({
    dias: Array.isArray(f && f.dias)
      ? [...new Set(f.dias.map(Number))].filter((d) => DIAS_VALIDOS.includes(d)).sort()
      : [],
    inicio: texto(f && f.inicio, 5),
    fim: texto(f && f.fim, 5),
  }));
}

function validarHospital(bruto = {}, { existentes = [], id = null } = {}) {
  const erros = {};
  const h = {
    id: id || novoId(bruto.nome, existentes),
    nome: texto(bruto.nome, 80),
    calendarId: texto(bruto.calendarId, 200).toLowerCase(),
    endereco: texto(bruto.endereco, 200),
    telefone: texto(bruto.telefone, 40),
    // opcional: quando este local tem uma recepção própria, os avisos vão para
    // cá em vez do número geral
    whatsappRecepcao: texto(bruto.whatsappRecepcao, 20).replace(/\D/g, ''),
    expediente: normalizarExpediente(bruto.expediente),
    duracaoMin: Number(bruto.duracaoMin),
    intervaloMin: Number(bruto.intervaloMin || 0),
    // quantos pacientes o médico atende no mesmo horário; 1 é o normal
    vagasPorHorario: numeroOu(bruto.vagasPorHorario, 1),
    antecedenciaMinHoras: Number(bruto.antecedenciaMinHoras),
    janelaDias: numeroOu(bruto.janelaDias, 60),
    ativo: bruto.ativo !== false,
  };

  if (!h.nome) erros.nome = 'Dê um nome ao local de atendimento.';
  if (!h.calendarId) erros.calendarId = 'Cole o ID da agenda do Google.';
  else if (!h.calendarId.includes('@')) erros.calendarId = 'Não parece um ID de agenda — deve terminar em @group.calendar.google.com.';
  else if (existentes.some((o) => o.id !== h.id && o.calendarId === h.calendarId)) {
    erros.calendarId = 'Esta agenda já está sendo usada por outro local.';
  }

  if (!(h.duracaoMin >= 5 && h.duracaoMin <= 480)) erros.duracaoMin = 'Duração entre 5 e 480 minutos.';
  if (!(h.intervaloMin >= 0 && h.intervaloMin <= 240)) erros.intervaloMin = 'Intervalo entre 0 e 240 minutos.';
  if (!(h.vagasPorHorario >= 1 && h.vagasPorHorario <= 10)) {
    erros.vagasPorHorario = 'Entre 1 e 10 pacientes por horário.';
  }
  if (!(h.antecedenciaMinHoras >= 0 && h.antecedenciaMinHoras <= 720)) {
    erros.antecedenciaMinHoras = 'Antecedência entre 0 e 720 horas.';
  }
  if (!(h.janelaDias >= 1 && h.janelaDias <= 365)) erros.janelaDias = 'Janela entre 1 e 365 dias.';
  // Cada local avisa a sua própria recepção: em hospital diferente é outra
  // pessoa que atende o telefone. Sem número aqui, o pedido feito para este
  // local não teria para onde ir.
  if (!h.whatsappRecepcao) {
    erros.whatsappRecepcao = 'Informe o WhatsApp que recebe os pedidos deste local.';
  } else if (!/^55\d{10,11}$/.test(h.whatsappRecepcao)) {
    erros.whatsappRecepcao = 'Use 55 + DDD + número, só dígitos. Ex.: 5562991234567';
  }

  Object.assign(erros, validarFaixas(h.expediente, h.duracaoMin));

  return { ok: Object.keys(erros).length === 0, erros, hospital: h };
}

/**
 * Erros das faixas vêm indexados (`expediente.0.fim`) para a tela conseguir
 * apontar exatamente a linha errada, e `expediente` para o que vale no conjunto.
 */
function validarFaixas(expediente, duracaoMin) {
  const erros = {};
  if (!expediente.length) {
    erros.expediente = 'Adicione pelo menos uma faixa de atendimento.';
    return erros;
  }

  // por dia da semana, para achar faixas que se sobrepõem
  const porDia = new Map();

  expediente.forEach((f, i) => {
    if (!f.dias.length) erros[`expediente.${i}.dias`] = 'Escolha os dias desta faixa.';
    if (!HORA.test(f.inicio)) erros[`expediente.${i}.inicio`] = 'Horário inválido.';
    if (!HORA.test(f.fim)) erros[`expediente.${i}.fim`] = 'Horário inválido.';

    if (HORA.test(f.inicio) && HORA.test(f.fim)) {
      if (minutos(f.fim) <= minutos(f.inicio)) {
        erros[`expediente.${i}.fim`] = 'O fim tem que ser depois do início.';
      } else if (duracaoMin >= 5 && minutos(f.fim) - minutos(f.inicio) < duracaoMin) {
        erros[`expediente.${i}.fim`] =
          `Não cabe uma consulta de ${duracaoMin} min nesta faixa.`;
      } else {
        for (const dia of f.dias) {
          const anteriores = porDia.get(dia) || [];
          const choca = anteriores.find(
            (a) => minutos(f.inicio) < minutos(a.fim) && minutos(a.inicio) < minutos(f.fim)
          );
          if (choca) {
            erros[`expediente.${i}.inicio`] =
              `Esta faixa se sobrepõe a outra na ${DIA_NOME[dia]} (${choca.inicio}–${choca.fim}).`;
          }
          anteriores.push(f);
          porDia.set(dia, anteriores);
        }
      }
    }
  });

  return erros;
}

/** União dos dias de todas as faixas — usado para varrer o calendário. */
function diasAtendidos(hospital) {
  const dias = new Set();
  for (const f of hospital.expediente || []) for (const d of f.dias) dias.add(d);
  return [...dias].sort();
}

function novoId(nome, existentes) {
  const base = texto(nome, 30).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'local';
  const usados = new Set(existentes.map((h) => h.id));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base}-${i}`)) return `${base}-${i}`;
}

function validarGerais(bruto = {}) {
  const erros = {};
  const dados = {
    medico: {
      nome: texto(bruto.medico?.nome, 80),
      crm: texto(bruto.medico?.crm, 40),
      especialidade: texto(bruto.medico?.especialidade, 60),
    },
    // `whatsapp` não entra mais aqui: quem recebe os pedidos é a recepção de
    // cada local, não um número único do consultório
    recepcao: {
      nome: texto(bruto.recepcao?.nome, 60) || 'Recepção',
    },
    agendasDeBloqueio: (Array.isArray(bruto.agendasDeBloqueio) ? bruto.agendasDeBloqueio : [])
      .map((s) => texto(s, 200).toLowerCase()).filter(Boolean),
  };

  if (!dados.medico.nome) erros['medico.nome'] = 'Informe o nome do médico.';

  return { ok: Object.keys(erros).length === 0, erros, dados };
}

/**
 * Valida o conteúdo da página vindo do editor.
 *
 * Aqui a régua é diferente da dos horários: texto ruim deixa a página feia,
 * não quebra agendamento. Então cortamos o que passa do limite em vez de
 * recusar, e só barramos o que deixaria a página sem sentido — título vazio,
 * nenhuma seção visível.
 */
function validarPagina(bruto = {}) {
  const base = pagina.padrao();
  const erros = {};
  const lista = (v) => (Array.isArray(v) ? v : []);

  const p = {
    hero: {
      eyebrow: texto(bruto.hero?.eyebrow, 60),
      titulo: texto(bruto.hero?.titulo, 140),
      lede: texto(bruto.hero?.lede, 600),
      botaoPrimario: texto(bruto.hero?.botaoPrimario, 30) || base.hero.botaoPrimario,
      botaoSecundario: texto(bruto.hero?.botaoSecundario, 30),
      credenciais: lista(bruto.hero?.credenciais).map((c) => texto(c, 80)).filter(Boolean).slice(0, 6),
      destaques: lista(bruto.hero?.destaques).map((d) => ({
        valor: texto(d?.valor, 20), rotulo: texto(d?.rotulo, 60),
      })).filter((d) => d.valor && d.rotulo).slice(0, 4),
      foto: texto(bruto.hero?.foto, 500),
    },
    destaque: {
      frase: texto(bruto.destaque?.frase, 300),
      autoria: texto(bruto.destaque?.autoria, 80),
    },
    sobre: {
      eyebrow: texto(bruto.sobre?.eyebrow, 60),
      titulo: texto(bruto.sobre?.titulo, 140),
      paragrafos: lista(bruto.sobre?.paragrafos).map((t) => texto(t, 1200)).filter(Boolean).slice(0, 8),
      tituloAreas: texto(bruto.sobre?.tituloAreas, 60),
      areas: lista(bruto.sobre?.areas).map((a) => ({
        nome: texto(a?.nome, 50), destaque: Boolean(a?.destaque),
      })).filter((a) => a.nome).slice(0, 20),
      tituloFormacao: texto(bruto.sobre?.tituloFormacao, 60),
      formacao: lista(bruto.sobre?.formacao).map((f) => ({
        ano: texto(f?.ano, 12), titulo: texto(f?.titulo, 100), detalhe: texto(f?.detalhe, 100),
      })).filter((f) => f.titulo).slice(0, 15),
    },
    locais: {
      eyebrow: texto(bruto.locais?.eyebrow, 60),
      titulo: texto(bruto.locais?.titulo, 140),
      descricao: texto(bruto.locais?.descricao, 600),
    },
    agendar: {
      eyebrow: texto(bruto.agendar?.eyebrow, 60),
      titulo: texto(bruto.agendar?.titulo, 140),
      descricao: texto(bruto.agendar?.descricao, 600),
      avisoUrgencia: texto(bruto.agendar?.avisoUrgencia, 300) || base.agendar.avisoUrgencia,
      preparo: lista(bruto.agendar?.preparo).map((t) => texto(t, 200)).filter(Boolean).slice(0, 10),
    },
    duvidas: {
      eyebrow: texto(bruto.duvidas?.eyebrow, 60),
      titulo: texto(bruto.duvidas?.titulo, 140),
      itens: lista(bruto.duvidas?.itens).map((d) => ({
        pergunta: texto(d?.pergunta, 200), resposta: texto(d?.resposta, 1200),
      })).filter((d) => d.pergunta && d.resposta).slice(0, 20),
    },
    rodape: lista(bruto.rodape).map((t) => texto(t, 300)).filter(Boolean).slice(0, 6),
    ordem: lista(bruto.ordem).filter((id) => base.ordem.includes(id)),
    ocultas: lista(bruto.ocultas).filter((id) => base.ordem.includes(id)),
  };

  // seção que sumiu da lista volta para o fim, em vez de desaparecer calada
  p.ordem = [...new Set([...p.ordem, ...base.ordem])];

  if (!p.hero.titulo) erros['hero.titulo'] = 'A página precisa de um título.';
  if (p.ordem.every((id) => p.ocultas.includes(id))) {
    erros.ocultas = 'Deixe pelo menos uma seção visível.';
  }
  if (p.ocultas.includes('agendar')) {
    erros.ocultas = 'A seção de agendamento não pode ser ocultada — é o que o paciente vem fazer aqui.';
  }

  return { ok: Object.keys(erros).length === 0, erros, pagina: p };
}

module.exports = {
  ler, gravar, alterar, validarHospital, validarGerais, validarPagina, novoId,
  ARQUIVO, semente, migrarHospital, herdarRecepcao, normalizarExpediente, diasAtendidos,
  validarFaixas, completarPagina, DIA_NOME,
};

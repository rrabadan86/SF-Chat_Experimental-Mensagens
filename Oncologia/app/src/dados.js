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

  return {
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
    atualizadoEm: null,
  };
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
    lido.hospitais = (lido.hospitais || []).map(migrarHospital);
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
    recepcao: {
      nome: texto(bruto.recepcao?.nome, 60) || 'Recepção',
      whatsapp: texto(bruto.recepcao?.whatsapp, 20).replace(/\D/g, ''),
    },
    agendasDeBloqueio: (Array.isArray(bruto.agendasDeBloqueio) ? bruto.agendasDeBloqueio : [])
      .map((s) => texto(s, 200).toLowerCase()).filter(Boolean),
  };

  if (!dados.medico.nome) erros['medico.nome'] = 'Informe o nome do médico.';
  const zap = dados.recepcao.whatsapp;
  if (!zap) erros['recepcao.whatsapp'] = 'Sem este número ninguém recebe os pedidos de agendamento.';
  else if (!/^55\d{10,11}$/.test(zap)) {
    erros['recepcao.whatsapp'] = 'Use o formato 55 + DDD + número, só dígitos. Ex.: 5562991234567';
  }

  return { ok: Object.keys(erros).length === 0, erros, dados };
}

module.exports = {
  ler, gravar, alterar, validarHospital, validarGerais, novoId, ARQUIVO, semente,
  migrarHospital, normalizarExpediente, diasAtendidos, validarFaixas, DIA_NOME,
};

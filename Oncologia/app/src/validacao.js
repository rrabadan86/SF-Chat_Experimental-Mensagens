/**
 * validacao.js — o que chega do navegador não é confiável.
 *
 * Função pura: entra o corpo cru do POST, sai { ok, erros, dados } com tudo já
 * normalizado. O servidor nunca usa o objeto original.
 */
const OBRIGATORIOS = {
  hospital: 'Escolha o hospital.',
  data: 'Escolha o dia.',
  hora: 'Escolha o horário.',
  nome: 'Informe o nome completo do paciente.',
  nascimento: 'Informe a data de nascimento.',
  telefone: 'Informe um WhatsApp com DDD.',
  tipo: 'Informe o tipo de consulta.',
  pagamento: 'Informe convênio ou particular.',
};

const TIPOS = ['Primeira consulta', 'Retorno', 'Segunda opinião', 'Avaliação pré-tratamento'];
const LIMITES = { nome: 120, pagamento: 60, carteirinha: 40, motivo: 1000, encaminhamento: 120 };

const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** (62) 99123-4567 -> 5562991234567 */
function normalizarTelefone(bruto) {
  let d = String(bruto || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return `55${d}`;
}

function validar(corpo = {}) {
  const erros = {};
  const dados = {
    hospital: texto(corpo.hospital, 10),
    data: texto(corpo.data, 10),
    hora: texto(corpo.hora, 5),
    nome: texto(corpo.nome, LIMITES.nome),
    nascimento: texto(corpo.nascimento, 10),
    telefone: normalizarTelefone(corpo.telefone),
    tipo: texto(corpo.tipo, 40),
    pagamento: texto(corpo.pagamento, LIMITES.pagamento),
    carteirinha: texto(corpo.carteirinha, LIMITES.carteirinha),
    motivo: texto(corpo.motivo, LIMITES.motivo),
    encaminhamento: texto(corpo.encaminhamento, LIMITES.encaminhamento),
    consentimento: corpo.consentimento === true || corpo.consentimento === 'true',
  };

  for (const [campo, mensagem] of Object.entries(OBRIGATORIOS)) {
    if (!dados[campo]) erros[campo] = mensagem;
  }

  if (dados.data && !/^\d{4}-\d{2}-\d{2}$/.test(dados.data)) erros.data = 'Data inválida.';
  if (dados.hora && !/^\d{2}:\d{2}$/.test(dados.hora)) erros.hora = 'Horário inválido.';
  if (dados.nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dados.nascimento)) {
    erros.nascimento = 'Data de nascimento inválida.';
  }
  if (dados.nome && !dados.nome.includes(' ')) erros.nome = 'Informe o nome completo.';
  if (dados.tipo && !TIPOS.includes(dados.tipo)) erros.tipo = 'Tipo de consulta inválido.';
  if (!dados.consentimento) {
    erros.consentimento = 'É preciso autorizar o uso dos dados para agendar.';
  }

  return { ok: Object.keys(erros).length === 0, erros, dados };
}

module.exports = { validar, normalizarTelefone, TIPOS };

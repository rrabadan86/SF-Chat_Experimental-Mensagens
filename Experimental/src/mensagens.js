/**
 * Cofre central de mensagens editáveis.
 *
 * Os textos "principais" que o robô envia (confirmações, follow-up, faltas,
 * renovação, aniversário, Instagram, Circuito) ficam aqui como PADRÃO. As
 * edições feitas no painel são gravadas em data/mensagens.json e têm
 * prioridade sobre o padrão.
 *
 * Cada texto usa marcadores no formato {nome}, {horario}, {professora}...
 * que são trocados pelos valores reais na hora do envio (render).
 *
 * Como o JSON é lido a cada render(), uma edição no painel vale já no
 * próximo envio — sem precisar reiniciar o robô.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'mensagens.json');
// Foto opcional por mensagem (uma por chave). Só as mensagens com foto:true no
// catálogo aceitam. O nome do arquivo é a própria chave (validada) — sem risco
// de path traversal.
const FOTOS_DIR = path.resolve(__dirname, '..', 'data', 'mensagens-fotos');

// Catálogo: ordem, título, descrição e variáveis de cada mensagem. Também
// alimenta o painel de edição. NÃO mude as chaves (o código depende delas).
const CATALOGO = [
  {
    chave: 'confirmacao_hoje',
    titulo: 'Confirmação — aula de hoje',
    quando: 'Enviada às 08:30 (seg–sáb) para quem tem experimental hoje.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário da aula'], ['professora', 'professora da aula (quando o EVO informa)'], ['data', 'data da aula (dd/mm/aaaa)']],
    padrao: 'Olá, {nome}! 😊\n\nTudo bem? Aqui é do {studio}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental de logo mais que está agendada para hoje às {horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪',
  },
  {
    chave: 'confirmacao_amanha',
    titulo: 'Confirmação — aula de amanhã',
    quando: 'Enviada às 15:30 (dom–sex) para quem tem experimental amanhã.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário da aula'], ['professora', 'professora da aula (quando o EVO informa)'], ['data', 'data da aula (dd/mm/aaaa)']],
    padrao: 'Olá, {nome}! 😊\n\nTudo bem? Aqui é do {studio}!\n\nEstamos mandando essa mensagem para confirmar a sua aula experimental que está agendada para amanhã às {horario}.\n\nPode confirmar sua presença? Estamos te esperando! 💪',
  },
  {
    chave: 'confirmacao_experimental',
    titulo: 'Confirmação — aula experimental (agendada pelo site/Sofia)',
    quando: 'Enviada logo após a lead agendar pelo formulário ou pela Sofia. Só é usada aqui se você EDITAR este texto; sem edição, vale o texto padrão do sistema.',
    vars: [['nome', 'primeiro nome da lead'], ['quando', 'dia e hora amigável, ex.: sexta-feira, 28/08 às 16:15']],
    padrao: 'Oie, {nome}! 🎉 Tudo bem? Me chamo Juliana e sou do *Studio Slim Fit* do Setor Bueno.\n\nEstou mandando essa mensagem para informar que a sua aula experimental está confirmada para *{quando}*.\nQualquer dúvida que tiver, ou precisar remarcar a sua aula, pode me chamar por aqui.❤️\n\n*Endereço:* R. C-235, 846, Setor Bueno, Goiânia-GO, 74280-130.\n*Localização:* https://goo.gl/maps/LFBZhkzbCZ5wJ99f6\n\nSe possível, tente chegar 10 minutos antes para você conhecer o Studio e conversarmos! 💪\nMuito bem vinda ao #SlimFit - A Revolução do Treinamento Feminino! ❤️',
  },
  {
    chave: 'followup',
    titulo: 'Follow-up pós-aula (ainda não fechou)',
    quando: 'Enviada 10:30 / 16:00 para quem fez a experimental no dia anterior.',
    vars: [['professora', 'nome da professora']],
    padrao: 'Oie! Tudo bem?\n\nSegue áudio que a professora {professora} fez sobre a sua aula experimental! =)\n\nSei que a primeira aula sempre é mais difícil, principalmente por ser uma metodologia nova!\n\nMas agora que você já deu o primeiro passo 👏, o que acha de vir para mais uma aula e darmos andamento da sua matrícula?\n\nTe aguardo!!! 🥰',
  },
  {
    chave: 'followup_aluna',
    titulo: 'Follow-up pós-aula (já virou aluna)',
    quando: 'Mesmo horário do follow-up, mas para quem já fechou contrato.',
    vars: [['professora', 'nome da professora']],
    padrao: 'Oie! Tudo bem?\n\nQue alegria ter você com a gente! 🥰\n\nSegue um áudio que a professora {professora} preparou sobre a sua aula!\n\nSeja muito bem-vinda ao SlimFit! 💪\n\nEstamos muito felizes com a sua decisão. Qualquer dúvida que tiver sobre o APP pode me acionar!\n\nConte conosco! ❤️',
  },
  {
    chave: 'no_show',
    titulo: 'Faltou (no-show) — convite para remarcar',
    quando: 'Enviada 11:30 / 19:30 para quem faltou à experimental.',
    vars: [['nome', 'primeiro nome da lead'], ['horario', 'horário entre parênteses, ex.: " (09:00)" — pode ficar vazio']],
    padrao: 'Oi, {nome}! 😊 Tudo bem?\n\nNotamos que você não conseguiu comparecer à sua aula experimental de hoje{horario}. Acontece! 💛\n\nQue tal remarcar? Vai ser um prazer te receber. É só me responder por aqui que a gente encontra um novo horário pra você! 🙌',
  },
  {
    chave: 'renovacao',
    titulo: 'Renovação de contrato',
    quando: 'Enviada às 14:30 para quem vence em exatos 7 dias.',
    vars: [['nome', 'primeiro nome da aluna'], ['data', 'data de vencimento']],
    padrao: 'Oi, {nome}! Tudo bem? 😊\nQue alegria ter você no SlimFit! 🥳\nEstou enviando essa mensagem para avisar que o seu plano vence no dia {data}. A gente ia adorar continuar com você firme nos treinos! ❤️\nPodemos dar andamento na renovação? Prefere manter o mesmo plano ou aumentar a frequência? 💪\nQualquer dúvida, é só me chamar! 😉',
  },
  {
    chave: 'aniversario',
    foto: true,
    titulo: 'Aniversário (nos grupos)',
    quando: 'Enviada às 08:00. A aniversariante é @marcada onde está {aluna}.',
    vars: [['aluna', 'a @menção da aniversariante — mantenha o {aluna} no texto']],
    padrao: 'Hoje é aniversário da {aluna}! 🥳🎉\n\nMuitas felicidades, saúde e sucesso!!! Que este novo ciclo venha repleto de conquistas e alegria!! Aproveite o seu dia! ❤️',
  },
  {
    chave: 'instagram',
    titulo: 'Boas-vindas no Instagram (DM)',
    quando: 'Enviada às 07:00 para novas seguidoras (em teste).',
    vars: [],
    padrao: 'Seja muito bem vinda ao SlimFit, a Revolução do Treinamento Feminino! ❤️\n\nEstou te presenteando com uma aula experimental gratuita para conhecer a nossa metodologia e o nosso studio! Faça o agendamento através deste link: https://sf-formularioexperimental.onrender.com/\n\nNos links abaixo eu explico sobre a nossa metodologia:\n-> O que é o SlimFit: https://www.instagram.com/reel/Crluss-AWPu/\n\n-> Personal X SlimFit: https://www.instagram.com/p/CwkvRzggYrs/\n\nAté mais!',
  },
  {
    chave: 'circuito_convocacao',
    foto: true,
    titulo: 'Circuito — convocatória (quarta)',
    quando: 'Enviada quarta 16:15 no grupo do Circuito. A professora é @marcada onde está {professora}.',
    vars: [['professora', 'a @menção da professora — mantenha o {professora} no texto'], ['hora', 'horário da aula de sábado, ex.: 09h45']],
    padrao: '🔥 SÁBADO É DIA DE QUEIMAR CALORIAS NO CIRCUITO! 🔥\n⚡️Comandada pela professora {professora}.\n\nCheckin Aberto!!!\n\n⏰ Sábado às {hora}',
  },
  {
    chave: 'circuito_lembrete',
    foto: true,
    titulo: 'Circuito — lembrete (sexta)',
    quando: 'Enviada sexta 16:15 no grupo do Circuito.',
    vars: [['hora', 'horário da aula de sábado, ex.: 09h45']],
    padrao: '🔥 *É AMANHÃ!* 🔥\n⚡️ Estamos esperando todas vocês!\n\n⏰ Sábado às {hora}',
  },
];

const PADROES = Object.fromEntries(CATALOGO.map(m => [m.chave, m.padrao]));

// ── Leitura/escrita do arquivo de edições ──────────────────────────────────
function carregarOverrides() {
  try {
    const raw = fs.readFileSync(ARQUIVO, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) {
    return {}; // sem arquivo (ou inválido) → usa só os padrões
  }
}

function salvarOverride(chave, texto) {
  if (!PADROES.hasOwnProperty(chave)) throw new Error('Mensagem desconhecida: ' + chave);
  const dir = path.dirname(ARQUIVO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const atual = carregarOverrides();
  const t = normalizar(texto);
  if (t.trim() === '' || t === PADROES[chave]) {
    delete atual[chave]; // vazio ou igual ao padrão → volta ao padrão
  } else {
    atual[chave] = t;
  }
  fs.writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2), 'utf8');
  return atual[chave] || PADROES[chave];
}

// Normaliza quebras de linha: navegadores enviam \r\n em formulários; o \r
// solto pode virar caractere estranho no WhatsApp. Guardamos/enviamos só \n.
function normalizar(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n');
}

// Texto atual de uma chave (edição do painel, ou o padrão). Aplica a
// normalização de quebras de linha mesmo em edições antigas já salvas com \r\n.
function texto(chave) {
  const ov = carregarOverrides();
  return (ov[chave] != null && String(ov[chave]).trim() !== '') ? normalizar(ov[chave]) : PADROES[chave];
}

// Substitui {marcadores} pelos valores. As variáveis GLOBAIS (studio, saudacao,
// hoje, dia_semana) são resolvidas sozinhas; o que o job passar tem prioridade.
function render(chave, vars = {}) {
  let t = texto(chave);
  if (t == null) return '';
  const todos = Object.assign(globais(), vars);
  for (const [k, v] of Object.entries(todos)) {
    t = t.split('{' + k + '}').join(v == null ? '' : String(v));
  }
  return t;
}

// Variáveis GLOBAIS: valem em QUALQUER mensagem, preenchidas automaticamente na
// hora do envio a partir do relógio/ambiente (não dependem do job). Se um job
// passar o mesmo nome com um valor específico, o valor do job tem prioridade.
function globais() {
  const agora = new Date();
  const opt = { timeZone: 'America/Sao_Paulo' };
  const h = parseInt(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }), 10);
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return {
    studio: process.env.STUDIO_NOME || 'Studio Slimfit Setor Bueno',
    saudacao,
    hoje: agora.toLocaleDateString('pt-BR', opt),
    dia_semana: agora.toLocaleDateString('pt-BR', Object.assign({ weekday: 'long' }, opt)),
  };
}
// Tags globais, para o painel listar como clicáveis em toda mensagem.
const GLOBAIS_TAGS = [
  ['saudacao', 'Bom dia / Boa tarde / Boa noite (conforme a hora)'],
  ['studio', 'nome do Studio'],
  ['hoje', 'data de hoje (ex.: 24/08/2026)'],
  ['dia_semana', 'dia da semana (ex.: segunda-feira)'],
];

// Valores de EXEMPLO para pré-visualizar/testar uma mensagem (o que a aluna
// veria). Usados no painel (pré-visualização) e no envio de teste.
const EXEMPLOS = {
  nome: 'Maria',
  horario: '09:00',
  professora: 'Tay',
  data: '30/08/2026',
  aluna: 'Maria',
  hora: '09h45',
  quando: 'sexta-feira, 28/08 às 16:15',
};
function exemplosCompletos() {
  return Object.assign(globais(), EXEMPLOS);
}
// Substitui {marcadores} num TEXTO qualquer (não só numa chave do catálogo).
// Usado pelo envio de teste, que manda o texto que está na tela.
function renderTexto(texto, vars = {}) {
  let t = normalizar(texto);
  const todos = Object.assign(globais(), EXEMPLOS, vars);
  for (const [k, v] of Object.entries(todos)) {
    t = t.split('{' + k + '}').join(v == null ? '' : String(v));
  }
  return t;
}

// Para mensagens com @menção nativa: renderiza tudo, menos o marcador da
// menção, e devolve { antes, depois } quebrado nesse ponto.
function partes(chave, vars, tokenMencao) {
  const t = render(chave, vars); // tokenMencao fica como {token} (não passado em vars)
  const marca = '{' + tokenMencao + '}';
  const i = t.indexOf(marca);
  if (i < 0) return { antes: t, depois: '' };
  return { antes: t.slice(0, i), depois: t.slice(i + marca.length) };
}

// ── Foto opcional por mensagem (grupo/broadcast: Circuito, Aniversário) ──────
function fotoPath(chave) {
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(FOTOS_DIR, chave + '.' + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function fotoNome(chave) { const p = fotoPath(chave); return p ? path.basename(p) : null; }
function removerFoto(chave) {
  for (const ext of ['jpg', 'png', 'webp']) {
    const p = path.join(FOTOS_DIR, chave + '.' + ext);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
}
// Todas as mensagens de WhatsApp aceitam foto (flyer). Exceção: 'instagram' é DM
// do Instagram (canal diferente, tratado na aba Instagram), então não entra aqui.
function aceitaFoto(chave) { const m = CATALOGO.find(x => x.chave === chave); return !!(m && m.chave !== 'instagram'); }
function salvarFoto(chave, dataUrl) {
  if (!aceitaFoto(chave)) throw new Error('Esta mensagem não aceita foto.');
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Imagem inválida (envie PNG, JPG ou WEBP).');
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('Imagem muito grande (máx. ~6 MB).');
  removerFoto(chave); // troca a anterior (qualquer extensão)
  if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
  fs.writeFileSync(path.join(FOTOS_DIR, chave + '.' + ext), buf);
  return chave + '.' + ext;
}

// Para o painel: lista com título, descrição, variáveis, texto atual, padrão
// e se está editado.
function listar() {
  const ov = carregarOverrides();
  return CATALOGO.map(m => ({
    chave: m.chave,
    titulo: m.titulo,
    quando: m.quando,
    // vars do job + globais (sem duplicar as que o job já lista).
    vars: [...(m.vars || []), ...GLOBAIS_TAGS.filter(g => !(m.vars || []).some(v => v[0] === g[0]))],
    padrao: m.padrao,
    texto: (ov[m.chave] != null && String(ov[m.chave]).trim() !== '') ? ov[m.chave] : m.padrao,
    editado: ov[m.chave] != null && String(ov[m.chave]).trim() !== '' && ov[m.chave] !== m.padrao,
    aceitaFoto: aceitaFoto(m.chave),
    fotoNome: aceitaFoto(m.chave) ? fotoNome(m.chave) : null,
  }));
}

module.exports = {
  render, renderTexto, partes, texto, salvarOverride, listar, carregarOverrides,
  fotoPath, fotoNome, salvarFoto, removerFoto, aceitaFoto, FOTOS_DIR,
  CATALOGO, PADROES, EXEMPLOS, exemplosCompletos, ARQUIVO,
};

/**
 * painel-visao-cliente.js — "📱 Visão do cliente" (WhatsApp → Visão do cliente).
 *
 * Mostra, num celular simulado, TODAS as mensagens automáticas que o sistema manda
 * pelo WhatsApp: para a aluna/lead (cada jornada) e para a equipe e os grupos
 * (resumos do dia, da semana e do mês, listas e avisos). Usa os TEXTOS CONFIGURADOS
 * no painel (mensagens.js) e as mesmas funções que montam os resumos de verdade,
 * com dados de exemplo — mudou o texto ou o formato, muda aqui. Só leitura: não envia nada.
 * Mensagem nova no catálogo precisa entrar numa jornada (visao-cliente.test.js confere).
 */
const mensagens = require('./mensagens');
const { esc, chrome, uiTopo } = require('./painel-base');

const EX = { nome: 'Mariana', aluna: 'Mariana', professora: 'Bia', horario: '09:30', hora: '09h30', quando: 'quinta-feira, às 09:30', data: '19/11', plano: 'SLIM 3X MENSAL', valor: 'R$ 289,00', vencimento: '16/11' };
// Ajustes por mensagem (formato que o robô usa de verdade naquele envio).
const EX_POR = {
  no_show: { horario: ' (09:30)' },
  sentimos_falta_1: { dias: '14' },
  sentimos_falta_2: { dias: '28' },
  ausentes: { dias: '10', lista: '* Carla Mendes - 05/11\n* Sofia Ramos - 07/11' },
  aniversariantes_mes: { mes: 'Dezembro', lista: '📅 03/12 — Bruna Teles\n📅 18/12 — Luciana Prado' },
  renovacoes_mes: { mes: 'Dezembro', lista: '📅 05/12 — Carla Mendes\n📅 15/12 — Juliana Rocha' },
};
// De onde sai cada mensagem (cabeçalho do celular).
const DE = {
  studio: { nome: 'SlimFit Studio · Recepção', ini: 'SF', sub: 'online' },
  sofia: { nome: 'SoFIA · SlimFit Studio', ini: '🤖', sub: 'online' },
  equipe: { nome: 'Equipe SlimFit', ini: '👥', sub: 'grupo da equipe · robô do Studio', grupo: true },
  alunas: { nome: 'Alunas SlimFit', ini: '💪', sub: 'grupo das alunas · robô do Studio', grupo: true },
  voce: { nome: 'SlimFit Studio · Robô', ini: 'SF', sub: 'relatório para o número escolhido no painel' },
};

// ── Mensagens montadas no código (não estão no catálogo): mesmas funções do envio,
// com dados de exemplo. Cada uma devolve texto (ou { html, legenda } para imagem).
const studioNome = () => { try { return require('./config').STUDIO_NOME || 'SlimFit Studio'; } catch (_) { return 'SlimFit Studio'; } };
const SEMANA = {
  de: '2026-11-13', ate: '2026-11-19', rotulo: '13/11 a 19/11',
  ag: { total: 14, sofia: 9, formulario: 3, express: 2 },
  exp: { exp: 11, veio: 9, faltou: 2, fechou: 4 },
  profs: [{ nome: 'Bia Souza', exp: 5, veio: 4, fechou: 2 }, { nome: 'Carol Dias', exp: 6, veio: 5, fechou: 2 }],
  ativas: { fim: 186, ini: 182, entraram: 7, novas: 5, sairam: 3 },
  pendentes: [{ nome: 'Patrícia Lima', dia: '2026-11-18', prof: 'Bia Souza' }, { nome: 'Renata Alves', dia: '2026-11-19', prof: 'Carol Dias' }],
  historico: [[3, 1], [5, 2], [4, 2], [6, 3], [5, 1], [7, 3], [6, 2], [9, 4]].map(([veio, fechou], i) => ({ rot: ['02/10', '09/10', '16/10', '23/10', '30/10', '06/11', '13/11', '19/11'][i], ag: veio + 3, veio, fechou })),
};
const MES = {
  k: '2026-10', nome: 'outubro/2026', nomeCurto: 'out/26', ativas: 186, inicio: 180, trancadas: 6,
  entraram: 14, novas: 10, voltaram: 4, sairam: 8, taxaSaida: 4.4,
  ant: { nome: 'setembro/2026', fim: 180 }, ano: { nome: 'outubro/2025', fim: 161 }, incompleto: false,
  saidas: [{ nome: 'Ana Beatriz Lopes', ultimo: '2026-10-12' }, { nome: 'Camila Freitas', ultimo: '2026-10-20' }, { nome: 'Débora Nunes', ultimo: '2026-10-28' }],
  exp: { exp: 38, veio: 31, faltou: 7, fechou: 12 },
  ultimos: [150, 154, 158, 161, 165, 167, 170, 172, 175, 178, 180, 186].map((v, i) => ({ k: '', rot: ['nov/25', 'dez/25', 'jan/26', 'fev/26', 'mar/26', 'abr/26', 'mai/26', 'jun/26', 'jul/26', 'ago/26', 'set/26', 'out/26'][i], v })),
  ignorados: ['circuito', 'vip'],
};
const GERADO = {
  resumo_dia: () => require('./resumo-dia').montarMensagem({
    reposicoes: [{ name: 'Carla Mendes', time: '07:00', status: 'Reposição' }],
    fizeram: [{ name: 'Juliana Rocha', time: '09:30' }, { name: 'Patrícia Lima', time: '18:00' }],
    faltaram: [{ name: 'Renata Alves', time: '19:00' }],
    fecharam: [{ name: 'Juliana Rocha', contrato: 'SLIM 3X QUADRIMESTRAL' }],
    rescisoes: [],
    amanha: [{ name: 'Fernanda Costa', time: '08:00', ficha: { objetivo: 'perder 5 kg até o verão', restricao: 'dor no joelho direito' } }, { name: 'Luana Martins', time: '18:30' }],
    amanhaData: '20/11/2026',
    trancadas: [{ name: 'Luciana Prado', fim: '05/12/2026' }],
  }, '19/11/2026'),
  resumo_semana: () => { const rs = require('./resumo-semanal'); return { html: rs.imagemHtml(SEMANA, studioNome()), legenda: rs.texto(SEMANA) }; },
  resumo_mes: () => { const rm = require('./resumo-mensal'); return { html: rm.imagemHtml(MES, studioNome()), legenda: rm.texto(MES) }; },
  presentes: () => require('./presentes-pendentes-grupo').montarMensagem({ '1 ano': ['Carla Mendes', 'Sofia Ramos'], '2 anos': ['Luciana Prado'] }, ['Bruna Teles']),
  bloqueio_app: () => require('./bloqueio-app').textoGrupo({ dias: 11, bloqueadas: [{ nome: 'MARIA CLARA SOUZA', dias: 14, tipo: 'boleto' }], reativadas: [{ nome: 'ANA LUIZA COSTA', motivo: 'pagou', avisou: true }] }, [], false),
  free_antecedencia: () => require('./free-antecedencia').montarMensagem({ itens: [{ data: '2026-11-20', hora: '07:00', nome: 'Aline Torres', plano: 'FREE 2X MENSAL', desmarcada: true }] }),
  presenca: () => require('./comparecimento').textoRelatorio({
    compareceu: [{ nome: 'Juliana Rocha', data: '18/11' }, { nome: 'Patrícia Lima', data: '18/11' }],
    faltou: [{ nome: 'Renata Alves', data: '19/11' }], semTag: [], remarcadas: [], novos: [],
  }, { diasJanela: 7 }),
};
const ROT_GERADO = {
  resumo_dia: 'Resumo do dia', resumo_semana: 'Resumo da semana (imagem + texto)', resumo_mes: 'Resumo do mês (imagem + texto)',
  presentes: 'Presentes por tempo de casa', bloqueio_app: 'Bloqueio do app — inadimplência', free_antecedencia: 'Planos FREE — antecedência',
  presenca: 'Relatório de presença da experimental',
};

// Jornadas. Passos: ['dia', rótulo] · ['in', chave do catálogo, hora] · ['out', resposta de exemplo, hora]
// · ['audio', duração, hora] · ['gerado', chave de GERADO, hora] · ['nota', texto explicativo]
const J = [
  // ─── Para a aluna e a lead ───
  { k: 'experimental', sec: 'cliente', titulo: 'Lead que agendou a aula experimental', sub: 'confirmação ao agendar → lembrete na véspera → follow-up depois da aula', de: 'studio', passos: [
    ['dia', 'Segunda'], ['in', 'confirmacao_experimental', '15:41'], ['out', 'Oba! Obrigada 😊', '15:52'],
    ['dia', 'Quarta'], ['in', 'confirmacao_amanha', '15:30'], ['out', 'Confirmadíssimo! 👍', '15:51'],
    ['dia', 'Sexta'], ['audio', '0:48', '10:30'], ['in', 'followup', '10:30'], ['out', 'Amei a aula! Quais são os planos?', '10:52'],
  ] },
  { k: 'express', sec: 'cliente', titulo: 'Lead do Cadastro Express (na recepção)', sub: 'confirmação da aula marcada no balcão', de: 'studio', passos: [
    ['dia', 'Hoje'], ['in', 'confirmacao_experimental_express', '11:12'], ['out', 'Perfeito, até amanhã!', '11:20'],
  ] },
  { k: 'calada', sec: 'cliente', titulo: 'Lead que não responde', sub: 'confirmação no dia → 2ª mensagem sem resposta → follow-up → encerramento educado', de: 'studio', passos: [
    ['dia', 'Quinta'], ['in', 'confirmacao_hoje', '08:30'], ['in', 'confirmacao_sem_resposta', '11:00'],
    ['nota', 'Ela veio à aula, mas não respondeu às mensagens.'],
    ['dia', 'Sexta'], ['in', 'followup', '10:30'],
    ['dia', 'Sábado'], ['in', 'followup_encerramento', '10:45'],
  ] },
  { k: 'fechou', sec: 'cliente', titulo: 'Lead que fez a aula e já fechou', sub: 'follow-up de quem já virou aluna', de: 'studio', passos: [
    ['dia', 'Sexta'], ['in', 'followup_aluna', '16:00'], ['out', 'Eu que agradeço! Até segunda 💪', '16:22'],
  ] },
  { k: 'faltou', sec: 'cliente', titulo: 'Lead que faltou à aula', sub: 'lembrete no dia → convite para remarcar → encerramento educado no dia seguinte', de: 'studio', passos: [
    ['dia', 'Ontem'], ['in', 'confirmacao_hoje', '08:30'], ['in', 'no_show', '19:30'],
    ['dia', 'Hoje'], ['in', 'noshow_encerramento', '19:50'], ['out', 'Desculpa! Tive um imprevisto. Posso remarcar pra segunda?', '20:03'],
  ] },
  { k: 'retomada', sec: 'cliente', titulo: 'Lead que parou de responder a SoFIA', sub: 'retomada pelo número do Studio → encerramento se seguir sem resposta', de: 'studio', passos: [
    ['dia', 'Terça'], ['in', 'retomada_sofia', '10:00'],
    ['dia', 'Quarta'], ['in', 'retomada_encerramento', '10:30'],
  ] },
  { k: 'nova', sec: 'cliente', titulo: 'Aluna nova', sub: 'boas-vindas com o link do contrato → lembrete de assinatura → convite de indicação aos 30 dias', de: 'studio', passos: [
    ['dia', '2 de outubro'], ['in', 'boasvindas_nova', '10:07'], ['out', 'Obrigada!! Ansiosa pra começar 💪', '10:20'],
    ['dia', '5 de outubro'], ['in', 'assinatura_contrato', '10:43'], ['out', 'Assinado! ✍️', '11:05'],
    ['dia', '1º de novembro'], ['in', 'indicacao_30d', '11:22'], ['out', 'Vou chamar minha irmã! Te passo o contato dela 😊', '12:40'],
  ] },
  { k: 'retorno', sec: 'cliente', titulo: 'Ex-aluna que voltou', sub: 'boas-vindas de retorno', de: 'studio', passos: [
    ['dia', 'Hoje'], ['in', 'boasvindas_retorno', '10:07'], ['out', 'Que saudade! Feliz de voltar 🥰', '10:30'],
  ] },
  { k: 'renovacao', sec: 'cliente', titulo: 'Renovação de contrato', sub: 'aviso antes de vencer → aviso no dia → boas-vindas da renovação', de: 'studio', passos: [
    ['dia', '7 dias antes'], ['in', 'renovacao', '14:30'],
    ['dia', 'No dia do vencimento'], ['in', 'vence_hoje', '09:17'], ['out', 'Vou passar aí hoje à tarde pra renovar!', '09:48'],
    ['dia', 'Dia seguinte'], ['in', 'boasvindas_renovacao', '10:07'],
  ] },
  { k: 'naorenovou', sec: 'cliente', titulo: 'Aluna que não renovou', sub: 'aviso no dia do vencimento → mensagem ao sair dos grupos', de: 'studio', passos: [
    ['dia', '16/11 (venceu)'], ['in', 'vence_hoje', '09:17'],
    ['dia', '23/11 (7 dias sem renovar)'], ['in', 'saida_grupos', '09:47'],
  ] },
  { k: 'ausente', sec: 'cliente', titulo: 'Aluna sumida', sub: '"sentimos sua falta" → 2ª mensagem 10+ dias depois', de: 'studio', passos: [
    ['dia', 'Segunda (14 dias sem vir)'], ['in', 'sentimos_falta_1', '10:37'],
    ['dia', 'Segunda, 10+ dias depois'], ['in', 'sentimos_falta_2', '10:37'], ['out', 'Oi! Estava viajando, volto na segunda 😊', '11:02'],
  ] },
  { k: 'exaluna', sec: 'cliente', titulo: 'Ex-aluna', sub: 'parabéns no aniversário, direto no WhatsApp dela', de: 'studio', passos: [
    ['dia', 'Hoje'], ['in', 'aniversario_ex', '08:03'], ['out', 'Que carinho! Obrigada, saudades de vocês 💛', '08:31'],
  ] },
  { k: 'cobranca', sec: 'cliente', titulo: 'Cobrança de boleto (pela SoFIA)', sub: 'boleto que vence hoje → boleto vencido → acesso ao app liberado depois do pagamento', de: 'sofia', passos: [
    ['dia', '16/11'], ['in', 'cobranca_boleto_hoje', '11:27'],
    ['dia', '20/11'], ['in', 'cobranca_boleto', '12:05'], ['out', 'Paguei agora, segue o comprovante', '12:31'], ['in', 'cobranca_app_reativado', '15:10'],
  ] },
  { k: 'cobranca2', sec: 'cliente', titulo: 'Outras cobranças (pela SoFIA)', sub: 'cartão recorrente recusado → saldo devedor sem boleto', de: 'sofia', passos: [
    ['dia', 'Cartão recorrente'], ['in', 'cobranca_recorrente', '11:30'],
    ['dia', 'Saldo devedor'], ['in', 'cobranca_saldo', '11:40'],
  ] },
  // ─── Para a equipe e os grupos ───
  { k: 'resumos', sec: 'equipe', titulo: 'Resumos do dia, da semana e do mês', sub: 'no grupo da equipe — o da semana e o do mês vão com imagem', de: 'equipe', passos: [
    ['dia', 'Todo dia'], ['gerado', 'resumo_dia', '19:45'],
    ['dia', 'Sexta'], ['gerado', 'resumo_semana', '16:30'],
    ['dia', 'Dia 1º do mês (escolhido no painel)'], ['gerado', 'resumo_mes', '08:00'],
  ] },
  { k: 'listas', sec: 'equipe', titulo: 'Listas para a equipe', sub: 'confirmação sem resposta, ausentes, aniversariantes, contratos a vencer, presentes', de: 'equipe', passos: [
    ['dia', 'Seg a sáb'], ['in', 'confirmacao_sem_resposta_equipe', '13:00'],
    ['dia', 'Segunda'], ['in', 'ausentes', '06:10'], ['gerado', 'presentes', '06:45'],
    ['dia', 'Dia 28'], ['in', 'aniversariantes_mes', '05:30'], ['in', 'renovacoes_mes', '09:07'],
  ] },
  { k: 'avisos', sec: 'equipe', titulo: 'Avisos automáticos para a equipe', sub: 'bloqueio do app, aulas FREE desmarcadas, relatório de presença', de: 'equipe', passos: [
    ['dia', 'Quando bloqueia ou libera o app'], ['gerado', 'bloqueio_app', ''],
    ['dia', 'Quando desmarca aula FREE'], ['gerado', 'free_antecedencia', ''],
    ['nota', 'O relatório de presença vai para o número escolhido no painel (não para o grupo):'],
    ['gerado', 'presenca', ''],
  ] },
  { k: 'grupos', sec: 'equipe', titulo: 'Grupos das alunas', sub: 'aniversário da aluna → convocatória e lembrete do Circuito', de: 'alunas', passos: [
    ['dia', 'Aniversário'], ['in', 'aniversario', '08:00'],
    ['dia', 'Quarta'], ['in', 'circuito_convocacao', '16:15'],
    ['dia', 'Sexta'], ['in', 'circuito_lembrete', '16:15'],
  ] },
];
const SECOES = [['cliente', 'Para a aluna e a lead'], ['equipe', 'Para a equipe e os grupos']];

// Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, links, quebras de linha).
function formatarWa(t) {
  return esc(String(t || ''))
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}
function textoDe(chave) {
  try {
    const t = mensagens.texto(chave);
    if (!t) return '';
    // sem link do formulário no .env (demonstração, teste), mostra um de exemplo
    const semForm = String(process.env.FORM_CLOUD_URL || '').trim() ? {} : { formulario: 'https://formulario.exemplo/agendar/' };
    return mensagens.renderTexto(t, Object.assign(semForm, mensagens.exemplosDe(chave), EX, EX_POR[chave] || {}));
  } catch (_) { return ''; }
}
function tituloDe(chave) { const m = (mensagens.CATALOGO || []).find(x => x.chave === chave); return m ? m.titulo : chave; }
function gerado(chave) { try { return GERADO[chave](); } catch (e) { return ''; } }
// Chaves do catálogo e mensagens geradas que aparecem em alguma jornada (o teste confere o catálogo inteiro).
function chavesMostradas() {
  const cat = new Set(), ger = new Set();
  for (const j of J) for (const [t, a] of j.passos) { if (t === 'in') cat.add(a); if (t === 'gerado') ger.add(a); }
  return { catalogo: [...cat], geradas: [...ger] };
}

function paginaVisaoCliente(k) {
  const j = J.find(x => x.k === k) || J[0];
  const de = DE[j.de] || DE.studio;
  const lista = SECOES.map(([sec, rot]) => `<div class="vc-sec">${esc(rot)}</div>` + J.filter(x => x.sec === sec).map(x => `<a class="vc-j${x.k === j.k ? ' on' : ''}" href="/visao-cliente?j=${x.k}#vc-celular"><b>${esc(x.titulo)}</b><span>${esc(x.sub)}</span></a>`).join('')).join('');
  const quem = de.grupo ? '<div class="vc-quem">Robô do Studio</div>' : '';
  const hora = (h) => h ? `<div class="vc-h">${esc(h)}</div>` : '';
  const bolhas = j.passos.map(([tipo, a, b]) => {
    if (tipo === 'dia') return `<div class="vc-dia"><span>${esc(a)}</span></div>`;
    if (tipo === 'nota') return `<div class="vc-dia vc-notinha"><span>${esc(a)}</span></div>`;
    if (tipo === 'audio') return `<div class="vc-b in"><div class="vc-audio">▶︎ <span class="vc-onda"></span> ${esc(a)}</div>${hora(b)}<div class="vc-tag">🎤 áudio da professora</div></div>`;
    if (tipo === 'out') return `<div class="vc-b out">${formatarWa(a)}<div class="vc-h">${esc(b)} <span class="vc-ck">✓✓</span></div></div>`;
    if (tipo === 'gerado') {
      const g = gerado(a); const rot = ROT_GERADO[a] || a;
      if (!g) return '';
      if (typeof g === 'object') return `<div class="vc-b in vc-midia">${quem}<div class="vc-img" role="img" aria-label="${esc(rot)}"><iframe sandbox="" tabindex="-1" title="${esc(rot)}" srcdoc="${esc(String(g.html).replace('<head>', '<head><style>html{zoom:.24;overflow:hidden}</style>'))}"></iframe></div>${formatarWa(g.legenda)}${hora(b)}<div class="vc-tag">${esc(rot)}</div></div>`;
      return `<div class="vc-b in">${quem}${formatarWa(g)}${hora(b)}<div class="vc-tag">${esc(rot)}</div></div>`;
    }
    const txt = textoDe(a);
    if (!txt) return '';
    return `<div class="vc-b in" title="${esc(tituloDe(a))}">${quem}${formatarWa(txt)}${hora(b)}<div class="vc-tag">${esc(tituloDe(a))}</div></div>`;
  }).join('');
  const corpo = `
<style>
.vc-wrap{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:22px;align-items:start}
@media (max-width:900px){.vc-wrap{grid-template-columns:1fr}}
.vc-lista{display:flex;flex-direction:column;gap:8px}
.vc-j{display:block;background:#fff;border:1px solid var(--linha,#e5e7eb);border-radius:12px;padding:12px 14px;text-decoration:none;color:inherit}
.vc-j b{display:block;font-size:15px;margin-bottom:3px}
.vc-j span{font-size:13px;color:var(--cinza,#6b7280)}
.vc-j.on{border-color:#0e6e6b;box-shadow:0 0 0 2px rgba(14,110,107,.15);background:#f0faf8}
.vc-tel{scroll-margin-top:12px;background:#111;border-radius:40px;padding:12px;box-shadow:0 18px 40px rgba(0,0,0,.25);max-width:400px;margin:0 auto}
.vc-tela{border-radius:30px;overflow:hidden;background:#efeae2;height:720px;display:flex;flex-direction:column}
.vc-top{background:#075e54;color:#fff;display:flex;align-items:center;gap:10px;padding:14px 14px 12px}
.vc-av{width:38px;height:38px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.vc-top b{display:block;font-size:15px}.vc-top small{font-size:12px;opacity:.85}
.vc-chat{flex:1;overflow-y:auto;padding:10px 10px 16px;display:flex;flex-direction:column;gap:6px;background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:14px 14px}
.vc-dia{text-align:center;margin:8px 0 4px}.vc-dia span{background:#e1f2fb;color:#3b4a54;font-size:12px;padding:4px 10px;border-radius:8px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.vc-b{max-width:84%;padding:7px 9px 5px;border-radius:9px;font-size:14px;line-height:1.38;color:#111b21;box-shadow:0 1px 1px rgba(0,0,0,.12);word-wrap:break-word;position:relative}
.vc-b.in{background:#fff;align-self:flex-start;border-top-left-radius:2px}
.vc-b.out{background:#d9fdd3;align-self:flex-end;border-top-right-radius:2px}
.vc-b a{color:#027eb5;word-break:break-all}
.vc-h{font-size:11px;color:#667781;text-align:right;margin-top:2px}
.vc-ck{color:#53bdeb;font-weight:700}
.vc-tag{font-size:10.5px;color:#0e6e6b;background:#e7f5f2;border-radius:6px;padding:2px 6px;margin-top:5px;display:inline-block}
.vc-audio{display:flex;align-items:center;gap:8px;min-width:210px;color:#54656f;font-size:13px}
.vc-onda{flex:1;height:18px;background:repeating-linear-gradient(90deg,#8696a0 0 2px,transparent 2px 5px);mask:linear-gradient(90deg,#000 0,#000 100%);opacity:.7;border-radius:3px}
.vc-rod{background:#f0f2f5;padding:10px 12px;color:#8696a0;font-size:13px;display:flex;gap:8px;align-items:center}
.vc-rod span{flex:1;background:#fff;border-radius:20px;padding:9px 14px}
.vc-nota{font-size:13px;color:var(--cinza,#6b7280);margin-top:10px;line-height:1.45}
.vc-sec{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cinza,#6b7280);margin:10px 2px 0}
.vc-sec:first-child{margin-top:0}
.vc-notinha span{background:#fff7e0;color:#5c4a12}
.vc-quem{font-size:12.5px;font-weight:700;color:#0e6e6b;margin-bottom:2px}
.vc-midia{max-width:88%}
.vc-img{width:259px;height:324px;overflow:hidden;border-radius:6px;margin-bottom:6px;background:#f3f6f6}
.vc-img iframe{display:block;width:259px;height:324px;border:0;pointer-events:none}
</style>
<div class="wrap">${require('./painel-whatsapp').subnavMensagens('cliente')}
${uiTopo({ titulo: '📱 Visão do cliente', sub: 'Todas as mensagens automáticas, como chegam no WhatsApp: da aluna e da lead, e da equipe e dos grupos. Os textos são os configurados em <b>WhatsApp → Configuração</b>, com dados de exemplo no lugar das variáveis.' })}
<div class="vc-wrap">
  <div><div class="vc-lista">${lista}</div>
    <p class="vc-nota">As bolhas brancas são as mensagens automáticas (a etiqueta verde mostra qual envio é). As verdes são respostas de exemplo da aluna. Os horários são os padrões — cada Studio pode mudar dias, horários e ligar ou desligar cada envio no painel. Nada aqui é enviado.</p></div>
  <div class="vc-tel" id="vc-celular"><div class="vc-tela">
    <div class="vc-top"><div class="vc-av">${esc(de.ini)}</div><div><b>${esc(de.nome)}</b><small>${esc(de.sub || 'online')}</small></div></div>
    <div class="vc-chat" id="vcChat">${bolhas}</div>
    <div class="vc-rod">😊 <span>Mensagem</span> 🎤</div>
  </div></div>
</div>
</div>
<script>(function(){var c=document.getElementById('vcChat');if(c)c.scrollTop=c.scrollHeight;})();</script>`;
  return chrome({ tab: 'Visão do cliente', h1: '', p: '' }, 'msg', corpo);
}

module.exports = { paginaVisaoCliente, JORNADAS: J, GERADO, chavesMostradas };

/**
 * demo-dados.js — gera os DADOS FICTÍCIOS do painel de demonstração (PAINEL_DEMO=1).
 *
 * Escreve em Experimental/data e na pasta da SoFIA (SOFIA_DIR) arquivos no mesmo
 * formato que o robô, a SoFIA e o EVO produzem — com nomes e números inventados.
 * Tudo é calculado a partir de HOJE e é DETERMINÍSTICO por dia (a mesma semente
 * no mesmo dia): rodar de novo no mesmo dia não muda o conteúdo, só revela o que
 * já "aconteceu" até agora (nada com horário futuro aparece). Por isso o cron
 * roda a cada 15 min e a demonstração parece viva o dia todo.
 *
 * Uso:  node src/demo-dados.js        (só roda com PAINEL_DEMO=1 no .env, por segurança)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

if (!/^(1|true|sim|yes)$/i.test(String(process.env.PAINEL_DEMO || ''))) {
  console.error('demo-dados: só roda numa instalação de DEMONSTRAÇÃO (PAINEL_DEMO=1 no .env). Nada foi alterado.');
  process.exit(1);
}
const DATA = path.resolve(__dirname, '..', 'data');
const SOFIA = path.resolve(process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot'));
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(SOFIA, { recursive: true });

// ── relógio e sorte determinística ───────────────────────────────────────────
const TZ = 'America/Sao_Paulo';
const AGORA = Date.now();
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const dia = (n) => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Instante (ms) de "YYYY-MM-DD HH:MM" no horário de Brasília (UTC-3, sem horário de verão).
const em = (d, hhmm) => Date.parse(`${d}T${hhmm}:00-03:00`);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const diaDe = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
const wd = (d) => new Date(d + 'T12:00:00Z').getUTCDay(); // 0=dom
let semente = [...hoje].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const rnd = () => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const passou = (ms) => ms <= AGORA;
const pad = (n, k = 2) => String(n).padStart(k, '0');
const cap = (t) => String(t || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
const corta = (t, n) => Array.from(String(t || '')).slice(0, n).join(''); // não parte emoji ao meio
const gravar = (arq, conteudo) => { const tmp = arq + '.tmp'; fs.writeFileSync(tmp, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo)); fs.renameSync(tmp, arq); };

// ── gente inventada ──────────────────────────────────────────────────────────
const NOMES = ['Ana Beatriz', 'Bruna', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Karina', 'Larissa', 'Mariana', 'Natália', 'Olívia', 'Patrícia', 'Rafaela', 'Sabrina', 'Tatiana', 'Vanessa', 'Aline', 'Bianca', 'Carolina', 'Débora', 'Elisa', 'Flávia', 'Giovana', 'Jéssica', 'Letícia', 'Michele', 'Nicole', 'Paula', 'Renata', 'Simone', 'Thaís', 'Vitória', 'Amanda', 'Beatriz', 'Cristina', 'Denise', 'Érica', 'Fabiana', 'Gisele', 'Lorena', 'Marcela', 'Priscila', 'Raquel', 'Sílvia', 'Talita', 'Yasmin', 'Adriana', 'Clara', 'Luana', 'Mirela', 'Roberta', 'Sofia', 'Valéria', 'Lívia', 'Manuela', 'Cecília'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferraz', 'Gouveia', 'Holanda', 'Lacerda', 'Machado', 'Nogueira', 'Oliveira', 'Pacheco', 'Queiroz', 'Rezende', 'Sampaio', 'Teixeira', 'Vasconcelos', 'Xavier', 'Zanetti', 'Moreira', 'Campos', 'Rocha', 'Prado'];
const PROFS = ['Ana', 'Bia', 'Carol', 'Duda'];
const HORAS = ['05:45', '07:00', '08:15', '09:30', '14:00', '16:15', '17:30', '18:45', '20:00'];
const PLANOS = ['SLIM 2X MENSAL', 'SLIM 3X MENSAL', 'SLIM 3X TRIMESTRAL', 'SLIM 4X SEMESTRAL', 'SLIM FREE 3X QUADRIMESTRAL', 'SLIM 5X ANUAL'];
const pessoas = NOMES.map((n, i) => ({
  i, nome: `${n} ${SOBRENOMES[i % SOBRENOMES.length]}`.toUpperCase(), primeiro: n.split(' ')[0],
  tel: '55629' + pad(1000 + i * 37, 4) + pad((i * 7919) % 10000, 4), id: String(3100 + i * 13),
}));
const ALUNAS = pessoas.slice(0, 34), EX = pessoas.slice(34, 42), LEADS = pessoas.slice(42);
const T = { contato: 'FX - 1. Contato inicial', agendou: 'FX - 3. Agendou Aula Exp', fez: 'FX - 5. Fez Aula Experimental', faltou: 'FX - 2. Encerrado com Agendamento sem Presença', encerrado: 'FX - 2. Encerrado sem agendamento', semInteresse: 'FX - 0. Sem interesse', aluna: '0. Aluna', ex: '0. Ex Aluna', preco: '0. Preço', anuncio: '0. Patrocinado' };

// ── conversas da SoFIA (roteiros) ────────────────────────────────────────────
// Cada passo: [autor, texto, minutos depois do passo anterior, tipo?]
const ROTEIROS = {
  agendou: [
    ['aluna', 'Oi, boa tarde! Vi o anúncio de vocês no Instagram', 0],
    ['sofia', 'Boa tarde! 😊 Tudo bem com você?\nSeja muito bem-vinda ao SlimFit! Sou a Sofia 💛', 1],
    ['sofia', 'Vamos agendar uma aula experimental gratuita pra você conhecer a nossa metodologia?', 0],
    ['aluna', 'Quero sim! Como funciona?', 3],
    ['sofia', 'O SlimFit é um *Studio de Personal exclusivo para mulheres*: treino completo de força, funcional e cardio em *até 1 hora*, em turmas de no máximo 9 alunas.', 1],
    ['sofia', 'Aqui está a nossa grade de horários 👇\nQual dia e horário ficam melhores pra você?', 0],
    ['aluna', 'Quinta às {hora} tem?', 4],
    ['sofia', 'Tenho vaga na quinta às {hora} 😊 Me passa seu nome completo e e-mail?', 1],
    ['aluna', '{nome} — {email}', 2],
    ['sofia', 'Prontinho, {primeiro}! ✅\nSua aula experimental está agendada para quinta às {hora}.\nEm instantes a recepção do Studio te manda mais informações. Super bem-vinda ao SlimFit 💪', 1],
  ],
  preco: [
    ['aluna', 'Boa noite, quanto custa?', 0],
    ['sofia', 'Boa noite! 😊 Tudo bem com você?\nSeja muito bem-vinda ao SlimFit! Sou a Sofia 💛', 1],
    ['sofia', 'O SlimFit não é uma academia comum — é um *Studio de Personal exclusivo para mulheres*. Nossos planos começam em *R$ 587,00/mês*.', 0],
    ['sofia', 'Posso te apresentar rapidinho a nossa metodologia? 💛', 0],
    ['aluna', 'Vou pensar e te falo', 9],
    ['sofia', 'Claro! A aula experimental é *gratuita e sem compromisso* — você sente tudo na prática antes de decidir. Quer que eu veja um horário pra você?', 1],
  ],
  semInteresse: [
    ['aluna', 'Oi, recebi a mensagem de vocês', 0],
    ['sofia', 'Oi! 😊 Que bom te ver por aqui. Posso te ajudar a agendar uma aula experimental?', 1],
    ['aluna', 'Obrigada, mas já treino em outro lugar e estou satisfeita', 6],
    ['sofia', 'Entendido, obrigada pelo retorno! 💛 Se mudar de ideia, é só me chamar. Até logo!', 1],
  ],
  remarcar: [
    ['aluna', 'Oi Sofia, não vou conseguir ir na aula de amanhã 😕', 0],
    ['sofia', 'Imagino! Sem problemas, vamos remarcar 💛 Tenho vaga no mesmo horário na sexta. Pode ser?', 1],
    ['aluna', 'Pode sim', 4],
    ['sofia', 'Prontinho! Remarquei sua aula para sexta às {hora} 💛 Qualquer coisa, é só me chamar!', 1],
  ],
  duvida: [
    ['aluna', 'Vocês têm estacionamento?', 0],
    ['sofia', 'Olá! 😊 Tudo bem com você? Seja muito bem-vinda ao SlimFit! Sou a Sofia 💛', 1],
    ['sofia', 'Temos sim, com vagas exclusivas para as alunas. Que tal conhecer na prática com uma aula experimental gratuita?', 0],
    ['aluna', 'E pra quem nunca treinou, dá?', 12],
    ['sofia', 'Não só pode como deve começar! 😊 A aula é ajustada ao seu nível, e a professora te acompanha de perto. Quer que eu veja um horário pra você?', 1],
  ],
  humano: [
    ['aluna', 'Oi, quero falar com uma atendente por favor', 0],
    ['sofia', 'Claro! Já avisei a nossa recepção — ela fala com você em instantes 💛', 1],
    ['humano', 'Oi {primeiro}! Aqui é a Júlia, da recepção. Como posso te ajudar?', 7],
    ['aluna', 'Queria saber se posso levar minha filha de 13 anos', 3],
    ['humano', 'Pode sim! A idade mínima é 12 anos 😊 Querem agendar juntas?', 2],
  ],
  campanha: [
    ['sofia', 'Oi {primeiro}! 💛 Sentimos sua falta por aqui. Neste mês temos condição especial para quem já fez a aula experimental. Quer receber os horários disponíveis?', 0, 'campanha'],
    ['aluna', 'Quero!', 40],
    ['sofia', 'Que ótimo! 😊 Aqui está a nossa grade de horários 👇\nQual dia e horário ficam melhores pra você?', 1],
    ['aluna', 'Segunda às {hora}', 8],
    ['sofia', 'Tenho vaga na segunda às {hora} 😊 Pode confirmar seu e-mail?', 1],
  ],
  followup: [
    ['aluna', 'Oi, quero saber mais sobre o studio', 0],
    ['sofia', 'Oi! 😊 Tudo bem com você? Seja muito bem-vinda ao SlimFit! Sou a Sofia 💛', 1],
    ['sofia', 'O SlimFit é um *Studio de Personal exclusivo para mulheres*. Quer que eu te mostre os horários para uma aula experimental gratuita?', 0],
    ['sofia', 'Oi {primeiro}! Ficou alguma dúvida? Se quiser, já te passo os horários disponíveis para essa semana 😊', 180, 'followup'],
  ],
};
const ESCOLHA = ['agendou', 'agendou', 'agendou', 'preco', 'preco', 'semInteresse', 'remarcar', 'duvida', 'duvida', 'humano', 'campanha', 'followup', 'agendou', 'preco', 'duvida', 'agendou', 'campanha', 'followup'];

const conversas = {}, tagLog = [], encerradas = {}, custo = [], agendaramCanal = {};
const tagsLead = {};
LEADS.forEach((p, k) => {
  const roteiro = ESCOLHA[k % ESCOLHA.length];
  const d = dia(-(k % 6)); // espalhado nos últimos 6 dias (hoje incluso)
  let t = em(d, pick(['08:12', '09:40', '11:05', '12:30', '13:47', '15:20', '17:55', '19:10', '20:35', '21:15']));
  const hora = pick(HORAS);
  const email = p.primeiro.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '.' + (k + 3) + '@exemplo.com';
  const msgs = [];
  for (const [autor, texto, mins, tipo] of ROTEIROS[roteiro]) {
    t += (mins || 0) * 60000 + entre(5, 50) * 1000;
    if (!passou(t)) break;
    const m = { autor, texto: texto.replace(/\{hora\}/g, hora).replace(/\{primeiro\}/g, p.primeiro).replace(/\{nome\}/g, p.nome.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())).replace(/\{email\}/g, email), em: t };
    if (tipo) m.tipo = tipo;
    if (autor === 'humano') m.por = 'julia';
    msgs.push(m);
    if (autor === 'sofia' && !tipo) custo.push({ em: new Date(t).toISOString(), tipo: 'conversa', model: 'claude-sonnet', tel: p.tel, inTok: entre(9000, 16000), outTok: entre(80, 260), usd: +(0.03 + rnd() * 0.035).toFixed(4) });
  }
  if (!msgs.length) return;
  conversas[p.tel] = { jid: p.tel + '@c.us', nome: p.primeiro, ultimaEm: msgs[msgs.length - 1].em, msgs };
  const primeiraEm = msgs[0].em, ultimaEm = msgs[msgs.length - 1].em;
  const add = (tag, motivo, quando, canal) => { tagLog.push({ chave: p.tel, tag, motivo, por: '', acao: 'add', em: quando, ...(canal ? { canal } : {}) }); };
  const tags = [];
  if (roteiro === 'campanha') { tags.push(T.fez); add('BlackNovember', 'campanha', primeiraEm + 41 * 60000); }
  else { tags.push(T.contato); add(T.contato, 'novo', primeiraEm); }
  if (roteiro === 'agendou' && msgs.length >= 10) { tags.splice(0, tags.length, T.agendou); add(T.agendou, 'agendou', ultimaEm, pick(['sofia', 'sofia', 'formulario', 'express'])); agendaramCanal[p.tel.slice(-8)] = 'sofia'; }
  if (roteiro === 'preco') { tags.push(T.preco); add(T.preco, 'ia', primeiraEm + 60000); }
  if (roteiro === 'semInteresse' && msgs.length >= 3) { tags.splice(0, tags.length, T.semInteresse); add(T.semInteresse, 'ia', msgs[2].em); encerradas[p.tel] = { em: ultimaEm + 60000, por: 'SoFIA' }; }
  if (roteiro === 'remarcar') { tags.splice(0, tags.length, T.agendou); }
  if (roteiro === 'humano') tags.push('0. Atendimento Humano');
  tagsLead[p.tel] = tags;
});

// ── aulas experimentais (histórico lido do "EVO") ────────────────────────────
const aulas = {};
let nAula = 0;
for (let n = -30; n <= 6; n++) {
  const d = dia(n); if (wd(d) === 0) continue;
  const qtd = wd(d) === 6 ? entre(0, 2) : entre(1, 4);
  for (let j = 0; j < qtd; j++) {
    const p = pessoas[(nAula * 7 + 11) % pessoas.length]; nAula++;
    const hora = pick(HORAS), prof = PROFS[(nAula + HORAS.indexOf(hora)) % PROFS.length];
    const aconteceu = em(d, hora) + 3600e3 < AGORA;
    let status = 'Agendado', contrato = '';
    if (aconteceu) {
      const r = rnd();
      status = r < 0.78 ? 'Presença' : 'Falta';
      if (status === 'Presença' && rnd() < 0.42) contrato = pick(PLANOS);
    }
    aulas[`${d}|${hora}|${p.id}`] = { dia: d, hora, prof, nome: p.nome, id: p.id, status, contrato, visto: AGORA };
  }
}
// Funil: quem agendou fez a aula? fechou? faltou? (tags atuais + a aula no histórico)
const resultadoAula = (p, quando, canal, d0) => {
  const dAula = dia(d0 + entre(1, 3)), hora = pick(HORAS), prof = pick(PROFS);
  const aconteceu = em(dAula, hora) + 3600e3 < AGORA;
  let status = 'Agendado', contrato = '', tags = [T.agendou];
  if (aconteceu) {
    const r = rnd();
    if (r < 0.17) { status = 'Falta'; tags = [T.faltou]; }
    else if (r < 0.52) { status = 'Presença'; contrato = pick(PLANOS); tags = [T.aluna]; }
    else { status = 'Presença'; tags = [T.fez]; }
  }
  aulas[`${dAula}|${hora}|${p.id}`] = { dia: dAula, hora, prof, nome: p.nome, id: p.id, status, contrato, visto: AGORA };
  tagLog.push({ chave: p.tel, tag: T.agendou, motivo: 'agendou', por: '', acao: 'add', em: quando, canal });
  return tags;
};
for (const p of LEADS) {
  const c = conversas[p.tel]; if (!c || !(tagsLead[p.tel] || []).includes(T.agendou)) continue;
  const d0 = Math.round((em(diaDe(c.ultimaEm), '12:00') - em(hoje, '12:00')) / 86400e3);
  // (o evento "agendou" desta lead já está no histórico de tags)
  const tags = resultadoAula(p, c.ultimaEm, 'sofia', d0); tagLog.pop(); // o evento "agendou" desta lead já está no histórico
  tagsLead[p.tel] = tags;
}
// Alunas que vieram da experimental neste mês (agendaram → fizeram → fecharam).
const VIERAM = ALUNAS.slice(0, 9);
VIERAM.forEach((p, k) => {
  const d0 = -entre(4, 27), quando = em(dia(d0), pick(['09:20', '11:40', '14:05', '19:30', '21:10']));
  const canal = pick(['sofia', 'sofia', 'formulario', 'express']);
  const tags = resultadoAula(p, quando, canal, d0);
  // quem não fechou na aula ainda pode ter fechado depois: mantém aluna (é aluna ativa)
  for (const a of Object.values(aulas)) if (a.id === p.id && a.status !== 'Agendado') { a.status = 'Presença'; a.contrato = a.contrato || pick(PLANOS); }
});
const lidos = {}; for (let n = -30; n <= 6; n++) lidos[dia(n)] = AGORA;

// ── contatos (CRM) ───────────────────────────────────────────────────────────
const contatos = {};
const criado = em(dia(-120), '10:00');
for (const p of ALUNAS) contatos[p.tel] = { tel: p.tel, nome: p.nome, tags: [T.aluna], instrucoes: '', criadoEm: criado, atualizadoEm: criado, idEvo: p.id };
for (const p of EX) contatos[p.tel] = { tel: p.tel, nome: p.nome, tags: [T.ex], instrucoes: '', criadoEm: criado, atualizadoEm: criado, idEvo: p.id };
for (const p of LEADS) if (conversas[p.tel]) contatos[p.tel] = { tel: p.tel, nome: p.primeiro, tags: tagsLead[p.tel] || [], instrucoes: '', criadoEm: conversas[p.tel].msgs[0].em, atualizadoEm: conversas[p.tel].ultimaEm };

// ── alunas ativas (leitura diária do "EVO") ──────────────────────────────────
const pesAtivas = {}, idsAtivos = [];
// Além das alunas com conversa/contato, um Studio de verdade tem ~130 ativas.
const EXTRAS = [];
for (let k = 0; EXTRAS.length < 96; k++) {
  const n = NOMES[(k * 7 + 3) % NOMES.length], sb = SOBRENOMES[(k * 5 + 11) % SOBRENOMES.length], sb2 = SOBRENOMES[(k * 3 + 1) % SOBRENOMES.length];
  EXTRAS.push({ nome: `${n} ${sb} ${sb2}`.toUpperCase(), tel: '55629' + pad(5000 + k * 41, 4) + pad((k * 6151) % 10000, 4), id: String(5200 + k * 7) });
}
ALUNAS.forEach((p, k) => {
  const ini = dia(-entre(20, 540)), plano = PLANOS[k % PLANOS.length];
  const fim = dia(entre(5, 300));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, plano, fim, 0]] };
  if (k % 9 === 0) pesAtivas[p.id].fq = [plano, dia(entre(10, 40))];
  idsAtivos.push(p.id);
});
EXTRAS.forEach((p, k) => {
  const ini = dia(-entre(15, 700)), plano = PLANOS[(k + 2) % PLANOS.length], fim = dia(entre(3, 330));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, plano, fim, 0]] };
  idsAtivos.push(p.id);
});
// Série dos últimos 24 meses (reconstruída "pelos contratos"): cresce com sazonalidade.
const DIAS_SERIE = 730, inicioSerie = dia(-(DIAS_SERIE - 1));
const serAtivas = [], serEntr = [], serNovas = [], serSai = [];
{
  let atual = Math.round(idsAtivos.length * 0.74);
  const alvo = idsAtivos.length;
  for (let i = 0; i < DIAS_SERIE; i++) {
    const dd = dia(-(DIAS_SERIE - 1) + i), mes = +dd.slice(5, 7), dow = wd(dd);
    const restante = DIAS_SERIE - i;
    const tend = (alvo - atual) / Math.max(1, restante);
    const forte = [1, 2, 3, 8].includes(mes) ? 1.6 : [6, 12].includes(mes) ? 0.5 : 1;
    let e = dow === 0 ? 0 : (rnd() < 0.36 * forte ? entre(1, 2) : 0);
    let sa = dow === 0 ? 0 : (rnd() < 0.3 * (mes === 12 || mes === 6 ? 1.7 : 1) ? entre(1, 2) : 0);
    if (tend > 0.2 && dow !== 0 && rnd() < 0.5) e++;
    if (tend < -0.2 && dow !== 0 && rnd() < 0.5) sa++;
    if (i === DIAS_SERIE - 1) { const dif = alvo - (atual + e - sa); if (dif > 0) e += dif; else sa -= dif; }
    atual = atual + e - sa;
    serAtivas.push(atual); serEntr.push(e); serNovas.push(e ? entre(0, e) : 0); serSai.push(sa);
  }
}
EX.forEach((p) => {
  const ini = dia(-entre(300, 700)), fim = dia(-entre(20, 200));
  pesAtivas[p.id] = { n: p.nome, nc: 1, tel: p.tel, iv: [[ini, fim]], cs: [[ini, fim, pick(PLANOS), fim, 0]] };
});

// ── log de envios do robô (aba Log) + SoFIA ──────────────────────────────────
const atividade = [], atividadeSofia = [];
const ev = (d, hora, contexto, destino, preview, extra = {}) => {
  const t = em(d, hora); if (!passou(t)) return;
  atividade.push({ data: d, ts: new Date(t).toISOString(), quando: hora, contexto, destino: extra.grupo ? destino : cap(destino), grupo: !!extra.grupo, midia: !!extra.midia, ok: extra.ok !== false, erro: extra.erro || '', preview: corta(preview, 80), texto: preview });
};
for (let n = -6; n <= 0; n++) {
  const d = dia(n); if (wd(d) === 0) continue;
  const doDia = Object.values(aulas).filter(a => a.dia === d);
  const amanha = Object.values(aulas).filter(a => a.dia === dia(n + 1));
  for (const a of doDia) ev(d, '06:30', 'Confirmação — aula de hoje', a.nome.split(' ')[0], `Bom dia, ${a.nome.split(' ')[0][0] + a.nome.split(' ')[0].slice(1).toLowerCase()}! Passando para confirmar sua aula experimental hoje às ${a.hora} 💪`);
  for (const a of amanha) ev(d, '18:00', 'Confirmação — aula de amanhã', a.nome.split(' ')[0], `Oi! Sua aula experimental é amanhã às ${a.hora}. Podemos confirmar? 😊`);
  for (const a of Object.values(aulas).filter(a => a.dia === dia(n - 1) && a.status === 'Presença' && !a.contrato)) ev(d, '10:00', 'Follow-up pós-aula', a.nome.split(' ')[0], 'Oi! Aqui é a professora da sua aula de ontem 💛 O que achou da experiência?', { midia: true });
  for (const a of Object.values(aulas).filter(a => a.dia === d && a.status === 'Falta')) ev(d, '20:15', 'Faltou (no-show) — convite para remarcar', a.nome.split(' ')[0], 'Oi! Sentimos sua falta hoje 😕 Quer remarcar sua aula experimental?');
  ev(d, '07:00', 'Aniversário', 'SlimFit Alunas 💪', `🎉 Hoje é dia de festa! Parabéns, ${pick(ALUNAS).primeiro}! Muita saúde e muitos treinos 💛`, { grupo: true, midia: true });
  ev(d, '19:45', 'Resumo do dia', 'SlimFit Equipe 💪', `📊 Resumo de hoje: ${doDia.length} experimentais · ${doDia.filter(a => a.status === 'Presença').length} vieram · ${doDia.filter(a => a.contrato).length} fecharam`, { grupo: true });
  if (n === -2) ev(d, '09:10', 'Renovação de contrato', pick(ALUNAS).primeiro, 'Oi! Seu plano vence semana que vem — quer que a gente já deixe a renovação pronta? 💛');
  if (n === -1) ev(d, '09:12', 'Renovação de contrato', pick(ALUNAS).primeiro, 'Oi! Seu plano vence semana que vem — quer que a gente já deixe a renovação pronta? 💛', { ok: false, erro: 'número sem WhatsApp' });
  // cobrança (pela SoFIA)
  const tCob = em(d, '12:05');
  if (passou(tCob) && n % 2 === 0) atividadeSofia.push({ data: d, ts: new Date(tCob).toISOString(), quando: '12:05', contexto: 'Cobrança — boleto', destino: pick(ALUNAS).tel, grupo: false, midia: false, ok: true, erro: '', preview: 'Oi! 💜 Passando pra lembrar que o boleto da sua mensalidade venceu…', texto: 'Oi! 💜 Passando pra lembrar que o boleto da sua mensalidade venceu. Segue o link para pagamento.' });
}
atividade.sort((a, b) => a.ts.localeCompare(b.ts));

// ── formulário (acessos e agendamentos) ──────────────────────────────────────
const indicadores = [];
for (let n = -29; n <= 0; n++) {
  const d = dia(n);
  const acessos = entre(18, 55);
  for (let j = 0; j < acessos; j++) {
    const hh = pick(['07', '08', '09', '11', '12', '13', '18', '19', '20', '21', '22']) + ':' + pad(entre(0, 59));
    if (!passou(em(d, hh))) continue;
    const vid = 'v' + d.replace(/-/g, '') + (j % Math.max(1, Math.floor(acessos * 0.7)));
    indicadores.push({ id: `a-${d}-${j}`, tipo: 'acesso', origem: pick(['instagram', 'instagram', 'sofia', 'google', 'site']), vid, hora: '', dia: d, quando: hh, tsForm: '' });
    if (rnd() < 0.09) indicadores.push({ id: `g-${d}-${j}`, tipo: 'agendou', origem: pick(['instagram', 'sofia', 'site']), vid, hora: pick(HORAS), dia: d, quando: hh, tsForm: '' });
  }
}

// ── campanhas ────────────────────────────────────────────────────────────────
const camp = (id, nome, status, enviadosQtd, pendQtd, desdeDias) => {
  const base = em(dia(-desdeDias), '09:00');
  const alvos = [...EX, ...LEADS];
  return {
    id, nome, tag: status === 'concluida' ? T.ex : T.fez,
    textoBase: 'Oi {nome}! 💛 Sentimos sua falta por aqui. Neste mês temos condição especial — quer receber os horários disponíveis?',
    variacoes: [], limiteDia: 40, delayMinSeg: 60, delayMaxSeg: 180, janelaIni: '09:00', janelaFim: '19:00', dataInicio: dia(-desdeDias),
    status, pendentes: alvos.slice(enviadosQtd, enviadosQtd + pendQtd).map(p => ({ tel: p.tel, nome: p.primeiro })),
    enviados: alvos.slice(0, enviadosQtd).map((p, k) => ({ tel: p.tel, nome: p.primeiro, em: base + k * 150000 })),
    falhas: [], enviadosHoje: status === 'enviando' ? Math.min(enviadosQtd, 12) : 0, diaRef: hoje, proxEnvioEm: AGORA + 120000, criadoEm: base - 3600e3, atualizadoEm: AGORA,
  };
};
const campanhas = [camp('demo-c1', 'Volta às aulas — ex-alunas', 'concluida', 8, 0, 9), camp('demo-c2', 'Black November — quem fez experimental', 'enviando', 12, 9, 1)];

// ── Saúde: status dos WhatsApps e batimento dos envios ───────────────────────
const statusOk = { estado: 'conectado', qr: null, atualizadoEm: new Date(AGORA - 40000).toISOString() };
let registrados = {};
try {
  const cfg = require('./config');
  for (const [k, expr] of Object.entries(cfg.schedule || {})) if (expr) registrados[k] = { expr: String(expr), tz: TZ, desde: new Date(AGORA - 30 * 86400e3).toISOString() };
} catch (_) {}
const disparos = {}; for (const k of Object.keys(registrados)) disparos[k] = new Date(AGORA - 60000).toISOString();

// ── arquivos-base da SoFIA (prompt, extração, mídias, regras) — só se faltarem ──
{
  const CHATBOT = path.resolve(__dirname, '..', '..', 'ChatBot');
  for (const f of ['sofia-prompt.default.txt', 'sofia-extracao.default.txt', 'sofia-midias.default.txt', 'sofia-regras.default.json']) {
    try { const dst = path.join(SOFIA, f); if (!fs.existsSync(dst) && fs.existsSync(path.join(CHATBOT, f))) fs.copyFileSync(path.join(CHATBOT, f), dst); } catch (_) {}
  }
}

// ── grava tudo ───────────────────────────────────────────────────────────────
gravar(path.join(SOFIA, 'sofia-conversas.json'), conversas);
gravar(path.join(SOFIA, 'sofia-tag-log.jsonl'), tagLog.filter(e => passou(e.em)).map(e => JSON.stringify(e)).join('\n') + '\n');
gravar(path.join(SOFIA, 'sofia-encerradas.json'), encerradas);
gravar(path.join(SOFIA, 'sofia-custo.jsonl'), custo.map(e => JSON.stringify(e)).join('\n') + '\n');
gravar(path.join(SOFIA, 'sofia-wa-status.json'), { estado: 'conectado', qr: '', codigo: '', atualizadoEm: statusOk.atualizadoEm });
gravar(path.join(SOFIA, 'campanhas.json'), campanhas);
gravar(path.join(SOFIA, 'sofia-agendaram-canal.json'), agendaramCanal);
gravar(path.join(SOFIA, 'sofia-lid-stats.json'), { mapeados: 14, semTel: 0, ultimoSemTelEm: 0, semTelLista: [], em: AGORA });
gravar(path.join(SOFIA, 'sofia-estado.txt'), 'on');
gravar(path.join(DATA, 'contatos.json'), contatos);
gravar(path.join(DATA, 'experimentais-historico.json'), { aulas, lidos, status: { estado: 'ok', inicio: AGORA - 600000, fim: AGORA - 540000, msg: 'leitura concluída', dias: 37, aulas: Object.keys(aulas).length }, cfg: { desde: dia(-30) } });
gravar(path.join(DATA, 'alunas-ativas-historico.json'), {
  ultimo: { dia: hoje, ids: idsAtivos }, pessoas: pesAtivas,
  dias: { [dia(-1)]: { ativas: serAtivas[serAtivas.length - 2], trancadas: 4, entraram: serEntr[serEntr.length - 2], sairam: serSai[serSai.length - 2] }, [hoje]: { ativas: idsAtivos.length, trancadas: 5, entraram: serEntr[serEntr.length - 1], sairam: serSai[serSai.length - 1] } },
  reconstruido: { inicio: inicioSerie, ativas: serAtivas, entraram: serEntr, novas: serNovas, sairam: serSai },
});
gravar(path.join(DATA, 'atividade.json'), atividade);
gravar(path.join(DATA, 'atividade-sofia.jsonl'), atividadeSofia.map(e => JSON.stringify(e)).join('\n') + (atividadeSofia.length ? '\n' : ''));
gravar(path.join(DATA, 'indicadores.json'), indicadores);
gravar(path.join(DATA, 'wa-status.json'), statusOk);
gravar(path.join(DATA, 'comparecimento.json'), { on: true, tagAgendou: T.agendou, tagsAgendou: [T.agendou], tagCompareceu: T.fez, tagFaltou: T.faltou, numeroRelatorio: '', criarNovos: false, diasJanela: 7, intervaloHoras: 0 });
gravar(path.join(DATA, 'auto-tag-alunas.json'), { on: true, tagAluna: T.aluna, tagExAluna: T.ex });
gravar(path.join(DATA, 'jobs-disparos.json'), { desde: new Date(AGORA - 30 * 86400e3).toISOString(), boot: new Date(AGORA - 3 * 86400e3).toISOString(), registrados, disparos, falhas: {} });

console.log(`demo-dados: ${Object.keys(conversas).length} conversas · ${Object.keys(contatos).length} contatos · ${Object.keys(aulas).length} experimentais · ${idsAtivos.length} alunas ativas · ${atividade.length} envios no log · ${indicadores.length} eventos do formulário.`);

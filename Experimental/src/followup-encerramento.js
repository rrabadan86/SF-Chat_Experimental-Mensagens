/**
 * ENCERRAMENTO da conversa (WhatsApp → Configuração → Follow-up e remarcação).
 * Serve para duas mensagens, cada uma com o seu texto e os seus horários:
 *   - origem 'followup': depois do follow-up pós-aula (ainda não fechou);
 *   - origem 'noshow':   depois do "Faltou (no-show) — convite para remarcar".
 *
 * 1) Todo envio dessas mensagens fica registrado aqui (telefone, nome,
 *    professora, manhã/tarde, quando saiu).
 * 2) No DIA SEGUINTE (horários "manhã" e "tarde", um para cada follow-up), o robô
 *    abre a conversa e confere:
 *      - ela respondeu (qualquer mensagem, figurinha, áudio) ou reagiu?  → nada;
 *      - alguém do studio escreveu à mão depois?                     → nada;
 *      - virou aluna (tag de aluna nos Contatos ou ativa no EVO)?      → nada;
 *      - agendou de novo (formulário, SoFIA ou Express) depois?       → nada;
 *      - nada disso → manda a mensagem de encerramento (voz da professora).
 *    Se não conseguir ler a conversa, NÃO envia. Uma vez por follow-up.
 *
 *   data/followups-enviados.json → { "<últimos8>|<dia do follow-up>": registro }
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');

const ARQ = path.resolve(__dirname, '..', 'data', 'followups-enviados.json');
const ATIVAS = path.resolve(__dirname, '..', 'data', 'alunas-ativas-historico.json');
const CONTEXTO = 'Follow-up — encerramento';
const ORIGENS = {
  followup: { msg: 'followup_encerramento', contexto: 'Follow-up — encerramento', origemMsg: 'followup' },
  noshow:   { msg: 'noshow_encerramento',   contexto: 'Faltou — encerramento',    origemMsg: 'no_show' },
};
const origemDe = (r) => (r && ORIGENS[r.origem]) ? r.origem : 'followup';
const ESPERA_MIN_MS = 18 * 3600e3;   // "dia seguinte": pelo menos 18h depois do follow-up
const ESPERA_MAX_MS = 4 * 86400e3;   // follow-up com mais de 4 dias: deixa para lá
const MAX_POR_VEZ = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ler() { try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function gravar(o) { try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); fs.writeFileSync(ARQ + '.tmp', JSON.stringify(o)); fs.renameSync(ARQ + '.tmp', ARQ); } catch (_) {} }
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const primeiro = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p && p === p.toUpperCase() ? p.charAt(0) + p.slice(1).toLowerCase() : p; };

// Chamado pelo follow-up pós-aula (origem 'followup', só "ainda não fechou") e
// pela mensagem de falta/no-show (origem 'noshow') a cada envio com sucesso.
function registrarFollowup({ telefone, nome, professora, periodo, origem = 'followup' }) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (!tel) return;
  const o = ler(), corte = Date.now() - 10 * 86400e3;
  for (const k of Object.keys(o)) if ((o[k].enviadoEm || 0) < corte) delete o[k];
  const org = ORIGENS[origem] ? origem : 'followup';
  o[`${tel.slice(-8)}|${hojeSP()}|${org}`] = { tel, nome: String(nome || ''), professora: String(professora || ''), periodo: periodo === 'afternoon' ? 'tarde' : 'manha', origem: org, enviadoEm: Date.now() };
  gravar(o);
}

// Virou aluna? Tag de aluna nos Contatos ou ativa na leitura do EVO (pelo celular).
function virouAluna(tel) {
  const l8 = String(tel || '').replace(/\D/g, '').slice(-8);
  try {
    const tagAluna = String(require('./auto-tag-alunas').ler().tagAluna || '0. Aluna').trim().toLowerCase();
    const r = require('./contatos').acharPorTel(tel);
    if (r && r.contato && (r.contato.tags || []).some(t => String(t).trim().toLowerCase() === tagAluna)) return true;
  } catch (_) {}
  try {
    const h = JSON.parse(fs.readFileSync(ATIVAS, 'utf8'));
    const ids = new Set(((h.ultimo || {}).ids || []).map(String));
    for (const [id, p] of Object.entries(h.pessoas || {})) {
      if (ids.has(String(id)) && p && p.tel && String(p.tel).replace(/\D/g, '').slice(-8) === l8) return true;
    }
  } catch (_) {}
  return false;
}

// Agendou de novo depois do envio? (todo agendamento — formulário, SoFIA, Express —
// fica no histórico de tags com motivo 'agendou').
function agendouDepois(tel, desde) {
  try {
    const evs = require('./sofia-editor').lerTagLog()[String(tel || '').replace(/\D/g, '').slice(-8)] || [];
    return evs.some(e => e.acao === 'add' && e.motivo === 'agendou' && (e.em || 0) >= desde);
  } catch (_) { return false; }
}

async function situacao(wa, r) {
  const c = await wa.conferirResposta(r.tel, r.enviadoEm);
  if (c.respondeu) return c.reagiu ? 'reagiu' : 'respondeu';
  if (c.humano) return 'recepcao';
  if (virouAluna(r.tel)) return 'aluna';
  if (agendouDepois(r.tel, r.enviadoEm)) return 'agendou';
  return 'silencio';
}
const MOTIVO = { respondeu: 'respondeu', reagiu: 'reagiu à mensagem', recepcao: 'a recepção já falou com ela', aluna: 'virou aluna', agendou: 'agendou de novo' };
const texto = (r) => mensagens.render(ORIGENS[origemDe(r)].msg, { nome: primeiro(r.nome), professora: primeiro(r.professora) || 'a professora' });

// periodo (opcional): 'manha' | 'tarde' — cada horário cuida de um envio.
// origem (opcional): 'followup' | 'noshow'.
async function runEncerramento({ log = console.log, dry = false, periodo = '', origem = '' } = {}) {
  const o = ler(), agora = Date.now();
  const fila = Object.entries(o).filter(([, r]) => !r.teste && (!periodo || r.periodo === periodo) && (!origem || origemDe(r) === origem) && !r.encerrado && !r.resolvido
    && agora - (r.enviadoEm || 0) >= ESPERA_MIN_MS && agora - (r.enviadoEm || 0) <= ESPERA_MAX_MS);
  log(`👋 Encerramento${origem ? ` (${origem === 'noshow' ? 'faltou' : 'follow-up'})` : ''}${periodo ? ` (${periodo})` : ''}: ${fila.length} para conferir.`);
  if (fila.length > MAX_POR_VEZ) throw new Error(`${fila.length} de uma vez (limite ${MAX_POR_VEZ}) — não enviei nada.`);
  const wa = require('./wa-client');
  const res = { enviadas: 0, puladas: 0, erros: 0 };
  for (const [k, r] of fila) {
    let st;
    try { st = await situacao(wa, r); } catch (e) { res.erros++; log(`   ⚠️  ${r.nome}: não consegui ler a conversa (${e.message}) — não enviei.`); continue; }
    if (st !== 'silencio') { o[k].resolvido = { motivo: st, em: Date.now() }; res.puladas++; log(`   ✅ ${r.nome}: ${MOTIVO[st]} — não precisa.`); continue; }
    if (dry) { log(`   🧪 ${r.nome}: receberia o encerramento.`); res.enviadas++; continue; }
    try {
      await wa.sendTexto(r.tel, texto(r), ORIGENS[origemDe(r)].contexto, ORIGENS[origemDe(r)].msg);
      o[k].encerrado = { em: Date.now() }; res.enviadas++;
      log(`   👋 ${r.nome}: encerramento enviado.`);
    } catch (e) { res.erros++; log(`   ⚠️  ${r.nome}: não enviei — ${e.message}`); }
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (!dry) gravar(o);
  log(`👋 Encerramento: ${res.enviadas} ${dry ? 'simulado(s)' : 'enviado(s)'}, ${res.puladas} responderam/atendidas/alunas, ${res.erros} erro(s).`);
  return res;
}

// ── Teste pelo painel (card do encerramento → 🧪 Testar com o seu número) ──
// 1) followup: manda um follow-up de TESTE para o número e registra;
// 2) conferir: confere a conversa AGORA (sem esperar o dia seguinte) e manda o encerramento se não houve resposta.
async function testar({ etapa, tel, origem = 'followup' } = {}) {
  const t = String(tel || '').replace(/\D/g, '');
  if (t.length < 10) throw new Error('número de teste inválido');
  const org = ORIGENS[origem] ? origem : 'followup';
  const wa = require('./wa-client');
  const o = ler(), k = `${t.slice(-8)}|teste|${org}`;
  if (etapa === 'followup' || etapa === 'enviar') {
    const msg = '🧪 *TESTE* — ' + mensagens.render(ORIGENS[org].origemMsg, { nome: 'Teste', professora: 'Professora', horario: '14:00' });
    await wa.sendTexto(t, msg, ORIGENS[org].contexto + ' (teste)', ORIGENS[org].origemMsg);
    o[k] = { tel: t, nome: 'Teste', professora: 'Professora', periodo: 'manha', origem: org, enviadoEm: Date.now(), teste: true };
    gravar(o);
    return { msg: `${org === 'noshow' ? 'Mensagem de falta' : 'Follow-up'} de teste enviado. Agora responda, reaja ou ignore no celular e clique em "2) Conferir agora".` };
  }
  const r = o[k];
  if (!r) throw new Error('mande primeiro a mensagem de teste (botão 1).');
  const c = await wa.conferirResposta(r.tel, r.enviadoEm).catch(e => { throw new Error('não consegui ler a conversa: ' + e.message); });
  const st = c.respondeu ? (c.reagiu ? 'reagiu' : 'respondeu') : c.humano ? 'recepcao' : 'silencio';
  if (st !== 'silencio') return { msg: `Resultado: ${MOTIVO[st]} → o encerramento NÃO seria enviado (está certo).` };
  if (r.encerrado) return { msg: 'Continua sem resposta. O encerramento já foi enviado neste teste. Para repetir, comece pelo botão 1.' };
  await wa.sendTexto(t, texto(r), ORIGENS[org].contexto + ' (teste)', ORIGENS[org].msg);
  o[k].encerrado = { em: Date.now() }; gravar(o);
  return { msg: 'Sem resposta → mensagem de encerramento enviada. Teste concluído.' };
}

module.exports = { registrarFollowup, runEncerramento, testar, ler, virouAluna, agendouDepois, CONTEXTO };

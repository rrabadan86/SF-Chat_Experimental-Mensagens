/**
 * Confirmação SEM RESPOSTA (WhatsApp → Configuração → Confirmação de aula).
 *
 * 1) Toda confirmação de aula (hoje / amanhã) que o robô manda fica registrada
 *    aqui: telefone, nome, dia e hora da aula, quando saiu.
 * 2) "2ª mensagem" (semResposta1/semResposta2): para cada confirmação de ~1h30+
 *    atrás, com a aula ainda pela frente, o robô abre a conversa e confere:
 *      - ela respondeu (qualquer mensagem) ou reagiu (❤️ 👍…)?  → não manda nada;
 *      - alguém do studio escreveu à mão depois?               → não manda nada;
 *      - nada disso                                           → manda a 2ª mensagem.
 * 3) "Lista da equipe" (semRespostaEquipe1/2): quem recebeu a 2ª mensagem e
 *    continua sem responder (aula ainda pela frente) vai numa lista no grupo da
 *    equipe, para a recepção ligar ou mandar áudio. Cada pessoa entra uma vez.
 *
 * Se não conseguir ler a conversa, NÃO envia (melhor não incomodar quem respondeu).
 *   data/confirmacoes-enviadas.json → { "<últimos8>|<dataAula>": registro }
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');

const ARQ = path.resolve(__dirname, '..', 'data', 'confirmacoes-enviadas.json');
const CONTEXTO_2A = 'Confirmação — sem resposta (2ª mensagem)';
const CONTEXTO_EQUIPE = 'Confirmação — sem resposta (lista da equipe)';
const ESPERA_2A_MS = 90 * 60 * 1000;      // 2ª mensagem só 1h30+ depois da confirmação
const ESPERA_LISTA_MS = 45 * 60 * 1000;   // lista só 45 min+ depois da 2ª mensagem
const ANTECEDENCIA_MS = 45 * 60 * 1000;   // não manda a 2ª se a aula é em menos de 45 min
const MAX_POR_VEZ = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ler() { try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function gravar(o) {
  try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); fs.writeFileSync(ARQ + '.tmp', JSON.stringify(o)); fs.renameSync(ARQ + '.tmp', ARQ); } catch (_) {}
}
const hojeSP = (desloc = 0) => new Date(Date.now() + desloc * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
// 'YYYY-MM-DD' + 'HH:MM' (Brasília) → ms
function aulaMs(r) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(r.horario || ''));
  if (!r.dataAula || !m) return 0;
  return Date.parse(`${r.dataAula}T${m[1].padStart(2, '0')}:${m[2]}:00-03:00`) || 0;
}
const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p && p === p.toUpperCase() ? p.charAt(0) + p.slice(1).toLowerCase() : p; };
const nomeBonito = (n) => String(n || '').toLowerCase().replace(/(^|\s)(\S)/g, (x, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (x) => x.toLowerCase());
function quandoDe(r) {
  if (r.dataAula === hojeSP()) return 'hoje';
  if (r.dataAula === hojeSP(1)) return 'amanhã';
  const [, mm, dd] = String(r.dataAula).split('-'); return dd ? `no dia ${dd}/${mm}` : '';
}
function fmtTel(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t;
}

// Chamado pelo whatsapp-sender a cada confirmação enviada com sucesso.
function registrarEnvio({ telefone, nome, horario, chave }) {
  if (chave !== 'confirmacao_hoje' && chave !== 'confirmacao_amanha') return;
  const tel = String(telefone || '').replace(/\D/g, '');
  if (!tel) return;
  const dataAula = chave === 'confirmacao_hoje' ? hojeSP() : hojeSP(1);
  const o = ler();
  const corte = Date.now() - 4 * 86400000;
  for (const k of Object.keys(o)) if ((o[k].enviadoEm || 0) < corte) delete o[k];
  o[`${tel.slice(-8)}|${dataAula}`] = { tel, nome: String(nome || ''), horario: String(horario || '').slice(0, 5), dataAula, chave, enviadoEm: Date.now() };
  gravar(o);
}

// Conferência da conversa → 'respondeu' | 'recepcao' | 'silencio' (lança se não conseguir ler).
async function situacao(wa, r) {
  const c = await wa.conferirResposta(r.tel, r.enviadoEm);
  if (c.respondeu) return c.reagiu ? 'reagiu' : 'respondeu';
  if (c.humano) return 'recepcao';
  return 'silencio';
}
const MOTIVO = { respondeu: 'respondeu', reagiu: 'reagiu à mensagem', recepcao: 'a recepção já falou com ela' };

// chave (opcional): só as confirmações daquele tipo ('confirmacao_hoje' | 'confirmacao_amanha').
async function runSegundaMensagem({ log = console.log, dry = false, chave = '' } = {}) {
  const o = ler(), agora = Date.now();
  const fila = Object.entries(o).filter(([, r]) => !r.teste && (!chave || r.chave === chave) && !r.segunda && !r.resolvido && agora - (r.enviadoEm || 0) >= ESPERA_2A_MS && aulaMs(r) - agora >= ANTECEDENCIA_MS);
  log(`📵 Confirmação sem resposta — 2ª mensagem: ${fila.length} para conferir.`);
  if (fila.length > MAX_POR_VEZ) throw new Error(`${fila.length} de uma vez (limite ${MAX_POR_VEZ}) — não enviei nada.`);
  const wa = require('./wa-client');
  const res = { enviadas: 0, puladas: 0, erros: 0 };
  for (const [k, r] of fila) {
    let st;
    try { st = await situacao(wa, r); } catch (e) { res.erros++; log(`   ⚠️  ${r.nome}: não consegui ler a conversa (${e.message}) — não enviei.`); continue; }
    if (st !== 'silencio') { o[k].resolvido = { motivo: st, em: Date.now() }; res.puladas++; log(`   ✅ ${r.nome}: ${MOTIVO[st]} — não precisa.`); continue; }
    const texto = mensagens.render('confirmacao_sem_resposta', { nome: primeiroNome(r.nome), horario: r.horario, quando: quandoDe(r) });
    if (dry) { log(`   🧪 ${r.nome}: receberia a 2ª mensagem.`); res.enviadas++; continue; }
    try {
      await wa.sendTexto(r.tel, texto, CONTEXTO_2A, 'confirmacao_sem_resposta');
      o[k].segunda = { em: Date.now() }; res.enviadas++;
      log(`   📨 ${r.nome}: 2ª mensagem enviada (aula ${quandoDe(r)} às ${r.horario}).`);
    } catch (e) { res.erros++; log(`   ⚠️  ${r.nome}: não enviei — ${e.message}`); }
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (!dry) gravar(o);
  log(`📵 2ª mensagem: ${res.enviadas} ${dry ? 'simulada(s)' : 'enviada(s)'}, ${res.puladas} já responderam/atendidas, ${res.erros} erro(s).`);
  return res;
}

async function runListaEquipe({ log = console.log, dry = false, chave = '' } = {}) {
  const o = ler(), agora = Date.now();
  const fila = Object.entries(o).filter(([, r]) => !r.teste && (!chave || r.chave === chave) && r.segunda && !r.listado && !r.resolvido && agora - (r.segunda.em || 0) >= ESPERA_LISTA_MS && aulaMs(r) > agora);
  log(`📵 Confirmação sem resposta — lista da equipe: ${fila.length} para conferir.`);
  const wa = require('./wa-client');
  const lista = [];
  for (const [k, r] of fila) {
    let st;
    try { st = await situacao(wa, r); } catch (e) { st = 'silencio'; log(`   ⚠️  ${r.nome}: não consegui ler a conversa (${e.message}) — entra na lista por segurança.`); }
    if (st !== 'silencio') { o[k].resolvido = { motivo: st, em: Date.now() }; log(`   ✅ ${r.nome}: ${MOTIVO[st]}.`); continue; }
    lista.push([k, r]);
  }
  if (lista.length) {
    lista.sort((a, b) => aulaMs(a[1]) - aulaMs(b[1]));
    const linhas = lista.map(([, r]) => `• ${r.horario} (${quandoDe(r)}) — ${nomeBonito(r.nome)} — ${fmtTel(r.tel)}`).join('\n');
    const texto = mensagens.render('confirmacao_sem_resposta_equipe', { lista: linhas });
    if (dry) log('   🧪 Lista que iria para a equipe:\n' + texto);
    else {
      await wa.sendGrupo(require('./grupos').equipe(), texto, CONTEXTO_EQUIPE);
      for (const [k] of lista) o[k].listado = { em: Date.now() };
      log(`   📣 Lista com ${lista.length} pessoa(s) postada no grupo da equipe.`);
    }
  }
  if (!dry) gravar(o);
  return { listadas: lista.length };
}

// ── Teste pelo painel (card da 2ª mensagem → 🧪 Testar com o seu número) ──
// 1) confirmar: manda uma confirmação de TESTE para o número e registra;
// 2) conferir:  confere a conversa AGORA (sem esperar 1h30) e manda a 2ª mensagem se ela não respondeu;
// 3) lista:     a lista que iria para o grupo da equipe vai para o próprio número de teste.
async function testar({ etapa, tel, log = console.log } = {}) {
  const t = String(tel || '').replace(/\D/g, '');
  if (t.length < 10) throw new Error('número de teste inválido');
  const wa = require('./wa-client');
  const o = ler(), k = `${t.slice(-8)}|teste`;
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  if (etapa === 'confirmar') {
    const horario = hhmm(Date.now() + 3 * 3600e3);
    const texto = '🧪 *TESTE* — ' + mensagens.render('confirmacao_hoje', { nome: 'Teste', horario, professora: '', data: '' });
    await wa.sendTexto(t, texto, 'Confirmação — sem resposta (teste)', 'confirmacao_hoje');
    o[k] = { tel: t, nome: 'Teste', horario, dataAula: hojeSP(), chave: 'teste', enviadoEm: Date.now(), teste: true };
    gravar(o);
    return { msg: 'Confirmação de teste enviada. Agora responda, reaja ou ignore no celular e clique em "2) Conferir agora".' };
  }
  const r = o[k];
  if (!r) throw new Error('mande primeiro a confirmação de teste (botão 1).');
  let st;
  try { st = await situacao(wa, r); } catch (e) { throw new Error('não consegui ler a conversa: ' + e.message); }
  log(`🧪 Teste sem resposta (${etapa}): ${st}`);
  if (st !== 'silencio') return { msg: `Resultado: ${MOTIVO[st]} → nada seria enviado (está certo).` };
  if (etapa === 'conferir') {
    if (r.segunda) return { msg: 'Continua sem resposta. A 2ª mensagem já foi enviada neste teste → clique em "3) Lista da equipe".' };
    await wa.sendTexto(t, mensagens.render('confirmacao_sem_resposta', { nome: 'Teste', horario: r.horario, quando: 'hoje' }), 'Confirmação — sem resposta (teste)', 'confirmacao_sem_resposta');
    o[k].segunda = { em: Date.now() }; gravar(o);
    return { msg: 'Sem resposta → 2ª mensagem enviada. Responda/reaja ou ignore e clique em "3) Lista da equipe".' };
  }
  if (etapa === 'lista') {
    if (!r.segunda) return { msg: 'Primeiro clique em "2) Conferir agora" (a lista só inclui quem recebeu a 2ª mensagem).' };
    const texto = '🧪 *TESTE* (iria para o grupo da equipe)\n\n' + mensagens.render('confirmacao_sem_resposta_equipe', { lista: `• ${r.horario} (hoje) — Teste — ${fmtTel(t)}` });
    await wa.sendTexto(t, texto, 'Confirmação — sem resposta (teste)');
    delete o[k]; gravar(o);
    return { msg: 'Continua sem resposta → a lista da equipe foi enviada para o seu número de teste. Teste concluído.' };
  }
  throw new Error('etapa desconhecida');
}

module.exports = { registrarEnvio, runSegundaMensagem, runListaEquipe, testar, ler, aulaMs, CONTEXTO_2A, CONTEXTO_EQUIPE };

if (require.main === module) {
  (async () => {
    const dry = !process.argv.includes('--enviar');
    await require('./wa-client').initWhatsApp();
    if (process.argv.includes('--lista')) await runListaEquipe({ dry }); else await runSegundaMensagem({ dry });
    process.exit(0);
  })().catch(e => { console.error('❌', e.message); process.exit(1); });
}

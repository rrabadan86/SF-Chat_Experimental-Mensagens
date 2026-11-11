/**
 * RETOMADA pelo número do STUDIO de quem parou de responder a SoFIA
 * (WhatsApp → Configuração → Leads da SoFIA).
 *
 * Automatiza o que a recepção faz com o filtro "😴 Sem resposta há 24h+ (Nd)"
 * das Conversas da SoFIA: para cada conversa em que a ÚLTIMA mensagem da pessoa
 * foi há 24h+ (e dentro dos últimos N dias — mesma janela do filtro, em SoFIA →
 * Configuração), o robô manda pelo número do Studio a mensagem de retomada.
 *
 * Fica de fora quem:
 *   - já recebeu mensagem do Studio depois de parar de responder (recepção à mão
 *     ou o próprio robô) ou escreveu para o Studio;
 *   - agendou (histórico de tags 'agendou' nos últimos 30 dias), virou aluna ou
 *     tem tag de "sem interesse";
 *   - está bloqueada ou em "não responder" na SoFIA;
 *   - só mandou resposta automática; ou não tem telefone (conversa só com LID).
 * Uma vez por período de silêncio: se ela voltar a falar com a SoFIA e esfriar de
 * novo, pode receber outra vez. Sem conseguir ler a conversa do Studio, não envia.
 *
 *   data/retomada-sofia.json → { "<últimos8>": { ultimaContato, enviadoEm, nome } }
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');

const ARQ = path.resolve(__dirname, '..', 'data', 'retomada-sofia.json');
const CONTEXTO = 'Retomada — parou de responder a SoFIA';
const MAX_POR_VEZ = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ler() { try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function gravar(o) { try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); fs.writeFileSync(ARQ + '.tmp', JSON.stringify(o)); fs.renameSync(ARQ + '.tmp', ARQ); } catch (_) {} }
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const primeiro = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''; };
// Telefone de verdade (55 + DDD + número); chave só com LID não serve para o Studio.
function telefoneDe(chave) {
  const d = String(chave || '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return '55' + d;
  return '';
}

// Lista de quem está no ponto da retomada (sem conferir o WhatsApp do Studio).
function candidatas(agora = Date.now()) {
  const sofia = require('./sofia-editor');
  const fe = require('./followup-encerramento');
  let cfg = { horas: 24, dias: 3 }; try { cfg = sofia.lerQuietoCfg(); } catch (_) {}
  const minMs = cfg.horas * 3600e3, maxMs = cfg.dias * 86400e3;
  let convs = {}; try { convs = sofia.conversas() || {}; } catch (_) {}
  let contatos = null; try { contatos = require('./contatos'); } catch (_) {}
  let tagAluna = '0. aluna'; try { tagAluna = semAcento(require('./auto-tag-alunas').ler().tagAluna || tagAluna).trim(); } catch (_) {}
  const reg = ler();
  const out = [];
  for (const [chave, c] of Object.entries(convs)) {
    const msgs = Array.isArray(c && c.msgs) ? c.msgs : [];
    let ult = 0;
    for (const m of msgs) if (m && m.autor === 'aluna' && m.tipo !== 'automatica' && (m.em || 0) > ult) ult = m.em;
    if (!ult) continue;
    const dt = agora - ult;
    if (dt < minMs || dt > maxMs) continue;
    const tel = telefoneDe(chave);
    const l8 = tel.slice(-8) || String(chave).replace(/\D/g, '').slice(-8);
    const item = { chave, tel, nome: c.nome || '', ultimaContato: ult, motivo: '' };
    let ct = null; try { ct = contatos && contatos.acharPorTel(tel || chave); } catch (_) {}
    if (ct && ct.contato && ct.contato.nome) item.nome = ct.contato.nome;
    const tags = ((ct && ct.contato && ct.contato.tags) || []).map(semAcento);
    if (!tel) item.motivo = 'sem telefone (conversa só com LID)';
    else if (reg[l8] && reg[l8].ultimaContato === ult) item.motivo = 'já recebeu a retomada neste período';
    else if (tags.includes(tagAluna) || fe.virouAluna(tel)) item.motivo = 'é aluna';
    else if (tags.some(t => /sem interesse/.test(t))) item.motivo = 'tag "sem interesse"';
    else if (fe.agendouDepois(tel, agora - 30 * 86400e3)) item.motivo = 'agendou aula experimental';
    else { try { if (sofia.estaBloqueado(chave) || sofia.estaNaoResponder(chave)) item.motivo = 'bloqueada / "não responder" na SoFIA'; } catch (_) {} }
    out.push(item);
  }
  return out.sort((a, b) => a.ultimaContato - b.ultimaContato);
}

async function runRetomada({ log = console.log, dry = false } = {}) {
  const lista = candidatas();
  const fila = lista.filter(x => !x.motivo);
  log(`💬 Retomada (parou de responder a SoFIA): ${lista.length} na janela, ${fila.length} para conferir.`);
  for (const x of lista.filter(x => x.motivo)) log(`   ⏭️  ${x.nome || x.chave}: ${x.motivo}`);
  if (fila.length > MAX_POR_VEZ) throw new Error(`${fila.length} de uma vez (limite ${MAX_POR_VEZ}) — não enviei nada.`);
  const wa = require('./wa-client');
  const reg = ler();
  const res = { enviadas: 0, puladas: 0, erros: 0 };
  for (const x of fila) {
    let c;
    try { c = await wa.conferirResposta(x.tel, x.ultimaContato); }
    catch (e) { res.erros++; log(`   ⚠️  ${x.nome}: não consegui ler a conversa do Studio (${e.message}) — não enviei.`); continue; }
    const l8 = x.tel.slice(-8);
    if (c.humano || c.respondeu) {
      reg[l8] = { ultimaContato: x.ultimaContato, pulado: c.humano ? 'recepcao' : 'falou-com-studio', em: Date.now(), nome: x.nome };
      res.puladas++; log(`   ✅ ${x.nome}: ${c.humano ? 'a recepção já mandou mensagem pelo Studio' : 'já falou com o Studio'} — não precisa.`);
      continue;
    }
    if (dry) { log(`   🧪 ${x.nome}: receberia a retomada.`); res.enviadas++; continue; }
    try {
      await wa.sendTexto(x.tel, mensagens.render('retomada_sofia', { nome: primeiro(x.nome) }), CONTEXTO, 'retomada_sofia');
      reg[l8] = { ultimaContato: x.ultimaContato, enviadoEm: Date.now(), nome: x.nome };
      res.enviadas++; log(`   💬 ${x.nome}: retomada enviada.`);
    } catch (e) { res.erros++; log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`); }
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (!dry) {
    const corte = Date.now() - 60 * 86400e3;
    for (const k of Object.keys(reg)) if ((reg[k].em || reg[k].enviadoEm || 0) < corte) delete reg[k];
    gravar(reg);
  }
  log(`💬 Retomada: ${res.enviadas} ${dry ? 'simulada(s)' : 'enviada(s)'}, ${res.puladas} já atendidas pelo Studio, ${res.erros} erro(s).`);
  return res;
}

module.exports = { candidatas, runRetomada, ler, CONTEXTO };

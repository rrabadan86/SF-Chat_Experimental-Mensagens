/**
 * saidas-grupos.js — Quem NÃO renovou: retira dos grupos do WhatsApp e manda a
 * mensagem de despedida (WhatsApp → Configuração, card "Saída — não renovou").
 *
 * Regras (pedidas pelo Studio):
 *   - Saída = o contrato SlimFit venceu há 7 dias (ou mais, até 17) e ela NÃO
 *     renovou: não está ativa (trancada conta como ativa), não tem contrato na
 *     FILA (fila = renovou) e não tem Circuito/VIP vigente (continua cliente).
 *   - Primeiro RETIRA de todos os grupos em comum com o número do Studio (o
 *     Studio precisa ser administrador); depois confere e, se saiu de pelo menos
 *     um, manda a mensagem. Se não está em nenhum grupo, NÃO manda mensagem.
 *   - Cada saída é tratada uma vez só (registro em data/saidas-grupos.json).
 *
 * Fonte: data/alunas-ativas-historico.json (run_ativas_foto.py, 05:25 todo dia).
 * O telefone vem dos Contatos (o código do EVO gravado pela sincronização de
 * alunas). Travas: só roda com a foto de HOJE; mais de 15 saídas num dia = leitura
 * suspeita → não mexe em ninguém e avisa.
 *
 * Uso manual:  node src/saidas-grupos.js --dry   (mostra quem sairia, não mexe)
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const ATIVAS = path.join(DATA, 'alunas-ativas-historico.json');
const REG = path.join(DATA, 'saidas-grupos.json');
const DIAS_VENCIDO = 7;   // tolerância: renovação com até 7 dias de atraso não é saída
const JANELA = 10;        // procura vencimentos de 7 a 17 dias atrás
const MAX_POR_DIA = 15;   // acima disso a leitura do EVO é suspeita
const CONTEXTO = 'Saída — não renovou';

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function somaDias(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const last8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function lerJson(arq, padrao) { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } }
function lerRegistro() { const o = lerJson(REG, {}); return { feitos: o.feitos || {}, ultimo: o.ultimo || null, ultimaAcao: o.ultimaAcao || null, ultimoSim: o.ultimoSim || null }; }
function gravarRegistro(r) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(REG, JSON.stringify(r, null, 2)); } catch (_) {} }

/**
 * Quem entra hoje (sem WhatsApp): [{ id, nome, fim, contrato, telefone, motivo }]
 * motivo vazio = vai ser processada; senão, por que fica de fora.
 */
function candidatas({ hoje = hojeSP() } = {}) {
  const h = lerJson(ATIVAS, {});
  const pes = h.pessoas || {};
  const reg = lerRegistro();
  let contatosMapa = {};
  try { contatosMapa = require('./contatos').carregar() || {}; } catch (_) {}
  const porIdEvo = new Map();
  for (const tel in contatosMapa) { const c = contatosMapa[tel]; if (c && c.idEvo) porIdEvo.set(String(c.idEvo), { tel, c }); }
  let tagAluna = '0. Aluna';
  try { tagAluna = require('./auto-tag-alunas').ler().tagAluna || tagAluna; } catch (_) {}
  const de = somaDias(hoje, -(DIAS_VENCIDO + JANELA)), ate = somaDias(hoje, -DIAS_VENCIDO);
  const out = [];
  for (const id of Object.keys(pes)) {
    const p = pes[id];
    if (!p || p.c != null) continue;                     // ativa hoje (inclui trancada)
    const iv = Array.isArray(p.iv) ? p.iv : [];
    if (!iv.length) continue;
    const fim = iv[iv.length - 1][1];
    if (!fim || fim < de || fim > ate) continue;          // venceu fora da janela 7–17 dias
    const cs = Array.isArray(p.cs) ? p.cs : [];
    const ult = cs.filter(c => c[1] === fim).pop() || cs[cs.length - 1] || [];
    const ct = porIdEvo.get(String(id));
    const item = { id, nome: (ct && ct.c.nome) || p.n || '', fim, contrato: ult[2] || '', telefone: ct ? ct.tel : '', motivo: '' };
    if (p.fq) item.motivo = `renovou (contrato na fila: ${p.fq[0] || 'novo contrato'}, começa ${p.fq[1] || ''})`;
    else if (p.cv) item.motivo = 'tem Circuito/VIP vigente (continua cliente)';
    else if (reg.feitos[`${id}|${fim}`]) item.motivo = 'já tratada em ' + String(reg.feitos[`${id}|${fim}`].em || '').slice(0, 10).split('-').reverse().join('/');
    else if (!ct) item.motivo = 'sem telefone nos Contatos (o código do EVO dela não está em nenhum contato)';
    else if ((ct.c.tags || []).some(t => norm(t) === norm(tagAluna))) item.motivo = `ainda está com a tag "${tagAluna}" nos Contatos`;
    out.push(item);
  }
  return { hoje, fotoDia: (h.ultimo && h.ultimo.dia) || '', de, ate, lista: out.sort((a, b) => a.fim.localeCompare(b.fim) || a.nome.localeCompare(b.nome)) };
}

async function runSaidasGrupos({ dry = false, log = console.log } = {}) {
  const atividade = require('./atividade');
  const mensagens = require('./mensagens');
  const c = candidatas();
  if (c.fotoDia !== c.hoje) throw new Error(`a leitura das alunas ativas de hoje (05:25) ainda não rodou (última: ${c.fotoDia || 'nunca'}) — não mexo em ninguém`);
  const fila = c.lista.filter(x => !x.motivo);
  log(`🚪 Saídas (venceu entre ${c.de} e ${c.ate}, não renovou): ${fila.length} para tratar, ${c.lista.length - fila.length} fora (renovou/Circuito/sem telefone/já tratada).`);
  for (const x of c.lista.filter(x => x.motivo)) log(`   ⏭️  ${x.nome} (venceu ${x.fim}): ${x.motivo}`);
  if (fila.length > MAX_POR_DIA) throw new Error(`${fila.length} saídas de uma vez (limite ${MAX_POR_DIA}) — parece leitura errada do EVO; não mexi em ninguém. Confira em Indicadores → Alunas ativas.`);

  const wa = require('./wa-client');
  const reg = lerRegistro();
  const res = { em: new Date().toISOString(), dry, tratadas: [], erros: 0 };
  for (const x of fila) {
    const nome1 = String(x.nome || '').trim().split(/\s+/)[0] || '';
    let grupos = [];
    try { grupos = await wa.getCommonGroups(x.telefone); }
    catch (e) { log(`   ⚠️  ${x.nome}: não consegui ver os grupos (${e.message}) — tento no próximo dia.`); res.erros++; continue; }
    if (!grupos.length) {
      log(`   ➖ ${x.nome}: não está em nenhum grupo — sem mensagem.`);
      if (!dry) reg.feitos[`${x.id}|${x.fim}`] = { em: res.em, nome: x.nome, grupos: [], semGrupo: true };
      res.tratadas.push({ nome: x.nome, grupos: [], enviou: false, motivo: 'sem grupo' });
      continue;
    }
    if (dry) {
      log(`   🧪 ${x.nome}: sairia de ${grupos.length} grupo(s): ${grupos.map(g => g.name || g.id).join(', ')} e receberia a mensagem.`);
      res.tratadas.push({ nome: x.nome, grupos: grupos.map(g => g.name || g.id), enviou: false, motivo: 'simulação' });
      continue;
    }
    const falhas = [];
    let naoAdmin = 0;
    for (const g of grupos) {
      const rot = g.name || g.id;
      try {
        await wa.removerDoGrupo(g.id, x.telefone);
        log(`   🚪 ${x.nome}: retirada de "${rot}"`);
      } catch (e) {
        if (e && e.code === 'NAO_ADMIN') naoAdmin++;
        falhas.push(`${rot}: ${e.message}`);
        log(`   ⚠️  ${x.nome}: não saiu de "${rot}" — ${e.message}`);
      }
      await sleep(3000);
    }
    // Confere de verdade: em quais grupos ela AINDA está.
    let depois = grupos;
    try { await sleep(2000); depois = await wa.getCommonGroups(x.telefone); } catch (_) {}
    const aindaIds = new Set(depois.map(g => g.id));
    const saiu = grupos.filter(g => !aindaIds.has(g.id));
    const ficou = grupos.filter(g => aindaIds.has(g.id));
    for (const g of saiu) atividade.registrar({ destino: g.name || 'grupo', grupo: true, ok: true, preview: `🚪 ${x.nome} retirada do grupo (não renovou)`, contexto: CONTEXTO });
    for (const g of ficou) atividade.registrar({ destino: g.name || 'grupo', grupo: true, ok: false, preview: `🚪 ${x.nome} — não consegui retirar do grupo`, erro: (falhas.find(f => f.startsWith((g.name || g.id) + ':')) || 'continua no grupo').replace(/^[^:]*:\s*/, ''), contexto: CONTEXTO });
    let enviou = false;
    if (saiu.length) {
      try {
        await wa.sendTexto(x.telefone, mensagens.render('saida_grupos', { nome: nome1 }), CONTEXTO, 'saida_grupos'); // foto do flyer, se houver
        enviou = true;
        log(`   ✉️  ${x.nome}: mensagem enviada (saiu de ${saiu.length} grupo(s)).`);
      } catch (e) { log(`   ⚠️  ${x.nome}: saiu dos grupos, mas a mensagem falhou — ${e.message}`); res.erros++; }
    } else {
      log(`   ⚠️  ${x.nome}: não saiu de nenhum grupo — mensagem NÃO enviada.`);
      res.erros++;
    }
    // Registra (não repete): saiu de algum grupo, ou o Studio não é admin de nenhum.
    if (saiu.length || (naoAdmin && naoAdmin === grupos.length)) {
      reg.feitos[`${x.id}|${x.fim}`] = { em: res.em, nome: x.nome, grupos: saiu.map(g => g.name || g.id), ficou: ficou.map(g => g.name || g.id), enviou };
    }
    res.tratadas.push({ nome: x.nome, grupos: saiu.map(g => g.name || g.id), ficou: ficou.map(g => g.name || g.id), enviou });
    await sleep(5000);
  }
  if (dry) { const r2 = lerRegistro(); r2.ultimoSim = res; gravarRegistro(r2); }
  if (!dry) {
    reg.ultimo = res;
    if (res.tratadas.length) reg.ultimaAcao = res; // a última que fez algo (o cartão mostra)
    const ks = Object.keys(reg.feitos).sort((a, b) => String(reg.feitos[a].em).localeCompare(String(reg.feitos[b].em)));
    for (const k of ks.slice(0, Math.max(0, ks.length - 2000))) delete reg.feitos[k];
    gravarRegistro(reg);
  }
  log(`🚪 Saídas: ${res.tratadas.filter(t => t.enviou).length} retirada(s) + mensagem, ${res.tratadas.filter(t => !t.grupos.length && !t.ficou).length} sem grupo, ${res.erros} com problema.`);
  if (res.erros && !dry) throw new Error(`${res.erros} saída(s) com problema — veja o Log (WhatsApp → Log).`);
  return res;
}

module.exports = { candidatas, runSaidasGrupos, lerRegistro, DIAS_VENCIDO, JANELA, CONTEXTO };

if (require.main === module) {
  const dry = process.argv.includes('--dry');
  if (dry && !process.argv.includes('--grupos')) {
    const c = candidatas();
    console.log(`Foto das ativas: ${c.fotoDia || 'nunca'} (hoje ${c.hoje}) · vencimentos de ${c.de} a ${c.ate}`);
    for (const x of c.lista) console.log(`${x.motivo ? '⏭️ ' : '🚪'} ${x.nome} · venceu ${x.fim} · ${x.contrato}${x.motivo ? ' — ' + x.motivo : ' → retiraria dos grupos e mandaria a mensagem'}`);
    if (!c.lista.length) console.log('Ninguém na janela.');
    process.exit(0);
  }
  require('./wa-client').initWhatsApp()
    .then(() => runSaidasGrupos({ dry }))
    .then(() => process.exit(0))
    .catch(e => { console.error('❌', e.message); process.exit(1); });
}

/**
 * assinaturas.js — Lembrete de CONTRATO SEM ASSINATURA (WhatsApp → Configuração,
 * card "Contrato sem assinatura").
 *
 * Quem recebe: aluna ativa com contrato VIGENTE que o EVO marca como não
 * assinado (signedTerms=false) e que tem link de assinatura (contractSigningUrl).
 * A mensagem leva o link dela ({link}). Quando ela assina, sai da lista sozinha.
 *
 * Frequência: os dias/horário do card (como os outros envios). Em cada disparo
 * cada aluna recebe no máximo UMA vez no dia. Alunas marcadas "Não enviar" no
 * painel nunca recebem (data/assinaturas-cfg.json).
 *
 * Fonte: API do EVO (/api/v1/members?status=1 — a lista já traz os contratos com
 * signedTerms e contractSigningUrl). O resultado da última leitura fica em
 * data/assinaturas-pendentes.json (o painel mostra a lista sem chamar o EVO).
 * Telefone: Contatos pelo código do EVO; senão o celular do cadastro do EVO.
 *
 *   node src/assinaturas.js            → lê o EVO e mostra quem receberia
 *   node src/assinaturas.js --enviar   → lê e envia (precisa do WhatsApp do robô)
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const CACHE = path.join(DATA, 'assinaturas-pendentes.json');
const REG = path.join(DATA, 'assinaturas.json');
const CFG = path.join(DATA, 'assinaturas-cfg.json');
const CONTEXTO = 'Contrato sem assinatura';
const MAX_POR_DIA = 80;   // acima disso a leitura do EVO é suspeita → não envia e avisa

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const last8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function lerJson(arq, padrao) { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } }
function gravarJson(arq, o) {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = arq + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, arq);
}

// ── Exclusões ("Não enviar") ─────────────────────────────────────────────────
function lerCfg() { const o = lerJson(CFG, {}); return { excluidos: (o.excluidos && typeof o.excluidos === 'object') ? o.excluidos : {} }; }
function excluir(id, nome, { remover = false, por = '' } = {}) {
  const k = String(id || '').trim();
  if (!/^\d+$/.test(k)) throw new Error('aluna inválida');
  const c = lerCfg();
  if (remover) delete c.excluidos[k];
  else c.excluidos[k] = { nome: String(nome || '').slice(0, 120), em: new Date().toISOString(), por: String(por || '').slice(0, 60) };
  gravarJson(CFG, c);
  return c;
}

// ── Registro de envios ───────────────────────────────────────────────────────
// feitos: { "<idAluna>|<idContrato>": { n, ultimo, invalido? } }
function lerRegistro() { const o = lerJson(REG, {}); return { feitos: o.feitos || {}, ultimo: o.ultimo || null, ultimaAcao: o.ultimaAcao || null }; }
function gravarRegistro(r) { try { gravarJson(REG, r); } catch (_) {} }

// ── Leitura no EVO ───────────────────────────────────────────────────────────
function vigente(x, hoje) {
  const ini = String(x.startDate || '').slice(0, 10), fim = String(x.endDate || '').slice(0, 10), canc = String(x.cancelDate || '').slice(0, 10);
  return !!ini && ini <= hoje && (!fim || fim >= hoje) && (!canc || canc >= hoje);
}
// Celular do detalhe da cliente (contacts: tipo celular/whatsapp primeiro).
function telefoneDoDetalhe(d) {
  const dig = (v) => { const x = String(v || '').replace(/\D/g, ''); return x.length >= 10 && x.length <= 13 ? x : ''; };
  const cands = [];
  for (const c of (d && Array.isArray(d.contacts) ? d.contacts : [])) {
    if (!c || typeof c !== 'object') continue;
    const val = c.description || c.value || c.contact || '';
    if (String(val).includes('@')) continue;
    const tipo = [c.contactType, c.type, c.idContactType].map(x => String(x || '')).join(' ').toLowerCase();
    const n = dig(String(c.ddi || '') + String(val)) || dig(val);
    if (n) cands.push([/cel|mobile|whats/.test(tipo) ? 0 : 1, n]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  return cands.length ? cands[0][1] : '';
}

/** Lê no EVO quem tem contrato vigente sem assinatura e grava o cache. */
async function atualizarPendentes({ log = () => {} } = {}) {
  const evo = require('./pagamento/evo-api');
  if (!evo.configurado()) throw new Error('não achei a chave da API do EVO (EVO_DNS/EVO_TOKEN) no .env');
  const hoje = hojeSP();
  const ativos = await evo.paginado('/api/v1/members', { status: 1 });
  let contatosMapa = {};
  try { contatosMapa = require('./contatos').carregar() || {}; } catch (_) {}
  const porIdEvo = new Map();
  for (const tel in contatosMapa) { const c = contatosMapa[tel]; if (c && c.idEvo) porIdEvo.set(String(c.idEvo), tel); }
  const antigo = lerJson(CACHE, {});
  const telAntigo = new Map(((antigo && antigo.lista) || []).filter(x => x.telefone).map(x => [x.id, x.telefone]));
  const lista = [];
  for (const m of ativos) {
    const id = String(m.idMember || '');
    if (!id) continue;
    const pend = (m.memberships || []).filter(x => vigente(x, hoje) && ('signedTerms' in x) && !x.signedTerms && x.contractSigningUrl);
    if (!pend.length) continue;
    const nome = [m.firstName, m.lastName].map(s => String(s || '').trim()).filter(Boolean).join(' ');
    let telefone = porIdEvo.get(id) || telAntigo.get(id) || '';
    if (!telefone) {
      try { const d = await evo.chamar(`/api/v2/members/${id}`); telefone = telefoneDoDetalhe(Array.isArray(d) ? d[0] : d); } catch (_) {}
    }
    for (const x of pend) {
      lista.push({ id, contrato: String(x.idMemberMembership || x.idMembership || x.startDate || ''), nome, plano: String(x.name || '').trim(), link: String(x.contractSigningUrl), inicio: String(x.startDate || '').slice(0, 10), telefone });
    }
  }
  const out = { em: new Date().toISOString(), ativas: ativos.length, lista };
  gravarJson(CACHE, out);
  log(`✍️  Assinaturas: ${ativos.length} aluna(s) ativa(s) lidas no EVO · ${lista.length} contrato(s) sem assinatura.`);
  return out;
}

/**
 * Quem recebe no próximo disparo (pela última leitura do EVO):
 * { em, lista: [{ id, contrato, nome, plano, telefone, envios, ultimo, motivo }] }
 * motivo vazio = recebe; senão, por que fica de fora.
 */
function candidatas({ hoje = hojeSP() } = {}) {
  const cache = lerJson(CACHE, {});
  const reg = lerRegistro(), cfg = lerCfg();
  const lista = ((cache && cache.lista) || []).map(x => {
    const f = reg.feitos[`${x.id}|${x.contrato}`] || {};
    const item = { id: x.id, contrato: x.contrato, nome: x.nome, plano: x.plano, inicio: x.inicio, telefone: x.telefone, envios: f.n || 0, ultimo: f.ultimo || '', motivo: '' };
    if (cfg.excluidos[x.id]) item.motivo = 'marcada para não receber';
    else if (f.invalido) item.motivo = 'o número não tem WhatsApp';
    else if (!x.telefone) item.motivo = 'sem telefone (nem nos Contatos nem no cadastro do EVO)';
    else if (String(f.ultimo || '').slice(0, 10) === hoje) item.motivo = 'já recebeu hoje';
    return item;
  });
  lista.sort((a, b) => (a.motivo ? 1 : 0) - (b.motivo ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { em: (cache && cache.em) || '', ativas: (cache && cache.ativas) || 0, lista };
}

async function runAssinaturas({ dry = false, log = console.log } = {}) {
  const mensagens = require('./mensagens');
  await atualizarPendentes({ log });
  const cache = lerJson(CACHE, {});
  const porChave = new Map(((cache && cache.lista) || []).map(x => [`${x.id}|${x.contrato}`, x]));
  const c = candidatas();
  const fila = c.lista.filter(x => !x.motivo);
  for (const x of c.lista.filter(x => x.motivo)) log(`   ⏭️  ${x.nome} (${x.plano}): ${x.motivo}`);
  if (fila.length > MAX_POR_DIA) throw new Error(`${fila.length} lembretes de uma vez (limite ${MAX_POR_DIA}) — parece leitura errada do EVO; não enviei nada.`);
  const reg = lerRegistro();
  const res = { em: new Date().toISOString(), dry, enviados: [], erros: 0 };
  const wa = dry ? null : require('./wa-client');
  const jaHoje = new Set();
  for (const x of fila) {
    if (jaHoje.has(x.id)) continue; // duas pendências da mesma aluna: um lembrete por dia
    const dado = porChave.get(`${x.id}|${x.contrato}`) || {};
    const nome1 = String(x.nome || '').trim().split(/\s+/)[0] || '';
    const nomeBonito = nome1 && nome1 === nome1.toUpperCase() ? nome1.charAt(0) + nome1.slice(1).toLowerCase() : nome1;
    const texto = mensagens.render('assinatura_contrato', { nome: nomeBonito, plano: x.plano, link: dado.link || '' });
    if (dry) { log(`   🧪 ${x.nome}: receberia o lembrete (${x.plano}).`); res.enviados.push({ nome: x.nome, ok: true, dry: true }); jaHoje.add(x.id); continue; }
    const k = `${x.id}|${x.contrato}`;
    try {
      await wa.sendTexto(x.telefone, texto, CONTEXTO, 'assinatura_contrato');
      reg.feitos[k] = { n: (reg.feitos[k] && reg.feitos[k].n || 0) + 1, ultimo: res.em, nome: x.nome };
      res.enviados.push({ nome: x.nome, ok: true });
      jaHoje.add(x.id);
      log(`   ✍️  ${x.nome}: lembrete enviado (${x.plano}).`);
    } catch (e) {
      res.erros++; res.enviados.push({ nome: x.nome, ok: false, erro: e.message });
      log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`);
      if (e && e.code === 'INVALIDO') reg.feitos[k] = Object.assign({}, reg.feitos[k], { invalido: true, ultimo: res.em }); // sem WhatsApp: não insiste
    }
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (!dry) {
    reg.ultimo = res;
    if (res.enviados.length) reg.ultimaAcao = res;
    gravarRegistro(reg);
  }
  log(`✍️  Assinaturas: ${res.enviados.filter(e => e.ok).length} lembrete(s) ${dry ? 'simulado(s)' : 'enviado(s)'}, ${res.erros} erro(s).`);
  if (res.erros && !dry) throw new Error(`${res.erros} lembrete(s) de assinatura não enviado(s) — veja o Log.`);
  return res;
}

module.exports = { candidatas, atualizarPendentes, runAssinaturas, lerRegistro, lerCfg, excluir, telefoneDoDetalhe, CONTEXTO };

if (require.main === module) {
  (async () => {
    await atualizarPendentes({ log: console.log });
    const c = candidatas();
    for (const x of c.lista) console.log(`${x.motivo ? '⏭️ ' : '✍️ '} ${x.nome} · ${x.plano}${x.motivo ? ' — ' + x.motivo : ''}`);
    if (!process.argv.includes('--enviar')) process.exit(0);
    await require('./wa-client').initWhatsApp();
    await runAssinaturas();
    process.exit(0);
  })().catch(e => { console.error('❌', e.message); process.exit(1); });
}

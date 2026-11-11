/**
 * BOAS-VINDAS e INDICAÇÃO (WhatsApp → Configuração → 🎉 Alunas novas).
 *
 * Fonte: a leitura diária das alunas ativas no EVO (data/alunas-ativas-historico.json,
 * 05:25) — para cada aluna: os contratos (cs) e os períodos em que ficou ativa (iv,
 * contratos emendados viram um período só — mesma regra de Indicadores → Alunas ativas).
 *
 * Boas-vindas (job boasVindas): contrato que COMEÇOU nos últimos 3 dias:
 *   - "nova"      → o período começou com este contrato e ela nunca teve outro;
 *   - "retorno"   → o período começou com este contrato, mas ela já teve outro antes;
 *   - "renovacao" → o contrato emendou num período que já vinha (renovou).
 *   Cada tipo tem a sua mensagem (editável) e pode ser ligado/desligado no card.
 *   {assinatura} = "✍️ … assine aqui: <link>" se o contrato ainda não foi assinado
 *   (link do EVO), ou vazio; {link} = só o link. Só vale DAQUI PRA FRENTE (contratos
 *   a partir da 1ª execução). Aviso para a recepção no grupo da equipe (novas e
 *   retornos), para colocar a aluna nos grupos.
 *
 * Indicação (job indicacao30): 30 dias depois do INÍCIO do período (nova ou retorno),
 *   se ela continua ativa — convite para trazer uma amiga. Uma vez por entrada.
 *
 *   data/boas-vindas-cfg.json → { nova, retorno, renovacao, equipe, desde }
 *   data/boas-vindas.json     → { feitos: { "<id>|<início>": {...} }, indicacao: { ... } }
 */
const fs = require('fs');
const path = require('path');
const mensagens = require('./mensagens');

const DATA = path.resolve(__dirname, '..', 'data');
const ATIVAS = path.join(DATA, 'alunas-ativas-historico.json');
const CFG = path.join(DATA, 'boas-vindas-cfg.json');
const REG = path.join(DATA, 'boas-vindas.json');
const JANELA_DIAS = 3;       // contrato que começou há até 3 dias
const IND_DE = 30, IND_ATE = 33;
const MAX_POR_VEZ = 40;
const CONTEXTO = { nova: 'Boas-vindas — aluna nova', retorno: 'Boas-vindas — voltou', renovacao: 'Boas-vindas — renovação', indicacao: 'Indicação (30 dias)' };
const MSG = { nova: 'boasvindas_nova', retorno: 'boasvindas_retorno', renovacao: 'boasvindas_renovacao' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function lerJson(f, padrao) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return (o && typeof o === 'object') ? o : padrao; } catch (_) { return padrao; } }
function gravarJson(f, o) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); }
const primeiro = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''; };
const bonito = (n) => String(n || '').toLowerCase().replace(/(^|\s)(\S)/g, (x, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (x) => x.toLowerCase());

function lerCfg() {
  const o = lerJson(CFG, {});
  return { nova: o.nova !== false, retorno: o.retorno !== false, renovacao: o.renovacao !== false, equipe: o.equipe !== false, desde: /^\d{4}-\d{2}-\d{2}$/.test(o.desde || '') ? o.desde : '' };
}
function salvarCfg(v) { const c = Object.assign(lerCfg(), v || {}); gravarJson(CFG, c); return c; }
function lerReg() { const o = lerJson(REG, {}); return { feitos: o.feitos || {}, indicacao: o.indicacao || {} }; }

// Telefone: Contatos (pelo código do EVO) → celular do cadastro guardado na leitura.
function resolvedorTel() {
  let contatos = {}; try { contatos = require('./contatos').carregar() || {}; } catch (_) {}
  const porId = new Map();
  for (const tel in contatos) { const c = contatos[tel]; if (c && c.idEvo) porId.set(String(c.idEvo), tel); }
  return (id, p) => porId.get(String(id)) || String((p && p.tel) || '').replace(/\D/g, '');
}

// Entradas recentes (boas-vindas). Não chama o EVO — o painel usa como prévia.
function entradas({ hoje = hojeSP(), cfg = lerCfg(), reg = lerReg() } = {}) {
  const h = lerJson(ATIVAS, {});
  const ids = new Set(((h.ultimo || {}).ids || []).map(String));
  const pes = h.pessoas || {};
  const tel = resolvedorTel();
  const de = cfg.desde && cfg.desde > somaDias(hoje, -JANELA_DIAS) ? cfg.desde : somaDias(hoje, -JANELA_DIAS);
  const out = [];
  for (const id of ids) {
    const p = pes[id]; if (!p) continue;
    const cs = Array.isArray(p.cs) ? p.cs : [], iv = Array.isArray(p.iv) ? p.iv : [];
    const recentes = cs.filter(c => c && c[0] >= de && c[0] <= hoje);
    if (!recentes.length) continue;
    const c = recentes[recentes.length - 1];
    const ini = c[0];
    const idxPer = iv.findIndex(pr => pr[0] <= ini && ini <= pr[1]);
    const per = iv[idxPer];
    const tipo = !per ? 'nova' : (per[0] < ini ? 'renovacao' : (idxPer > 0 ? 'retorno' : 'nova'));
    const item = { id, nome: bonito(p.n || ''), plano: c[2] || '', inicio: ini, tipo, telefone: tel(id, p), motivo: '' };
    if (reg.feitos[`${id}|${ini}`]) item.motivo = 'já recebeu';
    else if (!cfg[tipo]) item.motivo = `${tipo === 'renovacao' ? 'renovação' : tipo === 'retorno' ? 'ex-aluna voltando' : 'aluna nova'}: desligado no card`;
    else if (!item.telefone) item.motivo = 'sem telefone ainda (a leitura de amanhã tenta de novo)';
    out.push(item);
  }
  return out.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// 30 dias depois do INÍCIO do período (nova ou retorno), ainda ativa.
function paraIndicacao({ hoje = hojeSP(), reg = lerReg() } = {}) {
  const h = lerJson(ATIVAS, {});
  const ids = new Set(((h.ultimo || {}).ids || []).map(String));
  const pes = h.pessoas || {};
  const tel = resolvedorTel();
  const de = somaDias(hoje, -IND_ATE), ate = somaDias(hoje, -IND_DE);
  const out = [];
  for (const id of ids) {
    const p = pes[id]; if (!p) continue;
    const iv = Array.isArray(p.iv) ? p.iv : [];
    const per = iv[iv.length - 1];
    if (!per || per[0] < de || per[0] > ate) continue;
    const item = { id, nome: bonito(p.n || ''), inicio: per[0], telefone: tel(id, p), motivo: '' };
    if (reg.indicacao[`${id}|${per[0]}`]) item.motivo = 'já recebeu';
    else if (!item.telefone) item.motivo = 'sem telefone';
    out.push(item);
  }
  return out;
}

// Links de assinatura (contratos vigentes não assinados) pela API do EVO: id → [{inicio, link}].
async function linksAssinatura(log) {
  const mapa = new Map();
  try {
    const evo = require('./pagamento/evo-api');
    if (!evo.configurado()) return mapa;
    const ativos = await evo.paginado('/api/v1/members', { status: 1 });
    for (const m of ativos) {
      for (const x of (m.memberships || [])) {
        if (('signedTerms' in x) && !x.signedTerms && x.contractSigningUrl) {
          const id = String(m.idMember || '');
          (mapa.get(id) || mapa.set(id, []).get(id)).push({ inicio: String(x.startDate || '').slice(0, 10), link: String(x.contractSigningUrl) });
        }
      }
    }
  } catch (e) { log(`   ⚠️  Não consegui ler os links de assinatura no EVO (${e.message}) — sigo sem link.`); }
  return mapa;
}

async function runBoasVindas({ log = console.log, dry = false } = {}) {
  const cfg = lerCfg(), hoje = hojeSP();
  if (!cfg.desde && !dry) { cfg.desde = somaDias(hoje, -1); salvarCfg({ desde: cfg.desde }); log(`🎉 Boas-vindas: primeira execução — vale para contratos a partir de ${cfg.desde}.`); }
  const reg = lerReg();
  const lista = entradas({ hoje, cfg, reg });
  const fila = lista.filter(x => !x.motivo);
  log(`🎉 Boas-vindas: ${lista.length} contrato(s) novo(s) nos últimos ${JANELA_DIAS} dias, ${fila.length} para enviar.`);
  for (const x of lista.filter(x => x.motivo)) log(`   ⏭️  ${x.nome}: ${x.motivo}`);
  if (fila.length > MAX_POR_VEZ) throw new Error(`${fila.length} de uma vez (limite ${MAX_POR_VEZ}) — parece leitura errada do EVO; não enviei nada.`);
  if (!fila.length) return { enviadas: 0 };
  const links = await linksAssinatura(log);
  const wa = require('./wa-client');
  const res = { enviadas: 0, erros: 0 }, equipe = [];
  for (const x of fila) {
    const lk = (links.get(x.id) || []).find(l => l.inicio === x.inicio) || (links.get(x.id) || [])[0];
    const link = lk ? lk.link : '';
    const texto = mensagens.render(MSG[x.tipo], {
      nome: primeiro(x.nome), plano: x.plano, link,
      assinatura: link ? `\n\n✍️ Para finalizar, é só assinar o seu contrato por aqui: ${link}` : '',
    });
    if (dry) { log(`   🧪 ${x.nome} (${x.tipo}, ${x.plano})${link ? ' com link de assinatura' : ''}: receberia as boas-vindas.`); res.enviadas++; continue; }
    try {
      await wa.sendTexto(x.telefone, texto, CONTEXTO[x.tipo], MSG[x.tipo]);
      reg.feitos[`${x.id}|${x.inicio}`] = { em: new Date().toISOString(), tipo: x.tipo, nome: x.nome, plano: x.plano };
      res.enviadas++; log(`   🎉 ${x.nome}: boas-vindas (${x.tipo}) enviada.`);
      if (x.tipo !== 'renovacao') equipe.push(x);
    } catch (e) {
      res.erros++; log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`);
      if (e && e.code === 'INVALIDO') reg.feitos[`${x.id}|${x.inicio}`] = { em: new Date().toISOString(), tipo: x.tipo, nome: x.nome, invalido: true };
    }
    gravarJson(REG, reg);
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (equipe.length && cfg.equipe && !dry) {
    const linhas = equipe.map(x => `• ${x.nome} — ${x.plano || 'plano'} ${x.tipo === 'retorno' ? '(voltou 💚)' : '(aluna nova 🎉)'}`).join('\n');
    try { await wa.sendGrupo(require('./grupos').equipe(), mensagens.render('boasvindas_equipe', { lista: linhas }), 'Boas-vindas — aviso à equipe'); log('   📣 Aviso postado no grupo da equipe.'); }
    catch (e) { log(`   ⚠️  Não consegui avisar o grupo da equipe: ${e.message}`); }
  }
  log(`🎉 Boas-vindas: ${res.enviadas} ${dry ? 'simulada(s)' : 'enviada(s)'}, ${res.erros} erro(s).`);
  return res;
}

async function runIndicacao({ log = console.log, dry = false } = {}) {
  const reg = lerReg();
  const lista = paraIndicacao({ reg });
  const fila = lista.filter(x => !x.motivo);
  log(`💌 Indicação (30 dias): ${lista.length} aluna(s) completando ~30 dias, ${fila.length} para enviar.`);
  if (fila.length > MAX_POR_VEZ) throw new Error(`${fila.length} de uma vez (limite ${MAX_POR_VEZ}) — não enviei nada.`);
  const wa = require('./wa-client');
  const res = { enviadas: 0, erros: 0 };
  for (const x of fila) {
    if (dry) { log(`   🧪 ${x.nome}: receberia o convite de indicação.`); res.enviadas++; continue; }
    try {
      await wa.sendTexto(x.telefone, mensagens.render('indicacao_30d', { nome: primeiro(x.nome) }), CONTEXTO.indicacao, 'indicacao_30d');
      reg.indicacao[`${x.id}|${x.inicio}`] = { em: new Date().toISOString(), nome: x.nome };
      res.enviadas++; log(`   💌 ${x.nome}: convite enviado.`);
    } catch (e) { res.erros++; log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`); if (e && e.code === 'INVALIDO') reg.indicacao[`${x.id}|${x.inicio}`] = { em: new Date().toISOString(), invalido: true }; }
    gravarJson(REG, reg);
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  log(`💌 Indicação: ${res.enviadas} ${dry ? 'simulada(s)' : 'enviada(s)'}, ${res.erros} erro(s).`);
  return res;
}

module.exports = { entradas, paraIndicacao, runBoasVindas, runIndicacao, lerCfg, salvarCfg, lerReg };

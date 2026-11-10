/**
 * sentimos-falta.js — "Sentimos sua falta" para alunas ATIVAS que sumiram
 * (WhatsApp → Configuração, bloco "💛 Sentimos sua falta").
 *
 * Regras (pedidas pelo Studio):
 *   - Toda segunda (horário no cartão): aluna ativa, NÃO trancada, sem presença há
 *     N dias ou mais (painel; padrão 14) recebe a 1ª mensagem.
 *   - Se continuar sem presença (a "última presença" no EVO não mudou) e já
 *     passaram D dias da 1ª (painel; padrão 10), recebe a 2ª mensagem.
 *   - Depois da 2ª, nada mais — até ela voltar a treinar. Quando a última presença
 *     muda (ela veio) e depois some de novo, recomeça pela 1ª.
 *   - Trancada não recebe (o EVO informa as suspensões e elas saem da lista).
 *
 * Fonte: CRM → Faltantes do EVO (a mesma leitura do job "Ausentes" do grupo da
 * equipe — ausentes-10-dias.js), com o número de dias configurado aqui.
 * Telefone: Contatos (código do EVO) → celular do EVO lido pelas alunas ativas →
 * telefone do painel do EVO. Registro de quem recebeu: data/sentimos-falta.json.
 *
 * Uso manual:  node src/sentimos-falta.js --dry   (lê o EVO e mostra quem receberia)
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const REG = path.join(DATA, 'sentimos-falta.json');
const CFG = path.join(DATA, 'sentimos-falta-cfg.json');
const ATIVAS = path.join(DATA, 'alunas-ativas-historico.json');
const PADRAO = { diasAusente: 14, diasEntre: 10 };
const LIM = { diasAusente: [7, 120], diasEntre: [3, 60] };
const MAX_POR_VEZ = 120;  // acima disso a leitura do EVO é suspeita — não envia e avisa
const CONTEXTO = 'Sentimos sua falta';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const last8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
function lerJson(arq, padrao) { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } }
// "dd/mm/aaaa" → "aaaa-mm-dd" (ou '' se não der)
function isoDeBr(s) { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; }
function diasEntreDatas(a, b) { if (!a || !b) return null; return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
const brDe = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';

function lerCfg() {
  const o = lerJson(CFG, {});
  const out = {};
  for (const k of Object.keys(PADRAO)) {
    const n = parseInt(o[k], 10);
    out[k] = Number.isFinite(n) && n >= LIM[k][0] && n <= LIM[k][1] ? n : PADRAO[k];
  }
  return out;
}
function salvarCfg(v) {
  const atual = lerCfg();
  for (const k of Object.keys(PADRAO)) {
    if (v[k] === undefined || v[k] === null || v[k] === '') continue;
    const n = parseInt(v[k], 10);
    if (!Number.isFinite(n) || n < LIM[k][0] || n > LIM[k][1]) return null;
    atual[k] = n;
  }
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(atual, null, 2)); } catch (_) { return null; }
  return atual;
}
function lerRegistro() { const o = lerJson(REG, {}); return { alunas: o.alunas || {}, ultimo: o.ultimo || null, ultimaAcao: o.ultimaAcao || null, ultimoSim: o.ultimoSim || null }; }
function gravarRegistro(r) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(REG, JSON.stringify(r, null, 2)); } catch (_) {} }

// Telefone pelo nome do EVO: Contatos (código do EVO) → celular lido pelas ativas
// → o que veio do painel do EVO. Nome repetido (homônimas) não casa por nome.
function resolvedorTelefone() {
  const h = lerJson(ATIVAS, {});
  const pes = h.pessoas || {};
  const porNome = new Map(), repetido = new Set();
  for (const id of Object.keys(pes)) {
    const k = norm(pes[id] && pes[id].n); if (!k) continue;
    if (porNome.has(k)) repetido.add(k); else porNome.set(k, id);
  }
  let contatos = {}; try { contatos = require('./contatos').carregar() || {}; } catch (_) {}
  const porIdEvo = new Map();
  for (const tel of Object.keys(contatos)) { const c = contatos[tel]; if (c && c.idEvo) porIdEvo.set(String(c.idEvo), tel); }
  return (nome, telEvo) => {
    const k = norm(nome);
    const id = repetido.has(k) ? null : porNome.get(k);
    if (id && porIdEvo.has(String(id))) return { tel: porIdEvo.get(String(id)), fonte: 'Contatos' };
    if (id && pes[id] && pes[id].tel) return { tel: String(pes[id].tel).replace(/\D/g, ''), fonte: 'cadastro do EVO' };
    const d = String(telEvo || '').replace(/\D/g, '');
    if (d.length >= 10) return { tel: d.length <= 11 ? '55' + d : d, fonte: 'painel do EVO' };
    return { tel: '', fonte: '' };
  };
}

// Contrato ATIVO hoje? Usa a leitura diária das alunas ativas (API do EVO). O
// CRM → Faltantes às vezes ainda lista quem RESCINDIU ou venceu — essas ficam de
// fora. Sem leitura recente (≤ 3 dias) ou nome não encontrado → não filtra.
const normEvo = (s) => norm(s).replace(/^\d+\s*[-–—]?\s*/, '');
function filtroContratoAtivo(hoje = hojeSP()) {
  const h = lerJson(ATIVAS, {});
  const ult = h.ultimo || {};
  const ids = new Set((ult.ids || []).map(String));
  const dd = ult.dia ? diasEntreDatas(ult.dia, hoje) : null;
  if (!ids.size || dd === null || dd > 3) return () => '';
  const pes = h.pessoas || {};
  const porNome = new Map(), repetido = new Set();
  for (const id of Object.keys(pes)) {
    const k = normEvo(pes[id] && pes[id].n); if (!k) continue;
    if (porNome.has(k)) repetido.add(k); else porNome.set(k, id);
  }
  return (nome) => {
    const k = normEvo(nome);
    const id = repetido.has(k) ? null : porNome.get(k);
    if (!id || ids.has(String(id))) return '';
    const cs = Array.isArray(pes[id].cs) ? pes[id].cs : [];
    const u = cs[cs.length - 1] || [];
    return u[4] === 1 ? 'contrato RESCINDIDO no EVO — não é mais aluna' : 'contrato não está mais ativo no EVO (venceu ou foi cancelado)';
  };
}

/**
 * Decide, para cada ausente, o que fazer agora. Não envia nada.
 * ausentes: [{ nome, ultima ('dd/mm/aaaa'), telefone }]
 * → [{ chave, nome, ultima, dias, etapa (1|2|0), motivo, telefone }]
 */
function decidir(ausentes, { hoje = hojeSP(), cfg = lerCfg(), reg = lerRegistro() } = {}) {
  const tel = resolvedorTelefone();
  const contratoFora = filtroContratoAtivo(hoje);
  const out = [];
  for (const a of ausentes || []) {
    const chave = norm(a.nome); if (!chave) continue;
    const ult = isoDeBr(a.ultima);
    const dias = ult ? diasEntreDatas(ult, hoje) : null;
    const r = reg.alunas[chave];
    const t = tel(a.nome, a.telefone);
    const item = { chave, nome: a.nome, ultima: a.ultima || '', dias, etapa: 0, motivo: '', telefone: t.tel, fonteTel: t.fonte };
    const fora = contratoFora(a.nome);
    if (fora) { item.motivo = fora; out.push(item); continue; }
    // Ciclo novo: nunca recebeu, ou a última presença mudou (ela veio e sumiu de novo).
    const cicloNovo = !r || String(r.ultima || '') !== String(a.ultima || '');
    if (cicloNovo) item.etapa = 1;
    else if (r.m2) item.motivo = `já recebeu as 2 mensagens (1ª em ${brDe(r.m1)}, 2ª em ${brDe(r.m2)}) — só recomeça quando ela voltar a treinar`;
    else {
      const desde = diasEntreDatas(String(r.m1 || '').slice(0, 10), hoje);
      if (desde !== null && desde >= cfg.diasEntre) item.etapa = 2;
      else item.motivo = `recebeu a 1ª em ${brDe(r.m1)} — a 2ª sai a partir de ${brDe(somaDias(String(r.m1).slice(0, 10), cfg.diasEntre))} (se continuar sem vir)`;
    }
    // Trava: o EVO às vezes lista quem veio há pouco — só conta a partir do corte.
    if (item.etapa && dias !== null && dias < cfg.diasAusente) {
      item.motivo = a.destrancou ? `destrancou em ${a.destrancou} — a contagem começa aí: ${dias} dia(s), menos que ${cfg.diasAusente}` : `última presença há ${dias} dia(s) — menos que ${cfg.diasAusente}`;
      item.etapa = 0;
    }
    if (item.etapa && !item.telefone) { item.motivo = 'sem telefone (não está nos Contatos com o código do EVO e o EVO não mostrou celular)'; item.etapa = 0; }
    out.push(item);
  }
  return out.sort((a, b) => (b.dias || 0) - (a.dias || 0));
}
function somaDias(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Lê o EVO (com novas tentativas — o "detached Frame" do EVO é comum).
async function lerAusentes(dias, log) {
  const { coletarAusentes } = require('./ausentes-10-dias');
  let ultimoErro = null;
  for (let t = 1; t <= 3; t++) {
    try { return await coletarAusentes(dias); }
    catch (e) { ultimoErro = e; log(`   ⚠️  Leitura do EVO (tentativa ${t}/3) falhou: ${e.message}`); if (t < 3) await sleep(20000); }
  }
  throw ultimoErro;
}

async function runSentimosFalta({ dry = false, log = console.log, ausentes = null } = {}) {
  const cfg = lerCfg();
  log(`💛 Sentimos sua falta — ausentes há ${cfg.diasAusente}+ dias · 2ª mensagem ${cfg.diasEntre} dias depois da 1ª${dry ? ' (simulação)' : ''}`);
  let lidas = ausentes, trancadas = [];
  if (!lidas) {
    let trancOk = true;
    ({ ausentes: lidas, trancadas, trancOk } = await lerAusentes(cfg.diasAusente, log));
    // Sem a lista de trancamentos não dá para garantir que trancada fica de fora.
    if (trancOk === false && !dry) throw new Error('não consegui ler os trancamentos no EVO — para não escrever para trancada, não enviei nada. Tente de novo pelo Log (↻ Rodar de novo).');
  }
  // TRANCADAS: ainda trancada → fora. Já destrancou → volta para a lista, mas os
  // dias contam a partir do dia seguinte ao fim do trancamento (não da última
  // presença de antes de trancar).
  const hoje = hojeSP();
  const aindaTrancadas = [];
  lidas = (lidas || []).slice();
  for (const t of trancadas || []) {
    const fimIso = isoDeBr(t.fim);
    if (!fimIso || fimIso >= hoje) { aindaTrancadas.push(t); continue; }
    const volta = somaDias(fimIso, 1), ultIso = isoDeBr(t.ultima);
    const base = (!ultIso || volta > ultIso) ? volta : ultIso;
    lidas.push({ ...t, ultima: brDe(base), destrancou: t.fim });
  }
  trancadas = aindaTrancadas;
  const reg = lerRegistro();
  const itens = decidir(lidas, { cfg, reg });
  const vai = itens.filter(x => x.etapa);
  log(`   ${lidas.length} ausente(s) ativa(s) (${(trancadas || []).length} trancada(s) já fora): ${vai.filter(x => x.etapa === 1).length} recebem a 1ª, ${vai.filter(x => x.etapa === 2).length} recebem a 2ª, ${itens.length - vai.length} ficam de fora.`);
  for (const x of itens.filter(x => !x.etapa)) log(`   ⏭️  ${x.nome}: ${x.motivo}`);
  const res = { em: new Date().toISOString(), dry, cfg, total: lidas.length, trancadas: (trancadas || []).length, itens: itens.map(x => ({ nome: x.nome, ultima: x.ultima, dias: x.dias, etapa: x.etapa, motivo: x.motivo, ok: dry ? undefined : null })) };
  if (dry) {
    for (const x of vai) log(`   🧪 ${x.nome} (sem vir há ${x.dias ?? '?'} dias): receberia a ${x.etapa}ª mensagem`);
    reg.ultimoSim = res; gravarRegistro(reg);
    return res;
  }
  if (vai.length > MAX_POR_VEZ) throw new Error(`${vai.length} mensagens de uma vez (limite ${MAX_POR_VEZ}) — parece leitura errada do EVO; não enviei nada.`);
  const mensagens = require('./mensagens');
  const wa = require('./wa-client');
  let erros = 0;
  for (const x of vai) {
    const nome1 = String(x.nome || '').trim().split(/\s+/)[0] || '';
    const nomeBonito = nome1 ? nome1.charAt(0).toUpperCase() + nome1.slice(1).toLowerCase() : '';
    const chaveMsg = x.etapa === 1 ? 'sentimos_falta_1' : 'sentimos_falta_2';
    const texto = mensagens.render(chaveMsg, { nome: nomeBonito, dias: x.dias != null ? String(x.dias) : String(cfg.diasAusente) });
    const linha = res.itens.find(i => i.nome === x.nome);
    try {
      await wa.sendTexto(x.telefone, texto, CONTEXTO + (x.etapa === 2 ? ' (2ª)' : ' (1ª)'), chaveMsg);
      const agora = new Date().toISOString();
      if (x.etapa === 1) reg.alunas[x.chave] = { nome: x.nome, ultima: x.ultima, m1: agora, m2: null, tel: x.telefone };
      else reg.alunas[x.chave] = Object.assign({}, reg.alunas[x.chave], { m2: agora, tel: x.telefone });
      if (linha) linha.ok = true;
      log(`   ✉️  ${x.nome}: ${x.etapa}ª mensagem enviada (sem vir há ${x.dias ?? '?'} dias).`);
    } catch (e) {
      erros++; if (linha) { linha.ok = false; linha.erro = e.message; }
      log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`);
      // Número sem WhatsApp: marca a etapa como feita para não insistir toda semana.
      if (e && e.code === 'INVALIDO') {
        const agora = new Date().toISOString();
        if (x.etapa === 1) reg.alunas[x.chave] = { nome: x.nome, ultima: x.ultima, m1: agora, m2: null, invalido: true };
        else reg.alunas[x.chave] = Object.assign({}, reg.alunas[x.chave], { m2: agora, invalido: true });
      }
    }
    gravarRegistro(reg);
    await sleep(8000 + Math.floor(Math.random() * 3000));
  }
  // Limpa registros muito antigos (1 ano sem novidade).
  const corte = Date.now() - 365 * 864e5;
  for (const k of Object.keys(reg.alunas)) { const r = reg.alunas[k]; const t = Date.parse((r && (r.m2 || r.m1)) || '') || 0; if (t && t < corte) delete reg.alunas[k]; }
  reg.ultimo = res; if (vai.length) reg.ultimaAcao = res;
  gravarRegistro(reg);
  if (erros) throw new Error(`${erros} mensagem(ns) de "sentimos sua falta" não enviada(s) — veja o Log.`);
  return res;
}

module.exports = { runSentimosFalta, decidir, lerCfg, salvarCfg, lerRegistro, PADRAO, LIM, CONTEXTO };

if (require.main === module) {
  const dry = !process.argv.includes('--enviar');
  (dry ? runSentimosFalta({ dry: true }) : require('./wa-client').initWhatsApp().then(() => runSentimosFalta()))
    .then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
}

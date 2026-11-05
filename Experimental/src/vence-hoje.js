/**
 * vence-hoje.js — Aviso no DIA do vencimento do contrato para quem ainda NÃO
 * renovou (WhatsApp → Configuração, card "Vence hoje — sem renovação").
 *
 * Quem recebe: aluna com contrato SlimFit (Circuito/VIP não contam) que vence
 * HOJE e não tem contrato na FILA (fila = renovou). Trancada não recebe.
 * Dias sem disparo (ex.: domingo desligado no card): quem venceu nesses dias
 * recebe no próximo disparo, com {vencimento} = "venceu ontem" / "venceu no dia
 * DD/MM" — o dia de hoje usa "vence hoje".
 *
 * Fonte: data/alunas-ativas-historico.json (run_ativas_foto.py, 05:25 todo dia).
 * Telefone: Contatos pelo código do EVO, senão o celular do cadastro do EVO.
 * Cada contrato recebe uma vez só (data/vence-hoje.json). Só roda com a foto de
 * HOJE; mais de 60 de uma vez = leitura suspeita → não envia e avisa.
 *
 * Uso manual:  node src/vence-hoje.js --dry   (mostra quem receberia)
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const ATIVAS = path.join(DATA, 'alunas-ativas-historico.json');
const REG = path.join(DATA, 'vence-hoje.json');
const MAX_POR_DIA = 60;
const CONTEXTO = 'Vence hoje — sem renovação';

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function somaDias(dia, n) { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const diaSemana = (dia) => new Date(dia + 'T12:00:00Z').getUTCDay();
const last8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function lerJson(arq, padrao) { try { const o = JSON.parse(fs.readFileSync(arq, 'utf8')); return o && typeof o === 'object' ? o : padrao; } catch (_) { return padrao; } }
function lerRegistro() { const o = lerJson(REG, {}); return { feitos: o.feitos || {}, ultimo: o.ultimo || null, ultimaAcao: o.ultimaAcao || null }; }
function gravarRegistro(r) { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(REG, JSON.stringify(r, null, 2)); } catch (_) {} }

// Dias da semana em que o envio roda (do horário do card).
function diasDoCard() {
  try {
    const h = require('./horarios');
    return h.parse(h.cronDe('venceHoje')).dias;
  } catch (_) { return [1, 2, 3, 4, 5, 6]; }
}

// Datas de vencimento cobertas pelo disparo de hoje: hoje + os dias anteriores
// sem disparo (até 6), ex.: segunda cobre o domingo se o domingo está desligado.
function datasCobertas(hoje = hojeSP()) {
  const dias = new Set(diasDoCard());
  const out = [hoje];
  for (let i = 1; i <= 6; i++) {
    const d = somaDias(hoje, -i);
    if (dias.has(diaSemana(d))) break; // esse dia teve disparo
    out.push(d);
  }
  return out;
}

function textoVencimento(fim, hoje) {
  if (fim === hoje) return 'vence hoje';
  if (fim === somaDias(hoje, -1)) return 'venceu ontem';
  return 'venceu no dia ' + fim.split('-').reverse().slice(0, 2).join('/');
}

/** Quem recebe no próximo disparo: [{ id, nome, fim, contrato, telefone, vencimento, motivo }] */
function candidatas({ hoje = hojeSP() } = {}) {
  const h = lerJson(ATIVAS, {});
  const pes = h.pessoas || {};
  const reg = lerRegistro();
  const datas = datasCobertas(hoje);
  let contatosMapa = {};
  try { contatosMapa = require('./contatos').carregar() || {}; } catch (_) {}
  const porIdEvo = new Map(), porTel = new Map();
  for (const tel in contatosMapa) {
    const c = contatosMapa[tel]; if (!c) continue;
    if (c.idEvo) porIdEvo.set(String(c.idEvo), { tel, c });
    const k = last8(tel); if (k && !porTel.has(k)) porTel.set(k, { tel, c });
  }
  const out = [];
  for (const id of Object.keys(pes)) {
    const p = pes[id];
    const iv = Array.isArray(p && p.iv) ? p.iv : [];
    if (!iv.length) continue;
    const fim = iv[iv.length - 1][1];
    if (!datas.includes(fim)) continue;                    // não vence numa data coberta
    const cs = Array.isArray(p.cs) ? p.cs : [];
    // Só conta quando o EVO informa que o contrato TERMINA nessa data (c[3] = fim
    // real). Contrato sem data de fim aparece com fim = hoje e não pode virar aviso.
    const ult = cs.filter(c => c[3] && c[3] === fim).pop();
    if (!ult) continue;
    let ct = porIdEvo.get(String(id)) || (p.tel ? porTel.get(last8(p.tel)) : null) || null;
    if (!ct && p.tel) ct = { tel: String(p.tel).replace(/\D/g, ''), c: { nome: p.n || '', tags: [] } };
    const item = { id, nome: (p.nc && p.n) || (ct && ct.c.nome) || p.n || '', fim, contrato: ult[2] || p.c || '', telefone: ct ? ct.tel : '', vencimento: textoVencimento(fim, hoje), motivo: '' };
    if (p.f || p.fq) item.motivo = `renovou (contrato na fila: ${((p.f || p.fq)[0]) || 'novo contrato'})`;
    else if (p.t) item.motivo = 'trancada';
    else if (p.cv) item.motivo = 'tem Circuito/VIP vigente';
    else if (reg.feitos[`${id}|${fim}`]) item.motivo = 'já recebeu em ' + String(reg.feitos[`${id}|${fim}`].em || '').slice(0, 10).split('-').reverse().join('/');
    else if (!ct) item.motivo = 'sem telefone (não está nos Contatos com o código do EVO e o celular do EVO ainda não foi lido)';
    out.push(item);
  }
  return { hoje, datas, fotoDia: (h.ultimo && h.ultimo.dia) || '', lista: out.sort((a, b) => a.fim.localeCompare(b.fim) || a.nome.localeCompare(b.nome)) };
}

async function runVenceHoje({ dry = false, log = console.log } = {}) {
  const mensagens = require('./mensagens');
  const c = candidatas();
  if (c.fotoDia !== c.hoje) throw new Error(`a leitura das alunas ativas de hoje (05:25) ainda não rodou (última: ${c.fotoDia || 'nunca'}) — não envio nada`);
  const fila = c.lista.filter(x => !x.motivo);
  log(`📄 Vence hoje (vencimentos ${c.datas.join(', ')}): ${fila.length} para avisar, ${c.lista.length - fila.length} fora.`);
  for (const x of c.lista.filter(x => x.motivo)) log(`   ⏭️  ${x.nome} (vence ${x.fim}): ${x.motivo}`);
  if (fila.length > MAX_POR_DIA) throw new Error(`${fila.length} avisos de uma vez (limite ${MAX_POR_DIA}) — parece leitura errada do EVO; não enviei nada.`);
  const reg = lerRegistro();
  const res = { em: new Date().toISOString(), dry, enviados: [], erros: 0 };
  const wa = dry ? null : require('./wa-client');
  for (const x of fila) {
    const nome1 = String(x.nome || '').trim().split(/\s+/)[0] || '';
    const texto = mensagens.render('vence_hoje', { nome: nome1, vencimento: x.vencimento, contrato: x.contrato });
    if (dry) { log(`   🧪 ${x.nome}: receberia "${texto.split('\n')[1] || texto.slice(0, 60)}"`); res.enviados.push({ nome: x.nome, ok: true, dry: true }); continue; }
    try {
      await wa.sendTexto(x.telefone, texto, CONTEXTO, 'vence_hoje');
      reg.feitos[`${x.id}|${x.fim}`] = { em: res.em, nome: x.nome };
      res.enviados.push({ nome: x.nome, ok: true });
      log(`   ✉️  ${x.nome}: avisada (${x.vencimento}).`);
    } catch (e) {
      res.erros++; res.enviados.push({ nome: x.nome, ok: false, erro: e.message });
      log(`   ⚠️  ${x.nome}: não enviei — ${e.message}`);
      if (e && e.code === 'INVALIDO') reg.feitos[`${x.id}|${x.fim}`] = { em: res.em, nome: x.nome, invalido: true }; // número sem WhatsApp: não insiste
    }
    await sleep(8000 + Math.floor(Math.random() * 2000));
  }
  if (!dry) {
    reg.ultimo = res;
    if (res.enviados.length) reg.ultimaAcao = res;
    const ks = Object.keys(reg.feitos).sort((a, b) => String(reg.feitos[a].em).localeCompare(String(reg.feitos[b].em)));
    for (const k of ks.slice(0, Math.max(0, ks.length - 3000))) delete reg.feitos[k];
    gravarRegistro(reg);
  }
  if (res.erros && !dry) throw new Error(`${res.erros} aviso(s) de vencimento não enviado(s) — veja o Log.`);
  return res;
}

module.exports = { candidatas, runVenceHoje, lerRegistro, datasCobertas, textoVencimento, CONTEXTO };

if (require.main === module) {
  const c = candidatas();
  console.log(`Foto das ativas: ${c.fotoDia || 'nunca'} (hoje ${c.hoje}) · vencimentos cobertos: ${c.datas.join(', ')}`);
  for (const x of c.lista) console.log(`${x.motivo ? '⏭️ ' : '📄'} ${x.nome} · ${x.vencimento} · ${x.contrato}${x.motivo ? ' — ' + x.motivo : ''}`);
  if (!c.lista.length) console.log('Ninguém vence nas datas cobertas.');
  if (!process.argv.includes('--enviar')) process.exit(0);
  require('./wa-client').initWhatsApp().then(() => runVenceHoje()).then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
}

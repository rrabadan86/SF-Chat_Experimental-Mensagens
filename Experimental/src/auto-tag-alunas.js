/**
 * auto-tag-alunas.js — Mantém as tags "0. Aluna" e "0. Ex Aluna" no CRM da SoFIA
 * em sincronia com a leitura de ALUNAS ATIVAS do EVO (a mesma da planilha de
 * aniversários). Roda JUNTO da planilha (1x/dia), então não faz leitura extra.
 *
 * Regra (casando por TELEFONE — últimos 8 dígitos, tolera o 9º):
 *   - Aluna ATIVA (contrato vigente = está na lista de ativas / "SIM" na planilha)
 *     → põe "0. Aluna" e tira "0. Ex Aluna". Cadastra o contato se ainda não existir.
 *   - Contato que TINHA "0. Aluna" mas NÃO está mais entre as ativas → virou
 *     ex-aluna (sem vínculo) → põe "0. Ex Aluna" e tira "0. Aluna".
 *
 * Só age "daqui pra frente": um ex-aluno que saiu ANTES de a automação existir
 * (e nunca teve a tag "0. Aluna") não é reetiquetado — o passado já está no CRM.
 *
 * Config editável no painel: data/auto-tag-alunas.json { on, tagAluna, tagExAluna }
 */
const fs = require('fs');
const path = require('path');
const contatos = require('./contatos');

const ARQ = path.resolve(__dirname, '..', 'data', 'auto-tag-alunas.json');
const PADRAO = { on: false, tagAluna: '0. Aluna', tagExAluna: '0. Ex Aluna' };

function ler() {
  let o = {};
  try { const p = JSON.parse(fs.readFileSync(ARQ, 'utf8')); if (p && typeof p === 'object') o = p; } catch (_) {}
  return {
    on: !!o.on,
    tagAluna: String(o.tagAluna || PADRAO.tagAluna).trim() || PADRAO.tagAluna,
    tagExAluna: String(o.tagExAluna || PADRAO.tagExAluna).trim() || PADRAO.tagExAluna,
  };
}
function gravar(cfg) {
  const o = {
    on: !!(cfg && cfg.on),
    tagAluna: String((cfg && cfg.tagAluna) || PADRAO.tagAluna).trim() || PADRAO.tagAluna,
    tagExAluna: String((cfg && cfg.tagExAluna) || PADRAO.tagExAluna).trim() || PADRAO.tagExAluna,
  };
  try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQ, JSON.stringify(o, null, 2), 'utf8');
  return o;
}

const last8 = (x) => String(x || '').replace(/\D/g, '').slice(-8);
const norm = (t) => String(t || '').trim().toLowerCase();
// O EVO devolve o celular SEM o "55" (ex.: "62981055502"). O CRM (variantes9) só
// tolera o 9º dígito quando há o "55" na frente — sem ele, adicionarTag NÃO casa
// o contato existente e cria uma DUPLICATA. Aqui garantimos a forma canônica com
// "55" para os contatos NOVOS (os existentes usam a própria chave já guardada).
function normBR(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d;
}

/**
 * Sincroniza as tags a partir da lista de ALUNAS ATIVAS (com telefone) do EVO.
 * @param {Array<{id?,nome?,telefone?}>} ativas
 * @param {{dry?:boolean}} opts  dry=true só simula (não grava tag nenhuma).
 * @returns {{on,dry,alunasNovas,alunasAtualizadas,exAlunas,semTelefone,abortado,...}}
 */
function sincronizarTags(ativas, { dry = false } = {}) {
  const cfg = ler();
  const r = { on: cfg.on, dry: !!dry, alunasNovas: 0, alunasAtualizadas: 0, exAlunas: 0, semTelefone: 0, abortado: false, novasList: [], atualizadasList: [], exList: [], semTelList: [] };
  // Em modo real, só age se estiver ligado. Em --dry, mostra o que FARIA mesmo desligado.
  if (!cfg.on && !dry) { r.desligado = true; return r; }
  if (!Array.isArray(ativas)) { r.erro = 'lista de ativas inválida'; return r; }

  const alunaLc = norm(cfg.tagAluna), exLc = norm(cfg.tagExAluna);

  let mapa = {};
  try { mapa = contatos.carregar() || {}; } catch (e) { r.erro = 'não consegui ler os contatos: ' + (e && e.message); return r; }

  // Índice telefone(last8) → { key, contato } e contagem de quem já é "0. Aluna".
  const idx = new Map();
  let alunasAntes = 0;
  for (const tel in mapa) {
    const k = last8(tel); if (k && !idx.has(k)) idx.set(k, { key: tel, c: mapa[tel] });
    if ((mapa[tel].tags || []).some(t => norm(t) === alunaLc)) alunasAntes++;
  }

  // Telefones das ativas de hoje.
  const ativasTel = new Set();
  for (const a of ativas) { const k = last8(a.telefone); if (k) ativasTel.add(k); else { r.semTelefone++; r.semTelList.push({ nome: a.nome || '', id: a.id || '' }); } }

  // 1. ATIVAS → "0. Aluna" (cadastra se faltar; tira "0. Ex Aluna").
  for (const a of ativas) {
    const tel = String(a.telefone || '').replace(/\D/g, '');
    if (!tel) continue;
    const achou = idx.get(last8(tel));
    const jaAluna = achou && (achou.c.tags || []).some(t => norm(t) === alunaLc);
    if (!achou) { r.alunasNovas++; r.novasList.push({ nome: a.nome || '', telefone: tel }); }
    else if (!jaAluna) { r.alunasAtualizadas++; r.atualizadasList.push({ nome: a.nome || achou.c.nome || '', telefone: tel }); }
    if (!dry) {
      // GRAVA no contato JÁ existente (chave guardada) quando achou pelos últimos 8
      // dígitos; senão, cria em forma canônica com "55" — evita a duplicata do 9º díg.
      const alvo = achou ? achou.key : normBR(tel);
      // forcarNome: o nome OFICIAL do EVO sobrepõe o pushname do WhatsApp na conversa.
      try { contatos.adicionarTag(alvo, a.nome || (achou && achou.c.nome) || '', cfg.tagAluna, { forcarNome: !!(a.nome && a.nome.trim()) }); } catch (_) {}
      if (achou && (achou.c.tags || []).some(t => norm(t) === exLc)) { try { contatos.removerTag(alvo, cfg.tagExAluna); } catch (_) {} }
    }
  }

  // TRAVA DE SEGURANÇA: se a leitura veio suspeita (poucas ativas × muitas já
  // marcadas), NÃO rebaixa ninguém para ex-aluna — evita virar todo mundo
  // ex-aluna por um soluço do EVO. (As "0. Aluna" acima são seguras de aplicar.)
  if (alunasAntes >= 10 && ativasTel.size < alunasAntes * 0.5) {
    r.abortado = true;
    r.motivoAborto = `leitura suspeita: ${ativasTel.size} ativa(s) × ${alunasAntes} já marcada(s) — não rebaixei ninguém para ex-aluna.`;
    return r;
  }

  // 2. Quem TINHA "0. Aluna" e NÃO está mais entre as ativas → "0. Ex Aluna".
  for (const [k, v] of idx) {
    if (!(v.c.tags || []).some(t => norm(t) === alunaLc)) continue; // não era aluna
    if (ativasTel.has(k)) continue;                                  // segue ativa
    r.exAlunas++;
    r.exList.push({ nome: v.c.nome || '', telefone: v.key });
    if (!dry) {
      try { contatos.removerTag(v.key, cfg.tagAluna); } catch (_) {}
      try { contatos.adicionarTag(v.key, v.c.nome || '', cfg.tagExAluna); } catch (_) {}
    }
  }

  return r;
}

// Chave canônica de dedupe: DDD + 8 dígitos finais (sem "55", sem o 9º dígito).
// Distingue DDDs (evita fundir pessoas diferentes que só compartilham os últimos
// 8 dígitos) e junta as variantes com/sem 9 e com/sem 55 do MESMO número.
function chaveDedup(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3); // DDD + 9 + 8 → DDD + 8
  return d.length >= 10 ? d : ''; // canônico = DDD(2) + 8 dígitos
}

/**
 * Limpa contatos DUPLICADOS pelo 9º dígito / "55" (mesma pessoa em dois cadastros).
 * Escolhe um principal (prefere a forma com "55" — a do WhatsApp), MESCLA as tags
 * do duplicado nele e REMOVE o duplicado. Agrupa por DDD+8 (nunca funde DDDs
 * diferentes). dry=true só simula. Retorna a lista de ações.
 */
function limparDuplicatas({ dry = true } = {}) {
  let map = {};
  try { map = contatos.carregar() || {}; } catch (_) { return []; }
  const grupos = new Map();
  for (const key in map) {
    const k = chaveDedup(key); if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(key);
  }
  const acoes = [];
  for (const [, keys] of grupos) {
    if (keys.length < 2) continue;
    const com55 = keys.filter(x => String(x).startsWith('55')).sort((a, b) => b.length - a.length);
    const principal = com55[0] || keys.slice().sort((a, b) => b.length - a.length)[0];
    for (const o of keys) {
      if (o === principal) continue;
      const tags = (map[o] && map[o].tags) || [];
      acoes.push({ manter: principal, manterNome: (map[principal] && map[principal].nome) || '', remover: o, nome: (map[o] && map[o].nome) || '', tags });
      if (!dry) {
        try { for (const t of tags) contatos.adicionarTag(principal, (map[principal] && map[principal].nome) || (map[o] && map[o].nome) || '', t); } catch (_) {}
        try { contatos.remover(o); } catch (_) {}
      }
    }
  }
  return acoes;
}

module.exports = { ler, gravar, sincronizarTags, limparDuplicatas, PADRAO };

// CLI de limpeza de duplicatas: node src/auto-tag-alunas.js --limpar [--run]
if (require.main === module) {
  const run = process.argv.includes('--run');
  const acoes = limparDuplicatas({ dry: !run });
  console.log(`\n🧹 Duplicatas por 9º dígito / "55"${run ? '' : ' (SIMULAÇÃO — nada removido)'}: ${acoes.length} par(es).`);
  for (const a of acoes) {
    console.log(`   • fundir "${a.nome || 's/ nome'}" [${a.remover}] → manter [${a.manter}]${a.tags && a.tags.length ? ' (tags: ' + a.tags.join(', ') + ')' : ''}`);
  }
  console.log(run ? '\n✅ Duplicatas fundidas.' : '\n(Use --run para fundir de verdade.)');
  process.exit(0);
}

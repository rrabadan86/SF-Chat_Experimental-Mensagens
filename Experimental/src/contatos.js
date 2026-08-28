/**
 * contatos.js — CRM leve de contatos (Fase 1): importar CSV, listar/buscar/filtrar
 * por tag e editar as tags de cada contato. Guardado em data/contatos.json
 * (gitignored — dado pessoal). Chave = telefone normalizado (com DDI 55).
 *
 * Formato do CSV (cabeçalho flexível): Nome, Telefone, Instruções personalizadas, Tags.
 * Tags separadas por vírgula/ponto-e-vírgula (várias por contato).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQUIVO = path.join(DATA_DIR, 'contatos.json');
const ARQUIVO_TAGCFG = path.join(DATA_DIR, 'tags-config.json');

function normTel(t) {
  let d = String(t == null ? '' : t).replace(/\D/g, '');
  if (!d) return '';
  if (d.length < 10) return '';            // curto demais para ser telefone
  if (!d.startsWith('55')) d = '55' + d;   // garante o DDI
  return d;
}

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvar(map) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
  catch (_) {}
  fs.writeFileSync(ARQUIVO, JSON.stringify(map), 'utf8');
}

function limparTags(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[;,]/);
  const out = [];
  for (let t of arr) { t = String(t).trim(); if (t && !out.includes(t)) out.push(t); }
  return out;
}

// Insere ou atualiza um contato (mescla tags, não apaga as existentes na importação).
function upsert(map, { nome, telefone, tags, instrucoes }) {
  const tel = normTel(telefone);
  if (!tel) return null;
  const c = map[tel] || { tel, nome: '', tags: [], instrucoes: '', criadoEm: Date.now() };
  const nm = String(nome == null ? '' : nome).trim();
  if (nm) c.nome = nm;
  const ins = String(instrucoes == null ? '' : instrucoes).trim();
  if (ins && ins !== '-') c.instrucoes = ins;
  for (const t of limparTags(tags)) if (!c.tags.includes(t)) c.tags.push(t);
  c.atualizadoEm = Date.now();
  map[tel] = c;
  return c;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
function parseLinha(line, delim) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseCSV(texto) {
  const linhas = String(texto || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.length);
  if (!linhas.length) return { header: [], rows: [] };
  const delim = (linhas[0].split(';').length > linhas[0].split(',').length) ? ';' : ',';
  const header = parseLinha(linhas[0], delim).map(h => h.toLowerCase());
  const rows = linhas.slice(1).map(l => parseLinha(l, delim));
  return { header, rows };
}
function idxDe(header, chaves) {
  for (const k of chaves) { const i = header.findIndex(h => h.includes(k)); if (i >= 0) return i; }
  return -1;
}

// Importa um CSV. Devolve um resumo {novos, atualizados, ignorados, total}.
function importarCSV(texto) {
  const { header, rows } = parseCSV(texto);
  const iTel = idxDe(header, ['telefone', 'whatsapp', 'celular', 'fone']);
  if (iTel < 0) throw new Error('Não encontrei a coluna de Telefone no CSV. Cabeçalho esperado: Nome, Telefone, Tags.');
  const iNome = idxDe(header, ['nome']);
  const iIns = idxDe(header, ['instru']);
  const iTags = idxDe(header, ['tag']);
  const map = carregar();
  let novos = 0, atualizados = 0, ignorados = 0;
  for (const r of rows) {
    const tel = normTel(r[iTel]);
    if (!tel) { ignorados++; continue; }
    const existia = !!map[tel];
    upsert(map, {
      nome: iNome >= 0 ? r[iNome] : '',
      telefone: r[iTel],
      instrucoes: iIns >= 0 ? r[iIns] : '',
      tags: iTags >= 0 ? r[iTags] : '',
    });
    if (existia) atualizados++; else novos++;
  }
  salvar(map);
  return { novos, atualizados, ignorados, total: Object.keys(map).length };
}

// Exporta TODOS os contatos em CSV (mesmo formato do modelo/importação: Nome,
// Telefone, Tags, Instruções). Serve para levar a base para outra plataforma —
// e o próprio arquivo pode ser reimportado aqui sem perder nada. BOM p/ Excel
// abrir com acento certo; várias tags no mesmo contato separadas por ";".
function exportarCSV() {
  const map = carregar();
  const arr = Object.values(map).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const cel = v => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const linhas = ['Nome,Telefone,Instruções personalizadas,Tags'];
  for (const c of arr) {
    linhas.push([cel(c.nome), cel(c.tel), cel(c.instrucoes || ''), cel((c.tags || []).join(';'))].join(','));
  }
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

// Substitui as tags de um contato (edição manual no painel).
function setTags(telefone, tags) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!map[tel]) return false;
  map[tel].tags = tagsAposRegras(limparTags(tags)); // aplica transições entre tags
  map[tel].atualizadoEm = Date.now();
  salvar(map);
  return true;
}

// Exclui um contato.
function remover(telefone) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!map[tel]) return false;
  delete map[tel];
  salvar(map);
  return true;
}

// Edita nome/telefone/tags de um contato. Se o telefone mudar, muda a chave
// (se o novo número já existir, funde as tags no existente e remove o antigo).
function editarContato(telOrig, { nome, telefone, tags }) {
  const map = carregar();
  const orig = normTel(telOrig);
  if (!map[orig]) return false;
  let c = map[orig];
  if (nome != null) c.nome = String(nome).trim();
  if (tags != null) c.tags = limparTags(tags);
  const novo = normTel(telefone);
  if (novo && novo !== orig) {
    if (map[novo]) { // já existe → funde as tags e descarta o antigo
      for (const t of c.tags) if (!map[novo].tags.includes(t)) map[novo].tags.push(t);
      if (nome != null && String(nome).trim()) map[novo].nome = String(nome).trim();
      map[novo].atualizadoEm = Date.now();
      delete map[orig];
    } else { // re-chaveia
      c.tel = novo; map[novo] = c; delete map[orig];
    }
  } else {
    c.atualizadoEm = Date.now();
  }
  salvar(map);
  return true;
}

// ── Configuração por tag (automações estilo Zeetech) ────────────────────────
// { "<tag>": { autoAgendou: bool, avisarWpp: "<numero>" } }. Guardado em
// data/tags-config.json. Hoje o gatilho é "a SoFIA agendou uma aula
// experimental"; quando dispara, as tags com autoAgendou são aplicadas ao
// contato e os números em avisarWpp recebem um recado.
function lerTagsConfig() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO_TAGCFG, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvarTagsConfig(map) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQUIVO_TAGCFG, JSON.stringify(map, null, 2), 'utf8');
}
// Gatilhos possíveis: '' (nenhum) | 'agendou' | 'novo' | 'palavra' | 'ia' | 'humano' | 'encerrou' | 'campanha'.
//  • 'palavra' → casa por palavra-chave (contém), detectado no listener sem IA.
//  • 'ia'      → a SoFIA lê a conversa e decide pela INTENÇÃO descrita em `instrucao`.
const GATILHOS = ['agendou', 'novo', 'palavra', 'ia', 'humano', 'encerrou', 'campanha'];
function normCfg(c) {
  c = c || {};
  // compat: config antiga só tinha autoAgendou.
  const gatilho = String(c.gatilho || (c.autoAgendou ? 'agendou' : '') || '').trim();
  let palavras = [];
  if (Array.isArray(c.palavras)) palavras = c.palavras;
  else if (c.palavras) palavras = String(c.palavras).split(/[;,]/);
  palavras = palavras.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  let wpp = String(c.avisarWpp || '').replace(/\D/g, '');
  if (wpp && wpp.length >= 10 && wpp.length <= 11) wpp = '55' + wpp; // garante o DDI (Brasil)
  let remove = Array.isArray(c.remove) ? c.remove : (c.remove ? String(c.remove).split(/[;\n]/) : []);
  remove = remove.map(s => String(s).trim()).filter(Boolean);
  // Instrução em linguagem natural para o gatilho 'ia' (ex.: "quando a aluna
  // perguntar sobre preço, valores ou planos"). Limitada para não inflar o prompt.
  const instrucao = String(c.instrucao || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return {
    gatilho: GATILHOS.includes(gatilho) ? gatilho : '',
    palavras,
    instrucao,
    avisarWpp: wpp,
    remove,       // tags a remover do contato quando ESTA tag for aplicada
    encerrar: !!c.encerrar, // ao aplicar esta tag, encerra a conversa (🔒) → follow-up não incomoda
    criada: !!c.criada,
  };
}
function tagConfig(tag) { return normCfg(lerTagsConfig()[String(tag || '').trim()]); }
function definirTagConfig(tag, cfg) {
  tag = String(tag || '').trim(); if (!tag) return false;
  const map = lerTagsConfig();
  const n = normCfg(cfg);
  n.criada = !!(map[tag] && map[tag].criada) || !!(cfg && cfg.criada); // uma vez criada, permanece "conhecida"
  // Config totalmente vazia e não-criada → não guarda (evita lixo).
  if (!n.gatilho && !n.avisarWpp && !n.palavras.length && !n.instrucao && !n.remove.length && !n.encerrar && !n.criada) delete map[tag];
  else map[tag] = n;
  salvarTagsConfig(map);
  return true;
}
// Aplica as regras de exclusão entre tags: se um contato tem uma tag cuja config
// diz "remover X", tira X do conjunto. Usado ao adicionar/definir tags de um
// contato (transição de funil, ex.: entrar em "Agendou" tira "Contato inicial").
function tagsAposRegras(tags) {
  let cfg = {}; try { cfg = lerTagsConfig(); } catch (_) {}
  const set = new Set(tags);
  for (const t of tags) { const rem = normCfg(cfg[t]).remove || []; for (const r of rem) if (r !== t) set.delete(r); }
  return [...set];
}
// Cria uma tag "conhecida" (aparece nas listas mesmo sem contato).
function criarTag(nome) {
  nome = String(nome || '').trim();
  if (!nome) throw new Error('Informe o nome da tag.');
  if (nome.length > 60) throw new Error('Nome de tag muito longo.');
  const map = lerTagsConfig();
  if (!map[nome]) { map[nome] = normCfg({ criada: true }); salvarTagsConfig(map); }
  return nome;
}
// Tags configuradas com um gatilho específico (para as automações).
function tagsPorGatilho(g) {
  const map = lerTagsConfig();
  return Object.keys(map)
    .map(t => ({ tag: t, cfg: normCfg(map[t]) }))
    .filter(x => x.cfg.gatilho === g)
    .map(x => ({ tag: x.tag, avisarWpp: x.cfg.avisarWpp, palavras: x.cfg.palavras, instrucao: x.cfg.instrucao }));
}

// Adiciona UMA tag a um contato (cria o contato se não existir), sem mexer nas
// outras tags. Usado pela automação de agendamento.
function adicionarTag(telefone, nome, tag) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!tel) return false;
  const c = map[tel] || { tel, nome: '', tags: [], instrucoes: '', criadoEm: Date.now() };
  if (nome && !c.nome) c.nome = String(nome).trim();
  tag = String(tag || '').trim();
  if (tag && !c.tags.includes(tag)) c.tags.push(tag);
  c.tags = tagsAposRegras(c.tags); // aplica transições (ex.: sai de "Contato inicial")
  c.atualizadoEm = Date.now();
  map[tel] = c;
  salvar(map);
  return true;
}

// Remove UMA tag de um contato (não mexe nas outras). Usado por automações de
// estado (ex.: tira "Atendimento Humano" quando você devolve a conversa).
function removerTag(telefone, tag) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!map[tel]) return false;
  tag = String(tag || '').trim();
  const antes = (map[tel].tags || []).length;
  map[tel].tags = (map[tel].tags || []).filter(t => t !== tag);
  if (map[tel].tags.length !== antes) { map[tel].atualizadoEm = Date.now(); salvar(map); return true; }
  return false;
}

// Ação em LOTE: adiciona a tag `add` e/ou remove a tag `rm` num conjunto de
// contatos, numa passada só. O conjunto é:
//   • a lista `tels` (telefones), quando informada — seleção por linha no painel;
//   • senão, todos os contatos que casam com o filtro atual (busca+tag+bloqueio).
// Ao adicionar, respeita as regras de transição de funil (tagsAposRegras).
// Retorna quantos contatos foram efetivamente alterados. Grava uma vez só.
function aplicarTagLote({ q = '', tag = '', bloq = '', bloqueados = [], tels = null, add = '', rm = '' } = {}) {
  add = String(add || '').trim();
  rm = String(rm || '').trim();
  if (!add && !rm) throw new Error('Escolha ao menos uma tag para adicionar ou remover.');
  const map = carregar();
  let alvos;
  if (Array.isArray(tels) && tels.length) {
    const set = new Set(tels.map(t => normTel(t)).filter(Boolean));
    alvos = Object.values(map).filter(c => set.has(normTel(c.tel)));
  } else {
    alvos = filtrarContatos(Object.values(map), { q, tag, bloq, bloqueados });
  }
  const agora = Date.now();
  let n = 0;
  for (const c of alvos) {
    const antes = (c.tags || []).slice();
    const set = new Set(antes);
    if (rm) set.delete(rm);
    if (add) set.add(add);
    // Regras de funil só quando ADICIONA (senão remover poderia tirar outras tags).
    let novo = add ? tagsAposRegras([...set]) : [...set];
    const mudou = novo.length !== antes.length || novo.some(t => !antes.includes(t));
    c.tags = novo;
    if (mudou) { c.atualizadoEm = agora; n++; }
  }
  if (n) salvar(map);
  return n;
}
// Quantos contatos casam com o filtro atual (para o painel mostrar o total no
// botão de "aplicar a N contatos", sem paginar).
function contarFiltrados({ q = '', tag = '', bloq = '', bloqueados = [] } = {}) {
  return filtrarContatos(Object.values(carregar()), { q, tag, bloq, bloqueados }).length;
}

// Renomeia uma tag em TODOS os contatos. Devolve quantos foram afetados.
function renomearTag(de, para) {
  de = String(de || '').trim(); para = String(para || '').trim();
  if (!de || !para || de === para) return 0;
  const map = carregar(); let n = 0;
  for (const c of Object.values(map)) {
    if ((c.tags || []).includes(de)) { c.tags = limparTags(c.tags.map(t => t === de ? para : t)); c.atualizadoEm = Date.now(); n++; }
  }
  salvar(map);
  // Carrega a config junto com a tag renomeada.
  try { const cfg = lerTagsConfig(); if (cfg[de]) { cfg[para] = cfg[de]; delete cfg[de]; salvarTagsConfig(cfg); } } catch (_) {}
  return n;
}

// Remove uma tag de TODOS os contatos. Devolve quantos foram afetados.
function excluirTag(tag) {
  tag = String(tag || '').trim();
  if (!tag) return 0;
  const map = carregar(); let n = 0;
  for (const c of Object.values(map)) {
    const antes = (c.tags || []).length;
    c.tags = (c.tags || []).filter(t => t !== tag);
    if (c.tags.length !== antes) { c.atualizadoEm = Date.now(); n++; }
  }
  salvar(map);
  try { const cfg = lerTagsConfig(); if (cfg[tag]) { delete cfg[tag]; salvarTagsConfig(cfg); } } catch (_) {}
  return n;
}

// Lista com busca (nome/telefone), filtro por tag e paginação.
// bloq: '' (todos) | 'sim' (só bloqueados) | 'nao' (só não bloqueados).
// bloqueados: lista de telefones (dígitos) bloqueados — vem do módulo da SoFIA,
// porque o estado de bloqueio mora lá (sofia.lerBloqueios). Filtramos AQUI, antes
// de paginar, para o total/paginação ficarem certos (o botão antigo só escondia
// as linhas da página atual — por isso "Bloqueados" parecia vazio sem filtrar).
// Aplica os mesmos filtros da tela de Contatos (busca + tag + bloqueio) a um
// array de contatos. Compartilhado por listar() e pela ação em lote, para que
// "o filtro atual" signifique exatamente o mesmo conjunto nos dois.
function filtrarContatos(arr, { q = '', tag = '', bloq = '', bloqueados = [] } = {}) {
  if (q) {
    const s = String(q).toLowerCase();
    const sd = s.replace(/\D/g, '');
    arr = arr.filter(c => (c.nome || '').toLowerCase().includes(s) || (sd && (c.tel || '').includes(sd)));
  }
  if (tag === '__sem__') arr = arr.filter(c => !((c.tags || []).length));
  else if (tag) arr = arr.filter(c => (c.tags || []).includes(tag));
  if (bloq === 'sim' || bloq === 'nao') {
    const set = new Set((bloqueados || []).map(x => String(x).replace(/\D/g, '')).filter(Boolean));
    const estaBloq = c => set.has(String(c.tel || '').replace(/\D/g, ''));
    arr = arr.filter(c => bloq === 'sim' ? estaBloq(c) : !estaBloq(c));
  }
  return arr;
}

function listar({ q = '', tag = '', pagina = 0, porPagina = 25, bloq = '', bloqueados = [] } = {}) {
  const map = carregar();
  let arr = filtrarContatos(Object.values(map), { q, tag, bloq, bloqueados });
  arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const total = arr.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  pagina = Math.max(0, Math.min(parseInt(pagina, 10) || 0, paginas - 1));
  const itens = arr.slice(pagina * porPagina, pagina * porPagina + porPagina);
  return { itens, total, pagina, paginas, porPagina };
}

// Tags distintas com contagem (para o filtro e a visão geral).
function tagsDistintas() {
  const map = carregar();
  const c = {};
  for (const ct of Object.values(map)) for (const t of (ct.tags || [])) c[t] = (c[t] || 0) + 1;
  // Inclui tags "conhecidas" (criadas ou com automação) mesmo sem contato ainda.
  try { const cfg = lerTagsConfig(); for (const t of Object.keys(cfg)) if (!(t in c)) c[t] = 0; } catch (_) {}
  return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { sensitivity: 'base', numeric: true })).map(([tag, n]) => ({ tag, n }));
}

function totalContatos() { return Object.keys(carregar()).length; }

// Existe um contato salvo com este telefone?
function existe(telefone) { const t = normTel(telefone); return !!(t && carregar()[t]); }

// Adiciona/mescla UM contato (usado ao salvar direto de uma conversa).
function adicionar({ nome, telefone, tags, instrucoes }) {
  const map = carregar();
  const c = upsert(map, { nome, telefone, tags, instrucoes });
  if (!c) throw new Error('Telefone inválido.');
  salvar(map);
  return c;
}

module.exports = {
  normTel, carregar, importarCSV, exportarCSV, setTags, listar, tagsDistintas, totalContatos,
  remover, editarContato, renomearTag, excluirTag, existe, adicionar, ARQUIVO,
  tagConfig, definirTagConfig, tagsPorGatilho, criarTag, adicionarTag, removerTag, lerTagsConfig, GATILHOS,
  aplicarTagLote, contarFiltrados,
};

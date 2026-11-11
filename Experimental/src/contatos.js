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

// Variantes do 9º dígito do celular BR: o mesmo número pode aparecer COM o 9
// (55 + DDD + 9 + 8 dígitos = 13) ou SEM (55 + DDD + 8 = 12) — o WhatsApp (@c.us)
// costuma usar a forma antiga sem o 9, e o CRM às vezes guarda com o 9. Devolve as
// duas formas para casar o mesmo contato independentemente disso.
function variantes9(t) {
  const d = normTel(t); if (!d) return [];
  const out = new Set([d]);
  const m = /^55(\d{2})(\d+)$/.exec(d);
  if (m) {
    const ddd = m[1], resto = m[2];
    if (resto.length === 9 && resto[0] === '9') out.add('55' + ddd + resto.slice(1)); // tira o 9
    else if (resto.length === 8) out.add('55' + ddd + '9' + resto);                   // põe o 9
  }
  return [...out];
}
// Acha o contato existente por telefone, tolerante ao 9º dígito. Retorna
// { chave, contato } (chave = como está guardado) ou null. `map` opcional evita
// recarregar quando o chamador já tem a base em mãos.
function acharPorTel(telefone, map) {
  const m = map || carregar();
  for (const v of variantes9(telefone)) if (m[v]) return { chave: v, contato: m[v] };
  return null;
}

function carregar() {
  let txt = null;
  try { txt = fs.readFileSync(ARQUIVO, 'utf8'); } catch (_) { return {}; } // ainda não existe
  try { const o = JSON.parse(txt); return (o && typeof o === 'object') ? o : {}; }
  catch (e) {
    // Arquivo existe mas está corrompido: guarda uma cópia ANTES de seguir vazio —
    // senão o próximo salvar() gravaria {} por cima e a base inteira se perderia.
    try { const bk = ARQUIVO + '.corrompido-' + Date.now(); if (txt && txt.trim() && !carregar._bk) { carregar._bk = true; fs.writeFileSync(bk, txt); console.error(`[${path.basename(ARQUIVO)}] arquivo corrompido — cópia em ${bk}`); } } catch (_) {}
    return {};
  }
}
// Grava num arquivo temporário e troca de uma vez (rename): um desligamento no meio
// da gravação não deixa o JSON pela metade.
function gravarAtomico(arq, conteudo) {
  const tmp = arq + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, conteudo, 'utf8');
  fs.renameSync(tmp, arq);
}
// ── Trava entre processos ───────────────────────────────────────────────────
// O painel e o robô (comparecimento, auto-tag, sentimos-falta…) gravam este mesmo
// arquivo em processos separados. Cada alteração faz ler → mudar → gravar; sem
// trava, se os dois fizessem isso ao mesmo tempo, o último apagava a mudança do
// outro (ex.: tag aplicada no painel enquanto o robô marcava comparecimento).
// A trava é um diretório (mkdir é atômico); reentrante no mesmo processo; uma
// trava esquecida (processo morto) é desfeita depois de 15 s.
const TRAVA = ARQUIVO + '.lock';
let _travaNivel = 0;
function _dormir(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} }
function travar() {
  if (_travaNivel++ > 0) return;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  const ate = Date.now() + 8000;
  for (;;) {
    try { fs.mkdirSync(TRAVA); try { fs.writeFileSync(path.join(TRAVA, 'pid'), String(process.pid)); } catch (_) {} return; } catch (e) {
      if (e.code !== 'EEXIST') return; // sem permissão etc.: segue sem trava (como antes)
      try { if (Date.now() - fs.statSync(TRAVA).mtimeMs > 15000) { fs.rmSync(TRAVA, { recursive: true, force: true }); continue; } } catch (_) { continue; }
      if (Date.now() > ate) { console.warn('[contatos] trava ocupada há 8 s — seguindo sem ela'); return; }
      _dormir(25);
    }
  }
}
function destravar() {
  if (_travaNivel <= 0) { _travaNivel = 0; return; }
  if (--_travaNivel > 0) return;
  try { fs.rmSync(TRAVA, { recursive: true, force: true }); } catch (_) {}
}
// Executa a alteração inteira (ler → mudar → gravar) com a trava.
const comTrava = (fn) => function (...args) { travar(); try { return fn.apply(this, args); } finally { destravar(); } };

function salvar(map) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
  catch (_) {}
  gravarAtomico(ARQUIVO, JSON.stringify(map));
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
  // Reaproveita um contato JÁ existente em qualquer variante do 9º dígito
  // (55DDD9XXXX vs 55DDDXXXX) em vez de criar uma duplicata. Sem isto, importar o
  // mesmo número nas duas formas gerava dois cadastros com tags desencontradas.
  let chave = tel;
  const achado = acharPorTel(tel, map);
  if (achado) chave = achado.chave;
  const c = map[chave] || { tel: chave, nome: '', tags: [], instrucoes: '', criadoEm: Date.now() };
  const nm = String(nome == null ? '' : nome).trim();
  if (nm) c.nome = nm;
  const ins = String(instrucoes == null ? '' : instrucoes).trim();
  if (ins && ins !== '-') c.instrucoes = ins;
  for (const t of limparTags(tags)) if (!c.tags.includes(t)) c.tags.push(t);
  c.atualizadoEm = Date.now();
  map[chave] = c;
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
// DEFINE o conjunto EXATO de tags de um contato (edição manual pelo painel).
// NÃO aplica as transições de funil (tagsAposRegras) de propósito: na tela
// "Editar contato" o usuário escolhe a dedo quais tags ficam — o que ele vê
// marcado é o que deve ser gravado. As transições (ex.: "Agendou" tira
// "Contato inicial") valem para as AUTOMAÇÕES, que aplicam UMA tag por vez via
// adicionarTag; ali sim faz sentido limpar o estágio anterior. Antes esta
// função rodava as transições e removia a segunda tag manual (ex.: manter
// "0. Equipe" e "0. Aluna" juntas era impossível).
function setTags(telefone, tags) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!map[tel]) return false;
  map[tel].tags = limparTags(tags); // grava o conjunto exato escolhido (só remove duplicatas/vazios)
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

// Exclui VÁRIOS contatos de uma vez (lista de telefones). Devolve quantos saíram.
function removerLote(tels) {
  const set = new Set((Array.isArray(tels) ? tels : []).map(t => normTel(t)).filter(Boolean));
  if (!set.size) return 0;
  const map = carregar();
  let n = 0;
  for (const k of Object.keys(map)) if (set.has(k) || set.has(normTel((map[k] || {}).tel))) { delete map[k]; n++; }
  if (n) salvar(map);
  return n;
}

// Edita nome/telefone/tags de um contato. Se o telefone mudar, muda a chave
// (se o novo número já existir, funde as tags no existente e remove o antigo).
function editarContato(telOrig, { nome, telefone, tags }) {
  const map = carregar();
  const orig = normTel(telOrig);
  if (!map[orig]) return false;
  let c = map[orig];
  if (nome != null) { const nm = String(nome).trim(); if (nm && nm !== c.nome) c.nomeManual = true; c.nome = nm; }
  if (tags != null) c.tags = limparTags(tags);
  const novo = normTel(telefone);
  if (novo && novo !== orig) {
    if (map[novo]) { // já existe → funde as tags e descarta o antigo
      for (const t of c.tags) if (!map[novo].tags.includes(t)) map[novo].tags.push(t);
      if (nome != null && String(nome).trim()) { if (String(nome).trim() !== map[novo].nome) map[novo].nomeManual = true; map[novo].nome = String(nome).trim(); }
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

// Nome completo informado no AGENDAMENTO (SoFIA, Cadastro Express, formulário):
// atualiza o nome do contato, salvo quando
//   • a equipe digitou o nome à mão no painel (nomeManual) — nunca é trocado;
//   • o primeiro nome é outro — e não é um apelido que começa igual, como
//     "Lu" → "Luciana" (ex.: mãe "Ana Souza" agendando para a filha
//     "Júlia Souza") — o nome fica como está e o do agendamento é guardado em
//     nomeAgendado (aparece na lista de Contatos);
//   • o nome novo não é "completo" (precisa de nome e sobrenome).
// Devolve { mudou, antes, depois, motivo }.
const _normNome = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const _capitalizar = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, w => w.toLowerCase());
function nomeDoAgendamento(telefone, nomeNovo) {
  const map = carregar();
  const achado = acharPorTel(telefone, map);
  const novoBruto = String(nomeNovo || '').trim().replace(/\s+/g, ' ');
  const partes = _normNome(novoBruto).split(' ').filter(w => w.length > 1);
  if (!achado) return { mudou: false, motivo: 'contato não encontrado' };
  const c = achado.contato;
  if (partes.length < 2) return { mudou: false, motivo: 'nome incompleto' };
  // Nome todo em maiúsculas/minúsculas (como a pessoa digitou) → "Marina Ferreira Zanola"
  const novo = (novoBruto === novoBruto.toUpperCase() || novoBruto === novoBruto.toLowerCase()) ? _capitalizar(novoBruto) : novoBruto;
  const antes = String(c.nome || '').trim();
  if (_normNome(antes) === _normNome(novo)) return { mudou: false, motivo: 'igual' };
  const palavrasAntes = _normNome(antes).split(' ').filter(w => w.length > 1);
  const primeiroAntes = palavrasAntes[0] || '';
  // Mesmo primeiro nome, ou apelido de uma palavra que é o começo dele ("Lu" → "Luciana").
  const mesmaPessoa = !primeiroAntes || primeiroAntes === partes[0] || (palavrasAntes.length === 1 && partes[0].startsWith(primeiroAntes));
  const motivoNao = c.nomeManual ? 'nome editado no painel' : (!mesmaPessoa ? 'outro primeiro nome' : '');
  if (motivoNao) {
    if (c.nomeAgendado !== novo) { c.nomeAgendado = novo; c.atualizadoEm = Date.now(); salvar(map); }
    return { mudou: false, antes, depois: novo, motivo: motivoNao };
  }
  c.nome = novo; delete c.nomeAgendado; c.nomeDoAgendamentoEm = Date.now(); c.atualizadoEm = Date.now();
  salvar(map);
  return { mudou: true, antes, depois: novo };
}
// Marca que o nome foi digitado pela equipe (não é mais trocado pelo agendamento).
function marcarNomeManual(telefone) {
  const map = carregar();
  const a = acharPorTel(telefone, map); if (!a || a.contato.nomeManual) return false;
  a.contato.nomeManual = true; salvar(map); return true;
}

// ── Configuração por tag (automações estilo Zeetech) ────────────────────────
// { "<tag>": { autoAgendou: bool, avisarWpp: "<numero>" } }. Guardado em
// data/tags-config.json. Hoje o gatilho é "a SoFIA agendou uma aula
// experimental"; quando dispara, as tags com autoAgendou são aplicadas ao
// contato e os números em avisarWpp recebem um recado.
// Unidade NOVA (sem data/tags-config.json): nasce com as tags/automações padrão do
// repositório (Experimental/tags-config.default.json — as automações da SoFIA e as
// tags que o robô usa). Sem isso o painel publicava regras VAZIAS e apagava as
// automações semeadas no SOFIA_DIR. Só semeia se o arquivo NÃO existe (quem apagou
// as tags de propósito fica com {} e não é ressemeado).
const TAGCFG_PADRAO = path.resolve(__dirname, '..', 'tags-config.default.json');
function semearTagsConfig() {
  try {
    const o = JSON.parse(fs.readFileSync(TAGCFG_PADRAO, 'utf8'));
    if (o && typeof o === 'object' && Object.keys(o).length && !fs.existsSync(ARQUIVO_TAGCFG)) salvarTagsConfig(o);
  } catch (_) {}
}
function lerTagsConfig() {
  if (!fs.existsSync(ARQUIVO_TAGCFG)) semearTagsConfig();
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO_TAGCFG, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvarTagsConfig(map) {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  gravarAtomico(ARQUIVO_TAGCFG, JSON.stringify(map, null, 2));
}
// Gatilhos possíveis: '' (nenhum) | 'agendou' | 'novo' | 'palavra' | 'ia' | 'humano' | 'encerrou' | 'campanha'.
//  • 'palavra' → casa por palavra-chave (contém), detectado no listener sem IA.
//  • 'ia'      → a SoFIA lê a conversa e decide pela INTENÇÃO descrita em `instrucao`.
const GATILHOS = ['agendou', 'novo', 'mensagem', 'palavra', 'ia', 'humano', 'encerrou', 'campanha', 'anuncio'];
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
  // Só aplica (e só avisa) em quem já tem alguma destas tags. Vazio = qualquer pessoa.
  let exige = Array.isArray(c.exige) ? c.exige : (c.exige ? String(c.exige).split(/[;\n]/) : []);
  exige = [...new Set(exige.map(s => String(s).trim()).filter(Boolean))];
  // Instrução em linguagem natural para o gatilho 'ia' (ex.: "quando a aluna
  // perguntar sobre preço, valores ou planos"). Limitada para não inflar o prompt.
  const instrucao = String(c.instrucao || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 2000);
  // Gatilho 'campanha': id da campanha à qual a regra está amarrada. Vazio = qualquer
  // campanha (comportamento antigo). Com id, a tag só é aplicada a quem respondeu
  // ÀQUELA campanha — não a quem respondeu qualquer outra (ou um teste antigo).
  const campanhaId = String(c.campanhaId || '').trim().slice(0, 40);
  return {
    gatilho: GATILHOS.includes(gatilho) ? gatilho : '',
    palavras,
    instrucao,
    campanhaId,
    avisarWpp: wpp,
    remove,       // tags a remover do contato quando ESTA tag for aplicada
    exige,        // só para contatos que já têm alguma destas tags
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
  if (!n.gatilho && !n.avisarWpp && !n.palavras.length && !n.instrucao && !n.campanhaId && !n.remove.length && !n.exige.length && !n.encerrar && !n.criada) delete map[tag];
  else map[tag] = n;
  salvarTagsConfig(map);
  return true;
}
// Aplica as regras de exclusão entre tags: se um contato tem uma tag cuja config
// diz "remover X", tira X do conjunto. Usado ao adicionar/definir tags de um
// contato (transição de funil, ex.: entrar em "Agendou" tira "Contato inicial").
// `nova` = a tag que está sendo APLICADA agora. Ela nunca é apagada pela regra de
// uma tag que a pessoa já tinha ("Ao aplicar ESTA tag, remover…" vale para quem
// chega). Antes, quem tinha "Fez Aula Experimental" (que remove "Sem interesse")
// recebia "Sem interesse" da SoFIA e a tag sumia na mesma hora — o log dizia
// "aplicada" e o contato ficava sem ela. Sem `nova` (ou com protegerNova=false),
// mantém o comportamento antigo: a regra de qualquer tag presente vale.
function tagsAposRegras(tags, nova, protegerNova = true) {
  let cfg = {}; try { cfg = lerTagsConfig(); } catch (_) {}
  const set = new Set(tags);
  const prot = nova && protegerNova ? String(nova) : '';
  for (const t of tags) { const rem = normCfg(cfg[t]).remove || []; for (const r of rem) if (r !== t && r !== prot) set.delete(r); }
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
    .map(x => ({ tag: x.tag, avisarWpp: x.cfg.avisarWpp, palavras: x.cfg.palavras, instrucao: x.cfg.instrucao, campanhaId: x.cfg.campanhaId }));
}

// Adiciona UMA tag a um contato (cria o contato se não existir), sem mexer nas
// outras tags. Usado pela automação de agendamento.
function adicionarTag(telefone, nome, tag, opts) {
  const map = carregar();
  const tel = normTel(telefone);
  if (!tel) return false;
  // Reaproveita o contato JÁ existente em qualquer variante do 9º dígito (com/sem o
  // 9), como o upsert. Sem isto, a automação da SoFIA cria uma DUPLICATA quando a
  // aluna já está cadastrada na outra forma — ex.: a SoFIA recebe a mensagem SEM o
  // 9 (@c.us antigo) mas o CRM tem a aluna COM o 9 → nasce um "novo lead" errado
  // com "Contato inicial" ao lado da mesma pessoa que já era "0. Aluna".
  const achado = acharPorTel(tel, map);
  const chave = achado ? achado.chave : tel;
  const c = map[chave] || { tel: chave, nome: '', tags: [], instrucoes: '', criadoEm: Date.now() };
  // Normalmente só preenche o nome se estiver vazio (não atropela o pushname do
  // WhatsApp). Com opts.forcarNome (ex.: sincronização com o EVO), o nome oficial
  // do EVO SOBREPÕE o da conversa.
  if (nome && (!c.nome || (opts && opts.forcarNome))) c.nome = String(nome).trim();
  // Código do cliente no EVO (vem da sincronização de alunas) — o painel monta o link do perfil.
  if (opts && opts.idEvo && /^\d+$/.test(String(opts.idEvo))) c.idEvo = String(opts.idEvo);
  tag = String(tag || '').trim();
  if (tag && !c.tags.includes(tag)) c.tags.push(tag);
  // aplica transições (ex.: sai de "Contato inicial"). A tag aplicada agora fica,
  // exceto quando opts.ceder (gatilhos genéricos, ex.: "mandou mensagem" → "Contato
  // inicial" não deve voltar a quem já está mais à frente no funil).
  c.tags = tagsAposRegras(c.tags, tag, !(opts && opts.ceder));
  c.atualizadoEm = Date.now();
  map[chave] = c;
  salvar(map);
  return !tag || c.tags.includes(tag); // false = a tag cedeu à regra de outra que ela já tinha
}

// Remove UMA tag de um contato (não mexe nas outras). Usado por automações de
// estado (ex.: tira "Atendimento Humano" quando você devolve a conversa). Também
// tolerante ao 9º dígito para achar o mesmo contato guardado na outra forma.
function removerTag(telefone, tag) {
  const map = carregar();
  const achado = acharPorTel(normTel(telefone), map);
  if (!achado) return false;
  const chave = achado.chave;
  tag = String(tag || '').trim();
  const antes = (map[chave].tags || []).length;
  map[chave].tags = (map[chave].tags || []).filter(t => t !== tag);
  if (map[chave].tags.length !== antes) { map[chave].atualizadoEm = Date.now(); salvar(map); return true; }
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
  const mudados = []; // telefones efetivamente alterados (p/ o timeline registrar quem mexeu)
  for (const c of alvos) {
    const antes = (c.tags || []).slice();
    const set = new Set(antes);
    if (rm) set.delete(rm);
    if (add) set.add(add);
    // Regras de funil só quando ADICIONA (senão remover poderia tirar outras tags).
    let novo = add ? tagsAposRegras([...set], add) : [...set];
    const mudou = novo.length !== antes.length || novo.some(t => !antes.includes(t));
    c.tags = novo;
    if (mudou) { c.atualizadoEm = agora; mudados.push(normTel(c.tel)); }
  }
  if (mudados.length) salvar(map);
  return mudados;
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

// As funções que GRAVAM saem embrulhadas na trava; as de leitura, não.
module.exports = {
  normTel, variantes9, acharPorTel, carregar, importarCSV: comTrava(importarCSV), exportarCSV, setTags: comTrava(setTags), listar, tagsDistintas, totalContatos,
  remover: comTrava(remover), removerLote: comTrava(removerLote), editarContato: comTrava(editarContato), renomearTag: comTrava(renomearTag), excluirTag: comTrava(excluirTag), existe, adicionar: comTrava(adicionar), ARQUIVO,
  tagConfig, definirTagConfig: comTrava(definirTagConfig), tagsPorGatilho, criarTag: comTrava(criarTag), adicionarTag: comTrava(adicionarTag), removerTag: comTrava(removerTag), lerTagsConfig, salvarTagsConfig, GATILHOS,
  aplicarTagLote: comTrava(aplicarTagLote), contarFiltrados,
  nomeDoAgendamento: comTrava(nomeDoAgendamento), marcarNomeManual: comTrava(marcarNomeManual),
};

/**
 * sofia-editor.js — lê/grava os arquivos da Sofia (o chatbot em ../../ChatBot),
 * para a aba "🤖 Sofia" do painel editar o prompt e as configs SEM tocar em
 * código e sem reiniciar (a Sofia lê os arquivos a cada conversa).
 *
 * Substitui o antigo ChatBot/editor.ts (telinha separada) — a mesma lógica de
 * seções (# ...), extração, mídias, estado on/off e pausa, agora no painel.
 *
 * A pasta da Sofia é configurável (SOFIA_DIR); o padrão é a pasta ChatBot do
 * mesmo repositório. Se ela não existir nesta máquina, disponivel() é false.
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.SOFIA_DIR || path.resolve(__dirname, '..', '..', 'ChatBot');
const F = {
  prompt: path.join(DIR, 'sofia-prompt.txt'),
  promptBak: path.join(DIR, 'sofia-prompt.bak.txt'),
  extracao: path.join(DIR, 'sofia-extracao.txt'),
  extracaoBak: path.join(DIR, 'sofia-extracao.bak.txt'),
  estado: path.join(DIR, 'sofia-estado.txt'),
  pausa: path.join(DIR, 'sofia-pausa-min.txt'),
  sessao: path.join(DIR, 'sofia-sessao-horas.txt'), // janela de memória da conversa (horas) — lida pela Sofia
  healthMin: path.join(DIR, 'sofia-health-min.txt'), // intervalo do health-check (min) — lido pelo listener
  agruparSeg: path.join(DIR, 'sofia-agrupar-seg.txt'), // debounce de mensagens (seg) — lido pelo listener
  midias: path.join(DIR, 'sofia-midias.txt'),
  ritmo: path.join(DIR, 'sofia-ritmo.json'), // "jeito humano" (velocidade/pausas) — lido pelo listener
  waStatus: path.join(DIR, 'sofia-wa-status.json'), // publicado pelo listener da Sofia
  conversas: path.join(DIR, 'sofia-conversas.json'), // inbox — publicado pelo listener
  historico: path.join(DIR, 'sofia-historico.json'), // histórico de interações — publicado pelo listener
  agendou: path.join(DIR, 'sofia-agendou.jsonl'), // agendamentos concluídos — a SoFIA escreve, o painel consome
  avisos: path.join(DIR, 'sofia-avisos.jsonl'), // recados p/ um número — o painel escreve, o listener envia
  regras: path.join(DIR, 'sofia-regras.json'), // regras de automação por gatilho — painel escreve, listener lê
  eventos: path.join(DIR, 'sofia-eventos.jsonl'), // ações de automação — listener escreve, painel consome
  respostas: path.join(DIR, 'sofia-respostas.jsonl'), // fila de respostas do painel → listener envia
  humano: path.join(DIR, 'sofia-humano.json'), // conversas sob controle humano (Sofia não responde) — lido pela Sofia
  bloqueios: path.join(DIR, 'sofia-bloqueios.json'), // números bloqueados (Sofia ignora) — painel escreve, listener lê
  followupCfg: path.join(DIR, 'sofia-followup-cfg.json'), // config do follow-up (ligado/tempo/instrução) — painel
  followup: path.join(DIR, 'sofia-followup.jsonl'), // fila de follow-ups a gerar+enviar — painel escreve, listener consome
  campanhas: path.join(DIR, 'campanhas.json'), // estado das campanhas — publicado pelo listener (painel só lê)
  campanhasInbox: path.join(DIR, 'campanhas-inbox.jsonl'), // pedidos do painel → listener (criar/controle/excluir)
};

// Padrões do "jeito humano" (mesmos do listener). O painel edita e o listener lê
// este arquivo a cada mensagem — muda sem reiniciar.
const RITMO_PADRAO = { humano: true, msPorChar: 45, delayMin: 1200, delayMax: 4500 };

function ler(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
function existe(p) { try { return fs.existsSync(p); } catch (_) { return false; } }

// Gravação ATÔMICA e à prova de dono: escreve num arquivo temporário e faz
// rename por cima do destino. O rename substitui o alvo mesmo que ele seja de
// OUTRO usuário (ex.: criado como root), desde que a PASTA seja gravável —
// resolve o caso em que sofia-prompt.txt não podia ser sobrescrito e o prompt
// "voltava para o original". Confere lendo de volta; lança erro claro se falhar.
function gravarArquivo(destino, conteudo) {
  const dir = path.dirname(destino);
  const tmp = path.join(dir, '.' + path.basename(destino) + '.tmp-' + process.pid + '-' + Date.now());
  try {
    fs.writeFileSync(tmp, conteudo, 'utf8');
    fs.renameSync(tmp, destino); // atômico; troca mesmo arquivo de outro dono (precisa dir gravável)
  } catch (e1) {
    // Plano B: apagar o alvo (precisa só de permissão na PASTA) e escrever direto.
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    try { fs.rmSync(destino, { force: true }); fs.writeFileSync(destino, conteudo, 'utf8'); }
    catch (e2) {
      throw new Error('Não consegui gravar "' + path.basename(destino) + '": ' + (e2 && e2.message || e1 && e1.message) +
        '. Verifique as permissões da pasta da SoFIA (' + dir + ') — o usuário do painel precisa poder gravar nela.');
    }
  }
  // Confirma que o conteúdo REALMENTE ficou salvo (pega falha silenciosa/parcial).
  let lido = '';
  try { lido = fs.readFileSync(destino, 'utf8'); } catch (_) {}
  if (lido !== conteudo) {
    throw new Error('Gravei "' + path.basename(destino) + '" mas a releitura não bateu — provável problema de permissão/disco na pasta ' + dir + '.');
  }
}

// Semeadura: prompt/extração/mídias são editáveis pelo painel e ficam FORA do Git.
// O conteúdo base mora nos sofia-*.default.txt (versionados). Se o arquivo "vivo"
// sumir (clone novo ou git pull), recriamos a partir do .default — assim o painel
// nunca mostra vazio e o "git pull" e o painel nunca conflitam.
function comDefault(p) { return p.replace(/\.txt$/, '.default.txt'); }
function semear() {
  for (const vivo of [F.prompt, F.extracao, F.midias]) {
    try { const base = comDefault(vivo); if (!existe(vivo) && existe(base)) fs.copyFileSync(base, vivo); } catch (_) {}
  }
}
function disponivel() { semear(); return existe(DIR) && existe(F.prompt); }

// ── estado (on/off) e pausa (minutos de atendimento humano) ─────────────────
function estadoAtivo() { return ler(F.estado).trim().toLowerCase() !== 'off'; }
function gravarEstado(ativo) { gravarArquivo(F.estado, ativo ? 'on' : 'off'); }
function lerPausaMin() { const n = parseInt(ler(F.pausa).trim(), 10); return Number.isFinite(n) && n > 0 ? n : 30; }
function gravarPausaMin(n) { gravarArquivo(F.pausa, String(n)); }

// ── janela de sessão (memória da conversa), em HORAS ────────────────────────
// Padrão 12h (mesmo da Sofia). Depois desse tempo sem mensagens, a próxima
// mensagem começa uma conversa nova (a Sofia não lembra do que foi dito antes).
const SESSAO_HORAS_PADRAO = 12;
function lerSessaoHoras() {
  const n = parseFloat(ler(F.sessao).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : SESSAO_HORAS_PADRAO;
}
function gravarSessaoHoras(h) {
  const n = parseFloat(String(h).replace(',', '.'));
  const val = Number.isFinite(n) && n > 0 ? Math.min(n, 720) : SESSAO_HORAS_PADRAO;
  gravarArquivo(F.sessao, String(val));
}

// ── verificação de conexão (health-check), em MINUTOS ───────────────────────
// Padrão 3 min. 0 = desligado. Lido pelo listener a cada ciclo (muda sem reiniciar).
const HEALTH_MIN_PADRAO = 3;
function lerHealthMin() {
  const s = ler(F.healthMin).trim();
  if (s === '') return HEALTH_MIN_PADRAO;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : HEALTH_MIN_PADRAO;
}
function gravarHealthMin(m) {
  const n = parseFloat(String(m).replace(',', '.'));
  const val = Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : HEALTH_MIN_PADRAO;
  gravarArquivo(F.healthMin, String(val));
}

// ── agrupamento de mensagens (debounce), em SEGUNDOS ────────────────────────
// Padrão 7s. 0 = responder na hora. Lido pelo listener a cada mensagem.
const AGRUPAR_SEG_PADRAO = 7;
function lerAgruparSeg() {
  const s = ler(F.agruparSeg).trim();
  if (s === '') return AGRUPAR_SEG_PADRAO;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : AGRUPAR_SEG_PADRAO;
}
function gravarAgruparSeg(s) {
  const n = parseFloat(String(s).replace(',', '.'));
  const val = Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : AGRUPAR_SEG_PADRAO;
  gravarArquivo(F.agruparSeg, String(val));
}

// ── mídias (URLs de imagens de preços/grade) ────────────────────────────────
function lerMidias() {
  const d = { grade_imagem: '', grade_link: '', precos_imagem: '', precos_link: '' };
  for (const l of ler(F.midias).split('\n')) {
    const i = l.indexOf('=');
    if (i > 0) { const k = l.slice(0, i).trim(); if (k in d) d[k] = l.slice(i + 1).trim(); }
  }
  return d;
}
function gravarMidias(m) {
  const txt = 'grade_imagem=' + (m.grade_imagem || '') + '\n'
    + 'grade_link=' + (m.grade_link || '') + '\n'
    + 'precos_imagem=' + (m.precos_imagem || '') + '\n'
    + 'precos_link=' + (m.precos_link || '') + '\n';
  gravarArquivo(F.midias, txt);
}

// ── ritmo ("jeito humano": velocidade de digitação e pausas) ────────────────
function inteiro(v, padrao) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : padrao; }
function lerRitmo() {
  let o = {};
  try { const p = JSON.parse(ler(F.ritmo)); if (p && typeof p === 'object') o = p; } catch (_) {}
  const humano = (o.humano === undefined) ? RITMO_PADRAO.humano : (o.humano !== false);
  let msPorChar = Math.max(0, Math.min(500, inteiro(o.msPorChar, RITMO_PADRAO.msPorChar)));
  let delayMin = Math.max(0, Math.min(60000, inteiro(o.delayMin, RITMO_PADRAO.delayMin)));
  let delayMax = Math.max(0, Math.min(60000, inteiro(o.delayMax, RITMO_PADRAO.delayMax)));
  if (delayMax < delayMin) delayMax = delayMin; // coerência: máximo nunca menor que o mínimo
  return { humano, msPorChar, delayMin, delayMax };
}
function gravarRitmo(r) {
  const atual = lerRitmo();
  const novo = {
    humano: (r.humano === undefined) ? atual.humano : (r.humano !== false),
    msPorChar: Math.max(0, Math.min(500, inteiro(r.msPorChar, atual.msPorChar))),
    delayMin: Math.max(0, Math.min(60000, inteiro(r.delayMin, atual.delayMin))),
    delayMax: Math.max(0, Math.min(60000, inteiro(r.delayMax, atual.delayMax))),
  };
  if (novo.delayMax < novo.delayMin) novo.delayMax = novo.delayMin;
  gravarArquivo(F.ritmo, JSON.stringify(novo, null, 2));
}

// ── prompt em seções (linhas que começam com "# ") ──────────────────────────
function parseSecoes(texto) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const secoes = []; let atual = null; const intro = [];
  for (const l of linhas) {
    if (l.startsWith('# ')) { if (atual) secoes.push(atual); atual = { titulo: l.slice(2).trim(), corpo: '' }; }
    else if (atual) { atual.corpo += (atual.corpo ? '\n' : '') + l; }
    else { intro.push(l); }
  }
  if (atual) secoes.push(atual);
  const introTxt = intro.join('\n').trim();
  if (introTxt) secoes.unshift({ titulo: 'IDENTIDADE / ABERTURA', corpo: introTxt });
  return secoes;
}
function montarPrompt(secoes) {
  return secoes.map((s, i) => {
    const corpo = (s.corpo || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (i === 0 && s.titulo === 'IDENTIDADE / ABERTURA') return corpo;
    return '# ' + s.titulo + '\n' + corpo;
  }).join('\n\n').trim() + '\n';
}

// Estado completo para a página.
function estado() {
  return {
    disponivel: disponivel(),
    dir: DIR,
    ativa: estadoAtivo(),
    pausaMin: lerPausaMin(),
    sessaoHoras: lerSessaoHoras(),
    healthMin: lerHealthMin(),
    agruparSeg: lerAgruparSeg(),
    followup: lerFollowupCfg(),
    secoes: parseSecoes(ler(F.prompt)),
    extracao: ler(F.extracao),
    midias: lerMidias(),
    ritmo: lerRitmo(),
  };
}

// Salva tudo (com backup e validação mínima). Lança Error em caso de recusa.
function salvar({ secoes, extracao, pausaMin, sessaoHoras, healthMin, agruparSeg, followup, midias, ritmo }) {
  const promptMontado = montarPrompt(secoes || []);
  const ext = String(extracao || '').trim();
  if (promptMontado.trim().length < 50 || ext.length < 30) {
    throw new Error('Algum campo essencial ficou curto demais — confira e tente de novo.');
  }
  try { if (existe(F.prompt)) fs.copyFileSync(F.prompt, F.promptBak); } catch (_) {}
  try { if (existe(F.extracao)) fs.copyFileSync(F.extracao, F.extracaoBak); } catch (_) {}
  gravarArquivo(F.prompt, promptMontado);   // atômico + confere a releitura
  gravarArquivo(F.extracao, ext);
  gravarPausaMin(Math.max(1, Math.min(1440, parseInt(pausaMin, 10) || 30)));
  if (sessaoHoras !== undefined) gravarSessaoHoras(sessaoHoras);
  if (healthMin !== undefined) gravarHealthMin(healthMin);
  if (agruparSeg !== undefined) gravarAgruparSeg(agruparSeg);
  if (followup !== undefined) gravarFollowupCfg(followup || {});
  gravarMidias(midias || {});
  if (ritmo) gravarRitmo(ritmo);
}

function restaurar() {
  let ok = false;
  try { if (existe(F.promptBak)) { fs.copyFileSync(F.promptBak, F.prompt); ok = true; } } catch (_) {}
  try { if (existe(F.extracaoBak)) { fs.copyFileSync(F.extracaoBak, F.extracao); ok = true; } } catch (_) {}
  return ok;
}

// Conexão do WhatsApp da Sofia (publicada pelo listener em sofia-wa-status.json).
function waStatus() {
  try { const o = JSON.parse(ler(F.waStatus)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}

// Inbox de conversas (publicado pelo listener). Devolve objeto { chave: {jid,nome,ultimaEm,msgs[]} }.
function conversas() {
  try { const o = JSON.parse(ler(F.conversas)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
// Histórico de interações (publicado pelo listener em sofia-historico.json).
// Devolve objeto { <chave>: { nome, sessoes:[{id,inicioEm,fimEm,nMsgs,status,resumo,resumoPronto}] } }.
function historico() {
  try { const o = JSON.parse(ler(F.historico)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
// Consome (lê e apaga) os agendamentos concluídos que a SoFIA registrou.
// Devolve um array de { telefone, nome, when, em }. Padrão atômico: renomeia
// o arquivo antes de ler, para não perder linhas gravadas nesse meio-tempo.
function consumirAgendamentos() {
  let tam = 0;
  try { tam = fs.statSync(F.agendou).size; } catch (_) { return []; }
  if (!tam) return [];
  const tmp = F.agendou + '.' + Date.now() + '.proc';
  let linhas = [];
  try { fs.renameSync(F.agendou, tmp); linhas = fs.readFileSync(tmp, 'utf8').split('\n').map(l => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch (_) { return []; }
  const out = [];
  for (const l of linhas) { try { out.push(JSON.parse(l)); } catch (_) {} }
  return out;
}
// Publica as regras de automação por gatilho para o listener detectar eventos
// (novo lead, palavra-chave, respondeu campanha, sessão encerrada). Só grava se
// mudou, para não ficar tocando o mtime (o listener relê quando muda).
let _regrasCache = null;
function gravarRegras(obj) {
  try {
    const json = JSON.stringify(obj || {});
    if (json === _regrasCache) return false;
    fs.writeFileSync(F.regras, json, 'utf8');
    _regrasCache = json;
    return true;
  } catch (_) { return false; }
}
// Consome (lê e apaga) as ações de automação que o listener detectou.
// Cada item: { telefone, nome, tag, avisarWpp, motivo, em }.
function consumirEventos() {
  let tam = 0;
  try { tam = fs.statSync(F.eventos).size; } catch (_) { return []; }
  if (!tam) return [];
  const tmp = F.eventos + '.' + Date.now() + '.proc';
  let linhas = [];
  try { fs.renameSync(F.eventos, tmp); linhas = fs.readFileSync(tmp, 'utf8').split('\n').map(l => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch (_) { return []; }
  const out = [];
  for (const l of linhas) { try { out.push(JSON.parse(l)); } catch (_) {} }
  return out;
}
// Enfileira um recado para o listener enviar por WhatsApp a um número.
function enfileirarAviso(numero, texto) {
  const n = String(numero || '').replace(/\D/g, '');
  if (!n || !texto) return false;
  fs.appendFileSync(F.avisos, JSON.stringify({ numero: n, texto: String(texto), em: Date.now() }) + '\n', 'utf8');
  return true;
}

// Enfileira uma resposta do painel para o listener enviar (Parte 2 usa isto).
function enfileirarResposta(chave, jid, texto, fotoArquivo) {
  const linha = JSON.stringify({ chave, jid, texto: String(texto || ''),
    fotoArquivo: fotoArquivo || '', em: Date.now() }) + '\n';
  fs.appendFileSync(F.respostas, linha, 'utf8');
}

// Salva a foto anexada numa resposta manual (dataURL base64) em
// ChatBot/humano-fotos/<timestamp>.<ext> e devolve o caminho absoluto. O listener,
// na mesma máquina, envia a foto a partir desse caminho (igual às campanhas).
function salvarFotoResposta(dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || '').replace(/\s/g, ''));
  if (!m) throw new Error('Imagem inválida.');
  let ext = (m[1].split('/')[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  if (!/^[a-z0-9]+$/.test(ext)) ext = 'jpg';
  const dir = path.join(DIR, 'humano-fotos');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const arq = path.join(dir, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext);
  fs.writeFileSync(arq, Buffer.from(m[2], 'base64'));
  return arq;
}

// ── controle humano por conversa (interruptor no painel) ────────────────────
// { "<chave>": <ativadoEm> }. Quando a chave existe, a Sofia não responde AQUELA
// conversa (você conversa manualmente). As outras seguem com a Sofia normalmente.
function lerHumano() {
  try { const o = JSON.parse(ler(F.humano)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function controleHumanoDe(chave) { return !!lerHumano()[chave]; }

// Comando painel → listener (ex.: desconectar o WhatsApp da Sofia). O listener lê,
// executa e apaga o arquivo. Gravado em sofia-comando.json (fora do Git).
function enviarComando(cmd) {
  const arq = path.join(DIR, 'sofia-comando.json');
  fs.writeFileSync(arq, JSON.stringify({ cmd: String(cmd || ''), em: Date.now() }), 'utf8');
}

// ── campanhas (envio em massa por tag, pela SoFIA) ──────────────────────────
// O painel cria a campanha e controla (iniciar/pausar/cancelar/excluir) gravando
// pedidos em campanhas-inbox.jsonl; o listener executa e publica o estado em
// campanhas.json (que o painel só lê).
function lerCampanhas() {
  try { const o = JSON.parse(ler(F.campanhas)); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function opCampanha(obj) {
  const linha = JSON.stringify(Object.assign({ em: Date.now() }, obj)) + '\n';
  fs.appendFileSync(F.campanhasInbox, linha, 'utf8');
}
// Salva a foto de uma campanha (dataURL base64) em ChatBot/campanha-fotos/<id>.<ext>
// e devolve o caminho absoluto (o listener, na mesma máquina, envia a partir dele).
function salvarFotoCampanha(id, dataUrl) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || '').replace(/\s/g, ''));
  if (!m) throw new Error('Imagem inválida.');
  let ext = (m[1].split('/')[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  if (!/^[a-z0-9]+$/.test(ext)) ext = 'jpg';
  const dir = path.join(DIR, 'campanha-fotos');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const arq = path.join(dir, String(id).replace(/[^\w.-]/g, '') + '.' + ext);
  fs.writeFileSync(arq, Buffer.from(m[2], 'base64'));
  return arq;
}
// ── Lista de bloqueio (Sofia ignora estes números, como o "Bloquear" do WhatsApp) ──
// Array de telefones (só dígitos). O painel escreve; o listener lê a cada mensagem.
function lerBloqueios() {
  try { const a = JSON.parse(ler(F.bloqueios)); return Array.isArray(a) ? a.map(x => String(x).replace(/\D/g, '')).filter(Boolean) : []; }
  catch (_) { return []; }
}
function estaBloqueado(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  return !!d && lerBloqueios().indexOf(d) >= 0;
}
function setBloqueio(tel, ativo) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return false;
  let a = lerBloqueios().filter(x => x !== d);
  if (ativo) a.push(d);
  gravarArquivo(F.bloqueios, JSON.stringify(a));
  return !!ativo;
}

// ── Follow-up (retomada de leads que esfriaram sem agendar) ──────────────────
const FOLLOWUP_INSTRUCAO_PADRAO = 'Pergunte de forma leve se ela ainda tem interesse em conhecer o Studio e que estamos de portas abertas para ela fazer a aula experimental gratuita. Seja calorosa e natural.';
function lerFollowupCfg() {
  let o = {};
  try { o = JSON.parse(ler(F.followupCfg)) || {}; } catch (_) { o = {}; }
  const horas = parseFloat(o.horas);
  return {
    on: !!o.on,
    horas: (isFinite(horas) && horas > 0) ? horas : 24,
    instrucao: typeof o.instrucao === 'string' && o.instrucao.trim() ? o.instrucao : FOLLOWUP_INSTRUCAO_PADRAO,
  };
}
function gravarFollowupCfg({ on, horas, instrucao }) {
  const h = Math.max(0.25, Math.min(720, parseFloat(horas) || 24)); // 15 min a 30 dias
  const cfg = { on: !!on, horas: h, instrucao: String(instrucao || '').trim() || FOLLOWUP_INSTRUCAO_PADRAO };
  gravarArquivo(F.followupCfg, JSON.stringify(cfg));
  return cfg;
}
// O painel enfileira um follow-up para a Sofia gerar (com IA) e enviar.
function enfileirarFollowup(tel, instrucao) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return false;
  fs.appendFileSync(F.followup, JSON.stringify({ tel: d, instrucao: String(instrucao || ''), em: Date.now() }) + '\n', 'utf8');
  return true;
}

function setControleHumano(chave, ativo) {
  const o = lerHumano();
  if (ativo) o[chave] = Date.now(); else delete o[chave];
  fs.writeFileSync(F.humano, JSON.stringify(o), 'utf8');
  return !!ativo;
}

module.exports = {
  disponivel, estado, salvar, restaurar, estadoAtivo, gravarEstado,
  lerPausaMin, gravarPausaMin, lerSessaoHoras, gravarSessaoHoras, lerHealthMin, gravarHealthMin, lerAgruparSeg, gravarAgruparSeg, lerRitmo, gravarRitmo, waStatus,
  conversas, historico, consumirAgendamentos, gravarRegras, consumirEventos, enfileirarAviso, enfileirarResposta, salvarFotoResposta, lerHumano, controleHumanoDe, setControleHumano, lerBloqueios, estaBloqueado, setBloqueio, lerFollowupCfg, gravarFollowupCfg, enfileirarFollowup, enviarComando,
  lerCampanhas, opCampanha, salvarFotoCampanha, DIR, ARQUIVOS: F,
};

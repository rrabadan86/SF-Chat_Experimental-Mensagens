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
  quieto: path.join(DIR, 'sofia-quieto.json'), // janela do filtro "sem resposta do contato" (painel)
  inboxDias: path.join(DIR, 'sofia-inbox-dias.txt'), // retenção da inbox (dias; 0 = sempre) — lida pelo listener
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
  humanoLock: path.join(DIR, 'sofia-humano-lock.txt'), // minutos que uma conversa assumida fica travada p/ outros atendentes (e a Sofia fora) — painel escreve, sofia.ts lê
  bloqueios: path.join(DIR, 'sofia-bloqueios.json'), // números bloqueados (Sofia ignora) — painel escreve, listener lê
  modelo: path.join(DIR, 'sofia-modelo.json'), // modelo de IA (conversa/extração) — painel escreve, sofia.ts lê no boot
  transcricao: path.join(DIR, 'sofia-transcricao.txt'), // liga/desliga transcrição de áudio — painel escreve, listener lê
  followupCfg: path.join(DIR, 'sofia-followup-cfg.json'), // config do follow-up (ligado/tempo/instrução) — painel
  followup: path.join(DIR, 'sofia-followup.jsonl'), // fila de follow-ups a gerar+enviar — painel escreve, listener consome
  encerradas: path.join(DIR, 'sofia-encerradas.json'), // conversas encerradas à mão (cadeado) — painel escreve; sofia.ts/listener leem
  campanhas: path.join(DIR, 'campanhas.json'), // estado das campanhas — publicado pelo listener (painel só lê)
  campanhasInbox: path.join(DIR, 'campanhas-inbox.jsonl'), // pedidos do painel → listener (criar/controle/excluir/rascunho)
  campanhaRascunhos: path.join(DIR, 'campanha-rascunhos.json'), // frases geradas por instrução — listener escreve, painel lê
  lidStats: path.join(DIR, 'sofia-lid-stats.json'), // termômetro LID×telefone — listener escreve, painel (Saúde) lê
  custo: path.join(DIR, 'sofia-custo.jsonl'), // custo/tokens por turno — sofia.ts escreve, painel soma
  custoLimite: path.join(DIR, 'sofia-custo-limite.txt'), // alerta de gasto diário (US$; 0 = sem alerta) — painel
  avisoHumano: path.join(DIR, 'sofia-avisohumano.json'), // avisar nº quando a aluna pedir humano — painel escreve, sofia.ts lê
  atencao: path.join(DIR, 'sofia-atencao.json'), // conversas que pediram humano — sofia.ts marca, painel pinta/filtra e limpa
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

// ── filtro "sem resposta do contato" (só painel/Conversas) ──────────────────
// Duas janelas: `horas` = tempo mínimo de silêncio do contato (padrão 24h);
// `dias` = idade máxima da última mensagem dele (padrão 4 dias). Não afeta o
// robô — é só o filtro da inbox. Guardado como JSON.
const QUIETO_HORAS_PADRAO = 24, QUIETO_DIAS_PADRAO = 4;
function lerQuietoCfg() {
  let o = {}; try { o = JSON.parse(ler(F.quieto)) || {}; } catch (_) { o = {}; }
  const h = parseFloat(String(o.horas).replace(',', '.'));
  const d = parseFloat(String(o.dias).replace(',', '.'));
  return {
    horas: Number.isFinite(h) && h > 0 ? Math.min(h, 720) : QUIETO_HORAS_PADRAO,
    dias: Number.isFinite(d) && d > 0 ? Math.min(d, 60) : QUIETO_DIAS_PADRAO,
  };
}
function gravarQuietoCfg({ horas, dias } = {}) {
  const atual = lerQuietoCfg();
  const h = parseFloat(String(horas).replace(',', '.'));
  const d = parseFloat(String(dias).replace(',', '.'));
  const cfg = {
    horas: Number.isFinite(h) && h > 0 ? Math.min(h, 720) : atual.horas,
    dias: Number.isFinite(d) && d > 0 ? Math.min(d, 60) : atual.dias,
  };
  gravarArquivo(F.quieto, JSON.stringify(cfg));
  return cfg;
}

// ── retenção da inbox das Conversas, em DIAS (0 = nunca apagar) ──────────────
// Quanto tempo o painel guarda o histórico das conversas. Padrão 365 dias. O
// LISTENER lê este arquivo (sofia-inbox-dias.txt) e aplica na limpeza da inbox.
const INBOX_DIAS_PADRAO = 365;
function lerInboxDias() {
  const s = ler(F.inboxDias).trim();
  if (s === '') return INBOX_DIAS_PADRAO;
  const n = parseInt(s.replace(',', '.'), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 36500) : INBOX_DIAS_PADRAO;
}
function gravarInboxDias(d) {
  const n = parseInt(String(d).replace(',', '.'), 10);
  const val = Number.isFinite(n) && n >= 0 ? Math.min(n, 36500) : INBOX_DIAS_PADRAO;
  gravarArquivo(F.inboxDias, String(val));
  return val;
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
    quieto: lerQuietoCfg(),
    inboxDias: lerInboxDias(),
    followup: lerFollowupCfg(),
    modelos: lerModelos(),
    modelosValidos: MODELOS_VALIDOS,
    transcricaoOn: lerTranscricaoOn(),
    secoes: parseSecoes(ler(F.prompt)),
    extracao: ler(F.extracao),
    midias: lerMidias(),
    ritmo: lerRitmo(),
  };
}

// Salva tudo (com backup e validação mínima). Lança Error em caso de recusa.
function salvar({ secoes, extracao, pausaMin, sessaoHoras, healthMin, agruparSeg, quieto, inboxDias, followup, modelos, transcricaoOn, midias, ritmo }) {
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
  if (quieto !== undefined) gravarQuietoCfg(quieto || {});
  if (inboxDias !== undefined) gravarInboxDias(inboxDias);
  if (followup !== undefined) gravarFollowupCfg(followup || {});
  if (modelos !== undefined) gravarModelos(modelos || {});
  if (transcricaoOn !== undefined) gravarTranscricaoOn(!!transcricaoOn);
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
// porNome = usuário do painel que escreveu (atribuição na bolha e segurança).
function enfileirarResposta(chave, jid, texto, fotoArquivo, porNome) {
  const linha = JSON.stringify({ chave, jid, texto: String(texto || ''),
    fotoArquivo: fotoArquivo || '', porNome: String(porNome || ''), em: Date.now() }) + '\n';
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
// { "<chave>": { por, em } }. Quando existe E ainda está dentro do tempo de trava
// (LOCK), a Sofia não responde AQUELA conversa e SÓ o atendente "por" pode escrever
// (os outros veem cadeado). Passado o tempo, a trava expira sozinha: a conversa
// volta 100% para a Sofia e outro atendente pode reassumir. Valor legado = número
// (só o instante) ainda é lido. As demais conversas seguem com a Sofia normalmente.
function lerHumano() {
  try { const o = JSON.parse(ler(F.humano)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function _humEm(v) { return (v && typeof v === 'object') ? Number(v.em || 0) : Number(v || 0); }
function _humPor(v) { return (v && typeof v === 'object') ? String(v.por || '') : ''; }
// Minutos da trava de atendimento humano (configurável). Padrão: 60 (1 hora).
function lerHumanoLockMin() {
  try { const n = parseInt(String(ler(F.humanoLock)).trim(), 10); if (isFinite(n) && n > 0) return n; } catch (_) {}
  return 60;
}
function gravarHumanoLockMin(min) {
  const n = Math.max(1, Math.min(1440, parseInt(min, 10) || 60)); // 1 min … 24 h
  gravarArquivo(F.humanoLock, String(n));
  return n;
}
function _humLockMs() { return lerHumanoLockMin() * 60 * 1000; }
// A conversa está sob controle humano ATIVO agora? (assumida e dentro da trava)
function controleHumanoDe(chave) {
  const em = _humEm(lerHumano()[chave]);
  return em > 0 && (em + _humLockMs()) > Date.now();
}
// Quem assumiu + quando + se a trava ainda vale. null quando ninguém está no controle.
function humanoDono(chave) {
  const v = lerHumano()[chave];
  const em = _humEm(v);
  if (!(em > 0)) return null;
  const ativo = (em + _humLockMs()) > Date.now();
  return { por: _humPor(v), em, ativo };
}

// Comando painel → listener (ex.: desconectar o WhatsApp da Sofia). O listener lê,
// executa e apaga o arquivo. Gravado em sofia-comando.json (fora do Git).
function enviarComando(cmd, extra) {
  const arq = path.join(DIR, 'sofia-comando.json');
  const obj = Object.assign({ cmd: String(cmd || '') }, extra && typeof extra === 'object' ? extra : {}, { em: Date.now() });
  fs.writeFileSync(arq, JSON.stringify(obj), 'utf8');
}
// Status da importação de histórico (o listener escreve; o painel só lê).
function lerImportStatus() {
  try { const o = JSON.parse(fs.readFileSync(path.join(DIR, 'sofia-import-status.json'), 'utf8')); return (o && typeof o === 'object') ? o : null; }
  catch (_) { return null; }
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
// Lê o rascunho de campanha gerado pela SoFIA (por id). { pronto:false } enquanto
// a SoFIA ainda está gerando; { pronto:true, texto } quando termina (texto vazio
// = a geração falhou, o painel avisa).
// Soma custo/tokens/nº agrupado por TIPO (conversa, gerador, resumo, tags,
// followup) num intervalo de dias locais. Alimenta a quebra "por tipo" da tela
// de Custo — mostra TUDO que gasta token, não só as conversas.
function lerCustoPorTipo(ini, fim) {
  let linhas = [];
  try { linhas = fs.readFileSync(F.custo, 'utf8').split('\n'); } catch (_) { return []; }
  if (linhas.length > 20000) linhas = linhas.slice(-20000);
  const dentro = (dia) => (!ini || dia >= ini) && (!fim || dia <= fim);
  const mapa = {};
  for (const l of linhas) {
    const s = l.trim(); if (!s) continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; }
    if (!dentro(_diaLocal(o.em))) continue;
    const tipo = String(o.tipo || 'conversa');
    if (!mapa[tipo]) mapa[tipo] = { tipo, usd: 0, inTok: 0, outTok: 0, n: 0 };
    const m = mapa[tipo];
    m.usd += o.usd || 0; m.inTok += o.inTok || 0; m.outTok += o.outTok || 0; m.n += 1;
  }
  return Object.values(mapa).sort((a, b) => b.usd - a.usd);
}

// Termômetro da migração LID do WhatsApp (escrito pelo listener). mapeados =
// quantos LIDs já tiveram o telefone descoberto; semTel = LIDs que nunca deram
// telefone (se crescer, é sinal de que o WhatsApp começou a esconder o número).
function lerLidStats() {
  try { const o = JSON.parse(ler(F.lidStats)); if (!o || typeof o !== 'object') return null; return { mapeados: +o.mapeados || 0, semTel: +o.semTel || 0, ultimoSemTelEm: +o.ultimoSemTelEm || 0, em: +o.em || 0 }; }
  catch (_) { return null; }
}
function lerRascunhoCampanha(id) {
  if (!id) return { pronto: false };
  try {
    const o = JSON.parse(ler(F.campanhaRascunhos));
    const r = o && typeof o === 'object' ? o[id] : null;
    if (!r) return { pronto: false };
    const out = { pronto: true };
    if (typeof r.texto !== 'undefined') out.texto = String(r.texto || '');
    if (Array.isArray(r.variacoes)) out.variacoes = r.variacoes.map(x => String(x || ''));
    return out;
  } catch (_) { return { pronto: false }; }
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

// ── Encerrar conversa à mão (como esperar o tempo da sessão, só que agora) ────
// Guarda { "<chave>": <em> } = instante do encerramento manual. Uma conversa é
// considerada "encerrada à mão" enquanto NÃO houver mensagem nova depois disso
// (ou seja, em >= ultimaEm da conversa). Assim, quando a aluna volta a escrever,
// deixa de estar encerrada SOZINHO — ninguém precisa apagar o registro. A SoFIA
// (sofia.ts) e o listener leem este arquivo; o painel é quem escreve.
function lerEncerradas() {
  try { const o = JSON.parse(ler(F.encerradas)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
// Valor em sofia-encerradas.json: número (legado, só o instante) OU objeto
// { em, por } — "por" = nome do perfil que encerrou à mão pelo painel.
function _encEm(v) { return (v && typeof v === 'object') ? Number(v.em || 0) : Number(v || 0); }
function _encPor(v) { return (v && typeof v === 'object') ? String(v.por || '') : ''; }
// Está encerrada à mão AGORA? (fechada e sem mensagem nova desde o fechamento)
function estaEncerrada(chave, ultimaEm) {
  const em = _encEm(lerEncerradas()[chave]);
  return em > 0 && em >= (Number(ultimaEm) || 0);
}
// Instante da última mensagem DA ALUNA (autor 'aluna') numa conversa. É este o
// marco que "reabre" um encerramento — a resposta que a própria SoFIA manda
// DEPOIS de encerrar (ex.: uma despedida) NÃO deve reabrir a conversa recém-
// fechada. Por isso o painel compara o encerramento com este instante, e não
// com o ultimaEm (que inclui a resposta da SoFIA). Cai no ultimaEm se não houver
// nenhuma mensagem da aluna no histórico publicado.
function ultimaAlunaEm(conv) {
  const msgs = (conv && Array.isArray(conv.msgs)) ? conv.msgs : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].autor === 'aluna') return Number(msgs[i].em) || 0;
  }
  return Number(conv && conv.ultimaEm) || 0;
}
// { em, por } do encerramento manual (por='' quando desconhecido/legado).
function encerradaInfo(chave) {
  const v = lerEncerradas()[chave];
  return { em: _encEm(v), por: _encPor(v) };
}
// Marca (ou desmarca) o encerramento manual de UMA conversa, guardando quem
// encerrou. Poda registros com mais de 45 dias para o arquivo não crescer à toa.
function setEncerrada(chave, ativo, por) {
  chave = String(chave || '').trim();
  if (!chave) return false;
  const o = lerEncerradas();
  const corte = Date.now() - 45 * 24 * 3600 * 1000;
  for (const k of Object.keys(o)) if (!(_encEm(o[k]) > corte)) delete o[k];
  if (ativo) o[chave] = { em: Date.now(), por: String(por || '').trim() }; else delete o[chave];
  gravarArquivo(F.encerradas, JSON.stringify(o));
  return !!ativo;
}

// ── Modelo de IA (conversa e extração) — lido pelo sofia.ts no boot ──────────
const MODELO_PADRAO = 'claude-sonnet-5';
// Lista fixa de modelos válidos (rótulo amigável + id). Menu suspenso no painel.
const MODELOS_VALIDOS = [
  { id: 'claude-sonnet-5', rot: 'Sonnet 5 — equilíbrio (qualidade alta · custo médio) · recomendado p/ conversa' },
  { id: 'claude-opus-5', rot: 'Opus 5 — qualidade máxima (mais caro e um pouco mais lento)' },
  { id: 'claude-haiku-4-5-20251001', rot: 'Haiku 4.5 — rápido e barato (qualidade um pouco menor) · ideal p/ extração' },
];
function _modeloValido(m) { return MODELOS_VALIDOS.some(x => x.id === m) ? m : MODELO_PADRAO; }
function lerModelos() {
  let o = {};
  try { o = JSON.parse(ler(F.modelo)) || {}; } catch (_) { o = {}; }
  return { conversa: _modeloValido(o.conversa), extracao: _modeloValido(o.extracao) };
}
function gravarModelos({ conversa, extracao }) {
  const cfg = { conversa: _modeloValido(conversa), extracao: _modeloValido(extracao) };
  gravarArquivo(F.modelo, JSON.stringify(cfg));
  return cfg;
}
// Liga/desliga da transcrição de áudio (a chave fica no .env; isto só controla
// se usamos ou não). Padrão: ligado (se houver chave, transcreve).
function lerTranscricaoOn() { return ler(F.transcricao).trim().toLowerCase() !== 'off'; }
function gravarTranscricaoOn(on) { gravarArquivo(F.transcricao, on ? 'on' : 'off'); return !!on; }

// ── Follow-up (retomada de leads que esfriaram sem agendar) ──────────────────
const FOLLOWUP_INSTRUCAO_PADRAO = 'Escreva de forma elegante e madura — nosso público são mulheres exigentes e de alto padrão. NADA de gírias, diminutivos (ex.: "vaguinha") ou tom infantil. Retome o ponto onde a conversa parou: se já havia um dia/horário sendo tratado, proponha com naturalidade dar andamento ao agendamento naquele horário (ex.: "Podemos dar andamento ao seu agendamento para sexta às 14h?"); se não havia horário definido, faça um convite cordial para a aula experimental gratuita. Feche se colocando à disposição para qualquer dúvida. Uma ou duas frases, direta e acolhedora.';
// Valida um horário "HH:MM" (24h); devolve normalizado ("8:00" -> "08:00") ou o padrão.
function _hhmm(v, def) {
  const s = String(v == null ? '' : v).trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s)) return def;
  return s.length === 4 ? '0' + s : s;
}
function lerFollowupCfg() {
  let o = {};
  try { o = JSON.parse(ler(F.followupCfg)) || {}; } catch (_) { o = {}; }
  const horas = parseFloat(o.horas);
  const ligadoEm = parseInt(o.ligadoEm, 10);
  return {
    on: !!o.on,
    horas: (isFinite(horas) && horas > 0) ? horas : 24,
    instrucao: typeof o.instrucao === 'string' && o.instrucao.trim() ? o.instrucao : FOLLOWUP_INSTRUCAO_PADRAO,
    // Janela de horário em que É permitido enviar a retomada. Se o prazo vencer
    // fora dela (ex.: 19h50), a mensagem só sai no próximo horário permitido
    // (ex.: 8h do dia seguinte) — nunca de madrugada.
    janelaIni: _hhmm(o.janelaIni, '08:00'),
    janelaFim: _hhmm(o.janelaFim, '19:00'),
    // Instante em que foi LIGADO. O detector só considera leads cuja última
    // mensagem veio DEPOIS disso ("só daqui pra frente" — ignora o acúmulo).
    ligadoEm: isFinite(ligadoEm) && ligadoEm > 0 ? ligadoEm : 0,
  };
}
function gravarFollowupCfg({ on, horas, instrucao, janelaIni, janelaFim }) {
  const h = Math.max(0.25, Math.min(720, parseFloat(horas) || 24)); // 15 min a 30 dias
  const atual = lerFollowupCfg();
  // Marca o corte "daqui pra frente" só na TRANSIÇÃO desligado→ligado; se já
  // estava ligado, mantém o corte original (salvar de novo não reabre o acúmulo).
  let ligadoEm = atual.ligadoEm;
  if (on && !atual.on) ligadoEm = Date.now();
  if (!on) ligadoEm = 0;
  const cfg = { on: !!on, horas: h, instrucao: String(instrucao || '').trim() || FOLLOWUP_INSTRUCAO_PADRAO, janelaIni: _hhmm(janelaIni, '08:00'), janelaFim: _hhmm(janelaFim, '19:00'), ligadoEm };
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

// Assume (ativo=true, guardando quem e o instante — usado também para RENOVAR a
// trava a cada mensagem do dono) ou devolve à Sofia (ativo=false). Poda registros
// já expirados para o arquivo não crescer.
function setControleHumano(chave, ativo, por) {
  const o = lerHumano();
  const corteMs = _humLockMs();
  const agora = Date.now();
  for (const k of Object.keys(o)) if (!(_humEm(o[k]) + corteMs > agora)) delete o[k];
  if (ativo) o[chave] = { por: String(por || '').trim(), em: agora }; else delete o[chave];
  fs.writeFileSync(F.humano, JSON.stringify(o), 'utf8');
  return !!ativo;
}

// ── Custo da IA ─────────────────────────────────────────────────────────────
function lerCustoLimite() {
  try { const n = parseFloat(String(fs.readFileSync(F.custoLimite, 'utf8')).trim().replace(',', '.')); return (isFinite(n) && n >= 0) ? n : 0; } catch (_) { return 0; }
}
function gravarCustoLimite(v) {
  const n = Math.max(0, parseFloat(String(v).replace(',', '.')) || 0);
  fs.writeFileSync(F.custoLimite, String(n));
  return n;
}
function _diaLocal(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (_) { return String(iso).slice(0, 10); }
}
// Soma custo/tokens por dia (fuso de São Paulo) a partir de sofia-custo.jsonl.
function lerCusto(dias) {
  dias = dias || 30;
  const vazio = { hoje: { usd: 0, inTok: 0, outTok: 0, convs: 0 }, porDia: [], total: { usd: 0, convs: 0 }, limite: lerCustoLimite(), temDado: false };
  let linhas = [];
  try { linhas = fs.readFileSync(F.custo, 'utf8').split('\n'); } catch (_) { return vazio; }
  if (linhas.length > 8000) linhas = linhas.slice(-8000); // performance: só o recente
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const mapa = {};
  for (const l of linhas) {
    const s = l.trim(); if (!s) continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; }
    const dia = _diaLocal(o.em);
    if (!mapa[dia]) mapa[dia] = { usd: 0, inTok: 0, outTok: 0, convs: 0 };
    mapa[dia].usd += o.usd || 0;
    mapa[dia].inTok += o.inTok || 0;
    mapa[dia].outTok += o.outTok || 0;
    if (o.tipo === 'conversa') mapa[dia].convs += 1;
  }
  const diasOrd = Object.keys(mapa).sort().reverse().slice(0, dias);
  const porDia = diasOrd.map(d => ({ dia: d, usd: mapa[d].usd, inTok: mapa[d].inTok, outTok: mapa[d].outTok, convs: mapa[d].convs }));
  const total = porDia.reduce((a, d) => ({ usd: a.usd + d.usd, convs: a.convs + d.convs }), { usd: 0, convs: 0 });
  const hoje = mapa[hojeStr] || { usd: 0, inTok: 0, outTok: 0, convs: 0 };
  return { hoje, porDia, total, limite: lerCustoLimite(), temDado: porDia.length > 0 };
}

// Gasto agrupado por CONVERSA (telefone) dentro de um intervalo de dias locais.
// ini/fim = 'YYYY-MM-DD' (fuso SP); ini vazio = sem limite inferior; fim vazio = hoje.
// Só contam as linhas de 'conversa' que já trazem o telefone (registradas após a
// ativação desse recurso). Retorna { linhas:[{tel,usd,inTok,outTok,turnos,ultimo}], semTel }.
function lerCustoPorConversa(ini, fim) {
  let linhas = [];
  try { linhas = fs.readFileSync(F.custo, 'utf8').split('\n'); } catch (_) { return { linhas: [], semTel: 0 }; }
  if (linhas.length > 20000) linhas = linhas.slice(-20000);
  const dentro = (dia) => (!ini || dia >= ini) && (!fim || dia <= fim);
  const mapa = {};
  let semTel = 0, comTel = 0;
  for (const l of linhas) {
    const s = l.trim(); if (!s) continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; }
    if (o.tipo && o.tipo !== 'conversa') continue;
    if (!dentro(_diaLocal(o.em))) continue;
    const tel = String(o.tel || '').replace(/\D/g, '');
    if (!tel) { if (o.usd) semTel += o.usd; continue; }
    comTel += 1;
    if (!mapa[tel]) mapa[tel] = { tel, usd: 0, inTok: 0, outTok: 0, turnos: 0, ultimo: '' };
    const m = mapa[tel];
    m.usd += o.usd || 0; m.inTok += o.inTok || 0; m.outTok += o.outTok || 0; m.turnos += 1;
    if (!m.ultimo || o.em > m.ultimo) m.ultimo = o.em;
  }
  const out = Object.values(mapa).sort((a, b) => b.usd - a.usd);
  return { linhas: out, semTel, comTel };
}

// ── "Precisa de humano" (avisar um número) ──────────────────────────────────
// Expressões-padrão (iguais às do sofia.ts) — servem para semear a caixa no painel.
const PALAVRAS_HUMANO_PADRAO = [
  'atendente', 'falar com uma pessoa', 'falar com um humano', 'falar com alguém',
  'falar com o responsável', 'falar com o gerente', 'quero falar com', 'quero conversar com',
  'me liga', 'liga pra mim', 'isso não ajuda', 'não entendi nada', 'péssimo atendimento',
  'que raiva', 'tô irritada', 'estou irritada', 'você é um robô', 'só robô', 'para de me mandar',
];
function lerAvisoHumano() {
  try {
    const o = JSON.parse(ler(F.avisoHumano));
    let palavras = [];
    if (Array.isArray(o.palavras)) palavras = o.palavras;
    else if (typeof o.palavras === 'string') palavras = o.palavras.split('\n');
    palavras = palavras.map(s => String(s || '').trim()).filter(Boolean);
    return { on: !!o.on, numero: String(o.numero || '').replace(/\D/g, ''), palavras };
  } catch (_) { return { on: false, numero: '', palavras: [] }; }
}
// Conversas que pediram atendimento humano (fundo vermelho + filtro).
function lerAtencao() {
  try { const o = JSON.parse(ler(F.atencao)); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function setAtencao(chave, ativo) {
  chave = String(chave || '').trim(); if (!chave) return false;
  const o = lerAtencao();
  const corte = Date.now() - 45 * 24 * 3600 * 1000;
  for (const k of Object.keys(o)) if (!(Number(o[k]) > corte)) delete o[k]; // poda antigos
  if (ativo) o[chave] = Date.now(); else delete o[chave];
  gravarArquivo(F.atencao, JSON.stringify(o));
  return !!ativo;
}
function gravarAvisoHumano(on, numero, palavras) {
  let arr = [];
  if (Array.isArray(palavras)) arr = palavras;
  else if (typeof palavras === 'string') arr = palavras.split('\n');
  arr = arr.map(s => String(s || '').trim()).filter(Boolean);
  const o = { on: !!on, numero: String(numero || '').replace(/\D/g, ''), palavras: arr };
  gravarArquivo(F.avisoHumano, JSON.stringify(o));
  return o;
}

module.exports = {
  disponivel, estado, salvar, restaurar, estadoAtivo, gravarEstado,
  lerCusto, lerCustoPorConversa, lerCustoPorTipo, lerCustoLimite, gravarCustoLimite, lerAvisoHumano, gravarAvisoHumano, PALAVRAS_HUMANO_PADRAO, lerAtencao, setAtencao,
  lerPausaMin, gravarPausaMin, lerSessaoHoras, gravarSessaoHoras, lerHealthMin, gravarHealthMin, lerAgruparSeg, gravarAgruparSeg, lerQuietoCfg, gravarQuietoCfg, lerInboxDias, gravarInboxDias, lerRitmo, gravarRitmo, waStatus,
  conversas, historico, consumirAgendamentos, gravarRegras, consumirEventos, enfileirarAviso, enfileirarResposta, salvarFotoResposta, lerHumano, controleHumanoDe, humanoDono, lerHumanoLockMin, gravarHumanoLockMin, setControleHumano, lerBloqueios, estaBloqueado, setBloqueio, lerEncerradas, estaEncerrada, ultimaAlunaEm, encerradaInfo, setEncerrada, lerFollowupCfg, gravarFollowupCfg, enfileirarFollowup, lerModelos, gravarModelos, MODELOS_VALIDOS, lerTranscricaoOn, gravarTranscricaoOn, enviarComando, lerImportStatus,
  lerCampanhas, opCampanha, lerRascunhoCampanha, lerLidStats, salvarFotoCampanha, DIR, ARQUIVOS: F,
};

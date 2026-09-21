require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
/**
 * comparecimento.js — Fecha o funil da aula experimental cruzando com o EVO.
 *
 * 1x/semana (cron editável em Horários → chave 'comparecimento') lê a PRESENÇA
 * das aulas experimentais dos últimos 7 dias no EVO e faz a transição de tags:
 *   - Compareceu (status "presença") → remove a tag "Agendou" e põe "Fez aula".
 *   - Faltou     (status "falta")    → remove a tag "Agendou" e põe "sem presença".
 * Só mexe em quem está com a tag de "Agendou" (respeita o controle manual das
 * demais). Aulas ainda sem veredito (agendado/pendente) ficam intocadas.
 *
 * Pareamento por TELEFONE (via enrichWithPhones do scraper) — o mais confiável.
 *
 * Config editável no painel: data/comparecimento.json
 *   { on, tagAgendou, tagCompareceu, tagFaltou, numeroRelatorio }
 *
 * Uso manual na VPS (para TESTAR antes de ligar):
 *   node src/comparecimento.js --dry     → só mostra o que faria (não muda tags)
 *   node src/comparecimento.js --run      → executa de verdade
 */
const fs = require('fs');
const path = require('path');
const EvoScraper = require('./evo-scraper');
const contatos = require('./contatos');

const ARQ = path.resolve(__dirname, '..', 'data', 'comparecimento.json');
const PADRAO = {
  on: false,
  tagAgendou: 'FX - 3. Agendou Aula Exp',        // espelho (compat) — 1ª da lista
  tagsAgendou: ['FX - 3. Agendou Aula Exp'],      // LISTA de tags de origem ("agendou")
  tagCompareceu: 'FX - 5. Fez Aula Experimental',
  tagFaltou: 'FX - 2. Encerrado com Agendamento sem Presença',
  numeroRelatorio: '',
  criarNovos: false, // cadastrar na SoFIA quem fez experimental e não existe (p/ campanhas)
  diasJanela: 7,     // quantos dias para trás ler a presença no EVO (1-31)
  diasFrente: 7,     // quantos dias para FRENTE ler p/ detectar REMARCAÇÃO (0 = desliga a guarda)
  intervaloHoras: 0, // 0 = roda só no horário fixo; N = repete a cada N horas (2=12x/dia, 8=3x/dia)
};

// Quantos dias para trás olhar (1-31). Padrão 7. Rodar diário? use 2. Semanal? 7.
function clampDias(v) {
  const n = parseInt(v, 10);
  return (Number.isFinite(n) && n >= 1 && n <= 31) ? n : 7;
}

// Repetir a cada N horas (0 = desligado; 1-24). Ex.: 8 = 3x/dia, 6 = 4x/dia.
function clampIntervalo(v) {
  const n = parseInt(v, 10);
  return (Number.isFinite(n) && n >= 1 && n <= 24) ? n : 0;
}

// Dias para FRENTE p/ detectar remarcação (0 = desliga a guarda; 1-31).
function clampFrente(v) {
  const n = parseInt(v, 10);
  return (Number.isFinite(n) && n >= 0 && n <= 31) ? n : 7;
}

// Normaliza a lista de tags de "agendou": aceita a LISTA nova (tagsAgendou) e,
// para compatibilidade, a única antiga (tagAgendou).
function tagsAgendouDe(o) {
  let ta = Array.isArray(o && o.tagsAgendou) ? o.tagsAgendou.map(t => String(t || '').trim()).filter(Boolean) : [];
  if (!ta.length) { const one = String((o && o.tagAgendou) || PADRAO.tagAgendou).trim(); ta = [one || PADRAO.tagAgendou]; }
  return Array.from(new Set(ta));
}

function ler() {
  let o = {};
  try { const p = JSON.parse(fs.readFileSync(ARQ, 'utf8')); if (p && typeof p === 'object') o = p; } catch (_) {}
  const cfg = { ...PADRAO, ...o };
  cfg.tagsAgendou = tagsAgendouDe(o);
  cfg.tagAgendou = cfg.tagsAgendou[0]; // espelho p/ leitores antigos
  cfg.diasJanela = clampDias(o.diasJanela != null ? o.diasJanela : cfg.diasJanela);
  cfg.diasFrente = clampFrente(o.diasFrente != null ? o.diasFrente : cfg.diasFrente);
  cfg.intervaloHoras = clampIntervalo(o.intervaloHoras != null ? o.intervaloHoras : cfg.intervaloHoras);
  return cfg;
}
function gravar(cfg) {
  const tags = tagsAgendouDe(cfg);
  const o = {
    on: !!cfg.on,
    tagsAgendou: tags,
    tagAgendou: tags[0], // espelho (compat)
    tagCompareceu: String(cfg.tagCompareceu || '').trim() || PADRAO.tagCompareceu,
    tagFaltou: String(cfg.tagFaltou || '').trim() || PADRAO.tagFaltou,
    numeroRelatorio: String(cfg.numeroRelatorio || '').replace(/\D/g, ''),
    criarNovos: !!cfg.criarNovos,
    diasJanela: clampDias(cfg.diasJanela),
    diasFrente: clampFrente(cfg.diasFrente),
    intervaloHoras: clampIntervalo(cfg.intervaloHoras),
  };
  try { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); } catch (_) {}
  fs.writeFileSync(ARQ, JSON.stringify(o, null, 2), 'utf8');
  return o;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const last8 = (x) => String(x || '').replace(/\D/g, '').slice(-8);
const norm = (s) => String(s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, '').trim();

// Datas dos últimos N dias no formato do EVO (DD/MM/YYYY).
function ultimasDatas(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  return out;
}

// Classifica o status do EVO em 'compareceu' | 'faltou' | '' (sem veredito).
// (norm já deixa minúsculo e sem acento.)
function veredito(status) {
  const s = norm(status);
  if (!s) return '';
  if (s.includes('presen') || s.includes('realizad')) return 'compareceu';
  // O Studio marca as ausências como "Falta Justificada"/"Justificada" (não "Falta"
  // pura). Conta como FALTOU: falta, falta justificada, justificada, ausente.
  if (s.includes('falta') || s.includes('justificad') || s.includes('ausent')) return 'faltou';
  return '';
}

// True se o status indica uma experimental FUTURA ainda ATIVA (agendada/confirmada/
// pendente) — sinal de que a lead foi REMARCADA (tem reposição marcada).
function ehAgendada(status) {
  const s = norm(status);
  return s.includes('agendad') || s.includes('confirmad') || s.includes('pendente');
}

// Datas dos PRÓXIMOS N dias (amanhã em diante), no formato do EVO (DD/MM/YYYY).
function proximasDatas(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  return out;
}

/**
 * Coleta a presença/falta das aulas experimentais dos últimos 7 dias no EVO.
 * Devolve [{ nome, telefone, data, status, veredito }]. Best-effort por dia.
 */
async function coletarSemana(scraper, n) {
  const datas = ultimasDatas(clampDias(n));
  const coletado = [];
  try { await scraper.navigateToExperimental(); } catch (_) {}
  for (const data of datas) {
    try {
      await scraper.changeDateFilter(data);
      await sleep(2500);
      const aulas = await scraper.extractClassList();
      const comVeredito = aulas
        .map(a => ({ ...a, v: veredito(a.status) }))
        .filter(a => a.v && a.name);
      if (!comVeredito.length) continue;
      const enriquecidas = await scraper.enrichWithPhones(comVeredito); // adiciona .phone
      for (const a of enriquecidas) {
        coletado.push({ nome: a.name, telefone: String(a.phone || '').replace(/\D/g, ''), data, status: a.status, veredito: a.v });
      }
    } catch (e) {
      console.log(`   ⚠️  dia ${data} falhou: ${e && e.message}`);
    }
  }
  return coletado;
}

/**
 * GUARDA DA REMARCAÇÃO: lê os PRÓXIMOS `n` dias e devolve o conjunto de telefones
 * (last8) que têm uma experimental FUTURA ativa (agendada/confirmada). São leads
 * que foram REMARCADAS — não devem ser marcadas "sem presença" pela aula antiga.
 * Best-effort: qualquer falha devolve o que deu (nunca derruba o job).
 */
async function coletarFuturas(scraper, n) {
  const set = new Set();
  const dias = clampFrente(n);
  if (!dias) return set; // 0 = guarda desligada
  const datas = proximasDatas(dias);
  try { await scraper.navigateToExperimental(); } catch (_) {}
  for (const data of datas) {
    try {
      await scraper.changeDateFilter(data);
      await sleep(2500);
      const aulas = await scraper.extractClassList();
      const ativas = (aulas || []).filter(a => a && a.name && ehAgendada(a.status));
      if (!ativas.length) continue;
      const enriquecidas = await scraper.enrichWithPhones(ativas);
      for (const a of enriquecidas) {
        const k = last8(String(a.phone || '').replace(/\D/g, ''));
        if (k) set.add(k);
      }
    } catch (e) {
      console.log(`   ⚠️  dia futuro ${data} falhou: ${e && e.message}`);
    }
  }
  return set;
}

/**
 * Executa a transição de tags. { dry:true } = só simula (não altera nada).
 * Retorna um resumo { compareceu:[], faltou:[], semTag:[], erro }.
 */
async function rodar({ dry = false } = {}) {
  const cfg = ler();
  const resumo = { compareceu: [], faltou: [], semTag: [], dry: !!dry, em: Date.now() };

  // Uma OU MAIS tags de origem ("agendou") — é em quem tem qualquer uma delas
  // que vamos mexer.
  const origem = (cfg.tagsAgendou && cfg.tagsAgendou.length) ? cfg.tagsAgendou : [cfg.tagAgendou];

  // Contatos que estão com alguma tag de "Agendou" → é neles que vamos mexer.
  let mapa; // last8 -> { tel, nome, tags }
  try {
    const todos = contatos.carregar() || {};
    mapa = {};
    for (const tel in todos) {
      const c = todos[tel];
      if ((c.tags || []).some(tg => origem.includes(tg))) mapa[last8(tel)] = { tel, nome: c.nome || '', tags: c.tags || [] };
    }
  } catch (e) { resumo.erro = 'não consegui ler os contatos: ' + (e && e.message); return resumo; }

  const nAguardando = Object.keys(mapa).length;
  if (!nAguardando) { resumo.aviso = `Nenhum contato com as tags de "agendou" (${origem.join(', ')}).`; return resumo; }

  // Coleta a presença da semana no EVO (com 3 tentativas de sessão).
  let semana = [];
  let futurasAtivas = new Set();   // telefones (last8) com experimental FUTURA ativa = remarcados
  let ultimoErro = null;
  for (let t = 1; t <= 3; t++) {
    const scraper = new EvoScraper();
    try {
      await scraper.init();
      await scraper.login();
      semana = await coletarSemana(scraper, cfg.diasJanela);
      // Guarda da remarcação (best-effort: nunca derruba o job).
      try { futurasAtivas = await coletarFuturas(scraper, cfg.diasFrente); } catch (_) { futurasAtivas = new Set(); }
      ultimoErro = null;
      break;
    } catch (e) {
      ultimoErro = e;
      console.log(`   ⚠️  tentativa ${t}/3 (EVO) falhou: ${e && e.message}`);
      if (t < 3) await sleep(20000);
    } finally { try { await scraper.close(); } catch (_) {} }
  }
  if (ultimoErro) { resumo.erro = 'EVO indisponível: ' + (ultimoErro.message || ultimoErro); return resumo; }

  resumo.mapaSize = nAguardando;         // quantos contatos estão com a tag de "agendou"
  resumo.evo = [];                       // diagnóstico: cada aula lida no EVO + a ação
  resumo.novos = [];                     // contatos cadastrados a partir do EVO (modo criarNovos)

  // Se a MESMA pessoa tem mais de um registro na janela (ex.: uma REMARCAÇÃO deixa
  // "Falta Justificada" na aula ANTIGA e presença na aula NOVA), a PRESENÇA prevalece:
  // ordena compareceu primeiro, e o jaMexido (1x por telefone) pega o veredito certo.
  semana.sort((a, b) => {
    const rank = v => (v === 'compareceu' ? 0 : v === 'faltou' ? 1 : 2);
    return rank(a.veredito) - rank(b.veredito);
  });

  const jaMexido = new Set();
  const resumo_remarcadas = [];
  for (const a of semana) {
    const chave = last8(a.telefone);
    const alvo = chave ? mapa[chave] : null;
    // GUARDA DA REMARCAÇÃO: se a lead faltou na aula ANTIGA mas tem uma experimental
    // FUTURA ativa (foi remarcada), NÃO marca "sem presença" — mantém "agendou" até
    // ela comparecer (ou faltar de novo) na aula nova.
    if (a.veredito === 'faltou' && chave && !jaMexido.has(chave) && futurasAtivas.has(chave)) {
      jaMexido.add(chave);
      resumo_remarcadas.push({ nome: (alvo && alvo.nome) || a.nome, telefone: (alvo && alvo.tel) || a.telefone });
      resumo.evo.push({ nome: a.nome, status: a.status, veredito: a.veredito, telefone: a.telefone, data: a.data, bateu: !!alvo, acao: 'remarcada' });
      continue;
    }
    const destino = a.veredito === 'compareceu' ? cfg.tagCompareceu : cfg.tagFaltou;
    let acao = 'ignorado';
    if (chave && !jaMexido.has(chave)) {
      if (alvo) {
        // Já rastreado como "agendou" na SoFIA → transição de tag.
        jaMexido.add(chave); acao = 'transicao';
        const item = { nome: alvo.nome || a.nome, telefone: alvo.tel, data: a.data };
        if (!dry) { try { for (const tg of origem) contatos.removerTag(alvo.tel, tg); contatos.adicionarTag(alvo.tel, alvo.nome || a.nome, destino); } catch (e) { console.log(`   ⚠️  troca de tag falhou (${alvo.tel}): ${e && e.message}`); } }
        (a.veredito === 'compareceu' ? resumo.compareceu : resumo.faltou).push(item);
      } else if (cfg.criarNovos && a.telefone) {
        // Não está na SoFIA (ou sem a tag) → cadastra + tag do resultado (p/ campanha).
        jaMexido.add(chave); acao = 'cadastrado';
        const item = { nome: a.nome, telefone: a.telefone, data: a.data, novo: true };
        if (!dry) { try { contatos.adicionarTag(a.telefone, a.nome, destino); } catch (e) { console.log(`   ⚠️  cadastro/tag falhou (${a.telefone}): ${e && e.message}`); } }
        (a.veredito === 'compareceu' ? resumo.compareceu : resumo.faltou).push(item);
        resumo.novos.push(item);
      }
    }
    resumo.evo.push({ nome: a.nome, status: a.status, veredito: a.veredito, telefone: a.telefone, data: a.data, bateu: !!alvo, acao });
  }
  // Quem estava aguardando mas não apareceu na semana com veredito (aula futura,
  // ou não achei no EVO) — fica como está.
  for (const k in mapa) if (!jaMexido.has(k)) resumo.semTag.push({ nome: mapa[k].nome, telefone: mapa[k].tel });

  resumo.remarcadas = resumo_remarcadas;   // faltou na antiga, mas tem aula futura → mantida "agendou"
  return resumo;
}

function textoRelatorio(r, cfg) {
  const linhas = [];
  const jan = (cfg && cfg.diasJanela) ? `${cfg.diasJanela} dia${cfg.diasJanela > 1 ? 's' : ''}` : 'semana';
  linhas.push(`📋 *Presença da experimental (${jan})*${r.dry ? ' — SIMULAÇÃO' : ''}`);
  // Lista nome + telefone de cada pessoa (com a data quando houver veredito).
  const lista = (arr) => { for (const x of (arr || []).slice(0, 40)) linhas.push(`   • ${x.nome || 's/ nome'}${x.telefone ? ' · ' + x.telefone : ''}${x.data ? ' (' + x.data + ')' : ''}`); };
  linhas.push(`✅ Compareceram: ${r.compareceu.length}`);
  lista(r.compareceu);
  linhas.push(`❌ Faltaram: ${r.faltou.length}`);
  lista(r.faltou);
  linhas.push(`⏳ Ainda sem veredito: ${r.semTag.length}`);
  lista(r.semTag);
  if (r.remarcadas && r.remarcadas.length) {
    linhas.push(`🔁 Remarcadas (faltou na antiga, mas tem aula futura — mantidas "agendou"): ${r.remarcadas.length}`);
    lista(r.remarcadas);
  }
  if (r.novos && r.novos.length) linhas.push(`🆕 Cadastrados novos (não passaram pela SoFIA): ${r.novos.length}`);
  if (r.erro) linhas.push(`⚠️ ${r.erro}`);
  return linhas.join('\n');
}

// Ponto de entrada chamado pelo scheduler (cron semanal). Envia o relatório se
// houver número configurado. `enviar` = função (numero, texto) do robô.
async function rodarAgendado(enviar) {
  const cfg = ler();
  if (!cfg.on) { console.log('comparecimento: desligado (config.on=false).'); return; }
  console.log('📋 comparecimento: cruzando presença da semana com as tags...');
  const r = await rodar({ dry: false });
  console.log(`comparecimento: ${r.compareceu.length} compareceram, ${r.faltou.length} faltaram, ${r.semTag.length} sem veredito.` + (r.erro ? ` erro: ${r.erro}` : ''));
  if (cfg.numeroRelatorio && typeof enviar === 'function') {
    try { await enviar(cfg.numeroRelatorio, textoRelatorio(r, cfg)); } catch (e) { console.log('comparecimento: falha ao enviar relatório: ' + (e && e.message)); }
  }
  return r;
}

module.exports = { ler, gravar, rodar, rodarAgendado, textoRelatorio, PADRAO };

// CLI para teste manual na VPS.
if (require.main === module) {
  const dry = process.argv.includes('--dry') || !process.argv.includes('--run');
  const cfg = ler();
  rodar({ dry }).then(r => {
    console.log('\n──────── DIAGNÓSTICO ────────');
    console.log(`Contatos com alguma tag de "agendou" [${(cfg.tagsAgendou || [cfg.tagAgendou]).join(' | ')}] (é só nesses que o job age): ${r.mapaSize != null ? r.mapaSize : (r.aviso || 0)}`);
    console.log(`Aulas com presença/falta lidas no EVO na semana: ${(r.evo || []).length}`);
    if (r.evo && r.evo.length) {
      const rotAcao = { transicao: 'troca de tag ✅', cadastrado: 'cadastrado 🆕', ignorado: 'ignorado —' };
      console.log('  (nome · status → veredito · telefone · ação)');
      for (const e of r.evo) console.log(`   • ${e.nome} · ${e.status} → ${e.veredito} · ${e.telefone || '(sem tel)'} · ${rotAcao[e.acao] || e.acao}`);
    }
    if (r.novos && r.novos.length) console.log(`Cadastrados novos (não passaram pela SoFIA): ${r.novos.length}`);
    if (r.aviso) console.log('Aviso: ' + r.aviso);
    console.log('\n' + textoRelatorio(r, cfg));
    console.log(`\n${dry ? '(SIMULAÇÃO — nenhuma tag foi alterada. Use --run para valer.)' : '(Tags atualizadas.)'}`);
    process.exit(0);
  }).catch(e => { console.error('erro:', e && e.message); process.exit(1); });
}

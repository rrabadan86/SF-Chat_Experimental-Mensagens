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
  tagAgendou: 'FX - 3. Agendou Aula Exp',
  tagCompareceu: 'FX - 5. Fez Aula Experimental',
  tagFaltou: 'FX - 2. Encerrado com Agendamento sem Presença',
  numeroRelatorio: '',
};

function ler() {
  try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return { ...PADRAO, ...(o && typeof o === 'object' ? o : {}) }; }
  catch (_) { return { ...PADRAO }; }
}
function gravar(cfg) {
  const o = {
    on: !!cfg.on,
    tagAgendou: String(cfg.tagAgendou || '').trim() || PADRAO.tagAgendou,
    tagCompareceu: String(cfg.tagCompareceu || '').trim() || PADRAO.tagCompareceu,
    tagFaltou: String(cfg.tagFaltou || '').trim() || PADRAO.tagFaltou,
    numeroRelatorio: String(cfg.numeroRelatorio || '').replace(/\D/g, ''),
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
function veredito(status) {
  const s = norm(status);
  if (s === 'presenca' || s === 'presença' || s === 'realizado') return 'compareceu';
  if (s === 'falta') return 'faltou';
  return '';
}

/**
 * Coleta a presença/falta das aulas experimentais dos últimos 7 dias no EVO.
 * Devolve [{ nome, telefone, data, status, veredito }]. Best-effort por dia.
 */
async function coletarSemana(scraper) {
  const datas = ultimasDatas(7);
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
 * Executa a transição de tags. { dry:true } = só simula (não altera nada).
 * Retorna um resumo { compareceu:[], faltou:[], semTag:[], erro }.
 */
async function rodar({ dry = false } = {}) {
  const cfg = ler();
  const resumo = { compareceu: [], faltou: [], semTag: [], dry: !!dry, em: Date.now() };

  // Contatos que estão com a tag "Agendou" → é neles que vamos mexer.
  let mapa; // last8 -> { tel, nome, tags }
  try {
    const todos = contatos.carregar() || {};
    mapa = {};
    for (const tel in todos) {
      const c = todos[tel];
      if ((c.tags || []).includes(cfg.tagAgendou)) mapa[last8(tel)] = { tel, nome: c.nome || '', tags: c.tags || [] };
    }
  } catch (e) { resumo.erro = 'não consegui ler os contatos: ' + (e && e.message); return resumo; }

  const nAguardando = Object.keys(mapa).length;
  if (!nAguardando) { resumo.aviso = `Nenhum contato com a tag "${cfg.tagAgendou}".`; return resumo; }

  // Coleta a presença da semana no EVO (com 3 tentativas de sessão).
  let semana = [];
  let ultimoErro = null;
  for (let t = 1; t <= 3; t++) {
    const scraper = new EvoScraper();
    try {
      await scraper.init();
      await scraper.login();
      semana = await coletarSemana(scraper);
      ultimoErro = null;
      break;
    } catch (e) {
      ultimoErro = e;
      console.log(`   ⚠️  tentativa ${t}/3 (EVO) falhou: ${e && e.message}`);
      if (t < 3) await sleep(20000);
    } finally { try { await scraper.close(); } catch (_) {} }
  }
  if (ultimoErro) { resumo.erro = 'EVO indisponível: ' + (ultimoErro.message || ultimoErro); return resumo; }

  // Para cada aluna com veredito, se ela está na lista de "aguardando", troca a tag.
  const jaMexido = new Set();
  for (const a of semana) {
    const chave = last8(a.telefone);
    if (!chave || jaMexido.has(chave)) continue;
    const alvo = mapa[chave];
    if (!alvo) continue;                 // não está aguardando veredito → ignora
    jaMexido.add(chave);
    const destino = a.veredito === 'compareceu' ? cfg.tagCompareceu : cfg.tagFaltou;
    const item = { nome: alvo.nome || a.nome, telefone: alvo.tel, data: a.data };
    if (!dry) {
      try { contatos.removerTag(alvo.tel, cfg.tagAgendou); contatos.adicionarTag(alvo.tel, alvo.nome || a.nome, destino); }
      catch (e) { console.log(`   ⚠️  troca de tag falhou (${alvo.tel}): ${e && e.message}`); }
    }
    (a.veredito === 'compareceu' ? resumo.compareceu : resumo.faltou).push(item);
  }
  // Quem estava aguardando mas não apareceu na semana com veredito (aula futura,
  // ou não achei no EVO) — fica como está.
  for (const k in mapa) if (!jaMexido.has(k)) resumo.semTag.push({ nome: mapa[k].nome, telefone: mapa[k].tel });

  return resumo;
}

function textoRelatorio(r, cfg) {
  const linhas = [];
  linhas.push(`📋 *Presença da experimental (semana)*${r.dry ? ' — SIMULAÇÃO' : ''}`);
  linhas.push(`✅ Compareceram: ${r.compareceu.length}`);
  for (const x of r.compareceu.slice(0, 40)) linhas.push(`   • ${x.nome || x.telefone} (${x.data})`);
  linhas.push(`❌ Faltaram: ${r.faltou.length}`);
  for (const x of r.faltou.slice(0, 40)) linhas.push(`   • ${x.nome || x.telefone} (${x.data})`);
  linhas.push(`⏳ Ainda sem veredito: ${r.semTag.length}`);
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
  rodar({ dry }).then(r => {
    console.log('\n' + textoRelatorio(r, ler()));
    console.log(`\n${dry ? '(SIMULAÇÃO — nenhuma tag foi alterada. Use --run para valer.)' : '(Tags atualizadas.)'}`);
    process.exit(0);
  }).catch(e => { console.error('erro:', e && e.message); process.exit(1); });
}

/**
 * atividade.js — REGISTRO do que o robô enviou (para a aba "Hoje" do painel).
 *
 * Toda saída de mensagem passa pelo wa-client (sendTexto/sendMidia/sendGrupo…),
 * que chama registrar() aqui. O painel (processo separado) lê data/atividade.json
 * e mostra o resumo do dia. Falha em silêncio: registrar NUNCA derruba um envio.
 *
 * "Contexto" = qual job disparou (Confirmação, Follow-up, Aniversário…). O
 * scheduler chama setContexto() no início de cada job; como os jobs pesados são
 * serializados (jobRunning), o contexto vale para todos os envios daquele job.
 * Se o contexto estiver velho (>6 min), cai para "Outros".
 *
 * A SoFIA (outro processo) envia as COBRANÇAS pelo número dela e registra em
 * data/atividade-sofia.jsonl (só acrescenta linhas — sem disputar este arquivo
 * com o robô). O painel junta os dois ao mostrar o Log.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.resolve(__dirname, '..', 'data', 'atividade.json');
const ARQUIVO_SOFIA = path.resolve(__dirname, '..', 'data', 'atividade-sofia.jsonl');
const MAX = 1200;               // mantém os últimos N eventos (rotaciona sozinho)
const FRESCOR_MS = 6 * 60 * 1000; // contexto vale por até 6 min após setContexto

let ctx = { nome: '', ts: 0 };

function hojeSP() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function horaSP() { return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }

function setContexto(nome) { ctx = { nome: nome || '', ts: Date.now() }; }
function contextoAtual() { return (Date.now() - ctx.ts) < FRESCOR_MS ? ctx.nome : ''; }

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function salvar(arr) {
  try {
    const dir = path.dirname(ARQUIVO);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(arr.slice(-MAX)), 'utf8');
  } catch (_) { /* não é crítico */ }
}

// Quantos envios deram certo desde que o processo subiu. O scheduler compara antes
// e depois de uma tentativa de job: se algo saiu, NÃO repete o job (evita mandar
// a mesma mensagem duas vezes).
let _enviosOk = 0;
function enviosOk() { return _enviosOk; }

// ev: { destino, preview, ok, erro, grupo, midia, contexto? }
function registrar(ev) {
  if (ev && ev.ok !== false) _enviosOk++;
  try {
    const arr = carregar();
    arr.push({
      data: hojeSP(),
      ts: new Date().toISOString(),
      quando: horaSP(),
      contexto: (ev.contexto || contextoAtual() || 'Outros'),
      destino: String(ev.destino || ''),
      grupo: !!ev.grupo,
      midia: !!ev.midia,
      ok: ev.ok !== false,
      erro: ev.erro ? String(ev.erro).slice(0, 160) : '',
      preview: String(ev.preview || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      // Mensagem COMPLETA (preserva quebras de linha) para o painel expandir com "+".
      // Cap generoso: mensagens de WhatsApp raramente passam disso.
      texto: String(ev.preview || '').trim().slice(0, 2000),
    });
    salvar(arr);
  } catch (_) { /* registro nunca derruba o envio */ }
}

function carregarSofia() {
  try {
    return fs.readFileSync(ARQUIVO_SOFIA, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}
function doDia(dia) {
  const d = dia || hojeSP();
  return carregar().concat(carregarSofia()).filter(e => e.data === d)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

// Resumo agrupado por job (contexto), para os cards do topo.
function resumoHoje(dia) {
  const evs = doDia(dia);
  const porCtx = {};
  for (const e of evs) {
    const k = e.contexto || 'Outros';
    if (!porCtx[k]) porCtx[k] = { contexto: k, sent: 0, failed: 0 };
    if (e.ok) porCtx[k].sent++; else porCtx[k].failed++;
  }
  return {
    dia: dia || hojeSP(),
    total: evs.length,
    enviados: evs.filter(e => e.ok).length,
    falhas: evs.filter(e => !e.ok).length,
    jobs: Object.values(porCtx).sort((a, b) => (b.sent + b.failed) - (a.sent + a.failed)),
  };
}

function listarHoje(dia, limite = 120) { return doDia(dia).slice(-limite).reverse(); }

module.exports = { setContexto, contextoAtual, registrar, enviosOk, resumoHoje, listarHoje, doDia, hojeSP, carregarSofia, ARQUIVO, ARQUIVO_SOFIA };

/**
 * Convocatória do CIRCUITO no grupo do WhatsApp "Circuito Slim".
 *
 *  • Quarta 16:15 → convocatória: lê na Grade > Horários a PROFESSORA e o HORÁRIO
 *                   do Circuito de sábado, monta a mensagem e posta no grupo
 *                   (@marcando a professora, se o telefone estiver configurado).
 *  • Sexta  16:15 → lembrete "É amanhã!" (usa o horário lido na quarta).
 *
 * Uso manual:
 *   node src/enviar-circuito.js --convocacao --dry     # lê e imprime (não envia)
 *   node src/enviar-circuito.js --convocacao --enviar  # posta no grupo
 *   node src/enviar-circuito.js --lembrete --dry
 *   node src/enviar-circuito.js --lembrete --enviar
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const EvoScraper = require('./evo-scraper');
const config = require('./config');
const notif = require('./notificar');

const GRUPO = process.env.CIRCUITO_GRUPO || 'Circuito Slim';
const CHAVE = (process.env.CIRCUITO_ATIVIDADE || 'circuito').toLowerCase(); // atividade a procurar
const HORA_PADRAO = process.env.CIRCUITO_HORA || '09:45';                   // reserva se não achar
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'circuito.json');

// ─── Formatação e mensagens ───────────────────────────────────────────────
// "09:45" → "09h45"  |  "10:00" → "10h"
function fmtHora(h) {
  const s = String(h || HORA_PADRAO).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return `${m[1]}h${m[2]}`.replace(/h00$/, 'h');
}

const MSG_ANTES = `🔥 SÁBADO É DIA DE QUEIMAR CALORIAS NO CIRCUITO! 🔥\n⚡️Comandada pela professora `;
function msgDepois(horaFmt) { return `.\n\nCheckin Aberto!!!\n\n⏰ Sábado às ${horaFmt}`; }
function msgConvocacao(professora, horaFmt) { return MSG_ANTES + professora + msgDepois(horaFmt); }
function msgLembrete(horaFmt) {
  return `🔥 *É AMANHÃ!* 🔥\n⚡️ Estamos esperando todas vocês!\n\n⏰ Sábado às ${horaFmt}`;
}

// ─── Telefone da professora (para @marcar) ────────────────────────────────
// PROFESSORAS_TEL no .env (JSON: {"raissa":"5562...","taynara":"..."}), buscado
// pelo PRIMEIRO nome (minúsculo). Sem telefone → mensagem com o nome, sem @.
function mapaProfessorasTel() {
  try {
    if (process.env.PROFESSORAS_TEL) return JSON.parse(process.env.PROFESSORAS_TEL);
  } catch (e) {
    console.warn('⚠️  PROFESSORAS_TEL inválido no .env (ignorando):', e.message);
  }
  return {};
}
function telefoneDaProfessora(nome) {
  const m = mapaProfessorasTel();
  const inteiro = (nome || '').trim().toLowerCase();
  return m[inteiro.split(/\s+/)[0]] || m[inteiro] || null;
}

// ─── Estado (compartilha o horário lido na quarta com o lembrete de sexta) ─
function salvarEstado(professora, horario) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ professora, horario, ts: new Date().toISOString() }, null, 2), 'utf8');
  } catch (_) { /* estado é só conveniência */ }
}
function lerEstado() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}

// ─── Lê PROFESSORA + HORÁRIO do Circuito de sábado na Grade > Horários ─────
async function buscarCircuito(scraper) {
  const base = scraper.appOrigin || config.evo.url;
  const url = `${base}/#/app/slimfit/15/grade/horarios`;
  await scraper.page.goto(url, { waitUntil: 'networkidle2' });
  await scraper.sleep(5000);
  if (await scraper.isOnLoginPage()) {
    await scraper.login();
    await scraper.page.goto(url, { waitUntil: 'networkidle2' });
    await scraper.sleep(5000);
  }
  await scraper.dismissSurveyModal();
  await scraper.sleep(1500);

  // Garante a visão SEMANA (mostra o sábado da semana atual).
  await scraper.page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,span,div,li')) {
      if ((el.textContent || '').trim().toUpperCase() === 'SEMANA' && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
        (el.closest('button,a,[role="button"],li') || el).click();
        return;
      }
    }
  });
  await scraper.sleep(3500);

  return scraper.page.evaluate((chave) => {
    const cards = [];
    for (const el of document.querySelectorAll('div,td,li,a')) {
      const t = (el.innerText || '').trim();
      if (!t.toLowerCase().includes(chave)) continue;
      if (el.children.length > 10) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.width > 500 || r.height <= 0) continue;
      const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
      const ai = lines.findIndex(l => l.toLowerCase().includes(chave)); // linha da atividade
      if (ai < 0) continue;
      // professora = 1ª linha após a atividade que não seja horário/ocupação/número
      let prof = '';
      for (let j = ai + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/\d{1,2}:\d{2}/.test(l) || /^\d+\s*\/\s*\d+$/.test(l) || /^\d+$/.test(l)) continue;
        prof = l; break;
      }
      // horário = 1º HH:MM do card (início da aula: "09:45 - 10:45" → 09:45)
      let horario = '';
      for (const l of lines) { const m = l.match(/(\d{1,2}:\d{2})/); if (m) { horario = m[1]; break; } }
      cards.push({ prof, horario, x: Math.round(r.left), raw: lines.join(' | ') });
    }
    if (cards.length === 0) return null;
    cards.sort((a, b) => b.x - a.x); // sábado é a última coluna (mais à direita)
    const c = cards[0];
    return { professora: (c.prof || '').trim() || null, horario: c.horario || null, debug: cards.map(x => x.raw).slice(0, 4) };
  }, CHAVE);
}

// ─── Jobs ─────────────────────────────────────────────────────────────────
async function runCircuitoConvocacao({ dry = false } = {}) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CIRCUITO — Convocatória (quarta)                ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  let professora = null, horario = null;
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();
    const res = await buscarCircuito(scraper);
    professora = res && res.professora;
    horario = res && res.horario;
    console.log(`   Circuito de sábado → professora: ${professora || '(?)'} | horário: ${horario || '(?)'}`);
    if (res && res.debug) console.log(`   🔎 cards: ${res.debug.join('  //  ')}`);
  } catch (e) {
    console.log(`   ⚠️  Falha ao ler a grade: ${e.message}`);
  } finally {
    try { await scraper.close(); } catch (_) {}
  }

  if (!professora) {
    professora = process.env.CIRCUITO_PROFESSORA_PADRAO || '';
    if (!professora) {
      notif.alertar('Circuito: professora não encontrada',
        'Não achei a professora do Circuito de sábado na Grade. A convocatória NÃO foi enviada. '
        + 'Confira a Grade > Horários ou defina CIRCUITO_PROFESSORA_PADRAO no .env.',
        { tags: 'warning' });
      console.log('   ❌ Sem professora e sem fallback — convocatória NÃO enviada.');
      return;
    }
    console.log(`   ↪️  Usando professora padrão do .env: ${professora}`);
  }

  const horaFmt = fmtHora(horario);
  salvarEstado(professora, horario || HORA_PADRAO); // guarda para o lembrete de sexta

  const tel = telefoneDaProfessora(professora);
  const msg = msgConvocacao(professora, horaFmt);
  console.log('\n--- MENSAGEM ---\n' + msg + '\n----------------');
  console.log(tel ? '   👤 Vai @marcar a professora (tel configurado).' : '   ℹ️  Sem telefone da professora no .env → sai sem @ (só o nome).');
  if (dry) { console.log('🧪 DRY — nada enviado.'); return; }

  const wa = require('./wa-client');
  if (tel) {
    const g = await wa.acharGrupo(GRUPO);
    if (!g) throw new Error('Grupo não encontrado: ' + GRUPO);
    await wa.sendGrupoComMencao(g.id, MSG_ANTES, msgDepois(horaFmt), tel);
    console.log(`✅ Convocatória enviada no grupo "${GRUPO}" com @menção da professora.`);
  } else {
    await wa.sendGrupo(GRUPO, msg);
    console.log(`✅ Convocatória enviada no grupo "${GRUPO}" (sem @ — telefone não configurado).`);
  }
}

async function runCircuitoLembrete({ dry = false } = {}) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CIRCUITO — Lembrete (sexta)                     ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  // Usa o horário que a convocatória (quarta) leu e guardou. Reserva: HORA_PADRAO.
  const est = lerEstado();
  const horaFmt = fmtHora(est.horario || HORA_PADRAO);
  console.log(`   Horário (do estado da quarta): ${est.horario || HORA_PADRAO}`);

  const msg = msgLembrete(horaFmt);
  console.log('\n--- MENSAGEM ---\n' + msg + '\n----------------');
  if (dry) { console.log('🧪 DRY — nada enviado.'); return; }

  const wa = require('./wa-client');
  await wa.sendGrupo(GRUPO, msg);
  console.log(`✅ Lembrete enviado no grupo "${GRUPO}".`);
}

module.exports = { runCircuitoConvocacao, runCircuitoLembrete, buscarCircuito, msgConvocacao, msgLembrete };

// ─── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = !args.includes('--enviar');
  const ehLembrete = args.includes('--lembrete');
  (async () => {
    try {
      if (!dry) await require('./wa-client').initWhatsApp();
      if (ehLembrete) await runCircuitoLembrete({ dry });
      else await runCircuitoConvocacao({ dry });
    } catch (e) {
      console.error('❌ erro:', e.message);
    } finally {
      if (!dry) { try { await require('./wa-client').destroy(); } catch (_) {} }
      process.exit(0);
    }
  })();
}

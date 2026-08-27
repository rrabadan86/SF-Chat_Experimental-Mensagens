require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const EvoScraper = require('./evo-scraper');
const config = require('./config');

// ═══════════════════════════════════════════════════════════════════════════
//  RESUMO DO DIA das aulas experimentais → grupo da equipe.
//  Todo dia 19:45. Lê a agenda de experimentais de HOJE no EVO e monta:
//    🔁 Reposições (nome + horário)                [best-effort — ver nota]
//    ✅ Experimentais que fizeram aula (nome + horário)
//    ❌ Experimentais que faltaram (nome + horário)
//    🎉 Fechou contrato (nome + plano)
//
//  Nota reposição: a agenda de experimentais pode não trazer "reposição"
//  (que costuma ser aluna regular repondo). Este job marca qualquer linha cuja
//  atividade/status contenha "reposi" e lista as atividades encontradas no log,
//  para afinarmos a fonte depois de ver um caso real.
//
//  Uso:
//    node src/resumo-dia.js           → monta e ENVIA no grupo
//    node src/resumo-dia.js --dry     → só monta e imprime (não envia)
//    node src/resumo-dia.js --data=DD/MM/AAAA → força uma data (teste)
//
//  Standalone requer o scheduler PARADO (pm2 stop slimfit-exp): o envio usa a
//  mesma sessão do WhatsApp (cliente persistente).
// ═══════════════════════════════════════════════════════════════════════════

// Nome do grupo da equipe: editável no painel (data/grupos.json) > .env > padrão.
const GRUPO = require('./grupos').equipe();
const DRY = process.argv.includes('--dry');
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').split('=')[1];

const norm = (s) => (s || '').trim().toLowerCase();
const fezAula = (c) => /presen|realizad/.test(norm(c.status));

/** DD/MM/AAAA → DD/MM/AAAA do dia seguinte. */
function proximoDia(ds) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(ds || '');
  const d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date();
  d.setDate(d.getDate() + 1);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
const faltou = (c) => norm(c.status) === 'falta' || /\bfalta\b/.test(norm(c.status));

/** "Fulana — 08:00" (ordena por horário). */
function linhaNomeHora(lista) {
  return lista
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map(c => `• ${c.name}${c.time ? ' — ' + c.time : ''}`);
}

function montarMensagem(cats, dataStr) {
  const bloco = (titulo, linhas, vazio) =>
    `${titulo}\n` + (linhas.length ? linhas.join('\n') : `_${vazio}_`);

  // Formato pedido: HORÁRIO — STATUS — NOME
  const porHora = (a, b) => (a.time || '').localeCompare(b.time || '');
  const linhaHSN = (time, status, name) => `• ${time || '--:--'} — ${status} — ${name}`;

  const reposicoes = cats.reposicoes
    .slice().sort(porHora)
    .map(c => linhaHSN(c.time, c.status || 'Reposição', c.name));
  const fizeram = cats.fizeram
    .slice().sort(porHora)
    .map(c => linhaHSN(c.time, 'Presença', c.name));
  const faltaram = cats.faltaram
    .slice().sort(porHora)
    .map(c => linhaHSN(c.time, 'Falta', c.name));
  const fecharam = cats.fecharam
    .slice()
    .map(c => `• ${c.name}${c.contrato ? ' — ' + c.contrato : ''}`);
  const rescisoes = (cats.rescisoes || [])
    .slice()
    .map(c => `• ${c.name}${c.contrato ? ' — ' + c.contrato : ''}`);
  const amanha = (cats.amanha || [])
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map(c => `• ${c.time || '--:--'} — ${c.name}`);

  const trancadas = (cats.trancadas || [])
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(c => `• ${c.name}${c.fim ? ' — retorna ' + c.fim : ''}`);

  const dmAmanha = (cats.amanhaData || '').slice(0, 5); // DD/MM

  return `📋 *Resumo do dia — ${dataStr}*\n\n`
    + bloco('🔁 *Reposições*', reposicoes, 'nenhuma reposição hoje') + '\n\n'
    + bloco('✅ *Experimentais que fizeram aula*', fizeram, 'nenhuma') + '\n\n'
    + bloco('❌ *Experimentais que faltaram*', faltaram, 'nenhuma') + '\n\n'
    + bloco('🎉 *Fechou contrato*', fecharam, 'nenhum fechamento hoje') + '\n\n'
    + bloco('✂️ *Rescisões*', rescisoes, 'nenhuma rescisão hoje') + '\n\n'
    + bloco(`📅 *Experimentais de amanhã${dmAmanha ? ' (' + dmAmanha + ')' : ''}*`, amanha, 'nenhuma agendada para amanhã') + '\n\n'
    + bloco('🔒 *Trancadas hoje*', trancadas, 'nenhuma trancada hoje');
}

async function coletar(dataStr) {
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();

    // 1) Experimentais do dia (agenda de experimentais): fizeram / faltaram / fecharam
    await scraper.navigateToExperimental();
    await scraper.changeDateFilter(dataStr);
    await scraper.sleep(3000);
    const todas = await scraper.extractClassList();
    console.log(`   Total de linhas na agenda de experimentais: ${todas.length}`);
    const statuses = [...new Set(todas.map(c => c.status).filter(Boolean))];
    console.log(`   🔎 Status vistos: ${statuses.join(', ') || '(nenhum)'}`);

    // 2) Reposições do dia (tela Grade > Horários) → [{ nome, horario }]
    let reposicoes = [];
    try {
      const reps = await scraper.getReposicoesGrade(dataStr);
      reposicoes = reps.map(r => ({ name: r.nome, time: r.horario, status: r.status }));
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler reposições na Grade: ${e.message}`);
    }

    // 3) Contratos fechados no dia (Gerencial > Vendas) — TODAS as alunas
    let fecharam = [];
    try {
      const contratos = await scraper.getContratosDoDia(dataStr);
      fecharam = contratos.map(c => ({ name: c.nome, contrato: c.contrato }));
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler contratos do dia: ${e.message}`);
    }

    // 4) Rescisões do dia (Gerencial > Cancelamentos)
    let rescisoes = [];
    try {
      const rs = await scraper.getRescisoesDoDia(dataStr);
      rescisoes = rs.map(r => ({ name: r.nome, contrato: r.contrato }));
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler rescisões do dia: ${e.message}`);
    }

    // 5) Experimentais AGENDADAS para AMANHÃ (agenda de experimentais, status Agendado)
    const amanhaData = proximoDia(dataStr);
    let amanha = [];
    try {
      amanha = await scraper.getAgendadasNaData(amanhaData); // [{ name, time }]
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler experimentais de amanhã: ${e.message}`);
    }

    // 6) Trancamentos VIGENTES hoje (Gerencial > Suspensões) — reusa a MESMA
    //    sessão logada (scraper.page). dias=0 → só quem está trancada no dia.
    let trancadas = [];
    try {
      const { coletarTrancamentos } = require('./suspensoes');
      const list = await coletarTrancamentos(0, scraper.page);
      trancadas = list.map(t => ({ name: t.nome, fim: t.fim, motivo: t.motivo }));
    } catch (e) {
      console.log(`   ⚠️  Falha ao ler trancadas do dia: ${e.message}`);
    }

    // Descarta lançamentos de teste (ex.: "ZeeTech Experimental") nas experimentais.
    const ehTeste = (c) => /zeetech|\bteste\b/i.test(c.name || '');
    return {
      reposicoes,
      fizeram: todas.filter(c => fezAula(c) && !ehTeste(c)),
      faltaram: todas.filter(c => faltou(c) && !ehTeste(c)),
      fecharam,
      rescisoes,
      amanha: amanha.filter(c => !ehTeste(c)),
      amanhaData,
      trancadas: trancadas.filter(c => !ehTeste(c)),
    };
  } finally {
    await scraper.close();
  }
}

async function runResumoDia() {
  const dataStr = argData || (() => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  })();

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   RESUMO DO DIA → Grupo da Equipe                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Grupo: ${GRUPO} | data: ${dataStr} | ${DRY ? '🧪 DRY (não envia)' : '🚀 ENVIO'}\n`);

  // Retry: o login do EVO às vezes dá timeout por instabilidade. Tenta até 3x.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cats, ultimoErro;
  for (let i = 1; i <= 3; i++) {
    try { cats = await coletar(dataStr); break; }
    catch (e) {
      ultimoErro = e;
      console.log(`   ⚠️  Tentativa ${i}/3 falhou: ${e.message}`);
      if (i < 3) { console.log('   ⏳ aguardando 30s antes de tentar de novo...'); await sleep(30000); }
    }
  }
  if (!cats) throw ultimoErro;
  console.log(`   🔁 Reposições: ${cats.reposicoes.length} | ✅ Fizeram: ${cats.fizeram.length} | ❌ Faltaram: ${cats.faltaram.length} | 🎉 Fecharam: ${cats.fecharam.length} | ✂️ Rescisões: ${(cats.rescisoes || []).length} | 📅 Amanhã: ${(cats.amanha || []).length} | 🔒 Trancadas: ${(cats.trancadas || []).length}\n`);

  const msg = montarMensagem(cats, dataStr);
  console.log('─── Mensagem ─────────────────────────────────────');
  console.log(msg);
  console.log('──────────────────────────────────────────────────\n');

  const totalRelevante = cats.reposicoes.length + cats.fizeram.length + cats.faltaram.length + cats.fecharam.length + (cats.rescisoes || []).length + (cats.amanha || []).length;
  if (totalRelevante === 0) {
    console.log('📭 Nada de experimental/reposição hoje — NÃO enviei (evita resumo vazio).\n');
    return { enviado: false, total: 0 };
  }

  if (DRY) { console.log('🧪 DRY — não enviei nada.\n'); return { enviado: false, dry: true }; }

  const wa = require('./wa-client');
  await wa.initWhatsApp();
  await wa.sendGrupo(GRUPO, msg);
  console.log(`✅ Resumo do dia enviado no grupo "${GRUPO}".\n`);
  return { enviado: true, total: totalRelevante };
}

module.exports = { runResumoDia, montarMensagem };

if (require.main === module) {
  runResumoDia()
    .then(() => { if (DRY) process.exit(0); })
    .catch(err => { console.error('\n❌ Erro fatal:', err && err.message); if (err && err.stack) console.error(err.stack); process.exit(1); });
}

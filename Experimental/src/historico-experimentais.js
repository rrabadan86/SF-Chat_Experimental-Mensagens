require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
/**
 * historico-experimentais.js — lê a agenda de experimentais do EVO dia a dia e
 * guarda no histórico (experimentais-hist.js): professora, presença e contrato.
 *
 * Toda noite: relê os últimos 30 dias (presença e contrato mudam depois da aula)
 * e, enquanto o histórico não chega à data de início (padrão 90 dias; o painel
 * pode escolher outra, ex.: 01/01), lê mais 60 dias antigos ainda não lidos —
 * em vez de um job de horas. "Ler agora" no painel adianta 30. Domingo: pula.
 *
 * Uso manual na VPS:  node src/historico-experimentais.js [diasExtras]
 */
const hist = require('./experimentais-hist');

const LOTE_ANTIGO = 30;  // dias antigos (ainda não lidos) por execução manual; de madrugada, 60
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const datasParaLer = (extras) => hist.datasParaLer(extras);

async function runHistoricoExperimentais({ extras = LOTE_ANTIGO } = {}) {
  const datas = datasParaLer(extras);
  console.log(`\n👩‍🏫 Histórico de experimentais (professoras): ${datas.length} dia(s) para ler no EVO`);
  hist.setStatus({ estado: 'executando', inicio: Date.now(), fim: 0, msg: '', dias: 0, aulas: 0 });
  let dias = 0, aulas = 0, falhasSeguidas = 0;
  const EvoScraper = require('./evo-scraper');
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();
    await scraper.navigateToExperimental();
    for (const data of datas) {
      try {
        await scraper.changeDateFilter(data);
        await sleep(2500);
        const lista = await scraper.extractClassList();
        aulas += hist.registrarDia(data, lista);
        dias++; falhasSeguidas = 0;
      } catch (e) {
        falhasSeguidas++;
        console.log(`   ⚠️  dia ${data} falhou: ${e && e.message}`);
        if (falhasSeguidas >= 3) throw new Error(`3 dias seguidos sem conseguir ler (último: ${data}): ${e && e.message}`);
        try { await scraper.navigateToExperimental(); } catch (_) {}
      }
    }
    hist.setStatus({ estado: 'ok', fim: Date.now(), msg: '', dias, aulas });
    console.log(`✅ Histórico de experimentais: ${dias} dia(s) lido(s), ${aulas} aula(s) gravada(s).`);
    return { dias, aulas };
  } catch (e) {
    hist.setStatus({ estado: 'erro', fim: Date.now(), msg: String((e && e.message) || e).slice(0, 200), dias, aulas });
    throw e;
  } finally {
    try { await scraper.close(); } catch (_) {}
  }
}

module.exports = { runHistoricoExperimentais, datasParaLer };

if (require.main === module) {
  const extras = parseInt(process.argv[2], 10);
  runHistoricoExperimentais({ extras: Number.isFinite(extras) ? extras : LOTE_ANTIGO })
    .then(() => process.exit(0))
    .catch(e => { console.error('❌', e && e.message); process.exit(1); });
}

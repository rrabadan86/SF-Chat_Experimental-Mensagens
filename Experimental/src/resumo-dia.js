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

const GRUPO = process.env.GRUPO_EQUIPE || 'SlimFit Equipe 💪';
const DRY = process.argv.includes('--dry');
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').split('=')[1];

const norm = (s) => (s || '').trim().toLowerCase();
const fezAula = (c) => /presen|realizad/.test(norm(c.status));
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

  const reposicoes = cats.reposicoes
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map(c => `• ${c.name}${c.time ? ' — ' + c.time : ''}${c.status ? ' (' + c.status + ')' : ''}`);
  const fizeram = linhaNomeHora(cats.fizeram);
  const faltaram = linhaNomeHora(cats.faltaram);
  const fecharam = cats.fecharam
    .slice()
    .map(c => `• ${c.name}${c.contrato ? ' — ' + c.contrato : ''}`);

  return `📋 *Resumo do dia — ${dataStr}*\n\n`
    + bloco('🔁 *Reposições*', reposicoes, 'nenhuma reposição hoje') + '\n\n'
    + bloco('✅ *Experimentais que fizeram aula*', fizeram, 'nenhuma') + '\n\n'
    + bloco('❌ *Experimentais que faltaram*', faltaram, 'nenhuma') + '\n\n'
    + bloco('🎉 *Fechou contrato*', fecharam, 'nenhum fechamento hoje');
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

    return {
      reposicoes,
      fizeram: todas.filter(fezAula),
      faltaram: todas.filter(faltou),
      // NOTA: hoje só pega experimentais que fecharam. A dona quer TODAS as
      // alunas que fecharam contrato no dia (fonte diferente) — pendente.
      fecharam: todas.filter(c => c.virouAluna),
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

  const cats = await coletar(dataStr);
  console.log(`   🔁 Reposições: ${cats.reposicoes.length} | ✅ Fizeram: ${cats.fizeram.length} | ❌ Faltaram: ${cats.faltaram.length} | 🎉 Fecharam: ${cats.fecharam.length}\n`);

  const msg = montarMensagem(cats, dataStr);
  console.log('─── Mensagem ─────────────────────────────────────');
  console.log(msg);
  console.log('──────────────────────────────────────────────────\n');

  const totalRelevante = cats.reposicoes.length + cats.fizeram.length + cats.faltaram.length + cats.fecharam.length;
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

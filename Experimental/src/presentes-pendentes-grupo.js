require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { lerValores } = require('./sheets-sync');
const { connectWhatsApp, enviarTextoNoGrupo, GRUPO } = require('./aniversariantes-mes-grupo');

// ═══════════════════════════════════════════════════════════
//  Toda segunda 06:45 → envia no grupo "SlimFit Equipe 💪" a
//  lista de alunas com presente de tempo de casa PENDENTE.
//
//  A cor vermelha da planilha vem de formatação condicional, que a API não
//  consegue ler. Então replicamos a MESMA regra: uma aluna está "pendente" numa
//  faixa quando os DIAS (coluna G) ≥ limite da faixa E a coluna da faixa
//  (H/I/J/K) ≠ "Sim". Só alunas ATIVAS (coluna D = "Sim") entram.
//
//  Uso:
//    node src/presentes-pendentes-grupo.js          → monta e ENVIA no grupo
//    node src/presentes-pendentes-grupo.js --dry     → só monta e imprime
// ═══════════════════════════════════════════════════════════

const DRY = process.argv.includes('--dry');

// Colunas (índice a partir de A=0): A id, B nome, C aniv, D ativa, E atualizado,
// F data início, G dias, H 1ano, I 2anos, J 3anos, K 4anos
const COL = { nome: 1, ativa: 3, dataInicio: 5, dias: 6 };
const FAIXAS = [
  { label: '1 ano',  dias: 360,  col: 7 },
  { label: '2 anos', dias: 725,  col: 8 },
  { label: '3 anos', dias: 1090, col: 9 },
  { label: '4 anos', dias: 1455, col: 10 },
];

function ehSim(v) { return String(v ?? '').trim().toLowerCase() === 'sim'; }
function toDias(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}
// Sem data de início (coluna F) a planilha calcula "dias" errado (data de hoje
// menos vazio = número gigante) e a aluna cai em TODAS as faixas. Consideramos
// que tem data quando a célula não está vazia e contém algum dígito (uma data).
function temDataInicio(v) {
  const s = String(v ?? '').trim();
  return s !== '' && /\d/.test(s);
}

function montarMensagem(pendentesPorFaixa, semData) {
  const blocos = [];
  for (const f of FAIXAS) {
    const nomes = [...new Set(pendentesPorFaixa[f.label] || [])]; // dedup por segurança
    if (nomes.length) {
      blocos.push(`*${f.label}*\n` + nomes.map(n => `• ${n}`).join('\n'));
    }
  }
  const semDataUnica = [...new Set(semData || [])];
  const temPendente = blocos.length > 0;
  if (!temPendente && !semDataUnica.length) {
    return '🎁 *Presentes por tempo de casa*\n\n✅ Nenhum presente pendente no momento! 🎉';
  }
  let msg = '🎁 *Presentes pendentes de entrega*\n\n' +
    'Segue a listagem das alunas com presente de tempo de casa pendente:\n\n' +
    blocos.join('\n\n');
  if (semDataUnica.length) {
    if (blocos.length) msg += '\n\n';
    msg += '⚠️ *Alunas sem data de início* (cadastrar a data de ingresso para calcular o tempo de casa):\n' +
      semDataUnica.map(n => `• ${n}`).join('\n');
  }
  if (temPendente) msg += '\n\nVamos providenciar? 💪❤️';
  return msg;
}

async function runPresentesPendentes() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   PRESENTES PENDENTES → Grupo da Equipe           ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Grupo: ${GRUPO}\n`);

  // 1. Lê a planilha (aba padrão do config), colunas A:K
  const linhas = await lerValores('A2:K');
  console.log(`📄 ${linhas.length} linha(s) lida(s) da planilha.`);

  // 2. Para cada faixa, coleta as alunas ATIVAS pendentes
  const pendentes = {};
  for (const f of FAIXAS) pendentes[f.label] = [];

  let consideradas = 0;
  const semData = []; // ativas sem data de início — vão para uma seção separada
  for (const row of linhas) {
    const nome = String(row[COL.nome] ?? '').trim();
    if (!nome) continue;
    if (!ehSim(row[COL.ativa])) continue;   // só ativas
    consideradas++;
    // Sem data de início: não dá para calcular tempo de casa (senão cai em todas
    // as faixas). Manda para a seção "sem data" e não avalia as faixas.
    if (!temDataInicio(row[COL.dataInicio])) { semData.push(nome); continue; }
    const dias = toDias(row[COL.dias]);
    for (const f of FAIXAS) {
      if (dias >= f.dias && !ehSim(row[f.col])) {
        pendentes[f.label].push(nome);
      }
    }
  }

  console.log(`   👥 ${consideradas} aluna(s) ativa(s) avaliada(s).`);
  for (const f of FAIXAS) {
    console.log(`   • ${f.label} (≥${f.dias} dias): ${pendentes[f.label].length} pendente(s)`);
  }
  console.log(`   • sem data de início: ${[...new Set(semData)].length} aluna(s)`);

  const mensagem = montarMensagem(pendentes, semData);
  console.log('\n─── Mensagem ───────────────────────────────────────');
  console.log(mensagem);
  console.log('────────────────────────────────────────────────────');

  if (DRY) { console.log('\n🧪 Modo --dry: NADA foi enviado.'); return { enviado: false }; }

  // 3. Envia no grupo
  const { browser, page } = await connectWhatsApp();
  let ok = false;
  try {
    ok = await enviarTextoNoGrupo(page, GRUPO, mensagem);
  } finally {
    browser.disconnect();
  }
  console.log(ok ? '\n✅ Concluído.' : '\n⚠️  Não foi possível enviar.');
  return { enviado: ok };
}

module.exports = { runPresentesPendentes };

if (require.main === module) {
  runPresentesPendentes()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}

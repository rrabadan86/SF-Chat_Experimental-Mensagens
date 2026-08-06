// corrigir-confirmacao.js
// Corrige o TELEFONE de uma confirmação que está na fila e libera o reenvio.
//
// Por que existe: o telefone é gravado na fila no momento do agendamento
// (é uma "foto" do que a aluna digitou). Corrigir o cadastro no EVO NÃO muda a
// fila — o envio continuaria tentando o número errado. E, depois de 5 falhas,
// o sistema desiste daquela mensagem.
//
// Este utilitário faz as duas coisas: troca o telefone na fila e zera o
// contador de falhas, para a mensagem sair no próximo ciclo (a cada 15 min).
//
// Uso (no VPS, pode rodar com o scheduler ligado):
//   node src/corrigir-confirmacao.js --listar
//   node src/corrigir-confirmacao.js --nome="Ariana" --telefone=11942834774
//   node src/corrigir-confirmacao.js --nome="Ariana" --reenviar     (só libera)

try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); }
catch (_) { /* sem dotenv: usa STUDIO_OUTBOX_FILE do ambiente */ }
const fs = require('fs');

const OUTBOX = process.env.STUDIO_OUTBOX_FILE
  || require('path').resolve(__dirname, 'agendamento_evo', 'confirmacoes_outbox.jsonl');
const SENT_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_enviados.json';
const FAIL_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_falhas.json';

const arg = (nome) => {
  const a = process.argv.find(x => x.startsWith(`--${nome}=`));
  return a ? a.split('=').slice(1).join('=') : null;
};
const temFlag = (nome) => process.argv.includes(`--${nome}`);

const chave = (row) => `${row.contactId}|${row.when}|${row.ts}`;

function lerLinhas() {
  if (!fs.existsSync(OUTBOX)) return [];
  const out = [];
  for (const linha of fs.readFileSync(OUTBOX, 'utf8').split(/\r?\n/)) {
    if (!linha.trim()) continue;
    // mesma tolerância do leitor oficial: dois JSON colados na mesma linha
    const pedacos = linha.includes('}{') ? linha.replace(/\}\s*\{/g, '}\n{').split('\n') : [linha];
    for (const p of pedacos) {
      try { out.push(JSON.parse(p)); } catch { /* linha inválida */ }
    }
  }
  return out;
}

const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };

function listar() {
  const rows = lerLinhas();
  const enviados = new Set(lerJson(SENT_DB, []));
  const falhas = lerJson(FAIL_DB, {});
  if (!rows.length) { console.log('Fila vazia.'); return; }
  console.log(`\n${rows.length} item(ns) na fila:\n`);
  rows.forEach((r, i) => {
    const k = chave(r);
    const nFalhas = falhas[k] || 0;
    const estado = enviados.has(k) ? '✅ enviada'
      : nFalhas >= 5 ? `❌ desistiu (${nFalhas} falhas)`
      : nFalhas ? `⏳ pendente (${nFalhas} falha[s])` : '⏳ pendente';
    console.log(`  [${i}] ${(r.name || '(sem nome)').padEnd(28)} ${String(r.phone).padEnd(15)} ${r.when || ''}  ${estado}`);
  });
  console.log();
}

function corrigir() {
  const nome = arg('nome');
  const novoTel = arg('telefone');
  const indice = arg('indice');
  if (!nome && indice === null) {
    console.log('Informe --nome="..." ou --indice=N (veja com --listar).');
    return;
  }

  const rows = lerLinhas();
  const alvo = [];
  rows.forEach((r, i) => {
    const bateNome = nome && (r.name || '').toLowerCase().includes(nome.toLowerCase());
    const bateIdx = indice !== null && String(i) === String(indice);
    if (bateNome || bateIdx) alvo.push({ i, r });
  });

  if (!alvo.length) { console.log(`Não achei ninguém com esse critério. Use --listar.`); return; }
  if (alvo.length > 1 && !temFlag('todos')) {
    console.log(`Encontrei ${alvo.length} itens — refine com --indice=N (--listar) ou use --todos:`);
    alvo.forEach(({ i, r }) => console.log(`   [${i}] ${r.name} ${r.phone} ${r.when}`));
    return;
  }

  // 1) troca o telefone na fila (com backup do arquivo)
  if (novoTel) {
    let tel = String(novoTel).replace(/\D/g, '');
    if (tel.startsWith('55') && tel.length > 11) tel = tel.slice(2);
    if (tel.length !== 11 || tel[2] !== '9') {
      console.log(`❌ "${novoTel}" não parece celular válido (precisa de 11 dígitos: DDD + 9 + 8).`);
      return;
    }
    fs.copyFileSync(OUTBOX, OUTBOX + '.bak');
    const novas = rows.map((r, i) => {
      const ehAlvo = alvo.some(a => a.i === i);
      return JSON.stringify(ehAlvo ? { ...r, phone: tel } : r);
    });
    fs.writeFileSync(OUTBOX, novas.join('\n') + '\n', 'utf8');
    alvo.forEach(({ r }) => console.log(`📞 ${r.name}: ${r.phone} → ${tel}`));
    console.log(`   (backup em ${OUTBOX}.bak)`);
  }

  // 2) zera o contador de falhas para a mensagem voltar à fila de envio
  const falhas = lerJson(FAIL_DB, {});
  let liberadas = 0;
  alvo.forEach(({ r }) => { const k = chave(r); if (falhas[k]) { delete falhas[k]; liberadas++; } });
  fs.writeFileSync(FAIL_DB, JSON.stringify(falhas), 'utf8');

  // 3) se já estava marcada como enviada, não mexe (evita mandar duas vezes)
  const enviados = new Set(lerJson(SENT_DB, []));
  const jaEnviada = alvo.filter(({ r }) => enviados.has(chave(r)));
  if (jaEnviada.length) {
    console.log(`⚠️  ${jaEnviada.length} já constava(m) como ENVIADA(s) — não vou reenviar.`);
    console.log('   (se quiser forçar, apague a entrada em ' + SENT_DB + ')');
  }

  console.log(`\n✅ ${liberadas} mensagem(ns) liberada(s) para reenvio.`);
  console.log('   Sai no próximo ciclo (a cada 15 min). Acompanhe: pm2 logs slimfit-exp\n');
}

if (temFlag('listar')) listar();
else corrigir();

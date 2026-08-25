// reenviar-confirmacao.js
// Reenvia uma confirmação de aula experimental que ficou RETIDA (falhou por
// "número sem WhatsApp" ou por esgotar as tentativas). A confirmação NÃO some
// mais da fila — fica guardada em "<outbox>_retidas.json" e você reenvia aqui,
// com o número corrigido.
//
// IMPORTANTE: compartilha a conexão do WhatsApp com o robô. Pare antes:
//   pm2 stop slimfit-exp   →   (rode este script)   →   pm2 start slimfit-exp
//
// Uso:
//   node src/reenviar-confirmacao.js --listar
//   node src/reenviar-confirmacao.js --nome="Juliana" --para=62981055502          (prévia)
//   node src/reenviar-confirmacao.js --nome="Juliana" --para=62981055502 --enviar  (envia)
//   node src/reenviar-confirmacao.js --chave="<chave>" --para=629... --enviar

try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') }); } catch (_) {}

const { lerRetidos, reenviarRetido } = require('./enviar_confirmacoes');

function arg(nome) {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split('=').slice(1).join('=') : '';
}

function listar() {
  const r = lerRetidos();
  const chaves = Object.keys(r);
  if (!chaves.length) { console.log('✅ Nenhuma confirmação retida.'); return; }
  console.log(`📌 ${chaves.length} confirmação(ões) retida(s):\n`);
  for (const k of chaves) {
    const i = r[k];
    console.log(`• ${i.name || '(sem nome)'} — ${i.phone} — ${i.when || 's/ data'}`);
    console.log(`  motivo: ${i.motivo}  |  retida em: ${i.ts}`);
    console.log(`  chave: ${k}\n`);
  }
  console.log('Para reenviar (com o número certo):');
  console.log('  node src/reenviar-confirmacao.js --nome="Nome" --para=DDDNUMERO --enviar');
}

(async () => {
  const nome = arg('nome');
  const chaveArg = arg('chave');
  const telefone = arg('para');

  // Sem seletor, ou --listar → só lista (não conecta no WhatsApp).
  if (process.argv.includes('--listar') || (!nome && !chaveArg)) { listar(); process.exit(0); }

  // Prévia (sem --enviar): mostra o que iria, sem conectar no WhatsApp.
  if (!process.argv.includes('--enviar')) {
    const r = lerRetidos();
    const chaves = Object.keys(r);
    const alvo = (chaveArg && r[chaveArg]) ? chaveArg
      : chaves.find((c) => (r[c].name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
          .includes(nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()));
    if (!alvo) { console.error('❌ Retido não encontrado. Use --listar para ver os nomes.'); process.exit(1); }
    const i = r[alvo];
    console.log('👀 PRÉVIA (nada enviado). Use --enviar para mandar de verdade.\n');
    console.log(`Para: ${telefone || i.phone}${telefone ? '  (corrigido)' : '  (número guardado)'}`);
    console.log(`Aluna: ${i.name} — ${i.when}\n--- mensagem ---\n${i.message}`);
    process.exit(0);
  }

  // Envio real: conecta no WhatsApp (cliente único), envia e destrói.
  const wa = require('./wa-client');
  console.log('🐧 Conectando ao WhatsApp (sessão salva)…');
  await wa.initWhatsApp();
  try {
    const item = await reenviarRetido({ chave: chaveArg || undefined, nome: nome || undefined, telefone: telefone || undefined });
    console.log(`✅ Confirmação reenviada para ${item.name} (${item.enviadoPara}).`);
  } finally {
    await wa.destroy();
  }
  process.exit(0);
})().catch((e) => { console.error('❌', e.message || e); process.exit(1); });

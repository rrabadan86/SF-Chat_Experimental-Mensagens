require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const {
  connectEdge,
  coletarSeguidores,
  carregarConhecidos,
  salvarConhecidos,
  sleep,
  IG_USERNAME,
  DATA_DIR,
} = require('./instagram-seguidores');

// ═══════════════════════════════════════════════════════════
//  CONFIGURAÇÃO — edite à vontade
// ═══════════════════════════════════════════════════════════

// Mensagem de boas-vindas (texto fixo, com quebras de linha).
// As quebras de linha são enviadas como Shift+Enter (Enter sozinho ENVIA no Instagram).
const MENSAGEM_BOASVINDAS = () =>
`Seja muito bem vinda ao SlimFit, a Revolução do Treinamento Feminino! ❤️

Estou te presenteando com uma aula experimental gratuita para conhecer a nossa metodologia e o nosso studio! Faça o agendamento através deste link: https://sf-formularioexperimental.onrender.com/

Nos links abaixo eu explico sobre a nossa metodologia:
-> O que é o SlimFit: https://www.instagram.com/reel/Crluss-AWPu/

-> Personal X SlimFit: https://www.instagram.com/p/CwkvRzggYrs/

Até mais!`;

// Limite de envios por execução/dia (segurança contra bloqueio do Instagram).
const MAX_ENVIOS = parseInt(process.env.IG_MAX_DIA || '20', 10);

// Intervalo aleatório entre mensagens, em segundos (mín, máx).
// 2 a 5 minutos — parecido com comportamento humano.
const INTERVALO_MIN = parseInt(process.env.IG_INTERVALO_MIN || '120', 10);
const INTERVALO_MAX = parseInt(process.env.IG_INTERVALO_MAX || '300', 10);

// Modo simulação por padrão. Use --enviar para realmente mandar DMs.
// (o scheduler chama runBoasVindas() que força o envio)
let MODO_ENVIO = process.argv.includes('--enviar');

// Arquivos de estado
const ENVIADOS_FILE = path.join(DATA_DIR, 'instagram-enviados.json'); // quem já recebeu (nunca repete)
const RELATORIO_FILE = path.join(DATA_DIR, 'instagram-envios.json');  // resultado da última execução

// ═══════════════════════════════════════════════════════════

function intervaloAleatorio() {
  const min = Math.min(INTERVALO_MIN, INTERVALO_MAX);
  const max = Math.max(INTERVALO_MIN, INTERVALO_MAX);
  // usa índice/tempo em vez de Math.random para não depender de seed
  const span = max - min;
  const frac = (Date.now() % 1000) / 1000; // 0..1
  return Math.round((min + frac * span)) * 1000;
}

function carregarEnviados() {
  try {
    if (fs.existsSync(ENVIADOS_FILE)) {
      const j = JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8'));
      return new Set(j.usernames || []);
    }
  } catch (e) { /* ignora */ }
  return new Set();
}

function salvarEnviados(set) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ENVIADOS_FILE, JSON.stringify({
    usernames: Array.from(set),
  }, null, 2), 'utf8');
}

/**
 * Envia uma DM de boas-vindas para um seguidor.
 * Retorna: 'sent' | 'unavailable' | 'error'
 */
async function enviarDM(page, username, texto) {
  // 1. Abre o perfil do seguidor
  await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);

  // 2. Verifica se a conta não está disponível / restringida
  const indisponivel = await page.evaluate(() => {
    const body = (document.body.innerText || '').toLowerCase();
    return body.includes('página não está disponível') ||
           body.includes("isn't available") ||
           body.includes('page not available') ||
           body.includes('usuário não encontrado');
  });
  if (indisponivel) return 'unavailable';

  // 3. Clica no botão "Mensagem" / "Enviar mensagem" (opção 1: botão direto)
  let clicouMsg = await page.evaluate(() => {
    const alvos = document.querySelectorAll('div[role="button"], button, a');
    for (const el of alvos) {
      const t = (el.textContent || '').trim().toLowerCase();
      if ((t === 'mensagem' || t === 'message' || t === 'enviar mensagem' || t === 'send message') && el.offsetWidth > 0) {
        el.click();
        return true;
      }
    }
    return false;
  });

  // 3b. OPÇÃO 2: se o botão direto não existe (perfil privado), abre o menu "..."
  //     e clica em "Enviar mensagem" de dentro dele.
  if (!clicouMsg) {
    console.log('   ↪️  Botão direto ausente — tentando menu "..." (Enviar mensagem)');
    const abriuMenu = await page.evaluate(() => {
      // Botão de opções "..." no perfil
      const cands = document.querySelectorAll('[aria-label="Opções"], [aria-label="Options"], svg[aria-label="Opções"], svg[aria-label="Options"], [aria-label="Mais opções"]');
      for (const c of cands) {
        const clk = c.closest('div[role="button"], button, [role="button"]') || c;
        if (clk && clk.offsetWidth > 0) { clk.click(); return true; }
      }
      return false;
    });

    if (abriuMenu) {
      await sleep(1800);
      clicouMsg = await page.evaluate(() => {
        // No menu/diálogo aberto, procura "Enviar mensagem"
        const els = document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], [role="dialog"] a, [role="menu"] [role="menuitem"], button, div[role="button"]');
        for (const el of els) {
          const t = (el.textContent || '').trim().toLowerCase();
          if ((t === 'enviar mensagem' || t === 'send message' || t === 'mensagem' || t === 'message') && el.offsetWidth > 0) {
            el.click();
            return true;
          }
        }
        return false;
      });
    }
  }

  if (!clicouMsg) {
    // Nem o botão direto nem o menu "..." tinham "Enviar mensagem" → indisponível
    return 'unavailable';
  }

  await sleep(6000); // aguarda abrir a conversa (pode navegar para /direct/t/...)

  // 4. Detecta impossibilidade de enviar (conta restrita / bloqueio)
  const bloqueado = await page.evaluate(() => {
    const body = (document.body.innerText || '').toLowerCase();
    return body.includes('mensagem indisponível') ||
           body.includes('mensagens indisponíveis') ||
           body.includes('message unavailable') ||
           body.includes("you can't message") ||
           body.includes('não é possível enviar mensagem') ||
           body.includes('this account is private');
  });
  if (bloqueado) return 'unavailable';

  // 5. Localiza o campo de composição da mensagem
  const composer = await page.evaluate(() => {
    const seletores = [
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder]',
      'div[contenteditable="true"][aria-label]',
    ];
    for (const sel of seletores) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0) return sel;
    }
    return null;
  });

  if (!composer) return 'unavailable';

  // 6. Digita e envia
  //    Enter no Instagram ENVIA a mensagem. Para manter as quebras de linha,
  //    digitamos linha por linha usando Shift+Enter, e só no fim damos Enter.
  try {
    await page.click(composer);
    await sleep(800);

    const linhas = texto.split('\n');
    for (let li = 0; li < linhas.length; li++) {
      if (linhas[li].length > 0) {
        await page.keyboard.type(linhas[li], { delay: 15 });
      }
      if (li < linhas.length - 1) {
        // quebra de linha SEM enviar
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await sleep(80);
      }
    }
    await sleep(1200);
    await page.keyboard.press('Enter'); // envia a mensagem completa
    await sleep(3000);

    // 7. Confirma que a mensagem apareceu na conversa
    const confirmou = await page.evaluate((trecho) => {
      const body = document.body.innerText || '';
      return body.includes(trecho);
    }, texto.slice(0, 25));

    return confirmou ? 'sent' : 'sent'; // se digitou e deu Enter, considera enviado
  } catch (e) {
    return 'error';
  }
}

// Modo de teste: envia a mensagem para UM usuário específico e sai.
// Uso: node src/instagram-boasvindas.js --teste=usuario_de_teste
async function testeEnvio(alvo) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   INSTAGRAM — TESTE de envio (1 usuário)          ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Enviando mensagem de teste para: @${alvo}\n`);

  const browser = await connectEdge();
  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    // Garante estar logado (abre o IG)
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    const texto = MENSAGEM_BOASVINDAS();
    console.log('📨 Enviando...');
    const status = await enviarDM(page, alvo, texto);
    if (status === 'sent') console.log('   ✅ Mensagem de teste enviada! Confira no Instagram.');
    else if (status === 'unavailable') console.log('   🚫 Mensagem Indisponível (conta restrita/privada/bloqueio).');
    else console.log('   ⚠️  Falha ao enviar (veja se o botão Mensagem apareceu).');
  } finally {
    try { browser.disconnect(); } catch (e) {}
  }
}

async function main() {
  // Se passou --teste=usuario, roda só o teste de envio e sai
  const argTeste = (process.argv.find(a => a.startsWith('--teste=')) || '').split('=')[1];
  if (argTeste) {
    return testeEnvio(argTeste);
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   INSTAGRAM — Boas-vindas a novos seguidores      ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(MODO_ENVIO ? '🚀 MODO ENVIO ATIVO\n' : '🧪 MODO SIMULAÇÃO (use --enviar para enviar)\n');

  if (!IG_USERNAME) {
    console.log('❌ Defina seu usuário: --user=SEU_USUARIO ou IG_USERNAME no .env\n');
    process.exit(1);
  }
  console.log(`   Perfil: @${IG_USERNAME}`);
  console.log(`   Limite: ${MAX_ENVIOS} envios | Intervalo: ${INTERVALO_MIN}-${INTERVALO_MAX}s\n`);

  const browser = await connectEdge();
  const tsStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const relatorio = [];

  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // 1. Coleta seguidores atuais
    const atuais = await coletarSeguidores(page);
    console.log(`\n✅ Seguidores coletados: ${atuais.length}`);

    if (atuais.length === 0) {
      console.log('\n⚠️  Coletou 0 seguidores — algo deu errado (login? perfil? rede?).');
      console.log('   NÃO vou salvar base vazia nem enviar nada.\n');
      return;
    }

    // 2. Descobre os novos
    const conhecidos = carregarConhecidos();
    if (conhecidos === null) {
      salvarConhecidos(atuais, tsStr);
      console.log('\n📌 PRIMEIRA execução — base criada, ninguém marcado como novo.');
      console.log('   Rode de novo mais tarde para pegar quem entrar a partir de agora.\n');
      return;
    }

    const conhecidosSet = new Set(conhecidos.map(c => c.username));
    const jaEnviados = carregarEnviados();

    // Novos = está agora, não estava antes, e ainda não recebeu DM
    const novos = atuais.filter(a =>
      !conhecidosSet.has(a.username) && !jaEnviados.has(a.username)
    );

    console.log(`\n─────────────────────────────────────────────────────`);
    if (novos.length === 0) {
      console.log('📭 Nenhum novo seguidor para dar boas-vindas.');
      salvarConhecidos(atuais, tsStr);
      console.log(`💾 Base atualizada (${atuais.length}).\n`);
      return;
    }

    const aProcessar = novos.slice(0, MAX_ENVIOS);
    console.log(`🎉 ${novos.length} novo(s). Processando ${aProcessar.length} (limite ${MAX_ENVIOS}):\n`);
    aProcessar.forEach((n, i) => console.log(`  ${i + 1}. @${n.username}${n.full_name ? '  (' + n.full_name + ')' : ''}`));
    if (novos.length > MAX_ENVIOS) {
      console.log(`\n   ⏸️  ${novos.length - MAX_ENVIOS} ficaram para a próxima execução (limite diário).`);
    }
    console.log('─────────────────────────────────────────────────────\n');

    // 3. Modo simulação: não envia, só mostra
    if (!MODO_ENVIO) {
      console.log('🧪 Simulação — nada foi enviado.');
      console.log('   Para enviar de verdade: node src/instagram-boasvindas.js --enviar\n');
      // Em simulação NÃO atualiza a base (para você poder testar o envio depois)
      return;
    }

    // 4. Envia as DMs
    let enviadas = 0, indisponiveis = 0, erros = 0;
    for (let i = 0; i < aProcessar.length; i++) {
      const seg = aProcessar[i];
      const texto = MENSAGEM_BOASVINDAS();

      console.log(`\n📨 (${i + 1}/${aProcessar.length}) @${seg.username}...`);
      let status;
      try {
        status = await enviarDM(page, seg.username, texto);
      } catch (e) {
        status = 'error';
        console.log(`   ❌ Erro: ${e.message}`);
      }

      if (status === 'sent') {
        enviadas++;
        jaEnviados.add(seg.username);
        salvarEnviados(jaEnviados);
        console.log('   ✅ Enviada!');
      } else if (status === 'unavailable') {
        indisponiveis++;
        console.log('   🚫 Mensagem Indisponível (bloqueio/restrição)');
      } else {
        erros++;
        console.log('   ⚠️  Falha ao enviar');
      }

      relatorio.push({ username: seg.username, full_name: seg.full_name, status });

      // Intervalo aleatório antes do próximo (menos no último)
      if (i < aProcessar.length - 1) {
        const espera = intervaloAleatorio();
        console.log(`   ⏳ Aguardando ${Math.round(espera / 1000)}s antes do próximo...`);
        await sleep(espera);
      }
    }

    // 5. Atualiza a base de seguidores conhecidos
    salvarConhecidos(atuais, tsStr);

    // 6. Resumo
    console.log('\n╔═════════════════════════════════════════════════════╗');
    console.log('║   RESUMO — Boas-vindas Instagram                    ║');
    console.log('╠═════════════════════════════════════════════════════╣');
    relatorio.forEach(r => {
      const icon = r.status === 'sent' ? '✅' : r.status === 'unavailable' ? '🚫' : '⚠️';
      console.log(`  ${icon} @${r.username} — ${r.status === 'sent' ? 'Enviada' : r.status === 'unavailable' ? 'Mensagem Indisponível' : 'Falha'}`);
    });
    console.log('╠═════════════════════════════════════════════════════╣');
    console.log(`  ✅ Enviadas: ${enviadas}  🚫 Indisponíveis: ${indisponiveis}  ⚠️ Falhas: ${erros}`);
    console.log('╚═════════════════════════════════════════════════════╝\n');

  } finally {
    try { browser.disconnect(); } catch (e) {}
  }

  // Salva relatório
  if (relatorio.length > 0) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RELATORIO_FILE, JSON.stringify({ executadoEm: tsStr, resultados: relatorio }, null, 2), 'utf8');
    console.log(`📄 Relatório salvo em: ${RELATORIO_FILE}\n`);
  }
}

// Função exportada para o scheduler (sempre em modo de envio real)
async function runBoasVindas() {
  MODO_ENVIO = true;
  return main();
}

module.exports = { runBoasVindas, main };

// Execução direta via CLI
if (require.main === module) {
  main().catch(err => {
    console.error('\n❌ Erro fatal:', err.message);
    process.exit(1);
  });
}

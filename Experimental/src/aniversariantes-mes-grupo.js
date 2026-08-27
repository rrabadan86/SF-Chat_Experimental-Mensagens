require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
puppeteer.use(StealthPlugin());

const { buscarAlunasAniversario } = require('./planilha-aniversarios');

// ═══════════════════════════════════════════════════════════
//  Envia, todo dia 01, a lista de aniversariantes do MÊS para o
//  grupo "SlimFit Equipe 💪" — pelo MESMO perfil das confirmações
//  (Edge dedicado, porta 9226).
//
//  Uso:
//    node src/aniversariantes-mes-grupo.js            → monta e ENVIA no grupo
//    node src/aniversariantes-mes-grupo.js --dry      → só monta e imprime (não envia)
//    node src/aniversariantes-mes-grupo.js --mes=8    → força um mês específico (1-12)
// ═══════════════════════════════════════════════════════════

// Nome do grupo da equipe: editável no painel (data/grupos.json) > .env > padrão.
const GRUPO = require('./grupos').equipe();
const CDP_URL = 'http://127.0.0.1:9226';
const IS_LINUX = process.platform === 'linux';
const EDGE_PROFILE = 'Default';
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];

const DRY = process.argv.includes('--dry');
const argMes = (process.argv.find(a => a.startsWith('--mes=')) || '').split('=')[1];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function mesAtual() {
  // --mes=N força um mês específico (para teste).
  if (argMes) { const n = parseInt(argMes); if (n >= 1 && n <= 12) return n; }
  // Padrão: como o job roda no DIA 28 (aviso antecipado), mostra o PRÓXIMO mês.
  // Ex.: rodando em 28/07 → lista os aniversariantes de AGOSTO.
  const sp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const prox = sp.getMonth() + 2;              // getMonth()=0-11; +1 mês corrente, +1 próximo
  return ((prox - 1) % 12) + 1;                // normaliza para 1-12 (Dez→Jan)
}

/** Monta o texto da mensagem com as aniversariantes do mês (ordenadas por dia). */
function montarMensagem(alunasDoMes, mes) {
  const nomeMes = MESES[mes - 1];
  if (alunasDoMes.length === 0) {
    return `🎂 *Aniversariantes de ${nomeMes}*\n\nNenhuma aniversariante neste mês. 😉`;
  }
  const linhas = alunasDoMes
    .slice()
    .sort((a, b) => parseInt(a.aniversario.split('/')[0]) - parseInt(b.aniversario.split('/')[0]))
    .map(a => `📅 ${a.aniversario.split('/')[0]}/${String(mes).padStart(2, '0')} — ${a.nome}`);
  // Texto (intro + posição da {lista} + rodapé) é editável no painel: 'aniversariantes_mes'.
  return require('./mensagens').render('aniversariantes_mes', { mes: nomeMes, lista: linhas.join('\n') });
}

// ─── Conecta no Edge dedicado (mesmo perfil das confirmações) ───
async function connectWhatsApp() {
  // Cliente ÚNICO persistente (wa-client.js): garante que está 'ready' e devolve
  // um "browser" cujo disconnect() é no-op — o cliente compartilhado NUNCA fecha
  // aqui. Os jobs continuam chamando browser.disconnect() no finally (inofensivo).
  const wa = require('./wa-client');
  await wa.initWhatsApp();
  return { browser: { disconnect() {} }, page: null };

  console.log('🔄 Fechando Edge existente...');
  try { execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' }); } catch (e) {}
  await sleep(3000);

  let edgePath = null;
  for (const p of EDGE_PATHS) { if (fs.existsSync(p)) { edgePath = p; break; } }
  if (!edgePath) throw new Error('Microsoft Edge não encontrado');

  console.log(`📱 Abrindo Edge (perfil ${EDGE_PROFILE}, porta 9226)...`);
  const child = spawn(edgePath, [
    '--remote-debugging-port=9226',
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${EDGE_USER_DATA}`,
    `--profile-directory=${EDGE_PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    'https://web.whatsapp.com',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(6000);

  let browser = null;
  for (let i = 0; i < 5; i++) {
    try { browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null }); break; }
    catch (e) { await sleep(3000); }
  }
  if (!browser) throw new Error('Não foi possível conectar ao Edge');

  // Fecha ABAS DUPLICADAS do WhatsApp (mantém só uma) e traz para frente.
  const pages = await browser.pages();
  const waPages = pages.filter(p => p.url().includes('web.whatsapp.com'));
  let page;
  if (waPages.length) {
    page = waPages[0];
    if (waPages.length > 1) {
      console.log(`🧹 Encontrei ${waPages.length} abas do WhatsApp. Fechando as duplicadas...`);
      for (let i = 1; i < waPages.length; i++) { try { await waPages[i].close(); } catch (e) {} }
    }
  } else {
    page = await browser.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });
  }
  await page.bringToFront();
  await sleep(1500);

  // Se aparecer "Usar aqui" (sessão aberta em outra aba/dispositivo), clica.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button, div[role="button"]')) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'usar aqui' || t === 'use here' || t === 'continuar' || t === 'continue') { b.click(); return; }
    }
  }).catch(() => {});
  await sleep(1500);

  console.log('⏳ Aguardando WhatsApp Web...');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="chat-list"]') || document.querySelector('#pane-side'),
    { timeout: 60000 }
  );
  await sleep(2000);
  console.log('✅ WhatsApp pronto!\n');
  return { browser, page };
}

// ─── Abre um grupo pelo nome e envia um texto (com quebras de linha) ───
async function enviarTextoNoGrupo(page, nomeGrupo, texto) {
  // page é ignorado (compat). Envia pelo cliente único (whatsapp-web.js).
  {
    const wa = require('./wa-client');
    try {
      await wa.sendGrupo(nomeGrupo, texto);
      console.log(`   ✅ Enviado no grupo "${nomeGrupo}"`);
      return true;
    } catch (e) {
      console.log(`   ⚠️  Falha ao enviar no grupo "${nomeGrupo}": ${e.message}`);
      return false;
    }
  }
  // ── (código antigo via DOM abaixo fica inacessível) ──
  // 1. Clica na caixa de busca e procura o grupo (sem emoji, casa melhor)
  const consulta = nomeGrupo.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const buscaCoords = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('input, div[contenteditable="true"], [role="textbox"]'));
    for (const el of cands) {
      const lbl = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
      if ((lbl.includes('pesquis') || lbl.includes('search') || lbl.includes('conversa')) && el.offsetWidth > 0) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    let best = null;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.left < 600 && r.top < 220) {
        if (!best || r.top < best.top) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
      }
    }
    return best;
  });
  if (!buscaCoords) { console.log('   ⚠️  Caixa de busca não encontrada'); return false; }

  await page.mouse.click(buscaCoords.x, buscaCoords.y);
  await sleep(700);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(consulta, { delay: 40 });
  await sleep(3000);

  const composerSel = 'footer div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"], footer [role="textbox"], div[contenteditable="true"][data-tab="10"], [data-testid="conversation-compose-box-input"]';

  // 2. Abre o primeiro resultado com Enter
  await page.keyboard.press('Enter');
  await sleep(3000);
  let comp = await page.$(composerSel);

  // 3. Fallback: clica no resultado pelo título
  if (!comp) {
    await page.evaluate((nome) => {
      const alvo = nome.substring(0, 14);
      for (const li of document.querySelectorAll('[role="listitem"], [role="row"], [role="gridcell"], [role="button"]')) {
        const titulo = li.querySelector('span[title]');
        if (titulo) {
          const t = (titulo.getAttribute('title') || '').trim();
          if (t.includes(alvo)) { (titulo.closest('[role="listitem"], [role="row"], div[tabindex]') || titulo).click(); return true; }
        }
      }
      return false;
    }, consulta);
    await page.waitForFunction((sel) => !!document.querySelector(sel), { timeout: 8000 }, composerSel).catch(() => {});
    comp = await page.$(composerSel);
  }

  if (!comp) { console.log(`   ⚠️  Grupo "${nomeGrupo}" não abriu (campo de mensagem não encontrado)`); return false; }

  // 4. Confirma que abriu o grupo CERTO — lê o cabeçalho DA CONVERSA (#main),
  //    não o da lista lateral. Casa por palavras-chave da consulta.
  const tituloOk = await page.evaluate((consulta) => {
    const main = document.querySelector('#main') || document;
    const header = main.querySelector('header') || document.querySelector('[data-testid="conversation-header"]');
    const t = (header ? header.innerText : '').toLowerCase();
    if (!t) return true; // se não achou header, não bloqueia (já confirmamos o composer)
    // exige que as palavras significativas da consulta apareçam no cabeçalho
    const palavras = consulta.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    return palavras.length ? palavras.every(w => t.includes(w)) : t.length > 0;
  }, consulta);
  if (!tituloOk) {
    console.log(`   ⚠️  O chat aberto não parece ser "${nomeGrupo}". Abortando por segurança.`);
    return false;
  }

  await comp.click();
  await sleep(500);

  // 5. Insere o texto com quebras de linha (Shift+Enter) e envia (Enter).
  //    Emojis são inseridos via execCommand insertText (mais confiável que
  //    keyboard.type caractere-a-caractere, que trava com emoji multi-codepoint).
  const linhas = texto.split('\n');
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i]) {
      await page.evaluate((sel, txt) => {
        const el = document.querySelector(sel);
        if (el) { el.focus(); document.execCommand('insertText', false, txt); }
      }, composerSel, linhas[i]);
      await sleep(120);
    }
    if (i < linhas.length - 1) {
      await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
      await sleep(80);
    }
  }
  await sleep(700);

  // Confere que há texto no campo antes de enviar
  const temTexto = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || el.textContent || '').trim().length > 0 : false;
  }, composerSel);
  if (!temTexto) { console.log('   ⚠️  Campo de mensagem vazio após inserir — não enviei.'); return false; }

  await page.keyboard.press('Enter');
  await sleep(3000);
  console.log(`   ✅ Mensagem enviada no grupo "${nomeGrupo}"`);
  return true;
}

async function runEquipeAniversariantesMes() {
  const mes = mesAtual();
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   ANIVERSARIANTES DO MÊS → Grupo da Equipe        ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Mês: ${MESES[mes - 1]}  |  Grupo: ${GRUPO}\n`);

  // 1. Lê todas as alunas ativas + aniversários e filtra pelo mês
  const todas = await buscarAlunasAniversario();
  const doMes = todas.filter(a => {
    const p = (a.aniversario || '').split('/');
    return p.length === 2 && parseInt(p[1]) === mes;
  });
  console.log(`\n📊 ${doMes.length} aniversariante(s) em ${MESES[mes - 1]}.`);

  const mensagem = montarMensagem(doMes, mes);
  console.log('\n─── Mensagem ───────────────────────────────────────');
  console.log(mensagem);
  console.log('────────────────────────────────────────────────────');

  if (DRY) { console.log('\n🧪 Modo --dry: NADA foi enviado.'); return { mes, total: doMes.length, enviado: false }; }

  // 2. Envia no grupo
  const { browser, page } = await connectWhatsApp();
  let ok = false;
  try {
    ok = await enviarTextoNoGrupo(page, GRUPO, mensagem);
  } finally {
    browser.disconnect();
  }
  console.log(ok ? '\n✅ Concluído.' : '\n⚠️  Não foi possível enviar.');
  return { mes, total: doMes.length, enviado: ok };
}

module.exports = { runEquipeAniversariantesMes, connectWhatsApp, enviarTextoNoGrupo, GRUPO };

if (require.main === module) {
  runEquipeAniversariantesMes()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}

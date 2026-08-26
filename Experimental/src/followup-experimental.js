require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const EvoScraper = require('./evo-scraper');

puppeteer.use(StealthPlugin());

const CDP_URL = 'http://127.0.0.1:9226';
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
// Perfil DEDICADO do bot (pasta isolada) — evita conflito com o Edge pessoal
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const EDGE_PROFILE = 'Default';
const IS_LINUX = process.platform === 'linux';
const { execSync } = require('child_process');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Reassume a sessão do WhatsApp Web NESTA aba, clicando em "Usar nesta janela"
 * (aparece quando há outra aba/janela com o WhatsApp aberto). Retorna true se clicou.
 */
async function claimWhatsAppSession(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body.innerText || '').toLowerCase();
      const temAviso = txt.includes('outra janela') || txt.includes('another window')
        || txt.includes('usar nesta janela') || txt.includes('use here') || txt.includes('usar aqui');
      if (!temAviso) return false;
      const alvos = Array.from(document.querySelectorAll('button, div[role="button"], a'));
      const btn = alvos.find(b =>
        /usar nesta janela|usar aqui|use here|continuar|continue/i.test((b.textContent || '').trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
  } catch { return false; }
}

/**
 * Resolve o caminho do arquivo de áudio para uma professora.
 * Busca por qualquer extensão de áudio (.mp3, .ogg, .m4a, etc.)
 */
function getAudioPath(professorStr) {
  if (!professorStr) return null;

  const firstName = professorStr.trim().split(/\s+/)[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove acentos para matching

  const audioPrefix = config.audio.map[firstName];
  if (!audioPrefix) {
    console.log(`   ⚠️  Professora "${professorStr}" sem áudio mapeado`);
    return null;
  }

  const audioDir = config.audio.dir;

  // Prioriza formatos que o WhatsApp aceita como MENSAGEM DE VOZ (ogg/opus).
  // MP3 enviado como voz gera "arquivo de áudio com problema" — fica por último.
  const extensions = ['.ogg', '.opus', '.oga', '.m4a', '.aac', '.mp3', '.wav'];
  for (const ext of extensions) {
    const filePath = path.join(audioDir, audioPrefix + ext);
    if (fs.existsSync(filePath)) return filePath;
  }

  // Busca case-insensitive na pasta, respeitando a mesma ordem de preferência.
  try {
    const files = fs.readdirSync(audioDir);
    for (const ext of extensions) {
      for (const file of files) {
        const lower = file.toLowerCase();
        if (lower.startsWith(audioPrefix.toLowerCase()) && lower.endsWith(ext)) {
          return path.join(audioDir, file);
        }
      }
    }
  } catch (e) {
    console.log(`   ⚠️  Pasta de áudio não acessível: ${audioDir}`);
  }

  return null;
}

/**
 * Conecta ao Edge SlimFit (Profile 1, porta 9226).
 * Abre o Edge se não estiver rodando.
 */
async function connectEdgeWhatsApp() {
  // Cliente ÚNICO persistente (wa-client.js): garante 'ready' e devolve um
  // "browser" cujo disconnect() é no-op (o cliente compartilhado nunca fecha aqui).
  const wa = require('./wa-client');
  await wa.initWhatsApp();
  return { browser: { disconnect() {} }, page: null };

  // ── (código antigo do Edge/Chromium abaixo fica inacessível) ──
  let browser = null;

  // Sempre fecha o Edge antes de abrir com porta de debug
  // (Edge não aceita conexão remota se foi aberto sem --remote-debugging-port)
  console.log('🔄 Fechando Edge existente...');
  try { execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' }); } catch (ex) { /* nenhum Edge aberto */ }
  await sleep(3000);

  console.log(`📱 Abrindo Edge com perfil ${EDGE_PROFILE}...`);
  let edgePath = null;
  for (const p of EDGE_PATHS) { if (fs.existsSync(p)) { edgePath = p; break; } }
  if (!edgePath) throw new Error('Microsoft Edge não encontrado');

  const { spawn } = require('child_process');
  const child = spawn(edgePath, [
    '--remote-debugging-port=9226',
    '--remote-debugging-address=127.0.0.1', // força a porta no IP exato que o script busca
    '--remote-allow-origins=*',             // Chromium 111+ rejeita o WebSocket do DevTools sem isso
    `--user-data-dir=${EDGE_USER_DATA}`,
    `--profile-directory=${EDGE_PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    'https://web.whatsapp.com',             // abre direto no WhatsApp, sem restaurar sessão antiga
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(6000);

  for (let i = 0; i < 5; i++) {
    try { browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null }); break; }
    catch (err) { await sleep(3000); }
  }

  if (!browser) throw new Error('Não foi possível conectar ao Edge');

  const pages = await browser.pages();
  const waPages = pages.filter(p => p.url().includes('web.whatsapp.com'));

  // Prefere a aba do WhatsApp BUSINESS (é a linha do Studio, 8550-8065). Se não
  // conseguir identificar pelo título, fica com a primeira aba de WhatsApp.
  let page = null;
  for (const p of waPages) {
    let title = '';
    try { title = (await p.title()) || ''; } catch {}
    if (/business/i.test(title)) { page = p; break; }
  }
  if (!page) page = waPages[0] || null;

  if (!page) {
    page = await browser.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  // Fecha as OUTRAS abas de WhatsApp Web. Duas abas (ex.: "WhatsApp" pessoal +
  // "WhatsApp Business") dividem a MESMA sessão do perfil e ficam brigando
  // ("aberto em outra janela"), o que aborta os envios com net::ERR_ABORTED.
  for (const p of waPages) {
    if (p !== page) {
      try {
        const t = (await p.title()) || '';
        console.log(`   🧹 Fechando aba de WhatsApp duplicada: "${t}"`);
        await p.close();
      } catch {}
    }
  }
  await page.bringToFront().catch(() => {});

  console.log('⏳ Aguardando WhatsApp Web (reassumindo a sessão nesta janela se preciso)...');
  for (let i = 0; i < 25; i++) {
    const pronto = await page.evaluate(() =>
      !!(document.querySelector('[data-testid="chat-list"]') || document.querySelector('#pane-side'))
    ).catch(() => false);
    if (pronto) break;
    const claimed = await claimWhatsAppSession(page);
    if (claimed) console.log('   🔒 Reassumindo a sessão nesta janela ("Usar nesta janela")...');
    await sleep(2000);
  }
  await sleep(2000);
  console.log('✅ WhatsApp pronto!\n');

  return { browser, page };
}

/**
 * Envia o arquivo de áudio na conversa atual (assumindo que o chat já está aberto).
 */
async function _findAudioInput(page) {
  const inputs = await page.$$('input[type="file"]');
  for (const inp of inputs) {
    const accept = await page.evaluate(el => (el.getAttribute('accept') || '').toLowerCase(), inp);
    // WhatsApp já usou accept="audio/*"; versões novas às vezes usam
    // "audio/mp4,audio/mpeg,..." ou "application/ogg". Aceita qualquer um.
    if (accept.includes('audio') || accept.includes('ogg') || accept.includes('mpeg')) {
      console.log(`   🎯 Input de áudio localizado (accept="${accept}")`);
      return inp;
    }
  }
  return null;
}

async function sendAudioFile(page, audioPath) {
  // 1. Neutraliza o clique nativo em <input type=file> ANTES de abrir o menu.
  //    Assim, quando o item "Áudio" for clicado, o WhatsApp adiciona o input ao
  //    DOM mas o diálogo nativo do Windows NUNCA abre. Capturamos o input em
  //    window.__sfAudioInput para fazer uploadFile depois.
  await page.evaluate(() => {
    if (!window.__sfClickPatched) {
      const orig = HTMLInputElement.prototype.click;
      window.__sfOrigInputClick = orig;
      window.__sfClickPatched = true;
      HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') {
          window.__sfAudioInput = this; // captura o input, NÃO abre o diálogo
          return;
        }
        return orig.apply(this, arguments);
      };
    }
    window.__sfAudioInput = null;
  });

  // Helpers reutilizáveis ────────────────────────────────────
  // Acha o botão "+" (anexar) no rodapé do chat.
  const acharAttach = () => page.evaluate(() => {
    const selectors = [
      '[data-icon="plus-rounded"]', '[data-icon="plus"]',
      '[data-testid="attach-menu-plus"]', '[data-icon="attach-menu-plus"]',
      '[data-icon="clip"]', '[data-icon="clip-outline"]',
      'button[aria-label="Anexar"]', 'button[aria-label="Attach"]',
      '[aria-label="Anexar"]', '[aria-label="Attach"]',
      '[title="Anexar"]', 'button[title="Attach"]',
      '[data-testid="attach"]', 'span[data-testid="clip"]',
    ];
    const footer = document.querySelector('footer') || document;
    for (const root of [footer, document]) {
      for (const sel of selectors) {
        const el = root.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          const btn = el.closest('button') || el;
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, sel };
        }
      }
    }
    return null;
  });

  // Confirma que o MENU de anexo abriu de verdade. Os itens do WhatsApp são
  // <div> (não li/menuitem), então varremos elementos curtos e exigimos >=3
  // rótulos EXCLUSIVOS do menu (Documento, Câmera, Enquete, etc.) — assim não dá
  // falso positivo com a palavra "Áudio" solta numa mensagem do chat.
  const menuAberto = () => page.evaluate(() => {
    const alvo = ['documento', 'fotos e vídeos', 'fotos e videos', 'câmera', 'camera',
      'enquete', 'contato', 'evento', 'nova figurinha', 'catálogo', 'catalogo',
      'cobrar', 'resposta rápida', 'áudio', 'audio'];
    const seen = new Set();
    const els = document.querySelectorAll('div, span, li, button, [role="menuitem"], [role="button"], [role="listitem"], [role="option"]');
    for (const el of els) {
      if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      if (!t || t.length > 20) continue;
      if (alvo.includes(t)) seen.add(t);
    }
    return seen.size >= 3;
  });

  // Acha o item "Áudio" DENTRO do menu aberto.
  const acharItemAudio = () => page.evaluate(() => {
    const direct = ['[data-testid="mi-attach-audio"]', '[data-testid="attach-audio"]', '[data-icon="audio"]'];
    for (const sel of direct) {
      const el = document.querySelector(sel);
      if (el) {
        const target = el.closest('li, [role="button"], [role="menuitem"], button') || el;
        const r = target.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2, sel };
      }
    }
    // Coleta TODOS os "Áudio" visíveis e prioriza o que está DENTRO de um menu.
    const all = document.querySelectorAll('li, [role="listitem"], [role="menuitem"], [role="button"], div, span');
    const cands = [];
    for (const el of all) {
      if (/^[Áá]udio$|^Audio$/i.test((el.textContent || '').trim()) && el.offsetWidth > 0) {
        const inMenu = el.closest('[role="application"], [role="menu"], ul, [class*="menu"], [class*="dropdown"], [data-animate-dropdown-current]');
        const target = el.closest('li, [role="button"], [role="menuitem"], button') || el;
        const r = target.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) cands.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, sel: inMenu ? 'menu:Audio' : 'text:Audio', inMenu: !!inMenu });
      }
    }
    if (!cands.length) return null;
    const preferido = cands.find(c => c.inMenu) || cands[0];
    return { x: preferido.x, y: preferido.y, sel: preferido.sel };
  });

  const capturarInput = async () => {
    const handle = await page.evaluateHandle(() => window.__sfAudioInput || null);
    const el = handle.asElement();
    if (el && (await el.evaluate(x => !!x))) return el;
    return _findAudioInput(page);
  };

  // Reset de estado ANTES de abrir o menu — corrige a falha do 2º contato em
  // diante: depois de enviar o áudio do 1º, a aba perdia o foreground / ficava
  // com estado residual e o clique no "+" não abria o menu. Reassumimos o
  // foreground, limpamos qualquer overlay (ESC) e focamos o rodapé (compositor).
  // ATENÇÃO: NÃO usar tecla Escape aqui — no WhatsApp Web o Esc FECHA a conversa
  // (volta para a lista), aí some o "+" e o áudio nunca é enviado. Em vez disso,
  // reassumimos o foreground e focamos o compositor (não sai do chat).
  await page.bringToFront().catch(() => {});
  await sleep(300);
  await page.evaluate(() => {
    const comp = document.querySelector('footer div[contenteditable="true"], footer [role="textbox"]');
    if (comp) comp.focus();
  }).catch(() => {});
  await sleep(500);

  // 2-4. Abre o menu, clica em "Áudio" e captura o input — tudo com retry
  //      COMPLETO. A causa da falha do 2º contato em diante era o menu "+" não
  //      abrir de fato (o item "Audio" achado era um falso positivo fora do menu).
  let audioInput = null;
  for (let attempt = 1; attempt <= 3 && !audioInput; attempt++) {
    await page.evaluate(() => { window.__sfAudioInput = null; });

    // (re)abre o menu garantindo que abriu
    let menuOk = false;
    for (let m = 1; m <= 3 && !menuOk; m++) {
      const coords = await acharAttach();
      if (!coords) { await sleep(1000); continue; }
      if (attempt === 1 && m === 1) console.log(`   📎 Abrindo menu via: ${coords.sel}`);
      await page.mouse.click(coords.x, coords.y);
      await sleep(1400);
      menuOk = await menuAberto();
      if (!menuOk) {
        // NÃO usar Escape (fecha a conversa). Só espera e re-clica no "+".
        await sleep(700);
      }
    }
    if (!menuOk) {
      console.log(`   ⚠️  Menu de anexo não abriu (tentativa ${attempt}/3).`);
      continue;
    }

    const audioItem = await acharItemAudio();
    if (!audioItem) {
      console.log(`   ⚠️  Item "Áudio" não visível no menu aberto (tentativa ${attempt}/3).`);
      await sleep(700);
      continue;
    }
    console.log(`   🖱️  Item Áudio: ${audioItem.sel} (diálogo nativo neutralizado)`);
    await page.mouse.click(audioItem.x, audioItem.y);

    // aguarda o input de áudio ser criado/capturado (até 6s)
    try {
      await page.waitForFunction(() => {
        if (window.__sfAudioInput) return true;
        for (const i of document.querySelectorAll('input[type=file]')) {
          const a = (i.getAttribute('accept') || '').toLowerCase();
          if (a.includes('audio') || a.includes('ogg') || a.includes('mpeg')) return true;
        }
        return false;
      }, { timeout: 6000 });
    } catch (_) {}

    audioInput = await capturarInput();
    if (!audioInput) {
      console.log(`   ⏳ Áudio ainda indisponível (tentativa ${attempt}/3), reabrindo menu...`);
      await sleep(800);
    }
  }

  if (!audioInput) {
    // Diagnóstico: lista TODOS os inputs de arquivo presentes no DOM para
    // sabermos exatamente qual accept o WhatsApp está usando para áudio.
    const diag = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=file]')).map(i => ({
        accept: i.getAttribute('accept'),
        name: i.name || null,
        visible: i.offsetParent !== null,
      }))
    );
    console.log('   🔎 Inputs de arquivo no DOM:', JSON.stringify(diag));
    throw new Error('Input de áudio não encontrado após clicar no item Áudio');
  }

  console.log('   ⬆️  Enviando áudio via uploadFile (sem diálogo)...');
  await audioInput.uploadFile(audioPath);
  await sleep(5000); // aguarda upload e preview carregar

  // Aguarda o botão de enviar aparecer no preview de mídia
  // (botão diferente do botão de enviar do chat principal)
  try {
    await page.waitForFunction(() => {
      const selectors = [
        '[data-testid="media-caption-send-button"]',
        '[data-testid="send"]',
        'span[data-icon="send"]',
        '[aria-label="Enviar"]',
        '[aria-label="Send"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return true;
      }
      return false;
    }, { timeout: 15000 });
  } catch (e) {
    // timeout — tenta mesmo assim
  }
  await sleep(1000);

  // Clica no botão de enviar do preview de mídia
  const sent = await page.evaluate(() => {
    const selectors = [
      '[data-testid="media-caption-send-button"]',
      '[data-testid="send"]',
      'span[data-icon="send"]',
      '[aria-label="Enviar"]',
      '[aria-label="Send"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        // Clica no elemento e no pai para garantir
        el.click();
        if (el.parentElement) el.parentElement.click();
        return sel;
      }
    }
    return null;
  });

  if (sent) {
    console.log(`   🖱️  Botão clicado: ${sent}`);
  } else {
    // Fallback: Enter
    await page.keyboard.press('Enter');
  }
  await sleep(4000);

  // Restaura o click nativo do input (limpeza)
  await page.evaluate(() => {
    if (window.__sfClickPatched && window.__sfOrigInputClick) {
      HTMLInputElement.prototype.click = window.__sfOrigInputClick;
      window.__sfClickPatched = false;
    }
  }).catch(() => {});
}

/**
 * Envia texto + áudio para um número.
 */
async function sendFollowupMessage(page, phoneNumber, text, audioPath, chaveFoto) {
  // page ignorado (compat). Envia pelo cliente único: texto + áudio (como voz).
  {
    const wa = require('./wa-client');
    try {
      await wa.sendTexto(phoneNumber, text, undefined, chaveFoto);
      if (audioPath) {
        await sleep(1500);
        console.log(`   🎧 Enviando áudio como voz: ${path.basename(audioPath)}`);
        await wa.sendMidia(phoneNumber, audioPath, { comoVoz: true });
      }
      return true;
    } catch (e) {
      console.log(`   ⚠️  Falha no follow-up para ${phoneNumber}: ${e.message}`);
      return false;
    }
  }
  // ── (código antigo via page abaixo fica inacessível) ──
  let number = phoneNumber.replace(/\D/g, '');
  if (!number.startsWith('55')) number = '55' + number;

  const url = `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(text)}`;

  // Abre a conversa. O goto pode ser ABORTADO (net::ERR_ABORTED) quando a aba
  // recarrega por causa do aviso "aberto em outra janela" — então tentamos
  // algumas vezes, reassumindo a sessão entre as tentativas.
  let abriu = false;
  for (let tentativa = 1; tentativa <= 3 && !abriu; tentativa++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      abriu = true;
    } catch (e) {
      console.log(`   ⏳ Abertura da conversa falhou (${(e.message || '').split('\n')[0]}) — tentativa ${tentativa}/3`);
      await claimWhatsAppSession(page);
      await sleep(3000);
    }
  }
  if (!abriu) { console.log(`   ⚠️  Não consegui abrir a conversa de ${number} — pulando`); return false; }
  await sleep(2000);
  await claimWhatsAppSession(page); // caso o aviso apareça depois de abrir

  const temErro = await page.evaluate(() => {
    const body = (document.body.textContent || '').toLowerCase();
    return body.includes('número de telefone inválido') || body.includes('invalid phone')
      || body.includes('telefone compartilhado por url');
  });
  if (temErro) {
    console.log(`   ⚠️  Número inválido: ${number}`);
    return false;
  }

  // Aguarda a CAIXA DE MENSAGEM (mais confiável que o botão) — com retry,
  // reassumindo a sessão a cada tentativa.
  let pronto = false;
  for (let tentativa = 1; tentativa <= 3 && !pronto; tentativa++) {
    await claimWhatsAppSession(page);
    try {
      await page.waitForFunction(
        () => document.querySelector('div[contenteditable="true"][data-tab], footer div[contenteditable="true"]'),
        { timeout: 20000 }
      );
      pronto = true;
    } catch (e) {
      console.log(`   ⏳ Conversa não carregou (tentativa ${tentativa}/3) — aguardando...`);
      await sleep(4000);
    }
  }
  if (!pronto) {
    console.log(`   ⚠️  Chat não carregou para ${number} — pulando`);
    return false;
  }
  await sleep(1200);

  // Envia: foca a caixa, tenta o botão (seletores novos, inclui o ícone
  // wds-ic-send-filled) e, se não achar, manda Enter (forma mais confiável).
  await page.evaluate(() => {
    const box = document.querySelector('div[contenteditable="true"][data-tab], footer div[contenteditable="true"]');
    if (box) box.focus();
  });
  await sleep(500);
  const clicou = await page.evaluate(() => {
    const sel = ['button[aria-label="Enviar"]', 'button[aria-label="Send"]', '[data-testid="send"]',
      'span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]', 'footer button[data-tab]'];
    for (const s of sel) { const el = document.querySelector(s); if (el) { (el.closest('button') || el).click(); return true; } }
    return false;
  });
  if (!clicou) await page.keyboard.press('Enter');
  await sleep(4000);
  console.log('   ✅ Texto enviado');

  // Envia áudio se disponível
  if (audioPath) {
    if (fs.existsSync(audioPath)) {
      try {
        await sendAudioFile(page, audioPath);
        console.log(`   ✅ Áudio enviado: ${path.basename(audioPath)}`);
      } catch (err) {
        console.log(`   ⚠️  Falha no áudio: ${err.message}`);
      }
    } else {
      console.log(`   ⚠️  Arquivo de áudio não encontrado: ${audioPath}`);
    }
  }

  return true;
}

/**
 * Executa o job de follow-up para um período (morning | afternoon | all).
 */
async function runFollowup(periodoFiltro, dataOverride = null) {
  const periodoLabel = periodoFiltro === 'morning'
    ? 'Manhã (ontem antes das 12h)'
    : periodoFiltro === 'afternoon'
    ? 'Tarde (ontem após 12h)'
    : 'Todos';

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🎯 Follow-up Experimentais — SlimFit Setor Bueno ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`   Período: ${periodoLabel}\n`);

  // 1. Busca aulas de ontem com Presença
  const scraper = new EvoScraper();
  let alunos = [];
  try {
    await scraper.init();
    await scraper.login();
    alunos = await scraper.getYesterdayPresenceClasses(periodoFiltro, dataOverride);
  } finally {
    await scraper.close();
  }

  if (alunos.length === 0) {
    console.log('\n┌─────────────────────────────────────────────────────┐');
    console.log(`│  📭 Follow-up ${periodoLabel.padEnd(38)}│`);
    console.log('│  Sem experimental com Presença para o período.      │');
    console.log('└─────────────────────────────────────────────────────┘\n');
    return { enviadas: 0, falhas: 0, puladas: 0, alunos: [] };
  }

  console.log(`\n📋 ${alunos.length} aluno(s) para follow-up:\n`);
  alunos.forEach((a, i) => {
    const audio = getAudioPath(a.professor);
    console.log(`  ${i + 1}. ${a.name}`);
    console.log(`     Horário: ${a.time} | Prof: ${a.professor || '?'} | Tel: ${a.phone}`);
    console.log(`     Áudio: ${audio ? path.basename(audio) : '(não mapeado)'}`);
  });
  console.log('');

  // 2. Conecta WhatsApp e envia
  const { browser, page } = await connectEdgeWhatsApp();
  let enviadas = 0, falhas = 0, puladas = 0;
  const resultado = [];

  try {
    for (const aluno of alunos) {
      if (!aluno.phone || aluno.phone === 'N/A') {
        console.log(`⏭️  ${aluno.name}: sem telefone`);
        puladas++;
        continue;
      }

      const nomeProfessora = (aluno.professor || '').trim().split(/\s+/)[0] || 'a professora';
      // Mensagem diferente se a experimental JÁ virou aluna (contrato preenchido)
      const texto = aluno.virouAluna
        ? config.messageFollowupAluna(nomeProfessora)
        : config.messageFollowup(nomeProfessora);
      const audioPath = getAudioPath(aluno.professor);

      console.log(`\n📨 Enviando para ${aluno.name} (${aluno.phone})` +
        (aluno.virouAluna ? ' [JÁ É ALUNA — msg de boas-vindas]' : '') + '...');

      let status = '❌';
      try {
        const ok = await sendFollowupMessage(page, aluno.phone, texto, audioPath, aluno.virouAluna ? 'followup_aluna' : 'followup');
        if (ok) { enviadas++; status = '✅'; } else falhas++;
      } catch (err) {
        console.log(`   ❌ Erro: ${err.message}`);
        falhas++;
      }

      resultado.push({ status, name: aluno.name, time: aluno.time, professor: aluno.professor, audio: audioPath ? path.basename(audioPath) : null });
      await sleep(12000); // pausa entre mensagens
    }
  } finally {
    browser.disconnect();
  }

  // Resumo visual no Watchdog
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  console.log('\n╔═════════════════════════════════════════════════════╗');
  console.log(`║  📊 Follow-up ${periodoLabel.padEnd(38)}║`);
  console.log(`║  ${ts.padEnd(52)}║`);
  console.log('╠═════════════════════════════════════════════════════╣');
  resultado.forEach(r => {
    const linha = `${r.status} ${r.name} | ${r.time || '--:--'} | ${(r.professor || '?').split(' ')[0]}`;
    console.log(`║  ${linha.padEnd(51)}║`);
    if (r.audio) console.log(`║    🎵 ${r.audio.padEnd(47)}║`);
  });
  console.log('╠═════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Enviadas: ${String(enviadas).padEnd(6)} ❌ Falhas: ${String(falhas).padEnd(6)} ⏭️  Puladas: ${String(puladas).padEnd(4)}║`);
  console.log('╚═════════════════════════════════════════════════════╝\n');

  // Um único aviso no celular com o total (só quando houve falha).
  const quemFalhou = resultado.filter(r => r.status === '❌').map(r => r.name).join(', ');
  require('./notificar').alertarResumo(`Follow-up ${periodoLabel}`,
    { enviadas, falhas, puladas, detalhe: quemFalhou });

  return { enviadas, falhas, puladas, alunos: resultado };
}

/**
 * Modo TESTE: envia texto + áudio para UM número (o seu), sem tocar no EVO.
 * Serve para validar o envio de áudio com segurança.
 *   node src/followup-experimental.js --teste=62981718205 [--prof=taynara]
 */
async function runTeste(numero, professorKey = 'taynara', vezes = 1) {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🧪 TESTE de Follow-up (envio para número próprio) ║');
  console.log('╚════════════════════════════════════════════════════╝');

  const audioPath = getAudioPath(professorKey);
  const texto = config.messageFollowup(
    professorKey.charAt(0).toUpperCase() + professorKey.slice(1)
  );

  console.log(`   Número: ${numero}`);
  console.log(`   Professora (áudio): ${professorKey}`);
  console.log(`   Áudio: ${audioPath ? path.basename(audioPath) : '(não mapeado!)'}`);
  console.log(`   Repetições: ${vezes} (simula fila de vários contatos)`);
  if (audioPath && !fs.existsSync(audioPath)) {
    console.log(`   ⚠️  ATENÇÃO: o arquivo de áudio NÃO existe em: ${audioPath}`);
  }
  console.log('');

  const { browser, page } = await connectEdgeWhatsApp();
  let ok = 0, fail = 0;
  try {
    for (let i = 1; i <= vezes; i++) {
      console.log(`\n📨 (${i}/${vezes}) Enviando teste para ${numero}...`);
      const enviado = await sendFollowupMessage(page, numero, texto, audioPath, 'followup');
      if (enviado) ok++; else fail++;
      if (i < vezes) await sleep(12000); // mesma pausa do fluxo real entre contatos
    }
    console.log(`\n📊 Teste concluído — ✅ ${ok}  ❌ ${fail} (de ${vezes})`);
  } finally {
    browser.disconnect();
  }
}

// Exporta para o scheduler
async function runFollowupMorning() { return runFollowup('morning'); }
async function runFollowupAfternoon() { return runFollowup('afternoon'); }

module.exports = { runFollowupMorning, runFollowupAfternoon };

// Execução direta via CLI:
//   node src/followup-experimental.js [--periodo=manha|tarde|todos] [--data=DD/MM/YYYY]
//   node src/followup-experimental.js --teste=62981718205 [--prof=taynara]
if (require.main === module) {
  const argTeste = process.argv.find(a => a.startsWith('--teste='));

  if (argTeste) {
    const numero = argTeste.split('=')[1];
    const argProf = process.argv.find(a => a.startsWith('--prof='));
    const prof = argProf ? argProf.split('=')[1].toLowerCase() : 'taynara';
    const argVezes = process.argv.find(a => a.startsWith('--vezes='));
    const vezes = argVezes ? Math.max(1, parseInt(argVezes.split('=')[1]) || 1) : 1;
    runTeste(numero, prof, vezes)
      .then(() => process.exit(0))
      .catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
  } else {
    const argPeriodo = process.argv.find(a => a.startsWith('--periodo='));
    const argData   = process.argv.find(a => a.startsWith('--data='));
    const periodo = argPeriodo ? argPeriodo.split('=')[1] : 'todos';
    const data    = argData    ? argData.split('=')[1]    : null;
    const periodoMap = { manha: 'morning', tarde: 'afternoon', todos: 'all' };

    runFollowup(periodoMap[periodo] || 'all', data)
      .catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
  }
}

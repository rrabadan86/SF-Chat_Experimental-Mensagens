require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// ─── Configuração ──────────────────────────────────────────
// Usuário do Instagram a analisar (seu @). Pode vir do .env (IG_USERNAME)
// ou por argumento: node src/instagram-seguidores.js --user=seu_usuario
const argUser = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1];
const IG_USERNAME = argUser || process.env.IG_USERNAME || '';

// Perfil do Edge onde você está LOGADO no Instagram.
// Use um perfil separado do WhatsApp para não misturar sessões.
const IG_EDGE_PROFILE = process.env.IG_EDGE_PROFILE || 'Default';
const CDP_PORT = 9224; // porta dedicada (WhatsApp=9222, Financeiro=9223)
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
// Mesma pasta dedicada do WhatsApp SlimFit (o Instagram fica logado neste perfil)
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const { execSync, spawn } = require('child_process');

// ─── Suporte a Linux / VPS ─────────────────────────────────
const IS_LINUX = process.platform === 'linux';
// Perfil dedicado do Instagram no Linux (guarda a sessão logada do IG).
const IG_PROFILE_DIR = process.env.IG_PROFILE_DIR ||
  path.resolve(__dirname, '..', 'instagram-chrome-data');
const IG_HEADLESS = process.env.HEADLESS !== 'false';

// Proxy (residencial/móvel) para o Instagram — a Meta bloqueia IP de VPS (429).
// Defina no .env:  IG_PROXY=host:porta  (e, se precisar, IG_PROXY_USER / IG_PROXY_PASS)
const IG_PROXY = process.env.IG_PROXY || '';
const IG_PROXY_USER = process.env.IG_PROXY_USER || '';
const IG_PROXY_PASS = process.env.IG_PROXY_PASS || '';

// Lança o Chromium do Puppeteer com o perfil dedicado do Instagram (Linux).
async function launchInstagramChromium() {
  console.log(`🐧 Abrindo Chromium com perfil do Instagram (${IG_HEADLESS ? 'headless' : 'com tela'})${IG_PROXY ? ' via proxy ' + IG_PROXY : ''}...`);
  const browser = await puppeteer.launch({
    headless: IG_HEADLESS ? 'new' : false,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    userDataDir: IG_PROFILE_DIR,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,900',
      '--lang=pt-BR',
      ...(IG_PROXY ? ['--proxy-server=' + IG_PROXY] : []),
    ],
  });

  // Autenticação do proxy (se exigir usuário/senha) em toda página aberta.
  if (IG_PROXY && IG_PROXY_USER) {
    const autenticar = async (p) => { try { await p.authenticate({ username: IG_PROXY_USER, password: IG_PROXY_PASS }); } catch (_) {} };
    for (const p of await browser.pages()) await autenticar(p);
    browser.on('targetcreated', async (t) => { try { const p = await t.page(); if (p) await autenticar(p); } catch (_) {} });
  }
  // Os jobs chamam browser.disconnect() no fim; no Linux isso precisa FECHAR o
  // Chromium (liberar o perfil). browser.close() chama disconnect() internamente,
  // então uma trava evita a recursão infinita.
  const realClose = browser.close.bind(browser);
  let fechando = false;
  browser.disconnect = async () => {
    if (fechando) return;
    fechando = true;
    try { await realClose(); } catch (_) {}
  };
  return browser;
}

// Arquivo onde a lista de seguidores conhecidos é salva
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'instagram-seguidores.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Conexão com o Edge (perfil logado no Instagram) ──────
async function connectEdge() {
  if (IS_LINUX) {
    return await launchInstagramChromium();
  }

  console.log('🔄 Fechando Edge existente...');
  try { execSync('taskkill /F /IM msedge.exe', { stdio: 'ignore' }); } catch (e) { /* nenhum aberto */ }
  await sleep(3000);

  let edgePath = null;
  for (const p of EDGE_PATHS) { if (fs.existsSync(p)) { edgePath = p; break; } }
  if (!edgePath) throw new Error('Microsoft Edge não encontrado');

  console.log(`📱 Abrindo Edge com perfil ${IG_EDGE_PROFILE} (porta ${CDP_PORT})...`);
  const child = spawn(edgePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1', // força a porta no IP exato que o script busca
    '--remote-allow-origins=*',             // Chromium 111+ rejeita o WebSocket do DevTools sem isso
    `--user-data-dir=${EDGE_USER_DATA}`,
    `--profile-directory=${IG_EDGE_PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(6000);

  let browser = null;
  for (let i = 0; i < 5; i++) {
    try { browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null }); break; }
    catch (e) { await sleep(3000); }
  }
  if (!browser) throw new Error('Não foi possível conectar ao Edge');
  return browser;
}

// ─── Coleta de seguidores via API interna do Instagram ──────
// Usa a sua sessão logada (cookies) para chamar a API privada do IG
// diretamente por fetch dentro da página. Bem mais confiável que rolar a tela.
const IG_APP_ID = '936619743392459'; // app id do Instagram Web

async function coletarSeguidores(page) {
  // 1. Abre o Instagram (precisa estar no domínio para o fetch usar os cookies)
  console.log(`🌐 Abrindo perfil @${IG_USERNAME}...`);
  await page.goto(`https://www.instagram.com/${IG_USERNAME}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);

  // 1b. Verifica se está LOGADO
  const deslogado = await page.evaluate(() => {
    if (location.href.includes('/accounts/login')) return true;
    if (document.querySelector('input[name="username"], input[name="email"], input[name="pass"]')) return true;
    const body = (document.body.innerText || '').toLowerCase();
    if (body.includes('entrar com o facebook') || body.includes('log in with facebook')) return true;
    return false;
  });
  if (deslogado) {
    throw new Error('Você NÃO está logado no Instagram neste perfil do Edge. Faça login e tente de novo (ou ajuste IG_EDGE_PROFILE no .env).');
  }

  // 2. Descobre o ID numérico do perfil
  console.log('🔎 Obtendo ID do perfil...');
  const userId = await page.evaluate(async (username, appId) => {
    try {
      const r = await fetch(`/api/v1/users/web_profile_info/?username=${username}`, {
        headers: { 'X-IG-App-ID': appId },
        credentials: 'include',
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.data?.user?.id || null;
    } catch (e) { return null; }
  }, IG_USERNAME, IG_APP_ID);

  if (!userId) throw new Error('Não consegui obter o ID do perfil (sessão expirou? perfil errado?).');

  // 3. Pagina a lista de seguidores (mais recentes primeiro)
  console.log('👥 Coletando seguidores via API...');
  const seguidoresMap = new Map();
  let maxId = '';
  for (let pagina = 0; pagina < 120; pagina++) { // limite de segurança
    const res = await page.evaluate(async (id, appId, maxId) => {
      try {
        let url = `/api/v1/friendships/${id}/followers/?count=100`;
        if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;
        const r = await fetch(url, { headers: { 'X-IG-App-ID': appId }, credentials: 'include' });
        if (!r.ok) return { erro: r.status };
        return await r.json();
      } catch (e) { return { erro: String(e && e.message || e) }; }
    }, userId, IG_APP_ID, maxId);

    if (res.erro) {
      // Se já coletou algo, para com o que tem; senão, erro
      if (seguidoresMap.size > 0) {
        console.log(`\n   ⚠️  API parou (${res.erro}) — usando ${seguidoresMap.size} já coletados.`);
        break;
      }
      throw new Error(`API de seguidores retornou erro: ${res.erro}`);
    }

    const users = Array.isArray(res.users) ? res.users : [];
    for (const u of users) {
      if (u.username) {
        seguidoresMap.set(u.username, {
          username: u.username,
          full_name: u.full_name || '',
          pk: String(u.pk || u.id || ''),
        });
      }
    }
    process.stdout.write(`\r   Coletados: ${seguidoresMap.size} seguidor(es)   `);

    if (!res.next_max_id) break; // fim da lista
    maxId = res.next_max_id;
    await sleep(1500); // pausa entre páginas (evita rate limit)
  }
  console.log('');

  return Array.from(seguidoresMap.values());
}

// ─── Persistência ──────────────────────────────────────────
function carregarConhecidos() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const json = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return json.seguidores || [];
    }
  } catch (e) {
    console.log(`   ⚠️  Não consegui ler ${DB_FILE}: ${e.message}`);
  }
  return null; // null = primeira execução (sem base)
}

function salvarConhecidos(lista, tsStr) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({
    atualizadoEm: tsStr,
    total: lista.length,
    seguidores: lista,
  }, null, 2), 'utf8');
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   INSTAGRAM — Detecção de novos seguidores (LEITURA) ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  if (!IG_USERNAME) {
    console.log('\n❌ Informe seu usuário do Instagram:');
    console.log('   node src/instagram-seguidores.js --user=SEU_USUARIO');
    console.log('   (ou defina IG_USERNAME no arquivo .env)\n');
    process.exit(1);
  }
  console.log(`   Perfil: @${IG_USERNAME}\n`);

  const browser = await connectEdge();
  let atuais = [];
  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    atuais = await coletarSeguidores(page);
  } finally {
    try { browser.disconnect(); } catch (e) {}
  }

  console.log(`\n✅ Total de seguidores coletados: ${atuais.length}`);

  if (atuais.length === 0) {
    console.log('\n⚠️  Coletou 0 seguidores — algo deu errado (login? perfil? rede?).');
    console.log('   NÃO vou salvar base vazia. Confira o Edge que abriu e tente de novo.\n');
    return;
  }

  const tsStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const conhecidos = carregarConhecidos();

  if (conhecidos === null) {
    // Primeira execução: só cria a base, sem "novos"
    salvarConhecidos(atuais, tsStr);
    console.log('\n📌 PRIMEIRA execução — base de seguidores criada.');
    console.log('   Na próxima vez, quem entrar depois de agora será marcado como NOVO.');
    console.log(`   Base salva em: ${DB_FILE}\n`);
    return;
  }

  // Compara: quem está em "atuais" mas não estava em "conhecidos"
  const conhecidosSet = new Set(conhecidos.map(c => c.username));
  const novos = atuais.filter(a => !conhecidosSet.has(a.username));

  // (informativo) quem deixou de seguir
  const atuaisSet = new Set(atuais.map(a => a.username));
  const sairam = conhecidos.filter(c => !atuaisSet.has(c.username));

  console.log('\n─────────────────────────────────────────────────────');
  if (novos.length === 0) {
    console.log('📭 Nenhum seguidor NOVO desde a última verificação.');
  } else {
    console.log(`🎉 ${novos.length} NOVO(S) seguidor(es):\n`);
    novos.forEach((n, i) => {
      console.log(`  ${i + 1}. @${n.username}${n.full_name ? '  (' + n.full_name + ')' : ''}`);
    });
  }
  if (sairam.length > 0) {
    console.log(`\nℹ️  ${sairam.length} deixaram de seguir: ${sairam.map(s => '@' + s.username).join(', ')}`);
  }
  console.log('─────────────────────────────────────────────────────');

  // Atualiza a base para a próxima comparação
  salvarConhecidos(atuais, tsStr);
  console.log(`\n💾 Base atualizada (${atuais.length} seguidores) em ${tsStr}\n`);

  // Salva os novos num arquivo separado para inspeção/uso futuro
  if (novos.length > 0) {
    const novosFile = path.join(DATA_DIR, 'instagram-novos.json');
    fs.writeFileSync(novosFile, JSON.stringify({ detectadoEm: tsStr, novos }, null, 2), 'utf8');
    console.log(`📄 Lista de novos salva em: ${novosFile}\n`);
  }
}

// Exporta funções e constantes para reuso (ex: instagram-boasvindas.js)
module.exports = {
  connectEdge,
  launchInstagramChromium,
  coletarSeguidores,
  carregarConhecidos,
  salvarConhecidos,
  sleep,
  IG_USERNAME,
  IG_EDGE_PROFILE,
  IG_PROFILE_DIR,
  DATA_DIR,
  DB_FILE,
};

// Execução direta via CLI (só roda quando chamado diretamente)
if (require.main === module) {
  main().catch(err => {
    console.error('\n❌ Erro fatal:', err.message);
    process.exit(1);
  });
}

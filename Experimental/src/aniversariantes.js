require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════
//  CONFIGURAÇÃO — edite à vontade
// ═══════════════════════════════════════════════════════════

// A mensagem tem a marcação (@) no meio. Montamos em 3 partes:
// prefixo + [marcação da aniversariante] + sufixo.
const MSG_PREFIXO = 'Hoje é aniversário da ';
const MSG_SUFIXO  = '! 🥳🎉\n\nMuitas felicidades, saúde e sucesso!!! Que este novo ciclo venha repleto de conquistas e alegria!! Aproveite o seu dia! ❤️';

// WhatsApp: perfil DEDICADO do bot (pasta isolada), porta 9226 (mesmo do follow-up)
const CDP_URL = 'http://127.0.0.1:9226';
const IS_LINUX = process.platform === 'linux';
const EDGE_PROFILE = 'Default';

// Modo simulação por padrão. Use --enviar para realmente mandar nos grupos.
// (o scheduler chama runAniversariantes() que força o envio)
let MODO_ENVIO = process.argv.includes('--enviar');
// Permite testar uma data específica: --data=DD/MM
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').split('=')[1];

// ═══════════════════════════════════════════════════════════

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const { execSync, spawn } = require('child_process');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RELATORIO_FILE = path.join(DATA_DIR, 'aniversariantes-envios.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Data: é aniversário hoje? ─────────────────────────────
function diaMesHoje() {
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (argData) {
    const m = /^(\d{1,2})\/(\d{1,2})/.exec(argData);
    if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  }
  return { dia: hoje.getDate(), mes: hoje.getMonth() + 1 };
}

function extrairDiaMesNascimento(valor) {
  if (!valor) return null;
  const s = String(valor);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // ISO: 1990-07-02...
  if (m) return { dia: parseInt(m[3]), mes: parseInt(m[2]) };
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);   // DD/MM/YYYY
  if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  m = /^(\d{2})\/(\d{2})$/.exec(s);           // DD/MM
  if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  return null;
}

// ─── EVO: busca aniversariantes e filtra os de HOJE ────────
async function buscarAniversariantesHoje() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🎂 Buscando aniversariantes no EVO...');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === 'false' ? false : 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  let clientesIntercept = [];
  let dadosPessoaisCapturado = null;
  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  page.on('response', async (res) => {
    const url = res.url();
    try {
      if (url.includes('obter-clientes') && res.status() === 200) {
        const data = JSON.parse(await res.text());
        if (data.retorno?.length > 0) clientesIntercept = data.retorno;
      }
      if (url.includes('/dadosPessoais') && res.status() === 200) {
        dadosPessoaisCapturado = JSON.parse(await res.text());
      }
    } catch (e) {}
  });

  function extrairTelefone(data) {
    if (!data || !Array.isArray(data.telefones)) return null;
    const ordenados = [...data.telefones].sort((a, b) =>
      (/celular/i.test(a.descricaoTipoContato || '') ? 0 : 1) -
      (/celular/i.test(b.descricaoTipoContato || '') ? 0 : 1));
    for (const t of ordenados) {
      if ((t.descricaoTipoContato || '').toLowerCase().includes('mail')) continue;
      const num = String(t.descricao || t.telefone || t.numero || '').replace(/\D/g, '');
      if (num.length >= 10 && num.length <= 11) return num;
    }
    return null;
  }

  try {
    // 1. Login
    console.log('🔐 Fazendo login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(4000);
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    console.log('✅ Login OK\n');

    // 2. Vai para Segmentação e clica em "Aniversariantes"
    console.log('📂 Navegando para Segmentação...');
    await page.evaluate(() => { location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes'; });
    await sleep(5000);

    console.log('🔍 Clicando no segmento "Aniversariantes"...');
    const segClicado = await page.evaluate(() => {
      const els = document.querySelectorAll('a, li, span, div');
      for (const el of els) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === 'aniversariantes' && el.offsetWidth > 0 && el.offsetHeight > 0) {
          el.scrollIntoView(); el.click(); return true;
        }
      }
      // fallback: contém "aniversariante"
      for (const el of els) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t.includes('aniversariante') && el.children.length === 0 && el.offsetWidth > 0) {
          el.scrollIntoView(); el.click(); return true;
        }
      }
      return false;
    });
    if (!segClicado) throw new Error('Segmento "Aniversariantes" não encontrado.');
    await sleep(6000);
    console.log(`📊 ${clientesIntercept.length} cliente(s) na segmentação\n`);

    const alvo = diaMesHoje();
    console.log(`🗓️  Procurando aniversariantes do dia ${String(alvo.dia).padStart(2,'0')}/${String(alvo.mes).padStart(2,'0')}\n`);

    // 3. Lê a TABELA direto (nome + data de nascimento estão nas colunas)
    const linhasTabela = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, tr.mat-row, tr[role="row"], tr[class*="row"]');
      const out = [];
      rows.forEach(r => {
        const txt = r.innerText || '';
        const nasc = txt.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (!nasc) return;
        // Nome: preferência para o link (nome da cliente é clicável)
        let nome = '';
        const a = r.querySelector('a');
        if (a && a.textContent.trim()) nome = a.textContent.trim();
        if (!nome) {
          // fallback: célula com texto alfabético que não seja data/número
          const tds = r.querySelectorAll('td');
          for (const td of tds) {
            const t = (td.innerText || '').trim();
            if (/[A-Za-zÀ-ú]{3,}/.test(t) && !/\d{2}\/\d{2}/.test(t)) { nome = t.split('\n').pop().trim(); break; }
          }
        }
        if (nome) out.push({ nome, nascimento: nasc[1] });
      });
      return out;
    });
    console.log(`   ${linhasTabela.length} linha(s) com data de nascimento lida(s) da tabela`);

    // Filtra os que fazem aniversário hoje
    const doHoje = linhasTabela.filter(l => {
      const dm = extrairDiaMesNascimento(l.nascimento);
      return dm && dm.dia === alvo.dia && dm.mes === alvo.mes;
    });
    console.log(`   🎂 ${doHoje.length} fazem aniversário hoje\n`);

    // 4. Para cada aniversariante de hoje, abre o painel e pega o Celular
    const aniversariantes = [];
    for (const item of doHoje) {
      console.log(`🔎 ${item.nome} (${item.nascimento})...`);

      // 4a. Fecha qualquer painel aberto ANTES (senão lê o da pessoa anterior)
      await page.keyboard.press('Escape');
      await sleep(600);
      await page.evaluate(() => {
        // tenta clicar num botão de fechar (X) do painel, se existir
        const els = document.querySelectorAll('button, [role="button"], mat-icon, span');
        for (const el of els) {
          const t = (el.textContent || '').trim().toLowerCase();
          const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
          if ((t === 'close' || t === '×' || t === '✕' || lbl.includes('fechar') || lbl.includes('close')) && el.offsetWidth > 0) {
            el.click(); return;
          }
        }
      });
      // espera o painel fechar (sumir "Celular" da tela)
      await page.waitForFunction(
        () => !/celular/i.test(document.body.innerText || ''),
        { timeout: 5000 }
      ).catch(() => {});
      await sleep(600);

      // 4b. Clica no NOME (link) da cliente para abrir o painel dela
      const clicou = await page.evaluate((nome) => {
        const alvoTxt = nome.substring(0, 15);
        // prioriza o link do nome
        const links = document.querySelectorAll('table tbody tr a');
        for (const el of links) {
          if (el.textContent && el.textContent.includes(alvoTxt) && el.offsetWidth > 0) { el.click(); return true; }
        }
        const outros = document.querySelectorAll('table tbody tr td, table tbody tr span');
        for (const el of outros) {
          if (el.textContent && el.textContent.includes(alvoTxt) && el.offsetWidth > 0) { el.click(); return true; }
        }
        return false;
      }, item.nome);

      let telefone = null;
      if (clicou) {
        // 4c. Espera o painel mostrar O NOME desta pessoa + "Celular"
        const doisNomes = item.nome.split(/\s+/).slice(0, 2).join(' ');
        await page.waitForFunction(
          (nm) => {
            const t = document.body.innerText || '';
            return t.includes(nm) && /celular/i.test(t);
          },
          { timeout: 10000 }, doisNomes
        ).catch(() => {});
        await sleep(1200);

        // 4d. Lê o Celular (confirmando que o painel é desta pessoa)
        const cel = await page.evaluate((nm) => {
          const txt = document.body.innerText || '';
          if (!txt.includes(nm)) return null; // painel não é desta pessoa
          const m = txt.match(/Celular\s*([\d][\d\s()+\-]{8,})/i);
          return m ? m[1].replace(/\D/g, '') : null;
        }, doisNomes);
        if (cel && cel.length >= 10) telefone = cel;
      }

      aniversariantes.push({
        nome: item.nome,
        primeiroNome: (item.nome || '').trim().split(/\s+/)[0],
        telefone,
      });
      console.log(`   🎉 ${item.nome} — ${telefone || 'sem telefone'}`);
    }

    return aniversariantes;
  } finally {
    await browser.close();
  }
}

// ─── WhatsApp: conecta ao Edge Profile 1 (SlimFit) ─────────
async function connectWhatsApp() {
  // Cliente ÚNICO persistente (wa-client.js): garante 'ready' e devolve um
  // "browser" cujo disconnect() é no-op (o cliente compartilhado nunca fecha aqui).
  {
    const wa = require('./wa-client');
    await wa.initWhatsApp();
    return { browser: { disconnect() {} }, page: null };
  }

  console.log('🔄 Fechando Edge existente...');
  try { execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' }); } catch (e) {}
  await sleep(3000);

  let edgePath = null;
  for (const p of EDGE_PATHS) { if (fs.existsSync(p)) { edgePath = p; break; } }
  if (!edgePath) throw new Error('Microsoft Edge não encontrado');

  console.log(`📱 Abrindo Edge com perfil ${EDGE_PROFILE}...`);
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

  let browser = null;
  for (let i = 0; i < 5; i++) {
    try { browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null }); break; }
    catch (e) { await sleep(3000); }
  }
  if (!browser) throw new Error('Não foi possível conectar ao Edge');

  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('web.whatsapp.com')) || null;
  if (!page) {
    page = await browser.newPage();
    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });
  }
  console.log('⏳ Aguardando WhatsApp Web...');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="chat-list"]') || document.querySelector('#pane-side'),
    { timeout: 60000 }
  );
  await sleep(2000);
  console.log('✅ WhatsApp pronto!\n');
  return { browser, page };
}

// ─── Abre a conversa do número e lê os "grupos em comum" ───
async function getGruposEmComum(page, phone) {
  let number = phone.replace(/\D/g, '');
  if (!number.startsWith('55')) number = '55' + number;

  await page.goto(`https://web.whatsapp.com/send?phone=${number}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(4000);

  const invalido = await page.evaluate(() => {
    const b = document.body.textContent || '';
    return b.includes('número de telefone inválido') || b.includes('invalid phone');
  });
  if (invalido) { console.log(`   ⚠️  Número inválido: ${number}`); return []; }

  // Abre o painel de dados do contato (clica no cabeçalho da conversa)
  await page.evaluate(() => {
    const header = document.querySelector('header [role="button"], header ._amig, header span[title]');
    if (header) header.click();
  });
  await sleep(3000);

  // Rola o painel até o fim para carregar "grupos em comum"
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const drawer = document.querySelector('div[role="dialog"], section, ._aigv, [data-testid="drawer-right"]');
      const scrollables = (drawer || document).querySelectorAll('div');
      let alvo = null, maxH = 0;
      for (const d of scrollables) {
        if (d.scrollHeight > d.clientHeight && d.scrollHeight > maxH) { maxH = d.scrollHeight; alvo = d; }
      }
      if (alvo) alvo.scrollTop = alvo.scrollHeight;
    });
    await sleep(1000);
  }

  // Extrai os nomes dos grupos em comum
  const grupos = await page.evaluate(() => {
    // Acha a seção que contém o título "grupos em comum"
    const todos = Array.from(document.querySelectorAll('div, span, h2, header'));
    let secao = null;
    for (const el of todos) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (/grupos? em comum|groups? in common/.test(t) && t.length < 60) { secao = el; break; }
    }
    const nomes = new Set();
    // Estratégia: após a seção, pega os títulos de grupo (spans com title)
    const container = secao ? (secao.closest('div')?.parentElement || document) : document;
    const candidatos = container.querySelectorAll('span[title]');
    for (const s of candidatos) {
      const nome = (s.getAttribute('title') || '').trim();
      if (nome && nome.length > 1 && nome.length < 60) nomes.add(nome);
    }
    return Array.from(nomes);
  });

  return grupos;
}

// ─── Envia a mensagem com @marcação num grupo ──────────────
async function enviarParabensNoGrupo(page, nomeGrupo, phone, nomePessoa) {
  let number = phone.replace(/\D/g, '');
  if (!number.startsWith('55')) number = '55' + number;

  // 1. Clica na CAIXA DE BUSCA do WhatsApp e digita o nome do grupo
  //    (a busca pode ser <input> OU div[contenteditable], depende da versão)
  const buscaCoords = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('input, div[contenteditable="true"], [role="textbox"]'));
    // (a) por aria-label/placeholder contendo "pesquis"/"search"/"conversa"
    for (const el of cands) {
      const lbl = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
      if ((lbl.includes('pesquis') || lbl.includes('search') || lbl.includes('conversa')) && el.offsetWidth > 0) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    // (b) fallback: campo no topo-esquerdo (a busca, quando nenhum chat está aberto)
    let best = null;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.left < 600 && r.top < 220) {
        if (!best || r.top < best.top) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
      }
    }
    return best;
  });
  if (!buscaCoords) {
    const diag = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, div[contenteditable="true"], [role="textbox"]'))
        .filter(el => el.offsetWidth > 0)
        .map(el => ({ tag: el.tagName, label: el.getAttribute('aria-label'), ph: el.getAttribute('placeholder'), x: Math.round(el.getBoundingClientRect().left), y: Math.round(el.getBoundingClientRect().top) }))
    );
    console.log('      🔎 Campos:', JSON.stringify(diag));
    console.log('      ⚠️  Caixa de busca não encontrada');
    return false;
  }
  await page.mouse.click(buscaCoords.x, buscaCoords.y);
  await sleep(700);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(nomeGrupo, { delay: 40 });
  await sleep(3000);

  const composerSel = 'footer div[contenteditable="true"][role="textbox"], footer div[contenteditable="true"], footer [role="textbox"], div[contenteditable="true"][data-tab="10"], [data-testid="conversation-compose-box-input"]';

  // 2. Abre o primeiro resultado apertando Enter (forma mais confiável)
  await page.keyboard.press('Enter');
  await sleep(3000);

  let comp = await page.$(composerSel);

  // 3. Se não abriu pelo Enter, tenta clicar no resultado via DOM (sem depender de #pane-side)
  if (!comp) {
    await page.evaluate((nome) => {
      const alvo = nome.substring(0, 14);
      const rows = document.querySelectorAll('[role="listitem"], [role="row"], [role="gridcell"], [role="button"]');
      for (const li of rows) {
        const titulo = li.querySelector('span[title]');
        if (titulo) {
          const t = (titulo.getAttribute('title') || '').trim();
          if (t === nome || t.includes(alvo)) {
            (titulo.closest('[role="listitem"], [role="row"], div[tabindex]') || titulo).click();
            return true;
          }
        }
      }
      return false;
    }, nomeGrupo);
    await page.waitForFunction((sel) => !!document.querySelector(sel), { timeout: 8000 }, composerSel).catch(() => {});
    comp = await page.$(composerSel);
  }

  if (!comp) {
    console.log(`      ⚠️  Grupo "${nomeGrupo}" não abriu (campo de mensagem não encontrado)`);
    return false;
  }
  await comp.click();
  await sleep(500);

  // ─── Marcação (@) ────────────────────────────────────────
  // Quando o contato está SALVO, o WhatsApp mostra pelo NOME (não pelo número).
  // Estratégia: digita @ + consulta, DETECTA o popup com a pessoa, e seleciona
  // pelo TECLADO (Enter escolhe o item destacado). Depois CONFERE no campo.
  const primeiroNome = (nomePessoa || '').trim().split(/\s+/)[0] || '';

  async function limparCampo() {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await sleep(250);
  }

  // Lê o texto atual do campo de mensagem
  async function textoCampo() {
    return page.evaluate((sel) => {
      const c = document.querySelector(sel);
      return c ? (c.innerText || c.textContent || '') : '';
    }, composerSel);
  }

  // Uma tentativa: monta prefixo + @consulta, detecta popup, seleciona e confere.
  async function tentar(consulta, criterio) {
    await limparCampo();
    await page.keyboard.type(MSG_PREFIXO, { delay: 15 });
    await page.keyboard.type('@', { delay: 20 });
    await sleep(400);
    await page.keyboard.type(consulta, { delay: 45 });
    await sleep(1800);

    const critLc = (criterio || '').toLowerCase();

    // Detecta o popup de marcação com o item desejado (fora do campo de msg)
    const popupOk = await page.evaluate((critLc, sel) => {
      const comp = document.querySelector(sel);
      const els = document.querySelectorAll('div, span, li');
      for (const el of els) {
        if (comp && (el === comp || comp.contains(el))) continue;
        if (el.offsetHeight <= 0) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 45) continue;
        if (/mencione todos os membros/i.test(t)) continue;
        if (critLc) { if (t.toLowerCase().includes(critLc)) return true; }
        else { if (/\d{3,}/.test(t)) return true; } // por número: item com dígitos
      }
      return false;
    }, critLc, composerSel);

    if (!popupOk) {
      // popup não apareceu com a pessoa — NÃO aperta Enter (evita enviar quebrado)
      return false;
    }

    // Seleciona o item destacado (o WhatsApp destaca o 1º resultado da busca)
    await page.keyboard.press('Enter');
    await sleep(800);

    const txt = await textoCampo();
    // Segurança: não pode ter marcado "todos"
    if (/@?\s*todos\b/i.test(txt)) return false;
    // Sucesso se o nome (critério) entrou no campo; por número, se sobrou algo além do prefixo
    if (critLc) return txt.toLowerCase().includes(critLc);
    return txt.replace(MSG_PREFIXO, '').replace(/@/g, '').trim().length > 0;
  }

  let marcou = false;
  // 1) por NOME (contatos salvos)
  if (primeiroNome) {
    console.log(`      🔖 Tentando marcar por nome: "${primeiroNome}"`);
    marcou = await tentar(primeiroNome, primeiroNome);
  }
  // 2) por NÚMERO (contatos não salvos)
  if (!marcou) {
    console.log(`      🔖 Tentando marcar por número: ...${number.slice(-8)}`);
    marcou = await tentar(number.slice(-8), '');
  }

  if (!marcou) {
    console.log('      ⚠️  Não consegui marcar a pessoa — NÃO vou enviar (evita msg sem/errada tag)');
    await limparCampo();
    return false;
  }

  // O campo já tem: prefixo + @Marcação. Agora adiciona o sufixo e envia.
  await page.keyboard.type(MSG_SUFIXO, { delay: 15 });
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(3000);
  console.log(`      ✅ Enviado no grupo "${nomeGrupo}"`);
  return true;
}

// ─── Teste seguro: envia num ÚNICO grupo, marcando uma pessoa ──
// Uso: node src/aniversariantes.js --teste-grupo="Grupo" --marcar=5562... --nome="Nome Salvo"
async function testeGrupo(nomeGrupo, numeroMarcar, nomePessoa) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   ANIVERSARIANTES — TESTE em 1 grupo              ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Grupo: "${nomeGrupo}"`);
  console.log(`   Marcando: ${nomePessoa ? '"' + nomePessoa + '"' : ''} (${numeroMarcar})\n`);

  const wa = require('./wa-client');
  await wa.initWhatsApp();

  // Acha o grupo pelo nome.
  const g = await wa.acharGrupo(nomeGrupo);
  if (!g) { console.log(`\n⚠️  Grupo "${nomeGrupo}" não encontrado.`); return; }
  const gid = g.id._serialized;
  console.log(`   Grupo encontrado: ${g.name} (${gid})`);

  // 1) Envia um texto SIMPLES primeiro (isola: o envio no grupo funciona?)
  try {
    console.log('📨 [1/2] Enviando texto simples (sem marcação)...');
    await wa.sendGrupo(nomeGrupo, '🧪 Teste de envio no grupo (sem marcação).');
    console.log('   ✅ Texto simples enviado.');
  } catch (e) {
    console.log('   ⚠️  Falhou o texto simples:', e && e.message);
    if (e && e.stack) console.log(e.stack);
  }

  // 2) Envia com @marcação (o que o job de aniversário usa).
  try {
    console.log('📨 [2/2] Enviando com @marcação...');
    await wa.sendGrupoComMencao(gid, MSG_PREFIXO, MSG_SUFIXO, numeroMarcar);
    console.log('\n✅ Teste com marcação enviado! Confira o grupo.');
  } catch (e) {
    console.log(`\n⚠️  Não consegui enviar com marcação: ${e && e.message}`);
    if (e && e.stack) console.log(e.stack);
  }
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  // Modo de teste em 1 grupo específico (não toca no EVO nem em grupos reais)
  const argTesteGrupo = (process.argv.find(a => a.startsWith('--teste-grupo=')) || '').split('=').slice(1).join('=');
  const argMarcar = (process.argv.find(a => a.startsWith('--marcar=')) || '').split('=')[1];
  const argNome = (process.argv.find(a => a.startsWith('--nome=')) || '').split('=').slice(1).join('=');
  if (argTesteGrupo && argMarcar) {
    return testeGrupo(argTesteGrupo, argMarcar, argNome);
  }

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   ANIVERSARIANTES — Parabéns nos grupos           ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(MODO_ENVIO ? '🚀 MODO ENVIO ATIVO\n' : '🧪 MODO SIMULAÇÃO (use --enviar para enviar)\n');

  const aniversariantes = await buscarAniversariantesHoje();

  if (aniversariantes.length === 0) {
    console.log('\n📭 Nenhuma aniversariante hoje. Nada a fazer.\n');
    return { total: 0, resultados: [] };
  }

  console.log(`\n🎂 ${aniversariantes.length} aniversariante(s) hoje:\n`);
  aniversariantes.forEach((a, i) => console.log(`  ${i + 1}. ${a.nome} — ${a.telefone || '⚠️ sem telefone'}`));

  const wa = require('./wa-client');
  await wa.initWhatsApp(); // cliente único persistente (não abre/fecha nada)
  const resultados = [];

  try {
    for (const aniv of aniversariantes) {
      console.log(`\n👤 ${aniv.nome}...`);
      if (!aniv.telefone) { console.log('   ⏭️  Sem telefone — pulando'); resultados.push({ nome: aniv.nome, grupos: [], status: 'sem-telefone' }); continue; }

      // Grupos em comum via API nativa (getCommonGroups) → [{ id, name }]
      let grupos = [];
      try { grupos = await wa.getCommonGroups(aniv.telefone); }
      catch (e) { console.log(`   ⚠️  Erro ao buscar grupos: ${e.message}`); }
      console.log(`   👥 ${grupos.length} grupo(s) em comum: ${grupos.map(g => g.name || g.id).join(', ') || '(nenhum)'}`);

      if (grupos.length === 0) { resultados.push({ nome: aniv.nome, grupos: [], status: 'sem-grupos' }); continue; }

      if (!MODO_ENVIO) {
        console.log('   🧪 Simulação — não enviei nada.');
        resultados.push({ nome: aniv.nome, grupos: grupos.map(g => g.name || g.id), status: 'simulado' });
        continue;
      }

      const enviados = [];
      for (const g of grupos) {
        const rotulo = g.name || g.id;
        console.log(`   📨 Enviando no grupo "${rotulo}"...`);
        let ok = false;
        try {
          // Monta: MSG_PREFIXO + @<aniversariante> + MSG_SUFIXO (menção nativa)
          await wa.sendGrupoComMencao(g.id, MSG_PREFIXO, MSG_SUFIXO, aniv.telefone);
          ok = true;
          console.log(`      ✅ Enviado no grupo "${rotulo}"`);
        } catch (e) { console.log(`      ❌ Erro: ${e.message}`); }
        enviados.push({ grupo: rotulo, ok });
        await sleep(8000); // pausa entre grupos
      }
      resultados.push({ nome: aniv.nome, grupos: enviados, status: 'processado' });
    }
  } finally {
    // cliente persistente permanece vivo para os outros jobs
  }

  // Resumo
  console.log('\n╔═════════════════════════════════════════════════════╗');
  console.log('║   RESUMO — Aniversariantes                          ║');
  console.log('╚═════════════════════════════════════════════════════╝');
  resultados.forEach(r => {
    console.log(`  🎂 ${r.nome} — ${r.status}`);
    if (Array.isArray(r.grupos)) r.grupos.forEach(g => {
      if (typeof g === 'object') console.log(`      ${g.ok ? '✅' : '⚠️'} ${g.grupo}`);
      else console.log(`      • ${g}`);
    });
  });
  console.log('');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  fs.writeFileSync(RELATORIO_FILE, JSON.stringify({ executadoEm: ts, resultados }, null, 2), 'utf8');

  return { total: aniversariantes.length, resultados };
}

// Exporta para o scheduler (sempre em modo de envio real)
async function runAniversariantes() {
  MODO_ENVIO = true;
  return main();
}
module.exports = { runAniversariantes, main };

if (require.main === module) {
  main().catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
}

#!/usr/bin/env node
/**
 * diagnostico-whatsapp.js — abre o WhatsApp Web do zero, do jeito que a SoFIA abre,
 * e conta O QUE aparece: até onde a página carrega, se chega no ponto do QR, quais
 * erros a página dá e o que está escrito na tela.
 *
 * Para que serve: quando a SoFIA não chega no QR ("conexão: ?" no log) e não dá para
 * saber se é a versão do WhatsApp Web, o navegador do servidor ou o WhatsApp segurando.
 *
 * É SEGURO: usa um perfil de navegador TEMPORÁRIO (apagado no fim), não toca na pasta
 * da SoFIA nem do robô, não usa número nenhum e não precisa parar nada. Um QR que
 * apareça aqui NÃO é para escanear (o perfil é jogado fora).
 *
 * Uso:   node diagnostico-whatsapp.js /root/SF-Chat_Experimental-Mensagens
 *        (a pasta da instalação; dela vêm o navegador e o puppeteer da SoFIA)
 * Faz duas rodadas se a primeira não chegar no QR: 1) com a identificação de navegador
 * que a SoFIA usa; 2) com a identificação verdadeira do navegador do servidor.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const CHATBOT = path.join(RAIZ, 'ChatBot');
const URL_WA = process.env.DIAG_URL || 'https://web.whatsapp.com/';
const ESPERA_MS = parseInt(process.env.DIAG_ESPERA_MS || '150000', 10); // por rodada, depois de a página carregar
const UA_SOFIA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const dizer = (s) => console.log(`[${hora()}] ${s}`);

// Lê UMA chave do .env da SoFIA (só as de configuração abaixo — nunca imprime outras).
let envTexto = '';
try { envTexto = fs.readFileSync(path.join(CHATBOT, '.env'), 'utf8'); } catch (_) {}
function doEnv(nome) {
  const m = envTexto.match(new RegExp('^' + nome + '=\\s*["\']?([^"\'\\r\\n#]*)', 'm'));
  return m ? m[1].trim() : '';
}
// Linha "colada" na anterior (echo >> num .env sem quebra de linha no fim): não vale.
function conferirLinha(nome) {
  const noComeco = new RegExp('^' + nome + '=', 'm').test(envTexto);
  const emQualquerLugar = envTexto.includes(nome + '=');
  if (!emQualquerLugar) return `${nome}: não está no .env (vale o padrão)`;
  if (!noComeco) return `${nome}: ⚠️ está COLADA no fim de outra linha — não vale e pode ter estragado a linha anterior`;
  return `${nome}=${doEnv(nome)}`;
}

let puppeteer;
try { puppeteer = require(require.resolve('puppeteer', { paths: [CHATBOT] })); }
catch (e) { console.log(`Não achei o puppeteer da SoFIA em ${CHATBOT}/node_modules. Confira a pasta: node diagnostico-whatsapp.js /root/SF-Chat_Experimental-Mensagens`); process.exit(1); }

const CHROMIUM = process.env.DIAG_CHROMIUM || doEnv('CHROMIUM_PATH') || undefined;

async function rodada(nome, usarUaSofia) {
  console.log('');
  dizer(`── Rodada: ${nome} ──`);
  const perfil = fs.mkdtempSync(path.join(os.homedir(), 'diag-whatsapp-perfil-'));
  const erros = [], falhas = new Map();
  let browser = null, resultado = 'não chegou no QR', ultimo = '';
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROMIUM,
      userDataDir: perfil,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
    });
    const page = (await browser.pages())[0] || await browser.newPage();
    const uaReal = await browser.userAgent();
    dizer(`navegador do servidor: ${await browser.version()}`);
    if (usarUaSofia) await page.setUserAgent(UA_SOFIA);
    dizer(`identificação enviada ao WhatsApp: ${usarUaSofia ? UA_SOFIA : uaReal}`);

    page.on('pageerror', (e) => { if (erros.length < 30) erros.push('erro na página: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200)); });
    page.on('console', (m) => { if (m.type() === 'error' && erros.length < 30) erros.push('console: ' + m.text().split('\n')[0].slice(0, 200)); });
    const anotarFalha = (url, motivo) => {
      let host = url; try { host = new URL(url).host; } catch (_) {}
      const k = host + ' → ' + motivo; falhas.set(k, (falhas.get(k) || 0) + 1);
    };
    page.on('requestfailed', (r) => anotarFalha(r.url(), (r.failure() && r.failure().errorText) || 'falhou'));
    page.on('response', (r) => { if (r.status() >= 400) anotarFalha(r.url(), 'HTTP ' + r.status()); });

    const t0 = Date.now();
    await page.goto(URL_WA, { waitUntil: 'load', timeout: 120000, referer: 'https://whatsapp.com/' });
    dizer(`página carregou em ${((Date.now() - t0) / 1000).toFixed(1)} s — acompanhando por até ${Math.round(ESPERA_MS / 1000)} s`);

    const inicio = Date.now();
    while (Date.now() - inicio < ESPERA_MS) {
      const s = await Promise.race([
        page.evaluate(() => {
          const w = window, r = { versao: '', socket: '', erroModulo: '', titulo: document.title || '', texto: '', canvas: !!document.querySelector('canvas') };
          try { r.versao = String((w.Debug && w.Debug.VERSION) || ''); } catch (_) {}
          if (typeof w.require !== 'function') r.erroModulo = 'sistema de módulos do WhatsApp ainda não existe';
          else {
            try { const m = w.require('WAWebSocketModel'); r.socket = String((m && m.Socket && m.Socket.state) || '(sem estado)'); }
            catch (e) { r.erroModulo = String((e && e.message) || e).slice(0, 160); }
          }
          try { r.texto = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220); } catch (_) {}
          return r;
        }).catch((e) => ({ falhaLeitura: String((e && e.message) || e).slice(0, 120) })),
        new Promise((r) => setTimeout(() => r({ falhaLeitura: 'página sem resposta em 10 s' }), 10000)),
      ]);
      const linha = s.falhaLeitura ? `não consegui ler a página (${s.falhaLeitura})`
        : `versão: ${s.versao || '—'} · conexão: ${s.socket || '?'}${s.erroModulo ? ' (' + s.erroModulo + ')' : ''} · QR na tela: ${s.canvas ? 'sim' : 'não'} · tela: "${s.texto || s.titulo || '(vazia)'}"`;
      if (linha !== ultimo) { dizer(linha); ultimo = linha; }
      if (/^UNPAIRED/.test(s.socket || '') || s.socket === 'CONNECTED') { resultado = 'CHEGOU no ponto do QR ✅'; break; }
      await new Promise((r) => setTimeout(r, 5000));
    }
    try {
      const png = path.join(os.homedir(), `diagnostico-whatsapp-${usarUaSofia ? 'sofia' : 'navegador'}.png`);
      await page.screenshot({ path: png });
      dizer(`foto da tela salva em ${png}`);
    } catch (_) {}
  } catch (e) {
    resultado = 'deu erro: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200);
  } finally {
    try { if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]); } catch (_) {}
    try { const p = browser && browser.process && browser.process(); if (p && p.exitCode == null) p.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (_) {}
  }
  dizer(`resultado: ${resultado}`);
  if (erros.length) { dizer(`erros da página (${erros.length}, primeiros 8):`); for (const x of erros.slice(0, 8)) console.log('   • ' + x); }
  else dizer('a página não registrou erros.');
  if (falhas.size) { dizer('pedidos que falharam:'); for (const [k, n] of [...falhas].slice(0, 10)) console.log(`   • ${k} (${n}x)`); }
  return /CHEGOU/.test(resultado);
}

(async () => {
  dizer(`instalação: ${RAIZ}`);
  dizer(`navegador configurado: ${CHROMIUM || '(o do puppeteer)'}`);
  for (const n of ['SOFIA_AUTH_TIMEOUT_MS', 'SOFIA_BOOT_TIMEOUT_MS', 'WA_WEB_VERSION_FILE', 'WA_WEB_VERSION_URL', 'WA_USER_AGENT']) dizer('.env da SoFIA → ' + conferirLinha(n));
  try { dizer(`whatsapp-web.js da SoFIA: ${require(path.join(CHATBOT, 'node_modules', 'whatsapp-web.js', 'package.json')).version}`); } catch (_) {}
  const ok = await rodada('como a SoFIA abre', true);
  if (!ok) await rodada('com a identificação verdadeira do navegador', false);
  console.log('');
  dizer('fim. Mande todas as linhas acima. (Nenhum QR daqui é para escanear.)');
  process.exit(0);
})();

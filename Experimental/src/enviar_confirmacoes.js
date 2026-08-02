// enviar_confirmacoes.js
// Lê a fila "confirmacoes_outbox.jsonl" (gerada pelo agendamento ZEE->EVO) e envia as
// confirmações de aula experimental pela linha do STUDIO (8550-8065) via WhatsApp Web (Edge/CDP).
//
// DUAS FORMAS DE USAR:
//   A) COLAR NO SEU BOT (recomendado): importe e chame enviarConfirmacoes(page) com a `page`
//      do WhatsApp Web JÁ conectada — reusa sua sessão, sem abrir/matar Edge de novo.
//        const { enviarConfirmacoes } = require('./enviar_confirmacoes');
//        await enviarConfirmacoes(page);
//   B) RODAR SOZINHO: `node enviar_confirmacoes.js` — ele mesmo abre o Edge na porta 9226.
//      (Só use se NÃO houver outro job de WhatsApp rodando ao mesmo tempo, pra não conflitar.)
//
// Idempotência: marca o que já enviou em "<outbox>_enviados.json". Não reescreve a fila
// (evita corrida com o Python que faz append). Em falha, não marca -> tenta no próximo ciclo,
// até um limite de tentativas (registrado em "<outbox>_falhas.json") pra não repetir pra sempre.

const fs = require('fs');

// >>> AJUSTE o caminho da fila conforme sua máquina (ou defina STUDIO_OUTBOX_FILE no ambiente):
const OUTBOX = process.env.STUDIO_OUTBOX_FILE
  || 'C:\\AntiGravity\\Experimental\\src\\agendamento_evo\\confirmacoes_outbox.jsonl';
const SENT_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_enviados.json';
const FAIL_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_falhas.json';
const MAX_TENTATIVAS = 5;   // depois disso, desiste daquele número (evita loop infinito)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lerFila() {
  if (!fs.existsSync(OUTBOX)) return [];
  const registros = [];
  const linhas = fs.readFileSync(OUTBOX, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const linha of linhas) {
    // Tolerância: se dois registros ficaram colados na mesma linha ("}{" sem \n),
    // um JSON.parse direto falha e perderíamos AMBOS. Então separamos "}{" em
    // objetos distintos antes de parsear.
    const pedacos = linha.includes('}{')
      ? linha.replace(/\}\s*\{/g, '}\n{').split('\n')
      : [linha];
    for (const p of pedacos) {
      try { registros.push(JSON.parse(p)); } catch { /* linha inválida — ignora */ }
    }
  }
  return registros;
}
function lerEnviados() {
  try { return new Set(JSON.parse(fs.readFileSync(SENT_DB, 'utf8'))); }
  catch { return new Set(); }
}
function salvarEnviados(set) {
  fs.writeFileSync(SENT_DB, JSON.stringify([...set]), 'utf8');
}
function lerFalhas() {
  try { return JSON.parse(fs.readFileSync(FAIL_DB, 'utf8')) || {}; }
  catch { return {}; }
}
function salvarFalhas(obj) {
  try { fs.writeFileSync(FAIL_DB, JSON.stringify(obj), 'utf8'); } catch {}
}
function chave(row) { return `${row.contactId}|${row.when}|${row.ts}`; }
function normalizar(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (n && !n.startsWith('55')) n = '55' + n;   // garante DDI
  return n;
}

// Espera a conversa ficar pronta APÓS o goto do /send. Retorna:
//   'pronto'   -> a caixa de mensagem está disponível pra enviar
//   'invalido' -> o número não tem WhatsApp (popup de URL inválida)
//   'timeout'  -> não carregou a tempo (WhatsApp lento / tela travada)
// Também clica sozinho na tela de conflito de sessão ("Usar aqui"/"Continuar").
async function esperarConversaPronta(page, timeoutMs = 45000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const estado = await page.evaluate(() => {
      const txt = (document.body.innerText || '').toLowerCase();
      // Popup de número sem WhatsApp
      if (txt.includes('telefone compartilhado por url') ||
          txt.includes('phone number shared via url') ||
          txt.includes('número de telefone inválido') ||
          txt.includes('invalid phone number')) {
        return 'invalido';
      }
      // Tela de conflito de sessão: clica pra reassumir aqui
      const botoes = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const reassumir = botoes.find((b) =>
        /usar aqui|use here|usar nesta janela|continuar|continue/i.test((b.textContent || '').trim()));
      if (reassumir) { reassumir.click(); return 'conflito'; }
      // Caixa de mensagem pronta?
      const box = document.querySelector(
        'div[contenteditable="true"][data-tab], footer div[contenteditable="true"]');
      if (box) return 'pronto';
      return 'carregando';
    });
    if (estado === 'pronto') return 'pronto';
    if (estado === 'invalido') return 'invalido';
    await sleep(1000); // 'conflito'/'carregando' -> espera e reavalia
  }
  return 'timeout';
}

// Envia UMA mensagem usando uma page do WhatsApp Web já aberta/conectada.
async function enviarUma(page, phone, texto) {
  // page ignorado (compat). Envia pelo cliente único (whatsapp-web.js).
  {
    const wa = require('./wa-client');
    await wa.sendTexto(phone, texto);
    return;
  }
  // ── (código antigo via page abaixo fica inacessível) ──
  const number = normalizar(phone);
  await page.goto(
    `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(texto)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );

  const estado = await esperarConversaPronta(page, 45000);
  if (estado === 'invalido') {
    const err = new Error('numero_sem_whatsapp');
    err.code = 'INVALIDO';
    throw err;
  }
  if (estado !== 'pronto') {
    throw new Error('conversa não carregou (WhatsApp lento ou tela de conflito de sessão)');
  }

  // Foca a caixa e garante que o texto está lá (o ?text= já preenche).
  await page.evaluate(() => {
    const box = document.querySelector(
      'div[contenteditable="true"][data-tab], footer div[contenteditable="true"]');
    if (box) box.focus();
  });
  await sleep(600);

  // Envia: 1) tenta o botão por vários seletores (inclui o ícone novo);
  //        2) se não achar, manda Enter (forma mais confiável).
  const clicouBotao = await page.evaluate(() => {
    const seletores = [
      'button[aria-label="Enviar"]', 'button[aria-label="Send"]',
      '[data-testid="send"]',
      'span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]',
      'footer button[data-tab]',
    ];
    for (const s of seletores) {
      const el = document.querySelector(s);
      if (el) { (el.closest('button') || el).click(); return true; }
    }
    return false;
  });
  if (!clicouBotao) {
    await page.keyboard.press('Enter');
  }
  await sleep(3500); // espera a mensagem sair
}

// Conta quantas confirmações estão pendentes (SEM conectar no WhatsApp).
// Usado pelo scheduler pra só abrir o WhatsApp quando há algo a enviar.
// (Ignora as que já foram enviadas e as que estouraram o limite de tentativas.)
function contarPendentes() {
  const enviados = lerEnviados();
  const falhas = lerFalhas();
  return lerFila().filter((r) => {
    const k = chave(r);
    return !enviados.has(k) && (falhas[k] || 0) < MAX_TENTATIVAS;
  }).length;
}

// >>> Função pra COLAR no seu bot (reusa a page já conectada) <<<
async function enviarConfirmacoes(page) {
  const enviados = lerEnviados();
  const falhas = lerFalhas();
  const pendentes = lerFila().filter((r) => {
    const k = chave(r);
    return !enviados.has(k) && (falhas[k] || 0) < MAX_TENTATIVAS;
  });
  console.log(`[confirmacoes] ${pendentes.length} pendente(s)`);
  for (const row of pendentes) {
    const k = chave(row);
    try {
      await enviarUma(page, row.phone, row.message);
      enviados.add(k);
      salvarEnviados(enviados);
      if (falhas[k]) { delete falhas[k]; salvarFalhas(falhas); }
      console.log(`[confirmacoes] enviada para ${row.name} (${row.phone})`);
      await sleep(10000 + Math.floor(Math.random() * 2000)); // 10-12s entre mensagens
    } catch (e) {
      falhas[k] = (falhas[k] || 0) + 1;
      salvarFalhas(falhas);
      const restam = MAX_TENTATIVAS - falhas[k];
      if (e.code === 'INVALIDO') {
        // Número sem WhatsApp: não adianta re-tentar — desiste já.
        falhas[k] = MAX_TENTATIVAS;
        salvarFalhas(falhas);
        console.error(`[confirmacoes] ${row.phone} (${row.name}) parece não ter WhatsApp — desistindo.`);
      } else if (restam <= 0) {
        console.error(`[confirmacoes] falha ${row.phone} (${row.name}): ${e.message} — ` +
          `atingiu ${MAX_TENTATIVAS} tentativas, desistindo.`);
      } else {
        console.error(`[confirmacoes] falha ${row.phone} (${row.name}): ${e.message} — ` +
          `re-tenta depois (restam ${restam}).`);
      }
    }
  }
}

module.exports = { enviarConfirmacoes, enviarUma, contarPendentes };

// ---- Modo standalone (abre o próprio Edge na porta 9226, igual seus outros jobs) ----
if (require.main === module) {
  (async () => {
    const { execSync, spawn } = require('child_process');
    const puppeteer = require('puppeteer-extra');
    puppeteer.use(require('puppeteer-extra-plugin-stealth')());

    const EDGE = process.env.EDGE_PATH
      || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    try { execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' }); } catch {}
    spawn(EDGE, [
      '--remote-debugging-port=9226',
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      '--user-data-dir=C:\\SlimfitBot\\edge-wa',
      '--profile-directory=Default',
      '--no-first-run', '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' });
    await sleep(4000);

    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9226', defaultViewport: null });
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await enviarConfirmacoes(page);
    await browser.disconnect();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

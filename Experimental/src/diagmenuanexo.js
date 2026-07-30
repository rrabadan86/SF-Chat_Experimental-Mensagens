// diag-menu-anexo.js
// DIAGNÓSTICO do menu de anexo do WhatsApp Web (para consertar o envio de áudio).
// Abre o Edge do bot (porta 9226), abre uma conversa de teste, clica no "+" e
// DESPEJA a estrutura do menu (itens, data-icon, data-testid, e a "árvore" do
// item Áudio). Não envia nada — só abre o menu e lê o DOM.
//
// USO (na pasta src):
//   node diag-menu-anexo.js               (usa o número de teste padrão)
//   node diag-menu-anexo.js --num=62981718205
//
// Me manda TODA a saída JSON que aparecer.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
puppeteer.use(StealthPlugin());

const CDP_URL = 'http://127.0.0.1:9226';
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const EDGE_PROFILE = 'Default';
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrirEdge() {
  console.log('🔄 Fechando Edge existente...');
  try { execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' }); } catch (e) {}
  await sleep(3000);
  let edgePath = EDGE_PATHS.find((p) => fs.existsSync(p));
  if (!edgePath) throw new Error('Edge não encontrado.');
  spawn(edgePath, [
    '--remote-debugging-port=9226', '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*', `--user-data-dir=${EDGE_USER_DATA}`,
    `--profile-directory=${EDGE_PROFILE}`, '--no-first-run', '--no-default-browser-check',
    'https://web.whatsapp.com',
  ], { detached: true, stdio: 'ignore' }).unref();
  await sleep(6000);
  let browser = null;
  for (let i = 0; i < 5 && !browser; i++) {
    try { browser = await puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null }); }
    catch (e) { await sleep(3000); }
  }
  if (!browser) throw new Error('Não conectou ao Edge.');
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes('web.whatsapp.com')) || await browser.newPage();
  // espera pronto + trata "Usar nesta janela"
  for (let t = 0; t < 30; t++) {
    const pronto = await page.evaluate(() => {
      const alvos = ['usar nesta janela', 'usar aqui', 'use here'];
      for (const el of document.querySelectorAll('button,[role="button"],div,span,a')) {
        if (el.offsetWidth <= 0) continue;
        const x = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (alvos.includes(x)) { (el.closest('button,[role="button"]') || el).click(); return false; }
      }
      return !!(document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]'));
    }).catch(() => false);
    if (pronto) break;
    await sleep(2000);
  }
  return { browser, page };
}

async function main() {
  const argNum = (process.argv.find((a) => a.startsWith('--num=')) || '').split('=')[1];
  let num = (argNum || '62981718205').replace(/\D/g, '');
  if (!num.startsWith('55')) num = '55' + num;

  const { browser, page } = await abrirEdge();
  console.log('✅ WhatsApp pronto. Abrindo conversa de teste...');
  await page.goto(`https://web.whatsapp.com/send?phone=${num}&text=diagnostico`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(4000);

  // clica no botão "+" de anexo
  const clicou = await page.evaluate(() => {
    const sels = ['[data-icon="plus-rounded"]', '[data-icon="plus"]', '[data-icon="clip"]',
      '[data-testid="attach-menu-plus"]', '[aria-label="Anexar"]', '[title="Anexar"]'];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0) { (el.closest('button,[role="button"]') || el).click(); return sel; }
    }
    return null;
  });
  console.log('📎 Botão de anexo clicado via:', clicou);
  await sleep(2500);

  // despeja a estrutura do menu
  const dump = await page.evaluate(() => {
    const vis = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;
    const info = { attachButtons: [], menuItems: [], fileInputs: [], audioAncestry: null };

    for (const sel of ['[data-icon="plus-rounded"]', '[data-icon="plus"]', '[data-icon="clip"]',
      '[data-testid="attach-menu-plus"]', '[aria-label="Anexar"]', '[title="Anexar"]']) {
      const el = document.querySelector(sel);
      if (el) info.attachButtons.push({ sel, visible: vis(el) });
    }

    const seen = new Set();
    for (const el of document.querySelectorAll('li,[role="menuitem"],[role="button"],div,span,button')) {
      if (!vis(el)) continue;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 25) continue;
      if (!/fotos|v[ií]deo|documento|[áa]udio|contato|enquete|figurinha|c[âa]mera|evento/i.test(t)) continue;
      const key = t + '|' + el.tagName;
      if (seen.has(key)) continue; seen.add(key);
      info.menuItems.push({
        text: t, tag: el.tagName, role: el.getAttribute('role'),
        dataIcon: el.getAttribute('data-icon'), dataTestid: el.getAttribute('data-testid'),
        ariaLabel: el.getAttribute('aria-label'), cls: (el.className || '').toString().slice(0, 70),
      });
    }

    let audioEl = null;
    for (const el of document.querySelectorAll('div,span,li,button')) {
      if (!vis(el)) continue;
      if (/^(áudio|audio)$/i.test((el.textContent || '').trim())) { audioEl = el; break; }
    }
    if (audioEl) {
      const chain = [];
      let n = audioEl;
      for (let i = 0; i < 7 && n; i++) {
        chain.push({
          tag: n.tagName, role: n.getAttribute && n.getAttribute('role'),
          dataIcon: n.getAttribute && n.getAttribute('data-icon'),
          dataTestid: n.getAttribute && n.getAttribute('data-testid'),
          cls: (n.className || '').toString().slice(0, 90),
        });
        n = n.parentElement;
      }
      info.audioAncestry = chain;
    }

    for (const i of document.querySelectorAll('input[type=file]')) {
      info.fileInputs.push({ accept: i.getAttribute('accept'), visible: i.offsetParent !== null });
    }
    return info;
  });

  console.log('\n================= ESTRUTURA DO MENU DE ANEXO =================');
  console.log(JSON.stringify(dump, null, 2));
  console.log('=============================================================');
  console.log('\n>> Me manda TUDO isso. Com a "audioAncestry" e os data-icon/');
  console.log('>> data-testid dos itens, eu escrevo o seletor certo do "Áudio".');

  try { browser.disconnect(); } catch (e) {}
}

main().catch((e) => { console.error('❌ Erro:', e.message); process.exit(1); });

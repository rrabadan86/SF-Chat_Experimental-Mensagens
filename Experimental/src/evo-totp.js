// evo-totp.js — 2FA (autenticação em duas etapas) do EVO no login automático do robô.
//
// A partir de 30/10/2026 o EVO exige 2FA no login. Duas frentes, nesta ordem:
//
//   PLANO A (principal, automático) — AUTENTICADOR/TOTP: guardamos o SEGREDO que o
//   EVO mostra no cadastro (a "chave" atrás do QR) em EVO_TOTP_SECRET e geramos aqui
//   o MESMO código de 6 dígitos que o Google/Microsoft Authenticator geraria — offline,
//   sem depender de e-mail. Resolve TUDO sozinho, inclusive os jobs de madrugada.
//
//   PLANO B (rede de segurança, humano) — CÓDIGO PELO PAINEL: se o EVO cair na tela
//   de "código por E-MAIL" (acontece, ex.: "dispositivo novo/suspeito"), ou se ainda
//   não há TOTP configurado, o robô NÃO chuta um código errado. Ele: (1) avisa no
//   celular (ntfy), (2) grava um "pedido" que o painel mostra em WhatsApp →
//   Configuração, e (3) fica esperando alguém digitar o código lá. Assim que o código
//   chega (por um arquivo compartilhado), o robô digita e segue o login.
//
// SEGURO POR PADRÃO: sem EVO_TOTP_SECRET e sem EVO_2FA_PAINEL=true, TUDO aqui é no-op
// (retorno instantâneo) — as unidades que ainda não têm MFA continuam funcionando igual.
//
// .env (por unidade, NUNCA no Git):
//   EVO_TOTP_SECRET=BASE32DACHAVE   ← o texto atrás do QR (via app 2FAS/Aegis) [PLANO A]
//   EVO_2FA_PAINEL=true             ← liga o PLANO B mesmo sem TOTP (padrão: ligado se houver TOTP)
//   EVO_2FA_ESPERA_MS=240000        ← quanto o robô espera o código do painel (padrão 4 min)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Arquivos de "aperto de mão" (handshake) entre o ROBÔ e o PAINEL. Ficam na pasta
// data/ do Experimental (compartilhada pelos dois processos, fora do Git).
const DADOS_DIR = path.resolve(__dirname, '..', 'data');
const PEDIDO_FILE = path.join(DADOS_DIR, 'evo-2fa-pedido.json'); // robô -> painel: "preciso de um código"
const CODIGO_FILE = path.join(DADOS_DIR, 'evo-2fa-codigo.json'); // painel -> robô: "aqui está o código"

// Decodifica base32 (RFC 4648) — o formato do segredo TOTP.
function base32Decode(s) {
  const alf = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const limpo = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of limpo) bits += alf.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// Código TOTP (RFC 6238): HMAC-SHA1, janela de 30s, 6 dígitos. Igual ao do app.
function gerarTOTP(secret, ts = Date.now()) {
  const key = base32Decode(secret);
  if (!key.length) return '';
  let contador = Math.floor(ts / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = contador & 0xff; contador = Math.floor(contador / 256); }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Procura o campo "Código *" da tela de 2FA. Seletores prováveis + heurística
// por placeholder/aria contendo "código" (o e-mail do login é input#usuario, a
// senha input#senha — aqui é outro campo). Devolve o seletor achado ou null.
async function acharCampoCodigo(page, timeoutMs) {
  const seletores = [
    'input#codigo', 'input[name="codigo"]', 'input[formcontrolname="codigo"]',
    'input[name*="codig" i]', 'input[formcontrolname*="codig" i]',
    'input[placeholder*="ódig" i]', 'input[aria-label*="ódig" i]',
  ];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const sel of seletores) {
      try {
        const el = await page.$(sel);
        if (el && (await el.boundingBox())) return sel; // existe e está visível
      } catch (_) { /* seletor :i pode não ser suportado em versão antiga — ignora */ }
    }
    await espera(300);
  }
  return null;
}

// A tela de "código por e-mail" e a do "código do autenticador" têm o MESMO campo
// "Código". Só o TOTP o robô gera sozinho. Detecta a tela de E-MAIL pelo texto.
async function pareceEmail(page) {
  try {
    return await page.evaluate(() =>
      /enviad[oa] (para|ao) .*e-?mail|verifique .*e-?mail|c[oó]digo .*e-?mail/i.test(document.body.innerText || ''));
  } catch (_) { return false; }
}

// Digita o código no campo e clica em ENTRAR/CONFIRMAR/VALIDAR/ACESSAR.
async function digitarEConfirmar(page, sel, codigo) {
  await page.click(sel, { clickCount: 3 });
  await page.type(sel, codigo, { delay: 60 });
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim().toUpperCase();
      if (t.includes('ENTRAR') || t.includes('CONFIRMAR') || t.includes('VALIDAR') || t.includes('ACESSAR')) { b.click(); return; }
    }
    const p = document.querySelector('button[type="submit"], button.primary'); if (p) p.click();
  });
  await espera(1800);
}

// ── Handshake com o painel (arquivos em data/) ──────────────────────────────
function limparHandshake() {
  for (const f of [PEDIDO_FILE, CODIGO_FILE]) { try { fs.unlinkSync(f); } catch (_) {} }
}
function escreverPedido(motivo, esperaMs) {
  try {
    fs.mkdirSync(DADOS_DIR, { recursive: true });
    fs.writeFileSync(PEDIDO_FILE, JSON.stringify({
      pedidoEm: Date.now(), expiraEm: Date.now() + esperaMs, motivo: motivo || 'email',
      unidade: process.env.STUDIO_NOME || '',
    }), 'utf8');
  } catch (_) {}
}
// Lê o código que o painel gravou (só dígitos, 4–8). Devolve '' se ainda não veio.
function lerCodigoDigitado() {
  try {
    const o = JSON.parse(fs.readFileSync(CODIGO_FILE, 'utf8'));
    const c = String(o.codigo || '').replace(/\D/g, '');
    if (c.length >= 4 && c.length <= 8) return c;
  } catch (_) {}
  return '';
}

// PLANO B — pede o código a um humano pelo painel e espera. Best-effort: se
// ninguém digitar dentro de esperaMs, desiste (o login segue e provavelmente
// falha — mas o alerta já foi para o celular).
async function aguardarCodigoHumano(page, sel, { esperaMs = 240000, motivo = 'email' } = {}) {
  limparHandshake();                 // começa limpo (nada de código velho)
  escreverPedido(motivo, esperaMs);  // o painel passa a mostrar o campo aceso
  const min = Math.max(1, Math.round(esperaMs / 60000));
  const comoChegou = motivo === 'email'
    ? 'O EVO enviou o código por E-MAIL do usuário do robô.'
    : 'O EVO pediu um código de verificação.';
  console.log(`   🔐 2FA por código: ${comoChegou} Aguardando alguém digitar no painel (WhatsApp → Configuração) por até ${min} min…`);
  try {
    const notif = require('./notificar');
    await notif.alertar('EVO pediu código (2FA)',
      `${comoChegou}\nAbra o painel em WhatsApp → Configuração e digite o código no campo "Código do EVO (2FA)".`,
      { prioridade: 'urgent', tags: 'closed_lock_with_key', forcar: true });
  } catch (_) {}

  const t0 = Date.now();
  while (Date.now() - t0 < esperaMs) {
    const codigo = lerCodigoDigitado();
    if (codigo) {
      console.log('   🔐 Código recebido do painel — digitando no EVO…');
      try {
        await digitarEConfirmar(page, sel, codigo);
        limparHandshake();
        console.log('   ✅ Código do 2FA preenchido (via painel).');
        return true;
      } catch (e) {
        console.log('   ⚠️  Falha ao preencher o código do painel:', e.message);
        limparHandshake();
        return false;
      }
    }
    await espera(2500);
  }
  console.log('   ⏱️  Ninguém digitou o código no painel a tempo — seguindo (o login pode falhar).');
  limparHandshake();
  return false;
}

// Chame LOGO APÓS clicar em ENTRAR no login. Resolve o 2FA se ele aparecer:
//   • autenticador (TOTP) + EVO_TOTP_SECRET → digita o código gerado (automático);
//   • e-mail, ou sem TOTP, ou TOTP recusado → pede o código pelo painel (plano B).
// Seguro: sem MFA configurado (sem segredo e sem EVO_2FA_PAINEL), é no-op imediato.
async function preencher2FA(page, { timeoutMs = 8000, permitirPainel, esperaPainelMs } = {}) {
  const secret = process.env.EVO_TOTP_SECRET || '';
  const painelLigado = /^(1|true|sim)$/i.test(process.env.EVO_2FA_PAINEL || '');
  // Unidade sem NENHUM MFA configurado → não perde tempo procurando a tela.
  if (!secret && !painelLigado) return false;

  const sel = await acharCampoCodigo(page, timeoutMs);
  if (!sel) return false; // 2FA não pediu (dispositivo confiável) — segue normal

  if (permitirPainel === undefined) permitirPainel = painelLigado || !!secret;
  if (!esperaPainelMs) esperaPainelMs = parseInt(process.env.EVO_2FA_ESPERA_MS || '240000', 10) || 240000;

  const ehEmail = await pareceEmail(page);

  // PLANO A — autenticador (TOTP). Só quando há segredo E não é a tela de e-mail.
  if (secret && !ehEmail) {
    const codigo = gerarTOTP(secret);
    if (codigo) {
      console.log('   🔐 2FA do EVO detectado — digitando o código do autenticador…');
      try {
        await digitarEConfirmar(page, sel, codigo);
        console.log('   ✅ 2FA preenchido (autenticador).');
        return true;
      } catch (e) {
        console.log('   ⚠️  Falha ao preencher o 2FA do autenticador:', e.message, '— tentando pelo painel.');
      }
    } else {
      console.log('   ⚠️  EVO_TOTP_SECRET inválido — tentando pelo painel.');
    }
  }

  // PLANO B — e-mail, ou sem TOTP, ou o autenticador acima falhou.
  if (permitirPainel) {
    return await aguardarCodigoHumano(page, sel, { esperaMs: esperaPainelMs, motivo: ehEmail ? 'email' : 'codigo' });
  }
  console.log('   ⚠️  O EVO pediu código por e-mail e o plano B (painel) está desligado neste contexto. Login pode falhar.');
  return false;
}

module.exports = { gerarTOTP, preencher2FA, PEDIDO_FILE, CODIGO_FILE, limparHandshake };

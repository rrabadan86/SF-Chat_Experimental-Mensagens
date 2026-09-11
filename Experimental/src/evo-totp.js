// evo-totp.js — 2FA (autenticador/TOTP) do EVO para o login automático do robô.
//
// A partir de 30/10/2026 o EVO exige autenticação em duas etapas (MFA) no login.
// A forma robusta para um robô é o AUTENTICADOR (TOTP): guardamos o SEGREDO que
// o EVO mostra no cadastro (a "chave" atrás do QR) e geramos aqui o MESMO código
// de 6 dígitos que o Google/Microsoft Authenticator geraria — offline, sem
// depender de e-mail. Este módulo gera o código e o digita quando a tela de 2FA
// aparece após o login.
//
// SEGURO POR PADRÃO: sem EVO_TOTP_SECRET no .env, TUDO aqui é no-op — as unidades
// que ainda não têm MFA continuam funcionando igual.
//
// .env (por unidade, NUNCA no Git):
//   EVO_TOTP_SECRET=BASE32DACHAVE   ← o texto atrás do QR (via app 2FAS/Aegis)

const crypto = require('crypto');

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

// Chame LOGO APÓS clicar em ENTRAR no login. Se a tela de 2FA aparecer e houver
// EVO_TOTP_SECRET, digita o código do autenticador e confirma. Best-effort e
// seguro: sem segredo, ou sem o campo, retorna false e não faz nada.
async function preencher2FA(page, { timeoutMs = 8000 } = {}) {
  const secret = process.env.EVO_TOTP_SECRET || '';
  if (!secret) return false;                              // sem MFA configurado -> no-op
  const sel = await acharCampoCodigo(page, timeoutMs);
  if (!sel) return false;                                 // 2FA não pediu (dispositivo confiável)
  // As telas de "código por e-mail" e "código do autenticador" têm o MESMO campo
  // "Código". Só o TOTP (autenticador) o robô gera. Se o EVO caiu na tela de
  // E-MAIL, NÃO digitamos um código errado: avisamos claramente. (Ler o e-mail é
  // o plano B — só entra se você configurar o e-mail dedicado do robô.)
  let ehEmail = false;
  try {
    ehEmail = await page.evaluate(() =>
      /enviad[oa] (para|ao) .*e-?mail|verifique .*e-?mail|c[oó]digo .*e-?mail/i.test(document.body.innerText || ''));
  } catch (_) {}
  if (ehEmail) {
    console.log('   ⚠️  O EVO pediu o código por E-MAIL (não pelo autenticador). O robô só gera o código do AUTENTICADOR (TOTP). Confira se o MFA do usuário do robô está no modo autenticador. (Ler e-mail é plano B, não ativo.)');
    return false;
  }
  const codigo = gerarTOTP(secret);
  if (!codigo) { console.log('   ⚠️  EVO_TOTP_SECRET inválido — não gerei o código do 2FA.'); return false; }
  console.log('   🔐 2FA do EVO detectado — digitando o código do autenticador…');
  try {
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
    console.log('   ✅ 2FA preenchido.');
    return true;
  } catch (e) {
    console.log('   ⚠️  Falha ao preencher o 2FA:', e.message);
    return false;
  }
}

module.exports = { gerarTOTP, preencher2FA };

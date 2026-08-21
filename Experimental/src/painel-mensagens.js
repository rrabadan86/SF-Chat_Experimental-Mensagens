/**
 * Painel web para editar os textos das mensagens (sem mexer no código).
 *
 * • Roda no próprio servidor (VPS), sob o PM2, na porta PAINEL_PORT (padrão 8080).
 * • Protegido por usuário e senha (Basic Auth), definidos no .env:
 *      PAINEL_USER=...        PAINEL_SENHA=...
 * • Grava as edições em data/mensagens.json; o robô lê esse arquivo na hora do
 *   envio, então a mudança vale no próximo disparo (sem reiniciar).
 *
 * ⚠️ Basic Auth manda a senha só codificada (não criptografada). Exponha este
 *    painel SEMPRE atrás de HTTPS (ex.: Caddy + subdomínio). Ver o runbook.
 *
 * Uso:  node src/painel-mensagens.js        (ou sob o PM2 — ver instruções)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const http = require('http');
const crypto = require('crypto');
const mensagens = require('./mensagens');

const PORT = parseInt(process.env.PAINEL_PORT || '8080', 10);
// Por padrão escuta SÓ no localhost da VPS: o acesso vem pelo HTTPS do Caddy
// (reverse_proxy localhost:8080) ou por um túnel SSH — nunca direto da internet.
// Para expor em todas as interfaces (não recomendado), defina PAINEL_HOST=0.0.0.0.
const HOST = process.env.PAINEL_HOST || '127.0.0.1';
const USER = process.env.PAINEL_USER || 'admin';
const SENHA = process.env.PAINEL_SENHA || '';

// Comparação de credenciais em tempo constante (evita timing attack).
function seguraIgual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function autorizado(req) {
  if (!SENHA) return false; // sem senha configurada → nega tudo
  const h = req.headers.authorization || '';
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  let dec = '';
  try { dec = Buffer.from(m[1], 'base64').toString('utf8'); } catch (_) { return false; }
  const i = dec.indexOf(':');
  const u = dec.slice(0, i); const p = dec.slice(i + 1);
  return seguraIgual(u, USER) && seguraIgual(p, SENHA);
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function paginaHtml(aviso) {
  const itens = mensagens.listar().map(m => {
    const vars = (m.vars || []).map(([t, d]) =>
      `<span class="var" title="${esc(d)}">{${esc(t)}}</span>`).join(' ');
    const badge = m.editado ? '<span class="badge">editada</span>' : '';
    return `
    <form class="card" method="POST" action="/salvar">
      <input type="hidden" name="chave" value="${esc(m.chave)}">
      <div class="chead"><h2>${esc(m.titulo)} ${badge}</h2></div>
      <p class="quando">${esc(m.quando)}</p>
      ${vars ? `<p class="vars">Variáveis: ${vars} <small>(são trocadas automaticamente no envio — mantenha-as no texto)</small></p>` : ''}
      <textarea name="texto" rows="7" spellcheck="true">${esc(m.texto)}</textarea>
      <div class="acts">
        <button type="submit" class="save">Salvar</button>
        <button type="submit" name="reset" value="1" class="reset"
          onclick="return confirm('Voltar esta mensagem ao texto padrão?')">Restaurar padrão</button>
      </div>
    </form>`;
  }).join('\n');

  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Editar mensagens · SlimFit</title>
<style>
  :root{--teal:#11abae;--coral:#ff5b57;--tinta:#2d2a2f;--cinza:#6e6e70;--bg:#f6f7f8;--card:#fff;--linha:#e6e6e6}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--tinta);line-height:1.5}
  header{background:var(--teal);color:#fff;padding:20px 16px}
  .wrap{max-width:820px;margin:0 auto;padding:16px}
  header .wrap{padding:0 16px}
  header h1{margin:0;font-size:1.3rem}
  header p{margin:4px 0 0;opacity:.9;font-size:.9rem}
  .aviso{background:#e6f6f7;border:1px solid #bfe8e7;color:#0c6f70;border-radius:10px;padding:11px 14px;margin:16px 0}
  .card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:16px 18px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.04)}
  .chead{display:flex;align-items:center;gap:10px}
  h2{font-size:1.05rem;margin:0}
  .badge{background:#fff0ef;color:#c23b38;border:1px solid #f6cfcd;border-radius:999px;font-size:.7rem;font-weight:700;padding:2px 9px}
  .quando{color:var(--cinza);font-size:.85rem;margin:6px 0 8px}
  .vars{font-size:.82rem;color:var(--cinza);margin:0 0 8px}
  .vars small{opacity:.8}
  .var{display:inline-block;background:#eef7f7;color:#0c6f70;border:1px solid #cdeaea;border-radius:6px;padding:1px 6px;font-family:ui-monospace,monospace;font-size:.82rem}
  textarea{width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:11px 12px;font-size:.95rem;font-family:inherit;line-height:1.5;resize:vertical}
  textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(17,171,174,.15)}
  .acts{display:flex;gap:10px;margin-top:10px}
  button{border:none;border-radius:999px;padding:10px 18px;font-size:.92rem;font-weight:700;cursor:pointer;font-family:inherit}
  .save{background:var(--coral);color:#fff}
  .reset{background:#fff;color:var(--cinza);border:1px solid #dcdcdc}
  footer{color:var(--cinza);font-size:.8rem;text-align:center;padding:20px}
</style></head><body>
<header><div class="wrap"><h1>✏️ Editar mensagens do robô</h1>
  <p>Altere o texto e clique em <b>Salvar</b>. Vale já no próximo envio — sem reiniciar.</p></div></header>
<div class="wrap">
  ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
  ${itens}
</div>
<footer>SlimFit · painel de mensagens · as variáveis entre chaves são preenchidas automaticamente no envio.</footer>
</body></html>`;
}

function pedirLogin(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Painel de mensagens SlimFit", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Acesso restrito.');
}

const server = http.createServer((req, res) => {
  if (!autorizado(req)) return pedirLogin(res);

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const aviso = /(?:\?|&)ok=(\d+)/.test(req.url)
      ? 'Mensagem salva! Já vale no próximo envio.' : '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaHtml(aviso));
  }

  if (req.method === 'POST' && req.url === '/salvar') {
    let corpo = '';
    req.on('data', c => { corpo += c; if (corpo.length > 1e6) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(corpo);
      const chave = p.get('chave');
      try {
        if (p.get('reset')) mensagens.salvarOverride(chave, ''); // vazio → volta ao padrão
        else mensagens.salvarOverride(chave, p.get('texto') || '');
        res.writeHead(303, { Location: '/?ok=1' });
        res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaHtml('Erro ao salvar: ' + esc(e.message)));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
});

server.listen(PORT, HOST, () => {
  if (!SENHA) {
    console.warn('⚠️  PAINEL_SENHA não definido no .env — o painel vai NEGAR todo acesso até você definir usuário e senha.');
  }
  console.log(`✏️  Painel de mensagens ouvindo em ${HOST}:${PORT} (usuário: ${USER}).`);
  console.log('   Exponha SEMPRE atrás de HTTPS (ex.: Caddy). Nunca direto na internet sem TLS.');
});

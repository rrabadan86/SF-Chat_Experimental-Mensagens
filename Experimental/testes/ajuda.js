/**
 * Ajuda dos testes: monta um AMBIENTE ISOLADO numa pasta temporária — cópia do
 * Experimental/src, pasta data/ vazia e pasta da SoFIA própria — para que nenhum
 * teste leia ou grave os dados de verdade (Experimental/data, /root/sofia-data).
 *
 *   const amb = ambienteIsolado();
 *   amb.gravarData('contatos.json', {...});
 *   const wa = amb.whatsappFalso();            // nada sai de verdade
 *   const r = amb.req('retomada-sofia');
 *   ...
 *   amb.limpar();
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');

function ambienteIsolado() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teste-'));
  const exp = path.join(raiz, 'Experimental');
  const fora = new Set(['agendamento_evo', 'demo-assets']);
  fs.cpSync(SRC, path.join(exp, 'src'), { recursive: true, filter: (s) => !fora.has(path.basename(s)) || path.dirname(s) !== SRC });
  fs.mkdirSync(path.join(exp, 'data'), { recursive: true });
  if (fs.existsSync(NODE_MODULES)) fs.symlinkSync(NODE_MODULES, path.join(exp, 'node_modules'), 'dir');
  const sofia = path.join(raiz, 'sofia');
  fs.mkdirSync(sofia, { recursive: true });
  process.env.SOFIA_DIR = sofia;
  delete process.env.PAINEL_DEMO;

  const amb = {
    raiz, exp, sofia,
    data: path.join(exp, 'data'),
    arq: (m) => path.join(exp, 'src', m.endsWith('.js') ? m : m + '.js'),
    req: (m) => require(amb.arq(m)),
    gravarData: (nome, obj) => fs.writeFileSync(path.join(amb.data, nome), typeof obj === 'string' ? obj : JSON.stringify(obj)),
    lerData: (nome) => { try { return JSON.parse(fs.readFileSync(path.join(amb.data, nome), 'utf8')); } catch (_) { return null; } },
    gravarSofia: (nome, obj) => fs.writeFileSync(path.join(sofia, nome), typeof obj === 'string' ? obj : JSON.stringify(obj)),
    // WhatsApp do Studio de mentira: registra os envios; o comportamento da leitura
    // da conversa é definido pelo teste (padrão: ninguém respondeu).
    whatsappFalso(opcoes = {}) {
      const wa = {
        enviados: [], leituras: 0,
        conferir: opcoes.conferir || (async () => ({ respondeu: false, reagiu: false, humano: false, lidas: 1 })),
        async conferirResposta(tel, desde) { wa.leituras++; return wa.conferir(tel, desde, wa.leituras); },
        async sendTexto(tel, texto, contexto, chave) { wa.enviados.push({ tel, texto, contexto, chave }); return true; },
        async sendGrupo(grupo, texto, contexto) { wa.enviados.push({ grupo, texto, contexto }); return true; },
      };
      require.cache[amb.arq('wa-client')] = { id: amb.arq('wa-client'), filename: amb.arq('wa-client'), loaded: true, exports: wa };
      return wa;
    },
    limpar: () => { try { fs.rmSync(raiz, { recursive: true, force: true }); } catch (_) {} },
  };
  return amb;
}

// Os jobs esperam ~8 s entre um envio e outro (segurança do número). Nos testes,
// essas esperas viram imediatas — o resto do tempo (prazos do job) não muda.
function semEsperas() {
  const orig = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => orig(fn, ms >= 1000 && ms <= 15000 ? 0 : ms, ...a);
  return () => { global.setTimeout = orig; };
}

const HORA = 3600e3, DIA = 24 * HORA;
// Um "aparelho" de mentira para as notificações do painel: par de chaves + segredo
// (o que o navegador entrega ao se inscrever) e a decifragem do RFC 8291 — o lado
// do navegador. Se o painel cifrar errado, abrir() falha.
function aparelhoPush(n) {
  const crypto = require('crypto'), assert = require('node:assert');
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/aparelho-' + n, keys: { p256dh: b64u(ec.getPublicKey()), auth: b64u(auth) } },
    abrir(corpo) {
      const salt = corpo.subarray(0, 16), idlen = corpo[20], as = corpo.subarray(21, 21 + idlen), ct = corpo.subarray(21 + idlen);
      const ikm = Buffer.from(crypto.hkdfSync('sha256', ec.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ec.getPublicKey(), as]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
      const claro = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      assert.strictEqual(claro[claro.length - 1], 2, 'marcador de último registro');
      return JSON.parse(claro.subarray(0, claro.length - 1).toString('utf8'));
    },
  };
}

// Porta para teste que sobe servidor: sorteada numa faixa PRÓPRIA (41000–41999), longe
// das portas que o navegador e o fetch recusam (6000, 6665–6669, 10080…) e das dos
// servidores de verdade; confere que está livre antes de devolver.
const FAIXA_PORTAS = [41000, 41999];
function portaEstaLivre(porta) {
  return new Promise((ok) => { const srv = require('net').createServer(); srv.once('error', () => ok(false)); srv.listen(porta, '127.0.0.1', () => srv.close(() => ok(true))); });
}
async function portaLivre() {
  for (let i = 0; i < 60; i++) {
    const p = FAIXA_PORTAS[0] + Math.floor(Math.random() * (FAIXA_PORTAS[1] - FAIXA_PORTAS[0] + 1));
    if (await portaEstaLivre(p)) return p;
  }
  throw new Error('nenhuma porta livre na faixa dos testes');
}

module.exports = { ambienteIsolado, semEsperas, HORA, DIA, aparelhoPush, portaLivre, FAIXA_PORTAS };

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
module.exports = { ambienteIsolado, semEsperas, HORA, DIA };

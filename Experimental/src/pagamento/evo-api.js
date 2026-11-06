/**
 * pagamento/evo-api.js — acesso à API de integração do EVO (W12) para o módulo
 * de Pagamento dos professores.
 *
 * Autenticação Basic (DNS da academia : Secret Key), as MESMAS variáveis do
 * formulário de agendamento (EVO_BASE_URL, EVO_DNS, EVO_TOKEN no .env).
 *
 * O EVO aceita ~4 requisições/s por chave e o formulário usa a mesma chave, então
 * aqui vamos devagar: no máximo 1 requisição a cada 400 ms (2,5/s), com nova
 * tentativa em 429/5xx e em conexão derrubada pelo balanceador do EVO.
 */
// As credenciais do EVO ficam no .env do agendamento (src/agendamento_evo/.env) —
// o mesmo que a Grade e o envio da grade para o formulário (push_slots) usam. Lê
// também o .env do robô e o ambiente do processo; vale o primeiro valor NÃO vazio
// (o .env do robô costuma ter "EVO_DNS=" em branco, do modelo de instalação).
const pth = require('path'); const fsx = require('fs');
const ARQS_ENV = [pth.resolve(__dirname, '..', 'agendamento_evo', '.env'), pth.resolve(__dirname, '..', '..', '.env')];
function valorEnv(nome) {
  const limpo = (v) => { const x = String(v == null ? '' : v).trim(); return x && !x.startsWith('#') ? x : ''; };
  const doProc = limpo(process.env[nome]); if (doProc) return doProc;
  for (const arq of ARQS_ENV) {
    try { const v = limpo(require('dotenv').parse(fsx.readFileSync(arq))[nome]); if (v) return v; } catch (_) {}
  }
  return '';
}

const BASE = () => (valorEnv('EVO_BASE_URL') || 'https://evo-integracao-api.w12app.com.br').replace(/\/+$/, '');
const INTERVALO_MS = parseInt(process.env.PAGAMENTO_EVO_INTERVALO_MS || '400', 10);

function credenciais() {
  const dns = valorEnv('EVO_DNS'), tok = valorEnv('EVO_TOKEN');
  if (!dns || !tok) throw new Error('não achei a chave da API do EVO (EVO_DNS/EVO_TOKEN) em src/agendamento_evo/.env nem no .env do robô.');
  return 'Basic ' + Buffer.from(`${dns}:${tok}`).toString('base64');
}
function configurado() { try { credenciais(); return true; } catch (_) { return false; } }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let proximo = 0;
async function vez() { // fila simples: cada chamada reserva o próximo "horário" livre
  const agora = Date.now();
  const minha = Math.max(agora, proximo);
  proximo = minha + INTERVALO_MS;
  if (minha > agora) await sleep(minha - agora);
}

async function chamar(endpoint, params = {}) {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))).toString();
  const url = `${BASE()}${endpoint}${q ? '?' + q : ''}`;
  let ultimo;
  for (let t = 1; t <= 4; t++) {
    await vez();
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 45000);
      let res;
      try { res = await fetch(url, { headers: { Authorization: credenciais(), 'Content-Type': 'application/json', Connection: 'close' }, signal: ctl.signal }); }
      finally { clearTimeout(tm); }
      if (res.status === 429 || res.status >= 500) { ultimo = new Error(`EVO ${res.status} em ${endpoint}`); await sleep(1200 * t); continue; }
      const txt = await res.text();
      if (!res.ok) throw Object.assign(new Error(`EVO ${res.status} em ${endpoint}: ${txt.slice(0, 200)}`), { definitivo: true });
      return txt ? JSON.parse(txt) : null;
    } catch (e) {
      if (e && e.definitivo) throw e;
      ultimo = e; await sleep(800 * t);
    }
  }
  throw ultimo || new Error(`EVO: falha em ${endpoint}`);
}

async function paginado(endpoint, params = {}, { take = 50, maxPaginas = 200 } = {}) {
  const out = [];
  for (let p = 0, skip = 0; p < maxPaginas; p++, skip += take) {
    const d = await chamar(endpoint, { ...params, take, skip });
    const pagina = Array.isArray(d) ? d : (d && (d.items || d.data)) || [];
    out.push(...pagina);
    if (pagina.length < take) break;
  }
  return out;
}

module.exports = { chamar, paginado, configurado };

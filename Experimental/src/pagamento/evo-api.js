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
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const BASE = String(process.env.EVO_BASE_URL || 'https://evo-integracao-api.w12app.com.br').trim().replace(/\/+$/, '');
const INTERVALO_MS = parseInt(process.env.PAGAMENTO_EVO_INTERVALO_MS || '400', 10);

function credenciais() {
  const dns = String(process.env.EVO_DNS || '').trim();
  const tok = String(process.env.EVO_TOKEN || '').trim();
  if (!dns || !tok || dns.startsWith('#') || tok.startsWith('#')) throw new Error('EVO_DNS/EVO_TOKEN não configurados no .env do robô.');
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
  const url = `${BASE}${endpoint}${q ? '?' + q : ''}`;
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

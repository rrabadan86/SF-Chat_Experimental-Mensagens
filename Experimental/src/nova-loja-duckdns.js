/**
 * nova-loja-duckdns.js — o endereço da loja nova no DuckDNS (assistente 🏪 Nova loja, NOV-02).
 *
 * O dono tem DUAS contas no DuckDNS (cada conta grátis aceita até 5 endereços). Os tokens
 * ficam no .env deste painel (DUCKDNS_TOKEN_1/2, com um apelido em DUCKDNS_NOME_1/2),
 * gravados por env-arquivo.js e nunca devolvidos para a tela (só "guardado").
 *
 * O DuckDNS não deixa CRIAR endereço pela API: o dono cria em duckdns.org ("add domain")
 * e aqui o painel só aponta o endereço para o IP do servidor novo e confere.
 */
const https = require('https');
const dns = require('dns');
const path = require('path');

const ARQ_ENV = path.resolve(__dirname, '..', '.env');
const CONTAS = [1, 2];
const RX_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RX_IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** → [{ n, nome, guardado }] (nunca o token) */
function contas(env = process.env) {
  return CONTAS.map((n) => ({ n, nome: String(env[`DUCKDNS_NOME_${n}`] || `DuckDNS ${n}`).trim(), guardado: RX_TOKEN.test(String(env[`DUCKDNS_TOKEN_${n}`] || '').trim()) }));
}
function tokenDa(n, env = process.env) {
  const t = String(env[`DUCKDNS_TOKEN_${+n}`] || '').trim();
  return CONTAS.includes(+n) && RX_TOKEN.test(t) ? t : '';
}

/** Salva o apelido e (se veio) o token da conta n. Token vazio = mantém o guardado. */
function salvarConta(n, { nome, token } = {}, { arq = ARQ_ENV, gravar = require('./env-arquivo').gravar } = {}) {
  n = +n;
  if (!CONTAS.includes(n)) throw Object.assign(new Error('Conta inválida.'), { campo: 'conta' });
  const ap = String(nome || '').replace(/[\r\n"'`$\\]/g, '').trim().slice(0, 30) || `DuckDNS ${n}`;
  const tk = String(token || '').trim();
  if (tk && !RX_TOKEN.test(tk)) throw Object.assign(new Error('Esse token não parece do DuckDNS (é o código comprido do topo do duckdns.org, no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).'), { campo: `token${n}` });
  for (const [k, v] of [[`DUCKDNS_NOME_${n}`, ap], ...(tk ? [[`DUCKDNS_TOKEN_${n}`, tk]] : [])]) {
    const r = gravar(k, v, arq);
    if (r && r.ok === false) throw new Error(r.erro || 'Não consegui gravar no .env.');
    process.env[k] = v;
  }
  return contas();
}

/** "painel-marista.duckdns.org" → "painel-marista" ('' se não for do DuckDNS). */
function subdominioDe(dominio) {
  const m = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.duckdns\.org$/i.exec(String(dominio || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** Aponta o endereço para o IP. → 'OK' | 'KO' (KO = token errado ou o endereço não é dessa conta). */
function atualizarIp({ token, subdominio, ip, get = httpsGet }) {
  if (!RX_TOKEN.test(String(token || ''))) return Promise.reject(new Error('Conta do DuckDNS sem token guardado.'));
  if (!/^[a-z0-9-]{1,63}$/.test(String(subdominio || ''))) return Promise.reject(new Error('Endereço do DuckDNS inválido.'));
  if (!RX_IPV4.test(String(ip || ''))) return Promise.reject(new Error('O servidor precisa ser informado pelo IP (ex.: 203.0.113.10) para apontar o endereço.'));
  const u = `https://www.duckdns.org/update?domains=${encodeURIComponent(subdominio)}&token=${encodeURIComponent(token)}&ip=${encodeURIComponent(ip)}`;
  return get(u).then((t) => (String(t).trim().startsWith('OK') ? 'OK' : 'KO'));
}
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, { timeout: 15000 }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; if (b.length > 1000) r.destroy(); }); res.on('end', () => resolve(b)); });
    r.on('timeout', () => r.destroy(new Error('O DuckDNS não respondeu.')));
    r.on('error', reject);
  });
}

/** Espera o endereço apontar para o IP (até `tempoMs`). → true | false */
async function esperarDns(dominio, ip, { tempoMs = 90000, resolver = (d) => dns.promises.resolve4(d), dormir = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const fim = Date.now() + tempoMs;
  for (;;) {
    try { if ((await resolver(dominio)).includes(ip)) return true; } catch (_) {}
    if (Date.now() >= fim) return false;
    await dormir(5000);
  }
}

module.exports = { contas, tokenDa, salvarConta, subdominioDe, atualizarIp, esperarDns, RX_TOKEN, RX_IPV4, ARQ_ENV };

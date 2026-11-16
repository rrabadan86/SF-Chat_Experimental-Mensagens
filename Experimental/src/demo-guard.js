/**
 * demo-guard.js — MODO DEMONSTRAÇÃO do painel (PAINEL_DEMO=1 no .env).
 *
 * Uma cópia do painel com dados FICTÍCIOS para mostrar a franqueados (ex.:
 * painelslimfit.duckdns.org). Este módulo é carregado ANTES de tudo e fecha as
 * portas para o mundo real, para que nada feito na demonstração saia daqui:
 *   - comandos do sistema (child_process): bloqueados — o painel não reinicia robô,
 *     não atualiza o servidor, não roda Python/EVO. "pm2 jlist" devolve uma lista
 *     de processos FICTÍCIA (para a Saúde mostrar tudo "online");
 *   - rede de saída (fetch / http(s).request para fora do próprio servidor):
 *     bloqueada — nada de EVO, WhatsApp, Google, IA, formulário real.
 * O bloqueio das ações do painel (POST) e a entrada sem senha ficam em
 * painel-mensagens.js / painel-base.js, usando `ativo`.
 *
 * Fora do modo demonstração este módulo não faz NADA.
 */
const ativo = /^(1|true|sim|yes)$/i.test(String(process.env.PAINEL_DEMO || '').trim());

const AVISO = 'Modo demonstração — nada foi enviado nem alterado.';

function pm2Ficticio() {
  const raiz = require('path').resolve(__dirname, '..');
  const sobe = Date.now() - 3 * 86400e3 - 4 * 3600e3;
  const p = (name, exe) => ({ name, pm2_env: { status: 'online', pm_uptime: sobe, restart_time: 0, pm_cwd: raiz, pm_exec_path: raiz + '/' + exe } });
  return JSON.stringify([
    p('slimfit-painel', 'src/painel-mensagens.js'),
    p('slimfit-exp', 'scheduler-vps.sh'),
    { name: 'sofia-listener', pm2_env: { status: 'online', pm_uptime: sobe, restart_time: 0, pm_cwd: require('path').resolve(raiz, '..', 'ChatBot'), pm_exec_path: '/usr/lib/node_modules/npm/bin/npm-cli.js', args: ['run', 'listener'] } },
    p('slimfit-form', 'src/agendamento_evo/rodar-vps.sh'),
  ]);
}
const ehPm2Jlist = (cmd, args) => /\bpm2\b/.test(String(cmd)) && (/\bjlist\b/.test(String(cmd)) || (Array.isArray(args) && args.includes('jlist')));

if (ativo) {
  const cp = require('child_process');
  const erro = () => Object.assign(new Error(AVISO), { code: 'DEMO' });
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') cb = opts;
    const saida = ehPm2Jlist(cmd) ? pm2Ficticio() : '';
    setImmediate(() => { if (cb) cb(saida ? null : erro(), saida, ''); });
    return { on() {}, kill() {}, stdout: null, stderr: null };
  };
  cp.execFile = function (file, args, opts, cb) {
    if (typeof args === 'function') cb = args; else if (typeof opts === 'function') cb = opts;
    const saida = ehPm2Jlist(file, args) ? pm2Ficticio() : '';
    setImmediate(() => { if (cb) cb(saida ? null : erro(), saida, ''); });
    return { on() {}, kill() {}, stdout: null, stderr: null };
  };
  cp.execSync = function (cmd) { if (ehPm2Jlist(cmd)) return pm2Ficticio(); throw erro(); };
  cp.execFileSync = function (file, args) { if (ehPm2Jlist(file, args)) return pm2Ficticio(); throw erro(); };
  cp.spawn = cp.fork = function () { throw erro(); };
  cp.spawnSync = function () { return { status: 1, error: erro(), stdout: '', stderr: '' }; };

  // Rede de saída: só o próprio servidor (localhost) passa.
  const local = (h) => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(h || '').replace(/:\d+$/, ''));
  const hostDe = (a) => {
    try {
      if (typeof a === 'string') return new URL(a).hostname;
      if (a instanceof URL) return a.hostname;
      if (a && typeof a === 'object') return a.hostname || a.host || '';
    } catch (_) {}
    return '';
  };
  for (const mod of ['http', 'https']) {
    const m = require(mod);
    for (const fn of ['request', 'get']) {
      const orig = m[fn];
      m[fn] = function (a, ...resto) {
        if (local(hostDe(a))) return orig.call(this, a, ...resto);
        const { EventEmitter } = require('events');
        const req = new EventEmitter();
        req.end = req.write = req.setTimeout = req.abort = req.destroy = () => req;
        setImmediate(() => req.emit('error', erro()));
        return req;
      };
    }
  }
  if (typeof globalThis.fetch === 'function') {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (u, o) => (local(hostDe(typeof u === 'object' && u.url ? u.url : u)) ? origFetch(u, o) : Promise.reject(erro()));
  }
  console.log('[painel] 🎭 MODO DEMONSTRAÇÃO: dados fictícios; comandos, rede de saída e ações bloqueados.');
}

module.exports = { ativo, AVISO };

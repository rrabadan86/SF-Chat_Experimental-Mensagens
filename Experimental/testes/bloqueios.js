/**
 * Carregado ANTES do painel nos testes (node -r testes/bloqueios.js src/painel-mensagens.js):
 * bloqueia comandos do sistema (pm2, python…) e rede para fora do próprio servidor.
 * Assim, mesmo que uma rota sem permissão "escape", nada sai do teste.
 */
const erro = () => Object.assign(new Error('bloqueado no teste'), { code: 'TESTE' });
const cp = require('child_process');
cp.exec = (cmd, o, cb) => { if (typeof o === 'function') cb = o; setImmediate(() => cb && cb(erro(), '', '')); return { on() {}, kill() {}, unref() {} }; };
cp.execFile = (f, a, o, cb) => { if (typeof a === 'function') cb = a; else if (typeof o === 'function') cb = o; setImmediate(() => cb && cb(erro(), '', '')); return { on() {}, kill() {}, unref() {} }; };
cp.execSync = cp.execFileSync = () => { throw erro(); };
cp.spawn = cp.fork = () => { const { EventEmitter } = require('events'); const c = new EventEmitter(); c.unref = () => {}; c.kill = () => {}; setImmediate(() => c.emit('error', erro())); return c; };
cp.spawnSync = () => ({ status: 1, error: erro(), stdout: '', stderr: '' });
const local = (h) => /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(h || '').replace(/:\d+$/, ''));
const hostDe = (a) => { try { if (typeof a === 'string') return new URL(a).hostname; if (a instanceof URL) return a.hostname; if (a && typeof a === 'object') return a.hostname || a.host || ''; } catch (_) {} return ''; };
for (const mod of ['http', 'https']) {
  const m = require(mod);
  for (const fn of ['request', 'get']) {
    const orig = m[fn];
    m[fn] = function (a, ...r) {
      if (local(hostDe(a))) return orig.call(this, a, ...r);
      const { EventEmitter } = require('events'); const q = new EventEmitter();
      q.end = q.write = q.setTimeout = q.abort = q.destroy = () => q;
      setImmediate(() => q.emit('error', erro())); return q;
    };
  }
}
if (typeof globalThis.fetch === 'function') { const f = globalThis.fetch; globalThis.fetch = (u, o) => (local(hostDe(typeof u === 'object' && u.url ? u.url : u)) ? f(u, o) : Promise.reject(erro())); }

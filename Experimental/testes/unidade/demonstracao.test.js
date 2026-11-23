// Demonstração (demo-guard.js): nunca toca a unidade real. Roda num processo à parte,
// porque o modo demonstração troca peças do Node (comandos e rede) ao carregar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

const ROTEIRO = `
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const g = require('./src/demo-guard');
const cp = require('child_process');
const r = { ativo: g.ativo, sofiaDir: process.env.SOFIA_DIR, dentro: process.env.SOFIA_DIR.startsWith(raiz + path.sep) };
try { cp.execSync('echo oi'); r.comando = 'rodou'; } catch (e) { r.comando = e.code; }
try { cp.spawn('ls'); r.spawn = 'rodou'; } catch (e) { r.spawn = e.code; }
r.pm2 = JSON.parse(cp.execSync('pm2 jlist')).map(p => p.name);
(async () => {
  try { await fetch('https://example.com/'); r.fetchFora = 'saiu'; } catch (e) { r.fetchFora = 'bloqueado'; }
  r.httpFora = await new Promise((ok) => { try { const q = require('https').request({ host: 'api.anthropic.com', path: '/' }, () => ok('saiu')); q.on('error', () => ok('bloqueado')); q.end(); } catch (e) { ok('bloqueado'); } });
  const srv = require('http').createServer((q, s) => s.end('ok')).listen(+process.env.PORTA, '127.0.0.1', async () => {
    try { r.local = await (await fetch('http://127.0.0.1:' + process.env.PORTA + '/')).text(); } catch (e) { r.local = 'erro ' + e.message; }
    srv.close(); console.log('RESULTADO' + JSON.stringify(r)); process.exit(0);
  });
})();
`;

test('DEM-01/02 demonstração: comandos e rede para fora bloqueados; pasta da SoFIA sempre dentro da instalação', { timeout: 30000 }, async () => {
  const amb = ambienteIsolado();
  try {
    // o .env aponta para a SoFIA de uma unidade REAL — a demonstração não pode usar
    fs.writeFileSync(path.join(amb.exp, '.env'), 'PAINEL_DEMO=1\nSOFIA_DIR=/root/sofia-data\n');
    fs.writeFileSync(path.join(amb.exp, 'roteiro.js'), ROTEIRO);
    const env = { ...process.env, PORTA: String(await portaLivre()), SOFIA_DIR: '/root/sofia-data-lagosul1', PAINEL_DEMO: '1' }; // como no painel: o .env já foi lido
    const saida = execFileSync(process.execPath, ['roteiro.js'], { cwd: amb.exp, env, encoding: 'utf8', timeout: 20000 });
    const r = JSON.parse((/RESULTADO(.*)/.exec(saida) || [])[1] || 'null');
    assert.ok(r, saida);
    assert.strictEqual(r.ativo, true);
    assert.ok(r.dentro, `a SoFIA da demonstração foi para fora da instalação: ${r.sofiaDir}`);
    assert.strictEqual(path.basename(r.sofiaDir), 'sofia-demo');
    assert.strictEqual(r.comando, 'DEMO', 'comando do sistema bloqueado');
    assert.strictEqual(r.spawn, 'DEMO');
    assert.ok(r.pm2.includes('slimfit-painel'), 'a Saúde vê uma lista de processos de mentira');
    assert.strictEqual(r.fetchFora, 'bloqueado', 'fetch para fora bloqueado');
    assert.strictEqual(r.httpFora, 'bloqueado', 'https para fora (IA) bloqueado');
    assert.strictEqual(r.local, 'ok', 'o próprio servidor continua acessível');
  } finally { amb.limpar(); }
});

test('DEM-01 fora da demonstração o guarda não mexe em nada', () => {
  const amb = ambienteIsolado();
  try {
    fs.writeFileSync(path.join(amb.exp, 'r.js'), "const g=require('./src/demo-guard');const cp=require('child_process');console.log('R'+JSON.stringify({ativo:g.ativo,eco:String(cp.execSync('echo oi')).trim()}));");
    const env = { ...process.env }; delete env.PAINEL_DEMO;
    const r = JSON.parse(/R(\{.*\})/.exec(execFileSync(process.execPath, ['r.js'], { cwd: amb.exp, env, encoding: 'utf8' }))[1]);
    assert.deepStrictEqual(r, { ativo: false, eco: 'oi' });
  } finally { amb.limpar(); }
});

// AGE-07: atividade e serviço da aula experimental (SlimFit e Circuito) editados no
// painel (WhatsApp → Cadastro Express, só admin). O que está no .env aparece preenchido;
// o salvo no painel vai para data/ e vale antes do .env (o Python lê a cada uso).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

const pedir = (porta, metodo, url, cookie, corpo = '') => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 8000,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo) } },
  (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => ok({ st: r.statusCode, loc: r.headers.location || '', cookie: r.headers['set-cookie'], corpo: b })); });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});

test('AGE-07 atividade e serviço da experimental no painel: mostra o do .env, o admin salva e vale antes do .env', { timeout: 120000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
  let painel;
  try {
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=exemplo-do-dono-123\nSOFIA_DIR=${amb.sofia}\nEVO_ACTIVITY=SLIMFIT B\nEVO_SERVICE_ID=128\n`);
    amb.gravarSofia('sofia-prompt.txt', 'prompt de exemplo');
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR', 'EVO_ACTIVITY', 'EVO_ACTIVITY_ID', 'EVO_SERVICE', 'EVO_SERVICE_ID']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise((r) => setTimeout(r, 300)); }
    const ck = String(((await pedir(porta, 'POST', '/login', '', 'usuario=dono&senha=exemplo-do-dono-123')).cookie || [])[0] || '').split(';')[0];
    assert.match(ck, /^sf_sess=/);

    let pg = (await pedir(porta, 'GET', '/?view=express', ck)).corpo;
    assert.match(pg, /name="slimAtividade"[^>]*value="SLIMFIT B"/, 'atividade do .env aparece preenchida');
    assert.match(pg, /name="slimServico"[^>]*value="128"/, 'serviço do .env aparece preenchido');
    assert.match(pg, /veio da instalação \(\.env\)/);

    const r = await pedir(porta, 'POST', '/agendar/servicos-evo', ck, 'slimAtividade=122&slimServico=Aula+Experimental%22%3Cx%3E&id=316');
    assert.deepStrictEqual([r.st, r.loc], [303, '/?view=express']);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(amb.data, 'slimfit-evo.json'), 'utf8')), { atividade: '122', servico: 'Aula Experimentalx' }, 'aspas e < > saem');
    assert.strictEqual(fs.readFileSync(path.join(amb.data, 'circuito-servico.txt'), 'utf8'), '316');
    pg = (await pedir(porta, 'GET', '/?view=express', ck)).corpo;
    assert.match(pg, /name="slimAtividade"[^>]*value="122"/);
    assert.match(pg, /name="id"[^>]*value="316"/);
    assert.doesNotMatch(pg, /veio da instalação/, 'tudo salvo no painel: sem a nota do .env');

    const aud = fs.readdirSync(amb.data).filter((f) => /audit/.test(f)).map((f) => fs.readFileSync(path.join(amb.data, f), 'utf8')).join('\n');
    assert.match(aud, /express\.servicos-evo/, 'a troca fica na Auditoria');
  } finally { if (painel) painel.kill(); amb.limpar(); }
});

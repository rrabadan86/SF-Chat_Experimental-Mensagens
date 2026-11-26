// Permissões checadas NO SERVIDOR: um usuário logado SEM nenhuma tela liberada
// não pode abrir nem acionar nenhuma rota do painel — só as públicas (login,
// termos, páginas públicas do Slim Club/formulário…). As rotas são lidas do
// próprio código, então rota nova entra no teste sozinha.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const pedir = (porta, metodo, url, cookie, corpo = '') => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 8000,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo), accept: 'text/html' } },
  (r) => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ st: r.statusCode, loc: r.headers.location || '', cookie: r.headers['set-cookie'], corpo: b })); });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});

// Rotas do código: url === '/x' e url.startsWith('/x'). Pública = tratada antes do
// "const sess = usuarioDaReq(req)" (antes de exigir login) em painel-mensagens.js.
function rotas() {
  const fonte = fs.readFileSync(path.join(SRC, 'painel-mensagens.js'), 'utf8');
  const corte = fonte.indexOf('const sess = usuarioDaReq(req);');
  const out = new Map();
  const ver = (txt, arq, offsetCorte) => {
    const re = /url\s*===\s*'(\/[^'?]*)'|url\.startsWith\('(\/[^']*)'\)/g; let m;
    while ((m = re.exec(txt))) {
      const r = m[1] || (m[2].replace(/\/?$/, '/') + 'x');
      if (/^\/(favicon|robots)/.test(r)) continue;
      const publica = offsetCorte >= 0 && m.index < offsetCorte;
      if (!out.has(r)) out.set(r, { publica, arq });
    }
  };
  ver(fonte, 'painel-mensagens.js', corte);
  for (const f of ['painel-slimclub.js', 'painel-formularios.js']) ver(fs.readFileSync(path.join(SRC, f), 'utf8'), f, -1);
  return out;
}
// Páginas públicas por natureza (cadastro/listagem do Slim Club, formulário de campanha, termos).
// /trocar-senha: aberta a qualquer usuário logado (só cria a própria senha — PAI-12).
const PUBLICAS = /^\/(login|logout|trocar-senha|termos|politicadeprivacidade|midia-publica|auth\/google|slimclub|SlimClubCadastro|formulario\/|f\/)/i;

test('PAI-01 PAI-02 usuário sem nenhuma permissão não acessa rota nenhuma do painel', { timeout: 180000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
  let painel;
  try {
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=senha-do-teste-123\nSOFIA_DIR=${amb.sofia}\n`);
    amb.req('usuarios').criar({ usuario: 'semacesso', senha: 'teste-1234', telas: [], trocarSenha: false });
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; painel.stdout.on('data', d => { log += d; }); painel.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise(r => setTimeout(r, 300)); }

    const login = await pedir(porta, 'POST', '/login', '', 'usuario=semacesso&senha=teste-1234');
    const cookie = String((login.cookie || [])[0] || '').split(';')[0];
    assert.ok(/^sf_sess=/.test(cookie), 'o login do usuário de teste não funcionou');

    // Controle: o administrador ABRE as telas (prova que o 403 vem da permissão, não de painel quebrado).
    const adm = await pedir(porta, 'POST', '/login', '', 'usuario=dono&senha=senha-do-teste-123');
    const cookieAdm = String((adm.cookie || [])[0] || '').split(';')[0];
    for (const tela of ['/sofia?view=conversas', '/?view=config', '/funil', '/perfis']) {
      const r = await pedir(porta, 'GET', tela, cookieAdm);
      assert.strictEqual(r.st, 200, `o administrador não abriu ${tela} (HTTP ${r.st})`);
      const n = await pedir(porta, 'GET', tela, cookie);
      assert.strictEqual(n.st, 403, `sem permissão, ${tela} deveria dar 403 (deu ${n.st})`);
    }

    const escaparam = [], erros = [];
    let testadas = 0;
    for (const [rota, info] of rotas()) {
      if (info.publica || PUBLICAS.test(rota)) continue;
      testadas++;
      for (const metodo of ['GET', 'POST']) {
        const r = await pedir(porta, metodo, rota, cookie);
        if (r.st >= 500) erros.push(`${metodo} ${rota} → ${r.st}`);
        else if (r.st >= 200 && r.st < 400 && !/^\/login/.test(r.loc)) escaparam.push(`${metodo} ${rota} → ${r.st}${r.loc ? ' ' + r.loc : ''} (${info.arq})`);
      }
    }
    // Perfil parcial: recepção que só vê as Conversas da SoFIA. (O Funil é liberado para ela de propósito — podeFunil.)
    amb.req('usuarios').criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'], trocarSenha: false });
    const rec = await pedir(porta, 'POST', '/login', '', 'usuario=recepcao&senha=teste-1234');
    const cookieRec = String((rec.cookie || [])[0] || '').split(';')[0];
    assert.strictEqual((await pedir(porta, 'GET', '/sofia?view=conversas', cookieRec)).st, 200, 'a recepção não abriu as Conversas');
    for (const [metodo, rota] of [['GET', '/perfis'], ['POST', '/sofia/campanhas/criar'], ['POST', '/sofia/contatos/excluir-lote'], ['POST', '/sofia/contatos/importar'],
      ['POST', '/sofia/midia-upload'], ['GET', '/grade'], ['GET', '/?view=config'], ['GET', '/clube']]) {
      const r = await pedir(porta, metodo, rota, cookieRec);
      assert.strictEqual(r.st, 403, `a recepção (só Conversas) não deveria ter ${metodo} ${rota} — deu ${r.st}`);
    }

    assert.ok(testadas > 100, `poucas rotas encontradas no código (${testadas}) — o leitor de rotas quebrou?`);
    console.log(`   ${testadas} rotas testadas (GET e POST) com um usuário sem permissão`);
    assert.deepStrictEqual(escaparam, [], 'rotas abertas para quem não tem permissão:\n' + escaparam.join('\n'));
    assert.deepStrictEqual(erros, [], 'rotas que deram erro interno:\n' + erros.join('\n') + '\n' + log.slice(-1500));
  } finally { if (painel) painel.kill(); amb.limpar(); }
});

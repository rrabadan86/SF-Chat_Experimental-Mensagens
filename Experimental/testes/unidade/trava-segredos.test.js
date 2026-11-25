// A trava .claude/hooks/bloquear-segredos.js roda antes de todo "git commit"/"git push"
// do Claude. Aqui ela roda num repositório de mentira (pasta temporária), nunca no real.
// As chaves falsas são montadas em pedaços para este arquivo não disparar a trava.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const TRAVA = path.resolve(__dirname, '..', '..', '..', '.claude', 'hooks', 'bloquear-segredos.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-trava-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 'teste@exemplo.invalid'); git('config', 'user.name', 'teste');
  fs.writeFileSync(path.join(dir, 'leia.md'), 'ok\n'); git('add', '.'); git('commit', '-qm', 'inicio');
  const gravar = (f, txt) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), txt); };
  const commit = (cmd = 'git commit -m teste') => spawnSync(process.execPath, [TRAVA], { cwd: dir, input: JSON.stringify({ tool_input: { command: cmd } }), encoding: 'utf8' });
  return { dir, git, gravar, commit, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DAD-07 trava de segredos: barra .env, dados da unidade, sessão do WhatsApp e chave no código', () => {
  const casos = [
    ['Experimental/.env', 'X=1\n', 'arquivo .env'],
    ['Experimental/data/contatos.json', '{}\n', 'dados da unidade'],
    ['Experimental/.wwebjs_auth/sessao/a.txt', 'x\n', 'sessão do WhatsApp'],
    ['Experimental/src/novo.js', `const k = '${'sk-' + 'ant-' + 'a'.repeat(30)}';\n`, 'chave da Anthropic'],
    ['Experimental/src/outro.js', `${'EVO_' + 'SENHA'}=${'Qw7' + 'xYz9Kp'}\n`, 'com valor'],
  ];
  for (const [arq, txt, motivo] of casos) {
    const r = repo();
    try {
      r.gravar(arq, txt);
      const s = r.commit();
      assert.strictEqual(s.status, 2, `${arq} deveria ser barrado`);
      assert.match(s.stderr, new RegExp(motivo));
    } finally { r.limpar(); }
  }
});

test('DAD-07 trava de segredos: deixa passar o .gitkeep, o exemplo, o arquivo apagado e o que não é commit', () => {
  const r = repo();
  try {
    r.gravar('Experimental/data/.gitkeep', '');
    r.gravar('Experimental/.env.example', `${'EVO_' + 'SENHA'}=sua-senha-aqui\n`);
    r.gravar('Experimental/src/a.js', "const s = process.env.EVO_SENHA;\n");
    assert.strictEqual(r.commit().status, 0, 'gitkeep, .env.example e leitura de process.env passam');
    r.gravar('Experimental/data/velho.json', '{}\n');
    r.git('add', '-f', '.'); r.git('commit', '-qm', 'velho', '--no-verify');
    r.git('rm', '-q', '--cached', 'Experimental/data/velho.json'); fs.rmSync(path.join(r.dir, 'Experimental/data/velho.json'));
    assert.strictEqual(r.commit().status, 0, 'tirar dado do Git é permitido');
    r.gravar('Experimental/data/novo.json', '{}\n');
    assert.strictEqual(r.commit('git status').status, 0, 'comando que não é commit/push não é conferido');
  } finally { r.limpar(); }
});

test('DAD-07 trava de segredos: no código, expressão sem aspas e token só de zeros passam; segredo entre aspas continua barrado', () => {
  const K = 'TOK' + 'EN', P = 'PASS' + 'WORD';
  const r = repo();
  try {
    r.gravar('Experimental/src/a.js', `const RX_${K} = /^[0-9a-f]{8}-[0-9a-f]{4}$/i;\nconst s = { EVO_${P}: String((f && f.evoSenha) || '') };\nconst ${K} = '00000000-0000-0000-0000-000000000000';\n`);
    assert.strictEqual(r.commit().status, 0, 'regra de formato, leitura de campo e token de zeros não são segredo');
  } finally { r.limpar(); }
  for (const [arq, txt] of [
    ['Experimental/src/b.js', `const s = { EVO_${P}: '${'Qw7' + 'xYz9Kp'}' };\n`],
    ['Experimental/src/c.py', `EVO_${P} = "${'Qw7' + 'xYz9Kp'}"\n`],
    ['Experimental/config.txt', `EVO_${P}=${'Qw7' + 'xYz9Kp'}\n`],
    ['Experimental/src/d.js', `const ${K} = '${'01234567' + '-89ab-cdef-0123-456789abcdef'}';\n`],
    ['Experimental/src/e.js', `const x = { EVO_${P}: ${'Qw7' + 'xYz9Kp'} };\n`],
  ]) {
    const r2 = repo();
    try { r2.gravar(arq, txt); assert.strictEqual(r2.commit().status, 2, `${arq}: segredo escrito deveria ser barrado`); } finally { r2.limpar(); }
  }
});

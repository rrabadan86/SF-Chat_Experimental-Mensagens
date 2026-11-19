// Servidores só baixam versão aprovada no CI (marca "estavel"); sem a marca, a main.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buscar } = require('../../../scripts/ramo-estavel');

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const commit = (dir, msg) => { fs.writeFileSync(path.join(dir, 'a.txt'), msg); git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };

test('baixa a "estavel" e conta o que ainda está no teste; sem ela, usa a main; --main força a main', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ramo-'));
  try {
    const origem = path.join(raiz, 'origem.git'), dev = path.join(raiz, 'dev'), srv = path.join(raiz, 'servidor');
    git(raiz, 'init', '-q', '--bare', origem);
    execFileSync('git', ['clone', '-q', origem, dev], { stdio: 'ignore' });
    git(dev, 'checkout', '-q', '-b', 'main');
    const v1 = commit(dev, 'versao 1');
    git(dev, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', '-b', 'main', origem, srv], { stdio: 'ignore' });

    // Sem a marca: main (como antes).
    let r = buscar(git, srv);
    assert.strictEqual(r.ramo, 'main');
    assert.strictEqual(git(srv, 'rev-parse', r.ref), v1);

    // CI aprovou a v1 → estavel = v1. Entram v2 e v3 na main (ainda no teste).
    git(dev, 'push', '-q', 'origin', `${v1}:refs/heads/estavel`);
    commit(dev, 'versao 2'); const v3 = commit(dev, 'versao 3');
    git(dev, 'push', '-q', 'origin', 'main');
    r = buscar(git, srv);
    assert.deepStrictEqual({ ramo: r.ramo, emTeste: r.emTeste }, { ramo: 'estavel', emTeste: 2 });
    assert.strictEqual(git(srv, 'rev-parse', r.ref), v1, 'baixa só a aprovada');

    // Emergência: --main.
    r = buscar(git, srv, { forcarMain: true });
    assert.strictEqual(git(srv, 'rev-parse', r.ref), v3);

    // CI aprovou a v3.
    git(dev, 'push', '-q', '--force', 'origin', `${v3}:refs/heads/estavel`);
    r = buscar(git, srv);
    assert.deepStrictEqual({ ramo: r.ramo, emTeste: r.emTeste, sha: git(srv, 'rev-parse', r.ref) }, { ramo: 'estavel', emTeste: 0, sha: v3 });
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

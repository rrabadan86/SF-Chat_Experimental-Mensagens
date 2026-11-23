// Skills e hooks do Claude (.claude/): cada skill é encontrada, aponta para coisas que
// existem, e cada hook faz o que promete — rodando em pastas temporárias, nunca no repo real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const CLAUDE = path.join(REPO, '.claude');
const POS_GIT = path.join(CLAUDE, 'hooks', 'depois-do-git.js');
const LIMPAR = path.join(CLAUDE, 'hooks', 'limpar-restos-teste.js');

test('DEP-07 skills: as quatro existem, com nome e descrição, e só citam scripts e arquivos que existem', () => {
  const skills = fs.readdirSync(path.join(CLAUDE, 'skills')).sort();
  assert.deepStrictEqual(skills.filter(s => ['subir-versao', 'conferir-pr', 'conferir-celular', 'nova-tela'].includes(s)).length, 4, `skills: ${skills}`);
  const pacote = JSON.parse(fs.readFileSync(path.join(REPO, 'Experimental', 'package.json'), 'utf8'));
  const existe = (f) => [REPO, path.join(REPO, 'Experimental'), path.join(REPO, 'Experimental', 'src')].some(b => fs.existsSync(path.join(b, f)));
  for (const s of skills) {
    const txt = fs.readFileSync(path.join(CLAUDE, 'skills', s, 'SKILL.md'), 'utf8');
    const fm = /^---\nname: ([^\n]+)\ndescription: ([^\n]{40,})\n---/.exec(txt);
    assert.ok(fm, `${s}: SKILL.md sem name/description no topo`);
    assert.strictEqual(fm[1].trim(), s, `${s}: o name precisa ser igual ao nome da pasta`);
    for (const m of txt.matchAll(/npm run ([\w-]+)/g)) assert.ok(pacote.scripts[m[1]], `${s}: "npm run ${m[1]}" não existe em Experimental/package.json`);
    for (const m of txt.matchAll(/skill `([\w-]+)`/g)) assert.ok(skills.includes(m[1]), `${s}: cita a skill ${m[1]}, que não existe`);
    for (const m of txt.matchAll(/`((?:\.claude|Experimental|scripts|docs|testes)\/[\w./-]+\.(?:js|md|json|html))`/g)) assert.ok(existe(m[1]), `${s}: cita ${m[1]}, que não existe`);
  }
});

test('DEP-07 hooks: o settings.json liga os três hooks, e os arquivos existem', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'settings.json'), 'utf8'));
  const cmds = (ev) => (cfg.hooks[ev] || []).flatMap(h => h.hooks.map(x => x.command)).join(' ');
  assert.match(cmds('PreToolUse'), /bloquear-segredos\.js/);
  assert.match(cmds('PostToolUse'), /depois-do-git\.js/);
  assert.match(cmds('Stop'), /limpar-restos-teste\.js/);
  for (const m of JSON.stringify(cfg).matchAll(/\.claude\/hooks\/([\w-]+\.js)/g)) assert.ok(fs.existsSync(path.join(CLAUDE, 'hooks', m[1])), m[1]);
});

function repoFalso() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-trava-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 'teste@exemplo.invalid'); git('config', 'user.name', 'teste');
  const rodar = (cmd) => spawnSync(process.execPath, [POS_GIT], { cwd: dir, input: JSON.stringify({ tool_input: { command: cmd } }), encoding: 'utf8' });
  const aviso = (cmd) => { const r = rodar(cmd); assert.strictEqual(r.status, 0); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : ''; };
  return { dir, git, aviso, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DEP-07 depois do commit: lembra as regras da área dos arquivos e as regras sem teste; depois do push, a conferir-pr', () => {
  const r = repoFalso();
  try {
    fs.mkdirSync(path.join(r.dir, 'Experimental', 'src'), { recursive: true });
    fs.writeFileSync(path.join(r.dir, 'Experimental', 'src', 'sentimos-falta.js'), '// x\n');
    r.git('add', '.'); r.git('commit', '-qm', 'mexe no envio');
    const a = r.aviso('git add . && git commit -m "mexe no envio"');
    assert.match(a, /\.claude\/rules\/envio\.md \(ENV, CONF/);
    assert.match(a, /SEM teste: ENV-08/, 'avisa a regra do arquivo que não tem teste');
    assert.match(a, /só em parte: ALU-05/);
    assert.strictEqual(r.aviso('git status && echo "git commit"'), '', 'só avisa quando o comando é mesmo um commit');
    assert.strictEqual(r.aviso("cat > x <<'EOF'\ngit push\nEOF"), '', 'texto dentro de heredoc não conta');
    // push: avisa só se o remoto ficou igual ao local
    const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-trava-'));
    try {
      execFileSync('git', ['init', '-q', '--bare', remoto]);
      r.git('remote', 'add', 'origin', remoto);
      assert.strictEqual(r.aviso('git push -u origin HEAD'), '', 'push que não aconteceu não avisa');
      r.git('push', '-q', '-u', 'origin', 'HEAD');
      assert.match(r.aviso('git push -u origin HEAD'), /conferir-pr/);
    } finally { fs.rmSync(remoto, { recursive: true, force: true }); }
  } finally { r.limpar(); }
});

test('TST-10 limpeza: apaga só pastas sf-* de teste com mais de 2 h, na pasta temporária', () => {
  const { limpar } = require(LIMPAR);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teste-limpeza-'));
  try {
    const criar = (n, horas) => { const f = path.join(tmp, n); fs.mkdirSync(f); fs.writeFileSync(path.join(f, 'a.png'), 'x'); const t = (Date.now() - horas * 3600e3) / 1000; fs.utimesSync(f, t, t); return f; };
    const velha = criar('sf-telas-saida-abc', 5), velhaCopia = criar('sf-teste-xyz', 3);
    const nova = criar('sf-teste-agora', 0.5), outra = criar('dados-importantes', 10), naoTeste = criar('sf-qualquer', 10);
    fs.writeFileSync(path.join(tmp, 'sf-teste-arquivo'), 'x'); // arquivo solto, não pasta
    const apagadas = limpar(tmp).sort();
    assert.deepStrictEqual(apagadas, ['sf-telas-saida-abc', 'sf-teste-xyz']);
    assert.ok(!fs.existsSync(velha) && !fs.existsSync(velhaCopia));
    assert.ok(fs.existsSync(nova), 'pasta recente fica (pode ser teste rodando)');
    assert.ok(fs.existsSync(outra) && fs.existsSync(naoTeste), 'o que não é resto de teste fica');
    assert.ok(fs.existsSync(path.join(tmp, 'sf-teste-arquivo')));
    // como hook: roda sem entrada e sai sem erro
    assert.strictEqual(spawnSync(process.execPath, [LIMPAR], { input: '{}', env: { ...process.env, TMPDIR: tmp } }).status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('DEP-08 GitHub: CI em todo PR, rodada noturna que abre/fecha o aviso, prints só pelo botão', () => {
  const wf = (n) => fs.readFileSync(path.join(REPO, '.github', 'workflows', n), 'utf8');
  const ci = wf('ci.yml'), noite = wf('noturno.yml'), prints = wf('prints.yml');
  assert.match(ci, /\n  pull_request:/); assert.match(ci, /workflow_call:/, 'a rodada noturna reaproveita o CI');
  assert.match(ci, /testar-alteracao\.js --resumo/); assert.match(ci, /matriz\.js --resumo/);
  assert.match(ci, /group: ci-\$\{\{ github\.workflow \}\}-/, 'a rodada noturna não cancela o CI da main');
  assert.match(ci, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/, 'a marca estavel só anda num push na main');
  assert.match(noite, /schedule:\s*\n\s*- cron: '37 6 \* \* \*'/);
  assert.match(noite, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(noite, /TZ: \$\{\{ matrix\.tz \}\}/);
  assert.match(noite, /gh issue close/); assert.match(noite, /gh issue create/);
  assert.doesNotMatch(prints, /\n  (schedule|push|pull_request):/, 'prints só pelo botão');
  assert.match(prints, /--prints "--relogio=\$RELOGIO"/);
  for (const t of [ci, noite, prints]) assert.doesNotMatch(t, /run:[^\n]*\$\{\{ (github\.event|inputs)\./, 'entrada de fora vai por env, nunca direto no comando');
  // o que o CI roda existe
  assert.ok(fs.existsSync(path.join(REPO, 'scripts', 'testar-alteracao.js')) && fs.existsSync(path.join(REPO, 'scripts', 'matriz.js')));
});

test('DEP-08 relógio fixo dos prints: a data começa na pedida e anda; sem a variável nada muda', () => {
  const fixo = path.join(REPO, 'Experimental', 'testes', 'tela', 'relogio-fixo.js');
  const rodar = (env) => execFileSync(process.execPath, ['-r', fixo, '-e', "const a=Date.now(); const d=new Date(); console.log(JSON.stringify({iso: d.toISOString(), inst: d instanceof Date, str: typeof Date(), velho: new Date('2020-01-02T00:00:00Z').getUTCFullYear(), parse: Date.parse('2021-01-01T00:00:00Z')}))"], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const r = JSON.parse(rodar({ SF_RELOGIO_FIXO: '2026-03-02T10:00:00-03:00' }));
  assert.ok(r.iso.startsWith('2026-03-02T13:00:0'), r.iso);
  assert.deepStrictEqual([r.inst, r.str, r.velho, r.parse], [true, 'string', 2020, Date.parse('2021-01-01T00:00:00Z')]);
  const sem = JSON.parse(rodar({ SF_RELOGIO_FIXO: '' }));
  assert.ok(Math.abs(Date.parse(sem.iso) - Date.now()) < 60000, 'sem a variável o relógio é o de verdade');
});

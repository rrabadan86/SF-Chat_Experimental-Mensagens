// NOV-01: motor do assistente 🏪 Nova loja (nova-loja-remoto.js).
// Os testes de peças rodam sempre. O de servidor de verdade (SSH) só roda com
// SF_TESTE_VPS=host:porta e SF_TESTE_VPS_SENHA (ex.: um Ubuntu em Docker com sshd).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ambienteIsolado } = require('../ajuda');

const BOM = { host: '203.0.113.10', usuario: 'root', slug: 'marista', studio: 'Studio SlimFit Marista', dominio: 'painel-marista.duckdns.org', evoTenant: 'slimfit', evoBranch: '22' };

function comAmb(fn) { const amb = ambienteIsolado(); try { return fn(amb, amb.req('nova-loja-remoto')); } finally { try { fs.rmSync(amb.raiz, { recursive: true, force: true }); } catch (_) {} } }
async function comAmbAsync(fn) { const amb = ambienteIsolado(); try { return await fn(amb, amb.req('nova-loja-remoto')); } finally { try { fs.rmSync(amb.raiz, { recursive: true, force: true }); } catch (_) {} } }

test('NOV-01 nova loja: dados que vão para o comando são conferidos (nada de shell escondido)', () => comAmb((amb, nl) => {
  assert.deepStrictEqual(nl.validar(BOM), []);
  for (const [campo, ruim] of [['slug', 'Marista'], ['slug', 'a;rm -rf /'], ['host', '1.2.3.4; reboot'], ['dominio', 'x.com/$(id)'], ['evoBranch', '22 && ls'], ['evoTenant', "a'b"], ['usuario', 'root;id'], ['studio', 'linha\nquebrada']]) {
    const e = nl.validar({ ...BOM, [campo]: ruim });
    assert.ok(e.some((x) => x.campo === campo), `${campo}="${ruim}" devia ser recusado`);
  }
  // o nome da loja pode ter aspas/$ — vai entre aspas simples, nunca interpretado
  const cmd = nl.comandoInstalacao({ ...BOM, studio: `Studio D'Ávila $(reboot) \`id\`` });
  assert.match(cmd, /--studio 'Studio D'\\''Ávila \$\(reboot\) `id`'/);
  assert.match(cmd, /--tudo --slug 'marista' .*--install-deps --evo-tenant 'slimfit' --evo-branch '22' --port '8080' --domain 'painel-marista\.duckdns\.org' --segredos '\/root\/\.sf-nova-loja-segredos' <\/dev\/null/);
  assert.match(cmd, /timedatectl set-timezone America\/Sao_Paulo/, 'acerta o fuso antes de subir o pm2');
  assert.doesNotMatch(cmd, /EVO_PASSWORD|ANTHROPIC/, 'segredo nenhum no comando');
  assert.match(nl.comandoInstalacao({ ...BOM, segundaLoja: true }), /git clone -q '[^']+' '\/root\/slimfit-marista'[\s\S]*--port '8081'/);
}));

test('NOV-01 nova loja: segredos vão num arquivo base64 só com os nomes aceitos, e o log mascara', () => comAmb((amb, nl) => {
  const arq = nl.arquivoSegredos({ EVO_PASSWORD: "exemplo#$n'ha`=", EVO_EMAIL: 'robo@x.com', ANTHROPIC_API_KEY: '', INVENTADO: 'x' });
  const linhas = arq.trim().split('\n');
  assert.deepStrictEqual(linhas.map((l) => l.split('=')[0]), ['EVO_EMAIL', 'EVO_PASSWORD'], 'só os aceitos e preenchidos, na ordem fixa');
  assert.strictEqual(Buffer.from(linhas[1].slice('EVO_PASSWORD='.length), 'base64').toString(), "exemplo#$n'ha`=");
  assert.strictEqual(nl.mascarar('senha=s#e$n e chave sk-ant-123456 e ok', ['s#e$n', 'sk-ant-123456', '', 'ab']), 'senha=•••• e chave •••• e ok');
}));

test('NOV-01 nova loja: diagnóstico do servidor reprova o que não serve e avisa memória baixa', () => comAmb((amb, nl) => {
  const d = nl.lerDiagnostico(['SO=ubuntu', 'VERSAO=24.04', 'CPUS=1', 'RAM_MB=3900', 'DISCO_LIVRE_MB=45000', 'FUSO=Etc/UTC', 'ROOT=0', 'LOJAS=']);
  assert.deepStrictEqual(nl.avaliarDiagnostico(d), { ok: true, problemas: [], avisos: [] });
  const fraco = nl.avaliarDiagnostico({ ...d, so: 'debian', ramMb: 1900, discoLivreMb: 5000, root: false });
  assert.strictEqual(fraco.ok, false);
  assert.strictEqual(fraco.problemas.length, 3, JSON.stringify(fraco));
  assert.ok(fraco.avisos.some((a) => /memória/.test(a)));
  assert.ok(nl.avaliarDiagnostico({ ...d, lojas: ['/root/SF-Chat_Experimental-Mensagens'] }).avisos.some((a) => /já tem uma loja/.test(a)));
}));

test('NOV-01 setup-novo-studio.sh: --segredos lê valores difíceis, recusa nome desconhecido e apaga o arquivo', () => {
  const raiz = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sf-segredos-'));
  try {
    const orig = path.resolve(__dirname, '..', '..', 'setup-novo-studio.sh');
    const copia = path.join(raiz, 'setup.sh');
    // para logo depois de ler os segredos e mostra o que leu
    fs.writeFileSync(copia, fs.readFileSync(orig, 'utf8').replace('  echo "🔐 Segredos lidos do arquivo (e o arquivo foi apagado)."', '  printf "LIDO[%s][%s][%s]\\n" "$EVO_EMAIL_IN" "$EVO_PASSWORD_IN" "$GRUPO_EQUIPE_IN"; exit 0'));
    const seg = path.join(raiz, 'seg');
    const b = (s) => Buffer.from(s).toString('base64');
    fs.writeFileSync(seg, `EVO_EMAIL=${b('robo@x.com')}\nEVO_PASSWORD=${b("exemplo#$n'ha`=")}\nX_RUIM=${b('rm -rf /')}\nGRUPO_EQUIPE=${b('Equipe $(whoami) ✓')}`, { mode: 0o600 });
    const out = execFileSync('bash', [copia, '--slug', 'teste', '--no-git-pull', '--segredos', seg], { env: { ...process.env, HOME: raiz }, encoding: 'utf8' });
    assert.ok(out.includes("LIDO[robo@x.com][exemplo#$n'ha`=][Equipe $(whoami) ✓]"), out);
    assert.match(out, /nome desconhecido ignorado \(X_RUIM\)/);
    assert.strictEqual(fs.existsSync(seg), false, 'o arquivo de segredos foi apagado');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

const VPS = process.env.SF_TESTE_VPS, VPS_SENHA = process.env.SF_TESTE_VPS_SENHA;
test('NOV-01 nova loja: num servidor de verdade — senha só na 1ª vez, depois a chave; impressão digital conferida; segredos apagados', { skip: !(VPS && VPS_SENHA) && 'sem SF_TESTE_VPS' }, () => comAmbAsync(async (amb, nl) => {
  const [host, portaSsh] = VPS.split(':');
  const d = { ...BOM, host, portaSsh: portaSsh || '22' };
  const linhas = [];
  const comando = `echo "rodando"; ls -l ${nl.ARQ_SEGREDOS_REMOTO} | cut -c1-10; cat ${nl.ARQ_SEGREDOS_REMOTO} | cut -d= -f1; echo "senha ${VPS_SENHA} vazou?"`;
  const r1 = await nl.instalar(d, { senha: VPS_SENHA, segredos: { EVO_PASSWORD: 'exemplo-senha-evo-1', EVO_EMAIL: 'robo@x.com' }, aoLinha: (l) => linhas.push(l), comando });
  assert.ok(r1.ok, JSON.stringify(r1));
  assert.ok(linhas.includes('-rw-------'), 'arquivo de segredos com permissão 600: ' + linhas.join(' | '));
  assert.ok(linhas.includes('EVO_EMAIL') && linhas.includes('EVO_PASSWORD'));
  assert.ok(linhas.includes('senha •••• vazou?'), 'a senha do servidor não aparece no log');
  const log = fs.readFileSync(path.join(nl.DIR, 'marista.log'), 'utf8');
  assert.ok(!log.includes(VPS_SENHA) && !log.includes('exemplo-senha-evo-1'), 'nenhum segredo no log gravado');
  const est = nl.lerEstado('marista');
  assert.ok(est.passos.chave && /^SHA256:/.test(est.impressao));
  assert.ok(!JSON.stringify(est).includes(VPS_SENHA), 'a senha não vai para o estado');
  // 2ª vez: sem senha (usa a chave do painel) e o arquivo de segredos sumiu
  const r2 = await nl.instalar(d, { aoLinha: () => {}, comando: 'echo SEGUNDA' });
  assert.ok(r2.ok && r2.ultimas.includes('SEGUNDA'), JSON.stringify(r2));
  const { con } = await nl.conectar({ host, portaSsh, chavePrivada: nl.chaveDoPainel().privada, impressaoEsperada: nl.lerEstado('marista').impressao });
  try {
    const r = await nl.executar(con, `test -e ${nl.ARQ_SEGREDOS_REMOTO} && echo AINDA_EXISTE || echo APAGADO; date +%Z`, { tempoMs: 15000 });
    assert.ok(r.ultimas.includes('APAGADO'), 'o arquivo de segredos não fica no servidor: ' + r.ultimas.join(' | '));
  } finally { con.end(); }
  // impressão digital diferente → recusa
  const est2 = nl.lerEstado('marista'); est2.impressao = 'SHA256:outra'; fs.writeFileSync(path.join(nl.DIR, 'marista.json'), JSON.stringify(est2));
  const r3 = await nl.instalar(d, { comando: 'echo nao-devia-rodar' });
  assert.strictEqual(r3.ok, false);
  assert.match(r3.erro, /impressão digital do servidor MUDOU/);
  // senha errada na 1ª vez de outra loja
  const r4 = await nl.instalar({ ...d, slug: 'outra' }, { senha: 'errada', comando: 'true' });
  assert.match(r4.erro, /recusados/);
}));

test('NOV-01 setup-novo-studio.sh: nunca mostra segredo na tela (echo/printf de senha, token ou chave)', () => {
  const sh = fs.readFileSync(path.resolve(__dirname, '..', '..', 'setup-novo-studio.sh'), 'utf8');
  const ruins = sh.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*#/.test(l)
    && /\b(echo|printf)\b[^;|&]*\$\{?(EVO_PASSWORD_IN|EVO_TOKEN_IN|ANTHROPIC_IN|EVO_DNS_IN|EVO_EMAIL_IN)\b/.test(l));
  assert.deepStrictEqual(ruins, [], 'linha que mostra segredo: ' + JSON.stringify(ruins));
  assert.doesNotMatch(sh, /DBG\[/, 'sobrou linha de depuração');
});

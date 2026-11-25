/**
 * nova-loja-remoto.js — o "motor" do assistente 🏪 Nova loja (só o painel do Bueno, só admin).
 *
 * Entra por SSH no servidor novo (KVM) e instala uma loja com o MESMO script de sempre
 * (Experimental/setup-novo-studio.sh --tudo), sem o dono abrir terminal. Regras (NOV-01):
 *   • A senha do servidor só é usada para ENTRAR a primeira vez: fica na memória e não é
 *     gravada. Logo depois o painel instala a CHAVE dele no servidor e passa a usar só ela.
 *   • A "impressão digital" do servidor é anotada na primeira conexão; se mudar depois,
 *     o painel recusa entrar (pode ser outro servidor no mesmo IP).
 *   • Os segredos da loja (EVO, IA…) vão num arquivo 600 (`--segredos`), que o script
 *     apaga depois de ler — nunca na linha de comando (apareceria no `ps`) nem no log.
 *   • O estado e o log ficam em data/nova-loja/<apelido>.json|.log, SEM segredos (o log
 *     passa por `mascarar`). Dá para retomar: o script não sobrescreve o que já fez.
 *
 * A tela (passos, progresso) fica em outro arquivo; aqui só as peças e a ordem.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..', 'data', 'nova-loja');
const REPO_URL = 'https://github.com/rrabadan86/SF-Chat_Experimental-Mensagens.git';
const ARQ_SEGREDOS_REMOTO = '/root/.sf-nova-loja-segredos';
const SEGREDOS_ACEITOS = ['EVO_DNS', 'EVO_TOKEN', 'EVO_EMAIL', 'EVO_PASSWORD', 'EVO_ACTIVITY', 'EVO_SERVICE', 'EVO_ACTIVITY_ID', 'EVO_SERVICE_ID', 'ANTHROPIC_API_KEY', 'GRUPO_EQUIPE'];

let _ssh2 = null;
function ssh2() { if (!_ssh2) _ssh2 = require('ssh2'); return _ssh2; }

// ── validação do que o admin digita (tudo vai para um comando de shell) ──────────
const RX = {
  slug: /^[a-z0-9][a-z0-9-]{1,30}$/,
  host: /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i,
  usuario: /^[a-z_][a-z0-9_-]{0,31}$/,
  dominio: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i,
  evoTenant: /^[a-z0-9][a-z0-9_-]{0,40}$/i,
  evoBranch: /^\d{1,5}$/,
  porta: /^\d{2,5}$/,
};
/** Confere os dados da loja/servidor. → lista de erros (vazia = ok), com o campo. */
function validar(d) {
  const e = [];
  const ok = (campo, rx, msg) => { if (!rx.test(String(d[campo] || '').trim())) e.push({ campo, msg }); };
  ok('host', RX.host, 'IP ou endereço do servidor inválido');
  ok('usuario', RX.usuario, 'usuário do servidor inválido');
  ok('slug', RX.slug, 'apelido: minúsculo, sem espaço nem acento (ex.: marista)');
  ok('dominio', RX.dominio, 'endereço do painel inválido (ex.: painel-marista.duckdns.org)');
  ok('evoTenant', RX.evoTenant, 'rede do EVO inválida (está na URL do EVO: .../app/<rede>/<unidade>/)');
  ok('evoBranch', RX.evoBranch, 'número da unidade no EVO inválido');
  if (d.porta !== undefined && d.porta !== '' && !RX.porta.test(String(d.porta))) e.push({ campo: 'porta', msg: 'porta do painel inválida' });
  if (d.portaSsh !== undefined && d.portaSsh !== '' && !RX.porta.test(String(d.portaSsh))) e.push({ campo: 'portaSsh', msg: 'porta SSH inválida' });
  const nome = String(d.studio || '').trim();
  if (!nome || nome.length > 60 || /[\r\n]/.test(nome)) e.push({ campo: 'studio', msg: 'nome da loja: até 60 letras' });
  return e;
}

// Aspas simples do shell: o valor nunca é interpretado (nem $(), crase, ;).
function q(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }

/** Conteúdo do arquivo --segredos: NOME=<base64> por linha (só os nomes aceitos, só os preenchidos). */
function arquivoSegredos(seg) {
  const linhas = [];
  for (const k of SEGREDOS_ACEITOS) {
    const v = seg && seg[k];
    if (v === undefined || v === null || String(v) === '') continue;
    linhas.push(`${k}=${Buffer.from(String(v), 'utf8').toString('base64')}`);
  }
  return linhas.join('\n') + (linhas.length ? '\n' : '');
}

/** Troca cada segredo (e a senha do servidor) por •••• numa linha de log. */
function mascarar(texto, segredos) {
  let t = String(texto == null ? '' : texto);
  const vals = [...new Set((segredos || []).map((x) => String(x || '')).filter((x) => x.length >= 4))].sort((a, b) => b.length - a.length);
  for (const v of vals) t = t.split(v).join('••••');
  return t;
}

/** Pasta da loja no servidor: a 1ª loja na pasta de sempre; outra loja no mesmo servidor, em ~/slimfit-<apelido>. */
function pastaDaLoja(d) { return d.segundaLoja ? `/root/slimfit-${d.slug}` : '/root/SF-Chat_Experimental-Mensagens'; }

/**
 * O comando que instala a loja (roda como root no servidor novo). Tudo que veio do
 * admin já passou por `validar` e ainda vai entre aspas simples.
 */
function comandoInstalacao(d) {
  const pasta = pastaDaLoja(d);
  const flags = ['--tudo', '--slug', q(d.slug), '--studio', q(String(d.studio).trim()), '--install-deps',
    '--evo-tenant', q(d.evoTenant), '--evo-branch', q(d.evoBranch), '--port', q(d.porta || (d.segundaLoja ? '8081' : '8080')),
    '--domain', q(String(d.dominio).toLowerCase()), '--segredos', q(ARQ_SEGREDOS_REMOTO)];
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    // Fuso ANTES de tudo: o pm2 guarda o fuso de quando sobe (Guará: log 3 h adiantado).
    "timedatectl set-timezone America/Sao_Paulo 2>/dev/null || ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime",
    'echo "🕒 Fuso: $(date +%Z) $(date +%H:%M)"',
    'command -v git >/dev/null 2>&1 || { echo "📦 Instalando git…"; apt-get update -qq && apt-get install -y -qq git curl ca-certificates >/dev/null; }',
    `if [ -d ${q(pasta + '/.git')} ]; then echo "📂 Código já baixado em ${pasta.replace(/"/g, '')}"; else echo "📥 Baixando o código…"; git clone -q ${q(REPO_URL)} ${q(pasta)}; fi`,
    `cd ${q(pasta + '/Experimental')}`,
    `bash setup-novo-studio.sh ${flags.join(' ')} </dev/null`,
  ].join('\n');
}

// ── estado e log (sem segredos) ───────────────────────────────────────────────
const arqEstado = (slug) => path.join(DIR, `${slug}.json`);
const arqLog = (slug) => path.join(DIR, `${slug}.log`);
function lerEstado(slug) { try { return JSON.parse(fs.readFileSync(arqEstado(slug), 'utf8')) || null; } catch (_) { return null; } }
function gravarEstado(slug, est) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = arqEstado(slug) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(est, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, arqEstado(slug));
}
function anotarLog(slug, linha) { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(arqLog(slug), linha.replace(/\r/g, '') + '\n', { mode: 0o600 }); }

// ── chave do painel (para não guardar a senha do servidor) ───────────────────
function chaveDoPainel() {
  const priv = path.join(DIR, 'chave-painel'), pub = priv + '.pub';
  if (!fs.existsSync(priv) || !fs.existsSync(pub)) {
    fs.mkdirSync(DIR, { recursive: true });
    const k = ssh2().utils.generateKeyPairSync('ed25519', { comment: 'slimfit-painel-nova-loja' });
    fs.writeFileSync(priv, k.private, { mode: 0o600 });
    fs.writeFileSync(pub, k.public + '\n', { mode: 0o644 });
  }
  return { privada: fs.readFileSync(priv, 'utf8'), publica: fs.readFileSync(pub, 'utf8').trim() };
}

// ── SSH ───────────────────────────────────────────────────────────────────────
const impressaoDe = (chaveHost) => 'SHA256:' + require('crypto').createHash('sha256').update(chaveHost).digest('base64').replace(/=+$/, '');

/**
 * Conecta. Com `impressaoEsperada`, recusa servidor com outra impressão digital.
 * → { con, impressao }
 */
function conectar({ host, portaSsh = 22, usuario = 'root', senha, chavePrivada, impressaoEsperada, tempoMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const { Client } = ssh2();
    const con = new Client();
    let impressao = '', trocou = false;
    const fim = (err) => { try { con.end(); } catch (_) {} reject(err); };
    con.on('ready', () => resolve({ con, impressao }));
    con.on('error', (err) => {
      if (trocou) return fim(new Error('A impressão digital do servidor MUDOU desde a última vez — pode ser outro servidor no mesmo IP. Não entrei.'));
      const m = String(err && err.message || err);
      if (/authentication/i.test(m)) return fim(new Error('Usuário ou senha do servidor recusados.'));
      if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT|Timed out/i.test(m)) return fim(new Error('Não consegui alcançar o servidor (confira o IP e se ele está ligado).'));
      fim(new Error('Falha ao entrar no servidor: ' + m.slice(0, 120)));
    });
    con.connect({
      host: String(host).trim(), port: +portaSsh || 22, username: usuario, readyTimeout: tempoMs,
      ...(chavePrivada ? { privateKey: chavePrivada } : { password: String(senha || '') }),
      hostVerifier: (chaveHost) => {
        impressao = impressaoDe(chaveHost);
        if (impressaoEsperada && impressaoEsperada !== impressao) { trocou = true; return false; }
        return true;
      },
    });
  });
}

/**
 * Roda um comando (bash -s, o script vai pela entrada — não aparece no `ps`), linha a linha.
 * → { codigo, ultimas: [linhas] }
 */
function executar(con, script, { aoLinha, tempoMs = 60 * 60 * 1000, segredos = [] } = {}) {
  return new Promise((resolve, reject) => {
    con.exec('bash -s', (err, st) => {
      if (err) return reject(err);
      const ultimas = []; let resto = { out: '', err: '' };
      const linha = (l) => { const m = mascarar(l, segredos); ultimas.push(m); if (ultimas.length > 60) ultimas.shift(); try { aoLinha && aoLinha(m); } catch (_) {} };
      const pedaco = (qual) => (buf) => {
        const t = resto[qual] + buf.toString('utf8'); const partes = t.split('\n'); resto[qual] = partes.pop();
        for (const p of partes) linha(p);
      };
      const relogio = setTimeout(() => { try { st.close(); } catch (_) {} reject(new Error('A instalação passou do tempo limite.')); }, tempoMs);
      st.on('data', pedaco('out'));
      st.stderr.on('data', pedaco('err'));
      st.on('close', (codigo) => { clearTimeout(relogio); for (const k of ['out', 'err']) if (resto[k]) linha(resto[k]); resolve({ codigo: codigo == null ? -1 : codigo, ultimas }); });
      st.end(script + '\n');
    });
  });
}

/** Grava um arquivo no servidor com permissão 600 (sftp). */
function enviarArquivo(con, caminho, conteudo, modo = 0o600) {
  return new Promise((resolve, reject) => {
    con.sftp((err, sftp) => {
      if (err) return reject(err);
      const w = sftp.createWriteStream(caminho, { mode: modo });
      w.on('error', (e) => { try { sftp.end(); } catch (_) {} reject(e); });
      w.on('close', () => { sftp.chmod(caminho, modo, () => { try { sftp.end(); } catch (_) {} resolve(); }); });
      w.end(conteudo);
    });
  });
}

// ── diagnóstico do servidor ───────────────────────────────────────────────────
const SCRIPT_DIAG = [
  '. /etc/os-release 2>/dev/null; echo "SO=$ID"; echo "VERSAO=$VERSION_ID"',
  'echo "CPUS=$(nproc 2>/dev/null || echo 0)"',
  'echo "RAM_MB=$(awk \'/MemTotal/{print int($2/1024)}\' /proc/meminfo 2>/dev/null)"',
  'echo "DISCO_LIVRE_MB=$(df -Pm / | awk \'NR==2{print $4}\')"',
  'echo "FUSO=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo ?)"',
  'echo "ROOT=$(id -u)"',
  'echo "LOJAS=$(ls -d /root/SF-Chat_Experimental-Mensagens /root/slimfit-* 2>/dev/null | tr \'\\n\' \' \')"',
].join('\n');
function lerDiagnostico(linhas) {
  const o = {};
  for (const l of linhas) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) o[m[1]] = m[2].trim(); }
  return { so: o.SO || '', versao: o.VERSAO || '', cpus: +o.CPUS || 0, ramMb: +o.RAM_MB || 0, discoLivreMb: +o.DISCO_LIVRE_MB || 0, fuso: o.FUSO || '', root: o.ROOT === '0', lojas: String(o.LOJAS || '').split(/\s+/).filter(Boolean) };
}
/** O servidor serve? → { ok, problemas: [texto], avisos: [texto] } */
function avaliarDiagnostico(d, { segundaLoja = false } = {}) {
  const problemas = [], avisos = [];
  if (d.so !== 'ubuntu') problemas.push(`O sistema é "${d.so || '?'}" — precisa ser Ubuntu 22.04 ou 24.04.`);
  else if (!['22.04', '24.04'].includes(d.versao)) avisos.push(`Ubuntu ${d.versao}: o testado é 22.04 ou 24.04.`);
  if (!d.root) problemas.push('O usuário precisa ser o root (administrador) do servidor.');
  if (d.ramMb && d.ramMb < 3500) avisos.push(`Só ${Math.round(d.ramMb / 1024 * 10) / 10} GB de memória: uma loja usa uns 1,5 a 2 GB; abaixo de 4 GB pode ficar lento.`);
  if (segundaLoja && d.ramMb && d.ramMb < 7000) avisos.push('Segunda loja no mesmo servidor com menos de 8 GB de memória: deve ficar apertado.');
  if (d.discoLivreMb && d.discoLivreMb < 10000) problemas.push(`Só ${Math.round(d.discoLivreMb / 1024)} GB livres no disco — precisa de pelo menos 10 GB.`);
  const jaTem = d.lojas.includes('/root/SF-Chat_Experimental-Mensagens');
  if (!segundaLoja && jaTem) avisos.push('Este servidor já tem uma loja instalada: o assistente vai só completar/conferir a instalação que está lá.');
  return { ok: !problemas.length, problemas, avisos };
}

// ── ordem do assistente ───────────────────────────────────────────────────────
/**
 * Instala (ou retoma). `d` = dados da loja (validados), `acesso` = { senha } só na 1ª vez,
 * `segredos` = { EVO_DNS, … } (não são gravados). `aoLinha(texto)` recebe o andamento.
 * → { ok, etapa, erro?, diagnostico?, ultimas? }
 */
async function instalar(d, { senha, segredos = {}, aoLinha = () => {}, comando } = {}) { // comando: só nos testes
  const erros = validar(d);
  if (erros.length) return { ok: false, etapa: 'dados', erro: erros.map((x) => x.msg).join('; ') };
  const slug = d.slug;
  const est = lerEstado(slug) || { slug, criadoEm: Date.now(), passos: {} };
  Object.assign(est, { host: d.host, portaSsh: +d.portaSsh || 22, usuario: d.usuario, dominio: String(d.dominio).toLowerCase(), studio: String(d.studio).trim(), segundaLoja: !!d.segundaLoja, atualizadoEm: Date.now() });
  const mascara = [senha, ...Object.values(segredos)];
  const fala = (t) => { const m = mascarar(t, mascara); anotarLog(slug, `[${new Date().toISOString()}] ${m}`); aoLinha(m); };
  const passo = (nome, info) => { est.passos[nome] = Object.assign({ em: Date.now() }, info || {}); est.atualizadoEm = Date.now(); gravarEstado(slug, est); };
  let con = null;
  try {
    // 1) entrar: com a chave do painel se já instalada; senão com a senha (e instala a chave)
    const chave = chaveDoPainel();
    fala(`🔌 Entrando em ${d.host}…`);
    if (est.passos.chave) {
      ({ con } = await conectar({ host: d.host, portaSsh: d.portaSsh, usuario: d.usuario, chavePrivada: chave.privada, impressaoEsperada: est.impressao }));
    } else {
      if (!senha) return { ok: false, etapa: 'conexao', erro: 'Falta a senha do servidor (só é pedida na primeira vez).' };
      const r = await conectar({ host: d.host, portaSsh: d.portaSsh, usuario: d.usuario, senha, impressaoEsperada: est.impressao });
      con = r.con; est.impressao = r.impressao;
    }
    passo('conexao', { impressao: est.impressao });
    fala(`✅ Conectado (impressão digital ${est.impressao}).`);

    // 2) diagnóstico
    const diag = lerDiagnostico((await executar(con, SCRIPT_DIAG, { tempoMs: 30000 })).ultimas);
    const av = avaliarDiagnostico(diag, { segundaLoja: d.segundaLoja });
    passo('diagnostico', { diag, avaliacao: av });
    fala(`🖥️  Ubuntu ${diag.versao || '?'} · ${diag.cpus} CPU · ${Math.round(diag.ramMb / 102.4) / 10} GB de memória · ${Math.round(diag.discoLivreMb / 1024)} GB livres · fuso ${diag.fuso}`);
    for (const a of av.avisos) fala('⚠️  ' + a);
    if (!av.ok) { for (const p of av.problemas) fala('❌ ' + p); return { ok: false, etapa: 'diagnostico', erro: av.problemas.join(' '), diagnostico: diag }; }

    // 3) chave do painel (a senha não é mais necessária depois disto)
    if (!est.passos.chave) {
      const pub = chave.publica.replace(/'/g, '');
      const r = await executar(con, `set -e; umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; echo CHAVE_OK`, { tempoMs: 30000 });
      if (!r.ultimas.includes('CHAVE_OK')) return { ok: false, etapa: 'chave', erro: 'Não consegui gravar a chave do painel no servidor.' };
      passo('chave');
      fala('🔑 Chave do painel instalada — daqui em diante não preciso mais da senha do servidor.');
    }

    // 4) segredos (arquivo 600, apagado pelo script depois de ler) e instalação
    await enviarArquivo(con, ARQ_SEGREDOS_REMOTO, arquivoSegredos(segredos));
    fala('📦 Instalando (leva de 10 a 25 minutos; o andamento aparece abaixo)…');
    const r = await executar(con, comando || comandoInstalacao(d), { aoLinha: (l) => fala(l), segredos: mascara });
    // se o script parou antes de ler o arquivo, apaga mesmo assim
    try { await executar(con, `rm -f ${q(ARQ_SEGREDOS_REMOTO)}`, { tempoMs: 15000 }); } catch (_) {}
    if (r.codigo !== 0) { passo('instalacao', { ok: false, codigo: r.codigo }); return { ok: false, etapa: 'instalacao', erro: `A instalação parou (código ${r.codigo}). Veja as últimas linhas.`, ultimas: r.ultimas }; }
    passo('instalacao', { ok: true });
    fala('🎉 Instalação concluída.');
    return { ok: true, etapa: 'instalacao', diagnostico: diag, ultimas: r.ultimas };
  } catch (e) {
    fala('❌ ' + (e && e.message || e));
    return { ok: false, etapa: est.passos.conexao ? 'instalacao' : 'conexao', erro: e && e.message || String(e) };
  } finally {
    if (con) try { con.end(); } catch (_) {}
  }
}

module.exports = { validar, q, arquivoSegredos, mascarar, comandoInstalacao, pastaDaLoja, conectar, executar, enviarArquivo, lerDiagnostico, avaliarDiagnostico, instalar, lerEstado, chaveDoPainel, impressaoDe, SCRIPT_DIAG, SEGREDOS_ACEITOS, ARQ_SEGREDOS_REMOTO, DIR };

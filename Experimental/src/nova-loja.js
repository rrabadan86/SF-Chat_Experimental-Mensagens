/**
 * nova-loja.js — coordena o assistente 🏪 Nova loja (Perfis → Nova loja, só admin).
 *
 * Ordem (NOV-01 / NOV-02):
 *   1. confere os dados (EVO pelo link, endereço, apelido);
 *   2. endereço no DuckDNS: aponta para o IP do servidor e espera responder;
 *   3. motor (nova-loja-remoto.js): entra, confere o servidor, instala a chave e solta a
 *      instalação no servidor;
 *   4. a tela acompanha (status) — a instalação segue sozinha mesmo se o painel reiniciar.
 *
 * Uma instalação por apelido de cada vez (trava em memória). A senha do servidor e os
 * segredos da loja só passam por aqui: não ficam em memória depois que o passo termina.
 */
const remoto = require('./nova-loja-remoto');
const duck = require('./nova-loja-duckdns');

const emAndamento = new Map(); // slug → { linhas: [], inicio }
const cacheRemoto = new Map(); // slug → { em, r } (não abrir SSH a cada 2 s)
const MAX_LINHAS = 120;

/** Monta os dados a partir do formulário (campos de texto). → { d, segredos, senha, erros } */
function lerFormulario(f) {
  const s = (k) => String((f && f[k]) || '').trim();
  const evo = remoto.evoDaUrl(s('evoUrl')) || (s('evoTenant') && s('evoBranch') ? { tenant: s('evoTenant'), branch: s('evoBranch') } : null);
  const sub = s('endereco').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const dominio = sub && !sub.includes('.') ? `${sub}.duckdns.org` : sub;
  const d = {
    host: s('host'), portaSsh: s('portaSsh') || '22', usuario: s('usuario') || 'root',
    slug: s('slug').toLowerCase(), studio: s('studio'), dominio,
    evoTenant: evo ? evo.tenant : '', evoBranch: evo ? evo.branch : '',
    segundaLoja: s('segundaLoja') === '1', porta: s('segundaLoja') === '1' ? '8081' : '', contaDuck: s('contaDuck'),
  };
  const erros = remoto.validar(d).map((e) => (e.campo === 'evoTenant' || e.campo === 'evoBranch' ? { campo: 'evoUrl', msg: 'Cole o link do EVO da loja (o endereço que aparece no navegador com o EVO aberto: .../app/<rede>/<número>/...)' } : e.campo === 'dominio' ? { campo: 'endereco', msg: e.msg } : e));
  const unicos = []; for (const e of erros) if (!unicos.some((u) => u.campo === e.campo)) unicos.push(e);
  if (duck.subdominioDe(dominio) && d.contaDuck && !duck.tokenDa(d.contaDuck)) unicos.push({ campo: 'contaDuck', msg: 'Essa conta do DuckDNS ainda não tem o token guardado (veja "Contas do DuckDNS" acima).' });
  const segredos = { EVO_DNS: s('evoDns'), EVO_TOKEN: s('evoToken'), EVO_EMAIL: s('evoEmail'), EVO_PASSWORD: String((f && f.evoSenha) || ''), ANTHROPIC_API_KEY: s('iaChave'), GRUPO_EQUIPE: s('grupoEquipe'), PAINEL_SENHA: String((f && f.painelSenha) || '') };
  if (segredos.PAINEL_SENHA && (segredos.PAINEL_SENHA.length < 8 || /[\r\n]/.test(segredos.PAINEL_SENHA))) unicos.push({ campo: 'painelSenha', msg: 'A senha do painel novo precisa ter pelo menos 8 letras ou números.' });
  return { d, segredos, senha: String((f && f.senha) || ''), erros: unicos };
}

function anotar(slug, linha) {
  const j = emAndamento.get(slug); if (!j) return;
  j.linhas.push(linha); if (j.linhas.length > MAX_LINHAS) j.linhas.shift();
}

/**
 * Começa (ou continua) a instalação em segundo plano. → { ok, slug } | { ok:false, erro, campo }
 * `duckFn`/`remotoFn` só nos testes.
 */
function iniciar(form, { duckFn = duck, remotoFn = remoto } = {}) {
  const { d, segredos, senha, erros } = lerFormulario(form);
  if (erros.length) return { ok: false, erro: erros[0].msg, campo: erros[0].campo, erros };
  const est = remotoFn.lerEstado(d.slug);
  if (!senha && !(est && est.passos && est.passos.chave)) return { ok: false, erro: 'Falta a senha do servidor (só é pedida na primeira vez).', campo: 'senha' };
  if (!segredos.PAINEL_SENHA && !(est && est.passos && est.passos.lancada)) return { ok: false, erro: 'Escolha a senha do painel da loja nova (é com ela que você entra lá, usuário admin).', campo: 'painelSenha' };
  if (est && est.host && est.host !== d.host) return { ok: false, erro: `O apelido "${d.slug}" já foi usado para outro servidor (${est.host}). Escolha outro apelido.`, campo: 'slug' };
  if (emAndamento.has(d.slug) && !emAndamento.get(d.slug).fim) return { ok: false, erro: 'Essa instalação já está em andamento.', campo: 'slug' };
  const job = { linhas: [], inicio: Date.now(), fim: null, resultado: null };
  emAndamento.set(d.slug, job);
  cacheRemoto.delete(d.slug);
  (async () => {
    const fala = (t) => anotar(d.slug, t);
    try {
      const sub = duckFn.subdominioDe(d.dominio);
      if (sub && d.contaDuck) {
        fala(`🌐 Apontando ${d.dominio} para ${d.host} no DuckDNS…`);
        const r = await duckFn.atualizarIp({ token: duckFn.tokenDa(d.contaDuck), subdominio: sub, ip: d.host });
        if (r !== 'OK') { job.resultado = { ok: false, etapa: 'endereco', erro: `O DuckDNS recusou: o endereço "${sub}" não existe nessa conta (crie em duckdns.org → "add domain") ou o token está errado.` }; fala('❌ ' + job.resultado.erro); return; }
        const ok = await duckFn.esperarDns(d.dominio, d.host);
        fala(ok ? `✅ ${d.dominio} já responde com ${d.host}.` : `⚠️  ${d.dominio} ainda não responde com ${d.host} — sigo; o https liga sozinho quando o endereço atualizar.`);
      } else if (sub) fala(`ℹ️  Sem conta do DuckDNS escolhida: confira você mesmo que ${d.dominio} aponta para ${d.host}.`);
      job.resultado = await remotoFn.instalar(d, { senha, segredos, aoLinha: fala });
    } catch (e) {
      job.resultado = { ok: false, etapa: 'erro', erro: e && e.message || String(e) };
      fala('❌ ' + job.resultado.erro);
    } finally { job.fim = Date.now(); }
  })();
  return { ok: true, slug: d.slug };
}

/**
 * Andamento para a tela. Enquanto a parte do painel roda, devolve as linhas dela; depois
 * que a instalação foi solta no servidor, lê o andamento lá (no máximo a cada 5 s).
 */
async function status(slug, { remotoFn = remoto, agora = Date.now() } = {}) {
  const est = remotoFn.lerEstado(slug);
  const job = emAndamento.get(slug);
  const base = { ok: true, slug, studio: est && est.studio, dominio: est && est.dominio, host: est && est.host, passos: (est && est.passos) || {}, painel: job ? { linhas: job.linhas.slice(), terminou: !!job.fim, resultado: job.resultado } : null };
  if (job && !job.fim) return { ...base, fase: 'painel' };
  if (!est) return job ? { ...base, fase: 'painel' } : { ok: false, erro: 'Instalação não encontrada.' };
  if (!est.passos.lancada) return { ...base, fase: job && job.resultado && !job.resultado.ok ? 'parou' : 'nao-iniciada' };
  let c = cacheRemoto.get(slug);
  if (!c || agora - c.em > 5000) { c = { em: agora, r: await remotoFn.acompanhar(slug) }; cacheRemoto.set(slug, c); }
  const r = c.r;
  if (!r.ok) return { ...base, fase: 'sem-contato', erro: r.erro };
  const est2 = remotoFn.lerEstado(slug) || est;
  const fase = r.terminou ? (r.codigo === 0 ? 'concluida' : 'parou') : 'instalando';
  // concluiu e ainda não conferiu: confere sozinho uma vez (liga o aquecimento junto)
  if (fase === 'concluida' && !est2.conferencia && !conferindo.has(slug)) conferir(slug, { remotoFn });
  return { ...base, passos: est2.passos, fase, remoto: { linhas: r.linhas.slice(-MAX_LINHAS), codigo: r.codigo }, conferencia: est2.conferencia || null, conferindo: conferindo.has(slug) };
}

// ── conferência no fim (NOV-03) ──────────────────────────────────────────────
const conferindo = new Map(); // slug → true
/** Começa a conferência em segundo plano (uma por vez por loja). → { ok } */
function conferir(slug, { remotoFn = remoto } = {}) {
  if (conferindo.has(slug)) return { ok: true, jaRodando: true };
  const est = remotoFn.lerEstado(slug);
  if (!est || !est.passos || !est.passos.chave) return { ok: false, erro: 'Esta instalação ainda não começou.' };
  conferindo.set(slug, true);
  Promise.resolve().then(() => remotoFn.conferir(slug)).catch(() => {}).finally(() => conferindo.delete(slug));
  return { ok: true };
}

/** Esquece a parte em memória de uma instalação que já terminou (a tela não precisa mais). */
function limpar(slug) { const j = emAndamento.get(slug); if (j && j.fim) emAndamento.delete(slug); }

module.exports = { lerFormulario, iniciar, status, conferir, limpar, _emAndamento: emAndamento };

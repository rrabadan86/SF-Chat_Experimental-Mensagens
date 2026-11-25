// NOV-01 / NOV-02: assistente 🏪 Nova loja — o coordenador (nova-loja.js) e o endereço
// no DuckDNS (nova-loja-duckdns.js). Sem rede: DuckDNS, DNS e o servidor são de mentira.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { ambienteIsolado } = require('../ajuda');

const FORM = { host: '203.0.113.10', usuario: 'root', senha: 'exemplo-senha-root', studio: 'Studio SlimFit Marista', slug: 'marista', endereco: 'painel-marista', contaDuck: '1', evoUrl: 'https://evo.w12app.com.br/#/app/slimfit/22/inicio', evoEmail: 'robo@x.com', evoSenha: 'exemplo-evo-1', painelSenha: 'exemplo-painel-1' };
const TOKEN = '00000000-0000-0000-0000-000000000000'; // token de exemplo (só zeros)

async function comAmb(fn) { const amb = ambienteIsolado(); try { return await fn(amb); } finally { delete process.env.DUCKDNS_TOKEN_1; delete process.env.DUCKDNS_NOME_1; try { fs.rmSync(amb.raiz, { recursive: true, force: true }); } catch (_) {} } }
const esperar = (cond) => new Promise((ok, falha) => { const t0 = Date.now(); (function v() { if (cond()) return ok(); if (Date.now() - t0 > 3000) return falha(new Error('não terminou')); setTimeout(v, 10); })(); });

test('NOV-02 duckdns: tokens só no .env (nunca para a tela), endereço apontado para o IP e conferido', () => comAmb(async (amb) => {
  const duck = amb.req('nova-loja-duckdns');
  const gravados = {};
  const gravar = (k, v) => { gravados[k] = v; return { ok: true }; };
  assert.throws(() => duck.salvarConta(1, { token: 'não-é-token' }, { gravar }), /não parece do DuckDNS/);
  const c = duck.salvarConta(1, { nome: 'Conta "A"\n', token: TOKEN }, { gravar });
  assert.deepStrictEqual(gravados, { DUCKDNS_NOME_1: 'Conta A', DUCKDNS_TOKEN_1: TOKEN }, 'apelido sem aspas/quebra; token no .env');
  assert.ok(!JSON.stringify(c).includes(TOKEN), 'a lista de contas nunca traz o token');
  assert.deepStrictEqual(c[0], { n: 1, nome: 'Conta A', guardado: true });
  duck.salvarConta(1, { nome: 'Conta A', token: '' }, { gravar: (k, v) => { assert.notStrictEqual(k, 'DUCKDNS_TOKEN_1', 'token em branco mantém o guardado'); return { ok: true }; } });
  assert.strictEqual(duck.tokenDa(1), TOKEN);
  assert.strictEqual(duck.subdominioDe('Painel-Marista.duckdns.org'), 'painel-marista');
  assert.strictEqual(duck.subdominioDe('painel.marista.com.br'), '');
  let pedido = '';
  assert.strictEqual(await duck.atualizarIp({ token: TOKEN, subdominio: 'painel-marista', ip: '203.0.113.10', get: async (u) => { pedido = u; return 'OK'; } }), 'OK');
  assert.match(pedido, /^https:\/\/www\.duckdns\.org\/update\?domains=painel-marista&token=[0-9a-f-]+&ip=203\.0\.113\.10$/);
  assert.strictEqual(await duck.atualizarIp({ token: TOKEN, subdominio: 'painel-marista', ip: '203.0.113.10', get: async () => 'KO' }), 'KO');
  await assert.rejects(duck.atualizarIp({ token: TOKEN, subdominio: 'x', ip: 'servidor.com', get: async () => 'OK' }), /pelo IP/);
  let n = 0;
  assert.strictEqual(await duck.esperarDns('painel-marista.duckdns.org', '203.0.113.10', { resolver: async () => (++n < 3 ? ['198.51.100.1'] : ['203.0.113.10']), dormir: async () => {} }), true);
  assert.strictEqual(await duck.esperarDns('x.duckdns.org', '203.0.113.10', { tempoMs: 0, resolver: async () => { throw new Error('NXDOMAIN'); }, dormir: async () => {} }), false);
}));

test('NOV-01 nova loja: o formulário vira dados conferidos (EVO pelo link, endereço do DuckDNS) e aponta o campo com erro', () => comAmb(async (amb) => {
  process.env.DUCKDNS_TOKEN_1 = TOKEN;
  const nl = amb.req('nova-loja');
  const r = nl.lerFormulario(FORM);
  assert.deepStrictEqual(r.erros, []);
  assert.strictEqual(r.d.dominio, 'painel-marista.duckdns.org');
  assert.deepStrictEqual([r.d.evoTenant, r.d.evoBranch, r.d.porta], ['slimfit', '22', '']);
  assert.strictEqual(r.segredos.EVO_PASSWORD, 'exemplo-evo-1');
  assert.strictEqual(nl.lerFormulario({ ...FORM, segundaLoja: '1' }).d.porta, '8081');
  assert.strictEqual(nl.lerFormulario({ ...FORM, evoUrl: 'https://evo.com/' }).erros[0].campo, 'evoUrl');
  assert.strictEqual(nl.lerFormulario({ ...FORM, slug: 'Loja Nova' }).erros[0].campo, 'slug');
  assert.strictEqual(nl.lerFormulario({ ...FORM, endereco: 'painel marista' }).erros[0].campo, 'endereco');
  delete process.env.DUCKDNS_TOKEN_1;
  assert.strictEqual(nl.lerFormulario(FORM).erros[0].campo, 'contaDuck', 'conta sem token guardado');
}));

test('NOV-01 nova loja: endereço primeiro, depois o servidor; DuckDNS recusou = não entra no servidor; uma instalação por vez', () => comAmb(async (amb) => {
  process.env.DUCKDNS_TOKEN_1 = TOKEN;
  const nl = amb.req('nova-loja');
  const ordem = [];
  const duckFn = { subdominioDe: (d) => d.replace(/\.duckdns\.org$/, ''), tokenDa: () => TOKEN, atualizarIp: async (o) => { ordem.push('duck:' + o.subdominio + '>' + o.ip); return 'OK'; }, esperarDns: async () => { ordem.push('dns'); return true; } };
  let liberar; const segura = new Promise((r) => { liberar = r; });
  const remotoFn = { lerEstado: () => null, instalar: async (d, o) => { ordem.push('instalar:' + d.slug + ':' + (o.senha ? 'com-senha' : 'sem')); assert.strictEqual(o.segredos.EVO_PASSWORD, 'exemplo-evo-1'); await segura; return { ok: true, etapa: 'rodando' }; } };
  assert.deepStrictEqual(nl.iniciar(FORM, { duckFn, remotoFn }), { ok: true, slug: 'marista' });
  await esperar(() => ordem.length === 3);
  assert.strictEqual(nl.iniciar(FORM, { duckFn, remotoFn }).erro, 'Essa instalação já está em andamento.');
  liberar();
  await esperar(() => nl._emAndamento.get('marista').fim);
  assert.deepStrictEqual(ordem, ['duck:painel-marista>203.0.113.10', 'dns', 'instalar:marista:com-senha']);
  const st = await nl.status('marista', { remotoFn });
  assert.strictEqual(st.fase, 'painel', 'sem estado gravado ainda, mostra o que o painel fez');
  assert.ok(st.painel.linhas.some((l) => /aponta|Apontando/.test(l)));
  // DuckDNS recusou: não entra no servidor
  const ordem2 = [];
  nl.iniciar({ ...FORM, slug: 'outra' }, { duckFn: { ...duckFn, atualizarIp: async () => 'KO' }, remotoFn: { lerEstado: () => null, instalar: async () => { ordem2.push('instalar'); return { ok: true }; } } });
  await esperar(() => nl._emAndamento.get('outra').fim);
  assert.deepStrictEqual(ordem2, []);
  assert.match(nl._emAndamento.get('outra').resultado.erro, /não existe nessa conta/);
  // sem senha só dá para continuar uma instalação que já tem a chave
  assert.strictEqual(nl.iniciar({ ...FORM, slug: 'nova', senha: '' }, { duckFn, remotoFn }).campo, 'senha');
  assert.strictEqual(nl.iniciar({ ...FORM, slug: 'x2', host: '203.0.113.99' }, { duckFn, remotoFn: { lerEstado: () => ({ host: '203.0.113.10', passos: {} }) } }).campo, 'slug', 'apelido já usado em outro servidor');
}));

test('NOV-01 nova loja: andamento — instalando, concluída, parou e sem contato (lê no servidor no máximo a cada 5 s)', () => comAmb(async (amb) => {
  const nl = amb.req('nova-loja');
  let est = { slug: 'marista', studio: 'Studio SlimFit Marista', dominio: 'painel-marista.duckdns.org', host: '203.0.113.10', passos: { chave: {}, lancada: {} } };
  let leituras = 0, resp = { ok: true, terminou: false, codigo: null, linhas: ['📦 instalando'] };
  const remotoFn = { lerEstado: () => est, acompanhar: async () => { leituras++; return resp; } };
  assert.strictEqual((await nl.status('marista', { remotoFn, agora: 1000 })).fase, 'instalando');
  await nl.status('marista', { remotoFn, agora: 3000 });
  assert.strictEqual(leituras, 1, 'dentro de 5 s usa a leitura guardada');
  resp = { ok: true, terminou: true, codigo: 0, linhas: ['fim'] };
  const fim = await nl.status('marista', { remotoFn, agora: 7000 });
  assert.deepStrictEqual([fim.fase, fim.remoto.linhas], ['concluida', ['fim']]);
  resp = { ok: true, terminou: true, codigo: 1, linhas: ['❌'] };
  assert.strictEqual((await nl.status('marista', { remotoFn, agora: 13000 })).fase, 'parou');
  resp = { ok: false, erro: 'Não consegui alcançar o servidor' };
  const sc = await nl.status('marista', { remotoFn, agora: 19000 });
  assert.deepStrictEqual([sc.fase, sc.erro], ['sem-contato', 'Não consegui alcançar o servidor']);
  est = { ...est, passos: {} };
  assert.strictEqual((await nl.status('marista', { remotoFn, agora: 25000 })).fase, 'nao-iniciada');
  assert.strictEqual((await nl.status('nada', { remotoFn: { lerEstado: () => null } })).ok, false);
}));

test('NOV-03 conferência: lê o resultado do servidor em itens ✅/❌ com o que fazer', () => comAmb(async (amb) => {
  const nl = amb.req('nova-loja-remoto');
  const seg = { ok: true, segmentos: amb.req('conferir-segmentos').avaliar(['Clientes Ativos', 'Vencimento de contrato semana atual', 'Aniversariantes', 'Com débito pendente']) };
  const itens = nl.lerConferencia(['@@CHECK', '   ✅ EVO_EMAIL ok', '   ❌ ANTHROPIC_API_KEY vazio — a SoFIA não responde.', '@@PM2', 'PM2 marista-painel online', 'PM2 marista-exp online', 'PM2 marista-sofia online', 'PM2 marista-form errored',
    '@@IA', 'IA=vazia', '@@SEG', 'SEGMENTOS_JSON=' + JSON.stringify(seg), '@@AQ', 'AQ=ligado', '@@FIM@@']);
  const por = Object.fromEntries(itens.map((i) => [i.id, i]));
  assert.strictEqual(por.check.ok, false); assert.match(por.check.detalhe, /ANTHROPIC_API_KEY vazio/);
  assert.strictEqual(por.pm2.ok, false); assert.match(por.pm2.detalhe, /marista-form \(errored\)/);
  assert.strictEqual(por.ia.ok, false); assert.match(por.ia.detalhe, /Credenciais/);
  assert.strictEqual(por['seg-vencimento'].ok, true);
  assert.strictEqual(por['seg-aniversariantes'].ok, true);
  assert.strictEqual(por['seg-debito'].ok, false, '"Com débito pendente" não é o nome exato que a cobrança procura');
  assert.match(por['seg-debito'].detalhe, /Com débito: Sim/);
  assert.strictEqual(por.aquecimento.ok, true);
  assert.deepStrictEqual(nl.lerConferencia(['@@SEM_PASTA']).map((i) => i.ok), [false]);
  const semEvo = nl.lerConferencia(['@@SEG', 'SEGMENTOS_JSON={"ok":false,"erro":"Senha do EVO recusada antes — o robô não tenta de novo."}']);
  assert.match(semEvo.find((i) => i.id === 'evo').detalhe, /recusada/);
}));

test('NOV-03 conferência: o script só lê, não leva segredo na linha de comando e só liga o aquecimento quando pedido', () => comAmb(async (amb) => {
  const nl = amb.req('nova-loja-remoto');
  const est = { slug: 'marista', segundaLoja: false };
  const sc = nl.scriptConferencia(est, { ligarAquecimento: true });
  assert.match(sc, /setup-novo-studio\.sh --slug 'marista' --check --no-git-pull/);
  assert.match(sc, /node src\/conferir-segmentos\.js/);
  assert.match(sc, /a\.gravar\(d,7\)/, 'aquecimento de 7 dias');
  assert.doesNotMatch(sc, /x-api-key: \$|curl/, 'a chave da IA é lida pelo node, não vai na linha de comando');
  assert.match(nl.scriptConferencia(est, { ligarAquecimento: false }), /AQ=nao-pedido/);
  assert.match(nl.scriptConferencia({ slug: 'ls2', segundaLoja: true }), /cd '\/root\/slimfit-ls2\/Experimental'/);
  // conferir-segmentos: mesmos nomes que os jobs procuram
  const av = amb.req('conferir-segmentos').avaliar(['VENCIMENTO DE CONTRATO SEMANAL', 'aniversariantes do mês', 'Com  Débito']);
  assert.deepStrictEqual(av.map((x) => x.achado), [true, true, true]);
}));

test('NOV-03 conferência: concluiu → confere sozinha uma vez; o botão não roda duas ao mesmo tempo', () => comAmb(async (amb) => {
  const nl = amb.req('nova-loja');
  let est = { slug: 'marista', dominio: 'painel-marista.duckdns.org', passos: { chave: {}, lancada: {} } };
  let conferencias = 0, solta;
  const remotoFn = { lerEstado: () => est, acompanhar: async () => ({ ok: true, terminou: true, codigo: 0, linhas: [] }), conferir: async () => { conferencias++; await new Promise((r) => { solta = r; }); est = { ...est, conferencia: { em: 1, itens: [{ id: 'https', ok: true }] } }; return { ok: true }; } };
  const s1 = await nl.status('marista', { remotoFn, agora: 1 });
  assert.strictEqual(s1.fase, 'concluida');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(conferencias, 1, 'começou a conferir sozinha');
  assert.strictEqual(nl.conferir('marista', { remotoFn }).jaRodando, true);
  assert.strictEqual((await nl.status('marista', { remotoFn, agora: 10000 })).conferindo, true);
  solta(); await new Promise((r) => setTimeout(r, 10));
  const s2 = await nl.status('marista', { remotoFn, agora: 20000 });
  assert.deepStrictEqual([s2.conferindo, s2.conferencia.itens[0].id, conferencias], [false, 'https', 1], 'não confere de novo sozinha');
}));

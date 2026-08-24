require('./ambiente');
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const agendaFalsa = {
  async ocupados() { return []; },
  async eventos() { return { consultas: [], bloqueios: [] }; },
  async contaDeServico() { return 'x@y.iam.gserviceaccount.com'; },
};
const caminho = require.resolve('../src/google-agenda');
require.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports: agendaFalsa, children: [], paths: [] };

const { app } = require('../src/server');
const dados = require('../src/dados');

let servidor, base;
before(async () => {
  dados.alterar((c) => {
    c.medico = { nome: 'Dr. Felipe Oliveira', crm: 'CRM-GO 00.000', especialidade: 'Oncologia Clínica' };
    c.hospitais[0].endereco = 'Av. T-9, 1000 — Setor Bueno';
    c.hospitais[0].nome = 'INGOH';
  });
  await new Promise((r) => { servidor = app.listen(0, r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const pegar = async (caminho) => {
  const r = await fetch(base + caminho);
  return { status: r.status, tipo: r.headers.get('content-type'), html: await r.text() };
};

/** Só o que existe no HTML entregue — sem JavaScript, como o buscador lê. */
function textoVisivel(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('o conteúdo do médico vem no HTML, sem depender de JavaScript', async () => {
  const { html } = await pegar('/');
  const texto = textoVisivel(html);

  assert.match(texto, /Cuidado oncológico com tempo para ouvir você/);
  assert.match(texto, /Sou oncologista clínico/);          // parágrafo do sobre
  assert.match(texto, /Residência em Oncologia Clínica/);  // formação
  assert.match(texto, /Mama/);                             // áreas
  assert.match(texto, /INGOH/);                            // local
  assert.match(texto, /Meu horário já está garantido/);    // dúvidas
});

test('o h1 tem o título de verdade, não um espaço vazio', async () => {
  const { html } = await pegar('/');
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(h1, 'a página precisa ter um h1');
  assert.match(h1[1].trim(), /\S{10,}/);
});

test('título e descrição saem do que o médico cadastrou', async () => {
  const { html } = await pegar('/');
  assert.match(html, /<title>Dr\. Felipe Oliveira — Oncologia Clínica<\/title>/);
  const desc = html.match(/<meta name="description" content="([^"]+)"/);
  assert.ok(desc && desc[1].length > 60, 'descrição precisa ser útil');
  assert.match(desc[1], /Dr\. Felipe Oliveira/);
});

test('Open Graph preenchido, para o link ficar apresentável quando compartilhado', async () => {
  const { html } = await pegar('/');
  for (const p of ['og:type', 'og:title', 'og:description', 'og:url', 'og:locale']) {
    assert.match(html, new RegExp(`property="${p}"`), `faltou ${p}`);
  }
  assert.match(html, /<link rel="canonical"/);
});

test('dados estruturados descrevem um médico, com local e horários', async () => {
  const { html } = await pegar('/');
  const bloco = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(bloco, 'faltou o JSON-LD');

  const dados = JSON.parse(bloco[1]);
  assert.equal(dados['@type'], 'Physician');
  assert.equal(dados.name, 'Dr. Felipe Oliveira');
  assert.equal(dados.medicalSpecialty, 'Oncologia Clínica');
  assert.ok(dados.availableService.length, 'as áreas de atuação viram serviços');

  const local = dados.location[0];
  assert.equal(local['@type'], 'MedicalClinic');
  assert.equal(local.address.streetAddress, 'Av. T-9, 1000 — Setor Bueno');
  assert.ok(local.openingHoursSpecification[0].opens, 'horário de atendimento no schema');
});

test('a ordem das seções no HTML é a que o médico escolheu', async () => {
  dados.alterar((c) => { c.pagina.ordem = ['agendar', 'sobre', 'locais', 'duvidas']; });
  const { html } = await pegar('/');
  const ordem = [...html.matchAll(/<section id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['agendar', 'sobre', 'locais', 'duvidas']);

  dados.alterar((c) => { c.pagina.ordem = ['sobre', 'locais', 'agendar', 'duvidas']; });
});

test('seção oculta não aparece nem no HTML', async () => {
  dados.alterar((c) => { c.pagina.ocultas = ['duvidas']; });
  const { html } = await pegar('/');
  assert.ok(!html.includes('<section id="duvidas"'));
  assert.ok(!textoVisivel(html).includes('Meu horário já está garantido'));
  dados.alterar((c) => { c.pagina.ocultas = []; });
});

test('o formulário de agendamento vem no HTML, com os locais listados', async () => {
  const { html } = await pegar('/');
  assert.match(html, /id="pickLocal"/);
  assert.match(html, /data-loc="h1"/);
  assert.match(html, /id="f-nome"/);
  assert.match(html, /id="locais-json"/);
});

test('texto do paciente é escapado, não injetado', async () => {
  dados.alterar((c) => { c.pagina.hero.titulo = 'Cuidado <script>alert(1)</script> oncológico'; });
  const { html } = await pegar('/');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  dados.alterar((c) => { c.pagina.hero.titulo = 'Cuidado oncológico com tempo para ouvir você.'; });
});

test('sitemap e robots respondem', async () => {
  const mapa = await pegar('/sitemap.xml');
  assert.equal(mapa.status, 200);
  assert.match(mapa.tipo, /xml/);
  assert.match(mapa.html, /<loc>http/);

  const robots = await pegar('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.html, /Disallow: \/admin/);
});

test('a frase de destaque só aparece quando existe', async () => {
  dados.alterar((c) => {
    c.pagina.destaque = { frase: 'Ninguém deveria sair do consultório sem entender.', autoria: 'Dr. Felipe' };
  });
  const com = await pegar('/');
  assert.match(com.html, /<aside class="destaque">/);
  assert.match(com.html, /Ninguém deveria sair do consultório sem entender\./);
  assert.match(com.html, /<cite>Dr\. Felipe<\/cite>/);

  dados.alterar((c) => { c.pagina.destaque = { frase: '', autoria: '' }; });
  const sem = await pegar('/');
  assert.ok(!sem.html.includes('<aside class="destaque">'));
});

test('a frase sem assinatura não deixa <cite> vazio', async () => {
  dados.alterar((c) => { c.pagina.destaque = { frase: 'Uma frase só.', autoria: '' }; });
  const { html } = await pegar('/');
  assert.match(html, /Uma frase só\./);
  assert.ok(!html.includes('<cite>'));
});

test('/admin serve o painel (index:false não pode derrubá-lo)', async () => {
  for (const rota of ['/admin', '/admin/']) {
    const r = await pegar(rota);
    assert.equal(r.status, 200, rota);
    assert.match(r.html, /id="senha"/);
  }
});

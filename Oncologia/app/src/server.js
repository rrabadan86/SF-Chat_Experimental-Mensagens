/**
 * server.js — o servidor web.
 *
 * Rotas públicas (o navegador do paciente):
 *   GET  /api/hospitais                     lista para a tela 1
 *   GET  /api/horarios?hospital=h1&dias=8   grade já descontando o ocupado
 *   POST /api/agendar                       cria o pré-agendamento
 *
 * Rotas de serviço:
 *   GET|POST /webhook/whatsapp              respostas da recepcionista (driver cloud)
 *   POST     /tarefas/cobrar-pendentes      cobrança das 24h (cron externo)
 *   GET      /saude                         health check
 *
 * A credencial do Google e o número da recepcionista NUNCA chegam ao navegador.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');

const config = require('./config');
const wa = require('./whatsapp');
const servico = require('./agendamento');
const auth = require('./auth');
const rotasAdmin = require('./rotas-admin');
const render = require('./render');
const dados = require('./dados');

const app = express();
app.set('trust proxy', 1);
/**
 * Corpo em JSON, pequeno de propósito: as rotas do paciente recebem um
 * formulário, não um arquivo. A exceção é o envio da foto, que tem o próprio
 * limite maior definido na rota — por isso ela precisa escapar deste parser,
 * senão o corpo é recusado aqui antes de chegar lá.
 */
const CORPO_GRANDE = ['/admin/api/foto'];
const corpoPequeno = express.json({ limit: '32kb' });
app.use((req, res, next) => (
  CORPO_GRANDE.includes(req.path) ? next() : corpoPequeno(req, res, next)
));
/**
 * A página do paciente é montada no servidor, não no navegador.
 *
 * Assim o HTML já sai com o conteúdo que o médico editou — título, textos,
 * locais, perguntas — e o buscador lê tudo no primeiro acesso. O JavaScript
 * fica só para o formulário de agendamento.
 */
function enderecoDoSite(req) {
  const configurado = process.env.SITE_URL;
  if (configurado) return configurado.replace(/\/$/, '');
  const protocolo = req.get('x-forwarded-proto') || req.protocol;
  return `${protocolo}://${req.get('host')}`;
}

app.get('/', (req, res) => {
  const c = dados.ler();
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.type('html').send(render.paginaCompleta({
    pagina: c.pagina,
    medico: c.medico,
    hospitais: config.hospitais,
    url: enderecoDoSite(req),
  }));
});

app.get('/sitemap.xml', (req, res) => {
  const url = enderecoDoSite(req);
  const atualizado = (dados.ler().atualizadoEm || new Date().toISOString()).slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url}/</loc><lastmod>${atualizado}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`);
});

// index:false para o arquivo estático não passar na frente da página montada
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], index: false }));

// a foto que o médico enviou pelo painel
const PASTA_MIDIA = process.env.MIDIA_DIR || path.join(__dirname, '..', 'dados', 'midia');
fs.mkdirSync(PASTA_MIDIA, { recursive: true });
app.use('/midia', express.static(PASTA_MIDIA, { maxAge: '7d' }));

// painel do médico: a API exige sessão (ver rotas-admin.js)
app.use('/admin/api', rotasAdmin);

/** Freio simples por IP: dá conta de robô bobo sem precisar de Redis. */
const janelas = new Map();
function limitar(maximo, porMs) {
  return (req, res, next) => {
    const agora = Date.now();
    const chave = `${req.ip}:${req.path}`;
    const marcas = (janelas.get(chave) || []).filter((m) => agora - m < porMs);
    if (marcas.length >= maximo) {
      return res.status(429).json({ erro: 'Muitas tentativas seguidas. Espere um minuto.' });
    }
    marcas.push(agora);
    janelas.set(chave, marcas);
    next();
  };
}
setInterval(() => janelas.clear(), 10 * 60000).unref();

/** Conteúdo do site: textos, foto, ordem das seções. Público, é o que o paciente vê. */
app.get('/api/pagina', (_req, res) => {
  const c = require('./dados').ler();
  res.json({ pagina: c.pagina, medico: c.medico });
});

app.get('/api/hospitais', (_req, res) => {
  res.json({ hospitais: config.hospitais.map(servico.resumoHospital), medico: config.medico });
});

app.get('/api/horarios', async (req, res) => {
  try {
    const dias = Math.min(Math.max(Number(req.query.dias) || 8, 1), 20);
    res.json(await servico.horariosDisponiveis(String(req.query.hospital || ''), dias));
  } catch (e) {
    responderErro(res, e);
  }
});

app.post('/api/agendar', limitar(5, 60000), async (req, res) => {
  try {
    res.json({ ok: true, ...(await servico.agendar(req.body)) });
  } catch (e) {
    responderErro(res, e);
  }
});

/** Verificação do webhook exigida pela Meta na hora de cadastrar a URL. */
app.get('/webhook/whatsapp', (req, res) => {
  const esperado = process.env.WA_CLOUD_VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === esperado) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);                       // a Meta quer o 200 na hora
  try {
    if (wa.processarWebhook) await wa.processarWebhook(req.body);
  } catch (e) {
    console.error('[webhook] falhou:', e.message);
  }
});

app.post('/tarefas/cobrar-pendentes', async (req, res) => {
  if (process.env.TAREFAS_TOKEN && req.get('x-tarefas-token') !== process.env.TAREFAS_TOKEN) {
    return res.sendStatus(403);
  }
  try {
    res.json({ cobrados: await servico.cobrarPendentes() });
  } catch (e) {
    responderErro(res, e);
  }
});

app.get('/saude', (_req, res) => {
  res.json({
    ok: true,
    whatsapp: wa.nome,
    hospitais: config.hospitais.length,
    painel: Boolean(process.env.ADMIN_SENHA_HASH),
  });
});

// erro do parser de JSON (corpo grande, JSON quebrado) vira resposta em JSON,
// senão o Express devolve uma página HTML que a tela não consegue ler
app.use((erro, req, res, next) => {
  if (erro && erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Conteúdo grande demais para enviar.', codigo: 'muito_grande' });
  }
  if (erro && erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Não entendi os dados enviados.', codigo: 'json_invalido' });
  }
  return next(erro);
});

function responderErro(res, e) {
  if (e instanceof servico.ErroDeAgendamento) {
    const status = e.codigo === 'validacao' ? 400 : (e.codigo === 'horario_ocupado' ? 409 : 400);
    return res.status(status).json({ erro: e.message, codigo: e.codigo, erros: e.erros });
  }
  console.error('[erro]', e);
  res.status(500).json({ erro: 'Não consegui completar agora. Tente de novo em instantes.', codigo: 'interno' });
}

async function iniciar() {
  // o WhatsApp sobe em paralelo: um agendamento gravado na agenda vale mais do
  // que o aviso, e sem sessão salva o cliente ficaria esperando um QR para
  // sempre. Se falhar, o painel mostra a situação e o log registra.
  wa.iniciar().catch((e) => console.error(`[wa] início falhou: ${e.message}`));
  wa.aoReceber((msg) => servico.tratarRespostaRecepcao(msg));
  app.listen(config.porta, config.host, () => {
    console.log(`[web] http://${config.host}:${config.porta}  (WhatsApp: ${wa.nome})`);
    console.log(`[web] painel do médico: http://localhost:${config.porta}/admin`);
    const locais = config.hospitais;
    if (!locais.length) {
      console.log('      nenhum local ativo ainda — cadastre pelo painel');
    }
    for (const h of locais) console.log(`      ${h.nome} -> ${h.calendarId}`);
    if (!process.env.ADMIN_SENHA_HASH) {
      console.log('      [!] painel sem senha: rode "npm run senha" e preencha o .env');
    }
  });
}

if (require.main === module) {
  iniciar().catch((e) => { console.error('Não subiu:', e.message); process.exit(1); });
}

module.exports = { app, iniciar };

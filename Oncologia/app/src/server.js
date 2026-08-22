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
const express = require('express');

const config = require('./config');
const wa = require('./whatsapp');
const servico = require('./agendamento');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

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
  res.json({ ok: true, whatsapp: wa.nome, hospitais: config.hospitais.length });
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
  await wa.iniciar();
  wa.aoReceber((msg) => servico.tratarRespostaRecepcao(msg));
  app.listen(config.porta, () => {
    console.log(`[web] http://localhost:${config.porta}  (WhatsApp: ${wa.nome})`);
    for (const h of config.hospitais) console.log(`      ${h.nome} -> ${h.calendarId}`);
  });
}

if (require.main === module) {
  iniciar().catch((e) => { console.error('Não subiu:', e.message); process.exit(1); });
}

module.exports = { app, iniciar };

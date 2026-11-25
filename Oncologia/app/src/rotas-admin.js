/**
 * rotas-admin.js — a API do painel do médico.
 *
 * Tudo aqui exige sessão, menos entrar. As respostas devolvem a configuração
 * inteira depois de cada mudança, para a tela nunca ficar mostrando um estado
 * que não é o que está gravado.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dados = require('./dados');
const auth = require('./auth');
const agenda = require('./google-agenda');
const servico = require('./agendamento');

const router = express.Router();
const seguro = process.env.NODE_ENV === 'production';

function ip(req) { return req.ip || req.connection?.remoteAddress || 'desconhecido'; }

// ------------------------------------------------------------------- entrar

router.post('/entrar', (req, res) => {
  if (!auth.podeTentar(ip(req))) {
    return res.status(429).json({ erro: 'Muitas tentativas. Espere 15 minutos.', codigo: 'bloqueado' });
  }
  const guardado = process.env.ADMIN_SENHA_HASH;
  if (!guardado) {
    return res.status(500).json({
      erro: 'O painel ainda não tem senha configurada. Rode "npm run senha" e preencha o .env.',
      codigo: 'sem_senha',
    });
  }
  if (!auth.conferirSenha(req.body?.senha, guardado)) {
    auth.registrarFalha(ip(req));
    return res.status(401).json({ erro: 'Senha incorreta.', codigo: 'senha_errada' });
  }
  auth.limparTentativas(ip(req));
  auth.definirCookie(res, auth.criarToken(), seguro);
  res.json({ ok: true, horas: auth.VALIDADE_HORAS });
});

router.post('/sair', (req, res) => {
  auth.limparCookie(res);
  res.json({ ok: true });
});

router.get('/sessao', (req, res) => {
  res.json({ autenticado: auth.estaAutenticado(req) });
});

// ------------------------------------------------- daqui para baixo, com sessão

router.use(auth.exigirSessao);

router.get('/config', async (req, res) => {
  res.json({ config: dados.ler(), contaDeServico: await agenda.contaDeServico() });
});

/** Dados gerais: médico e recepção. */
router.put('/config', (req, res) => {
  const { ok, erros, dados: novos } = dados.validarGerais(req.body);
  if (!ok) return res.status(400).json({ erro: 'Confira os campos destacados.', erros });
  res.json({ ok: true, config: dados.alterar((c) => Object.assign(c, novos)) });
});

router.post('/hospitais', (req, res) => {
  const atual = dados.ler();
  const { ok, erros, hospital } = dados.validarHospital(req.body, { existentes: atual.hospitais });
  if (!ok) return res.status(400).json({ erro: 'Confira os campos destacados.', erros });
  res.json({ ok: true, hospital, config: dados.alterar((c) => { c.hospitais.push(hospital); }) });
});

router.put('/hospitais/:id', (req, res) => {
  const atual = dados.ler();
  const indice = atual.hospitais.findIndex((h) => h.id === req.params.id);
  if (indice < 0) return res.status(404).json({ erro: 'Local não encontrado.' });

  const { ok, erros, hospital } = dados.validarHospital(req.body, {
    existentes: atual.hospitais, id: req.params.id,
  });
  if (!ok) return res.status(400).json({ erro: 'Confira os campos destacados.', erros });
  res.json({ ok: true, hospital, config: dados.alterar((c) => { c.hospitais[indice] = hospital; }) });
});

/**
 * Ligar e desligar em vez de apagar.
 *
 * Desligado, o local some do formulário na hora, mas as consultas que já estão
 * na agenda continuam existindo e o histórico não se perde. Apagar de vez só
 * quando ele pedir explicitamente, e mesmo assim os eventos no Google ficam.
 */
router.post('/hospitais/:id/ativo', (req, res) => {
  const ligado = req.body?.ativo !== false;
  const atual = dados.ler();
  if (!atual.hospitais.some((h) => h.id === req.params.id)) {
    return res.status(404).json({ erro: 'Local não encontrado.' });
  }
  res.json({
    ok: true,
    config: dados.alterar((c) => {
      c.hospitais.find((h) => h.id === req.params.id).ativo = ligado;
    }),
  });
});

router.delete('/hospitais/:id', (req, res) => {
  const atual = dados.ler();
  if (!atual.hospitais.some((h) => h.id === req.params.id)) {
    return res.status(404).json({ erro: 'Local não encontrado.' });
  }
  res.json({
    ok: true,
    config: dados.alterar((c) => {
      c.hospitais = c.hospitais.filter((h) => h.id !== req.params.id);
    }),
  });
});

// ------------------------------------------------------------ conteúdo do site

router.get('/pagina', (req, res) => {
  res.json({ pagina: dados.ler().pagina, secoes: require('./pagina').SECOES });
});

router.put('/pagina', (req, res) => {
  const { ok, erros, pagina } = dados.validarPagina(req.body);
  if (!ok) return res.status(400).json({ erro: 'Confira os campos destacados.', erros });
  res.json({ ok: true, pagina: dados.alterar((c) => { c.pagina = pagina; }).pagina });
});

/**
 * Foto do médico.
 *
 * Chega como data URL porque o navegador já redimensionou a imagem antes de
 * enviar — isso evita trazer um multipart parser e uma biblioteca de imagem
 * para o servidor só por causa de um retrato que muda uma vez por ano.
 */
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PASTA_MIDIA = process.env.MIDIA_DIR || path.join(path.resolve(__dirname, '..'), 'dados', 'midia');

router.post('/foto', express.json({ limit: '6mb' }), (req, res) => {
  const dataUrl = String(req.body?.imagem || '');
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ erro: 'Envie uma imagem válida.' });

  const extensao = TIPOS[m[1]];
  if (!extensao) return res.status(400).json({ erro: 'Use uma imagem JPG, PNG ou WEBP.' });

  const conteudo = Buffer.from(m[2], 'base64');
  if (conteudo.length > 4 * 1024 * 1024) {
    return res.status(413).json({ erro: 'Imagem grande demais. Tente uma foto menor.' });
  }

  fs.mkdirSync(PASTA_MIDIA, { recursive: true });
  const nome = `foto-${crypto.randomBytes(6).toString('hex')}.${extensao}`;
  fs.writeFileSync(path.join(PASTA_MIDIA, nome), conteudo);

  const url = `/midia/${nome}`;
  const config = dados.alterar((c) => { c.pagina.hero.foto = url; });

  // a foto anterior não serve mais para ninguém
  limparFotosAntigas(nome);

  res.json({ ok: true, url, pagina: config.pagina });
});

function limparFotosAntigas(manter) {
  try {
    for (const arquivo of fs.readdirSync(PASTA_MIDIA)) {
      if (arquivo.startsWith('foto-') && arquivo !== manter) {
        fs.rmSync(path.join(PASTA_MIDIA, arquivo), { force: true });
      }
    }
  } catch { /* pasta sumiu ou sem permissão: não é motivo para falhar o upload */ }
}

// --------------------------------------------------------------- indicadores

const metricas = require('./metricas');

/**
 * Recomeça a contagem do zero. Guarda uma cópia antes — ver metricas.zerar.
 * DELETE, e não POST: é o método que diz o que a rota faz.
 */
router.delete('/metricas', (req, res) => {
  const { copia } = metricas.zerar();
  res.json({ ok: true, copia: copia ? require('path').basename(copia) : null });
});

router.get('/metricas', (req, res) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 180);
  const r = metricas.resumo(dias);
  // o nome do local, para o painel não ter que mostrar "h1"
  const nomes = {};
  for (const h of dados.ler().hospitais || []) nomes[h.id] = h.nome;
  res.json({ ...r, nomes });
});

// ------------------------------------------------------------------ WhatsApp

const wa = require('./whatsapp');

router.get('/whatsapp', async (req, res) => {
  const estado = wa.estado ? wa.estado() : { driver: wa.nome, situacao: 'desconhecida' };
  res.json({
    ...estado,
    // um destino por local: é para a recepção de cada lugar que o pedido vai
    destinos: (dados.ler().hospitais || [])
      .filter((h) => h.ativo !== false)
      .map((h) => ({ nome: h.nome, numero: (h.whatsappRecepcao || '').replace(/\D/g, '') })),
    qr: estado.temQr && wa.qrImagem ? await wa.qrImagem() : null,
  });
});

router.post('/whatsapp/conectar', async (req, res) => {
  try {
    const estado = wa.conectar ? await wa.conectar() : wa.estado();
    res.json({ ...estado, qr: estado.temQr && wa.qrImagem ? await wa.qrImagem() : null });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/whatsapp/desconectar', async (req, res) => {
  try {
    res.json(wa.desconectar ? await wa.desconectar() : wa.estado());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/** Pedidos que ficaram sem aviso — o paciente marcou e a recepção não soube. */
router.get('/avisos-pendentes', async (req, res) => {
  try {
    res.json({ pendentes: await servico.avisosPendentes() });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

router.post('/avisos-pendentes/reenviar', async (req, res) => {
  try {
    res.json(await servico.reenviarAvisos());
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

/**
 * Confere se uma linha responde no WhatsApp, sem enviar nada.
 *
 * O equivalente ao "Testar acesso" da agenda: pega dígito trocado na hora de
 * cadastrar, e não quando um paciente já agendou e a mensagem não chegou.
 */
router.post('/whatsapp/verificar-numero', async (req, res) => {
  if (!wa.verificar) {
    return res.json({ ok: false, motivo: 'indisponivel',
      mensagem: 'Este driver de WhatsApp não sabe testar números.' });
  }
  try {
    res.json(await wa.verificar((req.body && req.body.numero) || ''));
  } catch (e) {
    res.status(502).json({ ok: false, motivo: 'erro', mensagem: e.message });
  }
});

/**
 * Mensagem de teste para a recepção de um local, para provar que o caminho
 * funciona. Sem local informado, usa o primeiro que estiver no ar.
 */
router.post('/whatsapp/testar', async (req, res) => {
  const ativos = (dados.ler().hospitais || []).filter((h) => h.ativo !== false);
  const alvo = req.body && req.body.local
    ? ativos.find((h) => h.id === req.body.local)
    : ativos[0];
  const numero = (alvo && alvo.whatsappRecepcao || '').replace(/\D/g, '');
  if (!numero) {
    return res.status(400).json({ erro: 'Cadastre o WhatsApp da recepção deste local antes de testar.' });
  }
  try {
    await wa.enviar(numero,
      `Teste do sistema de agendamento (${alvo.nome}). Se você recebeu esta mensagem, está tudo certo.`);
    res.json({ ok: true, numero, local: alvo.nome });
  } catch (e) {
    res.status(502).json({ erro: e.message });
  }
});

/** Confere o compartilhamento da agenda antes de o médico salvar. */
router.post('/testar-agenda', async (req, res) => {
  try {
    res.json(await agenda.testarAcesso(req.body?.calendarId));
  } catch (e) {
    res.status(500).json({ ok: false, mensagem: `Não consegui testar agora: ${e.message}` });
  }
});

module.exports = router;

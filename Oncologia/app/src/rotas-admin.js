/**
 * rotas-admin.js — a API do painel do médico.
 *
 * Tudo aqui exige sessão, menos entrar. As respostas devolvem a configuração
 * inteira depois de cada mudança, para a tela nunca ficar mostrando um estado
 * que não é o que está gravado.
 */
const express = require('express');
const dados = require('./dados');
const auth = require('./auth');
const agenda = require('./google-agenda');

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

/** Confere o compartilhamento da agenda antes de o médico salvar. */
router.post('/testar-agenda', async (req, res) => {
  try {
    res.json(await agenda.testarAcesso(req.body?.calendarId));
  } catch (e) {
    res.status(500).json({ ok: false, mensagem: `Não consegui testar agora: ${e.message}` });
  }
});

module.exports = router;

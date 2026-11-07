/**
 * Painel web do Studio (roda na VPS, sob o PM2, porta PAINEL_PORT — padrão 8080).
 * Protegido por usuário e senha (Basic Auth) do .env: PAINEL_USER / PAINEL_SENHA.
 *
 * Duas páginas:
 *   • "/"        → editar os textos das mensagens do robô (data/mensagens.json)
 *   • "/agendar" → agendar envios avulsos por WhatsApp (data/agendamentos.json)
 *                  disparados 10:45 (manhã) e 15:45 (tarde) — ver enviar-agendados.js
 *
 * ⚠️ Basic Auth manda a senha só codificada (não criptografada). Exponha este
 *    painel SEMPRE atrás de HTTPS (ex.: Caddy + subdomínio). Ver o runbook.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const mensagens = require('./mensagens');
const ag = require('./agendamentos');
const waStatus = require('./wa-status');
const horarios = require('./horarios');
const renovacaoConfig = require('./renovacao-config');
const anivExcluir = require('./aniversario-excluir');
const atividade = require('./atividade');
const teste = require('./teste-envio');
const slimclub = require('./slimclub');               // Slim Club: benefícios de alunas para alunas
const slimclubPaginas = require('./slimclub-paginas'); // páginas públicas do Slim Club (cadastro e listagem)
const formularios = require('./formularios');               // formulários de campanha (ex.: lista da Black Friday)
const formulariosPaginas = require('./formularios-paginas'); // página pública /formulario/<endereço>
const igcfg = require('./instagram-config');
const igApi = require('./instagram-api'); // integração OFICIAL (Graph API): webhook comentário/DM → resposta
const igcookies = require('./instagram-cookies');
const igforcar = require('./ig-forcar');
const jobsAtivos = require('./jobs-ativos'); // liga/desliga de cada envio
const inadConfig = require('./inadimplentes-config'); // "vencido há X+ dias" (configurável)
const freeCfg = require('./free-antecedencia-config'); // planos FREE: intervalo (horas) + janela (dias)
const testeIg = require('./teste-instagram');
const indicadores = require('./indicadores');
const audiosMsg = require('./audios-msg'); // áudio da professora (follow-up, confirmação)
const histExp = require('./experimentais-hist'); // agenda de experimentais do EVO (Indicadores → Professoras)
const bookings = require('./bookings');
const autoTagAlunas = require('./auto-tag-alunas');
const origens = require('./origens');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const grupos = require('./grupos');
const usuarios = require('./usuarios');
const acessos = require('./acessos');
const auditoria = require('./auditoria');
const config = require('./config'); // STUDIO_NOME etc.
const https = require('https');
// Telas e peças em módulos próprios (mesma pasta), carregados aqui no lugar onde
// estavam: painel-estado (estado compartilhado), painel-base e uma por aba.
const E = require('./painel-estado');
const {
  _pm2Slug, PM2_EXP, PM2_SOFIA, COMP_CFG_FILE, COMP_PADRAO, compTagsAgendou, compDias, compIntervalo, lerCompCfg, USER, SENHA, TODAS_TELAS, SEGREDO, assinar, SESSOES_FILE, _salvarSessoesJa, salvarSessoesSoon, tocarSessao, sessaoValida, lerToken, lerCookie, ehHttps, usuarioDaReq, ADMIN_EMAIL, SOFIA_SUBS, podeSofiaSub, temSofia, sofiaHref, podeMsgSub, temMsg, msgHref, esc, infoI, hojeSP, fmtData, fmtTel, ESTILO, IG_NO_PAINEL, PAGAMENTO_ATIVO, navTabs, FOTOS_FILE, fotoDe, iniciais, AV_CORES, avatar, menuConta, chrome, scriptPreviewTeste, cardMensagem, professorasRecentes, cardAudio, cardFoto, DIAS, blocoHorario, lerJsonData, podeFunil, uiTrilho, uiBarra, uiTopo, uiChips, uiDatas, UI_SIT, uiPessoa, subnavSofia, scIp, scBaseUrl, scStudio, scHtml, scJson, scSoJson, lerCorpo, FU_AGENDOU_CANAL_FILE, fuLerJson, FU_AGENDOU_AULA_FILE,
} = require('./painel-base');
const {
  CIRC_SERV_FILE, lerCircuitoServico, horaAg, turnoLabel, barraTeste, card2FA, blocoWaRobo, subnavMensagens, cardGrupos, paginaMensagens, itemHtml, cardHorariosAgendados, blocoAgendarMsg, paginaExpress, paginaWa, HORARIOS_DA_MSG, TOGGLE_EXTRA_DA_MSG, jobsDoCard, cardDeMsg, blocoAnivExcluir, blocoSaidas, blocoVenceHoje, blocoSentimos, blocoRenovDias, OUTROS_JOBS, switchEnvio, horaTurno, FOTO_POR_CONTEXTO, JOBS_DO_LOG, jobDoLog, RODAR_JOB_ST, statusRodarJob, LOG_REFEITOS, lerRefeitos, hhmm, fotoDoEnvio, paginaHoje, paginaCobranca,
} = require('./painel-whatsapp');
const {
  PM2_PAINEL, COTACAO_FILE, COTACAO_TTL, atualizarCotacao, cotacaoUSD, cotacaoInfo, EXP_LIM_FILE, lerExpLimite, ANTEC_FILE, lerAntecedenciaHoras, CHATBOT_ENV_FILE, EXPERIMENTAL_ENV_FILE, lerEnvVar, lerApiKey, lerTranscricaoKey, lerTranscricaoProvedor, lerEvoEmail, evoSenhaDefinida, REFRESH_SEG_FILE, lerRefreshSeg, avisoI, blocoSofiaWa, paginaSofiaConversas, paginaSofiaContatos, estimarCampanha, fmtDataBR, campListHTML, paginaSofiaTags, paginaSofiaCampanhas, paginaSofia, paginaSofiaCusto,
} = require('./painel-sofia');
const {
  paginaIndicadores, subnavIndicadores, IND_CSS, _gradeSnapshot, paginaGrade, paginaSofiaFunil, MESES_CURTO, MESES_LONGO, rotuloPeriodo, contratoIgnorado, lerAtivasHist, ativasSerie, ativasPeriodos, ATIVAS_POR_PAG, paginaAtivasLista, paginaResumoMensal, paginaResumoSemanal, paginaAtivas, paginaProfessoras, fmtIdadeSaude, paginaSaude,
} = require('./painel-indicadores');
const {
  paginaInstagram,
} = require('./painel-instagram');
const {
  SESSAO_DIAS_FILE, SESSAO_DIAS_DEFAULT, lerSessaoDias, PERFIS_SUBS, subnavPerfis, paginaPerfis,
} = require('./painel-perfis');
const {
  GOOGLE_ID, GOOGLE_SECRET, googleAtivo, paginaLogin, docLegal, paginaPrivacidade, paginaTermos,
} = require('./painel-publicas');
const {
  scSetCookie, scFmtQuando, rotaSlimClubCadastro, rotaSlimClubPublico, scAvisarAprovado, scStatusAviso, paginaSlimClub,
} = require('./painel-slimclub');
const {
  fmLink, FM_CSS, FM_JS_COPIAR, paginaFormularios, paginaFormularioEditar, fmCodigosDoForm, fmCampanhas, paginaFormularioRespostas, FM_ROBO, fmCookieVisitante, fmContarAcesso, rotaFormularioPublico, rotaFormulariosPainel,
} = require('./painel-formularios');
const {
  fmtTelAviso, AUTO_ROTULO, _conversaEmAndamento, aplicarAutomacao, publicarRegras, FU_AGENDOU_FILE, FU_FEITO_FILE, fuSalvarJson, fuMarcarAgendou, fuMarcarCanal, fuMarcarAula, processarAgendamentos, processarFollowups, processarEventos, avisosPorAluna, ultimaMsgDaAluna, reconciliarTagHumano, bookConfig, processarExpressInbox,
} = require('./painel-automacao');
 // revalida a cada 6h
// (estado "_cotacao" → painel-estado.js)
try { const o = JSON.parse(fs.readFileSync(COTACAO_FILE, 'utf8')); if (o && o.valor > 0) E._cotacao = { valor: +o.valor, em: +o.em || 0, fonte: o.fonte || 'cache' }; } catch (_) {}
atualizarCotacao().catch(() => {}); // aquece no boot
setInterval(() => atualizarCotacao().catch(() => {}), COTACAO_TTL);
function gravarCompCfg(c) { const tags = compTagsAgendou(c); const o = { on: !!c.on, tagsAgendou: tags, tagAgendou: tags[0], tagCompareceu: String(c.tagCompareceu || '').trim() || COMP_PADRAO.tagCompareceu, tagFaltou: String(c.tagFaltou || '').trim() || COMP_PADRAO.tagFaltou, numeroRelatorio: String(c.numeroRelatorio || '').replace(/\D/g, ''), criarNovos: !!c.criarNovos, diasJanela: compDias(c.diasJanela), intervaloHoras: compIntervalo(c.intervaloHoras) }; try { fs.mkdirSync(path.dirname(COMP_CFG_FILE), { recursive: true }); } catch (_) {} fs.writeFileSync(COMP_CFG_FILE, JSON.stringify(o, null, 2)); return o; }
function gravarExpLimite(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 0) return false;
  try { fs.mkdirSync(path.dirname(EXP_LIM_FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(EXP_LIM_FILE, String(v), 'utf8');
  return true;
}
function gravarCircuitoServico(v) {
  const n = String(v || '').replace(/\D/g, '');
  try { fs.mkdirSync(path.dirname(CIRC_SERV_FILE), { recursive: true }); } catch (_) {}
  if (!n || +n <= 0) { try { fs.unlinkSync(CIRC_SERV_FILE); } catch (_) {} return null; }
  fs.writeFileSync(CIRC_SERV_FILE, String(+n), 'utf8');
  return +n;
}
function gravarAntecedenciaHoras(n) {
  const v = parseFloat(String(n).replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 168) return false; // teto de 7 dias
  try { fs.mkdirSync(path.dirname(ANTEC_FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(ANTEC_FILE, String(v), 'utf8');
  return true;
}
// Grava UMA variável no .env, preservando o resto do arquivo (substitui a linha
// se existir, senão acrescenta no fim). Aceita valor vazio (para "desligar").
function gravarEnvVar(nome, valor, arq) {
  arq = arq || CHATBOT_ENV_FILE;
  valor = String(valor || '').trim().replace(/^["']|["']$/g, '');
  let txt = ''; try { txt = fs.readFileSync(arq, 'utf8'); } catch (_) {}
  const linha = nome + '=' + valor;
  const re = new RegExp('^' + nome + '=.*$', 'm');
  if (re.test(txt)) txt = txt.replace(re, linha);
  else txt = (txt.replace(/\s*$/, '') + '\n' + linha + '\n').replace(/^\n/, '');
  try { fs.mkdirSync(path.dirname(arq), { recursive: true }); } catch (_) {}
  try { fs.writeFileSync(arq, txt, 'utf8'); return true; } catch (_) { return false; }
}
function gravarApiKey(key) {
  key = String(key || '').trim().replace(/^["']|["']$/g, '');
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) return false; // validação básica: chave Anthropic (nunca vazia)
  return gravarEnvVar('ANTHROPIC_API_KEY', key);
}
// Chave de transcrição: OpenAI (sk-...) ou Groq (gsk_...). Vazia é VÁLIDA —
// significa "desligar a transcrição" (deixa TRANSCRICAO_API_KEY= em branco).
function gravarTranscricaoKey(key) {
  key = String(key || '').trim().replace(/^["']|["']$/g, '');
  if (key && !/^(sk-|gsk_)[\w-]{20,}$/.test(key)) return false;
  return gravarEnvVar('TRANSCRICAO_API_KEY', key);
}
// Provedor de transcrição: define TRANSCRICAO_URL + TRANSCRICAO_MODELO no
// ChatBot/.env — assim trocar OpenAI↔Groq é feito pelo painel, sem editar .env.
const TRANSCRICAO_PROVEDORES = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', modelo: 'whisper-1', rot: 'OpenAI (Whisper)' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', modelo: 'whisper-large-v3-turbo', rot: 'Groq (whisper-large-v3-turbo)' },
};
function gravarTranscricaoProvedor(prov) {
  const key = String(prov || '').toLowerCase() === 'groq' ? 'groq' : 'openai';
  const p = TRANSCRICAO_PROVEDORES[key];
  gravarEnvVar('TRANSCRICAO_URL', p.url);
  gravarEnvVar('TRANSCRICAO_MODELO', p.modelo);
  return key;
}
function gravarEvoCredenciais(email, senha) {
  email = String(email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: 'e-mail inválido' };
  let ok = true;
  if (email) ok = gravarEnvVar('EVO_EMAIL', email, EXPERIMENTAL_ENV_FILE) && ok;
  senha = String(senha || '').trim();
  if (senha) ok = gravarEnvVar('EVO_PASSWORD', senha, EXPERIMENTAL_ENV_FILE) && ok; // em branco: mantém a atual
  // Atualiza também o ambiente DESTE processo: o "Reiniciar robô" usa
  // `pm2 restart --update-env`, que copia este ambiente para o robô.
  if (email) process.env.EVO_EMAIL = email;
  if (senha) process.env.EVO_PASSWORD = senha;
  return { ok };
}

const PORT = parseInt(process.env.PAINEL_PORT || '8080', 10);
// Por padrão escuta SÓ no localhost da VPS: o acesso vem pelo HTTPS do Caddy
// (reverse_proxy localhost:8080) ou por um túnel SSH — nunca direto da internet.
const HOST = process.env.PAINEL_HOST || '127.0.0.1';

function seguraIgual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function gravarSessaoDias(n) {
  const v = Math.min(90, Math.max(1, parseInt(n, 10) || SESSAO_DIAS_DEFAULT));
  try { require('fs').mkdirSync(path.dirname(SESSAO_DIAS_FILE), { recursive: true }); } catch (_) {}
  require('fs').writeFileSync(SESSAO_DIAS_FILE, String(v));
  return v;
}
function gravarRefreshSeg(n) {
  const v = Math.min(60, Math.max(3, parseInt(n, 10) || 4));
  try { require('fs').mkdirSync(path.dirname(REFRESH_SEG_FILE), { recursive: true }); } catch (_) {}
  require('fs').writeFileSync(REFRESH_SEG_FILE, String(v));
  return v;
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function criarToken(usuario, sid) {
  const payload = b64url(JSON.stringify({ u: usuario, sid: sid || '', exp: Date.now() + lerSessaoDias() * 864e5 }));
  return payload + '.' + assinar(payload);
}
// (estado "_sessoes" → painel-estado.js)
try { E._sessoes = JSON.parse(require('fs').readFileSync(SESSOES_FILE, 'utf8')) || {}; } catch (_) { E._sessoes = {}; }
function podarSessoes() {
  const lim = Date.now() - Math.max(1, lerSessaoDias()) * 864e5; let mud = false;
  for (const sid in E._sessoes) { const s = E._sessoes[sid]; if ((s.criadoEm || 0) < lim || (s.revogadoEm && s.revogadoEm < Date.now() - 2 * 864e5)) { delete E._sessoes[sid]; mud = true; } }
  if (mud) salvarSessoesSoon();
}
function criarSessao(usuario, metodo, req) {
  let sid; try { sid = crypto.randomBytes(12).toString('hex'); } catch (_) { sid = String(Date.now()) + Math.random().toString(16).slice(2); }
  E._sessoes[sid] = { usuario: String(usuario || ''), metodo: metodo || '', criadoEm: Date.now(), ultimoEm: Date.now(), ua: String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300) };
  podarSessoes(); _salvarSessoesJa(); return sid; // grava JÁ (não perde a sessão se reiniciar logo após o login)
}
function revogarSessao(sid) { const s = E._sessoes[sid]; if (s && !s.revogadoEm) { s.revogadoEm = Date.now(); _salvarSessoesJa(); return true; } return false; }
function setCookieSessao(req, res, valor, maxAgeSec) {
  const partes = [`sf_sess=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (ehHttps(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}
function baseUrl(req) { return (ehHttps(req) ? 'https' : 'http') + '://' + (req.headers.host || ''); }
function redirectUri(req) { return baseUrl(req) + '/auth/google/callback'; }
// Resolve o e-mail do Google → {usuario, admin} apenas se estiver AUTORIZADO.
function loginPorEmail(email) {
  const e = usuarios.normEmail(email);
  if (!e) return null;
  if (ADMIN_EMAIL && e === ADMIN_EMAIL) return { usuario: USER, admin: true };
  const u = usuarios.porEmail(e);
  return u ? { usuario: u.usuario, admin: !!u.admin } : null;
}
// Cookie curto (10 min) com o "state" anti-CSRF do fluxo OAuth.
function setStateCookie(req, res, valor) {
  const partes = [`g_state=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${valor ? 600 : 0}`];
  if (ehHttps(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}
// POST x-www-form-urlencoded → JSON (troca do "code" por tokens no Google).
function postForm(host, caminho, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const opt = { host, path: caminho, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
    const r = https.request(opt, (resp) => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { reject(new Error('resposta inválida do Google')); } }); });
    r.on('error', reject); r.setTimeout(8000, () => r.destroy(new Error('timeout')));
    r.write(body); r.end();
  });
}
// Lê os claims de um id_token (JWT). Não precisa validar assinatura: ele vem
// direto do endpoint do Google, por TLS (fluxo server-to-server).
function decodificarJwt(jwt) {
  try { const p = String(jwt).split('.')[1]; return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (_) { return null; }
}

// Confere usuário+senha no login. Devolve {usuario, admin} ou null.
const _falhasLogin = new Map(); // chave → [instantes das tentativas erradas]
function _falhasRecentes(k) { const ag = Date.now(); const arr = (_falhasLogin.get(k) || []).filter(t => ag - t < 15 * 60e3); if (arr.length) _falhasLogin.set(k, arr); else _falhasLogin.delete(k); return arr; }
function bloqueadoLogin(k) { return _falhasRecentes(k).length >= 10; }
function falhaLogin(k) { if (_falhasLogin.size > 5000) _falhasLogin.clear(); const arr = _falhasRecentes(k); arr.push(Date.now()); _falhasLogin.set(k, arr); }
function validarLogin(usuario, senha) {
  const u = String(usuario || '').trim();
  if (SENHA && usuarios.normU(u) === usuarios.normU(USER) && seguraIgual(senha, SENHA)) return { usuario: USER, admin: true };
  const fu = usuarios.verificar(u, senha);
  return fu ? { usuario: fu.usuario, admin: !!fu.admin } : null;
}
// Qual aba uma URL pertence (para a checagem de acesso). O resto é a aba WhatsApp.
function telaDaUrl(u) {
  if (u === '/hoje' || u.startsWith('/hoje/')) return 'msg'; // Hoje virou sub-aba do WhatsApp
  if (u === '/indicadores' || u === '/origens/criar' || u === '/origens/excluir') return 'ind';
  if (u === '/instagram' || u.startsWith('/instagram/')) return 'ig';
  if (u === '/sofia' || u.startsWith('/sofia/')) return 'sofia';
  if (u === '/perfis' || u.startsWith('/perfis/')) return 'perfis';
  if (u === '/saude') return 'saude'; // liberável por usuário (checkbox em Perfis) — a checagem genérica cobre
  if (u === '/grade' || u.startsWith('/grade/')) return 'grade'; // idem (checkbox em Perfis)
  if (u === '/funil') return 'funil'; // Indicadores → Funil (checkbox em Perfis; quem via pela SoFIA Conversas continua vendo)
  if (u === '/professoras' || u.startsWith('/professoras/')) return 'professoras'; // Indicadores → Professoras (checkbox em Perfis)
  if (u === '/ativas' || u.startsWith('/ativas/')) return 'ativas'; // Indicadores → Alunas ativas (checkbox em Perfis)
  if (u === '/pagamento' || u.startsWith('/pagamento/')) return 'pagamento'; // Indicadores → Pagamento professores (checkbox em Perfis)
  if (u === '/clube' || u.startsWith('/clube/')) return 'slimclub'; // validação do Slim Club (checkbox em Perfis)
  if (u === '/formularios' || u.startsWith('/formularios/')) return 'formularios'; // formulários de campanha (checkbox em Perfis)
  return 'msg';
}
// Rota /sofia/* (fora o GET da página) → sub-permissão exigida. O "salvar-novo"
// (marcar tags/salvar contato a partir de uma conversa) vale para Conversas OU Contatos.
function sofiaRotaPermitida(sess, url) {
  const has = k => (sess.telas || []).includes(k);
  if (url === '/sofia/agendar' || url === '/sofia/agendar/status') return has('sofia_conversas') || has('msg_express') || has('msg_agendar'); // agendar no EVO: das Conversas OU do Cadastro Express (aba WhatsApp)
  if (url === '/sofia/conversas' || url === '/sofia/responder' || url === '/sofia/humano' || url === '/sofia/humano-foto' || url === '/sofia/conversas/encerrar') return has('sofia_conversas');
  if (url === '/sofia/importar' || url === '/sofia/importar/status') return has('sofia_conversas') || has('sofia_config');
  if (url === '/sofia/contatos/salvar-novo') return has('sofia_conversas') || has('sofia_contatos');
  if (url === '/sofia/contatos/bloquear') return has('sofia_conversas') || has('sofia_contatos'); // bloquear vem tb do chat (Conversas)
  if (url === '/sofia/contatos/importar' || url === '/sofia/contatos/salvar' || url === '/sofia/contatos/tag' || url === '/sofia/contatos/lote' || url === '/sofia/contatos/excluir-lote' || url === '/sofia/contatos/interacoes' || url === '/sofia/contatos/modelo.csv' || url === '/sofia/contatos/exportar' || url === '/sofia/contatos/tagcfg' || url === '/sofia/contatos/criar-tag') return has('sofia_contatos');
  if (url === '/sofia/campanhas' || url.startsWith('/sofia/campanhas/')) return has('sofia_campanhas');
  if (url === '/sofia/comparecimento') return has('sofia_contatos') || has('sofia_config'); // agora mora na aba Tags
  if (url === '/sofia/auto-tag-alunas') return has('sofia_contatos') || has('sofia_config'); // auto-tag Aluna/Ex-aluna (aba Tags)
  if (url === '/sofia/midia-upload' || url === '/sofia/midia') return has('sofia_config'); // upload/preview das imagens (preços/grade)
  if (url === '/sofia/msgs-anuncio') return has('sofia_config'); // boas-vindas do anúncio que não pausam a SoFIA
  if (url === '/sofia/salvar' || url === '/sofia/restaurar' || url === '/sofia/toggle' || url === '/sofia/estado' || url === '/sofia/desconectar' || url === '/sofia/reiniciar' || url === '/sofia/parear' || url === '/sofia/custo-limite' || url === '/sofia/aviso-humano' || url === '/sofia/nao-responder' || url === '/sofia/alunas' || url === '/sofia/historico-tags' || url === '/sofia/prompt/download' || url === '/sofia/prompt/previa' || url === '/sofia/prompt/importar') return has('sofia_config');
  return false;
}
// Rota da aba WhatsApp → sub-permissão. Agendamento = /agendar* e /?view=agendar;
// Express = /?view=express; Hoje = /hoje; o resto (mensagens, fotos, teste, horários, conexão) é Configuração.
function msgRotaPermitida(sess, url, fullUrl) {
  const has = k => (sess.telas || []).includes(k);
  if (url === '/hoje') return has('msg_hoje');
  const podeExpr = has('msg_express') || has('msg_agendar'); // tela unificada (aceita a chave antiga)
  if (url === '/agendar' || url.startsWith('/agendar/')) return podeExpr;
  if (url === '/' && /(?:^|[?&])view=(agendar|express)/.test(fullUrl || '')) return podeExpr;
  return has('msg_config'); // /, /salvar, /mensagem/*, /teste/*, /horarios*, /wa*
}
function primeiraTela(sess) {
  // Tela inicial ao logar: Conversas da SoFIA (para quem tem acesso — inclui admin).
  if (podeSofiaSub(sess, 'conversas')) return '/sofia?view=conversas';
  if (sess.admin) return '/hoje';
  if (temMsg(sess)) return msgHref(sess);
  if (sess.telas.includes('ind')) return '/indicadores';
  if (IG_NO_PAINEL && sess.telas.includes('ig')) return '/instagram';
  if (temSofia(sess)) return sofiaHref(sess);
  if (sess.telas.includes('slimclub')) return '/clube';
  if (sess.telas.includes('formularios')) return '/formularios';
  if (podeFunil(sess)) return '/funil';
  if (sess.telas.includes('professoras')) return '/professoras';
  if (sess.telas.includes('ativas')) return '/ativas';
  if (sess.telas.includes('grade')) return '/grade';
  if (PAGAMENTO_ATIVO && sess.telas.includes('pagamento')) return '/pagamento';
  return '';
}
function salvarFoto(usuario, url) {
  const u = String(usuario || '').toLowerCase(), f = String(url || '');
  if (!u || !/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(f)) return;
  let m = {}; try { m = JSON.parse(fs.readFileSync(FOTOS_FILE, 'utf8')) || {}; } catch (_) {}
  if (m[u] === f) return;
  m[u] = f;
  try { fs.writeFileSync(FOTOS_FILE, JSON.stringify(m, null, 2), 'utf8'); } catch (_) {}
}
const JOBS_REFAZER = new Set(JOBS_DO_LOG.map(j => j[1]));
const _refazerPedido = {}; // job → { id, em } do último pedido (evita rodar 2x ao mesmo tempo)
function gravarRefeito(linha, dados) {
  if (!linha) return;
  try {
    const o = lerRefeitos(); o[String(linha).slice(0, 200)] = dados;
    const ks = Object.keys(o).sort((a, b) => (o[a].em || 0) - (o[b].em || 0));
    for (const k of ks.slice(0, Math.max(0, ks.length - 300))) delete o[k];
    fs.writeFileSync(LOG_REFEITOS, JSON.stringify(o));
  } catch (_) {}
}

// ── Grade de MATRÍCULAS FIXAS (/grade) ───────────────────────────────────────
// Snapshot gerado pelo run_grade_fixas.py (Python) → data/grade-fixas.json.
// (estado "_gradeGerando, _gradeDesde" → painel-estado.js)
function _gradePyBin() {
  const dir = path.resolve(__dirname, 'agendamento_evo');
  const venv = path.join(dir, '.venv', 'bin', 'python');
  let py = process.env.PYTHON_BIN || 'python3';
  try { if (fs.existsSync(venv)) py = venv; } catch (_) {}
  return { py, dir };
}

// Página "sem acesso" (usuário logado tentando uma tela não liberada).
function negarAcesso(res, sess) {
  const destino = primeiraTela(sess);
  const corpo = `<div class="wrap"><div class="card" style="text-align:center;padding:28px">
    <div style="font-size:2rem">🔒</div>
    <h2 style="margin:8px 0">Você não tem acesso a esta tela</h2>
    <p class="quando">Fale com o administrador se precisar deste acesso.</p>
    ${destino ? `<a href="${destino}" style="display:inline-block;margin-top:10px;background:var(--coral);color:#fff;border-radius:999px;padding:10px 20px;font-weight:700;text-decoration:none">Voltar ao painel</a>` : `<a href="/logout" style="display:inline-block;margin-top:10px;color:var(--cinza);text-decoration:underline">Sair</a>`}
  </div></div>`;
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(chrome({ tab: 'Sem acesso', h1: 'SlimFit', p: 'Painel do Studio.' }, '', corpo));
}

// ── Indicadores → Professoras: conversão da aula experimental por professora ──
// Fonte: histórico da agenda de experimentais do EVO (experimentais-hist.js),
// lido toda noite pelo robô. Cada linha: aluna, dia/hora, professora, presença e
// "Nome do contrato". Fechou = contrato preenchido no EVO OU a aluna tem a tag de
// aluna no CRM (mesmo nome). Conversão = fecharam ÷ vieram (só conta quem fez a aula).
// ── Indicadores → Alunas ativas ─────────────────────────────────────────────
// Evolução das alunas com contrato vigente (TRANCADA conta como ativa), por mês
// ou semana, e comparação entre dois meses (ex.: dez/2026 × dez/2025). Os dados
// vêm de data/alunas-ativas-historico.json, gravado pelo run_ativas_foto.py
// (05:25 todo dia): a série diária reconstruída pelos contratos do EVO.
const ATIVAS_FILE = path.resolve(__dirname, '..', 'data', 'alunas-ativas-historico.json');
// Cálculo sob demanda ("Atualizar agora"): estado + a saída do script, para a tela
// mostrar o erro em vez de ficar em "Calculando…" se algo der errado.
// (estado "_ativasGerando" → painel-estado.js)
// (estado "_ativasUltimo" → painel-estado.js)
// Leitura do histórico e agrupamento por mês/semana: ativas-dados.js (o resumo
// mensal no WhatsApp usa o mesmo módulo, para os números baterem).
const ativasDados = require('./ativas-dados');

// Erro inesperado numa rota → responde 500 e segue no ar (antes, um único pedido
// malformado — ex.: cookie com "%" inválido — derrubava o painel inteiro).
function protegido(fn) {
  return (req, res) => {
    // Cabeçalhos de proteção: o painel só pode ser aberto dentro de um quadro (iframe)
    // do próprio painel — outro site não consegue "esconder" o painel na página dele
    // para induzir cliques (clickjacking). As páginas públicas (formulário/Slim Club)
    // ficam liberadas para poderem ser incorporadas em sites/redes.
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!/^\/(formulario|slimclub)/i.test(String(req.url || ''))) { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); }
    } catch (_) {}
    try { return fn(req, res); }
    catch (e) {
      console.error('[painel] erro na rota', req.method, String(req.url || '').split('?')[0], '-', e && e.stack || e);
      try { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Erro interno. Tente de novo.'); } catch (_) {}
    }
  };
}
process.on('uncaughtException', (e) => console.error('[painel] erro não tratado (o painel continua no ar):', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('[painel] promessa rejeitada sem tratamento:', e && e.stack || e));

const server = http.createServer(protegido((req, res) => {
  const url = req.url.split('?')[0];
  E._navSess = null;

  // ── Login / logout (rotas públicas) ──────────────────────────────────────
  if (url === '/login') {
    if (req.method === 'GET') {
      const jaLogado = usuarioDaReq(req);
      if (jaLogado) { res.writeHead(303, { Location: primeiraTela(jaLogado) || '/hoje' }); return res.end(); }
      const q = req.url.split('?')[1] || '';
      let e = '';
      if (/(?:^|&)e=1/.test(q)) e = 'Usuário ou senha incorretos.';
      else if (/(?:^|&)e=limite/.test(q)) e = 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.';
      else if (/(?:^|&)g=naoaut/.test(q)) e = 'Este e-mail do Google não tem acesso. Peça para cadastrarem em Perfis.';
      else if (/(?:^|&)g=erro/.test(q)) e = 'Não consegui entrar com o Google. Tente de novo.';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaLogin(e));
    }
    if (req.method === 'POST') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        // Limite de tentativas ERRADAS (contra adivinhar senha): 10 por IP e 10 por
        // usuário a cada 15 min. Só as erradas contam; acertar não é barrado.
        const ipL = scIp(req), uL = usuarios.normU(p.get('usuario') || '');
        if (bloqueadoLogin('ip:' + ipL) || (uL && bloqueadoLogin('u:' + uL))) { res.writeHead(303, { Location: '/login?e=limite' }); return res.end(); }
        const ok = validarLogin(p.get('usuario'), p.get('senha') || '');
        if (!ok) { falhaLogin('ip:' + ipL); if (uL) falhaLogin('u:' + uL); console.warn(`[painel] login recusado: usuário "${String(p.get('usuario') || '').slice(0, 40)}" ip ${ipL}`); res.writeHead(303, { Location: '/login?e=1' }); return res.end(); }
        try { acessos.registrarLogin(ok.usuario, 'senha'); } catch (_) {}
        setCookieSessao(req, res, criarToken(ok.usuario, criarSessao(ok.usuario, 'senha', req)), lerSessaoDias() * 86400);
        const sess = { admin: ok.admin, telas: ok.admin ? TODAS_TELAS : (usuarios.obter(ok.usuario) || { telas: [] }).telas };
        res.writeHead(303, { Location: primeiraTela(sess) || '/hoje' }); res.end();
      });
    }
  }
  if (url === '/logout') {
    try { const o = lerToken(lerCookie(req, 'sf_sess')); if (o && o.sid) revogarSessao(o.sid); } catch (_) {} // encerra a própria sessão
    setCookieSessao(req, res, '', 0);
    res.writeHead(303, { Location: '/login' }); return res.end();
  }
  // Páginas legais públicas (o Google lê ao publicar o app OAuth).
  { // /politicadeprivacidade (o link divulgado) e /privacidade (o do Google), com qualquer maiúscula
    const u = url.toLowerCase().replace(/\/+$/, '');
    if (u === '/privacidade' || u === '/politicadeprivacidade' || u === '/politica-de-privacidade') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaPrivacidade()); }
  }
  if (url === '/termos') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(paginaTermos()); }
  // Imagem PÚBLICA (preços/grade) — o link que a SoFIA manda pra aluna ABRIR pelo
  // WhatsApp (sem login). Só serve os campos conhecidos (precos_imagem/grade_imagem),
  // pelo caminho salvo pelo próprio painel — sem risco de path traversal.
  if (url === '/midia-publica' || url.startsWith('/midia-publica?')) {
    const campo = new URLSearchParams(req.url.split('?')[1] || '').get('c') || '';
    let caminho = ''; try { caminho = sofia.caminhoMidiaLocal(campo); } catch (_) {}
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('imagem não encontrada'); }
    const ext = caminho.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'public, max-age=300' });
    return fs.createReadStream(caminho).pipe(res);
  }
  // ── Webhook OFICIAL do Instagram (público — a Meta chama sem login) ────────
  // GET = verificação (devolve o hub.challenge). POST = eventos (comentário/DM),
  // com assinatura conferida pelo APP_SECRET antes de processar.
  if (url === '/ig/webhook') {
    if (req.method === 'GET') {
      const challenge = igApi.verificar(req.url.split('?')[1] || '');
      if (challenge !== null) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(challenge); }
      res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('forbidden');
    }
    if (req.method === 'POST') {
      return lerCorpo(req, 1e6, corpo => {
        // Registra só o que precisa de atenção (assinatura inválida ou evento que o
        // processar ignora) — antes, um log de diagnóstico gravava TODO webhook.
        const assinOk = igApi.assinaturaValida(corpo, req.headers['x-hub-signature-256']);
        let body = null; try { body = JSON.parse(corpo); } catch (_) { body = null; }
        if (!assinOk) { console.log(`[ig-webhook] POST ${corpo.length}B com assinatura INVÁLIDA — ignorado`); res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('bad signature'); }
        if (!body || body.object !== 'instagram') console.log(`[ig-webhook] evento ignorado: ${body ? 'object=' + body.object : 'corpo não-JSON'}`);
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('EVENT_RECEIVED'); // responde rápido; processa depois
        if (body) igApi.processar(body).catch(e => console.log('[ig-api] processar:', e.message));
      });
    }
    res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('method not allowed');
  }
  // Login com Google — só ativo com GOOGLE_CLIENT_ID/SECRET no .env.
  if (url === '/auth/google') {
    if (!googleAtivo()) { res.writeHead(303, { Location: '/login' }); return res.end(); }
    const state = crypto.randomBytes(16).toString('hex');
    setStateCookie(req, res, state);
    const qs = new URLSearchParams({
      client_id: GOOGLE_ID, redirect_uri: redirectUri(req), response_type: 'code',
      scope: 'openid email profile', state, access_type: 'online', prompt: 'select_account',
    }).toString();
    res.writeHead(303, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + qs }); return res.end();
  }
  if (url === '/auth/google/callback') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    const code = sp.get('code'), state = sp.get('state'), stCookie = lerCookie(req, 'g_state');
    setStateCookie(req, res, ''); // state é de uso único
    if (!googleAtivo()) { res.writeHead(303, { Location: '/login' }); return res.end(); }
    if (!code || !state || !stCookie || state !== stCookie) { res.writeHead(303, { Location: '/login?g=erro' }); return res.end(); }
    postForm('oauth2.googleapis.com', '/token', {
      code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }).then((tok) => {
      const claims = tok && tok.id_token ? decodificarJwt(tok.id_token) : null;
      const emailOk = claims && (claims.email_verified === true || claims.email_verified === 'true');
      if (!claims || claims.aud !== GOOGLE_ID || !emailOk) { res.writeHead(303, { Location: '/login?g=erro' }); return res.end(); }
      const ok = loginPorEmail(claims.email);
      if (!ok) { res.writeHead(303, { Location: '/login?g=naoaut' }); return res.end(); }
      try { acessos.registrarLogin(ok.usuario, 'google'); } catch (_) {}
      try { if (claims.picture) salvarFoto(ok.usuario, claims.picture); } catch (_) {}
      setCookieSessao(req, res, criarToken(ok.usuario, criarSessao(ok.usuario, 'google', req)), lerSessaoDias() * 86400);
      const sess = { admin: ok.admin, telas: ok.admin ? TODAS_TELAS : (usuarios.obter(ok.usuario) || { telas: [] }).telas };
      res.writeHead(303, { Location: primeiraTela(sess) || '/hoje' }); res.end();
    }).catch(() => { res.writeHead(303, { Location: '/login?g=erro' }); res.end(); });
    return;
  }

  // ── Slim Club: páginas PÚBLICAS (sem login do painel) ─────────────────────
  // Endereços aceitos com qualquer combinação de maiúsculas (/SlimClubCadastro, /slimclub).
  {
    const rotaSc = url.toLowerCase().replace(/\/+$/, '');
    if (rotaSc === '/slimclubcadastro') return rotaSlimClubCadastro(req, res);
    if (rotaSc === '/slimclubcadastroexterno') return rotaSlimClubCadastro(req, res, true);
    if (rotaSc === '/slimclub' || rotaSc.startsWith('/slimclub/')) return rotaSlimClubPublico(req, res, rotaSc, url);
    if (rotaSc === '/formulario' || rotaSc.startsWith('/formulario/')) return rotaFormularioPublico(req, res, rotaSc); // formulários de campanha
  }

  // ── Exige login ──────────────────────────────────────────────────────────
  const sess = usuarioDaReq(req);
  if (!sess) {
    if (req.method === 'GET') { res.writeHead(303, { Location: '/login' }); return res.end(); }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Faça login.');
  }
  E._navSess = sess;
  try { acessos.registrarAcesso(sess.usuario); } catch (_) {} // marca "último acesso" (com trava de tempo)

  // ── Grade de matrículas FIXAS (/grade) — permissão "Grade" em Perfis ───────
  // (antes ficava antes da checagem de acesso: qualquer login via a Grade, que traz
  // TKM/faturamento, e podia disparar a releitura no EVO)
  if ((url === '/grade' || url.startsWith('/grade/')) && !sess.admin && !(sess.telas || []).includes('grade')) return negarAcesso(res, sess);
  if (req.method === 'GET' && url === '/grade') {
    const semana = new URLSearchParams(req.url.split('?')[1] || '').get('semana');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaGrade(semana));
  }
  if (req.method === 'POST' && (url === '/grade/atualizar' || url === '/grade/atualizar-tudo')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (E._gradeGerando) return res.end(JSON.stringify({ ok: true, jaRodando: true }));
    // /grade/atualizar = leve (só a grade, reaproveita o financeiro em cache).
    // /grade/atualizar-tudo = completo (recalcula TKM/faturamento no EVO).
    const tudo = (url === '/grade/atualizar-tudo');
    // semana vista (0 = atual, -2..+2) — gera o snapshot daquela semana.
    let semN = parseInt(new URLSearchParams(req.url.split('?')[1] || '').get('semana'), 10);
    semN = Number.isFinite(semN) ? Math.max(-2, Math.min(2, semN)) : 0;
    try {
      const cp = require('child_process');
      const { py, dir } = _gradePyBin();
      E._gradeGerando = true; E._gradeDesde = Date.now();
      const args = ['run_grade_fixas.py'];
      if (semN !== 0) args.push('--semana', String(semN));
      if (!tudo) args.push('--sem-financeiro');
      const child = cp.spawn(py, args, { cwd: dir, detached: true, stdio: 'ignore' });
      child.on('exit', () => { E._gradeGerando = false; });
      child.on('error', () => { E._gradeGerando = false; });
      try { child.unref(); } catch (_) {}
      try { auditoria.registrar(sess.usuario, tudo ? 'grade.atualizar-tudo' : 'grade.atualizar', '', ''); } catch (_) {}
      return res.end(JSON.stringify({ ok: true, iniciado: true }));
    } catch (e) { E._gradeGerando = false; return res.end(JSON.stringify({ ok: false, erro: e.message })); }
  }
  if (req.method === 'GET' && url === '/grade/status') {
    const snap = _gradeSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, gerando: E._gradeGerando, desde: E._gradeDesde, gerado_em: snap ? snap.gerado_em : null }));
  }

  // ── Raiz "pura" → tela inicial da pessoa (Conversas da SoFIA) ─────────────
  // Abrir o domínio/bookmark (GET "/" sem querystring) leva à primeira tela
  // permitida — Conversas da SoFIA para quem tem acesso (inclui admin). A aba
  // WhatsApp continua acessível por /?view=config (o menu já aponta pra lá),
  // então não há loop.
  if (req.method === 'GET' && req.url === '/') {
    const dest = primeiraTela(sess);
    if (dest && dest !== '/') { res.writeHead(302, { Location: dest }); return res.end(); }
  }

  // ── Autorização por tela ─────────────────────────────────────────────────
  const tela = telaDaUrl(url);
  if (tela === 'perfis') { if (!sess.admin) return negarAcesso(res, sess); }
  else if (tela === 'sofia') {
    if (!sess.admin) {
      if (req.method === 'GET' && url === '/sofia') { if (!temSofia(sess)) return negarAcesso(res, sess); }
      else if (!sofiaRotaPermitida(sess, url)) return negarAcesso(res, sess);
    }
  }
  else if (tela === 'msg') {
    if (!sess.admin) {
      if (req.method === 'GET' && url === '/') { if (!temMsg(sess)) return negarAcesso(res, sess); }
      else if (!msgRotaPermitida(sess, url, req.url)) return negarAcesso(res, sess);
    }
  }
  else if (tela === 'funil') { if (!podeFunil(sess)) return negarAcesso(res, sess); }
  else if (tela && !sess.admin && !(sess.telas || []).includes(tela)) return negarAcesso(res, sess);

  // ── Indicadores → 💰 Pagamento dos professores (permissão "pagamento" — barrada acima) ──
  if (url === '/pagamento' || url.startsWith('/pagamento/')) {
    if (!PAGAMENTO_ATIVO) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Pagamento dos professores não está ligado nesta unidade (PAGAMENTO_PROFESSORES=1 no .env).'); }
    const pg = require('./pagamento/painel');
    const pcfg = require('./pagamento/config');
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    const voltar = (loc) => { res.writeHead(303, { Location: loc }); res.end(); };
    const avisoQ = (() => { const a = sp.get('ok'), e = sp.get('erro'); return e ? { aviso: '⚠️ ' + e, erro: true } : a === 'sync' ? { aviso: '🔄 Leitura do EVO pedida ao robô — leva alguns minutos. Atualize a página para ver o andamento.' } : a === 'regras' ? { aviso: '✅ Regras salvas.' } : a === 'prof' ? { aviso: '✅ Percentual salvo.' } : a === 'ocupado' ? { aviso: '⏳ O robô já está rodando outro pedido — tente de novo em 1 minuto.', erro: true } : {}; })();
    if (req.method === 'GET' && url === '/pagamento') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(chrome({ tab: 'Pagamento dos professores' }, 'pagamento', pg.pagina({ esc, uiTopo, uiChips, subnav: subnavIndicadores('pagamento'), ym: sp.get('m') || '', prof: sp.get('prof') || '', dia: sp.get('d') || '', aviso: avisoQ.aviso })));
    }
    if (req.method === 'GET' && url === '/pagamento/config') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(chrome({ tab: 'Pagamento dos professores' }, 'pagamento', pg.paginaConfig({ esc, uiTopo, subnav: subnavIndicadores('pagamento'), aviso: avisoQ.aviso, erro: avisoQ.erro })));
    }
    if (req.method === 'GET' && url === '/pagamento/relatorio') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(pg.relatorio({ esc, ym: sp.get('m') || pg.mesAtualSP(), prof: sp.get('prof') || '', studio: process.env.STUDIO_NOME || '' }));
    }
    // Ajustes manuais do mês (guardados em data/pagamento/ajustes-AAAA-MM.json).
    const rotasAjuste = { '/pagamento/excluir': 'excluir', '/pagamento/inserir': 'inserir', '/pagamento/desfazer': 'desfazer', '/pagamento/oculto': 'oculto' };
    if (req.method === 'POST' && rotasAjuste[url]) {
      return lerCorpo(req, 1e5, corpo => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        try {
          const d = JSON.parse(corpo || '{}'); const aj = require('./pagamento/ajustes'); const ym = String(d.m || '');
          const acao = rotasAjuste[url];
          if (acao === 'excluir') aj.excluir(ym, { m: d.m2, nome: d.nome, escopo: d.escopo, prof: d.prof, profNome: d.profNome, s: d.s, sDesc: d.sDesc, motivo: d.motivo, de: d.de, ate: d.ate }, sess.usuario);
          else if (acao === 'inserir') aj.inserir(ym, { m: d.m2, nome: d.nome, s: d.s, sDesc: d.sDesc, prof: d.prof, motivo: d.motivo }, sess.usuario);
          else if (acao === 'desfazer') aj.desfazer(ym, String(d.id || ''));
          else aj.alternarOculto(ym, String(d.h || ''), sess.usuario);
          try { auditoria.registrar(sess.usuario, 'pagamento.' + acao, `${ym} ${d.nome || d.h || d.id || ''}`.trim(), String(d.motivo || '').slice(0, 200)); } catch (_) {}
          return res.end(JSON.stringify({ ok: true }));
        } catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
      });
    }
    if (req.method === 'POST' && url === '/pagamento/sync') {
      return lerCorpo(req, 1e4, corpo => {
        const m = new URLSearchParams(corpo).get('m') || '';
        const arq = path.resolve(__dirname, '..', 'data', 'rodar-job.json');
        if (fs.existsSync(arq)) return voltar('/pagamento?m=' + encodeURIComponent(m) + '&ok=ocupado');
        try {
          fs.mkdirSync(path.resolve(__dirname, '..', 'data', 'pagamento'), { recursive: true });
          if (/^\d{4}-\d{2}$/.test(m)) fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'pagamento', 'pedido.json'), JSON.stringify({ ym: m, em: Date.now() }));
          fs.writeFileSync(arq, JSON.stringify({ job: 'pagamentoSync', id: 'pg' + Date.now().toString(36) }));
          auditoria.registrar(sess.usuario, 'pagamento.sync', m, '');
        } catch (_) {}
        voltar('/pagamento?m=' + encodeURIComponent(m) + '&ok=sync');
      });
    }
    if (req.method === 'POST' && url === '/pagamento/regras') {
      return lerCorpo(req, 1e5, corpo => {
        const p = Object.fromEntries(new URLSearchParams(corpo));
        try { pcfg.salvarRegras(p); auditoria.registrar(sess.usuario, 'pagamento.regras', JSON.stringify(p).slice(0, 300), ''); voltar('/pagamento/config?ok=regras'); }
        catch (e) { voltar('/pagamento/config?erro=' + encodeURIComponent(e.message)); }
      });
    }
    if (req.method === 'POST' && url === '/pagamento/professor') {
      return lerCorpo(req, 1e4, corpo => {
        const p = Object.fromEntries(new URLSearchParams(corpo));
        try { pcfg.salvarProfessor(p.chave, p.nome, p); auditoria.registrar(sess.usuario, 'pagamento.professor', `${p.nome}: ${p.pct}% piso ${p.piso} teto ${p.teto} desde ${p.desde}`, ''); voltar('/pagamento/config?ok=prof'); }
        catch (e) { voltar('/pagamento/config?erro=' + encodeURIComponent(e.message)); }
      });
    }
    if (req.method === 'POST' && url === '/pagamento/professor/remover') {
      return lerCorpo(req, 1e4, corpo => {
        const p = Object.fromEntries(new URLSearchParams(corpo));
        try { pcfg.removerVigencia(p.chave, p.desde); auditoria.registrar(sess.usuario, 'pagamento.professor.remover', `${p.chave} desde ${p.desde}`, ''); } catch (_) {}
        voltar('/pagamento/config?ok=prof');
      });
    }
    if (req.method === 'POST' && url === '/pagamento/importar') {
      return lerCorpo(req, 2e6, corpo => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        try {
          const d = JSON.parse(corpo || '{}');
          const sync = require('./pagamento/sync'); const nomes = {};
          const atual = pg.mesAtualSP();
          for (let k = 0; k < 6; k++) { let a = +atual.slice(0, 4), m = +atual.slice(5, 7) - k; while (m < 1) { m += 12; a--; } const md = sync.lerMes(a, m); for (const au of (md && md.aulas) || []) if (au.pi && au.p) nomes[au.p] = au.pi; }
          const r = pcfg.importarCsvSupabase(d.csv || '', nomes);
          auditoria.registrar(sess.usuario, 'pagamento.importar', `${r.importados} registro(s)`, '');
          return res.end(JSON.stringify({ ok: true, ...r }));
        } catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
      });
    }
    res.writeHead(404); return res.end();
  }

  // ── Indicadores → Funil (permissão "funil" — barrada acima) ──
  if (req.method === 'GET' && url === '/funil') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaSofiaFunil({ per: sp.get('per') || '7', de: sp.get('de') || '', ate: sp.get('ate') || '', canal: sp.get('canal') || '' }));
  }

  // ── Indicadores → Alunas ativas (permissão "ativas" — barrada acima) ──
  if (req.method === 'GET' && url === '/ativas') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaAtivas({ vis: sp.get('vis') || '', r: sp.get('r') || '', a: sp.get('a') || '', b: sp.get('b') || '' }));
  }
  if (req.method === 'GET' && url === '/ativas/resumo') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    const av = { erro: `<div class="ui-nota erro"><span>⚠️ Não salvei: ${esc(sp.get('msg') || '')}</span></div>`, salvo: '<div class="ui-nota ok"><span>✅ Configuração salva.</span></div>', enviando: '<div class="ui-nota ok"><span>📤 Pedido enviado ao robô — em 1 a 3 minutos a mensagem chega nos grupos. Atualize a página para ver o resultado.</span></div>' }[sp.get('ok') || ''] || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (sp.get('t') === 'semana') return res.end(paginaResumoSemanal({ ate: sp.get('ate') || '' }, av));
    return res.end(paginaResumoMensal({ mes: sp.get('mes') || '' }, av));
  }
  if (req.method === 'GET' && url === '/ativas/resumo/imagem') {
    const rm = require('./resumo-mensal');
    const mes = new URLSearchParams(req.url.split('?')[1] || '').get('mes') || '';
    let d = null; try { d = rm.dadosDoMes(/^\d{4}-\d{2}$/.test(mes) ? mes : undefined); } catch (_) {}
    res.writeHead(d ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(d ? rm.imagemHtml(d, scStudio()) : 'sem dados');
  }
  if (req.method === 'GET' && url === '/ativas/resumo/imagem-semana') {
    const rs = require('./resumo-semanal');
    const ate = new URLSearchParams(req.url.split('?')[1] || '').get('ate') || '';
    let d = null; try { d = rs.dadosDaSemana(ate); } catch (_) {}
    res.writeHead(d && !d.vazio ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(d && !d.vazio ? rs.imagemHtml(d, scStudio()) : 'sem dados');
  }
  if (req.method === 'POST' && url === '/ativas/resumo/semana/salvar') {
    return lerCorpo(req, 2e4, corpo => {
      const q = new URLSearchParams(corpo);
      let erro = '';
      try {
        const dias = q.getAll('dias').map(Number).filter(n => n >= 0 && n <= 6);
        require('./resumo-semanal').salvarCfg({ ativo: q.get('ativo') === '1', grupos: String(q.get('grupos') || '').slice(0, 1000), dias, hora: q.get('hora') || '',
          porProfessora: q.get('porProfessora') === '1', ativas: q.get('ativas') === '1', pendentes: q.get('pendentes') === '1' });
        auditoria.registrar(sess.usuario, 'ativas.resumo-semana.salvar', '', '');
      } catch (e) { erro = e.message; }
      res.writeHead(303, { Location: '/ativas/resumo?t=semana&ok=' + (erro ? 'erro&msg=' + encodeURIComponent(erro) : 'salvo') }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/ativas/resumo/semana/enviar') {
    return lerCorpo(req, 1e4, corpo => {
      const ate = new URLSearchParams(corpo).get('ate') || '';
      try {
        fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'rodar-job.json'), JSON.stringify({ job: 'resumoSemanal', ate: /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : undefined }));
        auditoria.registrar(sess.usuario, 'ativas.resumo-semana.enviar', ate, '');
      } catch (_) {}
      res.writeHead(303, { Location: '/ativas/resumo?t=semana&ok=enviando&ate=' + encodeURIComponent(ate) }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/ativas/resumo/salvar') {
    return lerCorpo(req, 2e4, corpo => {
      const q = new URLSearchParams(corpo);
      try {
        require('./resumo-mensal').salvarCfg({ ativo: q.get('ativo') === '1', grupos: String(q.get('grupos') || '').slice(0, 1000), dia: q.get('dia'), hora: q.get('hora'), experimentais: q.get('experimentais') === '1', nomesSaida: q.get('nomesSaida') === '1' });
        auditoria.registrar(sess.usuario, 'ativas.resumo.salvar', '', '');
      } catch (e) { console.log('[resumo mensal] salvar falhou:', e.message); }
      res.writeHead(303, { Location: '/ativas/resumo?ok=salvo' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/ativas/resumo/enviar') {
    return lerCorpo(req, 1e4, corpo => {
      const mes = new URLSearchParams(corpo).get('mes') || '';
      try {
        fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'rodar-job.json'), JSON.stringify({ job: 'resumoMensal', mes: /^\d{4}-\d{2}$/.test(mes) ? mes : undefined }));
        auditoria.registrar(sess.usuario, 'ativas.resumo.enviar', mes, '');
      } catch (_) {}
      res.writeHead(303, { Location: '/ativas/resumo?ok=enviando&mes=' + encodeURIComponent(mes) }); res.end();
    });
  }
  if (req.method === 'GET' && url === '/ativas/lista') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    const g = (k) => sp.get(k) || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaAtivasLista({ tipo: g('tipo'), m: g('m'), dia: g('dia'), de: g('de'), ate: g('ate'), c: g('c'), q: g('q'), p: g('p'), voltar: g('voltar') }));
  }
  if (req.method === 'POST' && url === '/ativas/atualizar') {
    // Roda o run_ativas_foto.py agora (só lê o EVO pela API; < 1 min; desiste em 5 min).
    if (!E._ativasGerando) {
      try {
        const { py, dir } = _gradePyBin();
        E._ativasGerando = true;
        require('child_process').execFile(py, ['run_ativas_foto.py'], { cwd: dir, timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          E._ativasGerando = false;
          const out = String((stdout || '') + (stderr || '')).trim().split('\n').filter(Boolean);
          E._ativasUltimo = err
            ? { ok: false, fim: Date.now(), msg: (err.killed ? 'passou de 5 minutos e foi interrompido. ' : '') + (out.slice(-4).join(' · ') || err.message || 'erro desconhecido') }
            : { ok: true, fim: Date.now(), msg: out.slice(-1)[0] || '' };
          if (err) console.log('[ativas] cálculo falhou:', E._ativasUltimo.msg);
        });
        try { auditoria.registrar(sess.usuario, 'ativas.atualizar', '', ''); } catch (_) {}
      } catch (e) { E._ativasGerando = false; E._ativasUltimo = { ok: false, fim: Date.now(), msg: e.message }; }
    }
    res.writeHead(303, { Location: '/ativas' }); return res.end();
  }

  // ── Indicadores → Professoras (permissão "professoras" — barrada acima) ──
  if (req.method === 'GET' && url === '/professoras') {
    const sp = new URLSearchParams(req.url.split('?')[1] || '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaProfessoras({ per: sp.get('per') || '30', de: sp.get('de') || '', ate: sp.get('ate') || '' }));
  }
  if (req.method === 'POST' && url === '/professoras/desde') {
    return lerCorpo(req, 1e4, corpo => {
      const d = new URLSearchParams(corpo).get('desde') || '';
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2020-01-01' && d <= hoje) {
        try { histExp.definirDesde(d); } catch (_) {}
        try { auditoria.registrar(sess.usuario, 'professoras.desde', d, ''); } catch (_) {}
      }
      res.writeHead(303, { Location: '/professoras' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/professoras/atualizar') {
    // Pede ao robô (mesma pasta data/) para ler a agenda de experimentais agora.
    try { fs.writeFileSync(path.resolve(__dirname, '..', 'data', 'rodar-job.json'), JSON.stringify({ job: 'historicoExperimentais' })); histExp.setStatus({ estado: 'executando', inicio: Date.now(), msg: '' }); } catch (_) {}
    try { auditoria.registrar(sess.usuario, 'professoras.ler-evo', '', ''); } catch (_) {}
    res.writeHead(303, { Location: '/professoras' }); return res.end();
  }

  // ── Formulários de campanha (permissão "formularios" — barrada acima) ──
  if (tela === 'formularios') return rotaFormulariosPainel(req, res, url, sess);

  // ── Slim Club: validação pela recepção (permissão "slimclub" — barrada acima) ──
  if (tela === 'slimclub') {
    if (req.method === 'GET' && url === '/clube') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      return scHtml(res, 200, paginaSlimClub(q.get('view') || 'pendentes', scBaseUrl(req), q.get('ok') === 'config' ? 'Configuração salva.' : ''));
    }
    if (req.method === 'POST' && url === '/clube/acao') {
      return lerCorpo(req, 1e4, corpo => {
        let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
        const id = String(d.id || ''), acao = String(d.acao || '');
        const antes = slimclub.obter(id);
        if (!antes) return scJson(res, 404, { erro: 'Cadastro não encontrado.' });
        const alvo = antes.negocio + ' (' + antes.nome + ')';
        if (acao === 'excluir') {
          slimclub.excluir(id, { por: sess.usuario });
          try { auditoria.registrar(sess.usuario, 'slimclub.excluir', alvo, ''); } catch (_) {}
          return scJson(res, 200, { ok: true });
        }
        if (acao === 'apagar') {
          if (!slimclub.apagarDeVez(id)) return scJson(res, 400, { erro: 'Só dá para apagar de vez o que já está em Excluídos.' });
          try { auditoria.registrar(sess.usuario, 'slimclub.apagar', alvo, ''); } catch (_) {}
          return scJson(res, 200, { ok: true });
        }
        if (acao === 'aprovar-alteracao' || acao === 'recusar-alteracao') {
          if (!antes.alteracao) return scJson(res, 400, { erro: 'Esta alteração já foi decidida. Recarregue a página.' });
          const aprovar = acao === 'aprovar-alteracao';
          slimclub.avaliarAlteracao(id, aprovar, sess.usuario, d.motivo);
          try { auditoria.registrar(sess.usuario, 'slimclub.' + acao, alvo, aprovar ? '' : String(d.motivo || '')); } catch (_) {}
          return scJson(res, 200, { ok: true });
        }
        if (acao === 'novo-codigo') {
          if (antes.status !== 'aprovado') return scJson(res, 400, { erro: 'Só empresas aprovadas têm código.' });
          const r = slimclub.trocarCodigo(id);
          try { auditoria.registrar(sess.usuario, 'slimclub.novo-codigo', alvo, ''); } catch (_) {}
          return scJson(res, 200, { ok: true, codigo: r.codigo });
        }
        if (acao === 'reenviar-aviso') {
          if (antes.status !== 'aprovado') return scJson(res, 400, { erro: 'Só dá para avisar cadastros aprovados.' });
          return scJson(res, 200, { ok: true, aviso: scAvisarAprovado(antes, req) });
        }
        const status = { aprovar: 'aprovado', recusar: 'recusado', pendente: 'pendente' }[acao];
        if (!status) return scJson(res, 400, { erro: 'Ação inválida.' });
        if (antes.status === 'excluido') return scJson(res, 400, { erro: 'Este anúncio foi excluído. Peça para cadastrarem de novo.' });
        const r = slimclub.avaliar(id, status, sess.usuario, d.motivo);
        try { auditoria.registrar(sess.usuario, 'slimclub.' + acao, alvo, status === 'recusado' ? String(d.motivo || '') : ''); } catch (_) {}
        const aviso = (status === 'aprovado' && antes.status !== 'aprovado' && slimclub.lerConfig().avisar) ? scAvisarAprovado(r, req) : null;
        return scJson(res, 200, { ok: true, aviso });
      });
    }
    // Empresa parceira cadastrada/editada pela recepção (já aprovada).
    if (url === '/clube/parceira' && req.method === 'GET') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const r = q.get('id') ? slimclub.obter(q.get('id')) : null;
      if (q.get('id') && (!r || !slimclub.ehParceira(r))) { res.writeHead(303, { Location: '/clube?view=aprovados' }); return res.end(); }
      return scHtml(res, 200, slimclubPaginas.paginaCadastro({
        studio: scStudio(), categorias: slimclub.CATEGORIAS, avisar: slimclub.lerConfig().avisar, comprovacao: slimclub.COMPROVACAO, parceira: true, painel: true,
        edicao: r ? { r, telefone: fmtTel(r.telefone), documento: slimclub.fmtDocumento(r.documento), fotoUrl: '/slimclub/foto/' + r.id } : null,
      }));
    }
    if (url === '/clube/parceira' && req.method === 'POST') {
      if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const id = q.get('id') || '';
      return lerCorpo(req, 2e6, corpo => {
        let d = null; try { d = JSON.parse(corpo); } catch (_) {}
        if (!d || typeof d !== 'object') return scJson(res, 400, { erro: 'Envio inválido. Recarregue a página.' });
        const r = id ? slimclub.editarParceira(id, d, sess.usuario) : slimclub.criarParceira(d, { porRecepcao: true, usuario: sess.usuario });
        if (!r.ok) return scJson(res, 400, { erro: r.erro });
        try { auditoria.registrar(sess.usuario, id ? 'slimclub.parceira-editar' : 'slimclub.parceira-nova', r.r.negocio, ''); } catch (_) {}
        // Nova parceira já aprovada: manda o aviso com o código, como numa aprovação.
        if (!id && slimclub.lerConfig().avisar) scAvisarAprovado(r.r, req);
        return scJson(res, 200, { ok: true, ir: '/clube?view=aprovados' });
      });
    }
    if (req.method === 'POST' && url === '/clube/reclamacao') {
      return lerCorpo(req, 1e4, corpo => {
        let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
        const r = slimclub.tratarReclamacao(String(d.id || ''), d.acao === 'resolver', sess.usuario, d.nota);
        if (!r) return scJson(res, 404, { erro: 'Reclamação não encontrada.' });
        try { auditoria.registrar(sess.usuario, 'slimclub.reclamacao-' + (d.acao === 'resolver' ? 'resolver' : 'reabrir'), r.empresa + ' (' + (r.nome || r.tel) + ')', String(d.nota || '')); } catch (_) {}
        return scJson(res, 200, { ok: true });
      });
    }
    if (req.method === 'POST' && url === '/clube/config') {
      return lerCorpo(req, 1e4, corpo => {
        const p = new URLSearchParams(corpo);
        slimclub.gravarConfig({ avisar: p.get('avisar') === '1', msgAprovado: p.get('restaurar') === '1' ? '' : (p.get('msg') || '') });
        try { auditoria.registrar(sess.usuario, 'slimclub.config', 'Aviso de aprovação', ''); } catch (_) {}
        res.writeHead(303, { Location: '/clube?view=config&ok=config' }); return res.end();
      });
    }
  }

  // ── Perfis (só admin — já barrado acima) ─────────────────────────────────
  if (tela === 'perfis') {
    if (req.method === 'GET' && url === '/perfis') {
      const q = req.url.split('?')[1] || '';
      let aviso = '', erro = false;
      if (/(?:^|&)ok=criado/.test(q)) aviso = 'Usuário criado! Já pode entrar.';
      else if (/(?:^|&)ok=telas/.test(q)) aviso = 'Telas atualizadas.';
      else if (/(?:^|&)ok=senha/.test(q)) aviso = 'Senha redefinida.';
      else if (/(?:^|&)ok=email/.test(q)) aviso = 'E-mail salvo. Já pode entrar com o Google.';
      else if (/(?:^|&)ok=excluido/.test(q)) aviso = 'Usuário excluído.';
      else if (/(?:^|&)ok=sessao/.test(q)) aviso = 'Duração da sessão salva. Vale para os próximos logins.';
      else if (/(?:^|&)ok=sess-enc/.test(q)) aviso = 'Sessão encerrada. A pessoa precisará entrar de novo.';
      else if (/(?:^|&)err=/.test(q)) { aviso = (() => { try { return decodeURIComponent((q.match(/err=([^&]*)/) || [])[1] || 'Erro.'); } catch (_) { return 'Erro.'; } })(); erro = true; }
      const spP = new URLSearchParams(q);
      const viewPerfis = spP.get('view') || 'usuarios';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginaPerfis(aviso, erro, viewPerfis, { u: spP.get('u'), area: spP.get('area'), q: spP.get('q'), de: spP.get('de'), ate: spP.get('ate') }));
    }
    // Auditoria em CSV (com os mesmos filtros da tela). Perfis = só admin (checado acima).
    if (req.method === 'GET' && url === '/perfis/auditoria.csv') {
      const spP = new URLSearchParams(req.url.split('?')[1] || '');
      const csv = require('./painel-perfis').auditoriaCsv({ u: spP.get('u'), area: spP.get('area'), q: spP.get('q'), de: spP.get('de'), ate: spP.get('ate') });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
      return res.end(csv);
    }
    if (req.method === 'POST' && url === '/perfis/criar') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { const ehAdmin = p.get('admin') === '1'; usuarios.criar({ usuario: p.get('usuario'), senha: p.get('senha') || '', telas: p.getAll('telas'), email: p.get('email') || '', admin: ehAdmin }); try { auditoria.registrar(sess.usuario, 'perfil.criar', p.get('usuario') || '', ehAdmin ? '👑 como administrador' : ''); } catch (_) {} res.writeHead(303, { Location: '/perfis?ok=criado' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/sessao') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { const v = gravarSessaoDias(p.get('dias')); try { auditoria.registrar(sess.usuario, 'perfil.sessao', '', v + ' dia(s)'); } catch (_) {} res.writeHead(303, { Location: '/perfis?view=acessos&ok=sessao' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?view=acessos&err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/sessao-encerrar') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        const sid = String(p.get('sid') || '').trim();
        let alvoU = ''; try { alvoU = (E._sessoes[sid] || {}).usuario || ''; } catch (_) {}
        const ok = sid ? revogarSessao(sid) : false;
        try { if (ok) auditoria.registrar(sess.usuario, 'perfil.sessao-encerrar', alvoU || sid, ''); } catch (_) {}
        res.writeHead(303, { Location: '/perfis?view=acessos&' + (ok ? 'ok=sess-enc' : 'err=' + encodeURIComponent('sessão não encontrada')) }); res.end();
      });
    }
    if (req.method === 'POST' && url === '/perfis/email') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { usuarios.definirEmail(p.get('usuario'), p.get('email') || ''); try { auditoria.registrar(sess.usuario, 'perfil.email', p.get('usuario') || '', ''); } catch (_) {} res.writeHead(303, { Location: '/perfis?ok=email' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/telas') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        const alvoU = p.get('usuario');
        const ehAdmin = p.get('admin') === '1';
        let eraAdmin = false; try { const cu = usuarios.obter(alvoU); eraAdmin = !!(cu && cu.admin); } catch (_) {}
        try { usuarios.definirAdmin(alvoU, ehAdmin); } catch (_) {}       // liga/desliga admin (admin limpa as telas)
        if (!ehAdmin) usuarios.definirTelas(alvoU, p.getAll('telas'));      // só mexe em telas quando NÃO é admin
        if (ehAdmin !== eraAdmin) { try { auditoria.registrar(sess.usuario, 'perfil.admin', alvoU || '', ehAdmin ? 'promoveu a administrador' : 'removeu o administrador'); } catch (_) {} }
        else { try { auditoria.registrar(sess.usuario, 'perfil.telas', alvoU || '', ehAdmin ? 'admin (todas as telas)' : (p.getAll('telas') || []).join(', ')); } catch (_) {} }
        res.writeHead(303, { Location: '/perfis?ok=telas' }); res.end();
      });
    }
    if (req.method === 'POST' && url === '/perfis/senha') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        try { usuarios.definirSenha(p.get('usuario'), p.get('senha') || ''); try { auditoria.registrar(sess.usuario, 'perfil.senha', p.get('usuario') || '', 'redefiniu a senha'); } catch (_) {} res.writeHead(303, { Location: '/perfis?ok=senha' }); res.end(); }
        catch (e) { res.writeHead(303, { Location: '/perfis?err=' + encodeURIComponent(e.message) }); res.end(); }
      });
    }
    if (req.method === 'POST' && url === '/perfis/excluir') {
      return lerCorpo(req, 1e5, corpo => {
        const p = new URLSearchParams(corpo);
        usuarios.remover(p.get('usuario'));
        try { auditoria.registrar(sess.usuario, 'perfil.excluir', p.get('usuario') || '', ''); } catch (_) {}
        res.writeHead(303, { Location: '/perfis?ok=excluido' }); res.end();
      });
    }
  }

  // Página de mensagens
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Mensagem salva! Já vale no próximo envio.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horários salvos e robô reiniciado. Já valem.';
    else if (/(?:^|&)dcon=1/.test(q)) aviso = '🔌 Desconexão solicitada. O robô vai encerrar a sessão e, em alguns segundos, mostrar um QR novo aqui para reconectar.';
    else if (/(?:^|&)oksof=1/.test(q)) aviso = '🔄 Robô reiniciando… ele volta ao ar em ~1 minuto (o selo do WhatsApp acima mostra quando reconectar).';
    else if (/(?:^|&)errsof=1/.test(q)) { aviso = '⚠️ Não consegui reiniciar o robô pelo painel. Rode no servidor: pm2 restart ' + PM2_EXP; erro = true; }
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horários salvos, mas não consegui reiniciar o robô automaticamente. Rode no servidor: pm2 restart ' + PM2_EXP; erro = true; }
    else if (/(?:^|&)okdias=1/.test(q)) aviso = '✅ Dias depois do vencimento salvos — vale no próximo disparo.';
    else if (/(?:^|&)errdias=1/.test(q)) { aviso = '⚠️ Use um número de 1 a 60 dias.'; erro = true; }
    else if (/(?:^|&)oksim=1/.test(q)) aviso = '🧪 Simulação pedida ao robô — em 1 a 2 minutos, atualize a página: o resultado aparece no cartão "Saída — não renovou".';
    else if (/(?:^|&)oksfcfg=1/.test(q)) aviso = '✅ Sentimos sua falta: dias salvos — vale no próximo disparo, sem reiniciar.';
    else if (/(?:^|&)errsfcfg=1/.test(q)) { aviso = '⚠️ Sentimos sua falta: use de 7 a 120 dias sem treinar e de 3 a 60 dias entre as mensagens.'; erro = true; }
    else if (/(?:^|&)oksfsim=1/.test(q)) aviso = '🧪 Simulação pedida ao robô — ele lê o EVO (leva uns 5 a 15 minutos). Depois atualize a página: o resultado aparece no cartão "Sentimos sua falta — 1ª mensagem".';
    else if (/(?:^|&)errsim=1/.test(q)) { aviso = '⚠️ O robô ainda vai rodar outro pedido — tente de novo em 1 minuto.'; erro = true; }
    else if (/(?:^|&)okae=1/.test(q)) aviso = '🚫 Grupos que não recebem o parabéns salvos — já vale no próximo envio.';
    else if (/(?:^|&)errae=1/.test(q)) { aviso = '⚠️ Não consegui salvar os grupos que não recebem o parabéns.'; erro = true; }
    else if (/(?:^|&)okfree=1/.test(q)) aviso = '✅ Planos FREE: configuração salva — já vale na próxima verificação (sem reiniciar).';
    // Só a sub-aba permitida; se pediu uma sem acesso, cai na primeira permitida.
    // "Express" é a tela unificada (Express + Agendar mensagem); view=agendar cai nela.
    const podeMerged = podeMsgSub(sess, 'express') || podeMsgSub(sess, 'agendar');
    let view = /(?:^|&)view=(agendar|express)/.test(q) ? 'express' : 'config';
    if (view === 'express' ? !podeMerged : !podeMsgSub(sess, view)) {
      view = podeMsgSub(sess, 'config') ? 'config' : (podeMerged ? 'express' : (podeMsgSub(sess, 'hoje') ? 'hoje' : 'config'));
    }
    if (view === 'hoje') { res.writeHead(303, { Location: '/hoje' }); return res.end(); } // só tem Hoje → vai pra lá
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (view === 'express') return res.end(paginaExpress(aviso, erro)); // tela unificada Express + Agendar mensagem
    return res.end(paginaMensagens(aviso, erro));
  }
  if (req.method === 'POST' && url === '/salvar') {
    return lerCorpo(req, 1e6, corpo => {
      const p = new URLSearchParams(corpo);
      const vRaw = p.get('voltar');
      const voltar = (vRaw === '/instagram' || vRaw === '/sofia?view=cobranca') ? vRaw : '/'; // whitelist
      try {
        if (p.get('reset')) mensagens.salvarOverride(p.get('chave'), '');
        else mensagens.salvarOverride(p.get('chave'), p.get('texto') || '');
        const sep = voltar.includes('?') ? '&' : '?';
        res.writeHead(303, { Location: voltar + sep + 'ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        const msg = 'Erro ao salvar: ' + e.message;
        res.end(voltar === '/instagram' ? paginaInstagram(msg, true) : voltar === '/sofia?view=cobranca' ? paginaCobranca(msg, true) : paginaMensagens(msg, true));
      }
    });
  }

  // Nomes dos grupos do WhatsApp (equipe / circuito), editáveis no painel.
  if (req.method === 'POST' && url === '/grupos/salvar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        grupos.salvar({ equipe: p.get('equipe') || '', circuito: p.get('circuito') || '' });
        res.writeHead(303, { Location: '/?ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaMensagens('Erro ao salvar grupos: ' + e.message, true));
      }
    });
  }

  // Foto (flyer) de uma mensagem: salvar / remover / servir.
  if (req.method === 'POST' && url === '/mensagem/foto/salvar') {
    return lerCorpo(req, 12e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        mensagens.salvarFoto(d.chave, d.fotoDataUrl);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'POST' && url === '/mensagem/foto/remover') {
    return lerCorpo(req, 1e5, corpo => {
      try { mensagens.removerFoto(JSON.parse(corpo || '{}').chave); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
    });
  }
  // 🎙️ Áudio da professora (follow-up / confirmação)
  if (req.method === 'POST' && url === '/mensagem/audio/salvar') {
    return lerCorpo(req, 24e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const r = audiosMsg.salvar(String(d.grupo || ''), String(d.professora || ''), d.dataUrl, String(d.nome || ''));
        E._profsAudio.em = 0;
        try { auditoria.registrar(sess.usuario, 'audio.salvar', `${d.grupo} · ${d.professora}`, r.arquivo); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'POST' && url === '/mensagem/audio/remover') {
    return lerCorpo(req, 1e5, corpo => {
      try { const d = JSON.parse(corpo || '{}'); audiosMsg.remover(String(d.grupo || ''), String(d.slug || '')); try { auditoria.registrar(sess.usuario, 'audio.remover', `${d.grupo} · ${d.slug}`, ''); } catch (_) {} } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
    });
  }
  if (req.method === 'GET' && url === '/mensagem/audio') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const grupo = q.get('grupo') || '', slug = audiosMsg.slugProf(q.get('slug') || '');
    const caminho = audiosMsg.GRUPOS[grupo] && slug ? (audiosMsg.arquivoPainel(grupo, slug) || (audiosMsg.GRUPOS[grupo].legado ? audiosMsg.arquivoLegado(slug) : null)) : null;
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('nao encontrado'); }
    const ext = caminho.split('.').pop().toLowerCase();
    const tipo = { ogg: 'audio/ogg', opus: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=60' });
    return fs.createReadStream(caminho).pipe(res);
  }
  if (req.method === 'GET' && url === '/mensagem/foto') {
    const chave = new URLSearchParams(req.url.split('?')[1] || '').get('chave');
    const caminho = /^[a-z_]+$/i.test(chave || '') ? mensagens.fotoPath(chave) : null;
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('nao encontrada'); }
    const ext = caminho.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=60' });
    return fs.createReadStream(caminho).pipe(res);
  }

  // ↻ Reenviar uma mensagem que falhou (Log de envios): o robô manda só essa, com o
  // número corrigido. Aparece no Log como "<tipo original> · reenvio".
  if (req.method === 'POST' && url === '/hoje/reenviar') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const ctx = String(d.contexto || '').trim().slice(0, 60);
        // a foto só vai se for de uma mensagem do painel que tem foto salva
        const chaveFoto = /^[a-z0-9_]{2,60}$/i.test(String(d.chaveFoto || '')) && mensagens.fotoPath(d.chaveFoto) ? String(d.chaveFoto) : '';
        const id = teste.solicitar({ telefone: d.telefone, texto: String(d.texto || '').slice(0, 4000), chaveFoto, contexto: (ctx ? ctx + ' · reenvio' : 'Reenvio (painel)') });
        try { auditoria.registrar(sess && sess.usuario, 'log.reenviar', String(d.telefone || '').replace(/\D/g, ''), ctx); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // ↻ Rodar de novo (Log): pede ao robô para rodar o job que falhou.
  if (req.method === 'POST' && url === '/hoje/rodar-job') {
    return lerCorpo(req, 1e4, corpo => {
      const resp = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      try {
        const pd = JSON.parse(corpo || '{}');
        const job = String(pd.job || ''), linha = String(pd.linha || '');
        if (!JOBS_REFAZER.has(job)) return resp({ ok: false, erro: 'job desconhecido' }, 400);
        // Mesmo job já pedido e ainda sem resultado (até 25 min): não pede de novo.
        const ant = _refazerPedido[job];
        if (ant && Date.now() - ant.em < 25 * 60000) {
          const st = statusRodarJob(ant.id);
          if (!st || !['ok', 'erro'].includes(st.estado)) { gravarRefeito(linha, { job, id: ant.id, por: (sess && sess.usuario) || '', em: Date.now() }); return resp({ ok: true, id: ant.id, jaPedido: true }); }
        }
        const arq = path.resolve(__dirname, '..', 'data', 'rodar-job.json');
        if (fs.existsSync(arq)) return resp({ ok: false, erro: 'o robô ainda vai rodar outro pedido — tente em 1 minuto' });
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        fs.writeFileSync(arq, JSON.stringify({ job, id }));
        _refazerPedido[job] = { id, em: Date.now() };
        gravarRefeito(linha, { job, id, por: (sess && sess.usuario) || '', em: Date.now() });
        try { auditoria.registrar(sess && sess.usuario, 'log.rodar-job', job, ''); } catch (_) {}
        return resp({ ok: true, id });
      } catch (e) { return resp({ ok: false, erro: e.message }, 400); }
    });
  }

  if (req.method === 'GET' && url === '/hoje/rodar-job/status') {
    const id = new URLSearchParams(req.url.split('?')[1] || '').get('id') || '';
    const st = statusRodarJob(id) || { estado: 'pendente', msg: '' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ estado: st.estado, msg: st.msg || '' }));
  }

  // Enviar teste: painel grava o pedido; o robô (que tem a sessão) envia.
  if (req.method === 'POST' && url === '/teste/enviar') {
    return lerCorpo(req, 1e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        // Exemplos por mensagem (ex.: {aluna} = "@Maria" no aniversário). d.chave é
        // sempre a chave da mensagem; a foto só entra se d.comFoto estiver marcado.
        const textoFinal = mensagens.renderTexto(d.texto || '', mensagens.exemplosDe(d.chave));
        const chaveFoto = d.comFoto ? (d.chave || '') : (d.chaveFoto || '');
        const id = teste.solicitar({ telefone: d.telefone, texto: textoFinal, chaveFoto });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'GET' && url === '/teste/status') {
    const id = new URLSearchParams(req.url.split('?')[1] || '').get('id');
    const p = teste.ler(id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(p ? { status: p.status, erro: p.erro } : { status: 'desconhecido' }));
  }
  // Teste da COBRANÇA: enfileira na fila da SoFIA (sai pelo NÚMERO dela, não o do robô).
  if (req.method === 'POST' && url === '/cobranca/teste') {
    return lerCorpo(req, 1e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const tel = String(d.telefone || '').replace(/\D/g, '');
        if (tel.length < 10) throw new Error('Número para testes inválido (preencha no topo).');
        const texto = mensagens.renderTexto(d.texto || '', mensagens.exemplosDe(d.chave));
        if (!String(texto).trim()) throw new Error('texto vazio');
        const outbox = process.env.COBRANCA_OUTBOX_FILE || path.resolve(__dirname, '..', 'data', 'cobranca-outbox.jsonl');
        const linha = JSON.stringify({ id: 'teste-' + Date.now(), telefone: tel, texto, nome: 'Teste', tipo: 'teste', em: new Date().toISOString() });
        try { fs.mkdirSync(path.dirname(outbox), { recursive: true }); } catch (_) {}
        fs.appendFileSync(outbox, linha + '\n', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Config da cobrança: "vencido há X+ dias" (não precisa reiniciar — lido a cada run).
  if (req.method === 'POST' && url === '/cobranca/config') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const p = new URLSearchParams(corpo);
        const v = inadConfig.salvarDias(p.get('dias'));
        res.writeHead(303, { Location: '/sofia?view=cobranca&okdias=' + v }); return res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(paginaCobranca('Erro ao salvar: ' + e.message, true));
      }
    });
  }
  // Config dos planos FREE (desmarcação por antecedência): liga/desliga + intervalo
  // (horas) + janela (dias). Não precisa reiniciar — o robô lê a cada verificação.
  if (req.method === 'POST' && url === '/free/config') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const p = new URLSearchParams(corpo);
        // O liga/desliga é o toggle do card (switchEnvio → /envio/ativo); aqui só
        // salvamos intervalo, janela, planos e texto — sem mexer no on/off.
        const fh = p.get('freeHoras'); if (fh != null && fh !== '') freeCfg.salvarHoras(fh);
        const fd = p.get('freeDias'); if (fd != null && fd !== '') freeCfg.salvarDias(fd);
        const fp = p.get('freePlanos'); if (fp != null) freeCfg.salvarPlanos(fp);
        const ft = p.get('freeTexto'); if (ft != null) freeCfg.salvarTexto(ft);
        try { auditoria.registrar(sess.usuario, 'free.config', 'Planos FREE — antecedência', `horas=${fh} dias=${fd}`); } catch (_) {}
        res.writeHead(303, { Location: '/?okfree=1' }); return res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(paginaMensagens('Erro ao salvar a config dos planos FREE: ' + e.message, true));
      }
    });
  }

  // Página de agendamentos
  if (req.method === 'GET' && (url === '/agendar')) {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)ok=1/.test(q)) aviso = 'Agendamento salvo! Será enviado no dia e turno escolhidos.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horários salvos e robô reiniciado. Já valem.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horários salvos, mas não consegui reiniciar o robô automaticamente. Rode no servidor: pm2 restart ' + PM2_EXP; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaExpress(aviso, erro)); // /agendar (link antigo) → tela unificada Express
  }
  if (req.method === 'POST' && url === '/agendar/salvar') {
    return lerCorpo(req, 12e6, corpo => { // base64 da foto cabe aqui (~10-12 MB)
      try {
        const d = JSON.parse(corpo || '{}');
        if (d.id) ag.atualizar(d.id, { telefone: d.telefone, mensagem: d.mensagem, fotoDataUrl: d.fotoDataUrl, temFoto: !!d.temFoto, turno: d.turno, data: d.data });
        else ag.adicionar({ telefone: d.telefone, mensagem: d.mensagem, fotoDataUrl: d.fotoDataUrl, turno: d.turno, data: d.data });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'POST' && url === '/agendar/remover') {
    return lerCorpo(req, 1e5, corpo => {
      try { ag.remover(new URLSearchParams(corpo).get('id')); } catch (_) {}
      res.writeHead(303, { Location: '/agendar' }); res.end();
    });
  }
  if (req.method === 'GET' && url === '/agendar/foto') {
    const nome = new URLSearchParams(req.url.split('?')[1] || '').get('nome');
    const caminho = ag.caminhoFoto(nome);
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('nao encontrada'); }
    const ext = nome.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(caminho).pipe(res);
  }

  // /horarios agora vive dentro da aba Mensagens — redireciona quem tiver link antigo.
  if (req.method === 'GET' && url === '/horarios') {
    res.writeHead(301, { Location: '/?view=config' }); return res.end();
  }
  if (req.method === 'POST' && url === '/horarios/salvar') {
    return lerCorpo(req, 1e6, corpo => {
      const p = new URLSearchParams(corpo);
      const vRaw = p.get('voltar');
      const voltar = (vRaw === '/agendar' || vRaw === '/instagram' || vRaw === '/sofia?view=cobranca') ? vRaw : '/'; // whitelist
      try {
        // Valida TUDO antes de salvar qualquer coisa (build lança em entrada inválida).
        const planos = horarios.CATALOGO.map(j => {
          const hora = p.get('hora_' + j.chave);
          if (hora == null) return null; // job não presente no form → mantém como está
          const dias = p.getAll('dias_' + j.chave).map(Number);
          horarios.build(hora, dias); // valida (lança se inválido)
          return { chave: j.chave, hora, dias };
        }).filter(Boolean);
        planos.forEach(pl => horarios.salvar(pl.chave, pl.hora, pl.dias));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        const msg = 'Erro ao salvar horários: ' + e.message + ' (nada foi alterado).';
        return res.end(voltar === '/agendar' ? paginaExpress(msg, true) : voltar === '/instagram' ? paginaInstagram(msg, true) : voltar === '/sofia?view=cobranca' ? paginaCobranca(msg, true) : paginaMensagens(msg, true));
      }
      // Reinicia o robô para reagendar os jobs com os novos horários.
      exec('pm2 restart ' + PM2_EXP + ' --update-env', { timeout: 25000 }, (err) => {
        const sep = voltar.includes('?') ? '&' : '?';
        res.writeHead(303, { Location: voltar + sep + (err ? 'errh=1' : 'okh=1') }); res.end();
      });
    });
  }

  // Antecedência da Renovação (dias antes do vencimento) — não precisa reiniciar.
  if (req.method === 'POST' && url === '/aniversario/excluir') {
    return lerCorpo(req, 1e5, corpo => {
      let ok = true, gr = [];
      try { gr = anivExcluir.salvar(new URLSearchParams(corpo).get('grupos') || ''); } catch (_) { ok = false; }
      try { if (ok) auditoria.registrar(sess.usuario, 'aniversario.excluir', gr.join(' | ') || '(nenhum)', ''); } catch (_) {}
      res.writeHead(303, { Location: '/?view=config&' + (ok ? 'okae=1' : 'errae=1') + '#aniv-excluir' }); res.end();
    });
  }

  if (req.method === 'POST' && url === '/sentimos/cfg') {
    return lerCorpo(req, 1e4, corpo => {
      const p = new URLSearchParams(corpo);
      let r = null;
      try { r = require('./sentimos-falta').salvarCfg({ diasAusente: p.get('diasAusente'), diasEntre: p.get('diasEntre') }); } catch (_) {}
      try { if (r) auditoria.registrar(sess.usuario, 'sentimos.cfg', `${r.diasAusente} dias / 2ª após ${r.diasEntre}`, ''); } catch (_) {}
      res.writeHead(303, { Location: '/?view=config&' + (r ? 'oksfcfg=1' : 'errsfcfg=1') + '#sentimos' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/sentimos/simular') {
    return lerCorpo(req, 1e4, () => {
      let ok = true;
      try {
        const arq = path.resolve(__dirname, '..', 'data', 'rodar-job.json');
        if (fs.existsSync(arq)) ok = false;
        else fs.writeFileSync(arq, JSON.stringify({ job: 'sentimosFaltaDry', id: 'sim' + Date.now().toString(36) }));
        try { auditoria.registrar(sess.usuario, 'sentimos.simular', '', ''); } catch (_) {}
      } catch (_) { ok = false; }
      res.writeHead(303, { Location: '/?view=config&' + (ok ? 'oksfsim=1' : 'errsim=1') + '#sentimos' }); res.end();
    });
  }

  if (req.method === 'POST' && url === '/saidas/dias') {
    return lerCorpo(req, 1e4, corpo => {
      let n = null;
      try { n = require('./saidas-grupos').salvarDias(new URLSearchParams(corpo).get('dias')); } catch (_) {}
      try { if (n != null) auditoria.registrar(sess.usuario, 'saidas.dias', String(n), ''); } catch (_) {}
      res.writeHead(303, { Location: '/?view=config&' + (n != null ? 'okdias=1' : 'errdias=1') + '#saidas' }); res.end();
    });
  }

  if (req.method === 'POST' && url === '/saidas/simular') {
    return lerCorpo(req, 1e4, () => {
      let ok = true;
      try {
        const arq = path.resolve(__dirname, '..', 'data', 'rodar-job.json');
        if (fs.existsSync(arq)) ok = false;
        else fs.writeFileSync(arq, JSON.stringify({ job: 'saidaGruposDry', id: 'sim' + Date.now().toString(36) }));
        try { auditoria.registrar(sess.usuario, 'saidas.simular', '', ''); } catch (_) {}
      } catch (_) { ok = false; }
      res.writeHead(303, { Location: '/?view=config&' + (ok ? 'oksim=1' : 'errsim=1') + '#saidas' }); res.end();
    });
  }

  if (req.method === 'POST' && url === '/renovacao/dias') {
    return lerCorpo(req, 1e4, corpo => {
      const n = renovacaoConfig.salvarDias(new URLSearchParams(corpo).get('dias'));
      try { if (n != null) auditoria.registrar(sess.usuario, 'renovacao.dias', String(n), ''); } catch (_) {}
      res.writeHead(303, { Location: '/?view=config' + (n != null ? '&ok=1' : '&erro=dias') }); res.end();
    });
  }

  // Página de indicadores do formulário
  if (req.method === 'GET' && url === '/indicadores') {
    const sp2 = new URLSearchParams(req.url.split('?')[1] || '');
    const d = sp2.get('dias');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaIndicadores(d == null ? 7 : parseInt(d, 10), sp2.get('erro') || ''));
  }
  // Saúde do sistema (admin) — consulta o PM2 (assíncrono) e renderiza os selos.
  if (req.method === 'GET' && url === '/saude') {
    return exec('pm2 jlist', { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, async (err, stdout) => {
      let list = null; try { list = JSON.parse(stdout); } catch (_) {}
      // Grade: checagem viva com timeout curto (o form free do Render pode "dormir").
      let grade = null;
      try {
        const chk = require('./verificar-grade-nuvem').estadoGradeNuvem();
        grade = await Promise.race([chk, new Promise(r => setTimeout(() => r({ timeout: true }), 4000))]);
      } catch (_) { grade = { erro: true }; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(paginaSaude(list, { grade }));
    });
  }
  // Criar / excluir canal de origem (gerador de links).
  if (req.method === 'POST' && url === '/origens/criar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      let ok = true, msg = '';
      try { origens.criar({ rot: p.get('rot'), desc: p.get('desc') }); } catch (e) { ok = false; msg = e.message; }
      res.writeHead(303, { Location: '/indicadores' + (ok ? '' : '?erro=' + encodeURIComponent(msg)) }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/origens/excluir') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try { origens.remover(p.get('slug')); } catch (_) {}
      res.writeHead(303, { Location: '/indicadores' }); res.end();
    });
  }

  // Página "Hoje" (o que o robô enviou)
  if (req.method === 'GET' && url === '/hoje') {
    const dia = new URLSearchParams(req.url.split('?')[1] || '').get('dia');
    const valido = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') ? dia : null;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaHoje(valido));
  }

  // Aba Sofia (chatbot): prompt, configs e conexão
  if (req.method === 'GET' && url === '/sofia') {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)okdias=\d+/.test(q)) aviso = '⏱️ Salvo! A cobrança passa a começar a partir de ' + ((q.match(/okdias=(\d+)/) || [])[1] || '?') + ' dia(s) de atraso.';
    else if (/(?:^|&)ok=1/.test(q)) aviso = 'Salvo! As próximas conversas já usam estas configurações.';
    else if (/(?:^|&)okma=\d+/.test(q)) aviso = '📣 Boas-vindas do anúncio salvas (' + ((q.match(/okma=(\d+)/) || [])[1] || '0') + ') — a SoFIA não se pausa mais com elas.';
    else if (/(?:^|&)on=1/.test(q)) aviso = '🟢 SoFIA ativada — voltou a responder as alunas.';
    else if (/(?:^|&)off=1/.test(q)) aviso = '⏸️ SoFIA pausada — atenda manualmente pelo WhatsApp.';
    else if (/(?:^|&)rest=1/.test(q)) aviso = 'Restaurado para a versão anterior.';
    else if (/(?:^|&)rest=0/.test(q)) { aviso = 'Não havia versão anterior para restaurar.'; erro = true; }
    else if (/(?:^|&)ctok=1/.test(q)) aviso = 'Tags salvas.';
    else if (/(?:^|&)lote=/.test(q)) aviso = `🏷️ ${(q.match(/lote=(\d+)/) || [])[1] || '0'} contato(s) atualizado(s) em lote.`;
    else if (/(?:^|&)dcon=1/.test(q)) aviso = '🔌 Desconexão solicitada. A SoFIA vai encerrar a sessão e, em alguns segundos, mostrar um QR novo aqui para reconectar.';
    else if (/(?:^|&)oksof=1/.test(q)) aviso = '🔄 SoFIA reiniciando… ela volta ao ar em ~1 minuto (o selo do WhatsApp acima mostra quando reconectar). Modelo e transcrição já valem.';
    else if (/(?:^|&)errsof=1/.test(q)) { aviso = '⚠️ Não consegui reiniciar a SoFIA pelo painel. Rode no servidor: pm2 restart ' + PM2_SOFIA; erro = true; }
    else if (/(?:^|&)okc=criada/.test(q)) aviso = '📣 Campanha criada! A IA está gerando as variações. Quando ficar “pronta”, clique em ▶️ Iniciar para começar o envio.';
    else if (/(?:^|&)okah=1/.test(q)) aviso = 'Aviso "precisa de humano" salvo.';
    else if (/(?:^|&)okalu=1/.test(q)) aviso = '🎓 Regras das alunas salvas! Valem na hora.';
    else if (/(?:^|&)okhist=1/.test(q)) aviso = '👋 Etiquetas de ex-aluna e de quem já fez experimental salvas! Valem na próxima mensagem.';
    else if (/(?:^|&)oknr=\d+/.test(q)) aviso = '🔕 Lista de "não responder" salva (' + ((q.match(/oknr=(\d+)/) || [])[1] || '0') + ' número(s)).';
    else if (/(?:^|&)okcmp=1/.test(q) && /(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Config salva, mas não consegui reiniciar o robô p/ aplicar o novo horário. Rode no servidor: pm2 restart ' + PM2_EXP; erro = true; }
    else if (/(?:^|&)okcmp=1/.test(q)) aviso = 'Config de presença (troca de tags) salva.';
    else if (/(?:^|&)okc=ok/.test(q)) aviso = '✔️ Feito.';
    else if (/(?:^|&)errc=/.test(q)) { aviso = (() => { try { return decodeURIComponent((q.match(/errc=([^&]*)/) || [])[1] || 'Erro na campanha.'); } catch (_) { return 'Erro.'; } })(); erro = true; }
    const sp = new URLSearchParams(q);
    // Endereço antigo do Funil (SoFIA → Funil) → Indicadores → Funil, mantendo os filtros.
    if (sp.get('view') === 'funil') { sp.delete('view'); res.writeHead(302, { Location: '/funil' + (sp.toString() ? '?' + sp.toString() : '') }); return res.end(); }
    // Só renderiza a sub-aba que o usuário pode ver; se pediu uma sem acesso,
    // cai na primeira permitida (config → conversas → contatos).
    let view = sp.get('view') || 'config';
    // 'tags' e 'custo' são sub-abas ligadas a Contatos/Configuração (mesma permissão).
    const podeVerSub = (v) => (v === 'tags' ? podeSofiaSub(sess, 'contatos') : (v === 'custo' || v === 'cobranca') ? podeSofiaSub(sess, 'config') : v === 'funil' ? podeSofiaSub(sess, 'conversas') : podeSofiaSub(sess, v));
    if (!podeVerSub(view)) view = SOFIA_SUBS.find(s => podeSofiaSub(sess, s)) || 'config';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (view === 'contatos') return res.end(paginaSofiaContatos(aviso, erro, { q: sp.get('q') || '', tag: sp.get('tag') || '', bloq: sp.get('bloq') || '', pagina: sp.get('pagina') || 0 }));
    if (view === 'tags') return res.end(paginaSofiaTags(aviso, erro));
    if (view === 'conversas') return res.end(paginaSofiaConversas(aviso, erro, (sess && sess.usuario) ? sess.usuario : ''));
    if (view === 'campanhas') return res.end(paginaSofiaCampanhas(aviso, erro));
    if (view === 'cobranca') return res.end(paginaCobranca(aviso, erro));
    if (view === 'custo') return res.end(paginaSofiaCusto(aviso, erro, { per: sp.get('per') || '7', de: sp.get('de') || '', ate: sp.get('ate') || '' }));
    return res.end(paginaSofia(aviso, erro));
  }
  // Modelo de CSV para baixar (cabeçalho + exemplos) — ajuda a montar a planilha.
  if (req.method === 'GET' && url === '/sofia/contatos/modelo.csv') {
    const linhas = [
      'Nome,Telefone,Instruções personalizadas,Tags',
      'Maria Silva,+55 (62) 99999-0000,Prefere treinar de manhã,Aluna ou Ex Aluna',
      'Joana Souza,+55 62 98888-1111,,FX 4 - Feito;Equipe',
      'Ana,55 61 97777-2222,,',
    ];
    const csv = '﻿' + linhas.join('\r\n') + '\r\n'; // BOM p/ Excel abrir com acento certo
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="modelo-contatos-slimfit.csv"',
      'Cache-Control': 'no-store',
    });
    return res.end(csv);
  }
  // Exportar TODA a base de contatos em CSV (para migrar de plataforma / backup).
  if (req.method === 'GET' && url === '/sofia/contatos/exportar') {
    let csv = '﻿Nome,Telefone,Instruções personalizadas,Tags\r\n';
    try { csv = contatos.exportarCSV(); } catch (_) {}
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="contatos-slimfit-${hoje}.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.end(csv);
  }
  // Importar contatos (CSV enviado pelo painel, lido no navegador e postado como JSON).
  if (req.method === 'POST' && url === '/sofia/contatos/importar') {
    return lerCorpo(req, 20e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const resumo = contatos.importarCSV(d.csv || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, resumo }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Volta para a lista de contatos preservando busca/filtro/página.
  const voltarContatos = (p, res) => {
    // Renomear/excluir tag vem da sub-aba Tags → volta para lá; o resto, para Contatos.
    if (p.get('voltar') === 'tags') { res.writeHead(303, { Location: '/sofia?view=tags&ctok=1' }); res.end(); return; }
    const back = new URLSearchParams(); back.set('view', 'contatos');
    if (p.get('q')) back.set('q', p.get('q')); if (p.get('tag')) back.set('tag', p.get('tag'));
    if (p.get('bloq')) back.set('bloq', p.get('bloq'));
    back.set('pagina', p.get('pagina') || 0); back.set('ctok', '1');
    res.writeHead(303, { Location: '/sofia?' + back.toString() }); res.end();
  };
  // Salvar (editar nome/telefone/tags) OU excluir um contato.
  if (req.method === 'POST' && url === '/sofia/contatos/salvar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        if (p.get('acao') === 'excluir') contatos.remover(p.get('telOrig'));
        else contatos.editarContato(p.get('telOrig'), { nome: p.get('nome'), telefone: p.get('telefone'), tags: p.get('tags') || '' });
      } catch (_) {}
      voltarContatos(p, res);
    });
  }
  // Excluir vários contatos de uma vez (os marcados na lista).
  if (req.method === 'POST' && url === '/sofia/contatos/excluir-lote') {
    return lerCorpo(req, 2e6, corpo => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const tels = Array.isArray(d.tels) ? d.tels.map(t => String(t || '').trim()).filter(Boolean) : [];
      if (!tels.length) return res.end(JSON.stringify({ ok: false, erro: 'nenhum contato marcado' }));
      try {
        const n = contatos.removerLote(tels);
        try { auditoria.registrar(sess.usuario, 'contato.excluir-lote', n + ' contato(s)', tels.slice(0, 50).join(',') + (tels.length > 50 ? ',…' : '')); } catch (_) {}
        return res.end(JSON.stringify({ ok: true, excluidos: n }));
      } catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Bloquear / desbloquear um contato (a Sofia ignora quem está bloqueado).
  if (req.method === 'POST' && url === '/sofia/contatos/bloquear') {
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const tel = String(d.tel || '').trim();
      if (!tel) return res.end(JSON.stringify({ ok: false, erro: 'faltou o telefone' }));
      try { const bl = sofia.setBloqueio(tel, !!d.ativo); try { auditoria.registrar(sess.usuario, bl ? 'contato.bloquear' : 'contato.desbloquear', tel, ''); } catch (_) {} res.end(JSON.stringify({ ok: true, bloqueado: bl })); }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Renomear/excluir uma tag em TODOS os contatos.
  if (req.method === 'POST' && url === '/sofia/contatos/tag') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        if (p.get('acao') === 'excluir') contatos.excluirTag(p.get('de'));
        else contatos.renomearTag(p.get('de'), p.get('para'));
      } catch (_) {}
      voltarContatos(p, res);
    });
  }
  // Alterar tags EM LOTE: adiciona/remove uma tag em todos os contatos do filtro.
  if (req.method === 'POST' && url === '/sofia/contatos/lote') {
    const quem = (sess && sess.usuario) ? sess.usuario : ''; // captura o usuário AGORA (fora do callback)
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const back = new URLSearchParams(); back.set('view', 'contatos');
      if (p.get('q')) back.set('q', p.get('q'));
      if (p.get('tag_filtro')) back.set('tag', p.get('tag_filtro'));
      if (p.get('bloq')) back.set('bloq', p.get('bloq'));
      try {
        let bloqueados = []; try { bloqueados = sofia.lerBloqueios(); } catch (_) {}
        const tels = String(p.get('tels') || '').split(',').map(s => s.trim()).filter(Boolean);
        const add = p.get('add') || '', rm = p.get('rm') || '';
        const mudados = contatos.aplicarTagLote({
          q: p.get('q') || '', tag: p.get('tag_filtro') || '', bloq: p.get('bloq') || '', bloqueados,
          tels: tels.length ? tels : null, add, rm,
        });
        // Marca no timeline de cada conversa alterada (quem mexeu à mão).
        try { for (const t of (mudados || [])) { if (add) sofia.registrarTagLog(t, add, 'manual', quem, 'add'); if (rm) sofia.registrarTagLog(t, rm, 'manual', quem, 'remove'); } } catch (_) {}
        back.set('lote', String((mudados || []).length));
      } catch (e) {
        back.set('errc', e.message || 'Erro no lote.');
      }
      res.writeHead(303, { Location: '/sofia?' + back.toString() }); res.end();
    });
  }
  // Salvar a automação de uma tag (gatilho + palavras + avisar no WhatsApp).
  if (req.method === 'POST' && url === '/sofia/contatos/tagcfg') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        contatos.definirTagConfig(d.tag, { gatilho: d.gatilho || '', palavras: d.palavras || [], instrucao: d.instrucao || '', campanhaId: d.campanhaId || '', avisarWpp: d.avisarWpp || '', remove: d.remove || [], exige: d.exige || [], encerrar: !!d.encerrar });
        try { publicarRegras(); } catch (_) {} // atualiza o listener na hora
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Criar uma tag nova (fica "conhecida" mesmo sem contato ainda).
  if (req.method === 'POST' && url === '/sofia/contatos/criar-tag') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const nome = contatos.criarTag(d.nome);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, nome }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Salvar/atualizar um contato direto de uma conversa (cria se novo) e DEFINE as
  // tags exatamente como vieram (permite adicionar e remover no cabeçalho do chat).
  if (req.method === 'POST' && url === '/sofia/contatos/salvar-novo') {
    const quem = (sess && sess.usuario) ? sess.usuario : ''; // captura o usuário AGORA (fora do callback)
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        // Resolve o telefone p/ o contato JÁ existente tolerando o 9º dígito — assim
        // editar a tag por uma conversa (que pode vir sem o 9) NÃO cria um contato
        // duplicado; edita o que já está no CRM (com o 9).
        const achado = contatos.acharPorTel(d.telefone);
        const telAlvo = achado ? achado.chave : d.telefone;
        const tagsAntes = (achado && achado.contato && Array.isArray(achado.contato.tags)) ? achado.contato.tags.slice() : [];
        const nomeAntes = (achado && achado.contato && achado.contato.nome) || '';
        const c = contatos.adicionar({ nome: d.nome, telefone: telAlvo }); // cria/atualiza (sem mexer nas tags)
        // Nome digitado/alterado pela equipe na conversa → não é mais trocado pelo do agendamento.
        if (String(d.nome || '').trim() && String(d.nome).trim() !== String(nomeAntes).trim()) { try { contatos.marcarNomeManual(telAlvo); } catch (_) {} }
        contatos.setTags(telAlvo, d.tags || []);                            // DEFINE o conjunto EXATO (edição manual: não roda transições de funil)
        // Marca no timeline o que MUDOU (add/remove), com quem fez — comparando o
        // conjunto ANTES x o conjunto FINAL de fato gravado.
        try {
          const depoisR = contatos.acharPorTel(telAlvo);
          const tagsDepois = (depoisR && depoisR.contato && Array.isArray(depoisR.contato.tags)) ? depoisR.contato.tags : [];
          const antesSet = new Set(tagsAntes), depoisSet = new Set(tagsDepois);
          for (const t of tagsDepois) if (!antesSet.has(t)) sofia.registrarTagLog(telAlvo, t, 'manual', quem, 'add');
          for (const t of tagsAntes) if (!depoisSet.has(t)) sofia.registrarTagLog(telAlvo, t, 'manual', quem, 'remove');
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, tel: c.tel }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Inbox das conversas da Sofia (JSON) — a aba Conversas atualiza sozinha com isto.
  if (req.method === 'GET' && url === '/sofia/conversas') {
    let obj = {};
    try { obj = sofia.conversas() || {}; } catch (_) {}
    try { const cmap = contatos.carregar(); for (const k in obj) { const r = contatos.acharPorTel(k, cmap); const c = r ? r.contato : null; obj[k].salvo = !!c; obj[k].tagsContato = c ? (c.tags || []) : []; if (c && c.nome) obj[k].nome = c.nome; } } catch (_) {} // salvo? + tags + nome — casa o contato tolerando o 9º dígito (conversa @c.us às vezes vem sem o 9)
    let lockMin = 60; try { lockMin = sofia.lerHumanoLockMin(); } catch (_) {}
    try { const hum = sofia.lerHumano(); const lockMs = lockMin * 60000, agora = Date.now(); for (const k in obj) { const v = hum[k]; const isObj = v && typeof v === 'object'; const em = isObj ? (Number(v.em) || 0) : (Number(v) || 0); const ativo = em > 0 && (em + lockMs > agora); obj[k].humano = ativo; obj[k].humanoPor = ativo ? (isObj ? String(v.por || '') : '') : ''; obj[k].humanoEm = ativo ? em : 0; } } catch (_) {} // controle humano por conversa: quem assumiu + instante (a trava expira sozinha → SoFIA reassume)
    try { for (const k in obj) obj[k].bloq = sofia.estaBloqueado(k); } catch (_) {} // contato bloqueado?
    try { for (const k in obj) obj[k].enc = sofia.estaEncerrada(k, sofia.ultimaAlunaEm(obj[k])); } catch (_) {} // encerrada à mão (cadeado)? — mede pela última msg DA ALUNA, para a despedida da SoFIA depois do fechamento não reabrir
    try { const em = sofia.lerEncerradas() || {}; for (const k in obj) { const v = em[k]; const isObj = v && typeof v === 'object'; obj[k].encEm = isObj ? (Number(v.em) || 0) : (Number(v) || 0); obj[k].encPor = isObj ? String(v.por || '') : ''; } } catch (_) {} // instante + autor do encerramento manual (p/ a divisória)
    try { const hl = sofia.lerHumanoLog() || {}; for (const k in obj) { const l8 = String(k).replace(/\D/g, '').slice(-8); obj[k].humanoLog = hl[l8] || []; } } catch (_) {} // histórico assumiu/devolveu (para o timeline)
    try { const tl = sofia.lerTagLog() || {}; for (const k in obj) { const l8 = String(k).replace(/\D/g, '').slice(-8); obj[k].tagLog = tl[l8] || []; } } catch (_) {} // histórico de tags aplicadas por automação (para o timeline)
    try { const av = avisosPorAluna(); for (const k in obj) obj[k].avisos = av[String(k).replace(/\D/g, '').slice(-8)] || []; } catch (_) {} // avisos para a recepção sobre esta aluna (marca "🔔 Recepção avisada")
    try { for (const k in obj) obj[k].fuEspera = E.fuEsperando[k] || ''; } catch (_) {} // follow-up pronto, segurando pelo horário?
    try { const at = sofia.lerAtencao() || {}; const a8 = {}; for (const kk in at) a8[String(kk).replace(/\D/g, '').slice(-8)] = 1; for (const k in obj) obj[k].atencao = !!(at[k] || a8[String(k).replace(/\D/g, '').slice(-8)]); } catch (_) {} // pediu atendimento humano?
    try { const agSet = new Set((fuLerJson(FU_AGENDOU_FILE, []) || []).map(x => String(x).replace(/\D/g, '').slice(-8))); let agTags = []; try { agTags = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {} for (const k in obj) { const l8 = String(k).replace(/\D/g, '').slice(-8); obj[k].agendou = agSet.has(l8) || (obj[k].tagsContato || []).some(t => agTags.includes(t)); } } catch (_) {} // agendou aula experimental? (mesma lógica do follow-up)
    let wa = ''; try { wa = (sofia.waStatus() || {}).estado || ''; } catch (_) {} // online/off-line do WhatsApp da SoFIA
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ conv: obj, wa, lockMin }));
  }
  // Interações (histórico de sessões) de UM contato — aba Contatos → Interações.
  if (req.method === 'GET' && url === '/sofia/contatos/interacoes') {
    const tel = (new URLSearchParams(req.url.split('?')[1] || '')).get('tel') || '';
    const alvo = String(tel).replace(/\D/g, '');
    const ult8 = s => { const d = String(s).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : d; };
    let hist = {};
    try { hist = sofia.historico() || {}; } catch (_) {}
    let achado = null;
    for (const k in hist) { if (k.replace(/\D/g, '') === alvo || (ult8(k) && ult8(k) === ult8(alvo))) { achado = hist[k]; break; } }
    const sessoes = achado ? (achado.sessoes || []).slice().sort((a, b) => (b.inicioEm || 0) - (a.inicioEm || 0)) : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, nome: achado ? achado.nome : '', sessoes }));
  }
  // Encerrar UMA conversa à mão (mesmo efeito de esperar o tempo da sessão, só que
  // agora): marca o cadeado, a SoFIA recomeça do zero quando a aluna voltar
  // (sofia.ts lê sofia-encerradas.json) e o follow-up deixa de incomodar.
  if (req.method === 'POST' && url === '/sofia/conversas/encerrar') {
    const quem = (sess && sess.usuario) ? sess.usuario : ''; // captura o usuário AGORA (não no callback assíncrono)
    return lerCorpo(req, 1e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      const ativo = (typeof d.ativo === 'undefined') ? true : !!d.ativo; // true = encerrar (padrão) · false = reabrir
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'sem conversa' }));
      if (ativo) {
        try { sofia.setAtencao(chave, false); } catch (_) {}                 // encerrou → tira o vermelho
        try { sofia.setControleHumano(chave, false); } catch (_) {}          // encerrou → devolve à SoFIA (não fica "sob atendimento humano")
        try { const autos = contatos.tagsPorGatilho('humano'); for (const a of autos) { try { contatos.removerTag(chave, a.tag); } catch (_) {} } } catch (_) {} // e tira a tag de atendimento humano
      }
      try { sofia.setEncerrada(chave, ativo, quem); try { if (ativo) auditoria.registrar(quem, 'conversa.encerrar', chave, ''); } catch (_) {} return res.end(JSON.stringify({ ok: true })); }
      catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Importar histórico existente do WhatsApp para a inbox (comando → listener).
  if (req.method === 'POST' && url === '/sofia/importar') {
    return lerCorpo(req, 1e5, () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      try { sofia.enviarComando('importar-historico', { porChat: 60 }); return res.end(JSON.stringify({ ok: true })); }
      catch (e) { return res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  if (req.method === 'GET' && url === '/sofia/importar/status') {
    let st = null; try { st = sofia.lerImportStatus(); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: st }));
  }
  // Liga/desliga o controle humano de UMA conversa (a Sofia para de responder só ela).
  if (req.method === 'POST' && url === '/sofia/humano') {
    const quem = (sess && sess.usuario) ? sess.usuario : ''; // quem está assumindo/devolvendo AGORA
    return lerCorpo(req, 1e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'sem conversa' }));
      try {
        // Trava por atendente: se OUTRO já assumiu e a trava ainda vale, não deixa
        // assumir nem devolver por cima (só o dono, ou depois que a trava expira).
        let dono = null; try { dono = sofia.humanoDono(chave); } catch (_) {}
        if (dono && dono.ativo && dono.por && dono.por !== quem) {
          const restaMin = Math.max(1, Math.ceil((dono.em + sofia.lerHumanoLockMin() * 60000 - Date.now()) / 60000));
          return res.end(JSON.stringify({ ok: false, erro: '🔒 Conversa assumida por ' + dono.por + '. Fica livre em ~' + restaMin + ' min (ou peça pra ela devolver à SoFIA).' }));
        }
        const ativo = sofia.setControleHumano(chave, !!d.ativo, quem);
        try { auditoria.registrar(quem, ativo ? 'conversa.assumir' : 'conversa.devolver', chave, ''); } catch (_) {}
        if (ativo) { try { sofia.setAtencao(chave, false); } catch (_) {} } // recepção assumiu → tira o vermelho
        // Gatilho 'humano' (estado): ao ASSUMIR aplica a tag + avisa; ao DEVOLVER
        // à SoFIA, remove a tag (é um marcador de "sob controle humano agora").
        try {
          const autos = contatos.tagsPorGatilho('humano');
          if (autos.length) {
            if (ativo) {
              let nome = '';
              try { const c = contatos.carregar()[contatos.normTel(chave)]; if (c) nome = c.nome || ''; } catch (_) {}
              for (const a of autos) aplicarAutomacao({ telefone: chave, nome, tag: a.tag, avisarWpp: a.avisarWpp, motivo: 'humano' });
            } else {
              for (const a of autos) { try { contatos.removerTag(chave, a.tag); } catch (_) {} }
            }
          }
        } catch (_) {}
        res.end(JSON.stringify({ ok: true, ativo, por: ativo ? quem : '' }));
      }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Responder uma conversa pelo painel: enfileira para o listener da Sofia enviar
  // pelo WhatsApp (e assumir a conversa, pausando a Sofia nela).
  if (req.method === 'POST' && url === '/sofia/responder') {
    const quem = (sess && sess.usuario) ? sess.usuario : ''; // quem está escrevendo AGORA (atribuição + trava)
    return lerCorpo(req, 12e6, corpo => { // cabe a foto anexada em base64 (~10-12 MB)
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const chave = String(d.chave || '').trim();
      const jid = String(d.jid || '').trim();
      const texto = String(d.texto || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'faltou destinatário' }));
      // Pode enviar só texto, só foto (com ou sem legenda), ou os dois.
      if (!texto && !d.fotoBase64) return res.end(JSON.stringify({ ok: false, erro: 'faltou texto ou foto' }));
      // Segurança: só o atendente que assumiu (dono da trava) pode escrever. Se outro
      // assumiu e a trava vale, bloqueia. Se ninguém assumiu ainda, este assume.
      let dono = null; try { dono = sofia.humanoDono(chave); } catch (_) {}
      if (dono && dono.ativo && dono.por && dono.por !== quem) {
        const restaMin = Math.max(1, Math.ceil((dono.em + sofia.lerHumanoLockMin() * 60000 - Date.now()) / 60000));
        return res.end(JSON.stringify({ ok: false, erro: '🔒 Conversa assumida por ' + dono.por + '. Fica livre em ~' + restaMin + ' min.' }));
      }
      try { sofia.setControleHumano(chave, true, quem); } catch (_) {} // assume/RENOVA a trava a cada envio do dono
      let fotoArquivo = '';
      if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoResposta(d.fotoBase64); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Foto: ' + e.message })); } }
      try { sofia.enfileirarResposta(chave, jid, texto, fotoArquivo, quem); res.end(JSON.stringify({ ok: true })); }
      catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Agendamento MANUAL no EVO (atendente pelo painel) — enfileira; o listener agenda.
  // Grade de horários disponíveis (proxy do formulário) — popula o combobox do Express.
  if (req.method === 'GET' && url === '/agendar/slots' && /[?&]tipo=circuito\b/.test(req.url)) {
    // Grade do CIRCUITO SLIM: calculada aqui (slots_circuito.py, poucas chamadas ao EVO), guardada 2 min.
    const forcar = /[?&]forcar=1\b/.test(req.url);
    const responder = (o) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (!forcar && E._circSlots.dados && Date.now() - E._circSlots.em < 120000) return responder(E._circSlots.dados);
    const { py, dir } = _gradePyBin();
    return require('child_process').execFile(py, ['slots_circuito.py', '10'], { cwd: dir, timeout: 90000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      let j = null;
      try { const l = String(stdout || '').trim().split('\n').filter(Boolean).pop(); j = JSON.parse(l); } catch (_) {}
      if (err || !j || !j.dias) return responder({ dias: (E._circSlots.dados && E._circSlots.dados.dias) || {}, erro: String((stderr || (err && err.message) || 'falha ao ler a grade do circuito')).trim().slice(0, 300) });
      E._circSlots = { em: Date.now(), dados: j.aviso ? { dias: j.dias, aviso: String(j.aviso).slice(0, 400) } : { dias: j.dias } };
      return responder(E._circSlots.dados);
    });
  }
  if (req.method === 'POST' && url === '/agendar/circuito-servico') {
    if (!sess || !sess.admin) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Só administradores.'); }
    return lerCorpo(req, 2000, corpo => {
      const v = gravarCircuitoServico(new URLSearchParams(corpo).get('id'));
      try { auditoria.registrar(sess.usuario, 'express.circuito-servico', String(v || 'desligado'), ''); } catch (_) {}
      E._circSlots = { em: 0, dados: null };
      res.writeHead(303, { Location: '/?view=express' }); res.end();
    });
  }
  if (req.method === 'GET' && url === '/agendar/slots') {
    const FORM_BASE = (process.env.FORM_CLOUD_URL || '').replace(/\/+$/, '');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    return fetch(FORM_BASE + '/api/slots?days=10', { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => { clearTimeout(t); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ dias: (j && j.dias) || {} })); })
      .catch(e => { clearTimeout(t); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ dias: {}, erro: String((e && e.message) || e) })); });
  }
  // Atualizar a grade AGORA (botão 🔄 do Cadastro Express): recalcula a grade no
  // EVO e reenvia ao formulário (push_slots). Assim a recepção vê as vagas na hora,
  // sem esperar o envio automático (a cada ~30 min). Usa o venv do agendamento.
  if (req.method === 'POST' && url === '/agendar/slots/atualizar') {
    const cp = require('child_process'), p = require('path'), f = require('fs');
    const dir = p.resolve(__dirname, 'agendamento_evo');
    const venv = p.join(dir, '.venv', 'bin', 'python');
    let py = process.env.PYTHON_BIN || 'python3';
    try { if (f.existsSync(venv)) py = venv; } catch (_) {}
    return cp.execFile(py, [p.join(dir, 'push_slots.py')], { cwd: dir, timeout: 115000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (err) return res.end(JSON.stringify({ ok: false, erro: String((stderr || err.message || 'falha ao atualizar a grade')).trim().slice(0, 300) }));
      return res.end(JSON.stringify({ ok: true, saida: String(stdout || '').trim().slice(0, 200) }));
    });
  }
  if (req.method === 'POST' && url === '/sofia/agendar') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const chave = String(d.chave || '').replace(/\D/g, '');
      const nome = String(d.nome || '').trim(), email = String(d.email || '').trim(), when = String(d.when || '').trim();
      // origem: "express" (Cadastro Express) → confirmação com texto próprio;
      // "painel" (widget da conversa, com operador) → mesmo fluxo de PERGUNTAR no
      // duplicado; vazio (SoFIA sozinha) → cria novo, sem perguntar.
      const _org = String(d.origem || '').trim().toLowerCase();
      const origem = (_org === 'express' || _org === 'painel') ? _org : '';
      // decisão diante de cadastro de outra pessoa com o mesmo contato (mãe x filha).
      const ad = String(d.acao_duplicado || '').trim().toLowerCase();
      const acaoDuplicado = (ad === 'sobrescrever' || ad === 'novo') ? ad : '';
      if (!chave) return res.end(JSON.stringify({ ok: false, erro: 'sem conversa' }));
      if (!nome || !when) return res.end(JSON.stringify({ ok: false, erro: 'preencha nome e data/horário' }));
      if (!email || email.indexOf('@') < 1) return res.end(JSON.stringify({ ok: false, erro: 'e-mail é obrigatório (o EVO exige para cadastrar)' })); // o EVO passou a exigir e-mail no cadastro do prospect
      try {
        const id = sofia.enfileirarAgendamento({ chave, telefone: chave, nome, email, when, por: quem, origem, acaoDuplicado, tipo: origem && d.tipo === 'circuito' ? 'circuito' : '' });
        try { auditoria.registrar(quem, 'conversa.agendar', chave, when); } catch (_) {}
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  if (req.method === 'GET' && url === '/sofia/agendar/status') {
    const id = (new URLSearchParams(req.url.split('?')[1] || '')).get('id') || '';
    let r = null; try { r = sofia.lerAgendamentoResult(id); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, res: r }));
  }
  // Troca da chave da IA (ANTHROPIC_API_KEY) — só admin. Grava no ChatBot/.env;
  // vale após reiniciar a SoFIA (pm2 restart <sofia> --update-env).
  if (req.method === 'POST' && url === '/sofia/api-key') {
    if (!sess.admin) return negarAcesso(res, sess);
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const ok = gravarApiKey(d.key);
      if (ok) { try { auditoria.registrar(sess.usuario, 'sofia.apikey', 'ANTHROPIC_API_KEY', 'atualizada pelo painel'); } catch (_) {} }
      return res.end(JSON.stringify(ok ? { ok: true } : { ok: false, erro: 'chave inválida (deve começar com sk-ant-)' }));
    });
  }
  // Troca da chave de transcrição (TRANSCRICAO_API_KEY) — só admin. Grava no
  // ChatBot/.env; vale após reiniciar a SoFIA. Vazia = desliga a transcrição.
  if (req.method === 'POST' && url === '/sofia/transcricao-key') {
    if (!sess.admin) return negarAcesso(res, sess);
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const ok = gravarTranscricaoKey(d.key);
      // Provedor (OpenAI/Groq) → grava URL + modelo certos, sem editar .env.
      let provedor = lerTranscricaoProvedor();
      if (ok && d.provedor) { try { provedor = gravarTranscricaoProvedor(d.provedor); } catch (_) {} }
      // Liga/desliga (o toggle mora aqui agora, junto do provedor e da chave).
      if (ok && typeof d.on === 'boolean') { try { sofia.gravarTranscricaoOn(d.on); } catch (_) {} }
      if (ok) { try { auditoria.registrar(sess.usuario, 'sofia.transcricaokey', 'TRANSCRICAO_API_KEY', (String(d.key || '').trim() ? 'atualizada' : 'removida') + ' pelo painel (' + provedor + ')'); } catch (_) {} }
      return res.end(JSON.stringify(ok ? { ok: true, provedor } : { ok: false, erro: 'chave inválida (use sk-… da OpenAI ou gsk_… da Groq, ou deixe em branco para desligar)' }));
    });
  }
  // Login do robô no EVO (EVO_EMAIL / EVO_PASSWORD) — só admin. Grava no
  // Experimental/.env; vale após reiniciar o robô. Senha em branco = mantém a atual.
  if (req.method === 'POST' && url === '/sofia/evo-credenciais') {
    if (!sess.admin) return negarAcesso(res, sess);
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const r = gravarEvoCredenciais(d.email, d.senha);
      if (r.ok) { try { auditoria.registrar(sess.usuario, 'evo.credenciais', 'EVO_EMAIL/EVO_PASSWORD', 'login do EVO atualizado pelo painel' + (String(d.senha || '').trim() ? ' (com senha)' : ' (só e-mail)')); } catch (_) {} }
      return res.end(JSON.stringify(r.ok ? { ok: true } : { ok: false, erro: r.erro || 'não consegui salvar' }));
    });
  }
  // Serve a foto que VOCÊ enviou numa resposta manual (mostrada na bolha do chat).
  // Os arquivos ficam em ChatBot/humano-fotos/ (mesma máquina do listener).
  if (req.method === 'GET' && url === '/sofia/humano-foto') {
    const arq = new URLSearchParams(req.url.split('?')[1] || '').get('arq') || '';
    if (!/^[\w.-]+$/.test(arq) || arq.includes('..')) { res.writeHead(400); return res.end('nome inválido'); }
    const caminho = path.join(sofia.DIR, 'humano-fotos', arq);
    if (!fs.existsSync(caminho)) { res.writeHead(404); return res.end('não encontrada'); }
    const ext = arq.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(caminho).pipe(res);
  }
  // Upload da imagem (preços/grade) que a SoFIA ANEXA no WhatsApp. Recebe a imagem
  // em base64, salva no VPS (substitui a anterior) e devolve o caminho.
  if (req.method === 'POST' && url === '/sofia/midia-upload') {
    return lerCorpo(req, 12e6, corpo => { // cabe a imagem em base64
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      try {
        const campo = String(d.campo || '');
        const arq = sofia.salvarMidiaImagem(campo, String(d.dataUrl || ''));
        try { auditoria.registrar(sess.usuario, 'sofia.config', '', 'imagem ' + campo); } catch (_) {}
        // URL pública (link que a SoFIA pode mandar pra aluna abrir). Montada a
        // partir do host do request (o mesmo domínio público do painel via Caddy).
        const publicUrl = baseUrl(req) + '/midia-publica?c=' + encodeURIComponent(campo);
        res.end(JSON.stringify({ ok: true, path: arq, publicUrl }));
      } catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Serve a imagem local atual de um campo (para a miniatura no painel).
  if (req.method === 'GET' && url === '/sofia/midia') {
    const campo = new URLSearchParams(req.url.split('?')[1] || '').get('campo') || '';
    let caminho = ''; try { caminho = sofia.caminhoMidiaLocal(campo); } catch (_) {}
    if (!caminho || !fs.existsSync(caminho)) { res.writeHead(404); return res.end('sem imagem'); }
    const ext = caminho.split('.').pop().toLowerCase();
    const tipo = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    return fs.createReadStream(caminho).pipe(res);
  }
  if (req.method === 'POST' && url === '/sofia/salvar') {
    return lerCorpo(req, 4e6, corpo => {
      const p = new URLSearchParams(corpo);
      // Seções chegam como arrays paralelos titulo[]/corpo[] (permite adicionar e
      // remover seções pelo painel). Ignora seções totalmente vazias.
      const titulos = p.getAll('titulo[]');
      const corpos = p.getAll('corpo[]');
      const secoes = [];
      for (let i = 0; i < titulos.length; i++) {
        const t = (titulos[i] || '').trim();
        const c = corpos[i] || '';
        if (!t && !c.trim()) continue; // seção vazia (card novo não preenchido) — descarta
        secoes.push({ titulo: t || ('SEÇÃO ' + (i + 1)), corpo: c });
      }
      try {
        sofia.salvar({
          secoes,
          extracao: p.get('extracao') || '',
          pausaMin: p.get('pausaMin') || '30',
          sessaoHoras: p.get('sessaoHoras') || '12',
          healthMin: p.get('healthMin') != null ? p.get('healthMin') : '3',
          agruparSeg: p.get('agruparSeg') != null ? p.get('agruparSeg') : '7',
          quieto: { horas: p.get('quietoHoras') || '24', dias: p.get('quietoDias') || '4' },
          inboxDias: p.get('inboxDias') != null ? p.get('inboxDias') : '365',
          followup: { on: p.get('followupOn') === '1', horas: p.get('followupHoras') || '24', instrucao: p.get('followupInstrucao') || '', janelaIni: p.get('followupJanIni') || '08:00', janelaFim: p.get('followupJanFim') || '19:00', tagsExcluir: (typeof p.getAll === 'function' ? p.getAll('followupTagExcl') : []) },
          modelos: { conversa: p.get('modeloConversa') || '', extracao: p.get('modeloExtracao') || '' },
          // O toggle da transcrição mudou-se para "Credenciais da unidade" (salva por
          // conta própria). Aqui só PRESERVAMOS o valor atual — sem o campo no form,
          // p.get() é null e não devemos desligar a transcrição ao salvar o resto.
          transcricaoOn: p.get('transcricaoOn') != null ? (p.get('transcricaoOn') === '1') : !!sofia.lerTranscricaoOn(),
          midias: {
            grade_imagem: (p.get('grade_imagem') || '').trim(),
            grade_link: (p.get('grade_link') || '').trim(),
            precos_imagem: (p.get('precos_imagem') || '').trim(),
            precos_link: (p.get('precos_link') || '').trim(),
          },
          ritmo: {
            humano: p.get('ritHumano') === '1',
            msPorChar: p.get('ritMsPorChar') || '45',
            delayMin: p.get('ritDelayMin') || '1200',
            delayMax: p.get('ritDelayMax') || '4500',
          },
        });
        try { const el = p.get('expLimite'); if (el != null && el !== '') gravarExpLimite(el); } catch (_) {}
        try { const ah = p.get('antecedenciaHoras'); if (ah != null && ah !== '') gravarAntecedenciaHoras(ah); } catch (_) {}
        try { const lm = p.get('humanoLockMin'); if (lm != null && lm !== '') sofia.gravarHumanoLockMin(lm); } catch (_) {}
        try { const rf = p.get('refreshSeg'); if (rf != null && rf !== '') gravarRefreshSeg(rf); } catch (_) {}
        try { auditoria.registrar(sess.usuario, 'sofia.config', 'Configuração/prompt da SoFIA', 'modelo: ' + (p.get('modeloConversa') || '—')); } catch (_) {}
        res.writeHead(303, { Location: '/sofia?ok=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaSofia('Não salvei: ' + e.message, true));
      }
    });
  }
  if (req.method === 'POST' && url === '/sofia/restaurar') {
    return lerCorpo(req, 1e5, () => {
      let ok = false; try { ok = sofia.restaurar(); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?rest=' + (ok ? '1' : '0') }); res.end();
    });
  }
  // Estado do WhatsApp da Sofia (JSON) — o bloco de conexão atualiza só ele,
  // sem recarregar a página (não apaga o que estiver sendo editado no prompt).
  if (req.method === 'GET' && url === '/sofia/estado') {
    const st = sofia.waStatus() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ estado: st.estado || '', qr: st.qr || '', codigo: st.codigo || '', atualizadoEm: st.atualizadoEm || '' }));
  }
  if (req.method === 'POST' && url === '/sofia/toggle') {
    return lerCorpo(req, 1e5, () => {
      let novo = true;
      try { novo = !sofia.estadoAtivo(); sofia.gravarEstado(novo); } catch (_) {}
      try { auditoria.registrar(sess.usuario, novo ? 'sofia.ligar' : 'sofia.pausar', 'SoFIA', ''); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?' + (novo ? 'on=1' : 'off=1') }); res.end();
    });
  }
  // Salvar config do job de presença/comparecimento (troca de tags).
  if (req.method === 'POST' && url === '/sofia/comparecimento') {
    return lerCorpo(req, 1e4, corpo => {
      const p = new URLSearchParams(corpo);
      let intervaloAntes = 0; try { intervaloAntes = lerCompCfg().intervaloHoras; } catch (_) {}
      try { gravarCompCfg({ on: p.get('on') === '1', tagsAgendou: p.getAll('tagsAgendou'), tagCompareceu: p.get('tagCompareceu') || '', tagFaltou: p.get('tagFaltou') || '', numeroRelatorio: p.get('numeroRelatorio') || '', criarNovos: p.get('criarNovos') === '1', diasJanela: p.get('diasJanela'), intervaloHoras: p.get('intervaloHoras') }); } catch (_) {}
      const intervaloMudou = compIntervalo(p.get('intervaloHoras')) !== intervaloAntes;
      // Dia/hora que o job roda (mesmo cofre dos horários do robô). Se mudou (hora
      // OU intervalo), salva e reinicia o robô p/ reagendar; senão, sem reiniciar.
      const hora = p.get('hora_comparecimento');
      const dias = p.getAll('dias_comparecimento').map(Number);
      let mudouHora = false;
      if (hora != null) {
        try { const novo = horarios.build(hora, dias); mudouHora = (novo !== horarios.cronDe('comparecimento')); horarios.salvar('comparecimento', hora, dias); }
        catch (_) { /* horário inválido → ignora, mantém o atual */ }
      }
      if (!mudouHora && !intervaloMudou) { res.writeHead(303, { Location: '/sofia?view=tags&okcmp=1' }); return res.end(); }
      exec('pm2 restart ' + PM2_EXP + ' --update-env', { timeout: 25000 }, (err) => {
        res.writeHead(303, { Location: '/sofia?view=tags&okcmp=1' + (err ? '&errh=1' : '') }); res.end();
      });
    });
  }
  // Salvar config da auto-tag Aluna/Ex-aluna (roda junto da planilha).
  if (req.method === 'POST' && url === '/sofia/auto-tag-alunas') {
    return lerCorpo(req, 1e4, corpo => {
      const p = new URLSearchParams(corpo);
      try { autoTagAlunas.gravar({ on: p.get('on') === '1', tagAluna: p.get('tagAluna') || '', tagExAluna: p.get('tagExAluna') || '' }); } catch (_) {}
      try { auditoria.registrar(sess.usuario, 'sofia.autotagalunas', 'Auto-tag Aluna/Ex-aluna', p.get('on') === '1' ? 'ligada' : 'desligada'); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=tags&ok=1' }); res.end();
    });
  }
  // Salvar config do aviso "precisa de humano".
  if (req.method === 'POST' && url === '/sofia/aviso-humano') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try { sofia.gravarAvisoHumano(p.get('on') === '1', p.get('numero') || '', p.get('palavras') || ''); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?okah=1' }); res.end();
    });
  }
  // Lista "não responder": números que a SoFIA nunca responde sozinha (mas recebe e pode receber campanha).
  // Importar prompt (.txt inteiro): prévia (o que muda) e gravação.
  if (req.method === 'POST' && (url === '/sofia/prompt/previa' || url === '/sofia/prompt/importar')) {
    return lerCorpo(req, 3e6, corpo => {
      const resp = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      try {
        const texto = String(JSON.parse(corpo || '{}').texto || '');
        if (url === '/sofia/prompt/previa') return resp({ ok: true, ...sofia.previaImportacao(texto) });
        const n = sofia.importarPrompt(texto);
        try { auditoria.registrar(sess.usuario, 'sofia.prompt-importar', String(n) + ' seções', 'importou o prompt'); } catch (_) {}
        return resp({ ok: true, secoes: n });
      } catch (e) { return resp({ ok: false, erro: e.message }, 400); }
    });
  }
  // Baixa o prompt ATUAL (o arquivo que a SoFIA usa) como .txt — backup rápido.
  if (req.method === 'GET' && url === '/sofia/prompt/download') {
    try {
      const fsx = require('fs');
      const arq = (sofia.ARQUIVOS && sofia.ARQUIVOS.prompt) || '';
      // Se o arquivo ainda não existe (instalação nova), semeia a partir do
      // roteiro padrão antes de baixar — assim o botão nunca dá erro.
      if (!fsx.existsSync(arq)) { try { sofia.disponivel(); } catch (_) {} }
      const txt = fsx.readFileSync(arq, 'utf8');
      const hoje = hojeSP().replace(/-/g, '');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="sofia-prompt-${hoje}.txt"`,
        'Cache-Control': 'no-store',
      });
      try { auditoria.registrar(sess.usuario, 'sofia.prompt-download', '', 'baixou o prompt'); } catch (_) {}
      return res.end(txt);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não consegui ler o prompt: ' + e.message);
    }
  }
  // Salva as regras da tag "alunas" (janela da recepção + número de aviso).
  // Ex-alunas e quem já fez experimental (etiquetas) — só essas duas listas.
  if (req.method === 'POST' && url === '/sofia/historico-tags') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        sofia.gravarAlunas({ tagsExAluna: p.getAll('tagsExAluna'), tagsFezExp: p.getAll('tagsFezExp') });
        auditoria.registrar(sess.usuario, 'sofia.historico-tags', '', 'ex-alunas / fez experimental');
      } catch (_) {}
      res.writeHead(303, { Location: '/sofia?okhist=1' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/sofia/alunas') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      try {
        sofia.gravarAlunas({
          ativo: p.get('ativo') === 'on',
          janelaIni: p.get('janelaIni'), janelaFim: p.get('janelaFim'),
          recepcaoNumero: p.get('recepcaoNumero') || '',
          tags: p.getAll('tags'),
        });
        auditoria.registrar(sess.usuario, 'sofia.alunas', '', 'regras das alunas');
      } catch (_) {}
      res.writeHead(303, { Location: '/sofia?okalu=1' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/sofia/nao-responder') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      let lista = [];
      try { lista = sofia.gravarNaoResponder(p.get('numeros') || ''); } catch (_) {}
      try { auditoria.registrar(sess.usuario, 'sofia.nao-responder', '', lista.length + ' número(s)'); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?oknr=' + lista.length }); res.end();
    });
  }
  // Salvar as boas-vindas do anúncio (que não devem pausar a SoFIA).
  if (req.method === 'POST' && url === '/sofia/msgs-anuncio') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      let lista = [];
      try { lista = sofia.gravarMsgsAnuncio(p.get('msgs') || ''); } catch (_) {}
      try { auditoria.registrar(sess.usuario, 'sofia.config', '', 'boas-vindas do anúncio (' + lista.length + ')'); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=config&okma=' + lista.length }); res.end();
    });
  }
  // Salvar o limite de alerta de gasto diário (Custo IA).
  if (req.method === 'POST' && url === '/sofia/custo-limite') {
    return lerCorpo(req, 1e4, corpo => {
      try { sofia.gravarCustoLimite(new URLSearchParams(corpo).get('limite') || '0'); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=custo' }); res.end();
    });
  }
  // Desconectar o WhatsApp da Sofia (envia comando ao listener → logout + reinicia → QR novo).
  if (req.method === 'POST' && url === '/sofia/desconectar') {
    return lerCorpo(req, 1e5, () => {
      try { sofia.enviarComando('logout'); } catch (_) {}
      try { auditoria.registrar(sess.usuario, 'sofia.desconectar', 'WhatsApp da SoFIA', ''); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?dcon=1' }); res.end();
    });
  }
  // Conectar a SoFIA por CÓDIGO (sem QR): manda o número pro listener gerar o código.
  if (req.method === 'POST' && url === '/sofia/parear') {
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      const numero = String(d.numero || '').replace(/\D/g, '');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (numero.length < 10) return res.end(JSON.stringify({ ok: false, erro: 'número inválido (use DDI+DDD+número)' }));
      try {
        sofia.enviarComando('parear', { numero });
        try { auditoria.registrar(sess.usuario, 'sofia.parear', 'WhatsApp da SoFIA', numero); } catch (_) {}
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) { return res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e) })); }
    });
  }
  // Reiniciar a SoFIA (pm2 restart sofia-listener) — aplica modelo/transcrição e
  // qualquer ajuste que precise de reinício, sem SSH. Sai do ar ~1 min ao reconectar.
  if (req.method === 'POST' && url === '/sofia/reiniciar') {
    return lerCorpo(req, 1e5, () => {
      try { auditoria.registrar(sess.usuario, 'sofia.reiniciar', 'SoFIA', ''); } catch (_) {}
      exec('pm2 restart ' + PM2_SOFIA + ' --update-env', { timeout: 25000 }, (err) => {
        res.writeHead(303, { Location: '/sofia?' + (err ? 'errsof=1' : 'oksof=1') }); res.end();
      });
    });
  }
  // Criar campanha (JSON, para levar a foto em base64): resolve os contatos da tag,
  // salva a foto (se houver) e enfileira o pedido para o listener.
  if (req.method === 'POST' && url === '/sofia/campanhas/criar') {
    return lerCorpo(req, 14e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const tag = String(d.tag || '').trim();
      const textoBase = String(d.textoBase || '').trim();
      const nome = String(d.nome || '').trim() || 'Campanha';
      try {
        if (!tag || !textoBase) throw new Error('Preencha a tag e a mensagem.');
        const alvo = contatos.listar({ tag, pagina: 0, porPagina: 100000 });
        let destinatarios = (alvo.itens || []).map(c => ({ tel: c.tel, nome: c.nome || '', _cad: Number(c.criadoEm) || 0 })).filter(x => x.tel);
        if (!destinatarios.length) throw new Error('Nenhum contato com essa tag.');
        // Ordem de envio: "recentes" = quem conversou com a SoFIA mais recentemente
        // primeiro (conversas + histórico de interações); quem nunca conversou vai
        // depois, pelos cadastrados mais recentemente. Se faltar tempo/data de fim,
        // quem fica de fora são os contatos mais frios. "lista" = ordem da tag.
        if (String(d.ordem || 'recentes') === 'recentes') {
          const ult8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
          const toque = new Map();
          const marca = (k, ts) => { const u = ult8(k); if (u && ts > (toque.get(u) || 0)) toque.set(u, ts); };
          try { const cv = sofia.conversas(); for (const k in cv) marca(k, Number(cv[k] && cv[k].ultimaEm) || 0); } catch (_) {}
          try { const h = sofia.historico(); for (const k in h) for (const ss of ((h[k] && h[k].sessoes) || [])) marca(k, Number(ss.fimEm || ss.inicioEm) || 0); } catch (_) {}
          destinatarios.sort((x, y) => ((toque.get(ult8(y.tel)) || 0) - (toque.get(ult8(x.tel)) || 0)) || (y._cad - x._cad));
        }
        destinatarios = destinatarios.map(({ tel, nome }) => ({ tel, nome }));
        if (d.dataFim && /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataFim)) && String(d.dataFim) < String(d.dataInicio || hojeSP())) throw new Error('A data de fim precisa ser igual ou depois da data de início.');
        const id = 'c' + Date.now();
        // Foto de quem JÁ era aluna na criação — o resultado da campanha conta como
        // "virou aluna" só quem ganhou a etiqueta depois.
        try {
          const ehAl = (t) => { const k = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^\s*[a-z]{0,3}[-\s]?\d+[.)\-]\s*/, '').replace(/[^a-z0-9]+/g, '').replace(/s$/, ''); return k === 'aluna' || /\d+aluna$/.test(k) || k === 'alunaativa'; };
          const mp = contatos.carregar(); const alunas = [];
          for (const x of destinatarios) { const r = contatos.acharPorTel(x.tel, mp); if (r && (r.contato.tags || []).some(ehAl)) alunas.push(String(x.tel).replace(/\D/g, '').slice(-8)); }
          const arqSnap = path.join(__dirname, '..', 'data', 'campanhas-snapshot.json');
          let snap = {}; try { snap = JSON.parse(fs.readFileSync(arqSnap, 'utf8')) || {}; } catch (_) {}
          snap[id] = { em: Date.now(), alunas };
          fs.writeFileSync(arqSnap + '.tmp', JSON.stringify(snap)); fs.renameSync(arqSnap + '.tmp', arqSnap);
        } catch (_) {}
        let fotoArquivo = '';
        if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoCampanha(id, d.fotoBase64); } catch (e) { throw new Error('Foto: ' + e.message); } }
        sofia.opCampanha({
          op: 'criar',
          campanha: {
            id, nome, tag, textoBase,
            limiteDia: String(d.limiteDia || '40'), delayMinSeg: String(d.delayMinSeg || '120'), delayMaxSeg: String(d.delayMaxSeg || '180'),
            janelaIni: String(d.janelaIni || '09:00'), janelaFim: String(d.janelaFim || '20:00'),
            dataInicio: String(d.dataInicio || hojeSP()),
            dataFim: /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataFim || '')) ? String(d.dataFim) : '',
            dias: Array.isArray(d.dias) ? d.dias.map(Number).filter(x => x >= 0 && x <= 6) : [],
            variacoes: Array.isArray(d.variacoes) ? d.variacoes.map(s => String(s || '').trim()).filter(Boolean).slice(0, 50) : [],
            fotoArquivo, destinatarios,
          },
        });
        try { auditoria.registrar(sess.usuario, 'campanha.criar', nome, 'tag: ' + tag + ' · ' + destinatarios.length + ' contato(s) · ordem: ' + (String(d.ordem || 'recentes') === 'recentes' ? 'mais recentes primeiro' : 'lista')); } catch (_) {}
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Enviar teste da campanha (JSON): manda a mensagem+foto para um número seu.
  if (req.method === 'POST' && url === '/sofia/campanhas/teste') {
    return lerCorpo(req, 14e6, corpo => {
      let d = {};
      try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const telefone = String(d.telefone || '').replace(/\D/g, '');
      const texto = String(d.texto || '').trim();
      try {
        if (telefone.length < 10) throw new Error('Número inválido.');
        if (!texto) throw new Error('Mensagem vazia.');
        let fotoArquivo = '';
        if (d.fotoBase64) { try { fotoArquivo = sofia.salvarFotoCampanha('teste-' + Date.now(), d.fotoBase64); } catch (e) { throw new Error('Foto: ' + e.message); } }
        sofia.opCampanha({ op: 'teste', telefone, texto, fotoArquivo });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.end(JSON.stringify({ ok: false, erro: e.message })); }
    });
  }
  // Pedir à SoFIA uma frase de campanha a partir de uma INSTRUÇÃO (assíncrono):
  // enfileira o pedido; o painel faz poll de /sofia/campanhas/rascunho?id=… .
  if (req.method === 'POST' && url === '/sofia/campanhas/rascunho') {
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const instrucao = String(d.instrucao || '').trim();
      if (!instrucao) return res.end(JSON.stringify({ ok: false, erro: 'Escreva a instrução do que você quer.' }));
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const model = String(d.model || '').trim();
      try { sofia.opCampanha({ op: 'rascunho', id, instrucao, model }); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Falha ao enviar o pedido à SoFIA.' })); }
      res.end(JSON.stringify({ ok: true, id }));
    });
  }
  // Pedir à SoFIA as ~10 variações da mensagem base (para ver/editar antes de
  // criar). Assíncrono: o painel faz poll de /sofia/campanhas/rascunho?id=… .
  if (req.method === 'POST' && url === '/sofia/campanhas/variacoes') {
    return lerCorpo(req, 1e6, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const texto = String(d.texto || '').trim();
      if (!texto) return res.end(JSON.stringify({ ok: false, erro: 'Escreva a mensagem base primeiro.' }));
      const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try { sofia.opCampanha({ op: 'variacoes', id, texto }); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Falha ao enviar o pedido à SoFIA.' })); }
      res.end(JSON.stringify({ ok: true, id }));
    });
  }
  // Editar UMA variação de uma campanha já criada (id + índice + texto novo).
  if (req.method === 'POST' && url === '/sofia/campanhas/variacao') {
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const id = String(d.id || '').trim();
      const index = parseInt(d.index, 10);
      const texto = String(d.texto || '').trim();
      if (!id || !Number.isInteger(index) || index < 0) return res.end(JSON.stringify({ ok: false, erro: 'Dados inválidos.' }));
      if (!texto) return res.end(JSON.stringify({ ok: false, erro: 'A variação não pode ficar vazia.' }));
      try { sofia.opCampanha({ op: 'editar-variacao', id, index, texto }); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Falha ao salvar.' })); }
      res.end(JSON.stringify({ ok: true }));
    });
  }
  // Excluir UMA variação de uma campanha (id + índice). A campanha passa a usar as restantes.
  if (req.method === 'POST' && url === '/sofia/campanhas/variacao-excluir') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const id = String(d.id || '').trim();
      const index = parseInt(d.index, 10);
      if (!id || !Number.isInteger(index) || index < 0) return res.end(JSON.stringify({ ok: false, erro: 'Dados inválidos.' }));
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'excluir-variacao', id, index }); } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Falha ao excluir.' })); }
      try { auditoria.registrar(quem, 'campanha.variacao-excluir', nomeC || id, '#' + (index + 1)); } catch (_) {}
      res.end(JSON.stringify({ ok: true }));
    });
  }
  // Resultado do rascunho (poll do painel). { pronto:false } enquanto gera.
  if (req.method === 'GET' && url === '/sofia/campanhas/rascunho') {
    const id = (new URLSearchParams(req.url.split('?')[1] || '')).get('id') || '';
    let r = { pronto: false }; try { r = sofia.lerRascunhoCampanha(id); } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(r));
  }
  // Fragmento HTML só da lista de campanhas — o painel busca a cada poucos segundos
  // para atualizar o progresso sem recarregar a página inteira.
  if (req.method === 'GET' && url === '/sofia/campanhas/lista') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    const spc = new URLSearchParams(req.url.split('?')[1] || '');
    try { return res.end(campListHTML({ de: spc.get('de') || '', ate: spc.get('ate') || '' })); } catch (_) { return res.end(''); }
  }
  // Detalhe de UMA campanha: quem já recebeu, quem está na fila e as falhas.
  if (req.method === 'GET' && url === '/sofia/campanhas/detalhe') {
    const id = (new URLSearchParams(req.url.split('?')[1] || '')).get('id') || '';
    let campanhas = []; try { campanhas = sofia.lerCampanhas(); } catch (_) {}
    const c = campanhas.find(x => String(x.id) === String(id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (!c) return res.end(JSON.stringify({ ok: false }));
    const CAP = 300;
    const env = (c.enviados || []), pen = (c.pendentes || []), fal = (c.falhas || []);
    return res.end(JSON.stringify({
      ok: true, nome: c.nome, status: c.status,
      enviadosHoje: c.enviadosHoje || 0, limiteDia: c.limiteDia || 0,
      enviadosTotal: env.length, pendentesTotal: pen.length, falhasTotal: fal.length,
      enviados: env.slice(-CAP).map(x => ({ tel: x.tel, nome: x.nome, em: x.em })),
      pendentes: pen.slice(0, CAP).map(x => ({ tel: x.tel, nome: x.nome })),
      falhas: fal.slice(-CAP).map(x => ({ tel: x.tel, nome: x.nome, erro: x.erro, em: x.em })),
    }));
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/controle') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const id = p.get('id'), acao = String(p.get('acao') || 'controle');
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'controle', id, acao }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.' + acao, nomeC || id, ''); } catch (_) {} // iniciar/pausar/cancelar
      res.writeHead(303, { Location: '/sofia?view=campanhas&okc=ok' }); res.end();
    });
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/remover-fila') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const id = p.get('id'), tel = String(p.get('tel') || '').replace(/\D/g, '');
      if (!id || !tel) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, erro: 'faltou id/telefone' })); }
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'remover-fila', id, tel }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.remover-fila', nomeC || id, tel); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
    });
  }
  // "Enviar agora": dispara N mensagens da campanha JÁ (ignora teto/janela; mantém espaçamento).
  if (req.method === 'POST' && url === '/sofia/campanhas/enviar-agora') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const id = p.get('id'); const n = Math.max(1, Math.min(1000, parseInt(p.get('n'), 10) || 0));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!id || !n) return res.end(JSON.stringify({ ok: false, erro: 'faltou id/quantidade' }));
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'rajada', id, n }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.enviar-agora', nomeC || id, n + ' envio(s)'); } catch (_) {}
      return res.end(JSON.stringify({ ok: true }));
    });
  }
  // Ajustar o ritmo/limites de uma campanha já criada (delay, teto/dia, janela).
  if (req.method === 'POST' && url === '/sofia/campanhas/ritmo') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      let d = {}; try { d = JSON.parse(corpo || '{}'); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const id = String(d.id || ''); if (!id) return res.end(JSON.stringify({ ok: false, erro: 'faltou id' }));
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === id); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'ritmo', id, delayMinSeg: d.delayMinSeg, delayMaxSeg: d.delayMaxSeg, limiteDia: d.limiteDia, janelaIni: d.janelaIni, janelaFim: d.janelaFim, ...(d.dataFim !== undefined ? { dataFim: String(d.dataFim || '') } : {}) }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.ritmo', nomeC || id, `${d.delayMinSeg}-${d.delayMaxSeg}s · ${d.limiteDia}/dia`); } catch (_) {}
      return res.end(JSON.stringify({ ok: true }));
    });
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/reenviar') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const id = p.get('id'), tel = String(p.get('tel') || '').replace(/\D/g, '');
      if (!id || !tel) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, erro: 'faltou id/telefone' })); }
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'reenviar', id, tel }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.reenviar', nomeC || id, tel); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
    });
  }
  if (req.method === 'POST' && url === '/sofia/campanhas/excluir') {
    const quem = (sess && sess.usuario) ? sess.usuario : '';
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const id = p.get('id');
      let nomeC = ''; try { const c = (sofia.lerCampanhas() || []).find(x => String(x.id) === String(id)); if (c) nomeC = c.nome || ''; } catch (_) {}
      try { sofia.opCampanha({ op: 'excluir', id }); } catch (_) {}
      try { auditoria.registrar(quem, 'campanha.excluir', nomeC || id, ''); } catch (_) {}
      res.writeHead(303, { Location: '/sofia?view=campanhas&okc=ok' }); res.end();
    });
  }

  // Página do Instagram (status + liga/desliga + limite + mensagem + horário)
  if (req.method === 'GET' && url === '/instagram') {
    const q = req.url.split('?')[1] || '';
    let aviso = '', erro = false;
    if (/(?:^|&)oficial=1/.test(q)) aviso = '🤖 Instagram oficial salvo! Vale na hora — palavra-chave, mensagem, link e botões atualizados.';
    else if (/(?:^|&)ib=1/.test(q)) aviso = '🎉 Botões de boas-vindas publicados na conta do Instagram!';
    else if (/(?:^|&)on=1/.test(q)) aviso = '📸 Instagram LIGADO. Vale no próximo disparo (07:00).';
    else if (/(?:^|&)off=1/.test(q)) aviso = '⏸️ Instagram pausado. Nenhuma DM automática será enviada.';
    else if (/(?:^|&)lim=1/.test(q)) aviso = '🎯 Limite salvo. Vale já no próximo disparo — sem reiniciar.';
    else if (/(?:^|&)ck=\d/.test(q)) aviso = '🍪 Cookies importados (' + (q.match(/ck=(\d+)/) || [])[1] + '). A sessão do Instagram foi renovada — vale na próxima execução.';
    else if (/(?:^|&)ok=1/.test(q)) aviso = 'Mensagem salva! Já vale no próximo envio.';
    else if (/(?:^|&)okh=1/.test(q)) aviso = '🕒 Horário salvo e robô reiniciado. Já vale.';
    else if (/(?:^|&)errh=1/.test(q)) { aviso = '⚠️ Horário salvo, mas não consegui reiniciar o robô. Rode: pm2 restart ' + PM2_EXP; erro = true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(paginaInstagram(aviso, erro));
  }
  if (req.method === 'POST' && url === '/instagram/toggle') {
    return lerCorpo(req, 1e5, corpo => {
      const alvo = new URLSearchParams(corpo).get('alvo');
      try { igcfg.definir(alvo === 'on'); } catch (_) {}
      res.writeHead(303, { Location: alvo === 'on' ? '/instagram?on=1' : '/instagram?off=1' }); res.end();
    });
  }
  // Salva a config da integração OFICIAL (palavra-chave, mensagem, link, on/off).
  if (req.method === 'POST' && url === '/instagram/oficial/salvar') {
    return lerCorpo(req, 1e5, corpo => {
      const p = new URLSearchParams(corpo);
      const palavras = (p.get('palavras') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const iceBreakers = [];
      for (let i = 0; i < 4; i++) {
        const pergunta = (p.get('ib' + i + '_p') || '').trim().slice(0, 80);
        const resposta = (p.get('ib' + i + '_r') || '').trim().slice(0, 1000);
        if (pergunta) iceBreakers.push({ pergunta, resposta });
      }
      try {
        igApi.gravarCfg({
          enabled: p.get('enabled') === 'on',
          responderDM: p.get('responderDM') === 'on',
          palavras,
          mensagem: (p.get('mensagem') || '').slice(0, 2000),
          link: (p.get('link') || '').trim().slice(0, 500),
          iceBreakers,
        });
        res.writeHead(303, { Location: '/instagram?oficial=1' }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaInstagram('Erro ao salvar o Instagram oficial: ' + e.message, true));
      }
    });
  }
  // Publica os Ice Breakers (botões de boas-vindas) na conta via API.
  if (req.method === 'POST' && url === '/instagram/oficial/icebreakers') {
    return lerCorpo(req, 1e4, () => {
      igApi.publicarIceBreakers()
        .then(() => { res.writeHead(303, { Location: '/instagram?ib=1' }); res.end(); })
        .catch(e => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(paginaInstagram('Não deu pra publicar os botões: ' + e.message + ' — se falar em "capability"/permissão, é porque o app ainda não está "Ao vivo". Depois da aprovação, publique de novo.', true));
        });
    });
  }
  if (req.method === 'POST' && url === '/instagram/limite') {
    return lerCorpo(req, 1e5, corpo => {
      try { igcfg.definirMax(new URLSearchParams(corpo).get('max')); res.writeHead(303, { Location: '/instagram?lim=1' }); res.end(); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaInstagram('Erro ao salvar o limite: ' + e.message, true));
      }
    });
  }
  if (req.method === 'POST' && url === '/instagram/teste-dm') {
    return lerCorpo(req, 1e6, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const textoFinal = mensagens.renderTexto(d.texto || '', mensagens.EXEMPLOS);
        const id = testeIg.solicitar({ username: d.username, texto: textoFinal });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  if (req.method === 'GET' && url === '/instagram/teste-dm/status') {
    const id = new URLSearchParams(req.url.split('?')[1] || '').get('id');
    const p = testeIg.ler(id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(p ? { status: p.status, erro: p.erro } : { status: 'desconhecido' }));
  }
  // Liga/Desliga de um envio (toggle do card). Salva em data/jobs-ativos.json.
  if (req.method === 'POST' && url === '/envio/ativo') {
    return lerCorpo(req, 1e5, corpo => {
      try {
        const d = JSON.parse(corpo || '{}');
        const chaves = Array.isArray(d.chaves) ? d.chaves : (d.chave ? [d.chave] : []);
        const limpa = chaves.map(c => String(c || '').trim()).filter(Boolean);
        if (!limpa.length) throw new Error('sem chave');
        const on = d.ativo !== false;
        limpa.forEach(c => jobsAtivos.setAtivo(c, on));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, chaves: limpa, ativo: on }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, erro: e.message }));
      }
    });
  }
  // Forçar as boas-vindas do IG agora (o robô, que tem o navegador, executa).
  if (req.method === 'POST' && url === '/instagram/forcar') {
    try { const st = igforcar.pedir(); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: true, status: st.status })); }
    catch (e) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ ok: false, erro: e.message })); }
  }
  if (req.method === 'GET' && url === '/instagram/forcar/status') {
    const st = igforcar.estado() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: st.status || 'nenhum', erro: st.erro || '' }));
  }
  if (req.method === 'POST' && url === '/instagram/cookies') {
    return lerCorpo(req, 4e6, corpo => { // cookies podem somar alguns KB
      try {
        const n = igcookies.salvar(new URLSearchParams(corpo).get('cookies') || '');
        res.writeHead(303, { Location: '/instagram?ck=' + n }); res.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(paginaInstagram('Erro ao importar cookies: ' + e.message, true));
      }
    });
  }

  // Estado do WhatsApp em JSON — o banner da aba Mensagens atualiza só este bloco
  // (sem recarregar a página, para não apagar o texto que está sendo editado).
  if (req.method === 'GET' && url === '/wa/estado') {
    const st = waStatus.get() || {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ estado: st.estado || '', qr: st.qr || '', atualizadoEm: st.atualizadoEm || '',
      pairingCode: st.pairingCode || '', pairingNumero: st.pairingNumero || '' }));
  }
  // Conectar por CÓDIGO (pairing): grava o comando com o número → o robô pede o
  // código de 8 dígitos ao WhatsApp e o publica no estado (aparece aqui em ~20s).
  if (req.method === 'POST' && url === '/wa/parear') {
    return lerCorpo(req, 1e4, (corpo) => {
      let numero = '';
      try { numero = String((JSON.parse(corpo) || {}).numero || '').replace(/\D/g, ''); } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (numero.length < 10 || numero.length > 15) return res.end(JSON.stringify({ ok: false, erro: 'Número inválido. Use DDI+DDD+número, só dígitos (ex.: 5562999998010).' }));
      try {
        const arq = path.join(path.dirname(waStatus.ARQUIVO), 'wa-comando.json');
        fs.writeFileSync(arq, JSON.stringify({ cmd: 'parear', numero, em: Date.now() }), 'utf8');
      } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Não consegui enviar o pedido ao robô.' })); }
      try { auditoria.registrar(sess.usuario, 'robo.parear', 'WhatsApp por código (' + numero + ')', ''); } catch (_) {}
      return res.end(JSON.stringify({ ok: true }));
    });
  }

  // ── Código do EVO (2FA) — plano B (humano digita o código pelo painel) ──────
  // Handshake por arquivo com o robô: o robô grava "evo-2fa-pedido.json" quando
  // precisa de um código (ex.: o EVO mandou por e-mail) e lê "evo-2fa-codigo.json"
  // que o painel grava aqui. Mesmos nomes usados em src/evo-totp.js.
  if (url === '/wa/2fa/estado' || url === '/wa/2fa/codigo') {
    const p = require('path');
    const PEDIDO_2FA = p.join(__dirname, '..', 'data', 'evo-2fa-pedido.json');
    const CODIGO_2FA = p.join(__dirname, '..', 'data', 'evo-2fa-codigo.json');
    // Estado: há um pedido do robô AINDA válido (não expirado)?
    if (req.method === 'GET' && url === '/wa/2fa/estado') {
      let pedido = false, motivo = '';
      try {
        const o = JSON.parse(fs.readFileSync(PEDIDO_2FA, 'utf8'));
        if (o && (!o.expiraEm || Date.now() < o.expiraEm)) { pedido = true; motivo = o.motivo || ''; }
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ pedido, motivo }));
    }
    // Recebe o código digitado e grava para o robô ler.
    if (req.method === 'POST' && url === '/wa/2fa/codigo') {
      return lerCorpo(req, 1e4, (corpo) => {
        let cod = '';
        try { cod = String((JSON.parse(corpo) || {}).codigo || '').replace(/\D/g, ''); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        if (cod.length < 4 || cod.length > 8) return res.end(JSON.stringify({ ok: false, erro: 'Código deve ter de 4 a 8 dígitos.' }));
        try {
          fs.mkdirSync(p.dirname(CODIGO_2FA), { recursive: true });
          fs.writeFileSync(CODIGO_2FA, JSON.stringify({ codigo: cod, em: Date.now() }), 'utf8');
        } catch (e) { return res.end(JSON.stringify({ ok: false, erro: 'Não consegui salvar o código.' })); }
        try { auditoria.registrar(sess.usuario, 'evo.2fa', 'Código do EVO (2FA) enviado ao robô', ''); } catch (_) {}
        return res.end(JSON.stringify({ ok: true }));
      });
    }
  }

  // Desconectar o WhatsApp do robô (grava comando → o robô faz logout e reinicia → QR novo).
  if (req.method === 'POST' && url === '/wa/desconectar') {
    return lerCorpo(req, 1e5, () => {
      try {
        const fs = require('fs'); const p = require('path');
        const arq = p.join(p.dirname(waStatus.ARQUIVO), 'wa-comando.json');
        fs.writeFileSync(arq, JSON.stringify({ cmd: 'logout', em: Date.now() }), 'utf8');
      } catch (_) {}
      try { auditoria.registrar(sess.usuario, 'robo.desconectar', 'WhatsApp do robô', ''); } catch (_) {}
      res.writeHead(303, { Location: '/?dcon=1' }); res.end();
    });
  }
  // Reiniciar o robô (pm2 restart slimfit-exp) direto do painel, sem SSH.
  if (req.method === 'POST' && url === '/wa/reiniciar') {
    return lerCorpo(req, 1e5, () => {
      try { auditoria.registrar(sess.usuario, 'robo.reiniciar', 'Robô (' + PM2_EXP + ')', ''); } catch (_) {}
      exec('pm2 restart ' + PM2_EXP + ' --update-env', { timeout: 25000 }, (err) => {
        res.writeHead(303, { Location: '/?' + (err ? 'errsof=1' : 'oksof=1') }); res.end();
      });
    });
  }
  // A conexão do WhatsApp agora vive no topo da aba Mensagens — redireciona link antigo.
  if (req.method === 'GET' && url === '/wa') {
    res.writeHead(301, { Location: '/?view=config' }); return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado.');
}));
   // quem já agendou (não recebe follow-up)
 // { chave: ultimoInboundSeguido }

publicarRegras();
try {
  setInterval(() => { processarExpressInbox().catch(() => {}); }, 1500);
  setInterval(() => { try { processarAgendamentos(); } catch (_) {} try { processarEventos(); } catch (_) {} try { reconciliarTagHumano(); } catch (_) {} try { publicarRegras(); } catch (_) {} }, 4000);
  // Follow-up: cadência mais lenta (as leads esfriam em horas, não em segundos).
  setInterval(() => { try { processarFollowups(); } catch (_) {} }, 120000);
  setTimeout(() => { try { processarFollowups(); } catch (_) {} }, 30000);
} catch (_) {}

server.listen(PORT, HOST, () => {
  if (!SENHA) console.warn('⚠️  PAINEL_SENHA não definido no .env — o painel vai NEGAR todo acesso até você definir usuário e senha.');
  console.log(`🖥️  Painel do Studio ouvindo em ${HOST}:${PORT} (usuário: ${USER}).`);
  console.log('   Páginas: /hoje · /indicadores · /  (WhatsApp+mensagens) · /agendar · /instagram · /sofia. Exponha SEMPRE atrás de HTTPS.');
  // Instagram oficial (Graph API): valida token e descobre a conta. Silencioso
  // se as variáveis não estiverem no .env — não atrapalha o resto do painel.
  try { igApi.bootstrap().catch(() => {}); } catch (_) {}
  // Estado da Saúde para a bolinha do avatar: a cada 3 min (pm2 jlist é leve).
  const atualizarSaudeCor = () => exec('pm2 jlist', { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
    let list = null; try { list = JSON.parse(stdout); } catch (_) {}
    const navAntes = E._navSess; E._navSess = null;
    try { paginaSaude(list, {}); } catch (_) {}
    E._navSess = navAntes;
  });
  setTimeout(atualizarSaudeCor, 5000);
  const tSaude = setInterval(atualizarSaudeCor, 3 * 60 * 1000); if (tSaude.unref) tSaude.unref();
});

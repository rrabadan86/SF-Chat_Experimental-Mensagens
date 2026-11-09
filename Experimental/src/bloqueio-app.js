/**
 * bloqueio-app.js — corta o LOGIN DO APP da aluna com pendência financeira há
 * X+ dias (padrão 11 = "mais de 10 dias") e devolve quando ela quita.
 *
 * A API oficial do EVO NÃO tem comando para isso (o block-unblock só bloqueia o
 * acesso no studio — catraca/check-in; o app continua agendando). Então o robô
 * faz o mesmo que a recepção, na ficha da aluna (Cadastro → Dados pessoais →
 * "Área do aluno"):
 *   • bloquear  → botão EXCLUIR (apaga o login; o EVO não pede confirmação);
 *   • reativar  → botão CRIAR ACESSO + CONFIRMAR (o EVO recria o login com a
 *     senha PADRÃO: 3 primeiras letras do nome + nascimento ddMMyyyy) e a SoFIA
 *     avisa a aluna explicando a regra da senha (mensagem cobranca_app_reativado).
 *
 * Roda DENTRO da cobrança (inadimplentes.js), logo depois da leitura dos débitos,
 * na mesma sessão do EVO — não loga de novo nem lê tudo duas vezes.
 *
 * Modos (painel → SoFIA → Cobrança, por unidade):
 *   • desligado — não faz nada;
 *   • teste     — abre a ficha de quem SERIA bloqueada e confere se acha o botão,
 *                 mas NÃO clica em nada. Lista no painel;
 *   • ligado    — bloqueia e reativa de verdade.
 *
 * Segurança:
 *   • só reativa quem O ROBÔ bloqueou (não mexe em quem a recepção excluiu à mão);
 *   • exceções ("não bloquear") por aluna, no painel — e quem vira exceção depois
 *     de bloqueada é reativada na próxima execução;
 *   • antes de clicar, confere que a ficha aberta é da aluna certa (nome) e que o
 *     botão está DENTRO do quadro "Área do aluno" (nunca o Excluir de outro lugar);
 *   • só reativa se a leitura do dia veio completa (segmentação "Com débito" e
 *     lista de boletos lidas) e a aluna não ficou "sem leitura" (perfil não abriu);
 *   • no máximo MAX_POR_EXECUCAO bloqueios por dia.
 *
 * Arquivos (estado por VPS, fora do Git):
 *   data/bloqueio-app.json         → { modo, dias, excecoes: { id: {nome, em, por} } }
 *   data/bloqueio-app-estado.json  → { bloqueadas: { id: {...} }, ultima: {...}, historico: [...] }
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const CFG_FILE = path.join(DATA, 'bloqueio-app.json');
const EST_FILE = path.join(DATA, 'bloqueio-app-estado.json');
const MODOS = ['desligado', 'teste', 'ligado'];
const DIAS_PADRAO = 11, DIAS_MIN = 3, DIAS_MAX = 90;
const MAX_POR_EXECUCAO = parseInt(process.env.BLOQUEIO_APP_MAX || '30', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Config ───────────────────────────────────────────────────────────────────
function lerJson(f, padrao) { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return (o && typeof o === 'object') ? o : padrao; } catch (_) { return padrao; } }
function gravarJson(f, o) {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); } catch (_) {}
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}
function lerConfig() {
  const o = lerJson(CFG_FILE, {});
  const dias = Number(o.dias);
  return {
    modo: MODOS.includes(o.modo) ? o.modo : 'desligado',
    dias: Number.isFinite(dias) && dias >= DIAS_MIN && dias <= DIAS_MAX ? Math.round(dias) : DIAS_PADRAO,
    excecoes: (o.excecoes && typeof o.excecoes === 'object') ? o.excecoes : {},
  };
}
function salvarConfig({ modo, dias }) {
  const c = lerConfig();
  if (modo != null) { if (!MODOS.includes(modo)) throw new Error('modo inválido'); c.modo = modo; }
  if (dias != null && dias !== '') {
    const n = parseInt(dias, 10);
    if (!Number.isFinite(n) || n < DIAS_MIN || n > DIAS_MAX) throw new Error(`Informe um número de dias entre ${DIAS_MIN} e ${DIAS_MAX}.`);
    c.dias = n;
  }
  gravarJson(CFG_FILE, c);
  return c;
}
function excecao(id, nome, { remover = false, por = '' } = {}) {
  const c = lerConfig();
  const k = String(id || '').trim();
  if (!/^\d+$/.test(k)) throw new Error('aluna inválida');
  if (remover) delete c.excecoes[k];
  else c.excecoes[k] = { nome: String(nome || '').slice(0, 120), em: new Date().toISOString(), por: String(por || '').slice(0, 60) };
  gravarJson(CFG_FILE, c);
  return c;
}

// ── Estado ───────────────────────────────────────────────────────────────────
function lerEstado() {
  const o = lerJson(EST_FILE, {});
  return {
    bloqueadas: (o.bloqueadas && typeof o.bloqueadas === 'object') ? o.bloqueadas : {},
    ultima: o.ultima || null,
    historico: Array.isArray(o.historico) ? o.historico : [],
  };
}
function gravarEstado(e) {
  e.historico = (e.historico || []).slice(-300);
  gravarJson(EST_FILE, e);
}
// O painel pode tirar alguém da lista do robô (ex.: a recepção já resolveu à mão).
function esquecer(id) {
  const e = lerEstado();
  const k = String(id || '');
  if (!e.bloqueadas[k]) return false;
  e.historico.push({ em: new Date().toISOString(), acao: 'esquecida', id: k, nome: e.bloqueadas[k].nome, detalhe: 'tirada da lista pelo painel' });
  delete e.bloqueadas[k];
  gravarEstado(e);
  return true;
}

// ── Nomes ────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const primeiroNome = (nome) => {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p && p === p.toUpperCase() ? p.charAt(0) + p.slice(1).toLowerCase() : p;
};

// ── EVO: quadro "Área do aluno" da ficha ─────────────────────────────────────
// Acha o quadro pelo título "Área do aluno" e devolve o estado dele. Roda no
// navegador. Nunca considera um botão fora do quadro.
function _lerQuadroNoNavegador(acao) {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const visivel = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0));
  let titulo = null;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,p,strong,b,label,mat-card-title')) {
    if (el.children.length === 0 && n(el.textContent) === 'area do aluno') { titulo = el; break; }
  }
  if (!titulo) return { achou: false };
  const botoesDe = (c) => Array.from(c.querySelectorAll('button,a,[role="button"]')).filter(visivel);
  let quadro = null;
  for (let el = titulo.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
    const t = n(el.textContent);
    if (t.includes('informacoes adicionais') || t.includes('nota fiscal') || t.length > 1500) break; // subiu demais
    const bs = botoesDe(el).map(b => n(b.textContent));
    if (bs.some(b => b === 'excluir' || b === 'criar acesso')) { quadro = el; break; }
  }
  if (!quadro) return { achou: true, quadro: false, texto: n(titulo.parentElement && titulo.parentElement.textContent).slice(0, 300) };
  const texto = n(quadro.textContent);
  const bExcluir = botoesDe(quadro).find(b => n(b.textContent) === 'excluir');
  const bCriar = botoesDe(quadro).find(b => n(b.textContent) === 'criar acesso');
  const temAcesso = !!bExcluir && /login\s*:/.test(texto);
  const semAcesso = !!bCriar || texto.includes('sem acesso');
  if (acao === 'excluir' && temAcesso) { bExcluir.scrollIntoView({ block: 'center' }); bExcluir.click(); return { achou: true, quadro: true, clicou: true }; }
  if (acao === 'criar' && bCriar) { bCriar.scrollIntoView({ block: 'center' }); bCriar.click(); return { achou: true, quadro: true, clicou: true }; }
  return { achou: true, quadro: true, temAcesso, semAcesso, texto: texto.slice(0, 300), clicou: false };
}
// Confirma a janela "Confirmar criação de acesso" (só o botão CONFIRMAR dela).
function _confirmarCriacaoNoNavegador() {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const visivel = (el) => !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0));
  let tit = null;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,span,div,p')) {
    if (el.children.length === 0 && n(el.textContent).startsWith('confirmar criacao de acesso') && visivel(el)) { tit = el; break; }
  }
  if (!tit) return false;
  for (let el = tit.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
    const b = Array.from(el.querySelectorAll('button')).filter(visivel).find(x => n(x.textContent) === 'confirmar');
    if (b) { b.click(); return true; }
  }
  return false;
}
// Algum texto da ficha confere com o nome da aluna (1º e último nome)?
function _nomeConfereNoNavegador(partes) {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // o nome aparece no topo da ficha e/ou nos campos do cadastro (valor de input não entra no innerText)
  const campos = Array.from(document.querySelectorAll('input')).map(i => i.value || '').join(' ');
  const corpo = ' ' + n((document.body && document.body.innerText) + ' ' + campos) + ' ';
  return partes.every(p => corpo.includes(' ' + p + ' '));
}

async function abrirFicha(ctx, id, nome) {
  const { page, irPara } = ctx;
  await irPara(`clientes/cadastro/${id}//informacao/dados-pessoais`, 6000);
  let q = { achou: false };
  for (let i = 0; i < 20; i++) {
    q = await page.evaluate(_lerQuadroNoNavegador, '');
    if (q.achou && q.quadro && (q.temAcesso || q.semAcesso)) break;
    if (i === 6) await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(700);
  }
  const p = norm(nome).split(' ').filter(x => x.length > 1);
  const partes = p.length > 1 ? [p[0], p[p.length - 1]] : p;
  const nomeOk = partes.length ? await page.evaluate(_nomeConfereNoNavegador, partes).catch(() => false) : false;
  const url = page.url();
  const fichaOk = new RegExp(`cadastro/${id}(/|$)`).test(url);
  return { ...q, nomeOk, fichaOk };
}
async function excluirAcesso(ctx) {
  const { page } = ctx;
  const r = await page.evaluate(_lerQuadroNoNavegador, 'excluir');
  if (!r.clicou) return { ok: false, motivo: 'não achei o botão Excluir no quadro Área do aluno' };
  for (let i = 0; i < 20; i++) {
    await sleep(600);
    const q = await page.evaluate(_lerQuadroNoNavegador, '');
    if (q.quadro && q.semAcesso && !q.temAcesso) return { ok: true };
  }
  return { ok: false, motivo: 'cliquei em Excluir, mas o quadro não mudou para "Sem acesso"' };
}
async function criarAcesso(ctx) {
  const { page } = ctx;
  const r = await page.evaluate(_lerQuadroNoNavegador, 'criar');
  if (!r.clicou) return { ok: false, motivo: 'não achei o botão Criar acesso' };
  let confirmou = false;
  for (let i = 0; i < 15 && !confirmou; i++) { await sleep(600); confirmou = await page.evaluate(_confirmarCriacaoNoNavegador).catch(() => false); }
  if (!confirmou) return { ok: false, motivo: 'a janela "Confirmar criação de acesso" não apareceu' };
  for (let i = 0; i < 20; i++) {
    await sleep(700);
    const q = await page.evaluate(_lerQuadroNoNavegador, '');
    if (q.quadro && q.temAcesso) return { ok: true };
  }
  return { ok: false, motivo: 'confirmei, mas o login não apareceu (faltam nome, nascimento ou e-mail no cadastro?)' };
}

// ── Mensagem de reativação (pela SoFIA) ──────────────────────────────────────
function avisarReativacao(b, outboxFile) {
  const tel = String(b.celular || '').replace(/\D/g, '');
  if (!tel) return false;
  try {
    const texto = require('./mensagens').render('cobranca_app_reativado', { nome: primeiroNome(b.nome) });
    if (!texto.trim()) return false;
    fs.appendFileSync(outboxFile, JSON.stringify({ id: `app-${b.id}-${Date.now()}`, telefone: tel, texto, nome: b.nome, tipo: 'app', chaveMsg: 'cobranca_app_reativado', em: new Date().toISOString() }) + '\n', 'utf8');
    return true;
  } catch (_) { return false; }
}
function alertar(titulo, msg) {
  try { require('./notificar').alertar(titulo, msg).catch(() => {}); } catch (_) {}
}
function auditar(acao, alvo, detalhe) {
  try { require('./auditoria').registrar('robô', acao, alvo, detalhe); } catch (_) {}
}

/**
 * Executa o bloqueio/reativação com a leitura da cobrança.
 * leitura = {
 *   atrasos:  Map(id → { id, nome, dias, tipo, celular })  — dias = atraso da parcela mais antiga em aberto
 *   semLeitura: Set(id)  — estavam com débito mas o perfil não abriu (não decide nada sobre elas)
 *   completa: bool       — "Com débito" e boletos foram lidos (senão não reativa ninguém)
 * }
 */
async function executar(ctx, leitura, { log = console.log, outboxFile } = {}) {
  const cfg = lerConfig();
  if (cfg.modo === 'desligado') return null;
  const est = lerEstado();
  const agora = new Date().toISOString();
  const ultima = { em: agora, modo: cfg.modo, dias: cfg.dias, completa: !!leitura.completa, candidatas: [], bloqueadas: [], reativadas: [], erros: [], seriamReativadas: [] };
  const hist = (acao, b, detalhe) => est.historico.push({ em: new Date().toISOString(), acao, id: String(b.id), nome: b.nome, detalhe: detalhe || '' });
  log(`\n📵 Bloqueio do app — modo ${cfg.modo.toUpperCase()} · a partir de ${cfg.dias} dia(s) de atraso`);

  // 1) Quem bloquear: atraso ≥ dias, não é exceção, ainda não bloqueada pelo robô.
  const alvo = [...leitura.atrasos.values()]
    .filter(a => a.dias != null && a.dias >= cfg.dias && !cfg.excecoes[String(a.id)] && !est.bloqueadas[String(a.id)])
    .sort((x, y) => y.dias - x.dias);
  let feitas = 0;
  for (const a of alvo) {
    const linha = { id: String(a.id), nome: a.nome, dias: a.dias, tipo: a.tipo, status: '' };
    ultima.candidatas.push(linha);
    if (feitas >= MAX_POR_EXECUCAO) { linha.status = 'fila'; continue; }
    feitas++;
    try {
      const f = await abrirFicha(ctx, a.id, a.nome);
      if (!f.fichaOk) { linha.status = 'erro'; linha.motivo = 'a ficha não abriu'; continue; }
      if (!f.nomeOk) { linha.status = 'erro'; linha.motivo = 'o nome na ficha não confere — não mexi'; continue; }
      if (!f.achou || !f.quadro) { linha.status = 'erro'; linha.motivo = 'não achei o quadro "Área do aluno"'; continue; }
      if (!f.temAcesso) { linha.status = 'sem-acesso'; log(`   · ${a.nome} (${a.dias}d): já sem acesso ao app.`); continue; }
      if (cfg.modo === 'teste') { linha.status = 'seria'; log(`   🧪 ${a.nome} (${a.dias}d, ${a.tipo}): SERIA bloqueada (botão Excluir encontrado).`); continue; }
      const r = await excluirAcesso(ctx);
      if (!r.ok) { linha.status = 'erro'; linha.motivo = r.motivo; ultima.erros.push(`${a.nome}: ${r.motivo}`); log(`   ⚠️  ${a.nome}: ${r.motivo}`); continue; }
      linha.status = 'bloqueada';
      const b = { id: String(a.id), nome: a.nome, celular: a.celular || '', dias: a.dias, tipo: a.tipo, em: new Date().toISOString() };
      est.bloqueadas[b.id] = b;
      ultima.bloqueadas.push(b);
      hist('bloqueada', b, `${a.dias} dia(s) de atraso (${a.tipo})`);
      auditar('app.bloquear', a.nome, `login do app excluído — ${a.dias} dia(s) de atraso`);
      gravarEstado(est); // grava a cada uma: se cair no meio, não perde quem já foi bloqueada
      log(`   📵 ${a.nome} (${a.dias}d): login do app EXCLUÍDO.`);
    } catch (e) {
      linha.status = 'erro'; linha.motivo = e.message; ultima.erros.push(`${a.nome}: ${e.message}`);
    }
  }

  // 2) Quem reativar: bloqueada pelo robô que quitou (ou virou exceção).
  for (const b of Object.values(est.bloqueadas)) {
    const k = String(b.id);
    const ehExcecao = !!cfg.excecoes[k];
    if (!ehExcecao) {
      if (!leitura.completa) continue;            // leitura do dia incompleta → não decide
      if (leitura.semLeitura.has(k)) continue;     // perfil não abriu hoje → não decide
      const a = leitura.atrasos.get(k);
      if (a && a.dias != null && a.dias >= cfg.dias) continue; // segue devendo
      // boleto pode vir com o id do PAGADOR (≠ id da ficha): confere também pelo nome
      if ([...leitura.atrasos.values()].some(x => x.dias != null && x.dias >= cfg.dias && norm(x.nome) === norm(b.nome))) continue;
    }
    const motivo = ehExcecao ? 'marcada como exceção no painel' : 'quitou (sem atraso de ' + cfg.dias + '+ dias)';
    if (cfg.modo === 'teste') { ultima.seriamReativadas.push({ id: k, nome: b.nome, motivo }); continue; }
    try {
      const f = await abrirFicha(ctx, k, b.nome);
      if (!f.fichaOk || !f.nomeOk || !f.quadro) { const m = 'não consegui abrir a ficha certa para reativar'; ultima.erros.push(`${b.nome}: ${m}`); b.falha = m; continue; }
      let r = { ok: true };
      if (!f.temAcesso) r = await criarAcesso(ctx);
      if (!r.ok) {
        ultima.erros.push(`${b.nome}: ${r.motivo}`);
        if (!b.falha) alertar('App não reativado', `${b.nome} quitou, mas o robô não conseguiu recriar o acesso ao app: ${r.motivo}. Crie pela recepção (Cadastro → Área do aluno → Criar acesso).`);
        b.falha = r.motivo;
        log(`   ⚠️  ${b.nome}: não reativei — ${r.motivo}`);
        continue;
      }
      const avisou = f.temAcesso ? false : avisarReativacao(b, outboxFile); // se a recepção já recriou, não avisa de novo
      delete est.bloqueadas[k];
      ultima.reativadas.push({ id: k, nome: b.nome, motivo, avisou });
      hist('reativada', b, motivo + (f.temAcesso ? ' — a recepção já tinha recriado' : avisou ? ' — SoFIA avisou a aluna' : ' — sem telefone, aluna não avisada'));
      auditar('app.reativar', b.nome, motivo);
      gravarEstado(est);
      log(`   ✅ ${b.nome}: acesso ao app ${f.temAcesso ? 'já estava ativo' : 'RECRIADO'} (${motivo}).`);
    } catch (e) { ultima.erros.push(`${b.nome}: ${e.message}`); }
  }

  est.ultima = ultima;
  gravarEstado(est);
  const nS = ultima.candidatas.filter(c => c.status === 'seria').length;
  log(`📵 Bloqueio do app — ${cfg.modo === 'teste' ? `teste: ${nS} seriam bloqueadas, ${ultima.seriamReativadas.length} seriam reativadas` : `${ultima.bloqueadas.length} bloqueada(s), ${ultima.reativadas.length} reativada(s)`}${ultima.erros.length ? `, ${ultima.erros.length} erro(s)` : ''}.`);
  return ultima;
}

module.exports = { lerConfig, salvarConfig, excecao, lerEstado, esquecer, executar, MODOS, DIAS_PADRAO, DIAS_MIN, DIAS_MAX, CFG_FILE, EST_FILE };

/**
 * slimclub.js — SLIM CLUB: clube de benefícios entre alunas.
 *
 * A aluna que tem um negócio se cadastra em /SlimClubCadastro (página pública).
 * A recepção valida no painel (aba "Slim Club"). As empresas APROVADAS aparecem
 * em /slimclub, que só abre para quem tem a tag de aluna ativa ("0. Aluna" — a
 * mesma do auto-tag, editável no painel) ou a da equipe ("0. Equipe"). A tag é
 * conferida a CADA acesso:
 *   - quem vira ex-aluna perde o acesso à listagem na hora;
 *   - a empresa só aparece enquanto a DONA também for aluna ativa;
 *   - e enquanto a promoção estiver vigente (data de término em branco = sem prazo).
 *
 * Cada telefone tem UM anúncio. A dona edita o dela em /slimclub/meu-anuncio:
 *   - pendente ou recusado → a edição substitui o anúncio e ele volta a "pendente";
 *   - aprovado → a edição fica guardada em `alteracao` e vai para a recepção
 *     aprovar; até lá as alunas continuam vendo a versão já aprovada.
 *
 * O telefone é a chave: é o mesmo cadastrado no EVO (o auto-tag casa as alunas
 * ativas do EVO com os contatos por telefone, tolerando o 9º dígito).
 *
 * Dados desta unidade (gitignored): data/slimclub.json, data/slimclub-fotos/ e
 * data/slimclub-config.json (aviso de aprovação por WhatsApp).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const contatos = require('./contatos');
const autoTagAlunas = require('./auto-tag-alunas');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQ = path.join(DATA_DIR, 'slimclub.json');
const FOTOS_DIR = path.join(DATA_DIR, 'slimclub-fotos');
const CFG_ARQ = path.join(DATA_DIR, 'slimclub-config.json');
const SEGREDO_ARQ = path.join(DATA_DIR, '.slimclub-segredo');

const SESSAO_DIAS = 30;                       // aluna fica conectada 30 dias no aparelho
const FOTO_MAX_BYTES = 1024 * 1024;           // 1 MB (a página reduz a foto do celular antes de enviar)
const COOKIE = 'sc_aluna';

// Como a aluna comprova que é do Studio: fixo para todos os negócios.
const COMPROVACAO = 'Apresentando a carteira SlimClub';

const CATEGORIAS = ['Saúde', 'Beleza', 'Alimentação', 'Moda', 'Serviços', 'Consultoria'];

const MSG_APROVADO_PADRAO = 'Oi, {nome}! 💜 Aqui é do {studio}.\n\n'
  + 'Seu cadastro no *Slim Club* foi aprovado! 🎉 A partir de agora, *{negocio}* aparece para as alunas do Studio.\n\n'
  + 'Veja a listagem: {link}\n\nObrigada por fazer parte! ✨';

// ── Utilidades ──────────────────────────────────────────────────────────────
function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
// "0. Aluna", "0.aluna", "0 - ALUNA" → "0aluna" (compara tag sem depender da grafia)
function chaveTag(t) { return semAcento(t).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function palavrasNome(s) { return semAcento(s).toLowerCase().split(/[^a-z]+/).filter(Boolean); }
function primeiroNome(s) {
  const p = String(s || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}
function hojeSP() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function fmtData(s) { const p = String(s || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(s || ''); }
function linha(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }
function texto(s, max) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
// "@loja", "instagram.com/loja/", "https://www.instagram.com/loja?x" → "loja".
// '' = não informado; null = inválido.
function normInstagram(s) {
  let h = String(s || '').trim();
  if (!h) return '';
  h = h.replace(/^https?:\/\//i, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}
// CNPJ (o MEI também tem CNPJ). Desde jul/2026 a Receita emite CNPJ ALFANUMÉRICO,
// então aceitamos 14 letras/números — sem exigir só dígitos nem conferir o DV.
function normDocumento(s) {
  const d = String(s || '').toUpperCase().replace(/[.\-/\s]/g, '');
  return /^[A-Z0-9]{14}$/.test(d) ? d : null;
}
function fmtDocumento(d) {
  d = String(d || '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

// ── Aluna ativa? (tag do auto-tag, conferida no CRM pelo telefone) ──────────
function tagAluna() { try { return autoTagAlunas.ler().tagAluna || '0. Aluna'; } catch (_) { return '0. Aluna'; } }
function contatoDoTel(tel, map) {
  const r = contatos.acharPorTel(tel, map);
  return r ? r.contato : null;
}
// A equipe do Studio ("0. Equipe") tem o mesmo acesso de uma aluna ativa:
// cadastra o próprio negócio, vê a listagem e gera a carteira.
const TAG_EQUIPE = '0. Equipe';
function temTagAluna(ct) {
  const alvos = [chaveTag(tagAluna()), chaveTag(TAG_EQUIPE)];
  return !!(ct && (ct.tags || []).some(t => alvos.includes(chaveTag(t))));
}
function ehAluna(tel, map) { return temTagAluna(contatoDoTel(tel, map)); }

// ── Armazenamento ───────────────────────────────────────────────────────────
function carregar() {
  try {
    const o = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
    return Array.isArray(o && o.cadastros) ? o.cadastros : [];
  } catch (_) { return []; }
}
function salvar(arr) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARQ + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ cadastros: arr }, null, 2), 'utf8');
  fs.renameSync(tmp, ARQ); // troca atômica: nunca fica um JSON pela metade
}
function obter(id) { return carregar().find(r => r.id === id) || null; }
// nova=true → a foto de uma alteração que ainda aguarda aprovação.
function arqFoto(id, nova) { return path.join(FOTOS_DIR, id + (nova ? '-nova' : '') + '.jpg'); }
function fotoPath(id, nova) {
  if (!/^[a-f0-9]{16}$/.test(String(id || ''))) return null;
  const p = arqFoto(id, nova);
  return fs.existsSync(p) ? p : null;
}
function apagarFoto(id, nova) { try { fs.unlinkSync(arqFoto(id, nova)); } catch (_) {} }
function gravarFoto(id, buf, nova) {
  fs.mkdirSync(FOTOS_DIR, { recursive: true });
  fs.writeFileSync(arqFoto(id, nova), buf);
}

// A página converte a foto para JPEG (canvas) antes de enviar; aqui só aceitamos
// JPEG de verdade (assinatura FF D8 FF) de até 1 MB. Devolve { buf } ou { erro }.
function decodificarFoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { erro: 'Envie uma foto sua (JPG ou PNG).' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > FOTO_MAX_BYTES) return { erro: 'A foto passa de 1 MB. Escolha uma foto menor.' };
  if (buf.length < 1000 || !(buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)) {
    return { erro: 'Não consegui ler essa foto. Tente outra (JPG ou PNG, até 1 MB).' };
  }
  return { buf };
}

// ── Cadastro (página pública) ───────────────────────────────────────────────
// fotoOpcional: na edição, sem foto nova fica a que já está no anúncio.
function validar(c, { fotoOpcional = false } = {}) {
  c = c || {};
  const nome = linha(c.nome, 120);
  const telefone = contatos.normTel(c.telefone);
  const negocio = linha(c.negocio, 80);
  const categoria = linha(c.categoria, 40);
  const documento = normDocumento(c.documento);
  const beneficio = texto(c.beneficio, 600);
  const alcance = c.alcance === 'nacional' ? 'nacional' : (c.alcance === 'local' ? 'local' : '');
  const validacao = COMPROVACAO;
  const fimVigencia = String(c.fimVigencia || '').trim();
  const instagram = normInstagram(c.instagram);

  if (palavrasNome(nome).length < 2) return { erro: 'Informe seu nome completo.' };
  if (!telefone) return { erro: 'Informe o telefone com DDD (o mesmo cadastrado no Studio).' };
  if (!negocio) return { erro: 'Informe o nome do negócio.' };
  if (!categoria) return { erro: 'Escolha a categoria do negócio.' };
  if (!documento) return { erro: 'Informe o CNPJ do negócio (o MEI também tem CNPJ): 14 caracteres.' };
  if (beneficio.length < 10) return { erro: 'Descreva o benefício de forma específica (ex.: "15% de desconto em qualquer serviço").' };
  if (!alcance) return { erro: 'Escolha o alcance: local ou nacional.' };
  if (fimVigencia && !dataValida(fimVigencia)) return { erro: 'Data de término inválida.' };
  if (fimVigencia && fimVigencia < hojeSP()) return { erro: 'A data de término já passou. Deixe em branco se a oferta não tiver prazo.' };
  if (instagram === null) return { erro: 'Instagram inválido. Use só o @ do perfil (ex.: @minhaloja).' };
  if (!c.consentimento) return { erro: 'Para participar, autorize a exibição do seu nome e foto para as alunas.' };
  const foto = (fotoOpcional && !c.foto) ? { buf: null } : decodificarFoto(c.foto);
  if (foto.erro) return { erro: foto.erro };

  return {
    dados: { nome, telefone, negocio, categoria, documento, beneficio, alcance, validacao, fimVigencia, instagram },
    foto: foto.buf,
  };
}
// Campos que a dona pode alterar (o telefone é a chave e não muda).
const CAMPOS_EDITAVEIS = ['nome', 'negocio', 'categoria', 'documento', 'beneficio', 'alcance', 'fimVigencia', 'instagram'];

// O anúncio deste telefone (tolerando o 9º dígito). Se houver mais de um (de antes
// da regra de um por aluna), vale o mais recente.
function meuAnuncio(tel) {
  const vs = contatos.variantes9(tel);
  if (!vs.length) return null;
  const meus = carregar().filter(r => vs.includes(contatos.normTel(r.telefone)));
  meus.sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return meus[0] || null;
}

const MSG_NAO_ALUNA = 'Não encontramos uma aluna ativa com este telefone. Use o mesmo telefone cadastrado no Studio (no EVO). '
  + 'Se o número estiver certo, fale com a recepção.';

const MSG_JA_TEM = 'Você já tem um anúncio no Slim Club (cada aluna pode ter um). Para alterar, entre em /slimclub '
  + 'com seu nome e telefone e toque em "Editar meu anúncio".';

function criar(campos) {
  const tel = contatos.normTel(campos && campos.telefone);
  if (tel && meuAnuncio(tel)) return { erro: MSG_JA_TEM, jaTem: true };
  const v = validar(campos);
  if (v.erro) return v;
  const ct = contatoDoTel(v.dados.telefone);
  if (!temTagAluna(ct)) return { erro: MSG_NAO_ALUNA };
  const id = crypto.randomBytes(8).toString('hex');
  gravarFoto(id, v.foto);
  const arr = carregar();
  arr.push(Object.assign({ id, status: 'pendente', criadoEm: new Date().toISOString(), nomeNoCadastro: (ct && ct.nome) || '' }, v.dados));
  salvar(arr);
  return { ok: true, id };
}

// Edição pela dona (sessão da aluna). `tel` vem da sessão, nunca do formulário.
function editar(tel, campos) {
  const atual = meuAnuncio(tel);
  if (!atual) return { erro: 'Não encontramos um anúncio seu. Cadastre o seu negócio em /SlimClubCadastro.' };
  const v = validar(Object.assign({}, campos, { telefone: atual.telefone }), { fotoOpcional: true });
  if (v.erro) return v;
  const arr = carregar();
  const r = arr.find(x => x.id === atual.id);
  const agora = new Date().toISOString();
  const novos = {};
  for (const k of CAMPOS_EDITAVEIS) novos[k] = v.dados[k];
  if (r.status === 'aprovado') {
    // Já está no ar: a mudança espera a recepção; a versão aprovada continua valendo.
    r.alteracao = Object.assign(novos, { fotoNova: !!v.foto, enviadoEm: agora });
    if (v.foto) gravarFoto(r.id, v.foto, true); else apagarFoto(r.id, true);
    delete r.alteracaoRecusada;
    salvar(arr);
    return { ok: true, id: r.id, emAnalise: 'alteracao' };
  }
  // Pendente ou recusado: corrige o próprio anúncio, que volta para a fila.
  if (r.status === 'recusado') { r.motivoAnterior = r.motivo || ''; r.reenviadoEm = agora; }
  Object.assign(r, novos, { status: 'pendente', motivo: '', editadoEm: agora });
  if (v.foto) gravarFoto(r.id, v.foto);
  salvar(arr);
  return { ok: true, id: r.id, emAnalise: 'anuncio' };
}

// Recepção decide sobre a alteração de um anúncio já aprovado.
function avaliarAlteracao(id, aprovar, usuario, motivo) {
  const arr = carregar();
  const r = arr.find(x => x.id === id);
  if (!r || !r.alteracao) return null;
  const alt = r.alteracao;
  const agora = new Date().toISOString();
  if (aprovar) {
    for (const k of CAMPOS_EDITAVEIS) if (k in alt) r[k] = alt[k];
    if (alt.fotoNova && fotoPath(r.id, true)) fs.renameSync(arqFoto(r.id, true), arqFoto(r.id));
    r.alteradoEm = agora;
    r.alteracaoAvaliadaPor = String(usuario || '');
    delete r.alteracaoRecusada;
  } else {
    apagarFoto(r.id, true);
    r.alteracaoRecusada = { motivo: linha(motivo, 300), por: String(usuario || ''), em: agora };
  }
  delete r.alteracao;
  salvar(arr);
  return r;
}

// ── Validação pela recepção (painel) ────────────────────────────────────────
function avaliar(id, status, usuario, motivo) {
  if (status !== 'aprovado' && status !== 'recusado' && status !== 'pendente') return null;
  const arr = carregar();
  const r = arr.find(x => x.id === id);
  if (!r) return null;
  // Saindo de "aprovado" com uma alteração em espera: a alteração vira o anúncio
  // (é a versão mais nova da dona, e ele volta a ser avaliado por inteiro).
  if (r.alteracao && status !== 'aprovado') {
    for (const k of CAMPOS_EDITAVEIS) if (k in r.alteracao) r[k] = r.alteracao[k];
    if (r.alteracao.fotoNova && fotoPath(r.id, true)) fs.renameSync(arqFoto(r.id, true), arqFoto(r.id));
    delete r.alteracao;
  }
  r.status = status;
  r.avaliadoPor = String(usuario || '');
  r.avaliadoEm = new Date().toISOString();
  r.motivo = status === 'recusado' ? linha(motivo, 300) : '';
  salvar(arr);
  return r;
}
function marcarAviso(id, avisoId, erro) {
  const arr = carregar();
  const r = arr.find(x => x.id === id);
  if (!r) return;
  r.avisoId = avisoId || '';
  r.avisoErro = erro ? String(erro).slice(0, 200) : '';
  r.avisoEm = new Date().toISOString();
  salvar(arr);
}
function excluir(id) {
  const arr = carregar();
  const i = arr.findIndex(x => x.id === id);
  if (i < 0) return false;
  arr.splice(i, 1);
  salvar(arr);
  if (fotoPath(id)) apagarFoto(id);
  if (fotoPath(id, true)) apagarFoto(id, true);
  return true;
}

// Está na listagem das alunas agora? Se não, por quê (para o painel explicar).
function situacao(r, map, hoje) {
  hoje = hoje || hojeSP();
  if (r.status === 'pendente') return { visivel: false, motivo: 'aguardando validação' };
  if (r.status === 'recusado') return { visivel: false, motivo: 'recusado' };
  if (r.fimVigencia && r.fimVigencia < hoje) return { visivel: false, motivo: `promoção encerrada em ${fmtData(r.fimVigencia)}` };
  if (!ehAluna(r.telefone, map)) return { visivel: false, motivo: 'a dona não é mais aluna ativa' };
  return { visivel: true, motivo: '' };
}
// Painel: todos os cadastros, mais recentes primeiro, com a situação calculada.
function listarPainel() {
  const map = contatos.carregar();
  const hoje = hojeSP();
  return carregar()
    .map(r => Object.assign({}, r, { situacao: situacao(r, map, hoje), alunaAgora: ehAluna(r.telefone, map) }))
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}
// Listagem das alunas: só aprovados, vigentes e com a dona ainda aluna.
function publicos() {
  const map = contatos.carregar();
  const hoje = hojeSP();
  return carregar()
    .filter(r => situacao(r, map, hoje).visivel)
    .sort((a, b) => a.negocio.localeCompare(b.negocio, 'pt-BR', { sensitivity: 'base' }));
}

// "Meu anúncio": o que a dona vê no topo da listagem. cls: ok | esp | no.
function estadoMeuAnuncio(r) {
  if (r.status === 'pendente') {
    return { cls: 'esp', titulo: 'Aguardando aprovação', botao: 'Editar anúncio',
      texto: r.reenviadoEm ? 'Você reenviou o anúncio. A recepção vai conferir.' : 'A recepção vai conferir o seu anúncio antes de ele aparecer para as alunas.' };
  }
  if (r.status === 'recusado') {
    return { cls: 'no', titulo: 'Não aprovado', botao: 'Corrigir e reenviar',
      texto: (r.motivo ? `Motivo: ${r.motivo}. ` : '') + 'Corrija o anúncio e envie de novo para a recepção.' };
  }
  const st = situacao(r);
  const extra = r.alteracao
    ? ' Sua alteração está com a recepção para aprovar. Até lá, vale a versão atual.'
    : (r.alteracaoRecusada ? ` Sua última alteração não foi aprovada${r.alteracaoRecusada.motivo ? ` (motivo: ${r.alteracaoRecusada.motivo})` : ''}.` : '');
  if (st.visivel) return { cls: 'ok', titulo: 'No ar', botao: 'Editar anúncio', texto: 'Seu anúncio aparece para as alunas.' + extra };
  const venceu = r.fimVigencia && r.fimVigencia < hojeSP();
  return { cls: 'no', titulo: 'Fora do ar', botao: 'Editar anúncio',
    texto: (venceu ? `A promoção terminou em ${fmtData(r.fimVigencia)}. Atualize a data de término para voltar à listagem.` : `Motivo: ${st.motivo}.`) + extra };
}

// ── Acesso da aluna à listagem (cookie assinado, 30 dias) ───────────────────
const SEGREDO = (function () {
  if (process.env.SLIMCLUB_SEGREDO) return process.env.SLIMCLUB_SEGREDO;
  try { const s = fs.readFileSync(SEGREDO_ARQ, 'utf8').trim(); if (s) return s; } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SEGREDO_ARQ, s, 'utf8'); } catch (_) {}
  return s;
})();
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function assinar(dado) { return crypto.createHmac('sha256', SEGREDO).update(dado).digest('hex'); }
function criarToken(tel) {
  const payload = b64url(JSON.stringify({ t: tel, exp: Date.now() + SESSAO_DIAS * 864e5 }));
  return payload + '.' + assinar(payload);
}
function lerToken(tok) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !sig) return null;
  const esperado = assinar(payload);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  let o; try { o = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; }
  if (!o || !o.t || !o.exp || Date.now() > o.exp) return null;
  return o.t;
}
// O telefone é a chave; o nome confere de forma flexível (sem acento/caixa): o
// PRIMEIRO nome digitado precisa existir no nome cadastrado.
function nomeConfere(digitado, cadastrado) {
  const cad = palavrasNome(cadastrado);
  if (!cad.length) return true; // contato sem nome no CRM: vale só o telefone
  const p = palavrasNome(digitado)[0];
  return !!p && cad.includes(p);
}
const MSG_ACESSO_NEGADO = 'Não encontramos uma aluna ativa com esse nome e telefone. Use o telefone cadastrado no Studio. '
  + 'Se você é aluna e não consegue entrar, fale com a recepção.';
function entrar(nome, telefone) {
  const tel = contatos.normTel(telefone);
  const ct = tel ? contatoDoTel(tel) : null;
  if (!ct || !temTagAluna(ct) || !nomeConfere(nome, ct.nome)) return { erro: MSG_ACESSO_NEGADO };
  return { ok: true, token: criarToken(tel) };
}
// Aluna da sessão — a tag é conferida de novo a cada acesso (ex-aluna perde na hora).
function alunaDaSessao(tok) {
  const tel = lerToken(tok);
  if (!tel) return null;
  const ct = contatoDoTel(tel);
  if (!temTagAluna(ct)) return null;
  return { telefone: tel, nome: (ct && ct.nome) || '' };
}

// ── Configuração do aviso de aprovação (WhatsApp) ───────────────────────────
function lerConfig() {
  let o = {};
  try { const p = JSON.parse(fs.readFileSync(CFG_ARQ, 'utf8')); if (p && typeof p === 'object') o = p; } catch (_) {}
  return {
    avisar: o.avisar !== false,
    msgAprovado: (typeof o.msgAprovado === 'string' && o.msgAprovado.trim()) ? o.msgAprovado : MSG_APROVADO_PADRAO,
  };
}
function gravarConfig(cfg) {
  const o = {
    avisar: !!(cfg && cfg.avisar),
    msgAprovado: texto((cfg && cfg.msgAprovado) || '', 1500) || MSG_APROVADO_PADRAO,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CFG_ARQ, JSON.stringify(o, null, 2), 'utf8');
  return o;
}
function mensagemAprovado(r, link) {
  const vars = {
    nome: primeiroNome(r.nome),
    negocio: r.negocio,
    link: link || '',
    studio: process.env.STUDIO_NOME || 'Studio SlimFit',
  };
  let t = lerConfig().msgAprovado;
  for (const [k, v] of Object.entries(vars)) t = t.split('{' + k + '}').join(v);
  return t;
}

// ── Carteira SlimClub ───────────────────────────────────────────────────────
// A aluna ativa gera a carteira em /slimclub/carteira. O QR leva o parceiro a
// /slimclub/v/<código>, que mostra o status AGORA (ativa / ex-aluna) — um print
// antigo de quem virou ex-aluna é desmascarado na hora. O código é assinado
// (não dá para inventar um) e só carrega o telefone e a hora em que foi gerado.
function tagExAluna() { try { return autoTagAlunas.ler().tagExAluna || '0. Ex Aluna'; } catch (_) { return '0. Ex Aluna'; } }
function statusDoTel(tel, map) {
  const ct = contatoDoTel(tel, map);
  if (temTagAluna(ct)) return { status: 'ativa', contato: ct };
  const ex = chaveTag(tagExAluna());
  if (ct && (ct.tags || []).some(t => chaveTag(t) === ex)) return { status: 'ex-aluna', contato: ct };
  return { status: 'inativa', contato: ct };
}
function tokenVerificacao(tel, geradaEm) {
  const payload = b64url(JSON.stringify({ v: tel, g: geradaEm }));
  return payload + '.' + assinar('carteira:' + payload).slice(0, 32); // 128 bits: QR mais simples de ler
}
function verificar(tok) {
  const [payload, sig] = String(tok || '').split('.');
  if (!payload || !/^[a-f0-9]{32}$/.test(sig || '')) return null;
  const esperado = assinar('carteira:' + payload).slice(0, 32);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  let o; try { o = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return null; }
  if (!o || !o.v || !o.g) return null;
  const st = statusDoTel(o.v);
  return { status: st.status, nome: (st.contato && st.contato.nome) || '', telefone: o.v, geradaEm: o.g };
}
function ultimaSincronizacaoEvo() { try { return autoTagAlunas.ultimaSincronizacao() || ''; } catch (_) { return ''; } }

// ── Limite de tentativas por IP (cadastro/login públicos) ───────────────────
const _tentativas = new Map();
function permitir(chave, max, janelaMs) {
  const agora = Date.now();
  if (_tentativas.size > 5000) _tentativas.clear();
  const arr = (_tentativas.get(chave) || []).filter(t => agora - t < janelaMs);
  if (arr.length >= max) { _tentativas.set(chave, arr); return false; }
  arr.push(agora);
  _tentativas.set(chave, arr);
  return true;
}

module.exports = {
  COOKIE, SESSAO_DIAS, CATEGORIAS, MSG_APROVADO_PADRAO, COMPROVACAO, FOTO_MAX_BYTES,
  criar, obter, avaliar, marcarAviso, excluir, listarPainel, publicos, situacao,
  meuAnuncio, editar, avaliarAlteracao, estadoMeuAnuncio, CAMPOS_EDITAVEIS,
  entrar, alunaDaSessao, fotoPath,
  tokenVerificacao, verificar, ultimaSincronizacaoEvo,
  lerConfig, gravarConfig, mensagemAprovado,
  permitir, primeiroNome, fmtData, fmtDocumento, hojeSP, tagAluna,
  // expostos para testes
  _validar: validar, _normInstagram: normInstagram, _normDocumento: normDocumento, _nomeConfere: nomeConfere,
};

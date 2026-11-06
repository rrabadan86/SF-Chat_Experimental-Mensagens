/**
 * painel-slimclub.js — Slim Club (páginas públicas e validação no painel).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const fs = require('fs');
const teste = require('./teste-envio');
const slimclub = require('./slimclub');
const slimclubPaginas = require('./slimclub-paginas');
const auditoria = require('./auditoria');
const {
  ehHttps, scIp, scJson, lerCorpo, scHtml, scStudio, lerCookie, scSoJson, fmtTel, scBaseUrl, usuarioDaReq, esc, uiTopo, chrome, fmtData,
} = require('./painel-base');

function scSetCookie(req, res, valor, maxAgeSec, nome) {
  const partes = [`${nome || slimclub.COOKIE}=${encodeURIComponent(valor)}`, 'Path=/slimclub', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (ehHttps(req)) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}
function scFmtQuando(iso, comSegundos) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const o = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (comSegundos) o.second = '2-digit';
  return d.toLocaleString('pt-BR', o).replace(',', ' às');
}

// parceira=true: /SlimClubCadastroExterno (empresa que não é de aluna; vai para validação).
function rotaSlimClubCadastro(req, res, parceira) {
  if (req.method === 'GET') {
    return scHtml(res, 200, slimclubPaginas.paginaCadastro({ studio: scStudio(), categorias: slimclub.CATEGORIAS, avisar: slimclub.lerConfig().avisar, comprovacao: slimclub.COMPROVACAO, parceira: !!parceira }));
  }
  if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('method not allowed'); }
  if (!slimclub.permitir('cad:' + scIp(req), 10, 3600e3)) return scJson(res, 429, { erro: 'Muitos envios seguidos. Aguarde um pouco e tente de novo.' });
  return lerCorpo(req, 2e6, corpo => { // foto de até 1 MB (~1,4 MB em base64) + campos
    let d = null; try { d = JSON.parse(corpo); } catch (_) {}
    if (!d || typeof d !== 'object') return scJson(res, 400, { erro: 'Envio inválido. Recarregue a página e tente de novo.' });
    let r;
    try { r = parceira ? slimclub.criarParceira(d) : slimclub.criar(d); } catch (e) { console.log('[slimclub] erro ao salvar cadastro:', e.message); r = { erro: 'Não consegui salvar agora. Tente de novo em instantes.' }; }
    if (r.ok) console.log(`[slimclub] novo cadastro ${parceira ? 'de empresa parceira ' : ''}${r.id} — aguardando validação no painel`);
    return scJson(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { erro: r.erro });
  });
}

function rotaSlimClubPublico(req, res, rota, urlOriginal) {
  const studio = scStudio();
  if (rota === '/slimclub' && req.method === 'GET') {
    const aluna = slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    if (!aluna) return scHtml(res, 200, slimclubPaginas.paginaEntrar({ studio }));
    let meu = slimclub.meuAnuncio(aluna.telefone);
    // Aprovada antes do código existir: ganha o código já aqui (para aparecer no "Meu anúncio").
    if (meu && meu.status === 'aprovado' && !meu.codigo) { slimclub.garantirCodigos(); meu = slimclub.meuAnuncio(aluna.telefone); }
    const est = slimclub.estatisticas();
    const empresas = slimclub.publicos();
    const recs = {};
    for (const e of empresas) recs[e.id] = (est[e.id] && est[e.id].recs) || 0;
    const nums = meu && meu.status === 'aprovado' ? { recs: (est[meu.id] && est[meu.id].recs) || 0, usos: (est[meu.id] && est[meu.id].usos) || 0 } : null;
    return scHtml(res, 200, slimclubPaginas.paginaListagem({
      studio, aluna, empresas, fmtData: slimclub.fmtData, fmtDocumento: slimclub.fmtDocumento, primeiroNome: slimclub.primeiroNome, comprovacao: slimclub.COMPROVACAO,
      meu: meu ? { r: meu, estado: slimclub.estadoMeuAnuncio(meu), nums } : null,
      aval: slimclub.minhasAvaliacoes(aluna.telefone), recs,
      aviso: !meu && /(?:^|&)excluido=1(?:&|$)/.test(req.url.split('?')[1] || '') ? 'Seu anúncio foi excluído.' : '',
    }));
  }
  // A dona exclui o próprio anúncio (de aluna; o de parceira só a recepção exclui).
  if (rota === '/slimclub/meu-anuncio/excluir' && req.method === 'POST') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    const aluna = slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    if (!aluna) return scJson(res, 401, { erro: 'Sua sessão expirou. Entre de novo em /slimclub e tente outra vez.' });
    return lerCorpo(req, 1e3, () => {
      const meu = slimclub.meuAnuncio(aluna.telefone);
      if (!meu) return scJson(res, 404, { erro: 'Não encontramos um anúncio seu.' });
      slimclub.excluir(meu.id, { por: aluna.nome || fmtTel(aluna.telefone), pelaDona: true });
      try { auditoria.registrar(aluna.nome || fmtTel(aluna.telefone), 'slimclub.excluir-dona', meu.negocio + ' (' + meu.nome + ')', 'pela própria aluna'); } catch (_) {}
      console.log(`[slimclub] anúncio ${meu.id} (${meu.negocio}) excluído pela própria dona`);
      return scJson(res, 200, { ok: true });
    });
  }
  // 👍 (liga/desliga) e 👎 (reclamação para a recepção) — aluna conectada.
  if ((rota === '/slimclub/recomendar' || rota === '/slimclub/reclamar') && req.method === 'POST') {
    if (!scSoJson(req)) return scJson(res, 415, { erro: 'Envio inválido.' });
    const aluna = slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    if (!aluna) return scJson(res, 401, { erro: 'Sua sessão expirou. Entre de novo.' });
    if (!slimclub.permitir('aval:' + scIp(req), 60, 3600e3)) return scJson(res, 429, { erro: 'Muitos envios seguidos. Aguarde um pouco.' });
    return lerCorpo(req, 2e4, corpo => {
      let d = {}; try { d = JSON.parse(corpo) || {}; } catch (_) {}
      const id = String(d.empresa || '');
      const r = rota === '/slimclub/recomendar'
        ? slimclub.recomendar(aluna.telefone, id)
        : slimclub.reclamar(aluna.telefone, aluna.nome, id, d.texto);
      if (r.ok && rota === '/slimclub/reclamar') console.log(`[slimclub] nova reclamação ${r.id} — ver no painel (Slim Club → Reclamações)`);
      return scJson(res, r.ok ? 200 : 400, r);
    });
  }
  // Meu anúncio: a dona edita o próprio anúncio (um por telefone).
  if (rota === '/slimclub/meu-anuncio') {
    const aluna = slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    if (req.method === 'GET') {
      if (!aluna) { res.writeHead(303, { Location: '/slimclub' }); return res.end(); }
      const meu = slimclub.meuAnuncio(aluna.telefone);
      // Ainda sem anúncio: o cadastro abre aqui dentro, com nome e telefone da sessão.
      if (!meu) {
        return scHtml(res, 200, slimclubPaginas.paginaCadastro({
          studio, categorias: slimclub.CATEGORIAS, avisar: slimclub.lerConfig().avisar, comprovacao: slimclub.COMPROVACAO,
          logada: { nome: aluna.nome, telefone: fmtTel(aluna.telefone) },
        }));
      }
      // Com uma alteração em análise, o formulário mostra a versão enviada por último.
      const r = meu.alteracao ? Object.assign({}, meu, meu.alteracao) : meu;
      return scHtml(res, 200, slimclubPaginas.paginaCadastro({
        studio, categorias: slimclub.CATEGORIAS, avisar: slimclub.lerConfig().avisar, comprovacao: slimclub.COMPROVACAO,
        edicao: { r, aprovado: meu.status === 'aprovado', telefone: fmtTel(meu.telefone), documento: slimclub.fmtDocumento(r.documento),
          fotoUrl: '/slimclub/foto/' + meu.id + (meu.alteracao && meu.alteracao.fotoNova ? '-nova' : '') },
      }));
    }
    if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'text/plain' }); return res.end('method not allowed'); }
    // Só JSON (fetch da própria página): um formulário de outro site não consegue mandar.
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return scJson(res, 415, { erro: 'Envio inválido.' });
    if (!aluna) return scJson(res, 401, { erro: 'Sua sessão expirou. Entre de novo em /slimclub e tente outra vez.' });
    if (!slimclub.permitir('edit:' + scIp(req), 20, 3600e3)) return scJson(res, 429, { erro: 'Muitos envios seguidos. Aguarde um pouco e tente de novo.' });
    return lerCorpo(req, 2e6, corpo => {
      let d = null; try { d = JSON.parse(corpo); } catch (_) {}
      if (!d || typeof d !== 'object') return scJson(res, 400, { erro: 'Envio inválido. Recarregue a página e tente de novo.' });
      let r;
      const novo = !slimclub.meuAnuncio(aluna.telefone);
      try { r = novo ? slimclub.criar(Object.assign({}, d, { telefone: aluna.telefone })) : slimclub.editar(aluna.telefone, d); } catch (e) { console.log('[slimclub] erro ao salvar anúncio:', e.message); r = { erro: 'Não consegui salvar agora. Tente de novo em instantes.' }; }
      if (r.ok) console.log(novo ? `[slimclub] novo cadastro ${r.id} (pela área da aluna) — aguardando validação no painel`
        : `[slimclub] anúncio ${r.id} editado pela dona — ${r.emAnalise === 'alteracao' ? 'alteração' : 'anúncio'} aguardando validação`);
      return scJson(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { erro: r.erro });
    });
  }
  if (rota === '/slimclub/entrar' && req.method === 'POST') {
    return lerCorpo(req, 1e4, corpo => {
      const p = new URLSearchParams(corpo);
      const nome = p.get('nome') || '', telefone = p.get('telefone') || '';
      if (!slimclub.permitir('login:' + scIp(req), 15, 15 * 60e3)) {
        return scHtml(res, 429, slimclubPaginas.paginaEntrar({ studio, nome, telefone, erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }));
      }
      const r = slimclub.entrar(nome, telefone);
      if (!r.ok) return scHtml(res, 200, slimclubPaginas.paginaEntrar({ studio, nome, telefone, erro: r.erro }));
      scSetCookie(req, res, r.token, slimclub.SESSAO_DIAS * 86400);
      res.writeHead(303, { Location: '/slimclub' }); return res.end();
    });
  }
  if (rota === '/slimclub/sair') { scSetCookie(req, res, '', 0); res.writeHead(303, { Location: '/slimclub' }); return res.end(); }
  // Carteira SlimClub: só a aluna ATIVA conectada gera. O QR leva o parceiro à
  // conferência pública (/slimclub/v/<código>), que mostra o status de AGORA.
  if (rota === '/slimclub/carteira' && req.method === 'GET') {
    const aluna = slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    if (!aluna) { res.writeHead(303, { Location: '/slimclub' }); return res.end(); }
    const agora = Date.now();
    const sync = slimclub.ultimaSincronizacaoEvo();
    const link = scBaseUrl(req) + '/slimclub/v/' + slimclub.tokenVerificacao(aluna.telefone, agora);
    return require('qrcode').toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .catch((e) => { console.log('[slimclub] QR da carteira:', e.message); return ''; })
      .then(qr => scHtml(res, 200, slimclubPaginas.paginaCarteira({
        studio, nome: aluna.nome, telefone: fmtTel(aluna.telefone), qr,
        geradaEm: scFmtQuando(agora, true),
        verificadaEm: sync ? scFmtQuando(sync) : scFmtQuando(agora),
        verificadaNoEvo: !!sync,
      })));
  }
  const mv = /^\/slimclub\/v\/([A-Za-z0-9_-]+\.[a-f0-9]{32})\/?$/.exec(urlOriginal || '');
  if (mv && req.method === 'GET') {
    const r = slimclub.verificar(mv[1]);
    // Carteira ativa: a empresa parceira registra o uso do benefício aqui mesmo.
    let registro = null;
    if (r && r.status === 'ativa') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      const empresa = slimclub.empresaDoAparelho(lerCookie(req, slimclub.COOKIE_EMPRESA));
      const nomeEmp = empresa ? empresa.negocio : 'empresa';
      const MSGS = {
        ok: ['ok', `Uso do benefício registrado na ${nomeEmp} em ${scFmtQuando(Date.now())}.`],
        dia: ['ok', `O uso desta aluna na ${nomeEmp} já foi registrado hoje.`],
        velha: ['erro', `Esta carteira foi aberta há mais de ${slimclub.CARTEIRA_VALE_H} horas. Peça para a aluna abrir a carteira de novo no celular e leia o QR outra vez.`],
        codigo: ['erro', 'Código não encontrado. Confira os 6 dígitos que a empresa recebeu na aprovação (a recepção do Studio também tem o código).'],
        dona: ['erro', 'A dona do negócio não pode registrar uso no próprio negócio.'],
        limite: ['erro', 'Muitas tentativas de código. Aguarde 15 minutos e tente de novo.'],
        trocou: ['ok', 'Empresa desconectada deste celular. Digite o código da empresa que vai registrar o uso.'],
      };
      const m = MSGS[q.get('r')];
      registro = { empresa: empresa ? { negocio: empresa.negocio } : null, msg: m ? { cls: m[0], texto: m[1] } : null, acao: mv[1] && ('/slimclub/v/' + mv[1] + '/uso') };
    }
    return scHtml(res, 200, slimclubPaginas.paginaVerificacao({
      studio, r, conferidoEm: scFmtQuando(Date.now(), true), geradaEm: r ? scFmtQuando(r.geradaEm, true) : '', registro,
    }));
  }
  // Registro do uso: a empresa já lembrada neste aparelho, ou pelo código de 6 dígitos.
  const mu = /^\/slimclub\/v\/([A-Za-z0-9_-]+\.[a-f0-9]{32})\/uso$/.exec(urlOriginal || '');
  if (mu && req.method === 'POST') {
    const tok = mu[1];
    const volta = (codigo) => { res.writeHead(303, { Location: '/slimclub/v/' + tok + (codigo ? '?r=' + codigo : '') }); return res.end(); };
    return lerCorpo(req, 2e3, corpo => {
      const p = new URLSearchParams(corpo);
      if (p.get('acao') === 'trocar') { scSetCookie(req, res, '', 0, slimclub.COOKIE_EMPRESA); return volta('trocou'); }
      let empresa = null;
      const codigo = String(p.get('codigo') || '').trim();
      if (codigo) {
        if (!slimclub.permitir('cod:' + scIp(req), 10, 15 * 60e3)) return volta('limite');
        empresa = slimclub.empresaPorCodigo(codigo);
        if (!empresa) return volta('codigo');
        scSetCookie(req, res, slimclub.tokenEmpresa(empresa), slimclub.EMPRESA_DIAS * 86400, slimclub.COOKIE_EMPRESA);
      } else {
        empresa = slimclub.empresaDoAparelho(lerCookie(req, slimclub.COOKIE_EMPRESA));
        if (!empresa) return volta('codigo');
      }
      const r = slimclub.registrarUso(empresa, tok);
      if (r.ok) console.log(`[slimclub] uso registrado: ${r.uso.nome || r.uso.tel} na ${empresa.negocio}`);
      return volta(r.ok ? 'ok' : r.erro);
    });
  }
  // Foto da aluna: a equipe (com acesso ao Slim Club) vê todas; a aluna conectada
  // vê as dos negócios que estão na listagem e a do próprio anúncio. "-nova" é a
  // foto de uma alteração ainda não aprovada (só a equipe e a dona veem).
  const mf = /^\/slimclub\/foto\/([a-f0-9]{16})(-nova)?$/.exec(rota);
  if (mf && req.method === 'GET') {
    const id = mf[1], nova = !!mf[2];
    const st = usuarioDaReq(req);
    const equipe = !!(st && (st.admin || (st.telas || []).includes('slimclub')));
    const aluna = equipe ? null : slimclub.alunaDaSessao(lerCookie(req, slimclub.COOKIE));
    const meu = aluna ? slimclub.meuAnuncio(aluna.telefone) : null;
    const pode = equipe || !!(meu && meu.id === id) || (!!aluna && !nova && slimclub.publicos().some(e => e.id === id));
    const arq = pode ? slimclub.fotoPath(id, nova) : null;
    if (!arq) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('foto não encontrada'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' });
    return fs.createReadStream(arq).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('não encontrado');
}

// Aviso de aprovação: o robô (que tem o WhatsApp) envia pela ponte do teste-envio.
function scAvisarAprovado(r, req) {
  try {
    const id = teste.solicitar({ telefone: r.telefone, texto: slimclub.mensagemAprovado(r, scBaseUrl(req) + '/slimclub'), contexto: 'Slim Club' });
    slimclub.marcarAviso(r.id, id, '');
    return { ok: true };
  } catch (e) {
    slimclub.marcarAviso(r.id, '', e.message);
    return { ok: false, erro: e.message };
  }
}
function scStatusAviso(r) {
  if (r.avisoErro) return `⚠️ O aviso no WhatsApp não saiu: ${esc(r.avisoErro)}`;
  if (!r.avisoId) return '';
  const t = teste.ler(r.avisoId);
  if (!t) return '';
  if (t.status === 'enviado') return '✅ Aviso de aprovação enviado no WhatsApp.';
  if (t.status === 'falha') return `⚠️ O aviso no WhatsApp falhou: ${esc(t.erro || 'erro')}. Use "Reenviar aviso" quando o WhatsApp do robô estiver conectado.`;
  return '⏳ Aviso de aprovação na fila do robô.';
}

function paginaSlimClub(view, base, aviso) {
  const cfg = slimclub.lerConfig();
  slimclub.garantirCodigos(); // aprovadas de antes do código ganham um
  const todos = slimclub.listarPainel();
  const est = slimclub.estatisticas();
  const reclamacoes = slimclub.listarReclamacoes();
  const abertas = reclamacoes.filter(r => r.status === 'aberta').length;
  const por = { pendente: [], aprovado: [], recusado: [], excluido: [] };
  for (const r of todos) (por[r.status] || por.pendente).push(r);
  // Alteração de anúncio já aprovado: aparece em Pendentes (a recepção decide) e
  // continua em Aprovados (é a versão que está no ar).
  const alteracoes = por.aprovado.filter(r => r.alteracao)
    .sort((a, b) => String(b.alteracao.enviadoEm).localeCompare(String(a.alteracao.enviadoEm)));
  const VIEWS = { pendentes: 'pendente', aprovados: 'aprovado', recusados: 'recusado', excluidos: 'excluido' };
  por.excluido.sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
  if (!VIEWS[view] && view !== 'config' && view !== 'reclamacoes') view = 'pendentes';
  const sub = (v, rot) => `<a href="/clube?view=${v}"${view === v ? ' class="on"' : ''}>${rot}</a>`;
  const subtabs = `<div class="subtabs">${sub('pendentes', `Pendentes (${por.pendente.length + alteracoes.length})`)}${sub('aprovados', `Aprovados (${por.aprovado.length})`)}${sub('recusados', `Recusados (${por.recusado.length})`)}${sub('excluidos', `Excluídos (${por.excluido.length})`)}${sub('reclamacoes', `Reclamações${abertas ? ` <span class="sc-badge">${abertas}</span>` : ' (0)'}`)}${sub('config', 'Configuração')}</div>`;

  const linkCad = base + '/SlimClubCadastro', linkAlunas = base + '/slimclub', linkExt = base + '/SlimClubCadastroExterno';
  const links = `<div class="card">
    <div class="chead"><h2>Links para divulgar</h2><button type="button" class="save" style="margin-left:auto" onclick="location.href='/clube/parceira'">+ Nova empresa parceira</button></div>
    <div class="sc-link"><div><b>Cadastro das empresárias (alunas)</b><br><code>${esc(linkCad)}</code></div><button type="button" class="reset" onclick="scCopiar('${esc(linkCad)}',this)">Copiar</button></div>
    <div class="sc-link"><div><b>Cadastro de empresas parceiras</b> <span class="sc-sub">(não são alunas)</span><br><code>${esc(linkExt)}</code></div><button type="button" class="reset" onclick="scCopiar('${esc(linkExt)}',this)">Copiar</button></div>
    <div class="sc-link"><div><b>Listagem para as alunas</b><br><code>${esc(linkAlunas)}</code></div><button type="button" class="reset" onclick="scCopiar('${esc(linkAlunas)}',this)">Copiar</button></div>
    <p class="quando" style="margin:8px 0 0">Só entra na listagem quem tem a tag <b>${esc(slimclub.tagAluna())}</b> (ou <b>0. Equipe</b>) nos contatos. A empresa de aluna só aparece enquanto a dona também tiver essa tag; a empresa parceira não depende de tag. Todas saem quando a promoção vence.</p>
  </div>`;

  const item = (r) => {
    const st = r.situacao;
    const nomeCrm = r.nomeNoCadastro && slimclub.primeiroNome(r.nomeNoCadastro) !== slimclub.primeiroNome(r.nome)
      ? `<div class="sc-sub">Nome nos contatos: ${esc(r.nomeNoCadastro)}</div>` : '';
    let estado = '';
    if (r.status === 'pendente' && !r.alunaAgora && !slimclub.ehParceira(r)) estado = '<div class="sc-al">⚠️ Este telefone não está com a tag de aluna ativa agora. Mesmo aprovado, o negócio não aparece para as alunas.</div>';
    if (r.status === 'aprovado') {
      estado = (st.visivel ? '<div class="sc-okl">✅ Aparece na listagem das alunas.</div>' : `<div class="sc-al">⚠️ Fora da listagem: ${esc(st.motivo)}.</div>`)
        + (scStatusAviso(r) ? `<div class="sc-sub" style="margin-top:4px">${scStatusAviso(r)}</div>` : '')
        + `<div class="sc-sub" style="margin-top:4px">Aprovado por ${esc(r.avaliadoPor || '—')} em ${esc(scFmtQuando(r.avaliadoEm))}.</div>`;
    }
    if (r.status === 'recusado') {
      estado = `<div class="sc-sub">Recusado por ${esc(r.avaliadoPor || '—')} em ${esc(scFmtQuando(r.avaliadoEm))}${r.motivo ? ` — motivo: ${esc(r.motivo)}` : ''}.</div>`;
    }
    if (r.status === 'pendente' && r.reenviadoEm) estado += `<div class="sc-sub" style="margin-top:4px">↩️ Reenviado pela aluna em ${esc(scFmtQuando(r.reenviadoEm))}, depois de recusado${r.motivoAnterior ? ` (motivo: ${esc(r.motivoAnterior)})` : ''}.</div>`;
    else if (r.status === 'pendente' && r.editadoEm) estado += `<div class="sc-sub" style="margin-top:4px">✏️ Editado pela aluna em ${esc(scFmtQuando(r.editadoEm))}.</div>`;
    if (r.status === 'aprovado' && r.alteracao) estado += `<div class="sc-al" style="margin-top:6px">✏️ A aluna enviou uma alteração em ${esc(scFmtQuando(r.alteracao.enviadoEm))}. Ela está em <a href="/clube?view=pendentes">Pendentes</a>; até aprovar, vale esta versão.</div>`;
    if (r.status === 'aprovado' && r.alteracaoRecusada) estado += `<div class="sc-sub" style="margin-top:4px">Última alteração recusada por ${esc(r.alteracaoRecusada.por || '—')} em ${esc(scFmtQuando(r.alteracaoRecusada.em))}${r.alteracaoRecusada.motivo ? ` — motivo: ${esc(r.alteracaoRecusada.motivo)}` : ''}.</div>`;
    const parc = slimclub.ehParceira(r);
    if (r.status === 'aprovado') {
      const e = est[r.id] || { usosMes: 0, usos: 0, recs: 0, reclAbertas: 0, recl: 0, ultimosUsos: [] };
      estado += `<div class="sc-nums">
        <span>🎟️ <b>${e.usosMes}</b> uso${e.usosMes === 1 ? '' : 's'} no mês · ${e.usos} no total</span>
        <span>👍 <b>${e.recs}</b> recomendaç${e.recs === 1 ? 'ão' : 'ões'}</span>
        <span${e.reclAbertas ? ' class="sc-ruim"' : ''}>⚠️ <b>${e.recl}</b> reclamaç${e.recl === 1 ? 'ão' : 'ões'}${e.reclAbertas ? ` (<a href="/clube?view=reclamacoes">${e.reclAbertas} em aberto</a>)` : ''}</span>
      </div>`
        + (e.ultimosUsos.length ? `<div class="sc-sub" style="margin-top:4px">Últimos usos: ${e.ultimosUsos.map(u => `${esc(slimclub.primeiroNome(u.nome) || fmtTel(u.tel))} (${esc(scFmtQuando(u.em))})`).join(' · ')}</div>` : '')
        + (r.codigo ? `<div class="sc-cod">Código de conferência: <b>${esc(r.codigo)}</b> <span class="sc-sub">— a empresa digita ao ler o QR da carteira para registrar o uso.</span></div>` : '');
    }
    const bt = (acao, rot, cls) => `<button type="button" class="${cls}" onclick="scAcao('${r.id}','${acao}')">${rot}</button>`;
    const btEditar = parc ? `<button type="button" class="reset" onclick="location.href='/clube/parceira?id=${r.id}'">Editar</button>` : '';
    let acoes = '';
    if (r.status === 'pendente') acoes = bt('aprovar', 'Aprovar', 'save') + bt('recusar', 'Recusar', 'reset') + btEditar;
    if (r.status === 'aprovado') acoes = btEditar + (cfg.avisar ? bt('reenviar-aviso', 'Reenviar aviso', 'reset') : '') + bt('novo-codigo', 'Gerar outro código', 'reset') + bt('pendente', 'Voltar para pendente', 'reset') + bt('excluir', 'Excluir', 'reset sc-rm');
    if (r.status === 'recusado') acoes = bt('aprovar', 'Aprovar', 'save') + btEditar + bt('excluir', 'Excluir', 'reset sc-rm');
    if (r.status === 'excluido') {
      const antes = { aprovado: 'estava aprovado', pendente: 'estava pendente', recusado: 'estava recusado' }[r.statusAntes] || '';
      estado = `<div class="sc-al">🗑️ ${r.excluidoPelaDona
        ? `Excluído pela própria ${parc ? 'empresa' : 'aluna'}${r.excluidoPor ? ` (${esc(r.excluidoPor)})` : ''}`
        : `Excluído por ${esc(r.excluidoPor || '—')}`} em ${esc(scFmtQuando(r.excluidoEm))}${antes ? ` · ${antes}` : ''}.</div>`;
      acoes = bt('apagar', 'Apagar de vez', 'reset sc-rm');
    }
    return `<div class="card sc-it">
      <div class="sc-top">
        <a href="/slimclub/foto/${r.id}" target="_blank" rel="noopener"><img class="sc-av${slimclub.ehParceira(r) ? ' logo' : ''}" src="/slimclub/foto/${r.id}" alt="${slimclub.ehParceira(r) ? 'Logo' : 'Foto'} de ${esc(r.negocio)}" width="64" height="64" loading="lazy"></a>
        <div>
          <div class="sc-neg">${esc(r.negocio)}</div>
          <div class="sc-sub">${esc(r.categoria)} · ${r.alcance === 'nacional' ? 'Nacional (todas as unidades)' : 'Local (só nesta cidade)'}</div>
          <div class="sc-sub">👤 ${esc(r.nome)}${parc ? ' (responsável)' : ''} · <span style="white-space:nowrap">${esc(fmtTel(r.telefone))}</span> ${parc ? `<span class="sc-tag parc">empresa parceira${r.origem === 'recepcao' ? ' · cadastrada pela recepção' : ''}</span>` : r.alunaAgora ? '<span class="sc-tag ok">aluna ativa</span>' : '<span class="sc-tag no">não é aluna ativa</span>'}</div>
          ${parc ? '' : nomeCrm}
        </div>
      </div>
      <dl class="sc-dl">
        <dt>Benefício</dt><dd>${esc(r.beneficio)}</dd>
        <dt>Como comprovar</dt><dd>${esc(slimclub.COMPROVACAO)}</dd>
        <dt>CNPJ</dt><dd>${esc(slimclub.fmtDocumento(r.documento))}</dd>
        <dt>Término</dt><dd>${r.fimVigencia ? esc(fmtData(r.fimVigencia)) : 'Sem prazo'}</dd>
        <dt>Instagram</dt><dd>${r.instagram ? `<a href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>` : '—'}</dd>
        <dt>WhatsApp do negócio</dt><dd>${r.whatsapp ? `<a href="https://wa.me/${esc(String(r.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">${esc(fmtTel(r.whatsapp))}</a>` : '—'}</dd>
        <dt>Enviado em</dt><dd>${esc(scFmtQuando(r.criadoEm))}</dd>
      </dl>
      ${estado}
      <div class="acts">${acoes}</div>
    </div>`;
  };

  // Alteração de um anúncio no ar: mostra a versão nova e, nos campos que mudaram,
  // o valor que está no ar hoje.
  const itemAlteracao = (r) => {
    const a = r.alteracao;
    const ROT = { nome: 'Nome', negocio: 'Negócio', categoria: 'Categoria', alcance: 'Alcance', beneficio: 'Benefício', documento: 'CNPJ', fimVigencia: 'Término', instagram: 'Instagram', whatsapp: 'WhatsApp do negócio' };
    const fmt = (k, v) => {
      if (k === 'documento') return slimclub.fmtDocumento(v);
      if (k === 'fimVigencia') return v ? fmtData(v) : 'Sem prazo';
      if (k === 'alcance') return v === 'nacional' ? 'Nacional (todas as unidades)' : 'Local (só nesta cidade)';
      if (k === 'instagram') return v ? '@' + v : '—';
      if (k === 'whatsapp') return v ? fmtTel(v) : '—';
      return v || '—';
    };
    const linhas = Object.keys(ROT).map(k => {
      const mudou = String(a[k] || '') !== String(r[k] || '');
      return `<dt>${ROT[k]}${mudou ? ' <span class="sc-tag mud">mudou</span>' : ''}</dt><dd>${esc(fmt(k, a[k]))}${mudou ? `<div class="sc-antes">No ar hoje: ${esc(fmt(k, r[k]))}</div>` : ''}</dd>`;
    }).join('');
    const foto = a.fotoNova
      ? `<div class="sc-fotos"><a href="/slimclub/foto/${r.id}" target="_blank" rel="noopener"><img class="sc-av" src="/slimclub/foto/${r.id}" alt="Foto atual" width="64" height="64" loading="lazy"></a><span aria-hidden="true">→</span><a href="/slimclub/foto/${r.id}-nova" target="_blank" rel="noopener"><img class="sc-av" src="/slimclub/foto/${r.id}-nova" alt="Foto nova" width="64" height="64" loading="lazy"></a></div><div class="sc-sub" style="margin-top:4px">Foto nova <span class="sc-tag mud">mudou</span></div>`
      : `<a href="/slimclub/foto/${r.id}" target="_blank" rel="noopener"><img class="sc-av" src="/slimclub/foto/${r.id}" alt="Foto de ${esc(r.nome)}" width="64" height="64" loading="lazy"></a>`;
    const bt = (acao, rot, cls) => `<button type="button" class="${cls}" onclick="scAcao('${r.id}','${acao}')">${rot}</button>`;
    return `<div class="card sc-it">
      <div class="sc-alt">✏️ Alteração de um anúncio que já está no ar · enviada em ${esc(scFmtQuando(a.enviadoEm))}</div>
      <div class="sc-top">
        <div>${foto}</div>
        <div>
          <div class="sc-neg">${esc(a.negocio)}</div>
          <div class="sc-sub">👤 ${esc(a.nome)} · <span style="white-space:nowrap">${esc(fmtTel(r.telefone))}</span> ${r.alunaAgora ? '<span class="sc-tag ok">aluna ativa</span>' : '<span class="sc-tag no">não é aluna ativa</span>'}</div>
        </div>
      </div>
      <dl class="sc-dl">${linhas}</dl>
      <div class="sc-sub">Enquanto você não decide, as alunas continuam vendo a versão que está no ar.</div>
      <div class="acts">${bt('aprovar-alteracao', 'Aprovar alteração', 'save')}${bt('recusar-alteracao', 'Recusar alteração', 'reset')}</div>
    </div>`;
  };

  const itemReclamacao = (c) => {
    const emp = todos.find(r => r.id === c.empresaId);
    const aberta = c.status === 'aberta';
    return `<div class="card sc-it">
      <div class="sc-top"><div>
        <div class="sc-neg">${esc(emp ? emp.negocio : c.empresa)} ${aberta ? '<span class="sc-tag no">em aberto</span>' : '<span class="sc-tag ok">resolvida</span>'}</div>
        <div class="sc-sub">👤 ${esc(c.nome || '—')} · <span style="white-space:nowrap">${esc(fmtTel(c.tel))}</span> · ${esc(scFmtQuando(c.em))}${emp ? '' : ' · empresa já excluída'}</div>
      </div></div>
      <div class="sc-recl">${esc(c.texto)}</div>
      ${!aberta ? `<div class="sc-sub">Resolvida por ${esc(c.tratadaPor || '—')} em ${esc(scFmtQuando(c.tratadaEm))}${c.nota ? ` — ${esc(c.nota)}` : ''}.</div>` : ''}
      <div class="acts">${aberta
        ? `<button type="button" class="save" onclick="scRecl('${c.id}','resolver')">Marcar como resolvida</button>`
        : `<button type="button" class="reset" onclick="scRecl('${c.id}','reabrir')">Reabrir</button>`}</div>
    </div>`;
  };

  let conteudo;
  if (view === 'reclamacoes') {
    conteudo = `<p class="quando" style="margin:0 0 12px">O que as alunas contaram pelo 👎 "Tive um problema". Só a recepção vê; a empresa nunca sabe quem reclamou.</p>`
      + (reclamacoes.length ? reclamacoes.map(itemReclamacao).join('') : '<div class="card" style="text-align:center;color:var(--cinza)">Nenhuma reclamação até agora.</div>');
  } else if (view === 'config') {
    conteudo = `<form class="card" method="POST" action="/clube/config">
      <div class="chead"><h2>Aviso de aprovação no WhatsApp</h2></div>
      <p class="quando">Quando a recepção aprova um cadastro, o robô manda esta mensagem para a empresária.</p>
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" name="avisar" value="1"${cfg.avisar ? ' checked' : ''} style="width:18px;height:18px;accent-color:var(--teal)"> Enviar o aviso ao aprovar</label>
      <label for="scMsg">Mensagem</label>
      <p class="vars">Use: <span class="var">{nome}</span> primeiro nome · <span class="var">{negocio}</span> nome do negócio · <span class="var">{link}</span> link da listagem · <span class="var">{studio}</span> nome do Studio</p>
      <textarea id="scMsg" name="msg" rows="8">${esc(cfg.msgAprovado)}</textarea>
      <div class="acts"><button class="save" type="submit">Salvar</button>
        <button class="reset" type="submit" name="restaurar" value="1" onclick="return confirm('Voltar a mensagem para o texto padrão?')">Restaurar padrão</button></div>
    </form>`;
  } else {
    const lista = por[VIEWS[view]];
    const vazio = { pendentes: 'Nenhum cadastro aguardando validação.', aprovados: 'Nenhum cadastro aprovado ainda.', recusados: 'Nenhum cadastro recusado.', excluidos: 'Nenhum anúncio excluído.' }[view];
    const extra = view === 'pendentes' ? alteracoes.map(itemAlteracao).join('') : '';
    conteudo = (lista.length || extra) ? extra + lista.map(item).join('') : `<div class="card" style="text-align:center;color:var(--cinza)">${vazio}</div>`;
  }

  const corpo = `<div class="wrap">
    <style>
      .sc-link{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--linha-soft)}
      .sc-link:first-of-type{border-top:0}
      .sc-link code{font-size:.82rem;word-break:break-all;color:var(--teal-esc)}
      .sc-top{display:flex;gap:14px;align-items:flex-start}
      .sc-av{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--teal-soft);display:block}
      .sc-neg{font-weight:700;font-size:1.05rem}
      .sc-sub{color:var(--cinza);font-size:var(--fs-sm)}
      .sc-tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:var(--fs-xs);font-weight:700;margin-left:4px}
      .sc-tag.ok{background:#e8f5ec;color:#1a7f37}
      .sc-tag.no{background:var(--erro-bg);color:var(--erro)}
      .sc-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:14px 0 10px;font-size:var(--fs-sm)}
      .sc-dl dt{color:var(--cinza);font-weight:600}
      .sc-dl dd{margin:0;white-space:pre-line;overflow-wrap:anywhere}
      .sc-al{background:var(--avi-bg);border:1px solid var(--avi-bd);color:var(--avi-tx);border-radius:10px;padding:8px 12px;font-size:var(--fs-sm)}
      .sc-okl{color:#1a7f37;font-weight:600;font-size:var(--fs-sm)}
      .sc-rm{color:var(--erro)!important}
      .sc-badge{display:inline-block;min-width:18px;border-radius:999px;background:var(--erro);color:#fff;font-size:var(--fs-xs);font-weight:700;padding:0 6px;margin-left:2px}
      .sc-tag.parc{background:#efe8f8;color:#5b3a8c}
      .sc-av.logo{object-fit:contain;background:#fff;border:1px solid var(--linha)}
      .sc-nums{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:var(--fs-sm)}
      .sc-ruim{color:var(--erro)}
      .sc-cod{margin-top:6px;font-size:var(--fs-sm)}
      .sc-cod b{font-size:1rem;letter-spacing:.12em;font-variant-numeric:tabular-nums}
      .sc-recl{white-space:pre-line;background:var(--erro-bg);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:var(--fs-body)}
      .sc-alt{font-weight:700;font-size:var(--fs-sm);color:var(--avi-tx);background:var(--avi-bg);border:1px solid var(--avi-bd);border-radius:8px;padding:6px 10px;margin:0 0 12px}
      .sc-tag.mud{background:var(--avi-bg);color:var(--avi-tx);margin-left:2px}
      .sc-antes{color:var(--cinza);text-decoration:line-through;font-size:var(--fs-xs);margin-top:2px}
      .sc-fotos{display:flex;align-items:center;gap:6px;color:var(--cinza)}
      @media(max-width:560px){.sc-dl{grid-template-columns:1fr}.sc-dl dd{margin-bottom:6px}.sc-link{flex-direction:column;align-items:flex-start}}
    </style>
    ${subtabs}
    ${uiTopo({ titulo: 'Slim Club', sub: 'Benefícios de alunas para alunas: valide cadastros e alterações, acompanhe recomendações e reclamações e configure o clube.' })}
    ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
    ${view === 'pendentes' ? links : ''}
    ${conteudo}
  </div>
  <script>
  function scAcao(id, acao){
    var motivo='';
    if(acao==='recusar'||acao==='recusar-alteracao'){ motivo=prompt('Motivo da recusa (opcional). A aluna vê este motivo em "Meu anúncio":',''); if(motivo===null) return; }
    if(acao==='excluir' && !confirm('Excluir este anúncio? Ele sai da listagem das alunas, o código de conferência para de valer e ele vai para a aba Excluídos.')) return;
    if(acao==='apagar' && !confirm('Apagar de vez este cadastro e a foto? Não dá para desfazer.')) return;
    if(acao==='novo-codigo' && !confirm('Gerar outro código? O código atual para de funcionar e os celulares conectados com ele precisam digitar o novo.')) return;
    fetch('/clube/acao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,acao:acao,motivo:motivo})})
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui concluir.')); return; }
        if(j.aviso && !j.aviso.ok) alert('Cadastro atualizado, mas o aviso no WhatsApp não saiu: '+(j.aviso.erro||'erro'));
        if(j.codigo) alert('Novo código de conferência: '+j.codigo+'\\nPasse para a empresa (ou use "Reenviar aviso").');
        location.reload();
      })
      .catch(function(){ alert('❌ Erro de rede.'); });
  }
  function scRecl(id, acao){
    var nota='';
    if(acao==='resolver'){ nota=prompt('O que foi feito? (opcional, fica registrado aqui)',''); if(nota===null) return; }
    fetch('/clube/reclamacao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,acao:acao,nota:nota})})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j||!j.ok){ alert('❌ '+((j&&j.erro)||'Não consegui concluir.')); return; } location.reload(); })
      .catch(function(){ alert('❌ Erro de rede.'); });
  }
  function scCopiar(t,b){
    var ok=function(){ b.textContent='Copiado!'; setTimeout(function(){ b.textContent='Copiar'; },1500); };
    if(navigator.clipboard) navigator.clipboard.writeText(t).then(ok,function(){ prompt('Copie o link:',t); });
    else prompt('Copie o link:',t);
  }
  </script>`;
  return chrome({ tab: 'Slim Club', h1: 'Slim Club', p: 'Validação dos negócios das alunas.' }, 'slimclub', corpo);
}

module.exports = {
  scSetCookie, scFmtQuando, rotaSlimClubCadastro, rotaSlimClubPublico, scAvisarAprovado, scStatusAviso, paginaSlimClub,
};

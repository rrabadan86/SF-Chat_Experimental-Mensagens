/**
 * painel-perfis.js — tela de Perfis (usuários e acessos).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const path = require('path');
const usuarios = require('./usuarios');
const acessos = require('./acessos');
const auditoria = require('./auditoria');
const E = require('./painel-estado');
const {
  esc, USER, ADMIN_EMAIL, uiTopo, chrome, IG_NO_PAINEL, fmtTel,
} = require('./painel-base');

// Duração da sessão do painel, em DIAS. Editável SÓ pelo admin (Perfis → Acessos),
// guardada em data/painel-sessao-dias.txt. Sem o arquivo, usa o .env
// (PAINEL_SESSAO_DIAS) ou 7 dias. Limitada a 1–90 dias. Vale para os PRÓXIMOS logins.
const SESSAO_DIAS_FILE = path.join(__dirname, '..', 'data', 'painel-sessao-dias.txt');
const SESSAO_DIAS_DEFAULT = Math.min(90, Math.max(1, parseInt(process.env.PAINEL_SESSAO_DIAS || '7', 10) || 7));
function lerSessaoDias() {
  try { const n = parseInt(require('fs').readFileSync(SESSAO_DIAS_FILE, 'utf8').trim(), 10); if (n >= 1 && n <= 90) return n; } catch (_) {}
  return SESSAO_DIAS_DEFAULT;
}

// Aba "Perfis" (só admin): cria usuários, define telas, senha e exclui.
// Sub-abas de Perfis (igual à subnav da SoFIA): Usuários · Acessos · Auditoria.
const PERFIS_SUBS = ['usuarios', 'acessos', 'auditoria'];
function subnavPerfis(view) {
  const item = (v, rot) => `<a href="/perfis${v === 'usuarios' ? '' : '?view=' + v}"${view === v ? ' class="on"' : ''}>${rot}</a>`;
  return `<div class="subtabs">${item('usuarios', 'Usuários')}${item('acessos', 'Acessos')}${item('auditoria', 'Auditoria')}</div>`;
}
// ── Auditoria: filtros, rótulos e exportação ────────────────────────────────
// Área = o começo do código da ação ("campanha.criar" → "campanha").
const AREAS_AUD = { campanha: 'Campanhas', sofia: 'SoFIA (configuração)', conversa: 'Conversas', contato: 'Contatos', perfil: 'Perfis e acessos', pagamento: 'Pagamento', slimclub: 'Slim Club', formularios: 'Formulários', robo: 'Robô / WhatsApp', log: 'Log de envios', evo: 'EVO', express: 'Cadastro Express', ativas: 'Alunas ativas', professoras: 'Professoras', audio: 'Áudios', aniversario: 'Aniversários', sentimos: 'Sentimos sua falta', saidas: 'Saídas de grupo', renovacao: 'Renovação', free: 'Antecedência do Free', grade: 'Grade', mensagem: 'Mensagens', app: 'Bloqueio do app', assinaturas: 'Contrato sem assinatura' };
const areaDe = (acao) => String(acao || '').split('.')[0];
const ROT_ACAO_EXTRA = {
  'mensagem.fotos.exportar': '⬇️ Baixou as imagens das mensagens', 'mensagem.fotos.importar': '⬆️ Importou imagens das mensagens',
  'assinaturas.excluir': '🚫 Marcou aluna para não receber o lembrete de assinatura', 'assinaturas.voltar': '↩️ Voltou a enviar o lembrete de assinatura', 'assinaturas.ler': '🔄 Leu no EVO os contratos sem assinatura',
  'app.bloquear': '📵 Robô excluiu o login do app (inadimplência)', 'app.reativar': '✅ Robô recriou o login do app', 'app.bloqueio.config': '⚙️ Mudou o bloqueio do app', 'app.excecao': '🛡️ Marcou aluna para não bloquear o app', 'app.excecao.remover': '↩️ Tirou aluna das exceções do app', 'app.esquecer': '➖ Tirou aluna da lista de bloqueio do app',
  'aniversario.excluir': '🎂 Mudou os grupos que não recebem o aniversário', 'ativas.atualizar': '🔄 Atualizou as alunas ativas no EVO',
  'ativas.resumo.salvar': '⚙️ Mudou o resumo mensal', 'ativas.resumo.enviar': '📤 Enviou o resumo mensal', 'ativas.resumo-semana.salvar': '⚙️ Mudou o resumo semanal', 'ativas.resumo-semana.enviar': '📤 Enviou o resumo semanal',
  'audio.salvar': '🎙️ Salvou áudio de professora', 'audio.remover': '🗑️ Removeu áudio de professora',
  'campanha.iniciar': '▶️ Iniciou campanha', 'campanha.pausar': '⏸️ Pausou campanha', 'campanha.cancelar': '🚫 Cancelou campanha', 'campanha.reenviar': '🔁 Reenviou campanha para um número', 'campanha.remover-fila': '➖ Tirou número da fila da campanha', 'campanha.variacao-excluir': '🗑️ Excluiu variação da campanha',
  'contato.excluir-lote': '🗑️ Excluiu contatos em lote', 'evo.2fa': '🔐 Digitou o código do EVO (2FA)', 'evo.credenciais': '🔑 Mudou o login do EVO',
  'express.circuito-servico': '⚙️ Mudou o serviço do Circuito (Express)', 'free.config': '⚙️ Mudou a antecedência do Free',
  'formularios.apagar-resposta': '🗑️ Apagou resposta de formulário', 'formularios.duplicar': '📄 Duplicou formulário', 'formularios.etiquetar': '🏷️ Etiquetou respostas de formulário', 'formularios.excluir': '🗑️ Excluiu formulário', 'formularios.exportar': '⬇️ Exportou respostas de formulário', 'formularios.zerar-acessos': '🔄 Zerou acessos de formulário',
  'log.reenviar': '🔁 Reenviou mensagem pelo Log', 'log.rodar-job': '▶️ Rodou um envio na hora',
  'pagamento.excluir': '✕ Excluiu aluna do pagamento', 'pagamento.inserir': '＋ Incluiu aluna numa aula (pagamento)', 'pagamento.desfazer': '↩️ Desfez ajuste do pagamento', 'pagamento.oculto': '👁️ Mostrou/ocultou horário no pagamento',
  'pagamento.importar': '📥 Importou percentuais', 'pagamento.professor': '⚙️ Mudou percentual de professor', 'pagamento.professor.remover': '🗑️ Removeu vigência de professor', 'pagamento.regras': '⚙️ Mudou regras do pagamento', 'pagamento.sync': '🔄 Pediu leitura do EVO (pagamento)',
  'professoras.desde': '⚙️ Mudou o início dos indicadores de professoras', 'professoras.ler-evo': '🔄 Pediu leitura do EVO (professoras)',
  'renovacao.dias': '⚙️ Mudou os dias da renovação', 'robo.parear': '📱 Pareou o WhatsApp do robô', 'saidas.dias': '⚙️ Mudou as saídas de grupo', 'saidas.simular': '🧪 Simulou as saídas de grupo',
  'sentimos.cfg': '⚙️ Mudou o "Sentimos sua falta"', 'sentimos.simular': '🧪 Simulou o "Sentimos sua falta"',
  'sofia.apikey': '🔑 Mudou a chave da IA', 'sofia.transcricaokey': '🔑 Mudou a chave de transcrição', 'sofia.autotagalunas': '🏷️ Mudou a etiqueta automática de alunas', 'sofia.autotag.rodar': '▶️ Rodou a etiqueta automática de alunas', 'sofia.historico-tags': '👋 Mudou as etiquetas de ex-aluna / fez experimental', 'sofia.parear': '📱 Pareou o WhatsApp da SoFIA', 'sofia.prompt-importar': '📥 Importou o prompt da SoFIA',
  'slimclub.reclamacao-resolver': '✅ Resolveu reclamação do Slim Club', 'slimclub.reclamacao-reabrir': '↩️ Reabriu reclamação do Slim Club',
};
const ROT_ACAO = Object.assign({}, ROT_ACAO_EXTRA, {
    'campanha.criar': '📣 Criou campanha', 'campanha.iniciar': '▶️ Iniciou campanha', 'campanha.retomar': '▶️ Retomou campanha',
    'campanha.pausar': '⏸️ Pausou campanha', 'campanha.cancelar': '🚫 Cancelou campanha', 'campanha.excluir': '🗑️ Excluiu campanha', 'campanha.enviar-agora': '🚀 Enviou agora (campanha)', 'campanha.ritmo': '⚙️ Ajustou ritmo da campanha',
    'conversa.assumir': '🧑 Assumiu conversa', 'conversa.devolver': '🤖 Devolveu à SoFIA', 'conversa.encerrar': '🔒 Encerrou conversa', 'conversa.agendar': '📅 Agendou no EVO',
    'contato.bloquear': '🚫 Bloqueou contato', 'contato.desbloquear': '✅ Desbloqueou contato',
    'sofia.ligar': '▶️ Ligou a SoFIA', 'sofia.pausar': '⏸️ Pausou a SoFIA', 'sofia.reiniciar': '🔄 Reiniciou a SoFIA',
    'sofia.desconectar': '📴 Desconectou WhatsApp da SoFIA', 'sofia.config': '⚙️ Salvou configuração/prompt', 'sofia.nao-responder': '🔕 Atualizou "não responder"', 'sofia.alunas': '🎓 Atualizou regras das alunas', 'sofia.prompt-download': '⬇️ Baixou o prompt',
    'robo.reiniciar': '🔄 Reiniciou o robô', 'robo.desconectar': '📴 Desconectou WhatsApp do robô',
    'perfil.criar': '👤 Criou usuário', 'perfil.excluir': '🗑️ Excluiu usuário', 'perfil.telas': '🔑 Mudou telas de acesso',
    'perfil.senha': '🔑 Redefiniu senha', 'perfil.email': '📧 Alterou e-mail', 'perfil.admin': '👑 Mudou administrador',
    'perfil.sessao': '⏲️ Mudou duração da sessão', 'perfil.sessao-encerrar': '🚪 Encerrou uma sessão',
    'slimclub.aprovar': '🤝 Aprovou cadastro do Slim Club', 'slimclub.recusar': '🚫 Recusou cadastro do Slim Club', 'slimclub.pendente': '↩️ Voltou cadastro do Slim Club para pendente',
    'slimclub.excluir': '🗑️ Excluiu cadastro do Slim Club', 'slimclub.apagar': '🧹 Apagou de vez cadastro excluído do Slim Club', 'slimclub.excluir-dona': '🗑️ Aluna excluiu o próprio anúncio do Slim Club',
    'slimclub.aprovar-alteracao': '✏️ Aprovou alteração no Slim Club', 'slimclub.recusar-alteracao': '🚫 Recusou alteração no Slim Club',
    'slimclub.parceira-nova': '🤝 Cadastrou empresa parceira no Slim Club', 'slimclub.parceira-editar': '✏️ Editou empresa parceira no Slim Club',
    'slimclub.novo-codigo': '🔑 Gerou outro código de conferência do Slim Club',
    'slimclub.reclamacao-resolver': '✅ Resolveu reclamação do Slim Club', 'slimclub.reclamacao-reabrir': '↩️ Reabriu reclamação do Slim Club', 'slimclub.config': '⚙️ Mudou o aviso do Slim Club',
});
const rotuloGenerico = (acao) => { const a = areaDe(acao); return (AREAS_AUD[a] ? AREAS_AUD[a] + ': ' : '') + String(acao || '').split('.').slice(1).join(' ').replace(/-/g, ' '); };
const normAud = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function filtroAudNorm(f) {
  const d = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  return { u: String(f.u || '').trim(), area: String(f.area || '').trim(), q: String(f.q || '').trim().slice(0, 100), de: d(f.de), ate: d(f.ate) };
}
function filtrarAuditoria(logs, fa) {
  const diaSP = (ts) => { try { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  const q = normAud(fa.q);
  return logs.filter(l => (!fa.u || l.usuario === fa.u) && (!fa.area || areaDe(l.acao) === fa.area)
    && (!fa.de || diaSP(l.em) >= fa.de) && (!fa.ate || diaSP(l.em) <= fa.ate)
    && (!q || normAud(`${l.usuario} ${l.acao} ${l.alvo} ${l.detalhe}`).includes(q)));
}
function formFiltroAuditoria(todos, fa, nFiltrados, nMostrados) {
  const usuariosAud = [...new Set(todos.map(l => l.usuario))].sort();
  const areas = [...new Set(todos.map(l => areaDe(l.acao)))].sort((a, b) => String(AREAS_AUD[a] || a).localeCompare(AREAS_AUD[b] || b));
  const qs = new URLSearchParams(Object.assign({ view: 'auditoria' }, Object.fromEntries(Object.entries(fa).filter(([, v]) => v)))).toString();
  return `<form method="GET" action="/perfis" class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0 0 12px">
    <input type="hidden" name="view" value="auditoria">
    <div><label style="margin:0 0 3px;font-size:.72rem">Quem</label><select name="u"><option value="">Todos</option>${usuariosAud.map(u => `<option value="${esc(u)}"${u === fa.u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></div>
    <div><label style="margin:0 0 3px;font-size:.72rem">Área</label><select name="area"><option value="">Todas</option>${areas.map(a => `<option value="${esc(a)}"${a === fa.area ? ' selected' : ''}>${esc(AREAS_AUD[a] || a)}</option>`).join('')}</select></div>
    <div><label style="margin:0 0 3px;font-size:.72rem">De</label><input type="date" name="de" value="${esc(fa.de)}"></div>
    <div><label style="margin:0 0 3px;font-size:.72rem">Até</label><input type="date" name="ate" value="${esc(fa.ate)}"></div>
    <div style="flex:1;min-width:160px"><label style="margin:0 0 3px;font-size:.72rem">Buscar</label><input type="text" name="q" value="${esc(fa.q)}" placeholder="nome, telefone, campanha…"></div>
    <button type="submit" class="save" style="padding:8px 14px">Filtrar</button>
    ${(fa.u || fa.area || fa.q || fa.de || fa.ate) ? '<a class="reset" href="/perfis?view=auditoria" style="padding:8px 12px">Limpar</a>' : ''}
    <a class="reset" href="/perfis/auditoria.csv?${esc(qs)}" style="padding:8px 12px">⬇️ Exportar CSV</a>
  </form>
  <p class="quando" style="margin:0 0 10px">${nFiltrados} registro(s)${nFiltrados > nMostrados ? ` — mostrando os ${nMostrados} mais recentes (o CSV leva todos)` : ''} · de ${todos.length} guardados (o painel mantém as ~2.000 ações mais recentes).</p>`;
}
// CSV (separador ";" e BOM — abre direto no Excel em português).
function auditoriaCsv(filtro) {
  let todos = []; try { todos = auditoria.ler(5000); } catch (_) {}
  const linhas = filtrarAuditoria(todos, filtroAudNorm(filtro || {}));
  const cel = (v) => { const t = String(v == null ? '' : v); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const quando = (ts) => { try { return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  const rot = (a) => ROT_ACAO[a] || rotuloGenerico(a);
  return '\ufeff' + ['Quando;Usuário;Ação;Código da ação;Sobre;Detalhe'].concat(linhas.map(l => [quando(l.em), l.usuario, rot(l.acao), l.acao, l.alvo, l.detalhe].map(cel).join(';'))).join('\r\n');
}

function paginaPerfis(aviso, erro, view, filtroAud = {}) {
  view = PERFIS_SUBS.includes(view) ? view : 'usuarios';
  const lista = usuarios.listar();
  let ults = {}; try { ults = acessos.ultimosAcessos(); } catch (_) {}          // { usuario: ts }
  let logsAudTodos = []; try { logsAudTodos = auditoria.ler(5000); } catch (_) {}  // registro de atividades (recente→antigo) — tudo o que está guardado
  const fa = filtroAudNorm(filtroAud);
  const logsAudFiltrados = filtrarAuditoria(logsAudTodos, fa);
  const logsAud = logsAudFiltrados.slice(0, 300);
  const sessDias = lerSessaoDias();                                             // duração da sessão (dias), editável só aqui
  const meuSid = (E._navSess && E._navSess.sid) || '';                              // a sessão de quem está vendo esta página
  const uaCurto = (ua) => { ua = String(ua || ''); const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''; const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; const mob = /Mobile|Android|iPhone|iPad|iPod/.test(ua) ? '📱' : '💻'; const txt = [nav, so].filter(Boolean).join(' · '); return mob + ' ' + (txt || 'desconhecido'); };
  let sessArr = [];
  try { const corte = Date.now() - sessDias * 864e5; sessArr = Object.keys(E._sessoes).map(sid => Object.assign({ sid }, E._sessoes[sid] || {})).filter(s => !s.revogadoEm && (s.criadoEm || 0) >= corte); } catch (_) {}
  sessArr.sort((a, b) => (b.ultimoEm || 0) - (a.ultimoEm || 0));
  const fmtAcesso = (ts) => { if (!ts) return ''; try { return new Date(Number(ts)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return '—'; } };
  const seloAcesso = (usuario) => { const ts = ults[usuario]; return `<span class="quando" style="margin:0">· ${ts ? '🕘 ' + fmtAcesso(ts) : 'nunca acessou'}</span>`; };
  const umChk = (t, marcadas, prefixo) => `<label style="display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:600;font-size:var(--fs-sm);cursor:pointer;white-space:nowrap"><input type="checkbox" name="${prefixo}" value="${t.key}"${(marcadas || []).includes(t.key) ? ' checked' : ''} style="width:15px;height:15px;margin:0"> ${t.rot}</label>`;
  const chkTelas = (marcadas, prefixo) => {
    marcadas = (marcadas || []);
    // Compat: quem tinha a permissão antiga "msg_agendar" já aparece com a tela unificada marcada.
    if (marcadas.includes('msg_agendar') && !marcadas.includes('msg_express')) marcadas = marcadas.concat('msg_express');
    const soltas = usuarios.TELAS.filter(t => !t.grupo && (t.key !== 'ig' || IG_NO_PAINEL)); // Instagram escondido → sem a opção
    const grupos = {};
    for (const t of usuarios.TELAS) if (t.grupo) (grupos[t.grupo] = grupos[t.grupo] || []).push(t);
    const linha = `<div style="display:flex;flex-wrap:wrap;gap:6px 18px">${soltas.map(t => umChk(t, marcadas, prefixo)).join('')}</div>`;
    const gs = Object.keys(grupos).map(g => `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin-top:7px"><span style="font-weight:700;font-size:var(--fs-xs);color:var(--teal-esc);min-width:84px">${g}</span>${grupos[g].map(t => umChk(t, marcadas, prefixo)).join('')}</div>`).join('');
    return linha + gs;
  };

  const cardsUsuarios = lista.length ? lista.map(u => `
    <details class="card" style="margin-bottom:8px">
      <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0;user-select:none">
        <span style="font-weight:700;font-size:var(--fs-h2)">${esc(u.usuario)}</span>
        ${u.admin ? '<span style="background:var(--warn-bg);color:#8a6300;border:1px solid #f0d9a8;border-radius:999px;padding:1px 9px;font-size:.68rem;font-weight:700">👑 admin</span>' : ''}
        ${u.email ? `<span class="quando" style="margin:0">📧 ${esc(u.email)}</span>` : '<span class="quando" style="margin:0;color:var(--faint)">sem e-mail</span>'}
        <span class="quando" style="margin:0">· ${u.admin ? 'vê todas as telas' : (u.telas || []).length + ' tela(s)'}</span>
        ${seloAcesso(u.usuario)}
        <span class="u-caret" style="margin-left:auto;color:var(--faint);font-size:.9rem">▸</span>
      </summary>
      <div style="display:flex;gap:8px;align-items:flex-end;margin:12px 0 0">
        <div style="flex:1;min-width:180px"><label style="margin:0 0 4px">E-mail (login com Google)</label>
          <input type="email" name="email" value="${esc(u.email || '')}" autocapitalize="none" spellcheck="false" placeholder="email@gmail.com" form="em-${esc(u.usuario)}"></div>
        <button type="submit" class="reset" form="em-${esc(u.usuario)}" style="padding:6px 13px">Salvar e-mail</button>
      </div>
      <form method="POST" action="/perfis/email" id="em-${esc(u.usuario)}" style="display:none"><input type="hidden" name="usuario" value="${esc(u.usuario)}"></form>
      <form method="POST" action="/perfis/telas" style="margin-top:12px">
        <input type="hidden" name="usuario" value="${esc(u.usuario)}">
        <label style="display:inline-flex;align-items:center;gap:8px;font-weight:700;margin:0 0 10px;cursor:pointer"><input type="checkbox" name="admin" value="1"${u.admin ? ' checked' : ''} onchange="perfAdminTgl(this)" style="width:16px;height:16px;margin:0"> 👑 Administrador <small style="font-weight:400;color:var(--cinza)">— vê tudo e gerencia usuários</small></label>
        <div class="perf-telas" style="margin:0 0 10px${u.admin ? ';display:none' : ''}">${chkTelas(u.telas, 'telas')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding-top:10px;border-top:1px dashed var(--linha)">
          <button type="submit" class="save" style="padding:6px 13px">Salvar telas</button>
          <input type="text" name="senha" placeholder="nova senha" style="width:140px" form="sn-${esc(u.usuario)}">
          <button type="submit" class="reset" form="sn-${esc(u.usuario)}" style="padding:6px 13px">Redefinir senha</button>
          <button type="submit" class="reset" formaction="/perfis/excluir" onclick="return confirm('Excluir o usuário ${esc(u.usuario)}?')" style="padding:6px 13px;margin-left:auto">Excluir</button>
        </div>
      </form>
      <form method="POST" action="/perfis/senha" id="sn-${esc(u.usuario)}" style="display:none"><input type="hidden" name="usuario" value="${esc(u.usuario)}"></form>
    </details>`).join('') : '<p class="vazio">Nenhum usuário criado ainda. Crie o primeiro abaixo.</p>';

  // Rótulos amigáveis das ações auditadas (código estável → texto com ícone).
  const rotAcao = ROT_ACAO;
  const fmtAlvo = (acao, alvo) => { const d = String(alvo || '').replace(/\D/g, ''); return (/^conversa\.|^contato\./.test(acao) && d.length >= 10) ? fmtTel(alvo) : alvo; };
  const auditoriaLinhas = logsAud.map(l => `<tr style="border-bottom:1px solid var(--linha)">
    <td style="padding:7px 10px;white-space:nowrap;font-variant-numeric:tabular-nums">${fmtAcesso(l.em)}</td>
    <td style="padding:7px 10px;font-weight:600;white-space:nowrap">${esc(l.usuario)}</td>
    <td style="padding:7px 10px">${esc(rotAcao[l.acao] || rotuloGenerico(l.acao))}</td>
    <td style="padding:7px 10px;color:var(--cinza)">${esc(fmtAlvo(l.acao, l.alvo))}${l.detalhe ? ` <span style="color:var(--faint)">· ${esc(l.detalhe)}</span>` : ''}</td>
  </tr>`).join('');

  // ── Sub-aba: Usuários (criar + lista) ──
  const secUsuarios = `
    <div class="sec-t">Novo usuário</div>
    <div class="card">
      <form method="POST" action="/perfis/criar">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px"><label>Usuário</label><input type="text" name="usuario" autocapitalize="none" spellcheck="false" placeholder="ex.: recepcao"></div>
          <div style="flex:1;min-width:160px"><label>Senha</label><input type="text" name="senha" placeholder="senha inicial"></div>
        </div>
        <label style="margin-top:12px">E-mail <small style="font-weight:400;color:var(--cinza)">— opcional, para o login com Google (só quem tem e-mail aqui entra pelo Google)</small></label>
        <input type="email" name="email" autocapitalize="none" spellcheck="false" placeholder="email@gmail.com">
        <label style="display:inline-flex;align-items:center;gap:8px;font-weight:700;margin:14px 0 8px;cursor:pointer"><input type="checkbox" name="admin" value="1" onchange="perfAdminTgl(this)" style="width:16px;height:16px;margin:0"> 👑 Administrador <small style="font-weight:400;color:var(--cinza)">— vê tudo e gerencia usuários (igual ao admin do sistema)</small></label>
        <div class="perf-telas"><label style="margin:0">Telas que este usuário pode acessar</label>
        <div style="margin:4px 0 2px">${chkTelas([], 'telas')}</div></div>
        <div class="acts"><button type="submit" class="save">Criar usuário</button></div>
        <p class="quando" style="margin:8px 0 0">O usuário entra com esse login e senha na hora — sem reiniciar. A senha pode ser trocada depois aqui mesmo.</p>
      </form>
    </div>
    <script>function perfAdminTgl(cb){var f=cb.closest('form');if(!f)return;var t=f.querySelector('.perf-telas');if(t)t.style.display=cb.checked?'none':'';}</script>

    <div class="sec-t">Usuários</div>
    <div class="card" style="background:#f3fbfb;border-color:#bfe8e7"><p class="quando" style="margin:0">🔑 <b>Admin</b> (do sistema): <b>${esc(USER)}</b>${ADMIN_EMAIL ? ` · 📧 ${esc(ADMIN_EMAIL)}` : ''} ${ults[USER] ? `· 🕘 ${fmtAcesso(ults[USER])}` : ''} — vê todas as telas e gerencia os Perfis. A senha do admin fica em <code>PAINEL_SENHA</code> e o e-mail do login com Google em <code>PAINEL_ADMIN_EMAIL</code>, no <code>.env</code>.</p></div>
    ${cardsUsuarios}`;

  // ── Sub-aba: Acessos (último acesso + logins) ──
  const secAcessos = `
    <div class="sec-t">Duração da sessão</div>
    <form class="card" method="POST" action="/perfis/sessao" style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">
      <div style="flex:1 1 260px;min-width:0">
        <label style="margin:0;display:block;font-weight:700;font-size:.9rem">Por quantos dias a sessão dura</label>
        <p class="quando" style="margin:4px 0 0">Depois desse tempo (a partir do login), a pessoa precisa <b>entrar de novo</b>. Vale só para os <b>próximos logins</b> — quem já está logado mantém a sessão atual. Só o admin edita.</p>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" name="dias" min="1" max="90" step="1" value="${sessDias}" required style="width:90px;font-size:.9rem;padding:8px 9px;border:1px solid var(--linha);border-radius:8px;background:#fff;color:var(--tinta)">
        <span class="quando" style="margin:0">dias</span>
      </div>
      <button type="submit" class="save" style="padding:9px 18px">Salvar</button>
    </form>
    <div class="sec-t">Sessões ativas <small style="font-weight:600;color:var(--cinza)">— quem está logado agora</small></div>
    <div class="card">
      <p class="quando" style="margin:0 0 12px">Cada linha é um <b>login ativo</b> (um navegador/aparelho). O admin pode <b>Encerrar</b> qualquer sessão — a pessoa é <b>deslogada</b> e precisa entrar de novo. A <b>sua sessão atual</b> aparece destacada. Some daqui sozinho ao expirar (${sessDias} dia${sessDias === 1 ? '' : 's'}) ou no logout.</p>
      ${sessArr.length ? `<div style="overflow-x:auto"><table class="ui-tab">
        <thead><tr>
          <th>Usuário</th>
          <th>Entrou</th>
          <th>Último uso</th>
          <th>Como</th>
          <th>Dispositivo</th>
          <th style="font-weight:700;text-align:right">Ação</th>
        </tr></thead>
        <tbody>${sessArr.map(s => { const eu = (s.sid === meuSid); return `<tr${eu ? ' style="background:var(--teal-soft)"' : ''}>
          <td style="font-weight:600">${esc(s.usuario || '—')}${eu ? ' <span style="background:#e6f6ec;color:#1f8f52;border-radius:999px;padding:1px 8px;font-size:.66rem;font-weight:700">você</span>' : ''}</td>
          <td style="font-variant-numeric:tabular-nums">${fmtAcesso(s.criadoEm)}</td>
          <td style="font-variant-numeric:tabular-nums">${fmtAcesso(s.ultimoEm)}</td>
          <td>${s.metodo === 'google' ? '🟢 Google' : '🔑 Senha'}</td>
          <td>${esc(uaCurto(s.ua))}</td>
          <td style="text-align:right">${eu
            ? `<a href="/logout" class="reset" style="padding:5px 12px;text-decoration:none;white-space:nowrap;color:#c0392b">Sair</a>`
            : `<form method="POST" action="/perfis/sessao-encerrar" style="display:inline" onsubmit="return confirm('Encerrar a sessão de ${esc(s.usuario || 'usuário')}? A pessoa vai precisar entrar de novo.')"><input type="hidden" name="sid" value="${esc(s.sid)}"><button type="submit" class="reset" style="padding:5px 12px;white-space:nowrap;color:#c0392b">Encerrar</button></form>`}</td>
        </tr>`; }).join('')}</tbody>
      </table></div>` : '<p class="vazio" style="margin:0">Nenhuma sessão ativa registrada. Assim que alguém entrar (senha ou Google), aparece aqui. <small>(Quem já estava logado antes desta atualização aparece só depois de entrar de novo.)</small></p>'}
    </div>`;

  // ── Sub-aba: Auditoria (quem fez o quê) ──
  const secAuditoria = `
    <div class="sec-t">📜 Auditoria <small style="font-weight:600;color:var(--cinza)">— quem fez o quê</small></div>
    <div class="card">
      <p class="quando" style="margin:0 0 12px">Registro das ações de <b>impacto e segurança</b>: campanhas (criar/iniciar/pausar/cancelar/excluir), configuração/prompt da SoFIA, gestão de usuários, bloqueio/encerramento de conversa e reiniciar/desconectar. Mostra os 150 mais recentes.</p>
      ${formFiltroAuditoria(logsAudTodos, fa, logsAudFiltrados.length, logsAud.length)}
      ${logsAud.length ? `<div style="overflow-x:auto"><table class="ui-tab">
        <thead><tr>
          <th>Quando</th>
          <th>Usuário</th>
          <th>Ação</th>
          <th>Sobre</th>
        </tr></thead>
        <tbody>${auditoriaLinhas}</tbody>
      </table></div>` : '<p class="vazio" style="margin:0">Nenhuma atividade registrada ainda. Assim que alguém criar/iniciar/pausar uma campanha, mudar o prompt, etc., aparece aqui.</p>'}
    </div>`;

  const corpo = `<div class="wrap">
    ${aviso ? `<div class="aviso${erro ? ' err' : ''}">${esc(aviso)}</div>` : ''}
    ${subnavPerfis(view)}
    ${uiTopo({ titulo: 'Perfis e acessos', sub: view === 'acessos' ? 'Quem está logado agora e o histórico de entradas no painel. Encerre qualquer sessão por aqui.' : view === 'auditoria' ? 'Quem fez o quê no painel (salvou, excluiu, exportou…).' : 'Crie usuários, defina a senha ou o login pelo Google e escolha quais telas cada um pode ver.' })}
    ${view === 'acessos' ? secAcessos : view === 'auditoria' ? secAuditoria : secUsuarios}
  </div>`;
  return chrome({ tab: 'Perfis', h1: 'Perfis', p: 'Crie usuários e escolha quais telas cada um pode acessar.' }, 'perfis', corpo);
}

module.exports = {
  auditoriaCsv,
  SESSAO_DIAS_FILE, SESSAO_DIAS_DEFAULT, lerSessaoDias, PERFIS_SUBS, subnavPerfis, paginaPerfis,
};

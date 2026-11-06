/**
 * painel-automacao.js — automações em segundo plano do painel (tags por gatilho, follow-ups, eventos da SoFIA, Cadastro Express).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const fs = require('fs');
const path = require('path');
const atividade = require('./atividade');
const sofia = require('./sofia-editor');
const contatos = require('./contatos');
const E = require('./painel-estado');
const {
  fuLerJson, FU_AGENDOU_CANAL_FILE, FU_AGENDOU_AULA_FILE, lerCompCfg,
} = require('./painel-base');

// ── Automação por tag (gatilho → aplica tag + avisa no WhatsApp) ─────────────
// Gatilhos detectados AQUI (painel): 'agendou' (sofia-agendou.jsonl, escrito pela
// SoFIA) e 'humano' (rota /sofia/humano). Os demais ('novo', 'palavra', 'campanha',
// 'encerrou') são detectados pelo LISTENER, que lê as regras em sofia-regras.json
// (publicadas aqui) e devolve as ações em sofia-eventos.jsonl (consumidas aqui).
function fmtTelAviso(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) { const ddd = d.slice(2, 4), x = d.slice(4); return '+55 (' + ddd + ') ' + (x.length === 9 ? x.slice(0, 5) + '-' + x.slice(5) : x.slice(0, 4) + '-' + x.slice(4)); }
  return t || '';
}
const AUTO_ROTULO = {
  agendou: '🎉 Nova aula experimental agendada!',
  novo: '🆕 Nova aluna falou com a SoFIA',
  mensagem: '💬 Contato mandou mensagem',
  palavra: '🔑 Palavra-chave detectada — pode precisar de atendimento',
  ia: '🧠 Intenção detectada pela SoFIA',
  humano: '🙋 Conversa assumida por atendente',
  encerrou: '🔒 Atendimento encerrado sem agendamento',
  campanha: '💬 Aluna respondeu a uma campanha',
};
// A conversa está EM ANDAMENTO agora? (a lead escreveu há menos que a janela de
// sessão). Uma automação NUNCA deve force-fechar (🔒) uma conversa viva: o
// encerramento legítimo por tempo ('encerrou') só ocorre depois da janela inteira
// sem mensagem da lead, então ele nunca cai neste guarda; já um classificador por
// IA que marque "Encerrado sem agendamento" no meio de um atendimento (a lead
// acabou de escrever) é barrado aqui — antes derrubava a conversa e resetava a
// memória da SoFIA. Casa a chave pelos últimos 8 dígitos (variações do 9º dígito).
function _conversaEmAndamento(tel) {
  try {
    const alvo = String(tel || '').replace(/\D/g, '').slice(-8);
    if (!alvo) return false;
    let janelaMs = 12 * 3600 * 1000;
    try { const h = Number(sofia.lerSessaoHoras()); if (Number.isFinite(h) && h > 0) janelaMs = h * 3600 * 1000; } catch (_) {}
    const convs = sofia.conversas();
    for (const k of Object.keys(convs)) {
      if (String(k).replace(/\D/g, '').slice(-8) !== alvo) continue;
      const ua = Number(sofia.ultimaAlunaEm(convs[k])) || 0;
      if (ua && (Date.now() - ua) < janelaMs) return true;
    }
  } catch (_) {}
  return false;
}
// Aplica UMA tag a um contato e (se configurado) enfileira o aviso por WhatsApp.
function aplicarAutomacao({ telefone, nome, tag, avisarWpp, motivo, extra, canal }) {
  const tel = String(telefone || '').replace(/\D/g, '');
  if (!tel || !tag) return;
  // Gatilho 'novo' (lead novo → "Contato inicial"): se a pessoa JÁ está no CRM
  // — ex.: aluna cadastrada pela planilha de aniversários, casando pelo 9º dígito —
  // ela NÃO é um lead novo. Não marca "Contato inicial" nem avisa. Corrige o caso
  // em que a SoFIA recebia a mensagem numa forma do número (com/sem o 9) diferente
  // da cadastrada e rotulava uma aluna existente como contato inicial.
  if (String(motivo || '') === 'novo') {
    try { if (contatos.acharPorTel(tel)) return; } catch (_) {}
  }
  try { contatos.adicionarTag(tel, nome || '', tag); } catch (_) {}
  // Marca no timeline da conversa o momento exato em que a tag foi aplicada pela
  // automação (igual aos marcadores de assumir/encerrar) — ajuda a diagnosticar.
  // Grava TAMBÉM o canal do agendamento (sofia/formulario/express) no evento, para
  // o Funil saber o canal DAQUELE agendamento (não um valor fixo por telefone).
  try { sofia.registrarTagLog(tel, tag, motivo, '', 'add', undefined, (motivo === 'agendou' ? canal : '')); } catch (_) {}
  // Tag configurada para encerrar a conversa (ex.: "Sem interesse") → fecha (🔒)
  // como o cadeado do painel: o follow-up para de incomodar e a SoFIA recomeça
  // do zero se a aluna voltar a escrever. Usa a mesma chave que o feed/inbox usa.
  // Guarda: nunca force-fecha uma conversa que está EM ANDAMENTO (evita o bug de
  // marcar "Encerrado sem agendamento" no meio do atendimento e derrubar a conversa).
  try { if (contatos.tagConfig(tag).encerrar && !_conversaEmAndamento(tel)) { try { sofia.setAtencao(tel, false); } catch (_) {} sofia.setEncerrada(tel, true, 'SoFIA'); } } catch (_) {}
  // O Cadastro Express normalmente é feito pela PRÓPRIA recepção — não faz sentido
  // notificar quem acabou de cadastrar. Aplica a tag "agendou" (acima), mas PULA o
  // aviso no WhatsApp. Os avisos ficam só para SoFIA e Formulário.
  const pularAviso = String(canal || '').toLowerCase() === 'express';
  if (avisarWpp && !pularAviso) {
    const cab = AUTO_ROTULO[motivo] || '🔔 Automação da SoFIA';
    // Diferencia por QUAL canal veio o agendamento (só faz sentido no 'agendou').
    const canalRot = { formulario: '📲 via Formulário', sofia: '🤖 via SoFIA' }[String(canal || '').toLowerCase()] || '';
    const texto = `${cab}\n👤 ${nome || '(sem nome)'}\n📱 ${fmtTelAviso(tel)}${extra ? `\n${extra}` : ''}\n🏷️ ${tag}${canalRot ? `\n${canalRot}` : ''}`;
    try { sofia.enfileirarAviso(avisarWpp, texto, { sobre: tel, tag, motivo }); } catch (_) {}
  }
}
// Publica as regras que o LISTENER precisa (só os gatilhos dele).
function publicarRegras() {
  try {
    const regras = { novo: [], mensagem: [], palavra: [], ia: [], campanha: [], encerrou: [], anuncio: [] };
    for (const g of Object.keys(regras)) {
      for (const r of contatos.tagsPorGatilho(g)) {
        if (g === 'palavra') regras[g].push({ tag: r.tag, avisarWpp: r.avisarWpp, palavras: r.palavras });
        else if (g === 'ia') regras[g].push({ tag: r.tag, avisarWpp: r.avisarWpp, instrucao: r.instrucao });
        else if (g === 'campanha') regras[g].push({ tag: r.tag, avisarWpp: r.avisarWpp, campanhaId: r.campanhaId || '' });
        else regras[g].push({ tag: r.tag, avisarWpp: r.avisarWpp });
      }
    }
    sofia.gravarRegras(regras);
  } catch (_) {}
}
// Estado do follow-up (arquivos co-locados com os demais da Sofia, fora do Git).
const FU_AGENDOU_FILE = path.join(sofia.DIR, 'sofia-agendaram.json');const FU_FEITO_FILE = path.join(sofia.DIR, 'sofia-followup-feito.json');// Grava de forma ATÔMICA (temp + rename) e devolve true/false. O follow-up usa o
// retorno para só ENVIAR depois de gravar "já enviei" — assim uma falha de disco
// nunca vira follow-up repetido.
function fuSalvarJson(f, o) {
  try { fs.writeFileSync(f + '.tmp', JSON.stringify(o), 'utf8'); fs.renameSync(f + '.tmp', f); return true; }
  catch (_) { try { fs.writeFileSync(f, JSON.stringify(o), 'utf8'); return true; } catch (_) { return false; } }
}
function fuMarcarAgendou(tels) {
  const set = new Set((fuLerJson(FU_AGENDOU_FILE, []) || []).map(x => String(x).replace(/\D/g, '')));
  let mudou = false;
  for (const t of tels) { const d = String(t || '').replace(/\D/g, ''); if (d && !set.has(d)) { set.add(d); mudou = true; } }
  if (mudou) fuSalvarJson(FU_AGENDOU_FILE, Array.from(set).slice(-20000));
}
// Registra o CANAL de cada agendamento (por últimos 8 díg.) para o Funil. Um canal
// "de verdade" da SoFIA (sofia/formulario) é PEGAJOSO: uma vez marcado assim, um
// Express posterior não sobrescreve — assim quem agendou pela SoFIA e depois foi
// recadastrado no Express continua contando como conversão da SoFIA.
function fuMarcarCanal(evs) {
  let mapa = fuLerJson(FU_AGENDOU_CANAL_FILE, {}) || {};
  if (typeof mapa !== 'object' || Array.isArray(mapa)) mapa = {};
  let mudou = false;
  for (const ev of evs) {
    const d = String((ev && ev.telefone) || '').replace(/\D/g, '').slice(-8);
    const canal = String((ev && ev.canal) || '').trim().toLowerCase();
    if (!d || !canal) continue;
    const atual = mapa[d];
    if (atual && atual !== 'express' && canal === 'express') continue; // não rebaixa SoFIA→Express
    if (atual !== canal) { mapa[d] = canal; mudou = true; }
  }
  if (mudou) {
    // Poda: mantém no máx. ~20000 chaves (as últimas inseridas), como o outro arquivo.
    const ks = Object.keys(mapa);
    if (ks.length > 20000) { const cortar = ks.slice(0, ks.length - 20000); for (const k of cortar) delete mapa[k]; }
    fuSalvarJson(FU_AGENDOU_CANAL_FILE, mapa);
  }
}
function fuMarcarAula(evs) {
  let mapa = fuLerJson(FU_AGENDOU_AULA_FILE, {}) || {};
  if (typeof mapa !== 'object' || Array.isArray(mapa)) mapa = {};
  let mudou = false;
  for (const ev of evs) {
    const d = String((ev && ev.telefone) || '').replace(/\D/g, '').slice(-8);
    const when = String((ev && ev.when) || '').trim();
    if (!d || !when) continue;
    delete mapa[d]; // reinsere no fim (ordem = mais recentes por último, p/ a poda)
    mapa[d] = { when: when.slice(0, 60), em: Number(ev.em) || Date.now(), canal: String(ev.canal || '').trim().toLowerCase() };
    mudou = true;
  }
  if (mudou) {
    const ks = Object.keys(mapa);
    if (ks.length > 20000) for (const k of ks.slice(0, ks.length - 20000)) delete mapa[k];
    fuSalvarJson(FU_AGENDOU_AULA_FILE, mapa);
  }
}

// 1) Agendamentos concluídos (gatilho 'agendou') → aplica tags + avisa.
function processarAgendamentos() {
  let evs = [];
  try { evs = sofia.consumirAgendamentos(); } catch (_) { return; }
  if (!evs.length) return;
  try { fuMarcarAgendou(evs.map(ev => ev.telefone)); } catch (_) {} // registra p/ o follow-up NÃO incomodar quem agendou
  try { fuMarcarCanal(evs); } catch (_) {} // guarda o canal (sofia/formulario/express) p/ o Funil não contar Express
  try { fuMarcarAula(evs); } catch (_) {} // guarda dia/hora da aula agendada (mostrado no Funil)
  // Nome completo do agendamento → nome do contato (regras em contatos.nomeDoAgendamento).
  for (const ev of evs) {
    if (!ev.nome) continue;
    try {
      const r = contatos.nomeDoAgendamento(ev.telefone, ev.nome);
      if (r.mudou) console.log(`[contatos] nome atualizado pelo agendamento (${ev.canal || 'sofia'}): "${r.antes || '(vazio)'}" → "${r.depois}"`);
      else if (r.depois) console.log(`[contatos] nome do agendamento "${r.depois}" NÃO aplicado em "${r.antes}" (${r.motivo})`);
    } catch (_) {}
  }
  let autos = [];
  try { autos = contatos.tagsPorGatilho('agendou'); } catch (_) {}
  if (!autos.length) return;
  for (const ev of evs) {
    const nome = ev.nome || '';
    for (const a of autos) aplicarAutomacao({ telefone: ev.telefone, nome, tag: a.tag, avisarWpp: a.avisarWpp, motivo: 'agendou', extra: ev.when ? `📅 ${ev.when}` : '', canal: ev.canal });
  }
}

// 3) Follow-up: enfileira retomada para leads que esfriaram SEM agendar.
//    A Sofia (listener) é quem GERA (IA) e ENVIA — aqui só decidimos QUEM.
function processarFollowups() {
  let cfg; try { cfg = sofia.lerFollowupCfg(); } catch (_) { E.fuEsperando = {}; return; }
  if (!cfg || !cfg.on) { E.fuEsperando = {}; return; }
  try { if (!sofia.estadoAtivo()) { E.fuEsperando = {}; return; } } catch (_) {} // SoFIA pausada → não faz nada
  // Estamos DENTRO da janela de horário agora? Se não, os leads no ponto de
  // receber follow-up ficam "aguardando" (não enfileira) e a próxima varredura
  // (a cada 2 min) reavalia — o que venceu de madrugada só sai no início da
  // janela (ex.: 8h). Assim nunca manda tarde da noite. (Brasília.)
  let dentroDaJanela = true;
  try {
    const _mm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : -1; };
    const hhmm = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const cur = _mm(hhmm), ini = _mm(cfg.janelaIni), fim = _mm(cfg.janelaFim);
    if (cur >= 0 && ini >= 0 && fim >= 0 && ini !== fim) {
      dentroDaJanela = ini < fim ? (cur >= ini && cur < fim) : (cur >= ini || cur < fim); // ini<fim normal; senão cruza meia-noite
    }
  } catch (_) {}
  const esperaMs = Math.max(0.25, cfg.horas) * 3600 * 1000;
  const CAP = Math.max(esperaMs * 3, 14 * 24 * 3600 * 1000); // não pinga conversas muito antigas
  const agora = Date.now();
  let inbox = {}; try { inbox = sofia.conversas() || {}; } catch (_) { return; }
  let humano = {}; try { humano = sofia.lerHumano() || {}; } catch (_) {}
  const agendaram = new Set((fuLerJson(FU_AGENDOU_FILE, []) || []).map(x => String(x).replace(/\D/g, '')));
  let tagsAgendou = []; try { tagsAgendou = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {}
  let contatosMap = {}; try { contatosMap = contatos.carregar() || {}; } catch (_) {}
  // Tags que o painel configurou para NÃO receber follow-up (ex.: "Agendou Aula
  // Exp", "Encerrado ..."). Normaliza (sem acento/maiúscula/pontuação) para casar
  // "FX - 3. Agendou Aula Exp" com pequenas variações de escrita.
  const _normTag = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fuExcluir = new Set((cfg.tagsExcluir || []).map(_normTag).filter(Boolean));
  const feito = fuLerJson(FU_FEITO_FILE, {}) || {};
  const espera = {}; // leads prontos, mas segurados pelo horário (recalculado agora)
  for (const chave of Object.keys(inbox)) {
    const c = inbox[chave] || {}; const msgs = c.msgs || [];
    if (!msgs.length) continue;
    let ultimoAluna = 0;
    // m.imp = veio do "Reimportar histórico" (não é fala nova): não conta. Sem isso,
    // uma reimportação faz conversas antigas parecerem "aluna falou e ficou sem resposta".
    for (const m of msgs) if (m.autor === 'aluna' && !m.imp && m.em > ultimoAluna) ultimoAluna = m.em;
    if (!ultimoAluna) continue;                              // a lead nunca falou → ignora
    if (cfg.ligadoEm && ultimoAluna < cfg.ligadoEm) continue; // "só daqui pra frente": ignora o acúmulo de antes de ligar
    const idle = agora - (c.ultimaEm || ultimoAluna);
    if (idle < esperaMs || idle > CAP) continue;             // ainda quente, ou antiga demais
    if ((feito[chave] || 0) >= ultimoAluna) continue;        // já fez follow-up deste ciclo
    const d = String(chave).replace(/\D/g, '');
    if (sofia.estaBloqueado(chave)) continue;                // bloqueado
    if (humano[chave]) continue;                             // sob controle humano
    try { if (sofia.estaEncerrada(chave, ultimoAluna)) continue; } catch (_) {} // encerrada à mão → não incomoda (mede pela última msg da aluna: despedida da SoFIA não reabre)
    if (agendaram.has(d)) continue;                          // já agendou
    // acharPorTel tolera o 9º dígito: a conversa pode vir sem o 9 e o CRM guardar com o 9.
    try { const ct = (contatos.acharPorTel(chave, contatosMap) || {}).contato; if (ct && (ct.tags || []).some(t => tagsAgendou.includes(t))) continue; } catch (_) {}
    // Não reengaja quem já disse que não quer: contato com a tag "Sem interesse"
    // (ex.: "FX - 0. Sem interesse") fica de fora do follow-up.
    try { const ct = (contatos.acharPorTel(chave, contatosMap) || {}).contato; if (ct && (ct.tags || []).some(t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').includes('seminteresse'))) continue; } catch (_) {}
    // Tags excluídas pelo painel (ex.: "FX - 3. Agendou Aula Exp", "Encerrado ...").
    if (fuExcluir.size) { try { const ct = (contatos.acharPorTel(chave, contatosMap) || {}).contato; if (ct && (ct.tags || []).some(t => fuExcluir.has(_normTag(t)))) continue; } catch (_) {} }
    // Chegou aqui = está no ponto de receber a retomada. Só falta o horário:
    if (!dentroDaJanela) { espera[chave] = cfg.janelaIni; continue; } // segura p/ o próximo horário permitido
    // REGISTRA "já enviei" ANTES de enfileirar e só envia se o registro GRAVOU.
    // Assim, se a aluna não responder, o gate (feito >= ultimoAluna) barra novos
    // envios — 1 follow-up por conversa, até ela responder de novo. E como grava
    // antes, uma falha de disco nunca produz follow-up repetido.
    feito[chave] = ultimoAluna;
    if (fuSalvarJson(FU_FEITO_FILE, feito)) {
      try { sofia.enfileirarFollowup(chave, cfg.instrucao); } catch (_) {}
    } else {
      delete feito[chave]; // não gravou → não marca; tenta no próximo ciclo
    }
  }
  E.fuEsperando = espera; // publica p/ o painel mostrar o selo "⏳ aguardando horário"
}
// 2) Ações detectadas pelo listener (novo/palavra/campanha/encerrou).
function processarEventos() {
  let evs = [];
  try { evs = sofia.consumirEventos(); } catch (_) { return; }
  if (!evs.length) return;
  let tagsAgendou = [];
  try { tagsAgendou = contatos.tagsPorGatilho('agendou').map(a => a.tag); } catch (_) {}
  // Contam como PROVA DE AGENDAMENTO, além das tags de "agendou", os DESFECHOS da
  // Presença da experimental: "Fez Aula" (compareceu) e "Encerrado com Agendamento
  // sem Presença" (agendou e faltou). O job de presença TROCA a tag "Agendou" por
  // uma dessas — então, sem isto, quem agendou e faltou perdia o escudo e era
  // marcado (errado) como "Encerrado SEM agendamento" no fechamento da conversa.
  let comp = {}; try { comp = lerCompCfg(); } catch (_) {}
  const provasAgendou = new Set([
    ...tagsAgendou,
    ...(Array.isArray(comp.tagsAgendou) ? comp.tagsAgendou : []),
    comp.tagCompareceu, comp.tagFaltou,
  ].map(t => String(t || '').trim().toLowerCase()).filter(Boolean));
  for (const ev of evs) {
    const tel = String(ev.telefone || '').replace(/\D/g, '');
    if (!tel || !ev.tag) continue;
    // "Encerrado sem agendamento" não deve marcar quem JÁ agendou (tag de agendou
    // OU um desfecho de presença que prova o agendamento — ver provasAgendou acima).
    if (ev.motivo === 'encerrou') {
      try {
        // Busca TOLERANTE ao 9º dígito (acharPorTel), não por chave exata: o mesmo
        // número pode estar guardado numa forma (com/sem o 9) e chegar no evento na
        // outra. Com a busca exata, a trava não achava o contato e marcava "Encerrado
        // sem agendamento" em quem já tinha "...com Agendamento sem Presença" (no-show).
        const r = contatos.acharPorTel(tel);
        const c = r && r.contato;
        if (c && (c.tags || []).some(t => provasAgendou.has(String(t || '').trim().toLowerCase()))) continue;
      } catch (_) {}
    }
    // "Só para quem já tem a tag…": sem nenhuma delas, nem etiqueta nem avisa
    // (ex.: avisar a recepção só quando uma 0. Aluna / 0. Ex Aluna escrever).
    let exige = []; try { exige = contatos.tagConfig(ev.tag).exige || []; } catch (_) {}
    let nome = ev.nome;
    if (exige.length) {
      let c = null; try { const r = contatos.acharPorTel(tel); c = r && r.contato; } catch (_) {}
      if (!(c && (c.tags || []).some(t => exige.includes(t)))) continue;
      if (c.nome) nome = c.nome; // aluna cadastrada: o recado leva o nome do cadastro, não o do perfil do WhatsApp
    }
    let extra = ev.extra || '';
    if (!extra && ev.motivo === 'mensagem') extra = ultimaMsgDaAluna(tel, ev.em); // o recado mostra o que ela escreveu
    aplicarAutomacao({ telefone: tel, nome, tag: ev.tag, avisarWpp: ev.avisarWpp, motivo: ev.motivo, extra });
  }
}
// Avisos para a recepção já enviados (ou que falharam), agrupados pelos 8 últimos
// dígitos da aluna de quem eles falam — vêm do Log da SoFIA (atividade-sofia.jsonl).
function avisosPorAluna() {
  const out = {};
  for (const e of atividade.carregarSofia()) {
    if (e.contexto !== 'Aviso para a recepção' || !e.sobre) continue;
    const l8 = String(e.sobre).replace(/\D/g, '').slice(-8);
    (out[l8] || (out[l8] = [])).push({ em: Date.parse(e.ts) || 0, ok: e.ok !== false, destino: e.destino || '', erro: e.erro || '' });
  }
  return out;
}
// Texto da mensagem que disparou o evento (a última da aluna, de até 2 min antes),
// para o aviso no WhatsApp dizer O QUE ela escreveu. '' se não achar.
function ultimaMsgDaAluna(tel, em) {
  try {
    const conv = sofia.conversas() || {};
    const l8 = String(tel).slice(-8);
    const k = Object.keys(conv).find(x => String(x).replace(/\D/g, '').slice(-8) === l8);
    const msgs = (k && Array.isArray(conv[k].msgs)) ? conv[k].msgs : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.autor !== 'aluna') continue;
      if (em && Number(m.em) && Math.abs(Number(m.em) - Number(em)) > 120000) return '';
      const t = String(m.texto || '').replace(/\s+/g, ' ').trim();
      return t ? '💬 "' + (t.length > 300 ? t.slice(0, 300) + '…' : t) + '"' : '';
    }
  } catch (_) {}
  return '';
}
// Reconcilia a tag de "Atendimento humano" (gatilho 'humano') com o estado real
// do controle humano. A tag entra ao ASSUMIR e deve sair ao voltar para a SoFIA —
// seja pelo botão "devolver" (que já remove na hora) OU quando a trava de 1h
// EXPIRA sozinha (a SoFIA reassume automaticamente). Sem isto, a tag ficava presa
// quando ninguém clicava em devolver e a conversa voltava pela expiração.
function reconciliarTagHumano() {
  let autos = [];
  try { autos = contatos.tagsPorGatilho('humano'); } catch (_) { return; }
  if (!autos.length) return;
  const tags = autos.map(a => a.tag);
  let conv = {}; try { conv = sofia.conversas() || {}; } catch (_) { return; }
  let cmap = {}; try { cmap = contatos.carregar() || {}; } catch (_) { return; }
  for (const k in conv) {
    let ativo = false; try { ativo = sofia.controleHumanoDe(k); } catch (_) {}
    if (ativo) continue;                                   // ainda sob controle humano → mantém a tag
    const c = cmap[contatos.normTel(k)];
    if (!c || !(c.tags || []).some(t => tags.includes(t))) continue; // não tem a tag → nada a fazer
    for (const t of tags) { try { contatos.removerTag(k, t); } catch (_) {} } // voltou p/ SoFIA → remove
  }
}
// ── Cadastro Express: agenda no EVO SEM depender da SoFIA ────────────────────
// O Express enfileira o pedido; aqui (no painel, sempre no ar) consumimos a fila e
// fazemos o MESMO POST que a SoFIA fazia (/api/book-sofia no formulário). Assim o
// Express funciona IGUAL ao formulário, mesmo com a SoFIA desligada. A captura da
// fila é atômica, então convive com a SoFIA (ex.: Bueno) sem agendar em dobro.
// (estado "_bookCfgCache" → painel-estado.js)
function bookConfig() {
  if (E._bookCfgCache) return E._bookCfgCache;
  let token = (process.env.SOFIA_TOKEN || '').trim();
  let url = (process.env.SOFIA_BOOK_URL || '').trim();
  if (!token || !url) {
    try {
      const p = path.resolve(__dirname, '..', '..', 'ChatBot', '.env');
      const txt = fs.readFileSync(p, 'utf8');
      const pega = (k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(txt); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
      if (!token) token = pega('SOFIA_TOKEN');
      if (!url) url = pega('SOFIA_BOOK_URL');
    } catch (_) {}
  }
  if (!url) { const f = (process.env.FORM_CLOUD_URL || '').trim().replace(/\/+$/, ''); if (f) url = f + '/api/book-sofia'; }
  E._bookCfgCache = { token, url };
  return E._bookCfgCache;
}
// (estado "_bookInFlight" → painel-estado.js)
// (estado "_circSlots" → painel-estado.js)
async function processarExpressInbox() {
  if (E._bookInFlight) return;
  let pend = [];
  try { pend = sofia.consumirAgendarInbox(); } catch (_) { return; }
  if (!pend.length) return;
  E._bookInFlight = true;
  try {
    const { token, url } = bookConfig();
    for (const op of pend) {
      const id = String((op && op.id) || '');
      if (!id) continue;
      const telefone = String(op.telefone || op.chave || '').replace(/\D/g, '');
      const nome = String(op.nome || '').trim();
      try {
        if (!url || !token) throw new Error('SOFIA_BOOK_URL/SOFIA_TOKEN ausentes (confira o ChatBot/.env)');
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Sofia-Token': token },
          body: JSON.stringify({ nome, email: String(op.email || '').trim(), telefone, when: String(op.when || '').trim(), origem: String(op.origem || '').trim(), acao_duplicado: String(op.acaoDuplicado || '').trim(), tipo: op.tipo === 'circuito' ? 'circuito' : '' }),
          signal: AbortSignal.timeout(55000),
        });
        const data = await r.json().catch(() => ({}));
        let res;
        if (r.ok && data && data.ok) {
          res = { ok: true, when: data.when || op.when };
          if (data.aviso) res.aviso = String(data.aviso);   // ex.: EVO não separou (mesmo e-mail)
          try { sofia.registrarAgendou({ telefone, nome, when: res.when, canal: 'express' }); } catch (_) {}
        } else if (r.status === 409 && data && data.motivo === 'cadastro_existente' && data.existente) {
          // Cadastro de OUTRA pessoa com o mesmo e-mail/telefone (mãe x filha):
          // a tela decide sobrescrever ou criar novo, e reenvia com acao_duplicado.
          res = { duplicado: true, existente: data.existente };
        } else if (r.status === 409) {
          // detalhe = o motivo REAL do EVO ("Turma de … : já há 2 aulas experimentais
          // nesse horário", "não há turma nesse horário", "turma fechada"…) — a tela mostra.
          res = { lotada: true, alternativas: Array.isArray(data.alternativas) ? data.alternativas.filter(Boolean) : [], motivo: String((data && data.detalhe) || '').slice(0, 300) };
        } else {
          res = { erro: true, detalhe: (data && (data.erro || data.detalhe)) || ('HTTP ' + r.status) };
        }
        sofia.gravarAgendarResultId(id, res);
      } catch (e) {
        sofia.gravarAgendarResultId(id, { erro: true, detalhe: (e && e.message) || 'falha de rede' });
      }
    }
  } finally { E._bookInFlight = false; }
}

module.exports = {
  fmtTelAviso, AUTO_ROTULO, _conversaEmAndamento, aplicarAutomacao, publicarRegras, FU_AGENDOU_FILE, FU_FEITO_FILE, fuSalvarJson, fuMarcarAgendou, fuMarcarCanal, fuMarcarAula, processarAgendamentos, processarFollowups, processarEventos, avisosPorAluna, ultimaMsgDaAluna, reconciliarTagHumano, bookConfig, processarExpressInbox,
};

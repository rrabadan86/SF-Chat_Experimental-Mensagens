/**
 * push-eventos.js — transforma o que acontece no sistema em notificação do
 * painel (push.js). Só AVISA a equipe: não envia nada a cliente e não muda
 * nenhuma regra de envio. Tudo aqui é "se der, avisa": nenhuma função lança erro.
 *
 *   atendente — a conversa entrou em "atenção" (a pessoa pediu atendente)
 *   agendou   — aula experimental agendada (SoFIA ou Formulário; Express não,
 *               porque é a própria recepção que cadastra)
 *   recepcao  — os outros avisos que a SoFIA manda para a recepção por WhatsApp
 *   saude     — alerta da Saúde (chamado pelo notificar.js)
 */
const fs = require('fs');
const path = require('path');
const push = require('./push');

const ARQ_VISTO = path.resolve(__dirname, '..', 'data', 'push-atencao.json');
const digitos = (t) => String(t || '').replace(/\D/g, '');
const linkConversa = (tel) => { const d = digitos(tel); return d.length >= 8 && d.length <= 13 ? `/sofia?view=conversas&chat=${d}` : '/sofia?view=conversas'; };
const curto = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const semErro = (p) => Promise.resolve(p).catch(() => ({ enviados: 0, falhas: 0, removidos: 0 }));

// Aula experimental agendada. ev = { telefone, nome, when, canal }.
function agendou(ev) {
  if (!ev || String(ev.canal || '').toLowerCase() === 'express') return semErro(null);
  const via = { formulario: 'pelo Formulário', sofia: 'pela SoFIA' }[String(ev.canal || 'sofia').toLowerCase()] || '';
  return semErro(push.enviar('agendou', {
    titulo: '🎉 Aula experimental agendada',
    corpo: [curto(ev.nome, 60) || 'Nova lead', ev.when ? curto(ev.when, 40) : '', via].filter(Boolean).join(' · '),
    url: linkConversa(ev.telefone), tag: 'agendou-' + digitos(ev.telefone).slice(-8),
  }));
}
// Os outros avisos que a SoFIA manda para a recepção (palavra-chave, intenção,
// campanha, lead nova…). rotulo = o cabeçalho do aviso do WhatsApp.
function avisoRecepcao({ rotulo, nome, tel, tag }) {
  return semErro(push.enviar('recepcao', {
    titulo: curto(rotulo, 80) || '🔔 Aviso da SoFIA',
    corpo: [curto(nome, 60) || 'Sem nome', tag ? curto(tag, 50) : ''].filter(Boolean).join(' · '),
    url: linkConversa(tel), tag: 'recepcao-' + digitos(tel).slice(-8),
  }));
}
// "Pediu atendente": a SoFIA marca a conversa em sofia-atencao.json ({ chave: quando }).
// O painel olha esse arquivo de tempos em tempos e avisa só as marcas NOVAS.
// Na primeira vez não avisa nada (as marcas antigas não são novidade).
function vigiarAtencao(agora) {
  let marcas = {};
  try { marcas = require('./sofia-editor').lerAtencao() || {}; } catch (_) { return semErro(null); }
  let visto = null;
  try { visto = Number(JSON.parse(fs.readFileSync(ARQ_VISTO, 'utf8')).visto) || 0; } catch (_) { visto = null; }
  const maior = Math.max(0, ...Object.values(marcas).map(Number).filter(isFinite));
  const grava = (v) => { try { fs.mkdirSync(path.dirname(ARQ_VISTO), { recursive: true }); fs.writeFileSync(ARQ_VISTO, JSON.stringify({ visto: v })); } catch (_) {} };
  if (visto == null) { grava(Math.max(maior, agora || Date.now())); return semErro(null); }
  const novas = Object.keys(marcas).filter(k => Number(marcas[k]) > visto).sort((a, b) => marcas[a] - marcas[b]);
  if (!novas.length) return semErro(null);
  grava(maior); // anota ANTES de enviar: se o envio falhar, não repete o aviso depois
  let conv = {}; try { conv = require('./sofia-editor').conversas() || {}; } catch (_) {}
  return semErro(Promise.all(novas.slice(-5).map((k) => {
    let nome = (conv[k] && conv[k].nome) || '';
    if (!nome) { try { const r = require('./contatos').acharPorTel(k); nome = (r && r.contato && r.contato.nome) || ''; } catch (_) {} }
    return push.enviar('atendente', { titulo: '🙋 Pediu atendente', corpo: curto(nome, 60) || 'Uma pessoa pediu para falar com a equipe', url: linkConversa(k), tag: 'atendente-' + digitos(k).slice(-8) }, { urgente: true });
  })).then(rs => rs.reduce((a, r) => ({ enviados: a.enviados + r.enviados, falhas: a.falhas + r.falhas, removidos: a.removidos + r.removidos }), { enviados: 0, falhas: 0, removidos: 0 })));
}
// Alerta da Saúde (o mesmo texto que vai para o ntfy).
function saude(titulo, mensagem, urgente) {
  return semErro(push.enviar('saude', { titulo: curto(titulo, 100) || 'SlimFit · alerta', corpo: curto(mensagem, 400), url: '/saude', tag: 'saude-' + require('crypto').createHash('sha1').update(String(titulo || '')).digest('hex').slice(0, 10) }, { urgente: !!urgente }));
}

module.exports = { agendou, avisoRecepcao, vigiarAtencao, saude, linkConversa, ARQ_VISTO };

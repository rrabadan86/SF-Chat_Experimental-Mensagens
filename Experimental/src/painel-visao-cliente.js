/**
 * painel-visao-cliente.js — "📱 Visão do cliente" (WhatsApp → Visão do cliente).
 *
 * Mostra, num celular simulado, como as mensagens AUTOMÁTICAS chegam no WhatsApp
 * da aluna/lead em cada jornada (aula experimental, falta, aluna nova, renovação,
 * cobrança, ex-aluna). Usa os TEXTOS CONFIGURADOS no painel (mensagens.js), com
 * dados de exemplo no lugar das variáveis — mudou o texto em Configuração, muda
 * aqui. Só leitura: não envia nada.
 */
const mensagens = require('./mensagens');
const { esc, chrome, uiTopo } = require('./painel-base');

const EX = { nome: 'Mariana', aluna: 'Mariana', professora: 'Bia', horario: '09:30', hora: '09h30', quando: 'quinta-feira, às 09:30', data: '19/11', plano: 'SLIM 3X MENSAL', valor: 'R$ 289,00', vencimento: '16/11' };
// Ajustes por mensagem (formato que o robô usa de verdade naquele envio).
const EX_POR = { no_show: { horario: ' (09:30)' } };
// De onde sai cada mensagem: número do Studio (robô da recepção) ou da SoFIA (cobrança).
const DE = { studio: { nome: 'SlimFit Studio · Recepção', ini: 'SF' }, sofia: { nome: 'SoFIA · SlimFit Studio', ini: '🤖' } };

const J = [
  { k: 'experimental', titulo: 'Lead que agendou a aula experimental', sub: 'confirmação ao agendar → lembrete na véspera → follow-up depois da aula', de: 'studio', passos: [
    ['dia', 'Segunda'], ['in', 'confirmacao_experimental', '15:41'], ['out', 'Oba! Obrigada 😊', '15:52'],
    ['dia', 'Quarta'], ['in', 'confirmacao_amanha', '18:00'], ['out', 'Confirmadíssimo! 👍', '18:21'],
    ['dia', 'Sexta'], ['audio', '0:48', '10:00'], ['in', 'followup', '10:00'], ['out', 'Amei a aula! Quais são os planos?', '10:37'],
  ] },
  { k: 'faltou', titulo: 'Lead que faltou à aula', sub: 'lembrete no dia → convite para remarcar → encerramento educado no dia seguinte', de: 'studio', passos: [
    ['dia', 'Ontem'], ['in', 'confirmacao_hoje', '06:30'], ['in', 'no_show', '20:15'],
    ['dia', 'Hoje'], ['in', 'noshow_encerramento', '11:45'], ['out', 'Desculpa! Tive um imprevisto. Posso remarcar pra segunda?', '12:03'],
  ] },
  { k: 'nova', titulo: 'Aluna nova', sub: 'boas-vindas com o link do contrato → convite de indicação aos 30 dias', de: 'studio', passos: [
    ['dia', '2 de outubro'], ['in', 'boasvindas_nova', '10:05'], ['out', 'Obrigada!! Ansiosa pra começar 💪', '10:20'],
    ['dia', '1º de novembro'], ['in', 'indicacao_30d', '11:22'], ['out', 'Vou chamar minha irmã! Te passo o contato dela 😊', '12:40'],
  ] },
  { k: 'renovacao', titulo: 'Renovação de contrato', sub: 'aviso antes de vencer → aviso no dia → boas-vindas da renovação', de: 'studio', passos: [
    ['dia', 'Segunda passada'], ['in', 'renovacao', '09:10'],
    ['dia', 'Hoje'], ['in', 'vence_hoje', '09:30'], ['out', 'Vou passar aí hoje à tarde pra renovar!', '09:48'], ['in', 'boasvindas_renovacao', '17:40'],
  ] },
  { k: 'ausente', titulo: 'Aluna sumida', sub: 'mensagem de "sentimos sua falta" quando para de ir às aulas', de: 'studio', passos: [
    ['dia', 'Terça'], ['in', 'sentimos_falta_1', '10:00'], ['out', 'Oi! Estava viajando, volto na segunda 😊', '10:26'],
  ] },
  { k: 'exaluna', titulo: 'Ex-aluna', sub: 'parabéns no aniversário, direto no WhatsApp dela', de: 'studio', passos: [
    ['dia', 'Hoje'], ['in', 'aniversario_ex', '08:00'], ['out', 'Que carinho! Obrigada, saudades de vocês 💛', '08:31'],
  ] },
  { k: 'cobranca', titulo: 'Cobrança (pela SoFIA)', sub: 'boleto que vence hoje → boleto vencido → acesso ao app liberado depois do pagamento', de: 'sofia', passos: [
    ['dia', '16/11'], ['in', 'cobranca_boleto_hoje', '11:27'],
    ['dia', '20/11'], ['in', 'cobranca_boleto', '12:05'], ['out', 'Paguei agora, segue o comprovante', '12:31'], ['in', 'cobranca_app_reativado', '15:10'],
  ] },
];

// Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, links, quebras de linha).
function formatarWa(t) {
  return esc(String(t || ''))
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}
function textoDe(chave) {
  try {
    const t = mensagens.texto(chave);
    if (!t) return '';
    return mensagens.renderTexto(t, Object.assign({}, mensagens.exemplosDe(chave), EX, EX_POR[chave] || {}));
  } catch (_) { return ''; }
}
function tituloDe(chave) { const m = (mensagens.CATALOGO || []).find(x => x.chave === chave); return m ? m.titulo : chave; }

function paginaVisaoCliente(k) {
  const j = J.find(x => x.k === k) || J[0];
  const de = DE[j.de] || DE.studio;
  const lista = J.map(x => `<a class="vc-j${x.k === j.k ? ' on' : ''}" href="/visao-cliente?j=${x.k}"><b>${esc(x.titulo)}</b><span>${esc(x.sub)}</span></a>`).join('');
  const bolhas = j.passos.map(([tipo, a, b]) => {
    if (tipo === 'dia') return `<div class="vc-dia"><span>${esc(a)}</span></div>`;
    if (tipo === 'audio') return `<div class="vc-b in"><div class="vc-audio">▶︎ <span class="vc-onda"></span> ${esc(a)}</div><div class="vc-h">${esc(b)}</div><div class="vc-tag">🎤 áudio da professora</div></div>`;
    if (tipo === 'out') return `<div class="vc-b out">${formatarWa(a)}<div class="vc-h">${esc(b)} <span class="vc-ck">✓✓</span></div></div>`;
    const txt = textoDe(a);
    if (!txt) return '';
    return `<div class="vc-b in" title="${esc(tituloDe(a))}">${formatarWa(txt)}<div class="vc-h">${esc(b)}</div><div class="vc-tag">${esc(tituloDe(a))}</div></div>`;
  }).join('');
  const corpo = `
<style>
.vc-wrap{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:22px;align-items:start}
@media (max-width:900px){.vc-wrap{grid-template-columns:1fr}}
.vc-lista{display:flex;flex-direction:column;gap:8px}
.vc-j{display:block;background:#fff;border:1px solid var(--linha,#e5e7eb);border-radius:12px;padding:12px 14px;text-decoration:none;color:inherit}
.vc-j b{display:block;font-size:15px;margin-bottom:3px}
.vc-j span{font-size:13px;color:var(--cinza,#6b7280)}
.vc-j.on{border-color:#0e6e6b;box-shadow:0 0 0 2px rgba(14,110,107,.15);background:#f0faf8}
.vc-tel{background:#111;border-radius:40px;padding:12px;box-shadow:0 18px 40px rgba(0,0,0,.25);max-width:400px;margin:0 auto}
.vc-tela{border-radius:30px;overflow:hidden;background:#efeae2;height:720px;display:flex;flex-direction:column}
.vc-top{background:#075e54;color:#fff;display:flex;align-items:center;gap:10px;padding:14px 14px 12px}
.vc-av{width:38px;height:38px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.vc-top b{display:block;font-size:15px}.vc-top small{font-size:12px;opacity:.85}
.vc-chat{flex:1;overflow-y:auto;padding:10px 10px 16px;display:flex;flex-direction:column;gap:6px;background-image:radial-gradient(rgba(0,0,0,.035) 1px,transparent 1px);background-size:14px 14px}
.vc-dia{text-align:center;margin:8px 0 4px}.vc-dia span{background:#e1f2fb;color:#3b4a54;font-size:12px;padding:4px 10px;border-radius:8px;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.vc-b{max-width:84%;padding:7px 9px 5px;border-radius:9px;font-size:14px;line-height:1.38;color:#111b21;box-shadow:0 1px 1px rgba(0,0,0,.12);word-wrap:break-word;position:relative}
.vc-b.in{background:#fff;align-self:flex-start;border-top-left-radius:2px}
.vc-b.out{background:#d9fdd3;align-self:flex-end;border-top-right-radius:2px}
.vc-b a{color:#027eb5;word-break:break-all}
.vc-h{font-size:11px;color:#667781;text-align:right;margin-top:2px}
.vc-ck{color:#53bdeb;font-weight:700}
.vc-tag{font-size:10.5px;color:#0e6e6b;background:#e7f5f2;border-radius:6px;padding:2px 6px;margin-top:5px;display:inline-block}
.vc-audio{display:flex;align-items:center;gap:8px;min-width:210px;color:#54656f;font-size:13px}
.vc-onda{flex:1;height:18px;background:repeating-linear-gradient(90deg,#8696a0 0 2px,transparent 2px 5px);mask:linear-gradient(90deg,#000 0,#000 100%);opacity:.7;border-radius:3px}
.vc-rod{background:#f0f2f5;padding:10px 12px;color:#8696a0;font-size:13px;display:flex;gap:8px;align-items:center}
.vc-rod span{flex:1;background:#fff;border-radius:20px;padding:9px 14px}
.vc-nota{font-size:13px;color:var(--cinza,#6b7280);margin-top:10px;line-height:1.45}
</style>
<div class="wrap">${require('./painel-whatsapp').subnavMensagens('cliente')}
${uiTopo({ titulo: '📱 Visão do cliente', sub: 'Como as mensagens automáticas chegam no WhatsApp da aluna — escolha uma jornada. Os textos são os configurados em <b>WhatsApp → Configuração</b>, com dados de exemplo no lugar das variáveis.' })}
<div class="vc-wrap">
  <div><div class="vc-lista">${lista}</div>
    <p class="vc-nota">As bolhas brancas são as mensagens automáticas (a etiqueta verde mostra qual envio é). As verdes são respostas de exemplo da aluna. Nada aqui é enviado.</p></div>
  <div class="vc-tel"><div class="vc-tela">
    <div class="vc-top"><div class="vc-av">${esc(de.ini)}</div><div><b>${esc(de.nome)}</b><small>online</small></div></div>
    <div class="vc-chat" id="vcChat">${bolhas}</div>
    <div class="vc-rod">😊 <span>Mensagem</span> 🎤</div>
  </div></div>
</div>
</div>
<script>(function(){var c=document.getElementById('vcChat');if(c)c.scrollTop=c.scrollHeight;})();</script>`;
  return chrome({ tab: 'Visão do cliente', h1: '', p: '' }, 'msg', corpo);
}

module.exports = { paginaVisaoCliente, JORNADAS: J };

/**
 * Agenda dos envios automáticos desta unidade — horários SALVOS (padrão + o que
 * foi editado no painel), em ordem de horário, com ligado/desligado e um alerta
 * para envios LIGADOS que caem muito perto um do outro no mesmo dia.
 *
 *   node src/agenda.js            → só os ligados
 *   node src/agenda.js --todos    → inclui os desligados
 *
 * O robô roda um envio por vez: quando dois caem juntos, o segundo ESPERA o
 * primeiro terminar (até 40 min) — não falha, só atrasa. Envios que abrem o EVO
 * costumam levar de 2 a 10 minutos.
 */
const config = require('./config');
const jobsAtivos = require('./jobs-ativos');

const TODOS = process.argv.includes('--todos');
const PERTO_MIN = 10;
const D = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
let titulos = {};
try { titulos = Object.fromEntries(require('./horarios').CATALOGO.map(j => [j.chave, j.titulo])); } catch (_) {}
const NOMES = {
  histExperimentais: 'Histórico de experimentais (professoras)', ativasFoto: 'Alunas ativas (leitura do EVO)',
  aniversMesGrupo: 'Aniversariantes do mês (grupo)', gradeFixas: 'Grade de fixas', ausentes10: 'Ausentes 10+ dias (grupo)',
  presentesPend: 'Presentes de tempo de casa (grupo)', renovacoesMesGrupo: 'Contratos a vencer no mês (grupo)',
  slotsPushDia: 'Horários do formulário (dia)', slotsPushNoite: 'Horários do formulário (noite)',
};
const nome = (k) => titulos[k] || NOMES[k] || k;

function diasDe(dow) {
  if (!dow || dow === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
  const s = new Set();
  for (const p of dow.split(',')) {
    const m = /^(\d)-(\d)$/.exec(p);
    if (m) for (let d = +m[1]; d <= +m[2]; d++) s.add(d % 7); else if (/^\d$/.test(p)) s.add(+p % 7);
  }
  return s;
}
const txtDias = (s) => s.size === 7 ? 'todos os dias' : [...s].sort().map(d => D[d]).join(', ');

const linhas = [], outros = [];
for (const [k, v] of Object.entries(config.schedule || {})) {
  if (typeof v !== 'string') continue;
  const p = v.trim().split(/\s+/);
  const on = jobsAtivos.ativo(k);
  if (!on && !TODOS) continue;
  if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) { outros.push({ k, v, on }); continue; }
  const dias = p[2] !== '*' ? null : diasDe(p[4]);
  linhas.push({ k, v, on, min: +p[1] * 60 + +p[0], hhmm: `${p[1].padStart(2, '0')}:${p[0].padStart(2, '0')}`, dias, quando: p[2] !== '*' ? `todo dia ${p[2]} do mês` : txtDias(dias) });
}
linhas.sort((a, b) => a.min - b.min);

console.log(`\nAgenda dos envios — ${config.STUDIO_NOME || 'unidade'}${TODOS ? ' (ligados e desligados)' : ' (só os ligados; use --todos para ver todos)'}\n`);
for (const x of linhas) console.log(`${x.hhmm}  ${x.on ? '🟢' : '⚪'}  ${nome(x.k).padEnd(62)} ${x.quando}`);
for (const x of outros) console.log(`  ⏱️  ${x.on ? '🟢' : '⚪'}  ${nome(x.k).padEnd(62)} repetido (${x.v})`);

// Ligados a ≤ PERTO_MIN minutos um do outro, em pelo menos um dia em comum.
const alerta = [];
const lig = linhas.filter(x => x.on && x.dias);
for (let i = 0; i < lig.length; i++) for (let j = i + 1; j < lig.length; j++) {
  const a = lig[i], b = lig[j];
  if (b.min - a.min > PERTO_MIN) break;
  const comum = [...a.dias].filter(d => b.dias.has(d));
  if (comum.length) alerta.push(`${a.hhmm} ${nome(a.k)}  ×  ${b.hhmm} ${nome(b.k)}  (${txtDias(new Set(comum))})`);
}
console.log(alerta.length
  ? `\n⚠️  Envios ligados a ${PERTO_MIN} min ou menos um do outro (o segundo espera o primeiro terminar):\n` + alerta.map(l => '  • ' + l).join('\n')
  : `\n✅ Nenhum envio ligado a menos de ${PERTO_MIN} min de outro.`);
console.log('');

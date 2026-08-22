const cron = require('node-cron');
const config = require('./config');
const EvoScraper = require('./evo-scraper');
const WhatsAppSender = require('./whatsapp-sender');
const keepAwake = require('./keep-awake');
const { runFollowupMorning, runFollowupAfternoon } = require('./followup-experimental');
const { runNoShowMorning, runNoShowAfternoon } = require('./follow-up-no-show');
const { pullConfirmacoesNuvem } = require('./pull-confirmacoes-nuvem');
const notif = require('./notificar'); // alertas de saúde (ntfy.sh) — best-effort
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ─── Log com timestamp ─────────────────────────────────────
const LOG_DIR = path.resolve(__dirname, '..', 'logs');

// Calcula a grade de horários (script Python, rápido no VPS) e a envia pronta ao
// formulário na Render. Processo separado e leve — não usa o navegador/WhatsApp.
function runSlotsPush() {
  const dir = path.resolve(__dirname, 'agendamento_evo');
  const script = path.join(dir, 'push_slots.py');
  const py = process.env.PYTHON_BIN || 'python3';
  execFile(py, [script], { cwd: dir, timeout: 120000 }, (err, stdout, stderr) => {
    const out = (stdout || stderr || '').trim();
    if (err) { logError('Grade→formulário (push_slots)', err); if (out) console.log('   ' + out); return; }
    log('🗓️  ' + (out || 'grade enviada ao formulário'));
  });
}

// Convocatória do Circuito (quarta): lê a professora na Grade (usa o scraper do
// EVO), então respeita o jobRunning. Se outro job estiver rodando, espera e
// tenta de novo (não pode logar no EVO em paralelo com outro job).
function agendarCircuitoConvocacao(tentativa = 1) {
  if (jobRunning) {
    if (tentativa > 6) {
      logError('Circuito convocatória', new Error('scraper ocupado — desisti após esperar ~9 min'));
      return;
    }
    log(`⏳ Circuito: outro job em execução — tento de novo em 90s (tentativa ${tentativa})`);
    setTimeout(() => agendarCircuitoConvocacao(tentativa + 1), 90000);
    return;
  }
  jobRunning = true;
  const start = new Date();
  require('./enviar-circuito').runCircuitoConvocacao()
    .then(() => log('✅ Circuito convocatória concluída'))
    .catch(err => logError('Circuito convocatória', err))
    .finally(() => {
      jobRunning = false;
      log(`⏱️  Circuito convocatória finalizada em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
    });
}

function log(msg) {
  const ts = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const line = `[${ts}] ${msg}`;
  console.log(line);
}

function logError(msg, err) {
  const ts = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const line = `[${ts}] ❌ ${msg}: ${err?.message || err}`;
  console.error(line);
  if (err?.stack) console.error(err.stack);
  // Alerta push (ntfy) — best-effort, nunca derruba nada. O anti-spam do módulo
  // impede repetição do mesmo alerta em 30 min (evita enxurrada de push).
  try {
    notif.alertar(
      'Job com erro: ' + msg,
      (err?.message || String(err) || 'erro sem mensagem') + ' — veja pm2 logs slimfit-exp.',
      { prioridade: 'high', tags: 'warning' },
    );
  } catch (_) { /* alerta é opcional */ }
}

// ─── Helpers ───────────────────────────────────────────────
function formatDate(d) {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function printResults(results, jobName) {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log(`║  📊 Resultado: ${jobName.padEnd(27)}║`);
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║  ✅ Enviadas:  ${String(results.sent).padEnd(27)}║`);
  console.log(`║  ❌ Falharam:  ${String(results.failed).padEnd(27)}║`);
  console.log(`║  ⏭️  Puladas:   ${String(results.skipped).padEnd(27)}║`);
  console.log('╚═══════════════════════════════════════════╝');

  if (results.details.length > 0) {
    console.log('\nDetalhes:');
    results.details.forEach(d => {
      const icon = d.status === 'sent' ? '✅' : d.status === 'failed' ? '❌' : '⏭️';
      console.log(`  ${icon} ${d.name} ${d.phone ? '(' + d.phone + ')' : ''} - ${d.status} ${d.reason || ''}`);
    });
  }
  console.log('');
}

// ─── Global error handlers ─────────────────────────────────
// These prevent the process from silently dying on unhandled errors
process.on('uncaughtException', (err) => {
  logError('UNCAUGHT EXCEPTION (processo NÃO vai morrer)', err);
});

process.on('unhandledRejection', (reason) => {
  logError('UNHANDLED REJECTION (processo NÃO vai morrer)', reason);
});

// ─── Job lock to prevent overlapping runs ──────────────────
let jobRunning = false;

/**
 * Executa um job com proteção contra execução simultânea e timeout.
 * NÃO inicializa o WhatsApp aqui — cada executor abre a própria conexão
 * (Instagram usa porta 9224, WhatsApp usa 9226, etc.). Inicializar aqui
 * causava conflito: o init() do WhatsApp matava o Edge que o executor
 * do Instagram/Aniversariantes ia usar, e vice-versa.
 */
async function runJob(jobName, jobFn) {
  if (jobRunning) {
    log(`⚠️  Job ${jobName} ignorado — outro job ainda está em execução`);
    return;
  }

  jobRunning = true;
  const startTime = new Date();

  // Timeout de segurança: 5 minutos para qualquer job
  const JOB_TIMEOUT = 5 * 60 * 1000;
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    logError(`TIMEOUT: Job ${jobName} excedeu ${JOB_TIMEOUT / 1000}s`, new Error('Job timeout'));
  }, JOB_TIMEOUT);

  try {
    await jobFn();
    log(`✅ Job ${jobName} concluído com sucesso`);
  } catch (error) {
    logError(`Erro no job ${jobName}`, error);
  } finally {
    clearTimeout(timeoutHandle);
    jobRunning = false;
    const elapsed = ((new Date() - startTime) / 1000).toFixed(1);
    log(`⏱️  Job ${jobName} finalizado em ${elapsed}s${timedOut ? ' (TIMEOUT)' : ''}\n`);
  }
}

// ─── Cron job functions ────────────────────────────────────
function printJobSummary(title, classes, results) {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  console.log('\n╔═════════════════════════════════════════════════════╗');
  console.log(`║  📋 Confirmação: ${title.padEnd(35)}║`);
  console.log(`║  ${ts.padEnd(52)}║`);
  console.log('╠═════════════════════════════════════════════════════╣');
  if (classes.length === 0) {
    console.log('║  📭 Sem experimental para o período.                ║');
  } else {
    (results.details || []).forEach(d => {
      const icon = d.status === 'sent' ? '✅' : d.status === 'failed' ? '❌' : '⏭️ ';
      const c = classes.find(cl => cl.name === d.name) || {};
      const linha = `${icon} ${d.name} | ${c.time || '--:--'}`;
      console.log(`║  ${linha.padEnd(51)}║`);
    });
    console.log('╠═════════════════════════════════════════════════════╣');
    console.log(`║  ✅ Enviadas: ${String(results.sent || 0).padEnd(6)} ❌ Falhas: ${String(results.failed || 0).padEnd(6)} ⏭️  Puladas: ${String(results.skipped || 0).padEnd(4)}║`);
  }
  console.log('╚═════════════════════════════════════════════════════╝\n');
}

/**
 * Lê algo do EVO com retry (navegador novo a cada tentativa). O puppeteer solta
 * "detached Frame" quando o frame morre na navegação — sem retry, o job morria
 * na 1ª falha e a lead não recebia a confirmação. Tenta até 3x.
 */
async function scrapeComRetry(fn, label) {
  let ultimo;
  for (let t = 1; t <= 3; t++) {
    const scraper = new EvoScraper();
    try {
      await scraper.init();
      await scraper.login();
      return await fn(scraper);
    } catch (e) {
      ultimo = e;
      log(`⚠️  ${label}: tentativa ${t}/3 falhou: ${e.message}`);
      if (t < 3) await new Promise(r => setTimeout(r, 20000));
    } finally {
      try { await scraper.close(); } catch (_) { /* ignore */ }
    }
  }
  throw ultimo;
}

async function executeMorningJob() {
  const classes = await scrapeComRetry(s => s.getTodayAfternoonClasses(), 'Confirmação HOJE');
  if (classes.length === 0) { printJobSummary('Hoje (após 12h)', [], {}); return; }

  const whatsapp = new WhatsAppSender(); // conexão própria deste job
  try {
    await whatsapp.init();
    const results = await whatsapp.sendBulkMessages(classes, config.messagesToday);
    printJobSummary('Hoje (após 12h)', classes, results);
  } finally {
    try { await whatsapp.close(); } catch (e) { /* ignore */ }
  }
}

async function executeAfternoonJob() {
  const classes = await scrapeComRetry(s => s.getTomorrowMorningClasses(), 'Confirmação AMANHÃ');
  if (classes.length === 0) { printJobSummary('Amanhã (até 11:30)', [], {}); return; }

  const whatsapp = new WhatsAppSender(); // conexão própria deste job
  try {
    await whatsapp.init();
    const results = await whatsapp.sendBulkMessages(classes, config.messagesTomorrow);
    printJobSummary('Amanhã (até 11:30)', classes, results);
  } finally {
    try { await whatsapp.close(); } catch (e) { /* ignore */ }
  }
}

// ─── Confirmação de aula experimental (fila ZEE/EVO + formulário) ──────────
// Lê a fila `confirmacoes_outbox.jsonl` e envia pela linha do STUDIO (WhatsApp,
// porta 9226 — mesma conexão dos outros jobs). Só abre o WhatsApp se houver
// mensagem pendente. Idempotente (o próprio enviar_confirmacoes marca o que já
// enviou em `_enviados.json`; em falha, não marca -> re-tenta no próximo ciclo).
async function executeExperimentalConfirmJob() {
  const { enviarConfirmacoes, contarPendentes } = require('./enviar_confirmacoes');

  const pendentes = contarPendentes();
  if (pendentes === 0) {
    console.log('[confirmacoes] fila vazia — nada a enviar.');
    return;
  }
  console.log(`[confirmacoes] ${pendentes} pendente(s) — conectando ao WhatsApp do Studio...`);

  const whatsapp = new WhatsAppSender(); // conexão própria deste job (porta 9226)
  try {
    await whatsapp.init();
    await enviarConfirmacoes(whatsapp.page);
  } finally {
    try { await whatsapp.close(); } catch (e) { /* ignore */ }
  }
}

// ─── Registro de "o scheduler estava vivo até quando" ──────────────────────
// Um job só é REALMENTE perdido se o processo estava PARADO no horário dele.
// Sem isso, todo restart listava como "perdidos" jobs que já tinham rodado
// normalmente naquele dia (ruído no log e risco de reexecutar por engano).
const ALIVE_FILE = path.join(LOG_DIR, 'scheduler-alive.json');

function lerUltimoVivo() {
  try {
    const d = JSON.parse(fs.readFileSync(ALIVE_FILE, 'utf8'));
    const t = new Date(d.ts);
    return isNaN(t) ? null : t;
  } catch { return null; }
}

function marcarVivo() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(ALIVE_FILE, JSON.stringify({ ts: new Date().toISOString() }), 'utf8');
  } catch (_) { /* não é crítico */ }
}

// ─── Missed Cron Detection ─────────────────────────────────
/**
 * Verifica se algum job deveria ter rodado hoje mas foi perdido
 * (ex: processo morreu durante a noite e reiniciou após o horário).
 *
 * Cada job tem um horário previsto e os dias da semana em que roda.
 * Se agora estamos após o horário previsto (com margem de até 8h),
 * e o dia da semana é válido, executa o job imediatamente.
 */
function checkMissedCrons() {
  const now = new Date();
  // Horário atual em São Paulo
  const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const currentDay = spNow.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const currentMinutes = spNow.getHours() * 60 + spNow.getMinutes();

  const jobs = [
    {
      name: 'Confirmação — aulas de HOJE (após 12h)',
      horario: '08:30',
      cron: config.schedule.morning,
      scheduledMinutes: 8 * 60 + 30,
      validDays: [1, 2, 3, 4, 5, 6],
      executor: executeMorningJob,
    },
    {
      name: 'Confirmação — aulas de AMANHÃ (até 11:30)',
      horario: '15:30',
      cron: config.schedule.afternoon,
      scheduledMinutes: 15 * 60 + 30,
      validDays: [0, 1, 2, 3, 4, 5],
      executor: executeAfternoonJob,
    },
    {
      name: 'Follow-up pós-aula — MANHÃ (com áudio)',
      horario: '10:30',
      cron: config.schedule.followupMorning,
      scheduledMinutes: 10 * 60 + 30,
      validDays: [1, 2, 3, 4, 5, 6],
      executor: () => require('./followup-experimental').runFollowupMorning(),
    },
    {
      name: 'Follow-up pós-aula — TARDE (com áudio)',
      horario: '16:00',
      cron: config.schedule.followupAfternoon,
      scheduledMinutes: 16 * 60,
      validDays: [1, 2, 3, 4, 5, 6],
      executor: () => require('./followup-experimental').runFollowupAfternoon(),
    },
    {
      name: 'Faltas (no-show) — MANHÃ',
      horario: '11:30',
      cron: config.schedule.noShowMorning,
      scheduledMinutes: 11 * 60 + 30,
      validDays: [1, 2, 3, 4, 5, 6],
      executor: () => require('./follow-up-no-show').runNoShowMorning(),
    },
    {
      name: 'Faltas (no-show) — TARDE/NOITE',
      horario: '19:30',
      cron: config.schedule.noShowAfternoon,
      scheduledMinutes: 19 * 60 + 30,
      validDays: [1, 2, 3, 4, 5, 6],
      executor: () => require('./follow-up-no-show').runNoShowAfternoon(),
    },
    {
      name: 'Renovação de contratos (vencendo na semana)',
      horario: '17:00',
      cron: config.schedule.renewal,
      scheduledMinutes: 17 * 60,
      validDays: [1], // Segunda-feira
      executor: () => require('./renovar-contratos').runRenovacao(),
    },
    {
      name: 'Instagram — boas-vindas a novos seguidores',
      horario: '07:00',
      cron: config.schedule.instagram,
      scheduledMinutes: 7 * 60,
      validDays: [0, 1, 2, 3, 4, 5, 6], // todos os dias
      executor: () => require('./instagram-boasvindas').runBoasVindas(),
    },
    {
      name: 'Aniversariantes — parabéns nos grupos',
      horario: '08:00',
      cron: config.schedule.aniversariantes,
      scheduledMinutes: 8 * 60,
      validDays: [0, 1, 2, 3, 4, 5, 6], // todos os dias
      executor: () => require('./aniversariantes').runAniversariantes(),
    },
    {
      name: 'Planilha — alunas ativas & aniversários',
      horario: '14:00',
      cron: config.schedule.planilhaAniv,
      scheduledMinutes: 14 * 60,
      validDays: [0, 1, 2, 3, 4, 5, 6], // todos os dias
      executor: () => require('./planilha-aniversarios').runPlanilhaAniversarios(),
    },
  ];

  const MAX_DELAY_MINUTES = 8 * 60; // Executa se atrasou até 8 horas
  const missedJobs = [];

  // Até que minuto de HOJE o scheduler esteve rodando? Se ele estava vivo no
  // horário do job, o cron disparou — logo o job NÃO foi perdido (se falhou, é
  // outro assunto, e reexecutar aqui só duplicaria mensagem).
  const ultimoVivo = lerUltimoVivo();
  let vivoAteMin = -1;
  if (ultimoVivo) {
    const vivoSp = new Date(ultimoVivo.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const mesmoDia = vivoSp.toDateString() === spNow.toDateString();
    vivoAteMin = mesmoDia ? vivoSp.getHours() * 60 + vivoSp.getMinutes()
                          : -1;   // parou ontem ou antes → tudo de hoje é candidato
  }

  for (const job of jobs) {
    if (!job.validDays.includes(currentDay)) continue;

    const delay = currentMinutes - job.scheduledMinutes;
    if (delay <= 0 || delay > MAX_DELAY_MINUTES) continue;

    // O processo estava no ar quando o job deveria rodar? Então já disparou.
    if (job.scheduledMinutes <= vivoAteMin) continue;

    const delayStr = delay < 60
      ? `${delay}min`
      : `${Math.floor(delay / 60)}h${delay % 60}min`;
    log(`🔎 Job "${job.name}" perdido! Deveria ter rodado há ${delayStr}`);
    missedJobs.push(job);
  }

  if (missedJobs.length === 0 && vivoAteMin >= 0) {
    log('✅ Nenhum job perdido (o scheduler estava no ar nos horários de hoje).');
  }
  return missedJobs;
}

// ─── Pergunta interativa no terminal (com CONTAGEM REGRESSIVA) ─────────
// Mostra na tela o tempo restante, atualizando a cada segundo. Se ninguém
// responder em `timeoutMs` (padrão 180s), assume "n" (não executa) e segue —
// assim o Watchdog nunca fica travado esperando resposta.
function perguntarUsuario(pergunta, timeoutMs = 180000) {
  // Sem terminal interativo (ex.: rodando sob PM2/Xvfb no VPS) não há como
  // responder. Pula o job perdido automaticamente ("n"), sem esperar nem
  // poluir o log com a contagem regressiva.
  if (!process.stdin.isTTY) {
    console.log(`${pergunta}→ ambiente não interativo: assumindo "n" (não executar jobs perdidos).`);
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    let done = false;
    let remaining = Math.ceil(timeoutMs / 1000);

    const render = () => {
      // \r volta ao início da linha e reescreve; espaços no fim limpam sobras
      process.stdout.write(`\r${pergunta}[⏳ ${remaining}s p/ "n"]    `);
    };
    render();

    const ticker = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { finish(false); return; }
      render();
    }, 1000);

    const onData = (data) => finish(
      ['s', 'sim', 'y', 'yes'].includes(data.toString().trim().toLowerCase())
    );

    function finish(val) {
      if (done) return;
      done = true;
      clearInterval(ticker);
      process.stdout.write('\n');
      if (!val && remaining <= 0) {
        console.log('⏳ Sem resposta em 180s — assumindo "n" (não executar).');
      }
      try { process.stdin.removeListener('data', onData); process.stdin.pause(); } catch (e) {}
      resolve(val);
    }

    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  🏋️  Slimfit Setor Bueno - Confirmação Experimental  ║');
  console.log('║  Automação de confirmação via WhatsApp               ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  log('Scheduler iniciando...');

  // ─── Impedir suspensão/hibernação do Windows ──────────────
  keepAwake.enable();

  // ─── Cliente ÚNICO e PERSISTENTE do WhatsApp ──────────────
  // Sobe UMA vez aqui e fica autenticado em memória. TODOS os jobs reaproveitam
  // esta mesma sessão (nada de abrir/fechar navegador a cada envio — era isso
  // que derrubava a sessão). No shutdown, destroy() salva a sessão com segurança.
  const wa = require('./wa-client');

  const cleanup = async () => {
    keepAwake.disable();
    try { await wa.destroy(); } catch (_) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log('📱 Iniciando o cliente único do WhatsApp (aguardando "ready")...');
  try {
    await wa.initWhatsApp(); // resolve no evento 'ready' (WhatsApp Web sincronizado)
    console.log('✅ WhatsApp pronto — jobs liberados para disparar.\n');
  } catch (e) {
    logError('Falha ao iniciar o cliente do WhatsApp', e);
    console.log('⚠️  Seguindo assim mesmo; os jobs vão tentar reconectar.\n');
  }

  // ─── Verifica jobs perdidos antes de agendar ─────────────
  // (lê o registro ANTES de marcar que estamos vivos agora)
  const missedJobs = checkMissedCrons();
  marcarVivo();

  if (missedJobs.length > 0) {
    for (const job of missedJobs) {
      console.log('\n┌─────────────────────────────────────────────────────┐');
      console.log('│  ⚠️  Job perdido:                                    │');
      const linha = `│  • [${job.horario}] ${job.name}`;
      console.log(linha.padEnd(55) + '│');
      console.log('└─────────────────────────────────────────────────────┘');

      const resposta = await perguntarUsuario(`❓ Executar este job? (s/n): `);
      if (resposta) {
        log(`🚀 Executando job perdido: "${job.name}"`);
        try {
          await runJob(job.name + ' [RECUPERAÇÃO]', job.executor);
        } catch (err) {
          logError(`Falha ao recuperar job "${job.name}"`, err);
        }
      } else {
        log(`⏭️  "${job.name}" ignorado pelo usuário.`);
      }
    }
  } else {
    log('✅ Nenhum job perdido detectado.');
  }

  // Schedule: 08:30 seg-sáb → Aulas de hoje após 12h
  cron.schedule(config.schedule.morning, () => {
    log('⏰ Cron disparado: Job Manhã');
    runJob('Manhã (hoje)', executeMorningJob).catch(err => {
      logError('Falha crítica no job Manhã', err);
    });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job MANHÃ agendado: ${config.schedule.morning} (08:30 seg-sáb)`);
  console.log('   → Busca aulas de hoje após 12h');

  // Schedule: 15:30 dom-sex → Aulas de amanhã até 11:30
  cron.schedule(config.schedule.afternoon, () => {
    log('⏰ Cron disparado: Job Tarde');
    runJob('Tarde (amanhã)', executeAfternoonJob).catch(err => {
      logError('Falha crítica no job Tarde', err);
    });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job TARDE agendado: ${config.schedule.afternoon} (15:30 dom-sex)`);
  console.log('   → Busca aulas de amanhã até 11:30');

  // Schedule: 10:30 seg-sáb → Follow-up presença manhã (ontem antes das 12h)
  cron.schedule(config.schedule.followupMorning, () => {
    log('⏰ Cron disparado: Follow-up Manhã');
    if (jobRunning) { log('⚠️  Follow-up Manhã ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    runFollowupMorning()
      .then(() => log('✅ Follow-up Manhã concluído'))
      .catch(err => logError('Follow-up Manhã', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Follow-up Manhã finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job FOLLOW-UP MANHÃ agendado: ${config.schedule.followupMorning} (10:30 seg-sáb)`);
  console.log('   → Follow-up de ontem (aulas antes das 12h) com Presença');

  // Schedule: 16:00 seg-sáb → Follow-up presença tarde (ontem a partir das 12h)
  cron.schedule(config.schedule.followupAfternoon, () => {
    log('⏰ Cron disparado: Follow-up Tarde');
    if (jobRunning) { log('⚠️  Follow-up Tarde ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    runFollowupAfternoon()
      .then(() => log('✅ Follow-up Tarde concluído'))
      .catch(err => logError('Follow-up Tarde', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Follow-up Tarde finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job FOLLOW-UP TARDE agendado: ${config.schedule.followupAfternoon} (16:00 seg-sáb)`);
  console.log('   → Follow-up de ontem (aulas a partir das 12h) com Presença');

  // Schedule: 11:30 seg-sáb → Faltas (no-show) das aulas da MANHÃ
  cron.schedule(config.schedule.noShowMorning, () => {
    log('⏰ Cron disparado: Faltas (no-show) Manhã');
    if (jobRunning) { log('⚠️  No-show Manhã ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    runNoShowMorning()
      .then(() => log('✅ Faltas Manhã concluído'))
      .catch(err => logError('No-show Manhã', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Faltas Manhã finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job FALTAS MANHÃ agendado: ${config.schedule.noShowMorning} (11:30 seg-sáb)`);
  console.log('   → Faltas das aulas da manhã → convida a remarcar');

  // Schedule: 19:30 seg-sáb → Faltas (no-show) das aulas da TARDE/NOITE
  cron.schedule(config.schedule.noShowAfternoon, () => {
    log('⏰ Cron disparado: Faltas (no-show) Tarde/Noite');
    if (jobRunning) { log('⚠️  No-show Tarde/Noite ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    runNoShowAfternoon()
      .then(() => log('✅ Faltas Tarde/Noite concluído'))
      .catch(err => logError('No-show Tarde/Noite', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Faltas Tarde/Noite finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job FALTAS TARDE/NOITE agendado: ${config.schedule.noShowAfternoon} (19:30 seg-sáb)`);
  console.log('   → Faltas da tarde/noite → convida a remarcar');

  // Schedule: 14:30 todos os dias → Renovação (avisa quem vence em exatos 7 dias)
  cron.schedule(config.schedule.renewal, () => {
    log('⏰ Cron disparado: Renovação de contratos');
    if (jobRunning) { log('⚠️  Renovação ignorada — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./renovar-contratos').runRenovacao()
      .then(() => log('✅ Renovação de contratos concluída'))
      .catch(err => logError('Renovação de contratos', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Renovação finalizada em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job RENOVAÇÃO agendado: ${config.schedule.renewal} (14:30 todos os dias)`);
  console.log('   → Avisa a aluna 7 dias antes do vencimento do contrato');

  // Schedule: 16:15 quarta → Convocatória do Circuito (busca a professora de
  // sábado na Grade > Horários e posta no grupo "Circuito Slim").
  if (config.schedule.circuitoConvoca) {
    cron.schedule(config.schedule.circuitoConvoca, () => {
      log('⏰ Cron disparado: Circuito — convocatória');
      agendarCircuitoConvocacao();
    }, { timezone: 'America/Sao_Paulo' });
    log(`📅 Job CIRCUITO (convocatória) agendado: ${config.schedule.circuitoConvoca} (16:15 quarta)`);
    console.log('   → Convoca para o Circuito de sábado, com o nome da professora');
  }

  // Schedule: 16:15 sexta → Lembrete "É amanhã!" no grupo "Circuito Slim".
  // Só posta no grupo (não usa o EVO), então roda independente do jobRunning.
  if (config.schedule.circuitoLembrete) {
    cron.schedule(config.schedule.circuitoLembrete, () => {
      log('⏰ Cron disparado: Circuito — lembrete');
      require('./enviar-circuito').runCircuitoLembrete()
        .then(() => log('✅ Circuito lembrete enviado'))
        .catch(err => logError('Circuito lembrete', err));
    }, { timezone: 'America/Sao_Paulo' });
    log(`📅 Job CIRCUITO (lembrete) agendado: ${config.schedule.circuitoLembrete} (16:15 sexta)`);
    console.log('   → Lembrete "é amanhã" no grupo Circuito Slim');
  }

  // Schedule: 10:45 (manhã) e 15:45 (tarde) → dispara os ENVIOS AGENDADOS no
  // painel para o dia+turno atual (texto ou foto com legenda).
  function agendarEnvios(turno, label) {
    cron.schedule(turno === 'manha' ? config.schedule.agendadosManha : config.schedule.agendadosTarde, () => {
      log(`⏰ Cron disparado: Envios agendados — ${turno}`);
      if (jobRunning) { log(`⚠️  Agendados (${turno}) ignorado — outro job em execução`); return; }
      jobRunning = true;
      const start = new Date();
      require('./enviar-agendados').runAgendados(turno)
        .then(r => log(`✅ Envios agendados (${turno}) concluído — ${r.enviados} enviado(s), ${r.falhas} falha(s)`))
        .catch(err => logError(`Envios agendados (${turno})`, err))
        .finally(() => { jobRunning = false; log(`⏱️  Agendados (${turno}) em ${((new Date() - start) / 1000).toFixed(1)}s\n`); });
    }, { timezone: 'America/Sao_Paulo' });
    log(`📅 Job ENVIOS AGENDADOS (${turno}) agendado: ${label}`);
  }
  if (config.schedule.agendadosManha) agendarEnvios('manha', '10:45 todos os dias');
  if (config.schedule.agendadosTarde) agendarEnvios('tarde', '15:45 todos os dias');

  // Schedule: a cada 5 min (05h-22h) → calcula a grade de horários NO VPS e
  // ENVIA pronta para o formulário (Render). Assim a aluna vê os horários na
  // hora, sem a Render calcular (lento). É leve e NÃO usa o navegador/WhatsApp,
  // então roda independente do jobRunning dos jobs pesados.
  if (config.schedule.slotsPush) {
    cron.schedule(config.schedule.slotsPush, runSlotsPush, { timezone: 'America/Sao_Paulo' });
    log(`📅 Job GRADE→FORMULÁRIO agendado: ${config.schedule.slotsPush} (a cada 10 min, 24h)`);
    console.log('   → Calcula os horários e envia prontos ao formulário de agendamento');
    // Empurra uma vez já no start (após restart, o formulário fica pronto logo).
    setTimeout(runSlotsPush, 15000);
  }

  // Schedule: 07:00 todos os dias → Boas-vindas a novos seguidores do Instagram.
  // DESLIGADO por padrão: a Meta bloqueia o navegador do VPS com 429. Religue
  // com IG_ENABLED=true no .env quando tiver solução (PC de casa ou proxy).
  if (process.env.IG_ENABLED === 'true') {
    cron.schedule(config.schedule.instagram, () => {
      log('⏰ Cron disparado: Instagram boas-vindas');
      if (jobRunning) { log('⚠️  Instagram ignorado — outro job em execução'); return; }
      jobRunning = true;
      const start = new Date();
      require('./instagram-boasvindas').runBoasVindas()
        .then(() => log('✅ Instagram boas-vindas concluído'))
        .catch(err => logError('Instagram boas-vindas', err))
        .finally(() => {
          jobRunning = false;
          log(`⏱️  Instagram finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
        });
    }, { timezone: 'America/Sao_Paulo' });
    log(`📅 Job INSTAGRAM agendado: ${config.schedule.instagram} (07:00 todos os dias)`);
    console.log('   → Boas-vindas a novos seguidores (perfil logado no Instagram)');
  } else {
    log('⏸️  Job INSTAGRAM DESLIGADO (defina IG_ENABLED=true no .env para religar)');
  }

  // Schedule: 08:00 todos os dias → Parabéns às aniversariantes nos grupos
  cron.schedule(config.schedule.aniversariantes, () => {
    log('⏰ Cron disparado: Aniversariantes');
    if (jobRunning) { log('⚠️  Aniversariantes ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./aniversariantes').runAniversariantes()
      .then(() => log('✅ Aniversariantes concluído'))
      .catch(err => logError('Aniversariantes', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Aniversariantes finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job ANIVERSARIANTES agendado: ${config.schedule.aniversariantes} (08:00 todos os dias)`);
  console.log('   → Parabéns nos grupos em comum (perfil SlimFit)');

  // Schedule: 06:30 segunda → Planilha Google de alunas ativas + aniversários
  cron.schedule(config.schedule.planilhaAniv, () => {
    log('⏰ Cron disparado: Planilha de aniversários');
    if (jobRunning) { log('⚠️  Planilha ignorada — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./planilha-aniversarios').runPlanilhaAniversarios()
      .then(() => log('✅ Planilha de aniversários concluída'))
      .catch(err => logError('Planilha de aniversários', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Planilha finalizada em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job PLANILHA agendado: ${config.schedule.planilhaAniv} (14:00 todos os dias)`);
  console.log('   → Alunas ativas + aniversários → Google Sheets (preserva sua coluna)');

  // Schedule: 05:30 todo dia 01 → Lista de aniversariantes do mês no grupo da equipe
  cron.schedule(config.schedule.aniversMesGrupo, () => {
    log('⏰ Cron disparado: Aniversariantes do mês (grupo da equipe)');
    if (jobRunning) { log('⚠️  Aniversariantes-mês ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./aniversariantes-mes-grupo').runEquipeAniversariantesMes()
      .then(() => log('✅ Aniversariantes do mês (grupo) concluído'))
      .catch(err => logError('Aniversariantes do mês (grupo)', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Aniversariantes-mês finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job ANIVERSARIANTES-MÊS agendado: ${config.schedule.aniversMesGrupo} (05:30 dia 28)`);
  console.log('   → Lista de aniversariantes do mês no grupo "SlimFit Equipe" (perfil das confirmações)');

  // Schedule: 06:45 toda segunda → Presentes de tempo de casa pendentes no grupo
  cron.schedule(config.schedule.presentesPend, () => {
    log('⏰ Cron disparado: Presentes pendentes (grupo da equipe)');
    if (jobRunning) { log('⚠️  Presentes pendentes ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./presentes-pendentes-grupo').runPresentesPendentes()
      .then(() => log('✅ Presentes pendentes concluído'))
      .catch(err => logError('Presentes pendentes', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Presentes pendentes finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job PRESENTES agendado: ${config.schedule.presentesPend} (06:45 segunda)`);
  console.log('   → Presentes de tempo de casa pendentes no grupo "SlimFit Equipe"');

  // Schedule: 16:30 toda sexta → Resumo da semana no grupo da equipe
  cron.schedule(config.schedule.resumoSemana, () => {
    log('⏰ Cron disparado: Resumo da semana');
    if (jobRunning) { log('⚠️  Resumo da semana ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./resumo-semana').runResumoSemana()
      .then(() => log('✅ Resumo da semana concluído'))
      .catch(err => logError('Resumo da semana', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Resumo da semana finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job RESUMO SEMANA agendado: ${config.schedule.resumoSemana} (16:30 sexta)`);
  console.log('   → Resumo da semana das experimentais no grupo "SlimFit Equipe"');

  // Schedule: 06:10 toda segunda → Alunas ausentes há 10+ dias no grupo da equipe
  cron.schedule(config.schedule.ausentes10, () => {
    log('⏰ Cron disparado: Ausentes 10 dias');
    if (jobRunning) { log('⚠️  Ausentes 10 dias ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./ausentes-10-dias').runAusentes10Dias()
      .then(() => log('✅ Ausentes 10 dias concluído'))
      .catch(err => logError('Ausentes 10 dias', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Ausentes 10 dias finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job AUSENTES 10 DIAS agendado: ${config.schedule.ausentes10} (06:10 segunda)`);
  console.log('   → Alunas ativas ausentes há 10+ dias no grupo "SlimFit Equipe"');

  // Schedule: 19:45 todos os dias → Resumo do dia das experimentais no grupo
  cron.schedule(config.schedule.resumoDia, () => {
    log('⏰ Cron disparado: Resumo do dia');
    if (jobRunning) { log('⚠️  Resumo do dia ignorado — outro job em execução'); return; }
    jobRunning = true;
    const start = new Date();
    require('./resumo-dia').runResumoDia()
      .then(() => log('✅ Resumo do dia concluído'))
      .catch(err => logError('Resumo do dia', err))
      .finally(() => {
        jobRunning = false;
        log(`⏱️  Resumo do dia finalizado em ${((new Date() - start) / 1000).toFixed(1)}s\n`);
      });
  }, { timezone: 'America/Sao_Paulo' });

  log(`📅 Job RESUMO DO DIA agendado: ${config.schedule.resumoDia} (19:45 todos os dias)`);
  console.log('   → Reposições, experimentais (fizeram/faltaram) e fechamentos no grupo "SlimFit Equipe"');

  // A cada 15 min → envia as confirmações de aula experimental (fila ZEE/EVO + formulário)
  cron.schedule('*/15 * * * *', () => {
    log('⏰ Cron disparado: Confirmação Aula Experimental');
    runJob('Confirmação Aula Experimental', executeExperimentalConfirmJob).catch(err => {
      logError('Falha crítica no job Confirmação Aula Experimental', err);
    });
  }, { timezone: 'America/Sao_Paulo' });

  log('📅 Job CONFIRMAÇÃO EXPERIMENTAL agendado: a cada 15 min');
  console.log('   → Lê confirmacoes_outbox.jsonl e envia pelo WhatsApp do Studio (8550-8065)');

  // ─── Ponte com a nuvem: puxa as confirmações do FORMULÁRIO a cada 1 min ─────
  // Substitui o script Python (puxar_confirmacoes.py) e a janela de terminal
  // separada. É LEVE (só HTTP + gravar no arquivo, NÃO mexe no WhatsApp), então
  // roda FORA do runJob/lock, independente dos demais jobs. Precisa ser ~1 min
  // (não 15): o Render free dorme após ~15 min e APAGA a fila da nuvem; puxar de
  // 1 em 1 min traz a confirmação antes disso E mantém o Render acordado.
  let pullingNuvem = false;
  const puxarNuvem = async () => {
    if (pullingNuvem) return;                 // evita sobreposição se um ciclo demorar
    pullingNuvem = true;
    try { await pullConfirmacoesNuvem(); }
    catch (err) { logError('Ponte de confirmações (nuvem)', err); }
    finally { pullingNuvem = false; }
  };
  cron.schedule('* * * * *', puxarNuvem, { timezone: 'America/Sao_Paulo' });
  puxarNuvem(); // puxa uma vez já no boot (não espera o 1º minuto)

  log('📡 Ponte de confirmações (nuvem) agendada: a cada 1 min');
  console.log('   → Puxa as marcações do formulário (Render) p/ confirmacoes_outbox.jsonl');

  // ─── Heartbeat: log a cada 15 minutos para saber que o processo está vivo ───
  const HEARTBEAT_INTERVAL = 15 * 60 * 1000; // 15 min
  setInterval(() => {
    const mem = process.memoryUsage();
    const mbUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
    log(`💓 Heartbeat — Memória: ${mbUsed}MB | PID: ${process.pid} | Uptime: ${(process.uptime() / 3600).toFixed(1)}h`);
    marcarVivo();   // registra que estamos no ar (base do detector de jobs perdidos)
  }, HEARTBEAT_INTERVAL);

  log('✅ Agendador rodando. Pressione Ctrl+C para parar.\n');

  // ─── Keepalive: impede que o event loop fique vazio ──────
  // O setInterval do heartbeat já garante isso, mas por segurança:
  const keepalive = setInterval(() => {}, 60000);
  keepalive.unref(); // Não impede exit se tudo mais parar
}

main().catch(err => {
  logError('Erro fatal no main', err);
  process.exit(1);
});

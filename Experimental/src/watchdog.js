/**
 * watchdog.js — VIGIA EXTERNO do robô (rodado pelo cron do sistema, não pelo PM2).
 *
 * Por que externo? Se o processo do robô (slimfit-exp) cair de vez, nada DENTRO
 * dele pode avisar. Então este script roda separado (cron a cada 5 min), confere
 * pelo pm2 se os processos estão de pé e se o WhatsApp não está caído há muito
 * tempo, e manda um push (ntfy) quando algo está errado — e outro quando volta.
 *
 * De-duplicação: guarda o estado em data/watchdog-estado.json e só alerta quando
 * um problema APARECE (não repete a cada 5 min); manda "recuperado" quando some.
 *
 * Rodar pelo cron do sistema a cada 5 min (a linha exata do crontab está no
 * runbook / na aba de implantação). Ele só lê arquivos e consulta o pm2 — leve.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const notif = require('./notificar');
const waStatus = require('./wa-status');

const ESTADO_FILE = path.resolve(__dirname, '..', 'data', 'watchdog-estado.json');
const PROCESSOS = (process.env.WATCHDOG_PROCS || 'slimfit-exp,slimfit-painel').split(',').map(s => s.trim()).filter(Boolean);
const WA_MAX_MIN = parseInt(process.env.WATCHDOG_WA_MIN || '30', 10); // WhatsApp caído por mais que isso → alerta
const PM2_BIN = process.env.PM2_BIN || 'pm2';

function lerEstado() {
  try { const o = JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function salvarEstado(o) {
  try {
    const dir = path.dirname(ESTADO_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ESTADO_FILE, JSON.stringify(o, null, 2), 'utf8');
  } catch (_) { /* não é crítico */ }
}

function pm2List() {
  return new Promise(resolve => {
    execFile(PM2_BIN, ['jlist'], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch (_) { resolve(null); }
    });
  });
}

async function detectar() {
  const problemas = {}; // chave → { titulo, msg }
  const list = await pm2List();

  if (list === null) {
    problemas['pm2'] = {
      titulo: 'PM2 nao respondeu',
      msg: 'Nao consegui consultar o pm2 (pm2 jlist falhou). Verifique o servidor e o PATH do cron.',
    };
    return problemas; // sem pm2 não dá pra saber dos processos
  }

  for (const nome of PROCESSOS) {
    const p = list.find(x => x && x.name === nome);
    const status = p && p.pm2_env && p.pm2_env.status;
    if (!p) {
      problemas['proc:' + nome] = { titulo: nome + ' fora do PM2', msg: nome + ' nao aparece no pm2. Rode no servidor: pm2 resurrect (ou pm2 start).' };
    } else if (status !== 'online') {
      problemas['proc:' + nome] = { titulo: nome + ' esta ' + (status || '?'), msg: 'O processo ' + nome + ' esta "' + status + '" (deveria ser online). Rode: pm2 restart ' + nome + '.' };
    }
  }

  // Só checa o WhatsApp se o robô estiver online (senão o problema já é o processo).
  const exp = list.find(x => x && x.name === 'slimfit-exp');
  if (exp && exp.pm2_env && exp.pm2_env.status === 'online') {
    const st = waStatus.get() || {};
    if (st.estado === 'desconectado' || st.estado === 'qr') {
      const idadeMin = st.atualizadoEm ? (Date.now() - new Date(st.atualizadoEm).getTime()) / 60000 : 999;
      if (idadeMin >= WA_MAX_MIN) {
        problemas['wa'] = st.estado === 'qr'
          ? { titulo: 'WhatsApp pedindo QR ha ' + Math.round(idadeMin) + ' min', msg: 'A sessao caiu e o QR espera ha ' + Math.round(idadeMin) + ' min. Abra o painel (aba WhatsApp) e escaneie — ate la nenhuma mensagem sai.' }
          : { titulo: 'WhatsApp desconectado ha ' + Math.round(idadeMin) + ' min', msg: 'O WhatsApp esta desconectado ha ' + Math.round(idadeMin) + ' min. Veja o painel (aba WhatsApp) ou o servidor.' };
      }
    }
  }

  return problemas;
}

async function main() {
  const anterior = lerEstado();
  const ativosAnt = anterior.ativos || {};
  const problemas = await detectar();

  // Problemas NOVOS → alerta (urgente).
  for (const chave of Object.keys(problemas)) {
    if (!ativosAnt[chave]) {
      await notif.alertar(problemas[chave].titulo, problemas[chave].msg, { prioridade: 'urgent', tags: 'rotating_light', forcar: true });
      console.log('[watchdog] ALERTA: ' + problemas[chave].titulo);
    }
  }
  // Problemas que SUMIRAM → recuperado.
  for (const chave of Object.keys(ativosAnt)) {
    if (!problemas[chave]) {
      await notif.alertar('Recuperado: ' + (ativosAnt[chave].titulo || chave), 'O problema anterior foi resolvido — tudo normal agora.', { prioridade: 'default', tags: 'white_check_mark', forcar: true });
      console.log('[watchdog] recuperado: ' + (ativosAnt[chave].titulo || chave));
    }
  }

  const ativos = {};
  for (const chave of Object.keys(problemas)) ativos[chave] = { titulo: problemas[chave].titulo };
  salvarEstado({ ativos, verificadoEm: new Date().toISOString() });

  const n = Object.keys(problemas).length;
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[watchdog ${ts}] ` + (n ? `⚠️ ${n} problema(s): ${Object.values(problemas).map(p => p.titulo).join(' | ')}` : '✅ tudo ok'));
}

main().catch(e => { console.error('[watchdog] erro:', e && e.message); process.exit(0); });

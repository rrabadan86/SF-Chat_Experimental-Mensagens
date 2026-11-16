/**
 * backup-dados.js — BACKUP local e grátis da pasta data/ (rodado pelo cron).
 *
 * As edições do painel (mensagens, horários, agendamentos, fotos, config do IG)
 * vivem só em data/ nesta VPS e NÃO vão para o git. Se o disco falhar ou a VPS
 * for recriada, some tudo. Este script compacta data/ num .tar.gz em backups/,
 * mantém as últimas N cópias e (opcional) manda um ping no ntfy.
 *
 * Sem custo: é só disco local. Se quiser cópia FORA da VPS depois, dá para
 * enviar o .tar.gz a um repositório privado — mas o backup local já cobre o
 * risco principal (edição perdida).
 *
 * Cron (exemplo — ver o runbook): backup diário às 03:10
 *   10 3 * * * cd /root/SF-Chat_Experimental-Mensagens/Experimental && \
 *     /usr/bin/node src/backup-dados.js >> logs/backup.log 2>&1
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const notif = require('./notificar');

const RAIZ = path.resolve(__dirname, '..');
const DATA = path.join(RAIZ, 'data');
const BKP = path.join(RAIZ, 'backups');
const MANTER = parseInt(process.env.BACKUP_MANTER || '14', 10); // quantas cópias guardar

function carimbo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// Pasta da SoFIA (conversas do painel, campanhas, histórico de tags, custos…): vive
// FORA de data/ (SOFIA_DIR, ex.: /root/sofia-data) e não tinha cópia nenhuma. Vai
// num arquivo à parte, sofia-<data>.tar.gz, só com os DADOS (sem código, sessão do
// WhatsApp, node_modules nem .env). Restaurar: tar -xzf backups/sofia-<data>.tar.gz -C <pasta acima da SoFIA>
const SOFIA = path.resolve(process.env.SOFIA_DIR || path.join(RAIZ, '..', 'ChatBot'));
function comprimirSofia(destino) {
  return new Promise((resolve, reject) => {
    const fora = ['node_modules', '.wwebjs_auth', '.wwebjs_cache', 'edge-wa', '.git', '*.ts', '.env', '*.env', 'backup-*', 'backups', '*.log', '*.tmp'];
    const args = ['-czf', destino, ...fora.map(f => '--exclude=' + f), '-C', path.dirname(SOFIA), path.basename(SOFIA)];
    execFile('tar', args, { timeout: 300000 }, (err) => err ? reject(err) : resolve());
  });
}
function rotacionar(prefixo) {
  const arquivos = fs.readdirSync(BKP).filter(f => f.startsWith(prefixo + '-') && f.endsWith('.tar.gz')).sort();
  for (const f of arquivos.slice(0, Math.max(0, arquivos.length - MANTER))) { try { fs.unlinkSync(path.join(BKP, f)); } catch (_) {} }
  return Math.min(arquivos.length, MANTER);
}

function comprimir(destino) {
  return new Promise((resolve, reject) => {
    // -C RAIZ + "data" → o tar guarda o caminho "data/..." (restaura no lugar certo)
    execFile('tar', ['-czf', destino, '-C', RAIZ, 'data'], { timeout: 120000 }, (err) => err ? reject(err) : resolve());
  });
}

async function main() {
  if (!fs.existsSync(DATA)) { console.log('[backup] pasta data/ não existe — nada a fazer.'); return; }
  if (!fs.existsSync(BKP)) fs.mkdirSync(BKP, { recursive: true });

  const destino = path.join(BKP, `data-${carimbo()}.tar.gz`);
  await comprimir(destino);

  // Rotaciona: mantém só as MANTER cópias mais recentes.
  const arquivos = fs.readdirSync(BKP).filter(f => /^data-.*\.tar\.gz$/.test(f)).sort(); // (sofia-*.tar.gz roda à parte)
  const excedente = arquivos.slice(0, Math.max(0, arquivos.length - MANTER));
  for (const f of excedente) { try { fs.unlinkSync(path.join(BKP, f)); } catch (_) {} }

  // SoFIA: falha aqui não derruba o backup de data/ — só avisa.
  if (fs.existsSync(path.join(SOFIA, 'sofia-conversas.json')) || fs.existsSync(path.join(SOFIA, 'campanhas.json'))) {
    const destS = path.join(BKP, `sofia-${carimbo()}.tar.gz`);
    try {
      await comprimirSofia(destS);
      const n = rotacionar('sofia');
      console.log(`[backup] SoFIA ok: ${destS} (${(fs.statSync(destS).size / 1024).toFixed(0)} KB, de ${SOFIA}). Guardando ${n} cópia(s).`);
    } catch (e) {
      console.error('[backup] SoFIA FALHOU:', e && e.message);
      try { await notif.alertar('Backup da SoFIA FALHOU', (e && e.message) || 'erro no backup da pasta da SoFIA.', { prioridade: 'high', tags: 'warning', forcar: true }); } catch (_) {}
    }
  } else console.log(`[backup] pasta da SoFIA sem dados em ${SOFIA} — pulei.`);

  const tamKB = (fs.statSync(destino).size / 1024).toFixed(0);
  const guardadas = Math.min(arquivos.length, MANTER);
  console.log(`[backup] ok: ${destino} (${tamKB} KB). Guardando ${guardadas} cópia(s).`);

  // Ping de sucesso é opcional (evita push diário). Ligue com BACKUP_NTFY_OK=true.
  if (process.env.BACKUP_NTFY_OK === 'true') {
    await notif.alertar('Backup dos dados ok', `Backup salvo (${tamKB} KB). ${guardadas} cópia(s) guardada(s) em backups/.`, { prioridade: 'low', tags: 'floppy_disk' });
  }
}

main().catch(e => {
  console.error('[backup] FALHOU:', e && e.message);
  // Falha em backup é importante — sempre avisa.
  try { notif.alertar('Backup dos dados FALHOU', (e && e.message) || 'erro desconhecido no backup de data/.', { prioridade: 'high', tags: 'warning', forcar: true }); } catch (_) {}
  process.exit(0);
});

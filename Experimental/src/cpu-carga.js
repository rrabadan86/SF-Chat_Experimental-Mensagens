/**
 * cpu-carga.js — mede o uso de CPU do servidor entre duas rodadas do vigia (watchdog).
 *
 * Lê /proc/stat (Linux). Entre uma rodada e outra (cron a cada 5 min) calcula:
 *   ocupada — % do tempo em que a CPU trabalhou;
 *   roubada — % "steal": tempo que a hospedagem (ex.: limite de CPU da Hostinger)
 *             tirou da máquina. Roubada alta = o servidor está sendo freado por fora.
 * Só alerta quando a soma fica alta por várias rodadas seguidas (padrão: 3 = ~15 min),
 * para não apitar por um pico de um minuto.
 *
 * .env (opcionais):
 *   WATCHDOG_CPU_PCT=85        acima disto (ocupada + roubada) conta como rodada alta
 *   WATCHDOG_CPU_RODADAS=3     quantas rodadas altas seguidas para avisar
 */
const fs = require('fs');
const os = require('os');

function ler(arquivo = '/proc/stat') {
  try {
    const linha = fs.readFileSync(arquivo, 'utf8').split('\n').find(l => /^cpu\s/.test(l));
    if (!linha) return null;
    const n = linha.trim().split(/\s+/).slice(1).map(Number);
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = n;
    return { total: user + nice + system + idle + iowait + irq + softirq + steal, ocioso: idle + iowait, steal, em: Date.now() };
  } catch (_) { return null; }
}

/**
 * anterior: { amostra, seguidas } guardado na rodada passada (ou vazio).
 * Devolve { estado (para guardar), uso: {ocupada, roubada} | null, problema | null }.
 */
function avaliar(anterior, amostra, { limite = 85, rodadas = 3, cpus = os.cpus().length || 1, carga = os.loadavg() } = {}) {
  const ant = (anterior && anterior.amostra) || null;
  let seguidas = (anterior && anterior.seguidas) || 0;
  let uso = null;
  if (ant && amostra && amostra.total > ant.total) {
    const dt = amostra.total - ant.total;
    const roubada = Math.max(0, Math.round(100 * (amostra.steal - ant.steal) / dt));
    const ocupada = Math.max(0, Math.round(100 * (dt - (amostra.ocioso - ant.ocioso)) / dt) - roubada);
    uso = { ocupada, roubada };
    // Já avisando: só dá por resolvido quando cair bem abaixo do limite (evita liga-desliga).
    const corte = seguidas >= rodadas ? limite - 15 : limite;
    seguidas = (ocupada + roubada >= corte) ? seguidas + 1 : 0;
  }
  const estado = { amostra: amostra || ant, seguidas };
  let problema = null;
  if (uso && seguidas >= rodadas) {
    const min = Math.round(((amostra.em - ((anterior && anterior.desde) || ant.em)) / 60000));
    problema = {
      titulo: 'CPU do servidor no limite',
      msg: `A CPU esta em ${uso.ocupada + uso.roubada}% ha ${seguidas} verificacoes seguidas (~${Math.max(min, seguidas * 5)} min)`
        + (uso.roubada >= 10 ? `, sendo ${uso.roubada}% tirados pela hospedagem (limite de CPU do plano)` : '')
        + `. Carga: ${carga.map(x => x.toFixed(1)).join(' / ')} para ${cpus} CPU(s).`
        + ' Envios e a SoFIA podem atrasar. Veja: pm2 monit (ou o painel da hospedagem).',
    };
  }
  if (seguidas === 1) estado.desde = ant ? ant.em : (amostra && amostra.em);
  else if (seguidas > 1) estado.desde = anterior.desde;
  return { estado, uso, problema };
}

module.exports = { ler, avaliar };

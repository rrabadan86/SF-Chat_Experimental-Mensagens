/**
 * Config da desmarcação de antecedência dos planos FREE (GRUPO 2), editável no
 * painel (sem mexer no .env).
 *
 *   horas → de quantas em quantas horas o job roda (padrão 6). Editável no painel.
 *   dias  → janela varrida a partir de hoje+2 (padrão 3 → hoje+2, +3, +4).
 *
 * Guardado em data/free-antecedencia.json.
 * Prioridade: painel (arquivo) > .env (FREE_ANTEC_HORAS / FREE_ANTEC_DIAS) > padrão.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data', 'free-antecedencia.json');
// Planos que entram (critério), editável no painel. UMA regra por linha; termos
// separados por vírgula; o plano entra se o nome contém TODOS os termos de ALGUMA
// linha. Lido pelo Python (free_antecedencia.carregar_regras).
const PLANOS_FILE = path.resolve(__dirname, '..', 'data', 'free-antecedencia-planos.txt');
// Padrão: pega os 4 planos FREE 3X GRUPO 2 e exclui os FREE 5X.
const PLANOS_PADRAO = 'free, 3x, grupo 2';

const HORAS_MIN = 1, HORAS_MAX = 24, HORAS_PADRAO = 6;
const DIAS_MIN = 1, DIAS_MAX = 30, DIAS_PADRAO = 3;

function _ler() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (_) { return {}; }
}
function _salvar(o) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(FILE, JSON.stringify(o, null, 2), 'utf8');
}
function _validoHoras(n) { return Number.isFinite(n) && n >= HORAS_MIN && n <= HORAS_MAX; }
function _validoDias(n) { return Number.isFinite(n) && n >= DIAS_MIN && n <= DIAS_MAX; }

function lerHoras() {
  const o = _ler();
  const n = Number(o && o.horas);
  if (_validoHoras(n)) return n;
  if (process.env.FREE_ANTEC_HORAS) { const e = parseInt(process.env.FREE_ANTEC_HORAS, 10); if (_validoHoras(e)) return e; }
  return HORAS_PADRAO;
}

function lerDias() {
  const o = _ler();
  const n = Number(o && o.dias);
  if (_validoDias(n)) return n;
  if (process.env.FREE_ANTEC_DIAS) { const e = parseInt(process.env.FREE_ANTEC_DIAS, 10); if (_validoDias(e)) return e; }
  return DIAS_PADRAO;
}

function salvarHoras(n) {
  const v = parseInt(n, 10);
  if (!_validoHoras(v)) throw new Error(`Informe um intervalo entre ${HORAS_MIN} e ${HORAS_MAX} horas.`);
  const o = _ler(); o.horas = v; _salvar(o);
  return v;
}

function salvarDias(n) {
  const v = parseInt(n, 10);
  if (!_validoDias(v)) throw new Error(`Informe uma janela entre ${DIAS_MIN} e ${DIAS_MAX} dias.`);
  const o = _ler(); o.dias = v; _salvar(o);
  return v;
}

// "Última rodada" — para o scheduler verificar de hora em hora e só rodar quando
// já passou o intervalo de N horas (assim mudar as horas no painel vale sem
// reiniciar o robô).
function lerUltima() {
  const o = _ler();
  const t = o && o.ultimaRodada ? new Date(o.ultimaRodada) : null;
  return (t && !isNaN(t)) ? t : null;
}
function marcarRodada(quando) {
  const o = _ler();
  o.ultimaRodada = (quando instanceof Date ? quando : new Date()).toISOString();
  _salvar(o);
}
// true se nunca rodou OU já passou (horas) desde a última rodada (margem de 1 min
// para o tick de hora em hora não "perder" por poucos segundos).
function deveRodar(horas, now) {
  const ult = lerUltima();
  if (!ult) return true;
  const passadasH = ((now || new Date()) - ult) / 3600000;
  return passadasH >= (Number(horas) - (1 / 60));
}

// Planos (critério) — texto cru, uma regra por linha. Lido pelo Python.
function lerPlanos() {
  try {
    const t = fs.readFileSync(PLANOS_FILE, 'utf8');
    // só retorna o do arquivo se tiver alguma regra de verdade (linha não-comentário)
    if (t && t.split('\n').some(l => l.trim() && !l.trim().startsWith('#'))) return t.replace(/\s+$/, '');
  } catch (_) {}
  return PLANOS_PADRAO;
}

function salvarPlanos(txt) {
  // normaliza: remove linhas vazias nas pontas, limita tamanho. Linhas vazias no
  // meio e comentários (#) são preservados. Se vier tudo vazio, grava o padrão.
  let s = String(txt == null ? '' : txt).replace(/\r\n/g, '\n').trim();
  if (s.length > 4000) throw new Error('Lista de planos muito longa.');
  const temRegra = s.split('\n').some(l => l.trim() && !l.trim().startsWith('#'));
  if (!temRegra) s = PLANOS_PADRAO;
  try { fs.mkdirSync(path.dirname(PLANOS_FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(PLANOS_FILE, s + '\n', 'utf8');
  return s;
}

module.exports = {
  lerHoras, salvarHoras, lerDias, salvarDias, FILE,
  lerUltima, marcarRodada, deveRodar,
  lerPlanos, salvarPlanos, PLANOS_FILE, PLANOS_PADRAO,
  HORAS_MIN, HORAS_MAX, HORAS_PADRAO, DIAS_MIN, DIAS_MAX, DIAS_PADRAO,
};

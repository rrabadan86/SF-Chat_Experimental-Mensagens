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

module.exports = {
  lerHoras, salvarHoras, lerDias, salvarDias, FILE,
  HORAS_MIN, HORAS_MAX, HORAS_PADRAO, DIAS_MIN, DIAS_MAX, DIAS_PADRAO,
};

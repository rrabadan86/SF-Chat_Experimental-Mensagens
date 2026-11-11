/**
 * Nomes dos processos DESTA instalação no PM2 (robô, painel, SoFIA).
 *
 * Ordem: nome exato do .env (PM2_APP_EXP / PM2_APP_PAINEL / PM2_APP_SOFIA) →
 * conferido no PM2 (o processo que roda a partir da pasta desta instalação) →
 * derivado de PM2_SLUG (<slug>-exp...) → nomes legados do Setor Bueno.
 * Ex.: no Lago Norte o robô é "lagonorte-exp"; sem PM2_SLUG no .env, o painel
 * procurava "slimfit-exp" e a Saúde mostrava "não aparece no PM2".
 */
const path = require('path');

const RAIZ_EXP = path.resolve(__dirname, '..');
const RAIZ_SOFIA = path.resolve(__dirname, '..', '..', 'ChatBot');
const slug = () => (process.env.PM2_SLUG || '').trim();

let _lista;
function listaPm2() {
  if (_lista !== undefined) return _lista;
  try { _lista = JSON.parse(require('child_process').execSync(`${process.env.PM2_BIN || 'pm2'} jlist`, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })) || []; }
  catch (_) { _lista = null; }
  return _lista;
}

function descobrir(padrao, pasta, ehEle) {
  const lista = listaPm2();
  if (!Array.isArray(lista)) return padrao;
  const daqui = lista.filter(x => {
    const e = (x && x.pm2_env) || {};
    const cwd = path.resolve(String(e.pm_cwd || '/nao'));
    return (cwd === pasta || cwd.startsWith(pasta + path.sep)) && ehEle(String(e.pm_exec_path || ''), e);
  }).map(x => x.name);
  if (daqui.includes(padrao)) return padrao;
  if (daqui.length === 1) return daqui[0];
  return padrao;
}

const cache = {};
function nome(qual) {
  if (cache[qual]) return cache[qual];
  const s = slug();
  let n;
  if (qual === 'exp') n = (process.env.PM2_APP_EXP || '').trim() || descobrir(s ? s + '-exp' : 'slimfit-exp', RAIZ_EXP, (exe) => /scheduler(-vps\.sh|\.js)$/.test(exe));
  else if (qual === 'painel') n = (process.env.PM2_APP_PAINEL || '').trim() || descobrir(s ? s + '-painel' : 'slimfit-painel', RAIZ_EXP, (exe) => /painel-mensagens\.js$/.test(exe));
  else n = (process.env.PM2_APP_SOFIA || '').trim() || descobrir(s ? s + '-sofia' : 'sofia-listener', RAIZ_SOFIA,
    (exe, e) => /sofia-listener/.test(exe) || /(^|\/)(npm|npm-cli\.js|tsx)$/.test(exe) || /listener/.test(String((e.args || []).join(' '))));
  return (cache[qual] = n);
}

module.exports = { nome };

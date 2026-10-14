/**
 * free-antecedencia.js — Desmarcação por antecedência dos planos FREE (GRUPO 2).
 *
 * A aluna de plano FREE … GRUPO 2 só pode marcar a aula com, no máximo, 1 dia de
 * antecedência. O app antigo deixa marcar qualquer dia, então este job varre a
 * grade (hoje+2 em diante), DESMARCA as marcações feitas com 2+ dias e avisa no
 * grupo da Equipe.
 *
 * A parte do EVO (varrer + desmarcar) é feita em Python (run_free_antecedencia.py);
 * aqui a gente só chama, lê o JSON e posta o resumo no grupo pela linha do robô.
 *
 * Uso direto (teste):
 *   node src/free-antecedencia.js --dry     → só lista (não desmarca, não posta)
 *   node src/free-antecedencia.js           → desmarca e posta no grupo
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const config = require('./config');
const cfg = require('./free-antecedencia-config');

const AGEND_DIR = path.resolve(__dirname, 'agendamento_evo');
const SCRIPT = path.join(AGEND_DIR, 'run_free_antecedencia.py');

// Python a usar: PREFERE o venv do agendamento (tem as dependências: requests
// etc.), senão PYTHON_BIN do .env, senão o python3 do sistema. Assim não depende
// de editar o .env em cada unidade (o Bueno, p.ex., não tem PYTHON_BIN).
function _pythonBin() {
  const venv = path.join(AGEND_DIR, '.venv', 'bin', 'python');
  try { if (fs.existsSync(venv)) return venv; } catch (_) {}
  return process.env.PYTHON_BIN || 'python3';
}

function _fmtDia(iso) {
  // "2026-10-16" → "16/10"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : String(iso || '');
}

/** Roda o Python e devolve o objeto de resultado (promise). */
function _rodarPython({ dry, dias }) {
  return new Promise((resolve, reject) => {
    const py = _pythonBin();
    const args = [SCRIPT, '--dias', String(dias)];
    if (dry) args.push('--dry');
    execFile(py, args, { cwd: AGEND_DIR, timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || '').trim();
        // O stdout é SÓ o JSON (logs vão pro stderr). Em erro de processo ainda
        // tentamos ler o JSON (o CLI imprime {ok:false,...} e sai 1).
        let obj = null;
        try { obj = JSON.parse(out.split('\n').filter(Boolean).pop()); } catch (_) {}
        if (obj) return resolve(obj);
        return reject(new Error((err && err.message) || stderr || 'sem saída do Python'));
      });
  });
}

/** Monta a mensagem do grupo a partir do resultado, usando o modelo editável
 * no painel. Variáveis: {studio} {lista} {qtd} {falhas}. */
function _montarMensagem(res) {
  const studio = config.STUDIO_NOME || 'Studio';
  const ok = (res.itens || []).filter(i => i.desmarcada === true);
  const falhasItens = (res.itens || []).filter(i => i.desmarcada === false);

  const lista = ok.map(i =>
    `❌ ${_fmtDia(i.data)} ${i.hora || '--:--'} — *${i.nome || 'aluna'}*\n     ${i.plano || ''}`
  ).join('\n');

  let falhas = '';
  if (falhasItens.length) {
    falhas = '\n\n⚠️ *Não consegui desmarcar (confiram manualmente):*\n'
      + falhasItens.map(i => `• ${_fmtDia(i.data)} ${i.hora || '--:--'} — ${i.nome || 'aluna'}${i.erro ? ' (' + i.erro + ')' : ''}`).join('\n');
  }

  let modelo;
  try { modelo = cfg.lerTexto(); } catch (_) { modelo = cfg.TEXTO_PADRAO; }
  // Se o modelo não tiver {lista}, garante que a lista apareça (não deixa a
  // mensagem sair sem os nomes por um erro de edição).
  if (modelo.indexOf('{lista}') === -1) modelo = modelo + '\n\n{lista}{falhas}';

  return modelo
    .replace(/\{studio\}/g, studio)
    .replace(/\{qtd\}/g, String(ok.length))
    .replace(/\{lista\}/g, lista)
    .replace(/\{falhas\}/g, falhas);
}

/**
 * Executa a varredura. Em modo real (dry=false) desmarca no EVO e, se houve
 * desmarcação/falha, avisa no grupo da Equipe. Retorna um resumo.
 */
async function runFreeAntecedencia({ dry = false } = {}) {
  const dias = cfg.lerDias();
  const res = await _rodarPython({ dry, dias });
  if (res.ok === false) throw new Error(res.erro || 'falha na varredura');

  const itens = res.itens || [];
  const desmarcadas = itens.filter(i => i.desmarcada === true).length;
  const falhas = itens.filter(i => i.desmarcada === false).length;

  console.log(`[free] janela ${res.inicio}→${res.fim} | ${res.turmas} turma(s), ${res.alunas} aluna(s) | `
    + `${itens.length} FREE irregular(es)` + (dry ? ' (DRY — não desmarcou)' : ` | ${desmarcadas} desmarcada(s), ${falhas} falha(s)`));
  for (const i of itens) {
    const tag = dry ? 'seria desmarcada' : (i.desmarcada ? 'DESMARCADA' : 'FALHA: ' + (i.erro || ''));
    console.log(`   ❌ ${_fmtDia(i.data)} ${i.hora || '--:--'} ${i.nome} (idMember=${i.idMember}) — ${tag}`);
  }

  // Só posta no grupo em modo real e quando houve algo a relatar.
  let postado = false;
  if (!dry && (desmarcadas > 0 || falhas > 0)) {
    try {
      const grupo = require('./grupos').equipe();
      const wa = require('./wa-client');
      await wa.sendGrupo(grupo, _montarMensagem(res), 'Planos FREE — antecedência');
      postado = true;
      console.log(`[free] resumo postado no grupo "${grupo}".`);
    } catch (e) {
      console.error('[free] falha ao postar no grupo:', e && e.message);
    }
  }

  return { total: itens.length, desmarcadas, falhas, postado, dry, janela: `${res.inicio}→${res.fim}` };
}

module.exports = { runFreeAntecedencia };

// Execução direta (teste manual)
if (require.main === module) {
  const dry = process.argv.includes('--dry');
  runFreeAntecedencia({ dry })
    .then(r => { console.log('\n✅ Concluído:', JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error('\n❌ Erro:', e && e.message); process.exit(1); });
}

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
/**
 * dedup-contatos.js — junta contatos DUPLICADOS pelo 9º dígito do celular.
 *
 * PROBLEMA: antes da correção do 9º dígito, o mesmo número podia ser gravado em
 * duas formas — com o 9 (55 + DDD + 9 + 8) e sem (55 + DDD + 8) — virando DOIS
 * cadastros do mesmo contato, com tags desencontradas. Como a SoFIA casa por
 * telefone, ela pega uma das duplicatas "na sorte" e a tag pode não bater.
 *
 * SOLUÇÃO: agrupa os contatos que são a mesma pessoa (variantes do 9), mantém UM
 * (preferindo o formato com o 9 e o que tem nome/mais tags) e MESCLA as tags dos
 * outros nele (não perde nada). Depois apaga as duplicatas.
 *
 * Uso na VPS (na pasta Experimental):
 *   node src/dedup-contatos.js --dry   → só MOSTRA o que faria (não altera)
 *   node src/dedup-contatos.js --run   → aplica de verdade (faz BACKUP antes)
 */
const fs = require('fs');
const contatos = require('./contatos');

// Forma canônica (sem o 9) para agrupar as duas variantes do mesmo número.
function canon(k) {
  const m = /^55(\d{2})(\d+)$/.exec(String(k));
  if (m && m[2].length === 9 && m[2][0] === '9') return '55' + m[1] + m[2].slice(1);
  return String(k);
}
function ehGenerico(nome) { return !nome || /^contato\s*\d*$/i.test(String(nome).trim()); }

function analisar() {
  const map = contatos.carregar();
  const grupos = {};
  for (const k of Object.keys(map)) { const c = canon(k); (grupos[c] = grupos[c] || []).push(k); }
  const dups = Object.values(grupos).filter(ks => ks.length > 1);
  return { map, dups };
}

function rodar({ dry = true } = {}) {
  const { map, dups } = analisar();
  const resumo = { grupos: dups.length, removidos: 0, exemplos: [], dry: !!dry };
  for (const keys of dups) {
    // sobrevivente: prefere COM o 9 (13 díg), depois quem tem mais tags, depois nome real
    keys.sort((a, b) => (b.length - a.length)
      || ((map[b].tags || []).length - (map[a].tags || []).length)
      || ((ehGenerico(map[a].nome) ? 0 : 1) - (ehGenerico(map[b].nome) ? 0 : 1)));
    const keep = keys[0];
    const alvo = map[keep];
    alvo.tags = Array.isArray(alvo.tags) ? alvo.tags : [];
    for (const k of keys.slice(1)) {
      const dup = map[k] || {};
      for (const t of (dup.tags || [])) if (!alvo.tags.includes(t)) alvo.tags.push(t); // mescla tags
      if (ehGenerico(alvo.nome) && !ehGenerico(dup.nome)) alvo.nome = dup.nome;         // fica com o nome real
      if (!alvo.instrucoes && dup.instrucoes) alvo.instrucoes = dup.instrucoes;
      if (!dry) delete map[k];
      resumo.removidos++;
    }
    if (resumo.exemplos.length < 20) resumo.exemplos.push({ mantido: keep, nome: alvo.nome || '', juntou: keys.slice(1), tags: alvo.tags.slice() });
  }
  if (!dry && resumo.removidos) {
    try { fs.copyFileSync(contatos.ARQUIVO, contatos.ARQUIVO + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')); } catch (_) {}
    fs.writeFileSync(contatos.ARQUIVO, JSON.stringify(map), 'utf8');
  }
  return resumo;
}

if (require.main === module) {
  const dry = !process.argv.includes('--run');
  const r = rodar({ dry });
  console.log('\n──── DEDUP CONTATOS ' + (dry ? '(SIMULAÇÃO)' : '(APLICADO)') + ' ────');
  console.log('Grupos duplicados (mesmo número, 2 formas):', r.grupos);
  console.log((dry ? 'Seriam removidas' : 'Removidas') + ' (duplicatas):', r.removidos);
  for (const e of r.exemplos) {
    console.log('  • mantém ' + e.mantido + ' (' + (e.nome || 's/ nome') + ') · junta ' + e.juntou.join(', ') + ' · tags: ' + (e.tags || []).join(' | '));
  }
  console.log(dry
    ? '\n(SIMULAÇÃO — nada foi alterado. Use --run para aplicar; ele faz BACKUP antes.)'
    : '\n(Feito. Backup salvo ao lado do contatos.json: contatos.json.bak-...)');
  process.exit(0);
}

module.exports = { rodar, analisar, canon };

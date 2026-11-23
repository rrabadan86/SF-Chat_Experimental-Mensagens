#!/usr/bin/env node
/**
 * Matriz de rastreabilidade (docs/rastreabilidade.md): lê, confere e reconta o resumo.
 *
 *   npm run matriz              (em Experimental/) reconta o resumo e mostra o que está errado
 *   node scripts/matriz.js --conferir   só confere (sai com erro se algo estiver errado ou velho)
 *
 * Também é usado por testes/unidade/matriz.test.js e por scripts/testar-alteracao.js.
 * Não toca dado nenhum: só lê os arquivos do repositório.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const EXP = path.join(REPO, 'Experimental');
const MATRIZ = path.join(REPO, 'docs', 'rastreabilidade.md');
const REGRAS = path.join(REPO, '.claude', 'rules');
const PASTAS_TESTE = [path.join(EXP, 'testes', 'unidade'), path.join(EXP, 'testes', 'tela')];
const PYTHON = path.join(EXP, 'src', 'agendamento_evo', 'tests', 'test_offline.py');
const TELAS = path.join(EXP, 'testes', 'tela', 'telas.js');
const COBERTURAS = ['✅', 'parcial', '❌', 'processo'];
const INI = '<!-- resumo:inicio -->', FIM = '<!-- resumo:fim -->';

// "PAI-01..04" → PAI-01..PAI-04; "VIS-02/03/06" → VIS-02, VIS-03, VIS-06
function codigosDoTitulo(titulo) {
  const out = [];
  const re = /\b([A-Z]{2,4})-(\d{2})((?:(?:\.\.|\/)\d{2})*)(?![\w-])/g;
  let m;
  while ((m = re.exec(String(titulo)))) {
    const [, area, n0, resto] = m;
    const nums = [Number(n0)];
    for (const p of resto.match(/(\.\.|\/)\d{2}/g) || []) {
      const n = Number(p.replace(/\D/g, ''));
      if (p.startsWith('..')) for (let i = nums[nums.length - 1] + 1; i <= n; i++) nums.push(i);
      else nums.push(n);
    }
    for (const n of nums) out.push(`${area}-${String(n).padStart(2, '0')}`);
  }
  return [...new Set(out)];
}

// Códigos definidos nas regras: "**ÁREA-NN**" em .claude/rules/*.md
function codigosDasRegras() {
  const mapa = new Map();
  for (const f of fs.readdirSync(REGRAS).filter(f => f.endsWith('.md')).sort()) {
    const txt = fs.readFileSync(path.join(REGRAS, f), 'utf8');
    for (const m of txt.matchAll(/\*\*([A-Z]{2,4}-\d{2})\*\*/g)) {
      if (!mapa.has(m[1])) mapa.set(m[1], []);
      mapa.get(m[1]).push(f);
    }
  }
  return mapa;
}

// Todos os testes: { arq (nome), caminho, titulo, codigos }
function testesDoRepo() {
  const lista = [];
  for (const pasta of PASTAS_TESTE) {
    if (!fs.existsSync(pasta)) continue;
    for (const f of fs.readdirSync(pasta).filter(f => f.endsWith('.test.js')).sort()) {
      const caminho = path.join(pasta, f);
      const txt = fs.readFileSync(caminho, 'utf8');
      for (const m of txt.matchAll(/(?:^|\n)\s*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        const titulo = m[2].replace(/\\(.)/g, '$1');
        lista.push({ arq: f, caminho, titulo, codigos: codigosDoTitulo(titulo) });
      }
    }
  }
  if (fs.existsSync(PYTHON)) {
    for (const m of fs.readFileSync(PYTHON, 'utf8').matchAll(/^def (test_\w+)\(/gm)) {
      lista.push({ arq: path.basename(PYTHON), caminho: PYTHON, titulo: m[1], codigos: [], python: true });
    }
  }
  return lista;
}

function celulas(linha) { return linha.split('|').slice(1, -1).map(c => c.trim()); }
function crases(txt) { return (String(txt).match(/`([^`]+)`/g) || []).map(x => x.slice(1, -1)); }

// Lê as tabelas da matriz: uma linha por código
function lerMatriz(texto = fs.readFileSync(MATRIZ, 'utf8')) {
  const linhas = [];
  let secao = '', naTabela = false;
  for (const l of texto.split('\n')) {
    if (/^## /.test(l)) { secao = l.replace(/^## /, '').trim(); naTabela = false; continue; }
    if (/^\|\s*Código\s*\|/.test(l)) { naTabela = true; continue; }
    if (!naTabela) continue;
    if (!/^\|/.test(l)) { naTabela = false; continue; }
    if (/^\|\s*-/.test(l)) continue;
    const c = celulas(l);
    const testes = c[3] && c[3] !== '—' ? c[3].split(/<br\s*\/?>/).map(t => t.trim()).filter(Boolean).map(t => {
      const m = /^`([^`]+)`\s*(?:›\s*(.+))?$/.exec(t);
      return m ? { arq: m[1], titulo: (m[2] || '').trim(), texto: t } : { arq: '', titulo: '', texto: t, malFeito: true };
    }) : [];
    const cob = (c[4] || '').trim();
    linhas.push({ secao, codigo: c[0], regra: c[1], onde: c[2] === '—' ? [] : crases(c[2]), testes, cobertura: COBERTURAS.find(k => cob.startsWith(k)) || '', coberturaTexto: cob });
  }
  return linhas;
}

function acharArquivo(nome) {
  for (const base of [path.join(EXP, 'src'), EXP, REPO]) {
    const f = path.join(base, nome);
    if (fs.existsSync(f)) return f;
  }
  return '';
}

// Testes que uma citação aponta (precisa ser exatamente um; telas.js é o arquivo inteiro)
function resolver(ref, testes) {
  if (ref.arq === 'telas.js' && !ref.titulo) return fs.existsSync(TELAS) ? [{ arq: 'telas.js', caminho: TELAS, titulo: '', telas: true, codigos: [] }] : [];
  return testes.filter(t => t.arq === ref.arq && ref.titulo && (t.python ? t.titulo === ref.titulo : t.titulo.startsWith(ref.titulo)));
}

function conferir({ texto } = {}) {
  const erros = [];
  const regras = codigosDasRegras();
  const linhas = lerMatriz(texto);
  const testes = testesDoRepo();
  for (const [cod, arqs] of regras) if (arqs.length > 1) erros.push(`${cod} definido mais de uma vez nas regras (${arqs.join(', ')})`);
  const porCodigo = new Map();
  for (const l of linhas) {
    if (porCodigo.has(l.codigo)) erros.push(`${l.codigo} tem mais de uma linha na matriz`);
    porCodigo.set(l.codigo, l);
    if (!regras.has(l.codigo)) erros.push(`${l.codigo} está na matriz mas não existe em .claude/rules/`);
    if (!l.cobertura) erros.push(`${l.codigo}: cobertura "${l.coberturaTexto}" — use ✅, parcial, ❌ ou processo`);
    for (const a of l.onde) if (!acharArquivo(a)) erros.push(`${l.codigo}: arquivo ${a} (coluna Onde) não existe`);
    for (const r of l.testes) {
      if (r.malFeito) { erros.push(`${l.codigo}: teste fora do formato (\`arquivo\` › título): ${r.texto}`); continue; }
      const achou = resolver(r, testes);
      if (achou.length === 0) erros.push(`${l.codigo}: ${r.arq} não tem o teste "${r.titulo}"`);
      else if (achou.length > 1) erros.push(`${l.codigo}: "${r.titulo}" serve para ${achou.length} testes de ${r.arq} — escreva mais do título`);
      r.alvo = achou[0];
    }
    if ((l.cobertura === '✅' || l.cobertura === 'parcial') && !l.testes.length) erros.push(`${l.codigo}: cobertura ${l.cobertura} sem teste citado`);
    if (l.cobertura === '❌' && l.testes.length) erros.push(`${l.codigo}: tem teste citado mas está ❌`);
  }
  for (const cod of regras.keys()) if (!porCodigo.has(cod)) erros.push(`${cod} (${regras.get(cod)[0]}) não tem linha na matriz`);
  for (const t of testes) {
    for (const cod of t.codigos) {
      if (!regras.has(cod)) { erros.push(`${t.arq} › "${t.titulo}": código ${cod} não existe nas regras`); continue; }
      const l = porCodigo.get(cod);
      if (l && !l.testes.some(r => r.alvo === t)) erros.push(`${t.arq} › "${t.titulo}" tem ${cod} no nome mas não está na linha ${cod} da matriz`);
    }
  }
  return { erros, linhas, testes };
}

function resumo(linhas, testes) {
  const areas = [];
  for (const l of linhas) {
    let a = areas.find(x => x.nome === l.secao);
    if (!a) areas.push(a = { nome: l.secao, n: 0, '✅': 0, parcial: 0, '❌': 0, processo: 0 });
    a.n++; if (a[l.cobertura] !== undefined) a[l.cobertura]++;
  }
  const tot = { nome: '**Total**', n: 0, '✅': 0, parcial: 0, '❌': 0, processo: 0 };
  for (const a of areas) for (const k of ['n', '✅', 'parcial', '❌', 'processo']) tot[k] += a[k];
  const nome = (s) => s.replace(/\s*\(`[^`]+`\)\s*$/, '');
  const out = ['| Área | Regras | ✅ | parcial | ❌ | processo |', '|---|---|---|---|---|---|'];
  for (const a of [...areas, tot]) out.push(`| ${nome(a.nome)} | ${a.n} | ${a['✅']} | ${a.parcial} | ${a['❌']} | ${a.processo} |`);
  const deCodigo = tot.n - tot.processo;
  const comTeste = tot['✅'] + tot.parcial;
  const citados = new Set(linhas.flatMap(l => l.testes.map(r => r.alvo).filter(Boolean)));
  const soltos = testes.filter(t => !citados.has(t));
  const porArq = {};
  for (const t of soltos) porArq[t.arq] = (porArq[t.arq] || 0) + 1;
  out.push('');
  out.push(`Regras de código (sem as de processo): **${comTeste} de ${deCodigo}** com teste (${tot['✅']} inteiras, ${tot.parcial} em parte); **${tot['❌']}** sem teste.`);
  out.push('');
  out.push(`Testes: ${testes.length} no total, ${testes.length - soltos.length} ligados a uma regra. Os outros ${soltos.length} conferem funções que ainda não têm regra com código: ${Object.entries(porArq).map(([a, n]) => `\`${a}\` (${n})`).join(', ') || 'nenhum'}.`);
  return out.join('\n');
}

function comResumo(texto, novo) {
  const i = texto.indexOf(INI), f = texto.indexOf(FIM);
  if (i < 0 || f < i) throw new Error(`a matriz precisa ter ${INI} e ${FIM}`);
  return texto.slice(0, i + INI.length) + '\n' + novo + '\n' + texto.slice(f);
}

function resumoEmDia(texto = fs.readFileSync(MATRIZ, 'utf8')) {
  const { linhas, testes } = conferir({ texto });
  return comResumo(texto, resumo(linhas, testes)) === texto;
}

module.exports = { REPO, EXP, MATRIZ, TELAS, PYTHON, codigosDoTitulo, codigosDasRegras, testesDoRepo, lerMatriz, conferir, resumo, comResumo, resumoEmDia, acharArquivo };

if (require.main === module) {
  const soConferir = process.argv.includes('--conferir');
  const texto = fs.readFileSync(MATRIZ, 'utf8');
  const { erros, linhas, testes } = conferir({ texto });
  const novo = comResumo(texto, resumo(linhas, testes));
  if (novo !== texto) {
    if (soConferir) erros.push('o resumo está velho — rode: cd Experimental && npm run matriz');
    else { fs.writeFileSync(MATRIZ, novo); console.log('Resumo da matriz recontado.'); }
  } else console.log('Resumo da matriz já estava em dia.');
  console.log(resumo(linhas, testes).split('\n').filter(l => !/^\|---/.test(l)).join('\n'));
  if (erros.length) {
    console.error(`\n${erros.length} problema(s) na matriz:\n` + erros.map(e => '  - ' + e).join('\n'));
    process.exit(1);
  }
}

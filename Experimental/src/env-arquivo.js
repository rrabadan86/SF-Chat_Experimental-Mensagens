/**
 * env-arquivo.js — grava e lê UMA variável de um arquivo .env do jeito que quem usa
 * vai ler (dotenv), sem estragar o valor.
 *
 * Por que existe: o painel gravava `NOME=valor` cru. Com senha do EVO isso dava errado
 * sem ninguém ver:
 *   • "Slim#2026"  → o leitor do .env trata "#" como comentário e o robô lia "Slim";
 *   • "Fit$$2026"  → a troca de texto do JavaScript transformava "$$" em "$";
 *   • aspas no começo/fim eram cortadas;
 *   • com a linha repetida no arquivo, o painel trocava a 1ª e o robô lia a última.
 * Resultado: senha "trocada no painel", robô entrando com outra, e o EVO bloqueando o
 * usuário por excesso de tentativas.
 *
 * Aqui o valor vai entre aspas quando precisa, as linhas repetidas viram uma só, e
 * depois de gravar o arquivo é RELIDO: se o valor lido não for igual ao digitado, o
 * arquivo volta ao que era e a gravação falha (melhor erro na tela do que senha errada).
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Sem aspas só o que não tem como ser lido errado (chaves de API, e-mail, URL).
const SIMPLES = /^[A-Za-z0-9_@%+=:,./?&~^*!-]*$/;

// Como o valor vai escrito no arquivo. Lança erro se não houver como escrevê-lo.
function formatar(valor) {
  const v = String(valor == null ? '' : valor);
  if (/[\r\n]/.test(v)) throw new Error('o valor não pode ter quebra de linha');
  if (SIMPLES.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('`')) return '`' + v + '`';
  // entre aspas duplas o leitor troca \n e \r por quebra de linha
  if (!v.includes('"') && !/\\[nr]/.test(v)) return `"${v}"`;
  throw new Error('não dá para gravar um valor com aspas simples, aspas duplas e crase ao mesmo tempo');
}

// O que o dotenv lê para `nome` neste arquivo ('' se não há; vale a ÚLTIMA linha).
function ler(nome, arq) {
  try { const o = dotenv.parse(fs.readFileSync(arq)); return o[nome] == null ? '' : String(o[nome]); } catch (_) { return ''; }
}

// Grava `nome=valor` preservando o resto do arquivo. → { ok, erro }
function gravar(nome, valor, arq) {
  const v = String(valor == null ? '' : valor);
  let linha;
  try { linha = nome + '=' + formatar(v); } catch (e) { return { ok: false, erro: e.message }; }
  let antes = null;
  try { antes = fs.readFileSync(arq, 'utf8'); } catch (_) {}
  const ehDaVar = (l) => new RegExp('^\\s*(?:export\\s+)?' + nome + '\\s*=').test(l);
  const linhas = (antes || '').split('\n');
  let posto = false;
  const novas = [];
  for (const l of linhas) {
    if (!ehDaVar(l)) { novas.push(l); continue; }
    if (!posto) { novas.push(linha); posto = true; } // fica uma só, no lugar da primeira
  }
  let txt = novas.join('\n');
  if (!posto) txt = (txt.replace(/\s*$/, '') + '\n' + linha + '\n').replace(/^\n/, '');
  try {
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    let modo = 0o600; try { modo = fs.statSync(arq).mode & 0o777; } catch (_) {}
    const tmp = arq + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, txt, { encoding: 'utf8', mode: modo });
    fs.renameSync(tmp, arq);
  } catch (e) { return { ok: false, erro: 'não consegui gravar o arquivo' }; }
  // Confere: quem vai usar lê exatamente o que foi digitado?
  if (ler(nome, arq) !== v) {
    try { if (antes == null) fs.rmSync(arq, { force: true }); else fs.writeFileSync(arq, antes, 'utf8'); } catch (_) {}
    return { ok: false, erro: 'o valor gravado não ficou igual ao digitado — nada foi alterado' };
  }
  return { ok: true };
}

module.exports = { formatar, ler, gravar };

/**
 * ramo-estavel.js — qual versão os servidores baixam.
 *
 * Os servidores só recebem versão APROVADA no teste automático (CI do GitHub): a
 * cada versão nova da main que passa em todos os testes, o CI move a marca
 * "estavel" para ela (.github/workflows/ci.yml, job "Marcar versão estável").
 * O slimfit-atualizar e o "Atualizar agora" do painel baixam a "estavel".
 *
 * Se o repositório ainda não tem a "estavel" (outro repositório nosso, ou antes do
 * 1º CI), usa a main como antes. --main força a main (emergência).
 *
 * buscar(git, raiz, { forcarMain }) → { ref, ramo, emTeste }
 *   ref     — o que baixar (git reset --hard ref)
 *   ramo    — 'estavel' ou 'main'
 *   emTeste — quantas versões novas da main ainda estão no teste (não entram agora)
 */
const R_MAIN = 'refs/remotes/origin/main';
const R_ESTAVEL = 'refs/remotes/origin/estavel';

function buscar(git, raiz, { forcarMain = false } = {}) {
  git(raiz, 'fetch', 'origin', `+refs/heads/main:${R_MAIN}`);
  if (!forcarMain) {
    let temEstavel = true;
    try { git(raiz, 'fetch', 'origin', `+refs/heads/estavel:${R_ESTAVEL}`); } catch (_) { temEstavel = false; }
    if (temEstavel) {
      let emTeste = 0;
      try { emTeste = parseInt(git(raiz, 'rev-list', '--count', `${R_ESTAVEL}..${R_MAIN}`), 10) || 0; } catch (_) {}
      return { ref: R_ESTAVEL, ramo: 'estavel', emTeste };
    }
  }
  return { ref: R_MAIN, ramo: 'main', emTeste: 0 };
}

module.exports = { buscar };

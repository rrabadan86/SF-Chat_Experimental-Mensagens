/**
 * evo-paginas.js — lê TODAS as páginas de uma segmentação do EVO.
 *
 * A lista da segmentação vem paginada (20 por página). Os jobs interceptam a
 * resposta da API `obter-clientes`, mas uma resposta é só a página que está na
 * tela: com mais de 20 resultados, quem estava na página 2+ ficava de fora (ex.:
 * a cobrança do Park Sul via 20 de 32 devedoras). Aqui avançamos página a página
 * e juntamos as respostas, sem repetir ninguém.
 *
 * Uso: o interceptador do job mantém `estado = { seq, lista }` — a cada resposta
 * da lista filtrada faz `estado.seq++` e `estado.lista = linhas`. Depois que a
 * página 1 está na tela, chame `coletarTodasPaginas(page, { estado })`.
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// "32 resultados" no topo da segmentação (0 se não achar).
async function lerTotalResultados(page) {
  return page.evaluate(() => {
    const m = (document.body.innerText || '').match(/(\d+)\s+resultados?/i);
    return m ? parseInt(m[1], 10) : 0;
  }).catch(() => 0);
}

// Clica em "próxima página"; false se não houver (ou estiver desabilitado).
async function proximaPagina(page) {
  return page.evaluate(() => {
    for (const b of document.querySelectorAll('button, [role="button"], [class*="next"], [aria-label]')) {
      const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
      const desabilitado = b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('mat-button-disabled');
      if ((lbl.includes('próxim') || lbl.includes('proxim') || lbl.includes('next')) && !desabilitado && b.offsetWidth > 0) {
        b.click();
        return true;
      }
    }
    return false;
  }).catch(() => false);
}

/**
 * Junta a página atual e as seguintes. Para quando: chegou ao total informado,
 * não há próxima página, a página não carregou ou não trouxe ninguém novo.
 * @returns {{ linhas: object[], total: number, paginas: number }}
 */
async function coletarTodasPaginas(page, { estado, chaveId = (r) => r.idCliente ?? r.id ?? r.nome, maxPaginas = 30, log = () => {} }) {
  const mapa = new Map();
  const juntar = (lista) => {
    let novos = 0;
    for (const r of lista || []) {
      const k = String(chaveId(r) ?? '').trim();
      if (k && !mapa.has(k)) { mapa.set(k, r); novos++; }
    }
    return novos;
  };
  juntar(estado.lista);
  const total = await lerTotalResultados(page);
  let paginas = 1;
  for (let p = 2; p <= maxPaginas; p++) {
    if (total && mapa.size >= total) break;
    const antes = estado.seq;
    if (!(await proximaPagina(page))) break;
    for (let i = 0; i < 30 && estado.seq === antes; i++) await sleep(500);
    if (estado.seq === antes) { log(`página ${p} não carregou — sigo com ${mapa.size}`); break; }
    await sleep(800);
    const novos = juntar(estado.lista);
    paginas = p;
    log(`página ${p}: +${novos} (total ${mapa.size}${total ? '/' + total : ''})`);
    if (!novos) break;
  }
  if (total && mapa.size < total) log(`⚠️ li ${mapa.size} de ${total} resultado(s) da segmentação`);
  return { linhas: [...mapa.values()], total, paginas };
}

module.exports = { lerTotalResultados, proximaPagina, coletarTodasPaginas };

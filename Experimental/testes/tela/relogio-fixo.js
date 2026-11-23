// Relógio parado numa data (para prints de referência sempre iguais): carregado com
// NODE_OPTIONS="--require .../relogio-fixo.js" e SF_RELOGIO_FIXO=<data ISO>. O relógio
// começa na data pedida e anda normalmente a partir dela. Só para teste de tela; sem
// SF_RELOGIO_FIXO não muda nada.
const inicio = Date.parse(process.env.SF_RELOGIO_FIXO || '');
if (!Number.isNaN(inicio)) {
  const Real = Date;
  const real0 = Real.now();
  const agora = () => Real.now() - real0 + inicio;
  function DataFixa(...a) {
    if (!new.target) return new Real(agora()).toString();
    return a.length ? new Real(...a) : new Real(agora());
  }
  DataFixa.prototype = Real.prototype;
  DataFixa.now = agora;
  DataFixa.parse = Real.parse;
  DataFixa.UTC = Real.UTC;
  global.Date = DataFixa;
}

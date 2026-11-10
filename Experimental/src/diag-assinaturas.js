/**
 * Diagnóstico: o que a API do EVO informa sobre ASSINATURA DE CONTRATO das alunas
 * ativas (campos signedTerms e contractSigningUrl). Só LÊ; não envia nada.
 *
 *   node src/diag-assinaturas.js
 *
 * Mostra só contagens e até 5 exemplos (1º nome + plano) — nunca o link.
 */
const evo = require('./pagamento/evo-api');
const vig = (x) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const ini = String(x.startDate || '').slice(0, 10), fim = String(x.endDate || '').slice(0, 10), canc = String(x.cancelDate || '').slice(0, 10);
  return ini && ini <= hoje && (!fim || fim >= hoje) && (!canc || canc >= hoje);
};
(async () => {
  if (!evo.configurado()) { console.log('❌ não achei EVO_DNS/EVO_TOKEN no .env'); return; }
  const ativos = await evo.paginado('/api/v1/members', { status: 1 });
  console.log(`alunas ativas na lista: ${ativos.length}`);
  const ms0 = ativos.flatMap(m => m.memberships || []);
  const naLista = ms0.some(x => 'signedTerms' in x || 'contractSigningUrl' in x);
  console.log(`a LISTA já traz os campos de assinatura? ${naLista ? 'SIM' : 'NÃO (vou olhar o detalhe de uma amostra)'}`);
  let pessoas = ativos;
  if (!naLista) {
    pessoas = [];
    for (const m of ativos.slice(0, 25)) {
      try { const d = await evo.chamar(`/api/v2/members/${m.idMember}`); pessoas.push(Array.isArray(d) ? d[0] : d); } catch (e) { console.log('  falha no detalhe', m.idMember, e.message.slice(0, 80)); }
    }
    console.log(`detalhes lidos: ${pessoas.length} (amostra)`);
  }
  let comCampo = 0, assinados = 0, pendentes = 0, pendComLink = 0; const ex = [];
  for (const p of pessoas) {
    for (const x of ((p && p.memberships) || []).filter(vig)) {
      if (!('signedTerms' in x)) continue;
      comCampo++;
      if (x.signedTerms) { assinados++; continue; }
      pendentes++;
      if (x.contractSigningUrl) pendComLink++;
      if (ex.length < 5) ex.push(`${String(p.firstName || '').trim()} · ${String(x.name || '').trim()} · link: ${x.contractSigningUrl ? 'tem' : 'NÃO tem'} · aceite: ${x.acceptanceDate ? 'tem data' : 'sem data'}`);
    }
  }
  console.log(`contratos vigentes com o campo signedTerms: ${comCampo}`);
  console.log(`  assinados: ${assinados} · NÃO assinados: ${pendentes} (com link de assinatura: ${pendComLink})`);
  for (const e of ex) console.log('  ex.: ' + e);
})().catch(e => console.log('❌ ' + e.message));

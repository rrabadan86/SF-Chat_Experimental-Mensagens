// ─── Popup "Nova funcionalidade" do EVO (compartilhado) ──────────────────────
// O EVO passou a exibir um popup ("Uma nova tela já está disponível. A versão
// antiga ficará apenas para consulta.") que COBRE a tela antiga e impede cliques
// (segmentos, chips, tabelas). A versão antiga continua funcionando, então
// clicamos em "Permanecer" para ficar nela e os scrapers seguirem funcionando.
// O popup reaparece a cada navegação — chame após o login e após cada navegação.
async function fecharPopupNovaTela(page) {
  try {
    const fechou = await page.evaluate(() => {
      const alvos = Array.from(document.querySelectorAll('button, a, span, div'));
      for (const el of alvos) {
        const t = (el.textContent || '').trim().toLowerCase();
        if ((t === 'permanecer' || t === 'continuar na versão antiga' || t === 'agora não' || t === 'fechar') && el.offsetWidth > 0 && el.offsetHeight > 0) {
          (el.closest('button') || el).click();
          return true;
        }
      }
      return false;
    });
    if (fechou) console.log('   ↪️  popup "Nova funcionalidade" do EVO fechado (Permanecer).');
    return fechou;
  } catch (_) { return false; }
}

module.exports = { fecharPopupNovaTela };

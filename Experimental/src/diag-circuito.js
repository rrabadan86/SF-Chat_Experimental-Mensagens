/**
 * Diagnóstico: abre a Grade > Horários (visão SEMANA) e mostra como aparecem os
 * cards do "Circuito" — para descobrir onde está o nome da PROFESSORA e o horário.
 * Também lista os cabeçalhos de dia (para mapear a coluna de sábado).
 *
 * Uso:  xvfb-run -a node src/diag-circuito.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const EvoScraper = require('./evo-scraper');
const config = require('./config');

(async () => {
  const scraper = new EvoScraper();
  try {
    await scraper.init();
    await scraper.login();

    const base = scraper.appOrigin || config.evo.url;
    const url = `${base}/#/app/slimfit/15/grade/horarios`;
    console.log('🌐 Abrindo Grade > Horários...');
    await scraper.page.goto(url, { waitUntil: 'networkidle2' });
    await scraper.sleep(5000);
    if (await scraper.isOnLoginPage()) {
      await scraper.login();
      await scraper.page.goto(url, { waitUntil: 'networkidle2' });
      await scraper.sleep(5000);
    }
    await scraper.dismissSurveyModal();
    await scraper.sleep(1500);

    const clicar = async (rot) => scraper.page.evaluate((r) => {
      const a = r.toUpperCase();
      for (const el of document.querySelectorAll('button,a,span,div,li')) {
        if ((el.textContent || '').trim().toUpperCase() !== a) continue;
        if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
        (el.closest('button,a,[role="button"],li') || el).click();
        return true;
      }
      return false;
    }, rot);
    console.log('   Clicou em SEMANA?', await clicar('SEMANA'));
    await scraper.sleep(3500);

    const DATA = path.resolve(__dirname, '..', 'data');
    if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
    await scraper.page.screenshot({ path: path.join(DATA, 'circuito-grade.png'), fullPage: true }).catch(() => {});

    const dump = await scraper.page.evaluate(() => {
      const vis = (el) => (el.offsetWidth > 0 || el.offsetHeight > 0);
      // 1) Cabeçalhos de dia (mapeiam colunas)
      const dias = [];
      for (const el of document.querySelectorAll('div,th,td,span,li')) {
        const t = (el.innerText || '').trim();
        if (!/^(SEG|TER|QUA|QUI|SEX|S[ÁA]B|DOM)/i.test(t)) continue;
        if (t.length > 30 || !vis(el)) continue;
        const r = el.getBoundingClientRect();
        dias.push({ txt: t.replace(/\s+/g, ' '), x: Math.round(r.left) });
      }
      const seenD = new Set(), diasU = [];
      for (const d of dias) { const k = d.txt + '|' + d.x; if (!seenD.has(k)) { seenD.add(k); diasU.push(d); } }

      // 2) Cards que mencionam "circuito"
      const cards = [];
      for (const el of document.querySelectorAll('div,td,li,a,span')) {
        const t = (el.innerText || '').trim();
        if (!/circuito/i.test(t)) continue;
        if (el.children.length > 8 || !vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 500) continue; // ignora contêineres grandes
        cards.push({ txt: t.replace(/\s+/g, ' ').slice(0, 220), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) });
      }
      const seenC = new Set(), cardsU = [];
      for (const c of cards) { if (!seenC.has(c.txt)) { seenC.add(c.txt); cardsU.push(c); } }
      cardsU.sort((a, b) => a.x - b.x || a.y - b.y);
      return { dias: diasU, cards: cardsU };
    });

    console.log('\n=== CABEÇALHOS DE DIA (coluna) ===');
    dump.dias.forEach(d => console.log(`  x=${d.x}  "${d.txt}"`));
    console.log('\n=== CARDS COM "CIRCUITO" ===');
    dump.cards.forEach(c => console.log(`  [${c.w}x${c.h} @x${c.x},y${c.y}] "${c.txt}"`));
    console.log('\n📸 screenshot: data/circuito-grade.png');
  } catch (e) {
    console.error('❌ erro:', e.message);
  } finally {
    try { await scraper.close(); } catch (_) {}
  }
})();

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');
puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════════════════
//  CONTRATOS A VENCER NO PRÓXIMO MÊS → grupo "SlimFit Equipe 💪"
//
//  Roda todo dia 28 (aviso antecipado): lista as alunas cujo contrato vence no
//  MÊS SEGUINTE. Ex.: rodando em 28/09 → contratos que vencem em OUTUBRO.
//
//  De onde vêm os dados: a mesma Segmentação do EVO usada pela renovação
//  (renovar-contratos.js) — segmento "Vencimento de Contrato Seman...". Como o
//  EVO não tem opção "próximo mês", abrimos o chip "Vencimento do contrato:",
//  escolhemos "Período personalizado" e marcamos o intervalo do dia 1 ao último
//  dia do mês-alvo. A lista (obter-clientes) já traz nome + dataVencimento, então
//  NÃO precisamos abrir cada aluna nem buscar telefone (só postamos os nomes).
//
//  Uso:
//    node src/renovacoes-mes-grupo.js            → monta e ENVIA no grupo
//    node src/renovacoes-mes-grupo.js --dry      → só monta e imprime (não envia)
//    node src/renovacoes-mes-grupo.js --mes=10   → força um mês-alvo (1-12)
// ═══════════════════════════════════════════════════════════════════════════

const GRUPO = require('./grupos').equipe(); // nome do grupo (painel > .env > padrão)
const DRY = process.argv.includes('--dry');
const argMes = (process.argv.find(a => a.startsWith('--mes=')) || '').split('=')[1];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Data "agora" no fuso de Brasília (o servidor pode estar em UTC).
function agoraSP() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

// Mês-alvo = o PRÓXIMO mês (ou --mes=N). Devolve { ano, mesIndex(0-11) }.
function mesAlvo() {
  const sp = agoraSP();
  if (argMes) {
    const n = parseInt(argMes, 10);
    if (n >= 1 && n <= 12) {
      const mesIndex = n - 1;
      // Se o mês forçado é anterior ao mês atual, entende-se o ano que vem.
      const ano = mesIndex < sp.getMonth() ? sp.getFullYear() + 1 : sp.getFullYear();
      return { ano, mesIndex };
    }
  }
  const d = new Date(sp.getFullYear(), sp.getMonth() + 1, 1); // 1º dia do próximo mês
  return { ano: d.getFullYear(), mesIndex: d.getMonth() };
}

function fmtBR(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function formatarData(val) {
  if (!val) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  return fmtBR(d);
}
// Converte o vencimento (DD/MM/YYYY, ISO ou Date) numa Date "só dia" (00:00),
// para dar pra comparar com o intervalo do mês-alvo. Retorna null se não parsear.
function parseVenc(val) {
  if (!val) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(val));
  let d;
  if (m) d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  else { d = new Date(val); }
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monta o texto da mensagem (nome + dia/mês do vencimento), ordenado por data. */
function montarMensagem(alunas, mesIndex, ano) {
  const nomeMes = MESES[mesIndex];
  if (!alunas.length) {
    return `📄 *Contratos a vencer em ${nomeMes}*\n\nNenhum contrato vence neste mês. 😉`;
  }
  const diaDe = (v) => { const m = /^(\d{2})\/(\d{2})/.exec(v || ''); return m ? parseInt(m[1], 10) : 99; };
  const linhas = alunas
    .slice()
    .sort((a, b) => diaDe(a.vencimento) - diaDe(b.vencimento))
    .map(a => {
      const dm = /^(\d{2})\/(\d{2})/.exec(a.vencimento || '');
      const quando = dm ? `${dm[1]}/${dm[2]}` : String(mesIndex + 1).padStart(2, '0');
      return `📅 ${quando} — ${a.nome}`;
    });
  // Texto (intro + {lista} + rodapé) é editável no painel: chave 'renovacoes_mes'.
  return require('./mensagens').render('renovacoes_mes', { mes: nomeMes, lista: linhas.join('\n') });
}

// ─── Lê no EVO os contratos que vencem no intervalo [inicio, fim] ───
async function buscarContratosDoPeriodo(inicio, fim) {
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`📋 Contratos a vencer no EVO — período ${fmtBR(inicio)} a ${fmtBR(fim)}`);
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(30000);

  // Intercepta a lista da segmentação (obter-clientes) — traz nome + dataVencimento.
  let clientesIntercept = [];
  page.on('response', async (res) => {
    try {
      if (res.url().includes('obter-clientes') && res.status() === 200) {
        const data = JSON.parse(await res.text());
        if (data && Array.isArray(data.retorno) && data.retorno.length > 0) clientesIntercept = data.retorno;
      }
    } catch (_) { /* corpo não-JSON */ }
  });

  try {
    // 1. Login
    console.log('🔐 Fazendo login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 15000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 80 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 80 });
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(btn.textContent?.trim().toUpperCase())) { btn.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    await page.waitForFunction(() => window.location.hash.includes('/inicio/') || window.location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    console.log('✅ Login OK\n');

    // 2. Segmentação → segmento "Vencimento de Contrato Seman..."
    console.log('📂 Navegando para Segmentação...');
    await page.evaluate(() => { window.location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes'; });
    await sleep(5000);

    const procurarMenu = () => page.evaluate(() => {
      for (const el of document.querySelectorAll('span, div, a, li, md-list-item')) {
        const text = el.innerText?.trim() || '';
        if (text.toLowerCase().includes('vencimento de contrato seman') && text.length < 50 && el.offsetWidth > 0) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const clickableParent = el.closest('md-list-item') || el.closest('a') || el;
          clickableParent.id = 'target-segment-menu';
          return text;
        }
      }
      return null;
    });
    let menuEncontrado = null;
    for (let i = 0; i < 15 && !menuEncontrado; i++) { menuEncontrado = await procurarMenu(); if (!menuEncontrado) await sleep(3000); }
    if (!menuEncontrado) {
      const ondeEstou = await page.evaluate(() => location.href).catch(() => '(?)');
      console.log(`   🌐 Endereço em que a tela parou: ${ondeEstou}`);
      throw new Error('Menu da Segmentação não encontrado (procurei "Vencimento de Contrato Seman..."). Se o segmento foi renomeado no EVO, me diga o nome novo.');
    }
    console.log(`✅ Menu localizado: "${menuEncontrado}"`);
    await sleep(1500);
    await page.click('#target-segment-menu');

    console.log('⏳ Aguardando a tela da segmentação carregar...');
    let chipApareceu = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      chipApareceu = await page.evaluate(() =>
        Array.from(document.querySelectorAll('span, div, .md-chip-content'))
          .some(e => e.textContent && e.textContent.toLowerCase().includes('vencimento do contrato:')));
      if (chipApareceu) break;
    }
    if (!chipApareceu) console.log('⚠️  O chip de data demorou para aparecer — tento continuar.');
    await sleep(2000);

    // 3. Chip "Vencimento do contrato:" → "Período personalizado" → intervalo do mês-alvo
    clientesIntercept = []; // captura só o resultado JÁ filtrado
    const resultadoFiltro = await page.evaluate(async (diaIni, diaFim, mesIndex, ano) => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const mesesFull = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      const mesesAbbr = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const mesAlvoFull = mesesFull[mesIndex], mesAlvoAbbr = mesesAbbr[mesIndex], anoAlvo = String(ano);

      // PASSO 1: abrir o chip
      const chipNodes = Array.from(document.querySelectorAll('span, div, md-chip'))
        .filter(el => (el.textContent || '').toLowerCase().includes('vencimento do contrato:') && el.offsetWidth > 0);
      if (!chipNodes.length) return '⚠️ Chip de vencimento não encontrado.';
      const chip = chipNodes[chipNodes.length - 1];
      (chip.closest('md-chip') || chip.closest('.md-chip-content') || chip).click();
      await wait(1500);

      // PASSO 2: "Período personalizado"
      const itemPeriodo = Array.from(document.querySelectorAll('md-list-item, div, span'))
        .find(el => { const t = (el.textContent || '').trim().toLowerCase(); return t.includes('período personalizado') && t.length < 30 && el.offsetWidth > 0; });
      if (!itemPeriodo) return '⚠️ Opção "Período personalizado" não encontrada.';
      itemPeriodo.click();
      await wait(1500);

      // PASSO 3: abrir o calendário
      const inputData = Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').toLowerCase().includes('selecionar data'));
      if (!inputData) return '⚠️ Campo "Selecionar data" não encontrado.';
      inputData.click();
      await wait(1500);
      for (let i = 0; i < 20; i++) { if (document.querySelector('mat-calendar, .mat-calendar, md-calendar, .md-calendar')) break; await wait(250); }

      const isDisabled = (el) =>
        el.classList.contains('md-calendar-date-disabled') ||
        el.classList.contains('mat-calendar-body-disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el.className || '').toLowerCase().includes('disabled');

      // Acha um dia específico GARANTINDO mês + ano corretos (evita pegar o dia do mês errado).
      const acharDia = (dia) => {
        for (const el of document.querySelectorAll('td[aria-label], .mat-calendar-body-cell[aria-label], button[aria-label]')) {
          const al = (el.getAttribute('aria-label') || '').toLowerCase();
          if (!al) continue;
          const okMes = al.includes(mesAlvoFull) || al.includes(mesAlvoAbbr);
          const okAno = al.includes(anoAlvo);
          const okDia = new RegExp('(^|[^0-9])' + dia + '([^0-9]|$)').test(al);
          if (okMes && okAno && okDia && el.offsetWidth > 0 && !isDisabled(el)) return el;
        }
        const months = document.querySelectorAll('tbody.md-calendar-month, .md-calendar-month');
        for (const mesEl of months) {
          const label = (mesEl.textContent || '').toLowerCase();
          if (!label.includes(mesAlvoFull) && !label.includes(mesAlvoAbbr)) continue;
          for (const td of mesEl.querySelectorAll('td')) {
            if ((td.textContent || '').trim() !== String(dia)) continue;
            if (td.offsetWidth > 0 && !isDisabled(td)) return td;
          }
        }
        return null;
      };
      const acharBotaoProximo = () =>
        document.querySelector('.mat-calendar-next-button:not([disabled])') ||
        Array.from(document.querySelectorAll('button')).find(b => {
          if (b.offsetWidth <= 0 || b.disabled) return false;
          const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')).toLowerCase();
          const ic = (b.textContent || '').toLowerCase();
          return lbl.includes('próximo') || lbl.includes('proximo') || lbl.includes('next') || ic.includes('keyboard_arrow_right') || ic.includes('chevron_right');
        });
      const scroller = document.querySelector('.md-virtual-repeat-scroller') || document.querySelector('.md-calendar-scroll-mask');
      const clica = (el) => { el.scrollIntoView({ block: 'center' }); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click(); };

      // PASSO 4: navega até o mês-alvo e clica no DIA INÍCIO
      let elIni = acharDia(diaIni);
      for (let passo = 0; passo < 18 && !elIni; passo++) {
        const btn = acharBotaoProximo();
        if (btn) btn.click(); else if (scroller) { scroller.scrollTop += 300; scroller.dispatchEvent(new Event('scroll', { bubbles: true })); } else break;
        await wait(400);
        elIni = acharDia(diaIni);
      }
      if (!elIni) return `⚠️ Dia ${diaIni} de ${mesAlvoFull}/${ano} (início) não encontrado.`;
      clica(elIni);
      await wait(800);

      // PASSO 5: clica no DIA FIM (mesmo mês-alvo)
      let elFim = acharDia(diaFim);
      for (let passo = 0; passo < 6 && !elFim; passo++) { await wait(300); elFim = acharDia(diaFim); }
      if (!elFim) return `⚠️ Dia ${diaFim} de ${mesAlvoFull}/${ano} (fim) não encontrado.`;
      clica(elFim);
      await wait(1200);

      // PASSO 6: APLICAR
      const btnAplicar = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim().toLowerCase() === 'aplicar' && b.offsetWidth > 0);
      if (!btnAplicar) return '⚠️ Botão APLICAR não encontrado.';
      btnAplicar.click();
      return '✓ Filtro de período aplicado.';
    }, inicio.getDate(), fim.getDate(), inicio.getMonth(), inicio.getFullYear());
    console.log(`   👉 ${resultadoFiltro}`);

    // 4. Lê a lista (obter-clientes) — só nome + vencimento.
    //    IMPORTANTE: o segmento do EVO às vezes devolve contratos FORA do período
    //    (o filtro de data do EVO não é 100% confiável). Então conferimos AQUI:
    //    só entram os que vencem DENTRO do intervalo do mês-alvo [inicio, fim].
    await sleep(6000);
    const ini0 = new Date(inicio); ini0.setHours(0, 0, 0, 0);
    const fim0 = new Date(fim); fim0.setHours(0, 0, 0, 0);
    const vistos = new Set();
    const alunas = [];
    let foraDoMes = 0, semData = 0;
    for (const c of clientesIntercept) {
      const id = String(c.idCliente ?? c.id ?? c.nome);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const nome = String(c.nome || '').trim();
      if (!nome) continue;
      const venc = parseVenc(c.dataVencimento);
      if (!venc) { semData++; continue; }                 // sem data legível → não arrisca
      if (venc < ini0 || venc > fim0) { foraDoMes++; continue; } // fora do mês-alvo → descarta
      alunas.push({ nome, vencimento: fmtBR(venc) });
    }
    if (foraDoMes || semData) console.log(`   ↳ descartados: ${foraDoMes} fora do mês-alvo, ${semData} sem data.`);
    console.log(`📊 ${alunas.length} contrato(s) a vencer no mês-alvo.`);
    return alunas;
  } catch (err) {
    console.error('❌ Erro ao ler contratos:', err.message);
    try { await page.screenshot({ path: require('path').resolve(__dirname, '..', 'data', 'renovacoes-mes-debug.png'), fullPage: true }); } catch (_) {}
    return null;
  } finally {
    await sleep(2000);
    await browser.close();
  }
}

async function runRenovacoesMesGrupo() {
  const { ano, mesIndex } = mesAlvo();
  const inicio = new Date(ano, mesIndex, 1);
  const fim = new Date(ano, mesIndex + 1, 0); // dia 0 do mês seguinte = último dia do mês-alvo

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   CONTRATOS A VENCER NO MÊS → Grupo da Equipe     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`   Mês-alvo: ${MESES[mesIndex]}/${ano}  |  Grupo: ${GRUPO}\n`);

  const alunas = await buscarContratosDoPeriodo(inicio, fim);
  if (alunas === null) {
    console.log('\n⚠️  Não consegui ler os contratos no EVO — nada foi enviado.');
    return { mes: mesIndex + 1, total: 0, enviado: false, erro: true };
  }

  const mensagem = montarMensagem(alunas, mesIndex, ano);
  console.log('\n─── Mensagem ───────────────────────────────────────');
  console.log(mensagem);
  console.log('────────────────────────────────────────────────────');

  if (DRY) { console.log('\n🧪 Modo --dry: NADA foi enviado.'); return { mes: mesIndex + 1, total: alunas.length, enviado: false }; }

  // Envia no grupo pelo cliente único do robô (mesmo caminho dos aniversariantes/faltantes).
  const wa = require('./wa-client');
  let ok = false;
  try {
    await wa.initWhatsApp();
    await wa.sendGrupo(GRUPO, mensagem);
    ok = true;
    console.log(`\n✅ Enviado no grupo "${GRUPO}".`);
  } catch (e) {
    console.log(`\n⚠️  Falha ao enviar no grupo "${GRUPO}": ${e.message}`);
  }
  return { mes: mesIndex + 1, total: alunas.length, enviado: ok };
}

module.exports = { runRenovacoesMesGrupo, buscarContratosDoPeriodo, montarMensagem, GRUPO };

if (require.main === module) {
  runRenovacoesMesGrupo()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}

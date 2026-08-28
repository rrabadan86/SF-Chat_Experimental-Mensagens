/**
 * Lê no EVO a segmentação "Aniversariantes" (status Ativos, mês = TODOS) e
 * sincroniza a lista de alunas ativas + data de aniversário com uma planilha
 * do Google Sheets, preservando as colunas que o usuário preenche à mão.
 *
 * Fonte dos dados: intercepta a API interna "obter-clientes" do EVO (traz o ID
 * da matrícula, nome e data de nascimento). Fallback: lê a tabela do DOM.
 *
 * Uso:
 *   node src/planilha-aniversarios.js            → lê o EVO e sincroniza a planilha
 *   node src/planilha-aniversarios.js --dry      → só lê e imprime (NÃO escreve na planilha)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const config = require('./config');
const { sincronizar } = require('./sheets-sync');

const DRY = process.argv.includes('--dry');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));


async function buscarAlunasAniversario() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🎂 Lendo alunas ativas + aniversários no EVO...');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Captura as respostas da API "obter-clientes" como SNAPSHOTS separados (não
  // acumulados). O EVO chama essa API com a base inteira (306) E com o conjunto
  // filtrado (ex.: 81). Depois escolhemos o snapshot cujo tamanho bate com o
  // total exibido — é o filtrado — e usamos o campo "nome" LIMPO da API.
  const snapshots = [];
  const parseRec = (r) => {
    const id = String(r.idCliente ?? r.idFilialCliente ?? r.id ?? r.codigo ?? r.matricula ?? '').trim();
    const nome = String(r.nome ?? r.nomeCompleto ?? r.nomeCliente ?? '').replace(/\s+/g, ' ').trim();
    const nascRaw = r.dataNascimento ?? r.dataNasc ?? r.nascimento ?? r.dtNascimento ?? '';
    let aniv = '';
    const s = String(nascRaw);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) aniv = `${m[3]}/${m[2]}`;
    if (!aniv) { m = s.match(/(\d{2})\/(\d{2})\/\d{2,4}/); if (m) aniv = `${m[1]}/${m[2]}`; }
    return id ? { id, nome, aniversario: aniv } : null;
  };
  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  page.on('response', async (res) => {
    try {
      if (res.url().includes('obter-clientes') && res.status() === 200) {
        const data = JSON.parse(await res.text());
        const lista = data.retorno || data.data || [];
        const recs = lista.map(parseRec).filter(Boolean);
        if (recs.length) snapshots.push(recs);
      }
    } catch (e) { /* respostas não-JSON */ }
  });

  try {
    // 1. Login
    console.log('🔐 Fazendo login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(4000);
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    console.log('✅ Login OK\n');

    // 2. Segmentação → "Aniversariantes"
    console.log('📂 Abrindo Segmentação "Aniversariantes"...');
    await page.evaluate(() => { location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes'; });
    await sleep(5000);
    const tentarClicar = () => page.evaluate(() => {
      const els = document.querySelectorAll('a, li, span, div');
      for (const el of els) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t === 'aniversariantes' && el.offsetWidth > 0 && el.offsetHeight > 0) { el.scrollIntoView(); el.click(); return true; }
      }
      for (const el of els) {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t.includes('aniversariante') && el.children.length === 0 && el.offsetWidth > 0) { el.scrollIntoView(); el.click(); return true; }
      }
      return false;
    });

    // A lista de segmentos do EVO às vezes demora bem mais que os 5s de espera.
    // Antes tentávamos UMA vez e o job morria; agora insistimos por até ~45s.
    let segClicado = false;
    for (let i = 0; i < 15 && !segClicado; i++) {
      segClicado = await tentarClicar();
      if (!segClicado) await sleep(3000);
    }

    if (!segClicado) {
      const visiveis = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('md-list-item, li, a')) {
          const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (t && t.length < 60 && el.offsetWidth > 0 && !out.includes(t)) out.push(t);
        }
        return out.slice(0, 40);
      }).catch(() => []);
      // Se o EVO mudou a rota, ele redireciona para a Home e a lista de
      // segmentos nunca aparece — o endereço abaixo denuncia isso na hora.
      const ondeEstou = await page.evaluate(() => location.href).catch(() => '(?)');
      console.log(`   🌐 Endereço em que a tela parou: ${ondeEstou}`);
      console.log('   📋 Itens visíveis na tela agora:');
      visiveis.forEach(t => console.log(`      • ${t}`));
      throw new Error('Segmento "Aniversariantes" não encontrado (procurei por 45s). '
        + 'Veja a lista acima: se o segmento foi renomeado no EVO, me diga o nome novo.');
    }
    await sleep(6000);

    // 3. Seleciona "Mês de aniversário: Todos" — clicando SOMENTE dentro do
    //    dropdown aberto (o menu lateral tem um segmento chamado "Todos" que
    //    NÃO pode ser clicado por engano; era isso que estourava para 306).
    console.log('🗓️  Selecionando "Mês de aniversário: Todos"...');
    try { await selecionarMesTodos(page); }
    catch (e) { console.log(`   ⚠️  Filtro de mês falhou (${e && e.message ? e.message : e}) — seguindo com o padrão.`); }
    await sleep(4000);

    // 4. LÊ A TABELA DO DOM em todas as páginas. A tabela reflete EXATAMENTE a
    //    segmentação filtrada — é a fonte correta (a API do EVO também dispara
    //    com a base inteira antes do filtro, poluindo os dados).
    const domMap = new Map();
    let totalEsperado = await lerTotalResultados(page);
    console.log(`   🔢 EVO informa ${totalEsperado || '?'} resultado(s) na segmentação.`);
    let paginasSemNovos = 0;
    for (let pagina = 1; pagina <= 80; pagina++) {
      await sleep(800);
      const linhas = await lerTabelaDom(page);
      if (pagina === 1 && linhas.length === 0) {
        const diag = await page.evaluate(() => {
          const conta = (sel) => document.querySelectorAll(sel).length;
          const amostra = [];
          const cand = document.querySelectorAll('tr, [role="row"], [class*="row"]');
          for (let i = 0; i < Math.min(cand.length, 4); i++) {
            amostra.push((cand[i].innerText || '').replace(/\s+/g, ' ').trim().substring(0, 80));
          }
          return {
            'table tr': conta('table tr'),
            'tr[role=row]': conta('tr[role="row"]'),
            '[class*=row]': conta('[class*="row"]'),
            'mat-row': conta('mat-row'),
            amostra,
          };
        });
        console.log('   🔎 DIAGNÓSTICO (0 linhas na pág.1):', JSON.stringify(diag));
      }
      const antes = domMap.size;
      for (const l of linhas) if (l.id && l.nome) domMap.set(l.id, l);
      console.log(`   📄 Página ${pagina}: ${linhas.length} linha(s) — acumulado ${domMap.size}` +
        (totalEsperado ? ` / ${totalEsperado}` : ''));
      if (totalEsperado && domMap.size >= totalEsperado) break;
      // para se não achar linhas novas por 2 páginas seguidas (evita loop)
      paginasSemNovos = (domMap.size === antes) ? paginasSemNovos + 1 : 0;
      if (paginasSemNovos >= 2) break;
      const avancou = await avancarPagina(page);
      if (!avancou) break;
      await sleep(2500);
    }

    // 5. A LISTA CERTA é a do DOM (os 81 filtrados). A API do EVO pagina de 20
    //    em 20 e mistura a base inteira, então NÃO dá para usar um snapshot como
    //    lista. Usamos a API apenas como DICIONÁRIO de NOMES LIMPOS por ID:
    //    juntamos todos os registros de todos os snapshots num mapa id→nome
    //    (ter ids extras não atrapalha — só consultamos os 81 do DOM).
    const nomeLimpoPorId = new Map();
    for (const snap of snapshots) {
      for (const r of snap) {
        if (r.id && r.nome && !nomeLimpoPorId.has(r.id)) nomeLimpoPorId.set(r.id, r.nome);
      }
    }
    console.log(`   🧩 Dicionário de nomes da API: ${nomeLimpoPorId.size} registro(s).`);

    let corrigidos = 0;
    const alunas = Array.from(domMap.values()).map(a => {
      const limpo = nomeLimpoPorId.get(a.id);
      if (limpo && limpo !== a.nome) corrigidos++;
      return { id: a.id, nome: limpo || a.nome, aniversario: a.aniversario };
    });
    console.log(`   ✨ ${corrigidos} nome(s) ajustado(s) pela API (limpos).`);

    console.log(`\n📊 ${alunas.length} aluna(s) na segmentação` +
      (totalEsperado ? ` (EVO informa ${totalEsperado})` : '') + '.');
    if (totalEsperado && alunas.length !== totalEsperado) {
      console.log(`   ⚠️  Contagem diferente do esperado — confira antes de escrever.`);
    }
    return alunas;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Abre o chip "Mês de aniversário" e marca "Todos", clicando SOMENTE dentro do
 * dropdown aberto (.cdk-overlay-container). Assim nunca clica no segmento
 * "Todos" do menu lateral (que carregaria a base inteira).
 */
async function selecionarMesTodos(page) {
  // Componentes Angular ignoram .click() — usamos clique por COORDENADA (mouse).
  // .catch(...) engole erros transitórios do Puppeteer (ex.: "detached Frame",
  // quando o EVO re-renderiza a página no meio da leitura). Vira "não achei" e o
  // loop de retry tenta de novo — em vez de derrubar a planilha inteira.
  const acharChip = () => page.evaluate(() => {
    const els = document.querySelectorAll('span, div, button, [class*="chip"], [class*="filter"]');
    let best = null;
    for (const el of els) {
      const t = (el.textContent || '').trim();
      if (/M[êe]s de anivers/i.test(t) && el.offsetWidth > 0 && el.offsetHeight > 0) {
        if (!best || t.length < best.len) {
          const c = el.closest('button, [class*="chip"], [class*="filter"]') || el;
          const r = c.getBoundingClientRect();
          best = { x: r.left + r.width / 2, y: r.top + r.height / 2, len: t.length };
        }
      }
    }
    return best;
  }).catch(() => null);
  const overlayAberto = () => page.evaluate(() => {
    const o = document.querySelector('.cdk-overlay-container');
    if (!o || o.offsetHeight === 0) return false;
    return /janeiro|fevereiro|aplicar/i.test(o.textContent || '');
  }).catch(() => false);

  let aberto = false;
  for (let t = 1; t <= 4 && !aberto; t++) {
    const chip = await acharChip();
    if (!chip) { await sleep(1000); continue; }
    await page.mouse.click(chip.x, chip.y);
    await sleep(1600);
    aberto = await overlayAberto();
  }
  if (!aberto) { console.log('   ⚠️  Dropdown de mês não abriu — seguindo com o padrão.'); return false; }

  // Marca "Todos" (por coordenada) se ainda não estiver marcado — só no overlay.
  const todos = await page.evaluate(() => {
    const o = document.querySelector('.cdk-overlay-container');
    for (const el of o.querySelectorAll('mat-checkbox, [role="option"], label, li, span, div')) {
      if ((el.textContent || '').trim().toLowerCase() === 'todos' && el.offsetWidth > 0) {
        const inp = el.querySelector('input[type=checkbox]');
        const checked = inp ? inp.checked : (el.getAttribute('aria-checked') === 'true');
        const r = el.getBoundingClientRect();
        return { x: r.left + Math.min(18, r.width / 2), y: r.top + r.height / 2, checked };
      }
    }
    return null;
  });
  if (todos && !todos.checked) { await page.mouse.click(todos.x, todos.y); await sleep(900); }

  // APLICAR (por coordenada) — só no overlay.
  const aplicar = await page.evaluate(() => {
    const o = document.querySelector('.cdk-overlay-container');
    for (const b of o.querySelectorAll('button, span, div, a')) {
      if ((b.textContent || '').trim().toUpperCase() === 'APLICAR' && b.offsetWidth > 0) {
        const c = b.closest('button') || b;
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  });
  if (aplicar) await page.mouse.click(aplicar.x, aplicar.y);
  console.log(`   🗓️  Filtro de mês: aberto=sim, Todos=${todos ? (todos.checked ? 'já-marcado' : 'marcado-agora') : 'n/e'}, aplicar=${!!aplicar}`);
  await sleep(4000);
  return true;
}

/** Lê o total exibido pelo EVO (ex.: "82 resultados"). Retorna 0 se não achar. */
async function lerTotalResultados(page) {
  return page.evaluate(() => {
    const m = (document.body.innerText || '').match(/(\d+)\s+resultados?/i);
    return m ? parseInt(m[1]) : 0;
  });
}

/** Avança UMA página (botão "próxima"), retorna true se conseguiu. */
async function avancarPagina(page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button, [role="button"], [class*="next"], [aria-label]');
    for (const b of btns) {
      const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
      const disabled = b.disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('mat-button-disabled');
      if ((lbl.includes('próxim') || lbl.includes('proxim') || lbl.includes('next')) && !disabled && b.offsetWidth > 0) {
        b.click();
        return true;
      }
    }
    return false;
  });
}

/**
 * Lê nome + nascimento (dd/mm) + ID (badge) das linhas da tabela do EVO.
 * A tabela é feita de <div class="...row..."> (não é <table>), então testamos
 * vários seletores e usamos o que produzir mais linhas COM data de nascimento.
 */
async function lerTabelaDom(page) {
  return page.evaluate(() => {
    const out = [], seen = new Set();

    // Rejeita "lixo" de interface (barra de navegação, ícones, etc.) que não é
    // uma aluna: nomes com dígitos ou palavras de UI não são pessoas.
    const nomeValido = (nome) => {
      if (!nome || nome.length < 3) return false;
      if (/\d/.test(nome)) return false;                              // nome não tem números
      if (/(search|traffic|keyboard|arrow|unidade\s*atual|person_add|pesquis|menu|toolbar|dashboard)/i.test(nome)) return false;
      return /[A-Za-zÀ-ÿ]{3,}/.test(nome);
    };

    // Estratégia principal: cada NOME é um link (azul). Pegamos o texto do link
    // (nome limpo), subimos até o contêiner da linha (que tem a data) e lemos o
    // ID (badge) que aparece antes da data.
    const anchors = document.querySelectorAll('a');
    for (const a of anchors) {
      const nome = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!nomeValido(nome)) continue;
      if (/^(saiba|salvar|novo|todos|clientes|faltantes|aniversariantes|oportunidades|modelos)\b/i.test(nome)) continue;

      let cont = a;
      for (let i = 0; i < 6 && cont; i++) {
        if (/\d{2}\/\d{2}\/\d{2,4}/.test(cont.innerText || '')) break;
        cont = cont.parentElement;
      }
      if (!cont) continue;
      const txt = cont.innerText || '';
      const nasc = txt.match(/(\d{2}\/\d{2}\/\d{2,4})/);
      if (!nasc) continue;
      const antes = txt.slice(0, txt.indexOf(nasc[1]));
      const idm = antes.match(/\b(\d{3,6})\b/);
      if (!idm || seen.has(idm[1])) continue;
      seen.add(idm[1]);
      const d = nasc[1].split('/');
      out.push({ id: idm[1], nome, aniversario: `${d[0]}/${d[1]}` });
    }
    if (out.length) return out;

    // Fallback: lê por contêiner de linha e limpa prefixo de tag ("CL ").
    const seletores = ['[class*="row"]', 'tr[role="row"]', 'mat-row', 'table tbody tr', '[role="row"]'];
    let melhor = [];
    for (const sel of seletores) {
      const res = [];
      document.querySelectorAll(sel).forEach(r => {
        const txt = r.innerText || '';
        const nasc = txt.match(/(\d{2}\/\d{2}\/\d{2,4})/);
        if (!nasc) return;
        const antes = txt.slice(0, txt.indexOf(nasc[1]));
        const idm = antes.match(/\b(\d{3,6})\b/);
        if (!idm) return;
        let nome = antes.replace(/\b\d{3,6}\b/, '').replace(/\bCL\b/gi, '').replace(/\s+/g, ' ').trim();
        if (!nomeValido(nome)) return;                                 // descarta lixo de UI
        const d = nasc[1].split('/');
        res.push({ id: idm[1], nome, aniversario: `${d[0]}/${d[1]}` });
      });
      if (res.length > melhor.length) melhor = res;
    }
    const uniq = [];
    for (const r of melhor) if (!seen.has(r.id)) { seen.add(r.id); uniq.push(r); }
    return uniq;
  });
}

async function runPlanilhaAniversarios() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   PLANILHA — Alunas ativas & aniversários         ║');
  console.log('╚═══════════════════════════════════════════════════╝');

  const alunas = await buscarAlunasAniversario();

  // ordena por mês/dia para leitura (não afeta o alinhamento — a sincronização
  // preserva a ordem já existente na planilha e só adiciona novas no fim)
  alunas.sort((a, b) => {
    const pa = (a.aniversario || '99/99').split('/');
    const pb = (b.aniversario || '99/99').split('/');
    return (parseInt(pa[1]) - parseInt(pb[1])) || (parseInt(pa[0]) - parseInt(pb[0]));
  });

  console.log('\n📋 Prévia (dd/mm — nome — ID):');
  alunas.slice(0, 15).forEach(a => console.log(`   ${a.aniversario.padEnd(6)} ${a.nome}  [${a.id}]`));
  if (alunas.length > 15) console.log(`   ... e mais ${alunas.length - 15}.`);

  if (DRY) {
    console.log('\n🧪 Modo --dry: NADA foi escrito na planilha.');
    return { alunas: alunas.length };
  }

  if (alunas.length === 0) {
    console.log('\n⚠️  Nenhuma aluna coletada — planilha NÃO foi alterada (evita apagar dados).');
    return { alunas: 0 };
  }

  const res = await sincronizar(alunas);
  console.log('\n✅ Concluído.');
  return res;
}

module.exports = { runPlanilhaAniversarios, buscarAlunasAniversario };

if (require.main === module) {
  runPlanilhaAniversarios()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌ Erro:', err.message); process.exit(1); });
}

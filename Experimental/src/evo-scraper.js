const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

// Ativa o plugin stealth para evitar detecção Cloudflare
puppeteer.use(StealthPlugin());

/**
 * Formata a data de amanhã como DD/MM/YYYY
 */
function getTomorrowDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Compara horários no formato HH:MM
 * Retorna true se time >= minTime e time <= maxTime
 */
function isTimeInRange(time, minTime, maxTime) {
  if (!time) return false;
  const normalize = (t) => {
    const parts = t.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  };
  const t = normalize(time);
  const min = normalize(minTime);
  const max = normalize(maxTime);
  return t >= min && t <= max;
}

function normalizeStatus(status) {
  return (status || '').trim().toLowerCase();
}

function isExactStatus(status, expected) {
  return normalizeStatus(status) === expected;
}

class EvoScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    // Domínio real do app após o login (ex.: evo-abc-sec.w12app.com.br).
    // O authToken fica no localStorage DESSE domínio — todas as navegações
    // seguintes precisam usá-lo, senão a sessão "cai" para a tela de login.
    this.appOrigin = null;
  }

  /**
   * Inicializa o browser com stealth mode
   */
  async init() {
    console.log('🌐 Iniciando browser (stealth mode)...');
    const path = require('path');
    // HEADLESS=false (recomendado no Linux via xvfb-run) reproduz o navegador
    // "com tela" que o EVO espera. Perfil persistente guarda cookies/sessão,
    // exatamente como o Edge no Windows — evita cair no login a cada navegação.
    const headless = process.env.HEADLESS !== 'false';
    const userDataDir = process.env.EVO_PROFILE_DIR ||
      path.resolve(__dirname, '..', 'evo-chrome-data');
    this.browser = await puppeteer.launch({
      headless,
      userDataDir,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,900',
      ],
      defaultViewport: { width: 1366, height: 900 },
    });
    this.page = await this.browser.newPage();

    // User-Agent real de Chrome no Windows
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Timeout padrão
    this.page.setDefaultTimeout(60000);
    this.page.setDefaultNavigationTimeout(60000);
  }

  /**
   * Faz login no EVO
   */
  async login() {
    const loginUrl = `${config.evo.url}/${config.evo.loginPath}`;
    console.log(`🔐 Fazendo login em ${loginUrl}...`);

    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Aguarda possível challenge do Cloudflare e o redirecionamento do SPA
    // (ex.: slimfit -> evo5). Durante esse redirect o contexto de execução pode
    // ser destruído, então lemos o conteúdo de forma resiliente (com retry).
    await this.sleep(5000);

    let pageContent = '';
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      try {
        pageContent = await this.page.content();
        break;
      } catch (e) {
        // "Execution context was destroyed" = navegação/redirect em andamento.
        // Espera o SPA assentar e tenta de novo.
        console.log(`   ⏳ Página redirecionando, aguardando (${tentativa}/5)...`);
        await this.sleep(2000);
      }
    }

    if (pageContent.includes('you have been blocked') || pageContent.includes('Cloudflare')) {
      console.log('⚠️  Cloudflare detectado, aguardando resolução...');
      await this.sleep(10000);
    }

    // Aguarda o formulário de login RENDERIZAR de fato. O Angular do EVO demora
    // e varia no headless (às vezes a página fica sem inputs por vários segundos).
    // Se não aparecer, recarrega e tenta de novo (até 3x).
    const formSelectors = ['input#usuario', 'input[type="email"]', 'input[type="text"]', 'input[type="password"]'];
    let formReady = false;
    for (let tent = 1; tent <= 3 && !formReady; tent++) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        formReady = await this.page.evaluate(
          (sels) => sels.some((s) => { const el = document.querySelector(s); return !!(el && el.offsetWidth > 0); }),
          formSelectors
        );
        if (formReady) break;
        await this.sleep(1000);
      }
      if (!formReady) {
        console.log(`   ⏳ Formulário de login ainda não renderizou, recarregando (${tent}/3)...`);
        try { await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (_) {}
        await this.sleep(4000);
      }
    }

    // Debug screenshot
    await this.page.screenshot({ path: 'debug-login.png' });

    // Aguarda os inputs de login — tenta vários seletores
    const inputSelectors = [
      'input#usuario',
      'input[type="email"]',
      'input[type="text"]',
      'input[placeholder*="mail"]',
      'input[placeholder*="usuário"]',
      'input[placeholder*="usuario"]',
    ];

    let emailSelector = null;
    for (const sel of inputSelectors) {
      try {
        await this.page.waitForSelector(sel, { timeout: 5000 });
        emailSelector = sel;
        console.log(`✅ Campo de email encontrado: ${sel}`);
        break;
      } catch (e) { /* continue */ }
    }

    if (!emailSelector) {
      // Lista todos os inputs para debug
      const inputs = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('input')).map(i => ({
          id: i.id, name: i.name, type: i.type,
          placeholder: i.placeholder, tag: i.tagName,
        }));
      });
      console.log('📋 Inputs na página:', JSON.stringify(inputs, null, 2));
      throw new Error('Campo de email não encontrado na página de login');
    }

    // Preenche email
    await this.page.click(emailSelector, { clickCount: 3 });
    await this.page.type(emailSelector, config.evo.email, { delay: 80 });

    // Encontra e preenche senha
    const passwordSelectors = ['input#senha', 'input[type="password"]'];
    let passwordSelector = null;
    for (const sel of passwordSelectors) {
      try {
        await this.page.waitForSelector(sel, { timeout: 3000 });
        passwordSelector = sel;
        break;
      } catch (e) { /* continue */ }
    }

    if (!passwordSelector) {
      throw new Error('Campo de senha não encontrado');
    }

    await this.page.click(passwordSelector, { clickCount: 3 });
    await this.page.type(passwordSelector, config.evo.password, { delay: 80 });

    // Clica no botão ENTRAR
    const btnClicked = await this.page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim()?.toUpperCase();
        if (text && (text.includes('ENTRAR') || text.includes('LOGIN') || text.includes('ACESSAR'))) {
          btn.click();
          return true;
        }
      }
      // Fallback: botão primary
      const primary = document.querySelector('button.primary, button[type="submit"]');
      if (primary) { primary.click(); return true; }
      return false;
    });

    if (!btnClicked) {
      throw new Error('Botão de login não encontrado');
    }

    console.log('⏳ Aguardando login...');

    // Aguarda navegação para dashboard
    await this.page.waitForFunction(
      () => window.location.hash.includes('/inicio/') || window.location.hash.includes('/app/'),
      { timeout: 30000 }
    );

    await this.sleep(3000);

    // O EVO redireciona para o domínio real do app após o login
    // (ex.: evo5 -> evo-abc-sec). Capturamos esse domínio para navegar as
    // próximas páginas NELE — é onde o evo.authToken vive no localStorage.
    try {
      this.appOrigin = new URL(this.page.url()).origin;
      console.log(`   🔗 Domínio autenticado: ${this.appOrigin}`);
    } catch (_) {
      this.appOrigin = null;
    }

    console.log('✅ Login realizado com sucesso!');
  }

  /**
   * Navega para a página de aulas experimentais
   */
  async navigateToExperimental() {
    // Usa o domínio autenticado capturado no login (evo-abc-sec), não o de
    // entrada (evo5) — senão a sessão cai por causa do localStorage isolado.
    const base = this.appOrigin || config.evo.url;
    const url = `${base}/${config.evo.experimentalPath}`;
    console.log(`📋 Navegando para aulas experimentais...`);

    await this.page.goto(url, { waitUntil: 'networkidle2' });
    await this.sleep(4000);

    // Se a sessão caiu para a tela de login (comum ao recarregar o app deep-link),
    // refaz o login e volta para a página de experimentais.
    if (await this.isOnLoginPage()) {
      console.log('   🔐 Sessão caiu na tela de login. Refazendo login...');
      await this.login();
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      await this.sleep(4000);
    }

    // O EVO às vezes abre uma pesquisa de satisfação (NPS) por cima da tela,
    // bloqueando os cliques. Fecha logo após carregar.
    await this.dismissSurveyModal();
  }

  /**
   * Detecta se a página atual é a tela de login do EVO.
   */
  async isOnLoginPage() {
    try {
      return await this.page.evaluate(() => {
        const hash = location.hash || '';
        if (/acesso|autentica/i.test(hash)) return true;
        const txt = document.body ? (document.body.innerText || '') : '';
        const temSenha = !!document.querySelector('input[type="password"]');
        return temSenha && /Que bom ter voc|Esqueci a senha/i.test(txt);
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Fecha modais sobrepostos do EVO (ex.: pesquisa de satisfação / NPS
   * "recomendaria o EVO by ABC Fitness"). Esses pop-ups aparecem de tempos em
   * tempos e cobrem a tela com um backdrop, bloqueando os cliques no filtro —
   * era ESSA a causa da falha "de domingo". Tenta fechar pelo botão × e, se não
   * achar, clica no canto superior direito do diálogo. Também tenta ESC.
   * Retorna true se fechou algo.
   */
  async dismissSurveyModal() {
    try {
      const info = await this.page.evaluate(() => {
        const isVisible = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;
        const dialogs = document.querySelectorAll(
          '[role="dialog"], mat-dialog-container, .mat-dialog-container, .cdk-dialog-container, .modal, .cdk-overlay-pane'
        );
        for (const d of dialogs) {
          if (!isVisible(d)) continue;
          const txt = (d.textContent || '').toLowerCase();
          // só age em modal de pesquisa/recomendação ou com botão de fechar claro
          const btns = d.querySelectorAll('button, [aria-label], [title], [class*="close"], svg, i, span');
          for (const b of btns) {
            const label = ((b.getAttribute && (b.getAttribute('aria-label') || b.getAttribute('title'))) || '').toLowerCase();
            const bt = (b.textContent || '').trim();
            if (isVisible(b) && (label.includes('fechar') || label.includes('close') || label.includes('dismiss') ||
                bt === '×' || bt === '✕' || bt === '⨯' || bt.toLowerCase() === 'x')) {
              (b.closest('button') || b).click();
              return { clicked: true };
            }
          }
          // sem botão claro: devolve o rect para clicar no canto sup. direito (onde fica o ×)
          const r = d.getBoundingClientRect();
          if (/recomendar|escala de zero|by abc fitness|pesquisa/.test(txt)) {
            return { clicked: false, x: r.right - 18, y: r.top + 18 };
          }
        }
        return null;
      });

      if (!info) return false;
      if (!info.clicked && typeof info.x === 'number') {
        await this.page.mouse.click(info.x, info.y);
      }
      // reforço: tecla ESC
      try { await this.page.keyboard.press('Escape'); } catch (_) {}
      console.log('   🧹 Modal sobreposto do EVO (pesquisa/NPS) fechado.');
      await this.sleep(1200);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Altera o filtro de data para uma data específica.
   * Fluxo:
   *  1. Clica no chip "Agendamentos: Hoje"
   *  2. Clica em "Período personalizado" (mat-list-item)
   *  3. Clica no input "Selecionar data" (input#mat-input-0) para abrir calendário
   *  4. Clica no dia alvo 2x (data início + data fim)
   *  5. Clica em "APLICAR"
   */
  async changeDateFilter(dateStr) {
    console.log(`📅 Alterando filtro de data para: ${dateStr}...`);

    // Fecha qualquer pop-up de pesquisa/NPS que esteja bloqueando a tela.
    await this.dismissSurveyModal();

    // Parse da data DD/MM/YYYY ou DD/MM/YY
    const parts = dateStr.split('/');
    const targetDay = parseInt(parts[0]);
    const targetMonth = parseInt(parts[1]) - 1; // 0-indexed
    let targetYear = parseInt(parts[2]);
    if (targetYear < 100) targetYear += 2000; // normaliza ano de 2 dígitos (26 → 2026)

    try {
      // 1. Abre o dropdown de data clicando no chip "Agendamentos: ...".
      //    SEMPRE via coordenada (mouse.click) — os componentes Angular do EVO
      //    IGNORAM o .click() do Puppeteer (era esse o bug intermitente).
      //    Repete até o dropdown REALMENTE abrir (checa se "Período personalizado" apareceu).
      const acharChip = () => this.page.evaluate(() => {
        const isVisible = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;
        // 1) acha o elemento (menor texto) cujo conteúdo começa com "Agendamentos"
        let label = null;
        const candidates = document.querySelectorAll('span, div, button, [class*="chip"], [class*="filter"], evo-filter-date');
        for (const el of candidates) {
          const txt = (el.textContent || '').trim();
          if (txt.startsWith('Agendamentos') && isVisible(el)) {
            if (!label || el.textContent.length < label.textContent.length) label = el;
          }
        }
        if (!label) return null;
        // 2) sobe até o ancestral REALMENTE clicável (chip/botão/evo-filter-date).
        //    No domingo a lista vem vazia e o <span> interno fica estreito/deslocado,
        //    então clicar o centro dele erra o alvo — usamos o container clicável.
        let clickable = label;
        let node = label;
        for (let i = 0; i < 6 && node; i++) {
          const cls = (node.className || '').toString().toLowerCase();
          const tag = node.tagName ? node.tagName.toLowerCase() : '';
          if (tag === 'button' || tag === 'evo-filter-date' || cls.includes('chip') || cls.includes('filter')) {
            clickable = node;
          }
          node = node.parentElement;
        }
        const r = clickable.getBoundingClientRect();
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          w: r.width,
          txt: (label.textContent || '').trim().substring(0, 40),
        };
      });

      const dropdownAberto = () => this.page.evaluate(() => {
        const overlay = document.querySelector('.cdk-overlay-container');
        if (!overlay || overlay.offsetHeight === 0) return false;
        return /personaliz|esta semana|m[eê]s passado/i.test(overlay.textContent || '');
      });

      let aberto = false;
      for (let tent = 1; tent <= 5 && !aberto; tent++) {
        // A partir da 3ª tentativa, recarrega a página. No domingo a tela de
        // experimentais vem SEM aulas (nenhuma "hoje"), e esse estado vazio deixa
        // o chip num layout onde o clique não abre o dropdown. Um reload
        // reinicializa o componente e costuma destravar.
        if (tent === 3) {
          console.log('   🔄 Recarregando a página de experimentais (estado vazio de domingo)...');
          try {
            await this.page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
          } catch (_) {}
          await this.sleep(4000);
        }
        // Antes de cada clique, garante que nenhum modal de pesquisa reapareceu.
        await this.dismissSurveyModal();
        const chip = await acharChip();
        if (!chip) { console.log(`⚠️  Chip "Agendamentos" não encontrado (tentativa ${tent}/5)`); await this.sleep(1500); continue; }
        console.log(`   🖱️  Clicando no chip de data: "${chip.txt}" (tentativa ${tent}/5)`);
        await this.page.mouse.click(chip.x, chip.y);
        await this.sleep(1600);
        aberto = await dropdownAberto();
        // Fallback: clique um pouco à esquerda do centro (o label pode estar
        // deslocado dentro do container quando a lista está vazia).
        if (!aberto) {
          const dx = Math.min((chip.w / 2) - 8, 30);
          if (dx > 0) {
            await this.page.mouse.click(chip.x - dx, chip.y);
            await this.sleep(1600);
            aberto = await dropdownAberto();
          }
        }
      }

      if (!aberto) {
        console.log('⚠️  O dropdown de data NÃO abriu após 5 tentativas.');
        await this.page.screenshot({ path: 'debug-dropdown-nao-abriu.png' });
        console.log('   📸 Screenshot: debug-dropdown-nao-abriu.png');
        return;
      }
      console.log('   ✓ Dropdown de data aberto');

      // 2. Clica em "Período personalizado" — busca robusta (contém "personalizad",
      //    ignora acento/maiúscula, e clica no item clicável mais próximo).
      const periodoClicked = await this.page.evaluate(() => {
        const overlay = document.querySelector('.cdk-overlay-container');
        const containers = overlay ? [overlay, document] : [document];
        for (const container of containers) {
          const all = container.querySelectorAll(
            'mat-list-item, [role="menuitem"], [role="option"], li, button, a, span, div'
          );
          for (const el of all) {
            const t = (el.textContent || '').trim().toLowerCase();
            if (!t || t.length > 40) continue;                 // ignora blocos grandes
            if (/personaliz/.test(t) && el.offsetWidth > 0 && el.offsetHeight > 0) {
              const clickable = el.closest('mat-list-item, [role="menuitem"], [role="option"], li, button, a') || el;
              clickable.click();
              return t.substring(0, 40);
            }
          }
        }
        return null;
      });

      if (!periodoClicked) {
        // Diagnóstico: lista as opções visíveis do menu de filtro
        const opts = await this.page.evaluate(() => {
          const overlay = document.querySelector('.cdk-overlay-container') || document.body;
          return Array.from(overlay.querySelectorAll('mat-list-item, [role="menuitem"], [role="option"], li, button, span, div'))
            .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
            .map(el => (el.textContent || '').trim())
            .filter(t => t && t.length < 40 && /per[íi]odo|dia|semana|m[eê]s|personaliz|hoje|ontem|amanh/i.test(t))
            .slice(0, 25);
        });
        console.log('⚠️  "Período personalizado" não encontrado. Opções visíveis:', JSON.stringify(opts));
        await this.page.screenshot({ path: 'debug-periodo-nao-encontrado.png' });
        console.log('   📸 Screenshot: debug-periodo-nao-encontrado.png');
        return;
      }

      await this.sleep(1000);
      console.log(`   ✓ Período personalizado selecionado ("${periodoClicked}")`);

      // 3. Clica no input de data para abrir o calendário
      const inputClicked = await this.page.evaluate(() => {
        // Tenta pelo ID específico primeiro
        const input = document.querySelector('input#mat-input-0, input.input-date-picker-range');
        if (input && input.offsetWidth > 0) {
          input.click();
          input.focus();
          return true;
        }
        // Fallback: qualquer input com placeholder "Selecionar data"
        const inputs = document.querySelectorAll('input');
        for (const inp of inputs) {
          if ((inp.placeholder || '').toLowerCase().includes('selecionar') && inp.offsetWidth > 0) {
            inp.click();
            inp.focus();
            return true;
          }
        }
        return false;
      });

      if (!inputClicked) {
        console.log('⚠️  Input de data não encontrado');
        return;
      }

      await this.sleep(1500);
      console.log('   ✓ Calendário aberto');

      // 4. Navega até o mês/ano correto se necessário
      await this.navigateCalendarToMonth(targetMonth, targetYear);

      // 5. Clica no dia alvo — PRIMEIRA VEZ (data início)
      await this.clickCalendarDay(targetDay);
      await this.sleep(1000);
      console.log(`   ✓ Data início: dia ${targetDay}`);

      // 6. Clica no dia alvo — SEGUNDA VEZ (data fim)
      await this.clickCalendarDay(targetDay);
      await this.sleep(1000);
      console.log(`   ✓ Data fim: dia ${targetDay}`);

      // 7. Clica no botão "APLICAR"
      const applied = await this.page.evaluate(() => {
        const btn = document.querySelector('button.menu-multiselect-button-component');
        if (btn && btn.offsetWidth > 0) { btn.click(); return true; }
        // Fallback: busca pelo texto
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          if (b.textContent?.trim().toUpperCase() === 'APLICAR' && b.offsetWidth > 0) {
            b.click();
            return true;
          }
        }
        return false;
      });

      if (applied) {
        console.log('   ✓ Filtro APLICADO!');
      } else {
        console.log('⚠️  Botão APLICAR não encontrado');
      }

      await this.sleep(3000);
      await this.page.screenshot({ path: 'debug-filter-applied.png' });

    } catch (error) {
      console.error('⚠️  Erro ao alterar filtro de data:', error.message);
    }
  }

  /**
   * Navega o calendário Material até o mês/ano alvo
   */
  async navigateCalendarToMonth(targetMonth, targetYear) {
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Verifica o mês/ano atual exibido no calendário
      const calendarInfo = await this.page.evaluate(() => {
        // Material calendar exibe o mês no header (ex: "ABR 2026")
        const periodBtn = document.querySelector('.mat-calendar-period-button, [class*="calendar"] [class*="period"]');
        if (periodBtn) return periodBtn.textContent?.trim();

        // Fallback: procura qualquer texto de mês no calendário
        const headers = document.querySelectorAll('[class*="calendar"] th, [class*="calendar"] [class*="header"]');
        for (const h of headers) {
          const text = h.textContent?.trim();
          if (text && text.match(/[A-Za-zÇçÃã]{3,}\s*\d{4}/)) return text;
        }
        return null;
      });

      if (!calendarInfo) {
        console.log('   ℹ️  Header do calendário não encontrado, continuando...');
        break;
      }

      // Parse do mês exibido
      const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      const calText = calendarInfo.toLowerCase();
      let currentMonth = -1;
      let currentYear = -1;

      for (let i = 0; i < meses.length; i++) {
        if (calText.includes(meses[i])) {
          currentMonth = i;
          break;
        }
      }
      const yearMatch = calText.match(/\d{4}/);
      if (yearMatch) currentYear = parseInt(yearMatch[0]);

      if (currentMonth === targetMonth && currentYear === targetYear) {
        console.log(`   ✓ Calendário no mês correto: ${calendarInfo}`);
        break;
      }

      // Preciso avançar ou retroceder
      const currentTotal = currentYear * 12 + currentMonth;
      const targetTotal = targetYear * 12 + targetMonth;

      if (targetTotal > currentTotal) {
        // Avança — clica seta para frente
        await this.page.evaluate(() => {
          const nextBtn = document.querySelector('.mat-calendar-next-button, [class*="calendar"] [class*="next"]');
          if (nextBtn) nextBtn.click();
        });
      } else {
        // Retrocede — clica seta para trás
        await this.page.evaluate(() => {
          const prevBtn = document.querySelector('.mat-calendar-previous-button, [class*="calendar"] [class*="previous"]');
          if (prevBtn) prevBtn.click();
        });
      }

      await this.sleep(500);
    }
  }

  /**
   * Clica em um dia específico no calendário Material
   */
  async clickCalendarDay(dayNumber) {
    const clicked = await this.page.evaluate((day) => {
      // Material calendar: cada dia é um td com class mat-calendar-body-cell
      const cells = document.querySelectorAll(
        '.mat-calendar-body-cell, td[class*="calendar"] button, [class*="calendar"] td'
      );

      for (const cell of cells) {
        const text = cell.textContent?.trim();
        // Verifica se o texto é exatamente o dia (não um dia de outro mês)
        if (text === String(day) && cell.offsetWidth > 0 && cell.offsetHeight > 0) {
          // Verifica se não está desabilitado
          const isDisabled = cell.getAttribute('aria-disabled') === 'true' ||
                            cell.classList.contains('mat-calendar-body-disabled');
          if (!isDisabled) {
            // Clica no botão dentro da célula se existir
            const btn = cell.querySelector('button, div[class*="content"]');
            if (btn) {
              btn.click();
            } else {
              cell.click();
            }
            return true;
          }
        }
      }

      // Fallback: tenta encontrar pelo aria-label ou data attribute
      const allBtns = document.querySelectorAll('button, td');
      for (const btn of allBtns) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        if (ariaLabel.includes(String(day)) && btn.offsetWidth > 0) {
          btn.click();
          return true;
        }
      }

      return false;
    }, dayNumber);

    if (!clicked) {
      console.log(`   ⚠️  Dia ${dayNumber} não encontrado no calendário`);
    }
  }

  /**
   * Extrai a lista de aulas experimentais da tabela
   */
  async extractClassList() {
    console.log('📊 Extraindo lista de aulas experimentais...');

    // Screenshot para debug
    await this.page.screenshot({ path: 'debug-table.png' });

    const classes = await this.page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, tr.mat-row, tr[class*="row"]');
      const data = [];

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td, td.mat-cell');
        if (cells.length < 3) return;

        const cellTexts = Array.from(cells).map(c => c.textContent?.trim() || '');

        let id = '';
        let name = '';
        let activity = '';
        let time = '';
        let professor = '';
        let date = '';

        for (let i = 0; i < cellTexts.length; i++) {
          const text = cellTexts[i];

          // ID + Nome (ex: "431770P  Martina Final 5000")
          const idMatch = text.match(/^(\d+\w*)\s+(.*)/s);
          if (idMatch && !id) {
            id = idMatch[1].trim();
            name = idMatch[2].trim();
            continue;
          }

          // Horário (HH:MM)
          const timeMatch = text.match(/^(\d{1,2}:\d{2})$/);
          if (timeMatch && !time) {
            time = timeMatch[1];
            continue;
          }

          // Data (DD/MM/YYYY)
          const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dateMatch && !date) {
            date = dateMatch[1];
            continue;
          }

          // Atividade
          if (!activity && text.length > 0 && text.length < 30 && !text.match(/^\d/) &&
              text !== '-' && text !== 'Recepção' && !text.includes('/')) {
            activity = text;
          }
        }

        // Professor
        for (let i = 0; i < cellTexts.length; i++) {
          const text = cellTexts[i];
          if (text && text !== id && text !== name && text !== activity &&
              text !== time && text !== date && text !== '-' &&
              !text.match(/^\d/) && text !== 'Recepção' && text.length > 3) {
            if (!professor) professor = text;
          }
        }

        // Status (Presença, Falta, Confirmado, Pendente, Cancelado, etc.)
        // OBS: este bloco roda DENTRO do page.evaluate (contexto do NAVEGADOR),
        // então NÃO pode chamar funções do Node (normalizeStatus/isExactStatus).
        // Normaliza inline aqui.
        const statusValues = ['presença', 'presenca', 'falta', 'confirmado', 'cancelado', 'pendente', 'agendado', 'realizado'];
        let status = '';
        for (const text of cellTexts) {
          const lower = (text || '').trim().toLowerCase();
          if (statusValues.includes(lower)) {
            status = text.trim();
            break;
          }
        }

        // "Virou aluna?" — só é aluna quando a coluna "Nome do contrato" está
        // PREENCHIDA (matrícula fechada). ATENÇÃO: NÃO dá pra usar "2+ datas na
        // linha" como sinal, porque TODA aula experimental já tem duas datas
        // (Data da atividade + a data da "Venda" da própria experimental, idService
        // 128) — isso marcava todo mundo como aluna por engano. O único sinal
        // confiável é o nome do contrato (texto com "-" e maiúsculas, ex.:
        // "SLIMFIT 12X - ANUAL"), que fica vazio para quem só fez a experimental.
        let contrato = '';
        for (const t of cellTexts) {
          if (t && t !== name && t.length >= 6 && /[-–]/.test(t) &&
              /[A-ZÁÉÍÓÚÂÊÔÃÕ]{2,}/.test(t) && !/\d{2}\/\d{2}\/\d{4}/.test(t)) {
            contrato = t.trim();
          }
        }
        const virouAluna = !!contrato;

        if (name) {
          data.push({ id, name, activity, time, professor, date, status, virouAluna, contrato });
        }
      });

      return data;
    });

    console.log(`   Encontradas ${classes.length} aula(s) experimental(is)`);
    return classes;
  }

  /**
   * Abre o detalhe de um aluno e extrai o telefone
   */
  async getStudentPhone(studentName) {
    console.log(`   📱 Buscando telefone de: ${studentName}...`);

    try {
      // Clica no nome do aluno
      const clicked = await this.page.evaluate((name) => {
        const elements = document.querySelectorAll('a, span, td');
        for (const el of elements) {
          if (el.textContent?.trim().includes(name) && el.offsetWidth > 0) {
            const innerLink = el.querySelector('a');
            if (innerLink) { innerLink.click(); return true; }
            el.click();
            return true;
          }
        }
        return false;
      }, studentName);

      if (!clicked) {
        console.log(`   ⚠️  Link do aluno "${studentName}" não encontrado`);
        return null;
      }

      await this.sleep(3000);

      // Extrai telefone do painel de detalhes
      const phone = await this.page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (text === 'Celular' && el.offsetWidth > 0) {
            const parent = el.parentElement;
            if (parent) {
              const cleaned = parent.textContent.replace('Celular', '').trim();
              const match = cleaned.match(/[\d\s\(\)\-\+]+/);
              if (match && match[0].replace(/\D/g, '').length >= 10) {
                return match[0].replace(/\D/g, '');
              }
            }
            let next = el.nextElementSibling;
            if (next) {
              const match = next.textContent?.trim().match(/[\d\s\(\)\-\+]+/);
              if (match && match[0].replace(/\D/g, '').length >= 10) {
                return match[0].replace(/\D/g, '');
              }
            }
          }
        }

        // Fallback: busca 10-11 dígitos no side panel
        const body = document.body.textContent || '';
        const matches = body.match(/Celular[\s\S]*?(\d{10,11})/);
        if (matches) return matches[1];

        return null;
      });

      await this.closeDetailPanel();

      if (phone) {
        console.log(`   ✅ Telefone encontrado: ${phone}`);
      } else {
        console.log(`   ⚠️  Telefone não encontrado para ${studentName}`);
      }

      return phone;
    } catch (error) {
      console.error(`   ❌ Erro ao buscar telefone de ${studentName}:`, error.message);
      await this.closeDetailPanel();
      return null;
    }
  }

  /**
   * Fecha o painel de detalhes
   */
  async closeDetailPanel() {
    try {
      const closed = await this.page.evaluate(() => {
        // Procura botão FECHAR ou X
        const elements = document.querySelectorAll('button, a, span, mat-icon');
        for (const el of elements) {
          const text = el.textContent?.trim().toLowerCase();
          if ((text === 'close' || text === 'x' || text === '✕' || text === 'fechar' || text === '×') &&
              el.offsetWidth > 0) {
            el.click();
            return true;
          }
        }
        const icons = document.querySelectorAll('[class*="close"], [aria-label*="close"], [aria-label*="fechar"]');
        for (const icon of icons) {
          if (icon.offsetWidth > 0) { icon.click(); return true; }
        }
        return false;
      });

      if (!closed) {
        await this.page.keyboard.press('Escape');
      }
      await this.sleep(1000);
    } catch (error) {
      try { await this.page.keyboard.press('Escape'); } catch (e) { /* ignore */ }
      await this.sleep(500);
    }
  }

  /**
   * Busca aulas experimentais para HOJE (após 12h)
   */
  async getTodayAfternoonClasses() {
    console.log('\n═══════════════════════════════════════');
    console.log('🌅 Buscando aulas experimentais de HOJE (após 12h)');
    console.log('═══════════════════════════════════════\n');

    await this.navigateToExperimental();
    const allClasses = await this.extractClassList();

    // Apenas aulas com STATUS = "Agendado" recebem confirmação
    const agendadas = allClasses.filter(c => (c.status || '').toLowerCase().includes('agendad'));
    console.log(`   📋 ${agendadas.length} agendada(s) de ${allClasses.length} total`);

    const filtered = agendadas.filter(c =>
      isTimeInRange(c.time, config.filters.morning.minTime, config.filters.morning.maxTime)
    );

    console.log(`\n   📋 ${filtered.length} aula(s) agendada(s) após 12h`);
    return await this.enrichWithPhones(filtered);
  }

  /**
   * Busca aulas experimentais para AMANHÃ (até 11:30)
   */
  async getTomorrowMorningClasses() {
    const tomorrowStr = getTomorrowDateStr();
    console.log('\n═══════════════════════════════════════');
    console.log(`🌙 Buscando aulas experimentais de AMANHÃ (${tomorrowStr}, até 11:30)`);
    console.log('═══════════════════════════════════════\n');

    await this.navigateToExperimental();
    await this.changeDateFilter(tomorrowStr);
    await this.sleep(2000);

    const allClasses = await this.extractClassList();

    // Apenas aulas com STATUS = "Agendado" recebem confirmação
    const agendadas = allClasses.filter(c => (c.status || '').toLowerCase().includes('agendad'));
    console.log(`   📋 ${agendadas.length} agendada(s) de ${allClasses.length} total`);

    const filtered = agendadas.filter(c =>
      isTimeInRange(c.time, config.filters.afternoon.minTime, config.filters.afternoon.maxTime)
    );

    console.log(`\n   📋 ${filtered.length} aula(s) agendada(s) até 11:30`);
    return await this.enrichWithPhones(filtered);
  }

  /**
   * Enriquece a lista de aulas com os telefones dos alunos
   */
  async enrichWithPhones(classes) {
    const enriched = [];
    for (const cls of classes) {
      const phone = await this.getStudentPhone(cls.name);
      enriched.push({ ...cls, phone: phone || 'N/A' });
      await this.sleep(1000);
    }
    return enriched;
  }

  /**
   * Retorna a data de ontem no formato DD/MM/YYYY
   */
  getYesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  /**
   * Busca aulas de ontem filtradas por STATUS = Presença.
   * timeFilter: 'morning' (antes das 12h), 'afternoon' (a partir das 12h), 'all'
   */
  async getYesterdayPresenceClasses(timeFilter = 'all', dataOverride = null) {
    const yesterdayStr = dataOverride || this.getYesterdayDateStr();

    console.log('\n═══════════════════════════════════════');
    console.log(`🎯 Follow-up: aulas de ontem (${yesterdayStr}) com Presença`);
    console.log('═══════════════════════════════════════\n');

    await this.navigateToExperimental();
    await this.changeDateFilter(yesterdayStr);
    await this.sleep(3000);

    const allClasses = await this.extractClassList();
    console.log(`   Total de aulas: ${allClasses.length}`);

    const comPresenca = allClasses.filter(c =>
      (c.status || '').toLowerCase().includes('presen')
    );
    console.log(`   Com Presença: ${comPresenca.length}`);

    let filtered;
    if (timeFilter === 'morning') {
      filtered = comPresenca.filter(c => isTimeInRange(c.time, '00:00', '11:59'));
      console.log(`   Manhã (até 11:59): ${filtered.length}`);
    } else if (timeFilter === 'afternoon') {
      filtered = comPresenca.filter(c => isTimeInRange(c.time, '12:00', '23:59'));
      console.log(`   Tarde (a partir 12h): ${filtered.length}`);
    } else {
      filtered = comPresenca;
    }

    if (filtered.length === 0) return [];
    return await this.enrichWithPhones(filtered);
  }

  /**
   * Retorna a data de HOJE no formato DD/MM/YYYY
   */
  getTodayDateStr() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  /**
   * Busca as FALTAS (no-show) de HOJE na aula experimental → para reengajar/remarcar.
   * timeFilter: 'morning' (até 11:59), 'afternoon' (a partir das 12h), 'all'.
   */
  async getTodayNoShowClasses(timeFilter = 'all') {
    const todayStr = this.getTodayDateStr();

    console.log('\n═══════════════════════════════════════');
    console.log(`🚫 Faltas (no-show) de hoje (${todayStr})`);
    console.log('═══════════════════════════════════════\n');

    await this.navigateToExperimental();
    await this.changeDateFilter(todayStr);
    await this.sleep(3000);

    const allClasses = await this.extractClassList();
    console.log(`   Total de aulas: ${allClasses.length}`);

    const comFalta = allClasses.filter(c => isExactStatus(c.status, 'falta'));
    console.log(`   Com Falta: ${comFalta.length}`);

    let filtered;
    if (timeFilter === 'morning') {
      filtered = comFalta.filter(c => isTimeInRange(c.time, '00:00', '11:59'));
      console.log(`   Manhã (até 11:59): ${filtered.length}`);
    } else if (timeFilter === 'afternoon') {
      filtered = comFalta.filter(c => isTimeInRange(c.time, '12:00', '23:59'));
      console.log(`   Tarde/Noite (a partir 12h): ${filtered.length}`);
    } else {
      filtered = comFalta;
    }

    if (filtered.length === 0) return [];
    return await this.enrichWithPhones(filtered);
  }

  /**
   * Lê o RESUMO da semana das experimentais: seleciona o filtro "Esta semana"
   * e captura os cartões do topo (Aulas agendadas, Presenças, Vendas de novos
   * contratos). Retorna { agendadas, presencas, vendas } (números).
   */
  async getWeekSummary() {
    console.log('\n═══════════════════════════════════════');
    console.log('📊 Resumo da SEMANA (experimentais)');
    console.log('═══════════════════════════════════════\n');

    await this.navigateToExperimental();

    // Abre o dropdown de data e clica em "Esta semana" (clique por coordenada).
    const acharChip = () => this.page.evaluate(() => {
      const isVisible = (el) => el && el.offsetWidth > 0 && el.offsetHeight > 0;
      let label = null;
      for (const el of document.querySelectorAll('span, div, button, [class*="chip"], [class*="filter"], evo-filter-date')) {
        const txt = (el.textContent || '').trim();
        if (txt.startsWith('Agendamentos') && isVisible(el)) {
          if (!label || el.textContent.length < label.textContent.length) label = el;
        }
      }
      if (!label) return null;
      let clickable = label, node = label;
      for (let i = 0; i < 6 && node; i++) {
        const cls = (node.className || '').toString().toLowerCase();
        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tag === 'button' || tag === 'evo-filter-date' || cls.includes('chip') || cls.includes('filter')) clickable = node;
        node = node.parentElement;
      }
      const r = clickable.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const overlayAberto = () => this.page.evaluate(() => {
      const o = document.querySelector('.cdk-overlay-container');
      return !!o && o.offsetHeight > 0 && /esta semana|personaliz/i.test(o.textContent || '');
    });

    let aberto = false;
    for (let t = 1; t <= 4 && !aberto; t++) {
      await this.dismissSurveyModal();
      const chip = await acharChip();
      if (!chip) { await this.sleep(1200); continue; }
      await this.page.mouse.click(chip.x, chip.y);
      await this.sleep(1500);
      aberto = await overlayAberto();
    }
    if (aberto) {
      // Clica "Esta semana" por COORDENADA (Angular ignora .click()).
      const coords = await this.page.evaluate(() => {
        const o = document.querySelector('.cdk-overlay-container');
        if (!o) return null;
        for (const el of o.querySelectorAll('mat-list-item, [role="option"], [role="menuitem"], li, button, a, span, div')) {
          const t = (el.textContent || '').trim().toLowerCase();
          if (t === 'esta semana' && el.offsetWidth > 0) {
            const c = el.closest('mat-list-item, [role="option"], [role="menuitem"], li, button, a') || el;
            const r = c.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      });
      if (coords) {
        await this.page.mouse.click(coords.x, coords.y);
        await this.sleep(1200);
        console.log('   ✓ "Esta semana" clicado');
      } else {
        console.log('   ⚠️  "Esta semana" não encontrado — usando visão padrão.');
      }
      // Alguns dropdowns exigem APLICAR; clica se existir no overlay.
      const aplicar = await this.page.evaluate(() => {
        const o = document.querySelector('.cdk-overlay-container');
        if (!o) return null;
        for (const b of o.querySelectorAll('button, span, div, a')) {
          if ((b.textContent || '').trim().toUpperCase() === 'APLICAR' && b.offsetWidth > 0) {
            const c = b.closest('button') || b;
            const r = c.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
        return null;
      });
      if (aplicar) { await this.page.mouse.click(aplicar.x, aplicar.y); console.log('   ✓ APLICAR clicado'); }
      await this.sleep(3500);
    } else {
      console.log('   ⚠️  Dropdown de data não abriu — usando visão padrão.');
    }

    // ── Fonte: os CARTÕES do topo (aggregate do EVO) — confiáveis agora que o
    //    filtro "Esta semana" é aplicado de verdade. Lê "Aulas agendadas",
    //    "Presenças" e "Vendas de novos contratos".
    const cardInfo = await this.page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('div, span, a, li, strong, p, h1, h2, h3'));
      const noTopo = (el) => { const r = el.getBoundingClientRect(); return r.top > 0 && r.top < 460 && el.offsetWidth > 0; };
      const readCard = (label) => {
        for (const el of all) {
          if (!noTopo(el)) continue;
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (t && t.length <= 45 && t.toLowerCase().startsWith(label)) {
            const m = t.match(/(\d{1,4})/); if (m) return parseInt(m[1]);
          }
        }
        return null;
      };
      const amostra = [];
      for (const el of all) {
        if (!noTopo(el)) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 45 && /agendad|presen|venda/i.test(t)) amostra.push(t);
      }
      return {
        agendadas: readCard('aulas agendadas'),
        presencas: readCard('presenças') ?? readCard('presencas') ?? readCard('presença'),
        vendas: readCard('vendas de novos contratos') ?? readCard('vendas de novos') ?? readCard('vendas'),
        _diag: Array.from(new Set(amostra)).slice(0, 15),
      };
    });

    const resumo = {
      agendadas: cardInfo.agendadas,
      presencas: cardInfo.presencas,
      vendas: cardInfo.vendas,
      _diagCards: cardInfo._diag,
    };
    console.log('   📊 Cartões lidos:', JSON.stringify(resumo));
    return resumo;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Lê as REPOSIÇÕES do dia na tela Grade > Horários.
   * A grade mostra os horários do dia; ao abrir um horário, os participantes de
   * reposição vêm marcados (badge "R" / texto "Reposição"). Retorna
   * [{ nome, horario }]. Instrumentado: salva debug-grade.png e, do 1º horário
   * aberto, data/grade-modal.html para ajuste fino dos seletores.
   */
  async getReposicoesGrade(dataStr) {
    const fs = require('fs');
    const path = require('path');
    const DATA_DIR = path.resolve(__dirname, '..', 'data');
    const base = this.appOrigin || config.evo.url;
    const url = `${base}/#/app/slimfit/15/grade/horarios`;

    console.log('\n═══════════════════════════════════════');
    console.log(`🗓️  Reposições do dia (${dataStr}) — Grade > Horários`);
    console.log('═══════════════════════════════════════\n');

    await this.page.goto(url, { waitUntil: 'networkidle2' });
    await this.sleep(5000);
    if (await this.isOnLoginPage()) {
      console.log('   🔐 Sessão caiu na tela de login. Refazendo login...');
      await this.login();
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      await this.sleep(5000);
    }
    await this.dismissSurveyModal();
    await this.sleep(1500);

    // Troca para a visão do DIA (senão lê a semana toda) e garante que é HOJE.
    const clicarBotao = async (rotulo) => {
      const ok = await this.page.evaluate((rotulo) => {
        const alvo = rotulo.trim().toUpperCase();
        const els = Array.from(document.querySelectorAll('button, a, span, div, li'));
        for (const el of els) {
          if ((el.textContent || '').trim().toUpperCase() !== alvo) continue;
          if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
          (el.closest('button, a, [role="button"], li') || el).click();
          return true;
        }
        return false;
      }, rotulo);
      return ok;
    };
    console.log(`   ${await clicarBotao('DIA') ? '📆 Visão DIA' : '⚠️  botão DIA não achado'}`);
    await this.sleep(2500);
    await clicarBotao('HOJE');
    await this.sleep(2500);

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      await this.page.screenshot({ path: path.join(DATA_DIR, 'grade-debug.png'), fullPage: true }).catch(() => {});
    } catch (_) { /* ignore */ }

    // 1) Detecta os "cards" de horário do dia (na visão DIA há 1 aula por horário).
    const slots = await this.page.evaluate(() => {
      const out = [];
      for (const el of Array.from(document.querySelectorAll('div, a, li, td'))) {
        if (el.children.length > 8) continue;
        const t = (el.innerText || '').trim();
        const m = t.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
        if (!m) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.width > 700) continue; // ignora contêineres largos
        out.push({ horario: m[1], x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      }
      // na visão DIA dedup por horário (1 aula por horário)
      const seen = new Set(), uniq = [];
      for (const s of out) { if (!seen.has(s.horario)) { seen.add(s.horario); uniq.push(s); } }
      return uniq;
    });
    console.log(`   🕒 ${slots.length} horário(s) hoje: ${slots.map(s => s.horario).join(', ') || '(nenhum)'}`);

    const reposicoes = [];
    let dumpFeito = false;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      try {
        await this.page.mouse.click(s.x, s.y);
        await this.sleep(2500);

        // espera o painel "PRESENTES" abrir
        await this.page.waitForFunction(
          () => /presentes|marcar aus[êe]ncia|ocupa[çc][ãa]o/i.test(document.body.innerText || ''),
          { timeout: 6000 }
        ).catch(() => {});

        if (!dumpFeito) {
          try {
            const html = await this.page.evaluate(() => {
              const cand = Array.from(document.querySelectorAll('div,section')).find(d => /presentes/i.test(d.innerText || '') && d.innerText.length < 4000);
              return (cand ? cand.outerHTML : document.body.outerHTML).slice(0, 25000);
            });
            fs.writeFileSync(path.join(DATA_DIR, 'grade-modal.html'), html, 'utf8');
            dumpFeito = true;
            console.log('   🧷 Dump do 1º horário salvo em data/grade-modal.html');
          } catch (_) { /* ignore */ }
        }

        // lê participantes: nome vem do link (a.truncate). Reposição = badge "R"
        // no avatar da linha (ou texto "(Reposição)" no popover da linha).
        const info = await this.page.evaluate((horario) => {
          const res = [];
          let totalParticipantes = 0;
          const badges = new Set();
          const anchors = Array.from(document.querySelectorAll('a.truncate, a.primary, a.no-margin'));
          for (const a of anchors) {
            const nome = (a.textContent || '').trim();
            if (!nome || nome.length < 5) continue;
            if (/marcar|fechar|reabrir|enviar|adicionar|hist[óo]rico/i.test(nome)) continue;
            totalParticipantes++;
            // Linha do participante: sobe até o ancestral que contém o botão
            // "MARCAR PRESENÇA/AUSÊNCIA" (garante que o status fica no escopo).
            let row = a.closest('li, tr');
            {
              let anc = a.parentElement, hops = 0;
              while (anc && hops < 8) {
                if (/marcar\s+(aus|presen)/i.test(anc.innerText || '')) { row = anc; break; }
                anc = anc.parentElement; hops++;
              }
            }
            let ehRepo = false;
            const rowTxt = row ? (row.innerText || '') : '';
            if (row) {
              // badge do avatar: elemento-folha com 1-2 letras (R, A, CL...)
              for (const n of Array.from(row.querySelectorAll('*'))) {
                if (n.children.length === 0) {
                  const t = (n.textContent || '').trim();
                  if (t.length >= 1 && t.length <= 2 && /^[A-Za-z]+$/.test(t)) badges.add(t.toUpperCase());
                  if (t.toUpperCase() === 'R') ehRepo = true;
                }
              }
              if (/\(reposi|reposi[çc][ãa]o/i.test(rowTxt)) ehRepo = true;
            }
            if (!ehRepo) continue;
            // Status: MARCAR AUSÊNCIA = presente | MARCAR PRESENÇA = ausente.
            // "Justificada" escrito na linha → Falta Justificada (gera reposição).
            let status = '';
            if (/justificad/i.test(rowTxt)) status = 'Falta Justificada';
            else if (/marcar\s+presen/i.test(rowTxt)) status = 'Falta';
            else if (/marcar\s+aus/i.test(rowTxt)) status = 'Presença';
            res.push({ nome, horario, status, amostra: rowTxt.replace(/\s+/g, ' ').trim().slice(0, 90) });
          }
          return { res, totalParticipantes, badges: Array.from(badges) };
        }, s.horario);

        console.log(`      • ${s.horario}: ${info.totalParticipantes} presente(s), ${info.res.length} reposição | badges: ${info.badges.join(',') || '-'}`);
        for (const a of info.res) {
          console.log(`         ↳ ${a.nome} [${a.status || '?'}] « ${a.amostra} »`);
          reposicoes.push({ nome: a.nome, horario: a.horario, status: a.status });
        }

        // fecha o painel (×, FECHAR ou ESC)
        await this.page.evaluate(() => {
          const bs = Array.from(document.querySelectorAll('button, a, span, i, [role="button"]'));
          for (const b of bs) {
            const t = (b.textContent || '').trim().toLowerCase();
            const lbl = (b.getAttribute && (b.getAttribute('aria-label') || '') || '').toLowerCase();
            if (t === 'fechar' || t === '×' || t === '✕' || lbl.includes('fechar') || lbl.includes('close')) { b.click(); return; }
          }
        });
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.sleep(1200);
      } catch (e) {
        console.log(`   ⚠️  Horário ${s.horario}: ${e.message}`);
      }
    }

    // dedup por nome+horario
    const seen = new Set(), uniq = [];
    for (const r of reposicoes) { const k = (r.nome.toLowerCase()) + '|' + r.horario; if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
    console.log(`   🔁 ${uniq.length} reposição(ões) encontrada(s)\n`);
    return uniq;
  }

  /**
   * Lê os CONTRATOS fechados no dia (Gerencial > Vendas detalhadas).
   * Passos: define De/Até = data, marca o checkbox "Contrato", clica na lupa e
   * lê a grid (Nome + Sobrenome + Item/contrato). Retorna [{ nome, contrato }].
   * A tela é o legado "evo3" (iframe), igual à de Faltantes.
   */
  async getContratosDoDia(dataStr) {
    const fs = require('fs');
    const path = require('path');
    const DATA_DIR = path.resolve(__dirname, '..', 'data');
    const base = this.appOrigin || config.evo.url;
    const url = `${base}/#/app/slimfit/15/evo3/-Gerencial-Gerencial-Index-VENDAS`;

    console.log('\n═══════════════════════════════════════');
    console.log(`💳 Contratos fechados no dia (${dataStr}) — Gerencial > Vendas`);
    console.log('═══════════════════════════════════════\n');

    await this.page.goto(url, { waitUntil: 'networkidle2' });
    await this.sleep(6000);
    if (await this.isOnLoginPage()) {
      await this.login();
      await this.page.goto(url, { waitUntil: 'networkidle2' });
      await this.sleep(6000);
    }
    await this.dismissSurveyModal();

    // Espera o iframe legado (evo3) com o formulário de vendas.
    const acharFrame = async () => {
      for (const f of this.page.frames()) {
        try {
          const ok = await f.evaluate(() => {
            const t = (document.body && document.body.innerText || '').toLowerCase();
            return /vendas detalhadas|data da venda|colaborador venda|considerar especiais/.test(t);
          });
          if (ok) return f;
        } catch (_) { /* frame carregando */ }
      }
      return null;
    };
    let frame = null;
    for (let i = 0; i < 30 && !frame; i++) { frame = await acharFrame(); if (!frame) await this.sleep(1500); }
    if (!frame) { console.log('   ⚠️  Não achei o iframe de Vendas.'); return []; }
    console.log(`   🖼️  Frame: ${frame.url()}`);

    // Define De/Até = data DIGITANDO só nos campos VISÍVEIS (datepicker legado).
    // Setar todos os inputs (inclusive ocultos) corrompia o valor submetido.
    const dateHandles = await frame.$$('input');
    let setCount = 0;
    for (const h of dateHandles) {
      let info;
      try { info = await h.evaluate(el => ({ vis: !!(el.offsetWidth || el.offsetHeight), val: el.value || '', ro: !!el.readOnly })); }
      catch (_) { continue; }
      if (!info.vis || !/\d{2}\/\d{2}\/\d{4}/.test(info.val)) continue;
      try {
        await h.click({ clickCount: 3 });
        await this.sleep(150);
        if (info.ro) {
          await h.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }, dataStr);
        } else {
          await this.page.keyboard.down('Control'); await this.page.keyboard.press('KeyA'); await this.page.keyboard.up('Control');
          await this.page.keyboard.press('Backspace');
          await this.page.keyboard.type(dataStr, { delay: 40 });
          await this.page.keyboard.press('Escape');
          await h.evaluate((el) => { el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); });
        }
        setCount++;
      } catch (_) { /* segue */ }
    }
    const lidos = await frame.$$eval('input', els => els
      .filter(e => (e.offsetWidth || e.offsetHeight) && /\d{2}\/\d{2}\/\d{4}/.test(e.value || ''))
      .map(e => e.value));
    console.log(`   📅 De/Até digitadas em ${setCount} campo(s) → valores visíveis: ${JSON.stringify(lidos)}`);

    // Salva o HTML do formulário para inspeção (checkboxes, datas).
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const formHtml = await frame.evaluate(() => (document.body ? document.body.outerHTML.slice(0, 45000) : ''));
      fs.writeFileSync(path.join(DATA_DIR, 'contratos-form.html'), formHtml, 'utf8');
    } catch (_) { /* ignore */ }

    // Marca o checkbox "Contrato" (Tipo) por GEOMETRIA: acha o elemento cujo
    // TEXTO DIRETO é "Contrato" e marca o checkbox na mesma linha, logo à
    // esquerda dele (o evo3 separa o rótulo do input no DOM).
    // O checkbox da coluna Tipo é #contrato (name="Contratos"), estilizado com
    // jQuery Uniform (wrapper <div class="checker" id="uniform-contrato">).
    const cbInfo = await frame.evaluate(() => {
      const cb = document.querySelector('#contrato') || document.querySelector('input[name="Contratos"][type="checkbox"]');
      if (!cb) return { ok: false, motivo: 'input#contrato não encontrado' };
      const checker = document.getElementById('uniform-contrato') || (cb.closest && cb.closest('.checker'));
      const antes = cb.checked;
      if (!cb.checked && checker) { try { checker.click(); } catch (_) {} } // Uniform alterna pelo wrapper
      if (!cb.checked) {                                                    // fallback: força o estado
        cb.checked = true;
        if (checker) { checker.classList.add('checked'); const sp = checker.querySelector('span'); if (sp) sp.classList.add('checked'); }
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true, id: cb.id, name: cb.name, antes, checked: cb.checked, temChecker: !!checker };
    });
    console.log(cbInfo.ok
      ? `   ☑️  Checkbox "Contrato" (#${cbInfo.id}/${cbInfo.name}) → checked=${cbInfo.checked} (antes=${cbInfo.antes}, wrapper=${cbInfo.temChecker})`
      : `   ⚠️  ${cbInfo.motivo}`);
    await this.sleep(800);

    // Clica na lupa (pesquisar).
    const lupou = await frame.evaluate(() => {
      const cand = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], i, span, [role="button"]'));
      for (const el of cand) {
        if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
        const meta = (((el.getAttribute && ((el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.className || '') + ' ' + (el.value || ''))) || '') + ' ' + (el.textContent || '')).toLowerCase();
        if (/pesquis|buscar|search|lupa|fa-search|glyphicon-search|mdi-magnify/.test(meta)) { (el.closest('button, a, [role="button"], input') || el).click(); return true; }
      }
      return false;
    });
    console.log(lupou ? '   🔍 Lupa clicada' : '   ⚠️  Lupa não encontrada');
    await this.sleep(6000);
    frame = (await acharFrame()) || frame;

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      await this.page.screenshot({ path: path.join(DATA_DIR, 'contratos-debug.png'), fullPage: true }).catch(() => {});
      const gh = await frame.evaluate(() => { const t = document.querySelector('table'); return t ? t.outerHTML.slice(0, 20000) : '(sem table)'; });
      fs.writeFileSync(path.join(DATA_DIR, 'contratos-grid.html'), gh, 'utf8');
    } catch (_) { /* ignore */ }

    // Lê a grid (paginando). Colunas: Tipo|Id|Nome|Sobrenome|Item|... Pula
    // linhas de grupo ("Colaborador:") e de total.
    const lerPagina = () => frame.evaluate(() => {
      const norm = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      let best = null, mx = -1;
      for (const t of document.querySelectorAll('table')) {
        const hs = Array.from(t.querySelectorAll('th')).map(x => norm(x.textContent));
        if (!hs.some(h => h.includes('nome')) || !hs.some(h => h.includes('item'))) continue;
        const n = t.querySelectorAll('tbody tr, tr').length;
        if (n > mx) { mx = n; best = t; }
      }
      if (!best) return { rows: [], info: '', headers: [] };
      const ths = Array.from(best.querySelectorAll('th')).map(x => (x.textContent || '').trim());
      const hn = ths.map(norm);
      const iNome = hn.findIndex(h => h === 'nome' || h.includes('nome'));
      const iSob = hn.findIndex(h => h.includes('sobrenome'));
      const iItem = hn.findIndex(h => h.includes('item'));
      const body = best.querySelector('tbody') || best;
      const trs = Array.from(body.querySelectorAll('tr')).filter(tr => tr.querySelectorAll('td').length);
      const rows = [];
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText || '').trim());
        const joined = tds.join(' | ');
        if (/colaborador:|total geral|^total\b/i.test(joined)) continue;
        const nome = ((iNome >= 0 ? tds[iNome] : '') + ' ' + (iSob >= 0 ? tds[iSob] : '')).trim();
        const item = iItem >= 0 ? tds[iItem] : '';
        if (!nome || !item) continue;
        rows.push({ nome, item });
      }
      const info = (document.body.innerText.match(/Exibindo\s+itens?\s+\d+\s*-\s*\d+\s+de\s+\d+/i) || [''])[0];
      return { rows, info, headers: ths };
    });

    const proxima = async () => {
      const range = () => frame.evaluate(() => ((document.body.innerText.match(/Exibindo\s+itens?\s+(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/i) || []).slice(1).join(',')));
      const antes = await range();
      const clicou = await frame.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('a, button, span, li, i, [role="button"]'))) {
          if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
          const t = (el.textContent || '').trim();
          const cls = ((el.className || '') + ' ' + (el.getAttribute && (el.getAttribute('title') || '') || '')).toLowerCase();
          const isNext = t === '›' || t === '>' || /(\bnext\b|proxim|caret-right|chevron-right|fa-angle-right)/.test(cls);
          if (!isNext) continue;
          if (/disabled/i.test(cls) || (el.closest && el.closest('.disabled, [aria-disabled="true"]'))) return false;
          (el.closest('a, button, [role="button"], li') || el).click(); return true;
        }
        return false;
      });
      if (!clicou) return false;
      await this.sleep(2500);
      const depois = await range();
      return !!(depois && depois !== antes);
    };

    const extrairContrato = (item) => {
      let m = /contrato\s*[-–]\s*([\s\S]+?)\s*[-–]\s*in[íi]cio\s*em/i.exec(item);
      if (m) return m[1].trim();
      return String(item).replace(/^\s*contrato\s*[-–]\s*/i, '').replace(/\s*[-–]\s*in[íi]cio.*$/i, '').trim();
    };

    const out = [];
    let pagina = 1;
    while (pagina <= 20) {
      const { rows, info, headers } = await lerPagina();
      if (pagina === 1) console.log(`   📋 Colunas: ${headers.join(' | ') || '(?)'}`);
      console.log(`   📄 Página ${pagina}: ${rows.length} contrato(s) ${info ? '(' + info + ')' : ''}`);
      for (const r of rows) {
        const contrato = extrairContrato(r.item);
        console.log(`      🎉 ${r.nome} — ${contrato}`);
        out.push({ nome: r.nome, contrato });
      }
      if (!(await proxima())) break;
      frame = (await acharFrame()) || frame;
      pagina++;
    }

    // dedup por nome+contrato
    const seen = new Set(), uniq = [];
    for (const r of out) { const k = (r.nome.toLowerCase()) + '|' + (r.contrato.toLowerCase()); if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
    console.log(`   💳 ${uniq.length} contrato(s) fechado(s) no dia\n`);
    return uniq;
  }

  async close() {
    if (this.browser) {
      console.log('🔒 Fechando browser...');
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = EvoScraper;

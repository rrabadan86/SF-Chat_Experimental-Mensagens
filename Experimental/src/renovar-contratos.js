require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

puppeteer.use(StealthPlugin());

const WHATSAPP_EDGE_PROFILE = process.env.SLIMFIT_FINANCEIRO_PROFILE || 'Default';
const API_BASE = 'https://evo-abc-api.w12app.com.br';
const ID_FILIAL = 15;

// Modo simulação por padrão. Use --enviar para realmente enviar.
const MODO_ENVIO = process.argv.includes('--enviar');

function formatarData(val) {
  if (!val) return 'em breve';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d)) return val;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// Retorna a data exata de D+7 OU a data informada no terminal
function dataAlvoD7() {
  // Procura se você digitou --data=DD/MM no terminal
  const dataArg = process.argv.find(arg => arg.startsWith('--data='));
  
  if (dataArg) {
    const dataManual = dataArg.split('=')[1]; // Ex: 13/07
    const [dia, mes] = dataManual.split('/');
    const alvo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    alvo.setMonth(parseInt(mes) - 1);
    alvo.setDate(parseInt(dia));
    alvo.setHours(0, 0, 0, 0);
    return alvo;
  }

  // Se não digitou nada (ou se for o robô rodando sozinho), segue a regra normal de Hoje + 7
  const alvo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  alvo.setDate(alvo.getDate() + 7);
  alvo.setHours(0, 0, 0, 0);
  return alvo;
}

// Verifica se a data "DD/MM/YYYY" cai EXATAMENTE no dia alvo calculado acima
function venceEmExatos7Dias(dateStr) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateStr || '');
  if (!m) return false; // sem data válida → não envia
  
  const venc = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  venc.setHours(0, 0, 0, 0);
  
  const alvo = dataAlvoD7();
  return venc.getTime() === alvo.getTime();
}

function buildMessage(primeiroNome, dataVencimento) {
  return `Oi, ${primeiroNome}! Tudo bem? 😊
Que alegria ter você no SlimFit! 🥳
Estou enviando essa mensagem para avisar que o seu plano vence no dia ${dataVencimento}. A gente ia adorar continuar com você firme nos treinos! ❤️
Podemos dar andamento na renovação? Prefere manter o mesmo plano ou aumentar a frequência? 💪
Qualquer dúvida, é só me chamar! 😉`;
}

async function buscarContratosVencendoEm7Dias() {
  const alvoCalculado = dataAlvoD7();
  const alvoStr = `${String(alvoCalculado.getDate()).padStart(2,'0')}/${String(alvoCalculado.getMonth()+1).padStart(2,'0')}`;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`📋 Buscando contratos no EVO (Foco na data: ${alvoStr})...`);
  console.log('═══════════════════════════════════════════════════\n');

  // Leitura transparente (igual à confirmação/follow-up): o browser roda em
  // modo headless — NENHUMA aba/janela é aberta na tela para "ler" os contratos
  // no EVO. A única janela que aparece é a do Edge, mais adiante, apenas para
  // ENVIAR a mensagem no WhatsApp.
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,900',
    ],
    defaultViewport: { width: 1366, height: 900 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(30000);

  // Intercepta respostas: lista da segmentação + dadosPessoais do painel
  let clientesIntercept = [];
  let dadosPessoaisCapturado = null;
  await page.setRequestInterception(true);
  page.on('request', req => { req.continue(); });
  page.on('response', async (res) => {
    const url = res.url();
    try {
      if (url.includes('obter-clientes') && res.status() === 200) {
        const data = JSON.parse(await res.text());
        if (data.retorno?.length > 0) clientesIntercept = data.retorno;
      }
      if (url.includes('/dadosPessoais') && res.status() === 200) {
        dadosPessoaisCapturado = JSON.parse(await res.text());
      }
    } catch (e) {}
  });

  function extrairTelefone(data) {
    if (!data) return null;
    if (Array.isArray(data.telefones)) {
      const ordenados = [...data.telefones].sort((a, b) => {
        const cel = (x) => /celular/i.test(x.descricaoTipoContato || '') ? 0 : 1;
        return cel(a) - cel(b);
      });
      for (const t of ordenados) {
        const tipo = (t.descricaoTipoContato || '').toLowerCase();
        if (tipo.includes('mail')) continue;
        const num = String(t.descricao || t.telefone || t.numero || '').replace(/\D/g, '');
        if (num.length >= 10 && num.length <= 11) return num;
      }
    }
    return null;
  }

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
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (['ENTRAR','LOGIN','ACESSAR'].includes(btn.textContent?.trim().toUpperCase())) { btn.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });

    await page.waitForFunction(() => window.location.hash.includes('/inicio/') || window.location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    console.log('✅ Login OK\n');

    // 2. Navega e clica no segmento
    console.log('📂 Navegando para Segmentação...');
    await page.evaluate(() => { window.location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes'; });
    await sleep(5000);

    console.log('🔍 Procurando o menu lateral da segmentação...');
    
    const menuEncontrado = await page.evaluate(() => {
      const candidates = document.querySelectorAll('span, div, a, li, md-list-item');
      for (const el of candidates) {
        const text = el.innerText?.trim() || '';
        const tLower = text.toLowerCase();
        
        if (tLower.includes('vencimento de contrato seman') && text.length < 50 && el.offsetWidth > 0) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const clickableParent = el.closest('md-list-item') || el.closest('a') || el;
          clickableParent.id = 'target-segment-menu';
          return text;
        }
      }
      return null;
    });
    
    if (!menuEncontrado) throw new Error('Menu da Segmentação não encontrado. Verifique se a aba lateral está visível.');
    console.log(`✅ Menu localizado: "${menuEncontrado}"`);
    await sleep(1500);

    console.log('🖱️  Executando clique nativo (simulando mouse humano)...');
    await page.click('#target-segment-menu');
    
    console.log('⏳ Aguardando a tela da segmentação carregar...');
    let chipApareceu = false;
    for(let i = 0; i < 15; i++) { 
        await sleep(1000);
        chipApareceu = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span, div, .md-chip-content'));
            return spans.some(e => e.textContent && e.textContent.toLowerCase().includes('vencimento do contrato:'));
        });
        if(chipApareceu) break;
    }
    
    if(!chipApareceu) {
        console.log('⚠️ Aviso: O chip de data demorou muito para aparecer. Tentando continuar mesmo assim...');
    } else {
        console.log('✅ Segmentação carregada com sucesso na tela!');
    }
    await sleep(2000);

    // 3. Automação do Calendário do EVO (Visão Humana - Com Duplo Clique)
    const alvo = dataAlvoD7();
    console.log(`📅 Ajustando calendário do EVO para a data: ${formatarData(alvo)}...`);

    const resultadoFiltro = await page.evaluate(async (d, m, y) => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // PASSO 1: Clicar no Chip "Vencimento do contrato:..."
      const elementos = Array.from(document.querySelectorAll('span, div, md-chip'));
      const chipNodes = elementos.filter(el => {
          const txt = el.textContent || '';
          return txt.toLowerCase().includes('vencimento do contrato:') && el.offsetWidth > 0;
      });
      
      if (chipNodes.length > 0) {
          const chipVencimento = chipNodes[chipNodes.length - 1];
          const clickable = chipVencimento.closest('md-chip') || chipVencimento.closest('.md-chip-content') || chipVencimento;
          clickable.click();
          await wait(1500);
      } else {
          return '⚠️ Chip de vencimento não encontrado.';
      }

      // PASSO 2: Clicar na opção "Período personalizado"
      const opcoes = Array.from(document.querySelectorAll('md-list-item, div, span'));
      const itemPeriodo = opcoes.find(el => {
          const txt = (el.textContent || '').trim().toLowerCase();
          return txt.includes('período personalizado') && txt.length < 30 && el.offsetWidth > 0;
      });
      
      if (itemPeriodo) {
          itemPeriodo.click();
          await wait(1500);
      } else {
          return '⚠️ Opção "Período personalizado" não encontrada.';
      }

      // PASSO 3: Clicar no campo "Selecionar data"
      const inputs = Array.from(document.querySelectorAll('input'));
      const inputData = inputs.find(i => (i.placeholder || '').toLowerCase().includes('selecionar data'));
      
      if (inputData) {
          inputData.click();
          await wait(1500);
      } else {
          return '⚠️ Campo "Selecionar data" não encontrado.';
      }

      // PASSO 4: Ao clicar em "Selecionar data" abre um CALENDÁRIO. Como o mês atual
      // (ex.: julho) pode ser diferente do mês-alvo (ex.: agosto, quando D+7 cai no mês
      // seguinte), precisamos AVANÇAR o calendário até o mês certo e então clicar no dia.
      // O componente pode ser Angular Material (mat-calendar, com seta "próximo mês")
      // OU AngularJS (md-calendar, rolável). Tratamos os dois.
      const mesesFull = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
      const mesesAbbr = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      const mesAlvoFull = mesesFull[m];
      const mesAlvoAbbr = mesesAbbr[m];
      const anoAlvo = String(y);

      // Espera algum calendário abrir de fato.
      for (let i = 0; i < 20; i++) {
        if (document.querySelector('mat-calendar, .mat-calendar, md-calendar, .md-calendar')) break;
        await wait(250);
      }

      const isDisabled = (el) =>
        el.classList.contains('md-calendar-date-disabled') ||
        el.classList.contains('mat-calendar-body-disabled') ||
        el.getAttribute('aria-disabled') === 'true' ||
        (el.className || '').toLowerCase().includes('disabled');

      // Acha o dia-alvo garantindo MÊS + ANO corretos (evita pegar "3" do mês errado).
      const acharDiaNoMesAlvo = () => {
        // 1) células com aria-label completo (vale p/ mat e md): "3 de agosto de 2026"
        const cand = document.querySelectorAll('td[aria-label], .mat-calendar-body-cell[aria-label], button[aria-label]');
        for (const el of cand) {
          const al = (el.getAttribute('aria-label') || '').toLowerCase();
          if (!al) continue;
          const okMes = al.includes(mesAlvoFull) || al.includes(mesAlvoAbbr);
          const okAno = al.includes(anoAlvo);
          const okDia = new RegExp('(^|[^0-9])' + d + '([^0-9]|$)').test(al);
          if (okMes && okAno && okDia && el.offsetWidth > 0 && !isDisabled(el)) return el;
        }
        // 2) por seção de mês (AngularJS md-calendar: tbody.md-calendar-month rotula o mês)
        const months = document.querySelectorAll('tbody.md-calendar-month, .md-calendar-month');
        for (const mesEl of months) {
          const label = (mesEl.textContent || '').toLowerCase();
          if (!label.includes(mesAlvoFull) && !label.includes(mesAlvoAbbr)) continue;
          for (const td of mesEl.querySelectorAll('td')) {
            if ((td.textContent || '').trim() !== String(d)) continue;
            if (td.offsetWidth > 0 && !isDisabled(td)) return td;
          }
        }
        return null;
      };

      // Botão "próximo mês" do Angular Material (ou variações genéricas).
      const acharBotaoProximo = () =>
        document.querySelector('.mat-calendar-next-button:not([disabled])') ||
        Array.from(document.querySelectorAll('button')).find(b => {
          if (b.offsetWidth <= 0 || b.disabled) return false;
          const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.title || '')).toLowerCase();
          const ic = (b.textContent || '').toLowerCase();
          return lbl.includes('próximo') || lbl.includes('proximo') || lbl.includes('next')
            || ic.includes('keyboard_arrow_right') || ic.includes('chevron_right');
        });

      const scroller = document.querySelector('.md-virtual-repeat-scroller')
        || document.querySelector('.md-calendar-scroll-mask');

      // Navega até o dia-alvo aparecer: clica "próximo mês" (mat) OU rola (md).
      let diaEl = acharDiaNoMesAlvo();
      for (let passo = 0; passo < 18 && !diaEl; passo++) {
        const btnProx = acharBotaoProximo();
        if (btnProx) {
          btnProx.click();
        } else if (scroller) {
          scroller.scrollTop += 300;
          scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        } else {
          break; // não há como navegar de mês
        }
        await wait(400);
        diaEl = acharDiaNoMesAlvo();
      }

      if (!diaEl) {
        // Diagnóstico: se ainda falhar, o log diz qual é o componente real.
        const temMat = !!document.querySelector('mat-calendar, .mat-calendar');
        const temMd = !!document.querySelector('md-calendar, .md-calendar');
        const periodo = (document.querySelector('.mat-calendar-period-button, .mat-calendar-period-button-text')?.textContent || '').trim();
        const amostra = Array.from(document.querySelectorAll('td[aria-label], .mat-calendar-body-cell[aria-label]'))
          .slice(0, 4).map(e => e.getAttribute('aria-label')).join(' | ');
        return `⚠️ Dia ${d} de ${mesAlvoFull}/${y} não encontrado. [mat=${temMat} md=${temMd} proximo=${!!acharBotaoProximo()} scroller=${!!scroller} periodo="${periodo}" amostra="${amostra}"]`;
      }

      const clicaDia = (el) => {
        el.scrollIntoView({ block: 'center' });
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      };

      // Seletor de intervalo: 1º clique = data início, 2º clique = data fim (mesmo dia).
      clicaDia(diaEl);
      await wait(1000);
      clicaDia(acharDiaNoMesAlvo() || diaEl);
      await wait(1500);

      // Clica em APLICAR
      const btnAplicar = Array.from(document.querySelectorAll('button')).find(b =>
        (b.textContent || '').trim().toLowerCase() === 'aplicar' && b.offsetWidth > 0);
      if (btnAplicar) {
          btnAplicar.click();
          return '✓ Filtro de data aplicado com sucesso!';
      }
      return '⚠️ Botão APLICAR não encontrado.';
    }, alvo.getDate(), alvo.getMonth(), alvo.getFullYear());

    console.log(`   👉 ${resultadoFiltro}`);
	
    // 4. Extrai dados e telefones abrindo os painéis
    const clientesCompletos = [];
    clientesIntercept = []; // Limpa o cache
    await sleep(6000);
    console.log(`📊 ${clientesIntercept.length} cliente(s) capturados após o filtro de data\n`);

    for (const c of clientesIntercept) {
      const id = c.idCliente;
      console.log(`📞 Buscando telefone de: ${c.nome} (ID: ${id})...`);

      dadosPessoaisCapturado = null;

      const clicou = await page.evaluate((nome) => {
        const alvo = nome.substring(0, 18);
        const els = document.querySelectorAll('table tbody tr a, table tbody tr td, table tbody tr span');
        for (const el of els) {
          if (el.textContent && el.textContent.includes(alvo) && el.offsetWidth > 0) {
            el.click();
            return true;
          }
        }
        const firstRow = document.querySelector('table tbody tr');
        if (firstRow) { firstRow.click(); return true; }
        return false;
      }, c.nome);

      for (let t = 0; t < 20 && !dadosPessoaisCapturado; t++) await sleep(500);

      const telefone = extrairTelefone(dadosPessoaisCapturado);
      if (telefone) {
        console.log(`   📱 ${telefone}`);
      } else if (!clicou) {
        console.log(`   ⚠️  Não consegui clicar no cliente`);
      } else if (!dadosPessoaisCapturado) {
        console.log(`   ⚠️  dadosPessoais não carregou`);
      } else {
        const chaves = Object.keys(dadosPessoaisCapturado)
          .filter(k => /telefone|celular|fone|ddd|contato/i.test(k))
          .map(k => `${k}=${JSON.stringify(dadosPessoaisCapturado[k])}`);
        console.log(`   ⚠️  Telefone não encontrado. Campos: ${chaves.join(' | ') || 'nenhum'}`);
      }

      await page.keyboard.press('Escape');
      await sleep(1500);

      clientesCompletos.push({
        id,
        nome: c.nome,
        primeiroNome: (c.nome || '').trim().split(/\s+/)[0],
        contrato: c.contrato || '',
        vencimento: formatarData(c.dataVencimento),
        telefone,
      });
    }

    return clientesCompletos;

  } finally {
    await browser.close();
  }
}

async function enviarWhatsApp(clientes) {
  // Usa o cliente ÚNICO e persistente do WhatsApp (não abre/fecha navegador).
  const wa = require('./wa-client');
  await wa.initWhatsApp();

  const resultados = { enviadas: 0, falhas: 0, puladas: 0 };
  for (const cliente of clientes) {
    if (!cliente.telefone) { console.log(`⏭️  ${cliente.nome}: sem telefone`); resultados.puladas++; continue; }
    const mensagem = buildMessage(cliente.primeiroNome, cliente.vencimento);
    let numero = cliente.telefone.replace(/\D/g, '');
    if (!numero.startsWith('55')) numero = '55' + numero;
    console.log(`📨 Enviando para ${cliente.nome} (${numero})...`);
    try {
      await wa.sendTexto(numero, mensagem);
      console.log(`   ✅ Enviada!`);
      resultados.enviadas++;
    } catch (err) { console.log(`   ❌ Erro: ${err.message}`); resultados.falhas++; }
    await sleep(10000); // pausa entre envios
  }
  return resultados;
}

async function main(modoEnvioParam) {
  const modoEnvio = (modoEnvioParam === undefined) ? MODO_ENVIO : modoEnvioParam;

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     RENOVAÇÃO DE CONTRATOS — SlimFit Setor Bueno ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(modoEnvio ? '🚀 MODO ENVIO ATIVO\n' : '🧪 MODO SIMULAÇÃO (use --enviar para enviar)\n');

  const clientesBrutos = await buscarContratosVencendoEm7Dias();

  if (clientesBrutos.length === 0) {
    console.log('\n✅ Nenhuma lista base encontrada no EVO hoje.');
    return { enviadas: 0, falhas: 0, puladas: 0, clientes: [] };
  }

  // ─── Filtro extra: só envia se o "Vencimento do contrato ATUAL" cai na data alvo ───
  const alvo = dataAlvoD7();
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  console.log(`\n🗓️  Data alvo configurada: ${fmt(alvo)}`);

  const clientes = [];
  const foraDoPrazo = [];
  
  for (const c of clientesBrutos) {
    if (venceEmExatos7Dias(c.vencimento)) {
      clientes.push(c);
    } else {
      foraDoPrazo.push(c);
    }
  }

  if (foraDoPrazo.length > 0) {
    console.log(`\n⏭️  ${foraDoPrazo.length} cliente(s) IGNORADO(s) — a data de vencimento era diferente do alvo:`);
    foraDoPrazo.forEach(c => console.log(`   • ${c.nome} (vence ${c.vencimento})`));
  }

  if (clientes.length === 0) {
    console.log('\n✅ Nenhum cliente confirmado com vencimento exato para a data alvo. Nada a enviar.');
    return { enviadas: 0, falhas: 0, puladas: foraDoPrazo.length, clientes: [] };
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log(`🎯 Encontramos ${clientes.length} contrato(s) vencendo em ${fmt(alvo)}:`);
  clientes.forEach((c, i) => {
    console.log(`${i + 1}. ${c.nome} (ID: ${c.id})`);
    console.log(`   Contrato:   ${c.contrato}`);
    console.log(`   Vencimento: ${c.vencimento}`);
    console.log(`   Telefone:   ${c.telefone || '⚠️ não encontrado'}\n`);
  });
  console.log('─────────────────────────────────────────────────────\n');

  if (!modoEnvio) {
    console.log('🧪 Simulação concluída. Confira os telefones acima.');
    console.log('   Para enviar de verdade: node src/renovar-contratos.js --enviar');
    return { enviadas: 0, falhas: 0, puladas: foraDoPrazo.length, clientes };
  }

  const comTelefone = clientes.filter(c => c.telefone);
  if (comTelefone.length === 0) {
    console.log('⚠️  Nenhum cliente com telefone. Nada a enviar.');
    return { enviadas: 0, falhas: 0, puladas: clientes.length, clientes };
  }

  const resultados = await enviarWhatsApp(clientes);
  console.log(`\n✅ Enviadas: ${resultados.enviadas} | ❌ Falhas: ${resultados.falhas} | ⏭️ Puladas: ${resultados.puladas}\n`);
  return { ...resultados, clientes };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runRenovacao() { return main(true); }

module.exports = { runRenovacao, main };

if (require.main === module) {
  main().catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
}
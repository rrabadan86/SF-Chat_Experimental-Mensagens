// aniversario-ex.js
// Parabéns de aniversário para EX-ALUNAS (status "Inativos" no EVO) — mensagem
// DIRETA no WhatsApp da pessoa (reativação). Diferente do job de alunas ativas
// (aniversariantes.js), que posta @menção nos grupos em comum.
//
// Como funciona:
//   1) Loga no EVO e abre a Segmentação → "Aniversariantes".
//   2) Abre o dropdown "Status de cliente" e deixa SÓ "Inativos" marcado
//      (desmarca "Ativos"). Trava de segurança: se não confirmar Inativos ON e
//      Ativos OFF, ABORTA sem enviar (nunca manda para aluna ativa por engano).
//   3) Lê a tabela, filtra quem faz aniversário HOJE e pega o celular de cada uma.
//   4) Envia a mensagem editável "aniversario_ex" (com flyer opcional) direto.
//
// Uso:
//   node src/aniversario-ex.js               → simulação (não envia)
//   node src/aniversario-ex.js --enviar      → envia de verdade
//   node src/aniversario-ex.js --data=DD/MM  → testa uma data específica
// O scheduler chama runAniversarioEx() (força o envio).

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('./config');

puppeteer.use(StealthPlugin());

let MODO_ENVIO = process.argv.includes('--enviar');
const argData = (process.argv.find(a => a.startsWith('--data=')) || '').split('=')[1];

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RELATORIO_FILE = path.join(DATA_DIR, 'aniversario-ex-envios.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Data: é aniversário hoje? ─────────────────────────────
function diaMesHoje() {
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (argData) {
    const m = /^(\d{1,2})\/(\d{1,2})/.exec(argData);
    if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  }
  return { dia: hoje.getDate(), mes: hoje.getMonth() + 1 };
}

function extrairDiaMesNascimento(valor) {
  if (!valor) return null;
  const s = String(valor);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);   // ISO
  if (m) return { dia: parseInt(m[3]), mes: parseInt(m[2]) };
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);     // DD/MM/YYYY
  if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  m = /^(\d{2})\/(\d{2})$/.exec(s);             // DD/MM
  if (m) return { dia: parseInt(m[1]), mes: parseInt(m[2]) };
  return null;
}

// ─── Popup "Nova funcionalidade" do EVO ────────────────────
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
    if (fechou) console.log('   ↪️  popup "Nova funcionalidade" fechado (Permanecer).');
    return fechou;
  } catch (_) { return false; }
}

// ─── Filtro de status: deixa SÓ "Inativos" ─────────────────
// O filtro é um DROPDOWN (evo-filter-multiselect / mat-select) com o gatilho
// "Status de cliente: Ativos". As opções (inputs name=FL_ATIVOS / FL_INATIVOS /
// FL_COLABORADORES / FL_VISITANTES) só existem no DOM com o dropdown ABERTO.
// Abrimos, marcamos Inativos e desmarcamos Ativos, conferimos com ele aberto e
// fechamos (Escape) para aplicar. O estado "marcado" é uma classe "checked" no
// wrapper (o input pode estar 0x0), então lemos isso além de input.checked.
async function abrirDropdownStatus(page) {
  const ok = await page.evaluate(() => {
    const N = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const cands = Array.from(document.querySelectorAll('evo-filter-multiselect, mat-select, [class*="mat-select"], button, div, span'));
    for (const el of cands) {
      if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
      if (N(el.textContent).includes('status de cliente')) {
        const trig = el.querySelector('.mat-select-trigger, [class*="select-trigger"], mat-select-trigger, button') || el;
        (trig.closest('button') || trig).click();
        return true;
      }
    }
    return false;
  }).catch(() => false);
  if (ok) await sleep(1800);
  return ok;
}

// Lê/ajusta os checkboxes de status (com o dropdown ABERTO). acao:
//   'ler'  → só devolve o estado; 'set' → ajusta Inativos ON / Ativos OFF.
function opStatus(page, acao) {
  return page.evaluate((acao) => {
    const N = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const wrapChecked = (inp) => { let n = inp; for (let k = 0; k < 5 && n; k++) { if (/(?:^|\s)checked(?:\s|$)/.test(n.className || '')) return true; n = n.parentElement; } return false; };
    function achar(name, word) {
      let inp = document.querySelector(`input[name="${name}"][type="checkbox"]`);
      if (inp) return { inp, alvo: inp };
      // fallback por texto da opção
      for (const opt of document.querySelectorAll('mat-option, [role="option"], label, li, span, div')) {
        if (N(opt.textContent).toLowerCase() !== word) continue;
        if (opt.offsetWidth <= 0 || opt.offsetHeight <= 0) continue;
        const box = opt.querySelector('input[type=checkbox]');
        return { inp: box || null, alvo: opt };
      }
      return null;
    }
    function estado(x) {
      if (!x) return null;
      if (x.inp) return x.inp.checked || wrapChecked(x.inp);
      return /(?:^|\s)(?:mat-selected|selected|checked)(?:\s|$)/.test((x.alvo.className || '') + '');
    }
    const A = achar('FL_ATIVOS', 'ativos');
    const I = achar('FL_INATIVOS', 'inativos');
    const out = {
      ativosFound: !!A, inativosFound: !!I,
      ativosChecked: estado(A), inativosChecked: estado(I),
    };
    if (acao === 'set') {
      // marca Inativos se preciso
      if (I && !out.inativosChecked) { (I.inp || I.alvo).click(); out.clicouI = true; }
      // desmarca Ativos se preciso
      if (A && out.ativosChecked) { (A.inp || A.alvo).click(); out.clicouA = true; }
    }
    return out;
  }, acao);
}

async function definirStatusInativos(page) {
  const abriu = await abrirDropdownStatus(page);
  if (!abriu) {
    console.log('   ⚠️  não encontrei o gatilho "Status de cliente".');
    return { achouCheckboxes: false, inativosOn: false, ativosOff: false };
  }

  // Confere que as opções apareceram.
  let st = await opStatus(page, 'ler');
  if (!st.ativosFound || !st.inativosFound) {
    console.log(`   🔎 Opções no dropdown: Ativos=${st.ativosFound} Inativos=${st.inativosFound}`);
    return { achouCheckboxes: false, inativosOn: false, ativosOff: false };
  }

  // Ajusta: Inativos ON, Ativos OFF (recarrega a segmentação ao mudar).
  await opStatus(page, 'set');
  await sleep(3500);

  // Reconfere com o dropdown ainda aberto (leitura autoritativa).
  st = await opStatus(page, 'ler');
  const inativosOn = !!st.inativosChecked;
  const ativosOff = !st.ativosChecked;
  console.log(`   🏷️  Status → Ativos ${st.ativosChecked ? 'MARCADO' : 'desmarcado'} · Inativos ${st.inativosChecked ? 'MARCADO' : 'desmarcado'}`);

  // Fecha o dropdown (aplica o filtro) e espera recarregar a tabela.
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(4500);

  return { achouCheckboxes: true, inativosOn, ativosOff };
}

// Diagnóstico: salva um print e lista tudo que parece filtro de status. Chamado
// só quando não achamos os checkboxes — para depurar a estrutura real do EVO.
async function dumpDiagnosticoStatus(page) {
  try {
    const arq = path.join(DATA_DIR, 'aniversario-ex-status-debug.png');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    await page.screenshot({ path: arq, fullPage: true }).catch(() => {});
    console.log(`   🖼️  Print salvo em: ${arq}`);
  } catch (_) {}
  try {
    const info = await page.evaluate(() => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const alvo = /^(ativos|inativos|colaboradores|visitantes)$/i;
      const chave = /(status|situa|filtro|aplicar)/i;
      const out = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const t = norm(el.textContent);
        if (!t || t.length > 40) continue;
        if (alvo.test(t) || chave.test(t)) {
          const vis = el.offsetWidth > 0 && el.offsetHeight > 0;
          out.push(`${el.tagName.toLowerCase()}${vis ? '' : '(oculto)'}:"${t}"`);
        }
        if (out.length > 40) break;
      }
      const overlay = document.querySelector('.cdk-overlay-container');
      return { itens: out, overlay: overlay ? norm(overlay.textContent).slice(0, 120) : '(sem overlay)' };
    });
    console.log(`   🔬 Elementos de filtro no DOM: ${info.itens.join(' | ') || 'nenhum'}`);
    console.log(`   🔬 Overlay: ${info.overlay}`);
  } catch (_) {}
}

// ─── EVO: busca ex-alunas aniversariantes de HOJE ──────────
async function buscarExAlunasHoje() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('🎂 Buscando EX-ALUNAS aniversariantes no EVO (Inativos)...');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === 'false' ? false : 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

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
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; }
      }
      document.querySelector('button[type="submit"], button.primary')?.click();
    });
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000);
    await fecharPopupNovaTela(page);
    console.log('✅ Login OK\n');

    // 2. Segmentação → "Aniversariantes"
    console.log('📂 Navegando para Segmentação...');
    await page.evaluate(() => { location.hash = '#/app/slimfit/15/clientes/segmentacao/clientes'; });
    await sleep(5000);
    await fecharPopupNovaTela(page);

    console.log('🔍 Clicando no segmento "Aniversariantes"...');
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
    let segClicado = false;
    for (let i = 0; i < 15 && !segClicado; i++) {
      await fecharPopupNovaTela(page);
      segClicado = await tentarClicar();
      if (!segClicado) await sleep(3000);
    }
    if (!segClicado) throw new Error('Segmento "Aniversariantes" não encontrado (procurei por 45s).');
    await sleep(6000);

    // 3. Deixa SÓ "Inativos" no filtro de status (trava de segurança abaixo).
    console.log('🏷️  Ajustando o filtro de status para "Inativos"...');
    const stat = await definirStatusInativos(page);
    if (!stat.achouCheckboxes) {
      await dumpDiagnosticoStatus(page);
      throw new Error('Não abri/achei o filtro de status (Ativos/Inativos) — ABORTADO por segurança (não envio para não arriscar mandar às ativas).');
    }
    if (!stat.inativosOn || !stat.ativosOff) {
      await dumpDiagnosticoStatus(page);
      throw new Error(`Não consegui deixar SÓ "Inativos" marcado (inativos=${stat.inativosOn}, ativosDesmarcado=${stat.ativosOff}) — ABORTADO por segurança.`);
    }
    await sleep(2000);

    const alvo = diaMesHoje();
    console.log(`🗓️  Procurando ex-alunas do dia ${String(alvo.dia).padStart(2,'0')}/${String(alvo.mes).padStart(2,'0')}\n`);

    // 4. Lê a TABELA (nome + nascimento) de todas as páginas.
    const vistos = new Map(); // nome→nascimento (dedup)
    for (let pagina = 1; pagina <= 80; pagina++) {
      const linhas = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr, tr.mat-row, tr[role="row"], tr[class*="row"]');
        const out = [];
        rows.forEach(r => {
          const txt = r.innerText || '';
          const nasc = txt.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (!nasc) return;
          let nome = '';
          const a = r.querySelector('a');
          if (a && a.textContent.trim()) nome = a.textContent.trim();
          if (!nome) {
            const tds = r.querySelectorAll('td');
            for (const td of tds) {
              const t = (td.innerText || '').trim();
              if (/[A-Za-zÀ-ú]{3,}/.test(t) && !/\d{2}\/\d{2}/.test(t)) { nome = t.split('\n').pop().trim(); break; }
            }
          }
          if (nome) out.push({ nome, nascimento: nasc[1] });
        });
        return out;
      });
      const antes = vistos.size;
      for (const l of linhas) if (l.nome && !vistos.has(l.nome)) vistos.set(l.nome, l.nascimento);
      console.log(`   📄 Página ${pagina}: ${linhas.length} linha(s) — acumulado ${vistos.size}`);
      if (vistos.size === antes && pagina > 1) break;
      const avancou = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        for (const b of btns) {
          const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
          const dis = b.disabled || b.getAttribute('aria-disabled') === 'true' || /disabled/.test(b.className || '');
          if (!dis && (lbl.includes('próxima') || lbl.includes('proxima') || lbl.includes('next') || lbl.includes('seguinte')) && b.offsetWidth > 0) { (b.closest('button') || b).click(); return true; }
        }
        return false;
      });
      if (!avancou) break;
      await sleep(2500);
    }

    const linhasTabela = Array.from(vistos, ([nome, nascimento]) => ({ nome, nascimento }));
    console.log(`   ${linhasTabela.length} ex-aluna(s) com data de nascimento lida(s)`);

    const doHoje = linhasTabela.filter(l => {
      const dm = extrairDiaMesNascimento(l.nascimento);
      return dm && dm.dia === alvo.dia && dm.mes === alvo.mes;
    });
    console.log(`   🎂 ${doHoje.length} fazem aniversário hoje\n`);

    // 5. Para cada uma, abre o painel e pega o Celular.
    const resultado = [];
    for (const item of doHoje) {
      console.log(`🔎 ${item.nome} (${item.nascimento})...`);
      await page.keyboard.press('Escape');
      await sleep(600);
      await page.waitForFunction(() => !/celular/i.test(document.body.innerText || ''), { timeout: 5000 }).catch(() => {});
      await sleep(500);

      const clicou = await page.evaluate((nome) => {
        const alvoTxt = nome.substring(0, 15);
        const links = document.querySelectorAll('table tbody tr a');
        for (const el of links) if (el.textContent && el.textContent.includes(alvoTxt) && el.offsetWidth > 0) { el.click(); return true; }
        const outros = document.querySelectorAll('table tbody tr td, table tbody tr span');
        for (const el of outros) if (el.textContent && el.textContent.includes(alvoTxt) && el.offsetWidth > 0) { el.click(); return true; }
        return false;
      }, item.nome);

      let telefone = null;
      if (clicou) {
        const doisNomes = item.nome.split(/\s+/).slice(0, 2).join(' ');
        await page.waitForFunction((nm) => {
          const t = document.body.innerText || '';
          return t.includes(nm) && /celular/i.test(t);
        }, { timeout: 10000 }, doisNomes).catch(() => {});
        await sleep(1200);
        const cel = await page.evaluate((nm) => {
          const txt = document.body.innerText || '';
          if (!txt.includes(nm)) return null;
          const m = txt.match(/Celular\s*([\d][\d\s()+\-]{8,})/i);
          return m ? m[1].replace(/\D/g, '') : null;
        }, doisNomes);
        if (cel && cel.length >= 10) telefone = cel;
      }

      resultado.push({
        nome: item.nome,
        primeiroNome: (item.nome || '').trim().split(/\s+/)[0],
        telefone,
      });
      console.log(`   🎉 ${item.nome} — ${telefone || 'sem telefone'}`);
    }

    return resultado;
  } finally {
    await browser.close();
  }
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   ANIVERSÁRIO — EX-ALUNAS (direto no WhatsApp)     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(MODO_ENVIO ? '🚀 MODO ENVIO ATIVO\n' : '🧪 MODO SIMULAÇÃO (use --enviar para enviar)\n');

  const exAlunas = await buscarExAlunasHoje();

  if (exAlunas.length === 0) {
    console.log('\n📭 Nenhuma ex-aluna aniversariante hoje. Nada a fazer.\n');
    return { total: 0, resultados: [] };
  }

  console.log(`\n🎂 ${exAlunas.length} ex-aluna(s) aniversariante(s) hoje:\n`);
  exAlunas.forEach((a, i) => console.log(`  ${i + 1}. ${a.nome} — ${a.telefone || '⚠️ sem telefone'}`));

  const mensagens = require('./mensagens');
  const fotoAniv = mensagens.fotoPath('aniversario_ex'); // flyer opcional
  const resultados = [];

  const enviados = new Set(); // dedup por telefone
  const wa = MODO_ENVIO ? require('./wa-client') : null;
  if (wa) await wa.initWhatsApp(); // cliente único persistente

  for (const ex of exAlunas) {
    console.log(`\n👤 ${ex.nome}...`);
    if (!ex.telefone) { console.log('   ⏭️  Sem telefone — pulando'); resultados.push({ nome: ex.nome, status: 'sem-telefone' }); continue; }
    if (enviados.has(ex.telefone)) { console.log('   ⏭️  Telefone repetido — pulando'); resultados.push({ nome: ex.nome, status: 'repetido' }); continue; }

    const texto = mensagens.render('aniversario_ex', { aluna: ex.primeiroNome });

    if (!MODO_ENVIO) {
      console.log('   🧪 Simulação — não enviei nada.');
      resultados.push({ nome: ex.nome, telefone: ex.telefone, status: 'simulado' });
      continue;
    }

    try {
      // Envio DIRETO no WhatsApp da pessoa (flyer opcional como legenda).
      await wa.sendTexto(ex.telefone, texto, undefined, fotoAniv ? 'aniversario_ex' : undefined);
      enviados.add(ex.telefone);
      console.log('   ✅ Enviado');
      resultados.push({ nome: ex.nome, telefone: ex.telefone, status: 'enviado' });
      await sleep(9000 + Math.floor(Math.random() * 3000)); // 9-12s entre envios
    } catch (e) {
      console.log(`   ❌ Erro: ${e.message}`);
      resultados.push({ nome: ex.nome, telefone: ex.telefone, status: 'erro', erro: e.message });
    }
  }

  // Resumo + relatório
  console.log('\n╔═════════════════════════════════════════════════════╗');
  console.log('║   RESUMO — Aniversário ex-alunas                    ║');
  console.log('╚═════════════════════════════════════════════════════╝');
  resultados.forEach(r => console.log(`  🎂 ${r.nome} — ${r.status}`));
  console.log('');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  fs.writeFileSync(RELATORIO_FILE, JSON.stringify({ executadoEm: ts, resultados }, null, 2), 'utf8');

  return { total: exAlunas.length, resultados };
}

// Exporta para o scheduler (sempre em modo de envio real)
async function runAniversarioEx() {
  MODO_ENVIO = true;
  return main();
}
module.exports = { runAniversarioEx, main };

if (require.main === module) {
  main().catch(err => { console.error('\n❌ Erro fatal:', err.message); process.exit(1); });
}

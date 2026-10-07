/**
 * Inadimplentes — lê no EVO quem está com débito VENCIDO e monta a cobrança certa:
 *
 *   • RECORRENTE (cartão) → segmentação salva "Com débito". Para quem é recorrente
 *     (contrato "...RECORRENTE"), gera o LINK de pagamento (evo-totem) e manda a
 *     mensagem `cobranca_recorrente` (com link). ⚠️ "ENVIAR COBRANÇA" só GERA o
 *     link, não cobra. NUNCA clica "Receber"/"Confirmar" nem marca checkbox.
 *
 *   • BOLETO (pix/boleto) → tela global de boletos (Financeiro → Boletos →
 *     Integração Bancária, API CarregarListaBoletos), que lista TODOS os boletos em
 *     aberto. Para cada boleto vencido/que vence hoje, abre a ficha da aluna (busca
 *     pelo ID do cliente) e lê o `urlBoleto` (pjbank) + telefone. Manda:
 *       - `cobranca_boleto`      se já venceu há X+ dias (X configurável), ou
 *       - `cobranca_boleto_hoje` se vence HOJE.
 *     ⚠️ Nunca clica em excluir/lixeira/cancelar/estornar/baixar.
 *
 * Fonte dos dados (tudo interceptando a API interna do EVO, como os outros jobs).
 *
 * Uso:
 *   node src/inadimplentes.js            → só lê e imprime (dry, NÃO envia, NÃO cobra)
 *   node src/inadimplentes.js --enviar   → enfileira na fila da SoFIA (ela envia)
 *
 * O ENVIO de WhatsApp é feito pela SoFIA (consumidor em ChatBot/sofia-listener.ts),
 * pelo NÚMERO dela — não pelo WhatsApp do robô (recepção).
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Limite "vencido há X+ dias" — configurável no painel (data/inadimplentes-config.json).
const cfg = require('./inadimplentes-config');
// Não reenvia para a mesma aluna dentro desta janela (evita mandar todo dia).
const REENVIO_DIAS = parseInt(process.env.INADIMPLENTES_REENVIO_DIAS || '3', 10);
// Fila de cobrança consumida pela SoFIA (envia pelo NÚMERO dela, não o do robô).
const OUTBOX_FILE = process.env.COBRANCA_OUTBOX_FILE || path.resolve(__dirname, '..', 'data', 'cobranca-outbox.jsonl');
// Estado dos envios (por idCliente) — gitignored, por VPS.
const ENVIADOS_FILE = path.resolve(__dirname, '..', 'data', 'inadimplentes-enviados.json');
function lerEnviados() { try { const o = JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function gravarEnviados(o) { try { fs.mkdirSync(path.dirname(ENVIADOS_FILE), { recursive: true }); } catch (_) {} try { fs.writeFileSync(ENVIADOS_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch (_) {} }
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Dias de atraso entre uma data (ISO) e hoje, no fuso de São Paulo (só data).
function diasDeAtraso(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const venc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const agoraSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hoje = Date.UTC(agoraSp.getFullYear(), agoraSp.getMonth(), agoraSp.getDate());
  return Math.round((hoje - venc) / 86400000);
}
// "2026-09-25T..." → "25/09/2026"
function fmtData(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function ehRecorrente(contrato) { return /recorrente/i.test(String(contrato || '')); }

// Procura um telefone (10–13 dígitos) em qualquer campo "telefone/celular/fone/whatsapp".
function acharTelefone(obj, prof = 0) {
  if (!obj || typeof obj !== 'object' || prof > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' || typeof v === 'number') {
      if (/celular|telefone|fone|whats|ddd.?numero|numero.?ddd/i.test(k)) { const d = soDigitos(v); if (d.length >= 10 && d.length <= 13) return d; }
    } else if (v && typeof v === 'object') { const r = acharTelefone(v, prof + 1); if (r) return r; }
  }
  return null;
}

async function lerInadimplentes() {
  const diasMin = cfg.lerDias(); // limite configurável no painel
  console.log('\n═══════════════════════════════════════════════════');
  console.log('💳 Inadimplentes — lendo débitos vencidos no EVO...');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   Recorrente: vencido há ${diasMin}+ dia(s). Boleto: vencido há ${diasMin}+ dia(s) OU vence hoje.\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1366,900'],
    defaultViewport: { width: 1366, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);

  // ── Interceptação das respostas que interessam ──────────────────────────
  let listaDevedoras = null;   // snapshot da segmentação "Com débito"
  let perfilAtual = null;      // {vencimento, valor} do cliente em foco
  let linkAtual = null;        // link de cobrança (recorrente) do cliente em foco
  let listaBoletos = null;     // snapshot da tela global de boletos
  let boletosCliente = null;   // boletos (com urlBoleto) do cliente em foco
  let telefoneAtual = null;    // telefone do cliente em foco (para boleto)
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;

      if (/clientes-segmentacao\/obter-clientes/i.test(url)) {
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length && l.length <= 80) listaDevedoras = l;
        return;
      }
      if (/CarregarListaBoletos/i.test(url)) {
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.$values || d.retorno || d.data || d.lista || []);
        if (Array.isArray(l)) listaBoletos = l;
        return;
      }
      if (/\/api\/v1\/boletos/i.test(url)) {
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.$values || d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length) boletosCliente = l;
        return;
      }
      if (/recebimentos\/saldo-devedor\/dados-envio-cobranca/i.test(url)) {
        const d = JSON.parse(await res.text());
        const link = (d && (d.url || d.link)) || (typeof d === 'string' ? d : null);
        if (link && /^https?:\/\//.test(link)) linkAtual = link;
        return;
      }
      if (/\/clientes\/\d+\/perfil/i.test(url)) {
        const d = JSON.parse(await res.text());
        const itens = [];
        (function walk(o) {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) { o.forEach(walk); return; }
          if (typeof o.vencimento === 'string' && /\d{4}-\d{2}-\d{2}/.test(o.vencimento)) itens.push(o);
          for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
        })(d);
        let vmin = null, valor = 0;
        for (const it of itens) {
          if (!vmin || it.vencimento < vmin) vmin = it.vencimento;
          if (typeof it.valorSaldoDevedor === 'number') valor += it.valorSaldoDevedor;
        }
        perfilAtual = vmin ? { vencimento: vmin, valor } : { vencimento: null, valor: 0 };
        const tel = acharTelefone(d); if (tel) telefoneAtual = tel;
        return;
      }
      // telefone pode vir noutra chamada do cliente (básico/cadastro)
      if (/\/clientes\/(cadastro\/)?\d+(\/|$|\?)/i.test(url) || /\/membros\/\d+/i.test(url)) {
        try { const d = JSON.parse(await res.text()); const tel = acharTelefone(d); if (tel) telefoneAtual = tel; } catch (_) {}
        return;
      }
    } catch (_) { /* respostas não-JSON */ }
  });

  // ── Helpers de navegação ────────────────────────────────────────────────
  const irPara = async (rota, ms = 6000) => { await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/${rota}`); await sleep(ms); await fecharPopupNovaTela(page); };
  const abrirComDebito = async () => {
    await irPara('clientes/segmentacao/clientes', 5000);
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => { for (const el of document.querySelectorAll('a,li,span,div,p')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } } return false; });
      if (ok) break; await sleep(1500);
    }
    await sleep(4000);
  };
  const abrirFichaPorNome = async (nome) => {
    const clicou = await page.evaluate((nome) => { const n = nome.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return true; } } return false; }, nome);
    if (!clicou) return false;
    await sleep(5000); await fecharPopupNovaTela(page);
    await page.evaluate(() => { for (const el of document.querySelectorAll('button,a,span,div,li')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if ((t === 'ver perfil' || t === 'person ver perfil') && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } });
    await sleep(7000); await fecharPopupNovaTela(page);
    return true;
  };
  // Abre a ficha da aluna buscando pelo ID no campo de pesquisa global (aceita ID).
  const abrirFichaPorId = async (idCliente) => {
    const campo = await page.$('input[placeholder*="Pesquise por nome" i], input[aria-label*="Pesquise por nome" i]');
    if (!campo) return false;
    await campo.click({ clickCount: 3 });
    await campo.type(String(idCliente), { delay: 60 });
    await sleep(2500);
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(6000); await fecharPopupNovaTela(page);
    // Se o Enter não abriu a ficha, tenta clicar o 1º resultado.
    if (!/cadastro\/\d+/.test(page.url())) {
      await page.evaluate(() => { const r = document.querySelector('a[href*="cadastro/"], .resultado-busca a, [role="option"]'); if (r) r.click(); });
      await sleep(5000); await fecharPopupNovaTela(page);
    }
    return /cadastro\/\d+/.test(page.url());
  };

  const resultados = [];
  const vistos = new Set(); // idCliente já incluído (dedup entre passes)
  try {
    // 1) LOGIN
    console.log('🔐 Login no EVO...');
    await page.goto(`${config.evo.url}/${config.evo.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(4000);
    await page.waitForSelector('input#usuario, input[type="email"], input[type="text"]', { timeout: 20000 });
    await page.click('input#usuario, input[type="email"], input[type="text"]', { clickCount: 3 });
    await page.type('input#usuario, input[type="email"], input[type="text"]', config.evo.email, { delay: 60 });
    await page.click('input#senha, input[type="password"]', { clickCount: 3 });
    await page.type('input#senha, input[type="password"]', config.evo.password, { delay: 60 });
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) { if (['ENTRAR', 'LOGIN', 'ACESSAR'].includes(b.textContent?.trim().toUpperCase())) { b.click(); return; } } document.querySelector('button[type="submit"], button.primary')?.click(); });
    try { await require('./evo-totp').preencher2FA(page); } catch (_) {}
    await page.waitForFunction(() => location.hash.includes('/inicio/') || location.hash.includes('/app/'), { timeout: 30000 });
    await sleep(3000); await fecharPopupNovaTela(page);
    console.log('✅ Login OK\n');

    // ════════ PASSO A — RECORRENTE (segmentação "Com débito") ════════
    await irPara('clientes/segmentacao/clientes', 7000);
    for (let i = 0; i < 12; i++) {
      const ok = await page.evaluate(() => { for (const el of document.querySelectorAll('a,li,span,div,p')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } } return false; });
      if (ok) break; await sleep(1500);
    }
    await sleep(6000);
    const candidatas = (listaDevedoras || []).map(r => ({
      idCliente: r.idCliente, nome: r.nome,
      celular: soDigitos(r.celular || r.telefone || ''),
      contrato: String(r.contrato || '').replace(/\s+/g, ' ').trim(),
    })).filter(c => c.idCliente);
    console.log(`👥 "Com débito": ${candidatas.length} candidata(s).`);

    for (const c of candidatas) {
      if (!ehRecorrente(c.contrato)) { console.log(`   ⏭️  ${c.nome}: não é recorrente — cai no passo de boleto.`); continue; }
      perfilAtual = null; linkAtual = null;
      await abrirComDebito();
      const achou = await abrirFichaPorNome(c.nome);
      if (!achou) { console.log(`   ⚠️  ${c.nome}: não achei o nome na lista (pulando).`); continue; }
      for (let i = 0; i < 20 && !perfilAtual; i++) await sleep(500);
      await fecharPopupNovaTela(page);
      if (!perfilAtual) { console.log(`   ⚠️  ${c.nome}: não li o perfil (pulando).`); continue; }

      const dias = diasDeAtraso(perfilAtual.vencimento);
      if (dias == null || dias < diasMin) { console.log(`   ⏭️  ${c.nome}: venc. ${fmtData(perfilAtual.vencimento)} (atraso ${dias}d) — < ${diasMin}d.`); continue; }

      // Gera o link SEM cobrar: Saldo devedor → "ENVIAR COBRANÇA".
      await irPara(`clientes/cadastro/${c.idCliente}//financeiro/saldodevedor`, 6000);
      await page.evaluate(() => { for (const el of document.querySelectorAll('button,a,[role="button"]')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if ((t === 'enviar cobrança' || t === 'enviar cobranca') && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return; } } });
      for (let i = 0; i < 20 && !linkAtual; i++) await sleep(500);
      await page.evaluate(() => { for (const el of document.querySelectorAll('button,a')) { const t = (el.textContent || '').trim().toLowerCase(); if (t === 'cancelar' && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } });
      await page.keyboard.press('Escape').catch(() => {});

      if (!linkAtual) { console.log(`   ⚠️  ${c.nome}: recorrente vencida, mas NÃO consegui gerar o link (pulando).`); continue; }
      resultados.push({ idCliente: c.idCliente, nome: c.nome, celular: c.celular, tipo: 'recorrente', vencimento: perfilAtual.vencimento, vencimentoFmt: fmtData(perfilAtual.vencimento), diasAtraso: dias, valor: perfilAtual.valor, link: linkAtual });
      vistos.add(String(c.idCliente));
      console.log(`   💳 ${c.nome} | venc. ${fmtData(perfilAtual.vencimento)} (${dias}d) | recorrente | link OK`);
    }

    // ════════ PASSO B — BOLETO (tela global Integração Bancária) ════════
    // A tela carrega sozinha a lista de boletos do período padrão (em aberto,
    // ~últimos 30 dias de vencimento + hoje), que é a janela de cobrança. Só
    // lemos o que ela trouxe (CarregarListaBoletos) — sem mexer nos filtros.
    console.log('\n🧾 Boletos — tela global (Integração Bancária)...');
    listaBoletos = null;
    await irPara('evo3/-Financeiro-Boletos-IntegracaoBancaria', 9000);
    for (let i = 0; i < 16 && !listaBoletos; i++) { await sleep(800); await fecharPopupNovaTela(page); }
    console.log(`   · carga automática: ${listaBoletos ? listaBoletos.length + ' boleto(s)' : 'nada capturado (null)'}`);

    // Define o período de vencimento: início = hoje - JANELA, fim = hoje — digitando
    // via TECLADO (o Angular sincroniza o ngModel) e clicando na busca (lupa azul).
    const JANELA = parseInt(process.env.INADIMPLENTES_BOLETO_JANELA || '120', 10);
    try {
      const d2 = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
      const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const ini = new Date(hoje.getTime() - JANELA * 86400000);
      // localiza os inputs de data (valor dd/mm/aaaa)
      const inputs = await page.$$('input');
      const dateHandles = [];
      for (const h of inputs) { const v = await h.evaluate(el => el.value || ''); if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) dateHandles.push(h); }
      console.log(`   · campos de data encontrados: ${dateHandles.length}`);
      const setData = async (h, val) => { await h.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await h.type(val, { delay: 60 }); await page.keyboard.press('Tab'); await sleep(400); };
      if (dateHandles[0]) await setData(dateHandles[0], d2(ini));
      if (dateHandles[1]) await setData(dateHandles[1], d2(hoje));
      await sleep(600);
      const antes = listaBoletos;
      const clicou = await page.evaluate(() => {
        const vis = (el) => el.offsetWidth > 0 || el.offsetHeight > 0;
        const proibido = (b) => /excluir|lixeir|remov|cancelar|export|email|e-mail|imprimir|limpar|nova conta|transfer|copiar|baixar/.test(b);
        // 1) botão com texto/aria de busca na faixa de filtros (não o da barra de topo).
        for (const el of document.querySelectorAll('button, [role="button"], a')) {
          if (el.closest('table tbody')) continue;
          const blob = `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.className || ''}`.toLowerCase();
          if (proibido(blob)) continue;
          const rect = el.getBoundingClientRect();
          if (/pesquis|buscar|consultar|filtrar|search|lupa/.test(blob) && rect.top > 60 && rect.top < 440 && vis(el)) { el.scrollIntoView({ block: 'center' }); el.click(); return (blob.trim().slice(0, 24) || '(lupa)'); }
        }
        // 2) botão-ícone de lupa (só <i>/mat-icon "search") na faixa de filtros.
        for (const el of document.querySelectorAll('button, [role="button"], a')) {
          if (el.closest('table tbody')) continue;
          const ico = el.querySelector('i, mat-icon, svg');
          const txt = `${el.textContent || ''} ${ico ? ico.textContent : ''} ${ico ? (ico.getAttribute('class') || '') : ''}`.toLowerCase();
          const blob = `${txt} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`.toLowerCase();
          if (proibido(blob)) continue;
          const rect = el.getBoundingClientRect();
          if (/search|lupa|magnif|fa-search|pesquis|buscar/.test(blob) && rect.top > 60 && rect.top < 440 && vis(el)) { el.scrollIntoView({ block: 'center' }); el.click(); return '(ícone lupa)'; }
        }
        return null;
      });
      console.log(`   · busca por período [${d2(ini)} → ${d2(hoje)}]: ${clicou ? 'clicada ("' + clicou + '")' : 'botão não achado'}`);
      for (let i = 0; i < 12 && listaBoletos === antes; i++) await sleep(800); // espera nova carga
      console.log(`   · após a busca: ${listaBoletos ? listaBoletos.length + ' boleto(s)' : 'nada'}`);
    } catch (e) { console.log('   · (não consegui ajustar o período:', e.message, ')'); }

    const hojeDias = (iso) => diasDeAtraso(iso);
    let nCanc = 0, nPago = 0, nForaJanela = 0;
    const boletosAbertos = (listaBoletos || []).filter(b => {
      if (b.FL_CANCELADO === true || b.FL_CANCELADO === 1) { nCanc++; return false; }
      if (b.RECEBIMENTO) { nPago++; return false; }    // já recebido/pago
      const dias = hojeDias(b.DT_VENCIMENTO);
      if (dias == null) return false;
      const ok = dias === 0 || dias >= diasMin;         // vence hoje OU vencido há X+ dias
      if (!ok) nForaJanela++;
      return ok;
    });
    console.log(`   · total ${listaBoletos ? listaBoletos.length : 0} | cancelados ${nCanc} | pagos ${nPago} | fora da regra (futuro/<${diasMin}d) ${nForaJanela} | elegíveis ${boletosAbertos.length}`);
    // Um boleto por aluna (o mais antigo vencido).
    const porCliente = new Map();
    for (const b of boletosAbertos) {
      const id = b.ID_CLIENTE_PAGADOR; if (!id) continue;
      const atual = porCliente.get(id);
      if (!atual || String(b.DT_VENCIMENTO) < String(atual.DT_VENCIMENTO)) porCliente.set(id, b);
    }
    console.log(`🧾 Boletos em aberto vencidos/hoje: ${porCliente.size} aluna(s).`);

    for (const [idCliente, b] of porCliente) {
      if (vistos.has(String(idCliente))) { console.log(`   ⏭️  ${b.NOME}: já incluída pelo recorrente.`); continue; }
      const dias = hojeDias(b.DT_VENCIMENTO);
      boletosCliente = null; telefoneAtual = null;
      const ok = await abrirFichaPorId(idCliente);
      if (!ok) { console.log(`   ⚠️  ${b.NOME} (id ${idCliente}): não abri a ficha (pulando).`); continue; }
      for (let i = 0; i < 20 && !boletosCliente; i++) await sleep(500);
      // link do boleto: casa pelo ID_BOLETO; senão, o mais próximo do vencimento.
      let urlBoleto = null;
      if (Array.isArray(boletosCliente)) {
        const alvo = boletosCliente.find(x => Number(x.idBoleto) === Number(b.ID_BOLETO))
          || boletosCliente.find(x => fmtData(x.dtVencimento) === fmtData(b.DT_VENCIMENTO) && x.urlBoleto)
          || boletosCliente.find(x => x.urlBoleto && !x.recebimento);
        if (alvo && alvo.urlBoleto) urlBoleto = alvo.urlBoleto;
      }
      if (!urlBoleto) { console.log(`   ⚠️  ${b.NOME}: não achei o urlBoleto (pulando).`); continue; }
      const celular = telefoneAtual || '';
      resultados.push({ idCliente, nome: b.NOME, celular, tipo: 'boleto', venceHoje: dias === 0, vencimento: b.DT_VENCIMENTO, vencimentoFmt: fmtData(b.DT_VENCIMENTO), diasAtraso: dias, valor: b.VALOR, link: urlBoleto });
      vistos.add(String(idCliente));
      console.log(`   🧾 ${b.NOME} | venc. ${fmtData(b.DT_VENCIMENTO)} (${dias === 0 ? 'HOJE' : dias + 'd'}) | boleto | ${celular ? 'tel OK' : 'SEM TEL'} | link OK`);
    }
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  const nRec = resultados.filter(r => r.tipo === 'recorrente').length;
  const nBol = resultados.filter(r => r.tipo === 'boleto').length;
  console.log(`\n📋 Total a notificar: ${resultados.length} (recorrente: ${nRec}, boleto: ${nBol}).`);
  return resultados;
}

// ─── Enfileirar para a SoFIA ────────────────────────────────────────────────
// Lê os inadimplentes e ENFILEIRA a mensagem certa na fila de cobrança. Quem ENVIA
// é a SoFIA, pelo NÚMERO dela. dry=true: só imprime. Dedup por idCliente (não
// re-enfileira dentro de REENVIO_DIAS).
async function runInadimplentes({ dry = false } = {}) {
  const mensagens = require('./mensagens');
  const diasMin = cfg.lerDias();
  const lista = await lerInadimplentes();
  const res = { enfileirados: 0, skipped: 0, failed: 0, details: [] };
  if (!lista.length) { console.log('   📭 Ninguém a cobrar — nada a enfileirar.'); return res; }

  const enviados = lerEnviados();
  const agora = Date.now();
  const linhas = [];
  console.log(`\n${dry ? '🧪 DRY (nada enfileirado)' : '📥 Enfileirando para a SoFIA'} — ${lista.length} inadimplente(s):`);

  for (const r of lista) {
    const chave = String(r.idCliente);
    const nome = r.nome;

    const ult = enviados[chave] && enviados[chave].em ? new Date(enviados[chave].em).getTime() : 0;
    if (ult && (agora - ult) < REENVIO_DIAS * 86400000) {
      res.skipped++; res.details.push({ name: nome, status: 'skipped', reason: `avisada há < ${REENVIO_DIAS}d` });
      console.log(`   ⏭️  ${nome}: já avisada nos últimos ${REENVIO_DIAS} dia(s) — pulando.`);
      continue;
    }
    if (!r.celular) {
      res.skipped++; res.details.push({ name: nome, status: 'skipped', reason: 'sem telefone' });
      console.log(`   ⏭️  ${nome}: sem telefone — pulando.`);
      continue;
    }

    let texto, chaveMsg;
    if (r.tipo === 'recorrente') {
      if (!r.link) { res.failed++; res.details.push({ name: nome, status: 'failed', reason: 'link não gerado' }); console.log(`   ❌ ${nome}: recorrente sem link — não enfileiro.`); continue; }
      chaveMsg = 'cobranca_recorrente';
      texto = mensagens.render(chaveMsg, { nome: primeiroNome(nome), link: r.link });
    } else {
      if (!r.link) { res.failed++; res.details.push({ name: nome, status: 'failed', reason: 'boleto não gerado' }); console.log(`   ❌ ${nome}: boleto sem link — não enfileiro.`); continue; }
      chaveMsg = r.venceHoje ? 'cobranca_boleto_hoje' : 'cobranca_boleto';
      texto = mensagens.render(chaveMsg, { nome: primeiroNome(nome), vencimento: r.vencimentoFmt, link: r.link });
    }

    if (dry) {
      res.details.push({ name: nome, status: 'simulado' });
      console.log(`\n   — ${nome} (${r.celular}) · ${chaveMsg} · venc. ${r.vencimentoFmt} —\n${texto}\n`);
      continue;
    }

    linhas.push(JSON.stringify({
      id: `${chave}-${String(r.vencimento || '').slice(0, 10)}`,
      telefone: r.celular, texto, nome, tipo: r.tipo, chaveMsg, idCliente: r.idCliente,
      em: new Date().toISOString(),
    }));
    enviados[chave] = { em: new Date().toISOString(), nome, tipo: r.tipo, vencimento: r.vencimento };
    res.enfileirados++; res.details.push({ name: nome, phone: r.celular, status: 'enfileirado' });
    console.log(`   📥 ${nome} (${chaveMsg}) — enfileirada para a SoFIA.`);
  }

  if (!dry && linhas.length) {
    try { fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true }); } catch (_) {}
    fs.appendFileSync(OUTBOX_FILE, linhas.join('\n') + '\n', 'utf8');
    gravarEnviados(enviados);
    console.log(`   📤 ${linhas.length} mensagem(ns) na fila da SoFIA → ${OUTBOX_FILE}`);
  }

  console.log(`\n📊 Cobrança — enfileiradas: ${res.enfileirados} | puladas: ${res.skipped} | falhas: ${res.failed}`);
  return res;
}

module.exports = { lerInadimplentes, runInadimplentes, diasDeAtraso, ehRecorrente, fmtData, OUTBOX_FILE };

// ─── CLI ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const enviar = process.argv.includes('--enviar');
  (async () => {
    try { await runInadimplentes({ dry: !enviar }); }
    catch (e) { console.error('❌ erro:', e && e.message); }
    finally { process.exit(0); }
  })();
}

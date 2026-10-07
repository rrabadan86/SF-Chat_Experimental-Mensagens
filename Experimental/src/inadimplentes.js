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
// Regra: a cobrança é reenviada TODO DIA enquanto o débito continua em aberto, mas
// no máximo UMA vez por dia (não duplica no mesmo dia). Até a aluna pagar.
// Mesmo dia (fuso de São Paulo) que um ISO?
function mesmoDiaSp(iso) {
  if (!iso) return false;
  const fmt = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  try { return fmt(new Date(iso)) === fmt(new Date()); } catch (_) { return false; }
}
// Fila de cobrança consumida pela SoFIA (envia pelo NÚMERO dela, não o do robô).
const OUTBOX_FILE = process.env.COBRANCA_OUTBOX_FILE || path.resolve(__dirname, '..', 'data', 'cobranca-outbox.jsonl');
// Estado dos envios (por idCliente) — gitignored, por VPS. Escrito pela SoFIA SÓ
// quando ela confirma o envio (ChatBot/sofia-listener.ts: marcarCobrancaEnviada).
const ENVIADOS_FILE = path.resolve(__dirname, '..', 'data', 'inadimplentes-enviados.json');
function lerEnviados() { try { const o = JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
// idClientes que já estão na fila (cobranca-outbox.jsonl), aguardando envio — para
// não enfileirar de novo a mesma aluna antes de a SoFIA processar.
function lerPendentesOutbox() {
  const set = new Set();
  try {
    const txt = fs.readFileSync(OUTBOX_FILE, 'utf8');
    for (const l of txt.split('\n')) { const s = l.trim(); if (!s) continue; try { const o = JSON.parse(s); if (o && o.idCliente != null) set.add(String(o.idCliente)); } catch (_) {} }
  } catch (_) {}
  return set;
}
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
        const l = Array.isArray(d) ? d : (d.Data || d.data || d.$values || d.retorno || d.lista || []);
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
  // Abre a ficha da aluna pela BUSCA (campo global que aceita nome/ID). Digita o
  // NOME, clica no resultado (de preferência a linha que contém o ID) e em "Ver
  // perfil" — como fizemos no diagnóstico que funcionou. Chega no perfil, o que
  // dispara /api/v1/boletos (urlBoleto) e as chamadas com o telefone.
  const abrirFichaBusca = async (nome, idCliente) => {
    const campo = await page.$('input[placeholder*="Pesquise por nome" i], input[aria-label*="Pesquise por nome" i]');
    if (!campo) return false;
    await campo.click({ clickCount: 3 });
    await campo.type(String(nome), { delay: 55 });
    await sleep(4500); await fecharPopupNovaTela(page);
    const partes = String(nome).toLowerCase().split(/\s+/).filter(Boolean);
    const clicou = await page.evaluate(({ partes, id }) => {
      const cands = [...document.querySelectorAll('a,td,span,div,li')];
      if (id) { const re = new RegExp('(^|\\D)' + id + '(\\D|$)'); for (const el of cands) { if (el.children.length > 4) continue; const t = (el.textContent || '').trim(); if (re.test(t) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return 'id'; } } }
      for (const el of cands) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t.length <= 120 && partes[0] && t.includes(partes[0]) && t.includes(partes[partes.length - 1]) && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return 'nome'; } }
      return null;
    }, { partes, id: idCliente });
    if (!clicou) { await page.keyboard.press('Enter').catch(() => {}); }
    await sleep(5000); await fecharPopupNovaTela(page);
    await page.evaluate(() => { for (const el of document.querySelectorAll('button,a,span,div,li')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if ((t === 'ver perfil' || t === 'person ver perfil') && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } });
    await sleep(7000); await fecharPopupNovaTela(page);
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
    // A tela usa um grid customizado; em vez de dirigi-lo, abrimos a tela (para
    // ativar a sessão) e REPETIMOS a própria requisição dela (CarregarListaBoletos,
    // POST form-urlencoded) com um período amplo e pageSize grande — pegando todos
    // os boletos EM ABERTO vencidos no período. A resposta vem em { Data: [...] }.
    console.log('\n🧾 Boletos — tela global (Integração Bancária)...');
    listaBoletos = null;
    await irPara('evo3/-Financeiro-Boletos-IntegracaoBancaria', 9000);
    for (let i = 0; i < 16 && !listaBoletos; i++) { await sleep(800); await fecharPopupNovaTela(page); }
    console.log(`   · carga automática (período padrão): ${listaBoletos ? listaBoletos.length + ' boleto(s)' : 'nada'}`);

    // A tela é um IFRAME do sistema legado (evo3). Repetimos a requisição DENTRO
    // desse iframe (mesma origem → sem CORS) com um período amplo e pageSize grande.
    const JANELA = parseInt(process.env.INADIMPLENTES_BOLETO_JANELA || '120', 10);
    const d2 = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    const hojeSp = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dtIni = d2(new Date(hojeSp.getTime() - JANELA * 86400000));
    const dtFim = d2(hojeSp);
    try {
      const frame = page.frames().find(f => /evo3\.w12app|\/Financeiro\//i.test(f.url())) || null;
      console.log(`   · iframe evo3: ${frame ? 'encontrado' : 'NÃO encontrado (usando carga padrão)'}`);
      if (frame) {
        const body = `sort=&page=1&pageSize=5000&group=&filter=&aberto=true&pago=false&cancelado=false&ID_CLIENTE=0&ID_FORNECEDOR=0&ID_FUNCIONARIO=0&ID_PROSPECT=0&ID_PERSONAL=0&ID_CONVENIO=0&dtIni=${encodeURIComponent(dtIni)}&dtFim=${encodeURIComponent(dtFim)}`;
        const resp = await frame.evaluate(async (body) => {
          try {
            const r = await fetch('/Financeiro/Boletos/CarregarListaBoletos', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
              body,
            });
            const t = await r.text();
            return { ok: r.ok, status: r.status, text: t.slice(0, 8_000_000) };
          } catch (e) { return { ok: false, error: String(e) }; }
        }, body);
        if (resp && resp.ok && resp.text) {
          const d = JSON.parse(resp.text);
          const l = Array.isArray(d) ? d : (d.Data || d.data || d.$values || []);
          if (Array.isArray(l)) listaBoletos = l;
          console.log(`   · busca ampla [${dtIni} → ${dtFim}]: ${l.length} boleto(s) em aberto.`);
        } else {
          console.log(`   · busca ampla falhou (${resp && (resp.status || resp.error)}) — usando a carga padrão.`);
        }
      }
    } catch (e) { console.log('   · (erro na busca ampla:', e.message, '— usando a carga padrão.)'); }

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
      const ok = await abrirFichaBusca(b.NOME, idCliente);
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
// é a SoFIA, pelo NÚMERO dela. dry=true: só imprime. Reenvia TODO DIA enquanto o
// débito segue em aberto, no máximo 1x por dia (dedup por idCliente+dia).
async function runInadimplentes({ dry = false } = {}) {
  const mensagens = require('./mensagens');
  const diasMin = cfg.lerDias();
  const lista = await lerInadimplentes();
  const res = { enfileirados: 0, skipped: 0, failed: 0, details: [] };
  if (!lista.length) { console.log('   📭 Ninguém a cobrar — nada a enfileirar.'); return res; }

  const enviados = lerEnviados();         // escrito pela SoFIA SÓ quando confirma o envio
  const pendentes = lerPendentesOutbox(); // já na fila, ainda não enviados pela SoFIA
  const linhas = [];
  console.log(`\n${dry ? '🧪 DRY (nada enfileirado)' : '📥 Enfileirando para a SoFIA'} — ${lista.length} inadimplente(s):`);

  for (const r of lista) {
    const chave = String(r.idCliente);
    const nome = r.nome;

    // Reenvia todo dia até pagar, mas no máximo uma vez por dia.
    if (enviados[chave] && mesmoDiaSp(enviados[chave].em)) {
      res.skipped++; res.details.push({ name: nome, status: 'skipped', reason: 'já cobrada hoje' });
      console.log(`   ⏭️  ${nome}: já cobrada HOJE — pulando (reenvia amanhã se continuar em aberto).`);
      continue;
    }
    if (pendentes.has(chave)) {
      res.skipped++; res.details.push({ name: nome, status: 'skipped', reason: 'já na fila da SoFIA' });
      console.log(`   ⏭️  ${nome}: já está na fila da SoFIA (aguardando envio) — não duplico.`);
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
    // NÃO marca "avisada" aqui — a SoFIA marca SÓ quando confirmar o envio
    // (evita marcar quem não recebeu por falha de envio).
    res.enfileirados++; res.details.push({ name: nome, phone: r.celular, status: 'enfileirado' });
    console.log(`   📥 ${nome} (${chaveMsg}) — enfileirada para a SoFIA.`);
  }

  if (!dry && linhas.length) {
    try { fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true }); } catch (_) {}
    fs.appendFileSync(OUTBOX_FILE, linhas.join('\n') + '\n', 'utf8');
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

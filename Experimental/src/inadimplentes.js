/**
 * Inadimplentes — lê no EVO quem está com débito VENCIDO há 2+ dias e, para quem
 * é RECORRENTE (cartão), gera o LINK de pagamento. Classifica cada uma:
 *   • recorrente (contrato "...RECORRENTE") → mensagem COM link de pagamento;
 *   • comum / boleto / pix               → mensagem SEM link (contato com a unidade).
 *
 * Fonte dos dados (tudo interceptando a API interna do EVO, como os outros jobs):
 *   1. Segmentação salva "Com débito" → candidatas (id, nome, celular, contrato).
 *   2. clientes/{id}/perfil            → data de vencimento + valor do saldo devedor.
 *   3. (só recorrente) Saldo devedor → "ENVIAR COBRANÇA" → link evo-totem.
 *      ⚠️ "ENVIAR COBRANÇA" só GERA o link (não cobra). NUNCA clicamos
 *         "Receber"/"Confirmar". Não marca checkbox (isso abre a barra "receber").
 *
 * Uso:
 *   node src/inadimplentes.js --dry     → só lê e imprime (NÃO envia, NÃO cobra)
 *
 * O ENVIO de WhatsApp é feito por quem chama runInadimplentes (scheduler), não aqui.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fecharPopupNovaTela } = require('./evo-popup');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Débito vencido há quantos dias já conta (regra do Studio: "após 2 dias").
// Limite "vencido há X+ dias" — configurável no painel (data/inadimplentes-config.json).
const cfg = require('./inadimplentes-config');
// Não reenvia para a mesma aluna dentro desta janela (evita mandar todo dia).
const REENVIO_DIAS = parseInt(process.env.INADIMPLENTES_REENVIO_DIAS || '3', 10);
// Fila de cobrança consumida pela SoFIA (envia pelo NÚMERO dela, não o do robô).
// Compartilhada entre os processos: o robô (Experimental) grava, a SoFIA (ChatBot)
// lê em ../Experimental/data/cobranca-outbox.jsonl.
const OUTBOX_FILE = process.env.COBRANCA_OUTBOX_FILE || path.resolve(__dirname, '..', 'data', 'cobranca-outbox.jsonl');
// Estado dos envios (por idCliente) — gitignored, por VPS.
const ENVIADOS_FILE = path.resolve(__dirname, '..', 'data', 'inadimplentes-enviados.json');
function lerEnviados() { try { const o = JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; } catch (_) { return {}; } }
function gravarEnviados(o) { try { fs.mkdirSync(path.dirname(ENVIADOS_FILE), { recursive: true }); } catch (_) {} try { fs.writeFileSync(ENVIADOS_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch (_) {} }
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

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

async function lerInadimplentes() {
  const diasMin = cfg.lerDias(); // limite configurável no painel
  console.log('\n═══════════════════════════════════════════════════');
  console.log('💳 Inadimplentes — lendo débitos vencidos no EVO...');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   Regra: vencido há ${diasMin}+ dia(s) e ainda em aberto.\n`);

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
  let listaDevedoras = null;              // snapshot da segmentação "Com débito"
  let perfilAtual = null;                 // {vencimento, valor} do cliente em foco
  let linkAtual = null;                   // link de cobrança do cliente em foco
  page.on('response', async (res) => {
    try {
      if (res.status() !== 200) return;
      const url = res.url();
      if (/clientes-segmentacao\/obter-clientes/i.test(url)) {
        const d = JSON.parse(await res.text());
        const l = Array.isArray(d) ? d : (d.retorno || d.data || d.lista || []);
        if (Array.isArray(l) && l.length && l.length <= 80) listaDevedoras = l;
        return;
      }
      if (/\/clientes\/\d+\/perfil/i.test(url)) {
        const d = JSON.parse(await res.text());
        // Varre a resposta (qualquer embrulho) e coleta itens de débito: objetos
        // com `vencimento` (data) — somando o valorSaldoDevedor de cada um.
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
        console.log(`   · perfil recebido (${itens.length} item[s], venc. mais antigo: ${vmin || 'nenhum'})`);
        return;
      }
      if (/recebimentos\/saldo-devedor\/dados-envio-cobranca/i.test(url)) {
        const d = JSON.parse(await res.text());
        const link = (d && (d.url || d.link)) || (typeof d === 'string' ? d : null);
        if (link && /^https?:\/\//.test(link)) linkAtual = link;
        return;
      }
    } catch (_) { /* respostas não-JSON */ }
  });

  const resultados = [];
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

    // 2) Segmentação "Com débito" → candidatas
    await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
    await sleep(7000); await fecharPopupNovaTela(page);
    let abriu = false;
    for (let i = 0; i < 12 && !abriu; i++) {
      abriu = await page.evaluate(() => {
        for (const el of document.querySelectorAll('a,li,span,div,p')) {
          const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        }
        return false;
      });
      if (!abriu) await sleep(1500);
    }
    await sleep(6000);
    const candidatas = (listaDevedoras || []).map(r => ({
      idCliente: r.idCliente, nome: r.nome,
      celular: String(r.celular || r.telefone || '').replace(/\D/g, ''),
      contrato: String(r.contrato || '').replace(/\s+/g, ' ').trim(),
    })).filter(c => c.idCliente);
    console.log(`👥 "Com débito": ${candidatas.length} candidata(s).`);
    if (!candidatas.length) { console.log('   (nenhuma — nada a fazer)'); return resultados; }

    // Helpers de navegação. O SPA do EVO só carrega o perfil (clientes/{id}/perfil)
    // quando se clica em "Ver perfil" — navegar por hash entre clientes diferentes
    // NÃO recarrega. Então, para CADA candidata, voltamos à segmentação, clicamos
    // no nome e em "Ver perfil".
    const abrirComDebito = async () => {
      await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/segmentacao/clientes`);
      await sleep(5000); await fecharPopupNovaTela(page);
      for (let i = 0; i < 12; i++) {
        const ok = await page.evaluate(() => { for (const el of document.querySelectorAll('a,li,span,div,p')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === 'com débito' && el.children.length === 0 && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } } return false; });
        if (ok) break; await sleep(1500);
      }
      await sleep(4000);
    };
    const abrirFicha = async (nome) => {
      const clicou = await page.evaluate((nome) => { const n = nome.trim().toLowerCase(); for (const el of document.querySelectorAll('a,span,div,td')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if (t === n && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return true; } } return false; }, nome);
      if (!clicou) return false;
      await sleep(5000); await fecharPopupNovaTela(page);
      const verPerfil = await page.evaluate(() => { for (const el of document.querySelectorAll('button,a,span,div,li')) { const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' '); if ((t === 'ver perfil' || t === 'person ver perfil') && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return true; } } return false; });
      console.log(`   · nome clicado; "Ver perfil" ${verPerfil ? 'clicado' : 'NÃO encontrado'}`);
      await sleep(7000); await fecharPopupNovaTela(page);
      return true;
    };

    // 3) Para cada candidata: abre a ficha → perfil (vencimento) → filtra → link
    for (const c of candidatas) {
      perfilAtual = null; linkAtual = null;
      await abrirComDebito();
      const achou = await abrirFicha(c.nome);
      if (!achou) { console.log(`   ⚠️  ${c.nome}: não achei o nome na lista (pulando).`); continue; }
      for (let i = 0; i < 20 && !perfilAtual; i++) await sleep(500);
      await fecharPopupNovaTela(page);

      if (!perfilAtual) { console.log(`   ⚠️  ${c.nome}: não li o perfil (pulando).`); continue; }
      const dias = diasDeAtraso(perfilAtual.vencimento);
      const base = { ...c, vencimento: perfilAtual.vencimento, vencimentoFmt: fmtData(perfilAtual.vencimento), diasAtraso: dias, valor: perfilAtual.valor };

      if (dias == null || dias < diasMin) {
        console.log(`   ⏭️  ${c.nome}: venc. ${base.vencimentoFmt} (atraso ${dias}d) — ainda não entra (< ${diasMin}d).`);
        continue;
      }
      const recorrente = ehRecorrente(c.contrato);
      base.tipo = recorrente ? 'recorrente' : 'boleto';

      if (recorrente) {
        // Gera o link SEM cobrar: abre Saldo devedor e clica "ENVIAR COBRANÇA".
        await page.evaluate((h) => { location.hash = h; }, `${config.evo.appBase}/clientes/cadastro/${c.idCliente}//financeiro/saldodevedor`);
        await sleep(6000); await fecharPopupNovaTela(page);
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('button,a,[role="button"]')) {
            const t = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if ((t === 'enviar cobrança' || t === 'enviar cobranca') && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.scrollIntoView({ block: 'center' }); el.click(); return; }
          }
        });
        for (let i = 0; i < 20 && !linkAtual; i++) await sleep(500); // espera o link
        // SEGURANÇA: fecha o popup sem confirmar
        await page.evaluate(() => { for (const el of document.querySelectorAll('button,a')) { const t = (el.textContent || '').trim().toLowerCase(); if (t === 'cancelar' && (el.offsetWidth > 0 || el.offsetHeight > 0)) { el.click(); return; } } });
        await page.keyboard.press('Escape').catch(() => {});
        base.link = linkAtual || null;
        if (!base.link) console.log(`   ⚠️  ${c.nome}: recorrente vencida, mas NÃO consegui gerar o link.`);
      }

      resultados.push(base);
      const emoji = recorrente ? '💳' : '🧾';
      console.log(`   ${emoji} ${c.nome} | venc. ${base.vencimentoFmt} (${dias}d) | ${base.tipo}${base.link ? ' | link OK' : ''}`);
    }
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  console.log(`\n📋 Total a notificar: ${resultados.length} (recorrente: ${resultados.filter(r => r.tipo === 'recorrente').length}, boleto: ${resultados.filter(r => r.tipo === 'boleto').length})`);
  return resultados;
}

// ─── Enfileirar para a SoFIA ────────────────────────────────────────────────
// Lê os inadimplentes vencidos e ENFILEIRA a mensagem certa (recorrente = com
// link; boleto/comum = sem link) na fila de cobrança. Quem ENVIA é a SoFIA, pelo
// NÚMERO dela (consumidor em ChatBot/sofia-listener.ts). dry=true: só imprime.
// Deduplica por idCliente (não re-enfileira dentro de REENVIO_DIAS).
async function runInadimplentes({ dry = false } = {}) {
  const mensagens = require('./mensagens');
  const lista = await lerInadimplentes();
  const res = { enfileirados: 0, skipped: 0, failed: 0, details: [] };
  if (!lista.length) { console.log('   📭 Ninguém vencido há 2+ dias — nada a enfileirar.'); return res; }

  const enviados = lerEnviados();
  const agora = Date.now();
  const linhas = [];
  console.log(`\n${dry ? '🧪 DRY (nada enfileirado)' : '📥 Enfileirando para a SoFIA'} — ${lista.length} inadimplente(s):`);

  for (const r of lista) {
    const chave = String(r.idCliente);
    const nome = r.nome;

    // Dedup: não re-enfileira dentro da janela.
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

    let texto;
    if (r.tipo === 'recorrente') {
      if (!r.link) { res.failed++; res.details.push({ name: nome, status: 'failed', reason: 'link não gerado' }); console.log(`   ❌ ${nome}: recorrente sem link — não enfileiro.`); continue; }
      texto = mensagens.render('cobranca_recorrente', { nome: primeiroNome(nome), link: r.link });
    } else {
      texto = mensagens.render('cobranca_boleto', { nome: primeiroNome(nome), vencimento: r.vencimentoFmt });
    }

    if (dry) {
      res.details.push({ name: nome, status: 'simulado' });
      console.log(`\n   — ${nome} (${r.celular}) · ${r.tipo} · venc. ${r.vencimentoFmt} —\n${texto}\n`);
      continue;
    }

    linhas.push(JSON.stringify({
      id: `${chave}-${String(r.vencimento || '').slice(0, 10)}`,
      telefone: r.celular, texto, nome, tipo: r.tipo, idCliente: r.idCliente,
      em: new Date().toISOString(),
    }));
    enviados[chave] = { em: new Date().toISOString(), nome, tipo: r.tipo, vencimento: r.vencimento };
    res.enfileirados++; res.details.push({ name: nome, phone: r.celular, status: 'enfileirado' });
    console.log(`   📥 ${nome} (${r.tipo}) — enfileirada para a SoFIA.`);
  }

  if (!dry && linhas.length) {
    try { fs.mkdirSync(path.dirname(OUTBOX_FILE), { recursive: true }); } catch (_) {}
    fs.appendFileSync(OUTBOX_FILE, linhas.join('\n') + '\n', 'utf8');
    gravarEnviados(enviados);
    console.log(`   📤 ${linhas.length} mensagem(ns) na fila da SoFIA → ${OUTBOX_FILE}`);
  }

  console.log(`\n📊 Cobrança de inadimplentes — enfileiradas: ${res.enfileirados} | puladas: ${res.skipped} | falhas: ${res.failed}`);
  return res;
}

module.exports = { lerInadimplentes, runInadimplentes, diasDeAtraso, ehRecorrente, fmtData, OUTBOX_FILE };

// ─── CLI ────────────────────────────────────────────────────────────────────
//   node src/inadimplentes.js            → só lê e imprime (dry, não enfileira)
//   node src/inadimplentes.js --enviar   → enfileira na fila da SoFIA (ela envia)
if (require.main === module) {
  const enviar = process.argv.includes('--enviar');
  (async () => {
    try { await runInadimplentes({ dry: !enviar }); }
    catch (e) { console.error('❌ erro:', e && e.message); }
    finally { process.exit(0); }
  })();
}

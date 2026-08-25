// enviar_confirmacoes.js
// Lê a fila "confirmacoes_outbox.jsonl" (gerada pelo agendamento ZEE->EVO) e envia as
// confirmações de aula experimental pela linha do STUDIO (8550-8065) via WhatsApp Web (Edge/CDP).
//
// DUAS FORMAS DE USAR:
//   A) COLAR NO SEU BOT (recomendado): importe e chame enviarConfirmacoes(page) com a `page`
//      do WhatsApp Web JÁ conectada — reusa sua sessão, sem abrir/matar Edge de novo.
//        const { enviarConfirmacoes } = require('./enviar_confirmacoes');
//        await enviarConfirmacoes(page);
//   B) RODAR SOZINHO: `node enviar_confirmacoes.js` — ele mesmo abre o Edge na porta 9226.
//      (Só use se NÃO houver outro job de WhatsApp rodando ao mesmo tempo, pra não conflitar.)
//
// Idempotência: marca o que já enviou em "<outbox>_enviados.json". Não reescreve a fila
// (evita corrida com o Python que faz append). Em falha, não marca -> tenta no próximo ciclo,
// até um limite de tentativas (registrado em "<outbox>_falhas.json") pra não repetir pra sempre.

const fs = require('fs');

// >>> AJUSTE o caminho da fila conforme sua máquina (ou defina STUDIO_OUTBOX_FILE no ambiente):
const OUTBOX = process.env.STUDIO_OUTBOX_FILE
  || 'C:\\AntiGravity\\Experimental\\src\\agendamento_evo\\confirmacoes_outbox.jsonl';
const SENT_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_enviados.json';
const FAIL_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_falhas.json';
// Rede de segurança: quando uma confirmação falha EM DEFINITIVO (número sem
// WhatsApp ou tentativas esgotadas), em vez de sumir, ela é GUARDADA aqui com
// todos os dados — para você poder reenviar depois (com o número corrigido)
// sem precisar caçar nada. Ver src/reenviar-confirmacao.js.
const RETIDOS_DB = OUTBOX.replace(/\.jsonl$/i, '') + '_retidas.json';
const MAX_TENTATIVAS = 5;   // depois disso, desiste daquele número (evita loop infinito)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lerFila() {
  if (!fs.existsSync(OUTBOX)) return [];
  const registros = [];
  const linhas = fs.readFileSync(OUTBOX, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const linha of linhas) {
    // Tolerância: se dois registros ficaram colados na mesma linha ("}{" sem \n),
    // um JSON.parse direto falha e perderíamos AMBOS. Então separamos "}{" em
    // objetos distintos antes de parsear.
    const pedacos = linha.includes('}{')
      ? linha.replace(/\}\s*\{/g, '}\n{').split('\n')
      : [linha];
    for (const p of pedacos) {
      try { registros.push(JSON.parse(p)); } catch { /* linha inválida — ignora */ }
    }
  }
  return registros;
}
function lerEnviados() {
  try { return new Set(JSON.parse(fs.readFileSync(SENT_DB, 'utf8'))); }
  catch { return new Set(); }
}
function salvarEnviados(set) {
  fs.writeFileSync(SENT_DB, JSON.stringify([...set]), 'utf8');
}
function lerFalhas() {
  try { return JSON.parse(fs.readFileSync(FAIL_DB, 'utf8')) || {}; }
  catch { return {}; }
}
function salvarFalhas(obj) {
  try { fs.writeFileSync(FAIL_DB, JSON.stringify(obj), 'utf8'); } catch {}
}
function lerRetidos() {
  try { return JSON.parse(fs.readFileSync(RETIDOS_DB, 'utf8')) || {}; }
  catch { return {}; }
}
function salvarRetidos(obj) {
  try { fs.writeFileSync(RETIDOS_DB, JSON.stringify(obj, null, 2), 'utf8'); } catch {}
}
// Guarda a confirmação que falhou em definitivo (com todos os dados) para reenvio
// posterior — em vez de deixá-la sumir. É idempotente pela chave.
function reterFalha(row, motivo) {
  try {
    const r = lerRetidos();
    r[chave(row)] = {
      name: row.name || '', phone: row.phone || '', when: row.when || '',
      message: row.message || '', motivo, ts: new Date().toISOString(),
    };
    salvarRetidos(r);
  } catch (_) { /* rede de segurança: nunca atrapalha o envio */ }
}
function chave(row) { return `${row.contactId}|${row.when}|${row.ts}`; }

// "2026-08-28 16:15" -> "sexta-feira, 28/08 às 16:15" (mesmo formato do formulário).
const _DIAS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
function friendlyQuando(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(when || ''));
  if (!m) return String(when || '');
  const [, Y, Mo, D, H, Mi] = m;
  const dt = new Date(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi));
  return `${_DIAS_PT[dt.getDay()]}, ${D}/${Mo} às ${H}:${Mi}`;
}

// Texto a enviar. Se você EDITOU a "Confirmação — aula experimental" no painel,
// o robô re-renderiza esse texto (com {nome} e {quando}); senão, usa o texto que
// já veio pronto na fila (montado pelo formulário). Assim dá para editar a
// confirmação no painel SEM mexer no formulário/Render — e sem risco: sem edição,
// nada muda.
function mensagemDaConfirmacao(row) {
  try {
    const mensagens = require('./mensagens');
    const ov = mensagens.carregarOverrides();
    if (ov && ov.confirmacao_experimental && String(ov.confirmacao_experimental).trim()) {
      const nome = String(row.name || '').trim().split(/\s+/)[0] || '';
      return mensagens.render('confirmacao_experimental', { nome, quando: friendlyQuando(row.when) });
    }
  } catch (_) { /* qualquer erro: cai no texto da fila */ }
  return row.message;
}
function normalizar(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (n && !n.startsWith('55')) n = '55' + n;   // garante DDI
  return n;
}

// Espera a conversa ficar pronta APÓS o goto do /send. Retorna:
//   'pronto'   -> a caixa de mensagem está disponível pra enviar
//   'invalido' -> o número não tem WhatsApp (popup de URL inválida)
//   'timeout'  -> não carregou a tempo (WhatsApp lento / tela travada)
// Também clica sozinho na tela de conflito de sessão ("Usar aqui"/"Continuar").
async function esperarConversaPronta(page, timeoutMs = 45000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const estado = await page.evaluate(() => {
      const txt = (document.body.innerText || '').toLowerCase();
      // Popup de número sem WhatsApp
      if (txt.includes('telefone compartilhado por url') ||
          txt.includes('phone number shared via url') ||
          txt.includes('número de telefone inválido') ||
          txt.includes('invalid phone number')) {
        return 'invalido';
      }
      // Tela de conflito de sessão: clica pra reassumir aqui
      const botoes = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const reassumir = botoes.find((b) =>
        /usar aqui|use here|usar nesta janela|continuar|continue/i.test((b.textContent || '').trim()));
      if (reassumir) { reassumir.click(); return 'conflito'; }
      // Caixa de mensagem pronta?
      const box = document.querySelector(
        'div[contenteditable="true"][data-tab], footer div[contenteditable="true"]');
      if (box) return 'pronto';
      return 'carregando';
    });
    if (estado === 'pronto') return 'pronto';
    if (estado === 'invalido') return 'invalido';
    await sleep(1000); // 'conflito'/'carregando' -> espera e reavalia
  }
  return 'timeout';
}

// Envia UMA mensagem usando uma page do WhatsApp Web já aberta/conectada.
async function enviarUma(page, phone, texto) {
  // page ignorado (compat). Envia pelo cliente único (whatsapp-web.js).
  {
    const wa = require('./wa-client');
    await wa.sendTexto(phone, texto);
    return;
  }
  // ── (código antigo via page abaixo fica inacessível) ──
  const number = normalizar(phone);
  await page.goto(
    `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(texto)}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );

  const estado = await esperarConversaPronta(page, 45000);
  if (estado === 'invalido') {
    const err = new Error('numero_sem_whatsapp');
    err.code = 'INVALIDO';
    throw err;
  }
  if (estado !== 'pronto') {
    throw new Error('conversa não carregou (WhatsApp lento ou tela de conflito de sessão)');
  }

  // Foca a caixa e garante que o texto está lá (o ?text= já preenche).
  await page.evaluate(() => {
    const box = document.querySelector(
      'div[contenteditable="true"][data-tab], footer div[contenteditable="true"]');
    if (box) box.focus();
  });
  await sleep(600);

  // Envia: 1) tenta o botão por vários seletores (inclui o ícone novo);
  //        2) se não achar, manda Enter (forma mais confiável).
  const clicouBotao = await page.evaluate(() => {
    const seletores = [
      'button[aria-label="Enviar"]', 'button[aria-label="Send"]',
      '[data-testid="send"]',
      'span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]',
      'footer button[data-tab]',
    ];
    for (const s of seletores) {
      const el = document.querySelector(s);
      if (el) { (el.closest('button') || el).click(); return true; }
    }
    return false;
  });
  if (!clicouBotao) {
    await page.keyboard.press('Enter');
  }
  await sleep(3500); // espera a mensagem sair
}

// Conta quantas confirmações estão pendentes (SEM conectar no WhatsApp).
// Usado pelo scheduler pra só abrir o WhatsApp quando há algo a enviar.
// (Ignora as que já foram enviadas e as que estouraram o limite de tentativas.)
function contarPendentes() {
  const enviados = lerEnviados();
  const falhas = lerFalhas();
  return lerFila().filter((r) => {
    const k = chave(r);
    return !enviados.has(k) && (falhas[k] || 0) < MAX_TENTATIVAS;
  }).length;
}

/**
 * Avisa no celular (ntfy) quando uma confirmação é DEFINITIVAMENTE perdida.
 *
 * Só nos casos sem volta (número sem WhatsApp ou tentativas esgotadas) — não a
 * cada re-tentativa, para não virar spam. É importante avisar: significa que uma
 * aluna agendou a experimental e NÃO recebeu a confirmação; alguém precisa
 * falar com ela na mão.
 */
function avisarFalhaDefinitiva(row, motivo) {
  try {
    require('./notificar').alertar(
      'Confirmacao NAO enviada',
      `${row.name || 'aluna'} (${row.phone}) nao recebeu a confirmacao da aula experimental`
      + `${row.when ? ' de ' + row.when : ''}. Motivo: ${motivo}. Ficou RETIDA — reenvie com o numero certo:`
      + ` node src/reenviar-confirmacao.js --nome="${row.name || ''}" --para=NUMERO --enviar`,
      { prioridade: 'high', tags: 'warning', forcar: true },
    );
  } catch (_) { /* alerta é opcional; nunca atrapalha o envio */ }
}

// >>> Função pra COLAR no seu bot (reusa a page já conectada) <<<
async function enviarConfirmacoes(page) {
  const enviados = lerEnviados();
  const falhas = lerFalhas();
  const pendentes = lerFila().filter((r) => {
    const k = chave(r);
    return !enviados.has(k) && (falhas[k] || 0) < MAX_TENTATIVAS;
  });
  console.log(`[confirmacoes] ${pendentes.length} pendente(s)`);
  for (const row of pendentes) {
    const k = chave(row);
    try {
      await enviarUma(page, row.phone, mensagemDaConfirmacao(row));
      enviados.add(k);
      salvarEnviados(enviados);
      if (falhas[k]) { delete falhas[k]; salvarFalhas(falhas); }
      console.log(`[confirmacoes] enviada para ${row.name} (${row.phone})`);
      await sleep(10000 + Math.floor(Math.random() * 2000)); // 10-12s entre mensagens
    } catch (e) {
      falhas[k] = (falhas[k] || 0) + 1;
      salvarFalhas(falhas);
      const restam = MAX_TENTATIVAS - falhas[k];
      if (e.code === 'INVALIDO') {
        // Número sem WhatsApp: não adianta re-tentar — desiste já, mas GUARDA
        // para reenvio (com o número corrigido) em vez de deixar sumir.
        falhas[k] = MAX_TENTATIVAS;
        salvarFalhas(falhas);
        reterFalha(row, 'o número não tem WhatsApp');
        console.error(`[confirmacoes] ${row.phone} (${row.name}) parece não ter WhatsApp — retida para reenvio.`);
        avisarFalhaDefinitiva(row, 'o número não tem WhatsApp');
      } else if (restam <= 0) {
        reterFalha(row, e.message);
        console.error(`[confirmacoes] falha ${row.phone} (${row.name}): ${e.message} — ` +
          `atingiu ${MAX_TENTATIVAS} tentativas, retida para reenvio.`);
        avisarFalhaDefinitiva(row, e.message);
      } else {
        console.error(`[confirmacoes] falha ${row.phone} (${row.name}): ${e.message} — ` +
          `re-tenta depois (restam ${restam}).`);
      }
    }
  }
}

// Reenvia uma confirmação RETIDA. Seleciona por chave exata ou por nome (parcial,
// sem acento/caixa). Envia pelo cliente único (wa-client) já inicializado. Em caso
// de sucesso: tira dos retidos, marca como enviada (não reaparece) e limpa a falha.
function _semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
async function reenviarRetido({ chave: k, nome, telefone } = {}) {
  const retidos = lerRetidos();
  const chaves = Object.keys(retidos);
  let alvo = (k && retidos[k]) ? k : '';
  if (!alvo && nome) {
    const alvoNome = _semAcento(nome);
    const achados = chaves.filter((c) => _semAcento(retidos[c].name).includes(alvoNome));
    if (achados.length > 1) throw new Error(`mais de um retido bate com "${nome}" — use --chave=...`);
    alvo = achados[0] || '';
  }
  if (!alvo) throw new Error('confirmação retida não encontrada');
  const item = retidos[alvo];
  const destino = normalizar(telefone || item.phone);
  const wa = require('./wa-client');
  await wa.sendTexto(destino, mensagemDaConfirmacao(item));
  delete retidos[alvo]; salvarRetidos(retidos);
  const enviados = lerEnviados(); enviados.add(alvo); salvarEnviados(enviados);
  const falhas = lerFalhas(); if (falhas[alvo] != null) { delete falhas[alvo]; salvarFalhas(falhas); }
  return { ...item, enviadoPara: destino };
}

module.exports = { enviarConfirmacoes, enviarUma, contarPendentes, lerRetidos, reenviarRetido };

// ---- Modo standalone (VPS/Linux): dispara a fila usando o cliente persistente ----
// IMPORTANTE: pare o scheduler antes (pm2 stop slimfit-exp), pois compartilham a
// mesma sessão do WhatsApp; religue depois (pm2 start slimfit-exp).
//   Uso:  node src/enviar_confirmacoes.js
if (require.main === module) {
  (async () => {
    const wa = require('./wa-client');
    const pendentes = contarPendentes();
    console.log(`[confirmacoes] ${pendentes} pendente(s) na fila.`);
    if (pendentes === 0) { console.log('Nada a enviar.'); process.exit(0); }

    console.log('🐧 Conectando ao WhatsApp (sessão salva)...');
    await wa.initWhatsApp();
    // enviarUma ignora o "page" e envia pelo cliente único (whatsapp-web.js).
    await enviarConfirmacoes(null);
    await wa.destroy();
    console.log('✅ Fila processada.');
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

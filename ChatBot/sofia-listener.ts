/**
 * sofia-listener.ts — conecta a SOFIA ao WhatsApp (número PRÓPRIO dela) e liga
 * o cérebro (sofia.ts). Era a peça que faltava para a Sofia funcionar de ponta
 * a ponta.
 *
 * O que faz:
 *   • Sobe o WhatsApp da Sofia (sessão própria em .wwebjs_auth) e publica o QR
 *     em sofia-wa-status.json — o painel (aba 🤖 Sofia) mostra esse QR.
 *   • Recebe a mensagem da aluna → chama responderComMemoria() → envia a resposta
 *     (e as imagens que a Sofia pediu via enviar_midia).
 *   • Quando VOCÊ responde manualmente pelo WhatsApp, assume a conversa (a Sofia
 *     sai daquela conversa pelos minutos configurados no painel).
 *   • Respeita o liga/desliga (a própria sofia.ts checa sofia-estado.txt).
 *
 * Rodar (na pasta ChatBot):
 *   ANTHROPIC_API_KEY, SOFIA_TOKEN, SOFIA_BOOK_URL no .env
 *   npx tsx sofia-listener.ts        (ou: pm2 start npm --name sofia-listener -- run listener)
 */
import "dotenv/config";
import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import * as fs from "node:fs";
import * as path from "node:path";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { responderComMemoria, assumirConversa, registrarNaMemoria, drenarMidias, gerarVariacoes, deveResponder, janelaSessaoMs, resumirConversa } from "./sofia";

const DIR = process.cwd();
const STATUS_FILE = path.join(DIR, "sofia-wa-status.json");
const AUTH_DIR = process.env.SOFIA_WA_AUTH || path.join(DIR, ".wwebjs_auth");
const HEADLESS = process.env.SOFIA_HEADLESS !== "false";
// Fixa uma versão conhecida do WhatsApp Web (evita travar em 99%). Igual ao robô.
const WEB_VERSION_URL = process.env.WA_WEB_VERSION_URL
  || "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901307-alpha.html";

function setStatus(estado: string, qr = "") {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ estado, qr, atualizadoEm: new Date().toISOString() }), "utf8"); } catch {}
}
const log = (m: string) => console.log(`[sofia] ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Alerta de queda (push no celular via ntfy) ──────────────────────────────
// Mesmo canal do robô: assine o MESMO tópico no app ntfy. Basta ter NTFY_TOPIC
// (e, opcional, NTFY_URL) no ChatBot/.env — o mesmo valor usado pelo robô. Sem
// isso, não faz nada. Anti-spam de 30 min para o QR não repetir a cada refresh.
const NTFY_BASE = (process.env.NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
async function enviarNtfy(title: string, body: string, tags = "warning", priority = "high") {
  if (!NTFY_TOPIC) return; // não configurado → silêncio
  try {
    await fetch(`${NTFY_BASE}/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST",
      headers: { Title: title, Priority: priority, Tags: tags },
      body,
      signal: AbortSignal.timeout(15000),
    });
    log(`alerta enviado (ntfy): ${title}`);
  } catch (e: any) { log("falha ao enviar alerta ntfy: " + (e?.message || e)); }
}
let ultimoAlertaQr = 0;
async function alertarQuedaQR() {
  const agora = Date.now();
  if (agora - ultimoAlertaQr < 30 * 60 * 1000) return; // anti-spam do QR
  ultimoAlertaQr = agora;
  await enviarNtfy("SoFIA caiu - precisa de QR", "O WhatsApp da SoFIA desconectou. Abra o painel (aba SoFIA -> Configuracao) e escaneie o QR. Ate la, ela nao responde as alunas.", "rotating_light", "urgent");
}
// Personalização: troca {nome} pelo primeiro nome do contato; sem nome, remove o
// marcador de forma limpa (", {nome}" ou "{nome}" viram vazio).
function aplicarNome(texto: string, nome?: string): string {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  if (primeiro) return texto.replace(/\{nome\}/gi, primeiro);
  return texto.replace(/\s*,?\s*\{nome\}/gi, "").replace(/\{nome\}/gi, "");
}

// ── "Jeito humano": divide a resposta em várias mensagens e mostra "digitando…"
//    com um tempo proporcional ao tamanho.
//    Os valores vêm do painel (aba 🤖 Sofia → "Jeito de responder"), gravados em
//    sofia-ritmo.json e lidos AQUI a cada mensagem — muda sem reiniciar o listener.
//    Se o arquivo não existir, cai nas variáveis do .env (SOFIA_*) e, por fim, no padrão.
const RITMO_FILE = path.join(DIR, "sofia-ritmo.json");
type Ritmo = { humano: boolean; msPorChar: number; delayMin: number; delayMax: number };
function inteiroEnv(v: string | undefined, padrao: number): number {
  const n = parseInt(v ?? "", 10); return Number.isFinite(n) ? n : padrao;
}
function lerRitmo(): Ritmo {
  const base: Ritmo = {
    humano: process.env.SOFIA_HUMANO !== "false",
    msPorChar: inteiroEnv(process.env.SOFIA_MS_POR_CHAR, 45),
    delayMin: inteiroEnv(process.env.SOFIA_DELAY_MIN, 1200),
    delayMax: inteiroEnv(process.env.SOFIA_DELAY_MAX, 4500),
  };
  try {
    const o = JSON.parse(fs.readFileSync(RITMO_FILE, "utf8"));
    if (o && typeof o === "object") {
      if (o.humano !== undefined) base.humano = o.humano !== false;
      if (o.msPorChar !== undefined) base.msPorChar = inteiroEnv(String(o.msPorChar), base.msPorChar);
      if (o.delayMin !== undefined) base.delayMin = inteiroEnv(String(o.delayMin), base.delayMin);
      if (o.delayMax !== undefined) base.delayMax = inteiroEnv(String(o.delayMax), base.delayMax);
    }
  } catch {}
  if (base.delayMax < base.delayMin) base.delayMax = base.delayMin;
  return base;
}

// Cada parágrafo (separado por linha em branco) vira uma mensagem separada.
function dividirEmMensagens(texto: string): string[] {
  return String(texto || "").split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}
function delayDigitando(parte: string, r: Ritmo): number {
  return Math.min(r.delayMax, Math.max(r.delayMin, parte.length * r.msPorChar));
}
// "digitando…" SEM getChat: o getChat serializa a conversa e estoura o erro
// minificado ("r") — o robô descobriu isso e passou longe. Por baixo, o
// chat.sendStateTyping() da whatsapp-web.js só chama window.WWebJS.sendChatstate,
// então fazemos isso direto pelo jid (msg.from), sem serializar nada. Best-effort:
// se a versão do WhatsApp Web não tiver essa função, apenas não mostra a bolinha.
async function chatstate(jid: string, estado: "typing" | "recording" | "stop") {
  try {
    const page: any = (client as any).pupPage;
    if (!page) return;
    await page.evaluate(
      (chatId: string, st: string) => (window as any).WWebJS?.sendChatstate?.(st, chatId),
      jid, estado,
    );
  } catch {}
}
async function mostrarDigitando(jid: string) { await chatstate(jid, "typing"); }
async function pararDigitando(jid: string) { await chatstate(jid, "stop"); }

// Envia como gente: "digitando…" + pausa + a mensagem, uma parte de cada vez.
// O envio de verdade é client.sendMessage (não serializa chat) — a mensagem vai
// mesmo que a bolinha de "digitando" não apareça.
// `chaveRegistro` (opcional): quando informado, registra CADA parte enviada no
// inbox — assim o painel mostra as mesmas bolhas que a aluna vê no WhatsApp (no
// modo humano a resposta vira várias mensagens).
async function enviarHumano(to: string, texto: string, chaveRegistro?: string) {
  const r = lerRitmo(); // fresco a cada resposta — o painel manda no ritmo
  const partes = r.humano ? dividirEmMensagens(texto) : [String(texto || "").trim()];
  for (let i = 0; i < partes.length; i++) {
    if (!partes[i]) continue;
    await mostrarDigitando(to);
    await sleep(delayDigitando(partes[i], r));
    await enviar(to, partes[i]);
    if (chaveRegistro) registrarInbox(chaveRegistro, to, "", "sofia", partes[i]); // painel = WhatsApp
    if (i < partes.length - 1) await sleep(400 + Math.floor(Math.random() * 500));
  }
  await pararDigitando(to);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
  webVersionCache: { type: "remote", remotePath: WEB_VERSION_URL },
  puppeteer: {
    headless: HEADLESS,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  },
});

// jid → telefone/chave (mesma normalização nos dois handlers, para o handoff
// pausar exatamente a conversa que a Sofia estava respondendo).
function jidParaTel(jid: string) { return String(jid || "").replace(/@(c\.us|lid)$/, ""); }

// Resolve o TELEFONE REAL do contato. Para "@c.us" o próprio jid já é o número.
// Para o formato novo "@lid" o jid é um ID interno (NÃO é telefone) — aí buscamos
// o número de verdade em getContact() (best-effort). Sem isso, o agendamento ia
// para o EVO com o "@lid" e a confirmação do robô voltava "número não tem WhatsApp".
// Resolvemos UMA vez por contato e guardamos em cache, para a chave de memória e o
// handoff ficarem estáveis mesmo que um getContact posterior falhe.
const telCache = new Map<string, string>();
function soDigitos(v: any) { return String((v && (v._serialized || v.user || v)) || "").replace(/\D/g, ""); }
function pareceTelefone(s: string) { return /^\d{11,15}$/.test(s); } // com DDI: 55 + DDD + número

// Tenta descobrir o TELEFONE REAL de um contato "@lid" (o jid é um ID interno,
// NÃO é telefone). Tenta, em ordem: getContact().number → campos "Pn" que o
// protocolo novo às vezes traz no msg._data → store interno (pupPage). Se nada
// vier, loga um DIAGNÓSTICO com os campos disponíveis (pra mirarmos certo nesta
// versão) e devolve "" (sem número). Nunca devolve o próprio LID como telefone.
async function telefoneDoLid(msg: any, jid: string, lid: string): Promise<string> {
  // 1) getContact(): em "@lid", o telefone REAL vem no c.id (@c.us) — o c.number
  //    costuma trazer o próprio LID. Então tentamos o c.id PRIMEIRO.
  try {
    const c = await msg.getContact();
    const idSer: string = (c && c.id && c.id._serialized) || "";
    if (idSer.endsWith("@c.us")) {
      const num = soDigitos(c.id.user);
      if (pareceTelefone(num) && num !== lid) { log(`@lid ${jid} → telefone ${num} (getContact.id)`); return num; }
    }
    const num2 = soDigitos(c && c.number);
    if (pareceTelefone(num2) && num2 !== lid) { log(`@lid ${jid} → telefone ${num2} (getContact.number)`); return num2; }
  } catch {}
  // 2) Campos do protocolo novo que às vezes acompanham o LID
  try {
    const d: any = msg._data || {};
    for (const cand of [d.senderPn, d.peerRecipientPn, d.recipientPn, d.participantPn, d.author]) {
      const num = soDigitos(cand);
      if (pareceTelefone(num) && num !== lid) { log(`@lid ${jid} → telefone ${num} (msg._data)`); return num; }
    }
  } catch {}
  // 3) Store interno (nomes variam por versão — tudo best-effort)
  try {
    const page: any = (client as any).pupPage;
    if (page) {
      const bruto = await page.evaluate((lidJid: string) => {
        try {
          const S: any = (window as any).Store || {};
          const fns = [S.LidUtils && S.LidUtils.getPhoneNumber, S.NumberInfo && S.NumberInfo.getPhoneNumber];
          for (const fn of fns) { if (typeof fn === "function") { const r = fn(lidJid); const s = r && (r._serialized || r.user || r); if (s) return String(s); } }
          const WW: any = (window as any).WWebJS;
          if (WW && typeof WW.getContact === "function") { const c = WW.getContact(lidJid); if (c && c.number) return String(c.number); }
        } catch (e) {}
        return "";
      }, jid);
      const num = soDigitos(bruto);
      if (pareceTelefone(num) && num !== lid) { log(`@lid ${jid} → telefone ${num} (Store)`); return num; }
    }
  } catch {}
  // 4) Diagnóstico: mostra o que existe, pra sabermos qual campo usar nesta versão
  try {
    const c: any = await msg.getContact().catch(() => null);
    const d: any = msg._data || {};
    const chaves = Object.keys(d).filter((k) => /pn|phone|number|author|recipient|sender/i.test(k));
    log(`DIAG @lid ${jid}: number=${c && c.number} id=${c && c.id && c.id._serialized} campos=[${chaves.map((k) => k + "=" + JSON.stringify(soDigitos((d as any)[k]) || (d as any)[k])).join(", ")}]`);
  } catch {}
  log(`aviso: não achei o telefone real de ${jid} — agendamento fica sem número (avise pela Sofia).`);
  return "";
}

// Resolve DUAS coisas por contato (com cache, para ficarem estáveis):
//   • chave    → id estável para MEMÓRIA e handoff (telefone real, ou o LID quando
//                não dá pra descobrir — nunca colide entre contatos diferentes).
//   • telefone → telefone REAL para o AGENDAMENTO (ou "" quando não dá pra achar;
//                NUNCA o LID, pra não mandar lixo ao EVO).
const telRealCache = new Map<string, string>();
async function resolverTel(msg: any): Promise<{ chave: string; telefone: string }> {
  const jid: string = msg.from || msg.to || "";
  if (telCache.has(jid)) return { chave: telCache.get(jid) as string, telefone: telRealCache.get(jid) || "" };
  let telefone = "";
  if (jid.endsWith("@lid")) telefone = await telefoneDoLid(msg, jid, jidParaTel(jid)); // "" se não achar
  else telefone = jidParaTel(jid); // @c.us: o jid já é o telefone
  const chave = telefone || jidParaTel(jid); // estável: telefone real, senão o LID
  telCache.set(jid, chave);
  telRealCache.set(jid, telefone);
  return { chave, telefone };
}

// Quantas mensagens a PRÓPRIA Sofia enviou e ainda não "ecoaram" no evento
// message_create. Incrementa ANTES de enviar (sem corrida) e decrementa quando
// o eco chega. Um message_create fromMe SEM eco pendente = VOCÊ respondeu
// manualmente (handoff). À prova de corrida, ao contrário do id salvo depois.
const pendentesEco = new Map<string, number>();
function incEco(jid: string) { pendentesEco.set(jid, (pendentesEco.get(jid) || 0) + 1); }
function decEco(jid: string) { const n = (pendentesEco.get(jid) || 0) - 1; if (n > 0) pendentesEco.set(jid, n); else pendentesEco.delete(jid); }

async function enviar(to: string, conteudo: any, opts?: any) {
  incEco(to);
  try { return await client.sendMessage(to, conteudo, opts); }
  catch (e) { decEco(to); throw e; } // envio falhou → não deixa o contador preso
}

client.on("qr", async (qr) => {
  // Esperando um HUMANO escanear — NÃO é travamento. Desarma o watchdog para não
  // matar o processo (e trocar o QR) no meio da leitura. Ele é re-armado quando
  // a sessão autenticar (aí sim faz sentido cobrar o "PRONTA").
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  log("QR recebido — escaneie pelo painel (aba 🤖 Sofia) ou aqui no terminal:");
  alertarQuedaQR(); // push no celular (mesmo canal do robô) — sessão caiu, precisa reescanear
  try { qrcodeTerminal.generate(qr, { small: true }); } catch {}
  try { const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); setStatus("qr", dataUrl); }
  catch { setStatus("qr", ""); }
});
client.on("authenticated", () => { log("autenticada."); setStatus("iniciando"); armarWatchdogBoot(); });
client.on("ready", () => { pronta = true; if (bootTimer) clearTimeout(bootTimer); gravarFails(0); log("PRONTA — respondendo as alunas."); setStatus("conectado"); });
client.on("change_state", (s: string) => log("estado: " + s));
client.on("disconnected", (m: any) => { pronta = false; log("desconectada: " + m); setStatus("desconectado"); armarWatchdogBoot(); });

// ── Auto-recuperação do "travou no carregamento" (autentica mas nunca chega em
//    PRONTA). ESCALONA, para não virar loop destrutivo:
//      tentativa 1 → só reinicia (reaproveita o cache; muitas vezes já resolve);
//      tentativa 2 → limpa o cache do WhatsApp Web (NÃO o login) e reinicia;
//      tentativa >= MAX → PARA de reiniciar e fica ociosa pedindo atenção
//        (evita o loop infinito de reinícios). O contador zera quando conecta.
//    Desligue com SOFIA_BOOT_TIMEOUT_MS=0.
const BOOT_TIMEOUT_MS = parseInt(process.env.SOFIA_BOOT_TIMEOUT_MS || "75000", 10);  // 75s (0 desliga)
const BOOT_MAX_TENTATIVAS = parseInt(process.env.SOFIA_BOOT_MAX_TENTATIVAS || "6", 10);
const FAILS_FILE = path.join(DIR, ".sofia-boot-fails");
function lerFails() { try { return parseInt(fs.readFileSync(FAILS_FILE, "utf8").trim(), 10) || 0; } catch { return 0; } }
function gravarFails(n: number) { try { fs.writeFileSync(FAILS_FILE, String(n), "utf8"); } catch {} }
function limparCacheWa() {
  try { fs.rmSync(path.join(AUTH_DIR, "..", ".wwebjs_cache"), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(DIR, ".wwebjs_cache"), { recursive: true, force: true }); } catch {}
}
let pronta = false;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
function armarWatchdogBoot() {
  if (BOOT_TIMEOUT_MS <= 0) return; // desligado por env
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    if (pronta) return;
    const tentativa = lerFails() + 1;
    gravarFails(tentativa);
    if (tentativa >= BOOT_MAX_TENTATIVAS) {
      // Desiste de reiniciar sozinha (evita loop). Limpa o cache só AGORA — assim a
      // próxima tentativa manual pega a versão fresca — e fica ociosa pedindo atenção.
      log(`travou ${tentativa}x seguidas — PAREI de reiniciar sozinha. Limpei o cache; `
        + `rode 'pm2 restart sofia-listener' de novo (ou reescaneie o QR) quando puder.`);
      limparCacheWa();
      setStatus("desconectado");
      return;
    }
    // Boot bom conecta em segundos; travado nunca conecta. Reinício rápido
    // reaproveitando o cache maximiza a chance de pegar um boot bom logo — NÃO
    // limpamos o cache no meio (forçar re-download não ajuda num hang do WhatsApp).
    log(`travou (tentativa ${tentativa}/${BOOT_MAX_TENTATIVAS}) — reiniciando…`);
    setStatus("iniciando");
    process.exit(1); // pm2 reinicia o processo
  }, BOOT_TIMEOUT_MS);
}

// ── Health-check (pega o "travamento silencioso") ───────────────────────────
//    O watchdog acima só cobre "autenticou mas nunca ficou PRONTA". Mas às vezes
//    o whatsapp-web.js FICA "pronta" na memória e, mesmo assim, PARA de receber/
//    enviar (sessão zumbi) SEM disparar "disconnected" — a SoFIA fica muda e nada
//    avisa. Aqui, de tempos em tempos, perguntamos o estado real (getState, com
//    timeout). Se não estiver CONNECTED em 2 checagens seguidas, avisamos no
//    celular (ntfy) e reiniciamos (pm2 sobe de novo). Desliga com SOFIA_HEALTH_MS=0.
// Intervalo editável pelo painel (SoFIA → Configuração), em minutos, gravado em
// sofia-health-min.txt. Lido a cada ciclo — muda sem reiniciar. 0 = desligado.
const HEALTH_FILE = path.join(DIR, "sofia-health-min.txt");
function healthMs(): number {
  try {
    const n = parseFloat(fs.readFileSync(HEALTH_FILE, "utf8").trim().replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 60000);
  } catch {}
  const env = parseInt(process.env.SOFIA_HEALTH_MS || "", 10);
  return Number.isFinite(env) ? env : 180000; // padrão 3 min
}
let healthFails = 0;
async function checarSaude() {
  if (!pronta) return; // só cobramos saúde quando a sessão deveria estar no ar
  let estado: string | null = null;
  try {
    estado = await Promise.race([
      client.getState(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
    ]);
  } catch (e: any) { estado = null; log("health: getState falhou (" + (e?.message || e) + ")"); }
  if (estado === "CONNECTED") { healthFails = 0; return; }
  healthFails++;
  log(`health: sessão não-CONNECTED (estado=${estado}) — falha ${healthFails}/2.`);
  if (healthFails >= 2) {
    log("health: SoFIA parece TRAVADA (sessão zumbi) — avisando e reiniciando.");
    try { await enviarNtfy("SoFIA travou - reiniciando", "A SoFIA parou de responder (sessao travada, sem cair o QR). Ela esta reiniciando sozinha. Se depois de alguns minutos ainda nao responder, reescaneie o QR pelo painel.", "warning", "high"); } catch {}
    pronta = false;
    setStatus("iniciando");
    process.exit(1); // pm2 reinicia o processo
  }
}
// Timer que se reagenda lendo o intervalo do arquivo a cada ciclo (assim mudar
// no painel — ou desligar com 0 — vale sem reiniciar).
function agendarSaude() {
  const ms = healthMs();
  const espera = ms > 0 ? Math.max(30000, ms) : 60000; // desligado: só re-lê o arquivo a cada 1 min
  setTimeout(async () => {
    if (healthMs() > 0) { try { await checarSaude(); } catch {} }
    agendarSaude();
  }, espera);
}
agendarSaude();

// Serializa o processamento (uma mensagem por vez): mantém a fila de mídias
// (drenarMidias) coerente e é mais gentil com a API da Claude.
let fila: Promise<any> = Promise.resolve();
function enfileirar(fn: () => Promise<void>) { fila = fila.then(fn).catch((e: any) => log("erro na fila: " + (e?.stack || e?.message || e))); return fila; }

// ── Inbox (conversas em andamento) — persistido em sofia-conversas.json para o
//    painel (aba Sofia → Conversas) ler, mostrar e responder. Guarda as últimas
//    N mensagens por conversa e só os últimos X dias.
const CONVERSAS_FILE = path.join(DIR, "sofia-conversas.json");
const INBOX_MAX_MSGS = parseInt(process.env.SOFIA_INBOX_MSGS || "60", 10);
const INBOX_RETENCAO_MS = parseInt(process.env.SOFIA_INBOX_DIAS || "7", 10) * 24 * 3600 * 1000;
type InboxMsg = { autor: "aluna" | "sofia" | "humano"; texto: string; em: number };
type InboxConversa = { jid: string; nome: string; ultimaEm: number; msgs: InboxMsg[] };
const inbox = new Map<string, InboxConversa>();
let inboxTimer: ReturnType<typeof setTimeout> | null = null;
function carregarInbox() {
  try { const o = JSON.parse(fs.readFileSync(CONVERSAS_FILE, "utf8")); if (o && typeof o === "object") for (const k of Object.keys(o)) inbox.set(k, o[k]); } catch {}
}
function salvarInbox() {
  const corte = Date.now() - INBOX_RETENCAO_MS;
  const obj: Record<string, InboxConversa> = {};
  for (const [k, c] of inbox) { if (c.ultimaEm >= corte) obj[k] = c; else inbox.delete(k); }
  try { fs.writeFileSync(CONVERSAS_FILE, JSON.stringify(obj), "utf8"); } catch {}
}
function agendarSalvarInbox() { if (inboxTimer) return; inboxTimer = setTimeout(() => { inboxTimer = null; salvarInbox(); }, 1500); }
function registrarInbox(chave: string, jid: string, nome: string, autor: InboxMsg["autor"], texto: string) {
  const t = String(texto || "").trim();
  if (!t) return;
  let c = inbox.get(chave);
  if (!c) { c = { jid: jid || "", nome: nome || "", ultimaEm: 0, msgs: [] }; inbox.set(chave, c); }
  if (jid) c.jid = jid;
  if (nome && !c.nome) c.nome = nome;
  const em = Date.now();
  c.msgs.push({ autor, texto: t, em });
  if (c.msgs.length > INBOX_MAX_MSGS) c.msgs.splice(0, c.msgs.length - INBOX_MAX_MSGS);
  c.ultimaEm = em;
  agendarSalvarInbox();
  registrarSessao(chave, nome || c.nome, autor, t, em);
}

// ── Histórico de INTERAÇÕES (aba Contatos → Interações do painel) ────────────
//    Permanente e separado do inbox (que só guarda 7 dias). Uma "interação" é
//    uma sessão: começa numa mensagem da aluna e vai se estendendo enquanto as
//    respostas chegam dentro da janela de sessão (a mesma da memória da Sofia).
//    Quando passa a janela sem novidade, a sessão ENCERRA e ganha um resumo
//    curto (gerado pela Claude). Guardamos só metadados + resumo (sem transcrição
//    — leve e discreto). O arquivo cresce para sempre; o painel só lê.
const HISTORICO_FILE = path.join(DIR, "sofia-historico.json");
type SessaoMsg = { autor: string; texto: string };
type Sessao = { id: string; inicioEm: number; fimEm: number; nMsgs: number; status: "ativa" | "encerrada"; resumo: string; resumoPronto: boolean; _buf?: SessaoMsg[] };
type HistContato = { nome: string; sessoes: Sessao[] };
const historico = new Map<string, HistContato>();
let histTimer: ReturnType<typeof setTimeout> | null = null;
const HIST_MAX_SESSOES = 200; // teto por contato (mantém as mais recentes)

function carregarHistorico() {
  try {
    const o = JSON.parse(fs.readFileSync(HISTORICO_FILE, "utf8"));
    if (o && typeof o === "object") for (const k of Object.keys(o)) historico.set(k, o[k]);
  } catch {}
}
function salvarHistorico() {
  const obj: Record<string, HistContato> = {};
  for (const [k, h] of historico) {
    obj[k] = { nome: h.nome, sessoes: h.sessoes.map((s) => ({ id: s.id, inicioEm: s.inicioEm, fimEm: s.fimEm, nMsgs: s.nMsgs, status: s.status, resumo: s.resumo, resumoPronto: s.resumoPronto })) };
  }
  try { fs.writeFileSync(HISTORICO_FILE, JSON.stringify(obj), "utf8"); } catch {}
}
function agendarSalvarHistorico() { if (histTimer) return; histTimer = setTimeout(() => { histTimer = null; salvarHistorico(); }, 1500); }

function registrarSessao(chave: string, nome: string, autor: string, texto: string, em: number) {
  const janela = janelaSessaoMs();
  const eraNovo = !historico.has(chave); // primeira vez que vemos esse contato
  let h = historico.get(chave);
  const aberta = h && h.sessoes.length && h.sessoes[h.sessoes.length - 1].status === "ativa" ? h.sessoes[h.sessoes.length - 1] : null;
  const expirada = aberta && em - aberta.fimEm > janela;

  if (aberta && !expirada) {
    // Estende a sessão em andamento (qualquer autor).
    aberta.fimEm = em; aberta.nMsgs++;
    (aberta._buf || (aberta._buf = [])).push({ autor, texto });
    if (nome && (!h!.nome || h!.nome !== nome)) h!.nome = nome;
    agendarSalvarHistorico();
    return;
  }
  if (aberta && expirada) { void fecharSessao(chave, aberta); }
  // Só a mensagem da ALUNA abre uma interação nova (evita sessão só de campanha).
  if (autor !== "aluna") return;
  if (!h) { h = { nome: nome || "", sessoes: [] }; historico.set(chave, h); }
  if (nome) h.nome = nome;
  const nova: Sessao = { id: "s" + em.toString(36), inicioEm: em, fimEm: em, nMsgs: 1, status: "ativa", resumo: "", resumoPronto: false, _buf: [{ autor, texto }] };
  h.sessoes.push(nova);
  if (h.sessoes.length > HIST_MAX_SESSOES) h.sessoes.splice(0, h.sessoes.length - HIST_MAX_SESSOES);
  agendarSalvarHistorico();
  // Gatilho 'novo': primeira mensagem de um contato que nunca vimos.
  if (eraNovo) { for (const r of (lerRegras().novo || [])) emitirAcao(chave, nome, r, "novo"); }
}

async function fecharSessao(chave: string, sess: Sessao) {
  if (sess.status === "encerrada") return;
  sess.status = "encerrada";
  agendarSalvarHistorico();
  // Transcrição: o buffer em memória; se vazio (reinício), reconstrói do inbox.
  let linhas = sess._buf && sess._buf.length ? sess._buf : [];
  if (!linhas.length) {
    const c = inbox.get(chave);
    if (c) linhas = c.msgs.filter((m) => m.em >= sess.inicioEm && m.em <= sess.fimEm + 1000).map((m) => ({ autor: m.autor, texto: m.texto }));
  }
  try { sess.resumo = await resumirConversa(linhas); } catch { sess.resumo = ""; }
  sess.resumoPronto = true;
  delete sess._buf;
  agendarSalvarHistorico();
  // Gatilho 'encerrou': sessão encerrada. O painel decide se aplica (não marca
  // quem já agendou — ele tem a tag de agendou).
  const regEnc = lerRegras().encerrou || [];
  if (regEnc.length) { const nomeC = (historico.get(chave) || {} as any).nome || ""; for (const r of regEnc) emitirAcao(chave, nomeC, r, "encerrou"); }
}

// Fecha sessões paradas há mais que a janela (assim a interação encerra e ganha
// resumo mesmo que a aluna nunca mais escreva). Roda de tempos em tempos.
function varrerSessoes() {
  const janela = janelaSessaoMs();
  const agora = Date.now();
  for (const [chave, h] of historico) {
    const ult = h.sessoes[h.sessoes.length - 1];
    if (ult && ult.status === "ativa" && agora - ult.fimEm > janela) void fecharSessao(chave, ult);
  }
}

// ── Automação por tag (gatilhos detectados aqui: novo/palavra/campanha/encerrou) ──
//    O painel publica as regras em sofia-regras.json; nós detectamos os eventos
//    e devolvemos as AÇÕES em sofia-eventos.jsonl (o painel aplica a tag + avisa).
const REGRAS_FILE = path.join(DIR, "sofia-regras.json");
const EVENTOS_FILE = path.join(DIR, "sofia-eventos.jsonl");
type RegraTag = { tag: string; avisarWpp?: string; palavras?: string[] };
let regras: Record<string, RegraTag[]> = {};
let regrasMtime = -1;
function lerRegras(): Record<string, RegraTag[]> {
  try {
    const st = fs.statSync(REGRAS_FILE);
    if (st.mtimeMs !== regrasMtime) {
      regras = JSON.parse(fs.readFileSync(REGRAS_FILE, "utf8")) || {};
      regrasMtime = st.mtimeMs;
    }
  } catch { regras = {}; regrasMtime = -1; }
  return regras;
}
function emitirAcao(telefone: string, nome: string, r: RegraTag, motivo: string, extra?: string) {
  try {
    fs.appendFileSync(EVENTOS_FILE, JSON.stringify({
      telefone: String(telefone || "").replace(/\D/g, ""), nome: nome || "",
      tag: r.tag, avisarWpp: r.avisarWpp || "", motivo, extra: extra || "", em: Date.now(),
    }) + "\n", "utf8");
  } catch {}
}
// Anti-repetição por (chave|motivo|tag): não dispara o mesmo gatilho de novo
// dentro da janela de sessão (evita spam de palavra-chave/campanha).
const gatilhoRecente = new Map<string, number>();
function jaDisparou(chave: string, motivo: string, tag: string): boolean {
  const k = chave + "|" + motivo + "|" + tag;
  const agora = Date.now();
  const ate = gatilhoRecente.get(k) || 0;
  if (agora < ate) return true;
  gatilhoRecente.set(k, agora + janelaSessaoMs());
  return false;
}
function normTxt(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
// Chamado no fim do handler da aluna: checa palavra-chave e "respondeu campanha".
function checarGatilhosAluna(chave: string, nome: string, texto: string) {
  const rs = lerRegras();
  // palavra-chave
  const t = normTxt(texto);
  for (const r of (rs.palavra || [])) {
    const pals = (r.palavras || []).map(normTxt).filter(Boolean);
    if (pals.some((p) => t.includes(p)) && !jaDisparou(chave, "palavra", r.tag)) emitirAcao(chave, nome, r, "palavra");
  }
  // respondeu campanha: a aluna está na lista de enviados de alguma campanha?
  const camps = (rs.campanha || []);
  if (camps.length) {
    const alvo8 = soDigitos(chave).slice(-8);
    const recebeu = alvo8.length === 8 && campanhas.some((c) => (c.enviados || []).some((e: any) => soDigitos(e.tel).slice(-8) === alvo8));
    if (recebeu) for (const r of camps) if (!jaDisparou(chave, "campanha", r.tag)) emitirAcao(chave, nome, r, "campanha");
  }
}

// ── Respostas ENVIADAS PELO PAINEL (aba Sofia → Conversas) ──────────────────
//    O painel enfileira em sofia-respostas.jsonl (uma linha JSON por resposta:
//    {chave, jid, texto, em}). Aqui consumimos essa fila, enviamos pelo WhatsApp
//    e ASSUMIMOS a conversa (a Sofia sai dela pelos minutos configurados), igual
//    a responder pelo WhatsApp Web. Para não perder linhas gravadas enquanto
//    processamos, renomeamos o arquivo (atômico) e lemos a cópia — novas linhas
//    do painel caem num arquivo novo.
const RESPOSTAS_FILE = path.join(DIR, "sofia-respostas.jsonl");

// Resolve o ID de envio a partir do TELEFONE REAL — igual ao robô. Tenta as duas
// variações brasileiras (com e sem o 9º dígito) via getNumberId, que trata o "@lid"
// do WhatsApp. Sem isso, enviar direto por "<numero>@c.us" dá "No LID for user".
function variantesBR(n: string): string[] {
  const out = [n];
  const m = /^55(\d{2})(\d+)$/.exec(n);
  if (m) {
    const [, ddd, local] = m;
    if (local.length === 9 && local[0] === "9") out.push(`55${ddd}${local.slice(1)}`); // tira o 9
    else if (local.length === 8 && "6789".includes(local[0])) out.push(`55${ddd}9${local}`); // põe o 9
  }
  return out;
}
async function resolverIdEnvio(telefone: string): Promise<string> {
  let n = String(telefone || "").replace(/\D/g, "");
  if (!n) throw new Error("sem telefone");
  if (!n.startsWith("55")) n = "55" + n;
  for (const cand of variantesBR(n)) {
    try { const numId: any = await client.getNumberId(cand); if (numId && numId._serialized) return numId._serialized; }
    catch {}
  }
  return n + "@c.us"; // último recurso: deixa o envio tentar
}

let processandoResp = false;
async function processarRespostas() {
  if (processandoResp || !pronta) return;         // espera estar conectada
  let tamanho = 0;
  try { tamanho = fs.statSync(RESPOSTAS_FILE).size; } catch { return; } // sem fila
  if (!tamanho) return;
  processandoResp = true;
  const tmp = RESPOSTAS_FILE + "." + Date.now() + ".proc";
  let linhas: string[] = [];
  try {
    fs.renameSync(RESPOSTAS_FILE, tmp);           // atômico: novas gravações vão p/ um arquivo novo
    linhas = fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    fs.rmSync(tmp, { force: true });
  } catch (e: any) { log("erro lendo fila de respostas: " + (e?.message || e)); processandoResp = false; return; }
  for (const linha of linhas) {
    let ent: any; try { ent = JSON.parse(linha); } catch { continue; }
    const texto = String(ent?.texto || "").trim();
    if (!texto) continue;
    const chave = String(ent?.chave || "").trim();
    const jid = String(ent?.jid || "").trim();
    // Telefone REAL para enviar: a chave (telefone real, mesmo em contato "@lid").
    // Só usa os dígitos do jid quando ele é "@c.us" (aí o jid já é o telefone).
    const telefone = pareceTelefone(chave) ? chave : (jid.endsWith("@c.us") ? jidParaTel(jid) : "");
    if (!pareceTelefone(telefone)) { log(`resposta do painel sem telefone válido (chave=${chave}) — ignorada.`); continue; }
    enfileirar(async () => {
      // NÃO usamos a pausa por tempo aqui: quem controla é o interruptor "controle
      // humano" da conversa (o painel liga/desliga em sofia-humano.json). Assim,
      // ao devolver à Sofia (desligar o interruptor), ela volta na hora.
      registrarNaMemoria(chave, "humano", texto); // Sofia "ouve" para ter contexto quando voltar
      try {
        const alvo = await resolverIdEnvio(telefone); // igual ao robô: trata o "@lid"
        registrarInbox(chave, alvo, "", "humano", texto);
        await enviar(alvo, texto);
        log(`resposta do painel enviada para ${chave}.`);
      } catch (e: any) { log("falha ao enviar resposta do painel: " + (e?.message || e)); }
    });
  }
  processandoResp = false;
}
setInterval(() => { processarRespostas().catch(() => {}); }, 1500);
setInterval(() => { try { varrerSessoes(); } catch {} }, 60 * 1000); // encerra + resume sessões paradas

// ── Avisos internos (painel → um número seu) ────────────────────────────────
//    O painel enfileira em sofia-avisos.jsonl {numero, texto, em} quando uma
//    automação de tag dispara (ex.: aluna agendou aula experimental). Aqui só
//    entregamos por WhatsApp ao número configurado — SEM registrar como conversa
//    nem assumir nada (é um recado de sistema, não um atendimento).
const AVISOS_FILE = path.join(DIR, "sofia-avisos.jsonl");
let processandoAvisos = false;
async function processarAvisos() {
  if (processandoAvisos || !pronta) return;
  let tam = 0; try { tam = fs.statSync(AVISOS_FILE).size; } catch { return; }
  if (!tam) return;
  processandoAvisos = true;
  const tmp = AVISOS_FILE + "." + Date.now() + ".proc";
  let linhas: string[] = [];
  try { fs.renameSync(AVISOS_FILE, tmp); linhas = fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch { processandoAvisos = false; return; }
  for (const l of linhas) {
    let ent: any = null; try { ent = JSON.parse(l); } catch { continue; }
    const numero = String(ent?.numero || "").replace(/\D/g, "");
    const texto = String(ent?.texto || "");
    if (!numero || !texto) continue;
    try { const alvo = await resolverIdEnvio(numero); await enviar(alvo, texto); log(`aviso enviado para ${numero}.`); }
    catch (e: any) { log(`falha ao enviar aviso para ${numero}: ${e?.message || e}`); }
  }
  processandoAvisos = false;
}
setInterval(() => { processarAvisos().catch(() => {}); }, 2000);

// ── Ponte de comando painel → Sofia ─────────────────────────────────────────
// O painel grava sofia-comando.json para pedir ações que só dá para fazer aqui.
// Hoje: "logout" (desconectar o WhatsApp da Sofia). Lemos, executamos e apagamos.
const COMANDO_FILE = path.join(DIR, "sofia-comando.json");
setInterval(async () => {
  let cmd: any = null;
  try { cmd = JSON.parse(fs.readFileSync(COMANDO_FILE, "utf8")); } catch { return; } // sem comando
  try { fs.unlinkSync(COMANDO_FILE); } catch {} // consome uma vez só
  if (!cmd || cmd.cmd !== "logout") return;
  log("🔌 comando do painel: DESCONECTAR (logout). Encerrando a sessão da Sofia…");
  setStatus("desconectado");
  try { await client.logout(); log("sessão da Sofia desvinculada (logout)."); }
  catch (e: any) { log("logout falhou (" + (e?.message || e) + ") — reinicio mesmo assim."); }
  // Sai para o PM2 reiniciar: sem a sessão salva, sobe um QR novo no painel.
  setTimeout(() => process.exit(0), 500);
}, 4000);

// ══════════════════════════════════════════════════════════════════════════
// CAMPANHAS (envio em massa por tag, pela SoFIA) — limites definidos no painel
// O painel grava pedidos em campanhas-inbox.jsonl (criar/controle/excluir) e a
// LISTA de destinatários (o painel resolve a tag → telefones). Aqui geramos as
// variações do texto (IA) e enviamos com delays aleatórios, respeitando teto/dia
// e janela de horário. O estado vai para campanhas.json (o painel só lê).
// ══════════════════════════════════════════════════════════════════════════
type CampDest = { tel: string; nome?: string };
type Campanha = {
  id: string; nome: string; tag: string; textoBase: string; variacoes: string[];
  limiteDia: number; delayMinSeg: number; delayMaxSeg: number; janelaIni: string; janelaFim: string;
  dataInicio: string; // YYYY-MM-DD (não envia antes deste dia)
  fotoArquivo?: string; // caminho da imagem a enviar junto (opcional)
  status: "gerando" | "pronta" | "enviando" | "pausada" | "concluida" | "cancelada";
  pendentes: CampDest[]; enviados: { tel: string; nome?: string; em: number }[]; falhas: { tel: string; erro: string; em: number }[];
  enviadosHoje: number; diaRef: string; proxEnvioEm: number; criadoEm: number; atualizadoEm: number;
  falhasSeguidas?: number; // falhas consecutivas — se estourar, pausa sozinha e alerta
};
const CAMP_MAX_FALHAS_SEGUIDAS = parseInt(process.env.SOFIA_CAMP_MAX_FALHAS || "5", 10);
const CAMP_FILE = path.join(DIR, "campanhas.json");
const CAMP_INBOX = path.join(DIR, "campanhas-inbox.jsonl");
let campanhas: Campanha[] = [];
let campSalvarTimer: ReturnType<typeof setTimeout> | null = null;
function carregarCampanhas() {
  try { const o = JSON.parse(fs.readFileSync(CAMP_FILE, "utf8")); if (Array.isArray(o)) campanhas = o; } catch {}
  // Retoma sozinha o que estava "enviando" antes do restart — campanhas longas
  // atravessam vários restarts (deploy, reboot, watchdog) e não podem parar sem
  // avisar. O runner só envia aos "pendentes" e os remove conforme envia (gravado
  // logo após cada envio), então o pior caso é reenviar 1 mensagem se o processo
  // cair no exato momento de um envio — risco pequeno perto de a campanha travar.
  for (const c of campanhas) {
    if (c.status === "enviando") {
      if (!c.pendentes || !c.pendentes.length) c.status = "concluida";
      else c.proxEnvioEm = 0; // libera o próximo tick (ainda respeita janela/teto/delay)
    }
  }
}
function salvarCampanhas() { try { fs.writeFileSync(CAMP_FILE, JSON.stringify(campanhas), "utf8"); } catch {} }
function agendarSalvarCampanhas() { if (campSalvarTimer) return; campSalvarTimer = setTimeout(() => { campSalvarTimer = null; salvarCampanhas(); }, 800); }
function hojeSP(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }
function agoraHHMM(): string { return new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }); }
function dentroJanela(ini: string, fim: string): boolean {
  const a = agoraHHMM();
  if (!ini || !fim) return true;
  return a >= ini && a <= fim; // janela simples no mesmo dia
}
function aleatorio(min: number, max: number) { return min + Math.floor(Math.random() * Math.max(0, max - min + 1)); }

// Consome os pedidos do painel (criar/controle/excluir).
let processandoCampInbox = false;
async function processarCampInbox() {
  if (processandoCampInbox) return;
  let tam = 0; try { tam = fs.statSync(CAMP_INBOX).size; } catch { return; }
  if (!tam) return;
  processandoCampInbox = true;
  const tmp = CAMP_INBOX + "." + Date.now() + ".proc";
  let linhas: string[] = [];
  try { fs.renameSync(CAMP_INBOX, tmp); linhas = fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch (e: any) { log("erro lendo campanhas-inbox: " + (e?.message || e)); processandoCampInbox = false; return; }
  for (const linha of linhas) {
    let op: any; try { op = JSON.parse(linha); } catch { continue; }
    try {
      if (op.op === "criar" && op.campanha) {
        const p = op.campanha;
        const dests: CampDest[] = Array.isArray(p.destinatarios) ? p.destinatarios.filter((d: any) => d && d.tel) : [];
        const camp: Campanha = {
          id: String(p.id || Date.now()), nome: String(p.nome || "Campanha"), tag: String(p.tag || ""),
          textoBase: String(p.textoBase || ""), variacoes: [],
          limiteDia: Math.max(1, parseInt(p.limiteDia, 10) || 40),
          delayMinSeg: Math.max(1, parseInt(p.delayMinSeg, 10) || 20),
          delayMaxSeg: Math.max(1, parseInt(p.delayMaxSeg, 10) || 60),
          janelaIni: String(p.janelaIni || "09:00"), janelaFim: String(p.janelaFim || "20:00"),
          dataInicio: String(p.dataInicio || hojeSP()),
          fotoArquivo: p.fotoArquivo ? String(p.fotoArquivo) : "",
          status: "gerando", pendentes: dests, enviados: [], falhas: [],
          enviadosHoje: 0, diaRef: hojeSP(), proxEnvioEm: 0, criadoEm: Date.now(), atualizadoEm: Date.now(),
        };
        if (camp.delayMaxSeg < camp.delayMinSeg) camp.delayMaxSeg = camp.delayMinSeg;
        campanhas.unshift(camp);
        agendarSalvarCampanhas();
        log(`campanha "${camp.nome}" criada (${dests.length} destinatários) — gerando variações…`);
        gerarVariacoes(camp.textoBase, 10).then((vs) => {
          camp.variacoes = vs.length ? vs : [camp.textoBase];
          camp.status = "pronta"; camp.atualizadoEm = Date.now(); agendarSalvarCampanhas();
          log(`campanha "${camp.nome}": ${camp.variacoes.length} variações prontas.`);
        }).catch(() => { camp.variacoes = [camp.textoBase]; camp.status = "pronta"; agendarSalvarCampanhas(); });
      } else if (op.op === "controle" && op.id) {
        const c = campanhas.find((x) => x.id === String(op.id));
        if (c) {
          if (op.acao === "iniciar" && (c.status === "pronta" || c.status === "pausada") && c.pendentes.length) { c.status = "enviando"; c.proxEnvioEm = 0; }
          else if (op.acao === "pausar" && c.status === "enviando") c.status = "pausada";
          else if (op.acao === "cancelar") { c.status = "cancelada"; c.pendentes = []; }
          c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
        }
      } else if (op.op === "excluir" && op.id) {
        campanhas = campanhas.filter((x) => x.id !== String(op.id)); agendarSalvarCampanhas();
      } else if (op.op === "teste" && op.telefone) {
        // Enviar teste: manda a mensagem (com foto) para um número seu, na hora.
        const texto = aplicarNome(String(op.texto || ""), op.nome || "Maria");
        if (!pronta) { log("teste de campanha ignorado — SoFIA não está conectada."); }
        else {
          try {
            const alvo = await resolverIdEnvio(String(op.telefone));
            if (op.fotoArquivo && fs.existsSync(op.fotoArquivo)) { const m = MessageMedia.fromFilePath(op.fotoArquivo); await enviar(alvo, m, { caption: texto }); }
            else await enviar(alvo, texto);
            log(`teste de campanha enviado para ${op.telefone}.`);
          } catch (e: any) { log("falha no teste de campanha: " + (e?.message || e)); }
        }
      }
    } catch (e: any) { log("erro aplicando op de campanha: " + (e?.message || e)); }
  }
  processandoCampInbox = false;
}

// Runner: manda no máximo UMA mensagem por tick, respeitando delay/teto/janela.
let campanhaEnviando = false;
async function tickCampanha() {
  if (campanhaEnviando || !pronta) return;
  const c = campanhas.find((x) => x.status === "enviando");
  if (!c) return;
  if (c.diaRef !== hojeSP()) { c.diaRef = hojeSP(); c.enviadosHoje = 0; } // vira o dia → zera o contador
  if (!c.pendentes.length) { c.status = "concluida"; c.atualizadoEm = Date.now(); agendarSalvarCampanhas(); return; }
  if (c.dataInicio && hojeSP() < c.dataInicio) return;        // ainda não chegou a data de início
  if (!dentroJanela(c.janelaIni, c.janelaFim)) return;        // fora do horário → espera
  if (c.enviadosHoje >= c.limiteDia) return;                  // bateu o teto do dia → espera amanhã
  if (Date.now() < c.proxEnvioEm) return;                     // ainda no intervalo entre envios
  const alvoDest = c.pendentes[0];
  const variacaoBase = (c.variacoes.length ? c.variacoes[(c.enviados.length) % c.variacoes.length] : c.textoBase) || c.textoBase;
  const variacao = aplicarNome(variacaoBase, alvoDest.nome); // personaliza com o 1º nome
  campanhaEnviando = true;
  try {
    const alvo = await resolverIdEnvio(alvoDest.tel);
    if (c.fotoArquivo && fs.existsSync(c.fotoArquivo)) {
      const media = MessageMedia.fromFilePath(c.fotoArquivo); // foto com a variação como legenda
      await enviar(alvo, media, { caption: variacao });
    } else {
      await enviar(alvo, variacao);
    }
    c.pendentes.shift();
    c.enviados.push({ tel: alvoDest.tel, nome: alvoDest.nome, em: Date.now() });
    c.enviadosHoje++;
    c.falhasSeguidas = 0; // deu certo → zera o contador de falhas seguidas
    registrarInbox(alvoDest.tel, alvo, alvoDest.nome || "", "sofia", (c.fotoArquivo ? "📷 " : "") + variacao); // aparece nas Conversas
    log(`campanha "${c.nome}": enviada ${c.enviados.length}/${c.enviados.length + c.pendentes.length} (${alvoDest.tel}).`);
  } catch (e: any) {
    c.pendentes.shift();
    c.falhas.push({ tel: alvoDest.tel, erro: (e?.message || String(e)).slice(0, 120), em: Date.now() });
    c.falhasSeguidas = (c.falhasSeguidas || 0) + 1;
    log(`campanha "${c.nome}": FALHA em ${alvoDest.tel} (${e?.message || e}). Seguidas: ${c.falhasSeguidas}.`);
    if (c.falhasSeguidas >= CAMP_MAX_FALHAS_SEGUIDAS) {
      c.status = "pausada"; // auto-pausa para não queimar o número
      log(`campanha "${c.nome}": PAUSADA automaticamente após ${c.falhasSeguidas} falhas seguidas.`);
      enviarNtfy("Campanha pausada", `A campanha "${c.nome}" foi pausada apos ${c.falhasSeguidas} falhas seguidas. Verifique a conexao da SoFIA e os numeros. Retome pelo painel quando estiver ok.`, "warning", "high");
    }
  } finally {
    c.proxEnvioEm = Date.now() + aleatorio(c.delayMinSeg, c.delayMaxSeg) * 1000;
    if (!c.pendentes.length) c.status = "concluida";
    c.atualizadoEm = Date.now();
    agendarSalvarCampanhas();
    campanhaEnviando = false;
  }
}
carregarCampanhas();
setInterval(() => { processarCampInbox().catch(() => {}); }, 800); // aplica pedidos do painel rápido
setInterval(() => { tickCampanha().catch(() => {}); }, 3000);

// Aluna mandou ÁUDIO (ou mídia sem legenda): a Sofia ainda não "escuta" áudio,
// então respondemos com educação pedindo por texto — em vez de ignorar e deixar
// a lead no vácuo. Respeita liga/desliga, controle humano e handoff; com anti-spam.
const ultimoAvisoAudio = new Map<string, number>();
function tratarSemTexto(msg: any) {
  const t = msg.type || "";
  const ehAudio = t === "ptt" || t === "audio";
  if (!ehAudio) return; // por ora só tratamos áudio (figurinha/imagem seguem ignoradas)
  enfileirar(async () => {
    const { chave } = await resolverTel(msg);
    registrarInbox(chave, msg.from, (msg._data && msg._data.notifyName) || "", "aluna", "🎤 (áudio)"); // aparece nas Conversas
    if (!deveResponder(chave)) return; // desligada / controle humano / handoff → não responde
    const agora = Date.now();
    if (agora - (ultimoAvisoAudio.get(chave) || 0) < 5 * 60 * 1000) return; // não repete o aviso a cada áudio
    ultimoAvisoAudio.set(chave, agora);
    const resp = "Recebi seu áudio! 😊 Por aqui eu consigo te ajudar melhor por *texto* — consegue me mandar escrito o que você precisa?";
    registrarInbox(chave, msg.from, "", "sofia", resp);
    try { await enviarHumano(msg.from, resp); } catch (e: any) { log("falha ao avisar sobre áudio: " + (e?.message || e)); }
  });
}

// ── Agrupamento de mensagens (debounce) ─────────────────────────────────────
//    A aluna às vezes manda VÁRIAS mensagens seguidas (ou responde a uma pergunta
//    antiga enquanto a SoFIA ainda estava respondendo) — aí as respostas "se
//    cruzam" e a conversa fica confusa. Para evitar, esperamos alguns segundos
//    após a ÚLTIMA mensagem e respondemos UMA vez, juntando tudo. As mensagens já
//    entram no inbox na hora (painel ao vivo). Tempo editável no painel
//    (sofia-agrupar-seg.txt); 0 = responder na hora.
const AGRUPAR_FILE = path.join(DIR, "sofia-agrupar-seg.txt");
function agruparMs(): number {
  try {
    const n = parseFloat(fs.readFileSync(AGRUPAR_FILE, "utf8").trim().replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  } catch {}
  const env = parseInt(process.env.SOFIA_AGRUPAR_MS || "", 10);
  return Number.isFinite(env) ? env : 7000; // padrão 7s
}
type Pend = { jid: string; telefone: string; textos: string[]; timer: ReturnType<typeof setTimeout> | null };
const pendencias = new Map<string, Pend>();
function agendarResposta(chave: string, jid: string, telefone: string, texto: string) {
  let p = pendencias.get(chave);
  if (!p) { p = { jid, telefone, textos: [], timer: null }; pendencias.set(chave, p); }
  p.jid = jid; p.telefone = telefone;
  p.textos.push(texto);
  const ms = agruparMs();
  if (ms <= 0) { dispararResposta(chave); return; } // desligado → responde já
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => dispararResposta(chave), ms); // reinicia a cada nova mensagem
}
function dispararResposta(chave: string) {
  const p = pendencias.get(chave);
  if (!p) return;
  pendencias.delete(chave);
  if (p.timer) clearTimeout(p.timer);
  const jid = p.jid, telefone = p.telefone;
  const textoJunto = p.textos.join("\n").trim();
  if (!textoJunto) return;
  enfileirar(async () => {
    const reply = await responderComMemoria(chave, textoJunto, telefone); // trata on/off, handoff e memória
    const urls = drenarMidias(); // imagens que a Sofia pediu nesta resposta
    if ((reply && reply.trim()) || urls.length) {
      if (reply && reply.trim()) await enviarHumano(jid, reply, chave); // registra cada parte (= WhatsApp)
      for (const url of urls) {
        try {
          await mostrarDigitando(jid);
          await sleep(900);
          const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
          await enviar(jid, media);
          registrarInbox(chave, jid, "", "sofia", "🖼️ (imagem enviada)"); // aparece no painel
        } catch (e: any) { log("falha ao enviar imagem: " + (e?.message || e)); }
      }
      await pararDigitando(jid);
    }
  });
}

// Mensagem RECEBIDA da aluna (não é fromMe).
client.on("message", (msg: any) => {
  try {
    if (!msg.from || msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return; // ignora grupos/status
    const texto = (msg.body || "").trim();
    if (!texto) { tratarSemTexto(msg); return; } // áudio/imagem sem legenda → aviso educado (a Sofia ainda não escuta áudio)
    enfileirar(async () => {
      const { chave, telefone } = await resolverTel(msg); // chave estável p/ memória + telefone real p/ agendar
      const nomeAluna = (msg._data && msg._data.notifyName) || "";
      registrarInbox(chave, msg.from, nomeAluna, "aluna", texto); // mostra no inbox NA HORA (painel ao vivo)
      try { checarGatilhosAluna(chave, nomeAluna, texto); } catch (e: any) { log("gatilhos: " + (e?.message || e)); } // automações por tag (palavra/campanha)
      agendarResposta(chave, msg.from, telefone, texto); // espera as próximas e responde juntando (debounce)
    });
  } catch (e: any) { log("erro no on(message): " + (e?.message || e)); }
});

// VOCÊ respondeu MANUALMENTE (fromMe, e não foi a própria Sofia) → assume a
// conversa: a Sofia sai dela pelos minutos configurados no painel.
client.on("message_create", (msg: any) => {
  try {
    if (!msg.fromMe) return;
    const jid = msg.to;
    if (!jid || jid.endsWith("@g.us")) return;
    if ((pendentesEco.get(jid) || 0) > 0) { decEco(jid); return; } // foi a própria Sofia (eco do envio)
    const tel = telCache.get(jid) || jidParaTel(jid); // mesma chave da memória (telefone real do "@lid")
    assumirConversa(tel);
    registrarNaMemoria(tel, "humano", msg.body || "");
    registrarInbox(tel, jid, "", "humano", msg.body || ""); // registra sua resposta no inbox
    log(`você assumiu a conversa com ${tel} — Sofia pausada nela.`);
  } catch (e: any) { log("erro no on(message_create): " + (e?.message || e)); }
});

const sair = async () => { try { await client.destroy(); } catch {} process.exit(0); };
process.on("SIGINT", sair);
process.on("SIGTERM", sair);

carregarInbox(); // recupera as conversas já registradas (o painel mostra na aba Conversas)
carregarHistorico(); // recupera o histórico de interações (aba Contatos → Interações)
setStatus("iniciando");
log("iniciando a conexão do WhatsApp da Sofia...");
armarWatchdogBoot(); // se não chegar em PRONTA a tempo, limpa cache e reinicia sozinho
client.initialize();

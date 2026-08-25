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
import { responderComMemoria, assumirConversa, registrarNaMemoria, drenarMidias } from "./sofia";

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
async function enviarHumano(to: string, texto: string) {
  const r = lerRitmo(); // fresco a cada resposta — o painel manda no ritmo
  const partes = r.humano ? dividirEmMensagens(texto) : [String(texto || "").trim()];
  for (let i = 0; i < partes.length; i++) {
    if (!partes[i]) continue;
    await mostrarDigitando(to);
    await sleep(delayDigitando(partes[i], r));
    await enviar(to, partes[i]);
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
function pareceTelefone(s: string) { return /^\d{11,15}$/.test(s); } // com DDI: 55 + DDD + número
async function resolverTel(msg: any): Promise<string> {
  const jid: string = msg.from || msg.to || "";
  const cache = telCache.get(jid);
  if (cache) return cache;
  let tel = jidParaTel(jid);
  if (jid.endsWith("@lid")) {
    const lid = tel; // o próprio ID interno — NUNCA pode ser aceito como telefone
    try {
      const c = await msg.getContact();
      // Só c.number é o telefone de verdade. NÃO usar c.id.user: para "@lid" ele é
      // o próprio ID (e teria a mesma cara de um telefone, reintroduzindo o bug).
      const num = String((c && c.number) || "").replace(/\D/g, "");
      if (pareceTelefone(num) && num !== lid) tel = num;
      else log(`aviso: contato ${jid} sem telefone visível — agendamento ficaria sem número real (avise pela Sofia).`);
    } catch (e: any) { log("aviso: getContact falhou para " + jid + " (" + (e?.message || e) + ")"); }
  }
  telCache.set(jid, tel);
  return tel;
}

// Quantas mensagens a PRÓPRIA Sofia enviou e ainda não "ecoaram" no evento
// message_create. Incrementa ANTES de enviar (sem corrida) e decrementa quando
// o eco chega. Um message_create fromMe SEM eco pendente = VOCÊ respondeu
// manualmente (handoff). À prova de corrida, ao contrário do id salvo depois.
const pendentesEco = new Map<string, number>();
function incEco(jid: string) { pendentesEco.set(jid, (pendentesEco.get(jid) || 0) + 1); }
function decEco(jid: string) { const n = (pendentesEco.get(jid) || 0) - 1; if (n > 0) pendentesEco.set(jid, n); else pendentesEco.delete(jid); }

async function enviar(to: string, conteudo: any) {
  incEco(to);
  try { return await client.sendMessage(to, conteudo); }
  catch (e) { decEco(to); throw e; } // envio falhou → não deixa o contador preso
}

client.on("qr", async (qr) => {
  // Esperando um HUMANO escanear — NÃO é travamento. Desarma o watchdog para não
  // matar o processo (e trocar o QR) no meio da leitura. Ele é re-armado quando
  // a sessão autenticar (aí sim faz sentido cobrar o "PRONTA").
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  log("QR recebido — escaneie pelo painel (aba 🤖 Sofia) ou aqui no terminal:");
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

// Serializa o processamento (uma mensagem por vez): mantém a fila de mídias
// (drenarMidias) coerente e é mais gentil com a API da Claude.
let fila: Promise<any> = Promise.resolve();
function enfileirar(fn: () => Promise<void>) { fila = fila.then(fn).catch((e: any) => log("erro na fila: " + (e?.stack || e?.message || e))); return fila; }

// Mensagem RECEBIDA da aluna (não é fromMe).
client.on("message", (msg: any) => {
  try {
    if (!msg.from || msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return; // ignora grupos/status
    const texto = (msg.body || "").trim();
    if (!texto) return; // por ora só texto (áudio/imagem da aluna não são tratados aqui)
    enfileirar(async () => {
      const tel = await resolverTel(msg); // telefone REAL (resolve o "@lid"); estável via cache
      const reply = await responderComMemoria(tel, texto); // já cuida de on/off, handoff e memória
      const urls = drenarMidias(); // imagens que a Sofia pediu nesta resposta
      if ((reply && reply.trim()) || urls.length) {
        if (reply && reply.trim()) await enviarHumano(msg.from, reply);
        for (const url of urls) {
          try {
            await mostrarDigitando(msg.from);
            await sleep(900);
            const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
            await enviar(msg.from, media);
          } catch (e: any) { log("falha ao enviar imagem: " + (e?.message || e)); }
        }
        await pararDigitando(msg.from);
      }
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
    log(`você assumiu a conversa com ${tel} — Sofia pausada nela.`);
  } catch (e: any) { log("erro no on(message_create): " + (e?.message || e)); }
});

const sair = async () => { try { await client.destroy(); } catch {} process.exit(0); };
process.on("SIGINT", sair);
process.on("SIGTERM", sair);

setStatus("iniciando");
log("iniciando a conexão do WhatsApp da Sofia...");
armarWatchdogBoot(); // se não chegar em PRONTA a tempo, limpa cache e reinicia sozinho
client.initialize();

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
// Envia como gente: "digitando…" + pausa + a mensagem, uma parte de cada vez.
async function enviarHumano(chat: any, to: string, texto: string) {
  const r = lerRitmo(); // fresco a cada resposta — o painel manda no ritmo
  const partes = r.humano ? dividirEmMensagens(texto) : [String(texto || "").trim()];
  for (let i = 0; i < partes.length; i++) {
    if (!partes[i]) continue;
    try { await chat.sendStateTyping(); } catch {}
    await sleep(delayDigitando(partes[i], r));
    await enviar(to, partes[i]);
    if (i < partes.length - 1) await sleep(400 + Math.floor(Math.random() * 500));
  }
  try { await chat.clearState(); } catch {}
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
  log("QR recebido — escaneie pelo painel (aba 🤖 Sofia) ou aqui no terminal:");
  try { qrcodeTerminal.generate(qr, { small: true }); } catch {}
  try { const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); setStatus("qr", dataUrl); }
  catch { setStatus("qr", ""); }
});
client.on("authenticated", () => { log("autenticada."); setStatus("iniciando"); });
client.on("ready", () => { log("PRONTA — respondendo as alunas."); setStatus("conectado"); });
client.on("change_state", (s: string) => log("estado: " + s));
client.on("disconnected", (m: any) => { log("desconectada: " + m); setStatus("desconectado"); });

// Serializa o processamento (uma mensagem por vez): mantém a fila de mídias
// (drenarMidias) coerente e é mais gentil com a API da Claude.
let fila: Promise<any> = Promise.resolve();
function enfileirar(fn: () => Promise<void>) { fila = fila.then(fn).catch((e: any) => log("erro na fila: " + (e?.message || e))); return fila; }

// Mensagem RECEBIDA da aluna (não é fromMe).
client.on("message", (msg: any) => {
  try {
    if (!msg.from || msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return; // ignora grupos/status
    const texto = (msg.body || "").trim();
    if (!texto) return; // por ora só texto (áudio/imagem da aluna não são tratados aqui)
    const tel = jidParaTel(msg.from);
    enfileirar(async () => {
      const reply = await responderComMemoria(tel, texto); // já cuida de on/off, handoff e memória
      const urls = drenarMidias(); // imagens que a Sofia pediu nesta resposta
      if ((reply && reply.trim()) || urls.length) {
        const chat = await msg.getChat();
        if (reply && reply.trim()) await enviarHumano(chat, msg.from, reply);
        for (const url of urls) {
          try {
            try { await chat.sendStateTyping(); } catch {}
            await sleep(900);
            const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
            await enviar(msg.from, media);
          } catch (e: any) { log("falha ao enviar imagem: " + (e?.message || e)); }
        }
        try { await chat.clearState(); } catch {}
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
    const tel = jidParaTel(jid);
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
client.initialize();

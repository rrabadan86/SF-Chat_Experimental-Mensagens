/**
 * sofia-engine.ts — MOTOR da "SoFIA das Alunas" SEM WhatsApp próprio.
 *
 * Por que existe: o número B (alunas) só aceita UM cliente whatsapp-web.js — o
 * robô (slimfit-exp). Dois clientes no mesmo número se derrubam (LOGOUT em loop).
 * Então a IA das alunas NÃO abre WhatsApp: ela roda aqui como um serviço HTTP.
 * O robô (único dono do WhatsApp do B) recebe a mensagem, pergunta a resposta a
 * este motor e envia pelo próprio cliente. Assim há UM só WhatsApp no número B.
 *
 * Reaproveita 100% do cérebro: responderComMemoria() já aplica silêncio da
 * recepção, contexto de aluna, ferramentas do EVO, memória e handoff. Grava a
 * inbox (sofia-conversas.json) no MESMO formato que o painel lê, para a aba
 * Conversas mostrar as conversas das alunas.
 *
 * Dados: usa SOFIA_DIR (ex.: /root/sofia-alunas-data). Porta: SOFIA_ENGINE_PORT.
 */
import "dotenv/config";
import http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { responderComMemoria, drenarMidias, assumirConversa, registrarNaMemoria } from "./sofia";

const BASE_DIR = process.env.SOFIA_DIR || process.cwd();
const PORT = parseInt(process.env.SOFIA_ENGINE_PORT || "8790", 10);
const HOST = process.env.SOFIA_ENGINE_HOST || "127.0.0.1"; // local: só o robô, na mesma VPS, acessa

function log(...a: any[]) { console.log(`[motor-alunas]`, ...a); }

// ── Inbox (sofia-conversas.json) — mesmo formato que o painel lê ─────────────
type InboxMsg = { autor: "aluna" | "sofia" | "humano"; texto: string; em: number; foto?: string; por?: string; tipo?: "followup" | "wpp" };
type InboxConversa = { jid: string; nome: string; ultimaEm: number; msgs: InboxMsg[] };
const CONVERSAS_FILE = path.join(BASE_DIR, "sofia-conversas.json");
const INBOX_MAX_MSGS = parseInt(process.env.SOFIA_INBOX_MSGS || "60", 10);
const inbox = new Map<string, InboxConversa>();

function carregarInbox() {
  try { const o = JSON.parse(fs.readFileSync(CONVERSAS_FILE, "utf8")); if (o && typeof o === "object") for (const k of Object.keys(o)) inbox.set(k, o[k]); } catch {}
}
let inboxTimer: ReturnType<typeof setTimeout> | null = null;
function salvarInbox() {
  const obj: Record<string, InboxConversa> = {};
  for (const [k, c] of inbox) obj[k] = c;
  // Trava anti-perda: nunca sobrescrever um arquivo populado com um objeto vazio.
  if (Object.keys(obj).length === 0) {
    try { const antes = JSON.parse(fs.readFileSync(CONVERSAS_FILE, "utf8")); if (antes && typeof antes === "object" && Object.keys(antes).length > 0) return; } catch {}
  }
  try { fs.writeFileSync(CONVERSAS_FILE, JSON.stringify(obj), "utf8"); } catch {}
}
function agendarSalvarInbox() { if (inboxTimer) return; inboxTimer = setTimeout(() => { inboxTimer = null; salvarInbox(); }, 1500); }
function registrarInbox(chave: string, jid: string, nome: string, autor: InboxMsg["autor"], texto: string, foto?: string, porNome?: string, tipo?: InboxMsg["tipo"]) {
  const t = String(texto || "").trim();
  if (!t && !foto) return;
  let c = inbox.get(chave);
  if (!c) { c = { jid: jid || "", nome: nome || "", ultimaEm: 0, msgs: [] }; inbox.set(chave, c); }
  if (jid) c.jid = jid;
  if (nome && !c.nome) c.nome = nome;
  const em = Date.now();
  const msg: InboxMsg = { autor, texto: t, em };
  if (foto) msg.foto = foto;
  if (porNome) msg.por = String(porNome);
  if (tipo) msg.tipo = tipo;
  c.msgs.push(msg);
  if (c.msgs.length > INBOX_MAX_MSGS) c.msgs.splice(0, c.msgs.length - INBOX_MAX_MSGS);
  c.ultimaEm = em;
  agendarSalvarInbox();
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function lerCorpo(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
function json(res: http.ServerResponse, code: number, obj: any) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

carregarInbox();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/status") {
      return json(res, 200, { ok: true, dir: BASE_DIR, conversas: inbox.size });
    }

    // Mensagem da ALUNA chegou (o robô encaminha) → devolve a resposta da IA.
    // Respeita silêncio da recepção/handoff: se não deve responder, resposta = "".
    if (req.method === "POST" && req.url === "/responder") {
      const d = await lerCorpo(req);
      const telefone = String(d.telefone || "").replace(/\D/g, "");
      const texto = String(d.texto || "");
      const nome = String(d.nome || "");
      const jid = String(d.jid || "");
      if (!telefone || !texto) return json(res, 400, { erro: "telefone e texto são obrigatórios" });
      registrarInbox(telefone, jid, nome, "aluna", texto);
      const resposta = await responderComMemoria(telefone, texto, telefone);
      const midias = drenarMidias();
      if (resposta && resposta.trim()) registrarInbox(telefone, jid, "", "sofia", resposta);
      return json(res, 200, { resposta: resposta || "", midias });
    }

    // A recepcionista respondeu À MÃO (pelo celular do B) → pausa a IA nessa
    // conversa (handoff) e registra a fala dela na inbox/memória. O robô chama
    // isto quando detecta uma mensagem enviada manualmente (fromMe).
    if (req.method === "POST" && req.url === "/humano") {
      const d = await lerCorpo(req);
      const telefone = String(d.telefone || "").replace(/\D/g, "");
      const texto = String(d.texto || "");
      const jid = String(d.jid || "");
      if (!telefone) return json(res, 400, { erro: "telefone é obrigatório" });
      assumirConversa(telefone);
      if (texto) { registrarNaMemoria(telefone, "humano", texto); registrarInbox(telefone, jid, "", "humano", texto, undefined, undefined, "wpp"); }
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { erro: "rota não encontrada" });
  } catch (e: any) {
    log("erro:", e?.message || e);
    return json(res, 500, { erro: String(e?.message || e) });
  }
});

server.on("error", (e: any) => { log("falha no servidor:", e?.message || e); process.exit(1); });
server.listen(PORT, HOST, () => log(`ouvindo em http://${HOST}:${PORT} · dados: ${BASE_DIR}`));

process.on("SIGINT", () => { salvarInbox(); process.exit(0); });
process.on("SIGTERM", () => { salvarInbox(); process.exit(0); });
process.on("unhandledRejection", (e: any) => log("promessa rejeitada sem tratamento —", e?.message || e));

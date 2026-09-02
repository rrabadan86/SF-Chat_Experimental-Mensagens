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
import * as crypto from "node:crypto";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { responderComMemoria, assumirConversa, registrarNaMemoria, drenarMidias, gerarVariacoes, gerarTextoCampanha, deveResponder, janelaSessaoMs, resumirConversa, gerarFollowup, classificarIntencaoTags, agendarManual } from "./sofia";

// Pasta dos arquivos da Sofia. Por padrão, a pasta de trabalho (comportamento
// atual). Se SOFIA_DIR estiver definida, usa ela — permite guardar prompt/estado
// FORA do repositório, para o "git pull" nunca sobrescrever suas edições.
const DIR = process.env.SOFIA_DIR || process.cwd();
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
  // Sem nome: remove o {nome} E a pontuação/espaço grudada nele, dos dois lados
  // ("Oi, {nome}!" → "Oi!"; "{nome}, tudo bem?" → "tudo bem?"), depois limpa
  // espaços dobrados, espaço antes de pontuação e vírgula/pontuação sobrando no início.
  return texto
    .replace(/\s*,\s*\{nome\}/gi, "")   // vírgula ANTES: "Oi, {nome}" → "Oi"
    .replace(/\{nome\}\s*,\s*/gi, "")   // vírgula DEPOIS: "{nome}, tudo" → "tudo"
    .replace(/\{nome\}/gi, "")          // qualquer resto do marcador
    .replace(/[ \t]{2,}/g, " ")         // espaços dobrados
    .replace(/[ \t]+([!?.,;:])/g, "$1") // espaço antes de pontuação
    .replace(/^[\s,;:!?.]+/, "")        // pontuação/vírgula sobrando no começo
    .trim();
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
// Solta UMA imagem (grade/preços) no WhatsApp, com o "digitando..." antes.
async function soltarImagem(to: string, imagemUrl: string, chaveRegistro?: string) {
  try {
    await mostrarDigitando(to);
    await sleep(900);
    const media = await MessageMedia.fromUrl(imagemUrl, { unsafeMime: true });
    await enviar(to, media);
    if (chaveRegistro) registrarInbox(chaveRegistro, to, "", "sofia", "🖼️ (imagem enviada)"); // aparece no painel
  } catch (e: any) { log("falha ao enviar imagem: " + (e?.message || e)); }
}

async function enviarHumano(
  to: string,
  texto: string,
  chaveRegistro?: string,
  midias?: { imagem: string; link: string }[], // imagens desta resposta (grade/preços)
) {
  const r = lerRitmo(); // fresco a cada resposta — o painel manda no ritmo
  const partes = r.humano ? dividirEmMensagens(texto) : [String(texto || "").trim()];
  const jaEnviadas = new Set<string>(); // evita mandar a MESMA parte 2x na resposta (modelo às vezes repete)
  const pend = (midias || []).filter((m) => m && m.imagem).map((m) => ({ ...m, enviada: false }));
  for (let i = 0; i < partes.length; i++) {
    if (!partes[i]) continue;
    const chaveParte = partes[i].replace(/\s+/g, " ").trim().toLowerCase();
    if (jaEnviadas.has(chaveParte)) { log("parte duplicada ignorada"); continue; }
    jaEnviadas.add(chaveParte);
    await mostrarDigitando(to);
    await sleep(delayDigitando(partes[i], r));
    await enviar(to, partes[i]);
    if (chaveRegistro) registrarInbox(chaveRegistro, to, "", "sofia", partes[i]); // painel = WhatsApp
    // Se ESTA bolha anuncia uma imagem (cita o link dela), manda a foto AGORA — logo
    // depois da bolha e ANTES da próxima (ex.: antes do convite). Não deixa pro fim.
    for (const m of pend) {
      if (!m.enviada && m.link && partes[i].includes(m.link)) {
        m.enviada = true;
        await sleep(400 + Math.floor(Math.random() * 500));
        await soltarImagem(to, m.imagem, chaveRegistro);
      }
    }
    if (i < partes.length - 1) await sleep(400 + Math.floor(Math.random() * 500));
  }
  // Imagens que o texto não anunciou (nenhuma bolha citou o link) → manda no fim.
  for (const m of pend) {
    if (!m.enviada) { m.enviada = true; await soltarImagem(to, m.imagem, chaveRegistro); }
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
// Store interno da página (nomes variam por versão — tudo best-effort). Recebe o
// JID, não a mensagem, então serve tanto para quem manda quanto para quem recebe.
async function telefoneDoLidPelaPagina(jid: string, lid: string): Promise<string> {
  try {
    const page: any = (client as any).pupPage;
    if (!page) return "";
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
  } catch {}
  return "";
}

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
  {
    const num = await telefoneDoLidPelaPagina(jid, lid);
    if (num) return num;
  }
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

// ── Blindagem LID (preparação para o WhatsApp esconder o telefone) ───────────
// APRENDE o telefone de cada LID assim que descobre e PERSISTE. Assim, se uma
// mensagem futura vier só com o LID (telefoneDoLid falhar naquela hora), a gente
// ainda reconhece o mesmo contato pelo que já aprendeu. Também conta os LIDs que
// NUNCA resolveram um telefone — é o termômetro que aparece no painel → Saúde:
// se esse número começar a subir, é sinal de que a migração está nos afetando.
const LID_MAP_FILE = path.join(DIR, "sofia-lid-map.json");     // { "<lid>": { tel, em } }
const LID_STATS_FILE = path.join(DIR, "sofia-lid-stats.json"); // { mapeados, semTel, ultimoSemTelEm, em }
const lidMap = new Map<string, string>();  // lid → telefone real aprendido
const lidSemTel = new Set<string>();       // lids vistos que nunca deram telefone
let ultimoSemTelEm = 0;
try { const o = JSON.parse(fs.readFileSync(LID_MAP_FILE, "utf8")); if (o && typeof o === "object") for (const k of Object.keys(o)) { const t = o[k] && (o[k].tel || o[k]); if (t) lidMap.set(k, String(t)); } } catch {}
try { const s = JSON.parse(fs.readFileSync(LID_STATS_FILE, "utf8")); if (s && Array.isArray(s.semTelLista)) for (const l of s.semTelLista) lidSemTel.add(String(l)); if (s && s.ultimoSemTelEm) ultimoSemTelEm = +s.ultimoSemTelEm || 0; } catch {}
let lidSalvarTimer: ReturnType<typeof setTimeout> | null = null;
function persistirLid() {
  if (lidSalvarTimer) return;
  lidSalvarTimer = setTimeout(() => {
    lidSalvarTimer = null;
    try { const m: Record<string, { tel: string; em: number }> = {}; for (const [k, v] of lidMap) m[k] = { tel: v, em: Date.now() }; fs.writeFileSync(LID_MAP_FILE, JSON.stringify(m)); } catch {}
    try { fs.writeFileSync(LID_STATS_FILE, JSON.stringify({ mapeados: lidMap.size, semTel: lidSemTel.size, ultimoSemTelEm, semTelLista: [...lidSemTel].slice(-500), em: Date.now() })); } catch {}
  }, 2000);
}
function lembrarLid(lid: string, tel: string) {
  if (!lid || !tel) return;
  const mudou = lidMap.get(lid) !== tel || lidSemTel.has(lid);
  lidMap.set(lid, tel); lidSemTel.delete(lid);
  if (mudou) { persistirLid(); fundirConversaLid(lid, tel); }
}
function telLembradoDoLid(lid: string): string { return lidMap.get(lid) || ""; }
function marcarLidSemTel(lid: string) { if (!lid || lidMap.has(lid) || lidSemTel.has(lid)) return; lidSemTel.add(lid); ultimoSemTelEm = Date.now(); persistirLid(); }

// Chave de inbox para uma mensagem que NÓS iniciamos (campanha): usa a identidade
// CANÔNICA resolvida no envio (a mesma em que a resposta da pessoa vai cair),
// não o número cru do cadastro. Sem isso, o envio caía numa conversa e a resposta
// dela em OUTRA (por causa do 9º dígito / LID), sumindo do painel.
function chaveDoEnvio(alvo: string, telCru: string): string {
  if (alvo && alvo.endsWith("@c.us")) return jidParaTel(alvo);       // telefone canônico (com o 9 certo)
  const tel = String(telCru || "").replace(/\D/g, "");
  if (alvo && alvo.endsWith("@lid")) {
    const lid = jidParaTel(alvo);
    // Numa campanha nós JÁ conhecemos o telefone real (telCru, do cadastro). Usa ele
    // como chave — em vez do LID cru — e memoriza o mapa LID→telefone, para a RESPOSTA
    // dela (que chega como "@lid") cair na MESMA conversa. Sem isso, a conversa
    // aparecia no painel como um número interno (ex.: 262091856445504).
    if (pareceTelefone(tel)) { lembrarLid(lid, tel); return tel; }
    return telLembradoDoLid(lid) || lid; // sem telefone conhecido → o que já sabíamos, senão o LID
  }
  return tel;
}

// Um LID que não resolveu o telefone AGORA pode resolver daqui a pouco (o
// contato entra na agenda, o Store carrega, chega uma mensagem com o campo "Pn").
// Por isso o cache de "não achei" vale só alguns minutos — senão a conversa
// ficava presa ao LID cru até reiniciar o processo.
const RETENTAR_LID_MS = 5 * 60 * 1000;
const ultimaTentativaLid = new Map<string, number>();
function cacheDaChave(jid: string): { chave: string; telefone: string } | null {
  if (!telCache.has(jid)) return null;
  const cached = { chave: telCache.get(jid) as string, telefone: telRealCache.get(jid) || "" };
  if (cached.telefone) return cached;                                   // já resolvido
  if (Date.now() - (ultimaTentativaLid.get(jid) || 0) < RETENTAR_LID_MS) return cached;
  return null;                                                          // passou o prazo → tenta de novo
}
function guardarChave(jid: string, chave: string, telefone: string) {
  telCache.set(jid, chave);
  telRealCache.set(jid, telefone);
  if (!telefone) ultimaTentativaLid.set(jid, Date.now()); else ultimaTentativaLid.delete(jid);
}

async function resolverTel(msg: any): Promise<{ chave: string; telefone: string }> {
  const jid: string = msg.from || msg.to || "";
  const cache = cacheDaChave(jid);
  if (cache) return cache;
  let telefone = "";
  if (jid.endsWith("@lid")) {
    const lid = jidParaTel(jid);
    telefone = await telefoneDoLid(msg, jid, lid); // "" se não achar agora
    if (telefone) lembrarLid(lid, telefone);       // aprendeu → guarda p/ sempre
    else { telefone = telLembradoDoLid(lid); if (!telefone) marcarLidSemTel(lid); } // tenta o que já sabia; senão, conta no termômetro
  } else {
    telefone = jidParaTel(jid); // @c.us: o jid já é o telefone
  }
  const chave = telefone || jidParaTel(jid); // estável: telefone real, senão o LID
  guardarChave(jid, chave, telefone);
  return { chave, telefone };
}

// Telefone de um "@lid" de DESTINO (mensagem que SAIU do nosso número). Aqui não
// dá para usar msg.getContact(): numa mensagem fromMe ele devolve o NOSSO contato,
// e aprender esse número gravaria o telefone errado no mapa de LIDs. Ordem:
// o que já aprendemos → campos "Pn" do protocolo (na saída trazem o destinatário)
// → getContactById(jid) → Store da página.
async function telefoneDoLidDestino(msg: any, jid: string, lid: string): Promise<string> {
  const ok = (n: string) => pareceTelefone(n) && n !== lid;
  const lembrado = telLembradoDoLid(lid);
  if (ok(lembrado)) return lembrado;
  try {
    const d: any = msg._data || {};
    for (const cand of [d.recipientPn, d.peerRecipientPn, d.to, d.chatId]) {
      const num = soDigitos(cand);
      if (ok(num)) { log(`@lid ${jid} → telefone ${num} (destino, msg._data)`); return num; }
    }
  } catch {}
  try {
    const c: any = await (client as any).getContactById(jid);
    const idSer: string = (c && c.id && c.id._serialized) || "";
    if (idSer.endsWith("@c.us")) {
      const num = soDigitos(c.id.user);
      if (ok(num)) { log(`@lid ${jid} → telefone ${num} (destino, getContactById.id)`); return num; }
    }
    const num2 = soDigitos(c && c.number);
    if (ok(num2)) { log(`@lid ${jid} → telefone ${num2} (destino, getContactById.number)`); return num2; }
  } catch {}
  return await telefoneDoLidPelaPagina(jid, lid);
}

// Mesma ideia do resolverTel, mas para o JID de DESTINO. Usado quando VOCÊ
// responde direto pelo celular: sem isso a conversa entrava no painel com o LID
// cru no lugar do telefone (ex.: "101047745941681").
async function resolverTelDestino(msg: any, jid: string): Promise<{ chave: string; telefone: string }> {
  const cache = cacheDaChave(jid);
  if (cache) return cache;
  let telefone = "";
  if (jid.endsWith("@lid")) {
    const lid = jidParaTel(jid);
    telefone = await telefoneDoLidDestino(msg, jid, lid);
    if (telefone) lembrarLid(lid, telefone);
    else marcarLidSemTel(lid);
  } else {
    telefone = jidParaTel(jid);
  }
  const chave = telefone || jidParaTel(jid);
  guardarChave(jid, chave, telefone);
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
// Retenção da inbox (dias): quanto tempo o painel guarda o histórico das
// conversas. Antes eram 7 dias fixos (curto demais). Agora é CONFIGURÁVEL no
// painel (SoFIA → Configuração), gravado em sofia-inbox-dias.txt e lido aqui a
// cada limpeza (muda sem reiniciar). 0 = nunca apagar. Sem arquivo → SOFIA_INBOX_DIAS
// do .env, ou 365. Lê com cache por mtime.
const INBOX_DIAS_FILE = path.join(DIR, "sofia-inbox-dias.txt");
let _retDias = -1, _retMtime = -2;
function retencaoMs(): number {
  try {
    const st = fs.statSync(INBOX_DIAS_FILE);
    if (st.mtimeMs !== _retMtime) {
      const n = parseInt(fs.readFileSync(INBOX_DIAS_FILE, "utf8").trim(), 10);
      _retDias = Number.isFinite(n) && n >= 0 ? n : parseInt(process.env.SOFIA_INBOX_DIAS || "365", 10);
      _retMtime = st.mtimeMs;
    }
  } catch {
    if (_retDias < 0) { _retDias = parseInt(process.env.SOFIA_INBOX_DIAS || "365", 10); _retMtime = -2; }
  }
  const d = Number.isFinite(_retDias) && _retDias >= 0 ? _retDias : 365;
  return d > 0 ? d * 24 * 3600 * 1000 : Number.POSITIVE_INFINITY;
}
type InboxMsg = { autor: "aluna" | "sofia" | "humano"; texto: string; em: number; foto?: string; por?: string; tipo?: "followup" | "wpp" };
type InboxConversa = { jid: string; nome: string; ultimaEm: number; msgs: InboxMsg[] };
const inbox = new Map<string, InboxConversa>();
let inboxTimer: ReturnType<typeof setTimeout> | null = null;
function carregarInbox() {
  try { const o = JSON.parse(fs.readFileSync(CONVERSAS_FILE, "utf8")); if (o && typeof o === "object") for (const k of Object.keys(o)) inbox.set(k, o[k]); } catch {}
}
function salvarInbox() {
  const corte = Date.now() - retencaoMs();
  const obj: Record<string, InboxConversa> = {};
  for (const [k, c] of inbox) { if (c.ultimaEm >= corte) obj[k] = c; else inbox.delete(k); }
  // Trava de segurança contra perda de dados: NUNCA sobrescrever um arquivo de
  // conversas populado com um vazio. Se o mapa em memória está vazio (ex.: boot
  // falhou em carregar, ou path/cwd errado) mas o arquivo em disco tem conversas,
  // NÃO grava — assim um reinício problemático não apaga o histórico do painel.
  if (Object.keys(obj).length === 0) {
    try {
      const atual = fs.readFileSync(CONVERSAS_FILE, "utf8");
      const antes = JSON.parse(atual);
      if (antes && typeof antes === "object" && Object.keys(antes).length > 0) {
        log("⚠️  salvarInbox abortado: inbox em memória vazia, mas o arquivo tem " + Object.keys(antes).length + " conversas — preservando o arquivo.");
        return;
      }
    } catch { /* arquivo inexistente/ilegível → pode gravar (nada a perder) */ }
  }
  try { fs.writeFileSync(CONVERSAS_FILE, JSON.stringify(obj), "utf8"); } catch {}
}
function agendarSalvarInbox() { if (inboxTimer) return; inboxTimer = setTimeout(() => { inboxTimer = null; salvarInbox(); }, 1500); }
function registrarInbox(chave: string, jid: string, nome: string, autor: InboxMsg["autor"], texto: string, foto?: string, porNome?: string, tipo?: InboxMsg["tipo"]) {
  const t = String(texto || "").trim();
  if (!t && !foto) return;                         // nada de texto e nada de foto → ignora
  let c = inbox.get(chave);
  if (!c) { c = { jid: jid || "", nome: nome || "", ultimaEm: 0, msgs: [] }; inbox.set(chave, c); }
  if (jid) c.jid = jid;
  if (nome && !c.nome) c.nome = nome;
  const em = Date.now();
  const msg: InboxMsg = { autor, texto: t, em };
  if (foto) msg.foto = foto;                        // nome do arquivo em humano-fotos/ (o painel serve)
  if (porNome) msg.por = String(porNome);           // atendente que escreveu (bolha "humano") — atribuição/segurança
  if (tipo) msg.tipo = tipo;                        // "followup" → o painel mostra um selo na bolha
  c.msgs.push(msg);
  if (c.msgs.length > INBOX_MAX_MSGS) c.msgs.splice(0, c.msgs.length - INBOX_MAX_MSGS);
  c.ultimaEm = em;
  agendarSalvarInbox();
  registrarSessao(chave, nome || c.nome, autor, t || "📷 (foto)", em);
}

// ── Importar histórico existente do WhatsApp para a inbox (uma vez) ──────────
// getChats() do whatsapp-web.js falha nesta versão (erro interno "r"): a
// serialização completa dos chats quebra. Alternativa: ler o Store DIRETO na
// página (pupPage.evaluate), pegando só o essencial (id, nome, última atividade
// e as mensagens já carregadas em memória) — evita a serialização pesada. É
// read-only e só roda na importação manual (não mexe no fluxo ao vivo).
const IMPORT_STATUS_FILE = path.join(DIR, "sofia-import-status.json");
let importando = false;
function gravarImportStatus(o: any) { try { fs.writeFileSync(IMPORT_STATUS_FILE, JSON.stringify(o), "utf8"); } catch {} }
type RawChat = { id: string; name: string; t: number; msgs: Array<{ fromMe: boolean; body: string; t: number }> };
async function lerChatsRaw(limMsg: number): Promise<RawChat[]> {
  const page: any = (client as any).pupPage;
  if (!page) throw new Error("página do WhatsApp indisponível (pupPage).");
  const LIM = Math.max(1, Math.min(limMsg || INBOX_MAX_MSGS, 500));
  // IMPORTANTE: passamos o código como STRING (não como função). O tsx/esbuild
  // injeta um helper "__name" nas funções nomeadas que NÃO existe no navegador
  // (ReferenceError: __name is not defined ao rodar via page.evaluate). Em string,
  // o esbuild não transforma nada, então o código roda intacto na página.
  // Nesta versão não há window.Store, mas o WhatsApp Web expõe os módulos via
  // window.require. Lemos a COLEÇÃO de conversas crua (WAWebCollections.Chat),
  // sem serialização (rápido) e sem varrer contato por contato (lento/inútil).
  // Código em STRING para o esbuild não injetar o helper __name (inexistente no
  // navegador).
  const code = "(async function(LIM){\n"
    + "  var W = window;\n"
    + "  var PAGINAS = 8;\n"                       // até 8 páginas de histórico por conversa
    + "  var fimBudget = Date.now() + 110000;\n"   // teto (~2 min) carregando — margem p/ não estourar o timeout do protocolo
    + "  function req(n){ try { return W.require ? W.require(n) : null; } catch(e){ return null; } }\n"
    + "  function nModels(c){ try { return (c && c.msgs && c.msgs.getModelsArray) ? c.msgs.getModelsArray().length : ((c&&c.msgs&&c.msgs._models&&c.msgs._models.length)||0); } catch(e){ return 0; } }\n"
    // Resolve a função que carrega mensagens antigas: nesta versão é uma função de
    // MÓDULO (loadEarlierMsgs(chat)), não um método do modelo. Tenta módulos/nomes.
    + "  function getLoader(){\n"
    + "    var mods=['WAWebChatLoadMessages','WAWebLoadEarlierMsgsAction','WAWebMsgLoad','WAWebChatLoadUtils'];\n"
    + "    var nomes=['loadEarlierMsgs','loadEarlierMessages','loadEarlier','loadMoreMsgs','loadPageMessages'];\n"
    + "    for (var i=0;i<mods.length;i++){ var m=req(mods[i]); if(!m) continue; var cand=[m, m.default]; for (var ci=0;ci<cand.length;ci++){ var o=cand[ci]; if(!o) continue; for (var j=0;j<nomes.length;j++){ if (typeof o[nomes[j]]==='function') return { fn:o[nomes[j]], via: mods[i]+'.'+nomes[j] }; } } }\n"
    + "    return null;\n"
    + "  }\n"
    + "  var loader = getLoader();\n"
    + "  async function carregarAntigas(c){\n"       // pede ao WhatsApp as mensagens antigas (várias páginas)
    + "    var chamar = loader ? function(){ return loader.fn(c); }\n"
    + "                : (typeof (c&&c.loadEarlierMsgs)==='function' ? function(){ return c.loadEarlierMsgs(); } : null);\n"
    + "    if (!chamar) return;\n"
    + "    for (var p=0;p<PAGINAS;p++){\n"
    + "      if (Date.now() >= fimBudget) break;\n"
    + "      if (nModels(c) >= LIM) break;\n"
    + "      var loaded; try { loaded = await chamar(); } catch(e){ break; }\n"
    // decide pelo VALOR DE RETORNO (como a whatsapp-web.js): lista vazia = acabou o histórico local
    + "      if (!loaded || !loaded.length) break;\n"
    + "    }\n"
    + "  }\n"
    + "  function getChatColl(){\n"
    + "    try { if (W.Store && W.Store.Chat && W.Store.Chat.getModelsArray) return W.Store.Chat; } catch(e){}\n"
    + "    var m = req('WAWebCollections');\n"
    + "    if (m){ if (m.Chat && m.Chat.getModelsArray) return m.Chat; if (m.default && m.default.Chat && m.default.Chat.getModelsArray) return m.default.Chat; }\n"
    + "    var d = req('WAWebChatCollection');\n"
    + "    if (d){ if (d.ChatCollection && d.ChatCollection.getModelsArray) return d.ChatCollection; if (d.getModelsArray) return d; if (d.default && d.default.getModelsArray) return d.default; }\n"
    + "    return null;\n"
    + "  }\n"
    + "  var Chat = getChatColl();\n"
    + "  if(!Chat){\n"
    + "    var diag={ hasStore:!!W.Store, hasRequire: (typeof W.require==='function') };\n"
    + "    try { var t1=req('WAWebCollections'); diag.collectionsKeys = t1 ? Object.keys(t1).slice(0,50) : null; } catch(e){ diag.collectionsKeys='erro'; }\n"
    + "    return { erro:'Nao achei a colecao de conversas (Chat).', diag: diag };\n"
    + "  }\n"
    + "  var arr = Chat.getModelsArray();\n"
    + "  var out=[]; var totMsgs=0;\n"
    + "  function digits(x){ return String(x||'').replace(/\\D/g,''); }\n"
    + "  function telDe(c, id){\n"
    + "    if (id.indexOf('@c.us')>=0) return id.split('@')[0];\n"
    + "    try { var ci=c.contact && c.contact.id; var cis = ci && (ci._serialized || (ci.user?ci.user+'@'+(ci.server||''):'')); if (cis && cis.indexOf('@c.us')>=0) return cis.split('@')[0]; } catch(e){}\n"
    + "    try { var pn = c.contact && (c.contact.phoneNumber || c.contact.userid || c.contact.verifiedNumber); if(pn){ var d=digits(pn); if(d.length>=10 && d.length<=15) return d; } } catch(e){}\n"
    + "    return id.split('@')[0];\n" // fallback: dígitos do LID (chave estável)
    + "  }\n"
    + "  var comTel=0, soLid=0;\n"
    + "  for (var j=0;j<arr.length;j++){\n"
    + "    try {\n"
    + "      var c=arr[j]; var idObj=c&&c.id;\n"
    + "      var id = idObj ? (idObj._serialized || (idObj.user ? idObj.user+'@'+(idObj.server||'') : '')) : '';\n"
    + "      if(!id) continue;\n"
    + "      var isUser = (id.indexOf('@c.us')>=0) || (id.indexOf('@lid')>=0);\n"
    + "      if(!isUser) continue;\n" // pula grupos (@g.us), status, etc.
    + "      var tel = telDe(c, id);\n"
    + "      if(!tel || tel.length<8) continue;\n"
    + "      if (id.indexOf('@c.us')>=0 || (tel !== id.split('@')[0])) comTel++; else soLid++;\n"
    + "      var name = (c && (c.formattedTitle || c.name || (c.contact && (c.contact.pushname||c.contact.name||c.contact.formattedName||c.contact.verifiedName)))) || '';\n"
    + "      var t = (c && (c.t||c.timestamp||0)) || 0;\n"
    + "      try { await carregarAntigas(c); } catch(e){}\n"
    + "      var models=[]; try { models = (c.msgs && c.msgs.getModelsArray) ? c.msgs.getModelsArray() : ((c.msgs&&c.msgs._models)||[]); } catch(e){ models=[]; }\n"
    + "      var msgs = models.slice(-LIM).map(function(m){ return { fromMe: !!(m&&m.id&&m.id.fromMe), body: (m&&(m.body||m.caption||''))||'', t: (m&&(m.t||m.timestamp))||0 }; });\n"
    + "      totMsgs += msgs.length;\n"
    + "      out.push({ id: tel, name: name, t: t, msgs: msgs });\n"
    + "    } catch(e){}\n"
    + "  }\n"
    + "  var tipos={}; for (var q=0;q<arr.length;q++){ try { var s=(arr[q]&&arr[q].id&&arr[q].id.server)||'?'; tipos[s]=(tipos[s]||0)+1; } catch(e){} }\n"
    + "  var loaderDiag=null;\n"
    + "  if(!loader){ loaderDiag={}; var mm2=['WAWebChatLoadMessages','WAWebLoadEarlierMsgsAction','WAWebMsgLoad','WAWebChatLoadUtils','WAWebChatMsgs']; for (var z=0;z<mm2.length;z++){ try { var mo=req(mm2[z]); loaderDiag[mm2[z]] = mo ? Object.keys(mo).slice(0,40) : null; } catch(e){ loaderDiag[mm2[z]]='erro'; } } var proto0=null; try { proto0 = arr[0] ? Object.getOwnPropertyNames(Object.getPrototypeOf(arr[0])).filter(function(n){return /load|earlier|msg/i.test(n);}).slice(0,20) : null; } catch(e){} loaderDiag._modelMethods = proto0; }\n"
    + "  return { chats: out, via:'store-raw', total: arr.length, tipos: tipos, comTel: comTel, soLid: soLid, totMsgs: totMsgs, loaderVia: (loader?loader.via:''), loaderDiag: loaderDiag };\n"
    + "})(" + LIM + ")";
  const r: any = await page.evaluate(code);
  if (r && r.via) log(`import: leitura via ${r.via} — ${(r.chats && r.chats.length) || 0} conversas de ${r.total || 0} no store (com telefone: ${r.comTel || 0}, só LID: ${r.soLid || 0}, ${r.totMsgs || 0} mensagens no total). tipos=${JSON.stringify(r.tipos || {})}`);
  if (r) log(`import: carregador de histórico = ${r.loaderVia || "(nenhum encontrado)"}${r.loaderDiag ? " · diag=" + JSON.stringify(r.loaderDiag) : ""}`);
  if (r && r.erro) throw new Error(r.erro + (r.diag ? " Diag: " + JSON.stringify(r.diag) : ""));
  return (r && r.chats) || [];
}
async function importarHistorico(porChat: number) {
  if (importando) return;
  importando = true;
  const lim = Math.max(1, Math.min(porChat || INBOX_MAX_MSGS, 500));
  try {
    if (!pronta) { gravarImportStatus({ rodando: false, erro: "O WhatsApp da SoFIA não está conectado.", em: Date.now() }); return; }
    gravarImportStatus({ rodando: true, feitos: 0, total: 0, novos: 0, em: Date.now() });
    const chats = await lerChatsRaw(lim);
    // lerChatsRaw já devolve o telefone/LID como `id` (só dígitos, sem @sufixo)
    // e já filtrou para conversas de pessoa (sem grupos). Usamos direto.
    const alvos = chats.filter((c) => c.id);
    let feitos = 0, novos = 0;
    for (const chat of alvos) {
      try {
        const tel = String(chat.id).replace(/\D/g, "");
        if (tel && tel.length >= 8) {
          const ex = inbox.get(tel);
          const acc: InboxMsg[] = ex ? ex.msgs.slice() : [];
          const seen = new Set(acc.map((m) => m.em + "|" + m.autor));
          for (const m of chat.msgs) {
            const em = m.t ? m.t * 1000 : 0;
            const texto = String(m.body || "").trim();
            if (!em || !texto) continue;
            const autor: InboxMsg["autor"] = m.fromMe ? "humano" : "aluna";
            const k = em + "|" + autor;
            if (seen.has(k)) continue;
            seen.add(k);
            acc.push({ autor, texto, em });
          }
          acc.sort((a, b) => a.em - b.em);
          const trimmed = acc.slice(-INBOX_MAX_MSGS);
          // Mesmo sem texto de mensagem, guarda a última atividade (chat.t): a
          // recepção já vê "esse contato falou antes, última vez em tal data".
          const ultima = trimmed.length ? trimmed[trimmed.length - 1].em : (chat.t ? chat.t * 1000 : 0);
          if (ultima) {
            const nomeChat = (chat.name && !/^\+?[\d ()-]+$/.test(String(chat.name))) ? String(chat.name) : "";
            inbox.set(tel, { jid: chat.id, nome: (ex && ex.nome) || nomeChat, ultimaEm: Math.max(ultima, (ex && ex.ultimaEm) || 0), msgs: trimmed });
            novos++;
          }
        }
      } catch (e: any) { log("import chat falhou: " + (e?.message || e)); }
      feitos++;
      if (feitos % 50 === 0) { gravarImportStatus({ rodando: true, feitos, total: alvos.length, novos, em: Date.now() }); salvarInbox(); }
    }
    salvarInbox();
    gravarImportStatus({ rodando: false, feitos, total: alvos.length, novos, terminadoEm: Date.now() });
    log(`✅ histórico importado: ${feitos} conversas lidas, ${novos} com dados.`);
  } catch (e: any) {
    const det = (e?.name ? e.name + ": " : "") + (e?.message || String(e));
    gravarImportStatus({ rodando: false, erro: det, em: Date.now() });
    log("import histórico falhou: " + det + (e?.stack ? "\n" + e.stack : ""));
  } finally { importando = false; }
}

// ── Histórico de INTERAÇÕES (aba Contatos → Interações do painel) ────────────
//    Permanente e separado do inbox (que guarda um período configurável). Uma "interação" é
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

// Quando descobrimos o telefone de um LID que JÁ tinha conversa/histórico salvos
// com o LID cru como chave (ex.: "101047745941681" no painel), juntamos tudo na
// conversa do TELEFONE e apagamos a órfã. Assim o painel volta a mostrar sempre
// o número — inclusive para o que ficou registrado antes de sabermos quem era.
function fundirConversaLid(lid: string, tel: string) {
  try {
    if (!lid || !tel || lid === tel) return;

    const velha = inbox.get(lid);
    if (velha) {
      const nova = inbox.get(tel);
      if (!nova) {
        inbox.set(tel, velha);
      } else {
        nova.msgs = nova.msgs.concat(velha.msgs).sort((a, b) => a.em - b.em);
        if (nova.msgs.length > INBOX_MAX_MSGS) nova.msgs.splice(0, nova.msgs.length - INBOX_MAX_MSGS);
        nova.ultimaEm = Math.max(nova.ultimaEm, velha.ultimaEm);
        if (!nova.nome && velha.nome) nova.nome = velha.nome;
        if (!nova.jid && velha.jid) nova.jid = velha.jid;
      }
      inbox.delete(lid);
      agendarSalvarInbox();
    }

    const hVelho = historico.get(lid);
    if (hVelho) {
      const hNovo = historico.get(tel);
      if (!hNovo) {
        historico.set(tel, hVelho);
      } else {
        hNovo.sessoes = hNovo.sessoes.concat(hVelho.sessoes).sort((a, b) => a.inicioEm - b.inicioEm);
        if (hNovo.sessoes.length > HIST_MAX_SESSOES) hNovo.sessoes.splice(0, hNovo.sessoes.length - HIST_MAX_SESSOES);
        if (!hNovo.nome && hVelho.nome) hNovo.nome = hVelho.nome;
      }
      historico.delete(lid);
      agendarSalvarHistorico();
    }

    if (velha || hVelho) log(`conversa do LID ${lid} unida ao telefone ${tel} — o painel passa a mostrar o número.`);
  } catch (e: any) { log("aviso: não consegui unir a conversa do LID " + lid + ": " + (e?.message || e)); }
}

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

// Encerramento MANUAL de conversa (painel → sofia-encerradas.json). Além de
// resetar a memória da Sofia (feito no sofia.ts), fechamos aqui a interação em
// aberto para ela ganhar o resumo e disparar o gatilho 'encerrou' na hora, sem
// esperar o tempo da sessão. Lido com cache por mtime.
const ENCERRADAS_FILE = path.join(DIR, "sofia-encerradas.json");
let _encMtime = -1;
let _encMap: Record<string, number> = {};
function lerEncerradas(): Record<string, number> {
  try {
    const st = fs.statSync(ENCERRADAS_FILE);
    if (st.mtimeMs !== _encMtime) {
      _encMtime = st.mtimeMs;
      const o = JSON.parse(fs.readFileSync(ENCERRADAS_FILE, "utf8"));
      _encMap = (o && typeof o === "object") ? o : {};
    }
  } catch { _encMtime = -1; _encMap = {}; }
  return _encMap;
}

// Fecha sessões paradas há mais que a janela (assim a interação encerra e ganha
// resumo mesmo que a aluna nunca mais escreva) OU encerradas à mão pelo painel.
// Roda de tempos em tempos.
function varrerSessoes() {
  const janela = janelaSessaoMs();
  const agora = Date.now();
  const enc = lerEncerradas();
  for (const [chave, h] of historico) {
    const ult = h.sessoes[h.sessoes.length - 1];
    if (!ult || ult.status !== "ativa") continue;
    const d = String(chave).replace(/\D/g, "");
    const fechadaManual = Number(enc[chave] || (d && enc[d]) || 0) >= ult.fimEm;
    if (fechadaManual || agora - ult.fimEm > janela) void fecharSessao(chave, ult);
  }
}

// ── Automação por tag (gatilhos detectados aqui: novo/palavra/campanha/encerrou) ──
//    O painel publica as regras em sofia-regras.json; nós detectamos os eventos
//    e devolvemos as AÇÕES em sofia-eventos.jsonl (o painel aplica a tag + avisa).
const REGRAS_FILE = path.join(DIR, "sofia-regras.json");
const EVENTOS_FILE = path.join(DIR, "sofia-eventos.jsonl");
type RegraTag = { tag: string; avisarWpp?: string; palavras?: string[]; instrucao?: string; campanhaId?: string };
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
// ── Lista de bloqueio (Sofia ignora, como o "Bloquear" do WhatsApp) ──────────
//    Array de telefones (só dígitos) em sofia-bloqueios.json. O painel escreve;
//    lemos aqui a cada mensagem (cache por mtime).
const BLOQUEIOS_FILE = path.join(DIR, "sofia-bloqueios.json");
let bloqueios = new Set<string>();
let bloqueiosMtime = -1;
function lerBloqueios(): Set<string> {
  try {
    const st = fs.statSync(BLOQUEIOS_FILE);
    if (st.mtimeMs !== bloqueiosMtime) {
      const arr = JSON.parse(fs.readFileSync(BLOQUEIOS_FILE, "utf8"));
      bloqueios = new Set((Array.isArray(arr) ? arr : []).map((x: any) => String(x).replace(/\D/g, "")).filter(Boolean));
      bloqueiosMtime = st.mtimeMs;
    }
  } catch { bloqueios = new Set(); bloqueiosMtime = -1; }
  return bloqueios;
}
function estaBloqueado(...tels: string[]): boolean {
  const set = lerBloqueios();
  if (!set.size) return false;
  return tels.some((t) => { const d = String(t || "").replace(/\D/g, ""); return !!d && set.has(d); });
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
// Só CONSULTA (não marca) — usado para não pagar a chamada de IA quando a tag já
// disparou nesta sessão. O jaDisparou "de verdade" roda na hora de emitir a ação.
function jaDisparouReadOnly(chave: string, motivo: string, tag: string): boolean {
  return Date.now() < (gatilhoRecente.get(chave + "|" + motivo + "|" + tag) || 0);
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
  // intenção por IA: a SoFIA lê a conversa e decide pela intenção descrita.
  // Só as regras ainda não disparadas nesta sessão entram (economiza chamada).
  const iaRegras = (rs.ia || []).filter((r) => r.instrucao && !jaDisparouReadOnly(chave, "ia", r.tag));
  if (iaRegras.length) {
    const c = inbox.get(chave);
    const linhas = c ? c.msgs.slice(-14).map((m) => ({ autor: m.autor, texto: m.texto })) : [{ autor: "aluna", texto }];
    // Assíncrono (fire-and-forget): não segura a resposta da SoFIA.
    classificarIntencaoTags(linhas, iaRegras.map((r) => ({ tag: r.tag, instrucao: r.instrucao! })))
      .then((tags) => {
        for (const r of iaRegras) {
          if (tags.includes(r.tag) && !jaDisparou(chave, "ia", r.tag)) emitirAcao(chave, nome, r, "ia");
        }
      })
      .catch((e: any) => log("ia-tag: " + (e?.message || e)));
  }
  // respondeu campanha: a aluna está na lista de ENVIADOS de uma campanha?
  // Cada regra pode estar AMARRADA a uma campanha (r.campanhaId): aí só dispara se
  // a aluna recebeu AQUELA campanha. Sem id (regra antiga) = qualquer campanha.
  const camps = (rs.campanha || []);
  if (camps.length) {
    const alvo8 = soDigitos(chave).slice(-8);
    if (alvo8.length === 8) {
      const recebeuDe = (c: Campanha) => (c.enviados || []).some((e: any) => soDigitos(e.tel).slice(-8) === alvo8);
      for (const r of camps) {
        const recebeu = r.campanhaId
          ? campanhas.some((c) => String(c.id) === String(r.campanhaId) && recebeuDe(c))
          : campanhas.some(recebeuDe);
        if (recebeu && !jaDisparou(chave, "campanha", r.tag)) emitirAcao(chave, nome, r, "campanha");
      }
    }
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
    const fotoArquivo = String(ent?.fotoArquivo || "").trim();
    if (!texto && !fotoArquivo) continue;           // sem texto e sem foto → nada a enviar
    const chave = String(ent?.chave || "").trim();
    const jid = String(ent?.jid || "").trim();
    const porNome = String(ent?.porNome || "").trim();     // atendente do painel que escreveu
    // Telefone REAL para enviar: a chave (telefone real, mesmo em contato "@lid").
    // Só usa os dígitos do jid quando ele é "@c.us" (aí o jid já é o telefone).
    const telefone = pareceTelefone(chave) ? chave : (jid.endsWith("@c.us") ? jidParaTel(jid) : "");
    if (!pareceTelefone(telefone)) { log(`resposta do painel sem telefone válido (chave=${chave}) — ignorada.`); continue; }
    enfileirar(async () => {
      // NÃO usamos a pausa por tempo aqui: quem controla é o interruptor "controle
      // humano" da conversa (o painel liga/desliga em sofia-humano.json). Assim,
      // ao devolver à Sofia (desligar o interruptor), ela volta na hora.
      const memo = fotoArquivo ? (texto ? texto + " [foto]" : "[foto]") : texto;
      registrarNaMemoria(chave, "humano", memo); // Sofia "ouve" para ter contexto quando voltar
      try {
        const alvo = await resolverIdEnvio(telefone); // igual ao robô: trata o "@lid"
        if (fotoArquivo && fs.existsSync(fotoArquivo)) {
          // Foto (com o texto como legenda, se houver). O arquivo é MANTIDO em
          // humano-fotos/ para o painel exibir a imagem na bolha (limpo depois por
          // idade — ver limparFotosAntigas). Registra no painel = WhatsApp.
          const media = MessageMedia.fromFilePath(fotoArquivo);
          await enviar(alvo, media, texto ? { caption: texto } : undefined);
          registrarInbox(chave, alvo, "", "humano", texto, path.basename(fotoArquivo), porNome);
        } else {
          registrarInbox(chave, alvo, "", "humano", texto, undefined, porNome);
          await enviar(alvo, texto);
        }
        log(`resposta do painel enviada para ${chave}.`);
      } catch (e: any) { log("falha ao enviar resposta do painel: " + (e?.message || e)); }
    });
  }
  processandoResp = false;
}
setInterval(() => { processarRespostas().catch(() => {}); }, 1500);

// ── Agendamento MANUAL pelo painel (atendente) ──────────────────────────────
// O painel enfileira pedidos em sofia-agendar-inbox.jsonl; aqui agendamos no EVO
// (mesma rota da SoFIA) e gravamos o resultado por id em sofia-agendar-result.json,
// que o painel consulta. Registra também um marcador na conversa.
const AGENDAR_INBOX = path.join(DIR, "sofia-agendar-inbox.jsonl");
const AGENDAR_RESULT = path.join(DIR, "sofia-agendar-result.json");
let processandoAgendar = false;
function lerAgendarResult(): Record<string, any> { try { const o = JSON.parse(fs.readFileSync(AGENDAR_RESULT, "utf8")); return (o && typeof o === "object") ? o : {}; } catch { return {}; } }
function gravarAgendarResult(mapa: Record<string, any>) {
  // Mantém só os ~200 mais recentes para o arquivo não crescer.
  const ids = Object.keys(mapa).sort((a, b) => (mapa[a]?.em || 0) - (mapa[b]?.em || 0));
  while (ids.length > 200) { delete mapa[ids.shift() as string]; }
  try { fs.writeFileSync(AGENDAR_RESULT, JSON.stringify(mapa), "utf8"); } catch {}
}
async function processarAgendarInbox() {
  if (processandoAgendar) return;
  let tam = 0; try { tam = fs.statSync(AGENDAR_INBOX).size; } catch { return; }
  if (!tam) return;
  processandoAgendar = true;
  const tmp = AGENDAR_INBOX + "." + Date.now() + ".proc";
  let linhas: string[] = [];
  try { fs.renameSync(AGENDAR_INBOX, tmp); linhas = fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch (e: any) { log("erro lendo agendar-inbox: " + (e?.message || e)); processandoAgendar = false; return; }
  const mapa = lerAgendarResult();
  for (const linha of linhas) {
    let op: any; try { op = JSON.parse(linha); } catch { continue; }
    const id = String(op?.id || "");
    const chave = String(op?.chave || "");
    const telefone = String(op?.telefone || chave).replace(/\D/g, "");
    if (!id) continue;
    try {
      const r: any = await agendarManual(telefone, String(op?.nome || ""), String(op?.email || ""), String(op?.when || ""));
      mapa[id] = { ...r, em: Date.now() };
      if (r && r.ok) {
        const por = String(op?.por || "").trim();
        registrarInbox(chave || telefone, telefone, "", "humano", "📅 Aula experimental agendada no EVO — " + String(r.when || op?.when || ""), undefined, por);
        log(`agendamento manual OK (${por || "painel"}): ${op?.nome} em ${r.when}`);
      } else {
        log(`agendamento manual falhou: ${JSON.stringify(r).slice(0, 160)}`);
      }
    } catch (e: any) {
      mapa[id] = { erro: true, detalhe: e?.message || String(e), em: Date.now() };
      log("agendamento manual erro: " + (e?.message || e));
    }
  }
  gravarAgendarResult(mapa);
  processandoAgendar = false;
}
setInterval(() => { processarAgendarInbox().catch(() => {}); }, 1200);

setInterval(() => { try { varrerSessoes(); } catch {} }, 60 * 1000); // encerra + resume sessões paradas

// Fotos que você anexou nas respostas ficam em humano-fotos/ para o painel exibir
// na bolha. O inbox só guarda ~7 dias, então apagamos as fotos mais antigas que a
// retenção do inbox para o diretório não crescer sem fim. Best-effort.
const HUMANO_FOTOS_DIR = path.join(DIR, "humano-fotos");
function limparFotosAntigas() {
  try {
    if (!fs.existsSync(HUMANO_FOTOS_DIR)) return;
    const corte = Date.now() - retencaoMs() - 24 * 3600 * 1000; // 1 dia de folga
    for (const nome of fs.readdirSync(HUMANO_FOTOS_DIR)) {
      const p = path.join(HUMANO_FOTOS_DIR, nome);
      try { if (fs.statSync(p).mtimeMs < corte) fs.rmSync(p, { force: true }); } catch {}
    }
  } catch {}
}
setInterval(limparFotosAntigas, 6 * 3600 * 1000); // a cada 6 h
setTimeout(limparFotosAntigas, 30000);            // uma vez no boot

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

// ── Follow-up: o painel decide QUEM precisa (esfriou sem agendar) e enfileira
//    {tel, instrucao} em sofia-followup.jsonl; aqui a Sofia GERA a mensagem com IA
//    (usando as últimas mensagens da conversa) e ENVIA. Uma por pedido.
const FOLLOWUP_FILE = path.join(DIR, "sofia-followup.jsonl");
let processandoFollowup = false;
async function processarFollowups() {
  if (processandoFollowup || !pronta) return;
  let tam = 0; try { tam = fs.statSync(FOLLOWUP_FILE).size; } catch { return; }
  if (!tam) return;
  processandoFollowup = true;
  const tmp = FOLLOWUP_FILE + "." + Date.now() + ".proc";
  let linhas: string[] = [];
  try { fs.renameSync(FOLLOWUP_FILE, tmp); linhas = fs.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean); fs.rmSync(tmp, { force: true }); }
  catch { processandoFollowup = false; return; }
  for (const l of linhas) {
    let ent: any = null; try { ent = JSON.parse(l); } catch { continue; }
    const tel = String(ent?.tel || "").trim();
    if (!tel) continue;
    // Trava de segurança: nunca faz follow-up de bloqueado nem de quem está sob
    // controle humano (o painel já filtra, mas conferimos de novo aqui).
    if (estaBloqueado(tel)) { log(`follow-up de bloqueado (${tel}) — ignorado.`); continue; }
    // Respeita o "Pausar SoFIA" (estado global), o controle humano e o handoff
    // (você respondeu pelo celular): nada de follow-up automático nesses casos.
    if (!deveResponder(tel)) { log(`follow-up de ${tel} pulado — SoFIA pausada/controle humano/handoff.`); continue; }
    enfileirar(async () => {
      try {
        // Contexto: as últimas mensagens dessa conversa no inbox.
        const c = inbox.get(tel);
        const linhasConv = c ? c.msgs.slice(-14).map((m) => ({ autor: m.autor, texto: m.texto })) : [];
        const msg = (await gerarFollowup(linhasConv, String(ent?.instrucao || ""))).trim();
        if (!msg) { log(`follow-up de ${tel}: IA não gerou mensagem — pulado.`); return; }
        const alvo = await resolverIdEnvio(tel);
        registrarNaMemoria(tel, "sofia", msg);
        registrarInbox(tel, alvo, "", "sofia", msg, undefined, undefined, "followup");
        await enviar(alvo, msg);
        log(`follow-up enviado para ${tel}.`);
      } catch (e: any) { log(`falha no follow-up de ${tel}: ${e?.message || e}`); }
    });
  }
  processandoFollowup = false;
}
setInterval(() => { processarFollowups().catch(() => {}); }, 3000);

// ── Ponte de comando painel → Sofia ─────────────────────────────────────────
// O painel grava sofia-comando.json para pedir ações que só dá para fazer aqui.
// Hoje: "logout" (desconectar o WhatsApp da Sofia). Lemos, executamos e apagamos.
const COMANDO_FILE = path.join(DIR, "sofia-comando.json");
setInterval(async () => {
  let cmd: any = null;
  try { cmd = JSON.parse(fs.readFileSync(COMANDO_FILE, "utf8")); } catch { return; } // sem comando
  try { fs.unlinkSync(COMANDO_FILE); } catch {} // consome uma vez só
  if (cmd && cmd.cmd === "importar-historico") {
    log("📥 comando do painel: importar histórico do WhatsApp…");
    importarHistorico(parseInt(cmd.porChat, 10) || INBOX_MAX_MSGS); // async, não bloqueia
    return;
  }
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
  dias?: number[]; // dias da semana permitidos (0=Dom … 6=Sáb); vazio/ausente = todos
  fotoArquivo?: string; // caminho da imagem a enviar junto (opcional)
  status: "gerando" | "pronta" | "enviando" | "pausada" | "concluida" | "cancelada";
  pendentes: CampDest[]; enviados: { tel: string; nome?: string; em: number }[]; falhas: { tel: string; erro: string; em: number }[];
  enviadosHoje: number; diaRef: string; proxEnvioEm: number; criadoEm: number; atualizadoEm: number;
  falhasSeguidas?: number; // falhas consecutivas — se estourar, pausa sozinha e alerta
  rajadaRestante?: number; // "enviar agora": nº de envios a disparar JÁ, ignorando teto/janela (mantém o espaçamento)
};
const CAMP_MAX_FALHAS_SEGUIDAS = parseInt(process.env.SOFIA_CAMP_MAX_FALHAS || "5", 10);
const CAMP_FILE = path.join(DIR, "campanhas.json");
const CAMP_INBOX = path.join(DIR, "campanhas-inbox.jsonl");
// Rascunhos de campanha gerados a partir de uma instrução (painel → SoFIA). Mapa
// { <id>: { texto, em } }; o painel escreve o pedido no inbox e lê o resultado
// daqui. Guardamos só os mais recentes para não crescer sem fim.
const CAMP_RASCUNHOS = path.join(DIR, "campanha-rascunhos.json");
type RascunhoVal = { em: number; texto?: string; variacoes?: string[] };
function escreverRascunho(id: string, payload: { texto?: string; variacoes?: string[] }) {
  let m: Record<string, RascunhoVal> = {};
  try { const o = JSON.parse(fs.readFileSync(CAMP_RASCUNHOS, "utf8")); if (o && typeof o === "object") m = o; } catch {}
  m[id] = { ...payload, em: Date.now() };
  const recentes = Object.keys(m).sort((a, b) => (m[b].em - m[a].em)).slice(0, 20);
  const novo: Record<string, RascunhoVal> = {};
  for (const k of recentes) novo[k] = m[k];
  try { fs.writeFileSync(CAMP_RASCUNHOS, JSON.stringify(novo), "utf8"); } catch {}
}
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
// Dia da semana atual no fuso de São Paulo (0=Dom … 6=Sáb).
function diaSemanaSP(): number {
  const wd = new Date().toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return wd in map ? map[wd] : new Date().getDay();
}
// A campanha pode enviar HOJE? (vazio/ausente/7 dias = todos os dias)
function diaPermitido(c: Campanha): boolean {
  const d = c.dias;
  if (!d || !d.length || d.length >= 7) return true;
  return d.indexOf(diaSemanaSP()) >= 0;
}
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
        // Variações já revisadas/editadas no painel? Usa elas e já fica "pronta".
        // Senão, cria como "gerando" e a IA gera as variações aqui (comportamento antigo).
        const preVars: string[] = Array.isArray(p.variacoes) ? p.variacoes.map((s: any) => String(s || "").trim()).filter(Boolean) : [];
        const camp: Campanha = {
          id: String(p.id || Date.now()), nome: String(p.nome || "Campanha"), tag: String(p.tag || ""),
          textoBase: String(p.textoBase || ""), variacoes: preVars,
          limiteDia: Math.max(1, parseInt(p.limiteDia, 10) || 40),
          delayMinSeg: Math.max(1, parseInt(p.delayMinSeg, 10) || 50),
          delayMaxSeg: Math.max(1, parseInt(p.delayMaxSeg, 10) || 120),
          janelaIni: String(p.janelaIni || "09:00"), janelaFim: String(p.janelaFim || "20:00"),
          dataInicio: String(p.dataInicio || hojeSP()),
          dias: Array.isArray(p.dias) ? p.dias.map((x: any) => Number(x)).filter((x: number) => x >= 0 && x <= 6) : [],
          fotoArquivo: p.fotoArquivo ? String(p.fotoArquivo) : "",
          status: preVars.length ? "pronta" : "gerando", pendentes: dests, enviados: [], falhas: [],
          enviadosHoje: 0, diaRef: hojeSP(), proxEnvioEm: 0, criadoEm: Date.now(), atualizadoEm: Date.now(),
        };
        if (camp.delayMaxSeg < camp.delayMinSeg) camp.delayMaxSeg = camp.delayMinSeg;
        campanhas.unshift(camp);
        agendarSalvarCampanhas();
        if (preVars.length) {
          log(`campanha "${camp.nome}" criada com ${preVars.length} variações do painel (pronta).`);
        } else {
          log(`campanha "${camp.nome}" criada (${dests.length} destinatários) — gerando variações…`);
          gerarVariacoes(camp.textoBase, 10).then((vs) => {
            camp.variacoes = vs.length ? vs : [camp.textoBase];
            camp.status = "pronta"; camp.atualizadoEm = Date.now(); agendarSalvarCampanhas();
            log(`campanha "${camp.nome}": ${camp.variacoes.length} variações prontas.`);
          }).catch(() => { camp.variacoes = [camp.textoBase]; camp.status = "pronta"; agendarSalvarCampanhas(); });
        }
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
      } else if (op.op === "remover-fila" && op.id && op.tel) {
        // Remove UM número da fila (pendentes): não vai receber a campanha.
        const c = campanhas.find((x) => x.id === String(op.id));
        if (c) {
          const alvo8 = soDigitos(op.tel).slice(-8);
          const antes = (c.pendentes || []).length;
          c.pendentes = (c.pendentes || []).filter((d: any) => soDigitos(d.tel).slice(-8) !== alvo8);
          if (c.pendentes.length !== antes) {
            if (!c.pendentes.length && c.status === "enviando") c.status = "concluida";
            c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
            log(`campanha "${c.nome}": ${op.tel} removido da fila (manual).`);
          }
        }
      } else if (op.op === "ritmo" && op.id) {
        // Ajusta o ritmo/limites de uma campanha JÁ criada (delay, teto/dia, janela).
        const c = campanhas.find((x) => x.id === String(op.id));
        if (c) {
          const iMin = parseInt(String(op.delayMinSeg), 10); if (Number.isFinite(iMin) && iMin > 0) c.delayMinSeg = Math.min(3600, iMin);
          const iMax = parseInt(String(op.delayMaxSeg), 10); if (Number.isFinite(iMax) && iMax > 0) c.delayMaxSeg = Math.min(3600, Math.max(c.delayMinSeg, iMax));
          const iLim = parseInt(String(op.limiteDia), 10); if (Number.isFinite(iLim) && iLim > 0) c.limiteDia = Math.min(1000, iLim);
          if (op.janelaIni && /^\d{2}:\d{2}$/.test(String(op.janelaIni))) c.janelaIni = String(op.janelaIni);
          if (op.janelaFim && /^\d{2}:\d{2}$/.test(String(op.janelaFim))) c.janelaFim = String(op.janelaFim);
          c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
          log(`campanha "${c.nome}": ritmo atualizado — ${c.delayMinSeg}-${c.delayMaxSeg}s, teto ${c.limiteDia}/dia, janela ${c.janelaIni}-${c.janelaFim}.`);
        }
      } else if (op.op === "rajada" && op.id) {
        // "Enviar agora": dispara N mensagens JÁ, ignorando o teto diário e a janela
        // de horário — mas mantém o espaçamento (delay) para não queimar o número.
        const c = campanhas.find((x) => x.id === String(op.id));
        const n = Math.max(1, Math.min(1000, parseInt(String(op.n), 10) || 0));
        if (c && n && (c.pendentes || []).length) {
          c.rajadaRestante = (c.rajadaRestante || 0) + n;
          if (c.status === "pronta" || c.status === "pausada" || c.status === "concluida") c.status = "enviando";
          c.proxEnvioEm = 0; // libera o primeiro envio na hora
          c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
          log(`campanha "${c.nome}": ENVIAR AGORA +${n} (rajada total ${c.rajadaRestante}) — ignora teto/janela, mantém o espaçamento.`);
        }
      } else if (op.op === "reenviar" && op.id && op.tel) {
        // Reenvio manual de UM número que falhou: tira das falhas e volta pra fila.
        const c = campanhas.find((x) => x.id === String(op.id));
        if (c) {
          const alvo8 = soDigitos(op.tel).slice(-8);
          const idx = (c.falhas || []).findIndex((f: any) => soDigitos(f.tel).slice(-8) === alvo8);
          if (idx >= 0) {
            const f: any = c.falhas.splice(idx, 1)[0];
            c.pendentes.push({ tel: f.tel, nome: f.nome || "" });
            if (c.status === "concluida" || c.status === "cancelada") c.status = "pausada"; // volta a poder iniciar
            c.falhasSeguidas = 0; c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
            log(`campanha "${c.nome}": reenfileirado ${f.tel} (reenvio manual).`);
          }
        }
      } else if (op.op === "editar-variacao" && op.id) {
        // Editar UMA variação de uma campanha (o painel edita inline).
        const c = campanhas.find((x) => x.id === String(op.id));
        const idx = Number(op.index);
        const txt = String(op.texto || "").trim();
        if (c && Array.isArray(c.variacoes) && Number.isInteger(idx) && idx >= 0 && idx < c.variacoes.length && txt) {
          c.variacoes[idx] = txt; c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
          log(`campanha "${c.nome}": variação #${idx + 1} editada.`);
        }
      } else if (op.op === "excluir-variacao" && op.id) {
        // Excluir UMA variação; nunca deixa a campanha sem nenhuma.
        const c = campanhas.find((x) => x.id === String(op.id));
        const idx = Number(op.index);
        if (c && Array.isArray(c.variacoes) && Number.isInteger(idx) && idx >= 0 && idx < c.variacoes.length && c.variacoes.length > 1) {
          c.variacoes.splice(idx, 1); c.atualizadoEm = Date.now(); agendarSalvarCampanhas();
          log(`campanha "${c.nome}": variação #${idx + 1} excluída (restam ${c.variacoes.length}).`);
        }
      } else if (op.op === "rascunho" && op.id) {
        // Escrever uma frase de campanha a partir da instrução do painel. O painel
        // faz poll do resultado (campanha-rascunhos.json) até ficar pronto.
        const instrucao = String(op.instrucao || "");
        const modeloFrase = String(op.model || "");
        log(`gerando frase de campanha (rascunho ${op.id})${modeloFrase ? ` [${modeloFrase}]` : ""}…`);
        gerarTextoCampanha(instrucao, modeloFrase)
          .then((t) => { escreverRascunho(String(op.id), { texto: t || "" }); log(`rascunho ${op.id} pronto (${(t || "").length} caracteres).`); })
          .catch((e: any) => { escreverRascunho(String(op.id), { texto: "" }); log(`rascunho ${op.id} falhou: ${e?.message || e}`); });
      } else if (op.op === "variacoes" && op.id) {
        // Gerar as ~10 variações da mensagem base para o painel ver/editar ANTES
        // de criar a campanha. O painel faz poll do mesmo campanha-rascunhos.json.
        const texto = String(op.texto || "");
        log(`gerando variações de campanha (${op.id})…`);
        gerarVariacoes(texto, 10)
          .then((vs) => { escreverRascunho(String(op.id), { variacoes: Array.isArray(vs) ? vs : [] }); log(`variações ${op.id}: ${(vs || []).length}.`); })
          .catch((e: any) => { escreverRascunho(String(op.id), { variacoes: [] }); log(`variações ${op.id} falhou: ${e?.message || e}`); });
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
  const emRajada = (c.rajadaRestante || 0) > 0;               // "enviar agora": ignora data/dia/janela/teto
  if (c.dataInicio && hojeSP() < c.dataInicio && !emRajada) return; // ainda não chegou a data de início
  if (!diaPermitido(c) && !emRajada) return;                  // dia da semana não marcado → espera
  if (!dentroJanela(c.janelaIni, c.janelaFim) && !emRajada) return; // fora do horário → espera
  if (c.enviadosHoje >= c.limiteDia && !emRajada) return;     // bateu o teto do dia → espera amanhã
  if (Date.now() < c.proxEnvioEm) return;                     // espaçamento entre envios — SEMPRE respeitado (segurança do número)
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
    registrarInbox(chaveDoEnvio(alvo, alvoDest.tel), alvo, alvoDest.nome || "", "sofia", (c.fotoArquivo ? "📷 " : "") + variacao); // chave canônica → cai na MESMA conversa da resposta dela
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
    if (c.rajadaRestante && c.rajadaRestante > 0) c.rajadaRestante--; // consumiu um envio da rajada "enviar agora"
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
// Aviso educado quando NÃO dá para "ouvir" o áudio (transcrição desligada ou falhou).
async function avisarAudioPorTexto(msg: any) {
  const { chave } = await resolverTel(msg);
  registrarInbox(chave, msg.from, (msg._data && msg._data.notifyName) || "", "aluna", "🎤 (áudio)"); // aparece nas Conversas
  if (!deveResponder(chave)) return; // desligada / controle humano / handoff → não responde
  const agora = Date.now();
  if (agora - (ultimoAvisoAudio.get(chave) || 0) < 5 * 60 * 1000) return; // não repete o aviso a cada áudio
  ultimoAvisoAudio.set(chave, agora);
  const resp = "Recebi seu áudio! 😊 Por aqui eu consigo te ajudar melhor por *texto* — consegue me mandar escrito o que você precisa?";
  registrarInbox(chave, msg.from, "", "sofia", resp);
  try { await enviarHumano(msg.from, resp); } catch (e: any) { log("falha ao avisar sobre áudio: " + (e?.message || e)); }
}
function tratarSemTexto(msg: any) {
  const t = msg.type || "";
  if (t !== "ptt" && t !== "audio") return; // por ora só tratamos áudio (figurinha/imagem seguem ignoradas)
  enfileirar(() => avisarAudioPorTexto(msg));
}

// ── Transcrição de áudio (opt-in) ────────────────────────────────────────────
//    O Claude não "ouve" áudio, então usamos um serviço de fala→texto (Whisper).
//    LIGA sozinho quando TRANSCRICAO_API_KEY existe no .env. Compatível com
//    OpenAI (padrão) e Groq (basta trocar TRANSCRICAO_URL). Se não houver chave
//    ou a transcrição falhar, cai no aviso educado pedindo texto.
const TRANSCRICAO_KEY = process.env.TRANSCRICAO_API_KEY || "";
const TRANSCRICAO_URL = process.env.TRANSCRICAO_URL || "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRICAO_MODELO = process.env.TRANSCRICAO_MODELO || "whisper-1";
// Liga/desliga pelo painel (sofia-transcricao.txt): 'off' desliga mesmo com chave.
const TRANSCRICAO_FILE = path.join(DIR, "sofia-transcricao.txt");
function transcricaoLigadaNoPainel(): boolean {
  try { return fs.readFileSync(TRANSCRICAO_FILE, "utf-8").trim().toLowerCase() !== "off"; }
  catch { return true; } // sem arquivo = ligado (padrão)
}
function transcricaoAtiva(): boolean { return !!TRANSCRICAO_KEY && transcricaoLigadaNoPainel(); }
async function baixarMidia(msg: any): Promise<any> {
  // downloadMedia às vezes falha com um erro interno minificado ("r"). Tentamos
  // de novo e, se preciso, re-buscamos a mensagem pelo id (media mais "fresca").
  for (let i = 0; i < 2; i++) {
    try { const m = await msg.downloadMedia(); if (m && m.data) return m; } catch (e: any) { log("downloadMedia falhou (tentativa " + (i + 1) + "): " + (e?.message || e)); }
    try { const id = msg.id && (msg.id._serialized || msg.id); if (id) { const m2 = await client.getMessageById(id); const md = await m2.downloadMedia(); if (md && md.data) return md; } } catch (e: any) { log("re-baixar por id falhou: " + (e?.message || e)); }
    await sleep(800);
  }
  return null;
}
// Baixa e DESCRIPTOGRAFA o áudio direto do servidor do WhatsApp (mmg.whatsapp.net),
// usando a mediaKey/directPath que já vêm na mensagem — MESMA criptografia do app
// (HKDF-SHA256 + AES-256-CBC). Não usa o navegador nem o downloadMedia (que quebra
// com a versão fixada), então NÃO mexe na conexão/versão do WhatsApp.
async function baixarAudioDescriptografado(msg: any): Promise<Buffer | null> {
  try {
    const d = (msg && msg._data) || {};
    const mediaKeyB64 = d.mediaKey || msg.mediaKey;
    const directPath = d.directPath || msg.directPath;
    if (!mediaKeyB64 || !directPath) { log("áudio sem mediaKey/directPath — não dá p/ baixar manualmente."); return null; }
    const mediaKey = Buffer.from(String(mediaKeyB64), "base64");
    // "WhatsApp Audio Keys" vale para áudio e ptt (nota de voz).
    const expanded = Buffer.from(crypto.hkdfSync("sha256", mediaKey, Buffer.alloc(0), Buffer.from("WhatsApp Audio Keys"), 112));
    const iv = expanded.subarray(0, 16);
    const cipherKey = expanded.subarray(16, 48);
    const dp = String(directPath);
    const url = "https://mmg.whatsapp.net" + (dp.startsWith("/") ? dp : "/" + dp);
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) { log("download cifrado HTTP " + resp.status); return null; }
    const enc = Buffer.from(await resp.arrayBuffer());
    if (enc.length <= 10) return null;
    const file = enc.subarray(0, enc.length - 10); // últimos 10 bytes = MAC (ignorado)
    const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey, iv);
    return Buffer.concat([decipher.update(file), decipher.final()]);
  } catch (e: any) { log("download manual do áudio falhou: " + (e?.message || e)); return null; }
}
async function transcreverAudio(msg: any): Promise<string> {
  const mime = (msg._data && msg._data.mimetype) || "audio/ogg";
  // 1º tenta o download manual (não depende do navegador); 2º o downloadMedia.
  let bytes: Buffer | null = await baixarAudioDescriptografado(msg);
  if (!bytes) { const media = await baixarMidia(msg); if (media && media.data) bytes = Buffer.from(media.data, "base64"); }
  if (!bytes) { log("transcrição: não consegui baixar o áudio."); return ""; }
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "ogg";
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
  fd.append("model", TRANSCRICAO_MODELO);
  fd.append("language", "pt");
  const resp = await fetch(TRANSCRICAO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TRANSCRICAO_KEY}` },
    body: fd as any,
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) { log(`transcrição HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`); return ""; }
  const j: any = await resp.json().catch(() => ({}));
  return String(j?.text || "").trim();
}

// Processa uma mensagem de TEXTO da aluna (mesmo caminho para texto e para o
// áudio transcrito). textoInbox permite mostrar "🎤 ..." no painel.
async function processarTextoDaAluna(msg: any, texto: string, textoInbox?: string) {
  const { chave, telefone } = await resolverTel(msg); // chave estável p/ memória + telefone real p/ agendar
  // Contato bloqueado (como o "Bloquear" do WhatsApp): ignora por completo.
  if (estaBloqueado(chave, telefone, jidParaTel(msg.from))) { log(`mensagem de contato bloqueado (${chave}) — ignorada.`); return; }
  const nomeAluna = (msg._data && msg._data.notifyName) || "";
  registrarInbox(chave, msg.from, nomeAluna, "aluna", textoInbox || texto); // painel ao vivo
  try { checarGatilhosAluna(chave, nomeAluna, texto); } catch (e: any) { log("gatilhos: " + (e?.message || e)); }
  agendarResposta(chave, msg.from, telefone, texto); // debounce + resposta
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
// Contatos com uma resposta EM ANDAMENTO (gerando/enviando). Enquanto está em voo,
// novas mensagens só ACUMULAM — não disparam uma 2ª resposta sobreposta (era o que
// gerava respostas em duplicata quando a aluna mandava outra msg durante a geração).
const emVoo = new Set<string>();
function agendarResposta(chave: string, jid: string, telefone: string, texto: string) {
  let p = pendencias.get(chave);
  if (!p) { p = { jid, telefone, textos: [], timer: null }; pendencias.set(chave, p); }
  p.jid = jid; p.telefone = telefone;
  p.textos.push(texto);
  if (emVoo.has(chave)) return; // já respondendo → acumula; dispara ao terminar (no finally)
  const ms = agruparMs();
  if (ms <= 0) { dispararResposta(chave); return; } // desligado → responde já
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => dispararResposta(chave), ms); // reinicia a cada nova mensagem
}
function dispararResposta(chave: string) {
  const p = pendencias.get(chave);
  if (!p) return;
  if (emVoo.has(chave)) return; // uma resposta por vez por contato
  pendencias.delete(chave);
  if (p.timer) clearTimeout(p.timer);
  const jid = p.jid, telefone = p.telefone;
  const textoJunto = p.textos.join("\n").trim();
  if (!textoJunto) return;
  emVoo.add(chave);
  enfileirar(async () => {
    try {
      const reply = await responderComMemoria(chave, textoJunto, telefone); // trata on/off, handoff e memória
      const midias = drenarMidias(); // imagens que a Sofia pediu nesta resposta ({imagem, link})
      if ((reply && reply.trim()) || midias.length) {
        // Texto e imagens juntos: enviarHumano solta cada foto logo APÓS a bolha que a
        // anuncia (cita o link) — a grade não cai mais embaixo do convite. Sem texto,
        // manda só as imagens (o laço final do enviarHumano cuida disso).
        await enviarHumano(jid, reply || "", chave, midias);
      }
    } finally {
      emVoo.delete(chave);
      // Mensagens que chegaram DURANTE a geração → responde UMA vez mais (juntas),
      // em vez de sobrepor. Sem greeting repetido, sem token dobrado.
      const q = pendencias.get(chave);
      if (q && q.textos.length) {
        const ms = agruparMs();
        if (q.timer) clearTimeout(q.timer);
        q.timer = setTimeout(() => dispararResposta(chave), ms > 0 ? ms : 0);
      }
    }
  });
}

// Mensagem RECEBIDA da aluna (não é fromMe).
client.on("message", (msg: any) => {
  try {
    if (!msg.from || msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return; // ignora grupos/status
    const texto = (msg.body || "").trim();
    if (texto) { enfileirar(() => processarTextoDaAluna(msg, texto)); return; }
    // Sem texto: se for ÁUDIO e a transcrição estiver ligada, transcreve e trata
    // como se a aluna tivesse escrito. Senão, aviso educado pedindo texto.
    const tipo = msg.type || "";
    if ((tipo === "ptt" || tipo === "audio") && transcricaoAtiva()) {
      enfileirar(async () => {
        let txt = "";
        try { txt = await transcreverAudio(msg); } catch (e: any) { log("transcrição falhou: " + (e?.stack || e?.message || e)); }
        if (txt) { log(`🎤 áudio transcrito (${txt.length} car.)`); await processarTextoDaAluna(msg, txt, "🎤 " + txt); }
        else { await avisarAudioPorTexto(msg); } // não deu para transcrever → pede texto
      });
      return;
    }
    tratarSemTexto(msg);
  } catch (e: any) { log("erro no on(message): " + (e?.message || e)); }
});

// VOCÊ respondeu MANUALMENTE (fromMe, e não foi a própria Sofia) → assume a
// conversa: a Sofia sai dela pelos minutos configurados no painel.
client.on("message_create", (msg: any) => {
  // A checagem do eco tem de ser SÍNCRONA (antes de qualquer await), senão duas
  // mensagens seguidas da própria Sofia disputariam o mesmo contador.
  if (!msg.fromMe) return;
  const jid = msg.to;
  if (!jid || jid.endsWith("@g.us")) return;
  if ((pendentesEco.get(jid) || 0) > 0) { decEco(jid); return; } // foi a própria Sofia (eco do envio)
  void tratarRespostaManual(msg, jid);
});

async function tratarRespostaManual(msg: any, jid: string) {
  try {
    // Descobre o TELEFONE do destinatário (o jid pode ser "@lid"). Antes isso usava
    // só o cache em memória: depois de um restart ele está vazio e a conversa
    // entrava no painel com o LID cru no lugar do número.
    const { chave: tel } = await resolverTelDestino(msg, jid);
    assumirConversa(tel);
    registrarNaMemoria(tel, "humano", msg.body || "");
    // tipo "wpp" = resposta manual DIRETO pelo celular da SoFIA (handoff). O painel
    // marca isso na timeline (diferente de uma resposta enviada pelo painel, que leva o "por").
    registrarInbox(tel, jid, "", "humano", msg.body || "", undefined, undefined, "wpp"); // registra sua resposta no inbox
    log(`você assumiu a conversa com ${tel} — Sofia pausada nela.`);
  } catch (e: any) { log("erro no on(message_create): " + (e?.message || e)); }
}

const sair = async () => { try { await client.destroy(); } catch {} process.exit(0); };
process.on("SIGINT", sair);
process.on("SIGTERM", sair);

carregarInbox(); // recupera as conversas já registradas (o painel mostra na aba Conversas)
carregarHistorico(); // recupera o histórico de interações (aba Contatos → Interações)
// Conserta o que ficou salvo com o LID cru como chave antes de sabermos o número:
// para cada LID que já aprendemos, une a conversa órfã na do telefone.
for (const [lid, tel] of lidMap) fundirConversaLid(lid, tel);
setStatus("iniciando");
log("iniciando a conexão do WhatsApp da Sofia...");
armarWatchdogBoot(); // se não chegar em PRONTA a tempo, limpa cache e reinicia sozinho
client.initialize();

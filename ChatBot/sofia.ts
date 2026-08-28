/**
 * ══════════════════════════════════════════════════════════════════════════
 *  SOFIA — Chatbot completo do SlimFit Studio (Setor Bueno, Goiânia)
 *  ARQUIVO ÚNICO E DEFINITIVO. Reúne tudo:
 *    1) Configuração da Sofia (prompts, regras, metodologia, valores...)
 *    2) Ferramentas (enviar mídia, verificar horário, solicitar agendamento)
 *    3) Memória por telefone com janela de 12h
 *    4) Resumo/extração dos 4 campos e disparo para o seu sistema
 * ──────────────────────────────────────────────────────────────────────────
 *  Instalar (uma vez):
 *    npm install @anthropic-ai/claude-agent-sdk @anthropic-ai/sdk zod
 *  Configurar a chave (a cada janela do terminal):
 *    set ANTHROPIC_API_KEY=sua-chave         (Windows CMD)
 *  Rodar:
 *    npx tsx sofia.ts            → teste automático (mostra o disparo)
 *    npx tsx sofia.ts --chat     → chat interativo no terminal
 * ══════════════════════════════════════════════════════════════════════════
 */

import "dotenv/config";
import { query, tool, createSdkMcpServer, type ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import * as readline from "node:readline/promises";
import * as fs from "node:fs";
import * as path from "node:path";

const anthropic = new Anthropic(); // usado só na extração do resumo

// Pasta dos arquivos da Sofia (prompt/estado/etc.). Por padrão a pasta de
// trabalho (comportamento atual); se SOFIA_DIR estiver definida, usa ela — assim
// dá para guardar os editáveis FORA do repositório (o git pull nunca os toca).
const BASE_DIR = process.env.SOFIA_DIR || process.cwd();

// Custo da IA: cada turno de conversa (e as extrações) grava uma linha em
// sofia-custo.jsonl. O painel soma por dia e mostra o gasto/tokens + alerta.
// Best-effort: nunca pode quebrar o atendimento.
// "Precisa de humano": quando a aluna pede um atendente/demonstra irritação, a
// SoFIA avisa um número do Studio (uma vez por conversa). Config editável no
// painel (SoFIA → Configuração): sofia-avisohumano.json = { on, numero }.
const AVISOHUMANO_FILE = path.join(BASE_DIR, "sofia-avisohumano.json");
const AVISOS_OUT_FILE = path.join(BASE_DIR, "sofia-avisos.jsonl"); // mesmo arquivo que o listener envia
const ATENCAO_FILE = path.join(BASE_DIR, "sofia-atencao.json"); // conversas que pediram humano — o painel pinta de vermelho e filtra
function marcarAtencao(chave: string) {
  try {
    let o: Record<string, number> = {};
    try { o = JSON.parse(fs.readFileSync(ATENCAO_FILE, "utf8")) || {}; } catch { /* arquivo novo */ }
    o[String(chave)] = Date.now();
    fs.writeFileSync(ATENCAO_FILE, JSON.stringify(o));
  } catch { /* best-effort */ }
}
// Expressões-padrão que disparam o aviso (editáveis no painel — uma por linha).
const PALAVRAS_HUMANO_PADRAO = [
  "atendente", "falar com uma pessoa", "falar com um humano", "falar com alguém",
  "falar com o responsável", "falar com o gerente", "quero falar com", "quero conversar com",
  "me liga", "liga pra mim", "isso não ajuda", "não entendi nada", "péssimo atendimento",
  "que raiva", "tô irritada", "estou irritada", "você é um robô", "só robô", "para de me mandar",
];
function lerAvisoHumano(): { on: boolean; numero: string; palavras: string[] } {
  try {
    const o = JSON.parse(fs.readFileSync(AVISOHUMANO_FILE, "utf8"));
    let palavras: string[] = [];
    if (Array.isArray(o.palavras)) palavras = o.palavras;
    else if (typeof o.palavras === "string") palavras = o.palavras.split("\n");
    palavras = palavras.map((s: any) => String(s || "").trim()).filter(Boolean);
    return { on: !!o.on, numero: String(o.numero || "").replace(/\D/g, ""), palavras };
  } catch { return { on: false, numero: "", palavras: [] }; }
}
// Normaliza para comparar sem depender de acento/caixa.
const semAcento = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function precisaHumano(texto: string, palavras: string[]): boolean {
  const lista = (palavras && palavras.length ? palavras : PALAVRAS_HUMANO_PADRAO).map(semAcento).filter(Boolean);
  const alvo = semAcento(texto);
  return lista.some((p) => alvo.includes(p));
}
function avisarPrecisaHumano(telefone: string, conversa: Conversa, texto: string) {
  try {
    if (conversa.avisouHumano) return;
    const cfg = lerAvisoHumano();
    if (!cfg.on || !cfg.numero) return;
    if (!precisaHumano(texto, cfg.palavras)) return;
    const tel = String(telefone || "").replace(/\D/g, "");
    const aviso = `🙋 *Possível pedido de atendimento humano*\n\nContato: ${tel}\nÚltima mensagem: "${String(texto || "").slice(0, 180)}"\n\nAbra o painel (SoFIA → Conversas) e clique em "assumir" para atender.`;
    fs.appendFileSync(AVISOS_OUT_FILE, JSON.stringify({ numero: cfg.numero, texto: aviso, em: Date.now() }) + "\n");
    marcarAtencao(telefone); // pinta a conversa de vermelho no painel até a recepção assumir
    conversa.avisouHumano = true;
    console.log(`🙋 aviso "precisa de humano" enfileirado para ${cfg.numero} (contato ${tel}).`);
  } catch { /* best-effort */ }
}

const CUSTO_FILE = path.join(BASE_DIR, "sofia-custo.jsonl");
function registrarCusto(rec: { tipo: string; model?: string; inTok?: number; outTok?: number; usd?: number; tel?: string }) {
  try {
    fs.appendFileSync(CUSTO_FILE, JSON.stringify({
      em: new Date().toISOString(),
      tipo: rec.tipo,
      model: rec.model || "",
      tel: String(rec.tel || "").replace(/\D/g, ""), // telefone da conversa → painel soma o gasto por aluna
      inTok: rec.inTok || 0,
      outTok: rec.outTok || 0,
      usd: (typeof rec.usd === "number" && isFinite(rec.usd)) ? rec.usd : 0,
    }) + "\n");
  } catch { /* best-effort */ }
}

// Semeadura: prompt/extração/mídias são editáveis pelo painel e ficam FORA do Git
// (sofia-*.txt no .gitignore). O conteúdo base mora nos sofia-*.default.txt
// (versionados). Se o arquivo "vivo" não existir (clone novo, ou o git pull que
// removeu do índice apagou o arquivo), copiamos do .default — assim nunca caímos
// no PROMPT_PADRAO por acidente e um clone novo já sobe com o prompt atual.
const comDefault = (p: string) => p.replace(/\.txt$/, ".default.txt");
function semearSeFaltar(vivo: string) {
  try { const base = comDefault(vivo); if (!fs.existsSync(vivo) && fs.existsSync(base)) fs.copyFileSync(base, vivo); }
  catch { /* best-effort */ }
}

// ══════════════════════════════════════════════════════════════════════════
// RETRY — repete automaticamente quando a API está sobrecarregada (429/529)
// A API pode responder "Overloaded" em picos; em vez de quebrar, esperamos
// um pouco (com tempo crescente) e tentamos de novo, algumas vezes.
// ══════════════════════════════════════════════════════════════════════════
async function comRetry<T>(fn: () => Promise<T>, tentativas = 5): Promise<T> {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status;
      const ehTemporario = status === 429 || status === 529 || status >= 500;
      if (!ehTemporario || i === tentativas - 1) throw err; // erro definitivo ou acabaram as tentativas
      const esperaMs = Math.min(1000 * 2 ** i, 15000) + Math.random() * 500; // 1s, 2s, 4s, 8s...
      console.log(`⚠️  API sobrecarregada (${status}). Tentando de novo em ${Math.round(esperaMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
  throw new Error("comRetry: esgotou as tentativas"); // inalcançável, só para o TypeScript
}

// ══════════════════════════════════════════════════════════════════════════
// 1) LINKS E MÍDIAS
// ══════════════════════════════════════════════════════════════════════════
// URLs das imagens. Editáveis pela telinha (editor) via arquivo sofia-midias.txt.
// Ordem de prioridade: sofia-midias.txt → variável de ambiente → padrão abaixo.
function lerMidias(): Record<string, string> {
  try {
    const arq = path.join(BASE_DIR, "sofia-midias.txt");
    semearSeFaltar(arq);
    const txt = fs.readFileSync(arq, "utf-8");
    const m: Record<string, string> = {};
    for (const l of txt.split("\n")) {
      const i = l.indexOf("=");
      if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    return m;
  } catch {
    return {};
  }
}
const _mid = lerMidias();
const MIDIAS = {
  grade_imagem: _mid.grade_imagem || process.env.MIDIA_GRADE_IMG || "https://storage.zee.tech/tenants/7a8c9d8e-7208-4a26-87c2-6662c8f962e4/prompt-media/b57c13a0-e544-4df4-99ed-b27cc9cd8859.jpeg",
  grade_link: _mid.grade_link || process.env.MIDIA_GRADE_LINK || "https://drive.google.com/file/d/1wgAvctcQZJVNcka59KcV_FjLDetScCM8/view?usp=sharing",
  precos_imagem: _mid.precos_imagem || process.env.MIDIA_PRECOS_IMG || "https://storage.zee.tech/tenants/7a8c9d8e-7208-4a26-87c2-6662c8f962e4/prompt-media/63436026-ab4a-4b0f-b6fd-b02f8d4cf037.png",
  precos_link: _mid.precos_link || process.env.MIDIA_PRECOS_LINK || "https://drive.google.com/file/d/14Em2I3-O7-BJvI51P8na7YS2pVvVOUAZ/view?usp=sharing",
};

// ══════════════════════════════════════════════════════════════════════════
// 2) GRADE DE HORÁRIOS PERMITIDOS (0=domingo ... 6=sábado)
// ══════════════════════════════════════════════════════════════════════════
const HORARIOS_PERMITIDOS: Record<number, string[]> = {
  0: [],
  1: ["05:45", "07:00", "08:15", "14:00", "16:15"],
  2: ["07:00", "08:15", "09:30", "16:30", "18:15", "19:30"],
  3: ["05:45", "07:00", "08:15", "09:30", "14:00", "16:15"],
  4: ["07:00", "08:15", "09:30", "16:30", "18:15", "19:30"],
  5: ["05:45", "07:00", "08:15", "09:30", "14:00", "16:15"],
  6: ["08:30", "09:45"],
};
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

// ══════════════════════════════════════════════════════════════════════════
// 3) FERRAMENTAS
// ══════════════════════════════════════════════════════════════════════════
function paraMinutos(hhmm: string) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function json(obj: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] }; }
function proximaSegundaTarde(ref: Date) {
  const d = new Date(ref);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
  d.setHours(14, 0, 0, 0);
  return d;
}

// Imagens que a Sofia pediu para enviar NESTA resposta. O listener (WhatsApp)
// drena esta fila logo após responderComMemoria e envia as imagens de verdade.
// (é resetada no início de cada responderComMemoria; o listener serializa as
// mensagens, então não há corrida entre conversas.)
let _midiasDaVez: string[] = [];
export function drenarMidias(): string[] { const m = _midiasDaVez; _midiasDaVez = []; return m; }

const enviarMidia = tool(
  "enviar_midia",
  "Envia uma imagem para a usuária. 'grade' = grade de horários; 'precos' = tabela de preços 2026.",
  { tipo: z.enum(["grade", "precos"]).describe("Qual imagem enviar") },
  async ({ tipo }) => {
    const url = tipo === "grade" ? MIDIAS.grade_imagem : MIDIAS.precos_imagem;
    const link = tipo === "grade" ? MIDIAS.grade_link : MIDIAS.precos_link;
    if (url) _midiasDaVez.push(url); // o listener envia a imagem de verdade após a resposta
    console.log(`🖼️  [ENVIAR IMAGEM] ${tipo}: ${url}`);
    return { content: [{ type: "text", text: `Imagem "${tipo}" enviada. Link: ${link}` }] };
  },
);

const verificarDisponibilidade = tool(
  "verificar_disponibilidade",
  "Verifica se dia/horário da aula experimental são válidos, aplicando a regra de antecedência. " +
    "SEMPRE use antes de confirmar agendamento. Nunca invente horário — use só o que retornar aqui.",
  {
    data_desejada: z.string().describe("Data no formato AAAA-MM-DD, ex: '2026-07-30'"),
    horario_desejado: z.string().describe("Horário no formato HH:MM, ex: '08:15'"),
  },
  async ({ data_desejada, horario_desejado }) => {
    const agora = new Date();
    const alvo = new Date(`${data_desejada}T${horario_desejado}:00-03:00`);
    const diaSemana = alvo.getDay();
    const slots = HORARIOS_PERMITIDOS[diaSemana] ?? [];

    if (diaSemana === 0)
      return json({ valido: false, motivo: "O Studio não abre aos domingos.", opcoes_proximas: HORARIOS_PERMITIDOS[1] });
    if (!slots.includes(horario_desejado))
      return json({ valido: false, motivo: `${horario_desejado} não existe na ${DIAS[diaSemana]}.`, opcoes_do_dia: slots });

    const diaAgora = agora.getDay();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const emJanelaSemana =
      (diaAgora >= 2 && diaAgora <= 4) ||
      (diaAgora === 1 && minutosAgora > paraMinutos("07:00")) ||
      (diaAgora === 5 && minutosAgora <= paraMinutos("17:30"));

    if (emJanelaSemana) {
      const horas = (alvo.getTime() - agora.getTime()) / 3_600_000;
      if (horas < 4)
        return json({ valido: false, motivo: "Em dias úteis é preciso pelo menos 4h de antecedência.", opcoes_do_dia: slots });
    } else {
      const segundaTarde = proximaSegundaTarde(agora);
      if (alvo < segundaTarde)
        return json({ valido: false, motivo: "No fim de semana só agendamos a partir de segunda-feira à tarde.", primeiro_horario_valido: "segunda-feira, 14:00" });
    }
    return json({ valido: true, dia_semana: DIAS[diaSemana], horario: horario_desejado });
  },
);

const solicitarAgendamento = tool(
  "solicitar_agendamento",
  "AGENDA a aula experimental no sistema (EVO) DE VERDADE. Chame só DEPOIS de ter " +
    "horário válido (via verificar_disponibilidade), nome completo e e-mail. Aja conforme " +
    "o retorno: ok=agendado (confirme com alegria); lotada=ofereça as 'alternativas' e, " +
    "quando a aluna escolher, chame de novo com o novo horário; erro=peça para falar com a " +
    "secretária; faltando=peça só o dado que faltou (não invente nada).",
  {
    nome_completo: z.string(),
    email: z.string(),
    data: z.string().describe("AAAA-MM-DD"),
    horario: z.string().describe("HH:MM"),
    telefone: z.string().optional().describe("Telefone da aluna, se disponível"),
    indicacao: z.string().optional(),
  },
  async ({ nome_completo, email, data, horario, telefone }) => {
    const conversa = _conversaDaVez;
    // Idempotência: se já agendou nesta conversa, não reagenda.
    if (conversa && conversa.resumoEnviado) return json({ ok: true, ja_agendado: true });
    // Validação leve — não inventa dados; pede o que faltar.
    if (!nome_completo || nome_completo.trim().split(/\s+/).length < 2) return json({ faltando: "nome_completo" });
    if (!email || !/\S+@\S+\.\S+/.test(email)) return json({ faltando: "email" });
    if (!data || !horario) return json({ faltando: "horario" });
    // Telefone CONFIÁVEL vem do listener (resolve o "@lid"); só usa o do modelo se faltar.
    const tel = _telefoneDaVez || telefone || "";
    console.log("📋 [SOFIA VAI AGENDAR]", { nome_completo, email, data, horario, tel });
    const r = await bookNoEvo(tel, nome_completo, email, `${data} ${horario}`);
    if (conversa) conversa.solicitou = true; // a ferramenta cuidou → desliga o fallback automático
    if ("ok" in r) { if (conversa) conversa.resumoEnviado = true; return json({ ok: true, when: r.when }); }
    if ("lotada" in r) return json({ lotada: true, alternativas: r.alternativas });
    return json({ erro: true });
  },
);

// Consulta a LOTAÇÃO REAL da grade (turma cheia ou não) — via o /api/slots que o
// formulário já expõe. Diferente da verificar_disponibilidade (que só olha a
// grade/antecedência), esta sabe se a turma está lotada, ANTES de coletar dados.
const consultarVaga = tool(
  "consultar_vaga",
  "Verifica se um dia/horário da aula experimental TEM VAGA (turma não lotada), consultando a grade real. " +
    "Use ASSIM QUE a aluna informar o dia (e ANTES de pedir nome/e-mail), mesmo que ela não diga a hora — " +
    "passe qualquer hora do dia só para consultar. Se vaga=true, prossiga. Se vaga=false, ofereça SOMENTE os " +
    "horários de 'disponiveis_do_dia' (os que têm vaga NAQUELE dia); se esse estiver vazio, use 'alternativas' " +
    "(outros dias). NUNCA ofereça horário que não esteja em disponiveis_do_dia/alternativas — não use a grade "
    + "para dizer o que está disponível. Complementa a verificar_disponibilidade (que só checa grade/antecedência).",
  { data: z.string().describe("AAAA-MM-DD"), horario: z.string().describe("HH:MM") },
  async ({ data, horario }) => {
    const base = process.env.SOFIA_BOOK_URL || "https://sf-formularioexperimental.onrender.com/api/book-sofia";
    const slotsUrl = process.env.SOFIA_SLOTS_URL || base.replace(/\/api\/book-sofia\/?$/, "/api/slots");
    const hh = String(horario).slice(0, 5);
    try {
      const r = await comRetry(async () => {
        const resp = await fetch(slotsUrl + "?days=10", { headers: { Accept: "application/json" } });
        if (resp.status >= 500) throw Object.assign(new Error(`slots ${resp.status}`), { status: resp.status });
        return resp;
      });
      const j: any = await r.json().catch(() => ({}));
      const dias: Record<string, any[]> = (j && j.dias) || {};
      const doDia: any[] = Array.isArray(dias[data]) ? dias[data] : [];
      const alvo = doDia.find((s) => String(s.time).slice(0, 5) === hh);
      // Alternativas com vaga: primeiro o mesmo dia, depois os próximos.
      const comVaga: string[] = [];
      const juntar = (arr: any[]) => arr.forEach((s) => { if (s && s.disponivel) comVaga.push(s.activityDate); });
      juntar(doDia);
      for (const d of Object.keys(dias).sort()) { if (d !== data) juntar(dias[d] || []); }
      const alternativas = comVaga.slice(0, 5);
      // Horários COM VAGA no MESMO dia pedido (para oferecer só o que dá pra marcar).
      const disponiveis_do_dia = doDia.filter((s) => s && s.disponivel).map((s) => String(s.time).slice(0, 5));
      if (alvo && alvo.disponivel) return json({ vaga: true, freeSpots: alvo.freeSpots, disponiveis_do_dia });
      if (alvo && !alvo.disponivel) return json({ vaga: false, motivo: "lotada", disponiveis_do_dia, alternativas });
      return json({ vaga: false, motivo: "inexistente", disponiveis_do_dia, alternativas });
    } catch (e: any) {
      // Se a grade não responder, NÃO trava o atendimento: segue (a
      // solicitar_agendamento ainda valida a vaga de verdade na hora de agendar).
      console.log("⚠️  consultar_vaga falhou:", e?.message ?? e);
      return json({ vaga: null, indisponivel_checar: true });
    }
  },
);

const servidor = createSdkMcpServer({
  name: "slimfit",
  version: "1.0.0",
  tools: [enviarMidia, verificarDisponibilidade, consultarVaga, solicitarAgendamento],
});

// ══════════════════════════════════════════════════════════════════════════
// 4) SYSTEM PROMPT — configuração completa da Sofia
// ══════════════════════════════════════════════════════════════════════════
// O prompt fica num ARQUIVO EXTERNO (sofia-prompt.txt), editável pela telinha web,
// para você mudar o comportamento da Sofia sem tocar no código nem reiniciar nada.
// Se o arquivo não existir, usamos PROMPT_PADRAO abaixo como reserva.
const PROMPT_FILE = path.join(BASE_DIR, "sofia-prompt.txt");

// Interruptor liga/desliga (controlado pela telinha). Se o arquivo disser "off",
// a Sofia fica em SILÊNCIO — não responde nada (você atende manualmente).
const ESTADO_FILE = path.join(BASE_DIR, "sofia-estado.txt");
function sofiaAtiva(): boolean {
  try {
    return fs.readFileSync(ESTADO_FILE, "utf-8").trim().toLowerCase() !== "off";
  } catch {
    return true; // sem arquivo = ligada (padrão)
  }
}

// ── ATENDIMENTO HUMANO (assumir conversa) ─────────────────────────────────────
// Quando VOCÊ responde manualmente uma aluna pelo WhatsApp, o listener (na VPS)
// chama assumirConversa(telefone). A Sofia então fica fora DAQUELA conversa por
// X minutos (configurável na telinha, arquivo sofia-pausa-min.txt).
const PAUSA_FILE = path.join(BASE_DIR, "sofia-pausa-min.txt");
function pausaMinutos(): number {
  try { const n = parseInt(fs.readFileSync(PAUSA_FILE, "utf-8").trim(), 10); return n > 0 ? n : 30; }
  catch { return 30; }
}
// ── CONTROLE HUMANO POR CONVERSA (interruptor no painel) ──────────────────────
// Diferente da pausa por tempo (assumirConversa): aqui é um interruptor PERSISTENTE
// por conversa, ligado/desligado no painel (aba Sofia → Conversas). Enquanto ligado
// para uma conversa, a Sofia NÃO responde AQUELA conversa (você conversa manualmente);
// as demais conversas seguem com a Sofia normalmente. Gravado em sofia-humano.json
// pelo painel e lido AQUI a cada mensagem — muda sem reiniciar.
const HUMANO_FILE = path.join(BASE_DIR, "sofia-humano.json");
function controleHumanoAtivo(chave: string): boolean {
  try {
    const o = JSON.parse(fs.readFileSync(HUMANO_FILE, "utf-8"));
    return !!(o && typeof o === "object" && o[chave]);
  } catch { return false; }
}

const assumidasAte = new Map<string, number>(); // telefone -> timestamp (ms) até quando a Sofia fica fora
export function assumirConversa(telefone: string) {
  assumidasAte.set(telefone, Date.now() + pausaMinutos() * 60_000);
  console.log(`🙋 Conversa com ${telefone} assumida por humano — Sofia fora por ${pausaMinutos()} min.`);
}
function conversaAssumida(telefone: string): boolean {
  const ate = assumidasAte.get(telefone);
  if (!ate) return false;
  if (Date.now() >= ate) { assumidasAte.delete(telefone); return false; } // tempo passou → Sofia reassume
  return true;
}

// A Sofia deve responder ESTA conversa agora? (ligada, sem controle humano e sem
// handoff por tempo). Usado pelo listener p/ decidir o aviso de "só texto" no áudio.
export function deveResponder(telefone: string): boolean {
  return sofiaAtiva() && !controleHumanoAtivo(telefone) && !conversaAssumida(telefone);
}

// Registra uma mensagem na memória SEM a Sofia responder. Usado quando ela está
// pausada (assumida por humano ou desligada): mesmo calada, ela "ouve e anota",
// para não perder o contexto quando reassumir. O listener (VPS) chama isto para
// as mensagens da aluna E para as SUAS respostas manuais (autor "humano").
export function registrarNaMemoria(telefone: string, autor: "aluna" | "sofia" | "humano", texto: string) {
  if (!texto) return;
  let conversa = conversas.get(telefone);
  if (!conversa) {
    conversa = { sessionId: undefined, ultimaMensagemEm: Date.now(), transcricao: [], resumoEnviado: false };
    conversas.set(telefone, conversa);
  }
  // guarda "humano" como se fosse a Sofia (é o Studio falando), preservando o texto
  conversa.transcricao.push({ autor: autor === "aluna" ? "aluna" : "sofia", texto });
  conversa.ultimaMensagemEm = Date.now();
}


const PROMPT_PADRAO = `
Você é a *Sofia*, atendente virtual do *SlimFit Studio* do Setor Bueno, em Goiânia.
Fala no WhatsApp com mulheres interessadas na metodologia.

# TOM E TAMANHO (importante)
- Leve, acolhedora, humana e descontraída — como uma amiga simpática, NUNCA formal
  ou robótica. Pode usar emojis com moderação.
- Ao mesmo tempo, seja DIRETA e objetiva. Responda o que foi perguntado sem enrolar,
  sem repetir o que já disse, sem "encher linguiça". Menos é mais.
- Mensagens curtas, de conversa de WhatsApp: normalmente 2 a 4 linhas. Evite textões
  e evite listar tudo de uma vez — vá conduzindo a conversa em passos pequenos.
- Faça UMA pergunta por vez; não despeje várias perguntas juntas.
- Regra de ouro: agradável e calorosa, mas econômica nas palavras.
Use *asteriscos* para negrito (padrão do WhatsApp). Nunca invente horário.

# SAUDAÇÃO INICIAL (só na primeira mensagem da aluna)
"Olá! Seja muito bem-vinda ao SlimFit *Goiânia* do Setor Bueno!
Sou a Sofia e estou aqui pra tirar todas as suas dúvidas sobre a nossa metodologia, todos os nossos planos, grade horário e agendamento da sua aula experimental!"
E informe que a aula experimental pode ser feita direto pelo link: https://sf-formularioexperimental.onrender.com/

# SEU OBJETIVO
- Apresentar a metodologia SlimFit com clareza e destacar os diferenciais.
- Despertar interesse em agendar a aula experimental GRATUITA.
- Conversa leve, sem parecer que está "qualificando" a usuária (NUNCA mencione isso).
- Se ainda não agendou, convide gentilmente para a aula experimental.
- Se perguntarem seu objetivo: você tira dúvidas sobre a metodologia e ajuda no agendamento.

# SOBRE O SLIMFIT (destaques obrigatórios)
- Sempre "*o* SlimFit" — nunca "a" SlimFit.
- É um *Studio de Personal exclusivo para mulheres*, com treino de força de alta
  intensidade que *substitui a musculação tradicional*. Treino COMPLETO
  (força, funcional e cardio em até 1 hora) — não precisa de outra atividade física.
- NUNCA relacione o SlimFit a Pilates, Yoga, ballet fitness ou similares.
- Turmas reduzidas (máx. 9 alunas), acompanhamento próximo, resultados reais.
- Adapta à rotina corrida: planos de 2x até 6x por semana.
- Diferenciais: exclusividade feminina, treino personalizado por nível, resultados
  otimizados, acolhimento, e aula experimental grátis para quem ainda não é aluna.

# PECULIARIDADES DA UNIDADE
- Vagas exclusivas no estacionamento; brinquedoteca (sem monitor); banheiro com 2
  chuveiros; área de convivência; tudo térreo, sem elevador.

# ENDEREÇO
- R. C-235, 846, Setor Bueno, Goiânia-GO — https://goo.gl/maps/LFBZhkzbCZ5wJ99f6
- Ponto de referência: mesma rua do Salão North Face, um pouco antes do Biscoito Pereira da T63.
- Agendamentos SOMENTE para a unidade Setor Bueno.

# METODOLOGIA SLIMFIT (quando perguntarem, responda com TUDO abaixo, sem resumir)
"Nos vídeos abaixo te explico direitinho sobre a nossa metodologia e o Studio:
- *O que é o SlimFit*: https://www.instagram.com/reel/Crluss-AWPu/
- *Personal X SlimFit*: https://www.instagram.com/p/CwkvRzggYrs/"

# CIRCUITO SLIM
- Ocorre APENAS no sábado às 9h45. Complemento de cárdio ao SlimFit.
- Ótimo para emagrecimento, substitui outro aeróbio. Quem NÃO é aluna também pode fazer.
- Pode contratar só o Circuito, ou junto com o SlimFit. Todos os planos SlimFit dão direito ao Circuito.
- Vídeo: https://www.instagram.com/p/C4ndWUXvKCm/?next=%2Freel%2FCkQi4sNgSuB%2F

# DÚVIDAS FREQUENTES
- Horário fixo: depende do plano — *Fixo* (definido), *Livre* (flexível), *Flex* (combina).
- Reposição: desmarque com antecedência no APP e reponha conforme disponibilidade.
- Lesão/hérnia: aulas 100% adaptáveis, é só conversar com o professor(a) na experimental.
- Idade mínima: 12 anos. Plano família: sim, detalhes com a secretária.
- NÃO aceitamos Gympass nem Totalpass. Equipamentos/roupas: direcione à secretária.
- A aluna só treina na unidade em que se matriculou.

# VALORES / PLANOS / PREÇOS (regras rígidas)
- NUNCA escreva valores de planos. NUNCA confirme valores. Sempre use a imagem.
- 1ª vez que perguntarem preço: diga que há opções que variam conforme vezes na semana
  e período, *partindo de R$ 414,00 neste mês de Julho/2026 com a campanha Copa Slim*.
  Depois apresente a metodologia e convide para a experimental. NÃO envie a tabela agora.
- 2ª vez (ou mais): use enviar_midia("precos"), dizendo que é a tabela vigente de 2026 e
  que a *Campanha Copa Slim 2x na semana está R$ 414,00/mês*. NUNCA envie a tabela sem
  apresentar a metodologia antes.
- Ao enviar a tabela, diga: "O SlimFit possui três tipos de planos: o *Fixo*, com horários
  totalmente definidos; o *Livre*, com total flexibilidade para agendar as aulas; e o
  *Flex*, que combina horários fixos e livres. Esta é a tabela vigente."
- Se perguntarem valor de novo depois da tabela: diga que são os da imagem e envie a
  imagem de novo com enviar_midia("precos"). NUNCA confirme por texto.
- Aula avulsa: pode enviar a tabela de preços.
- Pagamento: mensal por cartão, boleto ou PIX. No cartão, cobrança recorrente sem ocupar o limite.
- Rescisão: só plano anual, mas a multa só se aplica se cancelar nos primeiros 6 meses;
  depois, sem multa, com aviso prévio de 30 dias. Valor da multa: com a secretária.
- Promoções: só a secretária fala sobre promoções.

# GRADE DE HORÁRIOS
- Se perguntarem por horários, use enviar_midia("grade") e informe o link: ${MIDIAS.grade_link}
- Depois de enviar a grade, pergunte qual o melhor horário para a experimental.

# PERSONALIZAÇÕES
- Achou caro → "Entendo. Não somos uma academia tradicional, mas basicamente um *Studio
  de Personal exclusivo para mulheres* e com um treino super dinâmico focado na
  transformação da sua relação com a atividade física. Vamos agendar a sua aula
  experimental? Tenho certeza que irá amar!"
- Comparou com personal dela → entenda (é normal), ressalte que muitas alunas vieram de
  personais e destacam o dinamismo e os resultados, além da flexibilidade e reposição.
  Convide para a experimental.
- Grávida → "Nossos professores são especializados em atender gestantes. A atividade
  física é recomendada desde o primeiro trimestre, mas é necessário monitorar os
  batimentos cardíacos durante as aulas. Tudo será adaptado para a sua segurança!"
- Sedentária → "Não só pode como deve começar! A aula será completamente ajustada ao seu
  nível e os professores irão ajudar você a ter uma experiência confortável e segura."
- Turmas para iniciantes → não há turmas específicas; cada treino é adaptado ao nível,
  turmas pequenas de até 9 alunas.
- Gift/voucher → "Que legal! Vai amar conhecer a nossa metodologia! Nesse caso em
  específico, a Secretária do Studio entrará em contato em breve para fazer as marcações
  das suas aulas. =)"

# GUARDRAILS
- RECUSE responder qualquer coisa que não seja sobre o SlimFit.
- O SlimFit é exclusivo para MULHERES. Se identificar que fala com um homem, pergunte se
  procura para alguma pessoa especial, e só agende se for para uma mulher.
- Nunca invente valores, prazos, horários ou promoções.
- Nunca informe telefone. Contato: e-mail slimfit.setorbueno@gmail.com ou o WhatsApp
  https://api.whatsapp.com/send?phone=556285508065
- Contratação direta/online, promoção ou atendimento humano → direcione ao WhatsApp acima.
- Se perguntarem se é humana ou robô: você é uma Assistente Virtual; para falar com a
  recepcionista, use o link do WhatsApp acima.

# AGENDAMENTO DA AULA EXPERIMENTAL
Nunca agende sem a aluna informar o horário. Ao iniciar, avise que vai começar o processo
e fará poucas perguntas.
1. Sem horário: pergunte "Qual é o seu horário de preferência para fazer o agendamento da
   sua aula experimental?" e não prossiga sem isso.
2. Com dia e horário, use verificar_disponibilidade. Se inválido, use enviar_midia("grade")
   e ofereça as opções mais próximas que a ferramenta retornar (não liste por texto).
3. Colete, uma pergunta por linha: *Nome completo*, depois *e-mail*. Não prossiga sem
   ambos ("Precisamos dessas informações para continuar o agendamento da sua aula
   experimental e garantir que você tenha uma experiência personalizada no SlimFit.").
4. Última pergunta: se conheceu por indicação de alguma aluna; se sim e não deu o nome,
   pergunte "Qual o nome da aluna que nos indicou?"
5. Só então chame solicitar_agendamento (passando data no formato AAAA-MM-DD e horário
   HH:MM). ESSA FERRAMENTA AGENDA DE VERDADE — responda conforme o resultado dela:
   - Se ok=true → confirme com alegria: "Prontinho, [nome]! ✅ Sua aula experimental está
     agendada para *[dia da semana] às [horário]*. Chegue uns 10 minutinhos antes pra
     conhecer o Studio. Qualquer coisa, é só me chamar! 💪"
   - Se lotada=true → lamente e ofereça as alternativas retornadas: "Ihh, esse horário
     acabou de lotar 😅 Mas tenho essas outras opções: [alternativas]. Qual fica melhor?"
     (e ao escolher, chame solicitar_agendamento de novo com o novo horário).
   - Se houver erro/falha → "Opa, tive uma dificuldade pra concluir aqui 🙈 Pode falar com
     a nossa secretária pelo WhatsApp https://api.whatsapp.com/send?phone=556285508065 que
     ela finaliza rapidinho pra você!"
   NUNCA diga que agendou se a ferramenta não retornou ok=true.

# FINALIZAÇÃO
- Ao apresentar metodologia/valores: se não agendou, convide para a experimental; se já
  agendou, pergunte "Posso ajudar em mais alguma coisa?"
- Ao encerrar: pergunte "Posso ajudar em mais alguma coisa?"; peça avaliação de 0 a 10;
  pergunte UMA única vez se já segue o Instagram (https://www.instagram.com/slimfit.setorbueno/);
  e agradeça: "Muito obrigada pelo seu tempo! Se precisar de mais alguma coisa, estarei por aqui. Até logo!"
`;

// Lê o prompt do arquivo a cada chamada (assim edições valem para conversas novas).
function carregarPrompt(): string {
  try {
    semearSeFaltar(PROMPT_FILE);
    const txt = fs.readFileSync(PROMPT_FILE, "utf-8").trim();
    return txt.length > 50 ? txt : PROMPT_PADRAO; // se vier vazio/curto, usa o padrão
  } catch {
    return PROMPT_PADRAO; // arquivo não existe ainda → usa o padrão
  }
}


// MODELO DE IA — editável pelo painel (SoFIA → Configuração). Fica em
// sofia-modelo.json; lido AQUI no boot (mudar → reiniciar o sofia-listener).
// Lista fixa de válidos + padrão Sonnet 5 (se o arquivo faltar ou vier inválido).
const MODELO_PADRAO = "claude-sonnet-5";
const MODELOS_VALIDOS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"];
function lerModelo(qual: "conversa" | "extracao"): string {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(BASE_DIR, "sofia-modelo.json"), "utf-8"));
    const m = o && o[qual];
    if (typeof m === "string" && MODELOS_VALIDOS.includes(m)) return m;
  } catch { /* sem arquivo/ inválido → padrão */ }
  return MODELO_PADRAO;
}
const MODELO_CONVERSA = lerModelo("conversa"); // conversa com as alunas + follow-up
const MODELO_EXTRACAO = lerModelo("extracao"); // extração dos dados + resumos
console.log(`🧠 modelos: conversa=${MODELO_CONVERSA} · extração=${MODELO_EXTRACAO}`);

const options: ClaudeAgentOptions = {
  model: MODELO_CONVERSA,
  // systemPrompt é injetado por conversa (lido do arquivo) — veja responderComMemoria.
  mcpServers: { slimfit: servidor },
  allowedTools: [
    "mcp__slimfit__enviar_midia",
    "mcp__slimfit__verificar_disponibilidade",
    "mcp__slimfit__consultar_vaga",
    "mcp__slimfit__solicitar_agendamento",
  ],
  permissionMode: "default",
};

// ══════════════════════════════════════════════════════════════════════════
// 5) MEMÓRIA POR TELEFONE + JANELA DE 12H
// ══════════════════════════════════════════════════════════════════════════
interface Conversa {
  sessionId?: string;
  ultimaMensagemEm: number;
  transcricao: { autor: "aluna" | "sofia"; texto: string }[];
  resumoEnviado: boolean;
  solicitou?: boolean; // a ferramenta solicitar_agendamento já cuidou (êxito ou não)
  avisouHumano?: boolean; // já avisamos o Studio que esta conversa pode precisar de humano
}
const conversas = new Map<string, Conversa>();

// Janela de sessão (memória da conversa). Depois deste tempo SEM mensagens, a
// próxima mensagem da aluna começa uma conversa NOVA (a Sofia não lembra do que
// foi dito antes). É editável pelo painel (aba Sofia → Configuração), gravado em
// sofia-sessao-horas.txt e lido AQUI a cada mensagem — muda sem reiniciar.
const SESSAO_FILE = path.join(BASE_DIR, "sofia-sessao-horas.txt");
const SESSAO_HORAS_PADRAO = 12;
export function janelaSessaoMs(): number {
  try {
    const n = parseFloat(fs.readFileSync(SESSAO_FILE, "utf-8").trim().replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.min(n, 720) * 3_600_000; // teto de 30 dias
  } catch {}
  return SESSAO_HORAS_PADRAO * 3_600_000;
}

// Encerramento MANUAL de conversa (painel → sofia-encerradas.json). Guarda
// { "<chave>": <em> }. Quando o painel encerra uma conversa à mão, a próxima
// mensagem da aluna começa uma conversa NOVA (a Sofia recomeça do zero), igual
// a esperar o tempo da sessão — só que na hora. Lido com cache por mtime.
const ENCERRADAS_FILE = path.join(BASE_DIR, "sofia-encerradas.json");
let _encMtime = -1;
let _encMap: Record<string, number> = {};
function encerradaManualEm(chave: string): number {
  try {
    const st = fs.statSync(ENCERRADAS_FILE);
    if (st.mtimeMs !== _encMtime) {
      _encMtime = st.mtimeMs;
      const o = JSON.parse(fs.readFileSync(ENCERRADAS_FILE, "utf-8"));
      _encMap = (o && typeof o === "object") ? o : {};
    }
  } catch { _encMtime = -1; _encMap = {}; }
  const d = String(chave || "").replace(/\D/g, "");
  return Number(_encMap[chave] || (d && _encMap[d]) || 0) || 0;
}

// Contexto da conversa ATUAL, para a ferramenta solicitar_agendamento (que roda
// DURANTE a resposta) usar o telefone CONFIÁVEL (resolvido pelo listener, já com
// a correção do "@lid") e marcar a conversa como agendada. Setados no começo de
// responderComMemoria, depois que a conversa é resolvida.
let _telefoneDaVez = "";
let _conversaDaVez: Conversa | null = null;

// `telefone` é a CHAVE de memória/handoff (telefone real, ou o LID quando não dá
// pra descobrir). `telefoneReal` é o número que vai ao EVO no agendamento (ou ""
// quando não dá pra achar — nunca o LID). Para "@c.us" os dois são iguais.
export async function responderComMemoria(telefone: string, mensagem: string, telefoneReal?: string): Promise<string> {
  _midiasDaVez = []; // zera as imagens desta resposta (o listener drena depois)
  // Interruptor geral: se estiver desligada, fica em silêncio (atendimento manual).
  // Retorna string vazia — o webhook/listener trata isso como "não enviar nada".
  if (!sofiaAtiva()) {
    console.log(`🔕 Sofia DESLIGADA — mensagem de ${telefone} não respondida (atenda manualmente).`);
    return "";
  }
  // Controle humano LIGADO para esta conversa (interruptor do painel): Sofia fica
  // fora SÓ desta conversa, sem prazo, até você desligar. As outras seguem normais.
  // Mesmo calada, REGISTRA a mensagem da aluna para ter contexto quando devolver.
  if (controleHumanoAtivo(telefone)) {
    registrarNaMemoria(telefone, "aluna", mensagem);
    console.log(`🙋 ${telefone} sob CONTROLE HUMANO — Sofia anotou a mensagem, mas não responde.`);
    return "";
  }
  // Conversa assumida por humano: Sofia fica fora só desta, pelo tempo configurado.
  // Mesmo calada, REGISTRA a mensagem da aluna para não perder o contexto ao reassumir.
  if (conversaAssumida(telefone)) {
    registrarNaMemoria(telefone, "aluna", mensagem);
    console.log(`🙋 ${telefone} em atendimento humano — Sofia anotou a mensagem, mas não responde.`);
    return "";
  }
  const agora = Date.now();
  let conversa = conversas.get(telefone);

  const janelaMs = janelaSessaoMs();
  const inativa = conversa && agora - conversa.ultimaMensagemEm > janelaMs;
  // Encerrada à mão pelo painel DEPOIS da última mensagem desta conversa → começa
  // do zero (a aluna voltou depois de você fechar a conversa).
  const fechadaManual = !!conversa && encerradaManualEm(telefone) >= conversa.ultimaMensagemEm;
  if (!conversa || inativa || fechadaManual) {
    if (fechadaManual) console.log(`🔒 ${telefone}: conversa encerrada no painel — iniciando conversa nova.`);
    else if (inativa) console.log(`⏰ ${telefone}: +${(janelaMs / 3_600_000).toFixed(1)}h de inatividade — iniciando conversa nova.`);
    conversa = { sessionId: undefined, ultimaMensagemEm: agora, transcricao: [], resumoEnviado: false, avisouHumano: false };
    conversas.set(telefone, conversa);
  }

  // Deixa o telefone confiável e a conversa acessíveis para a ferramenta de
  // agendamento (que roda durante a geração da resposta).
  _telefoneDaVez = (telefoneReal !== undefined ? telefoneReal : telefone); // real p/ o EVO (pode ser "")
  _conversaDaVez = conversa;

  // "Precisa de humano": se a aluna pediu um atendente/demonstrou irritação,
  // avisa o Studio (uma vez por conversa). A Sofia segue respondendo normalmente.
  avisarPrecisaHumano(telefone, conversa, mensagem);

  // Conversa NOVA → injeta o prompt lido do arquivo agora (pega edições recentes).
  // Conversa retomada → mantém a sessão (o prompt já está embutido nela).
  // IMPORTANTE: reaplicamos o systemPrompt em TODA mensagem (inclusive nas retomadas).
  // Sem isso, a partir da 2ª mensagem a Sofia perdia as regras (defletir preço, inventar
  // "franquia" etc.), porque o resume não estava mantendo o system prompt.
  const opcoesDaVez: ClaudeAgentOptions = conversa.sessionId
    ? { ...options, resume: conversa.sessionId, systemPrompt: carregarPrompt() }
    : { ...options, systemPrompt: carregarPrompt() };

  let resposta = "";
  let sessionId: string | undefined;
  try {
    await comRetry(async () => {
      resposta = "";
      for await (const msg of query({ prompt: mensagem, options: opcoesDaVez })) {
        if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
        if (msg.type === "result") {
          sessionId = msg.session_id ?? sessionId;
          // Custo do turno (a SDK do agente já calcula total_cost_usd e usage).
          try {
            const u: any = (msg as any).usage || {};
            registrarCusto({
              tipo: "conversa",
              model: MODELO_CONVERSA,
              tel: telefone,
              inTok: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
              outTok: u.output_tokens || 0,
              usd: (msg as any).total_cost_usd || 0,
            });
          } catch { /* best-effort */ }
          if (msg.subtype === "success") resposta = msg.result;
          // Se o próprio SDK sinalizar erro no result, deixa o retry tratar.
          if (msg.subtype !== "success") throw Object.assign(new Error("Agent SDK result de erro"), { status: 529 });
        }
      }
    });
  } catch (err: any) {
    // Caso raro: a API falhou TODAS as tentativas. A aluna nunca vê erro técnico —
    // recebe uma mensagem humana e é convidada a reenviar. Não gravamos essa troca
    // na transcrição, para não poluir o contexto da conversa.
    console.log("⚠️  Falha ao gerar resposta após retries:", err?.message ?? err);
    conversa.ultimaMensagemEm = agora;
    return "Opa, tivemos uma instabilidade rapidinha aqui 🙈 Pode me mandar a sua mensagem de novo, por favor?";
  }

  if (sessionId) conversa.sessionId = sessionId;
  conversa.ultimaMensagemEm = agora;
  conversa.transcricao.push({ autor: "aluna", texto: mensagem });
  conversa.transcricao.push({ autor: "sofia", texto: resposta });

  // Caminho AUTOMÁTICO de agendamento (extrai da conversa e agenda por trás).
  // DESLIGADO por padrão: ele agenda SEM avisar a Sofia do resultado, então numa
  // turma lotada a aluna era cadastrada mas ficava sem aula E a Sofia dizia
  // "agendada". Agora o agendamento é só pela ferramenta solicitar_agendamento,
  // que devolve o resultado real. Reative com SOFIA_AUTO_BOOK=true se algum dia
  // precisar do fallback.
  if (process.env.SOFIA_AUTO_BOOK === "true") {
    try {
      await verificarEDispararAgendamento(telefone, conversa);
    } catch (err: any) {
      console.log("⚠️  Não consegui extrair/disparar o resumo agora (tento na próxima mensagem):", err?.message ?? err);
    }
  }
  return resposta;
}

// ══════════════════════════════════════════════════════════════════════════
// 6) RESUMO (extração dos 4 campos) + DISPARO PARA O SEU SISTEMA
// ══════════════════════════════════════════════════════════════════════════
const EXTRACAO_FILE = path.join(BASE_DIR, "sofia-extracao.txt");
const EXTRACAO_PADRAO = `
Você é um extrator de dados. Sua única função é ler a conversa entre a aluna e a Sofia e retornar os dados para agendar a aula experimental.

Traga todas as informações exatamente como a aluna informou. NUNCA invente, complete ou deduza dados que não estejam explícitos na conversa. Se uma informação não foi dita, deixe o campo como "".

Extraia os seguintes campos:
- "nome_completo": o nome completo que a aluna digitou na conversa (ex.: "Bruna Souza de Melo"). Caso a aluna não tenha informado o nome em nenhum momento, use o nome do WhatsApp — e SOMENTE nessa situação.
- "email": o e-mail informado pela aluna, em letras minúsculas e sem espaços.
- "dia": o dia escolhido para a aula, como a aluna disse:
    - se ela disse um dia da semana, use o nome do dia por extenso (ex.: "segunda-feira");
    - se ela disse um dia do mês, use a palavra "dia" seguida do número (ex.: "dia 17").
- "hora": o horário escolhido, no formato HH:mm com dois dígitos (ex.: "16:15", "08:15").

REGRAS DE SAÍDA (obrigatórias):
- Responda APENAS com o objeto JSON, nada mais. Sem explicações, sem crases, sem markdown.
- Use exatamente estas quatro chaves, sempre presentes, mesmo que vazias.
- Se algum campo não foi informado, o valor deve ser exatamente "" (string vazia).

Formato exato: {"nome_completo":"","email":"","dia":"","hora":""}
`.trim();

function carregarPromptExtracao(): string {
  try {
    semearSeFaltar(EXTRACAO_FILE);
    const txt = fs.readFileSync(EXTRACAO_FILE, "utf-8").trim();
    return txt.length > 30 ? txt : EXTRACAO_PADRAO;
  } catch {
    return EXTRACAO_PADRAO;
  }
}

// Gera N variações NATURAIS de um texto de campanha, para o envio não parecer
// robótico/spam (cada contato recebe uma redação diferente). Usada pelo listener
// nas campanhas por tag. Se a IA falhar, cai no texto original (nunca quebra).
export async function gerarVariacoes(texto: string, n = 10): Promise<string[]> {
  const base = String(texto || "").trim();
  if (!base) return [];
  const instr = `Você reescreve mensagens de WhatsApp de um Studio de treino para mulheres.
Reescreva a mensagem abaixo em ${n} variações DIFERENTES entre si, mantendo EXATAMENTE o mesmo sentido,
o mesmo idioma (português do Brasil) e um tom amigável e humano de WhatsApp. Pode variar saudação,
ordem das frases e palavras, mas NÃO invente informação, preço, data ou promoção que não esteja no texto.
Mantenha eventuais *negritos* e links iguais. Se houver o marcador literal {nome} no texto, MANTENHA {nome}
em TODAS as variações, exatamente assim (é substituído depois pelo nome da pessoa). Responda APENAS um array
JSON de strings, sem explicação, sem markdown.

Mensagem:
"""${base}"""`;
  try {
    const resp = await comRetry(() =>
      anthropic.messages.create({
        model: MODELO_EXTRACAO,
        max_tokens: 3000,
        messages: [{ role: "user", content: instr }],
      }),
    );
    const txt = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("").replace(/```json|```/g, "").trim();
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      const limpas = arr.map((s) => String(s || "").trim()).filter(Boolean);
      if (limpas.length) return limpas.slice(0, n);
    }
  } catch (e: any) {
    console.log("⚠️  gerarVariacoes falhou:", e?.message ?? e);
  }
  return [base]; // fallback: usa o texto original
}

// Gera UMA mensagem de campanha pronta a partir de uma INSTRUÇÃO do painel
// (ex.: "campanha promocional enfatizando o nosso treino"). A recepção revisa e
// edita antes de criar a campanha — este é só o rascunho. Usa o modelo de
// conversa (escrita melhor). Devolve o texto, ou "" em qualquer falha (o painel
// avisa e mantém o campo para escrita manual).
export async function gerarTextoCampanha(instrucao: string): Promise<string> {
  const pedido = String(instrucao || "").trim();
  if (!pedido) return "";
  const instr = `Você escreve mensagens de WhatsApp para as alunas e leads de um Studio de treinamento para mulheres (SlimFit — Setor Bueno, Goiânia; público adulto e de alto padrão; comunicação acolhedora e assertiva).
Escreva UMA mensagem de campanha (disparo em massa) a partir do PEDIDO abaixo. Regras:
- Português do Brasil, tom amigável e humano de WhatsApp — acolhedor e direto, nada de linguagem corporativa.
- Curta: 2 a 5 linhas curtas. Pode usar 1–2 emojis e *negrito* do WhatsApp com moderação.
- Use o marcador literal {nome} UMA vez, logo no começo (ex.: "Oi, {nome}!") — ele é trocado depois pelo nome da pessoa.
- NÃO invente preço, data, desconto ou promoção que não esteja no pedido. Se o pedido não trouxer números, faça um convite sem inventar valores.
- Responda APENAS com o texto da mensagem: sem aspas em volta, sem markdown de bloco, sem explicação.

Pedido:
"""${pedido}"""`;
  try {
    const resp = await comRetry(() =>
      anthropic.messages.create({
        model: MODELO_CONVERSA,
        max_tokens: 700,
        messages: [{ role: "user", content: instr }],
      }),
    );
    const txt = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("").trim();
    return txt.replace(/^"+|"+$/g, "").trim();
  } catch (e: any) {
    console.log("⚠️  gerarTextoCampanha falhou:", e?.message ?? e);
    return "";
  }
}

// Resumo curto e natural de UMA sessão de atendimento (para a aba Contatos →
// Interações do painel). Recebe as linhas da conversa e devolve 2–4 frases em
// português. Usado pelo listener quando uma sessão encerra. Best-effort: em
// qualquer falha devolve "" (o painel mostra um aviso simpático no lugar).
export async function resumirConversa(linhas: { autor: string; texto: string }[]): Promise<string> {
  const texto = (linhas || [])
    .map((l) => `${l.autor === "aluna" ? "Aluna" : l.autor === "humano" ? "Atendente" : "SoFIA"}: ${l.texto}`)
    .join("\n")
    .slice(0, 8000);
  if (!texto.trim()) return "";
  try {
    const resp = await comRetry(() =>
      anthropic.messages.create({
        model: MODELO_EXTRACAO,
        max_tokens: 260,
        system:
          "Você resume atendimentos de um Studio de treinamento para mulheres (SlimFit). " +
          "Leia a conversa entre a aluna e a SoFIA (assistente) e escreva um resumo curto em português do Brasil, " +
          "de 2 a 4 frases, dizendo o que a aluna queria e como terminou (agendou aula experimental? ficou de pensar? " +
          "tirou dúvida de plano ou preço? não respondeu?). Seja objetivo e fiel — não invente nada. Sem listas, sem títulos.",
        messages: [{ role: "user", content: `Resuma este atendimento:\n\n${texto}` }],
      }),
    );
    return resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("").trim();
  } catch (e: any) {
    console.log("⚠️  resumirConversa falhou:", e?.message ?? e);
    return "";
  }
}

// Classifica a conversa contra uma lista de regras de tag por INTENÇÃO (gatilho
// 'ia'). Cada regra tem { tag, instrucao }. A SoFIA lê a conversa e devolve os
// NOMES das tags cuja intenção se aplica AGORA (com base na última mensagem da
// aluna + contexto). Uma única chamada cobre todas as regras. Best-effort:
// qualquer falha devolve [] (nenhuma tag é aplicada). Usa o modelo de extração
// (mais barato/rápido) e só é chamada quando existe ao menos uma regra 'ia'.
export async function classificarIntencaoTags(
  linhas: { autor: string; texto: string }[],
  regras: { tag: string; instrucao: string }[],
): Promise<string[]> {
  const regrasValidas = (regras || []).filter((r) => r && r.tag && r.instrucao);
  if (!regrasValidas.length) return [];
  const texto = (linhas || [])
    .map((l) => `${l.autor === "aluna" ? "Aluna" : l.autor === "humano" ? "Atendente" : "SoFIA"}: ${l.texto}`)
    .join("\n")
    .slice(0, 6000);
  if (!texto.trim()) return [];
  const catalogo = regrasValidas.map((r, i) => `${i + 1}. "${r.tag}" — ${r.instrucao}`).join("\n");
  try {
    const resp = await comRetry(() =>
      anthropic.messages.create({
        model: MODELO_EXTRACAO,
        max_tokens: 120,
        system:
          "Você classifica conversas de atendimento de um Studio de treinamento para mulheres (SlimFit). " +
          "Dada a conversa entre a aluna e a SoFIA e uma lista de tags (cada uma com uma descrição de quando aplicar), " +
          "decida QUAIS tags se aplicam AGORA, com base principalmente na ÚLTIMA mensagem da aluna e no contexto. " +
          "Seja conservador: só marque uma tag quando a intenção descrita realmente aparece. " +
          "Responda SOMENTE com um array JSON dos nomes EXATOS das tags que se aplicam (ex.: [\"Preço\"]). " +
          "Se nenhuma se aplica, responda [].",
        messages: [{ role: "user", content: `CONVERSA:\n${texto}\n\nTAGS:\n${catalogo}\n\nResponda apenas com o array JSON:` }],
      }),
    );
    const bruto = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const m = bruto.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    const nomes = arr.map((x) => String(x || "").trim());
    // Só devolve nomes que realmente existem nas regras (evita tag inventada).
    return regrasValidas.filter((r) => nomes.includes(r.tag)).map((r) => r.tag);
  } catch (e: any) {
    console.log("⚠️  classificarIntencaoTags falhou:", e?.message ?? e);
    return [];
  }
}

// Gera UMA mensagem de follow-up (retomada) para uma lead que esfriou sem agendar,
// com base nas últimas mensagens da conversa + uma instrução do Studio. Curta,
// calorosa e no tom da SoFIA. Retorna "" se não conseguir (o chamador não envia).
export async function gerarFollowup(
  linhas: { autor: string; texto: string }[],
  instrucao: string,
): Promise<string> {
  const texto = (linhas || [])
    .map((l) => `${l.autor === "aluna" ? "Aluna" : l.autor === "humano" ? "Atendente" : "SoFIA"}: ${l.texto}`)
    .join("\n")
    .slice(0, 6000);
  const instr = (instrucao || "").trim() ||
    "Pergunte, de forma leve, se ela ainda tem interesse em conhecer o Studio e retome o convite para a aula experimental gratuita.";
  try {
    const resp = await comRetry(() =>
      anthropic.messages.create({
        model: MODELO_CONVERSA,
        max_tokens: 320,
        system:
          "Você é a SoFIA, atendente virtual do SlimFit (Studio de treinamento para mulheres). " +
          "Uma lead conversou com você e parou de responder SEM agendar a aula experimental. " +
          "Escreva UMA única mensagem de WhatsApp para retomar a conversa, curta (1 a 3 frases), " +
          "calorosa e natural — como uma atendente humana, não robótica. Use o contexto da conversa " +
          "abaixo para ser específica quando fizer sentido. Não invente informações, não repita algo " +
          "que você já disse igual, não seja insistente. Português do Brasil. Responda APENAS com o " +
          "texto da mensagem, sem aspas, sem explicação.\n\nOrientação do Studio: " + instr,
        messages: [{ role: "user", content: `Conversa até aqui:\n\n${texto || "(sem histórico registrado)"}\n\nEscreva a mensagem de retomada:` }],
      }),
    );
    return resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("").trim();
  } catch (e: any) {
    console.log("⚠️  gerarFollowup falhou:", e?.message ?? e);
    return "";
  }
}

interface ResumoAgendamento { nome_completo: string; email: string; dia: string; hora: string; }

async function extrairResumo(conversa: Conversa, nomeWhatsapp: string): Promise<ResumoAgendamento> {
  const transcricaoTexto = conversa.transcricao
    .map((m) => `${m.autor === "aluna" ? "Aluna" : "Sofia"}: ${m.texto}`)
    .join("\n");

  const resp = await comRetry(() =>
    anthropic.messages.create({
      model: MODELO_EXTRACAO,
      max_tokens: 300,
      // Cacheia o prompt de extração (fixo e reusado) — leitura barata nas próximas.
      system: [{ type: "text", text: carregarPromptExtracao(), cache_control: { type: "ephemeral" } }] as any,
      messages: [{ role: "user", content: `Nome do WhatsApp: ${nomeWhatsapp}\n\nConversa:\n${transcricaoTexto}` }],
    }),
  );

  const texto = resp.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  try { return JSON.parse(texto) as ResumoAgendamento; }
  catch { return { nome_completo: "", email: "", dia: "", hora: "" }; }
}

async function verificarEDispararAgendamento(telefone: string, conversa: Conversa) {
  if (conversa.resumoEnviado) return;
  if (conversa.solicitou) return; // a ferramenta solicitar_agendamento já cuidou — não duplica

  // GATILHO: só tenta extrair depois que um e-mail apareceu na conversa.
  // Checagem local (sem chamar API) — evita gasto/erro no começo do papo.
  const temEmail = conversa.transcricao.some(
    (m) => m.autor === "aluna" && /\S+@\S+\.\S+/.test(m.texto),
  );
  if (!temEmail) return;

  const nomeWhatsapp = "Aluna WhatsApp"; // no real: vem do perfil do contato (webhook)
  const resumo = await extrairResumo(conversa, nomeWhatsapp);

  const completo = resumo.nome_completo && resumo.email && resumo.dia && resumo.hora;
  if (!completo) return;

  await enviarParaSeuSistema(telefone, resumo);
  conversa.resumoEnviado = true;
}

// URL e token do seu serviço Python (o formulário que já roda no Render).
// Padrão = seu form no Render. Sobrescreva com:  set SOFIA_BOOK_URL=...
const SOFIA_BOOK_URL = process.env.SOFIA_BOOK_URL || "https://sf-formularioexperimental.onrender.com/api/book-sofia";
const SOFIA_TOKEN = process.env.SOFIA_TOKEN || "";

type ResultadoAgendamento =
  | { ok: true; when: string }
  | { lotada: true; alternativas: string[] }
  | { erro: true; detalhe?: string };

// Registra um agendamento bem-sucedido num arquivo que o PAINEL consome para
// (a) auto-etiquetar o contato e (b) avisar no WhatsApp — configurável por tag.
const AGENDOU_FILE = path.join(BASE_DIR, "sofia-agendou.jsonl");
function registrarAgendamento(telefone: string, nome: string, when: string) {
  try {
    const tel = String(telefone || "").replace(/\D/g, "");
    if (!tel) return;
    fs.appendFileSync(AGENDOU_FILE, JSON.stringify({ telefone: tel, nome: nome || "", when: when || "", em: Date.now() }) + "\n", "utf8");
  } catch (e: any) { console.log("⚠️  registrarAgendamento falhou:", e?.message ?? e); }
}

// Caminho ÚNICO de agendamento no EVO (via o formulário). Devolve o resultado
// REAL para quem chamou — usado pela ferramenta solicitar_agendamento e pelo
// fallback automático. A aluna manda "dia"/"hora" em linguagem natural OU já
// vem "AAAA-MM-DD HH:MM"; o parse do Python resolve a data real.
async function bookNoEvo(telefone: string, nome: string, email: string, when: string): Promise<ResultadoAgendamento> {
  const corpo = { nome, email, telefone, when };
  let resp: any;
  try {
    resp = await comRetry(async () => {
      const r = await fetch(SOFIA_BOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sofia-Token": SOFIA_TOKEN },
        body: JSON.stringify(corpo),
      });
      // 5xx é temporário → deixa o comRetry tentar de novo. 4xx é definitivo.
      if (r.status >= 500) throw Object.assign(new Error(`EVO/serviço ${r.status}`), { status: r.status });
      return r;
    });
  } catch (e: any) {
    console.log("⚠️  Falha ao agendar no EVO (rede/serviço):", e?.message ?? e);
    return { erro: true, detalhe: e?.message };
  }

  const data: any = await resp.json().catch(() => ({}));

  if (resp.ok && data.ok) {
    console.log(`✅ AGENDADO NO EVO: ${nome} em ${data.when} (idProspect=${data.idProspect})`);
    registrarAgendamento(telefone, nome, data.when); // avisa o painel (auto-tag + notificação)
    return { ok: true, when: data.when };
  }
  // Turma cheia/indisponível: o lead já ficou cadastrado no EVO; a Sofia oferece
  // as alternativas retornadas para a aluna escolher outro horário.
  if (resp.status === 409) {
    const alternativas = Array.isArray(data.alternativas) ? data.alternativas.filter(Boolean) : [];
    console.log(`⚠️  Sem vaga para ${nome}. Alternativas:`, alternativas);
    return { lotada: true, alternativas };
  }
  console.log("⚠️  Falha ao agendar no EVO:", resp.status, data);
  return { erro: true, detalhe: data?.erro };
}

async function enviarParaSeuSistema(telefone: string, resumo: ResumoAgendamento): Promise<ResultadoAgendamento> {
  return bookNoEvo(telefone, resumo.nome_completo, resumo.email, `${resumo.dia} às ${resumo.hora}`);
}

// ══════════════════════════════════════════════════════════════════════════
// 7) TESTES
// ══════════════════════════════════════════════════════════════════════════
async function testeAutomatico() {
  const ALUNA = "+5562911111111";
  const fala = async (t: string) => { console.log("\n👤", t); console.log("🤖", await responderComMemoria(ALUNA, t)); };
  await fala("Oi! Quero agendar uma aula experimental");
  await fala("Meu nome é Bruna Souza de Melo");
  await fala("meu email é BRUNA.MELO @gmail.com");
  await fala("pode ser quinta-feira às 9h30"); // os 4 campos fecham → deve disparar
}

async function chatInterativo() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const telefone = "+5562900000000";
  console.log('Chat com a Sofia (digite "sair" para encerrar)\n');
  while (true) {
    const msg = await rl.question("👤 Você: ");
    if (msg.trim().toLowerCase() === "sair") break;
    console.log("🤖 Sofia:", await responderComMemoria(telefone, msg), "\n");
  }
  rl.close();
}

// Só roda o teste/chat quando a sofia.ts é executada DIRETAMENTE (tsx sofia.ts).
// Quando é IMPORTADA (pelo sofia-listener.ts), não dispara nada.
const _ehEntrada = /(^|[\\/])sofia\.ts$/.test(process.argv[1] || "");
if (_ehEntrada) {
  if (process.argv.includes("--chat")) chatInterativo().catch(console.error);
  else testeAutomatico().catch(console.error);
}

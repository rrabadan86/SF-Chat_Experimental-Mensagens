/**
 * ══════════════════════════════════════════════════════════════════════════
 *  SOFIA — Chatbot completo do SlimFit Studio (unidade configurável via painel/.env)
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
// Preço aproximado por modelo (US$ por 1 MILHÃO de tokens: entrada / saída).
// Usado para ESTIMAR o custo das chamadas fora da conversa (gerador, resumos,
// tags, follow-up), que usam a API messages e não trazem total_cost_usd. Ajustável.
const PRECO_MODELO: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
};
function custoUSD(model: string, inTok: number, outTok: number): number {
  const m = String(model || "").toLowerCase();
  const p = m.includes("opus") ? PRECO_MODELO.opus : m.includes("haiku") ? PRECO_MODELO.haiku : PRECO_MODELO.sonnet;
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}
// Registra o uso de uma chamada messages.create (usage → tokens + custo estimado).
function registrarUso(tipo: string, model: string, resp: any) {
  try {
    const u: any = (resp && resp.usage) || {};
    const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const outTok = u.output_tokens || 0;
    registrarCusto({ tipo, model, inTok, outTok, usd: custoUSD(model, inTok, outTok) });
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
  // Sem imagem definida (arquivo vivo / env vazios) a Sofia simplesmente não
  // envia a imagem — nada de imagem de outra unidade. Defina grade/preços no
  // painel (SoFIA → Configuração) ou por MIDIA_*.
  grade_imagem: _mid.grade_imagem || process.env.MIDIA_GRADE_IMG || "",
  grade_link: _mid.grade_link || process.env.MIDIA_GRADE_LINK || "",
  precos_imagem: _mid.precos_imagem || process.env.MIDIA_PRECOS_IMG || "",
  precos_link: _mid.precos_link || process.env.MIDIA_PRECOS_LINK || "",
};

// ══════════════════════════════════════════════════════════════════════════
// 2) GRADE DE HORÁRIOS EM QUE HÁ AULA (0=domingo ... 6=sábado)
// ══════════════════════════════════════════════════════════════════════════
// A SoFIA descobre QUE horários existem em cada dia DIRETO DO EVO (via /api/slots do
// formulário — a mesma fonte da vaga). Assim CADA unidade usa a SUA grade real, sempre
// em sincronia, sem ninguém manter nada à mão. A grade abaixo (SOFIA_GRADE no .env ou
// sofia-grade.json no SOFIA_DIR) é só uma RESERVA OPCIONAL, usada se o EVO não responder
// naquele instante. Sem reserva e com o EVO fora, a SoFIA NÃO rejeita por existência —
// a marcação valida ao vivo no EVO.
const GRADE_FILE = path.join(BASE_DIR, "sofia-grade.json");
// Aceita {0..6:[...]} (chaves número ou string), filtra só "HH:MM" válidos.
function normalizarGrade(o: unknown): Record<number, string[]> {
  const g: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  if (o && typeof o === "object") {
    for (let d = 0; d <= 6; d++) {
      const v = (o as Record<string, unknown>)[d] ?? (o as Record<string, unknown>)[String(d)];
      if (Array.isArray(v)) g[d] = v.filter((x): x is string => typeof x === "string" && /^\d{1,2}:\d{2}$/.test(x));
    }
  }
  return g;
}
// Reserva configurada (SOFIA_GRADE no .env, ou sofia-grade.json no SOFIA_DIR — o painel
// edita, vale sem reiniciar). Devolve null se NADA estiver configurado; aí a SoFIA é
// tolerante quando o EVO falha (não inventa a grade de outra unidade).
function lerGradeConfigurada(): Record<number, string[]> | null {
  let doArquivo = "";
  try { doArquivo = fs.readFileSync(GRADE_FILE, "utf-8"); } catch { /* sem arquivo */ }
  for (const raw of [process.env.SOFIA_GRADE, doArquivo]) {
    if (!raw) continue;
    try {
      const g = normalizarGrade(JSON.parse(raw));
      if (Object.values(g).some((a) => a.length)) return g; // só usa se tiver ao menos 1 horário
    } catch { /* JSON inválido → tenta a próxima fonte */ }
  }
  return null;
}
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

// Busca a grade REAL do EVO (via /api/slots que o formulário expõe): mapa
// data(AAAA-MM-DD) -> lista de slots { time, activityDate, disponivel, freeSpots }.
// Devolve null se a rede/serviço falhar — aí o chamador usa o fallback local.
async function buscarSlots(): Promise<Record<string, any[]> | null> {
  const base = process.env.SOFIA_BOOK_URL || "https://sf-formularioexperimental.onrender.com/api/book-sofia";
  const slotsUrl = process.env.SOFIA_SLOTS_URL || base.replace(/\/api\/book-sofia\/?$/, "/api/slots");
  try {
    const r = await comRetry(async () => {
      const resp = await fetch(slotsUrl + "?days=10", { headers: { Accept: "application/json" } });
      if (resp.status >= 500) throw Object.assign(new Error(`slots ${resp.status}`), { status: resp.status });
      return resp;
    });
    const j: any = await r.json().catch(() => ({}));
    return (j && j.dias) || {};
  } catch (e: any) {
    console.log("⚠️  buscarSlots falhou:", e?.message ?? e);
    return null;
  }
}
// Horários (HH:MM) que EXISTEM num dia, direto do EVO (a grade real da unidade).
//  - string[] (mesmo os cheios) quando o feed cobre essa data;
//  - []   quando a data está DENTRO do alcance do feed mas sem aula (dia fechado);
//  - null quando o feed está indisponível/vazio, ou a data está FORA do alcance —
//    aí o chamador usa a reserva configurada ou é tolerante (não rejeita).
async function horariosDoDiaEvo(dataISO: string): Promise<string[] | null> {
  const dias = await buscarSlots();
  if (!dias) return null;
  const keys = Object.keys(dias);
  if (keys.length === 0) return null;
  if (Array.isArray(dias[dataISO])) return dias[dataISO].map((s: any) => String(s.time).slice(0, 5));
  keys.sort();
  if (dataISO >= keys[0] && dataISO <= keys[keys.length - 1]) return []; // no alcance, sem aula
  return null; // fora do alcance do feed
}

// Imagens que a Sofia pediu para enviar NESTA resposta. O listener (WhatsApp)
// drena esta fila logo após responderComMemoria e envia as imagens de verdade.
// (é resetada no início de cada responderComMemoria; o listener serializa as
// mensagens, então não há corrida entre conversas.)
// Cada imagem pedida nesta resposta guarda o arquivo (imagem) E o link que a SoFIA
// cita no texto. O listener usa o link para soltar a foto logo DEPOIS da bolha que a
// anuncia (ex.: "aqui está a grade: <link>"), em vez de jogar tudo no fim.
let _midiasDaVez: { imagem: string; link: string }[] = [];
export function drenarMidias(): { imagem: string; link: string }[] { const m = _midiasDaVez; _midiasDaVez = []; return m; }

const enviarMidia = tool(
  "enviar_midia",
  "Envia uma imagem para a usuária. 'grade' = grade de horários; 'precos' = tabela de preços 2026.",
  { tipo: z.enum(["grade", "precos"]).describe("Qual imagem enviar") },
  async ({ tipo }) => {
    const url = tipo === "grade" ? MIDIAS.grade_imagem : MIDIAS.precos_imagem;
    const link = tipo === "grade" ? MIDIAS.grade_link : MIDIAS.precos_link;
    if (url) _midiasDaVez.push({ imagem: url, link }); // o listener envia a foto logo após a bolha que cita o link
    console.log(`🖼️  [ENVIAR IMAGEM] ${tipo}: ${url}`);
    return { content: [{ type: "text", text: `Imagem "${tipo}" enviada. Link: ${link}` }] };
  },
);

const verificarDisponibilidade = tool(
  "verificar_disponibilidade",
  "Verifica se dia/horário da aula experimental são válidos, aplicando a regra de antecedência. " +
    "SEMPRE use antes de confirmar agendamento. Nunca invente horário — use só o que retornar aqui. " +
    "É PROIBIDO dizer que um horário 'está ok/certinho/dá certo/disponível' — e PROIBIDO pedir nome/e-mail — " +
    "sem ANTES ter chamado consultar_vaga (vaga) E verificar_disponibilidade para EXATAMENTE aquele dia e horário.",
  {
    data_desejada: z.string().describe("Data no formato AAAA-MM-DD, ex: '2026-07-30'"),
    horario_desejado: z.string().describe("Horário no formato HH:MM, ex: '08:15'"),
  },
  async ({ data_desejada, horario_desejado }) => {
    const agora = new Date();
    const alvo = new Date(`${data_desejada}T${horario_desejado}:00-03:00`);
    const diaSemana = alvo.getDay();
    const hh = String(horario_desejado).slice(0, 5);
    // QUE horários existem no dia: PRIMEIRO do EVO (feed real da unidade — cada franquia
    // tem a sua grade, sempre em sincronia, sem manutenção). Se o feed não cobrir a data
    // (vazio/fora do alcance), usa a RESERVA configurada (SOFIA_GRADE/sofia-grade.json)
    // se houver; senão, NÃO checa existência aqui — a marcação valida ao vivo no EVO
    // (assim nunca dizemos "não existe" por causa de um soluço do feed).
    let slots: string[] | null = await horariosDoDiaEvo(data_desejada);
    if (slots === null) {
      const reserva = lerGradeConfigurada();
      slots = reserva ? (reserva[diaSemana] ?? []) : null;
    }
    if (slots !== null) {
      if (slots.length === 0)
        return json({ valido: false, motivo: `Não há aula na ${DIAS[diaSemana]}.`, opcoes_do_dia: [] });
      if (!slots.includes(hh))
        return json({ valido: false, motivo: `${horario_desejado} não existe na ${DIAS[diaSemana]}.`, opcoes_do_dia: slots });
    }

    const diaAgora = agora.getDay();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const emJanelaSemana =
      (diaAgora >= 2 && diaAgora <= 4) ||
      (diaAgora === 1 && minutosAgora > paraMinutos("07:00")) ||
      (diaAgora === 5 && minutosAgora <= paraMinutos("17:30"));

    if (emJanelaSemana) {
      const horas = (alvo.getTime() - agora.getTime()) / 3_600_000;
      if (horas < 4)
        return json({ valido: false, motivo: "Em dias úteis é preciso pelo menos 4h de antecedência.", opcoes_do_dia: slots ?? [] });
    } else {
      const segundaTarde = proximaSegundaTarde(agora);
      if (alvo < segundaTarde)
        return json({ valido: false, motivo: "No fim de semana só agendamos a partir de segunda-feira à tarde.", primeiro_horario_valido: "segunda-feira à tarde" });
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
    "passe qualquer hora do dia só para consultar. É PROIBIDO confirmar um horário ('está ok/certinho/dá certo') " +
    "ou pedir nome/e-mail sem ANTES chamar esta ferramenta para aquele dia/horário e receber vaga=true. Se a aluna " +
    "mudar de dia/horário durante a conversa, chame de novo para o NOVO dia/horário antes de confirmar. " +
    "Se vaga=true, prossiga. Se vaga=false, ofereça SOMENTE os " +
    "horários de 'disponiveis_do_dia' (os que têm vaga NAQUELE dia); se esse estiver vazio, use 'alternativas' " +
    "(outros dias). NUNCA ofereça horário que não esteja em disponiveis_do_dia/alternativas — não use a grade "
    + "para dizer o que está disponível. Complementa a verificar_disponibilidade (que só checa grade/antecedência).",
  { data: z.string().describe("AAAA-MM-DD"), horario: z.string().describe("HH:MM") },
  async ({ data, horario }) => {
    const hh = String(horario).slice(0, 5);
    const dias = await buscarSlots();
    // Se a grade não responder, NÃO trava o atendimento: segue (a
    // solicitar_agendamento ainda valida a vaga de verdade na hora de agendar).
    if (dias === null) return json({ vaga: null, indisponivel_checar: true });
    // Feed SEM NENHUM dia = a grade ainda não chegou/está "aquecendo" no formulário
    // (Render pode ter reiniciado e perdido a grade empurrada). NUNCA afirme que o
    // horário não existe nesse caso — deixe seguir e confirmar a vaga depois.
    if (Object.keys(dias).length === 0)
      return json({ vaga: null, indisponivel_checar: true, nota: "Não consegui conferir as vagas agora (grade indisponível). NÃO diga que o horário não existe nem que não tem vaga: diga que vai confirmar a disponibilidade e siga, ou que a secretária confirma." });
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
  },
);

// ══ Ferramentas de ALUNA CONTRATADA (remarcação com reposição) ═══════════
// Só valem para quem já é aluna (tag "alunas"). O telefone vem do listener.
const consultarAgendaAluna = tool(
  "consultar_agenda_aluna",
  "Mostra as aulas JÁ MARCADAS da aluna contratada (não serve para leads/experimental). " +
    "Use quando ela falar em remarcar, trocar de horário, cancelar ou perguntar que dia tem aula. " +
    "Retorna 'encontrada:false' se o telefone não for de aluna contratada — nesse caso trate como lead.",
  {},
  async () => {
    const tel = _telefoneDaVez || "";
    if (!tel) return json({ erro: "sem telefone" });
    const m = await apiAluna("/api/aluna/buscar", { telefone: tel });
    if (!m?.ok || !m.encontrada) return json({ encontrada: false });
    const ag = await apiAluna("/api/aluna/agenda", { idMember: m.idMember });
    return json({ encontrada: true, nome: m.nome, idMember: m.idMember, aulas: ag?.sessoes || [] });
  },
);

const consultarContratoAluna = tool(
  "consultar_contrato_aluna",
  "Dados do CONTRATO da aluna: plano, até quando vale, se está trancado (e até quando), " +
    "dias de trancamento usados e restantes, e quantas reposições ela tem. " +
    "Use quando ela perguntar sobre o contrato, vencimento, trancamento ou reposições. " +
    "NÃO traz valores/parcelas de propósito: dinheiro é assunto da recepção.",
  {},
  async () => {
    const tel = _telefoneDaVez || "";
    if (!tel) return json({ erro: "sem telefone" });
    const r = await apiAluna("/api/aluna/contrato", { telefone: tel });
    if (!r?.ok || r.encontrada === false) return json({ encontrada: false });
    // O financeiro é removido aqui: a Sofia nunca vê valor nem data de cobrança.
    const { valor_proxima_cobranca, proxima_cobranca, ...semDinheiro } = r;
    return json({ ...semDinheiro, financeiro: "encaminhar para a recepção" });
  },
);

const turmasDoDia = tool(
  "turmas_do_dia",
  "Lista as turmas de um dia com horário e VAGAS, para a aluna escolher o novo horário na remarcação. " +
    "Ofereça só as que têm vaga. Use antes de remarcar_aula.",
  { data: z.string().describe("AAAA-MM-DD") },
  async ({ data }) => json(await apiAluna("/api/aluna/turmas", { data })),
);

const remarcarAula = tool(
  "remarcar_aula",
  "REMARCA de verdade a aula da aluna contratada. Só chame DEPOIS de ela CONFIRMAR o novo horário " +
    "com todas as letras. Regra do Studio: 1 aula por dia — se já houver aula no mesmo dia, ela é " +
    "desmarcada automaticamente. Aja pelo retorno: ok=confirme com alegria e, se vier " +
    "'proxima_aula_outro_dia', pergunte se ela quer manter essa próxima aula; " +
    "motivo=nao_foi_possivel_marcar (ex.: sem reposição) => avise que a recepção vai chamá-la; " +
    "turma_lotada/turma_nao_roda_nesse_dia => ofereça as 'turmas_do_dia' que vierem no retorno.",
  {
    idMember: z.number().describe("Da consultar_agenda_aluna"),
    idConfiguration: z.number().describe("Turma escolhida, da turmas_do_dia"),
    data: z.string().describe("AAAA-MM-DD"),
  },
  async ({ idMember, idConfiguration, data }) => {
    console.log("📋 [SOFIA VAI REMARCAR]", { idMember, idConfiguration, data });
    const r = await apiAluna("/api/aluna/remarcar", { idMember, idConfiguration, activityDate: data, simular: false });
    // Sem reposição/cota: avisa a recepção pelo WhatsApp configurado no painel.
    if (r && r.ok === false && r.motivo) {
      try { avisarRecepcao(_telefoneDaVez || "", r.motivo); } catch (_) {}
    }
    return json(r);
  },
);

const servidor = createSdkMcpServer({
  name: "slimfit",
  version: "1.0.0",
  tools: [enviarMidia, verificarDisponibilidade, consultarVaga, solicitarAgendamento,
         consultarAgendaAluna, consultarContratoAluna, turmasDoDia, remarcarAula],
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
const HUMANO_LOCK_FILE = path.join(BASE_DIR, "sofia-humano-lock.txt");
// Minutos da trava de atendimento humano (o painel grava; padrão 60 = 1 h).
function humanoLockMs(): number {
  try { const n = parseInt(String(fs.readFileSync(HUMANO_LOCK_FILE, "utf-8")).trim(), 10); if (isFinite(n) && n > 0) return n * 60_000; } catch {}
  return 60 * 60_000;
}
// Controle humano ATIVO = a conversa foi assumida no painel E ainda está dentro da
// trava. Passado o tempo, expira sozinha: a Sofia reassume a conversa. Aceita o
// valor legado (só o instante) além do novo formato { por, em }.
function controleHumanoAtivo(chave: string): boolean {
  try {
    const o = JSON.parse(fs.readFileSync(HUMANO_FILE, "utf-8"));
    const v = o && typeof o === "object" ? o[chave] : null;
    if (!v) return false;
    const em = (typeof v === "object") ? Number(v.em || 0) : Number(v || 0);
    if (!(em > 0)) return false;
    return (em + humanoLockMs()) > Date.now();
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

// ── "NÃO RESPONDER" (silenciar por número) ───────────────────────────────────
// Números que a SoFIA NUNCA responde sozinha — mesmo ligada e sem controle humano.
// Ela ainda RECEBE (aparece nas Conversas), roda as tags/automações e pode ser
// alvo de CAMPANHAS; só não gera resposta automática nem follow-up. O painel grava
// a lista (sofia-nao-responder.json, só dígitos) e o processo lê aqui a cada mensagem.
// Casa pelos ÚLTIMOS 8 dígitos, tolerando variação de DDI 55 / 9º dígito.
const NAORESP_FILE = path.join(BASE_DIR, "sofia-nao-responder.json");
function estaNaoResponder(telefone: string): boolean {
  try {
    const arr = JSON.parse(fs.readFileSync(NAORESP_FILE, "utf-8"));
    if (!Array.isArray(arr)) return false;
    const alvo = String(telefone || "").replace(/\D/g, "");
    if (!alvo) return false;
    const a8 = alvo.slice(-8);
    return arr.some((x: any) => { const d = String(x).replace(/\D/g, ""); return d.length >= 8 && d.slice(-8) === a8; });
  } catch { return false; }
}

// A Sofia deve responder ESTA conversa agora? (ligada, fora da lista "não responder",
// sem controle humano e sem handoff por tempo). Usado pelo listener p/ o aviso de
// "só texto" no áudio e para pular o follow-up.
export function deveResponder(telefone: string): boolean {
  return sofiaAtiva() && !estaNaoResponder(telefone) && !controleHumanoAtivo(telefone)
    && !conversaAssumida(telefone) && !recepcaoAtendendo(telefone);
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


const PROMPT_PADRAO = (() => {
  // Reserva de último caso: o roteiro versionado (sofia-prompt.default.txt) é a
  // FONTE ÚNICA. Só cai no fallback abaixo se o arquivo vivo não existir E o
  // .default também sumir. Assim não há um segundo roteiro duplicado no código
  // (nem dados de unidade embutidos aqui).
  try { return fs.readFileSync(comDefault(PROMPT_FILE), "utf-8"); }
  catch {
    return "Você é a *Sofia*, atendente virtual de um *SlimFit Studio*. Fale no WhatsApp de forma breve e acolhedora, tire dúvidas sobre a metodologia e ajude a agendar a aula experimental gratuita. Se não souber uma informação, diga que a secretária do Studio confirma — nunca invente.";
  }
})();

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
    "mcp__slimfit__consultar_agenda_aluna",
    "mcp__slimfit__consultar_contrato_aluna",
    "mcp__slimfit__turmas_do_dia",
    "mcp__slimfit__remarcar_aula",
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
// Detecta a MENSAGEM DE SAUDAÇÃO/AUSÊNCIA automática do WhatsApp Business de
// OUTRO negócio (ex.: "Você está falando com a equipe da Dra. X. Sou a assistente
// e farei o primeiro atendimento. Nosso horário de funcionamento é..."). Sem isto,
// a SoFIA tratava essa auto-resposta como uma lead nova e respondia com toda a
// apresentação — falando com o robô do outro lado. Aqui ela reconhece o padrão e
// fica calada (a mensagem ainda aparece no painel, para a equipe ver).
// Cuidado com falso-positivo: uma lead PODE perguntar "qual o horário de vocês?".
// Por isso só disparamos em frases que praticamente só uma auto-resposta de
// empresa contém (a empresa se apresentando / avisando ausência) — nunca em uma
// simples pergunta sobre horário. Pode ser desligado com SOFIA_DETECTAR_AUTOMATICA=0.
function pareceMensagemAutomatica(texto: string): boolean {
  if (String(process.env.SOFIA_DETECTAR_AUTOMATICA || "1") === "0") return false;
  const t = String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // sem acento
    .toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length < 25) return false; // "oi", "bom dia", "quero saber preço" = gente
  // Frases que só uma AUTO-RESPOSTA de empresa costuma conter (empresa se
  // apresentando ou avisando ausência). Qualquer uma já basta.
  const fortes = [
    "mensagem automatica", "resposta automatica", "atendimento automatico",
    "e um atendimento automatico", "nao sao automaticas",
    "assistente virtual", "sou a assistente", "sou o assistente",
    "farei o primeiro atendimento", "fara o primeiro atendimento",
    "voce esta falando com a equipe", "esta falando com a equipe",
    "voce esta falando com o", "voce entrou em contato com",
    "obrigada por entrar em contato", "obrigado por entrar em contato",
    "agradecemos o seu contato", "agradecemos seu contato",
    "recebemos a sua mensagem", "recebemos sua mensagem",
    "retornaremos", "responderemos assim que", "responderemos o mais",
    "retornaremos assim que", "em breve retornaremos", "responderemos em breve",
    "assim que possivel entraremos", "fora do nosso horario", "fora do horario de",
    "nosso horario de funcionamento e", "nosso horario de atendimento e",
    "horario de funcionamento e de", "horario de atendimento e de",
    "funcionamos de segunda", "atendemos de segunda",
    "no momento estamos ausentes", "estamos ausentes no momento",
    "nosso time respondera", "nossa equipe respondera",
  ];
  return fortes.some((f) => t.includes(f));
}

export async function responderComMemoria(telefone: string, mensagem: string, telefoneReal?: string): Promise<string> {
  _midiasDaVez = []; // zera as imagens desta resposta (o listener drena depois)
  // Interruptor geral: se estiver desligada, fica em silêncio (atendimento manual).
  // Retorna string vazia — o webhook/listener trata isso como "não enviar nada".
  if (!sofiaAtiva()) {
    console.log(`🔕 Sofia DESLIGADA — mensagem de ${telefone} não respondida (atenda manualmente).`);
    return "";
  }
  // Lista "NÃO RESPONDER" do painel: a SoFIA nunca responde sozinha este número.
  // Registra a mensagem (aparece nas Conversas e dá contexto se você responder à mão), mas cala.
  if (estaNaoResponder(telefone)) {
    registrarNaMemoria(telefone, "aluna", mensagem);
    console.log(`🔕 ${telefone} está em "não responder" — Sofia anotou a mensagem, mas não responde.`);
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
  // ALUNA CONTRATADA dentro do horário da recepção: quem atende é a recepcionista,
  // a SoFIA fica CALADA (registra a mensagem para dar contexto, mas não responde).
  // Fora desse horário, segue o fluxo normal. (recepcaoAtendendo loga o motivo.)
  if (recepcaoAtendendo(telefone)) {
    registrarNaMemoria(telefone, "aluna", mensagem);
    return "";
  }
  // MENSAGEM AUTOMÁTICA de OUTRO negócio (saudação/ausência do WhatsApp Business):
  // a SoFIA não fala com o robô do outro lado. Anota (aparece no painel) e cala.
  if (pareceMensagemAutomatica(mensagem)) {
    registrarNaMemoria(telefone, "aluna", mensagem);
    console.log(`🤖 ${telefone}: mensagem parece uma saudação/ausência automática de outro negócio — SoFIA não responde.`);
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
  // Se o contato tem a tag de ALUNA CONTRATADA, avisamos a Sofia ANTES de ela
  // responder — assim ela não faz a apresentação de boas-vindas nem pergunta
  // "já conhece a metodologia?" para quem treina há anos, mesmo que a aluna
  // tenha mandado só um "oi" (sem nenhuma palavra-chave de remarcação).
  const promptDaVez = carregarPrompt() + contextoAluna(telefone);
  const opcoesDaVez: ClaudeAgentOptions = conversa.sessionId
    ? { ...options, resume: conversa.sessionId, systemPrompt: promptDaVez }
    : { ...options, systemPrompt: promptDaVez };

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
    registrarUso("gerador", MODELO_EXTRACAO, resp); // variações da campanha
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
export async function gerarTextoCampanha(instrucao: string, model?: string): Promise<string> {
  const pedido = String(instrucao || "").trim();
  if (!pedido) return "";
  const mdl = String(model || "").trim() || MODELO_CONVERSA; // modelo escolhido no painel (ou o da conversa)
  const instr = `Você escreve mensagens de WhatsApp para as alunas e leads de um Studio de treinamento para mulheres (SlimFit; público adulto e de alto padrão; comunicação acolhedora e assertiva).
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
        model: mdl,
        max_tokens: 700,
        messages: [{ role: "user", content: instr }],
      }),
    );
    registrarUso("gerador", mdl, resp); // frase da campanha (gerador)
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
    registrarUso("resumo", MODELO_EXTRACAO, resp); // resumo de interação (Contatos)
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
    registrarUso("tags", MODELO_EXTRACAO, resp); // classificação de intenção (tags 'ia')
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
          "Escreva UMA única mensagem de WhatsApp para retomar a conversa, BEM CURTA (1 a 2 frases, " +
          "no máximo 2 linhas), leve e natural — como uma amiga, não robótica. EVITE formalidade e " +
          "frases longas: nada de 'estou à disposição', 'ficarei feliz em' ou 'assim que tiver um dia " +
          "e horário de sua preferência'. No máximo 1 emoji. Use o contexto da conversa " +
          "abaixo para ser específica quando fizer sentido. Não invente informações, não repita algo " +
          "que você já disse igual, não seja insistente. Português do Brasil. Responda APENAS com o " +
          "texto da mensagem, sem aspas, sem explicação.\n\nOrientação do Studio: " + instr,
        messages: [{ role: "user", content: `Conversa até aqui:\n\n${texto || "(sem histórico registrado)"}\n\nEscreva a mensagem de retomada:` }],
      }),
    );
    registrarUso("followup", MODELO_CONVERSA, resp); // mensagem de retomada
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
// Base do formulário (mesmo serviço do book-sofia) — usada pelas ferramentas de ALUNA.
const SOFIA_API_BASE = SOFIA_BOOK_URL.replace(/\/api\/book-sofia\/?$/, "");
async function apiAluna(rota: string, corpo: any): Promise<any> {
  const r = await fetch(`${SOFIA_API_BASE}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sofia-Token": SOFIA_TOKEN },
    body: JSON.stringify(corpo),
  });
  return await r.json().catch(() => ({ ok: false, erro: "resposta inválida" }));
}

type ResultadoAgendamento =
  | { ok: true; when: string }
  | { lotada: true; alternativas: string[] }
  | { erro: true; detalhe?: string };

// Registra um agendamento bem-sucedido num arquivo que o PAINEL consome para
// (a) auto-etiquetar o contato e (b) avisar no WhatsApp — configurável por tag.
const AGENDOU_FILE = path.join(BASE_DIR, "sofia-agendou.jsonl");
// Lê as regras da tag "alunas" (janela da recepção + número de aviso), gravadas
// pelo painel em sofia-alunas.json. Sem o arquivo, usa os padrões.
const ALUNAS_FILE = path.join(BASE_DIR, "sofia-alunas.json");
function lerAlunasCfg(): { ativo: boolean; janelaIni: string; janelaFim: string; recepcaoNumero: string; tag: string } {
  const padrao = { ativo: true, janelaIni: "05:45", janelaFim: "16:30", recepcaoNumero: "", tag: "alunas" };
  try { return { ...padrao, ...JSON.parse(fs.readFileSync(ALUNAS_FILE, "utf8")) }; } catch { return padrao; }
}

// Avisa a recepção quando a SoFIA não consegue resolver sozinha (ex.: a aluna
// pediu remarcação mas não há reposição disponível). Usa a mesma fila de avisos
// que o listener já envia pelo WhatsApp.
// Contatos/tags são mantidos pelo painel; sobrescreva com CONTATOS_FILE se a
// sua instalação for diferente. Procura o contatos.json nos lugares onde ele costuma ficar (a Sofia roda de
// ChatBot/, mas o painel guarda o arquivo em Experimental/data/). Se nenhum
// existir, fica com o palpite padrão — temTagAluna trata a falta do arquivo.
// IMPORTANTE: BASE_DIR = SOFIA_DIR (ex.: /root/sofia-data), que NÃO é o
// repositório. O contatos.json é escrito pelo painel em <repo>/Experimental/data.
// Como a Sofia roda de <repo>/ChatBot, o caminho confiável é a partir de
// process.cwd() (a pasta ChatBot), não de BASE_DIR — foi por isso que a tag de
// aluna não era vista e a aluna era tratada como lead.
const CONTATOS_CANDIDATOS = [
  process.env.CONTATOS_FILE || "",
  path.resolve(process.cwd(), "..", "Experimental", "data", "contatos.json"),
  path.resolve(process.cwd(), "Experimental", "data", "contatos.json"),
  path.resolve(BASE_DIR, "..", "Experimental", "data", "contatos.json"),
  path.resolve(BASE_DIR, "..", "..", "Experimental", "data", "contatos.json"),
  path.resolve(BASE_DIR, "Experimental", "data", "contatos.json"),
  path.resolve(BASE_DIR, "data", "contatos.json"),
].filter(Boolean);
const CONTATOS_FILE = CONTATOS_CANDIDATOS.find((f) => { try { return fs.existsSync(f); } catch { return false; } })
  || CONTATOS_CANDIDATOS[CONTATOS_CANDIDATOS.length - 1];
try {
  const achou = fs.existsSync(CONTATOS_FILE);
  console.log(`📇 contatos.json: ${achou ? "usando " + CONTATOS_FILE : "NÃO ENCONTRADO (tags de aluna não funcionam). Defina CONTATOS_FILE no .env."}`);
} catch {}

// Compara etiquetas do jeito que a recepção escreve na vida real: a tag do
// painel pode vir como "0. Aluna", "Alunas", "aluna " ou "ALUNA". Tiramos
// acento, pontuação, numeração de ordenação ("0.", "FX-2.") e o plural, então
// todas essas grafias caem na MESMA chave. Sem isso, "0. Aluna" no contato não
// casava com "alunas" na configuração e a SoFIA tratava a aluna como lead.
function chaveTag(v: any): string {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // sem acento
    .toLowerCase()
    .replace(/^\s*[a-z]{0,3}[-\s]?\d+[.)\-]\s*/, "")   // "0. ", "1) ", "FX-2. "
    .replace(/[^a-z0-9]+/g, "")                          // só letras/números
    .replace(/s$/, "");                                  // singular = plural
}

function temTagAluna(telefone: string): boolean {
  try {
    const alvo = chaveTag(lerAlunasCfg().tag || "alunas");
    if (!alvo) return false;
    const ult8 = String(telefone || "").replace(/\D/g, "").slice(-8);
    if (!ult8) return false;
    const bruto = JSON.parse(fs.readFileSync(CONTATOS_FILE, "utf8"));
    const lista: any[] = Array.isArray(bruto) ? bruto : Object.values(bruto || {});
    for (const c of lista) {
      const t = String(c?.tel || c?.telefone || "").replace(/\D/g, "");
      if (t && t.endsWith(ult8)) {
        return (c?.tags || []).some((x: any) => chaveTag(x) === alvo);
      }
    }
  } catch { /* sem arquivo/contato = não é aluna */ }
  return false;
}

// True quando o contato está marcado como "sem interesse" no painel. Usada para
// NÃO disparar follow-up de reengajamento a quem já disse que não quer — a tag
// vem escrita como "FX - 0. Sem interesse" (com prefixo de ordenação), então
// comparamos por conteúdo normalizado (sem acento/pontuação) contendo
// "seminteresse", em vez de igualdade exata de chave.
export function temTagSemInteresse(telefone: string): boolean {
  try {
    const ult8 = String(telefone || "").replace(/\D/g, "").slice(-8);
    if (!ult8) return false;
    const bruto = JSON.parse(fs.readFileSync(CONTATOS_FILE, "utf8"));
    const lista: any[] = Array.isArray(bruto) ? bruto : Object.values(bruto || {});
    const norm = (v: any) => String(v || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "");
    for (const c of lista) {
      const t = String(c?.tel || c?.telefone || "").replace(/\D/g, "");
      if (t && t.endsWith(ult8)) {
        return (c?.tags || []).some((x: any) => norm(x).includes("seminteresse"));
      }
    }
  } catch { /* sem arquivo/contato = trata como não marcado */ }
  return false;
}

// True quando a RECEPÇÃO está no expediente e o contato é aluna contratada —
// nesse caso a Sofia não responde (quem atende é a recepcionista).
// A janela pode virar a meia-noite (ex.: 17:00–07:00).
// Aviso anexado ao prompt quando o contato JÁ É ALUNA (tag do painel). Resolve o
// caso da aluna que manda só "oi": sem isso a Sofia se apresentaria como se fosse
// a primeira conversa dela com o Studio.
function contextoAluna(telefone: string): string {
  try {
    // A regra de aluna é controlada pelo interruptor "Ligado" (sofia-alunas.json).
    // Desligada (ex.: instância dos LEADS, número A) → nenhum tratamento de aluna:
    // esta instância trata todo mundo como lead/primeiro contato.
    if (!lerAlunasCfg().ativo) return "";
    if (!temTagAluna(telefone)) return "";
    return `

# CONTEXTO DESTA CONVERSA (vale ACIMA da seção SAUDAÇÃO INICIAL)
- Esta pessoa JÁ É ALUNA CONTRATADA do Studio — ela treina aqui. Não é lead.
- NÃO se apresente, NÃO explique o que é o SlimFit e NÃO pergunte "você já conhece
  a nossa metodologia?". Ela conhece. Isso vale mesmo que a mensagem dela seja só "oi".
- NÃO ofereça aula experimental gratuita nem tabela de preços por iniciativa própria.
- Cumprimente de forma breve e calorosa (use o nome dela quando souber) e pergunte
  como pode ajudar. Ex.: "Oi, [nome]! 😊 Como posso te ajudar?"
- Se ela falar em remarcar/desmarcar/reposição/horário, siga a seção ALUNAS CONTRATADAS.`;
  } catch { return ""; }
}

function recepcaoAtendendo(telefone: string): boolean {
  try {
    const cfg = lerAlunasCfg();
    if (!cfg.ativo) { console.log(`(recepção) ${telefone}: regra desligada — SoFIA responde.`); return false; }
    const ehAluna = temTagAluna(telefone);
    if (!ehAluna) { console.log(`(recepção) ${telefone}: NÃO reconhecida como aluna (tag alvo="${cfg.tag}") — SoFIA responde.`); return false; }
    const agora = new Date().toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const m = (t: string) => { const p = String(t || "").split(":"); return (+p[0] || 0) * 60 + (+p[1] || 0); };
    const a = m(agora), ini = m(cfg.janelaIni), fim = m(cfg.janelaFim);
    const dentro = ini <= fim ? (a >= ini && a < fim) : (a >= ini || a < fim);
    if (dentro) console.log(`🎓 ${telefone}: aluna dentro do horário da recepção (${cfg.janelaIni}–${cfg.janelaFim}, agora ${agora}) — SoFIA não responde.`);
    else console.log(`(recepção) ${telefone}: aluna, mas FORA do horário (${cfg.janelaIni}–${cfg.janelaFim}, agora ${agora}) — SoFIA responde.`);
    return dentro;
  } catch (e: any) { console.log(`(recepção) ${telefone}: erro — ${e?.message || e}`); return false; }
}

function avisarRecepcao(telefoneAluna: string, motivo: string) {
  try {
    const cfg = lerAlunasCfg();
    if (!cfg.recepcaoNumero) return;
    const tel = String(telefoneAluna || "").replace(/\D/g, "");
    const porque = motivo === "nao_foi_possivel_marcar"
      ? "pediu remarcação, mas não há reposição disponível"
      : `pediu remarcação (${motivo})`;
    const aviso = `🎓 *Aluna precisa de atendimento*\n\nContato: ${tel}\nMotivo: ${porque}.\n\nEla foi avisada de que a recepção entrará em contato.`;
    fs.appendFileSync(AVISOS_OUT_FILE, JSON.stringify({ numero: cfg.recepcaoNumero, texto: aviso, em: Date.now() }) + "\n");
    console.log(`🎓 aviso de aluna enfileirado para ${cfg.recepcaoNumero} (contato ${tel}).`);
  } catch (e: any) { console.log("⚠️  avisarRecepcao falhou:", e?.message ?? e); }
}

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

// Agendamento MANUAL (atendente pelo painel): mesma rota do EVO que a SoFIA usa
// (cadastra + marca). Devolve o resultado real para o painel mostrar.
export async function agendarManual(telefone: string, nome: string, email: string, when: string): Promise<ResultadoAgendamento> {
  const tel = String(telefone || "").replace(/\D/g, "");
  if (!tel) return { erro: true, detalhe: "telefone inválido" };
  // E-mail é OPCIONAL (cadastro express de balcão/telefone pode não ter): o EVO
  // identifica a aluna pelo telefone. Só nome e data/horário são obrigatórios.
  if (!String(nome || "").trim() || !String(when || "").trim()) return { erro: true, detalhe: "faltam nome ou data/horário" };
  return bookNoEvo(tel, String(nome).trim(), String(email || "").trim(), String(when).trim());
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

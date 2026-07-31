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
// URLs das imagens. Para TROCAR sem mexer no código, defina no .env:
//   MIDIA_GRADE_IMG, MIDIA_GRADE_LINK, MIDIA_PRECOS_IMG, MIDIA_PRECOS_LINK
// Se não definir no .env, usa os valores padrão abaixo.
const MIDIAS = {
  grade_imagem: process.env.MIDIA_GRADE_IMG || "https://storage.zee.tech/tenants/7a8c9d8e-7208-4a26-87c2-6662c8f962e4/prompt-media/b57c13a0-e544-4df4-99ed-b27cc9cd8859.jpeg",
  grade_link: process.env.MIDIA_GRADE_LINK || "https://drive.google.com/file/d/1wgAvctcQZJVNcka59KcV_FjLDetScCM8/view?usp=sharing",
  precos_imagem: process.env.MIDIA_PRECOS_IMG || "https://storage.zee.tech/tenants/7a8c9d8e-7208-4a26-87c2-6662c8f962e4/prompt-media/63436026-ab4a-4b0f-b6fd-b02f8d4cf037.png",
  precos_link: process.env.MIDIA_PRECOS_LINK || "https://drive.google.com/file/d/14Em2I3-O7-BJvI51P8na7YS2pVvVOUAZ/view?usp=sharing",
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

const enviarMidia = tool(
  "enviar_midia",
  "Envia uma imagem para a usuária. 'grade' = grade de horários; 'precos' = tabela de preços 2026.",
  { tipo: z.enum(["grade", "precos"]).describe("Qual imagem enviar") },
  async ({ tipo }) => {
    const url = tipo === "grade" ? MIDIAS.grade_imagem : MIDIAS.precos_imagem;
    const link = tipo === "grade" ? MIDIAS.grade_link : MIDIAS.precos_link;
    console.log(`🖼️  [ENVIAR IMAGEM] ${tipo}: ${url}`); // no real: envia a imagem via API do WhatsApp
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
  "Marca que a coleta do agendamento terminou (nome + e-mail + dia/hora). " +
    "Chame só DEPOIS de ter horário válido, nome completo e e-mail. Depois de chamar, " +
    "confirme para a aluna que a solicitação foi registrada e que a secretária dará sequência.",
  {
    nome_completo: z.string(),
    email: z.string(),
    data: z.string().describe("AAAA-MM-DD"),
    horario: z.string().describe("HH:MM"),
    telefone: z.string().optional().describe("Telefone da aluna, se disponível"),
    indicacao: z.string().optional(),
  },
  async (dados) => {
    // Apenas confirma que a Sofia concluiu a coleta. O agendamento REAL no EVO é
    // feito pela função enviarParaSeuSistema (caminho único), logo após a extração
    // dos 4 campos — ela tem o telefone da aluna de forma confiável.
    console.log("📋 [SOFIA CONCLUIU A COLETA]", dados);
    return json({ registrado: true });
  },
);

const servidor = createSdkMcpServer({
  name: "slimfit",
  version: "1.0.0",
  tools: [enviarMidia, verificarDisponibilidade, solicitarAgendamento],
});

// ══════════════════════════════════════════════════════════════════════════
// 4) SYSTEM PROMPT — configuração completa da Sofia
// ══════════════════════════════════════════════════════════════════════════
// O prompt fica num ARQUIVO EXTERNO (sofia-prompt.txt), editável pela telinha web,
// para você mudar o comportamento da Sofia sem tocar no código nem reiniciar nada.
// Se o arquivo não existir, usamos PROMPT_PADRAO abaixo como reserva.
const PROMPT_FILE = path.join(process.cwd(), "sofia-prompt.txt");

// Interruptor liga/desliga (controlado pela telinha). Se o arquivo disser "off",
// a Sofia fica em SILÊNCIO — não responde nada (você atende manualmente).
const ESTADO_FILE = path.join(process.cwd(), "sofia-estado.txt");
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
const PAUSA_FILE = path.join(process.cwd(), "sofia-pausa-min.txt");
function pausaMinutos(): number {
  try { const n = parseInt(fs.readFileSync(PAUSA_FILE, "utf-8").trim(), 10); return n > 0 ? n : 30; }
  catch { return 30; }
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
    const txt = fs.readFileSync(PROMPT_FILE, "utf-8").trim();
    return txt.length > 50 ? txt : PROMPT_PADRAO; // se vier vazio/curto, usa o padrão
  } catch {
    return PROMPT_PADRAO; // arquivo não existe ainda → usa o padrão
  }
}


// MODELO DA CONVERSA: Haiku 4.5 (rápido e barato) dá conta do roteiro da Sofia.
// Se notar a Sofia escorregando em alguma regra, troque para "claude-sonnet-5".
const MODELO_CONVERSA = "claude-sonnet-5";
// MODELO DA EXTRAÇÃO: Sonnet, por precisão (roda 1x por agendamento, custo mínimo).
const MODELO_EXTRACAO = "claude-sonnet-5";

const options: ClaudeAgentOptions = {
  model: MODELO_CONVERSA,
  // systemPrompt é injetado por conversa (lido do arquivo) — veja responderComMemoria.
  mcpServers: { slimfit: servidor },
  allowedTools: [
    "mcp__slimfit__enviar_midia",
    "mcp__slimfit__verificar_disponibilidade",
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
}
const conversas = new Map<string, Conversa>();
const INATIVIDADE_MS = 12 * 60 * 60 * 1000; // 12 horas

export async function responderComMemoria(telefone: string, mensagem: string): Promise<string> {
  // Interruptor geral: se estiver desligada, fica em silêncio (atendimento manual).
  // Retorna string vazia — o webhook/listener trata isso como "não enviar nada".
  if (!sofiaAtiva()) {
    console.log(`🔕 Sofia DESLIGADA — mensagem de ${telefone} não respondida (atenda manualmente).`);
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

  const inativa = conversa && agora - conversa.ultimaMensagemEm > INATIVIDADE_MS;
  if (!conversa || inativa) {
    if (inativa) console.log(`⏰ ${telefone}: +12h de inatividade — iniciando conversa nova.`);
    conversa = { sessionId: undefined, ultimaMensagemEm: agora, transcricao: [], resumoEnviado: false };
    conversas.set(telefone, conversa);
  }

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

  // Se a extração/disparo falhar, não derruba a conversa: apenas registra e
  // tenta de novo na próxima mensagem (o flag resumoEnviado continua false).
  try {
    await verificarEDispararAgendamento(telefone, conversa);
  } catch (err: any) {
    console.log("⚠️  Não consegui extrair/disparar o resumo agora (tento na próxima mensagem):", err?.message ?? err);
  }
  return resposta;
}

// ══════════════════════════════════════════════════════════════════════════
// 6) RESUMO (extração dos 4 campos) + DISPARO PARA O SEU SISTEMA
// ══════════════════════════════════════════════════════════════════════════
const EXTRACAO_FILE = path.join(process.cwd(), "sofia-extracao.txt");
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
    const txt = fs.readFileSync(EXTRACAO_FILE, "utf-8").trim();
    return txt.length > 30 ? txt : EXTRACAO_PADRAO;
  } catch {
    return EXTRACAO_PADRAO;
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

async function enviarParaSeuSistema(telefone: string, resumo: ResumoAgendamento) {
  // A Sofia manda o "dia" + "hora" em linguagem natural; o parse_when do seu
  // Python resolve a data real ("quinta-feira às 16:30" -> 2026-07-30 16:30).
  const when = `${resumo.dia} às ${resumo.hora}`;
  const corpo = {
    nome: resumo.nome_completo,
    email: resumo.email,
    telefone,
    when,
  };

  const resp = await comRetry(async () => {
    const r = await fetch(SOFIA_BOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sofia-Token": SOFIA_TOKEN },
      body: JSON.stringify(corpo),
    });
    // 5xx é temporário → deixa o comRetry tentar de novo. 4xx é definitivo.
    if (r.status >= 500) throw Object.assign(new Error(`EVO/serviço ${r.status}`), { status: r.status });
    return r;
  });

  const data: any = await resp.json().catch(() => ({}));

  if (resp.ok && data.ok) {
    console.log(`✅ AGENDADO NO EVO: ${resumo.nome_completo} em ${data.when} (idProspect=${data.idProspect})`);
    return;
  }

  // Turma cheia/indisponível: o lead já ficou cadastrado no EVO. A secretária
  // trata (ou a Sofia pode oferecer as alternativas retornadas em data.alternativas).
  if (resp.status === 409) {
    console.log(`⚠️  Sem vaga para ${resumo.nome_completo}. Alternativas:`, data.alternativas ?? []);
    return;
  }

  console.log("⚠️  Falha ao agendar no EVO:", resp.status, data);
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

if (process.argv.includes("--chat")) chatInterativo().catch(console.error);
else testeAutomatico().catch(console.error);

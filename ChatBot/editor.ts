/**
 * EDITOR DA SOFIA — telinha web com CAMPOS SEPARADOS
 * ---------------------------------------------------
 * Cria automaticamente UMA caixa para cada seção do prompt (as marcadas com "# ..."),
 * mais uma caixa separada para o SCRIPT DE INTEGRAÇÃO (extração do resumo).
 * Ao salvar, remonta os arquivos que a Sofia lê — sem mexer em código, sem reiniciar.
 *
 *   set EDITOR_SENHA=uma-senha-forte
 *   npx tsx editor.ts
 *   Navegador: http://localhost:8080   (usuário: sofia / senha: a que você definiu)
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

const PORTA = Number(process.env.EDITOR_PORTA || 8080);
const SENHA = process.env.EDITOR_SENHA || "";
const USUARIO = "sofia";

const PROMPT_FILE = path.join(process.cwd(), "sofia-prompt.txt");
const PROMPT_BAK = path.join(process.cwd(), "sofia-prompt.bak.txt");
const EXTRACAO_FILE = path.join(process.cwd(), "sofia-extracao.txt");
const EXTRACAO_BAK = path.join(process.cwd(), "sofia-extracao.bak.txt");
const ESTADO_FILE = path.join(process.cwd(), "sofia-estado.txt");
const PAUSA_FILE = path.join(process.cwd(), "sofia-pausa-min.txt"); // minutos que a Sofia fica fora ao você assumir

function estadoAtivo() { try { return fs.readFileSync(ESTADO_FILE, "utf-8").trim().toLowerCase() !== "off"; } catch { return true; } }
function gravarEstado(ativo) { fs.writeFileSync(ESTADO_FILE, ativo ? "on" : "off", "utf-8"); }
function lerPausaMin() { try { const n = parseInt(fs.readFileSync(PAUSA_FILE, "utf-8").trim(), 10); return Number.isFinite(n) && n > 0 ? n : 30; } catch { return 30; } }
function gravarPausaMin(n) { fs.writeFileSync(PAUSA_FILE, String(n), "utf-8"); }

function lerArquivo(p) { try { return fs.readFileSync(p, "utf-8"); } catch { return ""; } }

// ── Mídias (URLs das imagens de preços e grade) ──────────────────────────────
const MIDIAS_FILE = path.join(process.cwd(), "sofia-midias.txt");
function lerMidias() {
  const d = { grade_imagem: "", grade_link: "", precos_imagem: "", precos_link: "" };
  try {
    for (const l of fs.readFileSync(MIDIAS_FILE, "utf-8").split("\n")) {
      const i = l.indexOf("=");
      if (i > 0) { const k = l.slice(0, i).trim(); if (k in d) d[k] = l.slice(i + 1).trim(); }
    }
  } catch {}
  return d;
}
function gravarMidias(m) {
  const txt = "grade_imagem=" + (m.grade_imagem || "") + "\n"
    + "grade_link=" + (m.grade_link || "") + "\n"
    + "precos_imagem=" + (m.precos_imagem || "") + "\n"
    + "precos_link=" + (m.precos_link || "") + "\n";
  fs.writeFileSync(MIDIAS_FILE, txt, "utf-8");
}

// ── parse do prompt em seções (por linhas que começam com "# ") ────────────────
function parseSecoes(texto) {
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");
  const secoes = [];
  let atual = null;
  const intro = [];
  for (const l of linhas) {
    if (l.startsWith("# ")) {
      if (atual) secoes.push(atual);
      atual = { titulo: l.slice(2).trim(), corpo: "" };
    } else if (atual) {
      atual.corpo += (atual.corpo ? "\n" : "") + l;
    } else {
      intro.push(l);
    }
  }
  if (atual) secoes.push(atual);
  const introTxt = intro.join("\n").trim();
  if (introTxt) secoes.unshift({ titulo: "IDENTIDADE / ABERTURA", corpo: introTxt });
  return secoes;
}
function montarPrompt(secoes) {
  return secoes.map((s, i) => {
    const corpo = (s.corpo || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
    if (i === 0 && s.titulo === "IDENTIDADE / ABERTURA") return corpo;
    return "# " + s.titulo + "\n" + corpo;
  }).join("\n\n").trim() + "\n";
}

function autorizado(req) {
  if (!SENHA) return false;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, p] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return u === USUARIO && p === SENHA;
}
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function pagina(aviso) {
  aviso = aviso || "";
  const secoes = parseSecoes(lerArquivo(PROMPT_FILE));
  const extracao = lerArquivo(EXTRACAO_FILE);
  const mid = lerMidias();
  const inpMidia = (nome, valor) => '<input type="text" name="' + nome + '" value="' + esc(valor)
    + '" style="width:100%;padding:10px;border:1px solid #cbd2d9;border-radius:8px;'
    + 'font-family:ui-monospace,monospace;font-size:13px;margin-bottom:6px;">';

  const camposConversa = secoes.map((s, i) => {
    const rows = Math.min(16, Math.max(4, s.corpo.split("\n").length + 1));
    return '<div class="card"><label>' + esc(s.titulo) + '</label>'
      + '<input type="hidden" name="titulo_' + i + '" value="' + esc(s.titulo) + '">'
      + '<textarea name="corpo_' + i + '" spellcheck="false" rows="' + rows + '">' + esc(s.corpo) + '</textarea></div>';
  }).join("");

  return '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">'
+ '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Editor da Sofia</title>'
+ '<style>'
+ ':root{--verde:#25a35a;} *{box-sizing:border-box;}'
+ 'body{font-family:system-ui,Arial,sans-serif;margin:0;background:#f4f6f8;color:#1a1a1a;}'
+ 'header{background:var(--verde);color:#fff;padding:14px 20px;font-size:18px;font-weight:600;position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;}'
+ '.toggle{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:6px 14px 6px 6px;font-size:14px;font-weight:700;cursor:pointer;color:#fff;}'
+ '.toggle .knob{width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s;}'
+ '.toggle.on{background:#1c7a43;} .toggle.on .knob{transform:translateX(2px);}'
+ '.toggle.off{background:#b0b7bd;} .toggle.off .knob{transform:translateX(0);}'
+ 'main{max-width:900px;margin:20px auto;padding:0 16px 90px;}'
+ '.card{background:#fff;border:1px solid #e1e6ea;border-radius:12px;padding:14px 16px;margin-bottom:14px;}'
+ '.card.extra{border-color:#e0a800;background:#fffdf5;}'
+ 'label{display:block;font-weight:700;color:#25603c;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:.3px;}'
+ '.card.extra label{color:#8a6d00;}'
+ 'textarea{width:100%;padding:12px;font-family:ui-monospace,Consolas,monospace;font-size:14px;line-height:1.5;border:1px solid #cbd2d9;border-radius:10px;resize:vertical;}'
+ '.secao-titulo{font-size:15px;font-weight:700;color:#555;margin:22px 0 8px;}'
+ '.barra{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e1e6ea;padding:12px 16px;display:flex;gap:12px;justify-content:center;}'
+ 'button{border:0;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer;}'
+ '.salvar{background:var(--verde);color:#fff;} .restaurar{background:#eee;color:#333;}'
+ '.aviso{background:#e8f5ec;border:1px solid var(--verde);color:#1c6b3c;padding:10px 14px;border-radius:10px;margin-bottom:14px;}'
+ '</style></head><body>'
+ '<header><span>&#129302; Editor da Sofia</span>'
+ '<form method="POST" action="/toggle" style="margin:0">'
+ (estadoAtivo()
    ? '<button class="toggle on" title="Clique para PAUSAR"><span class="knob"></span>IA ativa</button>'
    : '<button class="toggle off" title="Clique para ATIVAR"><span class="knob"></span>IA pausada</button>')
+ '</form></header><main>'
+ (aviso ? '<div class="aviso">' + esc(aviso) + '</div>' : "")
+ '<form method="POST" action="/salvar"><input type="hidden" name="n" value="' + secoes.length + '">'
+ '<div class="secao-titulo">&#9199; Atendimento humano</div>'
+ '<div class="card"><label>Minutos que a Sofia fica fora ao você assumir uma conversa</label>'
+ '<input type="number" name="pausaMin" min="1" max="1440" value="' + lerPausaMin() + '" '
+ 'style="width:120px;padding:12px;font-size:15px;border:1px solid #cbd2d9;border-radius:10px;"> minutos</div>'
+ '<div class="secao-titulo">&#128172; Conversa da Sofia (cada bloco abaixo é uma parte do atendimento)</div>'
+ camposConversa
+ '<div class="secao-titulo">&#128279; Script de integração (dados enviados ao EVO)</div>'
+ '<div class="card extra"><label>Extração do resumo (nome, e-mail, dia, hora)</label>'
+ '<textarea name="extracao" spellcheck="false" rows="12">' + esc(extracao) + '</textarea></div>'
+ '<div class="secao-titulo">&#128247; Imagens (troque as URLs quando atualizar a tabela/grade)</div>'
+ '<div class="card">'
+ '<label>Imagem da TABELA DE PREÇOS (URL)</label>' + inpMidia("precos_imagem", mid.precos_imagem)
+ '<label>Link (Google Drive) da tabela de preços</label>' + inpMidia("precos_link", mid.precos_link)
+ '<label>Imagem da GRADE DE HORÁRIOS (URL)</label>' + inpMidia("grade_imagem", mid.grade_imagem)
+ '<label>Link (Google Drive) da grade</label>' + inpMidia("grade_link", mid.grade_link)
+ '</div>'
+ '<div class="barra"><button class="salvar" type="submit">&#128190; Salvar tudo</button>'
+ '<button class="restaurar" type="submit" formaction="/restaurar" '
+ 'onclick="return confirm(\'Restaurar a versão anterior de TODOS os campos?\')">&#8617; Restaurar anterior</button></div>'
+ '</form></main></body></html>';
}

function lerCorpo(req) {
  return new Promise((r) => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
}

const servidor = http.createServer(async (req, res) => {
  if (!autorizado(req)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Editor da Sofia"' }); res.end("Precisa de senha."); return; }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(pagina()); return;
  }

  if (req.method === "POST" && req.url === "/salvar") {
    const params = new URLSearchParams(await lerCorpo(req));
    const n = Number(params.get("n") || 0);
    const secoes = [];
    for (let i = 0; i < n; i++) {
      secoes.push({ titulo: params.get("titulo_" + i) || ("SEÇÃO " + i), corpo: params.get("corpo_" + i) || "" });
    }
    const promptMontado = montarPrompt(secoes);
    const extracao = (params.get("extracao") || "").trim();

    if (promptMontado.trim().length < 50 || extracao.length < 30) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pagina("Não salvei: algum campo essencial ficou curto demais. Confira e tente de novo."));
      return;
    }
    try { if (fs.existsSync(PROMPT_FILE)) fs.copyFileSync(PROMPT_FILE, PROMPT_BAK); } catch {}
    try { if (fs.existsSync(EXTRACAO_FILE)) fs.copyFileSync(EXTRACAO_FILE, EXTRACAO_BAK); } catch {}
    fs.writeFileSync(PROMPT_FILE, promptMontado, "utf-8");
    fs.writeFileSync(EXTRACAO_FILE, extracao, "utf-8");

    // salva o tempo de pausa do atendimento humano (com limites de segurança)
    const pm = Math.max(1, Math.min(1440, parseInt(params.get("pausaMin") || "30", 10) || 30));
    gravarPausaMin(pm);

    // salva as URLs das imagens (preços/grade)
    gravarMidias({
      grade_imagem: (params.get("grade_imagem") || "").trim(),
      grade_link: (params.get("grade_link") || "").trim(),
      precos_imagem: (params.get("precos_imagem") || "").trim(),
      precos_link: (params.get("precos_link") || "").trim(),
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pagina("Salvo! As próximas conversas já vão usar estas configurações."));
    return;
  }

  if (req.method === "POST" && req.url === "/restaurar") {
    let ok = false;
    try { if (fs.existsSync(PROMPT_BAK)) { fs.copyFileSync(PROMPT_BAK, PROMPT_FILE); ok = true; } } catch {}
    try { if (fs.existsSync(EXTRACAO_BAK)) { fs.copyFileSync(EXTRACAO_BAK, EXTRACAO_FILE); ok = true; } } catch {}
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pagina(ok ? "Restaurado para a versão anterior." : "Não havia versão anterior para restaurar."));
    return;
  }

  if (req.method === "POST" && req.url === "/toggle") {
    const novo = !estadoAtivo();
    gravarEstado(novo);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pagina(novo ? "🟢 Sofia ATIVADA — voltou a responder as alunas." : "⏸️ Sofia PAUSADA — ela não vai responder (atenda manualmente pelo WhatsApp)."));
    return;
  }

  res.writeHead(404); res.end("não encontrado");
});

if (!SENHA) console.log("Defina a senha antes:  set EDITOR_SENHA=sua-senha");
servidor.listen(PORTA, () => console.log("Editor da Sofia em http://localhost:" + PORTA + "  (usuario: " + USUARIO + ")"));

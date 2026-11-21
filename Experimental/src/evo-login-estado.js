/**
 * evo-login-estado.js — o robô PARA de tentar entrar no EVO quando o EVO recusa a senha.
 *
 * Por que existe: com a senha errada, cada job tentava entrar de novo (e cada um repetia
 * 3 vezes). O EVO conta as tentativas e bloqueia o usuário ("excedeu o número de
 * tentativas" + código por e-mail). No celular chegava só "TIMEOUT" e "Waiting failed",
 * sem dizer que o problema era a senha.
 *
 * Como funciona (arquivo data/evo-login-recusado.json, lido pelo robô e pelo painel):
 *   • senha recusada  → anota e avisa UMA vez, com o que fazer. Dali em diante nenhum
 *     job tenta entrar até: o login ser salvo de novo no painel, o .env mudar, ou
 *     passarem 6 h (uma tentativa nova — cobre o caso de o EVO ter errado sozinho).
 *   • EVO pediu código por e-mail e ninguém digitou → o MESMO job não pede outro código
 *     logo em seguida (cada pedido gera um e-mail novo e confunde quem vai digitar).
 *
 * Só estado e contas — nada de navegador aqui.
 */
const fs = require('fs');
const path = require('path');

const DADOS = path.resolve(__dirname, '..', 'data');
const ARQ = path.join(DADOS, 'evo-login-recusado.json');
const ENV = path.resolve(__dirname, '..', '.env');
const ESPERA_SENHA_MS = 6 * 3600 * 1000;
const ESPERA_CODIGO_MS = 3 * 60 * 1000;

// Textos com que o EVO recusa usuário/senha (não confundir com código inválido).
const RECUSA = /invalid\s+username\s+and\/or\s+password|usu[aá]rio\s+(e\/ou|ou|e)\s+senha\s+inv[aá]lid|senha\s+(incorreta|inv[aá]lida)|e-?mail\s+ou\s+senha\s+inv[aá]lid/i;
const ehRecusa = (texto) => RECUSA.test(String(texto || ''));

const ler = () => { try { const o = JSON.parse(fs.readFileSync(ARQ, 'utf8')); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } };
const gravar = (o) => { try { fs.mkdirSync(DADOS, { recursive: true }); const t = ARQ + '.tmp'; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, ARQ); } catch (_) {} };
const quando = (ms) => { try { return new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

const MSG_SENHA = (em) => `O EVO recusou a senha do robô (${quando(em)}). O robô parou de tentar entrar para o EVO não bloquear o usuário. Confira a senha em SoFIA → Configuração → Credenciais da unidade → Login do robô no EVO e salve — ao salvar, ele volta a tentar.`;
const MSG_CODIGO = 'O EVO pediu um código por e-mail e ninguém digitou no painel a tempo. Rode o job de novo e digite o código mais recente em WhatsApp → Configuração → Código do EVO (2FA).';

// Está travado agora? → null | { motivo: 'senha' | 'codigo', em, mensagem }
function bloqueio(agora) {
  agora = agora || Date.now();
  const o = ler();
  if (!o || !o.em) return null;
  if (o.motivo === 'codigo') return agora < (o.ate || 0) ? { motivo: 'codigo', em: o.em, mensagem: MSG_CODIGO } : null;
  if (agora - o.em >= ESPERA_SENHA_MS) return null;               // passou o prazo: uma tentativa nova
  let mexido = 0; try { mexido = fs.statSync(ENV).mtimeMs; } catch (_) {}
  if (mexido > o.em) return null;                                 // o login foi salvo de novo depois da recusa
  return { motivo: 'senha', em: o.em, mensagem: MSG_SENHA(o.em) };
}

// Chamar ANTES de digitar o login: lança erro claro se não é para tentar agora.
function conferir() {
  const b = bloqueio();
  if (b) { const e = new Error(b.mensagem); e.evoLogin = b.motivo; throw e; }
}

// O EVO recusou usuário/senha. Anota e avisa (uma vez por recusa).
async function registrarRecusa(texto) {
  const em = Date.now();
  gravar({ motivo: 'senha', em, texto: String(texto || '').slice(0, 200) });
  console.log(`   🔒 [login] o EVO RECUSOU a senha do robô ("${String(texto || '').slice(0, 120)}") — paro de tentar até a senha ser conferida no painel.`);
  try {
    await require('./notificar').alertar('EVO recusou a senha do robô',
      'O robô não conseguiu entrar no EVO: usuário ou senha recusados.\nEle PAROU de tentar, para o EVO não bloquear o usuário.\nAbra o painel em SoFIA → Configuração → Credenciais da unidade → Login do robô no EVO, confira a senha e salve. Até lá os jobs do EVO não rodam (confirmações, presença, aniversários…).',
      { prioridade: 'urgent', tags: 'closed_lock_with_key', forcar: true });
  } catch (_) {}
  return em;
}

// O EVO pediu código por e-mail e ninguém digitou a tempo.
function registrarSemCodigo() {
  const o = ler();
  if (o && o.motivo === 'senha' && bloqueio()) return;            // a recusa de senha manda mais
  const em = Date.now();
  gravar({ motivo: 'codigo', em, ate: em + ESPERA_CODIGO_MS });
}

// Login salvo de novo no painel (ou login que deu certo): libera na hora.
function liberar() { try { fs.rmSync(ARQ, { force: true }); } catch (_) {} }

module.exports = { ARQ, ehRecusa, bloqueio, conferir, registrarRecusa, registrarSemCodigo, liberar, ESPERA_SENHA_MS, ESPERA_CODIGO_MS };

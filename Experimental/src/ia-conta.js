/**
 * Conta da IA (Anthropic) parada — SOF-09. Usado pela SoFIA (ChatBot/sofia.ts).
 *
 * Sem crédito ("Credit balance is too low") ou com a chave recusada, insistir não
 * adianta: cada nova tentativa falha igual e só atrasa a resposta. Em 23–24/11/2026
 * o Park Sul ficou quase um dia assim e ninguém soube — a lead recebia "instabilidade".
 *
 * Aqui: reconhecer esse erro (para não repetir a chamada) e avisar a equipe UMA vez
 * por episódio. O episódio acaba quando uma chamada à IA volta a funcionar; se parar
 * de novo depois disso, avisa de novo.
 */

const SEM_CREDITO = /credit balance is too low|purchase credits|plans\s*&\s*billing/i;
const CHAVE_RECUSADA = /invalid x-api-key|authentication_error|invalid api key|api key.*(invalid|revoked|disabled)/i;

function textoDoErro(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const partes = [err.message, err.error && err.error.message, err.error && err.error.error && err.error.error.message];
  return partes.filter(Boolean).join(' ') || String(err);
}

/** 'sem-credito' | 'chave-recusada' | '' (outro erro: pode ser passageiro) */
function motivoDeConta(err) {
  const t = textoDoErro(err);
  if (SEM_CREDITO.test(t)) return 'sem-credito';
  if (CHAVE_RECUSADA.test(t)) return 'chave-recusada';
  return '';
}

const TEXTOS = {
  'sem-credito': {
    titulo: 'SoFIA parada - IA sem credito',
    corpo: 'A conta da IA (Anthropic) da SoFIA ficou sem credito. Ate alguem colocar credito, ela nao responde as leads (elas recebem "tivemos uma instabilidade"). Coloque credito em console.anthropic.com -> Settings -> Billing e ligue a recarga automatica (auto-reload). Nao precisa reiniciar nada.',
  },
  'chave-recusada': {
    titulo: 'SoFIA parada - chave da IA recusada',
    corpo: 'A Anthropic recusou a chave da IA da SoFIA. Ate trocar a chave, ela nao responde as leads. Confira no painel: SoFIA -> Configuracao -> Credenciais.',
  },
};

/**
 * @param avisar (titulo, corpo, motivo) => void — manda o aviso para a equipe
 * @returns { falhou(err) → motivo ('' se não é problema de conta), ok() }
 */
function criarAvisoConta(avisar) {
  let avisado = '';
  return {
    falhou(err) {
      const motivo = motivoDeConta(err);
      if (motivo && !avisado) {
        avisado = motivo;
        try { const t = TEXTOS[motivo]; Promise.resolve(avisar && avisar(t.titulo, t.corpo, motivo)).catch(() => {}); } catch (_) {}
      }
      return motivo;
    },
    ok() { avisado = ''; },
    get avisado() { return avisado; },
  };
}

module.exports = { motivoDeConta, criarAvisoConta, TEXTOS };

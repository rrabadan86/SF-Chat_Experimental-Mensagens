// verificar-grade-nuvem.js
// Auto-recuperação da grade do formulário (Render).
//
// PROBLEMA que isto resolve: o Render free tem disco EFÊMERO — a cada deploy
// (ou reinício) o arquivo slots_pushed.json some e a grade EMPURRADA pelo VPS
// se perde. Até o próximo push agendado (a cada 60 min de dia / ~3h de
// madrugada), o formulário cai no cálculo LOCAL (lento na Render free), e a
// aluna vê "sem horário disponível" / "está demorando mais que o normal".
//
// SOLUÇÃO: o VPS consulta o formulário de tempos em tempos (leve: um GET
// /api/slots?days=1). Se a grade empurrada NÃO estiver presente lá
// (fonte != "vps"), o VPS reenvia a grade NA HORA — fechando a janela de até
// 60 min que existiria após um deploy.
//
// Variáveis de ambiente:
//   FORM_CLOUD_URL = https://sf-formularioexperimental.onrender.com

const CLOUD_URL = (process.env.FORM_CLOUD_URL || 'https://sf-formularioexperimental.onrender.com')
  .replace(/\/+$/, '');

/**
 * Consulta o formulário e diz se a grade EMPURRADA pelo VPS está presente lá.
 *
 * Retorna { presente, fonte, respondeu, erro }:
 *   - presente : true  → o form está servindo a grade do VPS (fonte "vps"); nada a fazer.
 *                false → o form está sem a grade do VPS (aquecendo/cálculo local); recuperar.
 *   - fonte    : "vps" | "warming" | null (o que o form devolveu)
 *   - respondeu: true se o form respondeu HTTP 200 (mesmo que sem a grade). Só
 *                consideramos "recuperar" quando o form RESPONDEU — assim um
 *                cold start / queda transitória (fetch falhou) não vira push.
 *   - erro     : mensagem quando não deu para consultar.
 */
async function estadoGradeNuvem() {
  try {
    const r = await fetch(`${CLOUD_URL}/api/slots?days=1`, {
      signal: AbortSignal.timeout(45000), // Render free demora no "cold start"
    });
    if (!r.ok) return { presente: false, fonte: null, respondeu: false, erro: `HTTP ${r.status}` };
    const d = await r.json();
    const fonte = d && d.fonte ? d.fonte : (d && d.warming ? 'warming' : null);
    return { presente: !!(d && d.fonte === 'vps'), fonte, respondeu: true, erro: null };
  } catch (e) {
    return { presente: false, fonte: null, respondeu: false, erro: e.message };
  }
}

module.exports = { estadoGradeNuvem, CLOUD_URL };

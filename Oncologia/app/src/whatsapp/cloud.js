/**
 * Driver "cloud" — WhatsApp Cloud API oficial da Meta.
 *
 * Pago por conversa, mas é o único caminho correto para o sistema INICIAR
 * conversa com o paciente: mensagem para quem não escreveu nas últimas 24h só
 * sai como template previamente aprovado pela Meta.
 *
 * As respostas da recepcionista chegam por webhook (ver src/server.js).
 */
const API = 'https://graph.facebook.com/v21.0';
const escutas = [];

function exigir(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`WA_DRIVER=cloud precisa de ${nome} no .env`);
  return v;
}

async function chamar(corpo) {
  const token = exigir('WA_CLOUD_TOKEN');
  const phoneId = exigir('WA_CLOUD_PHONE_ID');
  const r = await fetch(`${API}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
  });
  const dados = await r.json();
  if (!r.ok) throw new Error(`WhatsApp Cloud API ${r.status}: ${JSON.stringify(dados)}`);
  return dados;
}

/** Texto livre. Só chega se a janela de 24h estiver aberta (a recepcionista respondeu recentemente). */
async function enviar(numero, texto) {
  return chamar({ to: String(numero).replace(/\D/g, ''), type: 'text', text: { body: texto, preview_url: false } });
}

/** Template aprovado — o caminho para iniciar conversa com o paciente. */
async function enviarTemplate(numero, template, parametros = [], idioma = 'pt_BR') {
  return chamar({
    to: String(numero).replace(/\D/g, ''),
    type: 'template',
    template: {
      name: template,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: String(t) })) }]
        : undefined,
    },
  });
}

/** Chamado pelo webhook do Express com o corpo cru que a Meta manda. */
async function processarWebhook(corpo) {
  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      for (const msg of mudanca.value?.messages || []) {
        const texto = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '';
        for (const cb of escutas) {
          try { await cb({ de: msg.from, texto }); }
          catch (e) { console.error('[wa:cloud] erro tratando mensagem:', e.message); }
        }
      }
    }
  }
}

module.exports = {
  nome: 'cloud',
  async iniciar() { exigir('WA_CLOUD_TOKEN'); exigir('WA_CLOUD_PHONE_ID'); },
  enviar,
  enviarTemplate,
  processarWebhook,
  aoReceber: (cb) => escutas.push(cb),
  estado() {
    const configurado = Boolean(process.env.WA_CLOUD_TOKEN && process.env.WA_CLOUD_PHONE_ID);
    return {
      driver: 'cloud',
      situacao: configurado ? 'conectado' : 'erro',
      conectado: configurado,
      temQr: false,                      // API oficial não usa QR
      erro: configurado ? null : 'Faltam WA_CLOUD_TOKEN e WA_CLOUD_PHONE_ID no .env.',
      desde: null,
    };
  },
  async qrImagem() { return null; },
  async conectar() { return this.estado(); },
  async desconectar() { return this.estado(); },
};

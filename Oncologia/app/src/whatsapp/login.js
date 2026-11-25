/**
 * Escaneia o QR do WhatsApp uma vez e sai. Use antes de subir o servidor com
 * WA_DRIVER=wwebjs:  npm run wa:login
 */
require('dotenv').config();
process.env.WA_DRIVER = 'wwebjs';
process.env.WA_HEADLESS = process.env.WA_HEADLESS || 'false';

require('./wwebjs').iniciar()
  .then(() => { console.log('Sessão salva. Pode subir o servidor com npm start.'); process.exit(0); })
  .catch((e) => { console.error(e.message); process.exit(1); });

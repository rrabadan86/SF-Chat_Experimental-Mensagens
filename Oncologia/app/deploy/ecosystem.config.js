/**
 * PM2 — mantém o servidor de pé 24/7 e o traz de volta se cair ou se a VPS
 * reiniciar.  pm2 start deploy/ecosystem.config.js
 *
 * Um processo só, de propósito: o whatsapp-web.js mantém um navegador logado em
 * memória, e duas instâncias brigariam pela mesma sessão. Não use cluster aqui.
 */
module.exports = {
  apps: [{
    name: 'agendamento-onco',
    script: 'src/server.js',
    cwd: __dirname + '/..',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '30s',
    // o Chromium do WhatsApp come memória com o tempo; reinicia antes de incomodar
    max_memory_restart: '600M',
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 3000,
    },
    error_file: 'logs/erro.log',
    out_file: 'logs/saida.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

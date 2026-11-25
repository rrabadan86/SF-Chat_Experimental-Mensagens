/** Ambiente mínimo para os testes rodarem sem Google, sem WhatsApp e sem .env. */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TZ_OFFSET = '-03:00';
process.env.CAL_H1 = 'h1@group.calendar.google.com';
process.env.CAL_H2 = 'h2@group.calendar.google.com';
process.env.WA_DRIVER = 'log';
process.env.WA_RECEPCAO = '5562999998888';
process.env.MEDICO_NOME = 'Dr. Felipe Oliveira';
process.env.ADMIN_SEGREDO = 'segredo-de-teste-com-tamanho-suficiente';

/** Cada arquivo de teste escreve a configuração num diretório temporário só dele. */
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'onco-teste-'));
process.env.DADOS_ARQUIVO = path.join(pasta, 'config.json');
process.env.MIDIA_DIR = path.join(pasta, 'midia');
process.on('exit', () => fs.rmSync(pasta, { recursive: true, force: true }));

module.exports = { pasta };

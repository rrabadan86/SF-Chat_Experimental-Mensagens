/** Ambiente mínimo para os testes rodarem sem Google, sem WhatsApp e sem .env. */
process.env.TZ_OFFSET = '-03:00';
process.env.CAL_H1 = 'h1@group.calendar.google.com';
process.env.CAL_H2 = 'h2@group.calendar.google.com';
process.env.WA_DRIVER = 'log';
process.env.WA_RECEPCAO = '5562999998888';
process.env.MEDICO_NOME = 'Dr. Felipe Oliveira';

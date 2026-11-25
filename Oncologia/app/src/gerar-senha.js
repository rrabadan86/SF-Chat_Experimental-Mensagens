/**
 * Gera as duas linhas de segredo do painel:  npm run senha
 * A senha é pedida pelo terminal para não ficar no histórico de comandos.
 */
const crypto = require('crypto');
const readline = require('readline');
const { gerarHash } = require('./auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Senha do painel (mínimo 8 caracteres): ', (senha) => {
  rl.close();
  if (!senha || senha.length < 8) {
    console.error('\nSenha curta demais. Use pelo menos 8 caracteres.');
    process.exit(1);
  }
  console.log('\nCole estas duas linhas no arquivo .env:\n');
  console.log(`ADMIN_SENHA_HASH=${gerarHash(senha)}`);
  console.log(`ADMIN_SEGREDO=${crypto.randomBytes(32).toString('hex')}`);
  console.log('\n(o ADMIN_SEGREDO assina o cookie; trocar ele desconecta o painel)');
});

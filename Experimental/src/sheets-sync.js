/**
 * Sincroniza uma lista de alunas (id + nome + aniversário) com uma planilha
 * do Google Sheets, SEM nunca desalinhar a coluna que o usuário preenche à mão.
 *
 * Regra de ouro (anti-drift): cada aluna é ancorada pelo seu ID do EVO na
 * coluna A. As linhas existentes NUNCA mudam de posição nem são apagadas —
 * apenas atualizadas no lugar. Alunas novas entram no FINAL. Alunas que saíram
 * são marcadas "Ativa? = Não" (a linha permanece, preservando o histórico).
 *
 * Assim, qualquer coluna que o usuário criar à direita (ex.: "2026" com o SIM
 * de presente entregue) fica eternamente colada à aluna certa, porque a linha
 * dela nunca se move.
 *
 * O script só escreve as colunas A:E. A coluna F em diante é do usuário.
 *
 * Requisitos:
 *   - npm install googleapis
 *   - Conta de serviço Google (arquivo JSON) com acesso de Editor à planilha.
 *
 * Config (via .env ou variáveis de ambiente):
 *   SHEETS_ID          → ID da planilha (da URL)
 *   GOOGLE_SA_KEY      → caminho do arquivo service-account.json
 *   SHEETS_ABA         → (opcional) nome da aba/página; padrão "Aniversarios"
 */

const fs = require('fs');
const path = require('path');

const CABECALHO = ['ID EVO', 'Nome', 'Aniversário (dd/mm)', 'Ativa?', 'Atualizado em'];

function getConfig() {
  const spreadsheetId = process.env.SHEETS_ID || '1vTNQSEh9bT23_HhyKMdysM3tzrWc14y3xFnjtgVK95U';
  const keyFile = process.env.GOOGLE_SA_KEY || 'C:\\SlimfitBot\\service-account.json';
  const aba = process.env.SHEETS_ABA || 'Aniversarios';
  return { spreadsheetId, keyFile, aba };
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

async function getSheetsClient(keyFile) {
  let google;
  try {
    ({ google } = require('googleapis'));
  } catch (e) {
    throw new Error('Pacote "googleapis" não instalado. Rode: npm install googleapis');
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Credencial da conta de serviço não encontrada em: ${keyFile}\n` +
      '   → Baixe o service-account.json e/ou ajuste GOOGLE_SA_KEY no .env');
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

/**
 * Garante que a aba exista. Se não existir, cria.
 */
async function garantirAba(sheets, spreadsheetId, aba) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existe = (meta.data.sheets || []).some(s => s.properties.title === aba);
  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: aba } } }] },
    });
    console.log(`   📄 Aba "${aba}" criada na planilha.`);
  }
}

/**
 * Sincroniza a lista de alunas com a planilha.
 * @param {Array<{id:string, nome:string, aniversario:string}>} alunas
 * @returns {Promise<{novas:number, atualizadas:number, inativadas:number, total:number}>}
 */
async function sincronizar(alunas) {
  const { spreadsheetId, keyFile, aba } = getConfig();
  const sheets = await getSheetsClient(keyFile);

  console.log(`\n📗 Sincronizando com Google Sheets (aba "${aba}")...`);
  await garantirAba(sheets, spreadsheetId, aba);

  // 1. Lê o que já existe (só colunas A:E — nunca tocamos F+).
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${aba}!A:E`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const linhas = resp.data.values || [];

  // Detecta se a primeira linha é cabeçalho.
  const temCabecalho = linhas.length > 0 &&
    String(linhas[0][0] || '').trim().toLowerCase().startsWith('id');
  const dados = temCabecalho ? linhas.slice(1) : linhas;

  // 2. Mapeia ID → índice da linha (preservando a ORDEM existente).
  //    Cada elemento de "matriz" é uma linha [id, nome, aniv, ativa, atualizado].
  const matriz = dados.map(r => [
    String(r[0] ?? '').trim(),
    String(r[1] ?? ''),
    String(r[2] ?? ''),
    String(r[3] ?? ''),
    String(r[4] ?? ''),
  ]);
  const idParaLinha = new Map();
  matriz.forEach((r, i) => { if (r[0]) idParaLinha.set(r[0], i); });

  const idsAtuais = new Set(alunas.map(a => String(a.id)));
  const hoje = hojeBR();

  let novas = 0, atualizadas = 0, inativadas = 0;

  // 3. Upsert por ID — atualiza no lugar OU adiciona no final.
  for (const a of alunas) {
    const id = String(a.id);
    if (idParaLinha.has(id)) {
      const i = idParaLinha.get(id);
      const antes = matriz[i].slice();
      matriz[i][1] = a.nome;
      matriz[i][2] = a.aniversario;
      matriz[i][3] = 'Sim';
      // marca "atualizado em" só se algo mudou (nome/aniv/reativação)
      if (antes[1] !== a.nome || antes[2] !== a.aniversario || antes[3] !== 'Sim') {
        matriz[i][4] = hoje;
        atualizadas++;
      }
    } else {
      matriz.push([id, a.nome, a.aniversario, 'Sim', hoje]);
      idParaLinha.set(id, matriz.length - 1);
      novas++;
    }
  }

  // 4. Marca como inativa quem está na planilha mas não veio mais do EVO.
  //    NÃO apaga a linha (preserva o SIM do usuário e o histórico).
  matriz.forEach(r => {
    if (r[0] && !idsAtuais.has(r[0]) && r[3] !== 'Não') {
      r[3] = 'Não';
      r[4] = hoje;
      inativadas++;
    }
  });

  // 5. Reescreve APENAS A:E, na MESMA ordem de linhas (existentes no lugar,
  //    novas no fim). Como nenhuma linha existente mudou de índice, a coluna
  //    F+ do usuário continua alinhada.
  const corpo = [CABECALHO, ...matriz];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${aba}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: corpo },
  });

  console.log(`   ✅ Planilha atualizada: ${novas} nova(s), ${atualizadas} atualizada(s), ${inativadas} inativada(s).`);
  console.log(`   📊 Total de linhas de alunas: ${matriz.length}`);

  return { novas, atualizadas, inativadas, total: matriz.length };
}

/**
 * Lê valores de um intervalo da planilha (ex.: "A2:K"). Se não vier o nome da
 * aba no range, usa a aba padrão do config.
 * @returns {Promise<Array<Array<any>>>}
 */
async function lerValores(rangeA1) {
  const { spreadsheetId, keyFile, aba } = getConfig();
  const sheets = await getSheetsClient(keyFile);
  const range = rangeA1.includes('!') ? rangeA1 : `${aba}!${rangeA1}`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return resp.data.values || [];
}

module.exports = { sincronizar, lerValores };

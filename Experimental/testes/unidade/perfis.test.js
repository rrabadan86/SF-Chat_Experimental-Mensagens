// Perfis um a um (PAI-01..04): entra com cada perfil e confere o que ele VÊ (menu e
// telas que abrem) e o que o SERVIDOR NEGA (403), inclusive em ações (POST).
// Complementa permissoes.test.js (que varre todas as rotas com um usuário sem acesso).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ambienteIsolado, portaLivre } = require('../ajuda');

const pedir = (porta, metodo, url, cookie, corpo = '') => new Promise((ok) => {
  const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: metodo, timeout: 15000,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(corpo), accept: 'text/html' } },
  (r) => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ st: r.statusCode, loc: r.headers.location || '', cookie: r.headers['set-cookie'], corpo: b })); });
  req.on('timeout', () => { req.destroy(); ok({ st: 0 }); });
  req.on('error', () => ok({ st: 0 }));
  req.end(corpo);
});
const menu = (html) => ['ind', 'msg', 'grade', 'slimclub', 'sofia'].filter(k => new RegExp(`<a href="[^"]*" class="nav-${k}[ "]`).test(html));
const NOME_MENU = { ind: 'Formulário', msg: 'WhatsApp', grade: 'Indicadores', slimclub: 'Slim Club', sofia: 'SoFIA' };

// Cada perfil: telas liberadas, o que aparece no menu, o que abre e o que é negado.
const PERFIS = [
  { nome: 'recepcao', telas: ['sofia_conversas'], menu: ['grade', 'sofia'], // Funil liberado de propósito (IND-05)
    abre: ['/sofia?view=conversas', '/funil', '/dicionario', '/sofia/agendar/slots'], // horários com vaga do Agendar da conversa
    nega: [['GET', '/perfis'], ['GET', '/?view=config'], ['GET', '/hoje'], ['GET', '/grade'], ['GET', '/metas'], ['GET', '/clube'], ['GET', '/formularios'], ['GET', '/saude'],
      ['POST', '/sofia/salvar'], ['POST', '/sofia/aquecimento'], ['POST', '/sofia/campanhas/criar'], ['POST', '/sofia/contatos/excluir-lote'], ['POST', '/salvar'], ['POST', '/perfis/criar'],
      ['GET', '/perfis?view=novaloja'], ['GET', '/perfis/novaloja/status?slug=marista'], ['POST', '/perfis/novaloja/iniciar'], ['POST', '/perfis/novaloja/duckdns']], // NOV-01: Nova loja só admin
    naoMostra: { url: '/sofia?view=config', texto: 'Configuração da SoFIA' } },
  { nome: 'configsofia', telas: ['sofia_config'], menu: ['sofia'],
    abre: ['/sofia?view=config', '/sofia?view=cobranca'],
    nega: [['GET', '/funil'], ['GET', '/?view=config'], ['GET', '/perfis'], ['GET', '/sofia/agendar/slots'], ['POST', '/sofia/responder'], ['POST', '/sofia/contatos/excluir-lote'], ['POST', '/sofia/campanhas/criar'], ['POST', '/salvar']] },
  { nome: 'indicadores', telas: ['funil', 'ind', 'professoras', 'ativas', 'grade', 'metas'], menu: ['grade'],
    abre: ['/funil', '/indicadores', '/professoras', '/ativas', '/grade', '/metas', '/dicionario'],
    nega: [['GET', '/sofia?view=conversas'], ['GET', '/?view=config'], ['GET', '/perfis'], ['GET', '/clube'], ['POST', '/sofia/salvar'], ['POST', '/salvar'], ['POST', '/perfis/criar'], ['POST', '/envio/ativo']] },
  { nome: 'whatsapp', telas: ['msg_config', 'msg_express', 'msg_hoje'], menu: ['msg'],
    abre: ['/?view=config', '/?view=express', '/hoje'],
    nega: [['GET', '/sofia?view=conversas'], ['GET', '/funil'], ['GET', '/perfis'], ['GET', '/grade'], ['POST', '/sofia/campanhas/criar'], ['POST', '/sofia/salvar'], ['POST', '/perfis/criar']] },
  { nome: 'clube', telas: ['slimclub', 'formularios'], menu: ['ind', 'slimclub'],
    abre: ['/clube?view=pendentes', '/formularios'],
    nega: [['GET', '/sofia?view=conversas'], ['GET', '/funil'], ['GET', '/?view=config'], ['GET', '/perfis'], ['POST', '/sofia/salvar'], ['POST', '/salvar']] },
];

test('PAI-01..04 cada perfil vê só o que foi liberado e o servidor nega o resto', { timeout: 240000 }, async () => {
  const amb = ambienteIsolado();
  const porta = await portaLivre();
  let painel;
  try {
    fs.writeFileSync(path.join(amb.exp, '.env'), `PAINEL_PORT=${porta}\nPAINEL_HOST=127.0.0.1\nPAINEL_USER=dono\nPAINEL_SENHA=exemplo-do-dono-123\nSOFIA_DIR=${amb.sofia}\n`);
    amb.gravarSofia('sofia-prompt.txt', 'prompt de exemplo');
    const usuarios = amb.req('usuarios');
    for (const p of PERFIS) usuarios.criar({ usuario: p.nome, senha: 'exemplo-1234', telas: p.telas, trocarSenha: false });
    const env = { ...process.env }; for (const k of ['PAINEL_DEMO', 'PAINEL_PORT', 'PAINEL_USER', 'PAINEL_SENHA', 'SOFIA_DIR']) delete env[k];
    painel = spawn(process.execPath, ['-r', path.resolve(__dirname, '..', 'bloqueios.js'), 'src/painel-mensagens.js'], { cwd: amb.exp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; painel.stdout.on('data', d => { log += d; }); painel.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 60; i++) { const r = await pedir(porta, 'GET', '/login'); if (r.st) break; await new Promise(r => setTimeout(r, 300)); }
    const entrar = async (u, s) => String(((await pedir(porta, 'POST', '/login', '', `usuario=${u}&senha=${s}`)).cookie || [])[0] || '').split(';')[0];

    const falhas = [];
    for (const p of PERFIS) {
      const cookie = await entrar(p.nome, 'exemplo-1234');
      if (!/^sf_sess=/.test(cookie)) { falhas.push(`${p.nome}: não conseguiu entrar`); continue; }
      const primeira = await pedir(porta, 'GET', p.abre[0], cookie);
      const viu = menu(primeira.corpo || '');
      if (viu.join(',') !== p.menu.slice().sort((a, b) => ['ind', 'msg', 'grade', 'slimclub', 'sofia'].indexOf(a) - ['ind', 'msg', 'grade', 'slimclub', 'sofia'].indexOf(b)).join(','))
        falhas.push(`${p.nome}: o menu mostra [${viu.map(k => NOME_MENU[k]).join(', ')}], esperava [${p.menu.map(k => NOME_MENU[k]).join(', ')}]`);
      if (/href="\/perfis"/.test(primeira.corpo || '')) falhas.push(`${p.nome}: aparece o link de Perfis (só do administrador)`);
      for (const u of p.abre) { const r = await pedir(porta, 'GET', u, cookie); if (r.st !== 200) falhas.push(`${p.nome}: GET ${u} deveria abrir (deu ${r.st}${r.loc ? ' → ' + r.loc : ''})`); }
      for (const [m, u] of p.nega) { const r = await pedir(porta, m, u, cookie); if (r.st !== 403) falhas.push(`${p.nome}: ${m} ${u} deveria ser negado (deu ${r.st})`); }
      if (p.naoMostra) { const r = await pedir(porta, 'GET', p.naoMostra.url, cookie); if ((r.corpo || '').includes(p.naoMostra.texto)) falhas.push(`${p.nome}: ${p.naoMostra.url} mostrou "${p.naoMostra.texto}"`); }
    }
    // Administrador: vê tudo (inclusive Perfis) e o menu completo.
    const adm = await entrar('dono', 'exemplo-do-dono-123');
    for (const u of ['/sofia?view=config', '/sofia?view=conversas', '/?view=config', '/funil', '/grade', '/metas', '/perfis', '/perfis?view=auditoria', '/perfis?view=novaloja', '/clube', '/formularios', '/saude']) {
      const r = await pedir(porta, 'GET', u, adm); if (r.st !== 200) falhas.push(`admin: GET ${u} deveria abrir (deu ${r.st})`);
    }
    // Liga/desliga de um envio (toggle dos cartões do WhatsApp e da Cobrança da SoFIA)
    const sw = await pedir(porta, 'POST', '/envio/ativo', adm, JSON.stringify({ chaves: ['cobrancaRecorrente'], ativo: false }));
    if (sw.st !== 200 || !/"ok":true/.test(sw.corpo || '')) falhas.push(`admin: POST /envio/ativo deveria desligar o envio (deu ${sw.st})`);
    else if (amb.req('jobs-ativos').ativo('cobrancaRecorrente') !== false) falhas.push('admin: desligou pelo painel, mas o envio continua ligado');
    // SOF-12: ligar o aquecimento grava o arquivo e volta com a confirmação; desligar apaga
    const aqDir = amb.sofia, aqArq = require('path').join(aqDir, 'sofia-aquecimento.json');
    const liga = await pedir(porta, 'POST', '/sofia/aquecimento', adm, 'dias=7');
    if (liga.st !== 303 || !/okaq=1/.test(String(liga.loc || '')) || !require('fs').existsSync(aqArq)) falhas.push(`admin: POST /sofia/aquecimento deveria ligar e confirmar (deu ${liga.st} ${liga.loc || ''})`);
    const desl = await pedir(porta, 'POST', '/sofia/aquecimento', adm, 'dias=0');
    if (desl.st !== 303 || !/okaq=0/.test(String(desl.loc || '')) || require('fs').existsSync(aqArq)) falhas.push(`admin: POST /sofia/aquecimento dias=0 deveria desligar (deu ${desl.st} ${desl.loc || ''})`);
    // "Gerar código": um pedido a cada 3 min (cada pedido reinicia a SoFIA e abre outra conexão)
    const c1 = await pedir(porta, 'POST', '/sofia/parear', adm, JSON.stringify({ numero: '5561999990000' }));
    const c2 = await pedir(porta, 'POST', '/sofia/parear', adm, JSON.stringify({ numero: '5561999990000' }));
    if (!/"ok":true/.test(c1.corpo || '')) falhas.push(`admin: 1º pedido de código deveria passar (${c1.corpo})`);
    if (!/"ok":false/.test(c2.corpo || '') || !/Espere \d+ s/.test(c2.corpo || '')) falhas.push(`admin: 2º pedido de código em seguida deveria ser recusado (${c2.corpo})`);
    const tudo = menu((await pedir(porta, 'GET', '/funil', adm)).corpo || '');
    if (tudo.length !== 5) falhas.push(`admin: menu incompleto [${tudo.join(', ')}]`);
    assert.deepStrictEqual(falhas, [], falhas.join('\n') + '\n' + log.slice(-800));
  } finally { if (painel) painel.kill(); amb.limpar(); }
});

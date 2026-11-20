// Notificações do painel (push.js): a mensagem vai cifrada para o aparelho, só
// recebe quem tem a permissão HOJE, e o servidor não chama endereço que não seja
// um serviço de push conhecido.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { ambienteIsolado, aparelhoPush: aparelho } = require('../ajuda');

const b64u = (b) => Buffer.from(b).toString('base64url');
function cenario() {
  const amb = ambienteIsolado();
  process.env.PAINEL_USER = 'dono';
  const usuarios = amb.req('usuarios');
  usuarios.criar({ usuario: 'recepcao', senha: 'teste-1234', telas: ['sofia_conversas'] });
  usuarios.criar({ usuario: 'financeiro', senha: 'teste-1234', telas: ['grade'] });
  const push = amb.req('push');
  const enviados = [];
  push.usarTransporte(async (endpoint, headers, corpo) => { enviados.push({ endpoint, headers, corpo }); return { status: /sumiu/.test(endpoint) ? 410 : 201 }; });
  const sess = (u) => push.sessDe(u);
  return { amb, push, usuarios, enviados, sess };
}

test('a notificação vai cifrada para o aparelho e identificada com a chave da unidade', async () => {
  const { amb, push, enviados, sess } = cenario();
  try {
    const ap = aparelho(1);
    push.inscrever(sess('recepcao'), ap.sub, ['atendente'], 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile', 'https://painel.exemplo.com.br');
    const r = await push.enviar('atendente', { titulo: 'SoFIA · Lago Norte', corpo: '🙋 Ana pediu atendente', url: '/sofia?view=conversas', tag: 'atencao' });
    assert.deepStrictEqual(r, { enviados: 1, falhas: 0, removidos: 0 });
    const e = enviados[0];
    assert.strictEqual(e.endpoint, ap.sub.endpoint);
    assert.strictEqual(e.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(!e.corpo.toString('latin1').includes('Ana'), 'o nome não viaja em texto aberto');
    assert.deepStrictEqual(ap.abrir(e.corpo), { titulo: 'SoFIA · Lago Norte', corpo: '🙋 Ana pediu atendente', url: '/sofia?view=conversas', tag: 'atencao' });
    // VAPID: o JWT é assinado pela chave pública anunciada e vale só para aquele serviço
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(e.headers.Authorization);
    assert.ok(m && m[2] === push.chavePublica());
    const [h, p, s] = m[1].split('.'), pub = Buffer.from(m[2], 'base64url');
    const chave = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
    assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: chave, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    assert.strictEqual(claims.aud, 'https://fcm.googleapis.com');
    assert.strictEqual(claims.sub, 'https://painel.exemplo.com.br');
    assert.ok(push.doUsuario('recepcao')[0].ultimoOk > 0);
    assert.strictEqual(push.doUsuario('recepcao')[0].aparelho, 'Chrome no Android');
  } finally { amb.limpar(); }
});

test('só recebe quem tem a permissão — e ela é conferida de novo a cada envio', async () => {
  const { amb, push, usuarios, enviados, sess } = cenario();
  try {
    const rec = aparelho(1), fin = aparelho(2), dono = aparelho(3);
    // quem não vê Conversas nem Saúde não consegue se inscrever em nada
    assert.throws(() => push.inscrever(sess('financeiro'), fin.sub, ['atendente', 'saude'], '', ''), /pelo menos um tipo/);
    // a recepção pede os dois: fica só com o que pode
    assert.deepStrictEqual(push.inscrever(sess('recepcao'), rec.sub, ['atendente', 'agendou', 'recepcao', 'saude'], '', '').tipos, ['atendente', 'agendou', 'recepcao']);
    push.inscrever(sess('dono'), dono.sub, ['atendente', 'saude'], '', '');
    assert.strictEqual((await push.enviar('saude', { titulo: 'Robô parado' })).enviados, 1, 'alerta da Saúde só para o administrador');
    assert.strictEqual(enviados[0].endpoint, dono.sub.endpoint);
    assert.strictEqual((await push.enviar('atendente', { titulo: 'x' })).enviados, 2);
    // a recepção perde a permissão: para de receber, sem precisar desativar o aparelho
    usuarios.definirTelas('recepcao', []);
    enviados.length = 0;
    assert.strictEqual((await push.enviar('atendente', { titulo: 'x' })).enviados, 1);
    assert.strictEqual(enviados[0].endpoint, dono.sub.endpoint);
    // usuário excluído: também não recebe
    usuarios.criar({ usuario: 'temp', senha: 'teste-1234', telas: ['sofia_conversas'] });
    push.inscrever(sess('temp'), aparelho(4).sub, ['atendente'], '', '');
    usuarios.remover('temp');
    enviados.length = 0;
    assert.strictEqual((await push.enviar('atendente', { titulo: 'x' })).enviados, 1);
    assert.strictEqual((await push.enviar('nao-existe', { titulo: 'x' })).enviados, 0);
  } finally { amb.limpar(); }
});

test('endereço de entrega: só serviços de push conhecidos (o painel não chama outro endereço)', () => {
  const { amb, push, sess } = cenario();
  try {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://db5p.notify.windows.com/w/?token=x']) assert.strictEqual(push.endpointOk(ok), true, ok);
    for (const ruim of ['http://fcm.googleapis.com/fcm/send/abc', 'https://127.0.0.1/x', 'https://painel-interno.local/x', 'https://fcm.googleapis.com.malicioso.com/x', 'https://x:y@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd', '']) assert.strictEqual(push.endpointOk(ruim), false, ruim);
    const ap = aparelho(1);
    assert.throws(() => push.inscrever(sess('recepcao'), { ...ap.sub, endpoint: 'https://127.0.0.1:9000/roubar' }, ['atendente'], '', ''), /não reconhece/);
    assert.throws(() => push.inscrever(sess('recepcao'), { endpoint: ap.sub.endpoint, keys: { p256dh: 'curta', auth: 'x' } }, ['atendente'], '', ''), /chaves do aparelho/);
    assert.strictEqual(push.inscricoes().length, 0);
  } finally { amb.limpar(); }
});

test('faxina: aparelho que o serviço diz que sumiu sai da lista; cada um só mexe nos seus', async () => {
  const { amb, push, sess } = cenario();
  try {
    const vivo = aparelho(1), sumiu = aparelho(2);
    sumiu.sub.endpoint = 'https://fcm.googleapis.com/fcm/send/sumiu';
    push.inscrever(sess('recepcao'), vivo.sub, ['atendente'], '', '');
    push.inscrever(sess('recepcao'), sumiu.sub, ['atendente'], '', '');
    const r = await push.enviar('atendente', { titulo: 'x' });
    assert.deepStrictEqual(r, { enviados: 1, falhas: 0, removidos: 1 });
    assert.strictEqual(push.inscricoes().length, 1);
    const id = push.inscricoes()[0].id;
    assert.strictEqual(push.remover('dono', id), false, 'outro usuário não remove o aparelho da recepção');
    await assert.rejects(push.enviarTeste('dono', id), /não está inscrito/);
    assert.strictEqual(await push.enviarTeste('recepcao', id), true);
    assert.strictEqual(push.remover('recepcao', id), true);
    assert.strictEqual(push.inscricoes().length, 0);
    // o que a tela mostra não leva chave nem endereço de entrega
    push.inscrever(sess('recepcao'), vivo.sub, ['atendente'], '', '');
    assert.deepStrictEqual(Object.keys(push.doUsuario('recepcao')[0]).sort(), ['aparelho', 'criadoEm', 'id', 'tipos', 'ultimoOk']);
  } finally { amb.limpar(); }
});

test('na demonstração nada é enviado', async () => {
  const { amb, push, enviados, sess } = cenario();
  try {
    push.inscrever(sess('dono'), aparelho(1).sub, ['saude'], '', '');
    const guarda = amb.req('demo-guard');
    require.cache[amb.arq('demo-guard')].exports = { ...guarda, ativo: true };
    assert.deepStrictEqual(await push.enviar('saude', { titulo: 'x' }), { enviados: 0, falhas: 0, removidos: 0 });
    assert.strictEqual(enviados.length, 0);
    require.cache[amb.arq('demo-guard')].exports = guarda;
  } finally { amb.limpar(); }
});

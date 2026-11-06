/**
 * painel-publicas.js — páginas públicas do painel (login, privacidade, termos).
 * Separado do painel-mensagens.js (que ficou com o servidor e as rotas), sem
 * mudança de lógica.
 */
const {
  ESTILO, esc, ADMIN_EMAIL, IG_NO_PAINEL,
} = require('./painel-base');

// ── Login com Google (OAuth 2.0 / OpenID) — opcional, ligado pelo .env ───────
// Só entra quem tem o e-mail cadastrado num Perfil (ou o e-mail do admin em
// PAINEL_ADMIN_EMAIL). Fica DESLIGADO enquanto não houver GOOGLE_CLIENT_ID e
// GOOGLE_CLIENT_SECRET no .env — aí o botão aparece na tela de login. Reaproveita
// a mesma sessão (cookie HMAC) do login por senha; usuário/senha continua valendo.
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
function googleAtivo() { return !!(GOOGLE_ID && GOOGLE_SECRET); }

// Página de login (sem menu). Simples: usuário + senha.
function paginaLogin(erro) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · SlimFit</title>
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>${ESTILO}
  .loginwrap{max-width:380px;margin:8vh auto;padding:16px}
  .loginwrap .logo-box{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:10px 16px;text-align:center;margin-bottom:18px}
  .loginwrap .logo-box img{height:82px;width:auto;max-width:100%;display:block;margin:0 auto}
  .loginwrap .card{padding:22px}
  .loginwrap h1{font-family:"Inter";font-weight:600;font-size:1.2rem;margin:0 0 4px;text-align:center;letter-spacing:-.02em}
  .loginwrap p.sub{color:var(--cinza);font-size:.86rem;text-align:center;margin:0 0 12px}
  .loginwrap button{width:100%;margin-top:16px}
</style></head><body>
<div class="loginwrap">
  <div class="logo-box"><img alt="SlimFit Studio" src="https://drive.google.com/thumbnail?id=1pl1mh709FGcitG9uHo0J6nzMUKFYqg-w&sz=w400"></div>
  <div class="card">
    <h1>Painel do Studio</h1>
    <p class="sub">Entre com o seu usuário e senha.</p>
    ${erro ? `<div class="aviso err" style="margin:0 0 12px">${esc(erro)}</div>` : ''}
    <form method="POST" action="/login">
      <label>Usuário</label>
      <input type="text" name="usuario" autofocus autocapitalize="none" autocomplete="username" spellcheck="false">
      <label>Senha</label>
      <input type="password" name="senha" autocomplete="current-password" style="width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:11px 12px;font-size:1rem;font-family:inherit;background:#fff">
      <button type="submit" class="save">Entrar</button>
    </form>
    ${googleAtivo() ? `
    <div style="display:flex;align-items:center;gap:10px;margin:18px 0 14px;color:var(--faint);font-size:.8rem"><span style="flex:1;height:1px;background:var(--linha)"></span>ou<span style="flex:1;height:1px;background:var(--linha)"></span></div>
    <a href="/auth/google" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid #dcdcdc;border-radius:10px;padding:11px 12px;font-weight:600;font-size:.95rem;color:#3c4043;background:#fff;text-decoration:none">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Entrar com Google
    </a>` : ''}
  </div>
  <footer>SlimFit · painel do Studio</footer>
</div></body></html>`;
}

// ── Páginas legais (públicas): Política de Privacidade e Termos de Serviço ───
// Precisam ser acessíveis SEM login (o Google lê ao publicar o app OAuth).
function docLegal(titulo, atualizacao, corpo, { voltar = true } = {}) {
  // Documentos legais assinados pela ferramenta (Painel CRM), sem a marca/nome da unidade.
  const studio = 'Painel CRM';
  const contato = ADMIN_EMAIL ? esc(ADMIN_EMAIL) : 'o administrador do Studio';
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Painel CRM</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${ESTILO}
  .legal{max-width:720px;margin:6vh auto;padding:0 22px 60px}
  .legal .card{padding:30px 28px}
  .legal h1{font-family:"Inter";font-weight:700;font-size:1.5rem;margin:0 0 4px;letter-spacing:-.02em}
  .legal .quando{margin:0 0 18px}
  .legal h2{font-family:"Inter";font-weight:700;font-size:1.02rem;color:var(--teal-esc);margin:22px 0 6px}
  .legal p{margin:0 0 10px;color:var(--tinta);font-size:.95rem;line-height:1.65}
  .legal ul{margin:0 0 10px;padding-left:20px;color:var(--tinta);font-size:.95rem;line-height:1.6}
  .legal a{color:var(--teal)}
  .legal .back{display:inline-block;margin-bottom:16px;color:var(--cinza);text-decoration:none;font-size:.9rem}
  @media(max-width:560px){.legal{margin:16px auto;padding:0 12px 40px}.legal .card{padding:22px 18px}}
</style></head><body>
<div class="legal">
  ${voltar ? '<a class="back" href="/login">← Voltar ao login</a>' : ''}
  <div class="card">
    <h1>${esc(titulo)}</h1>
    <p class="quando">Última atualização: ${esc(atualizacao)} · ${studio}</p>
    ${corpo(studio, contato)}
  </div>
</div></body></html>`;
}
// Política pública (LGPD): vale para alunas, leads e para a equipe. Servida em
// /politicadeprivacidade (link usado em formulários, Meta e Google) e /privacidade.
function paginaPrivacidade() {
  return docLegal('Política de Privacidade', '30/10/2026', (studio, contato) => `
    <p>Esta política explica como o <b>Painel CRM</b> e o estúdio que o utiliza (“Studio”, “nós”) coletam, usam, guardam e protegem os dados pessoais de alunas, ex-alunas, interessadas (leads), empresas parceiras e da própria equipe, conforme a <b>Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD)</b>.</p>

    <h2>1. Quem é o responsável pelos seus dados</h2>
    <p>O controlador dos dados é o <b>estúdio com quem você tem relação</b> — o que enviou a mensagem, o formulário ou o link. O Painel CRM é a ferramenta que ele usa para atender e se comunicar com você. Para qualquer assunto sobre seus dados, fale com a gente pelo WhatsApp ou pela recepção do Studio, ou pelo e-mail ${contato}.</p>

    <h2>2. Quais dados coletamos</h2>
    <ul>
      <li><b>Dados que você informa:</b> nome, telefone/WhatsApp, e-mail e as respostas que você der nos nossos formulários (agendamento de aula experimental, listas de campanhas e promoções, cadastro no clube de benefícios) e no atendimento.</li>
      <li><b>Dados de matrícula:</b> quando você se torna aluna, os dados do contrato ficam no nosso sistema de gestão (por exemplo: nome, CPF, data de nascimento, contato, plano, horários, frequência e situação de pagamentos).</li>
      <li><b>Conversas:</b> mensagens trocadas com o Studio pelo WhatsApp (inclusive com a SoFIA, nossa assistente virtual)${IG_NO_PAINEL ? ' e pelo Instagram (comentários e mensagens no Direct)' : ''}, incluindo áudios e imagens que você enviar.</li>
      <li><b>Clube de benefícios:</b> se você cadastrar o seu negócio, os dados do anúncio (nome do negócio, categoria, CPF/CNPJ, benefício oferecido, Instagram, WhatsApp e foto ou logo), além do registro de uso dos benefícios e das avaliações.</li>
      <li><b>Dados técnicos:</b> endereço IP e dados básicos de acesso às nossas páginas, usados para segurança e para evitar envios automáticos (robôs).</li>
      <li><b>Equipe do Studio:</b> quem usa o painel interno tem nome de usuário, e-mail e registro de acessos. No login com Google recebemos apenas o e-mail e o nome do perfil; <b>não</b> acessamos caixa de e-mail, arquivos ou contatos.</li>
    </ul>

    <h2>3. Para que usamos e com qual base legal</h2>
    <ul>
      <li><b>Agendar e confirmar aulas, responder dúvidas e fazer o atendimento</b> — procedimentos preliminares e execução de contrato (art. 7º, V).</li>
      <li><b>Gerir a matrícula:</b> horários, frequência, renovações, avisos de vencimento e cobrança de valores em aberto — execução de contrato (art. 7º, V) e exercício regular de direitos (art. 7º, VI).</li>
      <li><b>Enviar novidades, promoções e campanhas</b> (por exemplo, para quem entrou numa lista de interesse) — consentimento (art. 7º, I) ou legítimo interesse (art. 7º, IX), sempre com a opção de parar de receber.</li>
      <li><b>Mensagens de relacionamento</b>, como aniversário e lembretes — legítimo interesse (art. 7º, IX).</li>
      <li><b>Funcionar o clube de benefícios</b> (exibir o anúncio para as alunas e conferir o uso dos benefícios) — consentimento dado no cadastro (art. 7º, I).</li>
      <li><b>Segurança, prevenção a fraudes e cumprimento de obrigações legais</b> — art. 7º, II e IX.</li>
    </ul>

    <h2>4. Mensagens no WhatsApp e como parar de receber</h2>
    <p>Podemos enviar pelo WhatsApp confirmações e lembretes de aula, avisos sobre a matrícula e os pagamentos e, para quem demonstrou interesse, ofertas e campanhas. <b>Para não receber mais mensagens promocionais, basta nos pedir pelo próprio WhatsApp</b> (ou na recepção) — atendemos o pedido e deixamos de enviar. Avisos indispensáveis do contrato (por exemplo, sobre a sua matrícula) podem continuar enquanto ele estiver ativo.</p>

    <h2>5. Assistente virtual com inteligência artificial (SoFIA)</h2>
    <p>Parte do atendimento no WhatsApp é feita pela SoFIA, uma assistente virtual. Para responder, o conteúdo da conversa é processado por um <b>provedor de inteligência artificial</b> contratado, apenas para gerar a resposta. Áudios podem ser transcritos automaticamente para o mesmo fim. Você pode pedir para falar com uma pessoa da equipe a qualquer momento.</p>

    ${IG_NO_PAINEL ? `    <h2>6. Instagram (API oficial da Meta)</h2>
    <p>O Studio conecta sua <b>própria conta profissional do Instagram</b> ao painel pela <b>API oficial da Meta</b>:</p>
    <ul>
      <li><b>O que recebemos:</b> quando alguém comenta em um post do Studio ou envia uma mensagem no Direct, a Meta nos envia o texto e o identificador público de quem enviou.</li>
      <li><b>Para que usamos:</b> identificar interesse (por exemplo, um comentário com uma palavra-chave) e responder no Direct com uma saudação e o link para agendar uma aula experimental.</li>
      <li><b>O que não fazemos:</b> não enviamos mensagens a quem não interagiu, não coletamos sua lista de seguidores, não publicamos em seu nome e não vendemos esses dados.</li>
    </ul>
    <p>Esse uso segue as Políticas da Plataforma da Meta.</p>
` : ''}
    <h2>${IG_NO_PAINEL ? 7 : 6}. Com quem compartilhamos</h2>
    <p><b>Não vendemos nem alugamos dados pessoais.</b> Compartilhamos apenas o necessário com quem nos ajuda a prestar o serviço:</p>
    <ul>
      <li><b>Sistema de gestão de academias</b> (cadastro, contratos, agenda e pagamentos);</li>
      <li><b>Meta</b> (${IG_NO_PAINEL ? 'WhatsApp e Instagram' : 'WhatsApp'}) para enviar e receber mensagens;</li>
      <li><b>Google</b> (login da equipe e planilhas internas);</li>
      <li><b>Provedores de inteligência artificial</b> (respostas da assistente virtual e transcrição de áudios);</li>
      <li><b>Provedor de hospedagem</b> onde ficam o painel e os formulários;</li>
      <li><b>Bancos e meios de pagamento</b>, para boletos e cobranças;</li>
      <li><b>Autoridades públicas</b>, quando exigido por lei ou ordem judicial.</li>
    </ul>
    <p>No clube de benefícios, os dados do anúncio que você cadastrou ficam visíveis para as alunas do Studio que acessam a listagem.</p>
    <p>Alguns desses fornecedores podem guardar dados fora do Brasil; nesses casos exigimos que sigam regras de proteção compatíveis com a LGPD.</p>

    <h2>${IG_NO_PAINEL ? 8 : 7}. Por quanto tempo guardamos</h2>
    <p>Guardamos os dados enquanto forem necessários para a finalidade de cada um: durante o atendimento e a matrícula e, depois disso, pelo prazo exigido por lei (por exemplo, obrigações fiscais e para defesa em eventuais processos). Respostas de formulários de campanha ficam até o fim da campanha ou até você pedir a exclusão. O histórico de conversas tem prazo de retenção definido no painel.</p>

    <h2>${IG_NO_PAINEL ? 9 : 8}. Como protegemos</h2>
    <p>As páginas e o painel usam conexão segura (<b>HTTPS</b>). O acesso ao painel é restrito à equipe autorizada, com senha guardada de forma protegida (hash), sessão por cookie assinado e registro de acessos. Formulários públicos têm proteção contra envios automáticos.</p>

    <h2>${IG_NO_PAINEL ? 10 : 9}. Cookies</h2>
    <p>Usamos apenas cookies <b>essenciais</b>: para manter a equipe conectada ao painel, as alunas conectadas ao clube de benefícios e, nos formulários, um identificador anônimo do navegador para contar as visitas. Não usamos cookies de publicidade nem de rastreamento de terceiros nessas páginas.</p>
    <p>Os <b>links de formulário que o Studio envia por WhatsApp</b> (por exemplo, numa campanha) podem ter um código pessoal. Com ele registramos <b>se e quando você abriu</b> a página, para saber se a mensagem foi útil e não insistir com quem já respondeu. Esse registro fica só no Studio e segue os prazos e direitos desta política.</p>

    <h2>${IG_NO_PAINEL ? 11 : 10}. Seus direitos</h2>
    <p>Pela LGPD (art. 18), você pode, a qualquer momento e sem custo:</p>
    <ul>
      <li>confirmar se tratamos seus dados e ter acesso a eles;</li>
      <li>corrigir dados incompletos, inexatos ou desatualizados;</li>
      <li>pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desacordo com a lei;</li>
      <li>pedir a portabilidade dos dados;</li>
      <li>saber com quem compartilhamos seus dados;</li>
      <li>revogar o consentimento e pedir a eliminação dos dados tratados com base nele;</li>
      <li>se opor a um tratamento feito com base em legítimo interesse.</li>
    </ul>
    <p>Para exercer seus direitos, fale com a gente pelos canais do item 1. Também é possível reclamar à <b>Autoridade Nacional de Proteção de Dados (ANPD)</b>.</p>

    <h2>${IG_NO_PAINEL ? 12 : 11}. Menores de idade</h2>
    <p>Dados de menores de 18 anos só são tratados com autorização e acompanhamento do responsável legal.</p>

    <h2>${IG_NO_PAINEL ? 13 : 12}. Alterações</h2>
    <p>Esta política pode ser atualizada; a data no topo indica a versão em vigor. Mudanças importantes serão comunicadas pelos nossos canais.</p>`, { voltar: false });
}
function paginaTermos() {
  return docLegal('Termos de Serviço', '28/08/2026', (studio, contato) => `
    <p>Ao acessar o <b>Painel CRM</b>, você concorda com estes termos.</p>
    <h2>1. Objeto</h2>
    <p>O painel é uma ferramenta <b>interna de gestão</b> do estúdio que o utiliza, de uso restrito à equipe autorizada.</p>
    <h2>2. Acesso</h2>
    <p>O acesso é concedido pelo <b>administrador</b> do Studio e pode ser <b>revogado a qualquer momento</b>. Cada usuário é responsável por manter suas credenciais em sigilo.</p>
    <h2>3. Uso aceitável</h2>
    <p>O painel deve ser usado apenas para as atividades legítimas do Studio. É proibido tentar acessar dados sem autorização, burlar o controle de acesso ou usar o sistema para fins ilícitos.</p>
    <h2>4. Dados</h2>
    <p>O tratamento de dados segue a <a href="/politicadeprivacidade">Política de Privacidade</a>.</p>
    <h2>5. Disponibilidade</h2>
    <p>O serviço é fornecido “no estado em que se encontra”. Buscamos manter o painel disponível, mas não garantimos funcionamento ininterrupto.</p>
    <h2>6. Contato</h2>
    <p>${contato}.</p>`);
}

module.exports = {
  GOOGLE_ID, GOOGLE_SECRET, googleAtivo, paginaLogin, docLegal, paginaPrivacidade, paginaTermos,
};

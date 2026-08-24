/**
 * render.js — a página do paciente montada NO SERVIDOR.
 *
 * Antes ela era montada no navegador a partir de moldes, e o HTML entregue
 * vinha vazio: título, textos e seções só apareciam depois do JavaScript rodar.
 * Para o Google isso é uma página em branco — e para um oncologista, ser
 * encontrado na busca é metade do motivo de existir o site.
 *
 * Agora o HTML sai pronto do servidor, com o conteúdo que o médico editou no
 * painel. O JavaScript continua existindo, mas só para o formulário de
 * agendamento: se ele falhar, a página ainda é legível por inteiro.
 *
 * Não trouxemos framework para isso. O conteúdo já mora em dados/config.json e
 * o servidor já é Node — gerar HTML aqui são algumas funções. Um Next.js
 * exigiria build a cada alteração, o que mataria a coisa mais útil do painel:
 * o médico salva e o site muda na hora.
 */
const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];
const DIAS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const DIAS_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------ auxiliares */

function iniciais(nome) {
  return String(nome || '').replace(/^(Dr|Dra|Prof)\.?\s+/i, '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase() || '+';
}

/** "Segundas, terças e quartas de manhã · quintas à tarde" */
function resumoExpediente(hospital) {
  const faixas = hospital.expediente || [];
  if (!faixas.length) return 'horários a confirmar';
  return faixas.map((f) => {
    const nomes = [...f.dias].sort().map((d) => DIAS_PLURAL[d]);
    if (!nomes.length) return '';
    const lista = nomes.length > 1
      ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
      : nomes[0];
    return `${lista[0].toUpperCase()}${lista.slice(1)} ${turno(f)}`;
  }).filter(Boolean).join(' · ');
}

function turno(faixa) {
  const inicio = Number(String(faixa.inicio).slice(0, 2));
  const fim = Number(String(faixa.fim).slice(0, 2));
  if (fim <= 12) return 'de manhã';
  if (inicio >= 18) return 'à noite';
  if (inicio >= 12) return 'à tarde';
  return `das ${faixa.inicio} às ${faixa.fim}`;
}

/** "Seg/Ter/Qua 07:30–12:00 · Qui 14:00–17:00" */
function horariosDetalhados(hospital) {
  return (hospital.expediente || []).map((f) => {
    const nomes = [...f.dias].sort().map((d) => DIAS_LONGOS[d].slice(0, 3));
    return `${nomes.join('/')} ${f.inicio}–${f.fim}`;
  }).join(' · ');
}

/* -------------------------------------------------------------- cabeçalho */

function descricaoDaPagina(pagina, medico) {
  const base = (pagina.hero.lede || pagina.sobre.paragrafos[0] || '')
    .replace(/\s+/g, ' ').trim();
  const quem = [medico.nome, medico.especialidade].filter(Boolean).join(' · ');
  return `${quem}${quem && base ? '. ' : ''}${base}`.slice(0, 300);
}

/**
 * Dados estruturados para o Google entender que isto é um médico, onde ele
 * atende e em que horários. É o que alimenta o painel de conhecimento e as
 * buscas do tipo "oncologista perto de mim".
 */
function dadosEstruturados({ pagina, medico, hospitais, url }) {
  const dados = {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    name: medico.nome || undefined,
    medicalSpecialty: medico.especialidade || undefined,
    description: descricaoDaPagina(pagina, medico) || undefined,
    url: url || undefined,
    image: pagina.hero.foto && url ? new URL(pagina.hero.foto, url).href : undefined,
    availableService: (pagina.sobre.areas || []).map((a) => ({
      '@type': 'MedicalProcedure', name: a.nome,
    })),
  };

  const locais = hospitais.filter((h) => h.endereco && h.endereco !== 'a definir');
  if (locais.length) {
    dados.location = locais.map((h) => ({
      '@type': 'MedicalClinic',
      name: h.nome,
      address: { '@type': 'PostalAddress', streetAddress: h.endereco, addressCountry: 'BR' },
      telephone: h.telefone || undefined,
      openingHoursSpecification: (h.expediente || []).map((f) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: f.dias.map((d) => DIAS_SCHEMA[d]),
        opens: f.inicio,
        closes: f.fim,
      })),
    }));
  }

  return JSON.stringify(dados, (k, v) => (v === undefined ? undefined : v));
}

function cabeca({ pagina, medico, hospitais, url }) {
  const titulo = [medico.nome, medico.especialidade].filter(Boolean).join(' — ')
    || pagina.hero.titulo || 'Agendamento de consulta';
  const descricao = descricaoDaPagina(pagina, medico);
  const imagem = pagina.hero.foto && url ? new URL(pagina.hero.foto, url).href : '';

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
${imagem ? `<meta property="og:image" content="${esc(imagem)}">` : ''}
<meta property="og:locale" content="pt_BR">
<meta name="twitter:card" content="${imagem ? 'summary_large_image' : 'summary'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Karla:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/estilo.css">
<script type="application/ld+json">${dadosEstruturados({ pagina, medico, hospitais, url })}</script>`;
}

/* ------------------------------------------------------------------ corpo */

function topo({ pagina, medico }) {
  const links = pagina.ordem
    .filter((id) => !(pagina.ocultas || []).includes(id) && id !== 'agendar')
    .map((id) => `<a href="#${id}">${esc(NOME_SECAO[id])}</a>`)
    .join('\n        ');

  return `<div class="topbar">
  <div class="wrap">
    <div class="brandmark">
      <div class="sigil" aria-hidden="true">${esc(iniciais(medico.nome))}</div>
      <div><b>${esc(medico.nome)}</b><span>${esc(medico.especialidade)}</span></div>
    </div>
    <nav class="topnav">
        ${links}
      <a class="btn sm" href="#agendar">${esc(pagina.hero.botaoPrimario || 'Agendar consulta')}</a>
    </nav>
  </div>
</div>`;
}

const NOME_SECAO = { sobre: 'Sobre', locais: 'Onde atendo', agendar: 'Agendamento', duvidas: 'Dúvidas' };

function hero({ pagina, medico }) {
  const h = pagina.hero;
  const mostraSobre = !(pagina.ocultas || []).includes('sobre');

  const credenciais = (h.credenciais || []).map((c) => `<span>${esc(c)}</span>`).join('');
  const destaques = (h.destaques || [])
    .map((d) => `<div><b>${esc(d.valor)}</b><span>${esc(d.rotulo)}</span></div>`).join('');

  return `<header class="hero">
  <div class="wrap hero-grid">
    <div>
      ${h.eyebrow ? `<div class="eyebrow">${esc(h.eyebrow)}</div>` : ''}
      <h1>${esc(h.titulo)}</h1>
      ${h.lede ? `<p class="lede">${esc(h.lede)}</p>` : ''}
      <div class="hero-actions">
        <a class="btn" href="#agendar">${esc(h.botaoPrimario || 'Agendar consulta')}</a>
        ${h.botaoSecundario && mostraSobre
          ? `<a class="btn ghost" href="#sobre">${esc(h.botaoSecundario)}</a>` : ''}
      </div>
      ${credenciais ? `<div class="credential">${credenciais}</div>` : ''}
      ${destaques ? `<div class="factstrip">${destaques}</div>` : ''}
    </div>
    ${h.foto
      ? `<div class="portrait com-foto"><img src="${esc(h.foto)}" alt="${esc(medico.nome || 'Foto do médico')}" width="800" height="1000"></div>`
      : ''}
  </div>
</header>`;
}

function secaoSobre(pagina) {
  const s = pagina.sobre;
  const paragrafos = (s.paragrafos || []).map((t) => `<p>${esc(t)}</p>`).join('\n          ');
  const areas = (s.areas || [])
    .map((a) => `<span class="chip${a.destaque ? ' solid' : ''}">${esc(a.nome)}</span>`).join('');
  const formacao = (s.formacao || []).map((f) =>
    `<div><dt>${esc(f.ano)}</dt><dd>${esc(f.titulo)}${f.detalhe ? `<span>${esc(f.detalhe)}</span>` : ''}</dd></div>`
  ).join('\n          ');

  return `<section id="sobre">
  <div class="wrap two">
    <div>
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}
      <h2>${esc(s.titulo)}</h2>
      <div class="prose" style="margin-top:16px">
          ${paragrafos}
      </div>
      ${areas ? `<div style="margin-top:30px">
        <div class="eyebrow">${esc(s.tituloAreas)}</div>
        <div class="chips" style="margin-top:12px">${areas}</div>
      </div>` : ''}
    </div>
    ${formacao ? `<div class="card">
      <div class="eyebrow">${esc(s.tituloFormacao)}</div>
      <dl class="timeline" style="margin-top:14px">
          ${formacao}
      </dl>
    </div>` : ''}
  </div>
</section>`;
}

function secaoLocais(pagina, hospitais) {
  const s = pagina.locais;
  const cartoes = hospitais.map((h) => `<article class="card local" data-loc="${esc(h.id)}">
        <h3>${esc(h.nome)}</h3>
        <ul>
          ${h.endereco && h.endereco !== 'a definir' ? `<li><b>Endereço</b><span>${esc(h.endereco)}</span></li>` : ''}
          <li><b>Dias</b><span>${esc(horariosDetalhados(h))}</span></li>
          <li><b>Consulta</b><span>${h.duracaoMin} minutos</span></li>
          ${h.telefone ? `<li><b>Telefone</b><span>${esc(h.telefone)}</span></li>` : ''}
        </ul>
      </article>`).join('\n      ');

  return `<section id="locais">
  <div class="wrap">
    <div class="sec-head">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}
      <h2>${esc(s.titulo)}</h2>
      ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
    </div>
    <div class="locais">
      ${cartoes || '<p class="muted">Locais de atendimento em breve.</p>'}
    </div>
  </div>
</section>`;
}

function secaoDuvidas(pagina) {
  const s = pagina.duvidas;
  const itens = (s.itens || []).map((d, i) =>
    `<details${i === 0 ? ' open' : ''}><summary>${esc(d.pergunta)}</summary><p>${esc(d.resposta)}</p></details>`
  ).join('\n      ');

  return `<section id="duvidas">
  <div class="wrap">
    <div class="sec-head">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}
      <h2>${esc(s.titulo)}</h2>
    </div>
    <div class="faq">
      ${itens}
    </div>
  </div>
</section>`;
}

function rodape({ pagina, medico }) {
  const identificacao = [medico.nome, medico.especialidade, medico.crm]
    .filter(Boolean).map(esc).join(' · ');
  const linhas = (pagina.rodape || []).map((l) => `<div>${esc(l)}</div>`).join('\n    ');
  return `<footer>
  <div class="wrap">
    <div><strong>${identificacao}</strong></div>
    ${linhas}
  </div>
</footer>`;
}

/**
 * A seção de agendamento, com o formulário inteiro no HTML.
 *
 * Os locais vêm renderizados: quem chega sem JavaScript ainda lê onde o médico
 * atende. Os horários é que dependem do script, porque saem de uma consulta ao
 * Google feita na hora.
 */
function secaoAgendar(pagina, hospitais) {
  const s = pagina.agendar;

  const locais = hospitais.map((h, i) => `<button type="button" data-loc="${esc(h.id)}" aria-pressed="false">
              <span class="name">${esc(h.nome)}</span>
              <span class="meta">${esc(resumoExpediente(h))}</span>
              ${h.endereco && h.endereco !== 'a definir' ? `<span class="meta">${esc(h.endereco)}</span>` : ''}
              <span class="cal"><i class="dot${i % 2 ? ' b' : ''}"></i> Consulta de ${h.duracaoMin} minutos</span>
            </button>`).join('\n            ');

  const preparo = (s.preparo || []).map((t) => `<li>${esc(t)}</li>`).join('\n              ');

  return `<section id="agendar">
  <div class="wrap">
    <div class="sec-head">
      ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}
      <h2>${esc(s.titulo)}</h2>
      ${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}
    </div>

    <div class="booker">
      <aside class="rail">
        <h3>Seu agendamento</h3>
        <ol id="rail">
          <li data-step="1" data-state="active"><span class="num">1</span> Local</li>
          <li data-step="2"><span class="num">2</span> Dia e horário</li>
          <li data-step="3"><span class="num">3</span> Seus dados</li>
          <li data-step="4"><span class="num">4</span> Revisar e enviar</li>
        </ol>
        ${s.avisoUrgencia ? `<div class="railfoot">${esc(s.avisoUrgencia)}</div>` : ''}
      </aside>

      <div class="stage">
        <div class="step" data-step="1" data-active="true">
          <h3>Onde você quer ser atendido?</h3>
          <p class="hint">Cada local tem dias e horários próprios.</p>
          <div class="pick" id="pickLocal">
            ${locais || '<p class="carregando">Locais de atendimento em breve.</p>'}
          </div>
          <div class="stepnav">
            <span></span>
            <button class="btn" type="button" data-go="2" disabled>Continuar</button>
          </div>
        </div>

        <div class="step" data-step="2">
          <h3>Quando fica melhor para você?</h3>
          <p class="hint" id="hintDia">Escolha o local para ver os horários.</p>
          <div class="days" id="days"></div>
          <div class="slots" id="slots"></div>
          <div class="legend">
            <span><i class="sel"></i> selecionado</span>
            <span><i class="busy"></i> já ocupado na agenda</span>
            <span><i></i> livre</span>
          </div>
          <div class="stepnav">
            <button class="btn ghost" type="button" data-go="1">Voltar</button>
            <button class="btn" type="button" data-go="3" disabled>Continuar</button>
          </div>
        </div>

        <div class="step" data-step="3">
          <h3>Seus dados</h3>
          <p class="hint">Precisamos disso para a recepção confirmar e preparar seu prontuário.</p>
          <form id="form" novalidate>
            <div class="fields">
              <div class="field full" data-name="nome">
                <label for="f-nome">Nome completo do paciente <span class="req">*</span></label>
                <input id="f-nome" name="nome" autocomplete="name" placeholder="Como está no documento">
              </div>
              <div class="field" data-name="nascimento">
                <label for="f-nasc">Data de nascimento <span class="req">*</span></label>
                <input id="f-nasc" name="nascimento" type="date" min="1900-01-01">
              </div>
              <div class="field" data-name="telefone">
                <label for="f-tel">WhatsApp com DDD <span class="req">*</span></label>
                <input id="f-tel" name="telefone" inputmode="tel" autocomplete="tel" placeholder="(62) 90000-0000">
                <span class="help">É por aqui que a recepção confirma.</span>
              </div>
              <div class="field" data-name="tipo">
                <label for="f-tipo">Tipo de consulta <span class="req">*</span></label>
                <select id="f-tipo" name="tipo">
                  <option value="">Selecione…</option>
                  <option>Primeira consulta</option>
                  <option>Retorno</option>
                  <option>Segunda opinião</option>
                  <option>Avaliação pré-tratamento</option>
                </select>
              </div>
              <div class="field" data-name="pagamento">
                <label for="f-pag">Convênio ou particular <span class="req">*</span></label>
                <select id="f-pag" name="pagamento">
                  <option value="">Selecione…</option>
                  <option>Particular</option>
                  <option>Convênio — Unimed</option>
                  <option>Convênio — Bradesco Saúde</option>
                  <option>Convênio — SulAmérica</option>
                  <option>Convênio — outro</option>
                </select>
              </div>
              <div class="field full" data-name="carteirinha">
                <label for="f-cart">Número da carteirinha</label>
                <input id="f-cart" name="carteirinha" placeholder="Se for por convênio">
              </div>
              <div class="field full" data-name="motivo">
                <label for="f-motivo">Motivo da consulta</label>
                <textarea id="f-motivo" name="motivo" maxlength="1000" placeholder="Em poucas linhas: o que está acontecendo, desde quando, se já tem diagnóstico ou laudo."></textarea>
              </div>
              <div class="field full" data-name="encaminhamento">
                <label for="f-enc">Quem encaminhou / indicou</label>
                <input id="f-enc" name="encaminhamento" placeholder="Nome do médico, se houver">
              </div>
              <label class="consent" data-name="consentimento">
                <input type="checkbox" id="f-consent" name="consentimento">
                <span>
                  Autorizo o uso destes dados para agendar e confirmar a consulta, conforme a
                  LGPD. Informações de saúde são tratadas em sigilo pela equipe do consultório.
                </span>
              </label>
            </div>
            <div class="formerr" id="formerr"></div>
          </form>
          <div class="stepnav">
            <button class="btn ghost" type="button" data-go="2">Voltar</button>
            <button class="btn" type="button" data-go="4">Revisar</button>
          </div>
        </div>

        <div class="step" data-step="4">
          <h3>Confira antes de enviar</h3>
          <p class="hint">Se algo estiver errado, é só voltar e corrigir.</p>
          <div class="review" id="review"></div>
          <div class="notice">
            <span class="ic" aria-hidden="true">!</span>
            <span>
              Isto é um <strong>pedido de agendamento</strong>. A consulta só está garantida
              depois que a recepção confirmar com você pelo WhatsApp.
            </span>
          </div>
          <div class="formerr" id="enviarerr"></div>
          <div class="stepnav">
            <button class="btn ghost" type="button" data-go="3">Voltar</button>
            <button class="btn" type="button" id="enviar">Enviar pedido</button>
          </div>
        </div>

        <div class="step" data-step="5">
          <div class="done-head">
            <div class="tick" aria-hidden="true">✓</div>
            <div>
              <h3>Pedido enviado</h3>
              <p class="hint" style="margin-bottom:0" id="doneMsg"></p>
              <span class="protocol" id="protocolo"></span>
            </div>
          </div>
          ${preparo ? `<div class="preparo">
            <h4>Enquanto isso, vá separando</h4>
            <ul>
              ${preparo}
            </ul>
          </div>` : ''}
          <div class="notice">
            <span class="ic" aria-hidden="true">!</span>
            <span>Se piorar antes da consulta — febre alta, dor intensa, sangramento ou falta de ar — procure o pronto-socorro. Não espere a data.</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

const SECOES = {
  sobre: (pagina) => secaoSobre(pagina),
  locais: (pagina, hospitais) => secaoLocais(pagina, hospitais),
  agendar: (pagina, hospitais) => secaoAgendar(pagina, hospitais),
  duvidas: (pagina) => secaoDuvidas(pagina),
};

/** A página inteira, pronta para o navegador e para o buscador. */
function paginaCompleta({ pagina, medico, hospitais, url }) {
  const ocultas = pagina.ocultas || [];
  const corpo = pagina.ordem
    .filter((id) => !ocultas.includes(id) && SECOES[id])
    .map((id) => SECOES[id](pagina, hospitais))
    .join('\n\n');

  // os dados dos locais viajam junto: o formulário precisa deles e assim evita
  // uma ida ao servidor logo no primeiro clique
  const dadosLocais = JSON.stringify(hospitais.map((h) => ({
    id: h.id, nome: h.nome, duracaoMin: h.duracaoMin, expediente: h.expediente || [],
  })));

  return `<!doctype html>
<html lang="pt-BR">
<head>
${cabeca({ pagina, medico, hospitais, url })}
</head>
<body>

${topo({ pagina, medico })}

${hero({ pagina, medico })}

<main>
${corpo}
</main>

${rodape({ pagina, medico })}

<script id="locais-json" type="application/json">${dadosLocais.replace(/</g, '\\u003c')}</script>
<script src="/app.js" defer></script>
</body>
</html>`;
}

module.exports = { esc, iniciais, resumoExpediente, horariosDetalhados, turno, cabeca,
  descricaoDaPagina, dadosEstruturados, topo, hero, secaoSobre, secaoLocais, secaoDuvidas,
  secaoAgendar, rodape, paginaCompleta, NOME_SECAO, DIAS_LONGOS, DIAS_PLURAL };

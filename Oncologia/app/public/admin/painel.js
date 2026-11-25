/**
 * painel.js — a tela onde o médico edita os locais de atendimento.
 *
 * Toda validação que importa é do servidor; aqui só cuidamos de mostrar os
 * erros no campo certo e de não deixar a tela mostrar um estado diferente do
 * que está gravado — por isso cada resposta devolve a configuração inteira e a
 * tela é redesenhada a partir dela.
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DIAS = [
    { n: 1, curto: 'Seg', longo: 'segunda' }, { n: 2, curto: 'Ter', longo: 'terça' },
    { n: 3, curto: 'Qua', longo: 'quarta' }, { n: 4, curto: 'Qui', longo: 'quinta' },
    { n: 5, curto: 'Sex', longo: 'sexta' }, { n: 6, curto: 'Sáb', longo: 'sábado' },
    { n: 0, curto: 'Dom', longo: 'domingo' },
  ];

  var estado = { config: null, contaServico: null, editando: null, faixas: [], zap: null, relogioZap: null };

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  async function api(caminho, opcoes) {
    var r = await fetch('/admin/api' + caminho, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, opcoes || {}));
    var corpo = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      // resposta sem JSON (erro do próprio servidor web) não pode virar
      // "não consegui falar com o servidor" — isso esconde a causa
      if (!corpo.erro) {
        corpo.erro = r.status === 413
          ? 'O arquivo é grande demais para enviar.'
          : 'O servidor respondeu ' + r.status + '. Veja os logs se persistir.';
      }
      var e = new Error(corpo.erro || 'Não consegui falar com o servidor.');
      e.codigo = corpo.codigo; e.erros = corpo.erros; e.status = r.status;
      throw e;
    }
    return corpo;
  }

  function mostrarErro(caixa, texto) {
    caixa.textContent = texto || '';
    caixa.setAttribute('data-show', texto ? 'true' : 'false');
  }

  function marcarCampos(erros) {
    $$('.field[data-name]').forEach(function (f) { f.setAttribute('data-error', 'false'); });
    Object.keys(erros || {}).forEach(function (nome) {
      var f = $('.field[data-name="' + nome + '"]');
      if (f) {
        f.setAttribute('data-error', 'true');
        var ajuda = $('.help', f);
        if (ajuda) ajuda.textContent = erros[nome];
      }
    });
  }

  /* ---------------------------------------------------------- entrar */

  $('#formEntrar').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var botao = $('#formEntrar button');
    botao.disabled = true;
    try {
      await api('/entrar', { method: 'POST', body: JSON.stringify({ senha: $('#senha').value }) });
      $('#senha').value = '';
      mostrarErro($('#erroEntrar'), '');
      await abrirPainel();
    } catch (e) {
      mostrarErro($('#erroEntrar'), e.message);
    } finally {
      botao.disabled = false;
    }
  });

  $('#sair').addEventListener('click', async function () {
    await api('/sair', { method: 'POST' }).catch(function () {});
    location.reload();
  });

  async function abrirPainel() {
    var r = await api('/config');
    estado.config = r.config;
    estado.contaServico = r.contaDeServico;
    $('#telaEntrar').hidden = true;
    $('#telaPainel').hidden = false;
    desenhar();
    desenharLinks();
    verZap();
    verMetricas();
    if (window.EditorConteudo) {
      EditorConteudo.iniciar(api).catch(function (e) {
        $('#editorConteudo').innerHTML =
          '<p class="erro-slot">Não consegui carregar o conteúdo do site: ' + escapar(e.message) + '</p>';
      });
    }
  }

  /* ------------------------------------------------- links de divulgação */

  var CANAIS_DIVULGACAO = [
    { rotulo: 'whatsapp', nome: 'WhatsApp', onde: 'mensagens que você manda para pacientes' },
    { rotulo: 'indicacao', nome: 'Indicação', onde: 'colegas que encaminham pacientes' },
    { rotulo: 'propaganda', nome: 'Propaganda', onde: 'anúncios pagos, panfleto, outdoor' },
    { rotulo: 'instagram', nome: 'Instagram', onde: 'link da bio' },
  ];

  function desenharLinks() {
    var base = location.origin + '/?de=';

    // as contagens vêm do mesmo período escolhido nos indicadores
    var porCanal = {};
    var semRotulo = 0;
    ((estado.metricas || {}).origens || []).forEach(function (o) {
      if (o.chave === 'Direto ou app') semRotulo += o.n;
      porCanal[o.chave] = (porCanal[o.chave] || 0) + o.n;
    });
    var medido = Boolean(estado.metricas);

    $('#linksDivulgacao').innerHTML = CANAIS_DIVULGACAO.map(function (c) {
      var url = base + c.rotulo;
      var n = porCanal[c.nome] || 0;
      return '<div class="link-div"' + (n ? '' : ' data-zerado="true"') + '>' +
        '<div><b>' + escapar(c.nome) + '</b>' +
          '<span class="muted small">' + escapar(c.onde) + '</span></div>' +
        '<code>' + escapar(url) + '</code>' +
        (medido ? '<div class="link-conta"><b>' + n + '</b><span>' +
          (n === 1 ? 'pessoa' : 'pessoas') + '</span></div>' : '<div class="link-conta"></div>') +
        '<button class="btn ghost sm" type="button" data-copiar="' + escapar(url) + '">Copiar</button>' +
      '</div>';
    }).join('') +
    (medido && semRotulo
      // sem esta linha os quatro zeros pareceriam "ninguém entrou", quando o
      // que houve foi gente entrando por um link sem marcação
      ? '<p class="muted small" style="margin:14px 0 0">Além desses, <b>' + semRotulo +
        '</b> ' + (semRotulo === 1 ? 'pessoa chegou' : 'pessoas chegaram') +
        ' por um endereço sem rótulo, e por isso entraram como "Direto ou app". ' +
        'Trocar os links já publicados pelos de cima resolve.</p>'
      : '');

    $$('[data-copiar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var texto = b.getAttribute('data-copiar');
        var antes = b.textContent;
        var pronto = function () { b.textContent = 'Copiado'; setTimeout(function () { b.textContent = antes; }, 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(texto).then(pronto, function () { b.textContent = 'Copie à mão'; });
        else b.textContent = 'Copie à mão';
      });
    });
  }

  /* ---------------------------------------------------- indicadores */

  async function verMetricas() {
    var caixa = $('#metricas');
    var dias = Number(($('#metricasPeriodo') || {}).value || 30);
    try {
      estado.metricas = await api('/metricas?dias=' + dias);
    } catch (e) {
      caixa.innerHTML = '<p class="erro-slot">' + escapar(e.message) + '</p>';
      return;
    }
    desenharMetricas();
  }

  function desenharMetricas() {
    var m = estado.metricas;
    var t = m.total;

    // agendamentos por local, somando a série toda
    var porLocal = {};
    m.dias.forEach(function (d) {
      Object.keys(d.porLocal || {}).forEach(function (id) {
        porLocal[id] = (porLocal[id] || 0) + d.porLocal[id];
      });
    });

    $('#metricas').innerHTML =
      '<div class="numeros">' +
        cartao(t.unicos, 'pessoas', 'visitantes distintos') +
        cartao(t.visitas, 'visitas', 'páginas abertas') +
        cartao(t.interessados, 'viram horários', 'chegaram a abrir a agenda') +
        cartao(t.agendamentos, 'agendaram', 'pedidos enviados') +
        cartao(t.conversao + '%', 'conversão', 'de cada 100 pessoas') +
      '</div>' +
      barras(m.dias, m.desde) +
      (Object.keys(porLocal).length
        ? '<div class="por-local">' + Object.keys(porLocal).map(function (id) {
            return '<span><b>' + porLocal[id] + '</b> ' + escapar(m.nomes[id] || id) + '</span>';
          }).join('') + '</div>'
        : '') +
      funil(t) +
      quadros(m);

    desenharLinks();          // os links mostram a contagem do mesmo período
    ligarDica();
  }

  var DIA_CURTO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  /**
   * A dica que aparece ao passar o mouse (ou tocar) numa coluna.
   *
   * Balão próprio em vez do `title` do navegador: o nativo demora quase um
   * segundo para aparecer, não quebra linha de forma confiável e não existe no
   * celular — e é justamente a quebra de linha que permite listar os canais.
   */
  function ligarDica() {
    var caixa = $('#dicaGrafico');
    var grafico = caixa && caixa.parentElement;
    if (!caixa) return;

    var mostrar = function (barra) {
      var d = (estado.metricas.dias || [])[Number(barra.getAttribute('data-i'))];
      if (!d) return;
      var data = new Date(d.dia + 'T12:00:00Z');
      var titulo = DIA_CURTO[data.getUTCDay()] + ', ' + d.dia.slice(8) + '/' + d.dia.slice(5, 7);

      var corpo;
      if (!d.medido) {
        corpo = '<span class="dica-vazio">antes de a contagem começar</span>';
      } else if (!d.visitas) {
        corpo = '<span class="dica-vazio">ninguém entrou</span>';
      } else {
        var canais = Object.keys(d.origens || {})
          .sort(function (a, b) { return d.origens[b] - d.origens[a]; })
          .map(function (c) {
            return '<span><i>' + escapar(c) + '</i>' + d.origens[c] + '</span>';
          }).join('');
        corpo = '<div class="dica-numeros">' +
            '<span><i>pessoas</i>' + d.unicos + '</span>' +
            '<span><i>visitas</i>' + d.visitas + '</span>' +
            '<span><i>viram horários</i>' + d.interessados + '</span>' +
            '<span><i>agendaram</i>' + d.agendamentos + '</span>' +
          '</div>' +
          (canais ? '<div class="dica-canais">' + canais + '</div>' : '');
      }

      caixa.innerHTML = '<b>' + escapar(titulo) + '</b>' + corpo;
      caixa.hidden = false;

      // encosta na borda em vez de vazar para fora do bloco
      var largura = caixa.offsetWidth;
      var meio = barra.offsetLeft + (barra.offsetWidth / 2) - (largura / 2);
      var limite = grafico.clientWidth - largura;
      caixa.style.left = Math.max(0, Math.min(meio, limite)) + 'px';
    };

    var esconder = function () { caixa.hidden = true; };

    $$('#metricas .barra').forEach(function (barra) {
      barra.addEventListener('mouseenter', function () { mostrar(barra); });
      barra.addEventListener('focus', function () { mostrar(barra); });
      barra.addEventListener('click', function () { mostrar(barra); });   // celular
      barra.addEventListener('blur', esconder);
    });
    $('#metricas .barras').addEventListener('mouseleave', esconder);
  }

  /** Do pedido à confirmação, com o tempo que o paciente esperou. */
  function funil(t) {
    if (!t.agendamentos && !t.confirmados) return '';
    return '<div class="funil">' +
      '<h3>Do pedido à confirmação</h3>' +
      '<div class="funil-linha">' +
        etapa(t.agendamentos, 'pediram') +
        etapa(t.confirmados, 'confirmados') +
        etapa(t.remarcados, 'remarcados') +
        etapa(t.parados, 'sem resposta', t.parados ? 'atencao' : '') +
      '</div>' +
      (t.esperaMedia === null || t.esperaMedia === undefined
        ? '<p class="marco">Nenhuma confirmação cronometrada ainda.</p>'
        : '<p class="marco">A recepção leva <b>' + escapar(duracao(t.esperaMedia)) +
          '</b> em média para confirmar. A pior espera do período foi de <b>' +
          escapar(duracao(t.esperaMax)) + '</b>.</p>') +
    '</div>';
  }

  function etapa(n, rotulo, estado) {
    return '<div class="etapa"' + (estado ? ' data-estado="' + estado + '"' : '') + '>' +
      '<b>' + Number(n || 0) + '</b><span>' + escapar(rotulo) + '</span></div>';
  }

  function duracao(minutos) {
    var m = Math.round(Number(minutos) || 0);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    var resto = m % 60;
    if (h < 24) return h + 'h' + (resto ? String(resto).padStart(2, '0') : '');
    return Math.floor(h / 24) + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
  }

  // indexado por número: é assim que a contagem guarda o dia (0 = domingo),
  // e um mapa por sigla fazia a tela mostrar "4" no lugar de "Quinta"
  var DIA_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  /** O que os pacientes escolhem e de onde vieram. */
  function quadros(m) {
    var e = m.escolhas || {};
    var partes = [
      quadro('Dias mais procurados', e.diaSemana, function (c) { return DIA_LONGO[Number(c)] || c; }),
      quadro('Horários mais procurados', e.hora, function (c) { return c + 'h'; }),
      quadro('Tipo de consulta', e.tipo),
      quadro('De onde vieram', m.origens),
    ].filter(Boolean);
    if (!partes.length) return '';
    return '<div class="quadros">' + partes.join('') + '</div>';
  }

  function quadro(titulo, itens, formatar) {
    if (!itens || !itens.length) return '';
    var maior = itens[0].n || 1;
    return '<div class="quadro"><h4>' + escapar(titulo) + '</h4>' +
      itens.slice(0, 6).map(function (i) {
        var rotulo = formatar ? formatar(i.chave) : i.chave;
        return '<div class="fatia">' +
          '<span class="fatia-nome">' + escapar(rotulo) + '</span>' +
          '<span class="fatia-barra"><i style="width:' + Math.round((i.n / maior) * 100) + '%"></i></span>' +
          '<b>' + i.n + '</b>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function cartao(valor, rotulo, ajuda) {
    return '<div class="numero" title="' + escapar(ajuda) + '">' +
      '<b>' + escapar(String(valor)) + '</b>' +
      '<span>' + escapar(rotulo) + '</span>' +
    '</div>';
  }

  /**
   * Barras em CSS puro: uma coluna por dia, altura proporcional às visitas,
   * com a fatia de quem agendou destacada. Sem biblioteca de gráfico — para
   * cinco números por dia não compensa carregar uma.
   */
  function barras(dias, desde) {
    var teto = dias.reduce(function (a, d) { return Math.max(a, d.unicos); }, 0);

    // Sem ninguém no período, um gráfico de barras é uma faixa vazia de 130px
    // que parece defeito. Uma frase explica melhor.
    if (!teto) {
      return '<p class="vazio-metricas">Ainda não há movimento no período. ' +
        'A contagem começou quando esta tela foi instalada — dias anteriores ' +
        'aparecem zerados porque nada foi medido, não porque ninguém entrou.</p>';
    }

    return '<div class="grafico">' +
      '<div class="dica" id="dicaGrafico" hidden></div>' +
      '<div class="barras" role="img" aria-label="visitantes e agendamentos por dia">' +
      dias.map(function (d, i) {
        var dia = d.dia.slice(8) + '/' + d.dia.slice(5, 7);

        // Dia anterior ao início da contagem não é "zero pessoas", é "não
        // sabemos". Desenhar barra zerada aqui faria a tela afirmar que
        // ninguém entrou num período em que ninguém estava medindo.
        if (!d.medido) {
          return '<div class="barra nao-medido" data-i="' + i + '" tabindex="0"></div>';
        }

        var alturaPessoas = Math.round((d.unicos / teto) * 100);
        var alturaAgenda = d.unicos ? Math.round((d.agendamentos / teto) * 100) : 0;
        return '<div class="barra" data-i="' + i + '" tabindex="0">' +
          '<div class="col">' +
            '<div class="parte pessoas" style="height:' + alturaPessoas + '%"></div>' +
            '<div class="parte agenda" style="height:' + alturaAgenda + '%"></div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>' +
      '<div class="legenda"><span class="chave pessoas"></span>pessoas' +
        '<span class="chave agenda"></span>agendaram' +
        (dias.some(function (d) { return !d.medido; })
          ? '<span class="chave sem-medida"></span>sem medição'
          : '') +
        '<span class="periodo-txt">' + escapar(dias[0].dia.slice(8) + '/' + dias[0].dia.slice(5, 7)) +
        ' → ' + escapar(dias[dias.length - 1].dia.slice(8) + '/' + dias[dias.length - 1].dia.slice(5, 7)) +
        '</span></div>' +
      (desde && dias[0].dia < desde
        ? '<p class="marco">A contagem começou em <b>' + escapar(dataCurta(desde)) +
          '</b>. Antes disso o sistema não media — os dias em branco não querem ' +
          'dizer que ninguém entrou.</p>'
        : '') +
    '</div>';
  }

  function dataCurta(iso) {
    return iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  /* ------------------------------------------------------- WhatsApp */

  var TEXTO_SITUACAO = {
    conectado: 'Conectado',
    qr: 'Aguardando leitura do QR',
    iniciando: 'Conectando…',
    desligado: 'Desconectado',
    erro: 'Com problema',
    teste: 'Modo de teste',
  };

  async function verZap(forcar) {
    try {
      estado.zap = await api('/whatsapp' + (forcar ? '' : ''));
    } catch (e) {
      $('#zap').innerHTML = '<p class="erro-slot">' + escapar(e.message) + '</p>';
      return;
    }
    desenharZap();
    agendarRelogio();
    verPendentes();
  }

  /** Enquanto está conectando ou esperando o QR, a tela se atualiza sozinha. */
  function agendarRelogio() {
    clearTimeout(estado.relogioZap);
    var s = (estado.zap || {}).situacao;
    if (s === 'qr' || s === 'iniciando') {
      estado.relogioZap = setTimeout(function () { verZap(); }, 3000);
    }
  }

  function desenharZap() {
    var z = estado.zap;
    var caixa = $('#zap');

    if (z.driver === 'log') {
      caixa.innerHTML =
        '<div class="zap-topo"><span class="zap-selo" data-situacao="teste">Modo de teste</span></div>' +
        '<p class="zap-detalhe">O sistema monta as mensagens mas <strong>não envia nada</strong> — elas só ' +
        'aparecem no log do servidor. Para enviar de verdade, troque <code>WA_DRIVER</code> para ' +
        '<code>wwebjs</code> no arquivo <code>.env</code> e reinicie.</p>';
      return;
    }

    if (z.driver === 'cloud') {
      caixa.innerHTML =
        '<div class="zap-topo"><span class="zap-selo" data-situacao="' + (z.conectado ? 'conectado' : 'erro') + '">' +
          (z.conectado ? 'API oficial conectada' : 'API oficial sem configuração') + '</span></div>' +
        '<p class="zap-detalhe">' + escapar(z.erro || 'Mensagens saem pela Cloud API da Meta. Não usa QR.') + '</p>';
      return;
    }

    caixa.innerHTML =
      '<div class="zap-topo">' +
        '<span class="zap-selo" data-situacao="' + escapar(z.situacao) + '">' +
          escapar(TEXTO_SITUACAO[z.situacao] || z.situacao) + '</span>' +
        (z.destinos && z.destinos.length
          ? '<span class="zap-detalhe">' + z.destinos.map(function (d) {
              return escapar(d.nome) + ': ' + (d.numero
                ? escapar(formatarZap(d.numero))
                : '<b>sem número</b>');
            }).join(' · ') + '</span>'
          : '<span class="zap-detalhe">nenhum local no ar</span>') +
        (z.numero
          ? '<span class="zap-detalhe">enviando pelo ' + escapar(formatarZap(z.numero)) + '</span>'
          : '') +
      '</div>' +
      (z.erro ? '<p class="zap-detalhe">' + escapar(z.erro) + '</p>' : '') +
      (z.qr
        ? '<div class="zap-qr">' +
            '<img src="' + z.qr + '" alt="QR Code para conectar o WhatsApp">' +
            '<ol>' +
              '<li>Abra o <strong>WhatsApp do consultório</strong> no celular</li>' +
              '<li>Toque em <strong>⋮ → Dispositivos conectados</strong></li>' +
              '<li>Toque em <strong>Conectar dispositivo</strong> e aponte para este código</li>' +
              '<li>A tela avisa sozinha quando conectar</li>' +
            '</ol>' +
          '</div>'
        : '') +
      '<div class="zap-acoes">' +
        (z.conectado
          ? '<button class="btn ghost sm" type="button" id="zapTestar">Enviar mensagem de teste</button>' +
            '<button class="btn ghost sm" type="button" id="zapSair">Desconectar</button>'
          : '<button class="btn sm" type="button" id="zapConectar">' +
              (z.situacao === 'qr' ? 'Gerar outro QR' : 'Conectar WhatsApp') + '</button>') +
        '<span class="zap-detalhe" id="zapAviso"></span>' +
      '</div>';

    var conectar = $('#zapConectar');
    if (conectar) {
      conectar.addEventListener('click', async function () {
        conectar.disabled = true; conectar.textContent = 'Preparando…';
        try { estado.zap = await api('/whatsapp/conectar', { method: 'POST' }); desenharZap(); agendarRelogio(); }
        catch (e) { $('#zapAviso').textContent = e.message; conectar.disabled = false; }
      });
    }

    var sair = $('#zapSair');
    if (sair) {
      sair.addEventListener('click', async function () {
        if (!confirm('Desconectar o WhatsApp?\n\nAs mensagens param de ser enviadas até você ' +
          'escanear o QR de novo. Os agendamentos continuam entrando na agenda normalmente.')) return;
        sair.disabled = true; sair.textContent = 'Desconectando…';
        try { estado.zap = await api('/whatsapp/desconectar', { method: 'POST' }); desenharZap(); }
        catch (e) { $('#zapAviso').textContent = e.message; sair.disabled = false; }
      });
    }

    var testar = $('#zapTestar');
    if (testar) {
      testar.addEventListener('click', async function () {
        testar.disabled = true;
        $('#zapAviso').textContent = 'Enviando…';
        try {
          var r = await api('/whatsapp/testar', { method: 'POST' });
          $('#zapAviso').textContent = 'Mensagem enviada para ' + formatarZap(r.numero) + '.';
        } catch (e) {
          $('#zapAviso').textContent = e.message;
        } finally {
          testar.disabled = false;
        }
      });
    }
  }

  /**
   * Pedidos que ficaram sem aviso.
   *
   * Um aviso perdido é silencioso por natureza: o paciente marcou, o horário
   * está reservado, e a recepção não sabe. Por isso ele aparece aqui em vez de
   * só no log.
   */
  async function verPendentes() {
    var caixa = $('#pendentes');
    var lista;
    try {
      lista = (await api('/avisos-pendentes')).pendentes;
    } catch (e) {
      caixa.hidden = true;
      return;
    }
    if (!lista.length) { caixa.hidden = true; caixa.innerHTML = ''; return; }

    caixa.hidden = false;
    caixa.innerHTML = '<div class="pendentes">' +
      '<h3>' + lista.length + (lista.length > 1
        ? ' pedidos não chegaram à recepção'
        : ' pedido não chegou à recepção') + '</h3>' +
      '<p class="small">O horário está reservado na agenda, mas a mensagem no WhatsApp falhou. ' +
      'Confira se o WhatsApp está conectado e reenvie.</p>' +
      '<ul>' + lista.map(function (p) {
        return '<li><strong>' + escapar(p.nome || '(sem nome)') + '</strong> — ' +
          escapar(p.protocolo) + (p.erroDoAviso ? ' · <span class="muted">' + escapar(p.erroDoAviso) + '</span>' : '') +
          '</li>';
      }).join('') + '</ul>' +
      '<div class="acoes">' +
        '<button class="btn sm" type="button" id="reenviarAvisos">Reenviar agora</button>' +
        '<span class="small" id="statusPendentes"></span>' +
      '</div></div>';

    $('#reenviarAvisos').addEventListener('click', async function () {
      var b = $('#reenviarAvisos');
      b.disabled = true; b.textContent = 'Reenviando…';
      try {
        var r = await api('/avisos-pendentes/reenviar', { method: 'POST' });
        $('#statusPendentes').textContent = r.enviados.length + ' enviado(s)' +
          (r.falharam.length ? ', ' + r.falharam.length + ' ainda falhando' : '');
        setTimeout(verPendentes, 1200);
      } catch (e) {
        $('#statusPendentes').textContent = e.message;
        b.disabled = false; b.textContent = 'Reenviar agora';
      }
    });
  }

  /** 5562991234567 -> (62) 99123-4567 */
  function formatarZap(numero) {
    var d = String(numero || '').replace(/\D/g, '').replace(/^55/, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return numero;
  }

  /* ---------------------------------------------------------- abas */

  $$('.aba').forEach(function (aba) {
    aba.addEventListener('click', function () {
      var alvo = aba.getAttribute('data-aba');
      $$('.aba').forEach(function (o) { o.setAttribute('aria-selected', String(o === aba)); });
      $$('[data-painel]').forEach(function (p) { p.hidden = p.getAttribute('data-painel') !== alvo; });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  /* ---------------------------------------------------------- desenhar */

  function resumoDias(dias) {
    if (!dias || !dias.length) return 'nenhum dia';
    return DIAS.filter(function (d) { return dias.indexOf(d.n) >= 0; })
      .map(function (d) { return d.curto; }).join(', ');
  }

  /** "Seg, Ter, Qua 07:30–12:00 · Qui 14:00–17:00" */
  function resumoExpediente(expediente) {
    if (!expediente || !expediente.length) return 'sem horário definido';
    return expediente.map(function (f) {
      return resumoDias(f.dias) + ' ' + f.inicio + '–' + f.fim;
    }).join(' · ');
  }

  function desenhar() {
    var c = estado.config;
    $('#nomeMedico').textContent = c.medico.nome || 'sem nome';
    $('#contaServico').textContent = estado.contaServico || 'credencial do Google não configurada';

    $('#g-nome').value = c.medico.nome || '';
    $('#g-crm').value = c.medico.crm || '';
    $('#g-esp').value = c.medico.especialidade || '';
    $('#g-recnome').value = (c.recepcao || {}).nome || '';
    $('#g-bloq').value = (c.agendasDeBloqueio || []).join('\n');

    var lista = $('#listaLocais');
    var ativos = c.hospitais.filter(function (h) { return h.ativo && h.calendarId; });

    if (!c.hospitais.length) {
      lista.innerHTML = '<div class="vazio-lista">Nenhum local cadastrado ainda.<br>' +
        'Clique em <strong>Adicionar local</strong> para começar.</div>';
      return;
    }

    lista.innerHTML =
      (ativos.length ? '' :
        '<div class="aviso-topo">Nenhum local ativo — o formulário do site não tem onde marcar consulta.</div>') +
      c.hospitais.map(function (h) {
        var problema = !h.calendarId;
        return '<article class="local-card" data-ativo="' + (h.ativo ? 'true' : 'false') + '">' +
          '<div class="local-topo">' +
            '<div style="min-width:0">' +
              '<h3>' + escapar(h.nome) + '</h3>' +
              '<code class="cal">' + escapar(h.calendarId || 'sem agenda ligada') + '</code>' +
            '</div>' +
            '<div class="local-acoes">' +
              '<span class="selo ' + (problema ? 'alerta' : (h.ativo ? '' : 'off')) + '">' +
                (problema ? 'sem agenda' : (h.ativo ? 'no ar' : 'desligado')) + '</span>' +
              '<button class="btn ghost sm" type="button" data-editar="' + h.id + '">Editar</button>' +
              '<button class="btn ghost sm" type="button" data-alternar="' + h.id + '">' +
                (h.ativo ? 'Desligar' : 'Ligar') + '</button>' +
              '<button class="btn ghost sm" type="button" data-excluir="' + h.id + '">Excluir</button>' +
            '</div>' +
          '</div>' +
          '<div class="local-meta">' +
            '<span><b>' + escapar(resumoExpediente(h.expediente)) + '</b></span>' +
            '<span>consulta de <b>' + h.duracaoMin + ' min</b></span>' +
            (h.intervaloMin ? '<span>intervalo de ' + h.intervaloMin + ' min</span>' : '') +
            ((h.vagasPorHorario || 1) > 1 ? '<span><b>' + h.vagasPorHorario + '</b> pacientes por horário</span>' : '') +
            '<span>recepção: <b>' + escapar(h.whatsappRecepcao || 'sem número') + '</b></span>' +
            '<span>antecedência de <b>' + h.antecedenciaMinHoras + 'h</b></span>' +
            (h.endereco ? '<span>' + escapar(h.endereco) + '</span>' : '') +
          '</div>' +
        '</article>';
      }).join('');

    $$('[data-editar]').forEach(function (b) {
      b.addEventListener('click', function () { abrirGaveta(b.getAttribute('data-editar')); });
    });
    $$('[data-alternar]').forEach(function (b) {
      b.addEventListener('click', function () { alternar(b.getAttribute('data-alternar')); });
    });
    $$('[data-excluir]').forEach(function (b) {
      b.addEventListener('click', function () { excluir(b.getAttribute('data-excluir')); });
    });
  }

  async function alternar(id) {
    var h = estado.config.hospitais.find(function (x) { return x.id === id; });
    if (h.ativo && !confirm('Desligar "' + h.nome + '"?\n\nEle some do formulário na hora. ' +
        'As consultas já marcadas continuam na agenda do Google.')) return;
    var r = await api('/hospitais/' + encodeURIComponent(id) + '/ativo', {
      method: 'POST', body: JSON.stringify({ ativo: !h.ativo }),
    });
    estado.config = r.config;
    desenhar();
  }

  async function excluir(id) {
    var h = estado.config.hospitais.find(function (x) { return x.id === id; });
    if (!confirm('Excluir "' + h.nome + '" de vez?\n\nSe a ideia é só parar de atender lá, ' +
      'prefira Desligar — assim dá para religar depois.\n\nAs consultas que já estão na ' +
      'agenda do Google não são apagadas.')) return;
    var r = await api('/hospitais/' + encodeURIComponent(id), { method: 'DELETE' });
    estado.config = r.config;
    desenhar();
  }

  /* ---------------------------------------------------------- gaveta */

  /**
   * Desenha o editor de faixas. Cada faixa é um horário com os seus dias —
   * é o que permite "seg/ter/qua de manhã e quinta à tarde", e também dia
   * partido (duas faixas no mesmo dia).
   */
  function montarFaixas(erros) {
    erros = erros || {};
    var caixa = $('#faixas');

    caixa.innerHTML = estado.faixas.map(function (f, i) {
      var erroDias = erros['expediente.' + i + '.dias'];
      var erroIni = erros['expediente.' + i + '.inicio'];
      var erroFim = erros['expediente.' + i + '.fim'];
      var erro = erroDias || erroIni || erroFim || '';
      return '<div class="faixa" data-i="' + i + '" data-error="' + (erro ? 'true' : 'false') + '">' +
        '<div class="faixa-topo">' +
          '<span class="faixa-num">Faixa ' + (i + 1) + '</span>' +
          (estado.faixas.length > 1
            ? '<button type="button" class="remover-faixa" data-remover="' + i + '" aria-label="Remover faixa">×</button>'
            : '') +
        '</div>' +
        '<div class="dias-semana">' +
          DIAS.map(function (d) {
            return '<button type="button" data-dia="' + d.n + '" aria-label="' + d.longo + '" ' +
              'aria-pressed="' + (f.dias.indexOf(d.n) >= 0) + '">' + d.curto + '</button>';
          }).join('') +
        '</div>' +
        '<div class="faixa-horas">' +
          '<input type="time" step="300" class="f-inicio" value="' + escapar(f.inicio) + '" aria-label="Começa às">' +
          '<span>às</span>' +
          '<input type="time" step="300" class="f-fim" value="' + escapar(f.fim) + '" aria-label="Termina às">' +
        '</div>' +
        '<p class="faixa-erro">' + escapar(erro) + '</p>' +
      '</div>';
    }).join('');

    $$('#faixas .faixa').forEach(function (linha) {
      var i = Number(linha.getAttribute('data-i'));
      $$('.dias-semana button', linha).forEach(function (b) {
        b.addEventListener('click', function () {
          var n = Number(b.getAttribute('data-dia'));
          var pos = estado.faixas[i].dias.indexOf(n);
          if (pos >= 0) estado.faixas[i].dias.splice(pos, 1);
          else estado.faixas[i].dias.push(n);
          estado.faixas[i].dias.sort();
          b.setAttribute('aria-pressed', String(pos < 0));
          atualizarPrevia();
        });
      });
      $('.f-inicio', linha).addEventListener('input', function (e) {
        estado.faixas[i].inicio = e.target.value; atualizarPrevia();
      });
      $('.f-fim', linha).addEventListener('input', function (e) {
        estado.faixas[i].fim = e.target.value; atualizarPrevia();
      });
    });

    $$('[data-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.faixas.splice(Number(b.getAttribute('data-remover')), 1);
        montarFaixas();
        atualizarPrevia();
      });
    });
  }

  $('#novaFaixa').addEventListener('click', function () {
    var ultima = estado.faixas[estado.faixas.length - 1];
    estado.faixas.push({
      dias: [],
      inicio: ultima ? ultima.fim : '08:00',
      fim: ultima ? ultima.fim : '12:00',
    });
    montarFaixas();
    atualizarPrevia();
  });

  function abrirGaveta(id) {
    var h = id ? estado.config.hospitais.find(function (x) { return x.id === id; }) : null;
    estado.editando = id || null;
    estado.faixas = (h && h.expediente && h.expediente.length)
      ? h.expediente.map(function (f) { return { dias: f.dias.slice(), inicio: f.inicio, fim: f.fim }; })
      : [{ dias: [1, 3], inicio: '08:00', fim: '12:00' }];

    $('#tituloLocal').textContent = h ? 'Editar ' + h.nome : 'Adicionar local';
    $('#l-nome').value = h ? h.nome : '';
    $('#l-cal').value = h ? h.calendarId : '';
    $('#l-dur').value = h ? h.duracaoMin : 40;
    $('#l-int').value = h ? (h.intervaloMin || 0) : 0;
    $('#l-vagas').value = h ? (h.vagasPorHorario || 1) : 1;
    $('#l-ant').value = h ? h.antecedenciaMinHoras : 24;
    $('#l-jan').value = h ? (h.janelaDias || 60) : 60;
    $('#l-end').value = h ? (h.endereco || '') : '';
    $('#l-tel').value = h ? (h.telefone || '') : '';
    $('#l-zap').value = h ? (h.whatsappRecepcao || '') : '';
    $('#resultadoZap').textContent = '';
    $('#resultadoZap').removeAttribute('data-estado');

    montarFaixas();
    marcarCampos({});
    mostrarErro($('#erroLocal'), '');
    $('#resultadoTeste').textContent = '';
    atualizarPrevia();

    $('#painelLocal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#l-nome').focus();
  }

  function fecharGaveta() {
    $('#painelLocal').hidden = true;
    document.body.style.overflow = '';
  }

  $$('[data-fechar]').forEach(function (b) { b.addEventListener('click', fecharGaveta); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#painelLocal').hidden) fecharGaveta();
  });
  $('#novoLocal').addEventListener('click', function () { abrirGaveta(null); });
  $('#metricasPeriodo').addEventListener('change', verMetricas);

  $('#zerarMetricas').addEventListener('click', async function () {
    var botao = $('#zerarMetricas');
    // apagar histórico não pode acontecer por um clique distraído
    if (!window.confirm(
      'Apagar toda a contagem de visitas e agendamentos?\n\n'
      + 'Uma cópia fica guardada no servidor, mas o painel recomeça do zero.\n'
      + 'As consultas na agenda do Google não são afetadas.'
    )) return;

    botao.disabled = true; botao.textContent = 'Zerando…';
    try {
      await api('/metricas', { method: 'DELETE' });
      await verMetricas();
      botao.textContent = 'Zerado';
      setTimeout(function () { botao.textContent = 'Zerar'; botao.disabled = false; }, 1800);
    } catch (e) {
      botao.textContent = 'Zerar'; botao.disabled = false;
      window.alert('Não consegui zerar: ' + e.message);
    }
  });

  function lerFormLocal() {
    return {
      nome: $('#l-nome').value,
      calendarId: $('#l-cal').value,
      expediente: estado.faixas.map(function (f) {
        return { dias: f.dias.slice().sort(), inicio: f.inicio, fim: f.fim };
      }),
      duracaoMin: Number($('#l-dur').value),
      intervaloMin: Number($('#l-int').value || 0),
      vagasPorHorario: Number($('#l-vagas').value || 1),
      antecedenciaMinHoras: Number($('#l-ant').value),
      janelaDias: Number($('#l-jan').value || 60),
      endereco: $('#l-end').value,
      telefone: $('#l-tel').value,
      whatsappRecepcao: $('#l-zap').value,
      ativo: estado.editando
        ? estado.config.hospitais.find(function (x) { return x.id === estado.editando; }).ativo
        : true,
    };
  }

  var minutos = function (s) { return Number(String(s).slice(0, 2)) * 60 + Number(String(s).slice(3)); };
  var paraHora = function (m) {
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  };

  /**
   * Mostra, por dia da semana, os horários que a configuração geraria.
   * É o que deixa o médico ver "quinta começa 14h, não 7h30" antes de salvar.
   */
  function atualizarPrevia() {
    var caixa = $('#previa');
    var dur = Number($('#l-dur').value);
    var inter = Number($('#l-int').value || 0);
    var vagas = Number($('#l-vagas').value || 1);

    if (!(dur > 0)) { caixa.setAttribute('data-vazio', 'true'); return; }

    var porDia = {};
    estado.faixas.forEach(function (f) {
      if (!/^\d{2}:\d{2}$/.test(f.inicio) || !/^\d{2}:\d{2}$/.test(f.fim)) return;
      if (minutos(f.fim) <= minutos(f.inicio)) return;
      var horas = [];
      for (var m = minutos(f.inicio); m + dur <= minutos(f.fim); m += dur + inter) horas.push(paraHora(m));
      f.dias.forEach(function (d) { porDia[d] = (porDia[d] || []).concat(horas); });
    });

    var diasComGrade = DIAS.filter(function (d) { return porDia[d.n] && porDia[d.n].length; });
    if (!diasComGrade.length) {
      caixa.setAttribute('data-vazio', 'false');
      caixa.innerHTML = '<span class="titulo vazio">Nenhuma consulta cabe nas faixas definidas.</span>';
      return;
    }

    var total = diasComGrade.reduce(function (n, d) { return n + porDia[d.n].length; }, 0);
    caixa.setAttribute('data-vazio', 'false');
    caixa.innerHTML =
      '<span class="titulo">' + total + ' consultas por semana' +
        (vagas > 1 ? ' × ' + vagas + ' pacientes por horário' : '') + '</span>' +
      diasComGrade.map(function (d) {
        var horas = porDia[d.n].sort();
        return '<div class="linha"><b>' + d.curto + '</b><div class="horas">' +
          horas.map(function (h) { return '<span>' + h + '</span>'; }).join('') +
          '</div></div>';
      }).join('');
  }

  ['#l-dur', '#l-int', '#l-vagas'].forEach(function (sel) {
    $(sel).addEventListener('input', atualizarPrevia);
  });

  $('#testar').addEventListener('click', async function () {
    var alvo = $('#resultadoTeste');
    var id = $('#l-cal').value.trim();
    if (!id) { alvo.setAttribute('data-estado', 'erro'); alvo.textContent = 'Cole o ID da agenda primeiro.'; return; }
    alvo.setAttribute('data-estado', 'testando');
    alvo.textContent = 'Consultando o Google…';
    $('#testar').disabled = true;
    try {
      var r = await api('/testar-agenda', { method: 'POST', body: JSON.stringify({ calendarId: id }) });
      alvo.setAttribute('data-estado', r.ok ? 'ok' : 'erro');
      alvo.textContent = (r.ok ? '✓ ' : '') + r.mensagem;
      if (r.ok && !$('#l-nome').value.trim() && r.nome) $('#l-nome').value = r.nome;
    } catch (e) {
      alvo.setAttribute('data-estado', 'erro');
      alvo.textContent = e.message;
    } finally {
      $('#testar').disabled = false;
    }
  });

  $('#testarZap').addEventListener('click', async function () {
    var alvo = $('#resultadoZap');
    var numero = $('#l-zap').value.trim();
    if (!numero) {
      alvo.setAttribute('data-estado', 'erro');
      alvo.textContent = 'Digite o número primeiro.';
      return;
    }
    alvo.setAttribute('data-estado', 'testando');
    alvo.textContent = 'Consultando o WhatsApp…';
    $('#testarZap').disabled = true;
    try {
      var r = await api('/whatsapp/verificar-numero', {
        method: 'POST', body: JSON.stringify({ numero: numero }),
      });
      // "não confirmado" não é o mesmo que "não existe": o envio segue sendo
      // tentado. Por isso o aviso é amarelo, não vermelho.
      alvo.setAttribute('data-estado', r.ok ? 'ok' : (r.motivo === 'nao_confirmado' ? 'aviso' : 'erro'));
      alvo.textContent = (r.ok ? '✓ ' : '') + r.mensagem;
    } catch (e) {
      alvo.setAttribute('data-estado', 'erro');
      alvo.textContent = e.message;
    } finally {
      $('#testarZap').disabled = false;
    }
  });

  $('#formLocal').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var botao = $('#salvarLocal');
    botao.disabled = true; botao.textContent = 'Salvando…';
    marcarCampos({});
    try {
      var corpo = JSON.stringify(lerFormLocal());
      var r = estado.editando
        ? await api('/hospitais/' + encodeURIComponent(estado.editando), { method: 'PUT', body: corpo })
        : await api('/hospitais', { method: 'POST', body: corpo });
      estado.config = r.config;
      fecharGaveta();
      desenhar();
    } catch (e) {
      marcarCampos(e.erros);
      montarFaixas(e.erros);          // aponta a faixa exata que está errada
      mostrarErro($('#erroLocal'), e.message);
    } finally {
      botao.disabled = false; botao.textContent = 'Salvar local';
    }
  });

  /* ---------------------------------------------------------- gerais */

  $('#formGerais').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    marcarCampos({});
    try {
      var r = await api('/config', {
        method: 'PUT',
        body: JSON.stringify({
          medico: { nome: $('#g-nome').value, crm: $('#g-crm').value, especialidade: $('#g-esp').value },
          recepcao: { nome: $('#g-recnome').value },
          agendasDeBloqueio: estado.config.agendasDeBloqueio || [],
        }),
      });
      estado.config = r.config;
      desenhar();
      verZap();
      mostrarErro($('#erroGerais'), '');
      piscar($('#formGerais'));
    } catch (e) {
      marcarCampos(e.erros);
      mostrarErro($('#erroGerais'), e.message);
    }
  });

  $('#formBloqueios').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var linhas = $('#g-bloq').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var c = estado.config;
    var r = await api('/config', {
      method: 'PUT',
      body: JSON.stringify({ medico: c.medico, recepcao: c.recepcao, agendasDeBloqueio: linhas }),
    });
    estado.config = r.config;
    desenhar();
    piscar($('#formBloqueios'));
  });

  function piscar(el) {
    el.style.transition = 'none';
    el.style.outline = '2px solid var(--ok)';
    setTimeout(function () { el.style.transition = 'outline .6s ease'; el.style.outline = '2px solid transparent'; }, 400);
  }

  $('#copiarConta').addEventListener('click', function () {
    var b = $('#copiarConta');
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText($('#contaServico').textContent.trim()).then(function () {
      b.textContent = 'Copiado';
      setTimeout(function () { b.textContent = 'Copiar'; }, 1800);
    });
  });

  /* ---------------------------------------------------------- início */

  api('/sessao').then(function (r) {
    if (r.autenticado) abrirPainel();
  }).catch(function () {});
})();

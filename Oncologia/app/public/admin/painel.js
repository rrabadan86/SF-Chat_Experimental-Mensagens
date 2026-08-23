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

  var estado = { config: null, contaServico: null, editando: null, diasEscolhidos: [] };

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
  }

  /* ---------------------------------------------------------- desenhar */

  function resumoDias(dias) {
    if (!dias || !dias.length) return 'nenhum dia';
    return DIAS.filter(function (d) { return dias.indexOf(d.n) >= 0; })
      .map(function (d) { return d.curto; }).join(', ');
  }

  function desenhar() {
    var c = estado.config;
    $('#nomeMedico').textContent = c.medico.nome || 'sem nome';
    $('#contaServico').textContent = estado.contaServico || 'credencial do Google não configurada';

    $('#g-nome').value = c.medico.nome || '';
    $('#g-crm').value = c.medico.crm || '';
    $('#g-esp').value = c.medico.especialidade || '';
    $('#g-recnome').value = (c.recepcao || {}).nome || '';
    $('#g-zap').value = (c.recepcao || {}).whatsapp || '';
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
            '<span><b>' + resumoDias(h.dias) + '</b> · ' + h.inicio + ' às ' + h.fim + '</span>' +
            '<span>consulta de <b>' + h.duracaoMin + ' min</b></span>' +
            (h.intervaloMin ? '<span>intervalo de ' + h.intervaloMin + ' min</span>' : '') +
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

  function montarDias() {
    $('#dias').innerHTML = DIAS.map(function (d) {
      return '<button type="button" data-dia="' + d.n + '" aria-pressed="false" ' +
        'aria-label="' + d.longo + '">' + d.curto + '</button>';
    }).join('');
    $$('#dias button').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-dia'));
        var i = estado.diasEscolhidos.indexOf(n);
        if (i >= 0) estado.diasEscolhidos.splice(i, 1); else estado.diasEscolhidos.push(n);
        b.setAttribute('aria-pressed', String(i < 0));
        atualizarPrevia();
      });
    });
  }

  function abrirGaveta(id) {
    var h = id ? estado.config.hospitais.find(function (x) { return x.id === id; }) : null;
    estado.editando = id || null;
    estado.diasEscolhidos = h ? h.dias.slice() : [1, 3];

    $('#tituloLocal').textContent = h ? 'Editar ' + h.nome : 'Adicionar local';
    $('#l-nome').value = h ? h.nome : '';
    $('#l-cal').value = h ? h.calendarId : '';
    $('#l-inicio').value = h ? h.inicio : '08:00';
    $('#l-fim').value = h ? h.fim : '12:00';
    $('#l-dur').value = h ? h.duracaoMin : 40;
    $('#l-int').value = h ? (h.intervaloMin || 0) : 0;
    $('#l-ant').value = h ? h.antecedenciaMinHoras : 24;
    $('#l-jan').value = h ? (h.janelaDias || 60) : 60;
    $('#l-end').value = h ? (h.endereco || '') : '';
    $('#l-tel').value = h ? (h.telefone || '') : '';

    $$('#dias button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(estado.diasEscolhidos.indexOf(Number(b.getAttribute('data-dia'))) >= 0));
    });
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

  function lerFormLocal() {
    return {
      nome: $('#l-nome').value,
      calendarId: $('#l-cal').value,
      dias: estado.diasEscolhidos.slice().sort(),
      inicio: $('#l-inicio').value,
      fim: $('#l-fim').value,
      duracaoMin: Number($('#l-dur').value),
      intervaloMin: Number($('#l-int').value || 0),
      antecedenciaMinHoras: Number($('#l-ant').value),
      janelaDias: Number($('#l-jan').value || 60),
      endereco: $('#l-end').value,
      telefone: $('#l-tel').value,
      ativo: estado.editando
        ? estado.config.hospitais.find(function (x) { return x.id === estado.editando; }).ativo
        : true,
    };
  }

  /** Mostra os horários que a configuração atual geraria, antes de salvar. */
  function atualizarPrevia() {
    var caixa = $('#previa');
    var ini = $('#l-inicio').value, fim = $('#l-fim').value;
    var dur = Number($('#l-dur').value), inter = Number($('#l-int').value || 0);
    var min = function (s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(3)); };

    if (!/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fim) || !(dur > 0) || min(fim) <= min(ini)) {
      caixa.setAttribute('data-vazio', 'true'); return;
    }
    var horas = [];
    for (var m = min(ini); m + dur <= min(fim); m += dur + inter) {
      horas.push(('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2));
    }
    if (!horas.length) {
      caixa.setAttribute('data-vazio', 'false');
      caixa.innerHTML = '<span class="titulo">Nenhuma consulta cabe nesse expediente.</span>';
      return;
    }
    caixa.setAttribute('data-vazio', 'false');
    caixa.innerHTML = '<span class="titulo">' + horas.length + ' consultas por dia' +
      (estado.diasEscolhidos.length ? ' · ' + resumoDias(estado.diasEscolhidos) : '') + '</span>' +
      '<div class="horas">' + horas.map(function (h) { return '<span>' + h + '</span>'; }).join('') + '</div>';
  }

  ['#l-inicio', '#l-fim', '#l-dur', '#l-int'].forEach(function (s) {
    $(s).addEventListener('input', atualizarPrevia);
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
          recepcao: { nome: $('#g-recnome').value, whatsapp: $('#g-zap').value },
          agendasDeBloqueio: estado.config.agendasDeBloqueio || [],
        }),
      });
      estado.config = r.config;
      desenhar();
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

  montarDias();
  api('/sessao').then(function (r) {
    if (r.autenticado) abrirPainel();
  }).catch(function () {});
})();

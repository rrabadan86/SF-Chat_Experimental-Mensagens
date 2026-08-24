/**
 * app.js — o formulário do paciente.
 *
 * Nada de regra de negócio aqui: os horários vêm de /api/horarios (que consulta
 * o Google) e a validação de verdade acontece no servidor. Este arquivo cuida da
 * navegação entre os passos e de não deixar a pessoa perder o que digitou.
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  var estado = { hospitais: [], loc: null, grade: null, dia: null, hora: null, dados: {}, enviando: false };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function diaDaSemana(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
  function dataLonga(iso) {
    var p = iso.split('-');
    return DIAS_CURTOS[diaDaSemana(iso)] + ', ' + Number(p[2]) + ' de ' + MESES_LONGOS[+p[1] - 1] + ' de ' + p[0];
  }
  function dataCurta(iso) {
    var p = iso.split('-');
    return DIAS_CURTOS[diaDaSemana(iso)] + ', ' + p[2] + '/' + p[1];
  }
  function dataBr(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function escapar(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function idade(iso) {
    if (!iso) return null;
    var n = iso.split('-').map(Number), hoje = new Date();
    var a = hoje.getFullYear() - n[0];
    if (hoje.getMonth() + 1 < n[1] || (hoje.getMonth() + 1 === n[1] && hoje.getDate() < n[2])) a--;
    return (a >= 0 && a < 130) ? a : null;
  }

  async function api(caminho, opcoes) {
    var r = await fetch(caminho, opcoes);
    var corpo = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      // resposta sem JSON (erro do próprio servidor web) não pode virar
      // "não consegui falar com o servidor" — isso esconde a causa
      if (!corpo.erro) {
        corpo.erro = r.status === 413
          ? 'O arquivo é grande demais para enviar.'
          : 'O servidor respondeu ' + r.status + '. Veja os logs se persistir.';
      }
      var erro = new Error(corpo.erro || 'Não consegui falar com o servidor.');
      erro.codigo = corpo.codigo;
      erro.erros = corpo.erros;
      throw erro;
    }
    return corpo;
  }

  /* ------------------------------------------------------ passos */

  /**
   * Liga o formulário. Só pode rodar depois que a seção de agendamento entrou
   * na página — os elementos dele vêm de um <template>, então antes disso não
   * existem no DOM.
   */
  function ligarFormulario() {
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        var alvo = +b.getAttribute('data-go');
        if (alvo === 4) {
          if (!validar()) return;
          montarRevisao();
        }
        irPara(alvo);
      });
    });

    var tel = $('#f-tel');
    tel.addEventListener('input', function () {
      var v = tel.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) tel.value = '(' + v.slice(0, 2) + ') ' + v.slice(2, 7) + '-' + v.slice(7);
      else if (v.length > 2) tel.value = '(' + v.slice(0, 2) + ') ' + v.slice(2);
      else if (v.length) tel.value = '(' + v;
    });
    $('#f-nasc').max = new Date().toISOString().slice(0, 10);

    $('#enviar').addEventListener('click', enviar);
    carregarHospitais();
  }

  function irPara(n) {
    $$('.step').forEach(function (s) {
      s.setAttribute('data-active', s.getAttribute('data-step') === String(n) ? 'true' : 'false');
    });
    $$('#rail li').forEach(function (li) {
      var p = +li.getAttribute('data-step');
      li.setAttribute('data-state', n >= 5 ? 'done' : (p === n ? 'active' : (p < n ? 'done' : '')));
    });
    var topo = $('#agendar');
    if (topo) window.scrollTo({ top: topo.offsetTop - 70, behavior: 'smooth' });
  }

  /* ------------------------------------------- passo 1: hospitais */

  /**
   * "Segundas, terças e quartas de manhã · quintas à tarde"
   *
   * O expediente é uma lista de faixas, porque o médico pode atender de manhã
   * num dia e à tarde noutro. Cada faixa vira um pedaço da frase.
   */
  function resumoDias(h) {
    var faixas = h.expediente || [];
    if (!faixas.length) return 'horários a confirmar';

    return faixas.map(function (f) {
      var nomes = f.dias.slice().sort().map(function (d) { return DIAS_SEMANA[d] + 's'; });
      if (!nomes.length) return '';
      var lista = nomes.length > 1
        ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1]
        : nomes[0];
      return lista.charAt(0).toUpperCase() + lista.slice(1) + ' ' + turno(f);
    }).filter(Boolean).join(' · ');
  }

  function turno(faixa) {
    var h = Number(String(faixa.inicio).slice(0, 2));
    var fim = Number(String(faixa.fim).slice(0, 2));
    if (fim <= 12) return 'de manhã';
    if (h >= 18) return 'à noite';
    if (h >= 12) return 'à tarde';
    return 'das ' + faixa.inicio + ' às ' + faixa.fim;   // atravessa o almoço
  }

  /** Faixa horária completa, para o card de "onde atendo". */
  function resumoHorarios(h) {
    return (h.expediente || []).map(function (f) {
      var nomes = f.dias.slice().sort().map(function (d) { return DIAS_SEMANA[d].slice(0, 3); });
      return nomes.join('/') + ' ' + f.inicio + '–' + f.fim;
    }).join(' · ');
  }

  async function carregarHospitais() {
    try {
      var dados = await api('/api/hospitais');
      estado.hospitais = dados.hospitais;
    } catch (e) {
      $('#pickLocal').innerHTML = '<p class="erro-slot">Não consegui carregar os locais agora. Recarregue a página em instantes.</p>';
      return;
    }

    $('#pickLocal').innerHTML = estado.hospitais.map(function (h, i) {
      return '<button type="button" data-loc="' + escapar(h.id) + '" aria-pressed="false">' +
        '<span class="name">' + escapar(h.nome) + '</span>' +
        '<span class="meta">' + escapar(resumoDias(h)) + '</span>' +
        (h.endereco && h.endereco !== 'a definir' ? '<span class="meta">' + escapar(h.endereco) + '</span>' : '') +
        '<span class="cal"><i class="dot' + (i ? ' b' : '') + '"></i> Consulta de ' + h.duracaoMin + ' minutos</span>' +
        '</button>';
    }).join('');

    $$('#pickLocal button').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.loc = b.getAttribute('data-loc');
        estado.dia = null; estado.hora = null; estado.grade = null;
        $$('#pickLocal button').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        $('.step[data-step="1"] [data-go="2"]').disabled = false;
        carregarHorarios();
      });
    });

    $('#cardsLocais').innerHTML = estado.hospitais.map(function (h, i) {
      return '<article class="card local" data-loc="' + escapar(h.id) + '">' +
        '<h3>' + escapar(h.nome) + '</h3>' +
        '<ul>' +
          '<li><b>Endereço</b><span>' + escapar(h.endereco || 'a definir') + '</span></li>' +
          '<li><b>Dias</b><span>' + escapar(resumoHorarios(h)) + '</span></li>' +
          '<li><b>Consulta</b><span>' + h.duracaoMin + ' minutos</span></li>' +
        '</ul></article>';
    }).join('');
  }

  /* --------------------------------------- passo 2: dias e horas */

  async function carregarHorarios() {
    var hospital = estado.hospitais.find(function (h) { return h.id === estado.loc; });
    $('#hintDia').textContent = 'Buscando horários livres em ' + hospital.nome + '…';
    $('#days').innerHTML = '';
    $('#slots').innerHTML = '<p class="carregando">Consultando a agenda do médico…</p>';
    $('.step[data-step="2"] [data-go="3"]').disabled = true;

    try {
      estado.grade = await api('/api/horarios?dias=8&hospital=' + encodeURIComponent(estado.loc));
    } catch (e) {
      $('#slots').innerHTML = '<p class="erro-slot">' + escapar(e.message) + '</p>';
      $('#hintDia').textContent = '';
      return;
    }

    $('#hintDia').textContent = hospital.nome + ' — ' + resumoDias(hospital) +
      '. Consultas de ' + hospital.duracaoMin + ' minutos.';

    var comVaga = estado.grade.dias.filter(function (d) { return d.livres > 0; });
    if (!comVaga.length) {
      $('#slots').innerHTML = '<p class="erro-slot">Não há horários livres nos próximos dias neste hospital. ' +
        'Tente o outro local ou fale com a recepção.</p>';
      return;
    }

    $('#days').innerHTML = estado.grade.dias.map(function (d) {
      var p = d.data.split('-');
      return '<button type="button" class="day" data-data="' + d.data + '" aria-pressed="false"' +
        (d.livres ? '' : ' disabled') + '>' +
        '<span class="dw">' + DIAS_CURTOS[diaDaSemana(d.data)] + '</span>' +
        '<span class="dd">' + p[2] + '</span>' +
        '<span class="dm">' + MESES[+p[1] - 1] + '</span>' +
        '<span class="free' + (d.livres ? '' : ' none') + '">' +
          (d.livres ? d.livres + (d.livres > 1 ? ' livres' : ' livre') : 'lotado') + '</span>' +
        '</button>';
    }).join('');

    $$('#days .day').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.dia = b.getAttribute('data-data');
        estado.hora = null;
        $$('#days .day').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        montarHorarios();
      });
    });

    $('#slots').innerHTML = '<p class="vazio">Escolha um dia acima para ver os horários.</p>';
    var primeiro = $('#days .day:not([disabled])');
    if (primeiro) primeiro.click();
  }

  function montarHorarios() {
    var dia = estado.grade.dias.find(function (d) { return d.data === estado.dia; });
    $('#slots').innerHTML = dia.slots.map(function (s) {
      return '<button type="button" class="slot" data-hora="' + s.inicio + '" aria-pressed="false"' +
        (s.livre ? '' : ' disabled title="Já ocupado na agenda do médico"') + '>' + s.inicio + '</button>';
    }).join('');
    $$('#slots .slot').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.hora = b.getAttribute('data-hora');
        $$('#slots .slot').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        $('.step[data-step="2"] [data-go="3"]').disabled = false;
      });
    });
    $('.step[data-step="2"] [data-go="3"]').disabled = true;
  }

  /* ---------------------------------------- passo 3: dados */

  var OBRIGATORIOS = ['nome', 'nascimento', 'telefone', 'tipo', 'pagamento'];

  function marcarErro(campo, tem) {
    var caixa = $('.field[data-name="' + campo + '"], .consent[data-name="' + campo + '"]');
    if (caixa) caixa.setAttribute('data-error', String(tem));
  }

  function validar() {
    var form = $('#form'), faltou = [];

    OBRIGATORIOS.forEach(function (nome) {
      var v = form.elements[nome].value.trim();
      var ruim = !v;
      if (nome === 'telefone' && v.replace(/\D/g, '').length < 10) ruim = true;
      if (nome === 'nome' && v && !v.includes(' ')) ruim = true;
      if (nome === 'nascimento' && v && idade(v) === null) ruim = true;
      marcarErro(nome, ruim);
      if (ruim) faltou.push(nome);
    });

    var consent = form.elements.consentimento.checked;
    marcarErro('consentimento', !consent);
    if (!consent) faltou.push('consentimento');

    var caixa = $('#formerr');
    if (faltou.length) {
      caixa.textContent = faltou.length === 1 && faltou[0] === 'consentimento'
        ? 'Para agendar, é preciso autorizar o uso dos dados.'
        : 'Confira os campos destacados.';
      caixa.setAttribute('data-show', 'true');
      var primeiro = $('.field[data-error="true"] input, .field[data-error="true"] select');
      if (primeiro) primeiro.focus();
      return false;
    }

    caixa.setAttribute('data-show', 'false');
    estado.dados = {};
    ['nome', 'nascimento', 'telefone', 'tipo', 'pagamento', 'carteirinha', 'motivo', 'encaminhamento']
      .forEach(function (k) { estado.dados[k] = form.elements[k].value.trim(); });
    estado.dados.consentimento = true;
    return true;
  }

  /* ---------------------------------------- passo 4: revisão */

  function linha(rot, val) {
    if (!val) return '';
    return '<div><dt>' + rot + '</dt><dd>' + escapar(val) + '</dd></div>';
  }

  function montarRevisao() {
    var h = estado.hospitais.find(function (x) { return x.id === estado.loc; });
    var d = estado.dados;
    var anos = idade(d.nascimento);
    $('#review').innerHTML =
      linha('Local', h.nome) +
      linha('Data e hora', dataLonga(estado.dia) + ' às ' + estado.hora) +
      linha('Paciente', d.nome) +
      linha('Nascimento', dataBr(d.nascimento) + (anos === null ? '' : ' (' + anos + ' anos)')) +
      linha('WhatsApp', d.telefone) +
      linha('Tipo', d.tipo) +
      linha('Pagamento', d.pagamento + (d.carteirinha ? ' · carteirinha ' + d.carteirinha : '')) +
      linha('Encaminhado por', d.encaminhamento) +
      linha('Motivo', d.motivo);
    $('#enviarerr').setAttribute('data-show', 'false');
  }

  /* ---------------------------------------- envio */

  async function enviar() {
    if (estado.enviando) return;
    var botao = $('#enviar'), erro = $('#enviarerr');
    estado.enviando = true;
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    erro.setAttribute('data-show', 'false');

    var corpo = Object.assign({}, estado.dados, {
      hospital: estado.loc, data: estado.dia, hora: estado.hora,
    });

    try {
      var r = await api('/api/agendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      $('#protocolo').textContent = 'Protocolo ' + r.protocolo;
      $('#doneMsg').textContent =
        'Guardamos ' + dataCurta(r.data) + ' às ' + r.hora + ' no ' + r.hospital.nome +
        '. A recepção vai confirmar pelo WhatsApp ' + estado.dados.telefone + ', em geral no mesmo dia útil.';
      irPara(5);
    } catch (e) {
      if (e.codigo === 'horario_ocupado') {
        erro.textContent = e.message;
        erro.setAttribute('data-show', 'true');
        await carregarHorarios();          // volta com a grade fresca
        irPara(2);
      } else {
        erro.textContent = e.message;
        erro.setAttribute('data-show', 'true');
      }
    } finally {
      estado.enviando = false;
      botao.disabled = false;
      botao.textContent = 'Enviar pedido';
    }
  }

  /* ------------------------------------------------- montagem da página */

  /**
   * A página é montada a partir da configuração: textos, foto, ordem das
   * seções. O formulário só é ligado depois que a seção de agendamento está no
   * DOM — antes disso os elementos dele nem existem.
   */
  function montarPagina(pagina, medico) {
    var iniciais = (medico.nome || '')
      .replace(/^(Dr|Dra|Prof)\.?\s+/i, '')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (p) { return p[0]; }).join('').toUpperCase();

    document.title = (medico.nome ? medico.nome + ' — ' : '') + (medico.especialidade || 'Agendamento de consulta');
    $('#sigla').textContent = iniciais || '+';
    $('#nomeTopo').textContent = medico.nome || '';
    $('#espTopo').textContent = medico.especialidade || '';

    var h = pagina.hero;
    $('#heroEyebrow').textContent = h.eyebrow || '';
    $('#heroTitulo').textContent = h.titulo || '';
    $('#heroLede').textContent = h.lede || '';
    $('#heroBotoes').innerHTML =
      '<a class="btn" href="#agendar">' + escapar(h.botaoPrimario || 'Agendar consulta') + '</a>' +
      (h.botaoSecundario && !escondida(pagina, 'sobre')
        ? '<a class="btn ghost" href="#sobre">' + escapar(h.botaoSecundario) + '</a>' : '');
    $('#heroCredenciais').innerHTML = (h.credenciais || [])
      .map(function (c) { return '<span>' + escapar(c) + '</span>'; }).join('');
    $('#heroDestaques').innerHTML = (h.destaques || [])
      .map(function (d) { return '<div><b>' + escapar(d.valor) + '</b><span>' + escapar(d.rotulo) + '</span></div>'; })
      .join('');
    $('#heroDestaques').hidden = !(h.destaques || []).length;

    if (h.foto) {
      $('#heroFoto').innerHTML = '<img src="' + escapar(h.foto) + '" alt="' + escapar(medico.nome || 'Foto do médico') + '">';
      $('#heroFoto').classList.add('com-foto');
    } else {
      $('#heroFoto').hidden = true;
    }

    $('#navTopo').innerHTML =
      pagina.ordem.filter(function (id) { return !escondida(pagina, id) && id !== 'agendar'; })
        .map(function (id) { return '<a href="#' + id + '">' + escapar(NOME_SECAO[id]) + '</a>'; }).join('') +
      '<a class="btn sm" href="#agendar">' + escapar(h.botaoPrimario || 'Agendar consulta') + '</a>';

    var alvo = $('#secoes');
    alvo.innerHTML = '';
    pagina.ordem.forEach(function (id) {
      if (escondida(pagina, id)) return;
      var molde = document.getElementById('tpl-' + id);
      if (!molde) return;
      var pedaco = molde.content.cloneNode(true);
      preencher(pedaco, pagina[id], id);
      alvo.appendChild(pedaco);
    });

    $('#rodape').innerHTML =
      '<div><strong>' + escapar(medico.nome || '') + '</strong>' +
      (medico.especialidade ? ' · ' + escapar(medico.especialidade) : '') +
      (medico.crm ? ' · ' + escapar(medico.crm) : '') + '</div>' +
      (pagina.rodape || []).map(function (l) { return '<div>' + escapar(l) + '</div>'; }).join('');
  }

  var NOME_SECAO = { sobre: 'Sobre', locais: 'Onde atendo', agendar: 'Agendamento', duvidas: 'Dúvidas' };

  function escondida(pagina, id) {
    return (pagina.ocultas || []).indexOf(id) >= 0;
  }

  /** Preenche os [data-campo] do molde com o conteúdo daquela seção. */
  function preencher(pedaco, dados, secao) {
    dados = dados || {};
    Array.prototype.forEach.call(pedaco.querySelectorAll('[data-campo]'), function (el) {
      var campo = el.getAttribute('data-campo');
      var valor = dados[campo];

      if (campo === 'paragrafos') {
        el.innerHTML = (valor || []).map(function (t) { return '<p>' + escapar(t) + '</p>'; }).join('');
      } else if (campo === 'areas') {
        el.innerHTML = (valor || []).map(function (a) {
          return '<span class="chip' + (a.destaque ? ' solid' : '') + '">' + escapar(a.nome) + '</span>';
        }).join('');
      } else if (campo === 'formacao') {
        el.innerHTML = (valor || []).map(function (f) {
          return '<div><dt>' + escapar(f.ano) + '</dt><dd>' + escapar(f.titulo) +
            (f.detalhe ? '<span>' + escapar(f.detalhe) + '</span>' : '') + '</dd></div>';
        }).join('');
      } else if (campo === 'itens' && secao === 'duvidas') {
        el.innerHTML = (valor || []).map(function (d, i) {
          return '<details' + (i === 0 ? ' open' : '') + '><summary>' + escapar(d.pergunta) +
            '</summary><p>' + escapar(d.resposta) + '</p></details>';
        }).join('');
      } else if (campo === 'preparo') {
        el.innerHTML = (valor || []).map(function (t) { return '<li>' + escapar(t) + '</li>'; }).join('');
      } else {
        el.textContent = valor || '';
      }

      if (!valor || (Array.isArray(valor) && !valor.length)) esconderVazio(el, campo);
    });

    // blocos inteiros somem quando ficam sem conteúdo
    Array.prototype.forEach.call(pedaco.querySelectorAll('[data-bloco]'), function (bloco) {
      var lista = dados[bloco.getAttribute('data-bloco')];
      if (Array.isArray(lista) && !lista.length) bloco.hidden = true;
    });
  }

  function esconderVazio(el, campo) {
    if (['eyebrow', 'descricao', 'avisoUrgencia'].indexOf(campo) >= 0) el.hidden = true;
  }

  /* ------------------------------------------------- início */

  (async function iniciar() {
    var pagina;
    try {
      var r = await api('/api/pagina');
      pagina = r.pagina;
      montarPagina(r.pagina, r.medico || {});
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin',
        '<div class="wrap" style="padding:40px 22px"><p class="erro-slot">' +
        'Não consegui carregar a página agora. Recarregue em instantes.</p></div>');
      return;
    }
    if (!escondida(pagina, 'agendar')) ligarFormulario();
  })();
})();

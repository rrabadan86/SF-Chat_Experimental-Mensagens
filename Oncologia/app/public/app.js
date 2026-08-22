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
      var erro = new Error(corpo.erro || 'Não consegui falar com o servidor.');
      erro.codigo = corpo.codigo;
      erro.erros = corpo.erros;
      throw erro;
    }
    return corpo;
  }

  /* ------------------------------------------------------ passos */

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

  /* ------------------------------------------- passo 1: hospitais */

  function resumoDias(h) {
    var nomes = h.dias.map(function (d) { return DIAS_SEMANA[d] + 's'; });
    var lista = nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] : nomes[0];
    var turno = Number(h.inicio.slice(0, 2)) < 12 ? 'manhã' : 'tarde';
    return lista.charAt(0).toUpperCase() + lista.slice(1) + ' · ' + turno;
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
          '<li><b>Dias</b><span>' + escapar(resumoDias(h)) + ', ' + h.inicio + ' às ' + h.fim + '</span></li>' +
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
        '<span class="free' + (d.livres ? '' : ' none') + '">' + (d.livres ? d.livres + ' livres' : 'lotado') + '</span>' +
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

  var tel = $('#f-tel');
  tel.addEventListener('input', function () {
    var v = tel.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 6) tel.value = '(' + v.slice(0, 2) + ') ' + v.slice(2, 7) + '-' + v.slice(7);
    else if (v.length > 2) tel.value = '(' + v.slice(0, 2) + ') ' + v.slice(2);
    else if (v.length) tel.value = '(' + v;
  });

  var nasc = $('#f-nasc');
  nasc.max = new Date().toISOString().slice(0, 10);

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

  $('#enviar').addEventListener('click', async function () {
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
  });

  carregarHospitais();
})();

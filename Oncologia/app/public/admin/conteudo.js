/**
 * conteudo.js — o editor do site: textos, foto, listas e ordem das seções.
 *
 * Fica separado do painel.js porque são dois assuntos diferentes: lá é a
 * agenda (locais, horários, recepção), aqui é o que o paciente lê.
 *
 * Os campos escrevem direto em `estado.pagina` conforme o médico digita, e o
 * botão "Salvar conteúdo" manda o objeto inteiro. Um salvar só, no fim, em vez
 * de um por bloco: com tantos campos, salvar em pedaços deixaria a tela
 * mostrando um estado que não é o que está gravado.
 */
window.EditorConteudo = (function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var estado = { pagina: null, secoes: [], sujo: false, api: null };

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function marcarSujo() {
    estado.sujo = true;
    $('#statusConteudo').textContent = 'alterações não salvas';
  }

  /* ------------------------------------------------ ordem das seções */

  function desenharOrdem() {
    var p = estado.pagina;
    var nomes = {};
    estado.secoes.forEach(function (s) { nomes[s.id] = s.nome; });

    $('#ordemSecoes').innerHTML = p.ordem.map(function (id, i) {
      var oculta = p.ocultas.indexOf(id) >= 0;
      var travada = id === 'agendar';
      return '<div class="ordem-item" data-oculta="' + oculta + '">' +
        '<span class="pos">' + (i + 1) + '</span>' +
        '<b>' + escapar(nomes[id] || id) + '</b>' +
        '<span class="setas">' +
          '<button type="button" data-sobe="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir">↑</button>' +
          '<button type="button" data-desce="' + i + '"' + (i === p.ordem.length - 1 ? ' disabled' : '') + ' aria-label="Descer">↓</button>' +
        '</span>' +
        (travada
          ? '<span class="fixa">sempre visível</span>'
          : '<button type="button" class="interruptor" data-ocultar="' + id + '" aria-pressed="' + !oculta + '">' +
              (oculta ? 'Oculta' : 'Visível') + '</button>') +
      '</div>';
    }).join('');

    $$('[data-sobe]').forEach(function (b) {
      b.addEventListener('click', function () { mover(Number(b.getAttribute('data-sobe')), -1); });
    });
    $$('[data-desce]').forEach(function (b) {
      b.addEventListener('click', function () { mover(Number(b.getAttribute('data-desce')), 1); });
    });
    $$('[data-ocultar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ocultar');
        var i = estado.pagina.ocultas.indexOf(id);
        if (i >= 0) estado.pagina.ocultas.splice(i, 1); else estado.pagina.ocultas.push(id);
        marcarSujo();
        desenharOrdem();
      });
    });
  }

  function mover(i, passo) {
    var ordem = estado.pagina.ordem;
    var destino = i + passo;
    if (destino < 0 || destino >= ordem.length) return;
    var t = ordem[i]; ordem[i] = ordem[destino]; ordem[destino] = t;
    marcarSujo();
    desenharOrdem();
  }

  /* ------------------------------------------------ campos genéricos */

  /** input ou textarea ligado direto a um caminho do objeto da página. */
  function campo(rotulo, caminho, opcoes) {
    opcoes = opcoes || {};
    var id = 'c-' + caminho.replace(/\./g, '-');
    var valor = pegar(caminho);
    return '<div class="field' + (opcoes.largo ? ' full' : '') + '">' +
      '<label for="' + id + '">' + escapar(rotulo) + '</label>' +
      (opcoes.linhas
        ? '<textarea id="' + id + '" rows="' + opcoes.linhas + '" data-caminho="' + caminho + '">' + escapar(valor) + '</textarea>'
        : '<input id="' + id + '" data-caminho="' + caminho + '" value="' + escapar(valor) + '">') +
      (opcoes.ajuda ? '<span class="help">' + escapar(opcoes.ajuda) + '</span>' : '') +
      '</div>';
  }

  function pegar(caminho) {
    return caminho.split('.').reduce(function (o, k) { return (o || {})[k]; }, estado.pagina);
  }

  function definir(caminho, valor) {
    var partes = caminho.split('.');
    var alvo = partes.slice(0, -1).reduce(function (o, k) { return o[k]; }, estado.pagina);
    alvo[partes[partes.length - 1]] = valor;
  }

  /**
   * Lista editável — parágrafos, credenciais, áreas, formação, dúvidas…
   * Todas têm as mesmas necessidades: adicionar, remover e trocar de ordem.
   */
  function lista(caminho, config) {
    var itens = pegar(caminho) || [];
    return '<div class="linhas" data-lista="' + caminho + '">' +
      (itens.length ? itens.map(function (item, i) {
        return '<div class="linha-item" data-i="' + i + '">' +
          '<div class="linha-campos ' + (config.formato || '') + '">' +
            config.campos.map(function (c) {
              var v = c.chave ? (item[c.chave] == null ? '' : item[c.chave]) : item;
              if (c.tipo === 'texto') {
                return '<textarea rows="' + (c.linhas || 3) + '" data-chave="' + (c.chave || '') +
                  '" placeholder="' + escapar(c.dica || '') + '">' + escapar(v) + '</textarea>';
              }
              if (c.tipo === 'marca') {
                return '<label class="marca-destaque"><input type="checkbox" data-chave="' + c.chave + '"' +
                  (v ? ' checked' : '') + '> ' + escapar(c.rotulo) + '</label>';
              }
              return '<input data-chave="' + (c.chave || '') + '" value="' + escapar(v) +
                '" placeholder="' + escapar(c.dica || '') + '">';
            }).join('') +
          '</div>' +
          '<div class="linha-acoes">' +
            '<button type="button" data-mover="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir">↑</button>' +
            '<button type="button" data-mover="1"' + (i === itens.length - 1 ? ' disabled' : '') + ' aria-label="Descer">↓</button>' +
            '<button type="button" class="apagar" data-apagar aria-label="Remover">×</button>' +
          '</div>' +
        '</div>';
      }).join('') : '<p class="muted small">Nenhum item ainda.</p>') +
      '</div>' +
      '<button class="btn ghost sm" type="button" data-adicionar="' + caminho + '" style="margin-top:10px">' +
        escapar(config.adicionar || 'Adicionar') + '</button>';
  }

  function ligarListas() {
    $$('[data-lista]').forEach(function (caixa) {
      var caminho = caixa.getAttribute('data-lista');
      $$('.linha-item', caixa).forEach(function (linha) {
        var i = Number(linha.getAttribute('data-i'));
        $$('[data-chave]', linha).forEach(function (el) {
          var chave = el.getAttribute('data-chave');
          var evento = el.type === 'checkbox' ? 'change' : 'input';
          el.addEventListener(evento, function () {
            var itens = pegar(caminho);
            var valor = el.type === 'checkbox' ? el.checked : el.value;
            if (chave) itens[i][chave] = valor; else itens[i] = valor;
            marcarSujo();
          });
        });
        $$('[data-mover]', linha).forEach(function (b) {
          b.addEventListener('click', function () {
            var itens = pegar(caminho);
            var destino = i + Number(b.getAttribute('data-mover'));
            if (destino < 0 || destino >= itens.length) return;
            var t = itens[i]; itens[i] = itens[destino]; itens[destino] = t;
            marcarSujo(); desenharEditor();
          });
        });
        $('[data-apagar]', linha).addEventListener('click', function () {
          pegar(caminho).splice(i, 1);
          marcarSujo(); desenharEditor();
        });
      });
    });

    $$('[data-adicionar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var caminho = b.getAttribute('data-adicionar');
        pegar(caminho).push(MOLDES[caminho]());
        marcarSujo(); desenharEditor();
      });
    });

    $$('[data-caminho]').forEach(function (el) {
      el.addEventListener('input', function () {
        definir(el.getAttribute('data-caminho'), el.value);
        marcarSujo();
      });
    });
  }

  var MOLDES = {
    'hero.credenciais': function () { return ''; },
    'hero.destaques': function () { return { valor: '', rotulo: '' }; },
    'sobre.paragrafos': function () { return ''; },
    'sobre.areas': function () { return { nome: '', destaque: false }; },
    'sobre.formacao': function () { return { ano: '', titulo: '', detalhe: '' }; },
    'agendar.preparo': function () { return ''; },
    'duvidas.itens': function () { return { pergunta: '', resposta: '' }; },
    rodape: function () { return ''; },
  };

  /* ------------------------------------------------ o editor inteiro */

  function desenharEditor() {
    var p = estado.pagina;

    $('#editorConteudo').innerHTML =
      bloco('Início da página', 'O que o paciente lê antes de qualquer coisa.',
        '<div class="fields">' +
          campo('Linha de cima', 'hero.eyebrow', { ajuda: 'Ex.: Oncologia clínica · Goiânia' }) +
          campo('Botão principal', 'hero.botaoPrimario') +
          campo('Título', 'hero.titulo', { largo: true }) +
          campo('Texto de apresentação', 'hero.lede', { largo: true, linhas: 4 }) +
          campo('Botão secundário', 'hero.botaoSecundario', { ajuda: 'Deixe em branco para não mostrar' }) +
        '</div>' +
        sub('Foto', fotoEditor()) +
        sub('Credenciais', lista('hero.credenciais', {
          campos: [{ tipo: 'linha', dica: 'CRM-GO 00.000' }], adicionar: 'Adicionar credencial',
        })) +
        sub('Números em destaque', lista('hero.destaques', {
          formato: 'duplo',
          campos: [{ chave: 'valor', dica: '2' }, { chave: 'rotulo', dica: 'hospitais de atendimento' }],
          adicionar: 'Adicionar destaque',
        }))
      ) +

      bloco('Sobre o médico', 'A apresentação, as áreas de atuação e a formação.',
        '<div class="fields">' +
          campo('Linha de cima', 'sobre.eyebrow') +
          campo('Título', 'sobre.titulo') +
        '</div>' +
        sub('Parágrafos', lista('sobre.paragrafos', {
          campos: [{ tipo: 'texto', linhas: 4, dica: 'Escreva um parágrafo' }],
          adicionar: 'Adicionar parágrafo',
        })) +
        '<div class="fields" style="margin-top:22px">' + campo('Título das áreas', 'sobre.tituloAreas') + '</div>' +
        sub('Áreas de atuação', lista('sobre.areas', {
          formato: 'nome-marca',
          campos: [{ chave: 'nome', dica: 'Mama' }, { chave: 'destaque', tipo: 'marca', rotulo: 'destacar' }],
          adicionar: 'Adicionar área',
        })) +
        '<div class="fields" style="margin-top:22px">' + campo('Título da formação', 'sobre.tituloFormacao') + '</div>' +
        sub('Formação', lista('sobre.formacao', {
          formato: 'trio',
          campos: [
            { chave: 'ano', dica: '2014' },
            { chave: 'titulo', dica: 'Residência em Oncologia Clínica' },
            { chave: 'detalhe', dica: 'Hospital' },
          ],
          adicionar: 'Adicionar formação',
        }))
      ) +

      bloco('Onde atendo', 'O texto acima dos cartões. Os locais em si vêm da aba Agenda.',
        '<div class="fields">' +
          campo('Linha de cima', 'locais.eyebrow') +
          campo('Título', 'locais.titulo') +
          campo('Descrição', 'locais.descricao', { largo: true, linhas: 3 }) +
        '</div>'
      ) +

      bloco('Agendamento', 'O texto em volta do formulário.',
        '<div class="fields">' +
          campo('Linha de cima', 'agendar.eyebrow') +
          campo('Título', 'agendar.titulo') +
          campo('Descrição', 'agendar.descricao', { largo: true, linhas: 3 }) +
          campo('Aviso de urgência', 'agendar.avisoUrgencia', { largo: true, linhas: 2,
            ajuda: 'Aparece na lateral do formulário. Não deixe em branco.' }) +
        '</div>' +
        sub('O que o paciente deve levar', lista('agendar.preparo', {
          campos: [{ tipo: 'linha', dica: 'Documento com foto' }], adicionar: 'Adicionar item',
        }))
      ) +

      bloco('Dúvidas frequentes', 'Perguntas que aparecem no fim da página.',
        '<div class="fields">' +
          campo('Linha de cima', 'duvidas.eyebrow') +
          campo('Título', 'duvidas.titulo') +
        '</div>' +
        sub('Perguntas', lista('duvidas.itens', {
          campos: [
            { chave: 'pergunta', dica: 'Meu horário já está garantido?' },
            { chave: 'resposta', tipo: 'texto', linhas: 3, dica: 'A resposta' },
          ],
          adicionar: 'Adicionar pergunta',
        }))
      ) +

      bloco('Rodapé', 'Avisos legais e observações no pé da página. Nome e CRM entram sozinhos.',
        lista('rodape', {
          campos: [{ tipo: 'texto', linhas: 2, dica: 'Uma linha do rodapé' }],
          adicionar: 'Adicionar linha',
        })
      );

    ligarListas();
    ligarFoto();
    void p;
  }

  function bloco(titulo, descricao, conteudo) {
    return '<section class="bloco-conteudo">' +
      '<div class="eyebrow">' + escapar(titulo) + '</div>' +
      '<h2>' + escapar(titulo) + '</h2>' +
      '<p class="muted small">' + escapar(descricao) + '</p>' +
      conteudo + '</section>';
  }

  function sub(titulo, conteudo) {
    return '<div style="margin-top:22px">' +
      '<div class="eyebrow" style="margin-bottom:10px">' + escapar(titulo) + '</div>' +
      conteudo + '</div>';
  }

  /* ------------------------------------------------ foto */

  function fotoEditor() {
    var url = estado.pagina.hero.foto;
    return '<div class="foto-editor">' +
      '<div class="foto-previa" id="fotoPrevia">' +
        (url ? '<img src="' + escapar(url) + '" alt="" id="imgPrevia">' : 'Sem foto') +
      '</div>' +
      '<div class="foto-acoes">' +
        '<div class="foto-botoes">' +
          '<button class="btn sm" type="button" id="escolherFoto">Enviar do computador</button>' +
          (url ? '<button class="btn ghost sm" type="button" id="tirarFoto">Remover</button>' : '') +
        '</div>' +
        '<input type="file" id="arquivoFoto" accept="image/jpeg,image/png,image/webp" hidden>' +
        '<div class="field">' +
          '<label for="c-hero-foto">…ou cole o endereço de uma imagem</label>' +
          '<input id="c-hero-foto" data-caminho="hero.foto" value="' + escapar(url) +
            '" placeholder="https://…">' +
        '</div>' +
        '<span class="help" id="statusFoto">Retrato em pé fica melhor. A imagem é reduzida antes de subir.</span>' +
      '</div>' +
    '</div>';
  }

  /**
   * Sites como Instagram e Facebook bloqueiam o uso da imagem fora deles, e os
   * endereços expiram em algumas horas. Colar um link desses parece funcionar
   * na hora de salvar e depois vira quadradinho quebrado na página do paciente,
   * então avisamos aqui, antes.
   */
  var HOSPEDEIROS_QUE_BLOQUEIAM = /(fbcdn\.net|cdninstagram\.com|instagram\.com|fbsbx\.com|lookaside\.)/i;

  function conferirEndereco() {
    var campo = $('#c-hero-foto');
    var status = $('#statusFoto');
    if (!campo || !status) return;
    var url = campo.value.trim();

    if (!url || url.indexOf('/midia/') === 0) return;

    if (HOSPEDEIROS_QUE_BLOQUEIAM.test(url)) {
      status.textContent = 'Endereços do Instagram e do Facebook não funcionam aqui: eles bloqueiam '
        + 'o uso da imagem fora do site e o link expira em algumas horas. Baixe a foto e use '
        + '"Enviar do computador".';
      return;
    }

    status.textContent = 'Verificando o endereço…';
    var teste = new Image();
    teste.onload = function () { status.textContent = 'Imagem encontrada.'; };
    teste.onerror = function () {
      status.textContent = 'Não consegui carregar a imagem desse endereço. Talvez o site bloqueie '
        + 'o uso fora dele — nesse caso, baixe a foto e use "Enviar do computador".';
    };
    teste.src = url;
  }

  function ligarFoto() {
    var escolher = $('#escolherFoto');
    if (!escolher) return;

    var campoUrl = $('#c-hero-foto');
    if (campoUrl) {
      var espera;
      campoUrl.addEventListener('input', function () {
        clearTimeout(espera);
        espera = setTimeout(conferirEndereco, 700);
      });
      campoUrl.addEventListener('blur', conferirEndereco);
    }
    escolher.addEventListener('click', function () { $('#arquivoFoto').click(); });

    var tirar = $('#tirarFoto');
    if (tirar) {
      tirar.addEventListener('click', function () {
        estado.pagina.hero.foto = '';
        marcarSujo(); desenharEditor();
      });
    }

    $('#arquivoFoto').addEventListener('change', async function (ev) {
      var arquivo = ev.target.files && ev.target.files[0];
      if (!arquivo) return;
      var status = $('#statusFoto');

      if (arquivo.size > 25 * 1024 * 1024) {
        status.textContent = 'Essa imagem tem mais de 25 MB. Use uma foto menor.';
        return;
      }

      status.textContent = 'Preparando a imagem…';
      try {
        var imagem = await reduzir(arquivo, 1000);
        status.textContent = 'Enviando ' + Math.round(imagem.length / 1400) + ' KB…';
        var r = await estado.api('/foto', { method: 'POST', body: JSON.stringify({ imagem: imagem }) });
        estado.pagina.hero.foto = r.url;
        desenharEditor();
        $('#statusFoto').textContent = 'Foto atualizada.';
      } catch (e) {
        status.textContent = e.message || 'Não consegui enviar a imagem.';
      }
    });
  }

  /**
   * Reduz a imagem no navegador antes de enviar.
   *
   * Foto de celular tem 4000px e 6 MB; a página mostra 400px. Reduzir aqui
   * evita trazer biblioteca de imagem para o servidor e faz o upload voar.
   */
  function reduzir(arquivo, maiorLado) {
    return new Promise(function (resolve, reject) {
      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error('Não consegui ler o arquivo.')); };
      leitor.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Arquivo de imagem inválido.')); };
        img.onload = function () {
          var escala = Math.min(1, maiorLado / Math.max(img.width, img.height));
          var tela = document.createElement('canvas');
          tela.width = Math.round(img.width * escala);
          tela.height = Math.round(img.height * escala);
          tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
          resolve(tela.toDataURL('image/jpeg', 0.85));
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }

  /* ------------------------------------------------ salvar */

  async function salvar() {
    var botao = $('#salvarConteudo');
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      var r = await estado.api('/pagina', { method: 'PUT', body: JSON.stringify(estado.pagina) });
      estado.pagina = r.pagina;
      estado.sujo = false;
      $('#statusConteudo').textContent = 'salvo';
      desenharOrdem(); desenharEditor();
    } catch (e) {
      $('#statusConteudo').textContent = e.message;
    } finally {
      botao.disabled = false; botao.textContent = 'Salvar conteúdo';
    }
  }

  /* ------------------------------------------------ entrada */

  function iniciar(api) {
    estado.api = api;
    $('#salvarConteudo').addEventListener('click', salvar);
    window.addEventListener('beforeunload', function (e) {
      if (estado.sujo) { e.preventDefault(); e.returnValue = ''; }
    });
    return api('/pagina').then(function (r) {
      estado.pagina = r.pagina;
      estado.secoes = r.secoes;
      desenharOrdem();
      desenharEditor();
    });
  }

  return { iniciar: iniciar };
})();

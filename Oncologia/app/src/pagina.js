/**
 * pagina.js — o conteúdo editável do site do paciente.
 *
 * Tudo que aparece na página vive aqui: textos, foto, formação, áreas de
 * atuação, perguntas frequentes, e a ORDEM das seções. O médico edita pelo
 * painel; nada disso é código.
 *
 * O padrão abaixo é o texto que estava escrito no HTML antes de existir o
 * editor — assim quem já tinha o site no ar não perde nada ao atualizar, e
 * quem instala do zero começa com uma página pronta em vez de uma em branco.
 */

/** As seções que podem ser reordenadas e ocultadas. A ordem aqui é a inicial. */
const SECOES = [
  { id: 'sobre', nome: 'Sobre o médico', fixa: false },
  { id: 'locais', nome: 'Onde atendo', fixa: false },
  { id: 'agendar', nome: 'Agendamento', fixa: false },
  { id: 'duvidas', nome: 'Dúvidas frequentes', fixa: false },
];

function padrao() {
  return {
    hero: {
      eyebrow: 'Oncologia clínica · Goiânia',
      titulo: 'Cuidado oncológico com tempo para ouvir você.',
      lede: 'Atendimento em dois hospitais, agenda aberta para primeira consulta, '
        + 'retorno e segunda opinião. O agendamento é feito aqui e a recepção confirma '
        + 'com você pelo WhatsApp no mesmo dia útil.',
      botaoPrimario: 'Agendar consulta',
      botaoSecundario: 'Conhecer o médico',
      credenciais: ['CRM-GO 00.000', 'RQE 0000 — Cancerologia Clínica', 'Membro SBOC'],
      destaques: [
        { valor: '2', rotulo: 'hospitais de atendimento' },
        { valor: '40 min', rotulo: 'de consulta por paciente' },
        { valor: 'até 24h', rotulo: 'para a recepção confirmar' },
      ],
      foto: '',
    },

    /**
     * Uma frase do médico, logo abaixo da apresentação. Existe para dar uma
     * pausa entre blocos de texto e para o paciente ouvir a voz dele antes de
     * ler o currículo. Em branco, o bloco não aparece.
     */
    destaque: {
      frase: 'Ninguém deveria receber um diagnóstico de câncer e sair do consultório '
        + 'sem entender o que vem pela frente.',
      autoria: '',
    },

    sobre: {
      eyebrow: 'Sobre',
      titulo: 'Quem vai te atender',
      paragrafos: [
        'Sou oncologista clínico e acompanho pacientes adultos em diagnóstico, tratamento '
        + 'e seguimento de tumores sólidos. Trabalho em conjunto com cirurgiões, '
        + 'radioterapeutas, nutrição e psicologia, porque tratamento de câncer raramente é '
        + 'decisão de uma pessoa só.',
        'Na primeira consulta a gente revisa o caso desde o começo: exames, laudos, biópsia '
        + 'e histórico. Você sai da consulta sabendo qual é o diagnóstico, quais são as '
        + 'opções e qual é o próximo passo — com tempo para perguntar o que precisar, junto '
        + 'de um acompanhante se preferir.',
        'Também atendo segunda opinião. Trazer o caso para outro oncologista antes de '
        + 'iniciar o tratamento é uma atitude sensata, não uma desconfiança do colega.',
      ],
      tituloAreas: 'Áreas de atuação',
      areas: [
        { nome: 'Mama', destaque: true },
        { nome: 'Trato gastrointestinal', destaque: true },
        { nome: 'Pulmão', destaque: true },
        { nome: 'Geniturinário', destaque: false },
        { nome: 'Ginecológico', destaque: false },
        { nome: 'Cabeça e pescoço', destaque: false },
        { nome: 'Cuidados paliativos', destaque: false },
        { nome: 'Segunda opinião', destaque: false },
      ],
      tituloFormacao: 'Formação',
      formacao: [
        { ano: '2008', titulo: 'Medicina', detalhe: 'Universidade' },
        { ano: '2011', titulo: 'Residência em Clínica Médica', detalhe: 'Hospital' },
        { ano: '2014', titulo: 'Residência em Oncologia Clínica', detalhe: 'Hospital' },
        { ano: '2016', titulo: 'Título de especialista', detalhe: 'SBOC / AMB' },
      ],
    },

    locais: {
      eyebrow: 'Onde atendo',
      titulo: 'Onde você pode ser atendido',
      descricao: 'Escolha o local mais fácil para você — a agenda de cada lugar é independente.',
    },

    agendar: {
      eyebrow: 'Agendamento',
      titulo: 'Escolha o local, o dia e o horário',
      descricao: 'Os horários abaixo são os que estão livres na agenda do médico agora. '
        + 'Ao enviar, sua consulta entra como pré-agendamento e a recepção confirma com '
        + 'você pelo WhatsApp.',
      avisoUrgencia: 'Em caso de urgência, não use este formulário: procure o pronto-socorro ou ligue 192.',
      preparo: [
        'Documento com foto e carteirinha do convênio',
        'Pedido ou encaminhamento médico, se tiver',
        'Todos os exames e laudos, inclusive os antigos — principalmente laudo de biópsia e exames de imagem',
        'Lista dos remédios que você toma hoje, com as doses',
      ],
    },

    duvidas: {
      eyebrow: 'Antes da consulta',
      titulo: 'Dúvidas frequentes',
      itens: [
        {
          pergunta: 'Meu horário já está garantido?',
          resposta: 'O horário fica reservado assim que você envia o pedido, mas a consulta '
            + 'só é confirmada quando a recepção falar com você pelo WhatsApp — normalmente '
            + 'no mesmo dia útil.',
        },
        {
          pergunta: 'O que eu levo na primeira consulta?',
          resposta: 'Documento com foto, carteirinha do convênio, pedido ou encaminhamento se '
            + 'tiver, e todos os exames e laudos que já fez — inclusive os antigos. Laudo de '
            + 'biópsia e exames de imagem são os mais importantes.',
        },
        {
          pergunta: 'Posso levar acompanhante?',
          resposta: 'Pode, e é recomendado. Consulta de oncologia tem muita informação; duas '
            + 'pessoas ouvindo ajudam bastante.',
        },
        {
          pergunta: 'E se eu precisar remarcar?',
          resposta: 'É só responder a mensagem da recepção no WhatsApp. Avisar com antecedência '
            + 'libera o horário para outro paciente que esteja esperando.',
        },
        {
          pergunta: 'É urgente. Posso usar este formulário?',
          resposta: 'Não. Em caso de febre alta, dor intensa, sangramento, falta de ar ou piora '
            + 'súbita, procure o pronto-socorro ou ligue 192. Este formulário é só para consulta '
            + 'ambulatorial.',
        },
      ],
    },

    rodape: [
      'Este site não substitui avaliação médica presencial e não atende urgências. Em emergência, ligue 192.',
      'Seus dados são usados apenas para agendar e confirmar a consulta, conforme a LGPD (Lei 13.709/2018).',
    ],

    ordem: SECOES.map((s) => s.id),
    ocultas: [],
  };
}

module.exports = { padrao, SECOES };

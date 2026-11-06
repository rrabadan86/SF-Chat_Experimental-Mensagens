/**
 * painel-estado.js — estado do painel que muda durante a execução (sessão da
 * página atual, sessões abertas, "gerando…", caches). Era "let" no topo do
 * painel-mensagens.js; ficou num objeto compartilhado para as telas, agora em
 * arquivos separados, enxergarem e alterarem o MESMO valor.
 */
module.exports = {
  _cotacao: { valor: 5.40, em: 0, fonte: 'padrão' },
  _sessoes: {},
  _sessoesDirty: false,
  _sessoesTimer: null,
  _navSess: null,
  _saudeCor: null,
  _profsAudio: { em: 0, lista: [] },
  _ffmpegOk: null,
  _gradeGerando: false,
  _gradeDesde: 0,
  _ativasGerando: false,
  _ativasUltimo: null,
  fuEsperando: {},
  _bookCfgCache: null,
  _bookInFlight: false,
  _circSlots: { em: 0, dados: null },
};

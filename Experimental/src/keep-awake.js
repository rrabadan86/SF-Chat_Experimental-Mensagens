/**
 * Keep-Awake: Impede que o Windows entre em suspensão/hibernação
 * enquanto o scheduler está rodando.
 *
 * Usa a API SetThreadExecutionState do kernel32.dll via koffi (FFI).
 * Não requer privilégios de administrador.
 *
 * Quando o processo Node encerra, o Windows automaticamente
 * libera o estado e volta a permitir suspensão.
 */

const koffi = require('koffi');

// Flags do SetThreadExecutionState
const ES_CONTINUOUS        = 0x80000000; // Mantém o estado até ser liberado
const ES_SYSTEM_REQUIRED   = 0x00000001; // Impede suspensão do sistema
const ES_DISPLAY_REQUIRED  = 0x00000002; // Impede desligamento do display
const ES_AWAYMODE_REQUIRED = 0x00000040; // Modo "ausente" — permite ao sistema
                                          // continuar processando sem exibir tela

let kernel32;
let SetThreadExecutionState;
let refreshInterval;

/**
 * Ativa o modo keep-awake.
 * O sistema não vai hibernar/suspender enquanto o processo estiver vivo.
 * Também mantém o display ligado para que o browser possa renderizar.
 */
function enable() {
  try {
    kernel32 = koffi.load('kernel32.dll');
    SetThreadExecutionState = kernel32.func(
      'uint32_t __stdcall SetThreadExecutionState(uint32_t esFlags)'
    );

    const flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED;
    const result = SetThreadExecutionState(flags);

    if (result === 0) {
      console.error('⚠️  Keep-Awake: SetThreadExecutionState falhou');
      return false;
    }

    // Refresca o estado a cada 5 minutos como segurança extra
    // (alguns drivers de energia podem resetar o estado)
    refreshInterval = setInterval(() => {
      try {
        SetThreadExecutionState(flags);
      } catch (e) {
        // Silencioso — se falhar, o próximo intervalo tenta de novo
      }
    }, 5 * 60 * 1000);

    console.log('🔋 Keep-Awake ATIVADO — sistema não vai hibernar/suspender');
    return true;
  } catch (err) {
    console.error(`⚠️  Keep-Awake não disponível: ${err.message}`);
    return false;
  }
}

/**
 * Desativa o modo keep-awake.
 * Libera o sistema para suspender/hibernar normalmente.
 */
function disable() {
  try {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }

    if (SetThreadExecutionState) {
      // ES_CONTINUOUS sozinho libera todas as flags anteriores
      SetThreadExecutionState(ES_CONTINUOUS);
      console.log('🔋 Keep-Awake DESATIVADO — sistema pode hibernar');
    }
  } catch (err) {
    // Silencioso no desligamento
  }
}

module.exports = { enable, disable };

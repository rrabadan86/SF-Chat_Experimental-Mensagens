const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

const CDP_URL = 'http://127.0.0.1:9226';
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
];
// Perfil DEDICADO do bot (pasta isolada) — evita conflito com o Edge pessoal.
// O Edge só permite 1 instância por pasta; como esta é exclusiva do bot,
// o Edge dele sempre abre limpo com a porta de depuração funcionando.
const EDGE_USER_DATA = process.env.BOT_EDGE_WA || 'C:\\SlimfitBot\\edge-wa';
const EDGE_PROFILE = 'Default';

class WhatsAppSender {
  constructor() {
    this.browser = null;
    this.page = null;
    this.ready = false;
  }

  /**
   * Conecta ao Edge existente ou abre um novo com depuração remota.
   * Encontra ou abre a aba do WhatsApp Web automaticamente.
   */
  async init() {
    if (this.ready) return;

    // 1. Tenta conectar ao Edge já aberto
    let connected = await this.tryConnect();

    // 2. Se conectou, VERIFICA se é o perfil correto (SlimFit)
    if (connected) {
      const isCorrectProfile = await this.verifyProfile();
      if (!isCorrectProfile) {
        console.log('⚠️  Edge está aberto com perfil ERRADO! Fechando e reabrindo com perfil SlimFit...');
        try { this.browser.disconnect(); } catch (e) { /* ignore */ }
        this.browser = null;
        connected = false;
        // Mata o Edge para reabrir com perfil correto
        await this.killEdge();
      }
    }

    // 3. Se não conseguiu (ou perfil errado), abre o Edge com perfil SlimFit.
    //    IMPORTANTE: relança o Edge (mata + reabre) a cada ciclo, porque às vezes
    //    um processo antigo do Edge impede a porta de depuração de abrir. Só tentar
    //    reconectar não resolve — é preciso reabrir o Edge de fato.
    if (!connected) {
      for (let ciclo = 1; ciclo <= 3 && !connected; ciclo++) {
        console.log(`📱 Abrindo Edge com perfil SlimFit (ciclo ${ciclo}/3)...`);
        await this.launchEdge(); // já mata o Edge antes de abrir

        for (let i = 0; i < 4 && !connected; i++) {
          await this.sleep(3000);
          connected = await this.tryConnect();
          if (!connected) console.log(`   Tentativa ${i + 1}/4 de conexão (ciclo ${ciclo})...`);
        }
      }

      // Verifica perfil novamente após abrir
      if (connected) {
        const isCorrectProfile = await this.verifyProfile();
        if (!isCorrectProfile) {
          throw new Error(`ABORTADO: Edge abriu com perfil errado. Esperado: ${EDGE_PROFILE}. NÃO vou enviar mensagens pelo perfil errado.`);
        }
      }
    }

    if (!connected) {
      throw new Error('Não foi possível conectar ao Edge. Verifique se ele está instalado.');
    }

// 4. Procura aba do WhatsApp Web já aberta e garante que seja a ÚNICA
    const pages = await this.browser.pages();
    this.page = null;
    let abasWhatsApp = [];

    for (const p of pages) {
      try {
        if (p.url().includes('web.whatsapp.com')) {
          abasWhatsApp.push(p);
        }
      } catch (e) { /* ignora abas com erro */ }
    }

    if (abasWhatsApp.length > 0) {
      this.page = abasWhatsApp[0]; // Pega a primeira que achou
      console.log('✅ Aba do WhatsApp Web encontrada!');

      // Se tiver outras abas do WhatsApp abertas, FECHA elas para evitar conflito
      if (abasWhatsApp.length > 1) {
        console.log(`🧹 Encontrei ${abasWhatsApp.length} abas do WhatsApp. Fechando as duplicadas...`);
        for (let i = 1; i < abasWhatsApp.length; i++) {
          try { await abasWhatsApp[i].close(); } catch(e) {}
        }
      }
    }

    // 5. Se não encontrou, abre uma nova; se encontrou, traz pra frente e recarrega
    if (!this.page) {
      console.log('📱 Abrindo nova aba do WhatsApp Web...');
      this.page = await this.browser.newPage();
      await this.page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });
    } else {
      console.log('🔄 Acordando a aba e recarregando para evitar inatividade...');
      await this.page.bringToFront();
      await this.page.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    }

    // 6. Aguarda a tela de chats carregar (e lida agressivamente com o "Usar Aqui")
    console.log('⏳ Aguardando WhatsApp Web ficar pronto (lidando com recarregamento e "Usar aqui")...');

    const maxWaitTime = 60000;
    const checkInterval = 2000;
    let elapsedTime = 0;
    let isReady = false;

    while (elapsedTime < maxWaitTime && !isReady) {
      try {
        isReady = await this.page.evaluate(() => {
          // 6.1 Clique agressivo no botão de reassumir a sessão. O WhatsApp novo
          //     usa "Usar nesta janela"; versões antigas usavam "Usar aqui"/"Use here".
          const alvos = ['usar nesta janela', 'usar aqui', 'use here', 'usar aquí',
                         'continuar aqui', 'continue here', 'use aqui'];
          const elements = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"], span, div, a'));
          const btnUsarAqui = elements.find(el => {
              if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
              const text = (el.innerText || el.textContent || '').trim().toLowerCase();
              return alvos.includes(text);
          });

          if (btnUsarAqui) {
              (btnUsarAqui.closest('button, [role="button"]') || btnUsarAqui).click();
              return false; // Clicou, então retorna falso para o robô esperar a tela recarregar
          }

          // 6.2 Verifica os seletores principais de "está logado e pronto"
          const chatList = document.querySelector('[data-testid="chat-list"]');
          const paneSide = document.querySelector('#pane-side');
          const ariaList = document.querySelector('[aria-label="Lista de conversas"]');
          const divTab3 = document.querySelector('div[data-tab="3"]');

          return !!(chatList || paneSide || ariaList || divTab3);
        });
      } catch (e) {
        // Ignora erros normais de transição de página durante o reload
      }

      if (!isReady) {
        await this.sleep(checkInterval);
        elapsedTime += checkInterval;
      }
    }
    
    if (!isReady) {
        throw new Error('Timeout: WhatsApp Web não carregou a lista de conversas após 60 segundos.');
    }

    await this.sleep(2000);
    this.ready = true;
    console.log('✅ WhatsApp Web pronto!\n');  }

  /**
   * Verifica se o Edge conectado está usando o perfil SlimFit.
   * Usa CDP para checar o profile-directory do browser.
   * NUNCA permite enviar mensagens pelo perfil errado.
   */
  async verifyProfile() {
    try {
      // Método 1: Verificar via edge://version (mais confiável)
      const pages = await this.browser.pages();
      let versionPage = null;
      let createdPage = false;

      // Procura uma aba edge://version já aberta
      for (const p of pages) {
        try {
          if (p.url().includes('edge://version')) {
            versionPage = p;
            break;
          }
        } catch (e) { /* ignore */ }
      }

      // Se não tem, abre uma temporária
      if (!versionPage) {
        versionPage = await this.browser.newPage();
        createdPage = true;
        await versionPage.goto('edge://version', { waitUntil: 'domcontentloaded', timeout: 10000 });
        await this.sleep(1000);
      }

      // Extrai o "Profile Path" da página edge://version
      const profilePath = await versionPage.evaluate(() => {
        const rows = document.querySelectorAll('tr, td, span');
        for (const el of rows) {
          const text = el.textContent || '';
          // Procura a linha "Profile Path" ou "Caminho do perfil"
          if (text.includes('Profile Path') || text.includes('Caminho do perfil') || text.includes('Perfil')) {
            // O valor está no próximo elemento ou na mesma linha
            const match = text.match(/(?:Profile Path|Caminho do perfil)[:\s]*(.*)/i);
            if (match) return match[1].trim();
          }
        }
        // Fallback: procura pelo conteúdo completo
        const bodyText = document.body.innerText;
        const profileMatch = bodyText.match(/(?:Profile Path|Caminho do perfil)\s+(.+?)[\n\r]/i);
        return profileMatch ? profileMatch[1].trim() : null;
      });

      // Fecha a aba temporária
      if (createdPage && versionPage) {
        try { await versionPage.close(); } catch (e) { /* ignore */ }
      }

      if (profilePath) {
        const profileName = profilePath.split(/[\\\/]/).pop();
		const isSlimFit = profileName === EDGE_PROFILE;
        if (isSlimFit) {
          console.log(`✅ Perfil verificado: SlimFit (${EDGE_PROFILE})`);
        } else {
          console.log(`❌ PERFIL ERRADO detectado! Path: ${profilePath}`);
          console.log(`   Esperado: ${EDGE_PROFILE} (SlimFit)`);
        }
        return isSlimFit;
      }

      // Método 2 (fallback): Verificar via CDP Browser.getVersion
      // Se não conseguiu via edge://version, tenta CDP
      console.log('⚠️  Não conseguiu verificar perfil via edge://version, usando fallback CDP...');
      const cdpPages = await this.browser.pages();
      if (cdpPages.length > 0) {
        const client = await cdpPages[0].target().createCDPSession();
        const { userAgent } = await client.send('Browser.getVersion');
        await client.detach();
        // Nota: userAgent não contém perfil, então vamos checar o user-data-dir
        // via args de linha de comando
      }

      // Se nenhum método funcionou, assume que está errado (segurança)
      console.log('⚠️  Não foi possível verificar o perfil. Por segurança, será reaberto.');
      return false;
    } catch (err) {
      console.log(`⚠️  Erro ao verificar perfil: ${err.message}. Por segurança, será reaberto.`);
      return false;
    }
  }

  /**
   * Se aparecer o aviso "WhatsApp aberto em outra janela", clica em
   * "Usar nesta janela" para reassumir a sessão. Retorna true se clicou.
   */
  async claimSession() {
    try {
      return await this.page.evaluate(() => {
        const alvos = ['usar nesta janela', 'usar aqui', 'use here', 'usar aquí',
                       'continuar aqui', 'continue here', 'use aqui'];
        const els = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"], span, div, a'));
        for (const el of els) {
          if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (alvos.includes(t)) { (el.closest('button, [role="button"]') || el).click(); return true; }
        }
        return false;
      });
    } catch (e) { return false; }
  }

  /**
   * Tenta conectar ao Edge via CDP
   */
  async tryConnect() {
    try {
      this.browser = await puppeteer.connect({
        browserURL: CDP_URL,
        defaultViewport: null,
      });
      console.log('✅ Conectado ao Edge!');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mata todos os processos do Edge
   */
  async killEdge() {
    const { execSync } = require('child_process');
    try {
      // /T mata também os processos-filho do Edge (evita sobrar processo que
      // segura o perfil e impede a porta de depuração de abrir)
      execSync('taskkill /F /T /IM msedge.exe', { stdio: 'ignore' });
      console.log('🔪 Edge fechado.');
    } catch (e) {
      // Sem processos do Edge para matar
    }
    await this.sleep(5000); // espera o Edge morrer de vez antes de reabrir
  }

  /**
   * Abre o Edge com depuração remota, SEMPRE usando o perfil SlimFit.
   * Mata qualquer Edge existente antes para garantir o perfil correto.
   */
  async launchEdge() {
    const fs = require('fs');
    const { spawn } = require('child_process');

    // Encontra o executável do Edge
    let edgePath = null;
    for (const p of EDGE_PATHS) {
      if (fs.existsSync(p)) {
        edgePath = p;
        break;
      }
    }

    if (!edgePath) {
      throw new Error('Microsoft Edge não encontrado.');
    }

    // SEMPRE mata processos do Edge antes de abrir com perfil correto
    await this.killEdge();

    console.log(`🌐 Abrindo Edge (perfil SlimFit - ${EDGE_PROFILE})...`);

    const child = spawn(edgePath, [
      '--remote-debugging-port=9226',
      '--remote-debugging-address=127.0.0.1', // força a porta no IP exato que o script busca
      '--remote-allow-origins=*',             // Chromium 111+ rejeita o WebSocket do DevTools sem isso
      `--user-data-dir=${EDGE_USER_DATA}`,
      `--profile-directory=${EDGE_PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://web.whatsapp.com',             // abre direto no WhatsApp, sem restaurar sessão antiga
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Aguarda Edge iniciar
    await this.sleep(5000);
  }

  /**
   * Envia uma mensagem via WhatsApp Web
   */
  async sendMessage(phoneNumber, message) {
    if (!this.ready) {
      console.error('❌ WhatsApp Web não está pronto.');
      return false;
    }

    let number = phoneNumber.replace(/\D/g, '');
    if (!number.startsWith('55')) {
      number = '55' + number;
    }

    try {
      const encodedMsg = encodeURIComponent(message);
      const url = `https://web.whatsapp.com/send?phone=${number}&text=${encodedMsg}`;

      console.log(`   📨 Enviando para ${phoneNumber}...`);
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      await this.sleep(3000);

      // Se o WhatsApp pedir para reassumir a sessão ("Usar nesta janela"), clica.
      if (await this.claimSession()) {
        console.log('   🔄 Sessão reassumida ("Usar nesta janela").');
        await this.sleep(3000);
      }

      // Verifica erro de número inválido
      const hasError = await this.page.evaluate(() => {
        const body = document.body.textContent || '';
        return body.includes('número de telefone inválido') ||
               body.includes('invalid phone') ||
               body.includes('Phone number shared via url is invalid');
      });

      if (hasError) {
        console.log(`   ⚠️  Número ${number} inválido ou não encontrado`);
        return false;
      }

      // Aguarda botão de enviar
      await this.page.waitForFunction(
        () => {
          return document.querySelector('[data-testid="send"], [aria-label="Enviar"], button[aria-label="Send"]') ||
                 document.querySelector('[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"]');
        },
        { timeout: 15000 }
      );

      await this.sleep(1500);

      // Clica no botão ENVIAR
      const sent = await this.page.evaluate(() => {
        const sendBtn = document.querySelector('[data-testid="send"], [aria-label="Enviar"], button[aria-label="Send"]');
        if (sendBtn) { sendBtn.click(); return true; }
        return false;
      });

      if (!sent) {
        await this.page.keyboard.press('Enter');
      }

      await this.sleep(3000);
      console.log(`   ✅ Mensagem enviada para ${phoneNumber}`);
      return true;
    } catch (error) {
      console.error(`   ❌ Erro ao enviar para ${phoneNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Envia mensagens para uma lista de alunos
   */
  async sendBulkMessages(students, messageBuilder) {
    const results = { sent: 0, failed: 0, skipped: 0, details: [] };

    console.log(`\n📨 Enviando ${students.length} mensagem(ns)...\n`);

    for (const student of students) {
      if (!student.phone || student.phone === 'N/A') {
        console.log(`   ⏭️  ${student.name}: sem telefone, pulando`);
        results.skipped++;
        results.details.push({ name: student.name, status: 'skipped', reason: 'Sem telefone' });
        continue;
      }

      const message = messageBuilder(student.name, student.time);
      const success = await this.sendMessage(student.phone, message);

      if (success) {
        results.sent++;
        results.details.push({ name: student.name, phone: student.phone, status: 'sent' });
      } else {
        results.failed++;
        results.details.push({ name: student.name, phone: student.phone, status: 'failed' });
      }

      // Pausa de 10s entre mensagens (natural)
      await this.sleep(10000);
    }

    return results;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Desconecta do Edge (NÃO fecha o Edge)
   */
  async close() {
    if (this.browser) {
      console.log('📱 Desconectando do Edge...');
      try {
        this.browser.disconnect();
      } catch (e) { /* ignore */ }
      this.browser = null;
      this.page = null;
      this.ready = false;
    }
  }
}

module.exports = WhatsAppSender;
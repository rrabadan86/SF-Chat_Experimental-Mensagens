/**
 * whatsapp-sender.js — ADAPTADOR sobre o cliente único (wa-client.js).
 *
 * Mantido por compatibilidade: os jobs continuam usando `new WhatsAppSender()`,
 * mas por baixo TUDO passa pelo MESMO cliente persistente (whatsapp-web.js).
 * Nada de abrir/fechar o navegador a cada envio — era isso que derrubava a
 * sessão. init() só garante que o cliente está pronto; close() é no-op.
 */
const wa = require('./wa-client');

class WhatsAppSender {
  constructor() {
    this.ready = false;
    this.page = null; // compat: jobs antigos liam .page; hoje não é usado
  }

  async init() {
    await wa.initWhatsApp(); // idempotente — o scheduler já subiu o cliente
    this.ready = wa.isReady();
    if (!this.ready) console.log('⚠️  WhatsApp ainda não está "ready".');
    return this.ready;
  }

  async sendMessage(phoneNumber, message, chaveFoto) {
    try {
      await wa.sendTexto(phoneNumber, message, undefined, chaveFoto);
      console.log(`   ✅ Mensagem enviada para ${phoneNumber}`);
      return true;
    } catch (error) {
      console.error(`   ❌ Erro ao enviar para ${phoneNumber}: ${error.message}`);
      return false;
    }
  }

  async sendBulkMessages(students, messageBuilder, chaveFoto) {
    const results = { sent: 0, failed: 0, skipped: 0, details: [] };
    console.log(`\n📨 Enviando ${students.length} mensagem(ns)...\n`);

    for (const student of students) {
      if (!student.phone || student.phone === 'N/A') {
        console.log(`   ⏭️  ${student.name}: sem telefone, pulando`);
        results.skipped++;
        results.details.push({ name: student.name, status: 'skipped', reason: 'Sem telefone' });
        continue;
      }

      const message = messageBuilder(student.name, student.time, student);
      console.log(`   📨 Enviando para ${student.name} (${student.phone})...`);
      const success = await this.sendMessage(student.phone, message, chaveFoto);

      // Áudio da professora da aula (painel → 🎙️ Áudio da professora), depois do texto.
      if (success) await this.enviarAudioDaProfessora(student.phone, chaveFoto, student.professor);

      if (success) {
        // Confirmação de hoje/amanhã: registra para a "Confirmação sem resposta".
        try { require('./confirmacao-sem-resposta').registrarEnvio({ telefone: student.phone, nome: student.name, horario: student.time, chave: chaveFoto }); } catch (_) {}
        results.sent++;
        results.details.push({ name: student.name, phone: student.phone, status: 'sent' });
      } else {
        results.failed++;
        results.details.push({ name: student.name, phone: student.phone, status: 'failed' });
      }

      // Pausa natural entre mensagens (8-10s)
      await this.sleep(8000 + Math.floor(Math.random() * 2000));
    }

    return results;
  }

  // Manda o áudio (como mensagem de voz) da professora, se houver um para esta
  // mensagem. Falha no áudio não desfaz o texto já enviado.
  async enviarAudioDaProfessora(phone, chaveMsg, professora) {
    let audio = null;
    try {
      const audios = require('./audios-msg');
      const grupo = audios.grupoDaChave(chaveMsg);
      if (!grupo) return;
      audio = audios.caminho(grupo, professora);
      if (!audio) return;
      await this.sleep(1500);
      await wa.sendMidia(phone, audio, { comoVoz: audios.VOZ.test(audio), contexto: `Áudio · ${professora || 'professora'}` });
      console.log(`   🎧 Áudio enviado (${require('path').basename(audio)})`);
    } catch (e) {
      console.error(`   ⚠️  Áudio não enviado para ${phone}${audio ? ` (${require('path').basename(audio)})` : ''}: ${e.message}`);
    }
  }

  sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  // Compat: NÃO fecha o cliente compartilhado (ele vive enquanto o app roda).
  async close() { /* no-op */ }
}

module.exports = WhatsAppSender;

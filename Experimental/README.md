# 🏋️ Slimfit - Confirmação Automática de Aulas Experimentais

Sistema que envia automaticamente mensagens de confirmação via WhatsApp para alunas com aulas experimentais agendadas no Studio Slimfit Setor Bueno.

## ⏰ Como funciona

| Horário | Ação |
|---------|------|
| **08:30 seg-sex** | Busca aulas experimentais de **hoje após 12h** e envia WhatsApp |
| **16:30 seg-sex** | Busca aulas experimentais de **amanhã até 11:30** e envia WhatsApp |

---

## 📋 Pré-requisitos

1. **Node.js** (v18 ou superior) — [Baixar aqui](https://nodejs.org/)
2. **Google Chrome** instalado no computador

## 🚀 Instalação

### 1. Copie a pasta do projeto
Copie toda a pasta `Experimental` para o outro computador.

### 2. Abra o terminal na pasta do projeto
```
cd C:\caminho\para\Experimental
```

### 3. Libere execução de scripts (apenas 1 vez)
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

### 4. Instale as dependências
```
npm install
```

### 5. Primeira execução — Conectar WhatsApp
```
node src/run-now.js whatsapp
```
- O **Chrome vai abrir** com o WhatsApp Web
- **Escaneie o QR code** com o celular (WhatsApp > Aparelhos conectados)
- Após conectar, feche com `Ctrl+C`
- A sessão fica salva, não precisa escanear novamente

### 6. Teste o scraping do EVO
```
node src/run-now.js scrape
```
Deve listar as aulas experimentais de hoje e amanhã.

### 7. Teste o envio completo (opcional)
```
node src/run-now.js whatsapp 5562XXXXXXXXX 07:00 NomeTeste
```
Envia uma mensagem de teste para o número informado.

### 8. Inicie o agendador automático
```
node src/scheduler.js
```
Pronto! O sistema vai rodar automaticamente nos horários programados.

---

## 📁 Estrutura do projeto

```
Experimental/
├── .env                    ← Credenciais do EVO (NÃO compartilhe!)
├── package.json
├── src/
│   ├── config.js           ← Configurações, mensagens e horários
│   ├── evo-scraper.js      ← Scraping do sistema EVO
│   ├── whatsapp-sender.js  ← Envio via WhatsApp Web (Chrome)
│   ├── scheduler.js        ← Agendador automático (cron)
│   └── run-now.js          ← Script de teste manual
├── whatsapp-chrome-data/   ← Sessão do WhatsApp (gerado automaticamente)
└── node_modules/           ← Dependências (gerado pelo npm install)
```

## 🔧 Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| `node src/scheduler.js` | Inicia o agendamento automático |
| `node src/run-now.js scrape` | Testa apenas o scraping do EVO |
| `node src/run-now.js morning` | Roda o job da manhã agora (scrape + envio) |
| `node src/run-now.js afternoon` | Roda o job da tarde agora (scrape + envio) |
| `node src/run-now.js whatsapp` | Abre WhatsApp Web para conectar |
| `node src/run-now.js whatsapp NUMERO` | Envia mensagem teste para o número |

## ⚠️ Observações importantes

- **Não feche** a janela do Chrome enquanto o scheduler estiver rodando
- O terminal precisa ficar aberto com o `scheduler.js` em execução
- Se o PC reiniciar, rode `node src/scheduler.js` novamente
- Se o WhatsApp desconectar, rode `node src/run-now.js whatsapp` para reconectar

## ✏️ Personalização

### Alterar mensagens
Edite o arquivo `src/config.js` — campos `messagesToday` e `messagesTomorrow`.

### Alterar horários do cron
Edite o arquivo `src/config.js` — campo `schedule`:
```js
schedule: {
  morning: '30 8 * * 1-5',    // 08:30 seg-sex
  afternoon: '30 16 * * 1-5', // 16:30 seg-sex
},
```

### Alterar credenciais do EVO
Edite o arquivo `.env`:
```
EVO_EMAIL=seu_email@gmail.com
EVO_PASSWORD=sua_senha
```

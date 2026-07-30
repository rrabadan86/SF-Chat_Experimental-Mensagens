# 🚀 Tutorial de Migração para VPS Hostinger — SlimFit

Guia completo para colocar a automação **`Experimental/`** rodando **online 24/7**
no VPS da Hostinger (Ubuntu 24.04). No final há também a seção do **`ChatBot/`
(Sofia)**, que será migrado depois.

> **VPS deste tutorial**
> - IP: `2.24.87.131` · Host: `srv1867807.hstgr.cloud`
> - SO: Ubuntu 24.04 LTS · 2 vCPU · 8 GB RAM · 100 GB disco
> - Usuário: `root`

---

## ⚠️ Leia isto antes de começar (importante!)

O código da pasta `Experimental/` **foi escrito para Windows**. Ele:

- Conecta-se ao **Microsoft Edge** de desktop via depuração remota (porta `9226`);
- Usa caminhos do Windows (`C:\SlimfitBot\edge-wa`), `taskkill /F /IM msedge.exe`
  e `edge://version`;
- Usa `koffi` + `kernel32.dll` (`keep-awake.js`) para impedir o Windows de suspender.

**No VPS (Linux) não existe Edge de desktop nem interface gráfica.** Por isso a
migração tem **duas partes**:

1. **Preparar o servidor** (Node, Chromium, dependências, fuso, autostart) — este tutorial.
2. **Adaptar a camada de navegador** para rodar **Chromium headless no Linux** (Etapa 6).
   Sem essa adaptação o `scheduler.js` sobe, mas o envio de WhatsApp falha.

> 🔒 **Aviso sobre o WhatsApp Web:** ao logar a sessão de um IP/localização nova
> (o VPS fica em Boston-EUA), o WhatsApp pode pedir reconfirmação ou sinalizar
> atividade. Recomendado: reservar um número dedicado ao bot e escanear o QR com
> calma na primeira vez. Se possível, use um número já "aquecido".

---

## ✅ Etapa 0 — Acesso ao servidor e atualização (JÁ FEITO)

Registro do que já foi executado — mantido aqui para referência/repetição.

```bash
# No seu PC (Windows/CMD ou PowerShell)
ssh root@2.24.87.131
# senha do VPS (painel Hostinger)

# Já dentro do servidor:
apt update
apt upgrade -y          # 48 pacotes atualizados; kernel novo instalado
apt install git -y      # já era a versão mais recente

# Clonagem do repositório oficial:
git clone https://github.com/rrabadan86/SF-Chat_Experimental-Mensagens.git
cd SF-Chat_Experimental-Mensagens/Experimental
```

> 💡 O `apt upgrade` instalou um **novo kernel** (`6.8.0-136`). Reinicie o VPS
> uma vez para carregá-lo, quando for conveniente:
> ```bash
> reboot
> ```
> A conexão SSH cai; reconecte após ~30–60 s com `ssh root@2.24.87.131`.

---

## 🔧 Etapa 1 — Fuso horário do servidor

Todos os horários do cron (`08:30`, `15:30`, etc.) são pensados em horário de
Brasília. Deixe o servidor no mesmo fuso para evitar confusão nos logs:

```bash
timedatectl set-timezone America/Sao_Paulo
timedatectl        # confira: "Time zone: America/Sao_Paulo"
```

> O código já usa `America/Sao_Paulo` explicitamente nos agendamentos (`node-cron`
> com `timezone`), mas alinhar o SO deixa os **logs** legíveis.

---

## 🟢 Etapa 2 — Instalar Node.js 20 LTS

O projeto pede Node 18+. Vamos instalar o **Node 20 LTS** (recomendado):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Ferramentas de build (algumas dependências nativas — koffi, etc. — precisam):
apt install -y build-essential python3

node -v      # deve mostrar v20.x
npm -v
```

---

## 🌐 Etapa 3 — Instalar o Chromium e as dependências do Puppeteer

O Puppeteer precisa de um navegador + várias bibliotecas de sistema. No Linux
headless (sem tela) instalamos as libs abaixo:

```bash
apt install -y \
  ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0t64 \
  libatk1.0-0t64 libc6 libcairo2 libcups2t64 libdbus-1-3 libexpat1 \
  libfontconfig1 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
  libxrandr2 libxkbcommon0 xdg-utils wget
```

> Se algum pacote acusar "não encontrado" no Ubuntu 24.04, rode
> `apt install -y libasound2` (sem o sufixo `t64`) — os nomes variam por versão.

O Puppeteer baixa o próprio Chromium durante o `npm install` (Etapa 5). Não é
preciso instalar o Chrome manualmente.

---

## 📄 Etapa 4 — Criar o arquivo `.env`

O `.env` guarda credenciais e caminhos. Ele **não** vem no Git (está no
`.gitignore`). Crie-o dentro de `Experimental/`:

```bash
cd ~/SF-Chat_Experimental-Mensagens/Experimental
nano .env
```

Cole e ajuste os valores reais:

```dotenv
# ─── EVO (sistema de gestão) ───────────────────────────────
EVO_URL=https://slimfit.w12app.com.br
EVO_EMAIL=seu_email@gmail.com
EVO_PASSWORD=sua_senha

# ─── Navegador (LINUX headless) ────────────────────────────
# true = sem janela (obrigatório no VPS). Só use false em PC com tela.
HEADLESS=true

# ─── Google Sheets / Service Account (se usar as planilhas) ─
# Cole o JSON da service account em UMA linha, ou aponte para um arquivo.
# GOOGLE_SA_KEY={"type":"service_account", ...}
SHEETS_ID=
SHEETS_ABA=

# ─── Integração com o formulário na nuvem (opcional) ───────
FORM_CLOUD_URL=
FORM_OUTBOX_TOKEN=

# ─── Instagram / grupos (opcional) ─────────────────────────
IG_USERNAME=
GRUPO_EQUIPE=
```

Salve no nano: `Ctrl+O`, `Enter`, `Ctrl+X`.

> Preencha só o que você realmente usa. Para a confirmação de aulas
> experimentais bastam `EVO_URL`, `EVO_EMAIL`, `EVO_PASSWORD` e `HEADLESS=true`.

---

## 📦 Etapa 5 — Instalar as dependências do projeto

```bash
cd ~/SF-Chat_Experimental-Mensagens/Experimental
npm install
```

Isso baixa o Chromium do Puppeteer e as libs. Pode levar alguns minutos.

Se o Chromium do Puppeteer não baixar automaticamente, force:

```bash
npx puppeteer browsers install chrome
```

---

## 🧩 Etapa 6 — Adaptar a camada de navegador para Linux (CRÍTICO)

Esta é a única mudança de **código** necessária. Hoje `src/whatsapp-sender.js` e
alguns scripts (`enviar_confirmacoes.js`, `instagram-seguidores.js`, etc.) abrem
o **Edge do Windows**. No VPS não há Edge — precisamos que eles usem o
**Chromium do Puppeteer em modo headless**.

Há duas formas de fazer isso:

### Opção A (recomendada) — Lançar o Chromium do Puppeteer

Em vez de `puppeteer.connect()` a um Edge externo, o sender deve `puppeteer.launch()`
o Chromium próprio, com um diretório de perfil dedicado e flags de servidor:

```js
// Exemplo do que o launch precisa no Linux (dentro do whatsapp-sender.js):
this.browser = await puppeteer.launch({
  headless: process.env.HEADLESS !== 'false',   // true no VPS
  userDataDir: process.env.WA_PROFILE_DIR || '/root/wa-profile',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
});
```

Os trechos específicos de Windows (`killEdge()` com `taskkill`, `EDGE_PATHS`,
`edge://version`, `verifyProfile()`) passam a **não** ser chamados no Linux.

### Opção B — Instalar Chromium do sistema e apontar o `executablePath`

```bash
apt install -y chromium-browser   # ou: snap install chromium
which chromium-browser            # ex.: /usr/bin/chromium-browser
```

E no launch: `executablePath: '/usr/bin/chromium-browser'`.

> ✅ **Sugestão:** eu (Claude) posso aplicar a Opção A automaticamente — criando
> um "modo Linux" no `whatsapp-sender.js` que preserva 100% do comportamento
> Windows atual e só troca a forma de abrir o navegador quando `process.platform
> === 'linux'`. Assim o mesmo repositório roda nos dois lugares. É só pedir.

Sobre o `keep-awake.js` (kernel32.dll): no Linux ele deve virar um "no-op"
(não faz nada). Como já está dentro de `try/catch`, ele não derruba o scheduler,
mas o ideal é detectar o SO e pular a chamada.

---

## 📱 Etapa 7 — Primeiro login no WhatsApp (escanear o QR)

Como o VPS é headless, o QR precisa aparecer **no terminal** (texto) em vez de
numa janela. O projeto já tem `qrcode-terminal` nas dependências.

Depois de aplicar a Etapa 6, rode a conexão inicial:

```bash
cd ~/SF-Chat_Experimental-Mensagens/Experimental
node src/run-now.js whatsapp
```

- Um **QR code em ASCII** aparece no terminal SSH.
- No celular: **WhatsApp → Aparelhos conectados → Conectar um aparelho** e
  aponte para o QR na tela.
- Conectou? A sessão fica salva no `userDataDir` (Etapa 6). Encerre com `Ctrl+C`.

> Se o QR não couber na janela, **maximize o terminal** ou diminua a fonte.
> Alternativa: salvar o QR como imagem (`whatsapp-qr.png`) e baixar via `scp`.

---

## 🧪 Etapa 8 — Testar antes de automatizar

```bash
# 1) Testa só o scraping do EVO (não envia nada):
node src/run-now.js scrape

# 2) Envia UMA mensagem de teste para um número seu:
node src/run-now.js whatsapp 5562XXXXXXXXX 07:00 Teste

# 3) Roda o job da manhã inteiro, agora (scrape + envio real!):
node src/run-now.js morning
```

Confirme que:
- o login no EVO funciona (credenciais do `.env`);
- as aulas experimentais aparecem na listagem;
- a mensagem de teste chega no seu WhatsApp.

---

## ♾️ Etapa 9 — Rodar 24/7 com PM2 (autostart + reinício automático)

O `scheduler.js` precisa ficar **sempre rodando**, sobreviver a quedas de SSH e
voltar sozinho se o VPS reiniciar. Use o **PM2**:

```bash
npm install -g pm2

cd ~/SF-Chat_Experimental-Mensagens/Experimental

# Sobe o agendador sob o nome "slimfit-exp":
pm2 start src/scheduler.js --name slimfit-exp --time

# Salva a lista e cria o serviço de boot:
pm2 save
pm2 startup systemd -u root --hp /root
# ↑ copie e execute o comando que ele imprimir (registra no systemd)
```

Comandos úteis do PM2:

```bash
pm2 status                 # ver se está "online"
pm2 logs slimfit-exp       # acompanhar os logs ao vivo
pm2 logs slimfit-exp --lines 200
pm2 restart slimfit-exp    # reiniciar
pm2 stop slimfit-exp       # parar
pm2 delete slimfit-exp     # remover do PM2
```

> **Alternativa ao PM2:** um serviço `systemd` próprio (`/etc/systemd/system/
> slimfit-exp.service`). Funciona igual; o PM2 é só mais prático para Node.

---

## 🔎 Etapa 10 — Verificação final

```bash
pm2 status                       # slimfit-exp = online
timedatectl                      # America/Sao_Paulo
pm2 logs slimfit-exp --lines 50  # sem erros de "Edge"/"taskkill"
```

Deixe rodar até o próximo horário agendado (ver tabela abaixo) e confirme no
`pm2 logs` que o job disparou e enviou.

### Horários agendados (de `src/config.js`)

| Job | Cron | Quando |
|-----|------|--------|
| Confirmação (hoje) | `30 8 * * 1-6` | 08:30 seg–sáb |
| Confirmação (amanhã) | `30 15 * * 0-5` | 15:30 dom–sex |
| Renovação de contratos | `0 17 * * 1` | 17:00 segunda |
| Follow-up manhã | `30 10 * * 1-6` | 10:30 seg–sáb |
| Follow-up tarde | `0 16 * * 1-6` | 16:00 seg–sáb |
| Instagram (boas-vindas) | `0 7 * * *` | 07:00 diário |
| Aniversariantes | `0 8 * * *` | 08:00 diário |

---

## 🛠️ Solução de problemas

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `Failed to launch the browser process` | Faltam libs do Chromium | Rode a Etapa 3 de novo |
| `Running as root without --no-sandbox` | Chromium como root | Garanta `--no-sandbox` no launch (Etapa 6) |
| Erros de `taskkill`/`msedge`/`edge://` | Código ainda em modo Windows | Aplique a Etapa 6 (modo Linux) |
| QR não aparece / desconecta | Sessão nova de IP diferente | Reescaneie; use número dedicado |
| `kernel32.dll` / `koffi` | `keep-awake` em Linux | Vira no-op no Linux (Etapa 6) |
| Fuso errado nos logs | SO em UTC | Etapa 1 (`timedatectl`) |
| Processo morre ao fechar SSH | Rodou sem PM2 | Use PM2 (Etapa 9) |

Atualizar o código depois (novos commits no GitHub):

```bash
cd ~/SF-Chat_Experimental-Mensagens
git pull
cd Experimental && npm install
pm2 restart slimfit-exp
```

---

## 🤖 Etapa 11 — Migrar o `ChatBot/` (Sofia) — DEPOIS

A pasta `ChatBot/` é independente e mais simples de hospedar (não usa navegador).
Ela tem duas peças:

- **`sofia.ts`** — o chatbot em TypeScript, usa `@anthropic-ai/claude-agent-sdk`
  e `@anthropic-ai/sdk`. Precisa da variável `ANTHROPIC_API_KEY`.
- **`rota_book_sofia.py`** — rota Flask (Python) que agenda no EVO; hoje pensada
  para rodar no Render junto ao `formulario_web/app.py`.

Passos gerais quando chegar a hora:

```bash
cd ~/SF-Chat_Experimental-Mensagens/ChatBot

# Node/TS:
npm install
npm install -g tsx           # para rodar .ts direto
export ANTHROPIC_API_KEY=sua-chave   # coloque num .env/serviço, não no histórico

# Teste:
npx tsx sofia.ts             # teste automático
npx tsx sofia.ts --chat      # chat interativo

# Produção (24/7):
pm2 start "npx tsx sofia.ts" --name sofia
pm2 save
```

Para a rota Python (`rota_book_sofia.py`), quando for servida no VPS:

```bash
apt install -y python3-venv
python3 -m venv .venv && source .venv/bin/activate
pip install flask requests           # + o que o formulario_web usar
# defina SOFIA_TOKEN e as variáveis EVO_* no ambiente
```

> Detalharemos o ChatBot num tutorial próprio quando o `Experimental/` estiver
> 100% no ar. A ideia é o mesmo VPS hospedar as duas coisas com PM2.

---

## 📌 Resumo rápido (checklist)

- [x] SSH, `apt update/upgrade`, `git clone` (Etapa 0)
- [ ] `reboot` para o novo kernel
- [ ] Fuso `America/Sao_Paulo` (Etapa 1)
- [ ] Node 20 + build-essential (Etapa 2)
- [ ] Libs do Chromium (Etapa 3)
- [ ] Criar `.env` (Etapa 4)
- [ ] `npm install` (Etapa 5)
- [ ] **Adaptar navegador p/ Linux** (Etapa 6) ← peça ao Claude p/ aplicar
- [ ] Escanear QR do WhatsApp (Etapa 7)
- [ ] Testes `scrape` / `morning` (Etapa 8)
- [ ] PM2 + autostart (Etapa 9)
- [ ] Verificação final (Etapa 10)
- [ ] ChatBot depois (Etapa 11)

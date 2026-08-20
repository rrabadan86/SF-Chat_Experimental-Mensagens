# 🚀 Tutorial de Migração para VPS Hostinger — SlimFit

Guia completo para colocar a automação **`Experimental/`** rodando **online 24/7**
no VPS da Hostinger (Ubuntu 24.04). No final há também a seção do **`ChatBot/`
(Sofia)**, que será migrado depois.

> 📌 **Este arquivo é o registro da migração ORIGINAL** (unidade Setor Bueno).
> Para **instalar o robô numa franquia nova**, use o **runbook** genérico e
> pronto-pra-franquia em **`/implantacao`** do formulário
> (`https://sf-formularioexperimental.onrender.com/implantacao`). Ele já parte do
> `.env.example` e das variáveis por unidade (`STUDIO_NOME`, `AUDIO_MAP`, etc.).
> Mantenha este documento como memória do primeiro deploy.

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

**No VPS (Linux) não existe Edge de desktop nem interface gráfica.** Boa notícia:
a **adaptação de código já foi feita** — o `whatsapp-sender.js` agora é
multiplataforma (Windows usa Edge; Linux usa Chromium headless do Puppeteer,
com o QR de login impresso no terminal). Veja a Etapa 6. Portanto a migração é,
na prática, só **preparar o servidor** (Node, Chromium, dependências, `.env`,
QR, autostart) seguindo os passos abaixo.

> 🔒 **Aviso sobre o WhatsApp Web:** ao logar a sessão de um IP/localização nova
> (o VPS fica em Boston-EUA), o WhatsApp pode pedir reconfirmação ou sinalizar
> atividade. Recomendado: reservar um número dedicado ao bot e escanear o QR com
> calma na primeira vez. Se possível, use um número já "aquecido".

---

## ✅ Configuração real validada no VPS (RESUMO DEFINITIVO)

> Esta seção reflete **exatamente o que foi testado e funcionou** em produção
> no VPS. Se houver divergência com as etapas detalhadas abaixo, **vale isto aqui.**

**Decisões-chave descobertas durante a migração:**

1. **Rodar com tela virtual (Xvfb), não headless puro.** O EVO (Angular) é
   instável em headless. Instale `xvfb` e rode tudo via `xvfb-run`. No `.env`:
   **`HEADLESS=false`**.
2. **Domínio do EVO:** o login ocorre em `evo5` e o app redireciona para
   `evo-abc-sec.w12app.com.br` (onde vive o `authToken`). O código agora
   **captura esse domínio automaticamente** — só garanta `EVO_URL=https://evo5.w12app.com.br`.
3. **Scheduler 24/7:** gerenciado pelo **PM2** via o wrapper **`scheduler-vps.sh`**
   (que já embrulha em `xvfb-run`).

**Sequência que funcionou (resumo):**
```bash
# 1. Sistema
timedatectl set-timezone America/Sao_Paulo
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs build-essential python3
apt install -y xvfb <libs-do-chromium>          # ver Etapa 3

# 2. Código + deps
cd ~/SF-Chat_Experimental-Mensagens/Experimental && npm install

# 3. .env  (EVO_URL=evo5, HEADLESS=false)  — ver Etapa 4

# 4. Login WhatsApp (QR no terminal)
xvfb-run -a node src/run-now.js whatsapp

# 5. Testes
xvfb-run -a node src/run-now.js scrape
xvfb-run -a node src/run-now.js whatsapp 5562XXXXXXXXX 08:00 Teste

# 6. 24/7 com PM2 + autostart
npm install -g pm2
pm2 start ./scheduler-vps.sh --name slimfit-exp --interpreter bash --time
pm2 save && pm2 startup systemd -u root --hp /root   # rode a linha que ele imprimir
```

**Operação do dia a dia:**
```bash
pm2 status                       # ver se está online
pm2 logs slimfit-exp             # logs ao vivo
pm2 restart slimfit-exp          # reiniciar
# atualizar código do GitHub:
cd ~/SF-Chat_Experimental-Mensagens && git pull origin claude/slimfit-official-repo-q71zdd
cd Experimental && npm install && pm2 restart slimfit-exp
```

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
`.gitignore`). O jeito mais simples é **copiar o modelo `.env.example`** (que já
vem no repositório, com todos os campos comentados e os `[POR UNIDADE]`
destacados) e preencher:

```bash
cd ~/SF-Chat_Experimental-Mensagens/Experimental
cp .env.example .env
nano .env        # preencha; salve com Ctrl+O, Enter, Ctrl+X
```

Campos essenciais:

```dotenv
# ─── Identidade da unidade ─────────────────────────────────
STUDIO_NOME=Studio Slimfit Setor Bueno
# mapa professora->audio (JSON). Ex.: {"taynara":"A-Tay-Pós"}
AUDIO_MAP={"taynara":"A-Tay-Pós","luiza":"A-Luiza-Pós"}

# ─── EVO (sistema de gestão) ───────────────────────────────
# Use o evo5: o login ocorre nele e o domínio seguro é capturado sozinho.
EVO_URL=https://evo5.w12app.com.br
EVO_EMAIL=seu_email@gmail.com
EVO_PASSWORD=sua_senha
# troque o número da filial no caminho pelo da unidade:
EVO_EXPERIMENTAL_PATH=#/app/slimfit/15/gerencial/aula-experimental

# ─── Navegador ─────────────────────────────────────────────
# false + Xvfb: o EVO (Angular) é instável em headless puro. Ver o
# "RESUMO DEFINITIVO" no topo — no VPS rodamos via xvfb-run.
HEADLESS=false
# (Opcional) usar Chromium do sistema em vez do do Puppeteer:
# CHROMIUM_PATH=/usr/bin/chromium-browser

# ─── Grupo / planilha / alertas ────────────────────────────
GRUPO_EQUIPE=Equipe SlimFit
# GOOGLE_SA_KEY=./google-sa.json   (planilha compartilhada c/ a conta de serviço)
SHEETS_ID=
SHEETS_ABA=
NTFY_TOPIC=slimfit-alertas-unidade

# ─── Integração com o formulário na nuvem (opcional) ───────
FORM_CLOUD_URL=
FORM_OUTBOX_TOKEN=     # o MESMO valor no .env da VPS e na Render
```

Salve no nano: `Ctrl+O`, `Enter`, `Ctrl+X`.

> ⚠️ **`HEADLESS`:** a configuração validada em produção usa **`HEADLESS=false`**
> com **Xvfb** (tela virtual), porque o EVO trava em headless puro. Veja o
> "✅ Configuração real validada" no topo — é ela que vale.
> Preencha só o que a unidade usa; para a confirmação básica bastam
> `STUDIO_NOME`, `EVO_URL`, `EVO_EMAIL`, `EVO_PASSWORD` e `HEADLESS=false`.

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

## 🧩 Etapa 6 — Camada de navegador para Linux (JÁ IMPLEMENTADA ✅)

**Esta adaptação já está no código** — não precisa editar nada. O
`src/whatsapp-sender.js` agora é **multiplataforma**:

- **No Windows:** continua conectando ao **Microsoft Edge** exatamente como antes
  (comportamento 100% preservado).
- **No Linux (VPS):** detecta `process.platform === 'linux'` e lança o
  **Chromium do próprio Puppeteer em modo headless**, com perfil dedicado em
  `whatsapp-chrome-data/` e as flags de servidor (`--no-sandbox`,
  `--disable-dev-shm-usage`, etc.). Nada do fluxo do Edge (`taskkill`,
  `edge://version`, verificação de perfil) roda no Linux.
- **QR de login:** no Linux o QR é impresso **no terminal em ASCII** (via
  `qrcode-terminal`) e também salvo como `whatsapp-qr.png` (fallback para baixar
  via `scp`). Assim dá para escanear pelo SSH.
- **`keep-awake.js`:** vira um *no-op* fora do Windows (o VPS não suspende).

O que você controla pelo `.env` (Etapa 4):

| Variável | Efeito |
|----------|--------|
| `HEADLESS=true` | Chromium sem janela (padrão e obrigatório no VPS) |
| `WA_PROFILE_DIR` | (opcional) pasta da sessão do WhatsApp — padrão: `whatsapp-chrome-data/` |
| `CHROMIUM_PATH` | (opcional) usar um Chromium do sistema em vez do do Puppeteer |

> **Opcional — Chromium do sistema:** se preferir não usar o Chromium que o
> Puppeteer baixa, instale um e aponte o `.env`:
> ```bash
> apt install -y chromium-browser
> which chromium-browser            # ex.: /usr/bin/chromium-browser
> ```
> `.env`: `CHROMIUM_PATH=/usr/bin/chromium-browser`

> ⚠️ **Nota:** outros scripts auxiliares que também abrem o Edge
> (`enviar_confirmacoes.js`, `instagram-seguidores.js`, etc.) ainda são
> Windows-only. O fluxo principal de **confirmação de aulas experimentais**
> (scheduler → `whatsapp-sender.js`) já roda no Linux. Os demais serão
> adaptados sob demanda, quando forem necessários no VPS.

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
| Aniversariantes do mês (grupo) | `30 5 28 * *` | 05:30 dia 28 |
| Ausentes há 10+ dias (grupo) | `10 6 * * 1` | 06:10 segunda |
| Presentes de tempo de casa (grupo) | `45 6 * * 1` | 06:45 segunda |
| Instagram (boas-vindas) | `0 7 * * *` | 07:00 diário |
| Aniversariantes (parabéns nos grupos) | `0 8 * * *` | 08:00 diário |
| Confirmação (hoje) | `30 8 * * 1-6` | 08:30 seg–sáb |
| Follow-up pós-aula — manhã | `30 10 * * 1-6` | 10:30 seg–sáb |
| Faltas / no-show — manhã | `30 11 * * 1-6` | 11:30 seg–sáb |
| Planilha de alunas & aniversários | `0 14 * * *` | 14:00 diário |
| Renovação de contratos | `30 14 * * *` | 14:30 diário |
| Confirmação (amanhã) | `30 15 * * 0-5` | 15:30 dom–sex |
| Follow-up pós-aula — tarde | `0 16 * * 1-6` | 16:00 seg–sáb |
| Resumo da semana (grupo) | `30 16 * * 5` | 16:30 sexta |
| Faltas / no-show — tarde/noite | `30 19 * * 1-6` | 19:30 seg–sáb |
| Resumo do dia (grupo) | `45 19 * * *` | 19:45 diário |

> Reinício automático do WhatsApp: **03:00** todos os dias (mantém a conexão saudável).

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
- [x] **Navegador multiplataforma** (Etapa 6) — já implementado no código
- [ ] Escanear QR do WhatsApp (Etapa 7)
- [ ] Testes `scrape` / `morning` (Etapa 8)
- [ ] PM2 + autostart (Etapa 9)
- [ ] Verificação final (Etapa 10)
- [ ] ChatBot depois (Etapa 11)

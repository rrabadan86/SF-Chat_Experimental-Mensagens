# Onboarding de um novo Studio (VPS separado)

Modelo: **uma instância por studio**. Cada studio roda numa VPS própria, com o
seu EVO, seus 2 WhatsApp, seu formulário e seus dados — totalmente isolado do
Setor Bueno. Você **não mexe no código**: só troca configuração (`.env`) e lê os
QRs dos WhatsApp do novo studio.

Tempo estimado por studio: **~30–40 min** (fora a espera de propagação de DNS).

---

## Visão geral (o que precisa existir por studio)

| Recurso | De onde vem | Observação |
|---|---|---|
| VPS (Ubuntu/Debian) | contrata um novo | 1 vCPU / 2 GB já roda bem |
| Node 18+, npm, pm2, tsx, Chromium | instalados no VPS | pré-requisitos |
| EVO (DNS + Secret Key / token) | do studio novo | `EVO_DNS`, `EVO_TOKEN` |
| Chave da IA (Anthropic) | sua ou do studio | `ANTHROPIC_API_KEY` (tem custo por conversa) |
| 2 números de WhatsApp | do studio novo | leem o **QR** no primeiro boot |
| Formulário (deploy na Render) | um novo deploy | URL + tokens próprios |
| Domínio/subdomínio do painel | seu DNS (ex.: DuckDNS) | HTTPS via Caddy |

---

## Passo a passo

### 1) Clonar o repositório
Num VPS Debian/Ubuntu novo (o script instala o resto):
```bash
git clone https://github.com/rrabadan86/SF-Chat_Experimental-Mensagens.git
cd SF-Chat_Experimental-Mensagens/Experimental
```

### 2) Preparar tudo (instala sistema + deps + monta os `.env`)
```bash
bash setup-novo-studio.sh --slug lagosul --studio "Studio SlimFit Lago Sul" --install-deps
```
O `--install-deps` instala **Node 20, git, Chromium, python3-venv, pm2 e tsx**;
depois o script instala as dependências do projeto (Node + Python num venv), cria
a pasta de dados (`SOFIA_DIR`, fora do repo) e gera **`Experimental/.env`** e
**`ChatBot/.env`** já com **segredos aleatórios**. Anote a **senha do painel**
que ele imprime.

> Sem `--install-deps`, o script assume que Node/pm2/tsx/Chromium já existem.
> Ele **nunca sobrescreve** um `.env` que já exista.

### 3) Preencher os campos `[POR STUDIO]`
Edite os dois `.env` (o script diz exatamente quais campos):

- **`Experimental/.env`** → `EVO_DNS`, `EVO_TOKEN`, `FORM_CLOUD_URL`, `ZEE_STUDIO_PHONE`.
- **`ChatBot/.env`** → `ANTHROPIC_API_KEY`, `SOFIA_BOOK_URL` (o form do studio).
- **Confira que `SOFIA_DIR` é IGUAL nos dois arquivos.**

Modelos completos e comentados: `Experimental/.env.example` e `ChatBot/.env.example`.

### 4) Descobrir os ids da aula no EVO (opcional)
Com o EVO já preenchido no `.env`:
```bash
bash setup-novo-studio.sh --slug lagosul --evo-ids
```
Mostra os serviços/atividades de aula experimental com seus **ids** — copie para
`EVO_SERVICE_ID` / `EVO_ACTIVITY_ID` no `.env` (ou use os nomes em `EVO_SERVICE` /
`EVO_ACTIVITY`).

### 5) Formulário (Render)
Faça um novo deploy do repositório do formulário para este studio e configure,
no ambiente da Render, **os mesmos tokens** que estão nos `.env` do VPS:

- `FORM_SLOTS_TOKEN` = igual ao do `Experimental/.env` (push da grade).
- `SOFIA_TOKEN` = igual ao do `ChatBot/.env` (agendamento pela SoFIA).
- O EVO do formulário aponta para o EVO **do novo studio**.

### 6) Subir tudo — com HTTPS automático
```bash
bash setup-novo-studio.sh --slug lagosul --start --domain painel-lagosul.seu-dominio
pm2 startup    # rode a linha que ele imprimir (sobe sozinho após reboot)
```
Sobem três processos (**`lagosul-painel`**, **`lagosul-exp`**, **`lagosul-sofia`**)
e o `--domain` gera o bloco do Caddy, liga no `/etc/caddy/Caddyfile` e recarrega
(HTTPS automático). **Aponte o DNS** desse subdomínio para o IP do VPS — o Caddy
emite o certificado sozinho. (Sem `--domain`, o painel fica em `localhost:8080`
e você liga o HTTPS depois.)

### 7) Ler os QRs dos 2 WhatsApp
```bash
pm2 logs lagosul-exp     # QR do WhatsApp do robô (confirmações/follow-up)
pm2 logs lagosul-sofia   # QR do WhatsApp da SoFIA (atendimento)
```
Escaneie cada QR com o celular do número correspondente. As sessões ficam
salvas (não precisa repetir).

### 8) Ajustes finos no painel
Entre no painel (usuário `admin` + a senha gerada) e ajuste, sem tocar em código:
o **roteiro da SoFIA**, **preços/grade** (imagens), **mensagens** de confirmação
e follow-up, **limite de experimentais por turma**, e crie os **usuários** do
studio com as telas que cada um vê.

---

## Comandos úteis por studio
```bash
pm2 status                          # ver os 3 processos
pm2 logs lagosul-sofia --lines 100  # logs da SoFIA
pm2 restart lagosul-painel          # reiniciar o painel
cd ~/SF-Chat_Experimental-Mensagens && git pull origin main   # atualizar
```

---

## O que NÃO fazer
- **Não** copie a pasta `.wwebjs_auth` de um studio para outro — cada número lê
  o próprio QR.
- **Não** reutilize o mesmo `SOFIA_DIR`, `FORM_SLOTS_TOKEN` ou `SOFIA_TOKEN`
  entre studios.
- **Não** suba nenhum `.env` para o Git (já estão no `.gitignore`).

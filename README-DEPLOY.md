# Deploy & Atualização — Automação SlimFit

Guia prático para **atualizar uma unidade existente** e para os detalhes que os guias
de instalação do zero ainda não cobriam (a página **/grade** e o **TKM/faturamento**).

- **Instalar uma unidade nova do zero:** seção **"0. Instalar uma unidade nova"** abaixo
  (instalador `setup-novo-studio.sh --tudo`). Guias antigos: `docs/GUIA-INSTALACAO-FRANQUIA.md`.
- Este arquivo foca em: **instalar unidade nova**, **atualizar versão**, **módulo /grade**,
  **`GRADE_FIXAS_CRON`** e **cheat-sheet por unidade**.

---

## 0. Instalar uma unidade nova (do zero) — `setup-novo-studio.sh`

Um comando (`--tudo`) instala o sistema, clona o formulário, cria os `.env`, sobe os
**4 processos** (`<slug>-painel/exp/sofia/form`) e **configura o Caddy (HTTPS) sozinho**.
O **único** passo manual é apontar o **DNS**.

**Antes de começar:** VPS Ubuntu/Debian com **portas 80/443 abertas**, subdomínio no
DuckDNS, dados do EVO (`tenant`, `branch`, `DNS`, `token`, `email`, `senha`) e a **chave
da Anthropic**. ⚠️ Nunca use `< >` nos valores — são redirecionamento no shell
(`--evo-dns slimfit`, nunca `--evo-dns <slimfit>`).

**1. Clonar:**
```bash
git clone https://github.com/rrabadan86/SF-Chat_Experimental-Mensagens.git
cd SF-Chat_Experimental-Mensagens/Experimental
```

**2. Instalar (sem os ids do EVO — entram no passo 5):**
```bash
bash setup-novo-studio.sh --tudo \
     --slug <slug> \
     --studio "Studio SlimFit <Nome>" \
     --install-deps \
     --evo-tenant <tenant> --evo-branch <branch> \
     --port 8080 \
     --domain painelsf<slug>.duckdns.org \
     --evo-email <email-do-robô>
```
Os segredos que faltarem (`EVO_DNS`, `EVO_TOKEN`, `EVO_PASSWORD`, `ANTHROPIC_API_KEY`,
`GRUPO_EQUIPE`) ele **pergunta** no terminal (senha/chave ocultas). Ao fim, instala e
configura o **Caddy** e **imprime o IP do VPS**.

**3. Apontar o DNS:** no DuckDNS, `painelsf<slug>` → o IP impresso (ou `curl -s -4 ifconfig.me`).
Em ~1 min o `https://painelsf<slug>.duckdns.org` abre com cadeado (certificado automático).
Se ficar "não seguro" por mais de uns minutos: confira a **porta 80** aberta e
`sudo journalctl -u caddy -n 50 --no-pager | grep -iE "certificate|challenge|error"`.

**4. Conectar os WhatsApp + persistir no reboot:**
```bash
pm2 logs <slug>-exp     # QR do robô
pm2 logs <slug>-sofia   # QR da SoFIA (ou pela aba WhatsApp do painel)
pm2 startup             # rode a linha impressa — sobe tudo após reboot
```

**5. IDs do EVO da aula experimental (Opção B — descobrir e preencher depois):**
```bash
bash setup-novo-studio.sh --slug <slug> --evo-ids
```
Lista **atividades** (idActivity → nome) e **serviços** (idService → nome). Ache a
atividade **SlimFit** e o serviço **"Aula experimental"** e grave os ids — no `nano` —
**nos DOIS .env** (o formulário é quem agenda):
- `~/SF-Chat_Experimental-Mensagens/Experimental/.env` → `EVO_ACTIVITY_ID=` / `EVO_SERVICE_ID=`
- `/root/sf-form-<slug>/.env` → idem; depois `pm2 restart <slug>-form`

> Não é urgente: a experimental só usa esses ids **quando alguém agenda**.

**6. Trocar os textos padrão (são do Bueno!):** no painel → **SoFIA → Configuração**
(roteiro, endereço, promoção, professoras) e **WhatsApp → Configuração** (mensagens).

**2 lojas no mesmo VPS:** dois clones em pastas diferentes, cada um com `--slug` e
`--port` próprios (ex.: 8080 e 8081). O Caddy acrescenta o 2º bloco sozinho.

---

## 1. Atualizar uma unidade para a última versão (deploy)

Tudo roda na branch **`main`**. Para puxar a versão nova numa unidade já instalada:

```bash
cd <pasta-do-repo-da-unidade>            # ex.: /root/SF-Chat_Experimental-Mensagens
git fetch origin main && git reset --hard origin/main
pm2 restart <unidade>-exp <unidade>-painel
```

- **`<unidade>-exp`** roda o `scheduler.js` (os crons, incluindo a grade das 05:40).
- **`<unidade>-painel`** serve as páginas (inclusive a `/grade`).
- Reinicie **os dois** — se só reiniciar o painel, os crons continuam no código antigo.

> `git reset --hard` descarta alterações locais não commitadas. Como a unidade só
> **consome** a main (não desenvolve), isso é o esperado. Os dados ficam fora do git
> (em `data/` e no `.env`), então não são afetados.

Mudanças que mexem em **dados da /grade** (presença, TKM, faturamento) só aparecem
depois de **regenerar o snapshot**: use um dos botões da página (abaixo), ou espere o
cron das 05:40. Mudanças só de **exibição** (tooltips, rótulos) aparecem no restart.

**Dois botões de atualização** (economia de chamadas ao EVO):
- **🔄 Atualizar grade** (leve): refaz a grade da semana (presença/ocupação) e
  **reaproveita** o TKM/faturamento e as matrículas em cache (`data/grade-financeiro.json`
  e `data/grade-enroll.json`). Consulta o EVO só para a presença das turmas e alunas novas.
- **💰 Atualizar tudo**: recalcula também o TKM/faturamento e relê todas as matrículas
  no EVO. Mais demorado — use quando quiser forçar os números financeiros na hora.
- O **cron das 05:40 roda completo** todo dia (atualiza os dois caches), então o botão
  leve fica fiel o dia todo. O rodapé da página mostra **"TKM/faturamento de &lt;hora&gt;"**.

---

## 2. A página /grade (requisitos do módulo Python)

A `/grade` é montada por um script Python (`Experimental/src/agendamento_evo/run_grade_fixas.py`)
que lê o EVO e grava um snapshot (`Experimental/src/data/grade-fixas.json`) que o painel exibe.

### 2.1 Credenciais EVO (API de integração)

A grade usa a **API de integração do EVO** (Basic auth), que é **diferente** do login do
scraper. No **`Experimental/.env`** da unidade precisam existir:

```ini
EVO_DNS=<dns da conta EVO>
EVO_TOKEN=<secret key da integração (sk-... / chave de integração)>
# opcionais:
EVO_BRANCH_ID=        # só em chave multi-filial
EVO_ACTIVITY=         # nome da atividade (ex.: "SLIMFIT B") — ou EVO_ACTIVITY_ID
EVO_ACTIVITY_ID=
```

> São as mesmas credenciais que o **formulário** já usa. Se o formulário da unidade
> funciona, a grade usa a mesma `EVO_DNS`/`EVO_TOKEN`.

### 2.2 Ambiente Python (.venv)

O painel **e** o scheduler usam o `.venv` de `agendamento_evo` se ele existir (senão caem
no `python3` do sistema). Crie-o uma vez por unidade:

```bash
cd <pasta-do-repo>/Experimental/src/agendamento_evo
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Teste (deve imprimir o resumo, sem erro):

```bash
.venv/bin/python run_grade_fixas.py --print
```

Saída esperada (exemplo): turmas, alunas ativas (Active + trancadas, sem VIP), TKM médio,
faturamento do mês, e o caminho do JSON gravado.

### 2.3 Atualização automática (cron 05:40)

Com o `<unidade>-exp` rodando, a grade se atualiza **sozinha todo dia às 05:40**
(horário de Brasília), em janela calma do EVO. No boot do processo o log mostra:

```
📅 Job GRADE DE FIXAS agendado: 40 5 * * *
```

Primeira geração é mais lenta (lê o contrato de cada aluna ativa no EVO — alguns minutos).

---

## 3. `GRADE_FIXAS_CRON` — escalonar duas lojas no mesmo servidor

Quando **duas unidades compartilham o mesmo servidor** (ex.: Lago Sul 1 e 2), dá pra
evitar que a atualização das duas rode no mesmo instante. O horário da grade é
configurável por unidade no `.env` (5 campos de cron); sem a variável, fica em `40 5 * * *`.

Exemplo — deixar a 2ª loja 7 min depois (05:47):

```bash
echo 'GRADE_FIXAS_CRON=47 5 * * *' >> <pasta-da-2a-loja>/Experimental/.env
pm2 restart <2a-loja>-exp
```

Confirme no log do `-exp`: `📅 Job GRADE DE FIXAS agendado: 47 5 * * *`.

> O limite do EVO (40 req/min) é **por conta EVO**. Se as duas lojas usam contas
> diferentes, não há concorrência; se compartilham a conta, escalonar evita `429`.

---

## 4. Cheat-sheet por unidade

> Os nomes dos processos variam um pouco por unidade (herança histórica). **Confirme
> sempre com `pm2 ls`** antes de reiniciar.

| Unidade      | Servidor            | Pasta do repo                      | Pasta do formulário            | Processos principais                                   |
|--------------|---------------------|------------------------------------|--------------------------------|--------------------------------------------------------|
| **Bueno**    | VPS próprio         | `/root/SF-Chat_Experimental-Mensagens` | `/root/sf-form-real` ⚠️        | `slimfit-exp`, `slimfit-painel`, `slimfit-form`, `sofia-listener` |
| **Park Sul** | VPS próprio         | `/root/SF-Chat_Experimental-Mensagens` | `/root/sf-form-parksul` ⚠️     | `parksul-exp`, `parksul-painel`, `parksul-form`, `parksul-sofia`  |
| **Lago Sul 1** | compartilhado     | `/root/SF-Chat_Experimental-Mensagens` | (roda do próprio repo)         | `lagosul1-exp`, `lagosul1-painel`, `lagosul1-form`, `lagosul1-sofia` |
| **Lago Sul 2** | (mesmo do LS1)    | `/root/slimfit-lagosul2`           | (roda do próprio repo)         | `lagosul2-exp`, `lagosul2-painel`, `lagosul2-form`, `lagosul2-sofia` |
| **Guará**    | VPS próprio         | `/root/SF-Chat_Experimental-Mensagens` | `/root/sf-form-guara`          | `guara-exp`, `guara-painel`, `guara-form`, `guara-sofia` |

- `-exp` = scheduler (crons). `-painel` = páginas. `-form` = formulário. `-sofia` = SoFIA (WhatsApp).
- A SoFIA do **Bueno** se chama `sofia-listener`; nas demais é `<unidade>-sofia`.
- ⚠️ **Bueno e Park Sul** rodam o formulário de um **clone separado** do repo
  `sf-formularioexperimental` (`/root/sf-form-<unidade>`) — para atualizar o form, dê o
  `git` **naquela pasta** também (`cd /root/sf-form-<unidade> && git fetch origin main && git reset --hard FETCH_HEAD && pm2 restart <unidade>-form`). **Lago Sul** roda o form do próprio repo principal. Instalações novas (via `--tudo`) usam o clone separado `/root/sf-form-<slug>`.
- **Lago Sul 2** roda com `GRADE_FIXAS_CRON=47 5 * * *` (05:47) para não concorrer com o Lago Sul 1 (05:40).

---

## 5. Sobreviver a reboot do servidor

Depois de subir/alterar processos, persista a lista do PM2 (lição do 502 pós-reboot):

```bash
pm2 save
pm2 startup        # rode a linha que ele imprimir (só na 1ª vez por servidor)
```

---

## 6. Troubleshooting rápido

| Sintoma | Provável causa | O que fazer |
|---|---|---|
| Atualizar manual funciona, mas o automático (05:40) não | o `-exp` no código antigo, ou sem `.venv` | reiniciar o `-exp`; conferir `.venv` em `agendamento_evo` |
| `/grade` com presença/TKM em "—" | snapshot antigo (gerado por versão anterior) | clicar 🔄 Atualizar, ou esperar as 05:40 |
| `run_grade_fixas.py` erro `ModuleNotFoundError: requests` | `.venv` não criado / deps faltando | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| TKM/faturamento vazios ou com erro de EVO | `EVO_DNS`/`EVO_TOKEN` ausentes/errados no `Experimental/.env` | conferir as credenciais de integração |
| Geração passa de ~8 min / toma `429` | muitas chamadas simultâneas ao EVO | escalonar com `GRADE_FIXAS_CRON`; o cliente já reencaixa 429 com retry |
| Ver o horário agendado da grade | — | `pm2 logs <unidade>-exp --lines 150 --nostream \| grep -i "grade de fixas"` |

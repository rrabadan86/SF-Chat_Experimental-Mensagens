# Planilha de Alunas & Aniversários — Guia de Instalação

O robô lê no EVO a segmentação **"Aniversariantes"** (status Ativos, mês = **Todos**) e
preenche uma planilha do Google com **todas as alunas ativas + a data de aniversário**,
sem nunca desalinhar a sua coluna de controle (ex.: `2026` com o "SIM" de presente entregue).

## Como o alinhamento é garantido (anti-drift)

- Cada aluna é ancorada pelo **ID da matrícula do EVO** (coluna **A**).
- Linhas existentes **nunca mudam de posição nem são apagadas** — só atualizadas no lugar.
- Aluna **nova** entra **no final** da planilha.
- Aluna que **saiu / não renovou** vira **`Ativa? = Não`** (a linha permanece; o seu "SIM" não some).
- O robô escreve **apenas as colunas A a E**. Da coluna **F** em diante é **sua** — ele nunca toca.

| A | B | C | D | E | F (sua) |
|---|---|---|---|---|---|
| ID EVO | Nome | Aniversário (dd/mm) | Ativa? | Atualizado em | 2026 (SIM/…) |

> Dica: se um dia você **ordenar** a planilha, selecione **todas as colunas juntas** (incluindo a F).
> Melhor ainda: use **Filtros** em vez de ordenar. Assim nada desalinha.

---

## Instalação (uma vez só)

### 1. Instalar a biblioteca do Google
Na pasta do projeto, rode:
```
npm install googleapis
```

### 2. Criar a conta de serviço do Google (gratuito)
1. Acesse https://console.cloud.google.com/ e crie (ou selecione) um projeto.
2. Menu **APIs e serviços → Biblioteca** → busque **Google Sheets API** → **Ativar**.
3. Menu **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**.
   - Dê um nome (ex.: `slimfit-bot`) e conclua.
4. Abra a conta de serviço criada → aba **Chaves → Adicionar chave → Criar nova chave → JSON**.
   - Vai baixar um arquivo `.json`. **Guarde-o** em `C:\SlimfitBot\service-account.json`.
5. Copie o **e-mail da conta de serviço** (algo como
   `slimfit-bot@seu-projeto.iam.gserviceaccount.com`).

### 3. Compartilhar a planilha com a conta de serviço
1. Abra sua planilha do Google.
2. Botão **Compartilhar** → cole o **e-mail da conta de serviço** → permissão **Editor** → Enviar.

### 4. Configurar o `.env` do projeto
Adicione (ajuste os valores):
```
SHEETS_ID=1vTNQSEh9bT23_HhyKMdysM3tzrWc14y3xFnjtgVK95U
GOOGLE_SA_KEY=C:\SlimfitBot\service-account.json
SHEETS_ABA=Aniversarios
```
- `SHEETS_ID` é o trecho da URL entre `/d/` e `/edit`.
- `SHEETS_ABA` é o nome da aba/página que o robô usa (ele cria se não existir).

---

## Testar

**Só leitura (não escreve na planilha):**
```
node src/planilha-aniversarios.js --dry
```
Mostra a prévia das alunas lidas do EVO.

**Rodar de verdade (lê o EVO e atualiza a planilha):**
```
node src/planilha-aniversarios.js
```

---

## Agendamento automático

Já está agendado no Watchdog para rodar **toda segunda-feira às 06:30**.
Para mudar o horário/frequência, edite `src/config.js`:
```
planilhaAniv: '30 6 * * 1',   // min hora * * diaDaSemana  (1 = segunda)
```
Depois **reinicie o Watchdog**.

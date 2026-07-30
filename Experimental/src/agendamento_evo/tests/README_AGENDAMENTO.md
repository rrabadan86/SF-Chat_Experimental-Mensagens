# Agendamento de aula experimental no EVO

Integração que faz, na API do **EVO** (W12 / abcevo), a partir dos dados de uma aluna
(nome, e-mail, telefone e horário escolhido), espelhando o processo manual do Studio:

1. **Cadastro** da oportunidade (prospect) — idempotente — `POST /api/v1/prospects`
2. **Venda** do serviço "Aula Experimental" — `POST /api/v1/sales`
3. **Agendamento** (matrícula na turma do horário) — `POST /api/v1/activities/schedule/enroll`

A checagem de vaga usa a **capacidade da turma** (`ocupation < capacity`, ex.: 9/9),
sem depender do flag `allowExperimentalClass`. Se a turma escolhida estiver cheia (ou
não houver turma naquele horário), a integração avisa o WhatsApp do Studio com
horários alternativos (ver "Turma lotada").

## Instalação

```bash
pip install -r requirements.txt          # requests + python-dotenv já bastam para isto
cp env.example .env                       # e preencha as variáveis EVO_*
```

## Configuração (mínima)

No `.env` (ou como secrets no GitHub Actions):

```
EVO_DNS=seu-dns-da-academia        # usuário do Basic Auth
EVO_TOKEN=sua-secret-key           # senha do Basic Auth
EVO_BRANCH_ID=                     # só em chave multi-filial
EVO_ACTIVITY=Pilates               # nome da atividade da aula experimental
EVO_SERVICE=Aula Experimental      # nome do serviço vendido para liberar a aula
```

> Descubra os nomes/ids certos com os comandos `services` e `slots` abaixo.

## Uso

Descobrir o serviço de aula experimental e os horários disponíveis:

```bash
python run_agendamento.py services
python run_agendamento.py slots --date 2026-07-10
```

Agendar (modo pronto, sem depender do ZEE):

```bash
python run_agendamento.py book \
  --name "Maria Silva" --email maria@ex.com --phone 62999998888 \
  --when "2026-07-10 19:00" --activity "Pilates" --service "Aula Experimental"
```

Se `EVO_ACTIVITY` / `EVO_SERVICE` estiverem no `.env`, pode omitir `--activity/--service`.

## Horário em linguagem natural

A aluna costuma dizer o **dia da semana + hora** ("segunda às 8h15"), raramente uma data.
O `--when` (e o horário vindo do ZEE) entende português e converte para a data real:

| A aluna diz | Vira (ex.: hoje = sex 03/07) |
|---|---|
| `segunda às 8h15` | próxima segunda 08:15 → 2026-07-06 08:15 |
| `amanhã 07:00` | 2026-07-04 07:00 |
| `quinta 19h30` | próxima quinta 19:30 |
| `dia 17 às 8h` | 2026-07-17 08:00 |

Regra: dia da semana → **próxima ocorrência** (se for hoje e a hora já passou, vai pra semana
seguinte). Sempre precisa ter **hora** (sem hora não dá pra agendar). Teste com:
`python -c "from evo_agendamento.util import parse_when; print(parse_when('segunda às 8h15'))"`

## Turma lotada (limite de vagas)

Cada turma tem um limite (ex.: 9). Antes de agendar, a integração consulta as vagas
(`capacity`/`ocupation`/`experimentalClassSlots`) e, se o horário escolhido estiver cheio
— ou se o EVO recusar por lotação no momento do agendamento — ela **avisa o WhatsApp do
Studio** para a recepção dar andamento manual:

```
⚠️ Aula experimental SEM VAGA
Aluna: Maria da Silva (62999998888)
Horário tentado: 2026-07-10 19:00
Ação: entrar em contato e sugerir outro horário.
Horários com vaga: 2026-07-11 19:00 (2 vaga(s)); ...
```

Configure o número do Studio em `ZEE_STUDIO_PHONE` (ou `--studio-phone`). O envio usa
`POST /send-message` do ZEE, então precisa de `ZEE_TOKEN` válido. A saída do comando vira
`{"status":"turma_lotada","studioNotified":true,"alternatives":[...]}` (exit code 3).
Se `ZEE_STUDIO_PHONE`/`ZEE_TOKEN` não estiverem configurados, a lista de alternativas
ainda é retornada no JSON (para a IA do ZEE reagir), mas nenhum WhatsApp é enviado.

## Instrução do RESUMO no ZEE (obrigatória p/ o automático)

O contato do ZEE traz só telefone + nome do WhatsApp. Nome completo, e-mail e horário a
aluna fala durante a conversa. Para o job pegar isso de forma estruturada, configure o
**resumo** (`get_summary`) do ZEE para devolver este JSON (cole na instrução do resumo):

```
Seu objetivo é extrair da conversa os dados para agendar a aula experimental.
Traga tudo exatamente como a aluna informou.

- "nome_completo": o nome completo que a aluna digitou (ex.: "Bruna Souza de Melo").
  NUNCA use o nome do WhatsApp; use o nome informado por ela.
- "email": o e-mail informado, em minúsculas, sem espaços.
- "dia": o dia escolhido, como ela disse:
    - dia da semana -> nome por extenso (ex.: "segunda-feira");
    - dia do mês -> "dia" + número (ex.: "dia 17").
- "hora": o horário no formato HH:mm com dois dígitos (ex.: "16:15", "08:15").

Se alguma informação não foi dita, deixe o campo como "".
O resultado final deve ser APENAS o JSON abaixo, sem texto adicional, sem
explicações e sem marcação de código (não use crases nem "json").

{
"nome_completo": "",
"email": "",
"dia": "",
"hora": "",
"resumo": ""
}
```

O código lê esse JSON (`nome_completo`, `email`, `dia`+`hora`), converte "segunda-feira 16:15"
na data real e agenda. Se o resumo não vier em JSON, cai no fallback e provavelmente marca
como "faltam dados" (aí a recepção resolve manual).

## Modo automático (job a cada 30 min)

O comando `run` é o job do GitHub Actions: varre as conversas recentes do ZEE, acha quem
tem a tag **"FX 3 - Agendou AE"** (e ainda não tem **"FX 4 - Feito"**), agenda no EVO e marca
a tag "Feito". Idempotente — não reprocessa quem já foi.

```bash
python run_agendamento.py run --hours-back 1          # roda o ciclo
python run_agendamento.py run --dry-run               # só mostra o que faria
```

Fluxo por contato: `GET /threads` (recentes) → `GET /contact` de cada → filtra pela tag →
lê nome/telefone/e-mail/horário → `book_experimental` → marca "Feito". Se a turma lotar,
avisa o Studio e marca "Feito" (pra não re-avisar).

Config das tags no `.env` (já preenchidas no exemplo): `ZEE_TAG_TODO` e `ZEE_TAG_DONE`.

### Agendar um contato específico (teste)
```bash
python run_agendamento.py from-zee --contact-id <uuid> --when "segunda às 8h15"
```

- Nome e telefone vêm estruturados do contato do ZEE.
- **E-mail e horário**: lidos do `metadata` do contato (se a IA do ZEE gravar lá —
  chaves `ZEE_META_EMAIL_KEY` / `ZEE_META_WHEN_KEY`) ou informados via `--email/--when`.
- Pendências para o modo automático ficar 100%:
  1. Confirmar o **esquema de autenticação do ZEE** (`ZEE_AUTH_HEADER` / `ZEE_AUTH_SCHEME`).
  2. Fazer a IA do ZEE **salvar e-mail e horário no metadata** do contato (ou passá-los na chamada).

## Estrutura

```
evo_agendamento/
  config.py        # variáveis de ambiente
  evo_client.py    # cliente EVO (Basic auth) — cadastro, serviços, horários, agendamento
  zee_client.py    # cliente ZEE (contatos, threads, resumo, tags)
  orchestrator.py  # book_experimental(): cadastro + venda + agendamento
  util.py          # datas, telefone, nome, e-mail
run_agendamento.py # CLI (services / slots / book / from-zee)
tests/test_offline.py  # testes sem rede
```

## Testes

```bash
python -m tests.test_offline
```

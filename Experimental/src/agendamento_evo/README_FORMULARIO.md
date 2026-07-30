# Formulário de Aula Experimental (web) — SlimFit

Página web (link para o anúncio) onde a oportunidade preenche os dados, escolhe
um horário com vaga e o sistema **agenda sozinho no EVO** e dispara a confirmação
pelo WhatsApp do Studio.

## Como funciona (visão geral)

```
[Anúncio] → link → [Página no Render (nuvem)]
                        │  GET /api/slots  → mostra 10 dias, só ≤7 alunas dá pra marcar
                        │  POST /api/book  → cadastra + vende + matricula no EVO
                        │                    e enfileira a confirmação (na nuvem)
                        ▼
        [PC do Studio] puxar_confirmacoes.py (a cada 2 min)
                        │  puxa a fila da nuvem → grava no confirmacoes_outbox.jsonl
                        ▼
        [bot Node no PC] enviar_confirmacoes.js → WhatsApp do Studio (8550-8065)
```

- **Regra de vaga:** turma com **≤7** alunas fica disponível; com **8 ou 9** aparece
  na grade, mas marcada como *indisponível* (não deixa marcar). Só no formulário.
- **Janela:** próximos **10 dias** (hoje + 9).
- **Campos:** Nome completo, CPF, Telefone, E-mail, Data de nascimento.
- **Confirmação:** sai pelo **Studio (8550-8065)**, igual às marcações do ZEE.

## Estrutura

```
evo_agendamento/     # o mesmo pacote de sempre (cadastro/venda/matrícula) — reaproveitado
formulario_web/
  app.py             # servidor (Flask): /api/slots, /api/book, /api/outbox/*
  templates/index.html   # a página (formulário + calendário)
pc_bridge/
  puxar_confirmacoes.py  # roda NO PC: puxa a fila da nuvem p/ o outbox local
requirements.txt / Procfile / render.yaml   # deploy no Render
```

---

## Passo 1 — Subir na nuvem (Render, grátis)

1. Crie uma conta em **https://render.com** (pode entrar com o GitHub).
2. Coloque **estes arquivos** num repositório do GitHub (pode ser um repo novo só
   para isso, com tudo na raiz — `requirements.txt`, `Procfile`, `formulario_web/`,
   `evo_agendamento/`).
3. No Render: **New +** → **Web Service** → conecte o repositório.
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn formulario_web.app:app --workers 1 --timeout 120 --bind 0.0.0.0:$PORT`
   - **Plan:** Free
4. Em **Environment** (variáveis), preencha (os mesmos valores do seu `.env`):

   | Variável | Valor |
   |---|---|
   | `EVO_BASE_URL` | `https://evo-integracao-api.w12app.com.br` |
   | `EVO_DNS` | seu DNS |
   | `EVO_TOKEN` | sua secret key |
   | `EVO_BRANCH_ID` | (só se multi-filial) |
   | `EVO_DDI` | `55` |
   | `EVO_ACTIVITY_ID` **ou** `EVO_ACTIVITY` | id/nome da atividade da experimental |
   | `EVO_SERVICE_ID` | `128` |
   | `EVO_PAYMENT` | *(vazio)* |
   | `FORM_DAYS` | `10` |
   | `FORM_MAX_OCUPACAO` | `7` |
   | `FORM_OUTBOX_TOKEN` | invente uma senha forte (guarde — o PC vai usar a mesma) |

5. **Deploy**. No fim o Render te dá um endereço tipo
   `https://slimfit-aula-experimental.onrender.com` — **esse é o link do anúncio**.

> Plano free "hiberna" após ~15 min sem acesso; a 1ª visita seguinte demora uns
> 30–50s pra abrir. Depois fica rápido.

## Passo 2 — Ligar a confirmação no seu PC

O formulário (nuvem) enfileira a confirmação; o seu PC puxa e envia pelo Studio.

1. Copie a pasta `pc_bridge/` para o PC (ex.: dentro de `agendamento_evo`).
2. Crie uma tarefa no **Agendador de Tarefas** rodando a cada **2 minutos**:
   - Programa: `python`
   - Argumento: caminho do `puxar_confirmacoes.py`
   - Variáveis de ambiente (ou edite os padrões no topo do arquivo):
     - `FORM_CLOUD_URL` = o endereço do Render (ex.: `https://slimfit-...onrender.com`)
     - `FORM_OUTBOX_TOKEN` = **a mesma** senha do `FORM_OUTBOX_TOKEN` do Render
     - `STUDIO_OUTBOX_FILE` = caminho do seu `confirmacoes_outbox.jsonl`
3. Pronto: o `enviar_confirmacoes.js` (que você já tem) envia essas confirmações
   pelo WhatsApp do Studio, junto com as do ZEE.

---

## Pontos de atenção

- **CPF e Data de Nascimento:** mando pro EVO nos campos `document` e `birthday`.
  Confira no **primeiro agendamento real** se apareceram certos no cadastro do EVO;
  se o EVO usar outro nome de campo, me avisa que ajusto rapidinho.
- **Fila na nuvem é temporária:** o Render free não guarda arquivos entre reinícios.
  Como o PC puxa a cada 2 min, a janela de risco é mínima. Se quiser 100% à prova de
  falhas, dá pra trocar por um banco (ex.: Supabase free) depois.
- **Segurança:** a chave do EVO fica **só** nas variáveis do Render (nunca na página).

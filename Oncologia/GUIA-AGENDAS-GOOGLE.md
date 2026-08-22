# Como criar as duas agendas no Google

Passo a passo para deixar o agendamento funcionando. São duas partes: uma sua
(desenvolvedor) e uma do médico. **Faça a parte 1 primeiro** — a parte 2 precisa
de um e-mail que só existe depois dela.

Tempo total: cerca de 20 minutos.

---

## Parte 1 — Você, no Google Cloud (~10 min)

Aqui nasce a "conta de serviço": um usuário robô que o sistema usa para escrever
na agenda. Ela não é uma pessoa, não tem caixa de e-mail e só enxerga as agendas
que o médico compartilhar explicitamente com ela.

1. Entre em <https://console.cloud.google.com> e crie um projeto
   — no nosso caso: `agenda-onco`.
2. Menu lateral → **APIs e serviços → Biblioteca**. Procure por
   **Google Calendar API** e clique em **Ativar**.
3. Menu lateral → **APIs e serviços → Credenciais** →
   **Criar credenciais → Conta de serviço**.
   - Nome: `marcacao`
   - Pode pular as duas etapas opcionais de permissão e clicar em **Concluir**.
4. Clique na conta que acabou de aparecer → aba **Chaves** →
   **Adicionar chave → Criar nova chave → JSON**. O arquivo baixa sozinho.
5. Renomeie esse arquivo para `credenciais.json` e coloque em `Oncologia/app/`.
6. Copie o **e-mail da conta de serviço**. No nosso projeto ele é:

   ```
   marcacao@agenda-onco.iam.gserviceaccount.com
   ```

   É esse endereço que o médico vai usar no passo seguinte. Ele não é segredo
   (pode ir por WhatsApp) — quem abre a porta é o arquivo JSON, não ele.

> **O arquivo JSON é uma senha.** Quem tiver ele escreve na agenda do médico.
> Nunca mande por WhatsApp, nunca suba para o Git — o `.gitignore` já bloqueia.

---

## Parte 2 — O médico, no Google Agenda dele (~10 min)

**Precisa ser no computador.** O aplicativo de celular não cria agenda nova nem
mostra o ID — depois de pronto, aí sim tudo funciona pelo celular.

### Criar as duas agendas

1. Abrir <https://calendar.google.com> logado com a conta dele
   (Gmail comum serve; não precisa de Workspace pago).
2. Na coluna da esquerda, ao lado de **Outras agendas**, clicar no **+** →
   **Criar nova agenda**.
3. Preencher:
   - **Nome:** `Consultas — Hospital 1`
   - **Fuso horário:** (GMT-03:00) Brasília
   - **Criar**
4. Repetir para `Consultas — Hospital 2`.

> Não use a agenda principal dele para isso. As consultas ficam em agendas
> próprias, e é justamente essa separação que deixa cada hospital com uma cor
> e permite compartilhar só uma delas com a recepção de cada lugar.

### Compartilhar cada agenda com o sistema

Para **cada uma** das duas agendas:

5. Passar o mouse sobre o nome da agenda → **⋮** → **Configurações e
   compartilhamento**.
6. Descer até **Compartilhar com pessoas ou grupos específicos** →
   **Adicionar pessoas**.
7. Colar o e-mail da conta de serviço:
   `marcacao@agenda-onco.iam.gserviceaccount.com`
8. Em permissão, escolher **Fazer alterações nos eventos**.
   Menos que isso não deixa o sistema marcar; mais que isso não é necessário.
9. **Enviar**. Não aparece convite para aceitar — conta de serviço não tem
   caixa de entrada, o acesso vale na hora.

### Pegar o ID de cada agenda

10. Na mesma tela de configurações, descer até **Integrar agenda**.
11. Copiar o campo **ID da agenda** — parece
    `c_a1b2c3...@group.calendar.google.com`.
12. Mandar os dois IDs para você, dizendo qual é de qual hospital.

### Deixar bom de usar no celular

13. No celular, abrir o app **Google Agenda** → menu **☰** → **Configurações**.
14. Nas duas agendas novas: marcar **Sincronização** e escolher uma **cor**
    diferente para cada hospital.

### Opcional: dar acesso à recepcionista

15. Se ela precisar ver ou mexer na agenda pelo Google também, repetir os
    passos 5 a 9 com o Gmail dela. Permissão sugerida:
    **Ver todos os detalhes do evento** (só leitura) ou
    **Fazer alterações nos eventos** se ela for remarcar pelo Google.
    Para o fluxo de confirmação pelo WhatsApp isso **não é necessário**.

### Opcional: não marcar em cima de compromisso pessoal

16. Se ele quiser que a agenda pessoal também bloqueie horário no formulário,
    repetir os passos 5 a 9 na agenda pessoal dele, mas com permissão
    **Ver apenas disponibilidade (ocultar detalhes)**. O sistema só saberá
    "ocupado das 12h às 13h", sem ver do que se trata.

---

## Parte 3 — Juntar as pontas (você, 2 min)

No arquivo `Oncologia/app/.env`:

```
CAL_H1=cole-aqui-o-id-do-hospital-1@group.calendar.google.com
CAL_H2=cole-aqui-o-id-do-hospital-2@group.calendar.google.com
GOOGLE_APPLICATION_CREDENTIALS=./credenciais.json
CAL_BLOQUEIOS=      # id da agenda pessoal, se ele topou o passo 16
```

Testar:

```bash
cd Oncologia/app
npm install
npm start
```

Abrir <http://localhost:3000> e chegar até a tela de horários. Se aparecerem os
dias e horários, as agendas estão conectadas.

---

## Se der errado

| O que aparece | O que é |
|---|---|
| `Falta a variável CAL_H1 no .env` | Os IDs não foram colados no `.env`. |
| `O Google recusou a consulta a estas agendas` | A agenda não foi compartilhada com a conta de serviço, ou foi compartilhada com permissão de leitura só. Refaça os passos 5 a 9. |
| `Faltou a credencial do Google` | O `credenciais.json` não está no lugar indicado no `.env`. |
| Nenhum horário aparece | Confira em `config/hospitais.json` se os dias da semana batem (0=domingo … 6=sábado) e se a antecedência mínima não está engolindo os próximos dias. |

---

## Por que as agendas são dele, e não suas

Vale explicar isso ao médico — é o tipo de coisa que gera confiança:

- **É dado de paciente.** Nome, telefone e motivo de consulta são dado sensível
  de saúde. Pela LGPD, quem responde por eles é o médico.
- **Não dá para transferir depois.** No Google Calendar, quem cria a agenda é o
  dono, e isso não muda. Se nascer na sua conta, fica na sua conta para sempre.
- **Independência.** Se um dia vocês pararem de trabalhar juntos, ele continua
  com a agenda inteira, e você não fica guardando dado de paciente de ninguém.

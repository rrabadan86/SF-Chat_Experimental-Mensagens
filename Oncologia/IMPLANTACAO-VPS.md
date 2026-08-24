# Subir na VPS

Sim, e é o lugar certo para este sistema. Não é preferência — três coisas
dele não funcionam bem em outro tipo de hospedagem.

## Por que VPS, e não Render/Vercel

**O WhatsApp precisa de processo vivo.** O `whatsapp-web.js` mantém um navegador
logado em memória. Em hospedagem que dorme, hiberna ou reinicia sozinha, a sessão
cai e alguém precisa reescanear o QR. Na VPS, sobe uma vez e fica.

**A configuração do médico é um arquivo em disco.** `dados/config.json` guarda o que
ele cadastrou no painel. Disco efêmero apaga isso a cada deploy — ele perderia os
locais de atendimento sem entender por quê.

**Sem cold start.** O paciente abre o formulário e os horários aparecem. Não há
aquele primeiro acesso de 30 segundos que faz a pessoa achar que quebrou.

Servidor de 1 vCPU e 1 GB dá conta, mas o Chromium do WhatsApp é folgado:
**2 vCPU / 2 GB** é o tamanho confortável. Ubuntu 22.04 ou 24.04.

---

## 1. Preparar a máquina

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# nginx, certificado e utilidades
sudo apt install -y nginx certbot python3-certbot-nginx git

# PM2, que mantém o serviço de pé
sudo npm install -g pm2
```

**Se for usar o WhatsApp pelo `wwebjs`**, as bibliotecas que o navegador precisa:

```bash
# Ubuntu 24.04
sudo apt install -y \
  libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation

# Ubuntu 22.04 (nomes sem o sufixo t64)
sudo apt install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-liberation
```

> O 24.04 renomeou várias dessas bibliotecas com sufixo `t64` (transição para
> `time_t` de 64 bits). Se o apt reclamar de pacote inexistente, é isso — confira
> qual versão do Ubuntu você tem com `lsb_release -a`.

**Não instale o `chromium-browser` do apt.** No 24.04 ele é só um atalho para o
snap, que roda confinado e quebra com o Puppeteer de um jeito difícil de
diagnosticar. O `whatsapp-web.js` traz o Puppeteer, que baixa um Chromium próprio
durante o `npm ci` — testado e na versão certa. As bibliotecas acima são o que
esse Chromium precisa para rodar.

Depois do `npm ci` (passo 2), confirme que ele veio:

```bash
cd ~/agendamento-onco/app
node -e "console.log(require('puppeteer').executablePath())"
```

> Sem essas bibliotecas o WhatsApp falha com um "browser não iniciou" sem
> explicação. É o tropeço mais comum ao subir whatsapp-web.js em VPS enxuta.

---

## 2. Subir o código

```bash
mkdir -p ~/agendamento-onco && cd ~/agendamento-onco
# suba o conteúdo da pasta Agendamento_Consulta para cá (scp, git clone, o que preferir)

cd app
npm ci --omit=dev
mkdir -p logs dados
```

Envie o `credenciais.json` do Google **por SCP**, nunca por WhatsApp ou e-mail:

```bash
# no seu Windows, no PowerShell:
scp credenciais.json usuario@SEU_IP:~/agendamento-onco/app/credenciais.json
```

```bash
# de volta na VPS: só o dono lê
chmod 600 ~/agendamento-onco/app/credenciais.json
```

---

## 3. Configurar

```bash
cd ~/agendamento-onco/app
cp .env.example .env
npm run senha            # gere ADMIN_SENHA_HASH e ADMIN_SEGREDO
nano .env
```

O mínimo para funcionar:

```
NODE_ENV=production
HOST=127.0.0.1
PORT=3000

GOOGLE_APPLICATION_CREDENTIALS=./credenciais.json

ADMIN_SENHA_HASH=(a linha que o npm run senha imprimiu)
ADMIN_SEGREDO=(a outra linha)

WA_DRIVER=log            # troque para wwebjs depois que o resto estiver de pé
TAREFAS_TOKEN=(gere um valor aleatório qualquer; protege o cron)
```

```bash
chmod 600 .env
```

Locais de atendimento, horários e WhatsApp da recepção **não vão aqui** — o médico
cadastra pelo painel.

Confira antes de expor:

```bash
npm test                 # 77 testes, sem rede
node src/server.js       # deve subir em 127.0.0.1:3000; Ctrl+C para sair
```

---

## 4. Manter de pé com o PM2

```bash
cd ~/agendamento-onco/app
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup              # copie e rode o comando que ele imprimir
pm2 logs agendamento-onco
```

`pm2 save` + `pm2 startup` são o que faz o serviço voltar sozinho depois de um
reboot da VPS. Pular isso é o motivo número um de "sumiu do ar de madrugada".

---

## 5. Domínio, nginx e HTTPS

Aponte um subdomínio (ex.: `agendamento.seudominio.com.br`) para o IP da VPS, com
um registro **A**. Espere propagar — `ping agendamento.seudominio.com.br` tem que
responder o IP certo.

```bash
sudo cp ~/agendamento-onco/app/deploy/nginx-agendamento.conf \
        /etc/nginx/sites-available/agendamento
sudo sed -i 's/SEU_DOMINIO/agendamento.seudominio.com.br/g' \
        /etc/nginx/sites-available/agendamento
sudo ln -sf /etc/nginx/sites-available/agendamento /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d agendamento.seudominio.com.br
```

> O arquivo traz só o bloco `:80`, de propósito: o nginx **recusa iniciar** com
> `listen 443 ssl` enquanto não existir certificado, e o certificado só é criado
> pelo certbot, que por sua vez precisa do `:80` no ar para provar o domínio. O
> certbot copia o bloco para um `:443` com o certificado e acrescenta o
> redirecionamento. Se você editar o arquivo e recolocar um `listen 443` na mão
> antes do certbot, o `nginx -t` falha com
> `no "ssl_certificate" is defined for the "listen ... ssl" directive`.

O certbot preenche o certificado e renova sozinho. Confira:

```bash
sudo certbot renew --dry-run
```

**HTTPS não é opcional aqui.** Sem ele a senha do painel e os dados do paciente
trafegam em claro, e o cookie de sessão não recebe a marca `Secure`.

### Se a máquina já roda Caddy (ou outro servidor na porta 80)

Instalar um segundo servidor web não funciona: quem chegar depois falha com
`bind() to 0.0.0.0:80 failed (98: Address already in use)`. Descubra quem é o
dono da porta antes de qualquer coisa:

```bash
sudo ss -ltnp | grep -E ':80\s|:443\s'
```

**Se for Caddy**, é o caminho mais fácil dos dois: ele emite e renova o
certificado sozinho, sem certbot. Desative o nginx e use
[`deploy/Caddyfile-agendamento`](app/deploy/Caddyfile-agendamento):

```bash
sudo systemctl disable --now nginx
sudo rm -f /etc/nginx/sites-enabled/agendamento

sudo tee -a /etc/caddy/Caddyfile < ~/agendamento-onco/app/deploy/Caddyfile-agendamento
sudo sed -i 's/SEU_DOMINIO/agendamento.seudominio.com.br/' /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O certificado é emitido no primeiro acesso ao domínio — pode levar alguns
segundos na primeira vez. Acompanhe com `sudo journalctl -u caddy -f`.

**Se for Apache** e não estiver servindo nada seu: `sudo systemctl disable --now apache2`
e siga com o nginx.

**Se for um container Docker publicando a 80**: não tome a porta dele. Ou o
container passa a escutar numa porta interna e o servidor da frente distribui
por domínio, ou você cadastra este site no proxy que já existe.

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

A porta 3000 **não** entra na lista: o Node escuta só em `127.0.0.1`, e quem fala
com a internet é o nginx.

---

## 6. Ligar o WhatsApp

Depois que o site estiver no ar:

```bash
cd ~/agendamento-onco/app
nano .env                # WA_DRIVER=wwebjs  (deixe CHROMIUM_PATH vazio/comentado:
                         #  vazio = usa o Chromium que o Puppeteer baixou)
pm2 restart agendamento-onco
```

Agora abra **`/admin`**, vá no bloco **WhatsApp** e clique em **Conectar WhatsApp**.
O QR aparece na tela; escaneie com o celular do consultório em
*⋮ → Dispositivos conectados → Conectar dispositivo*. A tela avisa sozinha quando
conectar, e o botão **Enviar mensagem de teste** confirma que a recepção recebe.

Quem preferir o terminal: `pm2 stop agendamento-onco && npm run wa:login`, escaneie,
e `pm2 start agendamento-onco`.

A sessão fica em `app/wwebjs_auth/`. Não apague essa pasta, senão precisa
escanear de novo.

---

## 7. Cobrança dos pré-agendamentos parados

```bash
crontab -e
```

```
# de hora em hora, cobra da recepção o que passou de 24h sem confirmação
0 * * * * curl -s -X POST -H "x-tarefas-token: SEU_TAREFAS_TOKEN" http://127.0.0.1:3000/tarefas/cobrar-pendentes > /dev/null

# backup diário da configuração e da sessão do WhatsApp
10 3 * * * /home/SEU_USUARIO/agendamento-onco/app/deploy/backup-config.sh >> /home/SEU_USUARIO/agendamento-onco/app/logs/backup.log 2>&1
```

---

## 8. Depois de subir, confira

```bash
curl -s http://127.0.0.1:3000/saude
# {"ok":true,"whatsapp":"wwebjs","hospitais":2,"painel":true}
```

- [ ] `https://seu-dominio` abre o formulário do paciente
- [ ] `https://seu-dominio/admin` pede senha e entra
- [ ] cadeado do HTTPS válido no navegador
- [ ] `curl http://SEU_IP:3000` **não** responde de fora (porta fechada)
- [ ] `pm2 status` mostra `online`
- [ ] reiniciar a VPS (`sudo reboot`) e o site voltar sozinho
- [ ] backup rodando: `ls ~/backups/agendamento`

---

## Rotina

```bash
pm2 logs agendamento-onco --lines 100   # o que está acontecendo
pm2 restart agendamento-onco            # depois de mexer no .env
pm2 monit                               # memória e CPU
```

**Atualizar o código:**

```bash
cd ~/agendamento-onco/app
# suba os arquivos novos
npm ci --omit=dev
npm test
pm2 restart agendamento-onco
```

`dados/config.json`, `.env`, `credenciais.json` e `wwebjs_auth/` **não** são
tocados por uma atualização — é justamente por isso que estão fora do Git.

---

## O que pode dar errado

| Sintoma | Causa provável |
|---|---|
| `EADDRINUSE` ao iniciar | já tem algo na 3000; `pm2 delete agendamento-onco` e suba de novo, ou mude a PORT |
| 502 no navegador | o Node caiu; veja `pm2 logs` |
| `no "ssl_certificate" is defined` no `nginx -t` | tem um `listen 443 ssl` sem certificado; deixe só o bloco `:80` e rode o certbot |
| `bind() to 0.0.0.0:80 failed (Address already in use)` | outro servidor já é dono da porta 80; veja "Se a máquina já roda Caddy" |
| WhatsApp não conecta | faltam as bibliotecas do Chromium (passo 1), ou o `CHROMIUM_PATH` aponta para o snap do sistema — deixe-o vazio para usar o do Puppeteer |
| `Package X has no installation candidate` no apt | Ubuntu 24.04 usa nomes com sufixo `t64` (`libasound2t64`, `libcups2t64`…) |
| Painel aceita a senha e volta para o login | faltou HTTPS: o cookie sai com `Secure` e o navegador descarta em http |
| Horários não aparecem | agenda não compartilhada com a conta de serviço — use "Testar acesso" no painel |
| Sumiu tudo que o médico cadastrou | `dados/config.json` foi apagado; restaure do backup |
| Some do ar depois de reboot | faltou `pm2 save` + `pm2 startup` |

---

## Segurança, em resumo

- `.env` e `credenciais.json` com `chmod 600`
- porta 3000 só em `127.0.0.1`; nginx é a única porta de entrada
- HTTPS obrigatório, com renovação automática
- painel com senha em scrypt, sessão de 12h, 8 tentativas por IP a cada 15 min,
  mais o freio do nginx no login
- `robots.txt` mantém o `/admin` fora dos buscadores
- backup diário do que não dá para recriar

Dado de paciente é dado sensível de saúde. Nada disso é exagero.

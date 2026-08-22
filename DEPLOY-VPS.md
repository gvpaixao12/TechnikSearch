# Deploy no VPS (Hostinger KVM / Ubuntu)

O app inteiro roda numa máquina só: o Express já serve o frontend estático
(`server/index.js` → `express.static`) e a API. Sem Vercel, sem CORS, sem
mixed-content. Frontend e backend na mesma origem.

> Substitua `SEU_IP` pelo IP do VPS (aparece no overview do hPanel) e
> `SEU_DOMINIO.com` pelo seu domínio (se tiver).

---

## 0. Antes de tudo: suba o código pro GitHub

As mudanças locais (inclusive o ajuste de `API_BASE`) precisam estar no
repositório, porque o VPS vai clonar de lá:

```powershell
git add -A
git commit -m "deploy: API_BASE relativo em produção"
git push origin main
```

---

## 1. Conectar no VPS

No PowerShell (ou pelo "Browser terminal" do hPanel):

```powershell
ssh root@SEU_IP
```

> Garanta no overview que o SO é **Ubuntu 22.04/24.04**. Se vier com painel
> (CyberPanel etc.) que você não quer, dá pra reinstalar SO limpo em
> *Operating System → Reinstall*.

## 2. Instalar Node 22, git e nginx

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git nginx
node -v          # deve mostrar v22.x
```

## 3. Trazer o código

Repositório é privado, então use um **token** do GitHub
(Settings → Developer settings → Personal access tokens → fine-grained,
acesso de leitura ao repo):

```bash
git clone https://SEU_TOKEN@github.com/gvpaixao12/TechnikSearch.git /opt/technik
cd /opt/technik         # já vem na branch main
```

## 4. Instalar dependências e configurar .env

```bash
cd /opt/technik/server
npm install --omit=dev        # pula o playwright (devDependency, pesado)
nano .env                     # cole as chaves reais (modelo em .env.example)
```

Conteúdo do `.env` (as mesmas chaves que você usa local):

```
GROQ_API_KEY=...
GROQ_VISION_API_KEY=
SERPER_API_KEY=...
# Supabase = banco (índice, histórico, rascunhos)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=...
# Cloudflare R2 = arquivos das fotos
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=car-images
R2_PUBLIC_BASE=https://pub-xxxx.r2.dev
PORT=3001
```

Teste rápido:

```bash
node index.js                 # deve printar "Technik server on http://localhost:3001"
```

`Ctrl+C` pra parar.

## 5. Manter rodando com pm2

```bash
npm install -g pm2
cd /opt/technik/server
pm2 start index.js --name technik
pm2 save
pm2 startup                   # rode o comando que ele imprimir (sobrevive a reboot)
```

Úteis: `pm2 logs technik`, `pm2 restart technik`, `pm2 status`.

## 6. Expor na porta 80 (nginx como proxy reverso)

O app escuta em `127.0.0.1:3001`; o nginx atende a internet na porta 80 e
repassa.

```bash
nano /etc/nginx/sites-available/technik
```

```nginx
server {
    listen 80;
    server_name SEU_IP;          # ou SEU_DOMINIO.com

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;  # builds de imagem demoram 10-30s
    }
}
```

```bash
ln -s /etc/nginx/sites-available/technik /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Firewall: abra as portas (e confira também o firewall do hPanel):

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Agora **http://SEU_IP/** serve o app. 🎉

## 7. Domínio + HTTPS (recomendado)

1. No DNS do domínio, crie um registro **A** apontando pro `SEU_IP`.
2. Troque `server_name` no nginx pro domínio e recarregue.
3. SSL grátis (Let's Encrypt):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d SEU_DOMINIO.com
```

O certbot reconfigura o nginx pra HTTPS e renova sozinho.

---

## Atualizar depois de novas mudanças

```bash
cd /opt/technik && git pull
cd server && npm install --omit=dev
pm2 restart technik
```

---

## 8. Autenticação (obrigatório desde 2026-08-22)

A partir da versão com login, **nada é público**: a raiz do site é a tela de
entrada, a busca mudou pra `/busca`, e a API responde 401 pra quem não estiver
autenticado. Antes disso qualquer um com a URL chamava `/api/recommend` e
gastava créditos da OpenAI.

São duas portas de entrada, e elas alcançam coisas diferentes:

| quem | como entra | alcança |
|---|---|---|
| você, no navegador | senha em `/login` → cookie de sessão | tudo |
| o app desktop | header `x-technik-device` | só `/busca` |

### Passos no primeiro deploy

Rode **antes** de reiniciar o pm2. São mudanças só de banco, então o app antigo
continua no ar enquanto isso — se algo falhar, nada quebrou ainda.

```bash
cd /opt/technik && git pull
cd server

# 1. cria as tabelas (idempotente — o próprio script aplica o schema)
#    e cria seu usuário. Escolha a senha aqui.
node scripts/criar-usuario.mjs SEU_LOGIN 'SUA_SENHA' 'Seu Nome'

# 2. só agora sobe o código novo
pm2 restart technik
```

Confira que fechou:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://SEU_DOMINIO/busca        # 302
curl -s -o /dev/null -w '%{http_code}\n' https://SEU_DOMINIO/api/consultas # 401
curl -s -o /dev/null -w '%{http_code}\n' https://SEU_DOMINIO/login        # 200
```

### Autorizar uma máquina (o app desktop)

O instalador **não** carrega credencial nenhuma — de propósito, senão qualquer
cópia dele viraria uma chave. A autorização é por computador:

```bash
node scripts/criar-dispositivo.mjs "notebook da loja" busca
```

Ele imprime um JSON **uma única vez** (o banco só guarda o hash). Grave esse
conteúdo em `%APPDATA%\Technik\credentials.json` na máquina, e o app passa a
entrar sozinho, sem tela de senha.

Para ver o que está autorizado, ou cortar o acesso de uma máquina:

```bash
node scripts/criar-dispositivo.mjs --listar
node scripts/criar-dispositivo.mjs --revogar <id>
```

Revogar tem efeito imediato e não afeta sua senha nem suas sessões de navegador.

### Trocar a senha

O mesmo script; ele detecta que o usuário existe e **derruba todas as sessões
abertas** — que é o comportamento que você quer quando troca senha por
desconfiança:

```bash
node scripts/criar-usuario.mjs SEU_LOGIN 'NOVA_SENHA'
```

### Se você se trancar do lado de fora

Nada aqui depende do app estar no ar: os scripts falam direto com o banco. Se
esquecer a senha, rode `criar-usuario.mjs` de novo com o mesmo login pela SSH.

### Cuidado com a ordem ao atualizar o desktop

O instalador precisa ser **1.0.3 ou mais novo**. Versões anteriores apontavam
pra raiz do site, que agora é o login — elas abrem numa tela onde o app não tem
senha pra digitar. E o 1.0.3 só funciona depois que este deploy estiver no ar,
porque antes dele `/busca` não existe.

### Reset de senha (sem e-mail)

O projeto não envia e-mail, então o fluxo é o de TI corporativa: o admin gera
uma senha temporária dentro do app e entrega por fora (WhatsApp, pessoalmente).

1. A pessoa clica em **"Esqueci minha senha"** na tela de login e informa o
   usuário. Isso registra um pedido — a tela responde igual exista ou não o
   login, senão viraria um jeito de descobrir quais existem.
2. Você entra no CRM e vê o aviso de pedidos pendentes na seção **Usuários**.
3. Clica em **Resetar senha**. O app mostra a temporária **uma única vez** e
   derruba as sessões abertas daquela pessoa.
4. Ela entra com a temporária e é **obrigada** a escolher uma definitiva antes
   de alcançar qualquer outra tela.

A trava do passo 4 é o que faz isso valer: enquanto a senha for temporária, a
sessão só alcança `/trocar-senha`. Sem ela bastaria navegar pra outro lugar e a
temporária viraria permanente.

### Criar usuários

Pela tela: **CRM → Usuários → Novo usuário**. Pela SSH, quando você estiver
trancado do lado de fora, continua valendo o `criar-usuario.mjs`.

Um usuário não pode remover a si mesmo, e o último usuário do sistema não pode
ser removido — senão ninguém entraria depois.

### Aplicar mudanças de schema num deploy

```bash
cd /opt/technik/server && node scripts/aplicar-schema.mjs auth-schema.sql
```

Idempotente (tudo é `if not exists`), então rodar de novo não faz mal. Use este
em vez do `criar-usuario.mjs` quando não quiser mexer em senha de ninguém.

### Monitor de consumo das APIs

O painel fica em **CRM → Consumo das APIs** e lê `GET /api/admin/usage`. Pra
gravar o histórico (sem isso ele funciona, mas zera a cada restart):

```bash
cd /opt/technik/server && node scripts/aplicar-schema.mjs uso-api-schema.sql
```

O que cada número é, e de onde vem:

| Medidor | Fonte | Exato? |
|---|---|---|
| Créditos do Serper | `GET google.serper.dev/account` | sim — é o saldo real |
| Gasto do mês | Costs API da OpenAI, se houver `OPENAI_ADMIN_KEY` | sim |
| Gasto do mês (sem admin key) | estimativa a partir dos tokens de cada resposta | aproximado |
| Janela de tokens (TPM) | headers `x-ratelimit-*` da última chamada | sim, mas é "vou tomar 429?", não saldo |
| FIPE · hoje | contagem própria em `fipe.js`, só do que saiu pra internet | sim — resposta de cache não entra |

A `OPENAI_ADMIN_KEY` é uma **admin key só-leitura** (Settings → Organization →
Admin keys), separada da `LLM_API_KEY` — chave de projeto não tem permissão de
ler custo, devolve `Missing scopes: api.usage.read`.

Pra conferir tudo sem abrir o navegador: `node scripts/diag-usage.js`.

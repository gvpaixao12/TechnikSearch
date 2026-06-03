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
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=...
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

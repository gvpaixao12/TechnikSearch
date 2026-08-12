# Plano: tirar o Postgres do Supabase e pôr na VPS

Status: **planejado, não executado.** Escrito em 2026-08-11, logo depois da
migração das fotos pro Cloudflare R2 (ver `DEPLOY-VPS.md` e `server/storage.js`).

---

## 1. Por que — e por que não

**Não é por quota.** O que estourou o free tier foi o *storage* das fotos, e isso
já foi resolvido indo pro R2. O banco tem 1.244 + 20 linhas e uns 3-5 MB: está a
quilômetros do limite de 500 MB e vai continuar assim por muito tempo. Migrar o
banco **não economiza nada hoje**.

**O motivo real é o pause por inatividade.** O free tier do Supabase pausa o
projeto, e quando isso acontece o host some do DNS, volta como 521, e o schema
cache do PostgREST ainda demora a reaquecer. O sintoma no app é "nenhuma foto
carrega", que não parece nem de longe problema de banco — já custou tempo de
diagnóstico antes. Na VPS isso deixa de existir.

Ganho secundário: um serviço externo a menos num app que já é todo seu, e o fim
da `service_role key` (que bypassa RLS) circulando em `.env` de duas máquinas.

**O custo honesto:** backup passa a ser sua responsabilidade, a VPS vira ponto
único de falha pro banco também, e o acesso do seu ambiente local ao banco de
produção passa a exigir túnel SSH (hoje é direto, porque é cloud). Se você não
se incomoda com isso, o plano compensa. Se você quer o mínimo de manutenção
possível, manter no Supabase é uma escolha defensável — só rode um cron qualquer
que bata no projeto semanalmente pra ele não pausar.

---

## 2. O que existe hoje

Três tabelas. Duas em uso, uma que **nunca foi criada** em produção.

### `car_images_cache` — 1.244 linhas
Índice das fotos. Nunca teve DDL versionado (foi criada na mão no painel do
Supabase); o schema abaixo foi derivado por introspecção e precisa ser conferido
contra o `\d` real antes do dump.

```sql
create table if not exists public.car_images_cache (
  key         text primary key,
  marca       text,
  modelo      text,
  ano         integer,
  images      jsonb not null default '[]'::jsonb,
  validated   boolean not null default false,
  cached_at   timestamptz not null default now(),
  expires_at  timestamptz
);
create index if not exists car_images_cache_expires_at_idx on public.car_images_cache (expires_at);
```

Nota: o campo `vision` de cada foto mora **dentro** do jsonb `images`, não numa
coluna. Existe um drift antigo anotado (código teria usado `vision_validated`);
confirmar que hoje não usa antes de recriar o schema.

### `consultas` — 20 linhas, 94 KB
DDL versionado em `server/scripts/consultas-schema.sql`. Histórico de
recomendações entregues.

### `rascunhos` — **não existe**
DDL versionado em `server/scripts/rascunhos-schema.sql`, mas o SQL nunca foi
rodado. Como `rascunhos.js` não engole erro de propósito, "Salvar rascunho" está
falhando pro usuário **hoje**. A migração é a hora natural de criar — mas se o
plano for adiado, rode o SQL no Supabase mesmo assim.

---

## 3. Decisão de arquitetura

**Postgres puro + driver `pg`, com uma camada `db.js` de funções nomeadas.**

Descartados:
- *Supabase self-hosted (Docker):* preservaria o `supabase-js` intacto, mas são
  ~8 containers (postgrest, gotrue, realtime, storage, kong…) pra usar um. Peso
  e superfície de manutenção que não se pagam aqui.
- *Shim que imita a API do supabase-js* (`from().select().eq()…`): tentador
  porque não tocaria nos call sites, mas é fragilidade escondida — qualquer
  método não coberto falha em runtime, não em review. Rejeitado.

O `db.js` expõe uma função por query, não um query builder. Os call sites ficam
legíveis e os 6 scripts importam de um lugar só.

```js
// server/db.js
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function q(text, params) { return (await pool.query(text, params)).rows; }
export async function one(text, params) { return (await q(text, params))[0] ?? null; }
```

---

## 4. Superfície de código a mudar

~20 queries, todas simples. Nenhuma RLS, auth, realtime ou RPC. As agregações do
histórico já são feitas em JS, não no banco.

| Arquivo | O que muda |
|---|---|
| `server/imageCache.js` | `getSupabase()` sai; `readCache`, `readCacheRow`, `writeCache`, `listCachedCars` viram SQL |
| `server/history.js` | 4 queries (insert+returning, 2 selects com order/limit, select by id) |
| `server/rascunhos.js` | 5 queries (insert/update com returning, list, get, delete) |
| `server/scripts/purge-car.js` | select com cadeia de `ilike` + delete by key |
| `server/scripts/build-images-background.js` | select de keys + `delete … where key = any($1)` |
| `server/scripts/migrate-to-avif.js` | select paginado + update de `images` |
| `server/scripts/migrate-storage-to-r2.js` | idem |
| `server/scripts/cleanup-orphans.js` | select de `images` |
| `server/scripts/revalidate-existing.js`, `diag-*.js` | selects diversos |

### Simplificação de brinde
Some a paginação de 1000 em 1000 que existe **só** porque o PostgREST tem esse
teto. Em Postgres direto, `listCachedCars`, `allRows` (2 scripts),
`referencedPaths` e `pruneOldVersions` viram um `select` único. São ~40 linhas de
loop a menos.

### Dois footguns do `pg` que vão morder
1. **jsonb vs array.** Pra coluna `jsonb` (`images`, `briefing`, `top`, `form`)
   passe `JSON.stringify(valor)`. Se passar um array JS cru, o `pg` serializa
   como *array do Postgres*, não como JSON, e o insert falha ou grava errado.
   Já pras colunas `text[]` (`tipos`, `top_models`, `combustiveis`,
   `prioridades`) passe o array JS **direto** — o inverso.
2. **`single()`/`maybeSingle()` não existem.** Eles lançavam erro quando o
   resultado não era exatamente 1 linha; com `pg` você checa `rows.length`. O
   `history.js` e o `rascunhos.js` dependem desse comportamento pra propagar
   erro — preservar a semântica explicitamente.

### Fica como está
As rotas `/api/supabase/cars*` em `index.js` viram um nome mentiroso, mas o
frontend depende delas. Renomear exige mexer no `technik-app.jsx` junto; deixar
pra um commit separado e cosmético.

---

## 5. Infra na VPS

```bash
apt update && apt install -y postgresql
sudo -u postgres psql -c "create role technik login password 'TROCAR';"
sudo -u postgres psql -c "create database technik owner technik;"
```

Deixar o `listen_addresses` no default (`localhost`) — o banco **não** vai pra
internet. O app conecta em `localhost`, e a sua máquina entra por túnel SSH
(seção 7).

```
# server/.env na VPS
DATABASE_URL=postgres://technik:TROCAR@localhost:5432/technik
```

**Confira a versão antes:** o `pg_dump` precisa ser >= a versão do servidor de
origem. Rode `select version()` no SQL editor do Supabase e instale na VPS uma
versão igual ou maior. Se o Supabase estiver em 17 e a VPS em 16, o dump falha
com erro de versão — e é chato de diagnosticar no meio do corte.

---

## 6. Dump e restore

**Gotcha que custa uma noite:** a senha do Postgres **não é** a
`SUPABASE_SERVICE_KEY`. Ela fica em Project Settings → Database. E a conexão
direta (`db.<ref>.supabase.co`) hoje é **IPv6-only** no free tier — de uma VPS
sem IPv6 dá "network unreachable". Use o **Session pooler** (porta 5432, tem
IPv4). O Transaction pooler (6543) não serve pra `pg_dump`.

```bash
# na VPS — só as tabelas que interessam, sem dono/permissões do Supabase
pg_dump "postgresql://postgres.<ref>:<SENHA>@aws-0-<regiao>.pooler.supabase.com:5432/postgres" \
  --no-owner --no-privileges \
  --table=public.car_images_cache \
  --table=public.consultas \
  > technik.sql

psql "postgres://technik:TROCAR@localhost:5432/technik" < technik.sql
psql "postgres://technik:TROCAR@localhost:5432/technik" < server/scripts/rascunhos-schema.sql
```

`gen_random_uuid()` é nativo do Postgres 13+, então não precisa de extensão.

Conferir depois do restore:
```sql
select count(*) from car_images_cache;   -- esperado: 1244
select count(*) from consultas;          -- esperado: 20
select count(*) from rascunhos;          -- esperado: 0
```

---

## 7. Acesso da sua máquina

Esse é o ponto que mais muda o dia a dia. Hoje o banco é cloud e compartilhado:
você roda `build-images-background.js`, os `diag-*` e os merges de catálogo aqui
e reflete em produção na hora. Com o banco dentro da VPS, isso passa por túnel:

```bash
ssh -N -L 5433:localhost:5432 root@2.25.166.43 -i ~/.ssh/technik_deploy
```

E o `.env` local aponta pra `postgres://technik:TROCAR@localhost:5433/technik`
(5433 pra não colidir com um Postgres local, se houver). O túnel precisa estar
de pé **antes** de qualquer script. Vale um atalho no PowerShell pra não
esquecer.

---

## 8. Backup

Vira sua responsabilidade — e agora tem onde guardar de graça (R2):

```bash
# /etc/cron.daily/technik-backup
pg_dump postgres://technik:TROCAR@localhost:5432/technik | gzip > /tmp/technik-$(date +%F).sql.gz
# subir pro bucket via rclone/aws-cli e apagar local; reter ~14 dias
```

Guardar num bucket **separado** do `car-images`, e testar o restore uma vez —
backup não verificado não é backup.

---

## 9. Ordem do corte

O corte é rápido porque o banco é minúsculo. Janela realista: **2 a 5 minutos**.

1. Terminar o R2 primeiro (deploy + purge). Um problema de cada vez.
2. Provisionar Postgres na VPS e restaurar o dump num banco de **teste**
   (`technik_test`).
3. Escrever o `db.js` e converter os call sites. Apontar o `.env` **local** pro
   banco de teste via túnel e rodar `server/scripts/test-scenarios.js` + os
   `diag-*`. É aqui que os footguns de jsonb aparecem.
4. Commit e push.
5. **Corte:** `pm2 stop technik` → `pg_dump` fresco do Supabase → restore no
   banco de produção → `git pull && npm install` → trocar `.env` →
   `pm2 start`. O dump fresco é o que garante não perder as consultas gravadas
   entre o teste e o corte.
6. Smoke test no app.
7. Deixar o projeto Supabase **vivo e intocado** por ~2 semanas.

### Rollback
Imediatamente após o corte: trocar `DATABASE_URL` de volta e reverter o commit —
o Supabase ainda tem tudo. Passadas algumas horas, as consultas e rascunhos
novos só existem na VPS, então voltar exigiria um dump no sentido inverso. Ou
seja: a janela de rollback barato é curta, e vale conferir o app com atenção
logo depois do corte.

---

## 10. Esforço

3 a 5 horas, sendo a maior parte na conversão dos call sites e no teste. Nada
aqui é difícil; o que dá trabalho é ser meticuloso com os 20 pontos de query.

## 11. Checklist

- [ ] Conferir `select version()` do Supabase e instalar versão >= na VPS
- [ ] Conferir o `\d car_images_cache` real contra o schema da seção 2
- [ ] Pegar a senha do Postgres em Settings → Database (≠ service key)
- [ ] Provisionar role + database + `technik_test`
- [ ] `pg_dump` via Session pooler (IPv4)
- [ ] Restore + criar `rascunhos`
- [ ] Escrever `server/db.js`
- [ ] Converter os 9 arquivos da seção 4
- [ ] Testar contra `technik_test` pelo túnel
- [ ] Cron de backup pro R2 + testar um restore
- [ ] Corte + smoke test
- [ ] Remover `SUPABASE_*` do `.env` das duas máquinas
- [ ] Após ~2 semanas estável: apagar o projeto Supabase

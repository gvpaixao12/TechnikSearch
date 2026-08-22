# Plano — App desktop e CRM

Registro das decisões tomadas na conversa de 2026-08-21 sobre empacotar o
Technik como aplicativo desktop e acrescentar um CRM. O que está implementado
hoje é só a **casca desktop** (pasta `desktop/`); o resto está aqui pra ser
retomado depois, com o raciocínio junto — a ideia é não ter que redescobrir
por que cada coisa foi decidida assim.

## Contexto do produto

O Technik vai ser vendido pra **um cliente específico**, e **uma pessoa** vai
usar. Ela usa a busca pra mostrar carros aos clientes dela, e (no futuro) um
CRM pra acompanhar esses clientes. Isso é o que justifica quase todas as
escolhas abaixo — várias delas seriam erradas num produto multi-cliente.

## Decisões fechadas

### A VPS fica

Cogitamos tirar o Technik da VPS pra baratear o preço de venda. Não vale:
a VPS hospeda outras coisas além do Technik, então desligar este app **não
tira nada da fatura**. O custo marginal de hospedar o Technik lá é ~zero, e
isso já permite vender sem mensalidade, que era o objetivo comercial.

Consequência: ficam descartados o PGlite/SQLite local, o backend embarcado no
Electron e a migração de dados. Todos existiam só pra zerar hospedagem.

### O desktop é casca fina, não app autônomo

O Electron carrega `https://technik.paixaogabriel.com` — o backend continua na
VPS. Isso mantém a versão web funcionando (mesmo app, mesma URL, mesmo banco)
e evita três problemas de uma vez: chave de API embarcada no cliente,
`electron-rebuild` do `sharp`, e drift de versão.

Vantagem que vem de brinde: como o frontend vem do servidor, **push no `main`
atualiza o desktop na hora**. Só mudança na casca exige reinstalar.

### Por que não serverless

Três coisas no backend travam Vercel/Workers/Netlify:

- SSE de longa duração em `server/index.js:335` (com ping a cada 15s) — funções
  serverless têm teto de duração e cortam a conexão no meio;
- `sharp` em `server/imageCache.js:406` — binário nativo, não roda em Workers;
- `spawn` de child process em `server/index.js:19`.

Dá pra reescrever os três, mas aí a economia vira refatoração do backend.

## Autenticação — FEITA (substitui o plano do auth_basic)

O `auth_basic` no nginx foi **descartado**. Em vez dele há login de verdade,
porque o CRM precisa de uma porta de entrada própria e senha compartilhada de
nginx não serve pra isso.

Duas portas, de propósito:

- **navegador** → `POST /api/login` → cookie de sessão (`HttpOnly`, `SameSite=Lax`,
  `Secure` sob https) → alcança tudo;
- **desktop** → header `x-technik-device` → alcança só o escopo do token
  (`busca`), nunca o CRM.

O desktop entra **sozinho**, sem tela de senha, porque a pessoa vai estar
mostrando carro pra um cliente. Mas ele não carrega a senha do usuário: carrega
um token de dispositivo, que alcança menos e é revogável sem trocar a senha do
navegador.

Arquivos: `server/auth.js`, `server/scripts/auth-schema.sql`, `login.html`,
`crm.html`, e os scripts `criar-usuario.mjs` / `criar-dispositivo.mjs`.

Senha com scrypt do `node:crypto` (sem dependência nova). Banco guarda só hash —
nem senha, nem sessão, nem token em claro.

### Rotas

| rota | quem alcança |
|---|---|
| `/login`, `/api/login`, `/brand-styles.css`, `/assets/*` | público |
| `/busca` | sessão ou dispositivo |
| `/crm` | só sessão (dispositivo leva 403) |
| `/` | redireciona: dispositivo → `/busca`, usuário → `/crm` |
| `/api/*` | sessão ou dispositivo (401 em JSON se não) |
| `/server/*`, `/node_modules/*`, `/desktop/*` | 404 |

Verificado com 28 checagens contra Postgres 16 real, incluindo o desktop
entrando com token e sendo barrado no CRM.

### Ainda pendente aqui

- **Nada disso está no ar.** Falta deploy, rodar o `auth-schema.sql` no banco de
  produção e criar o usuário.
- `pg_dump` automático pro R2.
- O `cors()` aberto de `index.js` continua lá — agora é menos grave, porque o
  portão vem antes, mas ainda não faz sentido.

## Pendente — custo por consulta

**Não sabemos quanto custa uma consulta**, e esse é o número que define o preço
de venda. Só o validador de imagem captura `usage` (`imageValidator.js:254`), e
mesmo assim pra estimar rate limit, não custo. O caminho de texto — que roda em
*toda* consulta — não mede nada (`agents.js:191`).

Conserto: capturar `usage` no `runChat` e gravar na tabela `consultas`, que o
`history.js` já mantém. Meia hora de trabalho. Vinte consultas reais depois,
você tem R$/consulta e sabe se está vendendo acima do custo marginal.

## Pendente — CRM

### Formato

**Um backend, um banco, dois frontends.** O Express já serve estático de
`FRONTEND_DIR` (`index.js:43`), então o CRM é mais um HTML de entrada com o
próprio JSX, na mesma origem, reusando `brand-styles.css`.

O **instalador do desktop não vira um build separado**: é a mesma casca com a
URL inicial travada na busca e o guarda de `will-navigate` recusando `/crm`
(já implementado em `desktop/main.js`, ver `BLOCKED_PATHS`).

A razão do split não é organização, é privacidade: o desktop é a tela que o
**cliente final** vê por cima do ombro na hora de olhar o carro. Aquele
executável não pode alcançar telefone e histórico de outro comprador.

### Escopo do primeiro corte (decidido)

Só duas coisas: **ver o histórico** e **cadastro de cliente**. Follow-up de
lead (status, próximo contato, anotações) ficou **de fora** — as tabelas
`leads`/`interacoes` não precisam existir ainda.

### Autenticação

Como é **uma pessoa só**, o `auth_basic` serve pro CRM também. **Não** precisa
de tabela de usuários, sessão nem papéis. Se um dia entrar equipe da loja,
isso muda: CRM que não registra quem atendeu o lead não é CRM, e aí entra
login de verdade — e o truque do `app.on('login')` no desktop vira tela de
login normal.

### O problema de fundo: não existe identidade de cliente

Hoje `client_name` em `consultas` (e em `rascunhos`) é **texto solto**, digitado
a cada atendimento. "João", "joao silva" e "Sr. João" são três clientes
distintos pro banco. O cadastro é justamente o que cria identidade.

Trabalho previsto:

1. tabela `clientes` (nome, telefone, e-mail, notas, timestamps), com DDL
   versionado em `server/scripts/clientes-schema.sql` no padrão dos outros;
2. coluna `cliente_id` **nulável** em `consultas` e `rascunhos`, apontando pra
   ela, com índice;
3. `server/clientes.js` no padrão do `rascunhos.js` — erro **sobe**, não é
   engolido, porque salvar é a ação principal do usuário (diferente do
   `history.js`, onde salvar não pode quebrar a recomendação);
4. rotas `/api/clientes` em `index.js`;
5. frontend: lista, ficha do cliente com o histórico dele, autocomplete de
   vinculação.

**Vinculação assistida, não backfill automático.** Um script que adivinha
cliente por nome vai fundir pessoas distintas e separar a mesma pessoa, em
silêncio e sem aviso. Melhor um autocomplete "vincular a cliente" na tela da
consulta: o histórico antigo vai sendo amarrado conforme o uso, e o que nunca
for vinculado continua funcionando como hoje.

### LGPD

Telefone e e-mail são dado pessoal **de terceiros** (os compradores do cliente),
e isso vale mesmo com um usuário só. O básico que precisa existir junto do
cadastro:

- HTTPS (já tem, certbot) e `auth_basic` na frente (pendente acima);
- backup que funcione de verdade (`pg_dump` pro R2);
- exclusão que apaga mesmo — botão de excluir cliente que remove a linha,
  não um flag de "inativo".

Vale saber: o CRM empurra o produto de "venda única sem mensalidade" pra
assinatura, porque guardar dado de cliente é responsabilidade contínua. É uma
escolha comercial legítima, mas é o oposto da direção original.

## Estimativa

| Etapa | Esforço |
|---|---|
| Casca desktop | ~1 dia — **feito** |
| `auth_basic` + cors + backup | meio dia |
| Instrumentar custo por consulta | meia hora |
| CRM: schema + `clientes.js` + rotas | meio dia |
| CRM: frontend (lista, ficha, vinculação) | 1 a 2 dias |

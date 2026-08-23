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

- ~~Nada disso está no ar.~~ **Está no ar** (conferido em 2026-08-23: `/`,
  `/busca` e `/crm` redirecionam pro `/login` em produção). O schema foi
  aplicado e o usuário existe.
- `pg_dump` automático pro R2 — **FEITO** (`scripts/backup-db.mjs`). Ver a
  seção "Backup" abaixo e o passo a passo em DEPLOY-VPS.md.
- O `cors()` aberto de `index.js:40` continua lá — menos grave porque o portão
  vem antes, mas ainda não faz sentido.

## Pendente — custo por consulta (meio feito)

**Ainda não sabemos quanto custa UMA consulta**, e esse é o número que define o
preço de venda. Mas metade do caminho já foi andada por outra sessão:

- `runChat` **captura** o `usage` agora (`agents.js:210` → `registraLLM`), e
  `usage.js` grava na tabela `uso_api` com custo estimado por modelo;
- o CRM tem o painel (**Uso**), que lê `GET /api/admin/usage`.

O que falta é **atribuição**: `uso_api` agrega por `provider/modelo/operacao`
num período, não por consulta. Dividir o total do mês pelo número de consultas
dá um número errado, porque no mesmo balde caem as varreduras de visão (que são
job de catálogo, não atendimento) — e são elas que dominam a conta.

Dois caminhos, do mais barato ao mais certo:

1. **Filtrar por `operacao = 'texto'`** e dividir pelo número de consultas do
   período. Some as varreduras da conta e dá a média em minutos de trabalho. Não
   responde "quanto custou o atendimento do João", mas responde a pergunta
   comercial, que é a que importa.
2. **Gravar o custo na própria linha de `consultas`** (era o plano original).
   Dá atribuição de verdade e sobrevive a mudança de preço da OpenAI. Exige
   passar o id da consulta pelo `runChat` até o `registraLLM`.

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

#### Ver o histórico — FEITO

O histórico **não foi construído do zero: foi movido**. Ele já existia como uma
aba dentro da busca, que é justamente a tela que o desktop abre e que o cliente
final vê por cima do ombro — ou seja, aquela tela listava nome, perfil e
orçamento de todos os outros compradores. Isso contradizia o motivo do split
(ver "Formato", acima), então a aba mudou de casa.

O que mudou:

- `crm.html` ganhou a aba **Histórico** (JS puro, no estilo do resto do
  arquivo — o CRM não carrega React de propósito);
- em `technik-app.jsx` a aba **Histórico** virou **Rascunhos**. Rascunho ficou
  na busca porque "Salvar rascunho" é um botão daquela tela: sem um lugar pra
  reabrir, viraria um botão que só sabe salvar. O vazamento diminui mas não
  zera — a lista de rascunhos ainda mostra nome de cliente;
- `GET /api/consultas` e `/api/consultas/stats` subiram pra `exigeAuth('crm')`.
  **Isto é o que fecha o buraco de verdade** — mover só a tela esconderia a UI,
  não o dado, e o token de dispositivo continuaria alcançando a rota;
- `GET /api/consultas/:id` **ficou** em escopo `busca`, de propósito: uma
  consulta avulsa é a lista de carros que o consultor está mostrando, não o
  cadastro dos outros clientes;
- o handoff entre os dois frontends é um link comum: a linha no CRM aponta pra
  `/busca#consulta=<id>`, e o `App` lê esse hash no boot, abre a consulta e
  consome o hash (senão um F5 depois de mexer no briefing recarregaria a
  consulta salva por cima).

Verificado com 33 checagens de browser (Playwright) contra a API stubada:
agrupamento por cliente, filtro, escape de HTML no nome, o handoff, e a
confirmação de que nenhum nome de consulta sobrou na tela da busca. O escopo
das rotas foi conferido por leitura (`alcanca` em `auth.js:168`), não em banco.

### Autenticação

Como é **uma pessoa só**, o `auth_basic` serve pro CRM também. **Não** precisa
de tabela de usuários, sessão nem papéis. Se um dia entrar equipe da loja,
isso muda: CRM que não registra quem atendeu o lead não é CRM, e aí entra
login de verdade — e o truque do `app.on('login')` no desktop vira tela de
login normal.

### O problema de fundo: não existe identidade de cliente — RESOLVIDO

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

#### Como ficou

Os cinco itens acima estão feitos. O que vale registrar do que foi decidido na
implementação:

- **`client_name` continua existindo nas duas tabelas.** Ele não foi substituído
  pelo `cliente_id`, nem é sobrescrito quando a consulta é vinculada. É o que foi
  digitado no atendimento, e serve de rastro: se a vinculação estiver errada, é
  por ele que se percebe. É também o que faz a consulta nunca vinculada seguir
  funcionando exatamente como antes.
- **A ficha nasce do nome digitado.** No modal de vinculação há um botão
  "Criar «João Silva»", que cria a ficha já com o nome do atendimento e vincula
  na mesma ação. Na prática é assim que quase toda ficha vai nascer — o cadastro
  vazio, preenchido a frio, seria o caminho que ninguém percorre.
- **O cadastro não aparece na busca.** Cogitou-se um autocomplete de cliente no
  formulário de briefing, e é uma armadilha: aquela tela é a que o comprador vê,
  e um autocomplete ali mostraria o nome dos outros compradores enquanto se
  digita. A vinculação vive só no CRM.
- **Exclusão anonimiza, não apaga a consulta.** `excluiCliente` roda numa
  transação: zera `cliente_id`, `client_name` e `client_segment` das consultas e
  rascunhos ligados, e só então apaga a linha do cadastro. A consulta sobrevive
  sem a pessoa — carros recomendados, faixa de orçamento e tipos não identificam
  ninguém e são o que alimenta as estatísticas. `on delete set null` sozinho não
  bastaria: soltaria o ponteiro e deixaria o nome gravado.
- **`tx()` novo em `db.js`.** Não havia helper de transação no projeto; a
  exclusão é o primeiro lugar que precisa de uma de verdade.

Verificado com 32 checagens de `clientes.js` contra um `db.js` falso
(`npm run test:clientes`) — ordem dos comandos, transação, rollback quando o
cliente não existe, e o fato de nenhum `delete from consultas` ser emitido — mais
45 checagens de browser cobrindo criar → vincular → editar → excluir.

**Atenção no deploy:** `clientes-schema.sql` tem que ser aplicado ANTES de subir
o código. Ver DEPLOY-VPS.md.

### LGPD

Telefone e e-mail são dado pessoal **de terceiros** (os compradores do cliente),
e isso vale mesmo com um usuário só. O básico que precisa existir junto do
cadastro:

- HTTPS (já tem, certbot) e login na frente — **feito**, ver "Autenticação";
- backup que funcione de verdade (`pg_dump` pro R2) — **feito**, e testado
  restaurando num banco vazio (ver "Backup", abaixo);
- exclusão que apaga mesmo — **feito**: o botão remove a linha e anonimiza as
  consultas ligadas, sem flag de "inativo".

Vale saber: o CRM empurra o produto de "venda única sem mensalidade" pra
assinatura, porque guardar dado de cliente é responsabilidade contínua. É uma
escolha comercial legítima, mas é o oposto da direção original.

## Backup — FEITO

`server/scripts/backup-db.mjs`. O que vale registrar das decisões:

- **Bucket separado do das fotos.** `car-images` é servido por um domínio
  público (`R2_PUBLIC_BASE`, `pub-*.r2.dev`). Um dump ali seria telefone e
  e-mail de cliente atrás de uma URL que qualquer um alcança sabendo o nome do
  arquivo. Vai pra `R2_BACKUP_BUCKET`, privado, e de preferência com um token do
  R2 escopado só nele — senão um vazamento do `.env` da aplicação entrega os
  backups junto.
- **O script recusa subir dump que não presta.** Antes do upload ele roda
  `pg_restore --list` no arquivo e exige que `clientes`, `consultas`, `usuarios`
  e `rascunhos` estejam lá dentro. Isso pega o modo de falha que passa meses sem
  ninguém notar: ter apontado pro banco errado (ou pro `technik_test` vazio) e
  acumular um ano de backups de nada.
- **A poda vem depois da conferência.** Só apaga backup antigo depois que o novo
  subiu e o `HEAD` confirmou o tamanho. Se qualquer coisa falhar antes disso, o
  histórico continua intacto.
- **Cifra é opcional (`BACKUP_PASSPHRASE`).** Não é default de propósito: perder
  a passphrase é perder todos os backups, e numa operação de uma pessoa esse
  risco compete de verdade com o risco que a cifra evita. Bucket privado é o
  grosso da proteção; a cifra é pra quem quer o resto.
- **`--verificar`** baixa o backup mais recente, decifra se preciso e prova que
  abre. Backup que ninguém restaurou é esperança, não backup.

Verificado com 21 checagens (`scripts/test-backup.mjs`) contra um Postgres 16 e
um S3 de verdade em container — incluindo **restaurar num banco vazio** e
conferir que o cliente, a vinculação com a consulta e o UTF-8 dos campos livres
voltaram; que adulterar o arquivo cifrado é recusado; e que a poda respeita o
teto sem levar junto o backup recém-criado.

Achado que virou nota no DEPLOY-VPS.md: **a versão do `pg_dump` tem que bater
com a do servidor**. Cliente mais velho recusa dumpar; cliente mais novo dumpa
mas escreve `SET transaction_timeout` no arquivo, e aí o `pg_restore` num
servidor 16 reclama. Apareceu no teste, com cliente 17 contra servidor 16.

## Estimativa

| Etapa | Esforço |
|---|---|
| Casca desktop | ~1 dia — **feito** |
| `auth_basic` + cors + backup | meio dia |
| Instrumentar custo por consulta | meia hora |
| CRM: histórico (mover da busca) | ~meio dia — **feito** |
| CRM: schema + `clientes.js` + rotas | meio dia — **feito** |
| CRM: frontend de clientes (lista, ficha, vinculação) | 1 a 2 dias — **feito** |
| `pg_dump` pro R2 | meio dia — **feito** |

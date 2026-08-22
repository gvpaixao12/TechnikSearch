-- Autenticação: usuários (login pelo navegador), sessões e dispositivos.
--
-- Três tabelas porque são três coisas com ciclos de vida diferentes:
--
--   usuarios     — quem você é. Senha guardada como hash scrypt.
--   sessoes      — um login ativo num navegador. Morre por expiração ou logout.
--   dispositivos — uma máquina que entra SOZINHA, sem senha (o app desktop).
--
-- Por que dispositivo não é só "usuário com senha salva": o token de
-- dispositivo é escopado (só alcança a busca, nunca o CRM) e revogável
-- isoladamente. Se a máquina do cliente for comprometida, você revoga aquele
-- token sem trocar a sua senha e sem derrubar suas sessões de navegador.
--
-- NENHUMA das três guarda segredo em claro: o que vai pro banco é sempre hash.
-- Vazamento do banco não dá acesso a nada — nem senha, nem sessão, nem token.

create table if not exists public.usuarios (
  id          uuid primary key default gen_random_uuid(),
  login       text not null unique,
  nome        text,
  senha_hash  text not null,          -- formato: scrypt$N$r$p$<salt-hex>$<hash-hex>
  criado_em   timestamptz not null default now(),
  ultimo_acesso timestamptz
);

-- O token da sessão NÃO fica aqui — fica o sha256 dele. O valor real só existe
-- no cookie do navegador. Assim o banco não tem como se passar pelo usuário.
create table if not exists public.sessoes (
  token_hash  text primary key,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  ultimo_uso  timestamptz not null default now(),
  user_agent  text
);

create index if not exists sessoes_usuario_idx on public.sessoes (usuario_id);
create index if not exists sessoes_expira_idx  on public.sessoes (expira_em);

-- Mesma ideia: guarda o sha256 do token. O valor real é mostrado UMA vez, na
-- criação, e vai pro credentials.json da máquina — se perder, emite outro.
create table if not exists public.dispositivos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,          -- "notebook da loja", pra saber o que revogar
  token_hash  text not null unique,
  escopo      text not null default 'busca',   -- 'busca' | 'crm' | 'tudo'
  criado_em   timestamptz not null default now(),
  ultimo_uso  timestamptz,
  revogado_em timestamptz
);

create index if not exists dispositivos_ativo_idx
  on public.dispositivos (token_hash) where revogado_em is null;

-- ─── Reset de senha ──────────────────────────────────────────────────────────
-- Fluxo sem e-mail (o projeto não envia nenhum): o admin gera uma senha
-- temporária dentro do app e entrega pra pessoa por fora. No primeiro login com
-- ela, a pessoa é obrigada a escolher uma senha própria.
--
-- `senha_temporaria` é o que força isso: enquanto for true, a sessão daquele
-- usuário só alcança a tela de troca. Sem essa trava, bastaria navegar pra
-- outro lugar e a senha temporária viraria permanente na prática.

alter table public.usuarios
  add column if not exists senha_temporaria boolean not null default false;

-- Pedidos feitos pelo "esqueci minha senha" da tela de login. Serve pro admin
-- saber que alguém está trancado do lado de fora.
--
-- Guarda o login DIGITADO, que pode nem existir — de propósito: se a tela
-- respondesse diferente pra login inexistente, daria pra descobrir quais
-- existem só testando.
create table if not exists public.pedidos_senha (
  id             uuid primary key default gen_random_uuid(),
  login_informado text not null,
  criado_em      timestamptz not null default now(),
  atendido_em    timestamptz,
  atendido_por   uuid references usuarios(id) on delete set null
);

create index if not exists pedidos_senha_pendentes_idx
  on public.pedidos_senha (criado_em desc) where atendido_em is null;

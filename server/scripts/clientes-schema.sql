-- Cadastro de clientes do CRM — a identidade que hoje não existe.
--
--   node scripts/aplicar-schema.mjs clientes-schema.sql
--
-- O problema que esta tabela resolve: `consultas.client_name` (e
-- `rascunhos.client_name`) é texto solto, digitado de novo a cada atendimento.
-- Pro banco, "João", "joao silva" e "Sr. João" são três pessoas. Sem uma linha
-- de verdade pra apontar, não dá pra ter ficha, nem histórico por pessoa.
--
-- Vinculação é ASSISTIDA, não automática: `cliente_id` é NULÁVEL e nasce null.
-- Um script que adivinhasse cliente por nome fundiria pessoas distintas e
-- separaria a mesma pessoa, em silêncio. O `client_name` de texto CONTINUA nas
-- duas tabelas de propósito — é o que faz o histórico não vinculado seguir
-- funcionando como sempre funcionou.
--
-- LGPD: telefone e e-mail aqui são dado pessoal de TERCEIROS (os compradores do
-- cliente). Por isso não existe flag de "inativo" — excluir apaga a linha, e a
-- aplicação (`clientes.js`) ainda anonimiza as consultas que apontavam pra ela,
-- numa transação. Ver o comentário de `excluiCliente`.

create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  nome       text not null,
  telefone   text,
  email      text,
  notas      text
);

-- Busca da tela de vinculação e da lista. `lower(nome)` porque o consultor
-- digita "joão" procurando "João Silva"; não é unique de propósito — dois
-- clientes podem se chamar igual, e é a pessoa que decide se são o mesmo.
create index if not exists clientes_nome_idx on public.clientes (lower(nome));
create index if not exists clientes_criado_em_idx on public.clientes (criado_em desc);

-- ─── Vinculação ─────────────────────────────────────────────────────────────
-- `on delete set null` mantém a consulta viva quando o cliente é excluído: o
-- dado de negócio (carros recomendados, orçamento, taxa de resultado) não é
-- pessoal e alimenta as estatísticas. Quem apaga o nome é `excluiCliente`.

alter table public.consultas
  add column if not exists cliente_id uuid references clientes(id) on delete set null;

alter table public.rascunhos
  add column if not exists cliente_id uuid references clientes(id) on delete set null;

create index if not exists consultas_cliente_id_idx on public.consultas (cliente_id);
create index if not exists rascunhos_cliente_id_idx on public.rascunhos (cliente_id);

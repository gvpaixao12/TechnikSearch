-- Rascunhos de briefing (formulários salvos pelo consultor pra retomar depois).
-- Rode este SQL UMA VEZ no Supabase → SQL Editor antes de usar "Salvar rascunho".
--
-- Diferente de `consultas` (que guarda recomendações JÁ entregues), um rascunho
-- é só o snapshot do formulário em construção — sem resultado. O snapshot inteiro
-- mora no jsonb `form`; client_name fica denormalizado só pra listar/filtrar.

create table if not exists public.rascunhos (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  client_name  text,            -- denormalizado do form, pra listagem/filtro
  form         jsonb not null   -- snapshot completo do formulário
);

create index if not exists rascunhos_updated_at_idx on public.rascunhos (updated_at desc);
create index if not exists rascunhos_client_name_idx on public.rascunhos (client_name);

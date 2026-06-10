-- Histórico de consultas (recomendações entregues a clientes).
-- Rode este SQL UMA VEZ no Supabase → SQL Editor antes de usar o histórico.
--
-- Colunas escalares/array são DENORMALIZADAS a partir do briefing/top só pra
-- permitir agregação rápida (carros mais recomendados, orçamento médio, etc.)
-- sem precisar abrir os jsonb. Os jsonb guardam o registro completo pra
-- reabrir a consulta exatamente como foi entregue.

create table if not exists public.consultas (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  -- identificação do atendimento
  client_name      text,
  client_segment   text,
  ok               boolean not null default true,

  -- briefing denormalizado (pra agregação)
  orcamento_min    integer,
  orcamento_max    integer,
  tipos            text[],
  combustiveis     text[],
  prioridades      text[],
  ano_min          integer,

  -- resultado denormalizado (pra agregação)
  total_resultados integer not null default 0,
  mes_referencia   text,
  top_models       text[],          -- ["Marca Modelo", ...] na ordem do ranking

  -- registro completo (pra reabrir a consulta)
  briefing         jsonb,
  top              jsonb,
  diagnostico      jsonb
);

create index if not exists consultas_created_at_idx on public.consultas (created_at desc);
create index if not exists consultas_client_name_idx on public.consultas (client_name);

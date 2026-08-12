-- Feedback do consultor sobre a qualidade de uma busca.
-- Rode este SQL UMA VEZ no Supabase → SQL Editor antes de usar o feedback.
--
-- De propósito SEM foreign key para `consultas`: a consulta é gravada de forma
-- assíncrona (fire-and-forget em /api/recommend), então o feedback pode chegar
-- antes da linha da consulta existir. Uma FK derrubaria o insert nesse caso —
-- e perder o feedback do consultor é pior do que ter um consulta_id órfão.

create table if not exists public.consulta_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  consulta_id  uuid,                                    -- sem FK (ver acima)
  rating       text not null check (rating in ('up', 'down')),

  -- por que foi ruim (só em rating='down')
  motivos      text[] not null default '{}',            -- chips: caro, perfil, faltou, ...
  comentario   text,                                    -- texto livre, opcional
  faltou       text,                                    -- "senti falta de X", como digitado
  diagnostico  jsonb,                                   -- por que X não apareceu (auto)

  -- contexto denormalizado (pra ler o feedback sem abrir a consulta)
  client_name  text,
  briefing     jsonb
);

create index if not exists consulta_feedback_created_at_idx
  on public.consulta_feedback (created_at desc);
create index if not exists consulta_feedback_consulta_id_idx
  on public.consulta_feedback (consulta_id);
create index if not exists consulta_feedback_rating_idx
  on public.consulta_feedback (rating);

-- Consumo das APIs pagas (LLM de texto, visão e busca de imagens).
--
--   node scripts/aplicar-schema.mjs uso-api-schema.sql
--
-- Uma linha por CHAMADA. O pipeline de fotos faz muita chamada, então a linha
-- é propositalmente magra e as consultas do painel são sempre agregadas por
-- período — nunca listagem. O custo é ESTIMADO a partir do `usage` que a
-- própria API devolve (ver tabela de preços em usage.js); a verdade em dólar
-- só existe na Costs API da OpenAI, que exige admin key.
--
-- Retenção: nada aqui é apagado automaticamente. Se a tabela incomodar,
--   delete from uso_api where criado_em < now() - interval '90 days';

create table if not exists public.uso_api (
  id         bigserial primary key,
  criado_em  timestamptz not null default now(),

  provider   text not null,                    -- openai | groq | serper
  modelo     text,                             -- gpt-4o-mini, llama-…; null na busca
  operacao   text not null,                    -- texto | visao | busca

  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  unidades   integer not null default 0,       -- créditos (serper) ou chamadas
  custo_usd  numeric(12,6) not null default 0  -- estimado
);

create index if not exists uso_api_criado_em_idx on public.uso_api (criado_em desc);
create index if not exists uso_api_provider_idx  on public.uso_api (provider, criado_em desc);

-- Índice das fotos: uma linha por marca/modelo/ano, com as URLs das fotos que
-- vivem no Cloudflare R2 (ver server/storage.js). É a única tabela com dado
-- insubstituível — perder ela órfã as 15.900 fotos no bucket e obriga a
-- reconstruir tudo do zero, gastando Serper e visão de novo.
--
-- ATENÇÃO: esta tabela nasceu criada à mão no painel do Supabase e ficou anos
-- sem DDL versionado. Este arquivo é a transcrição do schema REAL de produção
-- (conferido em 2026-08-11), não uma reconstrução por introspecção — a versão
-- derivada errava os quatro `not null` abaixo.
--
-- Sobre `images`: array de objetos { url, view, sourcePage, vision, manual,
-- favorite }. O status "validado na visão" é por FOTO, dentro do jsonb — não
-- existe coluna `vision_validated` na tabela, apesar de código antigo já ter
-- tentado usar uma.

create table if not exists public.car_images_cache (
  key         text not null,
  marca       text not null,
  modelo      text not null,
  ano         integer not null,
  images      jsonb not null default '[]'::jsonb,
  validated   boolean not null default false,
  cached_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  constraint car_images_cache_pkey primary key (key)
);

-- Usado pela varredura de expirados (TTL: 180d validado, 7d tentativa vazia).
create index if not exists car_images_cache_expires_idx
  on public.car_images_cache using btree (expires_at);

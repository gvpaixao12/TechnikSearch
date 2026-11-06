-- "Não curti este carro" — feedback do consultor sobre UM carro da lista.
-- Rode UMA VEZ no Postgres da VPS (psql technik) antes de usar o botão.
--
-- Diferente de consulta_feedback (que só é lida pra "senti falta de X"), esta
-- tabela é lida pelo pipeline a cada busca: motivo='perfil' tira a família do
-- modelo (ex.: honda|fit) das buscas seguintes cujo estilo de vida contém
-- `usos`. Apagar a linha desfaz a exclusão.

create table if not exists public.carro_feedback (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  consulta_id  uuid,                                   -- sem FK, mesmo motivo de consulta_feedback
  motivo       text not null check (motivo in ('perfil', 'foto')),

  marca        text not null,
  modelo       text not null,                          -- string FIPE completa
  ano          int,
  familia      text not null,                          -- chave de agrupamento (familiaModelo)

  usos         text[] not null default '{}',           -- estilo de vida da busca, em pt-BR
  foto_url     text,                                   -- motivo='foto': a foto removida

  client_name  text,
  briefing     jsonb
);

create index if not exists carro_feedback_motivo_idx
  on public.carro_feedback (motivo, created_at desc);

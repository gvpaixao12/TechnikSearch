-- Estoque de veículos — o que a loja TEM no pátio, não o que a FIPE conhece.
--
--   node scripts/aplicar-schema.mjs estoque-schema.sql
--
-- Por que uma tabela nova e não reaproveitar `car_images_cache`: aquele índice
-- é POR MODELO (`marca__modelo__ano`) e serve pra ILUSTRAR a recomendação —
-- foto genérica, buscada na web e aprovada no portão de visão. Estoque é POR
-- UNIDADE: é aquele carro, com aquele km, aquela cor e aquele arranhão. Se as
-- fotos do pátio entrassem no cache do modelo, o carro do pátio viraria a
-- ilustração de todo Corolla 2019 do catálogo. Daí tabela própria e prefixo
-- próprio no bucket (`estoque/<id>/`).
--
-- Cadastro é MANUAL de ponta a ponta: nada aqui é buscado, validado por IA ou
-- cruzado com a FIPE. Quem digita é o consultor, e o que ele digitou é o que
-- vale — mesma regra do resto do projeto: campo vazio é melhor que número
-- inventado.
--
-- `fotos` é jsonb na própria linha (e não uma tabela `estoque_fotos`) pelo
-- mesmo motivo de `car_images_cache.images`: a galeria só é lida junto com o
-- veículo, nunca sozinha, e são poucas fotos por unidade. Cada item:
--   { url, capa, criado_em }

create table if not exists public.estoque (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  marca          text not null,
  modelo         text not null,
  versao         text,
  ano_modelo     int,
  ano_fabricacao int,

  km             int,
  cor            text,
  -- Placa NÃO é unique: o mesmo carro pode ser recomprado e voltar pro pátio, e
  -- aí duas linhas com a mesma placa são duas passagens diferentes pelo estoque,
  -- não duplicata. É opcional também — consignado costuma entrar antes de o
  -- documento chegar.
  placa          text,
  cambio         text,
  combustivel    text,
  preco          numeric(12,2),   -- o que se pede pelo carro
  notas          text,

  -- ─── Baixa ────────────────────────────────────────────────────────────────
  -- Dar baixa é EVENTO DE NEGÓCIO (vendeu, devolveu ao consignante), não erro
  -- de digitação. Por isso a linha continua no banco: é dela que sai "quanto
  -- tempo esse carro ficou parado" e "por quanto saiu". Quem apaga de verdade é
  -- o delete, que existe pro cadastro errado — outro caso, outro botão.
  status         text not null default 'disponivel'
                 check (status in ('disponivel', 'baixado')),
  baixa_em       timestamptz,
  baixa_motivo   text,
  preco_venda    numeric(12,2),

  fotos          jsonb not null default '[]'::jsonb
);

-- A lista padrão da tela é "disponíveis, mais recente primeiro"; a busca por
-- texto varre marca/modelo/versão/placa.
create index if not exists estoque_status_idx on public.estoque (status, criado_em desc);
create index if not exists estoque_modelo_idx on public.estoque (lower(marca), lower(modelo));
create index if not exists estoque_placa_idx  on public.estoque (upper(placa)) where placa is not null;

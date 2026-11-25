// De onde vêm as fotos ruins.
//
// O portão de visão não reconhece loja quando ela não escreve o nome: a revenda
// com logo de fênix na parede passou em 4 carros, em duas rodadas seguidas. Mas
// a foto de loja vem sempre do mesmo site. Então toda foto apagada (CRM ou
// script) fica registrada com o site de origem, e o site que só dá foto ruim é
// bloqueado ANTES do download, sem passar pela visão.
//
//   fotos_removidas    — log de cada remoção (alimenta o relatório)
//   fontes_bloqueadas  — domínios barrados; editável sem deploy:
//     node scripts/fontes-fotos.js                     # relatório
//     node scripts/fontes-fotos.js --bloquear=dominio.com --motivo="loja"
//
// Banco fora do ar não pode travar foto: todo erro aqui é engolido.

import { q, exec } from './db.js';

export function dominioDe(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

let _pronta = null;
function garanteTabelas() {
  _pronta ||= exec(`
    create table if not exists fotos_removidas (
      id           bigserial primary key,
      key          text not null,
      url          text not null,
      view         text,
      source_page  text,
      dominio      text,          -- da página de origem (ou da imagem, sem página)
      vitrine      boolean not null default false,
      removida_em  timestamptz not null default now()
    );
    create index if not exists fotos_removidas_dominio on fotos_removidas (dominio);
    create table if not exists fontes_bloqueadas (
      dominio    text primary key,
      motivo     text,
      criado_em  timestamptz not null default now()
    );`).catch(e => { _pronta = null; throw e; });
  return _pronta;
}

// Registra uma foto apagada. Não espera o banco.
export function registraRemocao(key, im) {
  if (!im) return;
  const origem = im.sourcePage || im.page || null;
  garanteTabelas()
    .then(() => exec(
      `insert into fotos_removidas (key, url, view, source_page, dominio, vitrine)
       values ($1, $2, $3, $4, $5, $6)`,
      [key, im.url, im.view || null, origem, dominioDe(origem || ''), !!im.vitrine]
    ))
    .catch(e => console.warn(`[fontes-fotos] registro da remoção falhou: ${e.message}`));
}

// Cache em memória dos domínios bloqueados, recarregado a cada 10 min — o
// filtro roda por candidato e precisa ser síncrono.
const RECARGA_MS = 10 * 60_000;
let _bloqueados = new Set();
let _carregadoEm = 0;
let _carregando = null;

export async function carregaBloqueados(forcar = false) {
  if (!forcar && Date.now() - _carregadoEm < RECARGA_MS) return _bloqueados;
  _carregando ||= (async () => {
    try {
      await garanteTabelas();
      const rows = await q('select dominio from fontes_bloqueadas');
      _bloqueados = new Set(rows.map(r => r.dominio.toLowerCase()));
    } catch (e) {
      console.warn(`[fontes-fotos] leitura dos bloqueados falhou: ${e.message}`);
    } finally {
      _carregadoEm = Date.now();
      _carregando = null;
    }
  })();
  await _carregando;
  return _bloqueados;
}

// Bloqueado se o domínio (ou um pai dele: "loja.com.br" bloqueia
// "fotos.loja.com.br") estiver na tabela. Olha a imagem e a página.
export function fonteBloqueada(im) {
  if (!_bloqueados.size) return false;
  for (const u of [im.page, im.sourcePage, im.url]) {
    let d = dominioDe(u || '');
    while (d && d.includes('.')) {
      if (_bloqueados.has(d)) return true;
      d = d.slice(d.indexOf('.') + 1);
    }
  }
  return false;
}

export async function bloqueia(dominio, motivo = null) {
  await garanteTabelas();
  await exec(
    `insert into fontes_bloqueadas (dominio, motivo) values ($1, $2)
     on conflict (dominio) do update set motivo = coalesce(excluded.motivo, fontes_bloqueadas.motivo)`,
    [dominio.toLowerCase().replace(/^www\./, ''), motivo]
  );
  _carregadoEm = 0;
}

// Relatório: domínios com foto removida, quantas removidas, em quantos carros,
// e quantas fotos desse domínio continuam no ar (taxa de rejeição).
export async function relatorio() {
  await garanteTabelas();
  const removidas = await q(
    `select dominio, count(*)::int as removidas, count(distinct key)::int as carros
       from fotos_removidas where dominio <> '' group by 1 order by 2 desc`
  );
  const noAr = new Map((await q(
    `select e->>'sourcePage' as page from car_images_cache c, jsonb_array_elements(c.images) e
      where e->>'sourcePage' is not null`
  )).reduce((m, r) => { const d = dominioDe(r.page); m.set(d, (m.get(d) || 0) + 1); return m; }, new Map()));
  const bloqueados = await carregaBloqueados(true);
  return removidas.map(r => ({ ...r, noAr: noAr.get(r.dominio) || 0, bloqueado: bloqueados.has(r.dominio) }));
}

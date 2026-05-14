import Fuse from 'fuse.js';
import { getMarcas, getModelos, getAnos, getPreco } from './fipe.js';

let _marcasFuse = null;

async function buildMarcasFuse() {
  if (_marcasFuse) return _marcasFuse;
  const marcas = await getMarcas();
  _marcasFuse = new Fuse(marcas, {
    keys: ['nome'],
    threshold: 0.4,
    includeScore: true,
  });
  return _marcasFuse;
}

export async function findMarca(name) {
  if (!name) return null;
  const fuse = await buildMarcasFuse();
  const [hit] = fuse.search(name, { limit: 1 });
  if (!hit) return null;
  return { id: hit.item.codigo, nome: hit.item.nome, score: hit.score };
}

const _modelosFuseCache = new Map();

async function buildModelosFuse(marcaId) {
  if (_modelosFuseCache.has(marcaId)) return _modelosFuseCache.get(marcaId);
  const modelos = await getModelos(marcaId);
  const fuse = new Fuse(modelos, {
    keys: ['nome'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });
  _modelosFuseCache.set(marcaId, fuse);
  return fuse;
}

export async function findModelo(marcaId, name) {
  if (!name) return null;
  const fuse = await buildModelosFuse(marcaId);
  const [hit] = fuse.search(name, { limit: 1 });
  if (!hit) return null;
  return { id: hit.item.codigo, nome: hit.item.nome, score: hit.score };
}

export async function findModelosCandidatos(marcaId, name, limit = 5) {
  if (!name) return [];
  const fuse = await buildModelosFuse(marcaId);
  return fuse.search(name, { limit }).map(h => ({ id: h.item.codigo, nome: h.item.nome, score: h.score }));
}

export async function findAno(marcaId, modeloId, targetYear, { allowZeroKm = false, anoMin = null } = {}) {
  const anos = await getAnos(marcaId, modeloId);
  const list = anos
    .filter(a => allowZeroKm || !String(a.codigo).startsWith('32000'))
    .map(a => {
      const yearStr = String(a.codigo).split('-')[0];
      return { ...a, year: parseInt(yearStr, 10) };
    })
    .filter(a => Number.isFinite(a.year));

  if (list.length === 0) return null;

  // Se há anoMin e o targetYear é menor, eleva o alvo pro anoMin (LLM provavelmente chutou ano errado)
  const effectiveTarget = anoMin && targetYear < anoMin ? anoMin : targetYear;

  // Se exigimos anoMin, descarta tudo abaixo
  const eligible = anoMin ? list.filter(a => a.year >= anoMin) : list;
  if (eligible.length === 0) return null; // modelo só existe em anos < anoMin → genuinamente velho

  // Match exato no alvo efetivo
  const exact = eligible.find(a => a.year === effectiveTarget);
  if (exact) return { id: exact.codigo, nome: exact.nome, year: exact.year };

  // Senão, mais próximo do alvo efetivo (preferindo o mais novo em empate)
  const sorted = [...eligible].sort((x, y) => {
    const dx = Math.abs(x.year - effectiveTarget);
    const dy = Math.abs(y.year - effectiveTarget);
    if (dx !== dy) return dx - dy;
    return y.year - x.year; // empate: mais novo
  });
  const top = sorted[0];
  return { id: top.codigo, nome: top.nome, year: top.year };
}

function parseValor(valor) {
  if (typeof valor !== 'string') return null;
  const digits = valor.replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

export async function resolveCandidate({ marca, modelo, ano }, { anoMin = null } = {}) {
  const m = await findMarca(marca);
  if (!m) return { ok: false, reason: 'marca_not_found', input: { marca, modelo, ano } };

  // Tenta os top 5 modelos candidatos do Fuse, retornando o primeiro que tem ano dentro do anoMin.
  // Necessário porque "Hilux SR" pode bater em SW4/SRV (que não têm o ano), e a 1ª escolha morre.
  const modelos = await findModelosCandidatos(m.id, modelo, 10);
  if (modelos.length === 0) return { ok: false, reason: 'modelo_not_found', input: { marca, modelo, ano }, partial: { marca: m } };

  let mdEscolhido = null;
  let yrEscolhido = null;
  for (const md of modelos) {
    const yr = await findAno(m.id, md.id, ano, { anoMin });
    if (yr) {
      mdEscolhido = md;
      yrEscolhido = yr;
      break;
    }
  }

  if (!mdEscolhido) {
    return { ok: false, reason: 'ano_not_found', input: { marca, modelo, ano }, partial: { marca: m, modelo: modelos[0] } };
  }

  const preco = await getPreco(m.id, mdEscolhido.id, yrEscolhido.id);
  return {
    ok: true,
    fipe: {
      marca: m.nome,
      modelo: mdEscolhido.nome,
      anoModelo: yrEscolhido.year,
      anoNome: yrEscolhido.nome,
      precoTexto: preco.Valor,
      preco: parseValor(preco.Valor),
      codigoFipe: preco.CodigoFipe,
      mesReferencia: preco.MesReferencia,
      combustivel: preco.Combustivel,
    },
    matchScores: { marca: m.score, modelo: mdEscolhido.score },
    ids: { marca: m.id, modelo: mdEscolhido.id, ano: yrEscolhido.id },
  };
}

export async function resolveCandidates(candidates, { concurrency = 6, anoMin = null } = {}) {
  const results = new Array(candidates.length);
  let i = 0;
  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      try {
        results[idx] = await resolveCandidate(candidates[idx], { anoMin });
      } catch (e) {
        results[idx] = { ok: false, reason: 'error', error: e.message, input: candidates[idx] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}

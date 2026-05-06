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
    threshold: 0.45,
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

export async function findAno(marcaId, modeloId, targetYear, { allowZeroKm = false } = {}) {
  const anos = await getAnos(marcaId, modeloId);
  const list = anos
    .filter(a => allowZeroKm || !String(a.codigo).startsWith('32000'))
    .map(a => {
      const yearStr = String(a.codigo).split('-')[0];
      return { ...a, year: parseInt(yearStr, 10) };
    })
    .filter(a => Number.isFinite(a.year));

  if (list.length === 0) return null;

  const exact = list.find(a => a.year === targetYear);
  if (exact) return { id: exact.codigo, nome: exact.nome, year: exact.year };

  const olderOrEqual = list.filter(a => a.year <= targetYear).sort((x, y) => y.year - x.year);
  if (olderOrEqual.length > 0) {
    const top = olderOrEqual[0];
    return { id: top.codigo, nome: top.nome, year: top.year };
  }

  const oldest = [...list].sort((x, y) => x.year - y.year)[0];
  return { id: oldest.codigo, nome: oldest.nome, year: oldest.year };
}

function parseValor(valor) {
  if (typeof valor !== 'string') return null;
  const digits = valor.replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

export async function resolveCandidate({ marca, modelo, ano }) {
  const m = await findMarca(marca);
  if (!m) return { ok: false, reason: 'marca_not_found', input: { marca, modelo, ano } };

  const md = await findModelo(m.id, modelo);
  if (!md) return { ok: false, reason: 'modelo_not_found', input: { marca, modelo, ano }, partial: { marca: m } };

  const yr = await findAno(m.id, md.id, ano);
  if (!yr) return { ok: false, reason: 'ano_not_found', input: { marca, modelo, ano }, partial: { marca: m, modelo: md } };

  const preco = await getPreco(m.id, md.id, yr.id);
  return {
    ok: true,
    fipe: {
      marca: m.nome,
      modelo: md.nome,
      anoModelo: yr.year,
      anoNome: yr.nome,
      precoTexto: preco.Valor,
      preco: parseValor(preco.Valor),
      codigoFipe: preco.CodigoFipe,
      mesReferencia: preco.MesReferencia,
      combustivel: preco.Combustivel,
    },
    matchScores: { marca: m.score, modelo: md.score },
    ids: { marca: m.id, modelo: md.id, ano: yr.id },
  };
}

export async function resolveCandidates(candidates, { concurrency = 6 } = {}) {
  const results = new Array(candidates.length);
  let i = 0;
  async function worker() {
    while (i < candidates.length) {
      const idx = i++;
      try {
        results[idx] = await resolveCandidate(candidates[idx]);
      } catch (e) {
        results[idx] = { ok: false, reason: 'error', error: e.message, input: candidates[idx] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return results;
}

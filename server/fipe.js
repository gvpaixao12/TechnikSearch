import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');
const BASE = 'https://parallelum.com.br/fipe/api/v1/carros';

const TTL = {
  marcas: 7 * 24 * 60 * 60 * 1000,
  modelos: 7 * 24 * 60 * 60 * 1000,
  anos: 24 * 60 * 60 * 1000,
  preco: 6 * 60 * 60 * 1000,
};

async function readCache(file) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
    const { savedAt, data } = JSON.parse(raw);
    return { savedAt, data };
  } catch {
    return null;
  }
}

async function writeCache(file, data) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const payload = JSON.stringify({ savedAt: Date.now(), data });
  await fs.writeFile(path.join(CACHE_DIR, file), payload, 'utf8');
}

async function cachedFetch(file, ttl, url) {
  const hit = await readCache(file);
  if (hit && Date.now() - hit.savedAt < ttl) return hit.data;

  const res = await fetch(url, { headers: { 'User-Agent': 'TechnikSearch/0.1' } });
  if (!res.ok) throw new Error(`FIPE ${res.status} on ${url}`);
  const data = await res.json();
  await writeCache(file, data);
  return data;
}

export function getMarcas() {
  return cachedFetch('marcas.json', TTL.marcas, `${BASE}/marcas`);
}

export function getModelos(marcaId) {
  return cachedFetch(
    `modelos-${marcaId}.json`,
    TTL.modelos,
    `${BASE}/marcas/${marcaId}/modelos`,
  ).then(d => d.modelos ?? d);
}

export function getAnos(marcaId, modeloId) {
  return cachedFetch(
    `anos-${marcaId}-${modeloId}.json`,
    TTL.anos,
    `${BASE}/marcas/${marcaId}/modelos/${modeloId}/anos`,
  );
}

export function getPreco(marcaId, modeloId, anoId) {
  const safe = String(anoId).replace(/[^\w-]/g, '_');
  return cachedFetch(
    `preco-${marcaId}-${modeloId}-${safe}.json`,
    TTL.preco,
    `${BASE}/marcas/${marcaId}/modelos/${modeloId}/anos/${anoId}`,
  );
}

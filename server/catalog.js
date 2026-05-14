/* Carrega o catálogo FIPE pré-computado (server/data/catalog.json).
 * Lazy + singleton em memória.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'data', 'catalog.json');

let _cache = null;
let _loadingPromise = null;

export async function loadCatalog() {
  if (_cache) return _cache;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    try {
      const raw = await fs.readFile(FILE, 'utf8');
      const data = JSON.parse(raw);
      _cache = data;
      console.log(`[catalog] carregado: ${data.entries.length} entries (built ${data.builtAt})`);
      return data;
    } catch (e) {
      throw new Error(`Catálogo não encontrado em ${FILE}. Rode: node server/scripts/build-catalog.js  (erro: ${e.message})`);
    }
  })();

  return _loadingPromise;
}

export function clearCatalogCache() {
  _cache = null;
  _loadingPromise = null;
}

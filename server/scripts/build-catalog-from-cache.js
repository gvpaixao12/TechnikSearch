/* Constrói o catálogo SOMENTE a partir dos arquivos de cache local em server/cache/.
 * Não faz nenhum request à FIPE. Útil quando o IP foi rate-limited.
 *
 * Saída: server/data/catalog.json
 *
 * Rodar: node server/scripts/build-catalog-from-cache.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTipo, classifyFuel } from '../classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');

const ANO_MIN = 2018;

function parsePreco(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseAnoFromCode(code) {
  const yearStr = String(code).split('-')[0];
  const y = parseInt(yearStr, 10);
  return Number.isFinite(y) ? y : null;
}

async function readJsonCache(file) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, file), 'utf8');
    const { data } = JSON.parse(raw);
    return data;
  } catch { return null; }
}

async function main() {
  console.log(`Build de catálogo SOMENTE A PARTIR DO CACHE — ano >= ${ANO_MIN}`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const marcas = await readJsonCache('marcas.json');
  if (!marcas) { console.error('Cache de marcas não encontrado.'); process.exit(1); }

  const marcasById = new Map(marcas.map(m => [String(m.codigo), m]));

  const allFiles = await fs.readdir(CACHE_DIR);
  const precoFiles = allFiles.filter(f => f.startsWith('preco-'));

  console.log(`${marcas.length} marcas no cache`);
  console.log(`${precoFiles.length} arquivos de preço cacheados\n`);

  const catalog = [];
  const tipoStats = {};
  const modelosCache = new Map();

  async function getModelosCached(marcaId) {
    if (modelosCache.has(marcaId)) return modelosCache.get(marcaId);
    const data = await readJsonCache(`modelos-${marcaId}.json`);
    if (!data) return null;
    const lista = data.modelos ?? data;
    modelosCache.set(marcaId, lista);
    return lista;
  }

  for (const file of precoFiles) {
    const m = file.match(/^preco-(\d+)-(\d+)-(.+)\.json$/);
    if (!m) continue;
    const [_, marcaId, modeloId, anoCode] = m;

    const ano = parseAnoFromCode(anoCode);
    if (!ano || ano < ANO_MIN) continue;

    const preco = await readJsonCache(file);
    if (!preco?.Valor) continue;

    const marca = marcasById.get(marcaId);
    if (!marca) continue;

    const modelos = await getModelosCached(marcaId);
    if (!modelos) continue;
    const modelo = modelos.find(md => String(md.codigo) === modeloId);
    if (!modelo) continue;

    const fullName = `${marca.nome} ${modelo.nome}`;
    const tipo = classifyTipo(fullName);
    const combustivel = classifyFuel(fullName, preco.Combustivel);
    tipoStats[tipo] = (tipoStats[tipo] || 0) + 1;

    catalog.push({
      marca: marca.nome,
      modelo: modelo.nome,
      ano,
      tipo,
      combustivel,
      preco: parsePreco(preco.Valor),
      precoTexto: preco.Valor,
      codigoFipe: preco.CodigoFipe,
      marcaId: marca.codigo,
      modeloId: modelo.codigo,
      anoId: anoCode,
      mesReferencia: preco.MesReferencia,
    });
  }

  await fs.writeFile(OUT_FILE, JSON.stringify({
    version: 1,
    builtAt: new Date().toISOString(),
    builtFrom: 'cache-only',
    anoMin: ANO_MIN,
    stats: { entries: catalog.length, tipos: tipoStats },
    entries: catalog,
  }, null, 0), 'utf8');

  console.log('══════════════════════════════════════');
  console.log(`✓ Catálogo (parcial, do cache): ${catalog.length} entries`);
  console.log('  tipos:', tipoStats);
  console.log(`  arquivo: ${OUT_FILE}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

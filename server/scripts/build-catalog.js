/* Build offline do catálogo FIPE.
 * Varre top marcas BR, todos os modelos, anos >= 2018, salva preço + tipo classificado.
 * Saída: server/data/catalog.json
 *
 * Rodar: node server/scripts/build-catalog.js [--all-brands]
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMarcas, getModelos, getAnos, getPreco } from '../fipe.js';
import { classifyTipo, classifyFuel } from '../classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');

const ANO_MIN = 2005;
const ALL_BRANDS = process.argv.includes('--all-brands');

// Top marcas vendidas no BR — cobre ~95% do mercado
// Ordem: populares primeiro (menores e mais úteis), premium depois (catálogo grande)
const TOP_BRANDS_ORDERED = [
  'vw - volkswagen', 'volkswagen',
  'fiat',
  'gm - chevrolet', 'chevrolet',
  'hyundai', 'toyota', 'honda',
  'jeep', 'renault', 'nissan', 'ford',
  'mitsubishi', 'kia motors', 'kia',
  'caoa chery', 'chery', 'haval', 'gwm', 'byd',
  'peugeot', 'citroen', 'citroën',
  'ram', 'dodge',
  'mini', 'volvo', 'land rover',
  'bmw', 'audi', 'mercedes-benz',
  'porsche', 'lexus', 'jaguar',
  'subaru', 'ssangyong',
];
const TOP_BRANDS = new Set(TOP_BRANDS_ORDERED);

// (regras movidas pra ../classify.js — compartilhadas com build-catalog-from-cache.js)

function parsePreco(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isZeroKmCode(code) {
  return String(code).startsWith('32000');
}

function parseAnoFromCode(code) {
  const yearStr = String(code).split('-')[0];
  const y = parseInt(yearStr, 10);
  return Number.isFinite(y) ? y : null;
}

// Rate limiter global: max 3 requests/segundo (FIPE Parallelum limita ~5 req/s, deixa margem)
const RATE_INTERVAL_MS = 350;
let lastRequestAt = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + RATE_INTERVAL_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function ts() { return new Date().toLocaleTimeString('pt-BR', { hour12: false }); }

async function withRetry(fn, label, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await rateLimit();
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const is429 = e.message?.includes('429');
      const wait = is429 ? 5000 * (i + 1) : 1500 * (i + 1);
      if (i === attempts - 1 || !is429) {
        console.warn(`  [${ts()}] [retry ${i + 1}/${attempts}] ${label}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function main() {
  console.log(`Build de catálogo FIPE — ano >= ${ANO_MIN}, ${ALL_BRANDS ? 'TODAS' : 'top BR'} marcas`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const marcas = await getMarcas();
  let marcasFiltered;
  if (ALL_BRANDS) {
    marcasFiltered = marcas;
  } else {
    // Ordena pela posição em TOP_BRANDS_ORDERED — populares primeiro
    const order = new Map(TOP_BRANDS_ORDERED.map((n, i) => [n, i]));
    marcasFiltered = marcas
      .filter(m => TOP_BRANDS.has(m.nome.toLowerCase()))
      .sort((a, b) => (order.get(a.nome.toLowerCase()) ?? 999) - (order.get(b.nome.toLowerCase()) ?? 999));
  }

  console.log(`${marcasFiltered.length} marcas a processar (de ${marcas.length} totais)\n`);

  // MERGE: carrega catálogo existente (se houver) e indexa por codigoFipe.
  // Cada marca processada faz upsert nas suas entries, preservando outras marcas.
  let catalog = [];
  try {
    const raw = await fs.readFile(OUT_FILE, 'utf8');
    const existing = JSON.parse(raw);
    catalog = existing.entries || [];
    console.log(`✓ catálogo existente carregado: ${catalog.length} entries (preservando ao processar)\n`);
  } catch {
    console.log('(sem catálogo prévio — começando do zero)\n');
  }

  let modelosTotal = 0, anosTotal = 0, errosTotal = 0;
  const tipoStats = {};

  for (let mi = 0; mi < marcasFiltered.length; mi++) {
    const marca = marcasFiltered[mi];
    console.log(`[${ts()}] [${mi + 1}/${marcasFiltered.length}] ${marca.nome}`);

    let modelos;
    try {
      modelos = await withRetry(() => getModelos(marca.codigo), `getModelos ${marca.nome}`);
    } catch (e) {
      console.warn(`  [${ts()}] ⚠ falha definitiva em modelos: ${e.message}`);
      errosTotal++;
      continue;
    }
    modelosTotal += modelos.length;

    // Coleta entries dessa marca em variável separada — depois faz merge no catalog
    const brandEntries = [];

    // Sequencial — o rate limiter global garante ~3 req/s
    const BATCH = 1;
    for (let bi = 0; bi < modelos.length; bi += BATCH) {
      const slice = modelos.slice(bi, bi + BATCH);
      const results = await Promise.all(slice.map(async md => {
        let anos;
        try {
          anos = await withRetry(() => getAnos(marca.codigo, md.codigo), `getAnos ${marca.nome}/${md.nome}`);
        } catch { errosTotal++; return []; }

        const anosUsados = anos
          .filter(a => !isZeroKmCode(a.codigo))
          .map(a => ({ ...a, year: parseAnoFromCode(a.codigo) }))
          .filter(a => a.year !== null && a.year >= ANO_MIN);

        const entries = [];
        // getPreco SEQUENCIAL dentro do mesmo modelo pra não estourar rate limit do FIPE
        for (const ano of anosUsados) {
          let preco;
          try {
            preco = await withRetry(() => getPreco(marca.codigo, md.codigo, ano.codigo), `getPreco ${marca.nome}/${md.nome}/${ano.nome}`);
          } catch { errosTotal++; continue; }
          const tipo = classifyTipo(`${marca.nome} ${md.nome}`);
          const combustivel = classifyFuel(`${marca.nome} ${md.nome}`, preco.Combustivel);
          tipoStats[tipo] = (tipoStats[tipo] || 0) + 1;
          entries.push({
            marca: marca.nome,
            modelo: md.nome,
            ano: ano.year,
            tipo,
            combustivel,
            preco: parsePreco(preco.Valor),
            precoTexto: preco.Valor,
            codigoFipe: preco.CodigoFipe,
            marcaId: marca.codigo,
            modeloId: md.codigo,
            anoId: ano.codigo,
            mesReferencia: preco.MesReferencia,
          });
        }
        anosTotal += anosUsados.length;
        return entries;
      }));
      results.forEach(entries => brandEntries.push(...entries));
      if ((bi + BATCH) % 10 === 0 || bi + BATCH >= modelos.length) {
        const cur = slice[slice.length - 1];
        console.log(`    [${ts()}] ${Math.min(bi + BATCH, modelos.length)}/${modelos.length} modelos · modelo atual: ${cur.nome} · +${brandEntries.length} entries (cat total: ${catalog.length + brandEntries.length})`);
      }
    }

    // MERGE: remove entries antigas dessa marca, adiciona as novas
    catalog = catalog.filter(e => e.marcaId !== marca.codigo).concat(brandEntries);

    // Salva incrementalmente a cada marca pra não perder progresso
    await fs.writeFile(OUT_FILE, JSON.stringify({
      version: 1,
      builtAt: new Date().toISOString(),
      anoMin: ANO_MIN,
      stats: { marcas: mi + 1, modelos: modelosTotal, anos: anosTotal, entries: catalog.length, erros: errosTotal, tipos: tipoStats },
      entries: catalog,
    }, null, 0), 'utf8');
  }

  console.log('\n══════════════════════════════════════');
  console.log('Catálogo finalizado:');
  console.log(`  ${catalog.length} entries`);
  console.log(`  ${modelosTotal} modelos consultados`);
  console.log(`  ${anosTotal} anos consultados`);
  console.log(`  ${errosTotal} erros`);
  console.log('  tipos:', tipoStats);
  console.log(`  arquivo: ${OUT_FILE}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

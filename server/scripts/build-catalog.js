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
import { classifyTipo, classifyFuel, isComercial } from '../classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');

const ANO_MIN = 2005;
const ALL_BRANDS = process.argv.includes('--all-brands');

// Top marcas vendidas no BR — cobre ~95% do mercado
// Ordem: populares primeiro (menores e mais úteis), premium depois (catálogo grande)
const TOP_BRANDS_ORDERED = [
  // Marcas populares/premium primeiro — VW vai por último por ter 547 modelos
  // e esgotar o rate limit da FIPE antes das outras marcas serem processadas.
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
  // Premium/exóticas (segmento 1mi+) — catálogos pequenos, ficam no fim
  'ferrari', 'lamborghini', 'mclaren', 'aston martin', 'maserati', 'lotus', 'rolls-royce',
  'vw - volkswagen', 'volkswagen', // por último — muitos modelos, consome rate limit
];
const TOP_BRANDS = new Set(TOP_BRANDS_ORDERED);

// Build direcionado: --brands=porsche,ferrari,... processa só essas marcas
// (casa pelo nome exato em minúsculas da FIPE). Útil pra preencher um segmento
// sem revarrer o catálogo inteiro. Sobrepõe a lista TOP_BRANDS.
const BRANDS_ARG = (process.argv.find(a => a.startsWith('--brands=')) || '').slice('--brands='.length);
const BRANDS_FILTER = BRANDS_ARG
  ? new Set(BRANDS_ARG.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  : null;

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

// Rate limiter global. Padrão 1500ms; afrouxa em builds grandes via FIPE_RATE_MS
// (ex.: FIPE_RATE_MS=4000) pra reduzir o risco de ban por volume acumulado.
const RATE_INTERVAL_MS = parseInt(process.env.FIPE_RATE_MS || '', 10) || 1500;
let lastRequestAt = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + RATE_INTERVAL_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function ts() {
  const d = new Date();
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour12: false });
}

async function withRetry(fn, label, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await rateLimit();
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const is429 = e.message?.includes('429');
      const wait = is429 ? 3000 * (i + 1) : 1000 * (i + 1);
      console.warn(`  [${ts()}] [retry ${i + 1}/${attempts}] ${label}: ${e.message}`);
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
  if (BRANDS_FILTER) {
    marcasFiltered = marcas.filter(m => BRANDS_FILTER.has(m.nome.toLowerCase()));
    console.log(`Build direcionado: ${marcasFiltered.map(m => m.nome).join(', ') || '(nenhuma marca casou)'}`);
  } else if (ALL_BRANDS) {
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

  // Índice de entradas já no catálogo — pula getPreco se marcaId|modeloId|anoId já existir.
  // Permite retomada sem repetir requests que já tiveram sucesso.
  const existingKeys = new Set(catalog.map(e => `${e.marcaId}|${e.modeloId}|${e.anoId}`));
  console.log(`  (${existingKeys.size} combinações já indexadas — serão puladas)\n`);

  let modelosTotal = 0, anosTotal = 0, errosTotal = 0, pulados = 0;
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
        // Pula comercial (caminhão/ônibus/furgão) — fora do escopo. Skip aqui
        // economiza getAnos + getPreco do modelo inteiro.
        if (isComercial(`${marca.nome} ${md.nome}`)) return [];
        let anos;
        try {
          anos = await withRetry(() => getAnos(marca.codigo, md.codigo), `getAnos ${marca.nome}/${md.nome}`);
        } catch { errosTotal++; return []; }

        const anosUsados = anos
          .filter(a => !isZeroKmCode(a.codigo))
          .map(a => ({ ...a, year: parseAnoFromCode(a.codigo) }))
          .filter(a => a.year !== null && a.year >= ANO_MIN);

        const entries = [];
        for (const ano of anosUsados) {
          // Pula se já temos esse modelo/ano no catálogo (retomada)
          if (existingKeys.has(`${marca.codigo}|${md.codigo}|${ano.codigo}`)) {
            const cached = catalog.find(e => e.marcaId === marca.codigo && e.modeloId === md.codigo && e.anoId === ano.codigo);
            if (cached) { entries.push(cached); pulados++; continue; }
          }
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

    // MERGE (upsert, NÃO-destrutivo): nunca remove entries existentes — só
    // insere/atualiza as buscadas nesta rodada, indexando por marca|modelo|ano.
    // Assim, se um modelo falhar (ex.: 429 no getAnos), os carros dele que já
    // estão no catálogo são PRESERVADOS em vez de sumirem. (O merge antigo fazia
    // "remove a marca → põe o que buscou"; sob 429 isso erodia o catálogo.)
    // Pra um rebuild limpo do zero, apague o catalog.json antes de rodar.
    if (brandEntries.length) {
      const ukey = e => `${e.marcaId}|${e.modeloId}|${e.anoId}`;
      const byKey = new Map(catalog.map(e => [ukey(e), e]));
      for (const e of brandEntries) byKey.set(ukey(e), e);
      catalog = [...byKey.values()];
    }

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
  console.log(`  ${pulados} pulados (já estavam no catálogo)`);
  console.log('  tipos:', tipoStats);
  console.log(`  arquivo: ${OUT_FILE}`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

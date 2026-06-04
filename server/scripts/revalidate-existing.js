// Re-valida com VISÃO todas as entradas do cache que ainda estão só na heurística
// (sem flag `vision`). NÃO faz busca nova na web — valida as fotos que já temos e
// descarta o que for de outro mercado/modelo ou com marca-d'água. Marca o que
// sobrar como vision-validado. Idempotente: entradas já validadas são puladas.
//
// Uso (de dentro de server/):
//   node scripts/revalidate-existing.js              # só as heurísticas
//   node scripts/revalidate-existing.js --all        # revalida tudo de novo
//   node scripts/revalidate-existing.js --limit 20   # testa num subconjunto
//   IMAGE_BUILD_CONCURRENCY=6 node scripts/revalidate-existing.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getOrBuildImages } from '../imageCache.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const reAll = args.includes('--all');
const limIdx = args.indexOf('--limit');
const limit = limIdx >= 0 ? Number(args[limIdx + 1]) : Infinity;
const CHUNK = Number(process.env.IMAGE_BUILD_CONCURRENCY) || 6;

const { data, error } = await sb.from('car_images_cache').select('key,marca,modelo,ano,images');
if (error) { console.error('erro lendo cache:', error.message); process.exit(1); }

let rows = (data || []).filter(r => (r.images || []).length > 0);
if (!reAll) rows = rows.filter(r => !(r.images || []).some(im => im.vision === true));
rows = rows.slice(0, limit);

console.log(`re-validando ${rows.length} entradas (chunk=${CHUNK}, reAll=${reAll})...`);
const t0 = Date.now();
let done = 0, totalBefore = 0, totalAfter = 0, zeroFront = 0, ficaramVazias = 0;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  await Promise.all(chunk.map(async r => {
    const before = (r.images || []).length;
    try {
      const res = await getOrBuildImages({ marca: r.marca, modelo: r.modelo, ano: r.ano, skipVision: false });
      const imgs = res.images || [];
      const after = imgs.length;
      totalBefore += before; totalAfter += after; done++;
      if (after === 0) ficaramVazias++;
      else if (!imgs.some(im => im.view === 'front')) zeroFront++;
      console.log(`[${done}/${rows.length}] ${r.marca} ${r.modelo} ${r.ano}: ${before}→${after}${after && !imgs.some(im => im.view === 'front') ? '  (sem frente!)' : ''}`);
    } catch (e) {
      done++;
      console.warn(`[${done}/${rows.length}] ${r.key} ERRO: ${e.message}`);
    }
  }));
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\n=== FIM em ${mins} min ===`);
console.log(`carros: ${done} | fotos ${totalBefore} → ${totalAfter}`);
console.log(`ficaram vazias (placeholder): ${ficaramVazias} | sem foto de frente: ${zeroFront}`);
console.log(`(esses são os que mais se beneficiam do Serper depois)`);

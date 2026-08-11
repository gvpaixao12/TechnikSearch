// Remove arquivos ÓRFÃOS do bucket car-images: objetos que existem no storage
// mas NÃO são referenciados por nenhuma linha do índice (car_images_cache).
// Sobra de rebuilds/revalidações do portão de visão, que trocam o índice sem
// apagar os arquivos antigos. São espaço morto — nenhum app aponta pra eles.
//
// Uso:
//   node scripts/cleanup-orphans.js                 # DRY-RUN: lista quantas/quanto, não apaga
//   node scripts/cleanup-orphans.js --apply         # apaga de verdade (IRREVERSÍVEL)
//   node scripts/cleanup-orphans.js --apply --except=key1,key2   # preserva esses carros inteiros
//
// SEGURANÇA: só considera órfão o que está DENTRO de uma pasta <key>/ e não bate
// com nenhuma URL do índice. Chaves em --except são puladas por completo.
import 'dotenv/config';
import { getSupabase } from '../imageCache.js';
import { pathFromUrl, listPrefix, listFolders, removeObjects } from '../storage.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const exceptArg = args.find(a => a.startsWith('--except='));
// Por padrão preserva a Porsche 911 GT3 2025 (decisão do usuário: deixar de fora).
const EXCEPT = new Set(
  (exceptArg ? exceptArg.split('=')[1].split(',') : ['porsche__911-gt3-4-0-500cv-510cv-991-992__2025'])
    .map(s => s.trim()).filter(Boolean)
);

const sb = getSupabase();
const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : (b / (1 << 10)).toFixed(0) + ' KB';

// 1) Conjunto de TODOS os caminhos referenciados pelo índice.
async function referencedPaths() {
  const ref = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('car_images_cache').select('images').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    for (const r of data) for (const im of (r.images || [])) {
      const p = pathFromUrl(im?.url); if (p) ref.add(p);
    }
    if (data.length < 1000) break;
  }
  return ref;
}

// 2) Pastas top-level (keys) do bucket vêm de storage.listFolders().

const t0 = Date.now();
console.log('Lendo caminhos referenciados no índice...');
const ref = await referencedPaths();
console.log(`  ${ref.size} arquivos referenciados.`);
console.log('Listando pastas do bucket...');
const folders = await listFolders();
console.log(`  ${folders.length} pastas. Procurando órfãos${EXCEPT.size ? ` (preservando: ${[...EXCEPT].join(', ')})` : ''}...\n`);

const orphans = [];          // { path, size }
let scanned = 0, preserved = 0;
const CONC = 8;
for (let i = 0; i < folders.length; i += CONC) {
  const batch = folders.slice(i, i + CONC);
  await Promise.all(batch.map(async key => {
    if (EXCEPT.has(key)) { preserved++; return; }
    for (const f of await listPrefix(`${key}/`)) {
      if (!ref.has(f.path)) orphans.push({ path: f.path, size: f.size });
    }
  }));
  scanned += batch.length;
  if (scanned % 200 === 0 || scanned >= folders.length) process.stdout.write(`\r  ${scanned}/${folders.length} pastas varridas`);
}
console.log('');

const totalBytes = orphans.reduce((s, o) => s + o.size, 0);
console.log(`\n=== ÓRFÃOS ENCONTRADOS ===`);
console.log(`Arquivos órfãos:   ${orphans.length}`);
console.log(`Espaço ocupado:    ${fmt(totalBytes)}`);
console.log(`Pastas preservadas (--except): ${preserved}`);
console.log('\nAmostra:');
for (const o of orphans.slice(0, 12)) console.log(`  ${fmt(o.size).padStart(8)}  ${o.path}`);
if (orphans.length > 12) console.log(`  ... +${orphans.length - 12}`);

if (!APPLY) {
  console.log(`\nDRY-RUN — nada apagado. Pra apagar: node scripts/cleanup-orphans.js --apply`);
} else {
  console.log(`\n=== APAGANDO (irreversível) ===`);
  let removed = 0;
  const CHUNK = 500;
  for (let i = 0; i < orphans.length; i += CHUNK) {
    const paths = orphans.slice(i, i + CHUNK).map(o => o.path);
    try { removed += await removeObjects(paths); }
    catch (e) { console.warn(`  ! chunk ${i}: ${e.message}`); continue; }
    process.stdout.write(`\r  ${removed}/${orphans.length} apagados`);
  }
  console.log(`\n\nRemovidos: ${removed} arquivos, liberou ~${fmt(totalBytes)}.`);
  console.log('Rode scripts/diag-storage-size.js pra confirmar o novo total.');
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);

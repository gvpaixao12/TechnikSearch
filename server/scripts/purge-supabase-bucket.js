// Esvazia o bucket car-images do SUPABASE depois que o acervo já está no R2.
// Complementa o --purge-supabase do migrate-storage-to-r2.js, que só apaga o
// que ele mesmo migrou na execução corrente — inútil quando a migração já
// terminou numa rodada anterior.
//
// Uso (de dentro de server/):
//   node scripts/purge-supabase-bucket.js            # DRY-RUN: conta e mede, não apaga
//   node scripts/purge-supabase-bucket.js --apply    # apaga (IRREVERSÍVEL)
//
// DUAS TRAVAS antes de apagar qualquer coisa — se qualquer uma falhar, aborta:
//   1) nenhuma linha do índice ainda aponta pra URL do Supabase;
//   2) TODA foto referenciada no índice existe de fato no R2.
// Ou seja: só apaga o que comprovadamente já tem substituto servindo.
import 'dotenv/config';
import { getSupabase } from '../supabase.js';
import { listPrefix, pathFromUrl, isLegacyUrl } from '../storage.js';

const BUCKET = 'car-images';
const APPLY = process.argv.includes('--apply');
const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB' : (b / (1 << 10)).toFixed(0) + ' KB';

const sb = getSupabase();

async function indexRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('car_images_cache').select('key,images').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

console.log('=== TRAVAS DE SEGURANÇA ===');
const rows = await indexRows();
const inR2 = new Set((await listPrefix('')).map(o => o.path));
let total = 0, legacy = 0, missing = 0;
for (const r of rows) for (const im of (r.images || [])) {
  total++;
  if (isLegacyUrl(im.url)) { legacy++; continue; }
  const p = pathFromUrl(im.url);
  if (!p || !inR2.has(p)) missing++;
}
console.log(`  Fotos no índice:        ${total}`);
console.log(`  Objetos no R2:          ${inR2.size}`);
console.log(`  Ainda apontando p/ Supabase: ${legacy}   ${legacy === 0 ? '✓' : '✗'}`);
console.log(`  Ausentes no R2:         ${missing}   ${missing === 0 ? '✓' : '✗'}`);
if (legacy > 0 || missing > 0) {
  console.error('\nABORTADO: o acervo no R2 não está completo. Rode migrate-storage-to-r2.js primeiro.');
  process.exit(1);
}

// Varre o bucket do Supabase (pastas top-level → arquivos de cada pasta).
console.log('\n=== VARRENDO O BUCKET DO SUPABASE ===');
const folders = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(error.message);
  if (!data || !data.length) break;
  for (const o of data) if (o.id === null) folders.push(o.name);
  if (data.length < 1000) break;
}
console.log(`  ${folders.length} pastas.`);

const paths = [];
let bytes = 0, scanned = 0;
const CONC = 8;
for (let i = 0; i < folders.length; i += CONC) {
  await Promise.all(folders.slice(i, i + CONC).map(async key => {
    const { data } = await sb.storage.from(BUCKET).list(key, { limit: 1000 });
    for (const f of (data || [])) {
      if (f.id === null) continue;
      paths.push(`${key}/${f.name}`);
      bytes += f?.metadata?.size || 0;
    }
  }));
  scanned += Math.min(CONC, folders.length - i);
  if (scanned % 200 === 0 || scanned >= folders.length) process.stdout.write(`\r  ${scanned}/${folders.length} pastas varridas`);
}
console.log(`\n  ${paths.length} arquivos, ${fmt(bytes)}.`);

if (!APPLY) {
  console.log(`\nDRY-RUN — nada apagado. Pra apagar: node scripts/purge-supabase-bucket.js --apply`);
  process.exit(0);
}

console.log(`\n=== APAGANDO (IRREVERSÍVEL) ===`);
let removed = 0;
for (let i = 0; i < paths.length; i += 200) {
  const chunk = paths.slice(i, i + 200);
  const { error } = await sb.storage.from(BUCKET).remove(chunk);
  if (error) { console.warn(`\n  ! chunk ${i}: ${error.message}`); continue; }
  removed += chunk.length;
  process.stdout.write(`\r  ${removed}/${paths.length} apagados`);
}
console.log(`\n\nRemovidos ${removed} arquivos (~${fmt(bytes)} liberados no Supabase).`);
console.log('As pastas vazias somem sozinhas. O bucket pode ser deletado no painel se quiser.');

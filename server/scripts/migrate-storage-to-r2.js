// Migra o acervo de fotos do Supabase Storage → Cloudflare R2, mantendo os
// mesmos caminhos (`<key>/<vista>-NN.avif`) e reapontando o índice no Postgres.
//
// Uso (de dentro de server/):
//   node scripts/migrate-storage-to-r2.js                  # DRY-RUN: mede o que falta, não grava
//   node scripts/migrate-storage-to-r2.js --apply          # migra tudo
//   node scripts/migrate-storage-to-r2.js --apply --limit=50    # rollout em etapas
//   node scripts/migrate-storage-to-r2.js --apply --conc=8      # mais paralelismo
//   node scripts/migrate-storage-to-r2.js --apply --purge-supabase  # apaga do Supabase depois de migrar
//
// SEGURO RE-RODAR: fotos que já estão no R2 são puladas (idempotente). Por carro
// a ordem é sempre: baixa do Supabase → sobe no R2 → só então atualiza o índice.
// Se algo falhar no meio, a linha continua apontando pro Supabase e a próxima
// execução retoma — o app nunca fica apontando pra arquivo inexistente.
//
// --purge-supabase é OPCIONAL e vem depois: só apaga arquivos cuja URL nova já
// está gravada no índice. Recomendo migrar tudo, conferir o app, e só então
// rodar com --purge pra liberar o espaço lá.
import 'dotenv/config';
import { getSupabase } from '../supabase.js';
import { putObject, pathFromUrl, isLegacyUrl, publicBase } from '../storage.js';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d) => { const a = args.find(x => x.startsWith(f + '=')); return a ? a.split('=')[1] : d; };
const APPLY = has('--apply');
const PURGE = has('--purge-supabase');
const LIMIT = val('--limit', null) ? parseInt(val('--limit'), 10) : null;
const CONC = val('--conc', null) ? parseInt(val('--conc'), 10) : 6;
const ONLY_KEY = val('--key', null);

const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB'
  : (b / (1 << 10)).toFixed(0) + ' KB';

const supabase = getSupabase();

// content-type pelo sufixo — o acervo é .avif, mas pode ter .webp não-migrado.
function contentTypeOf(path) {
  if (/\.avif$/i.test(path)) return 'image/avif';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.png$/i.test(path)) return 'image/png';
  return 'application/octet-stream';
}

async function fetchBytes(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'TechnikMigrate/1.0' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function allRows() {
  const PAGE = 1000, rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('car_images_cache').select('key, images')
      .order('key', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Migra um carro. Retorna { bytes, moved, skipped, failed, purgeable }.
async function migrateRow(row, dry) {
  const images = Array.isArray(row.images) ? row.images : [];
  let bytes = 0, moved = 0, skipped = 0, failed = 0;
  const newImages = [];
  const purgeable = []; // caminhos no Supabase que já têm cópia confirmada no R2

  for (const im of images) {
    if (!im?.url || !isLegacyUrl(im.url)) { newImages.push(im); skipped++; continue; }
    const path = pathFromUrl(im.url);
    if (!path) { newImages.push(im); skipped++; continue; }

    let buf;
    try { buf = await fetchBytes(im.url); }
    catch (e) {
      console.warn(`  ! ${path}: ${e.message} — mantendo no Supabase`);
      newImages.push(im); failed++; continue;
    }
    bytes += buf.length;

    if (dry) { newImages.push(im); moved++; continue; }

    try {
      const url = await putObject({ path, body: buf, contentType: contentTypeOf(path) });
      newImages.push({ ...im, url });
      purgeable.push(path);
      moved++;
    } catch (e) {
      console.warn(`  ! upload R2 ${path}: ${e.message} — mantendo no Supabase`);
      newImages.push(im); failed++;
    }
  }

  // Só reescreve o índice se alguma URL mudou de fato.
  if (!dry && moved > 0) {
    const { error } = await supabase.from('car_images_cache')
      .update({ images: newImages }).eq('key', row.key);
    if (error) {
      console.warn(`  ! update índice ${row.key}: ${error.message} — NÃO vou marcar pra purge`);
      return { bytes, moved, skipped, failed, purgeable: [] };
    }
  }
  return { bytes, moved, skipped, failed, purgeable };
}

const t0 = Date.now();
console.log('Lendo índice (car_images_cache)...');
const rows = await allRows();
let pending = rows.filter(r => (r.images || []).some(im => isLegacyUrl(im?.url)));
if (ONLY_KEY) {
  pending = pending.filter(r => r.key === ONLY_KEY);
  if (!pending.length) { console.log(`--key=${ONLY_KEY}: nada pendente (não existe ou já está no R2).`); process.exit(0); }
}
const totalPhotos = pending.reduce((s, r) => s + (r.images || []).filter(im => isLegacyUrl(im?.url)).length, 0);
console.log(`${rows.length} carros no índice; ${pending.length} ainda com foto no Supabase (${totalPhotos} fotos).`);
if (pending.length === 0) { console.log('\nNada a migrar — acervo já está no R2. ✓'); process.exit(0); }
console.log(`Destino: ${publicBase()}/<key>/<vista>-NN.avif\n`);

let tot = { bytes: 0, moved: 0, skipped: 0, failed: 0 };
const add = r => { tot.bytes += r.bytes; tot.moved += r.moved; tot.skipped += r.skipped; tot.failed += r.failed; };

if (!APPLY) {
  const sample = pending.slice(0, 10);
  console.log(`=== DRY-RUN (baixa ${sample.length} carros só pra medir, nada é gravado) ===\n`);
  for (const row of sample) {
    const r = await migrateRow(row, true);
    add(r);
    if (r.moved) console.log(`  ${fmt(r.bytes).padStart(8)}  ${r.moved} fotos  ${row.key}`);
  }
  const avg = tot.moved ? tot.bytes / tot.moved : 0;
  console.log(`\n--- Amostra ---`);
  console.log(`Fotos medidas:     ${tot.moved}   (média ${fmt(avg)}/foto)`);
  console.log(`\n--- Projeção do acervo inteiro ---`);
  console.log(`Carros a migrar:   ${pending.length}`);
  console.log(`Fotos a migrar:    ${totalPhotos}`);
  console.log(`Transferência:     ~${fmt(avg * totalPhotos)}  (egress do Supabase → seu servidor → R2)`);
  console.log(`\nSe estiver bom: node scripts/migrate-storage-to-r2.js --apply`);
} else {
  const targets = LIMIT ? pending.slice(0, LIMIT) : pending;
  console.log(`=== APPLY: migrando ${targets.length} carros (${CONC} em paralelo) ===\n`);
  const allPurgeable = [];
  let done = 0;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    const results = await Promise.all(batch.map(row => migrateRow(row, false)));
    for (const r of results) { add(r); allPurgeable.push(...r.purgeable); done++; }
    process.stdout.write(`\r  ${done}/${targets.length} carros — ${tot.moved} fotos no R2 (${fmt(tot.bytes)})${tot.failed ? `, ${tot.failed} falhas` : ''}   `);
  }
  console.log(`\n\n=== FIM ===`);
  console.log(`Carros processados: ${done}`);
  console.log(`Fotos migradas:     ${tot.moved}  (${fmt(tot.bytes)})`);
  console.log(`Puladas:            ${tot.skipped} (já no R2)`);
  console.log(`Falhas:             ${tot.failed}${tot.failed ? '  — re-rode o script, ele retoma só o que faltou' : ''}`);

  if (PURGE && allPurgeable.length) {
    console.log(`\n=== PURGE no Supabase: ${allPurgeable.length} arquivos ===`);
    let removed = 0;
    for (let i = 0; i < allPurgeable.length; i += 200) {
      const chunk = allPurgeable.slice(i, i + 200);
      const { error } = await supabase.storage.from('car-images').remove(chunk);
      if (error) { console.warn(`  ! chunk ${i}: ${error.message}`); continue; }
      removed += chunk.length;
      process.stdout.write(`\r  ${removed}/${allPurgeable.length} apagados do Supabase`);
    }
    console.log(`\n  Liberou ~${fmt(tot.bytes)} no Supabase.`);
  } else if (!PURGE) {
    console.log(`\nOs arquivos continuam no Supabase (ocupando espaço). Depois de conferir`);
    console.log(`o app, rode com --purge-supabase pra liberar — ou apague o bucket lá.`);
  }
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);

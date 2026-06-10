// Remove do cache (Supabase) as entradas que batem com um termo de busca, e
// apaga os arquivos correspondentes no bucket. Útil pra forçar rebuild de um
// carro cuja foto saiu ruim (ex: anúncio de concessionária com telefone).
//
// Uso (de dentro de server/):
//   node scripts/purge-car.js "toro freedom"            # SÓ LISTA o que casaria
//   node scripts/purge-car.js "toro freedom" --delete   # apaga de fato
//   node scripts/purge-car.js "toro freedom" --ano 2023 --delete
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'car-images';
const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const anoIdx = args.indexOf('--ano');
const ano = anoIdx >= 0 ? Number(args[anoIdx + 1]) : null;
const term = args.filter((a, i) => !a.startsWith('--') && i !== (anoIdx + 1)).join(' ').trim();

if (!term) { console.error('informe um termo de busca, ex: node scripts/purge-car.js "toro freedom"'); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Quebra o termo em palavras e exige todas no modelo (ilike). Filtra ano se dado.
let q = sb.from('car_images_cache').select('key,marca,modelo,ano,images,validated');
for (const w of term.split(/\s+/)) q = q.ilike('modelo', `%${w}%`);
if (ano) q = q.eq('ano', ano);

const { data, error } = await q;
if (error) { console.error('erro lendo cache:', error.message); process.exit(1); }

const rows = data || [];
console.log(`\n${rows.length} entrada(s) casando com "${term}"${ano ? ` ano ${ano}` : ''}:\n`);
for (const r of rows) {
  const n = Array.isArray(r.images) ? r.images.length : 0;
  console.log(`  ${r.key}  →  ${r.marca} ${r.modelo} ${r.ano}  (${n} fotos, validated=${r.validated})`);
}

if (!doDelete) {
  console.log(`\n(dry-run) nada foi apagado. Rode de novo com --delete pra remover.\n`);
  process.exit(0);
}

for (const r of rows) {
  // Lista e remove todos os arquivos sob a "pasta" da key no bucket.
  const { data: files, error: listErr } = await sb.storage.from(BUCKET).list(r.key, { limit: 1000 });
  if (listErr) console.warn(`  ${r.key}: erro listando storage: ${listErr.message}`);
  if (files && files.length) {
    const paths = files.map(f => `${r.key}/${f.name}`);
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
    if (rmErr) console.warn(`  ${r.key}: erro removendo arquivos: ${rmErr.message}`);
    else console.log(`  ${r.key}: ${paths.length} arquivo(s) removido(s) do bucket`);
  }
  const { error: delErr } = await sb.from('car_images_cache').delete().eq('key', r.key);
  if (delErr) console.warn(`  ${r.key}: erro removendo linha: ${delErr.message}`);
  else console.log(`  ${r.key}: linha do cache removida ✓ (será reconstruída na próxima visita)`);
}
console.log('\nfeito.\n');

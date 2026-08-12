// Remove do índice (Postgres/Supabase) as entradas que batem com um termo de
// busca, e apaga os arquivos correspondentes no bucket (R2). Útil pra forçar
// rebuild de um carro cuja foto saiu ruim (ex: anúncio de concessionária).
//
// Uso (de dentro de server/):
//   node scripts/purge-car.js "toro freedom"            # SÓ LISTA o que casaria
//   node scripts/purge-car.js "toro freedom" --delete   # apaga de fato
//   node scripts/purge-car.js "toro freedom" --ano 2023 --delete
import 'dotenv/config';
import { listPrefix, removeObjects } from '../storage.js';
import { q, exec, closePool } from '../db.js';

const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const anoIdx = args.indexOf('--ano');
const ano = anoIdx >= 0 ? Number(args[anoIdx + 1]) : null;
const term = args.filter((a, i) => !a.startsWith('--') && i !== (anoIdx + 1)).join(' ').trim();

if (!term) { console.error('informe um termo de busca, ex: node scripts/purge-car.js "toro freedom"'); process.exit(1); }

// Quebra o termo em palavras e exige TODAS no modelo (ilike). Filtra ano se dado.
// Cada palavra vira um parâmetro — nunca interpolado na string, senão um termo
// com aspas viraria SQL injection num script que apaga coisas.
const palavras = term.split(/\s+/);
const condicoes = palavras.map((_, i) => `modelo ilike $${i + 1}`);
const params = palavras.map(w => `%${w}%`);
if (ano) { condicoes.push(`ano = $${params.length + 1}`); params.push(ano); }

let rows;
try {
  rows = await q(
    `select key, marca, modelo, ano, images, validated
       from car_images_cache
      where ${condicoes.join(' and ')}
      order by key`,
    params
  );
} catch (e) {
  console.error('erro lendo cache:', e.message);
  process.exit(1);
}
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
  try {
    const files = await listPrefix(`${r.key}/`);
    if (files.length) {
      const n = await removeObjects(files.map(f => f.path));
      console.log(`  ${r.key}: ${n} arquivo(s) removido(s) do bucket`);
    }
  } catch (e) {
    console.warn(`  ${r.key}: erro no storage: ${e.message}`);
  }
  try {
    await exec('delete from car_images_cache where key = $1', [r.key]);
    console.log(`  ${r.key}: linha do cache removida ✓ (será reconstruída na próxima visita)`);
  } catch (e) {
    console.warn(`  ${r.key}: erro removendo linha: ${e.message}`);
  }
}
console.log('\nfeito.\n');
await closePool();

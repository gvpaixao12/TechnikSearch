// Sonda READ-ONLY do tamanho do bucket car-images: percorre cada pasta (key),
// soma o tamanho dos objetos e reporta total, média por foto e maiores ofensores.
//   cd server && node scripts/diag-storage-size.js
import 'dotenv/config';

const u = process.env.SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_KEY;
if (!u || !k) { console.error('FALTA SUPABASE_URL / SUPABASE_SERVICE_KEY no .env'); process.exit(1); }
const h = { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
const BUCKET = 'car-images';

async function list(prefix, limit = 1000, offset = 0) {
  const r = await fetch(`${u}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Lista todas as "pastas" top-level (keys), paginando.
async function allKeys() {
  const keys = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await list('', 1000, offset);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const o of page) if (o.id === null || o.metadata == null) keys.push(o.name); // pastas vêm sem metadata
    if (page.length < 1000) break;
  }
  return keys;
}

const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB'
  : (b / (1 << 10)).toFixed(0) + ' KB';

const t0 = Date.now();
const keys = await allKeys();
console.log(`Pastas (carros) no bucket: ${keys.length}. Medindo objetos...`);

let totalBytes = 0, totalFiles = 0;
const perKey = [];
let done = 0;
const CONC = 8;
for (let i = 0; i < keys.length; i += CONC) {
  const batch = keys.slice(i, i + CONC);
  await Promise.all(batch.map(async key => {
    const objs = await list(key + '/', 1000, 0);
    let bytes = 0, files = 0;
    for (const o of (Array.isArray(objs) ? objs : [])) {
      const sz = o?.metadata?.size;
      if (typeof sz === 'number') { bytes += sz; files++; }
    }
    totalBytes += bytes; totalFiles += files;
    perKey.push({ key, bytes, files });
  }));
  done += batch.length;
  if (done % 80 === 0 || done === keys.length) process.stdout.write(`\r  ${done}/${keys.length} pastas medidas`);
}
console.log('');

perKey.sort((a, b) => b.bytes - a.bytes);
console.log('\n=== RESUMO ===');
console.log(`Carros com foto:   ${perKey.filter(p => p.files > 0).length}`);
console.log(`Total de fotos:    ${totalFiles}`);
console.log(`Storage total:     ${fmt(totalBytes)}  (${totalBytes.toLocaleString()} bytes)`);
console.log(`Média por foto:    ${totalFiles ? fmt(totalBytes / totalFiles) : '—'}`);
console.log(`Média por carro:   ${perKey.length ? fmt(totalBytes / perKey.filter(p=>p.files>0).length) : '—'}`);
console.log(`Fotos por carro:   ${perKey.length ? (totalFiles / perKey.filter(p=>p.files>0).length).toFixed(1) : '—'}`);

console.log('\n=== 10 carros que mais pesam ===');
for (const p of perKey.slice(0, 10))
  console.log(`  ${fmt(p.bytes).padStart(8)}  ${String(p.files).padStart(2)} fotos  ${p.key}`);

console.log(`\n(medido em ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

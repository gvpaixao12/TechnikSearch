// Sonda READ-ONLY do tamanho do bucket car-images no R2: lista todos os objetos,
// agrupa por pasta (key) e reporta total, média por foto e maiores ofensores.
//   cd server && node scripts/diag-storage-size.js
import 'dotenv/config';
import { listPrefix, BUCKET } from '../storage.js';

const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB'
  : (b / (1 << 10)).toFixed(0) + ' KB';

const t0 = Date.now();
console.log(`Listando objetos do bucket ${BUCKET} (R2)...`);

// Uma varredura só: o ListObjectsV2 pagina de 1000 em 1000 e já traz o tamanho,
// então não precisa de uma chamada por pasta como era no Supabase.
const objects = await listPrefix('');
console.log(`  ${objects.length} objetos.`);

const byKey = new Map();
let totalBytes = 0;
for (const o of objects) {
  const key = o.path.includes('/') ? o.path.slice(0, o.path.indexOf('/')) : '(raiz)';
  const cur = byKey.get(key) || { key, bytes: 0, files: 0 };
  cur.bytes += o.size; cur.files++;
  byKey.set(key, cur);
  totalBytes += o.size;
}

const perKey = [...byKey.values()].sort((a, b) => b.bytes - a.bytes);
const withPhotos = perKey.filter(p => p.files > 0).length;

console.log('\n=== RESUMO ===');
console.log(`Carros com foto:   ${withPhotos}`);
console.log(`Total de fotos:    ${objects.length}`);
console.log(`Storage total:     ${fmt(totalBytes)}  (${totalBytes.toLocaleString()} bytes)`);
console.log(`Média por foto:    ${objects.length ? fmt(totalBytes / objects.length) : '—'}`);
console.log(`Média por carro:   ${withPhotos ? fmt(totalBytes / withPhotos) : '—'}`);
console.log(`Fotos por carro:   ${withPhotos ? (objects.length / withPhotos).toFixed(1) : '—'}`);
console.log(`Free tier R2:      10 GB — usando ${(totalBytes / (10 * (1 << 30)) * 100).toFixed(1)}%`);

console.log('\n=== 10 carros que mais pesam ===');
for (const p of perKey.slice(0, 10))
  console.log(`  ${fmt(p.bytes).padStart(8)}  ${String(p.files).padStart(2)} fotos  ${p.key}`);

console.log(`\n(medido em ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

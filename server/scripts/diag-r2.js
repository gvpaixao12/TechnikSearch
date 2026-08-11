// Checagem de fumaça do R2: valida credencial, escrita, leitura pública e
// remoção. Rode ANTES de migrar o acervo — se isso passar, a migração passa.
//   cd server && node scripts/diag-r2.js
import 'dotenv/config';
import { getR2, putObject, removeObjects, listPrefix, publicBase, BUCKET } from '../storage.js';

const TEST_PATH = '_diag/technik-r2-check.txt';
const body = Buffer.from(`technik r2 ok ${new Date().toISOString()}\n`);
let failed = false;
const ok = (label, extra = '') => console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`);
const bad = (label, e) => { failed = true; console.log(`  ✗ ${label}: ${e.message}`); };

console.log(`Bucket: ${BUCKET}`);
try { console.log(`Base pública: ${publicBase()}\n`); }
catch (e) { console.log(`Base pública: ${e.message}\n`); failed = true; }

// 1) Credencial + listagem
try {
  getR2();
  const objs = await listPrefix('');
  const bytes = objs.reduce((s, o) => s + o.size, 0);
  ok('credencial e listagem', `${objs.length} objetos, ${(bytes / (1 << 20)).toFixed(1)} MB`);
} catch (e) { bad('credencial/listagem', e); }

// 2) Escrita
let url = null;
try { url = await putObject({ path: TEST_PATH, body, contentType: 'text/plain' }); ok('escrita (PUT)', url); }
catch (e) { bad('escrita (PUT)', e); }

// 3) Leitura pública — é isso que o browser do usuário faz.
if (url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} — o bucket está com acesso público ligado? (R2 → Settings → Public Development URL / domínio custom)`);
    const txt = await r.text();
    if (!txt.startsWith('technik r2 ok')) throw new Error('conteúdo inesperado');
    ok('leitura pública (GET)');
  } catch (e) { bad('leitura pública (GET)', e); }
}

// 4) Remoção
try { await removeObjects([TEST_PATH]); ok('remoção (DELETE)'); }
catch (e) { bad('remoção (DELETE)', e); }

console.log(failed
  ? '\nAlgo falhou — corrija antes de rodar a migração.'
  : '\nTudo certo. Pode rodar: node scripts/migrate-storage-to-r2.js');
process.exit(failed ? 1 : 0);

// Sonda READ-ONLY do Supabase: tabelas expostas, buckets e contagem de objetos.
//   cd server && node scripts/diag-supabase.js
import 'dotenv/config';

const u = process.env.SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}` };

// 1) Tabelas expostas pelo PostgREST (OpenAPI paths)
try {
  const r = await fetch(`${u}/rest/v1/`, { headers: h });
  const j = await r.json();
  const paths = Object.keys(j.paths || {}).filter(p => p !== '/').map(p => p.replace('/', ''));
  console.log('TABELAS no REST:', paths.length ? paths.join(', ') : '(nenhuma)');
} catch (e) { console.log('REST root falhou:', e.message); }

// 2) Buckets de storage
try {
  const r = await fetch(`${u}/storage/v1/bucket`, { headers: h });
  const j = await r.json();
  console.log('BUCKETS:', Array.isArray(j) ? (j.map(b => `${b.name}${b.public ? '(public)' : '(private)'}`).join(', ') || '(nenhum)') : JSON.stringify(j));
} catch (e) { console.log('storage bucket list falhou:', e.message); }

// 3) Quantos objetos no bucket car-images (top-level)
try {
  const r = await fetch(`${u}/storage/v1/object/list/car-images`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 100 }),
  });
  const j = await r.json();
  console.log('OBJETOS car-images (top-level):', Array.isArray(j) ? j.length : JSON.stringify(j));
} catch (e) { console.log('list objects falhou:', e.message); }

// Poll READ-ONLY: a tabela car_images_cache já voltou ao schema cache do PostgREST?
import 'dotenv/config';
const u = process.env.SUPABASE_URL;
const k = process.env.SUPABASE_SERVICE_KEY;
const h = { apikey: k, Authorization: `Bearer ${k}`, Prefer: 'count=exact' };

const r = await fetch(`${u}/rest/v1/car_images_cache?select=key`, { method: 'HEAD', headers: h });
const range = r.headers.get('content-range'); // ex: 0-24/350  → total depois da barra
if (r.ok) {
  const total = range ? range.split('/')[1] : '?';
  console.log(`OK — tabela visível. Linhas no cache: ${total}`);
  process.exit(0);
} else {
  const body = await r.text().catch(() => '');
  console.log(`AINDA NAO (HTTP ${r.status}): ${body.slice(0, 160)}`);
  process.exit(2);
}

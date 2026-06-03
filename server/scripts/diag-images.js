// Diagnóstico READ-ONLY do cache de imagens pros carros do teste.
// Não grava nada, não chama Serper/Groq — só lê o catálogo e o Supabase.
//
//   cd server && node scripts/diag-images.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadCatalog } from '../catalog.js';
import { makeKey } from '../imageCache.js';

// (regex no modelo, ano) — os 10 do print "Top 10 para Gabriel"
const WANTED = [
  [/fastback.*limited/i, 2023],
  [/fastback.*impetus/i, 2023],
  [/tiggo 5x pro/i, 2023],
  [/hr-v ex/i, 2023],
  [/creta platinum/i, 2023],
  [/creta ultimate/i, 2023],
  [/corolla cross se 1\.8/i, 2022],
  [/corolla cross xre/i, 2022],
  [/2008 active/i, 2025],
  [/fastback audace/i, 2025],
];

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('FALTA SUPABASE_URL / SUPABASE_SERVICE_KEY no .env');
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const catalog = await loadCatalog();

  // Acha as entries do catálogo que batem com cada padrão.
  const matched = [];
  for (const [rx, ano] of WANTED) {
    const hits = catalog.entries.filter(e => e.ano === ano && rx.test(e.modelo || ''));
    if (hits.length === 0) {
      matched.push({ label: `${rx} ${ano}`, missing: true });
      continue;
    }
    // dedup por codigoFipe
    const seen = new Set();
    for (const e of hits) {
      if (seen.has(e.codigoFipe)) continue;
      seen.add(e.codigoFipe);
      matched.push({ entry: e, k: makeKey({ marca: e.marca, modelo: e.modelo, ano: e.ano }) });
    }
  }

  const keys = matched.filter(m => m.k).map(m => m.k);
  const { data, error } = await supabase
    .from('car_images_cache')
    .select('key, images, validated, expires_at')
    .in('key', keys);
  if (error) { console.error('erro lendo cache:', error.message); process.exit(1); }

  const byKey = new Map((data || []).map(r => [r.key, r]));
  const now = new Date();

  console.log(`\nCatálogo: ${catalog.entries.length} entries (built ${catalog.builtAt})\n`);
  console.log('STATUS  FOTOS  VISION  EXPIRA          MARCA / MODELO / ANO');
  console.log('─'.repeat(92));

  for (const m of matched) {
    if (m.missing) {
      console.log(`NOCAT     —      —      —               (não achei no catálogo) ${m.label}`);
      continue;
    }
    const e = m.entry;
    const row = byKey.get(m.k);
    const desc = `${e.marca} / ${e.modelo} / ${e.ano}`;
    if (!row) {
      console.log(`MISS      —      —      —               ${desc}`);
      continue;
    }
    const n = Array.isArray(row.images) ? row.images.length : 0;
    const exp = new Date(row.expires_at);
    const expired = exp < now;
    const status = expired ? 'EXPIRED' : (n > 0 ? 'OK' : 'EMPTY');
    const vis = row.vision_validated ? 'sim' : 'não';
    console.log(
      `${status.padEnd(8)}${String(n).padStart(3)}    ${vis.padEnd(6)} ${exp.toISOString().slice(0,10).padEnd(15)} ${desc}`
    );
  }
  console.log('');
}

main().catch(e => { console.error('erro fatal:', e); process.exit(1); });

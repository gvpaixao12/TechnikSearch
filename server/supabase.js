// Cliente do Supabase — LEGADO, mantido só para a migração.
//
// O banco da aplicação é o Postgres da VPS (ver db.js). Este módulo existe
// para os scripts que ainda precisam LER do Supabase durante a transição:
// `import-to-postgres.js` (copia os dados) e `purge-supabase-bucket.js`.
//
// Nenhum código de runtime deve importar daqui. Quando o Supabase for
// desligado de vez, este arquivo e o pacote @supabase/supabase-js saem juntos.

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes no .env');
  if (_client) return _client;
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

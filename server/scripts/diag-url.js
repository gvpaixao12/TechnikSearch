// READ-ONLY: pega 1 foto de um carro cacheado e confere se a URL pública responde.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { makeKey } from '../imageCache.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const key = makeKey({ marca: 'Honda', modelo: 'HR-V EX 1.5 Flex Sensing 16V 5p Aut.', ano: 2023 });
const { data } = await supabase.from('car_images_cache').select('key, images').eq('key', key).maybeSingle();
const url = data?.images?.[0]?.url;
console.log('key:', key);
console.log('1a foto:', url || '(sem fotos)');
if (url) {
  const r = await fetch(url, { method: 'HEAD' });
  console.log(`HEAD -> HTTP ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length')} bytes`);
}

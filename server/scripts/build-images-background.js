// Builda o cache de imagens em background, percorrendo o catálogo.
// SEM vision (free tier da Groq não comporta) — usa heurísticas:
//   - Commons > Serper
//   - Blacklist de YouTube e títulos com palavras de review
//   - Maior resolução primeiro
//
// Roda com:
//   cd server && node scripts/build-images-background.js
//
// Pode interromper com Ctrl+C — próxima execução pula os que já estão cacheados.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadCatalog } from '../catalog.js';
import { getOrBuildImages, makeKey, KEY_PREFIX } from '../imageCache.js';

const SLEEP_MS = 2500;        // pausa entre carros — evita estourar Commons rate limit
const PROGRESS_EVERY = 10;    // print de resumo a cada N carros
const BUCKET = 'car-images';
const PRUNE_OLD = process.argv.slice(2).includes('--prune-old');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m${String(rs).padStart(2,'0')}s`;
}

// Remove entradas e arquivos de versões antigas do cache (keys que não começam
// com KEY_PREFIX). Roda só com a flag --prune-old.
async function pruneOldVersions(supabase) {
  console.log(`[prune] limpando versões antigas (mantendo ${KEY_PREFIX}*)…`);
  // 1) Linhas do índice
  const oldKeys = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('car_images_cache').select('key').range(from, from + PAGE - 1);
    if (error) { console.warn('[prune] erro lendo keys:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) if (!r.key.startsWith(KEY_PREFIX)) oldKeys.push(r.key);
    if (data.length < PAGE) break;
  }
  let deletedRows = 0;
  for (let i = 0; i < oldKeys.length; i += 200) {
    const chunk = oldKeys.slice(i, i + 200);
    const { error } = await supabase.from('car_images_cache').delete().in('key', chunk);
    if (error) console.warn('[prune] erro deletando linhas:', error.message);
    else deletedRows += chunk.length;
  }
  console.log(`[prune] ${deletedRows} linhas antigas removidas`);

  // 2) Pastas órfãs no bucket
  const { data: top, error: e1 } = await supabase.storage.from(BUCKET).list('', { limit: 10000 });
  if (e1) { console.warn('[prune] erro listando bucket:', e1.message); return; }
  const oldFolders = (top || []).filter(o => o.id === null && !o.name.startsWith(KEY_PREFIX));
  let deletedFiles = 0;
  for (const folder of oldFolders) {
    const { data: files, error: e2 } = await supabase.storage.from(BUCKET).list(folder.name, { limit: 1000 });
    if (e2) { console.warn(`[prune] erro listando ${folder.name}:`, e2.message); continue; }
    const paths = (files || []).map(f => `${folder.name}/${f.name}`);
    if (paths.length === 0) continue;
    const { error: e3 } = await supabase.storage.from(BUCKET).remove(paths);
    if (e3) console.warn(`[prune] erro removendo ${folder.name}:`, e3.message);
    else deletedFiles += paths.length;
  }
  console.log(`[prune] ${oldFolders.length} pastas antigas, ${deletedFiles} arquivos removidos do bucket\n`);
}

async function main() {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey) {
    console.error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no .env');
    process.exit(1);
  }
  const supabase = createClient(supaUrl, supaKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (PRUNE_OLD) await pruneOldVersions(supabase);

  const catalog = await loadCatalog();
  console.log(`[bg] catálogo: ${catalog.entries.length} entries`);

  // Filtra só FIPE-válidos (com preço), dedup por codigoFipe
  const seenFipe = new Set();
  const cars = [];
  for (const e of catalog.entries) {
    if (!e.preco) continue;
    if (seenFipe.has(e.codigoFipe)) continue;
    seenFipe.add(e.codigoFipe);
    cars.push(e);
  }
  console.log(`[bg] ${cars.length} carros com FIPE válido (deduplicado)`);

  // Quais já têm cache COM FOTOS? (entradas vazias serão refeitas)
  const allKeys = cars.map(c => makeKey({ marca: c.marca, modelo: c.modelo, ano: c.ano }));
  const cachedKeysWithPhotos = new Set();
  const emptyKeys = [];
  // Supabase tem limite no .in() — quebra em chunks de 200
  for (let i = 0; i < allKeys.length; i += 200) {
    const chunk = allKeys.slice(i, i + 200);
    const { data, error } = await supabase
      .from('car_images_cache')
      .select('key, images')
      .in('key', chunk);
    if (error) { console.warn('[bg] erro lendo cache:', error.message); continue; }
    for (const row of (data || [])) {
      const n = Array.isArray(row.images) ? row.images.length : 0;
      if (n > 0) cachedKeysWithPhotos.add(row.key);
      else emptyKeys.push(row.key);
    }
  }

  // Apaga entradas vazias pra que o getOrBuildImages refaça
  if (emptyKeys.length) {
    console.log(`[bg] limpando ${emptyKeys.length} entries com 0 fotos…`);
    for (let i = 0; i < emptyKeys.length; i += 200) {
      const chunk = emptyKeys.slice(i, i + 200);
      const { error } = await supabase.from('car_images_cache').delete().in('key', chunk);
      if (error) console.warn('[bg] erro deletando vazios:', error.message);
    }
  }

  const todo = cars.filter(c => !cachedKeysWithPhotos.has(makeKey({ marca: c.marca, modelo: c.modelo, ano: c.ano })));
  console.log(`[bg] ${cachedKeysWithPhotos.size} já no cache com fotos, ${todo.length} pra construir\n`);

  if (todo.length === 0) { console.log('Nada a fazer.'); return; }

  const t0 = Date.now();
  let ok = 0, fail = 0, withPhotos = 0, zeroPhotos = 0;
  let lastReport = Date.now();

  // Handler de SIGINT pra resumir antes de sair
  let stop = false;
  process.on('SIGINT', () => {
    console.log('\n[bg] Ctrl+C recebido, terminando após carro atual…');
    stop = true;
  });

  for (let i = 0; i < todo.length; i++) {
    if (stop) break;
    const c = todo[i];
    const cs = Date.now();
    try {
      const r = await getOrBuildImages({
        marca: c.marca,
        modelo: c.modelo,
        ano: c.ano,
        skipVision: true,
      });
      const n = r.images?.length || 0;
      if (n > 0) withPhotos++; else zeroPhotos++;
      ok++;
      console.log(`[bg ${String(i+1).padStart(4)}/${todo.length}] ${(c.marca+' '+c.modelo).slice(0, 50).padEnd(50)} ${c.ano}  ${String(n).padStart(2)} fotos · ${fmtTime(Date.now()-cs)}`);
    } catch (e) {
      fail++;
      console.warn(`[bg ${String(i+1).padStart(4)}/${todo.length}] ${c.marca} ${c.modelo} ${c.ano} FAIL: ${e.message}`);
    }

    if ((i + 1) % PROGRESS_EVERY === 0) {
      const elapsed = Date.now() - t0;
      const avgMs = elapsed / (i + 1);
      const remainingMs = Math.round(avgMs * (todo.length - i - 1));
      console.log(`\n  ── progress: ${i+1}/${todo.length} · ${ok} ok (${withPhotos} c/ foto · ${zeroPhotos} vazios) · ${fail} fail · ETA ${fmtTime(remainingMs)}\n`);
      lastReport = Date.now();
    }

    if (i < todo.length - 1 && !stop) await sleep(SLEEP_MS);
  }

  const elapsed = Date.now() - t0;
  console.log('\n' + '═'.repeat(78));
  console.log(`Total processado: ${ok + fail}/${todo.length} · ${fmtTime(elapsed)}`);
  console.log(`OK: ${ok}  (${withPhotos} c/ foto · ${zeroPhotos} vazios)`);
  console.log(`Falhou: ${fail}`);
  if (stop) console.log('Interrompido pelo usuário.');
}

main().catch(e => {
  console.error('[bg] erro fatal:', e);
  process.exit(1);
});

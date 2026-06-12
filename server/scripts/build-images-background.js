// Builda o cache de imagens em background, percorrendo o catálogo.
//
// Modo VISÃO (default agora que a visão é gpt-4o-mini, sem teto diário):
//   valida cada foto com o LLM de visão e persiste a flag `vision`. Assim o
//   caminho web nunca paga visão em runtime → fim do delay no top.
// Modo HEURÍSTICO (--heuristic): sem LLM, só Commons>Serper + blacklist.
//
// Roda em paralelo com um pool de workers (--concurrency=N, default 4). O limite
// real é o rate limit do Commons (429, com retry embutido) e o semáforo de builds
// em imageCache. Carros que já têm fotos VALIDADAS na visão são pulados; os que só
// têm heurística são re-validados (modo visão).
//
// Roda com:
//   cd server && node scripts/build-images-background.js                 # visão, conc=4
//   cd server && node scripts/build-images-background.js --concurrency=6
//   cd server && node scripts/build-images-background.js --heuristic     # sem LLM
//
// Pode interromper com Ctrl+C — termina os carros em voo e sai; a próxima execução
// pula os que já estão prontos.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadCatalog } from '../catalog.js';
import { getOrBuildImages, makeKey, KEY_PREFIX } from '../imageCache.js';
import { isVisionAborted } from '../imageValidator.js';

const ARGS = process.argv.slice(2);
const PRUNE_OLD = ARGS.includes('--prune-old');
const USE_VISION = !ARGS.includes('--heuristic');
const CONCURRENCY = (() => {
  const a = ARGS.find(x => x.startsWith('--concurrency='));
  const n = a ? parseInt(a.split('=')[1], 10) : 4;
  return Number.isFinite(n) && n > 0 ? n : 4;
})();
const STAGGER_MS = 300;       // atraso entre largadas de cada worker (suaviza Commons)
const PROGRESS_EVERY = 10;    // print de resumo a cada N carros
const BUCKET = 'car-images';

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

  console.log(`[bg] modo ${USE_VISION ? 'VISÃO (gpt-4o-mini)' : 'HEURÍSTICO'} · concorrência ${CONCURRENCY}`);
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

  // Estado de cada key no cache:
  //   - "pronto": tem fotos e (modo heurístico: basta ter foto; modo visão: tem
  //     pelo menos 1 foto com flag `vision`) → pula.
  //   - "heurístico": tem fotos mas nenhuma validada na visão → em modo visão
  //     entra no todo pra ser revalidado; em modo heurístico já está pronto.
  //   - "vazio": 0 fotos → apaga pra getOrBuildImages refazer.
  const allKeys = cars.map(c => makeKey({ marca: c.marca, modelo: c.modelo, ano: c.ano }));
  const doneKeys = new Set();
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
      const imgs = Array.isArray(row.images) ? row.images : [];
      if (imgs.length === 0) { emptyKeys.push(row.key); continue; }
      const visionOk = imgs.some(im => im && im.vision === true);
      if (!USE_VISION || visionOk) doneKeys.add(row.key);
      // modo visão + heurístico → fica de fora de doneKeys → entra no todo
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

  const todo = cars.filter(c => !doneKeys.has(makeKey({ marca: c.marca, modelo: c.modelo, ano: c.ano })));
  console.log(`[bg] ${doneKeys.size} já prontos, ${todo.length} pra ${USE_VISION ? 'validar/construir' : 'construir'}\n`);

  if (todo.length === 0) { console.log('Nada a fazer.'); return; }

  const t0 = Date.now();
  let ok = 0, fail = 0, withPhotos = 0, zeroPhotos = 0, processed = 0;

  // Handler de SIGINT pra resumir antes de sair
  let stop = false;
  process.on('SIGINT', () => {
    console.log('\n[bg] Ctrl+C recebido, terminando os carros em voo…');
    stop = true;
  });

  // Pool de workers: cada worker pega o próximo índice livre da fila. A
  // concorrência fica capada também pelo semáforo de builds em imageCache.
  let next = 0;
  async function worker(workerId) {
    // Largada escalonada pra não bater no Commons todos ao mesmo tempo.
    await sleep(workerId * STAGGER_MS);
    while (!stop) {
      // Disjuntor: 429 da OpenAI virou parede → para o pool inteiro.
      if (isVisionAborted()) {
        if (!stop) console.error('\n[bg] ⛔ ABORTADO: muitos 429 seguidos da OpenAI (rate limit). Parando o passe — rode de novo mais tarde (pula o que já ficou pronto).');
        stop = true;
        break;
      }
      const i = next++;
      if (i >= todo.length) break;
      const c = todo[i];
      const cs = Date.now();
      try {
        const r = await getOrBuildImages({
          marca: c.marca,
          modelo: c.modelo,
          ano: c.ano,
          skipVision: !USE_VISION,
        });
        const n = r.images?.length || 0;
        if (n > 0) withPhotos++; else zeroPhotos++;
        ok++;
        console.log(`[bg ${String(i+1).padStart(4)}/${todo.length}] ${(c.marca+' '+c.modelo).slice(0, 50).padEnd(50)} ${c.ano}  ${String(n).padStart(2)} fotos · ${fmtTime(Date.now()-cs)}`);
      } catch (e) {
        fail++;
        console.warn(`[bg ${String(i+1).padStart(4)}/${todo.length}] ${c.marca} ${c.modelo} ${c.ano} FAIL: ${e.message}`);
      }

      processed++;
      if (processed % PROGRESS_EVERY === 0) {
        const elapsed = Date.now() - t0;
        const avgMs = elapsed / processed;
        const remainingMs = Math.round(avgMs * (todo.length - processed));
        console.log(`\n  ── progress: ${processed}/${todo.length} · ${ok} ok (${withPhotos} c/ foto · ${zeroPhotos} vazios) · ${fail} fail · ETA ${fmtTime(remainingMs)}\n`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, (_, id) => worker(id))
  );

  const elapsed = Date.now() - t0;
  console.log('\n' + '═'.repeat(78));
  console.log(`Total processado: ${ok + fail}/${todo.length} · ${fmtTime(elapsed)}`);
  console.log(`OK: ${ok}  (${withPhotos} c/ foto · ${zeroPhotos} vazios)`);
  console.log(`Falhou: ${fail}`);
  if (isVisionAborted()) console.log('⛔ ABORTADO pelo disjuntor de 429 (rate limit). Rode de novo mais tarde.');
  else if (stop) console.log('Interrompido pelo usuário.');
}

main().catch(e => {
  console.error('[bg] erro fatal:', e);
  process.exit(1);
});

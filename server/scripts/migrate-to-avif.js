// Re-encoda o acervo de fotos WebP → AVIF pra reduzir o storage (R2) mantendo
// qualidade e quantidade. Fonte de encode = encodeForStorage() do pipeline
// (mesma qualidade das fotos novas).
//
// Uso:
//   node scripts/migrate-to-avif.js                 # DRY-RUN: mede economia numa amostra, não grava
//   node scripts/migrate-to-avif.js --sample=40     # amostra maior no dry-run
//   node scripts/migrate-to-avif.js --quality=45    # (dry-run) testa outra qualidade AVIF
//   node scripts/migrate-to-avif.js --apply         # PARA VALER: migra todo o acervo
//   node scripts/migrate-to-avif.js --apply --limit=100   # migra só os primeiros 100 carros (rollout em etapas)
//
// Seguro re-rodar: fotos já em .avif são puladas (idempotente). Ordem por carro:
// sobe .avif → atualiza índice no banco → apaga a .webp antiga (nunca deixa o app
// apontando pra arquivo inexistente).
import 'dotenv/config';
import sharp from 'sharp';
import {
  getSupabase, encodeForStorage, STORAGE_EXT, STORAGE_CONTENT_TYPE,
} from '../imageCache.js';
import { putObject, removeObjects, pathFromUrl } from '../storage.js';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = (f, d) => { const a = args.find(x => x.startsWith(f + '=')); return a ? a.split('=')[1] : d; };
const APPLY = has('--apply');
const SAMPLE = parseInt(val('--sample', '25'), 10);
const LIMIT = val('--limit', null) ? parseInt(val('--limit'), 10) : null;
const ONLY_KEY = val('--key', null); // migra só esse carro (key exata) — pra testes pontuais
const Q_OVERRIDE = val('--quality', null) ? parseInt(val('--quality'), 10) : null;
const E_OVERRIDE = val('--effort', null) ? parseInt(val('--effort'), 10) : null;

const fmt = b => b >= 1 << 30 ? (b / (1 << 30)).toFixed(2) + ' GB'
  : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + ' MB'
  : (b / (1 << 10)).toFixed(0) + ' KB';

// No dry-run com --quality/--effort a gente encoda localmente pra experimentar;
// no apply (e dry-run sem override) usa a função do pipeline — garante que o
// acervo fique idêntico às fotos novas.
async function encode(buffer) {
  if (Q_OVERRIDE != null || E_OVERRIDE != null) {
    return sharp(buffer).rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .avif({ quality: Q_OVERRIDE ?? 50, effort: E_OVERRIDE ?? 4 })
      .toBuffer();
  }
  return encodeForStorage(buffer);
}

const supabase = getSupabase();

async function fetchBytes(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'TechnikMigrate/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Lê todas as linhas do índice (key + images), paginando.
async function allRows() {
  const PAGE = 1000, rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('car_images_cache').select('key, images')
      .order('key', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Migra uma linha. Retorna { oldBytes, newBytes, converted, skipped }.
// dry: não sobe, não apaga, não grava — só mede.
async function migrateRow(row, dry) {
  const images = Array.isArray(row.images) ? row.images : [];
  let oldBytes = 0, newBytes = 0, converted = 0, skipped = 0;
  const newImages = [];
  const oldPathsToDelete = [];

  for (const im of images) {
    const path = pathFromUrl(im?.url);
    if (!path || !/\.webp$/i.test(path)) { newImages.push(im); skipped++; continue; }
    let src;
    try { src = await fetchBytes(im.url); }
    catch (e) { console.warn(`  ! ${path}: ${e.message} — mantendo original`); newImages.push(im); skipped++; continue; }
    const out = await encode(src);
    oldBytes += src.length; newBytes += out.length; converted++;

    if (dry) { newImages.push(im); continue; }

    const newPath = path.replace(/\.webp$/i, '.' + STORAGE_EXT);
    let newUrl;
    try {
      newUrl = await putObject({ path: newPath, body: out, contentType: STORAGE_CONTENT_TYPE });
    } catch (e) {
      console.warn(`  ! upload ${newPath}: ${e.message} — mantendo original`); newImages.push(im); skipped++; continue;
    }
    newImages.push({ ...im, url: newUrl });
    oldPathsToDelete.push(path);
  }

  if (!dry && converted > 0) {
    // 1) aponta o índice pras novas URLs .avif; 2) só então apaga as .webp.
    const { error: updErr } = await supabase.from('car_images_cache')
      .update({ images: newImages }).eq('key', row.key);
    if (updErr) { console.warn(`  ! update índice ${row.key}: ${updErr.message} — NÃO apagando .webp`); }
    else if (oldPathsToDelete.length) {
      try { await removeObjects(oldPathsToDelete); }
      catch (e) { console.warn(`  ! remove .webp ${row.key}: ${e.message} (órfãos ficam, re-rode depois)`); }
    }
  }
  return { oldBytes, newBytes, converted, skipped };
}

const t0 = Date.now();
console.log(`Lendo índice (car_images_cache)...`);
const rows = await allRows();
let withWebp = rows.filter(r => (r.images || []).some(im => /\.webp$/i.test(pathFromUrl(im?.url) || '')));
if (ONLY_KEY) {
  withWebp = withWebp.filter(r => r.key === ONLY_KEY);
  if (withWebp.length === 0) { console.log(`--key=${ONLY_KEY}: nada pra migrar (não existe ou já está em AVIF).`); process.exit(0); }
}
console.log(`${rows.length} carros no índice; ${withWebp.length} com foto .webp pra migrar.`);
console.log(`Encode: AVIF quality=${Q_OVERRIDE ?? 50} effort=${E_OVERRIDE ?? 4}${(Q_OVERRIDE ?? E_OVERRIDE) == null ? ' (do pipeline)' : ' (override — só dry-run)'}\n`);

let tot = { oldBytes: 0, newBytes: 0, converted: 0, skipped: 0 };
const add = r => { tot.oldBytes += r.oldBytes; tot.newBytes += r.newBytes; tot.converted += r.converted; tot.skipped += r.skipped; };

if (!APPLY) {
  // DRY-RUN: amostra pra projetar a economia sem tocar em nada.
  const sample = withWebp.slice(0, SAMPLE);
  console.log(`=== DRY-RUN (amostra de ${sample.length} carros, nada é gravado) ===\n`);
  for (const row of sample) {
    const r = await migrateRow(row, true);
    add(r);
    if (r.converted) console.log(`  ${fmt(r.oldBytes).padStart(8)} → ${fmt(r.newBytes).padStart(8)}  (${(100 - r.newBytes / r.oldBytes * 100).toFixed(0)}% menor)  ${r.converted} fotos  ${row.key}`);
  }
  const ratio = tot.oldBytes ? tot.newBytes / tot.oldBytes : 1;
  console.log(`\n--- Amostra ---`);
  console.log(`Fotos medidas:     ${tot.converted}`);
  console.log(`WebP:              ${fmt(tot.oldBytes)}  (média ${fmt(tot.oldBytes / (tot.converted || 1))}/foto)`);
  console.log(`AVIF:              ${fmt(tot.newBytes)}  (média ${fmt(tot.newBytes / (tot.converted || 1))}/foto)`);
  console.log(`Redução:           ${((1 - ratio) * 100).toFixed(1)}%`);
  console.log(`\n--- Projeção pro acervo inteiro (1,27 GB atuais) ---`);
  console.log(`Estimado após migrar: ~${fmt(1_368_010_978 * ratio)}  (economia ~${fmt(1_368_010_978 * (1 - ratio))})`);
  console.log(`\nSe estiver bom: node scripts/migrate-to-avif.js --apply`);
} else {
  // APPLY: migra tudo (ou --limit). Processa CONC carros em paralelo (cada carro
  // continua sequencial por dentro: sobe→atualiza índice→apaga). Ajustável via
  // --conc=N. Download é I/O-bound e o encode AVIF usa threads do libvips, então
  // paralelizar derruba muito o tempo total. Cuidado: subir demais estoura CPU/egress.
  const CONC = val('--conc', null) ? parseInt(val('--conc'), 10) : 5;
  const targets = LIMIT ? withWebp.slice(0, LIMIT) : withWebp;
  console.log(`=== APPLY: migrando ${targets.length} carros (${CONC} em paralelo) ===\n`);
  let done = 0;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    const results = await Promise.all(batch.map(row => migrateRow(row, false)));
    for (const r of results) { add(r); done++; }
    process.stdout.write(`\r  ${done}/${targets.length} carros — ${tot.converted} fotos convertidas, economizou ${fmt(tot.oldBytes - tot.newBytes)} até agora`);
  }
  console.log(`\n\n=== FIM ===`);
  console.log(`Carros migrados:   ${done}`);
  console.log(`Fotos convertidas: ${tot.converted}  (${tot.skipped} puladas)`);
  console.log(`WebP → AVIF:       ${fmt(tot.oldBytes)} → ${fmt(tot.newBytes)}  (economia ${fmt(tot.oldBytes - tot.newBytes)}, ${tot.oldBytes ? ((1 - tot.newBytes / tot.oldBytes) * 100).toFixed(1) : 0}%)`);
  console.log(`\nRode scripts/diag-storage-size.js pra confirmar o total do bucket.`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);

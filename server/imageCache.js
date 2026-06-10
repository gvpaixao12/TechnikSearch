// Orquestra a pipeline de imagens: lê cache (Supabase), e se miss/expirado
// faz busca → validação vision → resize/webp → upload pro bucket → grava índice.
//
// TTL: 6 meses para chaves que tiveram >= 2 fotos aprovadas; 7 dias para
// "tentativas vazias" (evita ficar gastando Serper/vision toda hora em modelo
// que a web não tem foto boa).

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { searchByView } from './imageProviders.js';
import { validateImages, isTpdExhausted } from './imageValidator.js';

const BUCKET = 'car-images';
const TTL_VALIDATED_DAYS = 180;
const TTL_FAILED_DAYS = 7;
const MAX_WIDTH = 1200;            // resize p/ storage final (~170KB médio)
const VISION_WIDTH = 512;          // resize p/ enviar à Groq (suficiente p/ classificar)
const WEBP_QUALITY = 82;
const WEBP_VISION_QUALITY = 70;
const MAX_CANDIDATES_PER_VIEW = 12; // download top-N por view (rich: precisa de pool maior)
const HEURISTIC_PER_VIEW = 6;      // fotos por view no modo skipVision (galeria rica)
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB hard cap por download

// Heurísticas pra modo skipVision (background sem LLM):
const BAD_URL_PATTERNS = [/youtube\.com/i, /youtu\.be/i, /ytimg/i, /vimeo/i];
const BAD_TITLE_KEYWORDS = /\b(vs|review|teste|melhor|vale a pena|completo|comparativo|opinião|opiniao|detonando|pior|ranking)\b/i;

// Agregadores/classificados que costumam estampar URL/marca d'água na própria
// foto. O caminho heurístico não lê pixels, então filtramos pela origem.
// (O caminho vision rejeita watermark olhando a imagem — ver imageValidator.)
// Lista extensível: adicione domínios conforme aparecerem fotos marcadas.
const WATERMARK_DOMAINS = ['carrosnaweb', 'usadosbr', 'napista'];

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isLikelyBadImage(im) {
  const url = (im.url || '').toLowerCase();
  const page = (im.page || '').toLowerCase();
  const title = (im.title || '').toLowerCase();
  if (BAD_URL_PATTERNS.some(rx => rx.test(url) || rx.test(page))) return true;
  if (WATERMARK_DOMAINS.some(d => url.includes(d) || page.includes(d))) return true;
  if (BAD_TITLE_KEYWORDS.test(title)) return true;
  return false;
}

// Seleção heurística com diversidade de fonte: pega 1 por domínio primeiro
// (evita 6 recortes do mesmo anúncio), depois completa com os melhores restantes.
function pickDiverse(sorted, k) {
  const picked = [];
  const seenHosts = new Set();
  for (const im of sorted) {
    if (picked.length >= k) break;
    const h = hostOf(im.page || im.url);
    if (h && seenHosts.has(h)) continue;
    if (h) seenHosts.add(h);
    picked.push(im);
  }
  for (const im of sorted) {
    if (picked.length >= k) break;
    if (!picked.includes(im)) picked.push(im);
  }
  return picked;
}

function scoreImage(im) {
  let s = 0;
  if (im.source === 'commons') s += 1000;   // Commons é curado, prioridade alta
  s += Math.min(im.width || 0, 2400) / 10;  // bonus até +240 por tamanho
  return s;
}

function selectHeuristic(byView, perView = HEURISTIC_PER_VIEW) {
  const out = { front: [], rear: [], side: [], interior: [] };
  for (const view of Object.keys(out)) {
    const sorted = (byView[view] || [])
      .filter(im => !isLikelyBadImage(im))
      .sort((a, b) => scoreImage(b) - scoreImage(a));
    out[view] = pickDiverse(sorted, perView);
  }
  return out;
}

let _supabase = null;
export function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes no .env');
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Versão do cache: faz parte da key. Bump invalida tudo (entradas antigas viram
// "miss" e são reconstruídas quando o carro reaparece = rebuild preguiçoso, sem
// precisar de migração de schema). Linhas/pastas antigas expiram sozinhas (≤180d)
// ou podem ser limpas com `build-images-background.js --prune-old`.
//
// ATENÇÃO: as ~495 entradas já populadas no Supabase têm key SEM prefixo
// (`marca__modelo__ano`). Bumpar o prefixo aqui faz `readCache` dar miss em
// todas elas → o app fica sem foto até repopular o catálogo inteiro. Só bumpe
// DEPOIS de rodar `build-images-background.js` pra reconstruir no prefixo novo.
export const CACHE_VERSION = 'v1';
export const KEY_PREFIX = '';

export function makeKey({ marca, modelo, ano }) {
  return `${KEY_PREFIX}${slug(marca)}__${slug(modelo)}__${ano}`;
}

// Baixa a imagem da web pro nosso servidor. Retorna o Buffer cru.
// Importante: a gente baixa porque mandar URL direta pro Groq dá "connection
// reset by peer" em vários hosts (eles bloqueiam o IP da Groq). Baixando aqui,
// a gente passa as imagens como base64 e isola o LLM da web inteira.
async function downloadImage(url, timeoutMs = 12000) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 TechnikBot/1.0',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

// Versão pequena em base64 — vai inline no payload pra Groq.
async function toVisionDataUrl(buffer) {
  const small = await sharp(buffer)
    .rotate()
    .resize({ width: VISION_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_VISION_QUALITY })
    .toBuffer();
  return `data:image/webp;base64,${small.toString('base64')}`;
}

// Versão grande pro bucket.
async function resizeForStorage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

async function uploadOne({ supabase, key, view, idx, buffer }) {
  const stored = await resizeForStorage(buffer);
  const path = `${key}/${view}-${String(idx + 1).padStart(2, '0')}.webp`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, stored, { contentType: 'image/webp', upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function readCache(supabase, key) {
  const { data, error } = await supabase
    .from('car_images_cache')
    .select('*')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.warn('[imageCache] read error:', error.message);
    return null;
  }
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}

async function writeCache(supabase, row) {
  const { error } = await supabase
    .from('car_images_cache')
    .upsert(row, { onConflict: 'key' });
  if (error) console.warn('[imageCache] write error:', error.message);
}

// Pra cada view, baixa os top-N candidatos e prepara a versão vision em base64.
// Resultado: cada imagem ganha { buffer, visionUrl } adicionais.
async function downloadByView(byViewRaw, views) {
  const out = {};
  for (const v of views) {
    const slice = (byViewRaw[v] || []).slice(0, MAX_CANDIDATES_PER_VIEW);
    const downloaded = await Promise.all(slice.map(async im => {
      const buffer = await downloadImage(im.url);
      if (!buffer) return null;
      let visionUrl;
      try { visionUrl = await toVisionDataUrl(buffer); }
      catch { return null; }
      return { ...im, buffer, visionUrl };
    }));
    out[v] = downloaded.filter(Boolean);
  }
  return out;
}

async function buildImages({ marca, modelo, ano, key, skipVision = false }) {
  await acquireBuildSlot();
  try {
    return await _buildImagesUnlocked({ marca, modelo, ano, key, skipVision });
  } finally {
    releaseBuildSlot();
  }
}

async function _buildImagesUnlocked({ marca, modelo, ano, key, skipVision = false }) {
  const supabase = getSupabase();
  const t0 = Date.now();

  const views = ['front', 'rear', 'side', 'interior'];
  const byViewRaw = await searchByView({ marca, modelo, ano, rich: true });

  // Baixa imagens pro nosso servidor (até MAX_CANDIDATES_PER_VIEW por view).
  // Cada imagem fica com { buffer, visionUrl } prontos.
  const byView = await downloadByView(byViewRaw, views);

  const totalCand = views.reduce((s, v) => s + byView[v].length, 0);
  const totalRaw = views.reduce((s, v) => s + (byViewRaw[v]?.length || 0), 0);
  console.log(`[images] ${key}: ${totalCand} candidatos baixados (de ${totalRaw} encontrados)`);

  if (totalCand === 0) {
    const row = {
      key, marca, modelo, ano,
      images: [], validated: false,
      expires_at: new Date(Date.now() + TTL_FAILED_DAYS * 86400_000).toISOString(),
    };
    await writeCache(supabase, row);
    return { key, images: [], validated: false, cached: false };
  }

  // Seleciona top-N por view. skipVision usa heurísticas; default usa LLM vision.
  const approved = skipVision
    ? selectHeuristic(byView, HEURISTIC_PER_VIEW)
    : await validateImages({ marca, modelo, ano, byView });
  const totalApproved = views.reduce((s, v) => s + approved[v].length, 0);
  console.log(`[images] ${key}: ${totalApproved} ${skipVision ? 'selecionadas (heurística)' : 'aprovadas no vision'}`);

  const uploaded = [];
  for (const view of views) {
    let idx = 0;
    for (const img of approved[view]) {
      try {
        const publicUrl = await uploadOne({ supabase, key, view, idx, buffer: img.buffer });
        uploaded.push({ url: publicUrl, view, sourcePage: img.page || null, vision: !skipVision });
        idx++;
      } catch (e) {
        console.warn(`[images] upload ${view} #${idx} falhou: ${e.message}`);
      }
    }
  }

  const validated = uploaded.length >= 2;
  const ttlDays = validated ? TTL_VALIDATED_DAYS : TTL_FAILED_DAYS;
  // OBS: o status "vision-validado" é persistido por foto (campo `vision` em cada
  // item de `images`), não numa coluna própria — a tabela não tem `vision_validated`.
  const row = {
    key, marca, modelo, ano,
    images: uploaded,
    validated,
    expires_at: new Date(Date.now() + ttlDays * 86400_000).toISOString(),
  };
  await writeCache(supabase, row);
  console.log(`[images] ${key}: ${uploaded.length} salvas em ${Date.now() - t0}ms`);
  return { key, images: uploaded, validated, cached: false };
}

// Lazy upgrade: substitui fotos heurísticas por validadas no vision.
// Roda em background (fire-and-forget). Se vision falhar/rejeitar tudo,
// PRESERVA as fotos heurísticas existentes — nunca deixa o carro vazio.
const _upgradesInFlight = new Set();

async function upgradeWithVision({ marca, modelo, ano, key }) {
  if (_upgradesInFlight.has(key)) return;
  _upgradesInFlight.add(key);
  try {
    await acquireBuildSlot();
    const supabase = getSupabase();
    const t0 = Date.now();
    console.log(`[upgrade] ${key}: iniciando re-validação com vision`);

    const views = ['front', 'rear', 'side', 'interior'];
    const byViewRaw = await searchByView({ marca, modelo, ano, rich: true });
    const byView = await downloadByView(byViewRaw, views);
    const totalCand = views.reduce((s, v) => s + byView[v].length, 0);
    if (totalCand === 0) {
      console.log(`[upgrade] ${key}: 0 candidatos novos, mantendo heurística`);
      return;
    }

    let approved;
    try {
      approved = await validateImages({ marca, modelo, ano, byView });
    } catch (e) {
      console.log(`[upgrade] ${key}: vision falhou (${e.message}), mantendo heurística`);
      return;
    }
    const totalApproved = views.reduce((s, v) => s + approved[v].length, 0);
    if (totalApproved < 2) {
      console.log(`[upgrade] ${key}: vision aprovou ${totalApproved} fotos — mantendo heurística`);
      return;
    }

    const uploaded = [];
    for (const view of views) {
      let idx = 0;
      for (const img of approved[view]) {
        try {
          const publicUrl = await uploadOne({ supabase, key, view, idx, buffer: img.buffer });
          uploaded.push({ url: publicUrl, view, sourcePage: img.page || null, vision: true });
          idx++;
        } catch (e) {
          console.warn(`[upgrade] ${key} upload ${view}#${idx}: ${e.message}`);
        }
      }
    }

    if (uploaded.length < 2) {
      console.log(`[upgrade] ${key}: só ${uploaded.length} subiram, mantendo heurística`);
      return;
    }

    const row = {
      key, marca, modelo, ano,
      images: uploaded,
      validated: true,
      expires_at: new Date(Date.now() + TTL_VALIDATED_DAYS * 86400_000).toISOString(),
    };
    await writeCache(supabase, row);
    console.log(`[upgrade] ${key}: ${uploaded.length} fotos validadas em ${Date.now() - t0}ms ✓`);
  } finally {
    releaseBuildSlot();
    _upgradesInFlight.delete(key);
  }
}

// Semáforo: limita builds/validações simultâneos. Com visão no gpt-4o-mini (sem
// teto por minuto como o Groq), dá pra rodar alguns em paralelo — acelera o
// portão num top 10. Ajustável via IMAGE_BUILD_CONCURRENCY. Extras enfileiram.
const MAX_CONCURRENT_BUILDS = Number(process.env.IMAGE_BUILD_CONCURRENCY) || 3;
let _activeBuilds = 0;
const _waiters = [];
async function acquireBuildSlot() {
  if (_activeBuilds < MAX_CONCURRENT_BUILDS) { _activeBuilds++; return; }
  await new Promise(resolve => _waiters.push(resolve));
}
function releaseBuildSlot() {
  _activeBuilds--;
  const next = _waiters.shift();
  if (next) { _activeBuilds++; next(); }
}

// Dedup de requests paralelos pro mesmo key (mesmo carro pedido 5x simultâneo
// não dispara 5 builds — todas aguardam o mesmo build).
const _inFlight = new Map();

// Uma entry é "vision-validada" se alguma das fotos foi marcada com `vision`.
// (Flag persistido por foto dentro de `images`, já que não há coluna própria.)
function isVisionValidated(cached) {
  return (cached?.images || []).some(im => im && im.vision === true);
}

// Re-valida com visão as fotos QUE JÁ ESTÃO no cache, sem nova busca na web
// (não depende do Serper). Mantém só as aprovadas e descarta o que for de outro
// mercado/modelo (europeu, mão-inglesa, geração errada). Se a visão falhar,
// PRESERVA as fotos atuais — nunca deixa o carro pior do que estava.
async function revalidateExisting({ marca, modelo, ano, key, images }) {
  await acquireBuildSlot();
  try {
    const supabase = getSupabase();
    const byView = { front: [], rear: [], side: [], interior: [] };
    for (const im of images) if (byView[im.view]) byView[im.view].push({ url: im.url, page: im.sourcePage });

    let approved;
    try {
      approved = await validateImages({ marca, modelo, ano, byView });
    } catch (e) {
      console.warn(`[revalida] ${key}: visão lançou exceção (${e.message}) — mantendo fotos atuais`);
      return { key, images, validated: images.length >= 2, cached: true };
    }

    const kept = [];
    for (const view of ['front', 'rear', 'side', 'interior'])
      for (const im of approved[view]) kept.push({ url: im.url, view, sourcePage: im.page || null, vision: true });

    // validateImages pode retornar 0 aprovadas silenciosamente (TPM/TPD que captura
    // internamente). Nesse caso preservamos o que tínhamos — nunca zeramos o cache.
    if (kept.length === 0 && images.length > 0) {
      console.warn(`[revalida] ${key}: visão retornou 0 aprovadas — mantendo ${images.length} fotos atuais`);
      return { key, images, validated: images.length >= 2, cached: true };
    }

    const validated = kept.length >= 2;
    const ttlDays = validated ? TTL_VALIDATED_DAYS : TTL_FAILED_DAYS;
    await writeCache(supabase, {
      key, marca, modelo, ano, images: kept, validated,
      expires_at: new Date(Date.now() + ttlDays * 86400_000).toISOString(),
    });
    console.log(`[revalida] ${key}: ${images.length} → ${kept.length} fotos aprovadas na visão`);
    return { key, images: kept, validated, cached: false };
  } finally {
    releaseBuildSlot();
  }
}

// allowUpgrade: o caminho web (skipVision rápido) liga isso pra que o upgrade
// vision rode em background na visita seguinte. O bg script deixa desligado
// (não quer disparar vision pro catálogo inteiro).
export async function getOrBuildImages({ marca, modelo, ano, skipVision = false, allowUpgrade = false }) {
  if (!marca || !modelo || !ano) throw new Error('marca, modelo e ano são obrigatórios');
  const supabase = getSupabase();
  const key = makeKey({ marca, modelo, ano });

  const cached = await readCache(supabase, key);
  if (cached) {
    const imgs = cached.images || [];
    // Portão de visão: no caminho web (skipVision=false) só servimos fotos já
    // aprovadas pela visão. Entrada heurística (sem flag `vision`) com fotos é
    // RE-VALIDADA usando as fotos que já temos (sem nova busca → independe do
    // Serper). Entradas vazias ou já-validadas voltam direto.
    if (skipVision || isVisionValidated(cached) || imgs.length === 0) {
      return { key, images: imgs, validated: !!cached.validated, cached: true };
    }
    if (_inFlight.has(key)) return _inFlight.get(key);
    const p = revalidateExisting({ marca, modelo, ano, key, images: imgs })
      .finally(() => _inFlight.delete(key));
    _inFlight.set(key, p);
    return p;
  }

  if (_inFlight.has(key)) return _inFlight.get(key);
  const promise = buildImages({ marca, modelo, ano, key, skipVision })
    .finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

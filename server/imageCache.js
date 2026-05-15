// Orquestra a pipeline de imagens: lê cache (Supabase), e se miss/expirado
// faz busca → validação vision → resize/webp → upload pro bucket → grava índice.
//
// TTL: 6 meses para chaves que tiveram >= 2 fotos aprovadas; 7 dias para
// "tentativas vazias" (evita ficar gastando Serper/vision toda hora em modelo
// que a web não tem foto boa).

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { searchByView } from './imageProviders.js';
import { validateImages } from './imageValidator.js';

const BUCKET = 'car-images';
const TTL_VALIDATED_DAYS = 180;
const TTL_FAILED_DAYS = 7;
const MAX_WIDTH = 1200;            // resize p/ storage final (~170KB médio)
const VISION_WIDTH = 512;          // resize p/ enviar à Groq (suficiente p/ classificar)
const WEBP_QUALITY = 82;
const WEBP_VISION_QUALITY = 70;
const MAX_CANDIDATES_PER_VIEW = 8; // download top-N por view (no skipVision precisa mais)
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB hard cap por download

// Heurísticas pra modo skipVision (background sem LLM):
const BAD_URL_PATTERNS = [/youtube\.com/i, /youtu\.be/i, /ytimg/i, /vimeo/i];
const BAD_TITLE_KEYWORDS = /\b(vs|review|teste|melhor|vale a pena|completo|comparativo|opinião|opiniao|detonando|pior|ranking)\b/i;

function isLikelyBadImage(im) {
  const url = (im.url || '').toLowerCase();
  const page = (im.page || '').toLowerCase();
  const title = (im.title || '').toLowerCase();
  if (BAD_URL_PATTERNS.some(rx => rx.test(url) || rx.test(page))) return true;
  if (BAD_TITLE_KEYWORDS.test(title)) return true;
  return false;
}

function scoreImage(im) {
  let s = 0;
  if (im.source === 'commons') s += 1000;   // Commons é curado, prioridade alta
  s += Math.min(im.width || 0, 2400) / 10;  // bonus até +240 por tamanho
  return s;
}

function selectHeuristic(byView, perView = 2) {
  const out = { front: [], rear: [], side: [], interior: [] };
  for (const view of Object.keys(out)) {
    out[view] = (byView[view] || [])
      .filter(im => !isLikelyBadImage(im))
      .sort((a, b) => scoreImage(b) - scoreImage(a))
      .slice(0, perView);
  }
  return out;
}

let _supabase = null;
function getSupabase() {
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

export function makeKey({ marca, modelo, ano }) {
  return `${slug(marca)}__${slug(modelo)}__${ano}`;
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
  const byViewRaw = await searchByView({ marca, modelo, ano });

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
    ? selectHeuristic(byView, 2)
    : await validateImages({ marca, modelo, ano, byView });
  const totalApproved = views.reduce((s, v) => s + approved[v].length, 0);
  console.log(`[images] ${key}: ${totalApproved} ${skipVision ? 'selecionadas (heurística)' : 'aprovadas no vision'}`);

  const uploaded = [];
  for (const view of views) {
    let idx = 0;
    for (const img of approved[view]) {
      try {
        const publicUrl = await uploadOne({ supabase, key, view, idx, buffer: img.buffer });
        uploaded.push({ url: publicUrl, view, sourcePage: img.page || null });
        idx++;
      } catch (e) {
        console.warn(`[images] upload ${view} #${idx} falhou: ${e.message}`);
      }
    }
  }

  const validated = uploaded.length >= 2;
  const ttlDays = validated ? TTL_VALIDATED_DAYS : TTL_FAILED_DAYS;
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

// Semáforo: limita builds simultâneos. Groq free tier tem 30k TPM no vision
// e cada build consome ~30-50k tokens (4 views × ~10k cada). Mais que 1 em
// paralelo bate no rate limit. Builds extras aguardam na fila.
const MAX_CONCURRENT_BUILDS = 1;
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

export async function getOrBuildImages({ marca, modelo, ano, skipVision = false }) {
  if (!marca || !modelo || !ano) throw new Error('marca, modelo e ano são obrigatórios');
  const supabase = getSupabase();
  const key = makeKey({ marca, modelo, ano });

  const cached = await readCache(supabase, key);
  if (cached) {
    return { key, images: cached.images || [], validated: !!cached.validated, cached: true };
  }

  if (_inFlight.has(key)) return _inFlight.get(key);
  const promise = buildImages({ marca, modelo, ano, key, skipVision })
    .finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

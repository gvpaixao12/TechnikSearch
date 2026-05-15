// Busca imagens em dois provedores e devolve candidatos por view (frente,
// traseira, interior). Estratégia: Wikimedia Commons primeiro (grátis e
// ilimitado, mas só cobre modelos populares); se < 4 fotos boas numa view,
// completa com Serper.dev (proxy do Google Images, free tier 2.5k buscas).

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const SERPER_URL = 'https://google.serper.dev/images';
const MIN_WIDTH = 600;

// Wikimedia Commons — search no namespace File (6), filtra por dimensão/MIME.
// Faz 1 retry com delay se receber 429 (rate limit).
async function searchCommons(query, { limit = 15 } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    origin: '*',
  });
  let res = await fetch(`${COMMONS_API}?${params}`, {
    headers: { 'User-Agent': 'TechnikBot/1.0 (educacional; contato via app)' },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 1200));
    res = await fetch(`${COMMONS_API}?${params}`, {
      headers: { 'User-Agent': 'TechnikBot/1.0 (educacional; contato via app)' },
      signal: AbortSignal.timeout(10000),
    });
  }
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
  const json = await res.json();
  const pages = json?.query?.pages || {};
  const items = [];
  for (const p of Object.values(pages)) {
    const ii = p?.imageinfo?.[0];
    if (!ii?.url) continue;
    if (!/^image\/(jpeg|png|webp)$/i.test(ii.mime || '')) continue;
    if ((ii.width || 0) < MIN_WIDTH) continue;
    items.push({
      url: ii.url,
      width: ii.width,
      height: ii.height,
      source: 'commons',
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title || '')}`,
      title: p.title,
    });
  }
  return items;
}

async function searchSerper(query, { num = 10 } = {}) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY ausente no .env');
  const res = await fetch(SERPER_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num, gl: 'br', hl: 'pt-br' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const json = await res.json();
  return (json.images || [])
    .map(im => ({
      url: im.imageUrl,
      width: im.imageWidth,
      height: im.imageHeight,
      source: 'serper',
      page: im.link,
      title: im.title,
    }))
    .filter(im => im.url && (im.width || 0) >= MIN_WIDTH);
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

// Buscas direcionadas por view. Retorna { front, rear, interior } com
// candidatos dedupados de Commons + (se necessário) Serper.
export async function searchByView({ marca, modelo, ano }) {
  const base = `${marca} ${modelo} ${ano}`;
  const baseEn = `${marca} ${modelo} ${ano}`;
  const plans = {
    front: { pt: `${base} frente`, en: `${baseEn} front` },
    rear: { pt: `${base} traseira`, en: `${baseEn} rear` },
    side: { pt: `${base} lateral`, en: `${baseEn} side profile` },
    interior: { pt: `${base} interior painel`, en: `${baseEn} interior dashboard` },
  };

  const out = { front: [], rear: [], side: [], interior: [] };

  for (const [view, { pt, en }] of Object.entries(plans)) {
    // Commons é predominantemente catalogado em inglês.
    try {
      const c = await searchCommons(en, { limit: 15 });
      out[view].push(...c);
    } catch (e) {
      console.warn(`[providers] Commons ${view} falhou: ${e.message}`);
    }
    if (out[view].length < 4) {
      try {
        const s = await searchSerper(pt, { num: 10 });
        out[view].push(...s);
      } catch (e) {
        console.warn(`[providers] Serper ${view} falhou: ${e.message}`);
      }
    }
    out[view] = dedupeByUrl(out[view]);
  }
  return out;
}

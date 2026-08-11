// Camada de storage das fotos: Cloudflare R2 (API S3).
//
// Substitui o Supabase Storage, que estourou o free tier (1 GB). No R2 o free
// tier é 10 GB de storage e — o que mais importa aqui — EGRESS ZERO: servir foto
// não custa nada, independente de tráfego. O Postgres do Supabase continua onde
// está (índice `car_images_cache`, histórico, rascunhos): é texto, não pesa.
//
// O layout de caminhos é idêntico ao que o Supabase usava, `<key>/<vista>-NN.avif`,
// então a migração é 1:1 e o resto do pipeline não muda.
//
// Env necessária (ver .env.example):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE
import {
  S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export const BUCKET = process.env.R2_BUCKET || 'car-images';

// Cache do CDN pras fotos. 1h (igual ao default antigo do Supabase) e NÃO
// immutable de propósito: o rebuild sobrescreve o mesmo caminho (`front-01.avif`),
// então TTL longo deixaria foto velha grudada no cache da Cloudflare.
const CACHE_CONTROL = 'public, max-age=3600';

let _client = null;

export function getR2() {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY ausentes no .env');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // O SDK v3 novo manda checksum CRC32 em todo PUT por default; o R2 rejeita
    // alguns desses headers. WHEN_REQUIRED = só quando a operação exige.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

// Base pública das fotos: subdomínio r2.dev do bucket ou domínio custom.
// Sem barra no fim.
export function publicBase() {
  const base = process.env.R2_PUBLIC_BASE;
  if (!base) throw new Error('R2_PUBLIC_BASE ausente no .env (ex: https://pub-xxxx.r2.dev)');
  return base.replace(/\/+$/, '');
}

export function publicUrl(path) {
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  return `${publicBase()}/${encoded}`;
}

// Caminho no bucket a partir da URL pública. Aceita as DUAS formas: a do R2 e a
// legada do Supabase (…/object/public/car-images/<path>). O fallback existe
// porque durante a migração as duas convivem no índice — e porque linhas antigas
// podem reaparecer de backup depois.
export function pathFromUrl(url) {
  const s = String(url || '');
  const supaMarker = `/object/public/${BUCKET}/`;
  const i = s.indexOf(supaMarker);
  if (i >= 0) return decodeURIComponent(s.slice(i + supaMarker.length));
  let base;
  try { base = publicBase(); } catch { return null; }
  if (s.startsWith(base + '/')) return decodeURIComponent(s.slice(base.length + 1));
  return null;
}

// True se a URL ainda aponta pro Supabase Storage (usado pela migração).
export function isLegacyUrl(url) {
  return String(url || '').includes(`/object/public/${BUCKET}/`);
}

export async function putObject({ path, body, contentType }) {
  await getR2().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: path,
    Body: body,
    ContentType: contentType,
    CacheControl: CACHE_CONTROL,
  }));
  return publicUrl(path);
}

// Apaga em lotes de 1000 (teto da API S3). Não estoura se a lista vier vazia.
export async function removeObjects(paths) {
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return 0;
  const client = getR2();
  let removed = 0;
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    const res = await client.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
    }));
    if (res.Errors?.length) {
      for (const e of res.Errors) console.warn(`[storage] remove ${e.Key}: ${e.Message}`);
    }
    removed += chunk.length - (res.Errors?.length || 0);
  }
  return removed;
}

// Todos os objetos sob um prefixo. Retorna [{ path, size }], já paginado.
export async function listPrefix(prefix) {
  const client = getR2();
  const out = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of (res.Contents || [])) out.push({ path: o.Key, size: o.Size || 0 });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// "Pastas" top-level = as keys de carro. Usa Delimiter pra não baixar a listagem
// inteira só pra descobrir os prefixos.
export async function listFolders() {
  const client = getR2();
  const folders = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Delimiter: '/', ContinuationToken: token,
    }));
    for (const p of (res.CommonPrefixes || [])) {
      if (p.Prefix) folders.push(p.Prefix.replace(/\/$/, ''));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return folders;
}

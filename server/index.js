import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..');
import { getMarcas, getModelos, getAnos, getPreco } from './fipe.js';
import { resolveCandidate, resolveCandidates } from './match.js';
import { runCurator } from './agents.js';
import { normalizeBriefing } from './briefing.js';
import { recommend } from './recommend.js';
import { loadCatalog, clearCatalogCache } from './catalog.js';
import { getOrBuildImages } from './imageCache.js';
import { spawn } from 'node:child_process';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use(express.static(FRONTEND_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'Technik - Painel Visual.html'));
});

app.get('/api/health', async (_req, res) => {
  let catalogTotal = null;
  let catalogBuiltAt = null;
  try {
    const c = await loadCatalog();
    catalogTotal = c.entries.length;
    catalogBuiltAt = c.builtAt;
  } catch { /* sem catálogo */ }
  res.json({
    ok: true,
    groqKey: process.env.GROQ_API_KEY ? 'set' : 'missing',
    catalogTotal,
    catalogBuiltAt,
    time: new Date().toISOString(),
  });
});

app.get('/api/fipe/marcas', async (_req, res, next) => {
  try { res.json(await getMarcas()); } catch (e) { next(e); }
});

app.get('/api/fipe/modelos/:marca', async (req, res, next) => {
  try { res.json(await getModelos(req.params.marca)); } catch (e) { next(e); }
});

app.get('/api/fipe/anos/:marca/:modelo', async (req, res, next) => {
  try { res.json(await getAnos(req.params.marca, req.params.modelo)); } catch (e) { next(e); }
});

app.get('/api/fipe/preco/:marca/:modelo/:ano', async (req, res, next) => {
  try { res.json(await getPreco(req.params.marca, req.params.modelo, req.params.ano)); } catch (e) { next(e); }
});

app.post('/api/match', async (req, res, next) => {
  try {
    const { marca, modelo, ano } = req.body || {};
    if (!marca || !modelo || !ano) return res.status(400).json({ error: 'marca, modelo e ano são obrigatórios' });
    res.json(await resolveCandidate({ marca, modelo, ano }));
  } catch (e) { next(e); }
});

app.post('/api/match-batch', async (req, res, next) => {
  try {
    const { candidates } = req.body || {};
    if (!Array.isArray(candidates)) return res.status(400).json({ error: 'candidates deve ser um array' });
    res.json(await resolveCandidates(candidates));
  } catch (e) { next(e); }
});

app.post('/api/curator-only', async (req, res, next) => {
  try {
    const briefing = normalizeBriefing(req.body || {});
    const candidatos = await runCurator(briefing);
    res.json({ briefing, candidatos });
  } catch (e) { next(e); }
});

app.post('/api/recommend', async (req, res, next) => {
  try {
    const result = await recommend(req.body || {});
    res.json(result);
  } catch (e) { next(e); }
});

// Info do catálogo: contagens, build date, distribuição por tipo
app.get('/api/catalog/info', async (_req, res) => {
  try {
    const c = await loadCatalog();
    res.json({
      ok: true,
      builtAt: c.builtAt,
      builtFrom: c.builtFrom || 'fipe',
      anoMin: c.anoMin,
      total: c.entries.length,
      tipos: c.stats?.tipos || {},
      marcas: [...new Set(c.entries.map(e => e.marca))].sort(),
    });
  } catch (e) {
    res.status(404).json({ ok: false, reason: e.message });
  }
});

// Reconstrói catálogo a partir do cache local (rápido, sem requests à FIPE).
// Retorna após ~1-3s. Pra build full da FIPE, rodar manualmente o script.
let _rebuildInProgress = false;
app.post('/api/catalog/rebuild-from-cache', async (_req, res) => {
  if (_rebuildInProgress) return res.status(409).json({ ok: false, reason: 'Build já em progresso' });
  _rebuildInProgress = true;
  const t0 = Date.now();
  const proc = spawn('node', [path.join(__dirname, 'scripts', 'build-catalog-from-cache.js')], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', d => stderr += d.toString());
  proc.on('close', async code => {
    _rebuildInProgress = false;
    if (code !== 0) {
      return res.status(500).json({ ok: false, reason: 'Build falhou', stdout, stderr });
    }
    clearCatalogCache();
    const c = await loadCatalog();
    res.json({
      ok: true,
      durationMs: Date.now() - t0,
      total: c.entries.length,
      builtAt: c.builtAt,
      tipos: c.stats?.tipos || {},
    });
  });
});

// Imagens dos modelos: busca + valida + cacheia no Supabase.
// Primeira request por modelo demora (~10-30s); subsequentes são instant.
app.get('/api/images/:marca/:modelo/:ano', async (req, res, next) => {
  try {
    const ano = Number(req.params.ano);
    if (!Number.isFinite(ano)) return res.status(400).json({ error: 'ano inválido' });
    // skipVision: 1º acesso devolve fotos rápido via heurística; allowUpgrade liga
    // o upgrade pra vision (limpa watermark, valida modelo) em background no próximo acesso.
    const result = await getOrBuildImages({
      marca: req.params.marca,
      modelo: req.params.modelo,
      ano,
      skipVision: true,
      allowUpgrade: true,
    });
    res.json(result);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Technik server on http://localhost:${PORT}`);
});

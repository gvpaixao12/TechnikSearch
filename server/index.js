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

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use(express.static(FRONTEND_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'Technik - Painel Visual.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    groqKey: process.env.GROQ_API_KEY ? 'set' : 'missing',
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

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Technik server on http://localhost:${PORT}`);
});

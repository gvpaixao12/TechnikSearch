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
import { recommend, diagnoseMiss, suggestModels, invalidateRankingHints } from './recommend.js';
import { loadCatalog, clearCatalogCache } from './catalog.js';
import { getOrBuildImages, listCachedCars, addManualImages, rebuildCarImages, getCarPhotos, deleteCarPhoto, setPhotoFavorite } from './imageCache.js';
import { saveConsulta, listConsultas, getConsulta, getStats } from './history.js';
import { saveFeedback, listFeedback } from './feedback.js';
import { saveRascunho, listRascunhos, getRascunho, deleteRascunho } from './rascunhos.js';
import { painelUso, saldoSerper } from './usage.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  autentica, criaSessao, destroiSessao, setCookieSessao, limpaCookieSessao,
  leCookie, identifica, exigeAuth, limpaSessoesVencidas, COOKIE,
  listaUsuarios, criaUsuario, removeUsuario, resetaSenha, trocaSenhaPropria,
  registraPedidoSenha, listaPedidosSenha, marcaPedidoAtendido,
  exigeAdmin, defineAdmin,
} from './auth.js';

const app = express();

// O nginx é quem termina o TLS; sem isso req.secure é sempre false e o cookie
// de sessão nunca ganharia a flag Secure em produção.
app.set('trust proxy', 1);

app.use(cors());

// Upload manual de fotos (base64): precisa de body grande. Parser dedicado,
// registrado ANTES do parser global de 1mb pra não esbarrar no limite. Como o
// handler responde e não chama next(), o parser global nunca roda nesta rota.
app.post('/api/supabase/cars/manual-photos', exigeAuth('busca'), express.json({ limit: '40mb' }), async (req, res) => {
  try {
    const { marca, modelo, ano, images, view } = req.body || {};
    if (!marca || !modelo || !ano) {
      return res.status(400).json({ ok: false, reason: 'marca, modelo e ano são obrigatórios' });
    }
    const result = await addManualImages({ marca, modelo, ano: Number(ano), dataUrls: images, view });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.use(express.json({ limit: '1mb' }));

// ─── Público ─────────────────────────────────────────────────────────────────
// Só o que a tela de login precisa pra desenhar. Tudo o mais fica atrás do
// portão logo abaixo — inclusive os .jsx do app, que antes eram servidos a
// quem pedisse.

app.get('/login', (req, res) => {
  // Já autenticado não deve ver tela de login: manda pra onde ele pode ir.
  identifica(req)
    .then(quem => (quem ? res.redirect(quem.escopo === 'busca' ? '/busca' : '/crm')
                        : res.sendFile(path.join(FRONTEND_DIR, 'login.html'))))
    .catch(() => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));
});

app.get('/brand-styles.css', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'brand-styles.css')));
app.use('/assets', express.static(path.join(FRONTEND_DIR, 'assets')));

app.post('/api/login', async (req, res) => {
  try {
    const { login, senha } = req.body || {};
    const u = await autentica({ login, senha });
    if (!u) return res.status(401).json({ ok: false, reason: 'usuário ou senha incorretos' });
    const token = await criaSessao({ usuarioId: u.id, userAgent: req.headers['user-agent'] });
    setCookieSessao(req, res, token);
    // `trocarSenha` avisa o frontend que a sessão só alcança /trocar-senha —
    // é o caso de quem entrou com a temporária que o admin gerou.
    res.json({
      ok: true,
      usuario: { login: u.login, nome: u.nome },
      trocarSenha: u.senhaTemporaria === true,
    });
  } catch (e) {
    console.error('[login] falhou:', e.message);
    res.status(500).json({ ok: false, reason: 'erro ao entrar' });
  }
});

// "Esqueci minha senha": registra o pedido pro admin ver no CRM. Não há e-mail
// no projeto — o admin gera uma senha temporária e entrega por fora.
//
// Responde igual exista ou não o login: resposta diferente pra login
// inexistente entregaria quais existem a quem ficasse testando.
app.post('/api/pedido-senha', async (req, res) => {
  try { await registraPedidoSenha(req.body?.login); }
  catch (e) { console.warn('[pedido-senha] falhou:', e.message); }
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  try { await destroiSessao(leCookie(req, COOKIE)); } catch { /* já era */ }
  limpaCookieSessao(res);
  res.json({ ok: true });
});

// ─── Portão ──────────────────────────────────────────────────────────────────
// Daqui pra baixo tudo exige identificação: sessão de navegador ou token de
// dispositivo. É isto que impede um desconhecido com a URL de chamar
// /api/recommend e gastar os créditos da OpenAI.

app.use(exigeAuth('busca'));

app.get('/api/me', (req, res) => {
  const a = req.auth;
  res.json({
    ok: true,
    tipo: a.tipo,
    nome: a.tipo === 'usuario' ? (a.nome || a.login) : a.nome,
    escopo: a.escopo,
    // O CRM usa isto pra não oferecer "remover" no próprio usuário.
    usuarioId: a.usuarioId || null,
    admin: a.admin === true,
  });
});

// ─── Troca de senha ──────────────────────────────────────────────────────────
// Alcançável mesmo com senha temporária — é a única coisa que é (ver
// LIBERADO_COM_SENHA_TEMPORARIA em auth.js).

app.get('/trocar-senha', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'trocar-senha.html'));
});

app.post('/api/trocar-senha', async (req, res) => {
  try {
    if (req.auth?.tipo !== 'usuario') {
      return res.status(403).json({ ok: false, reason: 'só usuários trocam senha' });
    }
    const { senha, senhaAtual } = req.body || {};
    await trocaSenhaPropria({
      usuarioId: req.auth.usuarioId,
      tokenAtual: leCookie(req, COOKIE),
      senhaAtual,
      novaSenha: senha,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// ─── Administração de usuários (só no CRM) ───────────────────────────────────

app.get('/api/usuarios', exigeAuth('crm'), exigeAdmin, async (_req, res) => {
  try { res.json({ ok: true, usuarios: await listaUsuarios() }); }
  catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
});

app.post('/api/usuarios', exigeAuth('crm'), exigeAdmin, async (req, res) => {
  try {
    const { login, nome, senha, admin } = req.body || {};
    const id = await criaUsuario({ login, nome, senha, admin });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.delete('/api/usuarios/:id', exigeAuth('crm'), exigeAdmin, async (req, res) => {
  try {
    await removeUsuario(req.params.id, req.auth.usuarioId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// Devolve a senha temporária UMA vez — não fica recuperável depois.
app.post('/api/usuarios/:id/resetar-senha', exigeAuth('crm'), exigeAdmin, async (req, res) => {
  try {
    const r = await resetaSenha(req.params.id);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.post('/api/usuarios/:id/admin', exigeAuth('crm'), exigeAdmin, async (req, res) => {
  try {
    await defineAdmin({ id: req.params.id, admin: req.body?.admin === true, quemPede: req.auth.usuarioId });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

app.get('/api/pedidos-senha', exigeAuth('crm'), exigeAdmin, async (_req, res) => {
  try { res.json({ ok: true, pedidos: await listaPedidosSenha() }); }
  catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
});

app.post('/api/pedidos-senha/:id/atender', exigeAuth('crm'), exigeAdmin, async (req, res) => {
  try {
    await marcaPedidoAtendido(req.params.id, req.auth.usuarioId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// A raiz não tem tela própria: manda cada um pro seu lugar. O desktop chega
// como dispositivo (escopo 'busca') e cairia num 403 se fosse jogado no CRM.
app.get('/', (req, res) => {
  res.redirect(req.auth.escopo === 'busca' ? '/busca' : '/crm');
});

// A busca — o que o app desktop abre.
app.get('/busca', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'Technik - Painel Visual.html'));
});

// O CRM exige escopo próprio: token de dispositivo não alcança.
app.get('/crm', exigeAuth('crm'), (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'crm.html'));
});

// FRONTEND_DIR é a raiz do projeto, e ela contém `server/`. Sem este guarda o
// código do backend sai pela web — o `.env` não, porque o express ignora
// dotfiles por padrão, mas `server/auth.js` e o resto sim.
app.use((req, res, next) => {
  if (/^\/(server|node_modules|desktop)(\/|$)/i.test(req.path)) return res.status(404).end();
  next();
});

app.use(express.static(FRONTEND_DIR));

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

// Consumo das APIs pagas — quanto de crédito/token ainda existe. Fica atrás do
// escopo `crm` porque expõe saldo e gasto da conta, não do cliente.
app.get('/api/admin/usage', exigeAuth('crm'), async (req, res) => {
  try {
    // ?force=1 fura o cache de 5 min do saldo do Serper (botão "atualizar").
    if (req.query.force) await saldoSerper({ force: true });
    res.json(await painelUso());
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
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
    // Gera o id AQUI pra devolver junto com o resultado: o frontend precisa
    // dele pra amarrar o feedback à consulta, e assim não esperamos o insert.
    const consultaId = randomUUID();
    res.json({ ...result, consultaId });
    // Grava no histórico depois de responder — save nunca atrasa nem quebra
    // a recomendação (erros são engolidos dentro de saveConsulta).
    saveConsulta({ id: consultaId, client: req.body?.client, result });
  } catch (e) { next(e); }
});

// ─── Histórico de consultas ──────────────────────────────────────
app.get('/api/consultas/stats', async (_req, res) => {
  try {
    res.json({ ok: true, stats: await getStats() });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

app.get('/api/consultas', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ ok: true, consultas: await listConsultas({ limit }) });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

app.get('/api/consultas/:id', async (req, res) => {
  try {
    const consulta = await getConsulta(req.params.id);
    if (!consulta) return res.status(404).json({ ok: false, reason: 'Consulta não encontrada' });
    res.json({ ok: true, consulta });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

// ─── Feedback do consultor sobre a busca ─────────────────────────
// Se veio "senti falta de X", diagnostica na hora POR QUE X não apareceu e
// devolve junto: o consultor vê a causa no mesmo clique, e a causa fica
// gravada com o feedback (vira fila de trabalho: gap de catálogo, filtro
// apertado ou ranking do vendedor).
app.post('/api/feedback', async (req, res) => {
  try {
    const { consultaId, rating, motivos, comentario, faltou, client, briefing, topModels } = req.body || {};

    let diagnostico = null;
    if (faltou?.trim()) {
      try {
        diagnostico = await diagnoseMiss({
          briefing,
          termo: faltou,
          topModels: Array.isArray(topModels) ? topModels : [],
        });
      } catch (e) {
        // Diagnóstico é bônus — nunca impede o feedback de ser salvo.
        console.warn('[feedback] diagnoseMiss falhou (ignorado):', e.message);
      }
    }

    try {
      const id = await saveFeedback({
        consultaId, rating, motivos, comentario, faltou, diagnostico,
        clientName: client?.name, briefing,
      });
      // Reclamação de ranking vira lembrete pro vendedor na PRÓXIMA busca. O
      // cache dos lembretes tem TTL de 5 min; sem este invalidate, o consultor
      // reclamaria e a busca seguinte ainda ignoraria o que ele acabou de dizer.
      if (diagnostico?.causa === 'vendedor-nao-escolheu') invalidateRankingHints();
      res.json({ ok: true, id, diagnostico });
    } catch (e) {
      // Não salvou (Supabase pausado, tabela ainda não criada…). Devolve o erro
      // sem esconder — mas manda o diagnóstico junto: ele já foi calculado e é
      // útil pro consultor agora, mesmo que a linha não tenha sido gravada.
      res.status(503).json({ ok: false, reason: e.message, diagnostico });
    }
  } catch (e) {
    res.status(500).json({ ok: false, reason: e.message });
  }
});

app.get('/api/feedback', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ ok: true, feedback: await listFeedback({ limit, rating: req.query.rating }) });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

// Autocomplete do campo "senti falta de" — nomes reais do catálogo, pra que o
// termo digitado seja diagnosticável em vez de texto solto.
app.get('/api/catalog/models', async (req, res) => {
  try {
    res.json({ ok: true, models: await suggestModels(req.query.q || '') });
  } catch (e) {
    res.status(404).json({ ok: false, reason: e.message });
  }
});

// ─── Rascunhos de briefing ───────────────────────────────────────
app.post('/api/rascunhos', async (req, res) => {
  try {
    const { id, client_name, form } = req.body || {};
    if (!form || typeof form !== 'object') {
      return res.status(400).json({ ok: false, reason: 'form é obrigatório' });
    }
    const savedId = await saveRascunho({ id, client_name, form });
    res.json({ ok: true, id: savedId });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

app.get('/api/rascunhos', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ ok: true, rascunhos: await listRascunhos({ limit }) });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

app.get('/api/rascunhos/:id', async (req, res) => {
  try {
    const rascunho = await getRascunho(req.params.id);
    if (!rascunho) return res.status(404).json({ ok: false, reason: 'Rascunho não encontrado' });
    res.json({ ok: true, rascunho });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

app.delete('/api/rascunhos/:id', async (req, res) => {
  try {
    await deleteRascunho(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
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

// Catálogo no Supabase: lista tudo que está cadastrado no cache de imagens,
// com contagem de fotos por carro. Alimenta a aba Ajustes → Catálogo.
app.get('/api/supabase/cars', async (_req, res) => {
  try {
    res.json({ ok: true, cars: await listCachedCars() });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

// "Buscar com IA" pra um carro específico, com o portão de visão. Bloqueante
// (~10-30s). scope: 'missing' (só as vistas sem foto, mantém o resto) ou 'full'
// (apaga tudo e refaz do zero). marca/modelo no body pra evitar "/" na URL.
app.post('/api/supabase/cars/fetch-ai', async (req, res) => {
  try {
    const { marca, modelo, ano, scope } = req.body || {};
    if (!marca || !modelo || !ano) {
      return res.status(400).json({ ok: false, reason: 'marca, modelo e ano são obrigatórios' });
    }
    const result = await rebuildCarImages({
      marca, modelo, ano: Number(ano), scope: scope === 'missing' ? 'missing' : 'full',
    });
    res.json({ ok: true, key: result.key, photoCount: result.photoCount, views: result.views, added: result.added, validated: result.validated });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

// Versão SSE do fetch-ai: mesma busca, mas emite os estágios (queue → search →
// download → validate → upload → done) ao vivo pro cliente desenhar a barra de
// progresso. EventSource só faz GET, então os params vêm na query. O POST acima
// continua existindo como fallback (uma única resposta, sem progresso).
app.get('/api/supabase/cars/fetch-ai-stream', async (req, res) => {
  const { marca, modelo, ano, scope } = req.query || {};
  if (!marca || !modelo || !ano) {
    return res.status(400).json({ ok: false, reason: 'marca, modelo e ano são obrigatórios' });
  }
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: não buffera SSE
  });
  res.flushHeaders?.();
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  // Ping periódico: mantém a conexão viva através de proxies com idle timeout.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  // Se o cliente desistir (fechou a aba/tray), paramos de tentar escrever.
  let aborted = false;
  req.on('close', () => { aborted = true; });
  try {
    const result = await rebuildCarImages({
      marca, modelo, ano: Number(ano), scope: scope === 'missing' ? 'missing' : 'full',
      onProgress: (p) => { if (!aborted) send('progress', p); },
    });
    if (!aborted) send('done', { ok: true, key: result.key, photoCount: result.photoCount, views: result.views, added: result.added, validated: result.validated });
  } catch (e) {
    if (!aborted) send('error', { ok: false, reason: e.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

// Fotos atuais de um carro (galeria) pra exibir/gerenciar na tela de Ajustes.
app.post('/api/supabase/cars/photos', async (req, res) => {
  try {
    const { marca, modelo, ano } = req.body || {};
    if (!marca || !modelo || !ano) {
      return res.status(400).json({ ok: false, reason: 'marca, modelo e ano são obrigatórios' });
    }
    res.json({ ok: true, ...(await getCarPhotos({ marca, modelo, ano: Number(ano) })) });
  } catch (e) {
    res.status(503).json({ ok: false, reason: e.message });
  }
});

// Exclui uma foto específica (por URL) de um carro.
app.post('/api/supabase/cars/delete-photo', async (req, res) => {
  try {
    const { marca, modelo, ano, url } = req.body || {};
    if (!marca || !modelo || !ano || !url) {
      return res.status(400).json({ ok: false, reason: 'marca, modelo, ano e url são obrigatórios' });
    }
    res.json({ ok: true, ...(await deleteCarPhoto({ marca, modelo, ano: Number(ano), url })) });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// Marca/desmarca uma foto como favorita (protegida da varredura completa).
app.post('/api/supabase/cars/favorite-photo', async (req, res) => {
  try {
    const { marca, modelo, ano, url, favorite } = req.body || {};
    if (!marca || !modelo || !ano || !url) {
      return res.status(400).json({ ok: false, reason: 'marca, modelo, ano e url são obrigatórios' });
    }
    res.json({ ok: true, ...(await setPhotoFavorite({ marca, modelo, ano: Number(ano), url, favorite })) });
  } catch (e) {
    res.status(400).json({ ok: false, reason: e.message });
  }
});

// Imagens dos modelos: busca + valida + cacheia no Supabase.
// Primeira request por modelo demora (~10-30s); subsequentes são instant.
app.get('/api/images/:marca/:modelo/:ano', async (req, res, next) => {
  try {
    const ano = Number(req.params.ano);
    if (!Number.isFinite(ano)) return res.status(400).json({ error: 'ano inválido' });
    // Portão de visão: valida por visão (gpt-4o-mini) antes de mostrar. Entrada
    // heurística é re-validada com as fotos que já temos — descarta europeu,
    // mão-inglesa e modelo errado. Sem foto certa = placeholder (honestidade).
    const result = await getOrBuildImages({
      marca: req.params.marca,
      modelo: req.params.modelo,
      ano,
      skipVision: false,
      // Não bloqueia o card: entrada heurística é servida na hora e revalidada
      // na visão em background pro próximo visitante (sem delay no top).
      revalidateInBackground: true,
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

import { normalizeBriefing } from './briefing.js';
import { runCurator, runVendor, runCuradorLeve } from './agents.js';
import { resolveCandidates } from './match.js';
import { loadCatalog } from './catalog.js';
import { splitModelo } from './classify.js';

const TIPO_TO_SLUG = {
  'Hatch': 'hatch',
  'Sedã': 'sedan', 'Sedan': 'sedan',
  'SUV': 'suv',
  'Picape': 'pickup',
  'Coupé': 'coupe', 'Coupe': 'coupe', 'Esportivo': 'coupe',
  'Minivan': 'minivan',
};

function tipoSlug(tipo) {
  if (!tipo) return 'suv';
  return TIPO_TO_SLUG[tipo] || 'suv';
}

function normFuel(s) {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function slugifyId(marca, modelo, ano) {
  const base = `${marca}-${modelo}-${ano}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 60);
}

// Match flexível de combustível: usuário aceita 'flex' → bate com flex, gasolina, álcool.
function combMatch(briefingFuels, entryFuel) {
  if (!briefingFuels.length) return true;
  const e = normFuel(entryFuel);
  return briefingFuels.some(b => {
    if (b === e) return true;
    // Flex aceita gasolina (carros flex são abastecidos com gasolina também)
    if (b === 'flex' && (e === 'gasolina' || e === 'flex')) return true;
    if (b === 'gasolina' && (e === 'gasolina' || e === 'flex')) return true;
    if (b === 'hibrido' && (e === 'hibrido' || e === 'hibrido plug-in')) return true;
    return false;
  });
}

// ─── Pipeline NOVO usando catálogo pré-computado ──────────────────────────
async function recommendFromCatalog(briefing, log) {
  const catalog = await loadCatalog();
  log('catalog-loaded', { count: catalog.entries.length });

  const tiposPedidos = (briefing.tiposDesejados || [])
    .map(t => TIPO_TO_SLUG[t]).filter(Boolean);
  const combsPedidas = (briefing.combustiveisAceitos || []).map(normFuel);
  const orc = briefing.orcamentoReais;
  const anoMin = briefing.anoMin;
  const anoMax = briefing.anoMax;

  const reasonsCount = { ano: 0, tipo: 0, comb: 0, orcamento: 0, semPreco: 0 };

  // Modo normal: 95% a 105% do orçamento (margem pequena)
  let pool = catalog.entries.filter(e => {
    if (!e.preco) { reasonsCount.semPreco++; return false; }
    if (anoMin && e.ano < Number(anoMin)) { reasonsCount.ano++; return false; }
    if (anoMax && e.ano > Number(anoMax)) { reasonsCount.ano++; return false; }
    if (tiposPedidos.length && !tiposPedidos.includes(e.tipo)) { reasonsCount.tipo++; return false; }
    if (combsPedidas.length && !combMatch(combsPedidas, e.combustivel)) { reasonsCount.comb++; return false; }
    if (e.preco < orc.min * 0.95 || (orc.max != null && e.preco > orc.max * 1.05)) { reasonsCount.orcamento++; return false; }
    return true;
  });

  log('catalog-filtered', { count: pool.length, descartes: reasonsCount });

  // Relaxa orçamento se sobrou pouco — piso em 90% do mínimo (mais conservador)
  if (pool.length < 5) {
    pool = catalog.entries.filter(e => {
      if (!e.preco) return false;
      if (anoMin && e.ano < Number(anoMin)) return false;
      if (anoMax && e.ano > Number(anoMax)) return false;
      if (tiposPedidos.length && !tiposPedidos.includes(e.tipo)) return false;
      if (combsPedidas.length && !combMatch(combsPedidas, e.combustivel)) return false;
      if (e.preco < orc.min * 0.9 || (orc.max != null && e.preco > orc.max * 1.10)) return false;
      return true;
    });
    log('catalog-relaxed', { count: pool.length });
  }

  // Dedupe por código FIPE (mesmo carro com 2+ codigosModelo iguais)
  const seenFipe = new Set();
  pool = pool.filter(e => {
    if (seenFipe.has(e.codigoFipe)) return false;
    seenFipe.add(e.codigoFipe);
    return true;
  });

  if (pool.length === 0) {
    return {
      ok: false,
      reason: `Não encontrei opções no catálogo que respeitem o briefing (ano>=${anoMin}${anoMax ? ` e <=${anoMax}` : ''}, tipo(s) ${briefing.tiposDesejados.join(', ')}, combustível(is) ${briefing.combustiveisAceitos.join(', ')}, R$ ${orc.min.toLocaleString('pt-BR')}-${orc.max == null ? 'sem teto' : orc.max.toLocaleString('pt-BR')}). Tente refinar critérios.`,
      diagnostico: { catalogTotal: catalog.entries.length, descartesPorEtapa: reasonsCount },
    };
  }

  // Curador leve LLM: se sobrou muito, prioriza top ~30 mais relevantes
  let candidates = pool;
  if (pool.length > 30) {
    try {
      const ids = await runCuradorLeve(briefing, pool);
      const byKey = new Map(pool.map(e => [`${e.marcaId}|${e.modeloId}|${e.anoId}`, e]));
      const picked = ids.map(id => byKey.get(id)).filter(Boolean);
      if (picked.length >= 5) candidates = picked.slice(0, 30);
      log('curador-leve-done', { count: candidates.length });
    } catch (e) {
      console.warn('[curador-leve] falhou, usando pool inteiro:', e.message);
      candidates = pool.slice(0, 30);
    }
  }

  // Adapta formato pro vendor (espera { fipe: { ... } })
  const candidatesForVendor = candidates.map(e => ({
    fipe: {
      marca: e.marca, modelo: e.modelo, anoModelo: e.ano,
      precoTexto: e.precoTexto, preco: e.preco,
      codigoFipe: e.codigoFipe, mesReferencia: e.mesReferencia,
      combustivel: e.combustivel,
    },
    cand: { tipo: e.tipo, combustivel: e.combustivel, marca: e.marca, modelo: e.modelo, ano: e.ano },
  }));

  const top = await runVendor(briefing, candidatesForVendor);
  log('vendor-done', { count: top.length });

  const byId = new Map(candidatesForVendor.map((p, i) => [`c${i + 1}`, p]));
  const seenInTop = new Set();
  const topEnriched = top
    .map(t => {
      const pair = byId.get(t.candidatoId);
      if (!pair) return null;
      const f = pair.fipe;
      if (seenInTop.has(t.candidatoId) || seenInTop.has(`fipe:${f.codigoFipe}`)) return null;
      seenInTop.add(t.candidatoId);
      seenInTop.add(`fipe:${f.codigoFipe}`);
      const { versao, motor } = splitModelo(f.modelo);
      return {
        id: slugifyId(f.marca, f.modelo, f.anoModelo),
        rank: t.rank,
        fichaTecnica: t.fichaTecnica || {},
        brand: f.marca,
        model: f.modelo,
        versao,
        motor,
        year: f.anoModelo,
        type: pair.cand.tipo,
        fuel: f.combustivel,
        price: f.precoTexto,
        priceN: f.preco,
        codigoFipe: f.codigoFipe,
        mesReferencia: f.mesReferencia,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  return {
    ok: true,
    briefing,
    top: topEnriched,
    diagnostico: {
      catalogTotal: catalog.entries.length,
      catalogPool: pool.length,
      curadorLeveSelecionou: candidates.length,
      vendedorRetornou: topEnriched.length,
      descartesPorEtapa: reasonsCount,
      builtAt: catalog.builtAt,
    },
  };
}

// ─── Recommend (entrypoint) ──────────────────────────────────────────────
export async function recommend(rawBriefing, { onStep } = {}) {
  const log = (step, payload) => {
    console.log(`[recommend] ${step}`, payload?.count !== undefined ? `(${payload.count})` : '', payload?.descartes ? JSON.stringify(payload.descartes) : '');
    onStep?.(step, payload);
  };

  const briefing = normalizeBriefing(rawBriefing);
  log('briefing-normalized');

  // Tenta usar catálogo. Se não existir, cai no fluxo antigo (LLM curador + FIPE matching).
  try {
    return await recommendFromCatalog(briefing, log);
  } catch (e) {
    if (e.message?.includes('Catálogo não encontrado')) {
      console.warn('[recommend] catálogo não disponível, usando fluxo legado LLM-curator');
      return await recommendLegacy(briefing, log);
    }
    throw e;
  }
}

// ─── Pipeline LEGADO (LLM curador + FIPE matching) ──────────────────────
// Mantido como fallback até o catálogo estar pronto.
async function recommendLegacy(briefing, log) {
  const candidatos = await runCurator(briefing);
  log('curator-done', { count: candidatos.length });

  const resolved = await resolveCandidates(candidatos, { anoMin: briefing.anoMin });
  const pairs = candidatos.map((cand, i) => ({ cand, res: resolved[i] }));
  const okPairs = pairs.filter(p => p.res?.ok);
  const failed = pairs.filter(p => !p.res?.ok);

  const seenFipe = new Set();
  const matched = [];
  for (const p of okPairs) {
    const key = p.res.fipe.codigoFipe;
    if (seenFipe.has(key)) continue;
    seenFipe.add(key);
    matched.push(p);
  }
  log('fipe-resolved', { count: matched.length });

  if (matched.length === 0) {
    return { ok: false, reason: 'Catálogo não disponível e curador LLM não retornou candidatos resolvíveis na FIPE.' };
  }

  const orc = briefing.orcamentoReais;
  const anoMin = briefing.anoMin;
  const anoMax = briefing.anoMax;
  const tiposPedidosSlug = (briefing.tiposDesejados || []).map(t => TIPO_TO_SLUG[t]).filter(Boolean);
  const combsOK = (briefing.combustiveisAceitos || []).map(normFuel);

  let pool = matched.filter(p => {
    const f = p.res.fipe;
    if (anoMin && Number(f.anoModelo) < Number(anoMin)) return false;
    if (anoMax && Number(f.anoModelo) > Number(anoMax)) return false;
    if (tiposPedidosSlug.length && !tiposPedidosSlug.includes(tipoSlug(p.cand.tipo))) return false;
    if (combsOK.length && !combMatch(combsOK, f.combustivel)) return false;
    if (f.preco < orc.min * 0.85 || (orc.max != null && f.preco > orc.max * 1.05)) return false;
    return true;
  });

  if (pool.length === 0) {
    return { ok: false, reason: 'Após filtros (ano/tipo/combustível/orçamento), nenhum candidato sobrou. Refine o briefing.' };
  }

  const top = await runVendor(briefing, pool.map(p => p.res));
  log('vendor-done', { count: top.length });

  const byId = new Map(pool.map((p, i) => [`c${i + 1}`, p]));
  const topEnriched = top
    .map(t => {
      const pair = byId.get(t.candidatoId);
      if (!pair) return null;
      const f = pair.res.fipe;
      const { versao, motor } = splitModelo(f.modelo);
      return {
        id: slugifyId(f.marca, f.modelo, f.anoModelo),
        rank: t.rank,
        fichaTecnica: t.fichaTecnica || {},
        brand: f.marca, model: f.modelo, versao, motor, year: f.anoModelo,
        type: tipoSlug(pair.cand.tipo),
        fuel: f.combustivel,
        price: f.precoTexto, priceN: f.preco,
        codigoFipe: f.codigoFipe, mesReferencia: f.mesReferencia,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  return { ok: true, briefing, top: topEnriched, diagnostico: { fluxo: 'legacy', curador: candidatos.length, fipe: matched.length, pool: pool.length, vendedor: topEnriched.length } };
}

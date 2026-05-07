import { normalizeBriefing } from './briefing.js';
import { runCurator, runVendor } from './agents.js';
import { resolveCandidates } from './match.js';

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

function slugifyId(marca, modelo, ano) {
  const base = `${marca}-${modelo}-${ano}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 60);
}

export async function recommend(rawBriefing, { onStep } = {}) {
  const log = (step, payload) => {
    console.log(`[recommend] ${step}`, payload?.count !== undefined ? `(${payload.count})` : '');
    onStep?.(step, payload);
  };

  const briefing = normalizeBriefing(rawBriefing);
  log('briefing-normalized');

  const candidatos = await runCurator(briefing);
  log('curator-done', { count: candidatos.length });

  const resolved = await resolveCandidates(candidatos);

  const pairs = candidatos.map((cand, i) => ({ cand, res: resolved[i] }));
  const okPairs = pairs.filter(p => p.res?.ok);
  const failed = pairs.filter(p => !p.res?.ok)
    .map(p => ({ input: p.cand, reason: p.res?.reason }));

  const seenFipe = new Set();
  const matched = [];
  const duplicates = [];
  for (const p of okPairs) {
    const key = p.res.fipe.codigoFipe;
    if (seenFipe.has(key)) { duplicates.push(p); continue; }
    seenFipe.add(key);
    matched.push(p);
  }
  log('fipe-resolved', { count: matched.length, failed: failed.length, duplicados: duplicates.length });

  if (matched.length === 0) {
    return {
      ok: false,
      reason: 'Nenhum candidato pôde ser resolvido na FIPE. Tente refinar o briefing (modelos mais comuns, ano mínimo menor, ou amplie os tipos de carroceria).',
      diagnostico: { candidatos, falhas: failed },
    };
  }

  // Filtro rígido por ano mínimo (usa anoModelo da FIPE, não a sugestão do LLM)
  const anoMin = briefing.anoMin;
  let anoFiltered = matched;
  let removidosPorAno = [];
  if (anoMin) {
    removidosPorAno = matched
      .filter(p => Number(p.res.fipe.anoModelo) < Number(anoMin))
      .map(p => ({ marca: p.res.fipe.marca, modelo: p.res.fipe.modelo, ano: p.res.fipe.anoModelo }));
    anoFiltered = matched.filter(p => Number(p.res.fipe.anoModelo) >= Number(anoMin));
    log('ano-filtered', { count: anoFiltered.length, removidos: removidosPorAno.length });
  }

  // Filtro rígido por tipo de carroceria (compara slug do curador com slugs pedidos)
  const tiposPedidosSlug = (briefing.tiposDesejados || [])
    .map(t => TIPO_TO_SLUG[t])
    .filter(Boolean);
  let tipoFiltered = anoFiltered;
  let removidosPorTipo = [];
  if (tiposPedidosSlug.length) {
    removidosPorTipo = anoFiltered
      .filter(p => !tiposPedidosSlug.includes(tipoSlug(p.cand.tipo)))
      .map(p => ({ marca: p.res.fipe.marca, modelo: p.res.fipe.modelo, ano: p.res.fipe.anoModelo, tipo: p.cand.tipo }));
    tipoFiltered = anoFiltered.filter(p => tiposPedidosSlug.includes(tipoSlug(p.cand.tipo)));
    log('tipo-filtered', { count: tipoFiltered.length, removidos: removidosPorTipo.length });
  }

  if (tipoFiltered.length === 0) {
    const motivos = [];
    if (anoMin && removidosPorAno.length) motivos.push(`ano mínimo ${anoMin} (${removidosPorAno.length} descartados por ano)`);
    if (removidosPorTipo.length) motivos.push(`tipo(s) ${briefing.tiposDesejados.join(', ')} (${removidosPorTipo.length} descartados por carroceria)`);
    return {
      ok: false,
      reason: `Não encontrei opções que respeitem o briefing${motivos.length ? ': ' + motivos.join(' e ') : ''}. Sugiro refinar a busca — talvez ampliar o orçamento, baixar o ano mínimo ou aceitar tipos próximos.`,
      diagnostico: {
        curadorSugeriu: candidatos.length,
        fipeResolvidos: matched.length,
        descartadosPorAno: removidosPorAno,
        descartadosPorTipo: removidosPorTipo,
      },
    };
  }

  const orc = briefing.orcamentoReais;
  const lower = orc.min * 0.85;
  const upper = orc.max * 1.05;
  let inBudget = tipoFiltered.filter(p => p.res.fipe.preco >= lower && p.res.fipe.preco <= upper);
  let budgetMode = 'normal';
  if (inBudget.length < 5) {
    inBudget = tipoFiltered.filter(p => p.res.fipe.preco >= orc.min * 0.7 && p.res.fipe.preco <= orc.max * 1.1);
    budgetMode = 'relaxed';
  }
  if (inBudget.length < 3) {
    inBudget = tipoFiltered.filter(p => p.res.fipe.preco <= orc.max * 1.1);
    budgetMode = 'budget-cap-only';
  }
  const foraOrcamento = tipoFiltered.filter(p => !inBudget.includes(p));
  log('budget-filtered', { count: inBudget.length, fora: foraOrcamento.length, mode: budgetMode });

  if (inBudget.length === 0) {
    return {
      ok: false,
      reason: `Encontrei modelos que respeitam ano mínimo e carroceria, mas nenhum dentro do orçamento de R$ ${orc.min.toLocaleString('pt-BR')} a R$ ${orc.max.toLocaleString('pt-BR')}. Tente ampliar o teto do orçamento.`,
      diagnostico: {
        curadorSugeriu: candidatos.length,
        fipeResolvidos: matched.length,
        aposFiltroAno: anoFiltered.length,
        aposFiltroTipo: tipoFiltered.length,
        foraDoOrcamento: tipoFiltered.map(p => ({
          marca: p.res.fipe.marca, modelo: p.res.fipe.modelo, ano: p.res.fipe.anoModelo,
          preco: p.res.fipe.preco, precoTexto: p.res.fipe.precoTexto,
        })),
      },
    };
  }

  const candidatesForVendor = inBudget.map(p => p.res);
  const top = await runVendor(briefing, candidatesForVendor);
  log('vendor-done', { count: top.length });

  const byId = new Map(inBudget.map((p, i) => [`c${i + 1}`, p]));
  const topEnriched = top
    .map(t => {
      const pair = byId.get(t.candidatoId);
      if (!pair) return null;
      const f = pair.res.fipe;
      const c = pair.cand;
      return {
        id: slugifyId(f.marca, f.modelo, f.anoModelo),
        rank: t.rank,
        match: t.match,
        veredicto: t.veredicto,
        why: t.why,
        pros: t.pros,
        cons: t.cons,
        brand: f.marca,
        model: f.modelo,
        year: f.anoModelo,
        type: tipoSlug(c.tipo),
        fuel: c.combustivel || f.combustivel,
        price: f.precoTexto,
        priceN: f.preco,
        codigoFipe: f.codigoFipe,
        mesReferencia: f.mesReferencia,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  const idsRetornados = new Set(top.map(t => t.candidatoId));
  const summarize = p => ({
    marca: p.res.fipe.marca, modelo: p.res.fipe.modelo, ano: p.res.fipe.anoModelo,
    preco: p.res.fipe.preco, precoTexto: p.res.fipe.precoTexto,
  });
  const descartadosPeloVendedor = inBudget
    .map((p, i) => ({ id: `c${i + 1}`, p }))
    .filter(({ id }) => !idsRetornados.has(id))
    .map(({ p }) => summarize(p));

  return {
    ok: true,
    briefing,
    top: topEnriched,
    diagnostico: {
      curadorSugeriu: candidatos.length,
      fipeResolvidos: matched.length,
      fipeFalhou: failed.length,
      duplicadosFipe: duplicates.length,
      descartadosPorAno: removidosPorAno,
      descartadosPorTipo: removidosPorTipo,
      aposFiltroAno: anoFiltered.length,
      aposFiltroTipo: tipoFiltered.length,
      foraDoOrcamento: foraOrcamento.map(summarize),
      modoOrcamento: budgetMode,
      vendedorRetornou: topEnriched.length,
      descartadosPeloVendedor,
    },
  };
}

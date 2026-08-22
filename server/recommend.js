import { normalizeBriefing } from './briefing.js';
import { runCurator, runVendor, runCuradorLeve } from './agents.js';
import { resolveCandidates } from './match.js';
import { loadCatalog } from './catalog.js';
import { splitModelo, baseModelo } from './classify.js';
import { listRankingMisses } from './feedback.js';

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

// Uma versão por modelo/ano no resultado. Três Fit 2021 (EXL, Personal, LX) são
// o mesmo carro em níveis de equipamento diferentes: ocupam três slots do top,
// exibem a MESMA foto (a web só tem a foto de imprensa do modelo, não do trim) e
// não dão ao comprador três decisões — dão uma.
//
// "Melhor" = melhor rank do vendedor, não a versão mais cara. O rank já pesa o
// briefing; se a pessoa pediu economia, o LX É a melhor opção. O filtro de
// orçamento roda antes, então todo mundo do grupo já cabe no budget — escolher
// pelo preço aqui seria enfiar um critério que ninguém pediu.
//
// Depende de baseModelo() (classify.js), que só agrupa quando reconhece o token
// de acabamento. Modelo com nome fora do dicionário fica separado de propósito.
// Espera a lista JÁ ordenada por rank.
function umaVersaoPorModelo(ordenadosPorRank) {
  const visto = new Set();
  return ordenadosPorRank.filter(c => {
    const chave = `${c.brand}|${baseModelo(c.model)}|${c.year}`.toLowerCase();
    if (visto.has(chave)) return false;
    visto.add(chave);
    return true;
  });
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

// ─── Filtro determinístico do catálogo ────────────────────────────────────
// Isolado numa função só porque o diagnóstico de "faltou o carro X" precisa
// rodar EXATAMENTE o mesmo filtro num carro específico (ver diagnoseMiss).
// Duplicar a regra aqui e lá significaria diagnóstico mentindo com o tempo.

const MARGEM_NORMAL = { lo: 0.95, hi: 1.05 };   // folga pequena no orçamento
const MARGEM_RELAXADA = { lo: 0.90, hi: 1.10 }; // usada quando sobram <5 opções

// Deriva do briefing normalizado tudo que os filtros consultam.
function filtroContext(briefing) {
  return {
    tiposPedidos: (briefing.tiposDesejados || []).map(t => TIPO_TO_SLUG[t]).filter(Boolean),
    combsPedidas: (briefing.combustiveisAceitos || []).map(normFuel),
    orc: briefing.orcamentoReais || {},
    anoMin: briefing.anoMin ? Number(briefing.anoMin) : null,
    anoMax: briefing.anoMax ? Number(briefing.anoMax) : null,
    // Rótulos originais em pt-BR — só pra texto de diagnóstico, não filtram.
    tiposLabel: briefing.tiposDesejados || [],
    combsLabel: briefing.combustiveisAceitos || [],
  };
}

// Por que esta entrada do catálogo NÃO entra no pool? null = entra.
// A ordem dos testes é a ordem de precedência do motivo reportado.
function motivoDescarte(e, ctx, margem = MARGEM_NORMAL) {
  if (!e.preco) return 'semPreco';
  if (ctx.anoMin && e.ano < ctx.anoMin) return 'ano';
  if (ctx.anoMax && e.ano > ctx.anoMax) return 'ano';
  if (ctx.tiposPedidos.length && !ctx.tiposPedidos.includes(e.tipo)) return 'tipo';
  if (ctx.combsPedidas.length && !combMatch(ctx.combsPedidas, e.combustivel)) return 'comb';
  if (e.preco < ctx.orc.min * margem.lo) return 'orcamento';
  if (ctx.orc.max != null && e.preco > ctx.orc.max * margem.hi) return 'orcamento';
  return null;
}

// ─── Lembretes de ranking: o feedback voltando pro pipeline ───────────────
// Quando o consultor diz "senti falta do Golf" e o diagnóstico conclui
// `vendedor-nao-escolheu`, o carro estava no pool e mesmo assim não chegou ao
// top. Sem isso aqui, essa reclamação morre no banco e a busca seguinte repete
// o mesmo erro. Com isso, o modelo reclamado (a) sobrevive ao corte do curador
// leve e (b) é apontado pro vendedor pelo nome.
//
// É empurrão, não passe livre: o carro precisa ter passado nos filtros DESTA
// busca pra ser lembrado, e o vendedor continua livre pra deixá-lo de fora.
// Forçar o carro na lista seria mentir pro cliente pra agradar o consultor.

const HINTS_TTL_MS = 5 * 60_000;
const HINTS_JANELA_DIAS = 90;   // reclamação de um ano atrás não rege hoje
const HINTS_MAX = 12;           // teto de nomes que entram no prompt
const HINTS_REPESCAGEM = 4;     // quantos podem furar o corte do curador leve
// Uma versão por reclamação. Com 2, medido, o vendedor trazia as duas e o
// modelo reclamado ocupava 2 dos 7 slots — o empurrão virava sequestro. O
// consultor sentiu falta DO Golf, não de dois Golfs.
const HINTS_POR_LEMBRETE = 1;

let _hintsCache = { at: 0, hints: [] };

/** Zera o cache — chamado quando um feedback novo chega (ver /api/feedback). */
export function invalidateRankingHints() {
  _hintsCache = { at: 0, hints: [] };
}

export async function loadRankingHints() {
  if (_hintsCache.at && Date.now() - _hintsCache.at < HINTS_TTL_MS) return _hintsCache.hints;
  let hints = [];
  try {
    const rows = await listRankingMisses({ dias: HINTS_JANELA_DIAS, limit: HINTS_MAX });
    hints = rows.map(r => {
      // MESMA tokenização do diagnóstico: ano solto vira filtro, não palavra-
      // chave. Se as duas regras divergirem, o lembrete passa a casar com um
      // carro diferente do que o consultor reclamou.
      const busca = normText(r.termo);
      const ano = (busca.match(/\b(19|20)\d{2}\b/) || [])[0];
      const tokens = busca.split(' ').filter(t => t.length >= 2 && t !== ano);
      return { termo: r.termo, vezes: r.vezes, tokens };
    }).filter(h => h.tokens.length);
  } catch (e) {
    // Banco fora do ar não pode derrubar recomendação: sem lembrete, a busca
    // roda exatamente como rodava antes desta feature existir.
    console.warn('[hints] não consegui ler o feedback (ignorado):', e.message);
  }
  _hintsCache = { at: Date.now(), hints };
  return hints;
}

/** Entradas do pool que casam com algum lembrete → Map(entrada → lembrete). */
export function marcaSinalizados(pool, hints) {
  const marcadas = new Map();
  if (!hints.length) return marcadas;
  for (const e of pool) {
    const alvo = normText(`${e.marca} ${e.modelo}`);
    const hint = hints.find(h => h.tokens.every(t => alvo.includes(t)));
    if (hint) marcadas.set(e, hint);
  }
  return marcadas;
}

// ─── Pipeline NOVO usando catálogo pré-computado ──────────────────────────
async function recommendFromCatalog(briefing, log) {
  const catalog = await loadCatalog();
  log('catalog-loaded', { count: catalog.entries.length });

  const ctx = filtroContext(briefing);
  const { orc, anoMin, anoMax } = ctx;

  const reasonsCount = { ano: 0, tipo: 0, comb: 0, orcamento: 0, semPreco: 0 };

  // Modo normal: 95% a 105% do orçamento (margem pequena)
  let pool = catalog.entries.filter(e => {
    const motivo = motivoDescarte(e, ctx, MARGEM_NORMAL);
    if (motivo) { reasonsCount[motivo]++; return false; }
    return true;
  });

  log('catalog-filtered', { count: pool.length, descartes: reasonsCount });

  // Relaxa orçamento se sobrou pouco — piso em 90% do mínimo (mais conservador)
  if (pool.length < 5) {
    pool = catalog.entries.filter(e => !motivoDescarte(e, ctx, MARGEM_RELAXADA));
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

  // Lembretes do feedback: quais entradas deste pool já foram reclamadas como
  // "sumiu do top". Lido aqui, com o pool inteiro na mão, antes de qualquer
  // corte — é justamente nos cortes que elas se perdiam.
  const hints = await loadRankingHints();
  const sinalizados = marcaSinalizados(pool, hints);
  if (sinalizados.size) log('hints-no-pool', { count: sinalizados.size });

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

  // Repescagem: carro sinalizado não pode morrer no corte do curador leve —
  // esse corte é um dos dois lugares onde ele sumia (o outro é o vendedor).
  // Entrar na lista do vendedor não é entrar no top: só garante que ele veja.
  //
  // O teto POR LEMBRETE existe porque um termo curto ("golf") casa com dezenas
  // de versões do mesmo carro: sem ele, uma reclamação só empurraria 15 Golfs
  // pra dentro e afogaria os outros candidatos.
  if (sinalizados.size) {
    const jaTem = new Set(candidates);
    const porHint = new Map();
    const repescados = [];
    // Mais novo primeiro: qual das 6 versões de Golf repescar seria arbitrário
    // (ordem do catálogo), e o consultor que sente falta "do Golf" tem em mente
    // o mais recente que cabe no orçamento — o teto de preço já rodou antes.
    const fila = [...sinalizados].sort((a, b) => (b[0].ano || 0) - (a[0].ano || 0));
    for (const [entry, hint] of fila) {
      if (jaTem.has(entry)) continue;
      const usados = porHint.get(hint) || 0;
      if (usados >= HINTS_POR_LEMBRETE) continue;
      porHint.set(hint, usados + 1);
      repescados.push(entry);
      if (repescados.length >= HINTS_REPESCAGEM) break;
    }
    if (repescados.length) {
      // Na FRENTE da lista, não no fim. Medido: repescado como candidato 31 de
      // 32, com o aviso depois de 32 linhas de lista, o vendedor ignorava — o
      // carro estava tecnicamente presente e continuava invisível, que é
      // exatamente a reclamação original.
      candidates = [...repescados, ...candidates];
      log('hints-repescados', { count: repescados.length });
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

  // Os IDs que o vendedor usa (c1, c2...) só existem aqui — o lembrete precisa
  // falar a língua dele, senão o modelo não sabe de que carro estamos falando.
  // Mesmo teto por lembrete da repescagem, e pelo mesmo motivo: uma lista de
  // "atenção especial" com 15 linhas deixa de ser atenção especial.
  const vistosPorHint = new Map();
  const lembretes = [];
  candidates.forEach((e, i) => {
    const hint = sinalizados.get(e);
    if (!hint) return;
    const usados = vistosPorHint.get(hint) || 0;
    if (usados >= HINTS_POR_LEMBRETE) return;
    vistosPorHint.set(hint, usados + 1);
    lembretes.push({ id: `c${i + 1}`, label: `${e.marca} ${e.modelo} ${e.ano}` });
  });

  const top = await runVendor(briefing, candidatesForVendor, { lembretes });
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

  const topUnico = umaVersaoPorModelo(topEnriched);
  log('dedupe-modelo', { antes: topEnriched.length, depois: topUnico.length });

  return {
    ok: true,
    briefing,
    top: topUnico,
    diagnostico: {
      catalogTotal: catalog.entries.length,
      catalogPool: pool.length,
      curadorLeveSelecionou: candidates.length,
      lembretes: lembretes.map(l => l.label),
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

  const topUnico = umaVersaoPorModelo(topEnriched);

  return { ok: true, briefing, top: topUnico, diagnostico: { fluxo: 'legacy', curador: candidatos.length, fipe: matched.length, pool: pool.length, vendedor: topEnriched.length, aposDedupe: topUnico.length } };
}

// ─── Diagnóstico de "senti falta do carro X" ─────────────────────────────
// Quando o consultor reclama que um carro não apareceu, roda os MESMOS filtros
// do pipeline só naquele carro e responde onde ele caiu. Sem isso, o feedback
// é uma caixa de sugestões; com isso, cada reclamação já vem com a causa.
//
// Quatro causas possíveis:
//   estava-na-lista       → apareceu no top entregue (o consultor não viu)
//   fora-do-catalogo      → nenhuma versão no catálogo FIPE → gap de build
//   cortado-por-filtro    → existe, mas preço/ano/tipo/combustível barraram
//   vendedor-nao-escolheu → passou nos filtros, o LLM vendedor não ranqueou

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILTRO_LABEL = {
  ano: 'ano', tipo: 'tipo de carroceria', comb: 'combustível',
  orcamento: 'orçamento', semPreco: 'sem preço na FIPE',
};

const plural = (n, sing, pl) => `${n} ${n === 1 ? sing : pl}`;

// Texto em pt-BR explicando o descarte dominante, com os números concretos.
// `entries` são SÓ as versões cortadas por este motivo — usar todas as versões
// encontradas produziria frases contraditórias ("é híbrido, flex; aceitava flex").
function explicaDescarte(motivo, entries, ctx) {
  const anos = entries.map(e => e.ano).filter(Boolean);
  const precos = entries.map(e => e.preco).filter(Boolean);
  const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  switch (motivo) {
    case 'ano': {
      const faixa = anos.length ? `${Math.min(...anos)}–${Math.max(...anos)}` : '?';
      const pedido = `${ctx.anoMin || '?'}${ctx.anoMax ? `–${ctx.anoMax}` : ' em diante'}`;
      return `no catálogo só há ano ${faixa}; o briefing pediu ${pedido}.`;
    }
    case 'tipo': {
      const tipos = [...new Set(entries.map(e => e.tipo))].join(', ');
      return `está classificado como ${tipos}; o briefing pediu ${ctx.tiposLabel.join(', ')}.`;
    }
    case 'comb': {
      const combs = [...new Set(entries.map(e => e.combustivel))].join(', ');
      return `é ${combs}; o briefing aceitava ${ctx.combsLabel.join(', ')}.`;
    }
    case 'orcamento': {
      const faixa = precos.length ? `${brl(Math.min(...precos))} a ${brl(Math.max(...precos))}` : '?';
      const teto = ctx.orc.max == null ? 'sem teto' : brl(ctx.orc.max);
      return `custa de ${faixa}; o briefing era ${brl(ctx.orc.min)} a ${teto}.`;
    }
    case 'semPreco':
      return 'as versões encontradas estão sem preço na FIPE.';
    default:
      return '';
  }
}

/**
 * Diagnostica por que um carro não apareceu numa recomendação.
 * @param {object}   p.briefing   briefing JÁ NORMALIZADO (como sai do /api/recommend)
 * @param {string}   p.termo      o que o consultor digitou, ex. "Corolla Cross 2022"
 * @param {string[]} p.topModels  modelos entregues, ex. ["Toyota Corolla Cross 2.0..."]
 */
export async function diagnoseMiss({ briefing, termo, topModels = [] }) {
  const busca = normText(termo);
  if (!busca) return null;

  // Ano solto no termo ("Corolla Cross 2022") vira filtro, não palavra-chave.
  const anoPedido = (busca.match(/\b(19|20)\d{2}\b/) || [])[0];
  const tokens = busca.split(' ').filter(t => t.length >= 2 && t !== anoPedido);
  if (!tokens.length) return null;

  const bate = (texto) => {
    const t = normText(texto);
    return tokens.every(tok => t.includes(tok));
  };

  // 1. O carro estava na lista entregue? Se o consultor citou um ano, ele
  // também precisa bater — senão "Compass 2020" casaria com um Compass 2023.
  const naLista = topModels.filter(m => bate(m) && (!anoPedido || normText(m).includes(anoPedido)));
  if (naLista.length) {
    return {
      termo, causa: 'estava-na-lista',
      resumo: `“${termo}” apareceu na lista entregue (${naLista[0]}).`,
      detalhe: { modelosNaLista: naLista.slice(0, 3) },
    };
  }

  const catalog = await loadCatalog();
  const ctx = filtroContext(briefing || {});
  const doModelo = catalog.entries.filter(e => bate(`${e.marca} ${e.modelo}`));
  const matches = anoPedido ? doModelo.filter(e => String(e.ano) === anoPedido) : doModelo;

  // 2a. O modelo existe, mas não naquele ano — é gap de ano, não de modelo.
  if (!matches.length && doModelo.length) {
    const anos = doModelo.map(e => e.ano).filter(Boolean);
    return {
      termo, causa: 'fora-do-catalogo',
      resumo: `O modelo existe no catálogo, mas não o ano ${anoPedido}: só há ${Math.min(...anos)}–${Math.max(...anos)}.`,
      detalhe: { candidatosNoCatalogo: 0, anoPedido, anosDisponiveis: [...new Set(anos)].sort() },
    };
  }

  // 2b. Nem existe no catálogo → gap de build (ou erro de digitação).
  if (!matches.length) {
    // Tenta o token mais longo sozinho pra sugerir "quis dizer?".
    const maiorToken = tokens.slice().sort((a, b) => b.length - a.length)[0];
    const sugestoes = [...new Set(
      catalog.entries
        .filter(e => normText(`${e.marca} ${e.modelo}`).includes(maiorToken))
        .map(e => `${e.marca} ${splitModelo(e.modelo).versao || e.modelo}`)
    )].slice(0, 5);
    return {
      termo, causa: 'fora-do-catalogo',
      resumo: sugestoes.length
        ? `Não há “${termo}” no catálogo FIPE. Parecidos: ${sugestoes.join(' · ')}.`
        : `Não há nenhuma versão de “${termo}” no catálogo FIPE — gap de catálogo.`,
      detalhe: { candidatosNoCatalogo: 0, sugestoes },
    };
  }

  // 3. Existe: rodar o filtro determinístico versão por versão.
  const descartes = {};
  const cortadasPor = {};   // motivo → versões cortadas por ele (pra explicação)
  const passaram = [];
  let passariaRelaxado = false;
  for (const e of matches) {
    const motivo = motivoDescarte(e, ctx, MARGEM_NORMAL);
    if (!motivo) { passaram.push(e); continue; }
    descartes[motivo] = (descartes[motivo] || 0) + 1;
    (cortadasPor[motivo] ||= []).push(e);
    if (!motivoDescarte(e, ctx, MARGEM_RELAXADA)) passariaRelaxado = true;
  }

  const exemplos = matches.slice(0, 5).map(e => ({
    marca: e.marca, modelo: e.modelo, ano: e.ano,
    preco: e.preco, tipo: e.tipo, combustivel: e.combustivel,
    motivo: motivoDescarte(e, ctx, MARGEM_NORMAL),
  }));

  // 4. Passou nos filtros mas não foi entregue → o vendedor LLM não escolheu.
  if (passaram.length) {
    return {
      termo, causa: 'vendedor-nao-escolheu',
      // Não dá pra saber daqui QUAL das duas etapas de ranking cortou (o
      // diagnóstico re-roda os filtros, não o pipeline LLM), então a frase não
      // aponta o culpado — antes dizia "o vendedor", o que era chute.
      resumo: `${plural(passaram.length, 'versão', 'versões')} de “${termo}” passou nos filtros e entrou no pool, mas o ranking não trouxe pro top. É ranking, não catálogo — nas próximas buscas em que ele passar nos filtros, entra marcado pro vendedor olhar.`,
      detalhe: { candidatosNoCatalogo: matches.length, passaramFiltro: passaram.length, descartes, exemplos },
    };
  }

  // 5. Todas cortadas → reporta o motivo dominante com os números.
  const dominante = Object.entries(descartes).sort((a, b) => b[1] - a[1])[0]?.[0];
  const nota = passariaRelaxado
    ? ' Entraria na busca relaxada (usada só quando sobram menos de 5 opções).'
    : '';
  return {
    termo, causa: 'cortado-por-filtro',
    filtro: dominante,
    resumo: `${plural(matches.length, 'versão', 'versões')} de “${termo}” no catálogo, nenhuma passou nos filtros. `
      + `Motivo principal — ${FILTRO_LABEL[dominante] || dominante}: ${explicaDescarte(dominante, cortadasPor[dominante] || matches, ctx)}${nota}`,
    detalhe: { candidatosNoCatalogo: matches.length, passaramFiltro: 0, descartes, passariaRelaxado, exemplos },
  };
}

/** Sugestões "Marca Modelo" do catálogo, pro autocomplete do campo "faltou". */
export async function suggestModels(q, limit = 8) {
  const busca = normText(q);
  if (busca.length < 2) return [];
  const catalog = await loadCatalog();
  const tokens = busca.split(' ');
  const out = new Set();
  for (const e of catalog.entries) {
    const versao = splitModelo(e.modelo).versao || e.modelo;
    const label = `${e.marca} ${versao}`;
    if (out.has(label)) continue;
    const alvo = normText(`${e.marca} ${e.modelo}`);
    if (tokens.every(t => alvo.includes(t))) out.add(label);
    if (out.size >= limit) break;
  }
  return [...out];
}

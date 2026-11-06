import { normalizeBriefing } from './briefing.js';
import { runCurator, runVendor, runCuradorLeve, TOP_N, CURADOR_N } from './agents.js';
import { resolveCandidates } from './match.js';
import { loadCatalog } from './catalog.js';
import { splitModelo, baseModelo } from './classify.js';
import { listRankingMisses } from './feedback.js';
import { listExclusoesPerfil } from './carro-feedback.js';

const TIPO_TO_SLUG = {
  'Hatch': 'hatch',
  'Sedã': 'sedan', 'Sedan': 'sedan',
  'SUV': 'suv',
  'Picape': 'pickup',
  'Coupé': 'coupe', 'Coupe': 'coupe', 'Esportivo': 'coupe',
  'Minivan': 'minivan',
  'Perua': 'perua',
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
    lugaresMin: briefing.lugaresMin ? Number(briefing.lugaresMin) : null,
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
  if (!cabeLugares(e, ctx.lugaresMin)) return 'lugares';
  if (e.preco < ctx.orc.min * margem.lo) return 'orcamento';
  if (ctx.orc.max != null && e.preco > ctx.orc.max * margem.hi) return 'orcamento';
  return null;
}

// ─── Lugares e porta-malas ───────────────────────────────────────────────
// O catálogo FIPE não sabe quantos lugares um carro tem, e antes disto o
// pedido só chegava ao LLM como texto. Medido: SUV 7 lugares, 120–200k → 8 de 9
// entregues tinham 5 lugares, e a PRÓPRIA ficha do vendedor dizia "5".
//
// Duas camadas. Antes do LLM, quem pede 6+ lugares só vê modelos que EXISTEM
// em versão de 7 (lista abaixo) — senão o vendedor recebe 30 carros de 5 e não
// tem o que escolher. Depois do vendedor, a ficha decide caso a caso: a lista
// inclui modelos que têm versão de 5 e de 7 (Discovery Sport, Outlander, Spin).

// Modelos vendidos no Brasil com versão de 7+ lugares (2005+). Na dúvida,
// entra: a lista só abre a porta; quem barra é a ficha, depois.
// GLS/GLE amarrados à Mercedes: na Hyundai "GLS" é acabamento (Tucson GLS,
// Elantra GLS) e passava o Tucson de 5 lugares como 7.
const SETE_LUGARES = /\bsw4\b|\bcommander\b|\bgrand\s*cherokee\s*l\b|\btrailblazer\b|\bcaptiva\b|\bspin\b|\bzafira\b|\btahoe\b|\bsuburban\b|\bpajero\b(?!\s*(tr4|io))|\boutlander\b(?!\s*sport)|\bsanta\s*f[eé]|\bvera\s*cruz\b|\bpalisade\b|\bsorento\b|\bcarnival\b|\bsedona\b|\bcarens\b|\bmohave\b|\btiggo\s*8\b|\baircross\s*7|\bjac\b.*\bj6\b|\ballspace\b|\btouran\b|\bpathfinder\b|\bgrand\s*livina\b|\bodyssey\b|\bpilot\b|\bexplorer\b|\bjourney\b|\bdurango\b|\bfreemont\b|\bdobl[oò]\b|\bgrand\s*picasso\b|\bc4\s*picasso\b|\b5008\b|\bgrand\s*sc[eé]nic\b|\bdiscovery\b|\bdefender\b|\bxc\s*90\b|\bq7\b|\bx5\b|\bx7\b|\bglb\b|mercedes.*\bgl[se]\b|\bclasse?\s*r\b|\bland\s*cruiser\b|\bprado\b|\blx[ -]?\d{3}|\bgx[ -]?\d{3}|\btan\b|\bsienna\b|\bsharan\b|\bvito\b|\bsprinter\b|\bminibus\b|\bjumpy\b|\bexpert\b|\bkombi\b/i;

// Subconjunto que SÓ existe com 7+ lugares no Brasil. Aqui a lista vence a
// ficha do LLM: medido, o vendedor escreveu "5 lugares" pro Discovery 2017
// (que tem 7) e o pós-filtro jogou fora um carro que atendia.
const SEMPRE_SETE = /\bsw4\b|\bcommander\b|\btiggo\s*8\b|\bdiscovery\b(?!\s*sp)|\bxc\s*90\b|\bq7\b|\bx7\b|mercedes.*\bgls\b|\bcarnival\b|\bsedona\b|\bodyssey\b|\bsienna\b|\bpalisade\b|\b5008\b|\bgrand\s*picasso\b|\bfreemont\b|\bjourney\b|\bminibus\b/i;

function cabeLugares(e, lugaresMin) {
  if (!lugaresMin || lugaresMin <= 5) return true;
  return SETE_LUGARES.test(`${e.marca} ${e.modelo}`);
}

// "420 L", "1.050 litros", "420/1.200 L" → 420 (o primeiro número é a
// configuração normal; o segundo costuma ser com banco rebatido).
function litrosDaFicha(s) {
  const m = String(s || '').replace(/(\d)\.(\d{3})/g, '$1$2').match(/\d{2,4}/);
  return m ? Number(m[0]) : null;
}

// Por que a ficha do vendedor desmente o briefing? null = não desmente.
// Ficha em branco (o vendedor não sabia) não desmente nada — não dá pra
// provar que não atende, e descartar no escuro esvaziaria a lista.
function fichaContradiz(ficha, briefing, nomeFipe = '') {
  const lug = Number(ficha?.lugares) || 0;
  if (briefing.lugaresMin && lug > 0 && lug < briefing.lugaresMin) return 'lugares';
  const litros = litrosDaFicha(ficha?.porta_malas);
  if (briefing.portaMalasMinL && litros && litros < briefing.portaMalasMinL) return 'portaMalas';
  if (pedeEsportivo(briefing) && nivelEsportivo(ficha, nomeFipe) === 'nao') return 'esportivo';
  return null;
}

// ─── Uso esportivo ───────────────────────────────────────────────────────
// O prompt do vendedor já diz "aspirado com pacote visual NÃO é esportivo",
// e mesmo assim, medido, o Fit 1.5 de 116 cv entrou num "hatch esportivo".
// Pedido de prompt é preferência; isto é a trava.
//
// Três níveis, calibrados pelo consultor:
//   'sim'   → 130+ cv ou versão esportiva de fábrica (GTI, HGT, RS3…)
//   'quase' → turbo ou pacote esportivo sobre motor comum (Onix RS, Polo 200
//             TSI, N Line): "um pouco esportivo" — entra, mas no fim da lista
//   'nao'   → aspirado, sem pacote, abaixo de 130 cv (Fit 1.5): sai
//   null    → ficha sem potência e nada no nome: não dá pra julgar, fica onde
//             o vendedor pôs (descartar no escuro esvazia a lista)
const CV_MIN_ESPORTIVO = 130;
// RS só com número (RS3, RS6): "RS 1.0" é o Onix, que é pacote (nível 'quase').
// "GT Line" (Sandero, 208) é pacote, não o GT.
const SELO_ESPORTIVO = /\b(gti|gts|hgt|gt(?![\s-]*line)|rs\s?\d(?![.,\d])|amg|abarth|type\s?r|jcw|john\s+cooper|cooper\s+s|m\d{3}i|srt|cupra)\b/i;
const TURBO = /\b(turbo|tb|tsi|tfsi|thp|t-?gdi|ecoboost|t200|t270|\d\.\dt)\b/i;
const PACOTE_ESPORTIVO = /\b(rs|r\.s\.|n[\s-]?line|r[\s-]?line|gt[\s-]?line|s[\s-]?line|m\s?sport)\b/i;

function pedeEsportivo(briefing) {
  return (briefing.estiloDeVida || []).includes('uso esportivo');
}

function cvDaFicha(s) {
  const m = String(s || '').match(/\d{2,4}/);
  return m ? Number(m[0]) : null;
}

function nivelEsportivo(ficha, nomeFipe) {
  const cv = cvDaFicha(ficha?.potencia);
  if (SELO_ESPORTIVO.test(nomeFipe) || (cv && cv >= CV_MIN_ESPORTIVO)) return 'sim';
  if (TURBO.test(nomeFipe) || PACOTE_ESPORTIVO.test(nomeFipe)) return 'quase';
  if (cv) return 'nao';
  return null;
}

// Fim da lista pros 'quase', mantendo a ordem do vendedor dentro de cada grupo.
function quaseEsportivosPorUltimo(top, briefing) {
  if (!pedeEsportivo(briefing)) return top;
  const quase = t => nivelEsportivo(t.fichaTecnica, t.model) === 'quase';
  return [...top.filter(t => !quase(t)), ...top.filter(quase)];
}

// ─── Variedade antes do LLM ──────────────────────────────────────────────
// Medido (hatch esportivo até 110k): o pool tinha 117 entradas em 29 modelos,
// mas 15 eram Argo, 16 Fox e 17 Fit. O curador (gpt-4o-mini) recebia isso em
// blocos na ordem do catálogo e devolvia 8 Argos nos 10 primeiros; A 250, 125i,
// 130i e A3 estavam no pool e não passavam do corte. O vendedor, que só monta
// ficha, repetia a ordem. Peso por quantidade de versões na FIPE não é
// relevância — então cada modelo chega ao LLM com uma entrada por acabamento
// (até N), intercalados, e sai dele com no máximo M versões.

// 12 é só trava de segurança: Polo e Fox têm 12 acabamentos cada no pool de
// hatch até 110k, e com 8 o corte por preço derrubava justamente o Polo GTS.
const VERSOES_POR_MODELO_CURADOR = 12;
const VERSOES_POR_MODELO_VENDEDOR = 2;
// Os tetos são preferência, não regra: se a busca só tem 6 versões de 911,
// mostrar 2 por "variedade" seria esconder carro que atende.
const MIN_CANDIDATOS = TOP_N;

// `lista` mais itens de `reserva` (na ordem dela) até ter `n`.
function completaAte(lista, reserva, n) {
  if (lista.length >= n) return lista;
  const out = [...lista];
  const tem = new Set(lista);
  for (const e of reserva) {   // reserva pode repetir item: dedupe aqui
    if (out.length >= n) break;
    if (!tem.has(e)) { tem.add(e); out.push(e); }
  }
  return out;
}

// "Argo HGT 1.8" e "Argo Drive 1.0" → fiat|argo. "Classe A 250" → mercedes|classe a.
// BMW nomeia por motor (118i, 120iA, 130i): sem agrupar pelo 1º dígito, a
// Série 1 vira 8 "modelos" e fura o teto — medido, 5 BMWs num top de 10.
function familiaModelo(e) {
  const marca = normText(e.marca).split(' ')[0];
  const toks = normText(baseModelo(e.modelo)).split(' ').filter(Boolean);
  const bmw = marca === 'bmw' && (toks[0] || '').match(/^(\d)\d\d[a-z]*$/);
  if (bmw) return `bmw|serie ${bmw[1]}`;
  const n = ['classe', 'serie'].includes(toks[0]) ? 2 : 1;
  return `${marca}|${toks.slice(0, n).join(' ')}`;
}

function agrupaPorFamilia(lista) {
  const grupos = new Map();
  for (const e of lista) {
    const k = familiaModelo(e);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(e);
  }
  return grupos;
}

// "Polo GTS 1.4 TSI" → vw|polo gts. Acabamento, sem motor nem ano.
function chaveVersao(e) {
  const t = normText(e.modelo).split(' ').filter(Boolean);
  return `${normText(e.marca).split(' ')[0]}|${t.slice(0, t[0] === 'classe' ? 3 : 2).join(' ')}`;
}

// Uma entrada por VERSÃO (a mais nova que coube no orçamento), até `max` por
// modelo, intercaladas (um de cada modelo por rodada) pra não entregar ao LLM
// um bloco de 15 Argos.
//
// Por versão e não por faixa de preço: a primeira tentativa pegava a mais cara,
// a do meio e a mais barata de cada modelo — com 100 Polos no pool, o Polo GTS
// (justamente o que o hatch esportivo pede) caía fora da amostra. Anos
// vizinhos do mesmo acabamento não são escolhas diferentes; acabamentos são.
function amostraPorModelo(pool, max) {
  const porVersao = new Map();
  for (const e of pool) {
    const k = chaveVersao(e);
    const atual = porVersao.get(k);
    if (!atual || e.ano > atual.ano || (e.ano === atual.ano && e.preco > atual.preco)) porVersao.set(k, e);
  }
  const grupos = [...agrupaPorFamilia([...porVersao.values()]).values()].map(g => {
    const ord = [...g].sort((a, b) => b.preco - a.preco);
    if (ord.length <= max) return ord;
    // Modelo com acabamento demais (Fox tem 12): aí sim espalha por preço.
    const idx = new Set();
    for (let i = 0; i < max; i++) idx.add(Math.round(i * (ord.length - 1) / (max - 1)));
    return [...idx].map(i => ord[i]);
  });
  const out = [];
  for (let r = 0; r < max; r++) for (const g of grupos) if (g[r]) out.push(g[r]);
  return out;
}

// Teto por MARCA na lista do vendedor (30). Medido com o catálogo completo:
// hatch até 60k tinha Onix, HB20, Sandero, Fit e Etios no pool, e o curador
// mandou quase só VW — 7 dos 10 do top. Mesmo espírito do teto por modelo:
// preferência, desliga sozinho (completaAte) quando a busca só tem uma marca.
// 1/4 da lista do vendedor (era 6 de 30; agora 12 de 50).
const CARROS_POR_MARCA_VENDEDOR = Math.round(CURADOR_N / 4);
const marcaDe = e => normText(e.marca).split(' ')[0];

// Mantém a ordem de quem já ranqueou, cortando o excesso de um mesmo modelo
// (ou do que `chave` agrupar).
function limitaPorModelo(ordenados, max, chave = familiaModelo) {
  const conta = new Map();
  return ordenados.filter(e => {
    const k = chave(e);
    const n = conta.get(k) || 0;
    if (n >= max) return false;
    conta.set(k, n + 1);
    return true;
  });
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

// ─── Exclusões do consultor: "não combina com esse perfil" ───────────────
// Botão por card (carro-feedback.js). Escopo é o ESTILO DE VIDA da busca em
// que ele clicou: "Fit não é esportivo" não pode tirar o Fit de uma busca de
// hatch pra família. Vale quando a busca nova tem todos aqueles usos (busca
// "esportivo + cidade" herda a reclamação feita em "esportivo"). Reclamação
// feita numa busca SEM estilo de vida só vale pra buscas sem estilo de vida —
// senão um clique viraria banimento global.
let _exclCache = { at: 0, rows: [] };

export function invalidateExclusoes() { _exclCache = { at: 0, rows: [] }; }

async function loadExclusoes() {
  if (_exclCache.at && Date.now() - _exclCache.at < HINTS_TTL_MS) return _exclCache.rows;
  let rows = [];
  try {
    rows = await listExclusoesPerfil();
  } catch (e) {
    // Mesma regra dos lembretes: banco fora não derruba a recomendação.
    console.warn('[exclusoes] não consegui ler (ignorado):', e.message);
  }
  _exclCache = { at: Date.now(), rows };
  return rows;
}

function familiasExcluidas(rows, briefing) {
  const usos = new Set(briefing.estiloDeVida || []);
  const out = new Set();
  for (const r of rows) {
    const rUsos = r.usos || [];
    const vale = rUsos.length ? rUsos.every(u => usos.has(u)) : usos.size === 0;
    if (vale) out.add(r.familia);
  }
  return out;
}

/** Chave de família pra gravar a exclusão — a MESMA que o filtro do pool usa. */
export function familiaDe(marca, modelo) {
  return familiaModelo({ marca, modelo });
}

// ─── Pipeline NOVO usando catálogo pré-computado ──────────────────────────
async function recommendFromCatalog(briefing, log) {
  const catalog = await loadCatalog();
  log('catalog-loaded', { count: catalog.entries.length });

  const ctx = filtroContext(briefing);
  const { orc, anoMin, anoMax } = ctx;

  const reasonsCount = { ano: 0, tipo: 0, comb: 0, lugares: 0, orcamento: 0, semPreco: 0 };

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

  // "Não combina com esse perfil" dito pelo consultor num card: a família sai
  // do pool aqui, antes de qualquer LLM — ele não tem como reintroduzir.
  const exclusoes = await loadExclusoes();
  const familiasFora = familiasExcluidas(exclusoes, briefing);
  if (familiasFora.size) {
    const antes = pool.length;
    pool = pool.filter(e => !familiasFora.has(familiaModelo(e)));
    reasonsCount.consultor = antes - pool.length;
    log('exclusoes-consultor', { count: antes - pool.length });
  }

  if (pool.length === 0) {
    return {
      ok: false,
      reason: `Não encontrei opções no catálogo que respeitem o briefing (ano>=${anoMin}${anoMax ? ` e <=${anoMax}` : ''}, tipo(s) ${briefing.tiposDesejados.join(', ')}, combustível(is) ${briefing.combustiveisAceitos.join(', ')}${ctx.lugaresMin > 5 ? `, ${ctx.lugaresMin}+ lugares` : ''}, R$${orc.min.toLocaleString('pt-BR')}-${orc.max == null ? 'sem teto' : orc.max.toLocaleString('pt-BR')}). Tente refinar critérios.`,
      diagnostico: { catalogTotal: catalog.entries.length, descartesPorEtapa: reasonsCount },
    };
  }

  // Lembretes do feedback: quais entradas deste pool já foram reclamadas como
  // "sumiu do top". Lido aqui, com o pool inteiro na mão, antes de qualquer
  // corte — é justamente nos cortes que elas se perdiam.
  const hints = await loadRankingHints();
  const sinalizados = marcaSinalizados(pool, hints);
  if (sinalizados.size) log('hints-no-pool', { count: sinalizados.size });

  // Amostra por versão — sempre, não só com pool grande: com 22 SUVs de 7
  // lugares, cortar "2 por modelo" sem amostra antes pegava os 2 primeiros do
  // catálogo, arbitrário.
  const amostra = completaAte(amostraPorModelo(pool, VERSOES_POR_MODELO_CURADOR), pool, MIN_CANDIDATOS);
  log('amostra-por-modelo', { pool: pool.length, amostra: amostra.length });
  let candidates = amostra;

  // Curador leve LLM: se sobrou muito, prioriza os ~30 mais relevantes
  if (amostra.length > CURADOR_N) {
    try {
      const ids = await runCuradorLeve(briefing, amostra);
      const byKey = new Map(amostra.map(e => [`${e.marcaId}|${e.modeloId}|${e.anoId}`, e]));
      const picked = ids.map(id => byKey.get(id)).filter(Boolean);
      candidates = picked.length >= 5 ? picked : amostra;
      log('curador-leve-done', { count: picked.length });
    } catch (e) {
      console.warn('[curador-leve] falhou, usando amostra intercalada:', e.message);
    }
  }
  // O vendedor monta ficha na ordem que recebe e devolve os 10 primeiros: o
  // teto por modelo tem que valer AQUI, não só na entrada do curador.
  // Completar com a AMOSTRA (intercalada, outros modelos) antes de devolver
  // versões cortadas: quando o curador escolheu estreito (medido: hatch até 60k
  // com quase só VW), completar com as sobras dele trazia 4 Fox no top.
  const variado = lista => limitaPorModelo(
    limitaPorModelo(lista, VERSOES_POR_MODELO_VENDEDOR), CARROS_POR_MARCA_VENDEDOR, marcaDe);
  const reserva = [...variado(amostra), ...limitaPorModelo(amostra, VERSOES_POR_MODELO_VENDEDOR), ...candidates];
  candidates = completaAte(variado(candidates), reserva, Math.max(MIN_CANDIDATOS, Math.min(candidates.length, CURADOR_N))).slice(0, CURADOR_N);

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

  // A ficha que o vendedor acabou de escrever é a mesma que o cliente vai ler:
  // entregar um carro cuja ficha diz "5 lugares" pra quem pediu 7 é o sistema
  // se contradizendo na tela.
  const descartadosPorFicha = [];
  for (const t of topEnriched) {
    // Ficha que contradiz a lista curada: o número está errado. Apagar (0 =
    // "não sei") em vez de mostrar errado ou "corrigir" com palpite.
    const lug = Number(t.fichaTecnica?.lugares) || 0;
    if (lug > 0 && lug < 7 && SEMPRE_SETE.test(`${t.brand} ${t.model}`)) t.fichaTecnica.lugares = 0;
  }
  const topCoerente = topEnriched.filter(t => {
    const motivo = fichaContradiz(t.fichaTecnica, briefing, t.model);
    if (motivo) descartadosPorFicha.push({ carro: `${t.brand} ${t.model} ${t.year}`, motivo });
    return !motivo;
  });
  if (descartadosPorFicha.length) log('ficha-contradiz', { count: descartadosPorFicha.length });

  const topUnico = quaseEsportivosPorUltimo(umaVersaoPorModelo(topCoerente), briefing);
  log('dedupe-modelo', { antes: topCoerente.length, depois: topUnico.length });

  if (!topUnico.length && descartadosPorFicha.length) {
    return {
      ok: false,
      reason: `Encontrei candidatos no orçamento, mas nenhum atende ${[
        briefing.lugaresMin ? `${briefing.lugaresMin} lugares` : null,
        briefing.portaMalasMinL ? `porta-malas de ${briefing.portaMalasMinL} L` : null,
        pedeEsportivo(briefing) ? `uso esportivo (${CV_MIN_ESPORTIVO} cv, motor turbo ou versão esportiva)` : null,
      ].filter(Boolean).join(' e ')} segundo a ficha técnica. Tente afrouxar esse critério ou o orçamento.`,
      diagnostico: { catalogTotal: catalog.entries.length, catalogPool: pool.length, descartesPorEtapa: reasonsCount, descartadosPorFicha },
    };
  }

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
      descartadosPorFicha,
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
  orcamento: 'orçamento', semPreco: 'sem preço na FIPE', lugares: 'lugares',
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
    case 'lugares':
      return `não consta como modelo com versão de ${ctx.lugaresMin}+ lugares; o briefing pediu ${ctx.lugaresMin}. Se ele tem, falta na lista SETE_LUGARES (recommend.js).`;
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

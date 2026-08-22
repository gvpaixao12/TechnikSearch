// Medidor de consumo das APIs pagas — responde "está acabando?" pras três
// contas que o app queima: LLM de texto, LLM de visão e busca de imagens.
//
// O que cada provedor deixa saber, e por que o módulo é assim:
//
//   Serper  → tem endpoint de saldo (GET /account → { balance, rateLimit }).
//             É a única fonte EXATA das três: o número que ele devolve é o que
//             sobra pra gastar. Cacheado, porque é resposta de rede.
//
//   OpenAI  → NÃO existe saldo por chave de projeto. Sobram dois sinais:
//             (a) headers x-ratelimit-* de toda resposta — dizem se o próximo
//                 429 está perto, não se o dinheiro acabou;
//             (b) Costs API (/v1/organization/costs), que dá gasto em dólar de
//                 verdade mas exige uma ADMIN key com escopo api.usage.read
//                 (OPENAI_ADMIN_KEY). Sem ela, o painel cai na estimativa
//                 local a partir do `usage` de cada resposta.
//
//   Groq    → free tier; conta chamada e token só pra saber quanto correu.
//
// Nada aqui pode derrubar uma chamada de verdade: todo caminho de gravação é
// fire-and-forget e engole o próprio erro. Sem DATABASE_URL (dev local) o
// módulo continua funcionando, só que os números vivem em memória e zeram
// quando o processo reinicia.

const TEM_DB = !!process.env.DATABASE_URL;
const TZ = 'America/Sao_Paulo';

// Preço em USD por 1 milhão de tokens. Serve pra ESTIMAR — a verdade em dólar
// vem da Costs API. Modelo desconhecido entra como zero: melhor custo faltando
// do que custo inventado.
const PRECOS_USD_POR_MTOK = {
  'gpt-4o-mini':  { in: 0.15, out: 0.60 },
  'gpt-4o':       { in: 2.50, out: 10.00 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'gpt-5-mini':   { in: 0.25, out: 2.00 },
};

function estimaCusto(modelo, tokensIn, tokensOut) {
  const p = PRECOS_USD_POR_MTOK[modelo];
  if (!p) return 0;
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

function diaLocal(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });   // YYYY-MM-DD
}

// ─── Acumulador em memória ───────────────────────────────────────────────────
// Vale por si só (dev local sem banco) e como rede de segurança quando o
// Postgres está fora. Chave: provider|modelo|operacao.
const _mem = { dia: diaLocal(), mes: diaLocal().slice(0, 7), hoje: new Map(), mesAtual: new Map() };

function _viraODia() {
  const dia = diaLocal();
  if (dia === _mem.dia) return;
  _mem.dia = dia;
  _mem.hoje = new Map();
  const mes = dia.slice(0, 7);
  if (mes !== _mem.mes) { _mem.mes = mes; _mem.mesAtual = new Map(); }
}

function _acumula(mapa, linha) {
  const k = `${linha.provider}|${linha.modelo || ''}|${linha.operacao}`;
  const a = mapa.get(k) || {
    provider: linha.provider, modelo: linha.modelo, operacao: linha.operacao,
    chamadas: 0, tokens_in: 0, tokens_out: 0, unidades: 0, custo_usd: 0,
  };
  a.chamadas += 1;
  a.tokens_in += linha.tokens_in;
  a.tokens_out += linha.tokens_out;
  a.unidades += linha.unidades;
  a.custo_usd += linha.custo_usd;
  mapa.set(k, a);
}

// ─── Gravação no Postgres ────────────────────────────────────────────────────
// Em lote: o pipeline de fotos faz centenas de chamadas seguidas e um INSERT
// por chamada só acrescentaria latência a um caminho que já é o gargalo.
const _buffer = [];
const FLUSH_A_CADA_MS = 10_000;
const FLUSH_EM = 50;
let _timer = null;
let _dbMorto = false;          // depois de falhar, para de tentar (e de logar)

async function _flush() {
  if (!TEM_DB || _dbMorto || _buffer.length === 0) return;
  const lote = _buffer.splice(0, _buffer.length);
  try {
    const { q } = await import('./db.js');
    // Um INSERT com N linhas: ($1,$2,…), ($8,$9,…)…
    const cols = 7;
    const valores = lote.map((_, i) =>
      `(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(',')})`).join(',');
    const params = lote.flatMap(l =>
      [l.provider, l.modelo, l.operacao, l.tokens_in, l.tokens_out, l.unidades, l.custo_usd]);
    await q(
      `insert into uso_api (provider, modelo, operacao, tokens_in, tokens_out, unidades, custo_usd)
       values ${valores}`, params);
  } catch (e) {
    _dbMorto = true;
    console.warn('[usage] não consegui gravar consumo no banco, seguindo só em memória:', e.message);
  }
}

function _agenda() {
  if (_buffer.length >= FLUSH_EM) { _flush(); return; }
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; _flush(); }, FLUSH_A_CADA_MS);
  _timer.unref?.();               // não segura o processo vivo
}

function _registra(linha) {
  _viraODia();
  _acumula(_mem.hoje, linha);
  _acumula(_mem.mesAtual, linha);
  if (TEM_DB && !_dbMorto) { _buffer.push(linha); _agenda(); }
}

// ─── O que os chamadores usam ────────────────────────────────────────────────

// Uma chamada de LLM (texto ou visão). `usage` é o objeto que a própria API
// devolve; se vier vazio, a chamada ainda conta como chamada.
export function registraLLM({ provider, modelo, operacao, usage }) {
  const tokensIn = usage?.prompt_tokens || 0;
  const tokensOut = usage?.completion_tokens || 0;
  _registra({
    provider, modelo, operacao,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    unidades: 1,
    custo_usd: provider === 'openai' ? estimaCusto(modelo, tokensIn, tokensOut) : 0,
  });
}

// Uma busca. No Serper, 1 request = 1 crédito do saldo.
export function registraBusca({ provider = 'serper', creditos = 1 } = {}) {
  _registra({
    provider, modelo: null, operacao: 'busca',
    tokens_in: 0, tokens_out: 0, unidades: creditos, custo_usd: 0,
  });
}

// Headers x-ratelimit-* da última resposta. É o sinal de "vou tomar 429", e o
// teto é DA CONTA — texto e visão dividem o mesmo TPM (ver imageValidator).
const _rate = {};
export function registraRateLimit(headers, escopo = 'texto') {
  if (!headers) return;
  const h = n => (typeof headers.get === 'function' ? headers.get(n) : headers[n]);
  const num = n => { const v = h(n); return v == null ? null : Number(v); };
  const restanteTokens = num('x-ratelimit-remaining-tokens');
  if (restanteTokens == null) return;              // provedor não manda (Groq nem sempre)
  _rate[escopo] = {
    tokensRestantes: restanteTokens,
    tokensLimite: num('x-ratelimit-limit-tokens'),
    requestsRestantes: num('x-ratelimit-remaining-requests'),
    requestsLimite: num('x-ratelimit-limit-requests'),
    resetTokens: h('x-ratelimit-reset-tokens') || null,
    em: new Date().toISOString(),
  };
}

// ─── Saldo do Serper (fonte exata) ───────────────────────────────────────────
const CACHE_SALDO_MS = 5 * 60_000;
let _saldo = { valor: null, em: 0 };

export async function saldoSerper({ force = false } = {}) {
  if (!process.env.SERPER_API_KEY) return { ok: false, reason: 'SERPER_API_KEY ausente' };
  if (!force && _saldo.valor && Date.now() - _saldo.em < CACHE_SALDO_MS) {
    return { ..._saldo.valor, cache: true };
  }
  try {
    const res = await fetch('https://google.serper.dev/account', {
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    _saldo = {
      valor: {
        ok: true,
        creditos: json.balance ?? null,
        rateLimit: json.rateLimit ?? null,
        em: new Date().toISOString(),
      },
      em: Date.now(),
    };
    return _saldo.valor;
  } catch (e) {
    // Saldo velho é melhor que nada — mas o painel precisa saber que é velho.
    if (_saldo.valor) return { ..._saldo.valor, cache: true, erro: e.message };
    return { ok: false, reason: e.message };
  }
}

// ─── Gasto real na OpenAI (precisa de admin key) ─────────────────────────────
const CACHE_CUSTO_MS = 15 * 60_000;
let _custo = { valor: null, em: 0 };

export async function custoOpenAI() {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) return { ok: false, reason: 'sem OPENAI_ADMIN_KEY — usando estimativa local' };
  if (_custo.valor && Date.now() - _custo.em < CACHE_CUSTO_MS) return { ..._custo.valor, cache: true };
  try {
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    const url = 'https://api.openai.com/v1/organization/costs'
      + `?start_time=${Math.floor(inicio.getTime() / 1000)}&bucket_width=1d&limit=31`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || json?.error || `HTTP ${res.status}`);
    let total = 0;
    for (const bucket of json.data || []) {
      for (const r of bucket.results || []) total += r?.amount?.value || 0;
    }
    _custo = {
      valor: { ok: true, mesUsd: total, desde: inicio.toISOString(), em: new Date().toISOString() },
      em: Date.now(),
    };
    return _custo.valor;
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─── Agregação pro painel ────────────────────────────────────────────────────

// Offset de São Paulo em minutos naquele instante (pega horário de verão se
// um dia voltar). A VPS roda em UTC, então isso não pode sair do fuso do
// processo: o dia do painel é o dia do consultor.
function _offsetTz(d) {
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return (local - utc) / 60_000;
}

function _inicioDoDia() {
  const [a, m, d] = diaLocal().split('-').map(Number);
  const utc = Date.UTC(a, m - 1, d, 0, 0, 0);
  return new Date(utc - _offsetTz(new Date(utc)) * 60_000);
}

function _inicioDoMes() {
  const [a, m] = diaLocal().split('-').map(Number);
  const utc = Date.UTC(a, m - 1, 1, 0, 0, 0);
  return new Date(utc - _offsetTz(new Date(utc)) * 60_000);
}

function _doMapa(mapa) {
  return [...mapa.values()].map(l => ({ ...l, custo_usd: Number(l.custo_usd.toFixed(6)) }));
}

async function _doBanco(desde) {
  const { q } = await import('./db.js');
  return q(
    `select provider, modelo, operacao,
            count(*)::int           as chamadas,
            sum(tokens_in)::bigint  as tokens_in,
            sum(tokens_out)::bigint as tokens_out,
            sum(unidades)::bigint   as unidades,
            sum(custo_usd)::float   as custo_usd
       from uso_api
      where criado_em >= $1
      group by provider, modelo, operacao
      order by custo_usd desc`, [desde]);
}

function _totaliza(linhas) {
  const t = { chamadas: 0, tokens: 0, buscas: 0, custoUsd: 0 };
  for (const l of linhas) {
    t.chamadas += Number(l.chamadas);
    t.tokens += Number(l.tokens_in) + Number(l.tokens_out);
    if (l.operacao === 'busca') t.buscas += Number(l.unidades);
    t.custoUsd += Number(l.custo_usd);
  }
  t.custoUsd = Number(t.custoUsd.toFixed(4));
  return t;
}

// O painel inteiro numa chamada. Nenhuma parte derruba as outras: cada bloco
// devolve o próprio erro no próprio campo.
export async function painelUso() {
  _viraODia();
  await _flush();                       // o painel sempre vê o que já rodou

  let hoje = null;
  let mes = null;
  let fonte = 'memoria';
  if (TEM_DB && !_dbMorto) {
    try {
      [hoje, mes] = await Promise.all([_doBanco(_inicioDoDia()), _doBanco(_inicioDoMes())]);
      fonte = 'postgres';
    } catch (e) {
      console.warn('[usage] agregação no banco falhou, usando memória:', e.message);
    }
  }
  if (!hoje) { hoje = _doMapa(_mem.hoje); mes = _doMapa(_mem.mesAtual); }

  const [serper, openaiCusto] = await Promise.all([saldoSerper(), custoOpenAI()]);

  return {
    ok: true,
    fonte,                                        // postgres | memoria
    serper,
    openai: {
      rateLimit: _rate,                           // { texto: {…}, visao: {…} }
      custoReal: openaiCusto,                     // Costs API, se houver admin key
      adminKey: process.env.OPENAI_ADMIN_KEY ? 'set' : 'missing',
    },
    hoje: { total: _totaliza(hoje), linhas: hoje },
    mes: { total: _totaliza(mes), linhas: mes },
    em: new Date().toISOString(),
  };
}

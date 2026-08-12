// Histórico de consultas — persiste cada recomendação entregue no Postgres
// (tabela `consultas`, criada via scripts/consultas-schema.sql).
//
// Filosofia: salvar NUNCA pode quebrar a recomendação. Todo erro aqui é
// logado e engolido — o consultor recebe o resultado mesmo que o histórico
// falhe (ex.: banco fora do ar).

import { q, one, oneOrFail, jsonb } from './db.js';

// Monta a linha denormalizada a partir do request + resultado do recommend.
function buildRow({ id, client, result }) {
  const briefing = result?.briefing || {};
  const orc = briefing.orcamentoReais || {};
  const top = Array.isArray(result?.top) ? result.top : [];
  return {
    ...(id ? { id } : {}),
    client_name: client?.name?.trim() || null,
    client_segment: client?.segment?.trim() || null,
    ok: result?.ok !== false,
    orcamento_min: Number.isFinite(orc.min) ? Math.round(orc.min) : null,
    orcamento_max: Number.isFinite(orc.max) ? Math.round(orc.max) : null,
    tipos: briefing.tiposDesejados || [],
    combustiveis: briefing.combustiveisAceitos || [],
    prioridades: briefing.prioridades || [],
    ano_min: briefing.anoMin != null ? Number(briefing.anoMin) : null,
    total_resultados: top.length,
    mes_referencia: top[0]?.mesReferencia || null,
    top_models: top.map(c => `${c.brand} ${c.model}`),
    briefing,
    top,
    diagnostico: result?.diagnostico || null,
  };
}

// Grava uma consulta. Retorna o id inserido, ou null se falhou (sem lançar).
// `id` opcional: quem chama pode gerar o uuid antes (crypto.randomUUID) pra já
// devolver o id ao frontend sem esperar o insert — é o que /api/recommend faz,
// pra que o feedback consiga se referir à consulta sem atrasar a resposta.
export async function saveConsulta({ id, client, result }) {
  try {
    const r = buildRow({ id, client, result });
    // `tipos`, `combustiveis`, `prioridades` e `top_models` são text[] e vão
    // como array JS mesmo — é `briefing`/`top`/`diagnostico` (jsonb) que
    // precisam de jsonb(). Ver o comentário em db.js.
    const inserted = await one(
      `insert into consultas
         (${r.id ? 'id, ' : ''}client_name, client_segment, ok, orcamento_min, orcamento_max,
          tipos, combustiveis, prioridades, ano_min, total_resultados,
          mes_referencia, top_models, briefing, top, diagnostico)
       values (${r.id ? '$16, ' : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning id`,
      [r.client_name, r.client_segment, r.ok, r.orcamento_min, r.orcamento_max,
        r.tipos, r.combustiveis, r.prioridades, r.ano_min, r.total_resultados,
        r.mes_referencia, r.top_models, jsonb(r.briefing), jsonb(r.top),
        jsonb(r.diagnostico), ...(r.id ? [r.id] : [])]
    );
    return inserted?.id || null;
  } catch (e) {
    console.warn('[history] saveConsulta falhou (ignorado):', e.message);
    return null;
  }
}

// Colunas leves pra listagem/agregação (sem os jsonb grandes).
const LIST_COLS = 'id, created_at, client_name, client_segment, ok, orcamento_min, orcamento_max, tipos, total_resultados, mes_referencia, top_models';

// Lista as consultas mais recentes (resumo, sem briefing/top completos).
export async function listConsultas({ limit = 50 } = {}) {
  return q(
    `select ${LIST_COLS} from consultas order by created_at desc limit $1`,
    [limit]
  );
}

// Registro completo de uma consulta (pra reabrir como resultado).
// Lança quando não existe — era o comportamento do .single() do supabase-js, e
// o endpoint depende dele pra devolver erro em vez de 200 com corpo vazio.
export async function getConsulta(id) {
  return oneOrFail('select * from consultas where id = $1', [id], 'consulta não encontrada');
}

// Agrega métricas em JS (volume baixo; evita RPC/GROUP BY no Postgres).
export async function getStats({ sample = 1000 } = {}) {
  const rows = await q(
    `select created_at, ok, orcamento_min, orcamento_max, total_resultados, tipos, top_models
       from consultas order by created_at desc limit $1`,
    [sample]
  );

  const total = rows.length;
  const comResultado = rows.filter(r => r.total_resultados > 0).length;

  // Orçamento médio (ponto médio da faixa) sobre quem tem faixa definida.
  const faixas = rows
    .filter(r => Number.isFinite(r.orcamento_min) && Number.isFinite(r.orcamento_max))
    .map(r => (r.orcamento_min + r.orcamento_max) / 2);
  const orcamentoMedio = faixas.length
    ? Math.round(faixas.reduce((s, v) => s + v, 0) / faixas.length)
    : null;

  // Tally de arrays (tipos pedidos, carros recomendados).
  const tally = (arrays) => {
    const m = new Map();
    for (const arr of arrays) for (const v of (arr || [])) {
      if (!v) continue;
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  };

  const tiposMaisPedidos = tally(rows.map(r => r.tipos)).slice(0, 8);
  const carrosMaisRecomendados = tally(rows.map(r => r.top_models)).slice(0, 10);

  return {
    total,
    comResultado,
    semResultado: total - comResultado,
    taxaResultado: total ? Math.round((comResultado / total) * 100) : 0,
    orcamentoMedio,
    tiposMaisPedidos,
    carrosMaisRecomendados,
  };
}

// Histórico de consultas — persiste cada recomendação entregue no Supabase
// (tabela `consultas`, criada via scripts/consultas-schema.sql).
//
// Filosofia: salvar NUNCA pode quebrar a recomendação. Todo erro aqui é
// logado e engolido — o consultor recebe o resultado mesmo que o histórico
// falhe (ex.: tabela ainda não criada, Supabase pausado).

import { getSupabase } from './imageCache.js';

// Monta a linha denormalizada a partir do request + resultado do recommend.
function buildRow({ client, result }) {
  const briefing = result?.briefing || {};
  const orc = briefing.orcamentoReais || {};
  const top = Array.isArray(result?.top) ? result.top : [];
  return {
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
export async function saveConsulta({ client, result }) {
  try {
    const sb = getSupabase();
    const row = buildRow({ client, result });
    const { data, error } = await sb
      .from('consultas')
      .insert(row)
      .select('id')
      .single();
    if (error) throw error;
    return data?.id || null;
  } catch (e) {
    console.warn('[history] saveConsulta falhou (ignorado):', e.message);
    return null;
  }
}

// Colunas leves pra listagem/agregação (sem os jsonb grandes).
const LIST_COLS = 'id, created_at, client_name, client_segment, ok, orcamento_min, orcamento_max, tipos, total_resultados, mes_referencia, top_models';

// Lista as consultas mais recentes (resumo, sem briefing/top completos).
export async function listConsultas({ limit = 50 } = {}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consultas')
    .select(LIST_COLS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Registro completo de uma consulta (pra reabrir como resultado).
export async function getConsulta(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consultas')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// Agrega métricas em JS (volume baixo; evita RPC/GROUP BY no Postgres).
export async function getStats({ sample = 1000 } = {}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consultas')
    .select('created_at, ok, orcamento_min, orcamento_max, total_resultados, tipos, top_models')
    .order('created_at', { ascending: false })
    .limit(sample);
  if (error) throw error;
  const rows = data || [];

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

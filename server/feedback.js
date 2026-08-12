// Feedback do consultor sobre a qualidade de uma busca — 👍/👎 e, quando 👎,
// os motivos e o carro que faltou (tabela `consulta_feedback`, criada via
// scripts/feedback-schema.sql).
//
// Filosofia OPOSTA à de history.js: aqui o erro NÃO é engolido. O histórico é
// salvo pelas costas do consultor, então falhar calado é aceitável; o feedback
// ele digitou à mão, e sumir em silêncio depois de escrever um parágrafo é pior
// do que dizer "não consegui salvar". Quem chama decide o que mostrar.

import { getSupabase } from './imageCache.js';

const MOTIVOS_VALIDOS = new Set([
  'caro', 'perfil', 'faltou', 'repetitivo', 'ficha', 'fotos', 'poucos',
]);

export async function saveFeedback({
  consultaId, rating, motivos, comentario, faltou, diagnostico, clientName, briefing,
}) {
  if (rating !== 'up' && rating !== 'down') {
    throw new Error('rating precisa ser "up" ou "down"');
  }
  const row = {
    consulta_id: consultaId || null,
    rating,
    motivos: (Array.isArray(motivos) ? motivos : []).filter(m => MOTIVOS_VALIDOS.has(m)),
    comentario: comentario?.trim() || null,
    faltou: faltou?.trim() || null,
    diagnostico: diagnostico || null,
    client_name: clientName?.trim() || null,
    briefing: briefing || null,
  };
  const sb = getSupabase();
  const { data, error } = await sb
    .from('consulta_feedback')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return data?.id || null;
}

// Lista os feedbacks mais recentes (pra inspeção/priorização).
export async function listFeedback({ limit = 100, rating } = {}) {
  const sb = getSupabase();
  let q = sb
    .from('consulta_feedback')
    .select('id, created_at, consulta_id, rating, motivos, comentario, faltou, diagnostico, client_name')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (rating === 'up' || rating === 'down') q = q.eq('rating', rating);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

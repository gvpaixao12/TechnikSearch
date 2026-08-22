// Feedback do consultor sobre a qualidade de uma busca — 👍/👎 e, quando 👎,
// os motivos e o carro que faltou (tabela `consulta_feedback`, criada via
// scripts/feedback-schema.sql).
//
// Filosofia OPOSTA à de history.js: aqui o erro NÃO é engolido. O histórico é
// salvo pelas costas do consultor, então falhar calado é aceitável; o feedback
// ele digitou à mão, e sumir em silêncio depois de escrever um parágrafo é pior
// do que dizer "não consegui salvar". Quem chama decide o que mostrar.

import { q, one, jsonb } from './db.js';

const MOTIVOS_VALIDOS = new Set([
  'caro', 'perfil', 'faltou', 'repetitivo', 'ficha', 'fotos', 'poucos',
]);

export async function saveFeedback({
  consultaId, rating, motivos, comentario, faltou, diagnostico, clientName, briefing,
}) {
  if (rating !== 'up' && rating !== 'down') {
    throw new Error('rating precisa ser "up" ou "down"');
  }
  // ATENÇÃO: esta é a tabela onde é mais fácil errar a serialização — `motivos`
  // é text[] (vai como array JS) enquanto `diagnostico` e `briefing` são jsonb
  // (precisam de jsonb()). Trocar os dois grava torto sem estourar erro. Ver db.js.
  const inserted = await one(
    `insert into consulta_feedback
       (consulta_id, rating, motivos, comentario, faltou, diagnostico, client_name, briefing)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      consultaId || null,
      rating,
      (Array.isArray(motivos) ? motivos : []).filter(m => MOTIVOS_VALIDOS.has(m)),
      comentario?.trim() || null,
      faltou?.trim() || null,
      jsonb(diagnostico || null),
      clientName?.trim() || null,
      jsonb(briefing || null),
    ]
  );
  return inserted?.id || null;
}

// Lista os feedbacks mais recentes (pra inspeção/priorização).
export async function listFeedback({ limit = 100, rating } = {}) {
  const filtra = rating === 'up' || rating === 'down';
  return q(
    `select id, created_at, consulta_id, rating, motivos, comentario, faltou,
            diagnostico, client_name
       from consulta_feedback
      ${filtra ? 'where rating = $2' : ''}
      order by created_at desc
      limit $1`,
    filtra ? [limit, rating] : [limit]
  );
}

// ─── O feedback voltando pro pipeline ────────────────────────────────────
// Modelos que o consultor apontou como "senti falta de X" E que o diagnóstico
// classificou como problema de RANKING (passou nos filtros, entrou no pool,
// não chegou ao top). São os únicos que viram lembrete pro LLM: gap de
// catálogo é trabalho de build, e corte por filtro é o briefing funcionando —
// nenhum dos dois se resolve cutucando o modelo.
//
// Agrupa por termo digitado (normalizado no SQL só o suficiente pra "Golf" e
// "golf " caírem juntos); quem consome re-tokeniza com a MESMA regra do
// diagnóstico, pra lembrete e diagnóstico nunca discordarem sobre o que casa.
export async function listRankingMisses({ dias = 90, limit = 12 } = {}) {
  return q(
    `select lower(trim(faltou)) as termo,
            count(*)::int       as vezes,
            max(created_at)     as ultima
       from consulta_feedback
      where rating = 'down'
        and faltou is not null
        and trim(faltou) <> ''
        and diagnostico->>'causa' = 'vendedor-nao-escolheu'
        and created_at > now() - make_interval(days => $1::int)
      group by 1
      order by vezes desc, ultima desc
      limit $2`,
    [dias, limit]
  );
}

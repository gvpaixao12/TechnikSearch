// Acesso ao Postgres da VPS. Substitui o cliente PostgREST do Supabase
// (`supabase-js`) por SQL direto — ver PLANO-BANCO-VPS.md.
//
// Não é um query builder de propósito: a superfície são ~25 queries simples,
// e um builder só acrescentaria uma linguagem intermediária pra aprender. Quem
// chama escreve SQL e recebe linhas.
//
// Conexão: DATABASE_URL. Na VPS aponta pra localhost (o Postgres NÃO fica
// exposto na internet); da máquina local, pra um túnel SSH — ver o README do
// plano.

import pg from 'pg';

let _pool = null;

export function getPool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL ausente no .env');
  _pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sem este handler, um erro num socket ocioso derruba o processo inteiro.
  _pool.on('error', e => console.warn('[db] erro em conexão ociosa:', e.message));
  return _pool;
}

// Retorna as linhas. Use $1, $2… — NUNCA interpole valor na string.
export async function q(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rows;
}

// Primeira linha ou null. Equivale ao `.maybeSingle()` do supabase-js.
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

// Igual a `one`, mas exige que exista — equivale ao `.single()`, que lançava
// quando não achava. `history.js` e `rascunhos.js` dependem desse
// comportamento pra propagar erro em vez de devolver undefined em silêncio.
export async function oneOrFail(text, params = [], msg = 'registro não encontrado') {
  const row = await one(text, params);
  if (!row) throw new Error(msg);
  return row;
}

// Número de linhas afetadas por insert/update/delete.
export async function exec(text, params = []) {
  const res = await getPool().query(text, params);
  return res.rowCount;
}

// ─── O footgun do driver `pg` ────────────────────────────────────────────────
// O driver serializa um array JS como ARRAY DO POSTGRES. Isso é o que você quer
// nas colunas `text[]` (tipos, top_models, combustiveis, prioridades, motivos)
// — passe o array direto. Mas é exatamente o que você NÃO quer numa coluna
// `jsonb` (images, briefing, top, diagnostico, form): ali o valor precisa ir
// como string JSON, senão o insert falha ou grava um array do Postgres onde
// deveria haver JSON.
//
// A pegadinha é que o caso errado nem sempre estoura — grava torto e só
// aparece na leitura. Por isso todo parâmetro jsonb passa por aqui, e a
// `consulta_feedback` (que tem `motivos text[]` E `diagnostico jsonb` na mesma
// linha) é o lugar mais fácil de trocar os dois.
export function jsonb(value) {
  return value == null ? null : JSON.stringify(value);
}

// Fecha o pool (scripts que precisam terminar o processo).
export async function closePool() {
  if (_pool) { await _pool.end(); _pool = null; }
}

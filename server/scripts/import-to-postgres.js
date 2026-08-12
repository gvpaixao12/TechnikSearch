// Copia os dados do Supabase (via API REST) para o Postgres da VPS.
//
// Usa a REST em vez de pg_dump de propósito: assim não precisa da senha do
// Postgres do Supabase (que é diferente da service_role key) nem da conexão
// direta, que é IPv6-only no free tier. A chave que o app já usa basta.
//
// Uso (de dentro de server/), com o túnel SSH de pé:
//   ssh -N -L 5433:localhost:5432 root@2.25.166.43 -i ~/.ssh/technik_deploy
//   DATABASE_URL=postgres://technik:SENHA@localhost:5433/technik_test \
//     node scripts/import-to-postgres.js            # DRY-RUN: conta, não grava
//   ... node scripts/import-to-postgres.js --apply  # grava
//
// IDEMPOTENTE: re-rodar não duplica (upsert por chave primária). Seguro rodar
// de novo pra sincronizar o que mudou desde a última vez — útil porque o app
// continua escrevendo no Supabase até o corte.
import 'dotenv/config';
import { getSupabase } from '../supabase.js';
import { q, exec, jsonb, closePool, getPool } from '../db.js';

const APPLY = process.argv.includes('--apply');

// Colunas jsonb de cada tabela — precisam de JSON.stringify antes de virar
// parâmetro. As colunas text[] NÃO entram aqui: o driver já serializa array JS
// como array do Postgres, que é o que elas querem. Ver o comentário em db.js.
const TABELAS = [
  {
    nome: 'car_images_cache',
    pk: 'key',
    colunas: ['key', 'marca', 'modelo', 'ano', 'images', 'validated', 'cached_at', 'expires_at'],
    json: ['images'],
  },
  {
    nome: 'consultas',
    pk: 'id',
    colunas: ['id', 'created_at', 'client_name', 'client_segment', 'ok', 'orcamento_min',
      'orcamento_max', 'tipos', 'combustiveis', 'prioridades', 'ano_min', 'total_resultados',
      'mes_referencia', 'top_models', 'briefing', 'top', 'diagnostico'],
    json: ['briefing', 'top', 'diagnostico'],
  },
  { nome: 'rascunhos', pk: 'id', colunas: ['id', 'created_at', 'updated_at', 'client_name', 'form'], json: ['form'] },
  {
    nome: 'consulta_feedback',
    pk: 'id',
    colunas: ['id', 'created_at', 'consulta_id', 'rating', 'motivos', 'comentario',
      'faltou', 'diagnostico', 'client_name', 'briefing'],
    json: ['diagnostico', 'briefing'],
  },
];

const sb = getSupabase();

async function lerTudo(nome) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(nome).select('*').range(from, from + 999);
    if (error) {
      // Tabela ausente na origem não é motivo pra abortar a migração das que
      // importam — e o schema cache do PostgREST às vezes "perde" uma tabela
      // vazia por alguns minutos. Trata como zero linhas e segue.
      if (/schema cache|does not exist|not find the table/i.test(error.message)) {
        console.warn(`  ⚠ ${nome}: não encontrada na origem (${error.message.slice(0, 60)}…) — tratando como vazia`);
        return rows;
      }
      throw new Error(`${nome}: ${error.message}`);
    }
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// Um INSERT por linha com upsert na PK. O volume é pequeno (~1.250 linhas), então
// não vale a complexidade de multi-row insert — legibilidade ganha aqui.
async function gravar(t, rows) {
  const cols = t.colunas;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = cols.filter(c => c !== t.pk).map(c => `${c} = excluded.${c}`).join(', ');
  const sql = `insert into ${t.nome} (${cols.join(', ')}) values (${placeholders})
               on conflict (${t.pk}) do update set ${updates}`;
  let n = 0;
  for (const row of rows) {
    const params = cols.map(c => (t.json.includes(c) ? jsonb(row[c]) : row[c] ?? null));
    n += await exec(sql, params);
  }
  return n;
}

const destino = (process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@');
console.log(`Origem:  Supabase (REST)`);
console.log(`Destino: ${destino || '(DATABASE_URL ausente)'}\n`);
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL ausente — o túnel SSH está de pé?'); process.exit(1); }

// Falha cedo e com mensagem clara se o túnel não estiver aberto.
try {
  await getPool().query('select 1');
} catch (e) {
  console.error(`Não consegui falar com o Postgres: ${e.message}`);
  console.error('Confira o túnel: ssh -N -L 5433:localhost:5432 root@2.25.166.43 -i ~/.ssh/technik_deploy');
  process.exit(1);
}

let total = 0;
for (const t of TABELAS) {
  const rows = await lerTudo(t.nome);
  const antes = Number((await q(`select count(*)::int as n from ${t.nome}`))[0].n);
  if (!APPLY) {
    console.log(`  ${String(rows.length).padStart(5)} linhas no Supabase · ${antes} já no Postgres  ${t.nome}`);
    continue;
  }
  const n = await gravar(t, rows);
  const depois = Number((await q(`select count(*)::int as n from ${t.nome}`))[0].n);
  console.log(`  ${String(n).padStart(5)} gravadas · Postgres ${antes} → ${depois}  ${t.nome}`);
  total += n;
}

if (!APPLY) {
  console.log('\nDRY-RUN — nada gravado. Pra valer: --apply');
} else {
  console.log(`\n${total} linhas gravadas.`);
}
await closePool();

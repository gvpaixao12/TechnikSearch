// Cadastro de clientes do CRM (tabela `clientes`, criada via
// scripts/clientes-schema.sql).
//
// Erros SOBEM, como em `rascunhos.js` e ao contrário de `history.js`. A regra é
// a mesma dos dois: quando gravar É a ação que o usuário pediu, ele precisa
// saber se falhou. Em `history.js` salvar é efeito colateral de uma
// recomendação, então lá o erro é engolido pra não derrubar o resultado.

import { q, one, oneOrFail, exec, tx } from './db.js';

const limpa = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return s || null;
};

// Lista com a contagem de consultas de cada um — é o número que a lista do CRM
// mostra, e buscá-lo por linha seria N+1.
export async function listClientes({ busca = null, limit = 200 } = {}) {
  const termo = limpa(busca);
  return q(
    `select c.id, c.nome, c.telefone, c.email, c.criado_em, c.atualizado_em,
            count(co.id)::int as total_consultas,
            max(co.created_at)  as ultima_consulta
       from clientes c
       left join consultas co on co.cliente_id = c.id
      ${termo ? 'where c.nome ilike $2 or c.telefone ilike $2 or c.email ilike $2' : ''}
      group by c.id
      order by c.nome asc
      limit $1`,
    termo ? [limit, `%${termo}%`] : [limit]
  );
}

// Ficha do cliente + o histórico dele. Duas queries porque são duas listas de
// tamanhos diferentes; juntar num join só devolveria a ficha repetida N vezes.
export async function getCliente(id) {
  const cliente = await oneOrFail('select * from clientes where id = $1', [id], 'cliente não encontrado');
  const consultas = await q(
    `select id, created_at, client_segment, ok, orcamento_min, orcamento_max,
            tipos, total_resultados, top_models
       from consultas where cliente_id = $1 order by created_at desc`,
    [id]
  );
  const rascunhos = await q(
    `select id, created_at, updated_at, client_name
       from rascunhos where cliente_id = $1 order by updated_at desc`,
    [id]
  );
  return { ...cliente, consultas, rascunhos };
}

export async function criaCliente({ nome, telefone, email, notas }) {
  const n = limpa(nome);
  if (!n) throw new Error('nome é obrigatório');
  return one(
    `insert into clientes (nome, telefone, email, notas)
     values ($1, $2, $3, $4) returning *`,
    [n, limpa(telefone), limpa(email), limpa(notas)]
  );
}

export async function atualizaCliente(id, { nome, telefone, email, notas }) {
  const n = limpa(nome);
  if (!n) throw new Error('nome é obrigatório');
  return oneOrFail(
    `update clientes
        set nome = $1, telefone = $2, email = $3, notas = $4, atualizado_em = now()
      where id = $5 returning *`,
    [n, limpa(telefone), limpa(email), limpa(notas), id],
    'cliente não encontrado'
  );
}

// Exclusão de verdade: some a linha do cadastro E o nome/perfil das consultas e
// rascunhos que apontavam pra ela.
//
// O `on delete set null` do schema, sozinho, só desataria o ponteiro — o
// `client_name` de texto continuaria gravado em cada consulta, e aí "excluir o
// cliente" não teria apagado dado pessoal nenhum. O que sobra na consulta é o
// que NÃO identifica ninguém (carros recomendados, faixa de orçamento, tipos),
// que é o que alimenta as estatísticas do painel.
//
// Tudo numa transação: anonimizar sem apagar deixaria o cadastro de pé com as
// consultas já descaracterizadas, e não há como desfazer isso depois.
export async function excluiCliente(id) {
  return tx(async ({ exec: x }) => {
    const consultas = await x(
      `update consultas set cliente_id = null, client_name = null, client_segment = null
        where cliente_id = $1`,
      [id]
    );
    const rascunhos = await x(
      'update rascunhos set cliente_id = null, client_name = null where cliente_id = $1',
      [id]
    );
    const apagados = await x('delete from clientes where id = $1', [id]);
    if (!apagados) throw new Error('cliente não encontrado');
    return { consultasAnonimizadas: consultas, rascunhosAnonimizados: rascunhos };
  });
}

// ─── Vinculação assistida ───────────────────────────────────────────────────
// Amarra uma consulta já registrada a um cliente do cadastro. É o caminho pelo
// qual o histórico antigo vai ganhando identidade: nada de backfill por
// adivinhação de nome, que fundiria pessoas distintas em silêncio.
//
// O `client_name` da consulta NÃO é sobrescrito com o nome do cadastro. Ele é o
// que foi digitado no atendimento e serve de rastro — se a vinculação estiver
// errada, é por ele que se percebe.
export async function vinculaConsulta(consultaId, clienteId) {
  await oneOrFail('select id from clientes where id = $1', [clienteId], 'cliente não encontrado');
  return oneOrFail(
    'update consultas set cliente_id = $1 where id = $2 returning id, cliente_id',
    [clienteId, consultaId],
    'consulta não encontrada'
  );
}

export async function desvinculaConsulta(consultaId) {
  await exec('update consultas set cliente_id = null where id = $1', [consultaId]);
  return true;
}

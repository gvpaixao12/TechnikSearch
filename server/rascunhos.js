// Rascunhos de briefing — snapshots do formulário que o consultor salva pra
// retomar depois (tabela `rascunhos`, criada via scripts/rascunhos-schema.sql).
//
// Diferente do histórico: aqui o SAVE é a ação principal do usuário (ele clicou
// "Salvar rascunho"), então erros NÃO são engolidos — sobem pro endpoint, que
// devolve o motivo. Assim o consultor sabe se o rascunho não foi salvo.

import { q, one, oneOrFail, exec, jsonb } from './db.js';

// Salva (insere) ou atualiza um rascunho. Se `id` vier, atualiza aquele; senão
// cria um novo. Retorna o id do rascunho gravado.
export async function saveRascunho({ id = null, client_name = null, form }) {
  if (!form || typeof form !== 'object') throw new Error('form é obrigatório');
  const name = (client_name || form?.client?.name || '').trim() || null;

  if (id) {
    const row = await oneOrFail(
      `update rascunhos set client_name = $1, form = $2, updated_at = now()
        where id = $3 returning id`,
      [name, jsonb(form), id],
      'rascunho não encontrado'
    );
    return row.id;
  }

  const row = await one(
    'insert into rascunhos (client_name, form) values ($1, $2) returning id',
    [name, jsonb(form)]
  );
  return row?.id || null;
}

// Lista os rascunhos mais recentes (sem o jsonb form pesado).
export async function listRascunhos({ limit = 50 } = {}) {
  return q(
    `select id, created_at, updated_at, client_name
       from rascunhos order by updated_at desc limit $1`,
    [limit]
  );
}

// Registro completo de um rascunho (pra restaurar o formulário).
export async function getRascunho(id) {
  return oneOrFail('select * from rascunhos where id = $1', [id], 'rascunho não encontrado');
}

export async function deleteRascunho(id) {
  await exec('delete from rascunhos where id = $1', [id]);
  return true;
}

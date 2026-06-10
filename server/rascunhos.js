// Rascunhos de briefing — snapshots do formulário que o consultor salva pra
// retomar depois (tabela `rascunhos`, criada via scripts/rascunhos-schema.sql).
//
// Diferente do histórico: aqui o SAVE é a ação principal do usuário (ele clicou
// "Salvar rascunho"), então erros NÃO são engolidos — sobem pro endpoint, que
// devolve o motivo. Assim o consultor sabe se o rascunho não foi salvo.

import { getSupabase } from './imageCache.js';

// Salva (insere) ou atualiza um rascunho. Se `id` vier, atualiza aquele; senão
// cria um novo. Retorna o id do rascunho gravado.
export async function saveRascunho({ id = null, client_name = null, form }) {
  if (!form || typeof form !== 'object') throw new Error('form é obrigatório');
  const sb = getSupabase();
  const name = (client_name || form?.client?.name || '').trim() || null;

  if (id) {
    const { data, error } = await sb
      .from('rascunhos')
      .update({ client_name: name, form, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .single();
    if (error) throw error;
    return data?.id || id;
  }

  const { data, error } = await sb
    .from('rascunhos')
    .insert({ client_name: name, form })
    .select('id')
    .single();
  if (error) throw error;
  return data?.id || null;
}

// Lista os rascunhos mais recentes (sem o jsonb form pesado).
export async function listRascunhos({ limit = 50 } = {}) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('rascunhos')
    .select('id, created_at, updated_at, client_name')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Registro completo de um rascunho (pra restaurar o formulário).
export async function getRascunho(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('rascunhos')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRascunho(id) {
  const sb = getSupabase();
  const { error } = await sb.from('rascunhos').delete().eq('id', id);
  if (error) throw error;
  return true;
}

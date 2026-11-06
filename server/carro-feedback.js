// "Não curti este carro" — o botão por card na lista de resultados.
//
// Ao contrário dos chips de consulta_feedback (só gravados), cada motivo aqui
// AGE na hora — um botão que só anota é exatamente o que o consultor
// estranhou no feedback da busca:
//   'perfil' → a família do modelo some das próximas buscas com o mesmo uso
//              (lido por recommend.js via loadExclusoes)
//   'foto'   → a foto da capa é apagada da galeria (quem apaga é o index.js)
//
// Mesma filosofia de erro de feedback.js: não engolir — o consultor clicou e
// precisa saber se pegou.

import { q, one, exec, jsonb } from './db.js';

const MOTIVOS = new Set(['perfil', 'foto']);

export async function saveCarroFeedback({
  consultaId, motivo, marca, modelo, ano, familia, usos, fotoUrl, clientName, briefing,
}) {
  if (!MOTIVOS.has(motivo)) throw new Error('motivo precisa ser "perfil" ou "foto"');
  if (!marca || !modelo || !familia) throw new Error('marca, modelo e familia são obrigatórios');
  const row = await one(
    `insert into carro_feedback
       (consulta_id, motivo, marca, modelo, ano, familia, usos, foto_url, client_name, briefing)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      consultaId || null, motivo, marca, modelo, Number(ano) || null, familia,
      (Array.isArray(usos) ? usos : []).filter(Boolean),
      fotoUrl || null, clientName?.trim() || null, jsonb(briefing || null),
    ]
  );
  return row?.id || null;
}

// Exclusões por perfil ainda válidas. Um ano: gosto do consultor muda devagar,
// mas não é pra sempre — e apagar a linha desfaz antes disso.
export async function listExclusoesPerfil({ dias = 365 } = {}) {
  return q(
    `select id, created_at, marca, modelo, ano, familia, usos
       from carro_feedback
      where motivo = 'perfil'
        and created_at > now() - make_interval(days => $1::int)
      order by created_at desc`,
    [dias]
  );
}

export async function deleteCarroFeedback(id) {
  return exec(`delete from carro_feedback where id = $1`, [id]);
}

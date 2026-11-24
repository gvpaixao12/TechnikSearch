// Ficha técnica guardada por versão FIPE + ano-modelo.
//
// Antes, o vendedor reescrevia a ficha de 25 carros em TODA busca: ~9k tokens
// de saída, a parte mais lenta e cara da recomendação, e o lugar onde nascem os
// números errados — e o mesmo Compass 2020 podia sair com 166 cv numa busca e
// 185 na outra. A ficha de uma versão não depende do briefing, então ela é
// escrita uma vez e reaproveitada: a busca fica mais rápida, mais barata, e uma
// correção (manual ou do ficha-sanity) vale pra sempre.
//
// Banco fora do ar não pode derrubar a recomendação: aqui todo erro é engolido
// e o pipeline volta a pedir a ficha inteira ao LLM, como antes.
//
// Correção manual: UPDATE ficha_cache SET ficha = '{...}', origem = 'manual'
// WHERE chave = '<codigoFipe>|<ano>'. Linha 'manual' nunca é sobrescrita.

import { q, exec, jsonb } from './db.js';

const CAMPOS = ['motor', 'cambio', 'potencia', 'torque', 'tracao', 'consumoCidade', 'consumoEstrada', 'porta_malas', 'lugares'];

export const chaveFicha = (codigoFipe, ano) => (codigoFipe && ano ? `${codigoFipe}|${ano}` : null);

// Quantos campos a ficha tem de fato preenchidos — ficha toda em branco não
// vale guardar, e uma mais completa substitui uma mais pobre.
export function camposPreenchidos(ficha) {
  if (!ficha) return 0;
  return CAMPOS.filter(c => (c === 'lugares' ? Number(ficha[c]) > 0 : String(ficha[c] ?? '').trim() !== '')).length;
}

let _pronta = null;
function garanteTabela() {
  _pronta ||= exec(`
    create table if not exists ficha_cache (
      chave       text primary key,          -- codigoFipe|anoModelo
      marca       text not null,
      modelo      text not null,
      ano         int,
      ficha       jsonb not null,
      campos      int  not null default 0,   -- campos preenchidos (ver camposPreenchidos)
      origem      text not null default 'llm', -- 'llm' | 'manual'
      modelo_llm  text,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now()
    )`).catch(e => { _pronta = null; throw e; });
  return _pronta;
}

let _avisou = false;
function avisa(onde, e) {
  if (_avisou) return;
  _avisou = true;
  console.warn(`[ficha-cache] ${onde} falhou, seguindo sem cache: ${e.message}`);
}

// Map chave → ficha, só das que existem.
export async function carregaFichas(chaves) {
  const lista = [...new Set(chaves.filter(Boolean))];
  if (!lista.length) return new Map();
  try {
    await garanteTabela();
    const rows = await q('select chave, ficha from ficha_cache where chave = any($1)', [lista]);
    return new Map(rows.map(r => [r.chave, r.ficha]));
  } catch (e) {
    avisa('leitura', e);
    return new Map();
  }
}

// itens: [{ chave, marca, modelo, ano, ficha }]. Não espera o banco — quem
// chama já tem a resposta pro usuário; gravar é só pra próxima busca.
export function salvaFichas(itens, modeloLlm = null) {
  const bons = itens.filter(i => i.chave && camposPreenchidos(i.ficha) >= 3);
  if (!bons.length) return;
  (async () => {
    await garanteTabela();
    for (const i of bons) {
      await exec(
        `insert into ficha_cache (chave, marca, modelo, ano, ficha, campos, modelo_llm)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (chave) do update
           set ficha = excluded.ficha, campos = excluded.campos,
               modelo_llm = excluded.modelo_llm, updated_at = now()
         where ficha_cache.origem <> 'manual' and excluded.campos > ficha_cache.campos`,
        [i.chave, i.marca, i.modelo, Number(i.ano) || null, jsonb(i.ficha), camposPreenchidos(i.ficha), modeloLlm]
      );
    }
  })().catch(e => avisa('gravação', e));
}

// Resumo de uma linha pro prompt: o LLM decide melhor "esportivo" e "7
// lugares" vendo o número do que lembrando dele.
export function resumoFicha(ficha) {
  if (!ficha) return '';
  const partes = [
    Number(ficha.lugares) > 0 ? `${ficha.lugares} lugares` : null,
    ficha.potencia || null,
    ficha.motor || null,
    ficha.cambio || null,
    ficha.tracao ? `tração ${ficha.tracao}` : null,
    ficha.porta_malas ? `porta-malas ${ficha.porta_malas}` : null,
  ].filter(Boolean);
  return partes.join(', ');
}

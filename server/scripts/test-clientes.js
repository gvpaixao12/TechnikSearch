// Teste da lógica de `clientes.js` contra um `db.js` falso.
//
// Existe por causa de UMA função: `excluiCliente`. O que ela faz é
// irreversível (apaga cadastro e anonimiza consultas) e é a única coisa do
// módulo que depende de ORDEM e de transação — anonimizar sem apagar, ou apagar
// sem anonimizar, são os dois jeitos de o "excluir" mentir. Nenhum dos dois
// estoura em runtime, então só um teste pega.
//
// O `db.js` falso grava o SQL emitido em vez de falar com o Postgres: o que
// está sendo verificado é quais comandos saem, em que ordem e dentro de qual
// transação — não o Postgres, que já sabe executar update e delete.
//
// Uso:  node --experimental-test-module-mocks scripts/test-clientes.js

import { mock } from 'node:test';

// ─── db.js falso ────────────────────────────────────────────────────────────
let emitido = [];         // [{ sql, params, dentroDeTx }]
let dentroDeTx = false;
let commitou = false;
let reverteu = false;
let resposta = () => [{ id: 'k1' }];   // o que as queries devolvem
let linhasAfetadas = 1;

function grava(sql, params) {
  emitido.push({ sql: sql.replace(/\s+/g, ' ').trim(), params, dentroDeTx });
}

mock.module('../db.js', {
  namedExports: {
    q: async (sql, params) => { grava(sql, params); return resposta(); },
    one: async (sql, params) => { grava(sql, params); return resposta()[0] ?? null; },
    oneOrFail: async (sql, params, msg) => {
      grava(sql, params);
      const r = resposta()[0];
      if (!r) throw new Error(msg || 'registro não encontrado');
      return r;
    },
    exec: async (sql, params) => { grava(sql, params); return linhasAfetadas; },
    tx: async (fn) => {
      dentroDeTx = true;
      try {
        const r = await fn({
          q: async (sql, params) => { grava(sql, params); return resposta(); },
          exec: async (sql, params) => { grava(sql, params); return linhasAfetadas; },
        });
        commitou = true;
        return r;
      } catch (e) {
        reverteu = true;
        throw e;
      } finally {
        dentroDeTx = false;
      }
    },
    jsonb: (v) => (v == null ? null : JSON.stringify(v)),
  },
});

const clientes = await import('../clientes.js');

// ─── Arreio ─────────────────────────────────────────────────────────────────
const testes = [];
const ok = (nome, cond, extra = '') => testes.push({ nome, cond: !!cond, extra });

function limpa() {
  emitido = [];
  commitou = false;
  reverteu = false;
  linhasAfetadas = 1;
  resposta = () => [{ id: 'k1' }];
}

const sqls = () => emitido.map(e => e.sql.toLowerCase());
const achaIdx = (re) => sqls().findIndex(s => re.test(s));

async function estoura(fn) {
  try { await fn(); return null; } catch (e) { return e.message; }
}

// ─── excluiCliente ──────────────────────────────────────────────────────────
limpa();
const r = await clientes.excluiCliente('k1');

const iConsultas = achaIdx(/update consultas set/);
const iRascunhos = achaIdx(/update rascunhos set/);
const iDelete = achaIdx(/delete from clientes/);

ok('exclusão: emite os três comandos', iConsultas !== -1 && iRascunhos !== -1 && iDelete !== -1,
  sqls().join(' | '));
ok('exclusão: anonimiza ANTES de apagar o cadastro',
  iConsultas < iDelete && iRascunhos < iDelete);
ok('exclusão: tudo dentro da transação', emitido.every(e => e.dentroDeTx),
  emitido.filter(e => !e.dentroDeTx).map(e => e.sql).join(' | '));
ok('exclusão: commitou', commitou && !reverteu);

const sqlConsultas = emitido[iConsultas].sql.toLowerCase();
ok('exclusão: apaga o NOME da consulta, não só o ponteiro',
  sqlConsultas.includes('client_name = null') && sqlConsultas.includes('client_segment = null'),
  sqlConsultas);
ok('exclusão: desfaz o vínculo também', sqlConsultas.includes('cliente_id = null'));
ok('exclusão: só mexe nas consultas daquele cliente',
  /where cliente_id = \$1/.test(sqlConsultas) && emitido[iConsultas].params[0] === 'k1');
ok('exclusão: NÃO apaga a consulta em si', !sqls().some(s => /delete from consultas/.test(s)),
  'apagou consulta — o dado de negócio tem que sobreviver');
ok('exclusão: devolve quantas foram anonimizadas',
  r.consultasAnonimizadas === 1 && r.rascunhosAnonimizados === 1, JSON.stringify(r));

// Cliente inexistente: o delete não pega ninguém → tem que reverter.
limpa();
linhasAfetadas = 0;
const err = await estoura(() => clientes.excluiCliente('nao-existe'));
ok('exclusão: cliente inexistente estoura', err === 'cliente não encontrado', String(err));
ok('exclusão: e reverte a anonimização junto', reverteu && !commitou,
  'reverteu=' + reverteu + ' commitou=' + commitou);

// ─── vinculaConsulta ────────────────────────────────────────────────────────
limpa();
await clientes.vinculaConsulta('c1', 'k1');
ok('vínculo: confere o cliente antes de gravar',
  achaIdx(/select id from clientes/) < achaIdx(/update consultas set cliente_id/),
  sqls().join(' | '));
ok('vínculo: NÃO sobrescreve o client_name com o nome do cadastro',
  !sqls().some(s => /update consultas set.*client_name =/.test(s)),
  'o nome digitado é o rastro de uma vinculação errada');

limpa();
resposta = () => [];   // cliente não existe
const errV = await estoura(() => clientes.vinculaConsulta('c1', 'fantasma'));
ok('vínculo: cliente inexistente é recusado', errV === 'cliente não encontrado', String(errV));
ok('vínculo: e nada é gravado na consulta',
  !sqls().some(s => /update consultas/.test(s)), sqls().join(' | '));

// ─── Validação de nome ──────────────────────────────────────────────────────
for (const [rotulo, valor] of [['vazio', ''], ['só espaço', '   '], ['ausente', undefined]]) {
  limpa();
  const e1 = await estoura(() => clientes.criaCliente({ nome: valor }));
  ok('criar: nome ' + rotulo + ' é recusado', e1 === 'nome é obrigatório', String(e1));
  ok('criar: nome ' + rotulo + ' não chega no banco', emitido.length === 0);
}

limpa();
const e2 = await estoura(() => clientes.atualizaCliente('k1', { nome: '  ' }));
ok('editar: nome vazio é recusado', e2 === 'nome é obrigatório', String(e2));

// Campos em branco viram null, não string vazia — senão o "tem telefone?" da
// tela passa a dar true pra aspas vazias.
limpa();
await clientes.criaCliente({ nome: '  João Silva  ', telefone: '', email: '   ', notas: null });
ok('criar: apara o nome', emitido[0].params[0] === 'João Silva', JSON.stringify(emitido[0].params));
ok('criar: campos em branco viram null',
  emitido[0].params.slice(1).every(v => v === null), JSON.stringify(emitido[0].params));

// ─── getCliente ─────────────────────────────────────────────────────────────
limpa();
const ficha = await clientes.getCliente('k1');
ok('ficha: traz consultas e rascunhos junto',
  Array.isArray(ficha.consultas) && Array.isArray(ficha.rascunhos));
ok('ficha: as consultas vêm da coluna nova, não do nome',
  sqls().some(s => /from consultas where cliente_id = \$1/.test(s)), sqls().join(' | '));
ok('ficha: não carrega os jsonb pesados na listagem',
  !sqls().some(s => /from consultas/.test(s) && /\bbriefing\b|\btop\b(?!_models)/.test(s)),
  'briefing/top são grandes e a ficha não os mostra');

limpa();
resposta = () => [];
const e3 = await estoura(() => clientes.getCliente('fantasma'));
ok('ficha: id inexistente estoura', e3 === 'cliente não encontrado', String(e3));

// ─── listClientes ───────────────────────────────────────────────────────────
limpa();
await clientes.listClientes();
ok('lista: conta as consultas no próprio SQL (sem N+1)',
  /count\(co\.id\)/.test(sqls()[0]) && /left join consultas/.test(sqls()[0]), sqls()[0]);
ok('lista: left join — cliente sem consulta continua aparecendo',
  /left join/.test(sqls()[0]));

limpa();
await clientes.listClientes({ busca: 'maria' });
ok('lista: busca vai como parâmetro, não interpolada',
  emitido[0].params.includes('%maria%') && !emitido[0].sql.includes('maria'),
  emitido[0].sql);

limpa();
await clientes.listClientes({ busca: '   ' });
ok('lista: busca em branco não vira filtro',
  !emitido[0].sql.toLowerCase().includes('where'), emitido[0].sql);

// ─── Relatório ──────────────────────────────────────────────────────────────
let falhas = 0;
for (const t of testes) {
  if (!t.cond) falhas++;
  console.log((t.cond ? '  ok  ' : ' FALHA ') + t.nome + (t.cond || !t.extra ? '' : '\n         -> ' + t.extra));
}
console.log('\n' + (testes.length - falhas) + '/' + testes.length + ' passaram');
process.exit(falhas ? 1 : 0);

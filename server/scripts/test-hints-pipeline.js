// Teste ponta a ponta dos "lembretes de ranking": um feedback de "senti falta
// do X" muda mesmo a busca seguinte? (Ver o bloco de lembretes em recommend.js.)
//
// Existe porque o efeito depende do COMPORTAMENTO do LLM, não só do código: já
// aconteceu de o carro entrar no prompt e o vendedor ignorar mesmo assim
// (estava em 31º de 32, com o aviso depois de 32 linhas de lista). Trocar de
// modelo ou mexer no VENDOR_SYSTEM pode reintroduzir isso em silêncio, e o
// sintoma seria idêntico ao bug original: o consultor reclama de novo do mesmo
// carro. Este script é o que pega isso.
//
// Substitui SÓ a leitura do banco (não há DATABASE_URL na máquina local); o
// catálogo, os filtros, o curador leve e o vendedor rodam de verdade — então
// gasta chamadas de LLM.
//
// Uso:  node --experimental-test-module-mocks scripts/test-hints-pipeline.js

import 'dotenv/config';
import { mock } from 'node:test';

const TERMO = 'vw - volkswagen golf';

mock.module('../feedback.js', {
  namedExports: {
    listRankingMisses: async () => ([{ termo: TERMO, vezes: 1, ultima: new Date() }]),
  },
});

const { recommend } = await import('../recommend.js');

const casos = [
  {
    nome: 'positivo — Golf passa nos filtros, tem de aparecer',
    briefing: { budget: [60, 130], types: ['hatch'], fuels: ['flex'], yearMin: 2015 },
    esperaGolf: true,
  },
  {
    nome: 'negativo — briefing de SUV: o lembrete não pode vazar',
    briefing: { budget: [80, 160], types: ['suv'], fuels: ['flex'], yearMin: 2018 },
    esperaGolf: false,
  },
];

let falhou = false;
for (const caso of casos) {
  const r = await recommend(caso.briefing);
  const entregues = (r.top || []).map(c => `${c.brand} ${c.model} ${c.year}`);
  const temGolf = entregues.some(m => /golf/i.test(m));
  const ok = temGolf === caso.esperaGolf;
  if (!ok) falhou = true;

  console.log(`\n${ok ? 'PASSOU' : 'FALHOU'} — ${caso.nome}`);
  console.log(`  lembretes no prompt: ${JSON.stringify(r.diagnostico?.lembretes ?? [])}`);
  console.log(`  entregues: ${entregues.join(' · ') || '(nenhum)'}`);
  if (!ok) {
    console.log(`  esperava Golf no top: ${caso.esperaGolf} · veio: ${temGolf}`);
  }
}

console.log(falhou ? '\nAlgum caso falhou.\n' : '\nTodos os casos passaram.\n');
process.exitCode = falhou ? 1 : 0;

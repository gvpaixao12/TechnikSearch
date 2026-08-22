// Diagnóstico dos "lembretes de ranking" — o feedback do consultor voltando
// pro pipeline (ver o bloco de lembretes em recommend.js).
//
// Responde duas perguntas, nesta ordem:
//   1. Que reclamações de ranking o banco tem hoje (últimos 90 dias)?
//   2. Com que entradas do catálogo cada uma delas casa?
//
// A (2) é a que mais erra na prática: o termo vem do autocomplete ("VW -
// VolksWagen Golf") e precisa casar com `marca + modelo` do catálogo. Se casar
// com nada, o lembrete existe no banco e não faz efeito nenhum na busca; se
// casar com o carro errado, empurra o carro errado.
//
// Uso:
//   node scripts/diag-hints.js                 # lê os lembretes do banco
//   node scripts/diag-hints.js --termo=golf    # simula um termo, sem banco
//
// O modo --termo é o que roda na máquina local, onde não há DATABASE_URL: ele
// exercita a mesma função de match usada pelo pipeline, só que com um lembrete
// falso no lugar dos do banco.

import 'dotenv/config';
import { loadCatalog } from '../catalog.js';
import { loadRankingHints, marcaSinalizados } from '../recommend.js';
import { closePool } from '../db.js';

const TERMO_ARG = (process.argv.find(a => a.startsWith('--termo=')) || '').slice('--termo='.length);

// Mesma tokenização de loadRankingHints — aqui é aceitável repetir porque o
// objetivo é justamente simular uma linha do banco que ainda não existe.
function fakeHint(termo) {
  const busca = termo.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const ano = (busca.match(/\b(19|20)\d{2}\b/) || [])[0];
  return { termo, vezes: 1, tokens: busca.split(' ').filter(t => t.length >= 2 && t !== ano) };
}

async function main() {
  const hints = TERMO_ARG ? [fakeHint(TERMO_ARG)] : await loadRankingHints();

  console.log(`\nLembretes ativos: ${hints.length}${TERMO_ARG ? ' (simulado por --termo)' : ''}`);
  if (!hints.length) {
    console.log('Nenhum feedback com causa "vendedor-nao-escolheu" nos últimos 90 dias.');
    console.log('Sem lembrete, a busca roda exatamente como rodava antes.\n');
    return;
  }
  for (const h of hints) {
    console.log(`  · "${h.termo}" — ${h.vezes}x — tokens: [${h.tokens.join(', ')}]`);
  }

  const catalog = await loadCatalog();
  // O pipeline casa contra o POOL (já filtrado pelo briefing). Aqui casamos
  // contra o catálogo inteiro de propósito: mostra o alcance máximo do termo,
  // que é onde se enxerga um lembrete grosso demais.
  const marcadas = marcaSinalizados(catalog.entries, hints);
  console.log(`\nCasam com ${marcadas.size} de ${catalog.entries.length} entradas do catálogo:`);

  const porHint = new Map();
  for (const [entry, hint] of marcadas) {
    (porHint.get(hint) || porHint.set(hint, []).get(hint)).push(entry);
  }
  for (const [hint, entries] of porHint) {
    console.log(`\n  "${hint.termo}" → ${entries.length} entradas`);
    for (const e of entries.slice(0, 8)) {
      console.log(`    ${e.marca} ${e.modelo} ${e.ano} (${e.tipo}, ${e.combustivel}) ${e.precoTexto}`);
    }
    if (entries.length > 8) console.log(`    … +${entries.length - 8}`);
  }
  console.log('');
}

main()
  .catch(e => { console.error('falhou:', e.message); process.exitCode = 1; })
  .finally(() => closePool().catch(() => {}));

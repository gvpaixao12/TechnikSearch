// Reaplica classifyTipo/classifyFuel ao catalog.json que já existe, SEM tocar
// na FIPE. Necessário porque o tipo é gravado no momento do fetch: melhorar uma
// regra em classify.js não conserta, sozinha, as entradas já salvas — elas
// continuam com o tipo antigo até o carro ser rebuscado.
//
// Isso importa mais do que parece: recommend.js:100 exclui do resultado toda
// entrada cujo `tipo` não casa com o pedido. Um carro com tipo 'unknown' é
// INVISÍVEL em qualquer busca que peça um tipo — estava acontecendo com 453
// entradas, entre elas os SUVs da Jaguar.
//
// Uso (de dentro de server/):
//   node scripts/reclassify-catalog.js           # DRY-RUN: mostra o que mudaria
//   node scripts/reclassify-catalog.js --apply   # grava
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTipo, classifyFuel } from '../classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'catalog.json');
const APPLY = process.argv.includes('--apply');

const data = JSON.parse(await fs.readFile(FILE, 'utf8'));
const entries = data.entries || [];

const mudancas = {};
let n = 0;
for (const e of entries) {
  const tipo = classifyTipo(`${e.marca} ${e.modelo}`);
  if (tipo === e.tipo) continue;
  const k = `${e.tipo} → ${tipo}`;
  mudancas[k] = (mudancas[k] || 0) + 1;
  n++;
  if (APPLY) e.tipo = tipo;
}

const unknownAntes = entries.filter(e => e.tipo === 'unknown').length;
console.log(`${entries.length} entries · ${n} mudariam de tipo\n`);
for (const [k, v] of Object.entries(mudancas).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

if (!APPLY) {
  console.log('\nDRY-RUN — nada gravado. Pra aplicar: --apply');
} else {
  data.builtAt = data.builtAt; // preserva: reclassificar não é rebuild
  await fs.writeFile(FILE, JSON.stringify(data, null, 0), 'utf8');
  console.log(`\n${n} entries reclassificadas · unknown agora: ${unknownAntes}`);
  console.log('Rode `--audit` pra conferir a cobertura.');
}

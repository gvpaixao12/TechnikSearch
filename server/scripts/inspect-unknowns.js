/* Lista os modelos classificados como "unknown" no catálogo, agrupados por marca. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'catalog.json');

const raw = await fs.readFile(FILE, 'utf8');
const data = JSON.parse(raw);

const unknowns = data.entries.filter(e => e.tipo === 'unknown');

console.log(`${unknowns.length} entries classificadas como "unknown":\n`);

const byBrand = new Map();
for (const e of unknowns) {
  if (!byBrand.has(e.marca)) byBrand.set(e.marca, new Set());
  byBrand.get(e.marca).add(e.modelo);
}

for (const [marca, modelos] of [...byBrand.entries()].sort()) {
  console.log(`${marca}:`);
  [...modelos].sort().forEach(m => console.log(`  - ${m}`));
  console.log();
}

// Dry run do portão de visão: busca, baixa e valida, sem subir nada pro R2 nem
// escrever no banco — dá pra conferir o que o portão aprova/reprova sem mexer
// no acervo de um carro que está no ar.
//
//   node scripts/diag-visao-dryrun.mjs
//   node scripts/diag-visao-dryrun.mjs "Honda" "Fit EXL 1.5 Flex 16V 5p Aut" 2012
import 'dotenv/config';
import sharp from 'sharp';
import { searchByView } from '../imageProviders.js';
import { validateImages } from '../imageValidator.js';

const marca = process.argv[2] || 'VW - VolksWagen';
const modelo = process.argv[3] || 'Golf 2.0/ 2.0 Mi Flex Comfortline Aut.';
const ano = Number(process.argv[4] || 2009);

const views = ['front', 'side'];
const raw = await searchByView({ marca, modelo, ano, rich: true });

const byView = {};
for (const v of views) {
  const cands = (raw[v] || []).slice(0, 5);
  const out = [];
  for (const im of cands) {
    try {
      const res = await fetch(im.url, { headers: { 'User-Agent': 'Mozilla/5.0 TechnikBot/1.0' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const small = await sharp(buf).rotate().resize({ width: 512, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
      out.push({ ...im, visionUrl: `data:image/webp;base64,${small.toString('base64')}` });
    } catch { /* candidato morto, segue */ }
  }
  byView[v] = out;
  console.log(`\n== ${v}: ${out.length} candidatos`);
  out.forEach((im, i) => console.log(`   ${i + 1}. ${im.url.slice(0, 100)}`));
}

const aprovadas = await validateImages({ marca, modelo, ano, byView });
for (const v of views) {
  const ok = new Set((aprovadas[v] || []).map(im => im.url));
  console.log(`\n== ${v}: ${ok.size}/${byView[v].length} aprovadas`);
  byView[v].forEach((im, i) => console.log(`   ${ok.has(im.url) ? 'APROVADA ' : 'reprovada'} ${i + 1}. ${im.url.slice(0, 100)}`));
}

// Sites de onde vêm as fotos que a revisão apaga — e o bloqueio deles.
// Ver fontes-fotos.js.
//
//   cd server && node scripts/fontes-fotos.js                       # relatório
//   cd server && node scripts/fontes-fotos.js --bloquear=a.com,b.com --motivo="loja de seminovos"
//
// Critério sugerido: bloquear o site com 2+ fotos removidas em carros
// DIFERENTES e quase nada no ar. Site de imprensa ou enciclopédia (bmw.com,
// wikimedia) também aparece no relatório quando uma foto dele é de geração
// errada — esse não se bloqueia.

import 'dotenv/config';
import { relatorio, bloqueia } from '../fontes-fotos.js';

const ARGS = process.argv.slice(2);
const val = nome => ARGS.find(a => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');

async function main() {
  const bloquear = val('bloquear');
  if (bloquear) {
    const motivo = val('motivo') || null;
    for (const d of bloquear.split(',').map(s => s.trim()).filter(Boolean)) {
      await bloqueia(d, motivo);
      console.log(`bloqueado: ${d}${motivo ? ` (${motivo})` : ''}`);
    }
  }
  const linhas = await relatorio();
  if (!linhas.length) { console.log('Nenhuma foto removida registrada ainda.'); return; }
  console.log(`${'domínio'.padEnd(40)} removidas  carros  no ar  bloqueado`);
  for (const r of linhas) {
    const sugere = !r.bloqueado && r.carros >= 2 && r.noAr <= r.removidas / 2 ? '  ← candidato' : '';
    console.log(`${r.dominio.slice(0, 40).padEnd(40)} ${String(r.removidas).padStart(9)}  ${String(r.carros).padStart(6)}  ${String(r.noAr).padStart(5)}  ${r.bloqueado ? 'sim' : '-'}${sugere}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

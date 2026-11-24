// Galeria "vitrine" pros carros que MAIS APARECEM nas consultas: mais fotos por
// vista, mais cores e foto de imprensa (em movimento / cenário / 3/4 dianteiro)
// como capa. Ver vitrineCarImages em imageCache.js — é não-destrutivo: só troca
// a galeria se a nova for >= à atual, e mantém favoritas e manuais.
//
// Frequência = em quantas consultas o carro (marca + modelo FIPE + ano) entrou no
// resultado. Consultas de teste não contam, a não ser as pesquisas modelo (são as
// que vão pra apresentação).
//
//   cd server && node scripts/fotos-vitrine.js --listar             # só mostra o ranking, não gasta nada
//   cd server && node scripts/fotos-vitrine.js --top=10 --calibrar  # busca + visão, NÃO grava (mede o resultado)
//   cd server && node scripts/fotos-vitrine.js --top=30             # roda de verdade
//   cd server && node scripts/fotos-vitrine.js --top=30 --refazer   # inclui os que já são vitrine
//
// Na VPS (1 vCPU servindo o site): nice -n 19 e IMAGE_BUILD_CONCURRENCY=1.

import 'dotenv/config';
import { q as dbq } from '../db.js';
import { vitrineCarImages, makeKey } from '../imageCache.js';
import { isVisionAborted } from '../imageValidator.js';

const ARGS = process.argv.slice(2);
const arg = (nome, padrao) => {
  const a = ARGS.find(x => x.startsWith(`--${nome}=`));
  const n = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : padrao;
};
const TOP = arg('top', 30);
const MIN_APARICOES = arg('min', 2);
const LISTAR = ARGS.includes('--listar');
const CALIBRAR = ARGS.includes('--calibrar');
const REFAZER = ARGS.includes('--refazer');

// Créditos Serper por carro no modo vitrine: frente 3 imprensa + 1-2 principal
// + 6 cores; traseira/lateral/interior 1-2 + 3 cores cada; + reserva por vista
// vazia. ~28 com folga.
const SERPER_POR_CARRO = 28;

async function saldoSerper() {
  try {
    const r = await fetch('https://google.serper.dev/account', {
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY || '' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return (await r.json()).balance ?? null;
  } catch { return null; }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL é obrigatório no .env');
    process.exit(1);
  }

  const ranking = await dbq(
    `select e->>'brand' as marca, e->>'model' as modelo, (e->>'year')::int as ano,
            count(distinct c.id)::int as n
       from consultas c, jsonb_array_elements(c.top) e
      where (not c.teste or c.modelo) and jsonb_typeof(c.top) = 'array'
      group by 1, 2, 3
     having count(distinct c.id) >= $1
      order by n desc, marca, modelo
      limit $2`,
    [MIN_APARICOES, TOP * 3]
  );

  // Estado atual de cada um: já é vitrine? quantas fotos?
  const keys = ranking.map(r => makeKey(r));
  const atual = new Map();
  for (const row of await dbq('select key, images from car_images_cache where key = any($1)', [keys])) {
    atual.set(row.key, Array.isArray(row.images) ? row.images : []);
  }
  const jaVitrine = imgs => imgs.length > 0 && imgs.filter(im => !im.favorite && !im.manual).every(im => im.vitrine);

  const todo = [];
  for (const r of ranking) {
    const imgs = atual.get(makeKey(r)) || [];
    r.fotos = imgs.length;
    r.vitrine = jaVitrine(imgs);
    if (!REFAZER && r.vitrine) continue;
    if (todo.length < TOP) todo.push(r);
  }

  console.log(`[vitrine] ${ranking.length} carros com >= ${MIN_APARICOES} aparições · ${todo.length} na fila (top ${TOP}${REFAZER ? ', refazendo' : ', pulando os já vitrine'})\n`);
  for (const [i, r] of todo.entries()) {
    console.log(`  ${String(i + 1).padStart(3)}. ${String(r.n).padStart(3)}×  ${r.marca} ${r.modelo} ${r.ano}  (${r.fotos} fotos)`);
  }
  if (LISTAR || todo.length === 0) return;

  // Saldo ANTES de gastar (ver memória: varredura já zerou a conta uma vez).
  const saldo = await saldoSerper();
  const precisa = todo.length * SERPER_POR_CARRO;
  console.log(`\n[vitrine] Serper: saldo ${saldo ?? '?'} · estimado ${precisa} créditos`);
  if (saldo == null) { console.error('Não consegui ler o saldo do Serper — abortando.'); process.exit(1); }
  if (saldo < precisa * 1.2) { console.error('Saldo insuficiente pra rodar com folga — reduza --top.'); process.exit(1); }
  console.log('[vitrine] Visão: ~12-16 chamadas gpt-4o-mini por carro (detail low). Saldo da OpenAI não é legível por chave de projeto — confira no painel antes de lotes grandes.\n');

  let stop = false;
  process.on('SIGINT', () => { console.log('\n[vitrine] Ctrl+C, terminando o carro em voo…'); stop = true; });

  const t0 = Date.now();
  let trocou = 0, manteve = 0, falhou = 0, semCapaBoa = [];
  for (const [i, r] of todo.entries()) {
    if (stop || isVisionAborted()) break;
    const nome = `${r.marca} ${r.modelo} ${r.ano}`;
    try {
      const res = await vitrineCarImages({ marca: r.marca, modelo: r.modelo, ano: r.ano, dryRun: CALIBRAR });
      const d = res.depois;
      const linha = `${d.front}F ${d.side}L ${d.rear}T ${d.interior}I · capa ${res.capa ?? '-'}`;
      if (res.trocou) trocou++; else manteve++;
      if ((res.capa ?? 0) < 7) semCapaBoa.push(`${nome} (capa ${res.capa ?? '-'})`);
      console.log(`[${String(i + 1).padStart(3)}/${todo.length}] ${nome.slice(0, 60).padEnd(60)} ${r.fotos}→${linha} · ${res.trocou ? 'TROCOU' : `manteve: ${res.motivo}`}`);
    } catch (e) {
      falhou++;
      console.warn(`[${i + 1}/${todo.length}] ${nome} FALHOU: ${e.message}`);
    }
  }

  const saldoDepois = await saldoSerper();
  console.log('\n' + '═'.repeat(78));
  console.log(`${trocou} trocados · ${manteve} mantidos · ${falhou} falhas · ${Math.round((Date.now() - t0) / 60000)} min`);
  if (saldo != null && saldoDepois != null) console.log(`Serper gasto: ${saldo - saldoDepois} créditos (${((saldo - saldoDepois) / Math.max(1, trocou + manteve)).toFixed(1)}/carro)`);
  if (semCapaBoa.length) {
    console.log(`\nSem foto de imprensa boa pra capa (nota < 7) — vale trocar à mão no CRM:`);
    for (const s of semCapaBoa) console.log(`  - ${s}`);
  }
  if (isVisionAborted()) console.log('⛔ Visão abortada (429/saldo). Rode de novo depois — pula os que já viraram vitrine.');
}

main().catch(e => { console.error('[vitrine] erro fatal:', e); process.exit(1); });

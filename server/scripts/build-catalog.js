/* Build offline do catálogo FIPE.
 * Varre top marcas BR, todos os modelos, anos >= 2018, salva preço + tipo classificado.
 * Saída: server/data/catalog.json
 *
 * Rodar:
 *   node scripts/build-catalog.js --audit              # relatório de cobertura, SEM tocar na FIPE
 *   node scripts/build-catalog.js                      # top marcas BR
 *   node scripts/build-catalog.js --all-brands
 *   node scripts/build-catalog.js --brands=fiat,gm\ -\ chevrolet   # dirigido
 *   FIPE_RATE_MS=4000 FIPE_RETRIES=8 node scripts/build-catalog.js --brands=...
 *
 * Sai com código != 0 se alguma marca ficar incompleta — build torto não passa
 * mais por sucesso. Retomada é automática: o que já está no catalog.json é
 * pulado, então re-rodar dirigido às marcas que falharam é barato.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMarcas, getModelos, getAnos, getPreco } from '../fipe.js';
import { classifyTipo, classifyFuel, isComercial } from '../classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'catalog.json');

const ANO_MIN = 2005;
const ALL_BRANDS = process.argv.includes('--all-brands');
const AUDIT = process.argv.includes('--audit');

// Top marcas vendidas no BR — cobre ~95% do mercado
// Ordem: populares primeiro (menores e mais úteis), premium depois (catálogo grande)
const TOP_BRANDS_ORDERED = [
  // Marcas populares/premium primeiro — VW vai por último por ter 547 modelos
  // e esgotar o rate limit da FIPE antes das outras marcas serem processadas.
  'fiat',
  'gm - chevrolet', 'chevrolet',
  'hyundai', 'toyota', 'honda',
  'jeep', 'renault', 'nissan', 'ford',
  'mitsubishi', 'kia motors', 'kia',
  'caoa chery', 'chery', 'haval', 'gwm', 'byd',
  'peugeot', 'citroen', 'citroën',
  'ram', 'dodge',
  'mini', 'volvo', 'land rover',
  'bmw', 'audi', 'mercedes-benz',
  'porsche', 'lexus', 'jaguar',
  'subaru', 'ssangyong',
  // Premium/exóticas (segmento 1mi+) — catálogos pequenos, ficam no fim
  'ferrari', 'lamborghini', 'mclaren', 'aston martin', 'maserati', 'lotus', 'rolls-royce',
  'vw - volkswagen', 'volkswagen', // por último — muitos modelos, consome rate limit
];
const TOP_BRANDS = new Set(TOP_BRANDS_ORDERED);

// Build direcionado: --brands=porsche,ferrari,... processa só essas marcas
// (casa pelo nome exato em minúsculas da FIPE). Útil pra preencher um segmento
// sem revarrer o catálogo inteiro. Sobrepõe a lista TOP_BRANDS.
const BRANDS_ARG = (process.argv.find(a => a.startsWith('--brands=')) || '').slice('--brands='.length);
const BRANDS_FILTER = BRANDS_ARG
  ? new Set(BRANDS_ARG.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  : null;

// (regras movidas pra ../classify.js — compartilhadas com build-catalog-from-cache.js)

function parsePreco(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isZeroKmCode(code) {
  return String(code).startsWith('32000');
}

function parseAnoFromCode(code) {
  const yearStr = String(code).split('-')[0];
  const y = parseInt(yearStr, 10);
  return Number.isFinite(y) ? y : null;
}

// Rate limiter global. Padrão 1500ms; afrouxa em builds grandes via FIPE_RATE_MS
// (ex.: FIPE_RATE_MS=4000) pra reduzir o risco de ban por volume acumulado.
const RATE_INTERVAL_MS = parseInt(process.env.FIPE_RATE_MS || '', 10) || 1500;
let lastRequestAt = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + RATE_INTERVAL_MS - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function ts() {
  const d = new Date();
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour12: false });
}

// Tentativas por request. 2 era pouco: sob 429 sustentado a marca inteira morria
// na primeira rajada (foi assim que a Chevrolet ficou com 14 entries). Backoff
// exponencial em vez de linear, com jitter — o jitter evita que várias falhas
// sincronizem e voltem a bater na FIPE todas no mesmo instante.
const RETRY_ATTEMPTS = parseInt(process.env.FIPE_RETRIES || '', 10) || 5;
const RETRY_MAX_WAIT_MS = 60000;

async function withRetry(fn, label, attempts = RETRY_ATTEMPTS) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    await rateLimit();
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const is429 = e.message?.includes('429');
      const wait = Math.min((is429 ? 3000 : 1000) * 2 ** i, RETRY_MAX_WAIT_MS)
        + Math.floor(Math.random() * 1000);
      console.warn(`  [${ts()}] [retry ${i + 1}/${attempts}] ${label}: ${e.message}`);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function main() {
  if (AUDIT) return auditar();
  console.log(`Build de catálogo FIPE — ano >= ${ANO_MIN}, ${ALL_BRANDS ? 'TODAS' : 'top BR'} marcas`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const marcas = await getMarcas();
  let marcasFiltered;
  if (BRANDS_FILTER) {
    marcasFiltered = marcas.filter(m => BRANDS_FILTER.has(m.nome.toLowerCase()));
    console.log(`Build direcionado: ${marcasFiltered.map(m => m.nome).join(', ') || '(nenhuma marca casou)'}`);
  } else if (ALL_BRANDS) {
    marcasFiltered = marcas;
  } else {
    // Ordena pela posição em TOP_BRANDS_ORDERED — populares primeiro
    const order = new Map(TOP_BRANDS_ORDERED.map((n, i) => [n, i]));
    marcasFiltered = marcas
      .filter(m => TOP_BRANDS.has(m.nome.toLowerCase()))
      .sort((a, b) => (order.get(a.nome.toLowerCase()) ?? 999) - (order.get(b.nome.toLowerCase()) ?? 999));
  }

  console.log(`${marcasFiltered.length} marcas a processar (de ${marcas.length} totais)\n`);

  // MERGE: carrega catálogo existente (se houver) e indexa por codigoFipe.
  // Cada marca processada faz upsert nas suas entries, preservando outras marcas.
  let catalog = [];
  try {
    const raw = await fs.readFile(OUT_FILE, 'utf8');
    const existing = JSON.parse(raw);
    catalog = existing.entries || [];
    console.log(`✓ catálogo existente carregado: ${catalog.length} entries (preservando ao processar)\n`);
  } catch {
    console.log('(sem catálogo prévio — começando do zero)\n');
  }

  // Índice de entradas já no catálogo — pula getPreco se marcaId|modeloId|anoId já existir.
  // Permite retomada sem repetir requests que já tiveram sucesso.
  const existingKeys = new Set(catalog.map(e => `${e.marcaId}|${e.modeloId}|${e.anoId}`));
  console.log(`  (${existingKeys.size} combinações já indexadas — serão puladas)\n`);

  let modelosTotal = 0, anosTotal = 0, errosTotal = 0, pulados = 0;
  const tipoStats = {};
  // Cobertura por marca. Antes o build terminava "com sucesso" mesmo perdendo
  // uma marca inteira num 429 — o único sinal era um console.warn afogado em
  // milhares de linhas de log. Agora cada marca vira uma linha do relatório
  // final e build incompleto sai com código != 0.
  const brandReport = [];

  // MERGE (upsert, NÃO-destrutivo): nunca remove entries existentes — só insere
  // ou atualiza as buscadas, indexando por marca|modelo|ano. Se um modelo falhar,
  // os carros dele que já estão no catálogo são PRESERVADOS em vez de sumirem.
  const mergeBrand = (brandEntries) => {
    if (!brandEntries.length) return;
    const ukey = e => `${e.marcaId}|${e.modeloId}|${e.anoId}`;
    const byKey = new Map(catalog.map(e => [ukey(e), e]));
    for (const e of brandEntries) byKey.set(ukey(e), e);
    catalog = [...byKey.values()];
  };

  // ANTES o catálogo só era gravado no FIM de cada marca. Uma marca grande leva
  // quase uma hora (Chevrolet tem 556 modelos), então uma interrupção no meio
  // jogava fora todo o trabalho — aconteceu, 47 min e 347 entries perdidos.
  // Agora grava a cada CHECKPOINT_MODELOS modelos: o pior caso passa a ser
  // perder alguns modelos, não a marca inteira.
  const CHECKPOINT_MODELOS = 10;
  const salvar = async (marcasFeitas) => {
    await fs.writeFile(OUT_FILE, JSON.stringify({
      version: 1,
      builtAt: new Date().toISOString(),
      anoMin: ANO_MIN,
      stats: { marcas: marcasFeitas, modelos: modelosTotal, anos: anosTotal, entries: catalog.length, erros: errosTotal, tipos: tipoStats },
      entries: catalog,
    }, null, 0), 'utf8');
  };

  // Disjuntor. A FIPE bloqueia por VOLUME acumulado, não por velocidade: medido
  // em campo, o bloqueio veio depois de ~500 requests mesmo com 2,5s de intervalo,
  // e a partir dali NADA mais passou. Insistir não recupera nada e provavelmente
  // prolonga o bloqueio. Quando N modelos seguidos falham inteiros, para limpo —
  // com o progresso salvo — pra retomar noutra sessão.
  const ABORT_AFTER_FAILS = parseInt(process.env.FIPE_ABORT_AFTER || '', 10) || 5;
  let bloqueado = false;

  for (let mi = 0; mi < marcasFiltered.length && !bloqueado; mi++) {
    const marca = marcasFiltered[mi];
    console.log(`[${ts()}] [${mi + 1}/${marcasFiltered.length}] ${marca.nome}`);
    const errosAntes = errosTotal;

    let modelos;
    try {
      modelos = await withRetry(() => getModelos(marca.codigo), `getModelos ${marca.nome}`);
    } catch (e) {
      console.warn(`  [${ts()}] ⚠ falha definitiva em modelos: ${e.message}`);
      errosTotal++;
      brandReport.push({ marca: marca.nome, status: 'FALHOU', modelos: 0, entries: 0, erros: 1 });
      continue;
    }
    modelosTotal += modelos.length;

    // Coleta entries dessa marca em variável separada — depois faz merge no catalog
    const brandEntries = [];

    // Sequencial — o rate limiter global garante ~3 req/s
    const BATCH = 1;
    let falhasSeguidas = 0;
    for (let bi = 0; bi < modelos.length; bi += BATCH) {
      const slice = modelos.slice(bi, bi + BATCH);
      const results = await Promise.all(slice.map(async md => {
        // Pula comercial (caminhão/ônibus/furgão) — fora do escopo. Skip aqui
        // economiza getAnos + getPreco do modelo inteiro.
        if (isComercial(`${marca.nome} ${md.nome}`)) return [];
        let anos;
        try {
          anos = await withRetry(() => getAnos(marca.codigo, md.codigo), `getAnos ${marca.nome}/${md.nome}`);
          falhasSeguidas = 0;
        } catch { errosTotal++; falhasSeguidas++; return []; }

        const anosUsados = anos
          .filter(a => !isZeroKmCode(a.codigo))
          .map(a => ({ ...a, year: parseAnoFromCode(a.codigo) }))
          .filter(a => a.year !== null && a.year >= ANO_MIN);

        const entries = [];
        for (const ano of anosUsados) {
          // Pula se já temos esse modelo/ano no catálogo (retomada)
          if (existingKeys.has(`${marca.codigo}|${md.codigo}|${ano.codigo}`)) {
            const cached = catalog.find(e => e.marcaId === marca.codigo && e.modeloId === md.codigo && e.anoId === ano.codigo);
            if (cached) { entries.push(cached); pulados++; continue; }
          }
          let preco;
          try {
            preco = await withRetry(() => getPreco(marca.codigo, md.codigo, ano.codigo), `getPreco ${marca.nome}/${md.nome}/${ano.nome}`);
          } catch { errosTotal++; continue; }
          const tipo = classifyTipo(`${marca.nome} ${md.nome}`);
          const combustivel = classifyFuel(`${marca.nome} ${md.nome}`, preco.Combustivel);
          tipoStats[tipo] = (tipoStats[tipo] || 0) + 1;
          entries.push({
            marca: marca.nome,
            modelo: md.nome,
            ano: ano.year,
            tipo,
            combustivel,
            preco: parsePreco(preco.Valor),
            precoTexto: preco.Valor,
            codigoFipe: preco.CodigoFipe,
            marcaId: marca.codigo,
            modeloId: md.codigo,
            anoId: ano.codigo,
            mesReferencia: preco.MesReferencia,
          });
        }
        anosTotal += anosUsados.length;
        return entries;
      }));
      results.forEach(entries => brandEntries.push(...entries));

      // Checkpoint: funde o que já foi coletado no catálogo e grava em disco.
      // Fazer isso a cada CHECKPOINT_MODELOS é o que impede que uma interrupção
      // jogue a marca inteira fora. mergeBrand é idempotente (upsert por chave),
      // então re-fundir o mesmo brandEntries a cada checkpoint é inofensivo.
      const feitos = Math.min(bi + BATCH, modelos.length);
      if (feitos % CHECKPOINT_MODELOS === 0 || feitos >= modelos.length) {
        mergeBrand(brandEntries);
        await salvar(mi);
        const cur = slice[slice.length - 1];
        console.log(`    [${ts()}] ${feitos}/${modelos.length} modelos · modelo atual: ${cur.nome} · +${brandEntries.length} entries (cat total: ${catalog.length}) ✔salvo`);
      }

      if (falhasSeguidas >= ABORT_AFTER_FAILS) {
        bloqueado = true;
        console.error(`\n  ⛔ [${ts()}] ${falhasSeguidas} modelos seguidos falharam por completo — a FIPE bloqueou o IP.`);
        console.error(`     Parando aqui. O progresso até ${feitos}/${modelos.length} modelos está salvo.`);
        console.error(`     Retome mais tarde (horas) com: --brands=${marca.nome.toLowerCase()}`);
        break;
      }
    }

    // Fecha a marca. O merge e a gravação já aconteceram nos checkpoints; isto
    // aqui só garante o estado final caso o último lote não tenha caído num
    // múltiplo de CHECKPOINT_MODELOS. Pra um rebuild limpo do zero, apague o
    // catalog.json antes de rodar.
    mergeBrand(brandEntries);
    await salvar(mi + 1);

    const errosMarca = errosTotal - errosAntes;
    brandReport.push({
      marca: marca.nome,
      status: bloqueado ? 'BLOQUEADO' : errosMarca > 0 ? 'PARCIAL' : 'ok',
      modelos: modelos.length,
      entries: brandEntries.length,
      erros: errosMarca,
    });
  }

  console.log('\n══════════════════════════════════════');
  console.log('Catálogo finalizado:');
  console.log(`  ${catalog.length} entries`);
  console.log(`  ${modelosTotal} modelos consultados`);
  console.log(`  ${anosTotal} anos consultados`);
  console.log(`  ${errosTotal} erros`);
  console.log(`  ${pulados} pulados (já estavam no catálogo)`);
  console.log('  tipos:', tipoStats);
  console.log(`  arquivo: ${OUT_FILE}`);

  // Ordenado do menor pro maior: marca popular no topo da lista é o sinal de
  // build truncado. É o relatório que faltava — sem ele, "3473 entries, 0 erros"
  // passava por sucesso com a Chevrolet em 14.
  console.log('\n═══ COBERTURA POR MARCA (desta rodada) ═══');
  for (const b of [...brandReport].sort((x, y) => x.entries - y.entries)) {
    const flag = b.status === 'FALHOU' ? '✗' : b.status === 'BLOQUEADO' ? '⛔' : b.status === 'PARCIAL' ? '!' : ' ';
    const erros = b.erros ? `${String(b.erros).padStart(4)} erros` : '          ';
    console.log(`  ${flag} ${String(b.entries).padStart(5)} entries ${String(b.modelos).padStart(4)} modelos ${erros}  ${b.marca}`);
  }

  if (bloqueado) {
    console.log('\n⛔ BUILD INTERROMPIDO: a FIPE bloqueou o IP por volume acumulado.');
    console.log('   O progresso está salvo — retome daqui a algumas horas, dirigido');
    console.log('   às marcas que faltam. O bloqueio não é por velocidade: afrouxar');
    console.log('   FIPE_RATE_MS não evita, é preciso espaçar as SESSÕES.');
    process.exitCode = 1;
  }

  const falhas = brandReport.filter(b => b.status === 'FALHOU');
  const parciais = brandReport.filter(b => b.status === 'PARCIAL');
  if (falhas.length || parciais.length) {
    console.log(`\n⚠ BUILD INCOMPLETO: ${falhas.length} marca(s) perdida(s), ${parciais.length} parcial(is).`);
    if (falhas.length) console.log(`  perdidas: ${falhas.map(b => b.marca).join(', ')}`);
    console.log(`  Re-rode dirigido: --brands=${[...falhas, ...parciais].map(b => b.marca.toLowerCase()).join(',')}`);
    console.log(`  (a retomada pula tudo que já deu certo — não refaz o catálogo inteiro)`);
    process.exitCode = 1;
  } else {
    console.log('\n✓ todas as marcas processadas sem erro.');
  }
}

// --audit: relatório de cobertura do catálogo QUE JÁ EXISTE, sem tocar na FIPE.
// Serve pra enxergar o desequilíbrio a qualquer momento — inclusive na VPS —
// com risco zero de ban. Foi o que revelou Porsche com 714 entries e a
// Chevrolet com 14.
async function auditar() {
  const data = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  const entries = data.entries || [];
  const porMarca = new Map();
  for (const e of entries) {
    const cur = porMarca.get(e.marca) || { marca: e.marca, entries: 0, modelos: new Set(), nameplates: new Set() };
    cur.entries++;
    cur.modelos.add(e.modelo);
    // Nameplate = primeira palavra do modelo FIPE ("GOLF Comfortline 1.4 TSI"
    // vira "GOLF"). Grosseiro, mas separa "temos Golf" de "temos 14 anos do
    // mesmo Golf" — e e essa a pergunta que o usuario faz.
    cur.nameplates.add(String(e.modelo).trim().split(/[\s\/]+/)[0].toUpperCase());
    porMarca.set(e.marca, cur);
  }
  const rows = [...porMarca.values()].sort((a, b) => a.nameplates.size - b.nameplates.size);
  console.log(`Catálogo: ${entries.length} entries · ${rows.length} marcas · buildado em ${data.builtAt}\n`);
  // ATENCAO: `entries` engana como medida de cobertura — conta variacao de ano
  // e acabamento, nao carro diferente. A VW aparecia com 583 entries (2a maior)
  // tendo so 8 nameplates: era Gol/Fox/Golf multiplicados por 14 anos. Ordenar
  // por NAMEPLATE e o que revela o buraco real.
  console.log('  nameplates  modelos  entries  marca');
  for (const r of rows) {
    console.log(`  ${String(r.nameplates.size).padStart(10)}  ${String(r.modelos.size).padStart(7)}  ${String(r.entries).padStart(7)}  ${r.marca}`);
  }
  const presentes = new Set([...porMarca.keys()].map(m => m.toLowerCase()));
  const ausentes = TOP_BRANDS_ORDERED.filter(n => !presentes.has(n));
  if (ausentes.length) {
    console.log(`\n⚠ da lista TOP_BRANDS, sem NENHUMA entry: ${ausentes.join(', ')}`);
    console.log('  (alguns são só nome alternativo da mesma marca na FIPE — confira antes de sair rodando)');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

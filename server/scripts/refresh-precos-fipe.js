// Atualiza o PREÇO das entradas do catalog.json direto na fonte oficial
// (veiculos.fipe.org.br), sem passar pela Parallelum.
//
// Por que a fonte oficial: a Parallelum só repassa esses dados e limita o IP
// anônimo a ~500 req/dia — atualizar 4,5 mil preços por lá levaria ~10 dias.
// Aqui a consulta é 1 requisição por entrada, pelo codigoFipe + ano + combustível
// que o catálogo já guarda (Parallelum precisava de marca→modelo→ano).
//
// O endpoint é o que a própria página de consulta da FIPE usa — não é API
// pública documentada. Por isso o script é conservador:
//   - 1 req/s por padrão (FIPE_OFICIAL_RATE_MS)
//   - para na PRIMEIRA resposta anormal (HTTP != 200, corpo não-JSON) e salva
//   - retomável: pula entradas que já estão no mês da tabela atual
//   - --limit=N pra rodar em lotes
//
// Uso (de dentro de server/):
//   node scripts/refresh-precos-fipe.js              # DRY-RUN: só conta o que faria
//   node scripts/refresh-precos-fipe.js --apply      # atualiza e grava
//   node scripts/refresh-precos-fipe.js --apply --limit=500
//   node scripts/refresh-precos-fipe.js --apply --overlay   # grava em data/precos-fipe.json
//     (modo da VPS: não toca no catalog.json versionado — ver precos-overlay.js)
import fs from 'node:fs/promises';
import path from 'node:path';
import { lerOverlay, gravarOverlay, aplicaOverlay, chavePreco } from '../precos-overlay.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'catalog.json');
const APPLY = process.argv.includes('--apply');
const OVERLAY = process.argv.includes('--overlay');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').slice(8), 10) || Infinity;
const RATE_MS = parseInt(process.env.FIPE_OFICIAL_RATE_MS || '', 10) || 1000;
const SALVA_A_CADA = 100;
// Sequência de "não encontrado" seguidos que indica problema sistemático
// (parâmetro errado, endpoint mudou), não carro que saiu da tabela.
const MAX_NAO_ACHADOS_SEGUIDOS = 25;

const BASE = 'https://veiculos.fipe.org.br/api/veiculos';
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Referer': 'https://veiculos.fipe.org.br/',
  'Origin': 'https://veiculos.fipe.org.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'X-Requested-With': 'XMLHttpRequest',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('pt-BR');

class Anormal extends Error {}

async function post(endpoint, params) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST', headers: HEADERS, body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Anormal(`HTTP ${res.status}: ${text.slice(0, 150)}`);
  try { return JSON.parse(text); } catch { throw new Anormal(`corpo não-JSON: ${text.slice(0, 150)}`); }
}

function parsePreco(s) {
  const n = parseFloat(String(s).replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const data = JSON.parse(await fs.readFile(FILE, 'utf8'));
const entries = data.entries || [];

const tabelas = await post('ConsultarTabelaDeReferencia', {});
const tabela = tabelas[0];
// "novembro/2026 " → "novembro de 2026", o formato que o catálogo já usa
const mesAtual = tabela.Mes.trim().replace('/', ' de ');
console.log(`Tabela FIPE atual: ${mesAtual} (código ${tabela.Codigo})`);

// No modo overlay, o que já foi atualizado em rodada anterior (e está no
// overlay) conta como feito — é isso que torna a rodada da VPS retomável.
const overlay = OVERLAY ? await lerOverlay() : null;
if (overlay) aplicaOverlay(entries, overlay);
const pendentes = entries.filter(e => e.codigoFipe && e.anoId && e.mesReferencia !== mesAtual);
console.log(`${entries.length} entradas · ${entries.length - pendentes.length} já em ${mesAtual} · ${pendentes.length} pendentes`);
if (!APPLY) {
  console.log(`DRY-RUN. Com --apply: ${Math.min(LIMIT, pendentes.length)} consultas, ~${Math.ceil(Math.min(LIMIT, pendentes.length) * RATE_MS / 60000)} min.`);
  process.exit(0);
}

const salvar = () => overlay
  ? gravarOverlay({ ...overlay, mesReferencia: mesAtual, atualizadoEm: new Date().toISOString() })
  : fs.writeFile(FILE, JSON.stringify(data), 'utf8');

let feitas = 0, atualizadas = 0, naoAchados = 0, naoAchadosSeguidos = 0, motivoParada = null;
const variacoes = [];
for (const e of pendentes) {
  if (feitas >= LIMIT) { motivoParada = `--limit=${LIMIT}`; break; }
  const [ano, comb] = String(e.anoId).split('-');
  let r;
  try {
    r = await post('ConsultarValorComTodosParametros', {
      codigoTabelaReferencia: tabela.Codigo,
      codigoTipoVeiculo: 1,
      anoModelo: ano,
      codigoTipoCombustivel: comb,
      tipoVeiculo: 'carro',
      modeloCodigoExterno: e.codigoFipe,
      tipoConsulta: 'codigo',
    });
  } catch (err) {
    motivoParada = `resposta anormal em ${e.codigoFipe} ${e.anoId}: ${err.message}`;
    break;
  }
  feitas++;

  const preco = r && r.Valor ? parsePreco(r.Valor) : null;
  if (!preco) {
    // {"codigo":"0","erro":"nadaencontrado"} — o carro/ano saiu da tabela atual.
    // Fica com o preço antigo (o selo de mês na tela mostra que é antigo).
    naoAchados++; naoAchadosSeguidos++;
    if (naoAchadosSeguidos >= MAX_NAO_ACHADOS_SEGUIDOS) {
      motivoParada = `${naoAchadosSeguidos} "não encontrado" seguidos — último: ${JSON.stringify(r).slice(0, 150)}`;
      break;
    }
  } else {
    naoAchadosSeguidos = 0;
    if (e.preco) variacoes.push((preco - e.preco) / e.preco);
    e.preco = preco;
    e.precoTexto = r.Valor.trim();
    e.mesReferencia = (r.MesReferencia || mesAtual).trim();
    if (overlay) {
      overlay.precos = overlay.precos || {};
      overlay.precos[chavePreco(e)] = { preco: e.preco, precoTexto: e.precoTexto, mesReferencia: e.mesReferencia };
    }
    atualizadas++;
  }

  if (feitas % SALVA_A_CADA === 0) {
    await salvar();
    console.log(`  [${ts()}] ${feitas}/${Math.min(LIMIT, pendentes.length)} · ${atualizadas} atualizadas · ${naoAchados} não encontradas ✔salvo`);
  }
  await sleep(RATE_MS);
}

// mesCompleto = o agendador não precisa mais rodar neste mês. Só marca quando
// a rodada passou por todas as pendentes (parada no meio = retoma depois).
if (overlay && !motivoParada) overlay.mesCompleto = mesAtual;
await salvar();
variacoes.sort((a, b) => a - b);
const pct = x => (x * 100).toFixed(1) + '%';
console.log(`\n${feitas} consultas · ${atualizadas} atualizadas · ${naoAchados} não encontradas na tabela atual`);
if (variacoes.length) {
  console.log(`variação de preço: mediana ${pct(variacoes[variacoes.length >> 1])} · min ${pct(variacoes[0])} · max ${pct(variacoes[variacoes.length - 1])}`);
}
if (motivoParada) {
  console.log(`PAROU: ${motivoParada}`);
  console.log('Progresso salvo — rode de novo pra continuar de onde parou.');
  process.exit(motivoParada.startsWith('--limit') ? 0 : 2);
}
console.log('Concluído.');

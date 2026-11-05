// Cliente da fonte OFICIAL (veiculos.fipe.org.br) com a mesma interface de
// fipe.js (getMarcas/getModelos/getAnos/getPreco) e o mesmo formato de retorno,
// pra o build-catalog.js trocar de fonte sem mudar mais nada.
//
// Os códigos de marca, modelo e ano são os mesmos da Parallelum (ela só repassa
// esta fonte), então entradas já no catálogo continuam sendo reconhecidas na
// retomada.
//
// Não é API pública documentada: é o que a página de consulta usa. O Cloudflare
// barra rajadas (~140 req seguidas a 1 req/s → 429 "Just a moment", libera em
// ~1 min). A 3 s/req rodou 4 mil consultas sem bloqueio. Ver
// scripts/refresh-precos-fipe.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache', 'oficial');
const BASE = 'https://veiculos.fipe.org.br/api/veiculos';
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Referer': 'https://veiculos.fipe.org.br/',
  'Origin': 'https://veiculos.fipe.org.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'X-Requested-With': 'XMLHttpRequest',
};
const TIPO_CARRO = 1;

const TTL = {
  tabela: 6 * 60 * 60 * 1000,
  marcas: 7 * 24 * 60 * 60 * 1000,
  modelos: 7 * 24 * 60 * 60 * 1000,
  anos: 24 * 60 * 60 * 1000,
  preco: 6 * 60 * 60 * 1000,
};

async function readCache(file, ttl) {
  try {
    const { savedAt, data } = JSON.parse(await fs.readFile(path.join(CACHE_DIR, file), 'utf8'));
    return Date.now() - savedAt < ttl ? data : null;
  } catch { return null; }
}

async function writeCache(file, data) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, file), JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
}

async function post(endpoint, params) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST', headers: HEADERS, body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  // A mensagem carrega "429" pro withRetry do build reconhecer como bloqueio.
  if (!res.ok) throw new Error(`FIPE oficial ${res.status} em ${endpoint}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`FIPE oficial: corpo não-JSON em ${endpoint}`); }
  // {"codigo":"0","erro":"nadaencontrado"} e afins
  if (json && !Array.isArray(json) && json.erro) throw new Error(`FIPE oficial: ${json.erro} em ${endpoint}`);
  return json;
}

async function cached(file, ttl, fn) {
  const hit = await readCache(file, ttl);
  if (hit) return hit;
  const data = await fn();
  await writeCache(file, data);
  return data;
}

// Tabela de referência = mês. Sempre a mais recente.
function getTabela() {
  return cached('tabela.json', TTL.tabela, async () => (await post('ConsultarTabelaDeReferencia', {}))[0].Codigo);
}

export async function getMarcas() {
  const tabela = await getTabela();
  return cached('marcas.json', TTL.marcas, async () =>
    (await post('ConsultarMarcas', { codigoTabelaReferencia: tabela, codigoTipoVeiculo: TIPO_CARRO }))
      .map(m => ({ codigo: String(m.Value), nome: m.Label })));
}

export async function getModelos(marcaId) {
  const tabela = await getTabela();
  return cached(`modelos-${marcaId}.json`, TTL.modelos, async () =>
    (await post('ConsultarModelos', { codigoTabelaReferencia: tabela, codigoTipoVeiculo: TIPO_CARRO, codigoMarca: marcaId }))
      .Modelos.map(m => ({ codigo: Number(m.Value), nome: m.Label })));
}

export async function getAnos(marcaId, modeloId) {
  const tabela = await getTabela();
  return cached(`anos-${marcaId}-${modeloId}.json`, TTL.anos, async () =>
    (await post('ConsultarAnoModelo', {
      codigoTabelaReferencia: tabela, codigoTipoVeiculo: TIPO_CARRO,
      codigoMarca: marcaId, codigoModelo: modeloId,
    })).map(a => ({ codigo: String(a.Value), nome: a.Label })));
}

export async function getPreco(marcaId, modeloId, anoId) {
  const tabela = await getTabela();
  const [ano, comb] = String(anoId).split('-');
  const safe = String(anoId).replace(/[^\w-]/g, '_');
  return cached(`preco-${marcaId}-${modeloId}-${safe}.json`, TTL.preco, async () => {
    const r = await post('ConsultarValorComTodosParametros', {
      codigoTabelaReferencia: tabela, codigoTipoVeiculo: TIPO_CARRO,
      codigoMarca: marcaId, codigoModelo: modeloId,
      anoModelo: ano, codigoTipoCombustivel: comb, tipoConsulta: 'tradicional',
    });
    // Mesmo formato da Parallelum (Valor, Combustivel, CodigoFipe, MesReferencia…)
    return { ...r, MesReferencia: String(r.MesReferencia || '').trim() };
  });
}

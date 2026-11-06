// Validador de imagens via Vision LLM (Groq). Recebe candidatos por view e
// devolve até 2 fotos APROVADAS por view. Filosofia "honestidade > generosidade":
// se o LLM duvida ou a chamada falha, descarta — melhor zero foto que foto errada.

import OpenAI from 'openai';
import { classifyTipo, extractTrim } from './classify.js';
import { registraLLM, registraRateLimit } from './usage.js';

// Provedor de visão. Default: reaproveita a conta OpenAI do texto (LLM_API_KEY)
// com gpt-4o-mini — confiável, sem teto diário (TPD) e bom em ler volante/placa.
// Override explícito via VISION_API_KEY / VISION_BASE_URL / VISION_MODEL.
// Fallback Groq (Llama 4 Scout) só se nenhuma chave OpenAI estiver setada.
const VISION_API_KEY = process.env.VISION_API_KEY || process.env.LLM_API_KEY || process.env.GROQ_VISION_API_KEY || process.env.GROQ_API_KEY;
const USE_OPENAI_VISION = !!(process.env.VISION_API_KEY || process.env.LLM_API_KEY);
const VISION_BASE_URL = process.env.VISION_BASE_URL || (USE_OPENAI_VISION ? 'https://api.openai.com/v1' : 'https://api.groq.com/openai/v1');
const VISION_MODEL = process.env.VISION_MODEL || process.env.GROQ_VISION_MODEL || (USE_OPENAI_VISION ? 'gpt-4o-mini' : 'meta-llama/llama-4-scout-17b-16e-instruct');
console.log(`[validator] visão via ${VISION_BASE_URL} · model=${VISION_MODEL}`);

// Se bater TPD (500k tokens/dia), marca pra cortar curto as próximas chamadas
// na mesma sessão. Reseta quando o processo reiniciar (ou TTL_FAILED expirar
// no Supabase, o que vier antes).
let _tpdExhaustedUntil = 0;
export function isTpdExhausted() { return Date.now() < _tpdExhaustedUntil; }
function markTpdExhausted(seconds) {
  const ms = Math.max(seconds, 60) * 1000;
  _tpdExhaustedUntil = Date.now() + ms;
  console.warn(`[validator] TPD esgotado por ${Math.round(ms/60000)} min — pulando validações até reset`);
}

// Disjuntor: se o rate limit virar uma parede (N chamadas 429 SEGUIDAS, sem
// nenhum sucesso no meio), aborta de vez — não adianta martelar a noite toda
// gerando carro com 0 foto. Qualquer chamada bem-sucedida zera o contador. O
// passe de background checa isVisionAborted() e para o pool. Tunável por env.
const ABORT_AFTER_429 = Number(process.env.VISION_ABORT_AFTER) || 10;
let _consec429 = 0;
let _visionAborted = false;
export function isVisionAborted() { return _visionAborted; }

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!VISION_API_KEY) throw new Error('Nenhuma chave de visão no .env (LLM_API_KEY/VISION_API_KEY/GROQ_API_KEY)');
  _client = new OpenAI({ apiKey: VISION_API_KEY, baseURL: VISION_BASE_URL });
  return _client;
}

// Teto GLOBAL de chamadas de visão simultâneas. Desacopla do nº de builds e de
// views em paralelo — sem isso, builds×4 views estouram o TPM da conta (200k
// tokens/min no tier 1 da OpenAI) e as views desistem com 429. Cada chamada
// gasta ~2.2k tokens; com 2 em voo e a latência do LLM, fica ~90k/min, dentro do
// teto. Suba VISION_CONCURRENCY se o tier da conta for maior.
// Orçamento de TOKENS por minuto reservado à visão.
//
// O teto de TPM é DA CONTA, compartilhado com o LLM de texto da recomendação —
// e foi assim que uma consulta de 1.512 tokens levou 429 enquanto o pipeline de
// fotos torrava 200.000/min. Limitar chamadas simultâneas não bastava porque o
// custo por chamada estava subestimado em ~6x: o gpt-4o-mini cobra imagem num
// multiplicador alto, e são MAX_IMAGES_PER_CALL imagens por chamada.
//
// Aqui a visão fica com uma fatia e o resto é folga pra busca do usuário passar.
// O consumo real vem do `usage` da resposta, então a estimativa se autocorrige.
const VISION_TPM_BUDGET = Number(process.env.VISION_TPM_BUDGET) || 120_000;
let _tokenEstimate = 15_000;          // por chamada; ajustado pelo usage real
const _tokenLog = [];                 // [{ t, tokens }] da última janela de 60s

function _tokensNaJanela() {
  const corte = Date.now() - 60_000;
  while (_tokenLog.length && _tokenLog[0].t < corte) _tokenLog.shift();
  return _tokenLog.reduce((s, e) => s + e.tokens, 0);
}

// Segura a chamada até caber no orçamento. Sem isso o 429 vira a forma normal
// de descobrir que passou do limite — e quem paga é a recomendação.
async function aguardaOrcamento() {
  let avisou = false;
  for (let i = 0; i < 60; i++) {
    const usados = _tokensNaJanela();
    if (usados + _tokenEstimate <= VISION_TPM_BUDGET) {
      if (avisou) console.log(`[validator] orçamento liberou (${usados} tokens na janela)`);
      return _reserva();
    }
    if (!avisou) {
      console.log(`[validator] segurando visão: ${usados}/${VISION_TPM_BUDGET} tokens no último minuto (est. ${_tokenEstimate}/chamada)`);
      avisou = true;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return _reserva();
  console.warn('[validator] orçamento de TPM não liberou em 2min — seguindo mesmo assim');
}

// Reserva o custo ESTIMADO no instante em que a chamada e liberada. Sem isso,
// N chamadas concorrentes olham a mesma janela "vazia" e entram todas juntas —
// medido em campo: 165k consumidos num orcamento de 120k. A reserva e
// reconciliada com o consumo real quando a resposta volta.
function _reserva() {
  const e = { t: Date.now(), tokens: _tokenEstimate };
  _tokenLog.push(e);
  return e;
}

function _registraUso(reserva, tokens) {
  if (!tokens) return;                       // falhou: mantem a reserva estimada
  if (reserva) reserva.tokens = tokens;      // reconcilia com o real
  else _tokenLog.push({ t: Date.now(), tokens });
  _tokenEstimate = Math.round(_tokenEstimate * 0.7 + tokens * 0.3);
}

const VISION_CONCURRENCY = Number(process.env.VISION_CONCURRENCY) || 2;
let _activeVision = 0;
const _visionWaiters = [];
function acquireVision() {
  if (_activeVision < VISION_CONCURRENCY) { _activeVision++; return Promise.resolve(); }
  return new Promise(resolve => _visionWaiters.push(resolve));
}
function releaseVision() {
  _activeVision--;
  const next = _visionWaiters.shift();
  if (next) { _activeVision++; next(); }
}

const VIEW_LABEL = {
  front: 'frente (vista frontal externa)',
  rear: 'traseira (vista traseira externa)',
  side: 'lateral (perfil do carro de lado)',
  interior: 'interior (painel, console ou bancos)',
};

// Carroceria alvo, vinda do catálogo (classifyTipo) e não do LLM. Vira critério
// de REPROVAÇÃO no prompt: sem ela um sedã passou como "lateral" de um Golf — o
// prompt falava de marca, modelo e geração, mas nunca do formato do carro.
const BODY_LABEL = {
  hatch: { nome: 'hatch (hatchback)', desc: 'traseira curta, SEM porta-malas saliente; o vidro traseiro termina logo acima da tampa' },
  sedan: { nome: 'sedã', desc: 'três volumes, porta-malas saliente e separado do vidro traseiro' },
  suv: { nome: 'SUV / crossover', desc: 'carroceria alta, boa altura livre do solo, traseira reta' },
  pickup: { nome: 'picape', desc: 'cabine + caçamba aberta atrás' },
  // Sem contagem de portas de propósito: o catálogo marca como cupê tanto o
  // 911 de 2 portas quanto o CLA "cupê de 4 portas", e "duas portas" reprovaria
  // o CLA inteiro.
  coupe: { nome: 'cupê / esportivo', desc: 'teto baixo e caído, silhueta esportiva — pode ter 2 ou 4 portas' },
  minivan: { nome: 'minivan / monovolume', desc: 'teto alto e comprido, três fileiras, perfil de van' },
  perua: { nome: 'perua / station wagon', desc: 'frente de hatch ou sedã com o teto reto prolongado até a traseira, tampa traseira quase vertical' },
};

// Tolerância do portão de ano. O ano-modelo da FIPE costuma ser o ano de
// produção + 1, e um facelift no meio da geração faz o LLM devolver a fase em
// vez da geração inteira. Um ano de folga de cada lado absorve os dois casos
// sem deixar passar a geração errada — essa erra por 5+ anos, não por 1.
const ANO_TOLERANCIA = 1;

// Lê o veredito POR FOTO e aplica em código o que não dá pra confiar ao LLM: o
// portão de ano (a geração que ele declarou tem que conter o ano alvo) e a
// diversidade de cor na seleção final. Antes as duas coisas eram pedidas no
// prompt como "escolha as melhores N", e o modelo tratava a resposta como um
// ranking a preencher em vez de um julgamento foto a foto — foi assim que um
// sedã entrou na lateral de um hatch.
function _selecionaAprovadas(text, images, cap, ano, view) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }

  // Formato antigo ({"aprovadas":[1,3]}) ainda aceito: se o modelo ignorar o
  // schema novo, cair no comportamento de antes é melhor que zerar a galeria.
  if (!Array.isArray(json.fotos) && Array.isArray(json.aprovadas)) {
    return json.aprovadas
      .map(n => Number(n) - 1)
      .filter(i => Number.isInteger(i) && i >= 0 && i < images.length)
      .slice(0, cap);
  }

  const vistos = new Set();
  const ok = [];
  for (const v of (Array.isArray(json.fotos) ? json.fotos : [])) {
    const i = Number(v?.n) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= images.length) continue;
    if (v.ok !== true || vistos.has(i)) continue;
    // Portão de ano. Sem os anos (o modelo omitiu o campo) vale o veredito
    // dele — não dá pra zerar a galeria por causa de um campo faltando.
    const [ini, fim] = Array.isArray(v.anos) ? v.anos.map(Number) : [];
    if (Number.isFinite(ini) && Number.isFinite(fim)
        && (ano < ini - ANO_TOLERANCIA || ano > fim + ANO_TOLERANCIA)) {
      console.log(`[validator] ${view} #${v.n}: geração ${ini}-${fim} não cobre ${ano} — reprovada`);
      continue;
    }
    vistos.add(i);
    ok.push({ i, nota: Number(v.nota) || 0, cor: String(v.cor || '').toLowerCase().trim() });
  }

  ok.sort((a, b) => b.nota - a.nota);

  // Diversidade de cor: a primeira passada só aceita cor inédita, a segunda
  // completa a cota. Com veredito por foto o LLM não escolhe mais nada, então a
  // variedade que ele fazia ("prefira 2-3 cores distintas") sai daqui.
  const out = [];
  const cores = new Set();
  for (const e of ok) {
    if (out.length >= cap) break;
    if (e.cor && cores.has(e.cor)) continue;
    out.push(e);
    if (e.cor) cores.add(e.cor);
  }
  for (const e of ok) {
    if (out.length >= cap) break;
    if (!out.includes(e)) out.push(e);
  }
  return out.map(e => e.i);
}

// Llama 4 Scout aceita no máx 5 imagens por chamada.
const MAX_IMAGES_PER_CALL = 5;
// Fotos aprovadas por view (galeria rica; interior mais variado).
const APPROVED_PER_VIEW = { front: 6, side: 4, rear: 4, interior: 8 };
const DEFAULT_APPROVED = 4;
// Teto de candidatos enviados ao vision por view (segura quota: ~2 lotes/view).
const MAX_CANDIDATES_TO_VALIDATE = 10;

async function validateBatch({ marca, modelo, ano, view, images, maxApproved = 3, retries = 5 }) {
  if (images.length === 0) return [];
  const client = getClient();
  const cap = Math.min(maxApproved, images.length);

  // O nome FIPE mistura acabamento e motor ("Golf 2.0/ 2.0 Mi Flex Comfortline
  // Aut."), e o acabamento fica soterrado no meio da especificação. Destacado,
  // ele serve de DESEMPATE entre fotos válidas.
  //
  // De propósito NÃO é critério de reprovação: EXL, LX e Personal diferem em
  // roda, farol de neblina e sensor — detalhe que nenhum modelo de visão
  // distingue de forma confiável, e "em dúvida, reprove" transformaria isso em
  // galeria vazia. Reprovação é marca/modelo/carroceria/geração/mercado.
  //
  // extractTrim (e não splitModelo) porque no formato mais comum da FIPE o trim
  // vem DEPOIS do motor: splitModelo devolvia versao="Golf" e o prompt saía com
  // "ACABAMENTO: Golf", que não diz nada.
  const trim = extractTrim(modelo);
  const trimHint = trim
    ? `\nACABAMENTO: ${trim}. Havendo mais de uma foto igualmente válida, PREFIRA a que corresponde a este acabamento (rodas, faróis de neblina, frisos). NÃO reprove uma foto só por dúvida de acabamento.`
    : '';

  const isExternal = view !== 'interior';

  // Só nas vistas externas: do painel não dá pra dizer a carroceria, e com
  // "em dúvida, reprove" a regra zeraria os interiores.
  const body = isExternal ? BODY_LABEL[classifyTipo(`${marca} ${modelo}`)] : null;
  const bodyHint = body
    ? `\nCARROCERIA: ${body.nome} — ${body.desc}. Carroceria diferente REPROVA, mesmo que a marca e o nome do modelo batam.`
    : '';

  const content = [
    {
      type: 'text',
      text:
`Vou te mostrar ${images.length} fotos numeradas de 1 a ${images.length}.

CARRO ALVO: ${marca} ${modelo}, ano ${ano}.
VISTA PEDIDA: ${VIEW_LABEL[view]}.
MERCADO: Brasil — carro brasileiro tem volante à ESQUERDA.${bodyHint}${trimHint}

Julgue CADA foto POR SI. Isto NÃO é uma escolha das melhores: cada foto passa ou reprova sozinha, e reprovar TODAS é um resultado normal e aceitável.

REPROVE a foto se QUALQUER item abaixo for verdade:
- **CARROCERIA ERRADA**: o formato do carro não é o da carroceria alvo. Sedã tem porta-malas saliente (três volumes); hatch termina na tampa traseira; perua/SW estende o teto até a traseira; cupê tem teto caído e silhueta esportiva; SUV é alto; picape tem caçamba. Confira o perfil ANTES de aprovar — é o erro mais comum.
- **GERAÇÃO ERRADA**: o carro tem que ser da geração vendida NO BRASIL em ${ano}. Farol, grade, para-choque e lanterna de outra geração REPROVAM, mesmo sendo a mesma marca e o mesmo modelo. Atenção: a geração europeia de ${ano} normalmente NÃO é a que se vendia aqui — o Brasil costuma receber a geração anterior por vários anos.
- Marca ou modelo visivelmente diferentes.
- **VOLANTE À DIREITA (mão inglesa)**: se o volante aparecer e estiver do lado DIREITO, é unidade de outro mercado (Reino Unido/Japão/Austrália/Índia) — REPROVE. Vale pro interior e pra qualquer foto que mostre o painel.
- **PLACA ESTRANGEIRA** visível: placa europeia (faixa azul da UE à esquerda), alemã, americana etc. indica carro de fora — REPROVE. Placa brasileira (Mercosul ou a cinza antiga) é ok.
- Versão de outro mercado: faróis, para-choque, rodas ou detalhes que não correspondem ao vendido no Brasil. Em dúvida sobre o mercado, REPROVE.
- VISTA ERRADA (ex: interior quando pedi ${VIEW_LABEL[view]}).
- Render 3D/CAD, desenho, ilustração, miniatura, brinquedo ou peça solta — queremos FOTO REAL.
- **ANÚNCIO DE CONCESSIONÁRIA / CLASSIFICADO**: tarja, faixa, moldura, rodapé ou borda com TELEFONE, nome de loja/revenda/seminovos, endereço, lista de cidades, "R$"/preço, KM ou logo de revenda — REPROVE SEMPRE, mesmo com o carro limpo. Qualquer telefone visível REPROVA.
- **THUMBNAIL DE VÍDEO / CHAMADA DE MATÉRIA**: capa de YouTube, headline sobreposta ("MELHOR HATCH 2024?", "TESTE COMPLETO"), preço ou número grande sobre o carro — REPROVE.
- Colagem/montagem com várias fotos numa só (antes/depois, comparativo).
- **FOTO EDITADA / DE LOJA DE ACESSÓRIOS**: círculo ou quadro com detalhe ampliado sobreposto ao carro (peça, aerofólio, ponteira), seta, linha, setinha ou marcação desenhada, texto sobreposto, ou placa trocada por plaqueta com nome de loja/marca ("ACESSÓRIOS", "@perfil", site). É anúncio de peça, não foto do carro — REPROVE, mesmo que o carro em si esteja certo e limpo.
- Marca d'água ou logo GRANDE cobrindo mais de ~10% do carro. Marca d'água de site pequena e discreta num canto é tolerável; logo de revenda, telefone ou faixa promocional NUNCA são.

Em dúvida, REPROVE. Melhor zero foto que uma foto errada.

Retorne EXCLUSIVAMENTE este JSON, com UMA entrada por foto, na ordem de 1 a ${images.length}:
{"fotos":[{"n":1,"ok":true,"anos":[2006,2013],"cor":"prata","nota":8},{"n":2,"ok":false,"motivo":"sedã"}]}

- "ok": true SÓ se a foto passar em TODOS os critérios acima.
- "anos": [primeiro, último] ano em que ESSA geração exata foi vendida NOVA NO BRASIL (não a produção mundial — a mesma geração chega ao Brasil anos depois, e é isso que separa o carro certo do errado). Obrigatório quando ok=true: é assim que conferimos o ano.
- "cor": cor predominante ${isExternal ? 'da pintura' : 'do revestimento interno'}, uma palavra.
- "nota": 0 a 10, o quanto a foto é limpa e representativa.
- "motivo": 2 a 4 palavras, só quando ok=false.`,
    },
    ...images.map(img => ({
      type: 'image_url',
      image_url: { url: img.visionUrl || img.url },
    })),
  ];

  // Curto-circuito: TPD esgotado ou disjuntor de 429 disparado → nem chama.
  if (_visionAborted) throw new Error('visão abortada (muitos 429) — pulando');
  if (isTpdExhausted()) {
    throw new Error('TPD esgotado — pulando validação');
  }

  let completion;
  // ORDEM IMPORTA: a vaga de concorrencia vem ANTES da reserva de tokens.
  // Ao contrario, as N chamadas de um carro (4 vistas x 2 lotes) passavam todas
  // pela reserva e depois empacavam no semaforo — 320k reservados com 2
  // executando. O pacer passava a bloquear a si mesmo com reserva fantasma.
  await acquireVision();
  const _res = await aguardaOrcamento();
  try {
    // `.withResponse()` traz os headers x-ratelimit-* junto — é aqui que dá pra
    // ver a janela da conta encolhendo ANTES do 429 chegar.
    const rodada = await client.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    }).withResponse();
    completion = rodada.data;
    registraRateLimit(rodada.response?.headers, 'visao');
  } catch (e) {
    const msg = String(e.message || '');
    const is429 = /429|rate.limit|too many/i.test(msg);
    // TPD só quando a OpenAI diz explicitamente "per day" / (TPD) / (RPD) — e
    // NUNCA numa mensagem de TPM (por minuto). Sem isso, um 429 de TPM casava por
    // acidente (ex.: o "7m" do org-id) e marcava TPD falso, matando a rodada.
    const isTPD = /per day|\(TPD\)|\(RPD\)/i.test(msg) && !/per min|\(TPM\)/i.test(msg);

    // SALDO ZERADO não é rate limit, mas a OpenAI manda como 429 ("You have no
    // credits remaining"). Sem esta cláusula ele caía no retry de TPM: 5 esperas
    // com backoff por view, ~20s jogados fora e o log dizendo "TPM" pra um erro
    // que nenhuma espera resolve. Aborta a visão de uma vez — o passe de
    // background lê isVisionAborted() e para.
    if (/no credits remaining|insufficient_quota|exceeded your current quota|check your plan and billing/i.test(msg)) {
      _visionAborted = true;
      console.error('[validator] ⛔ saldo da conta zerado — abortando a visão (adicione créditos)');
      throw new Error('saldo da conta de visão zerado');
    }

    // TPD esgotou → marca a sessão e desiste deste view.
    if (is429 && isTPD) {
      const minMatch = msg.match(/(\d+)m(?!s)/i);
      const secMatch = msg.match(/(\d+(?:\.\d+)?)s/i);
      const totalSec = (minMatch ? parseInt(minMatch[1]) * 60 : 0) + (secMatch ? parseFloat(secMatch[1]) : 0);
      markTpdExhausted(totalSec || 3600);
      throw new Error('TPD esgotado');
    }

    // TPM (por minuto) → aguarda o tempo que a OpenAI pediu e retenta ANTES de
    // contar como falha. A dica de espera pode vir em ms ("657ms") ou s ("1.2s").
    // Backoff cresce a cada retry (floor de 1s) pra não martelar a janela de TPM
    // quando a dica vem curta demais sob pressão sustentada.
    if (retries > 0 && is429) {
      const msMatch = msg.match(/try again in (\d+(?:\.\d+)?)ms/i);
      const secMatch = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
      const hintMs = msMatch ? Math.ceil(parseFloat(msMatch[1])) + 300
        : secMatch ? Math.ceil(parseFloat(secMatch[1]) * 1000) + 300
        : 2000;
      const attempt = 6 - retries;                 // 1, 2, 3…
      const waitMs = Math.max(hintMs, 1000 * attempt);
      console.warn(`[validator] TPM 429 em ${view}, aguardando ${waitMs}ms (retries restantes: ${retries - 1})`);
      await new Promise(r => setTimeout(r, waitMs));
      return validateBatch({ marca, modelo, ano, view, images, maxApproved, retries: retries - 1 });
    }

    // Disjuntor: só conta quando os retries ESGOTARAM (falha real, não 429
    // transitório que o retry resolveria). N chamadas realmente mortas em
    // sequência → para tudo (o bg checa isVisionAborted()).
    if (is429) {
      _consec429++;
      if (_consec429 >= ABORT_AFTER_429) {
        _visionAborted = true;
        console.error(`[validator] ⛔ ${_consec429} chamadas 429 SEGUIDAS (retries esgotados) — abortando a visão (rate limit virou parede)`);
        throw new Error('visão abortada: muitos 429 seguidos');
      }
    }
    throw e;
  } finally {
    releaseVision();
  }

  // Sucesso: zera a contagem de 429 seguidos.
  _consec429 = 0;
  // Consumo REAL da chamada — realimenta a estimativa do pacer de TPM.
  _registraUso(_res, completion?.usage?.total_tokens);
  // …e vai também pro medidor de consumo (painel do CRM). São coisas
  // diferentes: o pacer acima só enxerga os últimos 60s.
  registraLLM({
    provider: USE_OPENAI_VISION ? 'openai' : 'groq',
    modelo: VISION_MODEL,
    operacao: 'visao',
    usage: completion?.usage,
  });

  const text = completion.choices?.[0]?.message?.content || '{}';
  return _selecionaAprovadas(text, images, cap, ano, view);
}

// Valida uma view: lote os candidatos em grupos de MAX_IMAGES_PER_CALL e mescla
// as aprovadas até o alvo da view. Se TPD/TPM estourar no meio, fica com o que
// já aprovou.
async function validateView({ marca, modelo, ano, view, byView }) {
  const target = APPROVED_PER_VIEW[view] || DEFAULT_APPROVED;
  const candidates = (byView[view] || []).slice(0, MAX_CANDIDATES_TO_VALIDATE);
  if (candidates.length === 0) return [];

  const approved = [];
  for (let start = 0; start < candidates.length && approved.length < target; start += MAX_IMAGES_PER_CALL) {
    const batch = candidates.slice(start, start + MAX_IMAGES_PER_CALL);
    const remaining = target - approved.length;
    try {
      const okIdx = await validateBatch({ marca, modelo, ano, view, images: batch, maxApproved: remaining });
      for (const i of okIdx) approved.push(batch[i]);
    } catch (e) {
      console.warn(`[validator] ${view} lote (offset ${start}) falhou: ${e.message} — encerrando view`);
      break; // TPD/TPM ou erro: preserva o que já foi aprovado
    }
  }
  return approved.slice(0, target);
}

// Valida as 4 views EM PARALELO. Retorna { front, rear, side, interior } com até
// APPROVED_PER_VIEW[view] fotos. As views são independentes, então rodar em
// paralelo corta a latência ~4x (o gpt-4o-mini não tem teto por minuto que
// inviabilize isso). O semáforo de builds em imageCache limita o fan-out total.
export async function validateImages({ marca, modelo, ano, byView }) {
  const views = ['front', 'rear', 'side', 'interior'];
  const results = await Promise.all(
    views.map(view => validateView({ marca, modelo, ano, view, byView }))
  );
  const out = { front: [], rear: [], side: [], interior: [] };
  views.forEach((v, i) => { out[v] = results[i]; });
  return out;
}

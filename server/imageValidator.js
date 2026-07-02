// Validador de imagens via Vision LLM (Groq). Recebe candidatos por view e
// devolve até 2 fotos APROVADAS por view. Filosofia "honestidade > generosidade":
// se o LLM duvida ou a chamada falha, descarta — melhor zero foto que foto errada.

import OpenAI from 'openai';

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

  const isExternal = view !== 'interior';
  const diversityHint = isExternal
    ? 'Se entre as fotos houver cores EXTERNAS diferentes do carro (ex: preto, branco, vermelho), prefira escolher 2-3 com cores DISTINTAS — diversidade visual é desejável.'
    : 'Se houver variações de revestimento interno (cores de banco, tipo de painel), prefira escolher exemplos visualmente diferentes.';

  const content = [
    {
      type: 'text',
      text:
`Vou te mostrar ${images.length} fotos numeradas de 1 a ${images.length}.

Pra cada foto, julgue se é REALMENTE um(a) ${marca} ${modelo} do ano ${ano}, vista de ${VIEW_LABEL[view]}.
IMPORTANTE: queremos a versão vendida no MERCADO BRASILEIRO. Carros do Brasil têm volante à ESQUERDA.

Rejeite a foto se qualquer um abaixo for verdade:
- Marca, modelo ou geração visivelmente diferente
- **VOLANTE À DIREITA (mão inglesa)**: se o volante aparecer e estiver do lado DIREITO, é unidade de outro mercado (Reino Unido/Japão/Austrália/Índia) — REJEITE. Vale pra interior e qualquer foto que mostre o painel/volante.
- **PLACA ESTRANGEIRA** visível: placa europeia (faixa azul da UE à esquerda), alemã, americana, etc. indica carro de fora — REJEITE. Placa brasileira (Mercosul ou a cinza antiga) é ok.
- Versão/acabamento claramente de outro mercado — faróis, para-choque, rodas ou detalhes que não correspondem ao vendido no Brasil. Em dúvida sobre o mercado, REJEITE.
- View errada (ex: interior quando pedi frente)
- Imagem 3D/render/CAD/desenho (queremos foto real)
- Marca d'água ou logo GRANDE cobrindo parte significativa do carro (mais de ~10% da área)
- Miniatura, brinquedo, peça solta
- **ANÚNCIO DE CONCESSIONÁRIA / CLASSIFICADO**: foto com TARJA, FAIXA, MOLDURA, RODAPÉ ou BORDA contendo NÚMERO DE TELEFONE, nome de loja/revenda/seminovos, endereço, lista de cidades, "R$"/preço, KM, ou logo de revenda em destaque — REJEITE SEMPRE, mesmo que o carro em si esteja limpo. Queremos a foto MAIS LIMPA POSSÍVEL, sem qualquer texto de contato, telefone ou marca de loja. Em caso de qualquer telefone visível na imagem, REJEITE.
- **THUMBNAIL DE VÍDEO / CHAMADA DE MATÉRIA**: capa de YouTube, headline sobreposta ("MELHOR HATCH 2024?", "TESTE COMPLETO"), preço ou número grande em destaque sobre o carro — REJEITE.
- Colagem / montagem com várias fotos numa só (antes/depois, comparativo).
- Uma marca d'água de SITE realmente PEQUENA e discreta num canto (ex: "autoesporte.com" sutil) é tolerável. Mas logo de concessionária, telefone, nome de revenda ou faixa promocional NÃO são — esses sempre reprovam.
- Foto com várias imagens montadas (colagem, antes/depois, comparativo).

${diversityHint}

Em dúvida, REJEITE. Melhor zero foto aprovada que uma foto errada.

Retorne EXCLUSIVAMENTE este JSON: {"aprovadas":[1,3]} — array de números (índices das aprovadas), MÁXIMO ${cap} itens, em ordem do mais representativo pro menos.`,
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
  await acquireVision();
  try {
    completion = await client.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    const msg = String(e.message || '');
    const is429 = /429|rate.limit|too many/i.test(msg);
    // TPD só quando a OpenAI diz explicitamente "per day" / (TPD) / (RPD) — e
    // NUNCA numa mensagem de TPM (por minuto). Sem isso, um 429 de TPM casava por
    // acidente (ex.: o "7m" do org-id) e marcava TPD falso, matando a rodada.
    const isTPD = /per day|\(TPD\)|\(RPD\)/i.test(msg) && !/per min|\(TPM\)/i.test(msg);

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

  const text = completion.choices?.[0]?.message?.content || '{}';
  try {
    const json = JSON.parse(text);
    const arr = Array.isArray(json.aprovadas) ? json.aprovadas : [];
    return arr
      .map(n => Number(n) - 1)
      .filter(i => Number.isInteger(i) && i >= 0 && i < images.length)
      .slice(0, cap);
  } catch {
    return [];
  }
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

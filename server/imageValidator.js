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

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!VISION_API_KEY) throw new Error('Nenhuma chave de visão no .env (LLM_API_KEY/VISION_API_KEY/GROQ_API_KEY)');
  _client = new OpenAI({ apiKey: VISION_API_KEY, baseURL: VISION_BASE_URL });
  return _client;
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

async function validateBatch({ marca, modelo, ano, view, images, maxApproved = 3, retries = 2 }) {
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
- **THUMBNAIL DE VÍDEO / CHAMADA DE MATÉRIA**: capa de YouTube, headline sobreposta ("MELHOR HATCH 2024?", "TESTE COMPLETO"), preço ou número grande em destaque sobre o carro — REJEITE.
- Colagem / montagem com várias fotos numa só (antes/depois, comparativo).
- Logo ou URL PEQUENO e discreto num canto (ex: marca d'água sutil de site, logo de concessionária) é ACEITÁVEL — não rejeite por isso.
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

  // Curto-circuito: se TPD já esgotou nesta sessão, nem chama Groq.
  if (isTpdExhausted()) {
    throw new Error('TPD esgotado — pulando validação');
  }

  let completion;
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
    const isTPD = /tokens per day|TPD/i.test(msg);

    // TPD esgotou → marca a sessão e desiste deste view.
    if (is429 && isTPD) {
      const minMatch = msg.match(/(\d+)m/i);
      const secMatch = msg.match(/(\d+(?:\.\d+)?)s/i);
      const totalSec = (minMatch ? parseInt(minMatch[1]) * 60 : 0) + (secMatch ? parseFloat(secMatch[1]) : 0);
      markTpdExhausted(totalSec || 3600);
      throw new Error('TPD esgotado');
    }

    // TPM (por minuto) → aguarda o tempo que a Groq pediu e retenta.
    if (retries > 0 && is429) {
      const secMatch = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
      const waitMs = secMatch ? Math.ceil(parseFloat(secMatch[1]) * 1000) + 250 : 2500;
      console.warn(`[validator] TPM 429 em ${view}, aguardando ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      return validateBatch({ marca, modelo, ano, view, images, maxApproved, retries: retries - 1 });
    }
    throw e;
  }

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

// Valida as 4 views. Retorna { front, rear, side, interior } com até
// APPROVED_PER_VIEW[view] fotos. Como o modelo aceita ≤5 imagens/chamada,
// lote os candidatos em grupos de MAX_IMAGES_PER_CALL e mescla as aprovadas até
// o alvo da view. Se TPD/TPM estourar no meio, fica com o que já aprovou.
export async function validateImages({ marca, modelo, ano, byView }) {
  const out = { front: [], rear: [], side: [], interior: [] };
  for (const view of ['front', 'rear', 'side', 'interior']) {
    const target = APPROVED_PER_VIEW[view] || DEFAULT_APPROVED;
    const candidates = (byView[view] || []).slice(0, MAX_CANDIDATES_TO_VALIDATE);
    if (candidates.length === 0) continue;

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
    out[view] = approved.slice(0, target);
  }
  return out;
}

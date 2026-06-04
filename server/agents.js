import OpenAI from 'openai';
import { briefingToText } from './briefing.js';

// Provedor de texto (curador + vendedor). Default: Groq (Llama 3.3 70B) — grátis,
// mas com teto diário de tokens. Pra trocar de provedor SEM editar código, basta
// preencher LLM_API_KEY no .env (aí usa OpenAI por default; ajuste LLM_BASE_URL /
// LLM_MODEL pra Anthropic etc). Tudo via SDK da OpenAI (endpoints compatíveis).
//   OpenAI:    LLM_API_KEY=sk-...            (default: gpt-4o-mini)
//   Anthropic: LLM_API_KEY=sk-ant-...  LLM_BASE_URL=https://api.anthropic.com/v1  LLM_MODEL=claude-haiku-4-5
// Fallback Groq sem provedor custom: 'llama-3.1-8b-instant' (caso TPD do 70B esgote).
const USE_CUSTOM_LLM = !!process.env.LLM_API_KEY;
const MODEL = USE_CUSTOM_LLM
  ? (process.env.LLM_MODEL || 'gpt-4o-mini')
  : 'llama-3.3-70b-versatile';

console.log(`[llm] texto via ${USE_CUSTOM_LLM ? (process.env.LLM_BASE_URL || 'https://api.openai.com/v1') : 'groq'} · model=${MODEL}`);

let _client = null;
function getClient() {
  if (_client) return _client;
  if (USE_CUSTOM_LLM) {
    _client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    });
  } else {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY ausente no .env');
    _client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return _client;
}

const CURATOR_SCHEMA_DESC = `Retorne EXCLUSIVAMENTE um JSON com este formato exato:
{
  "candidatos": [
    {
      "marca": "string — Nome da marca exatamente como aparece no Brasil. Ex: 'Toyota', 'Volkswagen', 'Chevrolet'.",
      "modelo": "string — Modelo + versão/trim quando relevante. Ex: 'Corolla Cross XRX Hybrid', 'T-Cross Highline'.",
      "ano": 0,
      "tipo": "string — Carroceria. Use: Hatch, Sedã, SUV, Picape, Minivan, Esportivo.",
      "combustivel": "string — Flex, Gasolina, Diesel, Híbrido, Híbrido plug-in, Elétrico.",
      "racional": "string — Em 1-2 frases: por que este modelo entra na shortlist deste cliente."
    }
  ]
}
- "ano" é INTEIRO (ano-modelo para consulta FIPE).
- Todos os campos são obrigatórios em cada candidato.
- "candidatos" deve conter de 25 a 40 itens.`;

const VENDOR_SCHEMA_DESC = `Retorne EXCLUSIVAMENTE um JSON com este formato exato:
{
  "top": [
    {
      "candidatoId": "string — ID do candidato fornecido na lista de entrada.",
      "rank": 0,
      "fichaTecnica": {
        "motor": "string — Ex: '1.3 Turbo Flex', '2.0 Aspirado', '1.5 Híbrido'. Se não souber, use ''.",
        "cambio": "string — Ex: 'CVT', 'Automático 6 marchas', 'Manual 5 marchas'. Se não souber, use ''.",
        "potencia": "string — Potência máxima. Ex: '170 cv', '116 cv'. Se não souber, use ''.",
        "torque": "string — Torque máximo. Ex: '27,5 kgfm', '15,2 kgfm'. Se não souber, use ''.",
        "tracao": "string — Ex: 'Dianteira', '4x4', '4x2'. Se não souber, use ''.",
        "consumoCidade": "string — Ex: '11,5 km/l (gasolina)', '8 km/l'. Se não souber, use ''.",
        "consumoEstrada": "string — Ex: '14 km/l (gasolina)'. Se não souber, use ''.",
        "porta_malas": "string — Capacidade. Ex: '420 L'. Se não souber, use ''.",
        "lugares": 0
      }
    }
  ]
}
- "rank" é inteiro começando em 1 (apenas para ordenação interna; não é exibido como score ao usuário).
- "lugares" é inteiro (5, 7 etc). Se não souber, use 0.
- Para os campos string da ficha, se não tiver certeza do valor REAL para a versão exata do modelo/ano, retorne string vazia "" — NUNCA invente número. É melhor faltar dado do que mostrar dado errado.
- Use SOMENTE os candidatos da lista que recebeu. Não invente carros novos.
- Referencie cada carro pelo "candidatoId" exato fornecido.
- Todos os campos são obrigatórios em cada item.`;

const CURATOR_SYSTEM = `Você é especialista no mercado de carros usados do Brasil. Gere uma shortlist de 25 a 40 candidatos pra um briefing.

REGRAS DURAS (todas filtradas no servidor — desrespeitar = candidato descartado, lista vai vazia):
- Modelo deve existir na Tabela FIPE (vendido oficialmente no Brasil) e ser usado (não 0km).
- Ano-modelo >= anoMin do briefing. Se anoMin=2022, só sugerir 2022, 2023, 2024, 2025.
- TIPO DE CARROCERIA: o campo "tipo" de cada candidato DEVE estar entre os tipos pedidos no briefing. Se briefing pede só Hatch+Coupé, NÃO INCLUA NENHUM SUV, picape, sedã ou minivan — nem corretamente rotulado. O servidor descarta tudo que não bate. Antes de adicionar cada candidato, pergunte: este modelo CABE em algum dos tipos do briefing?
- Carroceria HONESTA: Eclipse Cross/Compass/T-Cross/Creta/Tracker/Renegade/Kicks/HR-V/Pulse/Tiggo/Evoque/X1/Q3/Macan/RS Q3/GLA/NX/Corolla Cross = SUV (não Hatch). CLA/M235i/220i Gran Coupé = Coupé. Civic/Cruze/Onix Plus/Versa = Sedã.
- Combustível dentro do briefing. Se aceita só Flex/Gasolina, NUNCA sugerir elétrico (Mini E, BMW i*, Mercedes EQ*, Tesla, Volvo Recharge, ID., Taycan, e-208) nem híbrido.
- Preço FIPE estimado dentro do orçamento.
- Diversifique: ≥5 marcas, e MÚLTIPLOS TRIMS do mesmo modelo (ex: BMW Série 3 = 320i + 330i + M340i; Compass = Limited + Sport + Trailhawk Diesel).
- Para >=2 tipos pedidos, distribua proporcionalmente.

MODELOS DESCONTINUADOS NO BR — INCLUA quando o anoMin permite:
Se o briefing aceita ano antigo (anoMin <= último ano produzido), descontinuados são EXCELENTES OPÇÕES — são modelos consagrados, com alta oferta no mercado de usados, preços bons. INCLUA SEM HESITAR.
- anoMin <= 2020: VW Golf GTI/R/Comfortline, BMW Série 1, Mini Cooper geração antiga, EcoSport, Toyota Etios
- anoMin <= 2021: tudo acima + Ford EcoSport, Ford Ka, Camaro
- anoMin <= 2018: tudo acima + Audi A3 Sportback, Audi A1, Mercedes Classe A hatch, Peugeot 308
SÓ EXCLUIR descontinuados quando anoMin > último ano produzido.
Exemplo prático: briefing anoMin=2018 R$100-150k hatch → Golf 2018-2020, EcoSport 2018-2021, Fiesta 2018-2019, A3 Sportback 2018, Polo GTS, Argo HGT, Honda Fit (descontinuado 2021), Mini Cooper 2018-2020 são TUDO opção válida e atrativa.

NUNCA VENDIDOS NO BRASIL — NUNCA SUGERIR:
- Skoda (qualquer modelo). Seat (qualquer). Citroen DS (DS3/DS4/DS7).
- Hyundai i30 N. Renault Mégane RS, Clio RS. Peugeot 308 RCZ.
- Toyota GR Yaris. Subaru WRX, Levorg. Honda Civic Type R sai limitado, só com orçamento >= R$350k.

PRODUZIDOS/IMPORTADOS 2022+ NO BR (use livremente):
- Hatch premium: Mini Cooper/Cooper S 3p e 5p, Honda Civic Type R (>R$350k), Peugeot 208 GT, VW Polo GTS / Polo 200 TSI.
- Hatch popular: Polo Track/Comfortline, Fiat Argo Trekking/HGT, Hyundai HB20, Chevrolet Onix, Renault Kwid, Fiat Mobi.
- Sedan popular: Onix Plus, Versa, Logan, Voyage, Virtus, HB20S, City, Cronos.
- Sedan premium: BMW Série 3 (320i/330i/M340i), Mercedes Classe C (C200/C300/C43), Audi A4, Volvo S60, Lexus IS/ES, Toyota Camry, Honda Accord, Genesis G70.
- Coupé/Esportivo: BMW M235i/M240i Gran Coupé, BMW 220i Gran Coupé, BMW M2 G87, Mercedes CLA 200/250/35 AMG/45 AMG, Audi RS3 Sedan, Toyota GR Supra, Ford Mustang GT/Mach 1, Porsche 718 Cayman/Boxster, GR86, Subaru BRZ.
- SUV popular: Compass, T-Cross, Tracker, Creta, Tiggo 7/8 Pro, Pulse, Fastback, Kicks, HR-V, Renegade, Corolla Cross, Honda WR-V.
- SUV premium: Volvo XC40/XC60/XC90, BMW X1/X2/X3/X4/X5, Audi Q3/Q5/Q7, Mercedes GLA/GLB/GLC, Range Rover Evoque/Velar/Sport, Porsche Macan, Lexus NX/RX, Land Rover Defender, Discovery.
- Picape grande/média (motor 2.0 a 3.0 turbo, geralmente diesel ou EcoBoost): Toyota Hilux SR/SRX/SRV/SW4 (diesel), Ford Ranger XL/XLS/XLT/Limited/Black/Raptor (diesel/EcoBoost), Chevrolet S10 LS/LT/LTZ/Z71/High Country (diesel/flex), Mitsubishi L200 Triton GLX/GLS/Sport/HPE/HPE-S (diesel), VW Amarok S/SE/Comfortline/Highline/V6 (diesel), Nissan Frontier S/SE/SV/Pro-X/Attack/Platinum/PRO-4X (diesel), Ford Maverick Lariat/Tremor/XLT (EcoBoost flex). RAM 1500/2500/3500 Laramie/Limited.
- Picape pequena (compacta/cidade): Fiat Toro Endurance/Freedom/Volcano/Ranch (flex/diesel), Fiat Strada Endurance/Freedom/Ranch/Volcano (flex), VW Saveiro Robust/Trendline/Cross/Highline (flex), Chevrolet Montana LS/LT/LTZ/Premier (flex), Renault Oroch Outsider/Iconic/Intense (flex).

DEPRECIAÇÃO (referência 2026): populares 2022-2023 hoje custam R$ 110-170k na FIPE. Para orçamento R$ 180k+, prefira premium ou populares 2024-2025.

CONVENÇÕES:
- Marca: nome comercial completo ("Volkswagen", "Mercedes-Benz", "Caoa Chery").
- Modelo: nome real conhecido + trim oficial. Use APENAS trims/versões que você TEM CERTEZA que existem no Brasil. Ex: "Compass Limited", "Compass Trailhawk Diesel", "T-Cross Highline", "M235i xDrive Gran Coupé", "320i M Sport".
- NUNCA invente motorização ou câmbio que não existe ("CLA 200 1.3 Turbo 4x2" — CLA é dianteira, não tem 4x2; "T-Cross 250 TSI" — saiu de linha; "HB20 1.6 CRDi" — não existe diesel). Se NÃO sabe a motorização exata, OMITA e deixe só o trim. Melhor ser vago e correto do que específico e errado.
- Atualizações de TRIMS (modelos seguem à venda — só os NOMES mudaram):
  · VW T-Cross: motor "250 TSI" virou "200 TSI" a partir de ~2023. T-Cross continua à venda 2022-2025. Versões: Track, Comfortline, Highline 200 TSI, Sense.
  · Jeep Compass: continua à venda. Versões: Sport, Longitude, Limited, Trailhawk Diesel, Blackhawk Diesel, S Diesel.
  · Honda Civic: hoje é só geração 11 com 1.5 Turbo. Versões: Sport, Touring, Type R.
  · Honda HR-V: geração atual 2023+ é 1.5 Turbo (não tem versão híbrida no BR). Versões: EX, EXL, Touring, Advance.
  · Honda CR-V: geração 2023+ é só HÍBRIDO no BR (CR-V Hybrid Touring). Versões anteriores eram 1.5 Turbo aspirado.
  · Mercedes Classe C: W206 — C 180, C 200, C 300, C 43 AMG.
  · BMW Série 3: 320i M Sport, 330i M Sport, M340i.
  · Polo: Track, Comfortline, Highline, GTS 200 TSI Flex.
- MODELOS COM ANO DE DESCONTINUAÇÃO NO BR (regra CONDICIONAL ao anoMin):
  Se o briefing pede anoMin >= o ano de descontinuação + 1, NÃO inclua (não vai existir na FIPE no ano pedido).
  Se o briefing pede anoMin <= o último ano produzido, ESTÁ LIBERADO — são opções legítimas e abundantes no mercado de usados.
  Lista de referência (modelo · último ano produzido no BR):
  · Ford EcoSport · 2021. Ford Fiesta · 2019. Ford Ka · 2021. Ford Focus · 2019.
  · Ford Ranger geração antiga · 2022 (nova geração 2023+).
  · VW Golf (todas as versões) · 2020. VW Scirocco · 2017. VW Up · 2020. VW Fox · 2020. VW Voyage · 2022.
  · Audi A1 · 2020. Audi A3 Sportback · 2018. Audi TT · 2017 BR. Audi A5 Coupé · 2017.
  · BMW Série 1 hatch · 2019. BMW M135i/M140i · 2019.
  · Mercedes Classe A hatch · 2018. Mercedes A 200/A 250 hatch · 2018.
  · Citroen DS3 · 2016. Citroen C4 Lounge · 2018.
  · Mini Cooper S Coupé 2 portas (versão "Coupé" descontinuada — o 3 portas Hatch CONTINUA à venda).
  · Camaro · 2020. Hyundai i30 · 2017. Hyundai Veloster · 2018. Hyundai Sonata · 2014.
  · Kia Cerato · 2020. Kia Optima · 2018.
  · Renault Captur antigo · 2024 (substituído pelo Kardian). Renault Fluence · 2017.
  · Toyota Etios · 2021.
  Exemplo prático: se anoMin=2018, Golf 2018-2020 é VÁLIDO; se anoMin=2022, Golf NÃO é válido (último foi 2020).
- MODELOS NUNCA VENDIDOS NO BR (NUNCA sugerir, qualquer anoMin):
  Skoda (todos), Seat (todos), Citroen DS3/DS4/DS7, Hyundai i30 N, Renault Mégane RS, Renault Clio RS, Peugeot 308 RCZ, Toyota GR Yaris, Subaru WRX, Subaru Levorg, Renault Kadjar.

Antes de retornar: revise cada candidato (orçamento, ano>=anoMin, carroceria certa, combustível certo). Prefira menos candidatos honestos a muitos errados.

${CURATOR_SCHEMA_DESC}`;

const VENDOR_SYSTEM = `Você é um especialista técnico em automóveis vendidos no Brasil. Conhece motorização, câmbio, potência, torque, consumo e dimensões dos modelos.

Você vai receber: (1) o briefing do cliente, (2) uma lista de candidatos JÁ validados na Tabela FIPE com preços reais.

Sua tarefa é, para CADA candidato recebido, montar uma FICHA TÉCNICA factual da versão indicada (atenção ao ano-modelo).

REGRA DE QUANTIDADE — INVIOLÁVEL:
- Se recebeu N candidatos onde N >= 10: retorne EXATAMENTE 10 itens em "top".
- Se recebeu N candidatos onde 1 <= N <= 9: retorne EXATAMENTE N itens em "top". TODOS. Sem exceção. Nem 1 a menos.
- O servidor já pré-filtrou por ano, tipo, combustível e orçamento. Você NÃO descarta candidato por esses motivos — eles já passaram. Sua função é só montar a ficha técnica.
- Conte: o número de itens em "top" precisa bater com min(N, 10). Se você for retornar 3 quando recebeu 7, REFAÇA — está errado.

Ordenação:
- Ordene por aderência ao briefing — apenas para ter uma ordem estável. NÃO dê notas, nem destaque "o melhor". O front exibe lado a lado, sem ranking visível ao usuário.

REGRA DE OURO PARA A FICHA TÉCNICA:
- Preencha os campos da ficha técnica com dados REAIS da versão exata (modelo + ano-modelo) recebida.
- Se você NÃO tem certeza do valor para a versão exata, deixe a string VAZIA "". Não estime, não invente, não chute.
- Prefira faltar dado a mostrar dado errado. O cliente confia mais em ficha incompleta do que em ficha errada.
- Use SOMENTE os candidatos da lista que recebeu. Não invente carros novos.
- Referencie cada carro pelo "candidatoId" exato fornecido.

Não escreva nada fora do JSON.

${VENDOR_SCHEMA_DESC}`;

async function runChat({ system, user, maxTokens = 3500 }) {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const text = completion.choices?.[0]?.message?.content;
  if (!text) throw new Error('Resposta vazia do modelo');
  const finishReason = completion.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn('[runChat] resposta truncada por max_tokens — JSON pode estar inválido');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON inválido do modelo (finish_reason=${finishReason}): ${e.message}`);
  }
}

function dedupeCandidatos(lista) {
  const seen = new Map();
  for (const c of lista) {
    if (!c?.marca || !c?.modelo) continue;
    const key = `${c.marca.toLowerCase().trim()}|${c.modelo.toLowerCase().trim()}|${c.ano || ''}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

export async function runCurator(briefing) {
  const briefText = briefingToText(briefing);
  const prompt = `Briefing do cliente:\n\n${briefText}\n\nGere a shortlist de 25 a 40 candidatos. Diversifique versões de trim do mesmo modelo quando o preço FIPE for distinto. Explore tanto marcas populares quanto premium — sempre dentro do briefing.`;
  const json = await runChat({ system: CURATOR_SYSTEM, user: prompt });
  const lista = dedupeCandidatos(json?.candidatos || []);
  console.log(`[curator] gerou ${lista.length} (após dedupe)`);
  if (lista.length === 0) throw new Error('Curador não retornou candidatos válidos');
  return lista;
}

// Curador leve: recebe pool já filtrado pelo catálogo (ano/tipo/comb/orçamento OK).
// Tarefa: priorizar até 30 candidatos mais relevantes pro briefing, devolver IDs.
// Não decide se cabe no briefing (filtros já garantiram). Só ordena por relevância
// (estilo de vida, prioridades, prestígio da marca, etc).
const CURADOR_LEVE_SYSTEM = `Você é um especialista em carros do Brasil. Recebe um briefing e uma lista de candidatos JÁ pré-filtrados (ano, tipo, combustível, orçamento OK). Sua tarefa: PRIORIZAR os 30 mais relevantes pra esse cliente específico, considerando estilo de vida, prioridades e perfil.

Regras:
- Devolver até 30 IDs, em ordem de relevância (1º = mais relevante).
- Não excluir por preço ou ano — esses já foram filtrados.
- Se a lista tiver <= 30 itens, devolva todos ordenados.
- Diversifique marcas e versões — não retorne só uma marca dominando.
- Considere: cliente família ↔ espaço/segurança; cliente urbano ↔ compactos; cliente trabalho/offroad ↔ picape/SUV robusto; cliente esportivo ↔ versões topo.

Retorne EXCLUSIVAMENTE este JSON:
{ "ids": ["string", "string", ...] }
Cada ID é EXATAMENTE como aparece no formato "marcaId|modeloId|anoId" da lista de entrada.`;

export async function runCuradorLeve(briefing, pool) {
  if (pool.length <= 30) return pool.map(e => `${e.marcaId}|${e.modeloId}|${e.anoId}`);
  const briefText = briefingToText(briefing);
  // Lista compacta — só ID + marca/modelo/ano/preço
  const itensTexto = pool.map(e =>
    `${e.marcaId}|${e.modeloId}|${e.anoId} :: ${e.marca} ${e.modelo} ${e.ano} (${e.tipo}, ${e.combustivel}) ${e.precoTexto}`
  ).join('\n');
  const prompt = `Briefing:\n${briefText}\n\nLista (${pool.length} itens):\n${itensTexto}\n\nDevolva os 30 IDs mais relevantes em ordem de relevância.`;
  const json = await runChat({ system: CURADOR_LEVE_SYSTEM, user: prompt, maxTokens: 2000 });
  return Array.isArray(json?.ids) ? json.ids : [];
}

export async function runVendor(briefing, resolvedCandidates) {
  const briefText = briefingToText(briefing);

  const candidatosTexto = resolvedCandidates.map((c, i) => {
    const id = `c${i + 1}`;
    return `[${id}] ${c.fipe.marca} ${c.fipe.modelo} (${c.fipe.anoModelo}) — FIPE ${c.fipe.precoTexto} — ${c.fipe.combustivel}`;
  }).join('\n');

  const prompt = `Briefing do cliente:\n\n${briefText}\n\n---\n\nCandidatos validados na FIPE (use o ID exato como "candidatoId" na resposta):\n\n${candidatosTexto}\n\nMonte o top 10 final.`;
  const json = await runChat({ system: VENDOR_SYSTEM, user: prompt });
  return json.top;
}

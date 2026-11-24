import OpenAI from 'openai';
import { briefingToText } from './briefing.js';
import { registraLLM, registraRateLimit } from './usage.js';
import { resumoFicha } from './ficha-cache.js';

// Provedores de texto (curador + vendedor), em ORDEM DE PREFERÊNCIA. Se o
// primeiro falhar, a chamada cai no próximo sem o usuário perceber. Motivo: o
// crédito da OpenAI já zerou uma vez e derrubou a recomendação inteira — com um
// reserva configurado, isso vira só uma linha de log.
// Tudo via SDK da OpenAI (endpoints compatíveis).
//   1) Principal: LLM_API_KEY [+ LLM_BASE_URL, LLM_MODEL]    (default: OpenAI gpt-4o-mini)
//   2) Reserva:   LLM_FALLBACK_API_KEY [+ LLM_FALLBACK_BASE_URL, LLM_FALLBACK_MODEL]
//                 (default: Anthropic claude-haiku-5-5)
//   3) Último:    GROQ_API_KEY [+ GROQ_TEXT_MODEL]            (default: llama-3.3-70b-versatile)
// Qualquer um pode faltar; precisa existir pelo menos um.
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Provedor com falha "dura" (sem crédito, chave inválida, modelo inexistente)
// fica de fora por este tempo — senão TODA busca pagaria a latência de bater
// nele antes de cair no reserva.
const QUARENTENA_MS = 15 * 60 * 1000;
// Uma chamada do vendedor gera ~9k tokens; com o default do SDK (10 min) um
// provedor travado seguraria a busca e o reserva nunca entraria.
const TIMEOUT_MS = 180_000;

function nomeDoProvedor(baseURL) {
  return /groq/i.test(baseURL) ? 'groq' : /anthropic/i.test(baseURL) ? 'anthropic' : 'openai';
}

function montaProvedores() {
  const lista = [];
  const add = (apiKey, baseURL, model) => {
    if (!apiKey) return;
    lista.push({ nome: nomeDoProvedor(baseURL), apiKey, baseURL, model, client: null, foraAte: 0 });
  };
  add(process.env.LLM_API_KEY,
    process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    process.env.LLM_MODEL || 'gpt-4o-mini');
  add(process.env.LLM_FALLBACK_API_KEY,
    process.env.LLM_FALLBACK_BASE_URL || 'https://api.anthropic.com/v1',
    process.env.LLM_FALLBACK_MODEL || 'claude-haiku-5-5');
  add(process.env.GROQ_API_KEY, GROQ_BASE_URL, process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile');
  return lista;
}

const PROVEDORES = montaProvedores();

// Tamanho do resultado. Era 10; com o catálogo cobrindo o mercado (12,6 mil
// carros), 10 vagas obrigavam a IA a escolher entre Onix, HB20 e Gol — e ela
// escolhia uma marca. 25 é o teto prático: cada item custa ~250 tokens de ficha
// e o gpt-4o-mini sai no máximo com 16k, então 50 não caberia numa chamada.
export const TOP_N = 25;
// O curador manda o dobro pro vendedor, pra ele ter de onde escolher.
export const CURADOR_N = TOP_N * 2;

console.log(`[llm] texto: ${PROVEDORES.map(p => `${p.nome}/${p.model}`).join(' → ') || 'NENHUM PROVEDOR'}`);

function clientDe(p) {
  if (!p.client) p.client = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseURL, timeout: TIMEOUT_MS });
  return p.client;
}

// Falha que não se resolve tentando de novo daqui a pouco: sem saldo, chave
// errada, modelo fora do catálogo (o Groq já tirou o 70B do ar com 404), teto
// DIÁRIO de tokens. 429 comum (TPM/RPM) não entra — passa em segundos.
function falhaDura(err) {
  const s = err?.status;
  if ([401, 402, 403, 404].includes(s)) return true;
  const txt = `${err?.code || ''} ${err?.error?.code || ''} ${err?.message || ''}`;
  return s === 429 && /insufficient_quota|quota|billing|credit|per day|TPD/i.test(txt);
}

// Anthropic (endpoint compatível) ignora response_format e às vezes embrulha o
// JSON em ```json ... ```. Aceita isso em vez de jogar a resposta fora.
function parseJSON(text) {
  try { return JSON.parse(text); } catch { /* tenta extrair abaixo */ }
  const ini = text.indexOf('{');
  const fim = text.lastIndexOf('}');
  if (ini >= 0 && fim > ini) return JSON.parse(text.slice(ini, fim + 1));
  throw new Error('nenhum objeto JSON na resposta');
}

async function chamaProvedor(p, { system, user, maxTokens, maxRetries }) {
  // `.withResponse()` entrega a resposta HTTP junto: é de onde saem os headers
  // x-ratelimit-*, o único sinal de quanto ainda cabe na janela da conta.
  const { data: completion, response } = await clientDe(p).chat.completions.create({
    model: p.model,
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }, { maxRetries }).withResponse();
  registraRateLimit(response?.headers, 'texto');
  registraLLM({ provider: p.nome, modelo: p.model, operacao: 'texto', usage: completion?.usage });
  const text = completion.choices?.[0]?.message?.content;
  if (!text) throw new Error('Resposta vazia do modelo');
  const finishReason = completion.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn(`[llm] ${p.nome}: resposta truncada por max_tokens — JSON pode estar inválido`);
  }
  try {
    return parseJSON(text);
  } catch (e) {
    throw new Error(`JSON inválido do modelo (finish_reason=${finishReason}): ${e.message}`);
  }
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
        "torque": "string — Torque máximo, SEMPRE em kgfm (nunca Nm). Ex: '27,5 kgfm', '15,2 kgfm'. Se não souber, use ''.",
        "tracao": "string — Um destes: 'Dianteira', 'Traseira', '4x4'. Esportivos de motor dianteiro longitudinal são 'Traseira' (Mustang, Camaro, BMW M2/M4/Z4 e Série 3 a 8 sem xDrive, Porsche 718/911, Mercedes Classe C/E/S sem 4MATIC, Jaguar F-Type). Se não souber, use ''.",
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
- Cada ficha é da versão EXATA daquele candidato. Não reaproveite números de outro carro da lista (ex.: 420i Cabriolet NÃO tem a potência do M235i). Potência e câmbio que aparecem no nome FIPE ("530cv", "Mec.", "Aut.") são a verdade.
- Use SOMENTE os candidatos da lista que recebeu. Não invente carros novos.
- Referencie cada carro pelo "candidatoId" exato fornecido.
- Candidato marcado "FICHA JÁ CONHECIDA": a ficha está guardada no servidor. Devolva só { "candidatoId", "rank" } — NÃO escreva "fichaTecnica" pra ele. Use os dados que vieram nele pra ordenar.
- Nos demais, todos os campos são obrigatórios.`;

const CURATOR_SYSTEM = `Você é especialista no mercado de carros usados do Brasil. Gere uma shortlist de 25 a 40 candidatos pra um briefing.

REGRAS DURAS (todas filtradas no servidor — desrespeitar = candidato descartado, lista vai vazia):
- Modelo deve existir na Tabela FIPE (vendido oficialmente no Brasil) e ser usado (não 0km).
- Ano-modelo >= anoMin do briefing. Se anoMin=2022, só sugerir 2022, 2023, 2024, 2025.
- Ano-modelo <= anoMax do briefing, QUANDO informado. Se anoMax=2018, NÃO sugerir 2019+ (ex: anoMin=2012 e anoMax=2018 → só 2012 a 2018). Se anoMax vier vazio/null, não há teto.
- TIPO DE CARROCERIA: o campo "tipo" de cada candidato DEVE estar entre os tipos pedidos no briefing. Se briefing pede só Hatch+Coupé, NÃO INCLUA NENHUM SUV, picape, sedã ou minivan — nem corretamente rotulado. O servidor descarta tudo que não bate. Antes de adicionar cada candidato, pergunte: este modelo CABE em algum dos tipos do briefing?
- Carroceria HONESTA: Eclipse Cross/Compass/T-Cross/Creta/Tracker/Renegade/Kicks/HR-V/Pulse/Tiggo/Evoque/X1/Q3/Macan/RS Q3/GLA/NX/Corolla Cross = SUV (não Hatch). CLA/M235i/220i Gran Coupé = Coupé. Civic/Cruze/Onix Plus/Versa = Sedã.
- Combustível dentro do briefing. Se aceita só Flex/Gasolina, NUNCA sugerir elétrico (Mini E, BMW i*, Mercedes EQ*, Tesla, Volvo Recharge, ID., Taycan, e-208) nem híbrido.
- Preço FIPE estimado dentro do orçamento.
- Diversifique por MODELO, não por acabamento: ≥5 marcas e modelos distintos. NÃO gaste vagas da lista com vários trims do mesmo modelo/ano (Fit EXL + Fit LX + Fit Personal = um carro só) — o servidor mantém apenas a melhor versão de cada modelo e descarta as outras. Uma versão por modelo/ano; use as vagas que sobram pra trazer MAIS MODELOS.
- Para >=2 tipos pedidos, distribua proporcionalmente.

MODELOS DESCONTINUADOS NO BR — INCLUA quando o anoMin permite:
Se o briefing aceita ano antigo (anoMin <= último ano produzido), descontinuados são EXCELENTES OPÇÕES — são modelos consagrados, com alta oferta no mercado de usados, preços bons. INCLUA SEM HESITAR.
- anoMin <= 2020: VW Golf GTI/R/Comfortline, BMW Série 1, Mini Cooper geração antiga, EcoSport, Toyota Etios
- anoMin <= 2021: tudo acima + Ford EcoSport, Ford Ka, Camaro
- anoMin <= 2018: tudo acima + Audi A3 Sportback, Audi A1, Mercedes Classe A hatch, Peugeot 308
- anoMin <= 2015: tudo acima + BMW Série 3 E90 (2006-2012), BMW Série 1 E87 (2004-2011), BMW X1 E84 (2010-2015), Mercedes Classe C W204 (2008-2014), Audi A4 B8 (2008-2015), VW Golf 6 (2010-2013), Honda Civic 9ª ger. (2012-2016), Toyota Corolla 11ª ger. (2014-2019 no BR, mas anos antigos válidos)
- anoMin <= 2010: tudo acima + BMW Série 3 E46 (2000-2005), BMW Série 5 E60 (2004-2010), Mercedes Classe C W203 (2001-2007), Audi A4 B6/B7 (2001-2008), VW Golf 5 (2006-2009), Honda Civic 8ª ger. (2006-2011), Toyota Corolla 10ª ger. (2008-2013), Mitsubishi Lancer (2007-2013), Subaru Impreza/WRX (até 2012 no BR)
SÓ EXCLUIR descontinuados quando anoMin > último ano produzido.
Exemplo prático: briefing anoMin=2008 R$30-60k sedan → BMW E46 2003-2005, E90 2006-2008, Golf 5 2007-2009, Civic 8ª ger. 2006-2011, Corolla E140 2008-2013 são TODOS válidos e muito procurados no mercado de usados BR.

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

// O que cada perfil do briefing quer dizer, compartilhado entre o curador leve
// e o vendedor. Precisa estar nos DOIS: com pool pequeno (SUV 7 lugares tem ~20
// candidatos) o curador leve nem roda, e quem ordena é o vendedor sozinho —
// que antes não tinha regra nenhuma de perfil.
//
// "Design" era só a palavra solta no briefing. É gosto, mas não é aleatório:
// quem marca design reclama de carro com cara velha e de versão de entrada
// pelada, e é isso que a regra tenta capturar.
const CRITERIOS_PERFIL = `CRITÉRIOS DE PERFIL (use pra ordenar):
- Família ↔ espaço/segurança. Urbano ↔ compactos. Trabalho/offroad ↔ picape/SUV robusto.
- Uso esportivo = DESEMPENHO, não acabamento. Priorize motor turbo ou de maior potência (TB, TSI, TFSI, Turbo, 2.0, cv alto), versões esportivas de fábrica (GTI, HGT, AMG, M Sport, R-Design, Sport) e hatches premium de tração forte (Mercedes Classe A 250, BMW 125i/130i, Audi A3, Golf TSI, Volvo V40 T4/T5). Um 1.0/1.3 aspirado com pacote visual topo de linha NÃO é esportivo — vai pro fim. Ano mais antigo não é demérito quando o briefing aceita esse ano.
- Prioridade "design" = APARÊNCIA e presença, não desempenho. Priorize: (1) geração ou facelift mais recente que caiba no orçamento — carro de linha nova envelhece melhor; (2) versões topo ou com pacote visual de fábrica (R-Line, M Sport, AMG Line, S line, GT Line, N Line, Limited, Diamond, Black/Night Edition, Overland, Highline), que trazem roda maior, faróis full LED e acabamento diferenciado; (3) modelos reconhecidos pelo desenho (ex.: Volvo, Range Rover Evoque/Velar, Peugeot 2008/3008/5008 atuais, Jeep Compass/Commander, Kia Sportage nova geração, Mini). Versão de entrada "pelada" e linhas de desenho utilitário/datado (Spin, Doblò, Grand Livina, Zafira) vão pro fim quando design é prioridade — a não ser que sejam os únicos que atendem um requisito duro (ex.: 7 lugares).
- Esportivo + design juntos: pacote visual sozinho NÃO basta. O ideal é a versão que tem os dois (motor forte E visual de topo); depois, desempenho com visual comum; por último, só visual.`;

const VENDOR_SYSTEM = `Você é um especialista técnico em automóveis vendidos no Brasil. Conhece motorização, câmbio, potência, torque, consumo e dimensões dos modelos.

Você vai receber: (1) o briefing do cliente, (2) uma lista de candidatos JÁ validados na Tabela FIPE com preços reais.

Sua tarefa é, para CADA candidato recebido, montar uma FICHA TÉCNICA factual da versão indicada (atenção ao ano-modelo).

REGRA DE QUANTIDADE — INVIOLÁVEL:
- Se recebeu N candidatos onde N >= ${TOP_N}: retorne EXATAMENTE ${TOP_N} itens em "top".
- Se recebeu N candidatos onde 1 <= N <= ${TOP_N - 1}: retorne EXATAMENTE N itens em "top". TODOS. Sem exceção. Nem 1 a menos.
- O servidor já pré-filtrou por ano, tipo, combustível e orçamento. Você NÃO descarta candidato por esses motivos — eles já passaram. Sua função é só montar a ficha técnica.
- Conte: o número de itens em "top" precisa bater com min(N, ${TOP_N}). Se você for retornar 3 quando recebeu 7, REFAÇA — está errado.

Ordenação:
- Ordene por aderência ao briefing — apenas para ter uma ordem estável. NÃO dê notas, nem destaque "o melhor". O front exibe lado a lado, sem ranking visível ao usuário.
- Quando houver mais de ${TOP_N} candidatos, a ordem decide quem fica de fora: siga os critérios de perfil abaixo.

${CRITERIOS_PERFIL}

REGRA DE OURO PARA A FICHA TÉCNICA:
- Preencha os campos da ficha técnica com dados REAIS da versão exata (modelo + ano-modelo) recebida.
- Se você NÃO tem certeza do valor para a versão exata, deixe a string VAZIA "". Não estime, não invente, não chute.
- Prefira faltar dado a mostrar dado errado. O cliente confia mais em ficha incompleta do que em ficha errada.
- Use SOMENTE os candidatos da lista que recebeu. Não invente carros novos.
- Referencie cada carro pelo "candidatoId" exato fornecido.

Não escreva nada fora do JSON.

${VENDOR_SCHEMA_DESC}`;

// `valida` recebe o JSON e diz se ele serve. Resposta fora do formato também
// passa pro próximo provedor — antes, um `top` ausente estourava lá no
// recommend.js como "Cannot read properties of undefined".
async function runChat({ system, user, maxTokens = 3500, valida }) {
  if (!PROVEDORES.length) throw new Error('Nenhum provedor de LLM no .env (LLM_API_KEY, LLM_FALLBACK_API_KEY ou GROQ_API_KEY)');
  const agora = Date.now();
  const vivos = PROVEDORES.filter(p => p.foraAte <= agora);
  // Todos em quarentena: tenta assim mesmo. O crédito pode ter sido recarregado.
  const fila = vivos.length ? vivos : PROVEDORES;
  let ultimoErro;
  for (const [i, p] of fila.entries()) {
    const temReserva = i < fila.length - 1;
    try {
      // Sem reserva, insiste: o 429 de TPM (pipeline de fotos cravando a conta)
      // costuma dizer "try again in 453ms" e o SDK respeita o retry-after. Com
      // reserva, desistir cedo e trocar de provedor é mais rápido.
      const json = await chamaProvedor(p, { system, user, maxTokens, maxRetries: temReserva ? 2 : 6 });
      if (valida && !valida(json)) throw new Error('resposta fora do formato esperado');
      if (p.foraAte) p.foraAte = 0;
      if (p !== PROVEDORES[0]) console.warn(`[llm] servido pelo reserva ${p.nome}/${p.model}`);
      Object.defineProperty(json, '_llm', { value: `${p.nome}/${p.model}` });
      return json;
    } catch (e) {
      ultimoErro = e;
      if (falhaDura(e)) {
        p.foraAte = Date.now() + QUARENTENA_MS;
        console.error(`[llm] ${p.nome}/${p.model} em quarentena por ${QUARENTENA_MS / 60000} min (${e.message})`);
      } else {
        console.warn(`[llm] ${p.nome}/${p.model} falhou (${e.message})${temReserva ? ' — tentando o próximo' : ''}`);
      }
    }
  }
  throw ultimoErro;
}

// Pro painel/diagnóstico: quem está ativo e quem está de castigo.
export function statusProvedores() {
  const agora = Date.now();
  return PROVEDORES.map(p => ({
    provedor: p.nome, modelo: p.model,
    ativo: p.foraAte <= agora,
    voltaEm: p.foraAte > agora ? new Date(p.foraAte).toISOString() : null,
  }));
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
  const prompt = `Briefing do cliente:\n\n${briefText}\n\nGere a shortlist de 25 a 40 candidatos. Uma versão por modelo/ano — prefira ampliar o número de MODELOS diferentes a repetir acabamentos do mesmo carro. Explore tanto marcas populares quanto premium — sempre dentro do briefing.`;
  const json = await runChat({ system: CURATOR_SYSTEM, user: prompt, valida: j => Array.isArray(j?.candidatos) });
  const lista = dedupeCandidatos(json?.candidatos || []);
  console.log(`[curator] gerou ${lista.length} (após dedupe)`);
  if (lista.length === 0) throw new Error('Curador não retornou candidatos válidos');
  return lista;
}

// Curador leve: recebe pool já filtrado pelo catálogo (ano/tipo/comb/orçamento OK).
// Tarefa: priorizar até 30 candidatos mais relevantes pro briefing, devolver IDs.
// Não decide se cabe no briefing (filtros já garantiram). Só ordena por relevância
// (estilo de vida, prioridades, prestígio da marca, etc).
const CURADOR_LEVE_SYSTEM = `Você é um especialista em carros do Brasil. Recebe um briefing e uma lista de candidatos JÁ pré-filtrados (ano, tipo, combustível, orçamento OK). Sua tarefa: PRIORIZAR os ${CURADOR_N} mais relevantes pra esse cliente específico, considerando estilo de vida, prioridades e perfil.

Regras:
- Devolver até ${CURADOR_N} IDs, em ordem de relevância (1º = mais relevante).
- Não excluir por preço ou ano — esses já foram filtrados.
- Se a lista tiver <= ${CURADOR_N} itens, devolva todos ordenados.
- Lugares mínimos e porta-malas mínimo do briefing NÃO foram filtrados com certeza: priorize quem atende e mande pro fim quem você sabe que não atende (ex: pediu 7 lugares, a versão tem 5).
- Diversifique: no máximo 2 versões do mesmo modelo (dois Argo, dois Golf) entre os ${CURADOR_N}. A ordem da lista de entrada NÃO indica relevância.
- Alguns itens trazem "ficha:" com dados conferidos (lugares, potência, motor). Use-os em vez da memória — ex.: pediu 7 lugares e a ficha diz 5, vai pro fim.

${CRITERIOS_PERFIL}

Retorne EXCLUSIVAMENTE este JSON:
{ "ids": ["string", "string", ...] }
Cada ID é EXATAMENTE como aparece no formato "marcaId|modeloId|anoId" da lista de entrada.`;

// `fichaDe(entry)` devolve a ficha guardada daquela entrada (ou null). É uma
// função, e não um campo na entrada, porque as entradas do catálogo ficam em
// memória entre buscas — pendurar a ficha nelas vazaria de uma busca pra outra.
export async function runCuradorLeve(briefing, pool, { fichaDe = () => null } = {}) {
  if (pool.length <= CURADOR_N) return pool.map(e => `${e.marcaId}|${e.modeloId}|${e.anoId}`);
  const briefText = briefingToText(briefing);
  // Lista compacta — ID + marca/modelo/ano/preço, e o resumo da ficha quando
  // ela já está guardada (ver ficha-cache.js).
  const itensTexto = pool.map(e => {
    const ficha = resumoFicha(fichaDe(e));
    return `${e.marcaId}|${e.modeloId}|${e.anoId} :: ${e.marca} ${e.modelo} ${e.ano} (${e.tipo}, ${e.combustivel}) ${e.precoTexto}${ficha ? ` · ficha: ${ficha}` : ''}`;
  }).join('\n');
  const prompt = `Briefing:\n${briefText}\n\nLista (${pool.length} itens):\n${itensTexto}\n\nDevolva os ${CURADOR_N} IDs mais relevantes em ordem de relevância.`;
  const json = await runChat({ system: CURADOR_LEVE_SYSTEM, user: prompt, maxTokens: CURADOR_N * 40, valida: j => Array.isArray(j?.ids) });
  return Array.isArray(json?.ids) ? json.ids : [];
}

// `lembretes` são candidatos que algum consultor já reclamou de não ver no top
// (ver "lembretes de ranking" em recommend.js).
//
// O texto é forte de propósito — "inclua, salvo razão técnica concreta". A
// versão anterior era um pedido educado ("avalie com atenção") e foi ignorada
// nos testes: o carro entrava no prompt e não saía na lista. Continua não sendo
// inclusão automática, e a diferença importa: quem barra é a razão técnica
// contra o BRIEFING, não a preferência do consultor. Quem garante que não vira
// carta branca é o filtro determinístico lá atrás — só chega aqui carro que já
// passou em ano, tipo, combustível e orçamento.
export async function runVendor(briefing, resolvedCandidates, { lembretes = [] } = {}) {
  const briefText = briefingToText(briefing);

  // `fichaConhecida` vem do ficha-cache: o vendedor só ordena esses e não
  // reescreve a ficha — é daí que sai a economia de tokens e de tempo.
  const candidatosTexto = resolvedCandidates.map((c, i) => {
    const id = `c${i + 1}`;
    const ficha = resumoFicha(c.fichaConhecida);
    return `[${id}] ${c.fipe.marca} ${c.fipe.modelo} (${c.fipe.anoModelo}) — FIPE ${c.fipe.precoTexto} — ${c.fipe.combustivel}`
      + (c.fichaConhecida ? ` — FICHA JÁ CONHECIDA${ficha ? `: ${ficha}` : ''}` : '');
  }).join('\n');
  const semFicha = resolvedCandidates.filter(c => !c.fichaConhecida).length;

  // Vem ANTES da lista de candidatos de propósito: depois de 30 linhas de
  // lista, o aviso era ignorado — o carro entrava no prompt e continuava
  // invisível, que é a reclamação original com passos a mais.
  const blocoLembretes = lembretes.length
    ? `---\n\nATENÇÃO — sinalizado por consultor humano:\n`
      + lembretes.map(l => `[${l.id}] ${l.label}`).join('\n')
      + `\n\nUm consultor experiente já reclamou de não ver estes carros em buscas parecidas com esta, e eles passaram em todos os filtros do briefing. Inclua-os no top ${TOP_N}, a não ser que exista razão técnica CONCRETA contra (ex: o briefing pede 7 lugares e o carro tem 5). "Outro candidato é mais popular" ou "é mais óbvio" NÃO é razão.\n\n`
    : '';

  const prompt = `Briefing do cliente:\n\n${briefText}\n\n---\n\n${blocoLembretes}Candidatos validados na FIPE (use o ID exato como "candidatoId" na resposta):\n\n${candidatosTexto}\n\nMonte o top ${TOP_N} final.`;
  // ~250 tokens de ficha por item sem ficha guardada; ~20 por item que só
  // precisa de id + rank. O default (3500) truncava acima de ~12 fichas.
  const comFicha = Math.min(semFicha, TOP_N);
  const json = await runChat({
    system: VENDOR_SYSTEM, user: prompt,
    maxTokens: Math.max(1500, comFicha * 350 + (TOP_N - comFicha) * 40),
    valida: j => Array.isArray(j?.top) && j.top.length > 0,
  });
  // Quem escreveu as fichas (pra coluna modelo_llm do cache). Não enumerável
  // pra não vazar em JSON.stringify nem mudar o formato do array.
  Object.defineProperty(json.top, 'llm', { value: json._llm || null });
  return json.top;
}

// Mostra o painel de consumo sem precisar subir o servidor nem logar no CRM:
//
//   node scripts/diag-usage.js          — só lê (saldo Serper, custo, agregados)
//   node scripts/diag-usage.js --probe  — faz 1 chamada mínima ao LLM pra ver
//                                          se os headers x-ratelimit-* chegam
//
// O --probe gasta alguns tokens (fração de centavo). Sem ele, nada é chamado
// além do saldo do Serper.

import 'dotenv/config';
import OpenAI from 'openai';
import { registraLLM, registraRateLimit, painelUso } from '../usage.js';

if (process.argv.includes('--probe')) {
  const client = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL });
  const { data, response } = await client.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    max_tokens: 5,
    messages: [{ role: 'user', content: 'responda apenas: ok' }],
  }).withResponse();
  registraRateLimit(response?.headers, 'texto');
  registraLLM({
    provider: 'openai',
    modelo: process.env.LLM_MODEL || 'gpt-4o-mini',
    operacao: 'texto',
    usage: data?.usage,
  });
}

console.log(JSON.stringify(await painelUso(), null, 2));
process.exit(0);   // o pool do pg (se houver) seguraria o processo

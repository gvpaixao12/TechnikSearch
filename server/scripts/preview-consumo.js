// Abre o CRM num navegador só pra OLHAR o painel de consumo, sem precisar de
// banco nem de login: um servidor estático serve os arquivos do front e as
// rotas /api/* são interceptadas pelo Playwright.
//
//   node scripts/preview-consumo.js          — saldo do Serper real, resto zerado
//   node scripts/preview-consumo.js --demo   — preenche a IA com números de exemplo
//   node scripts/preview-consumo.js --shot   — só tira o screenshot e fecha
//
// Com --demo, os números de IA são INVENTADOS (o painel de verdade só mostra o
// que foi realmente gasto). Serve pra ver o layout cheio.

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { painelUso } from '../usage.js';

const FRONT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = process.argv.includes('--demo');
const SO_SHOT = process.argv.includes('--shot');
// Porta zero = o SO escolhe uma livre: dá pra abrir dois previews ao mesmo
// tempo (um aberto pra olhar, outro tirando screenshot) sem colidir.
let porta = 0;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const arq = path.join(FRONT, rel === '/' ? 'crm.html' : rel);
  if (!arq.startsWith(FRONT) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404); res.end('não achei'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});
await new Promise(r => servidor.listen(0, r));
porta = servidor.address().port;

// Painel real (saldo do Serper vem da conta de verdade); a parte de IA só tem
// número se este processo tiver chamado algum LLM — por isso o --demo.
const painel = await painelUso();
if (DEMO) {
  painel.openai.rateLimit = {
    visao: {
      tokensRestantes: 138_400, tokensLimite: 200_000,
      requestsRestantes: 9_910, requestsLimite: 10_000,
      resetTokens: '18s', em: new Date().toISOString(),
    },
  };
  painel.hoje = {
    total: { chamadas: 412, tokens: 3_184_902, buscas: 96, custoUsd: 0.58, fipe: 218, fipe429: 12 },
    linhas: [],
  };
  painel.mes = {
    total: { chamadas: 7_318, tokens: 61_402_115, buscas: 2_140, custoUsd: 11.34 },
    linhas: [
      { provider: 'openai', modelo: 'gpt-4o-mini', operacao: 'visao', chamadas: 6_902, tokens_in: 58_120_400, tokens_out: 402_310, unidades: 6_902, custo_usd: 10.96 },
      { provider: 'openai', modelo: 'gpt-4o-mini', operacao: 'texto', chamadas: 416, tokens_in: 2_390_120, tokens_out: 489_285, unidades: 416, custo_usd: 0.65 },
      { provider: 'serper', modelo: null, operacao: 'busca', chamadas: 2_140, tokens_in: 0, tokens_out: 0, unidades: 2_140, custo_usd: 0 },
      { provider: 'fipe', modelo: null, operacao: 'consulta', resultado: 'ok', chamadas: 4_806, tokens_in: 0, tokens_out: 0, unidades: 4_806, custo_usd: 0 },
      { provider: 'fipe', modelo: null, operacao: 'consulta', resultado: '429', chamadas: 391, tokens_in: 0, tokens_out: 0, unidades: 391, custo_usd: 0 },
    ],
  };
}

const browser = await chromium.launch({ headless: SO_SHOT });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

// O CRM de verdade exige sessão; aqui as rotas de API respondem de mentira.
await page.route('**/api/me', r => r.fulfill({ json: { ok: true, nome: 'Preview', escopo: 'crm', admin: true, usuarioId: 'u1' } }));
await page.route('**/api/usuarios', r => r.fulfill({ json: { ok: true, usuarios: DEMO ? [
  { id: 'u1', login: 'exemplo-admin', nome: '(exemplo) Admin', admin: true, ultimo_acesso: new Date().toISOString() },
  { id: 'u2', login: 'exemplo-consultor', nome: '(exemplo) Consultor', admin: false, ultimo_acesso: null, senha_temporaria: true },
] : [] } }));
await page.route('**/api/pedidos-senha', r => r.fulfill({ json: { ok: true, pedidos: DEMO ? [
  { id: 'p1', login_informado: 'exemplo-consultor', criado_em: new Date().toISOString() },
] : [] } }));
await page.route('**/api/admin/usage*', r => r.fulfill({ json: painel }));

// --aba=usuarios / --aba=inicio pra abrir direto noutra aba.
const aba = (process.argv.find(a => a.startsWith('--aba=')) || '--aba=uso').split('=')[1];
await page.goto(`http://localhost:${porta}/crm.html#${aba}`);
await page.waitForSelector(aba === 'uso' ? '.medidor .numero' : '.aba.ativa');
await page.waitForTimeout(500);

const shot = path.join(FRONT, 'server', 'scripts', 'preview-consumo.png');
await page.screenshot({ path: shot, fullPage: true });
console.log(`screenshot: ${shot}`);
console.log(`saldo Serper (real): ${painel.serper.creditos ?? '—'} créditos`);
if (DEMO) console.log('números de IA: EXEMPLO, não são consumo real');

if (SO_SHOT) {
  await browser.close();
  servidor.close();
  process.exit(0);
}

console.log('navegador aberto — feche a janela quando terminar de olhar.');
await page.waitForEvent('close', { timeout: 0 });
await browser.close();
servidor.close();
process.exit(0);

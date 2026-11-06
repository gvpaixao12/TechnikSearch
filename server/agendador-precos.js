/* Atualização mensal dos preços FIPE, rodando dentro do próprio servidor.
 *
 * A partir do 5º dia útil do mês, de hora em hora: se os preços do mês ainda
 * não foram completados, dispara scripts/refresh-precos-fipe.js --overlay num
 * processo filho (~12,6 mil consultas a 3 s = ~10 h). O filho grava em
 * data/precos-fipe.json (fora do git — ver precos-overlay.js) e é retomável:
 * se cair (deploy, pm2 restart, bloqueio do Cloudflare), a próxima checagem
 * continua de onde parou.
 *
 * Desligado por padrão: só liga com PRECOS_AUTO=1 no .env — pra não sair
 * rodando 10 h de consulta na máquina de desenvolvimento.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerOverlay, mesOrdem } from './precos-overlay.js';
import { clearCatalogCache } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'scripts', 'refresh-precos-fipe.js');
const CHECA_A_CADA_MS = 60 * 60 * 1000;
const DIA_UTIL_ALVO = 5;

// Páscoa (algoritmo de Meeus/Jones/Butcher) — base dos feriados móveis.
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Feriados nacionais + Carnaval e Corpus Christi (ponto facultativo, mas
// mercado/FIPE param). Feriado estadual/municipal fica de fora.
function feriados(ano) {
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']
    .map(md => `${ano}-${md}`);
  const moveis = [-48, -47, -2, 60].map(n => iso(somaDias(p, n)));   // Carnaval seg/ter, Sexta Santa, Corpus Christi
  return new Set([...fixos, ...moveis]);
}

export function quintoDiaUtil(ano, mes /* 0-11 */) {
  const fer = feriados(ano);
  let d = new Date(ano, mes, 1), n = 0;
  for (;;) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !fer.has(iso(d))) n++;
    if (n === DIA_UTIL_ALVO) return d;
    d = somaDias(d, 1);
  }
}

let rodando = false;

async function checar() {
  if (rodando) return;
  const hoje = new Date();
  if (hoje < quintoDiaUtil(hoje.getFullYear(), hoje.getMonth())) return;
  const ov = await lerOverlay();
  const mesCalendario = hoje.getFullYear() * 100 + hoje.getMonth() + 1;
  if (mesOrdem(ov.mesCompleto) >= mesCalendario) return;

  rodando = true;
  console.log(`[precos-auto] iniciando atualização FIPE (5º dia útil já passou; último mês completo: ${ov.mesCompleto || 'nenhum'})`);
  const filho = spawn(process.execPath, [SCRIPT, '--apply', '--overlay'], {
    cwd: path.join(__dirname),
    env: { ...process.env, FIPE_OFICIAL_RATE_MS: process.env.FIPE_OFICIAL_RATE_MS || '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Só o resumo vai pro log do pm2; as linhas de progresso a cada 100 também,
  // que é o que dá pra acompanhar com `pm2 logs technik`.
  filho.stdout.on('data', b => process.stdout.write(`[precos-auto] ${b}`));
  filho.stderr.on('data', b => process.stderr.write(`[precos-auto] ${b}`));
  filho.on('exit', code => {
    rodando = false;
    // Recarrega o catálogo com o overlay novo — mesmo numa rodada parcial, o
    // que já foi atualizado passa a valer.
    clearCatalogCache();
    console.log(`[precos-auto] processo terminou (código ${code}); catálogo será recarregado na próxima busca`);
  });
}

export function iniciarAgendadorPrecos() {
  if (process.env.PRECOS_AUTO !== '1') {
    console.log('[precos-auto] desligado (PRECOS_AUTO != 1)');
    return;
  }
  const h = new Date();
  console.log(`[precos-auto] ligado · 5º dia útil deste mês: ${iso(quintoDiaUtil(h.getFullYear(), h.getMonth()))}`);
  // Primeira checagem 2 min depois de subir, pra não competir com o boot.
  setTimeout(() => { checar().catch(e => console.error('[precos-auto]', e)); }, 2 * 60 * 1000);
  setInterval(() => { checar().catch(e => console.error('[precos-auto]', e)); }, CHECA_A_CADA_MS);
}

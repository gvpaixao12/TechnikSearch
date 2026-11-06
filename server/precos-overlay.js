/* Preços FIPE atualizados NA VPS, por cima do catalog.json do git.
 *
 * Por que um arquivo separado: o catalog.json é versionado (carro novo entra
 * por commit). Se o servidor regravasse ele todo mês, o próximo `git pull` do
 * deploy daria conflito. Então a atualização mensal (agendador-precos.js →
 * scripts/refresh-precos-fipe.js --overlay) grava só os preços aqui, num
 * arquivo fora do git, e o catalog.js aplica por cima ao carregar.
 *
 * Formato: { mesReferencia, atualizadoEm, precos: { "codigoFipe|anoId": { preco, precoTexto, mesReferencia } } }
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OVERLAY_FILE = path.join(__dirname, 'data', 'precos-fipe.json');

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "novembro de 2026" / "novembro/2026 " → 202611. Desconhecido → 0.
export function mesOrdem(s) {
  const m = String(s || '').toLowerCase().trim().match(/^([a-zç]+)\s*(?:de|\/)\s*(\d{4})/);
  if (!m) return 0;
  const i = MESES.indexOf(m[1]);
  return i < 0 ? 0 : Number(m[2]) * 100 + i + 1;
}

export const chavePreco = e => `${e.codigoFipe}|${e.anoId}`;

export async function lerOverlay() {
  try {
    return JSON.parse(await fs.readFile(OVERLAY_FILE, 'utf8'));
  } catch {
    return { mesReferencia: null, atualizadoEm: null, precos: {} };
  }
}

export async function gravarOverlay(ov) {
  const tmp = `${OVERLAY_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ov), 'utf8');
  await fs.rename(tmp, OVERLAY_FILE);   // atômico: o servidor nunca lê arquivo pela metade
}

// Aplica o preço do overlay só quando ele é MAIS NOVO que o do catálogo: se
// um catalog.json recém-commitado já vier com preço mais fresco (rodado na
// máquina local), o overlay velho não pode puxar ele pra trás.
export function aplicaOverlay(entries, ov) {
  let n = 0;
  for (const e of entries) {
    const p = ov.precos?.[chavePreco(e)];
    if (p && mesOrdem(p.mesReferencia) > mesOrdem(e.mesReferencia)) {
      e.preco = p.preco;
      e.precoTexto = p.precoTexto;
      e.mesReferencia = p.mesReferencia;
      n++;
    }
  }
  return n;
}

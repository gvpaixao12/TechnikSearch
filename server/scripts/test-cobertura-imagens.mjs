// Teste de cobertura de imagens LICENCIADAS para modelos 2026 do catálogo.
// Consulta Wikimedia Commons (grátis, sem limite) e CarsXE (sandbox: 100
// chamadas VITALÍCIAS, compartilhadas entre todas as APIs deles), baixa até 3
// fotos por fonte e gera um relatório HTML pra olhar a olho nu.
//
// NÃO mexe no app, no R2 nem no banco. Saída em server/cache/cobertura-imagens/
// (gitignored).
//
//   cd server
//   node scripts/test-cobertura-imagens.mjs              # só Wikimedia (sem gastar nada)
//   CARSXE_API_KEY=... node scripts/test-cobertura-imagens.mjs --carsxe
//   node scripts/test-cobertura-imagens.mjs --carsxe --limite 10
//
// Flags:
//   --carsxe        também consulta CarsXE (1 chamada por modelo; precisa de CARSXE_API_KEY no .env)
//   --limite N      testa só os N primeiros modelos da lista
//   --sem-download  só consulta, não baixa as fotos
//   --visao         passa até 8 candidatas Wikimedia por modelo no gpt-4o-mini (custa ~US$ 0,01/modelo)
//   --so A,B,C      testa só esses modelos (ex.: --so Onix,Nivus,Kardian)
import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'cache', 'cobertura-imagens');
const CATALOG = path.join(__dirname, '..', 'data', 'catalog.json');
const CARSXE_LEDGER = path.join(OUT, 'carsxe-chamadas.json');
const CARSXE_TETO = 90;          // deixa folga das 100 vitalícias
const UA = 'TechnikCoverageTest/1.0 (teste interno)';
const FOTOS_POR_FONTE = 3;

const args = process.argv.slice(2);
const USA_CARSXE = args.includes('--carsxe');
const BAIXA = !args.includes('--sem-download');
const LIMITE = Number(args[args.indexOf('--limite') + 1]) || Infinity;
const VISAO = args.includes('--visao');
const SO = args.includes('--so') ? String(args[args.indexOf('--so') + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
const VISAO_CANDIDATAS = 8;

// ─── Modelos de teste ─────────────────────────────────────────────────────────
// fipe = como aparece no catálogo (marca + 1º token do modelo); busca = nome
// "de mundo" usado nas APIs. Mistura proposital: só-Brasil × globais.
const MODELOS = [
  // Só Brasil / América Latina, onde a cobertura deve ser fraca
  { fipe: ['VW - VolksWagen', 'Tera'],     make: 'Volkswagen', model: 'Tera',        br: true },
  { fipe: ['VW - VolksWagen', 'Nivus'],    make: 'Volkswagen', model: 'Nivus',       br: true },
  { fipe: ['VW - VolksWagen', 'Saveiro'],  make: 'Volkswagen', model: 'Saveiro',     br: true },
  { fipe: ['Fiat', 'Strada'],              make: 'Fiat',       model: 'Strada',      br: true },
  { fipe: ['Fiat', 'PULSE'],               make: 'Fiat',       model: 'Pulse',       br: true },
  { fipe: ['Fiat', 'Fastback'],            make: 'Fiat',       model: 'Fastback',    br: true },
  { fipe: ['Fiat', 'ARGO'],                make: 'Fiat',       model: 'Argo',        br: true },
  { fipe: ['Fiat', 'MOBI'],                make: 'Fiat',       model: 'Mobi',        br: true },
  { fipe: ['Fiat', 'Titano'],              make: 'Fiat',       model: 'Titano',      br: true },
  { fipe: ['Renault', 'Kardian'],          make: 'Renault',    model: 'Kardian',     br: true },
  { fipe: ['Renault', 'KWID'],             make: 'Renault',    model: 'Kwid',        br: true },
  { fipe: ['Renault', 'Boreal'],           make: 'Renault',    model: 'Boreal',      br: true },
  { fipe: ['Citroën', 'BASALT'],           make: 'Citroen',    model: 'Basalt',      br: true },
  { fipe: ['GM - Chevrolet', 'ONIX'],      make: 'Chevrolet',  model: 'Onix',        br: true },
  { fipe: ['GM - Chevrolet', 'MONTANA'],   make: 'Chevrolet',  model: 'Montana',     br: true },
  { fipe: ['GM - Chevrolet', 'SPIN'],      make: 'Chevrolet',  model: 'Spin',        br: true },
  { fipe: ['Hyundai', 'HB20'],             make: 'Hyundai',    model: 'HB20',        br: true },
  { fipe: ['Nissan', 'Kait'],              make: 'Nissan',     model: 'Kait',        br: true },
  { fipe: ['RAM', 'RAMPAGE'],              make: 'Ram',        model: 'Rampage',     br: true },
  // Globais, onde a cobertura deve ser boa
  { fipe: ['Toyota', 'Corolla'],           make: 'Toyota',     model: 'Corolla Cross' },
  { fipe: ['Toyota', 'Hilux'],             make: 'Toyota',     model: 'Hilux' },
  { fipe: ['Jeep', 'COMPASS'],             make: 'Jeep',       model: 'Compass' },
  { fipe: ['Jeep', 'Renegade'],            make: 'Jeep',       model: 'Renegade' },
  { fipe: ['Hyundai', 'Creta'],            make: 'Hyundai',    model: 'Creta' },
  { fipe: ['VW - VolksWagen', 'T-Cross'],  make: 'Volkswagen', model: 'T-Cross' },
  { fipe: ['GM - Chevrolet', 'TRACKER'],   make: 'Chevrolet',  model: 'Tracker' },
  { fipe: ['Ford', 'Ranger'],              make: 'Ford',       model: 'Ranger' },
  { fipe: ['Nissan', 'KICKS'],             make: 'Nissan',     model: 'Kicks' },
  { fipe: ['Honda', 'HR-V'],               make: 'Honda',      model: 'HR-V' },
  { fipe: ['BYD', 'Dolphin'],              make: 'BYD',        model: 'Dolphin' },
  { fipe: ['GWM', 'Haval'],                make: 'Haval',      model: 'H6' },
  { fipe: ['Caoa Chery', 'Tiggo'],         make: 'Chery',      model: 'Tiggo 7' },
];

// ─── Licenças ────────────────────────────────────────────────────────────────
// Comercial OK = domínio público, CC0, CC BY, CC BY-SA. Fora: NC, ND, "fair use",
// copyright, ou qualquer coisa que a gente não reconheça (honestidade > volume).
function classificaLicenca(nome = '') {
  const s = nome.toLowerCase();
  if (!s) return { ok: false, motivo: 'sem licença' };
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|fair use|copyright/.test(s)) return { ok: false, motivo: 'restrita' };
  if (/public domain|^pd\b|cc0|cc[- ]by(-sa)?[- ]?\d|cc[- ]by(-sa)?$/.test(s)) return { ok: true, motivo: '' };
  return { ok: false, motivo: 'não reconhecida' };
}

const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = s => norm(s).replace(/ /g, '-');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Wikimedia Commons ───────────────────────────────────────────────────────
async function buscaWikimedia({ make, model }) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search', gsrnamespace: '6', gsrlimit: '40',
    gsrsearch: `intitle:"${model}" ${make} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800',
  });
  let res;
  for (let t = 0; t < 3; t++) {
    res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 429) break;
    await sleep(4000 * (t + 1));
  }
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`);
  const json = await res.json();
  const modelTok = norm(model).split(' ');
  const out = [];
  for (const p of Object.values(json?.query?.pages || {})) {
    const ii = p.imageinfo?.[0];
    if (!ii?.url || !/^image\/(jpeg|png|webp)$/i.test(ii.mime || '') || (ii.width || 0) < 800) continue;
    // Título tem que citar o modelo inteiro ("Tiggo 7", não só "Tiggo")
    const t = ` ${norm(p.title)} `;
    if (!modelTok.every(w => t.includes(` ${w} `) || t.includes(` ${w}`))) continue;
    // Carro de corrida com carroceria do modelo (TC2000, Stock Car...) não serve
    if (/tc ?2000|stock ?car|rally|rali|racing|race|carrera|turismo carretera|\btcr\b|super ?tc|copa /i.test(p.title)) continue;
    // Foto principal é do exterior: interior/motor/painel ficam de fora
    if (/interior|dashboard|cockpit|engine|motor\b|painel|trunk|porta-?malas/i.test(p.title)) continue;
    // Nome "…-2048x1152.webp" = imagem copiada de site (quase sempre foto de
    // imprensa da montadora subida no Commons com licença falsa)
    if (/-\d{3,4}x\d{3,4}\.\w+$/i.test(p.title)) continue;
    const md = ii.extmetadata || {};
    const licenca = stripHtml(md.LicenseShortName?.value);
    // Ano: o do título ("Nivus ... 2022.jpg") costuma ser o ano-modelo, e vale
    // mais que a data da foto. NUNCA usar md.DateTime: é a data de modificação
    // do arquivo no Commons, e marcava foto de 2022 como "2026".
    const anoDe = s => Number((String(s || '').match(/\b(19[89]\d|20[0-3]\d)\b/) || [])[0]) || null;
    const anoFoto = anoDe(p.title) || anoDe(stripHtml(md.DateTimeOriginal?.value));
    out.push({
      fonte: 'wikimedia',
      titulo: p.title.replace(/^File:/, ''),
      url: ii.url,
      thumb: ii.thumburl || ii.url,
      pagina: ii.descriptionurl,
      largura: ii.width,
      licenca,
      licencaOk: classificaLicenca(licenca),
      autor: stripHtml(md.Artist?.value).slice(0, 120),
      anoFoto,
    });
  }
  // Mais recentes primeiro: pra 2026, foto de 2015 provavelmente é outra geração
  out.sort((a, b) => (b.anoFoto || 0) - (a.anoFoto || 0));
  return out;
}

// ─── CarsXE ──────────────────────────────────────────────────────────────────
async function lerLedger() {
  try { return JSON.parse(await fs.readFile(CARSXE_LEDGER, 'utf8')); } catch { return { chamadas: 0, log: [] }; }
}
async function buscaCarsXE({ make, model }, ledger) {
  if (ledger.chamadas >= CARSXE_TETO) throw new Error(`teto local de ${CARSXE_TETO} chamadas atingido (sandbox = 100 vitalícias)`);
  const params = new URLSearchParams({
    key: process.env.CARSXE_API_KEY, make, model, year: '2026',
    license: 'ModifyCommercially', angle: 'front', format: 'json',
  });
  ledger.chamadas++;
  ledger.log.push({ quando: new Date().toISOString(), make, model });
  await fs.writeFile(CARSXE_LEDGER, JSON.stringify(ledger, null, 2));   // conta ANTES: crédito some mesmo com erro
  const res = await fetch(`https://api.carsxe.com/images?${params}`, { signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`CarsXE HTTP ${res.status} ${json.message || json.error || ''}`.trim());
  return (json.images || []).map(im => ({
    fonte: 'carsxe',
    titulo: im.contextLink ? new URL(im.contextLink).hostname : '',
    url: im.link,
    thumb: im.thumbnailLink || im.link,
    pagina: im.contextLink,
    largura: Number(im.width) || null,
    // O filtro do CarsXE é um rótulo de busca e "não concede licença": tem que conferir na página de origem.
    licenca: 'filtro ModifyCommercially (conferir na origem)',
    licencaOk: { ok: null, motivo: 'conferir' },
    autor: '',
    anoFoto: null,
  }));
}

// ─── Visão (gpt-4o-mini) ─────────────────────────────────────────────────────
// Prompt PRÓPRIO do teste, derivado do portão de produção (imageValidator.js),
// com três diferenças pro Wikimedia:
//   1. placa de vizinho (AR/UY/PY/CL...) NÃO reprova: lá vende o mesmo carro, e
//      é de onde vêm as melhores fotos do Commons;
//   2. carro modificado/adesivado/de corrida/em evento reprova (Onix de anime);
//   3. cara de foto oficial de imprensa reprova (licença provavelmente falsa).
let _openai;
async function avaliaComVisao(m, candidatas) {
  _openai ??= new OpenAI({ apiKey: process.env.VISION_API_KEY || process.env.LLM_API_KEY });
  // Manda base64: o fetcher da OpenAI às vezes leva 403 do upload.wikimedia.org
  const imgs = [];
  for (const c of candidatas) {
    try {
      const r = await fetch(c.thumb, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const mime = r.headers.get('content-type') || 'image/jpeg';
      imgs.push({ c, url: `data:${mime};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` });
    } catch { /* pula */ }
  }
  if (!imgs.length) return [];
  // UMA foto por chamada: com 8 no mesmo lote o gpt-4o-mini trocava os motivos
  // entre as fotos (o adesivo do Argo 7 ia parar no Argo 1, que era limpo).
  const texto =
`Vou te mostrar UMA foto. Ela pode virar a foto ILUSTRATIVA de um modelo de carro numa ferramenta de venda: o cliente olha e pensa "é esse o carro".

CARRO ALVO: ${m.make} ${m.model}, a geração VENDIDA NOVA NO BRASIL em 2026 (incluindo a reestilização vigente).

Reprovar é um resultado normal. Descreva só o que você REALMENTE vê nesta foto.

REPROVE se QUALQUER item for verdade:
- Marca/modelo diferentes, ou carroceria diferente da vendida no Brasil (ex.: sedã chinês no lugar do hatch brasileiro).
- GERAÇÃO ou FASE ERRADA: farol, grade, para-choque de antes da reestilização atual ou de outra geração REPROVAM.
- Versão de outro mercado com visual diferente do brasileiro, ou volante à direita.
- CARRO MODIFICADO: adesivo/envelopamento/pintura artística (anime, patrocinadores), rebaixado, rodas/aerofólios não originais, carro de corrida ou de rally, viatura de polícia, táxi, ambulância.
- CARRO EM EVENTO/LOJA: salão, exposição, convenção, showroom de concessionária, com banners, faixas ou logos de loja no fundo.
- CARA DE FOTO OFICIAL DE IMPRENSA/MARKETING: estúdio, fundo infinito, iluminação profissional de catálogo, pista vazia com carro posado de fábrica, render. (Queremos foto de rua tirada por uma pessoa comum.)
- Carro cortado, muito obstruído, danificado, sujo demais, muito escuro ou desfocado; foto só de detalhe/interior/motor.
- Texto, marca d'água, moldura ou montagem sobre a imagem.

NÃO reprove por: placa de país vizinho (Argentina, Uruguai, Paraguai, Chile etc.) — lá se vende o mesmo carro; fundo de rua com outros carros; cor.

Em dúvida, REPROVE.

Retorne SÓ este JSON:
{"o_que_vejo":"descrição curta da cena","ok":true,"anos":[2024,2026],"nota":8,"motivo":""}
- "o_que_vejo": 1 frase sobre o carro e o fundo, ANTES de decidir.
- "anos": primeiro e último ano em que ESSA fase do carro foi vendida nova no Brasil (obrigatório se ok=true).
- "nota": 0 a 10, o quanto a foto é limpa e representativa (só se ok=true).
- "motivo": 2 a 5 palavras em português, só se ok=false.`;
  const julga = async ({ url }) => {
    for (let t = 0; ; t++) {
      try {
        const resp = await _openai.chat.completions.create({
          model: process.env.VISION_MODEL || 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 300,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [{ type: 'text', text: texto }, { type: 'image_url', image_url: { url } }] }],
        });
        try { return JSON.parse(resp.choices[0].message.content); } catch { return { ok: false, motivo: 'resposta inválida' }; }
      } catch (e) {
        if (t >= 2 || e.status === 429 && /quota/i.test(e.message)) throw e;   // sem crédito: não insiste
        await sleep(3000 * (t + 1));
      }
    }
  };
  // 4 em paralelo: rápido sem encostar no limite de tokens/min do tier 1
  const vereditos = [];
  for (let k = 0; k < imgs.length; k += 4) vereditos.push(...await Promise.all(imgs.slice(k, k + 4).map(julga)));
  return imgs.map(({ c }, k) => {
    const f = vereditos[k] || { ok: false, motivo: 'sem veredito' };
    let ok = f.ok === true, motivo = f.motivo || '';
    // Portão de ano em código (mesma ideia do app): a fase declarada tem que chegar a 2026
    const [ini, fim] = Array.isArray(f.anos) ? f.anos.map(Number) : [];
    if (ok && Number.isFinite(fim) && fim < 2025) { ok = false; motivo = `fase ${ini}-${fim}, não é a de 2026`; }
    return { ...c, visao: { ok, motivo, anos: f.anos, nota: Number(f.nota) || 0, viu: f.o_que_vejo || '' } };
  });
}

// ─── Download ────────────────────────────────────────────────────────────────
// Wikimedia: thumb de 800px (o original pode ter 20 MB). CarsXE: a thumb é uma
// miniatura de ~150px do Google, então vai no original primeiro.
async function baixa(item, dir, nome) {
  const ordem = item.fonte === 'wikimedia' ? [item.thumb, item.url] : [item.url, item.thumb];
  for (const u of ordem) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const ext = (r.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
      const arq = `${nome}.${ext}`;
      await fs.writeFile(path.join(dir, arq), Buffer.from(await r.arrayBuffer()));
      return arq;
    } catch { /* tenta a próxima URL */ }
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────
await fs.mkdir(OUT, { recursive: true });
const catalogo = JSON.parse(await fs.readFile(CATALOG, 'utf8')).entries.filter(e => e.ano >= 2026);

if (USA_CARSXE && !process.env.CARSXE_API_KEY) {
  console.error('--carsxe pedido mas CARSXE_API_KEY não está no .env. Rodando só Wikimedia.');
}
const comCarsXE = USA_CARSXE && !!process.env.CARSXE_API_KEY;
const ledger = await lerLedger();
if (comCarsXE) console.log(`CarsXE: ${ledger.chamadas} chamadas já gastas neste PC (teto local ${CARSXE_TETO}).\n`);

const resultados = [];
const lista = SO ? MODELOS.filter(m => SO.some(s => norm(m.model).includes(norm(s)))) : MODELOS;
for (const m of lista.slice(0, LIMITE)) {
  const [fMarca, fTok] = m.fipe;
  const noCat = catalogo.filter(e => e.marca === fMarca && norm(e.modelo).startsWith(norm(fTok))).length;
  const r = { ...m, versoes2026: noCat, wikimedia: [], carsxe: [], erros: [] };

  try { r.wikimedia = await buscaWikimedia(m); } catch (e) { r.erros.push(`wikimedia: ${e.message}`); }
  await sleep(1500);
  if (comCarsXE) {
    try { r.carsxe = await buscaCarsXE(m, ledger); } catch (e) { r.erros.push(`carsxe: ${e.message}`); }
  }

  const wikiOk = r.wikimedia.filter(i => i.licencaOk.ok);
  const wikiRecente = wikiOk.filter(i => (i.anoFoto || 0) >= 2024);
  let aprovadasVisao = null;
  if (VISAO && wikiOk.length) {
    // Recentes primeiro (ordem do buscaWikimedia); o resto completa as 8
    const cand = [...wikiRecente, ...wikiOk.filter(i => !wikiRecente.includes(i))].slice(0, VISAO_CANDIDATAS);
    try {
      r.visao = await avaliaComVisao(m, cand);
      aprovadasVisao = r.visao.filter(i => i.visao.ok).sort((a, b) => b.visao.nota - a.visao.nota);
    } catch (e) { r.erros.push(`visão: ${e.message}`); }
  }
  r.resumo = {
    visaoAvaliadas: r.visao?.length ?? null,
    visaoAprovadas: aprovadasVisao?.length ?? null,
    wikiTotal: r.wikimedia.length,
    wikiComercial: wikiOk.length,
    wikiComercialRecente: wikiRecente.length,
    carsxe: r.carsxe.length,
  };

  if (BAIXA) {
    const dir = path.join(OUT, slug(`${m.make} ${m.model}`));
    await fs.mkdir(dir, { recursive: true });
    const wikiEscolhidas = aprovadasVisao ?? (wikiRecente.length ? wikiRecente : wikiOk);
    const escolhidas = [...wikiEscolhidas.slice(0, FOTOS_POR_FONTE), ...r.carsxe.slice(0, FOTOS_POR_FONTE)];
    for (const [i, it] of escolhidas.entries()) {
      it.arquivo = await baixa(it, dir, `${it.fonte}-${i + 1}`);
      if (it.arquivo) it.arquivo = `${path.basename(dir)}/${it.arquivo}`;
    }
    r.baixadas = escolhidas;
  }

  const s = r.resumo;
  console.log(
    `${(m.br ? '[BR] ' : '     ') + `${m.make} ${m.model}`.padEnd(24)}`
    + ` cat:${String(noCat).padStart(3)}`
    + `  wiki: ${String(s.wikiComercial).padStart(2)} comerciais (${s.wikiComercialRecente} de 2024+) / ${s.wikiTotal} total`
    + (s.visaoAvaliadas != null ? `  visão: ${s.visaoAprovadas}/${s.visaoAvaliadas} aprovadas` : '')
    + (comCarsXE ? `  carsxe: ${s.carsxe}` : '')
    + (r.erros.length ? `  ⚠ ${r.erros.join('; ')}` : ''),
  );
  resultados.push(r);
  await gravaRelatorio();   // a cada modelo: Ctrl+C no meio não perde o que já gastou de CarsXE
}

const cont = await gravaRelatorio();
console.log(`\n${cont.achou} achou · ${cont['só antiga']} só foto antiga · ${cont['não achou']} não achou`);
console.log(`Relatório: ${path.join(OUT, 'relatorio.html')}`);

// ─── Relatório ───────────────────────────────────────────────────────────────
async function gravaRelatorio() {
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const veredito = r => r.resumo.visaoAprovadas != null
  ? (r.resumo.visaoAprovadas ? 'achou' : 'não achou')
  : r.resumo.wikiComercialRecente || r.resumo.carsxe ? 'achou'
  : r.resumo.wikiComercial ? 'só antiga' : 'não achou';
const cont = { achou: 0, 'só antiga': 0, 'não achou': 0 };
for (const r of resultados) cont[veredito(r)]++;

const cards = resultados.map(r => `
<section class="${veredito(r).replace(/\W/g, '')}">
  <h2>${esc(r.make)} ${esc(r.model)} ${r.br ? '<span class="tag">só BR</span>' : ''}
    <small>${esc(veredito(r))} · ${r.versoes2026} versões 2026 no catálogo</small></h2>
  <p>Wikimedia: <b>${r.resumo.wikiComercial}</b> com licença comercial (${r.resumo.wikiComercialRecente} de 2024+), ${r.resumo.wikiTotal} no total
   ${comCarsXE ? ` · CarsXE: <b>${r.resumo.carsxe}</b>` : ''}${r.erros.length ? ` · <span class="err">${esc(r.erros.join('; '))}</span>` : ''}</p>
  <div class="grid">${(r.baixadas || []).filter(i => i.arquivo).map(i => `
    <figure><a href="${esc(i.pagina)}" target="_blank"><img src="${esc(i.arquivo)}" loading="lazy"></a>
      <figcaption><b>${esc(i.fonte)}</b> · ${esc(i.licenca)}${i.anoFoto ? ` · foto de ${i.anoFoto}` : ''}${i.visao ? ` · <b style="color:#2e9e5b">aprovada, nota ${i.visao.nota}</b>` : ''}<br>${esc(i.autor || i.titulo)}</figcaption></figure>`).join('')}
  </div>
  ${r.visao ? `<details><summary>Reprovadas pela visão (${r.visao.filter(i => !i.visao.ok).length})</summary><div class="grid">${r.visao.filter(i => !i.visao.ok).map(i => `
    <figure class="rep"><a href="${esc(i.pagina)}" target="_blank"><img src="${esc(i.thumb)}" loading="lazy"></a>
      <figcaption><b style="color:#c0392b">${esc(i.visao.motivo)}</b><br>${esc(i.titulo)}</figcaption></figure>`).join('')}</div></details>` : ''}
</section>`).join('');

const html = `<!doctype html><meta charset="utf-8"><title>Cobertura de imagens 2026</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;background:#f6f6f4;color:#222}
section{background:#fff;border-left:6px solid #ccc;padding:12px 16px;margin:12px 0;border-radius:6px}
section.achou{border-color:#2e9e5b}section.sóantiga,section.santiga{border-color:#d9a400}section.nãoachou,section.noachou{border-color:#c0392b}
h2{margin:0 0 4px;font-size:17px}h2 small{font-weight:400;color:#777;margin-left:8px}
.tag{font-size:11px;background:#222;color:#fff;padding:1px 6px;border-radius:4px;vertical-align:middle}
.grid{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0;width:240px}
img{width:240px;height:160px;object-fit:cover;border-radius:4px;background:#eee}
figcaption{font-size:11px;color:#555;line-height:1.35}.err{color:#c0392b}
</style>
<h1>Cobertura de imagens: modelos 2026</h1>
<p>Gerado em ${new Date().toLocaleString('pt-BR')} · ${resultados.length} modelos ·
<b style="color:#2e9e5b">${cont.achou} achou</b> · <b style="color:#b08600">${cont['só antiga']} só foto antiga</b> ·
<b style="color:#c0392b">${cont['não achou']} não achou</b>${comCarsXE ? ` · CarsXE: ${ledger.chamadas}/100 chamadas gastas` : ' · CarsXE não consultado'}</p>
<p style="color:#777">"Achou" = foto Wikimedia com licença comercial tirada em 2024+, ou resultado do CarsXE.
Foto mais antiga pode ser de outra geração. A licença do CarsXE é só um filtro de busca: tem que conferir na página de origem.</p>
${cards}`;

await fs.writeFile(path.join(OUT, 'relatorio.html'), html);
await fs.writeFile(path.join(OUT, 'relatorio.json'), JSON.stringify(resultados, null, 2));
return cont;
}

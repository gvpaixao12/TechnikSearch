import { chromium } from 'playwright';

const API = 'http://localhost:3001';

// Defaults do form: budget=[180,320], yearMin=2022, types=['suv'], fuels=['flex','hybrid'],
// lifestyle=['family','travel'], priorities=['safety','comfort','economy']
// Cada cenário descreve mudanças a partir desse default.

const SCENARIOS = [
  {
    name: 'A · Hatch+Coupé R$180-320k flex/gas (caso real)',
    clientName: 'Rafael Paixão',
    clientSegment: 'Solteiro',
    types: ['hatch', 'coupe'],          // remove suv, adiciona hatch+coupe
    fuels: ['flex', 'gas'],             // remove hybrid, adiciona gas
    lifestyle: [],                       // limpa
    priorities: ['design', 'tech', 'safety'],
    expect: { minResults: 6, mustNotInclude: ['eletrico'] },
  },
  {
    name: 'B · SUV familiar R$130-200k flex/hybrid',
    clientName: 'Mariana Coutinho',
    clientSegment: 'Família 4+1',
    types: ['suv'],
    fuels: ['flex', 'hybrid'],
    lifestyle: ['family', 'travel'],
    priorities: ['safety', 'comfort'],
    budget: [130, 200],                 // requer ajuste de slider
    expect: { minResults: 8 },
  },
  {
    name: 'C · Picape diesel R$200-350k',
    clientName: 'Pedro Teste',
    clientSegment: 'Construtor',
    types: ['pickup'],
    fuels: ['diesel'],
    lifestyle: ['work', 'offroad'],
    priorities: ['safety'],
    budget: [200, 350],
    expect: { minResults: 5, mustNotInclude: ['flex', 'gasolina'] },
  },
  {
    name: 'D · Hatch usado R$100-150k anoMin=2018 (testa descontinuados)',
    clientName: 'João Teste',
    clientSegment: 'Primeiro carro premium',
    types: ['hatch'],
    fuels: ['flex', 'gas'],
    lifestyle: ['urban'],
    priorities: ['economy', 'design'],
    budget: [100, 150],
    yearMin: 2018,
    expect: { minResults: 6 },
  },
  {
    name: 'E · SUV elétrico premium R$300-500k (nicho, espera-se poucos)',
    clientName: 'Camila Teste',
    clientSegment: 'Eco-friendly executiva',
    types: ['suv'],
    fuels: ['electric'],
    lifestyle: ['urban'],
    priorities: ['tech', 'design'],
    budget: [300, 500],
    yearMin: 2022,
    expect: { minResults: 1, mustNotInclude: ['flex', 'gasolina', 'diesel'] },
  },
  {
    name: 'F · Sedan híbrido família R$150-250k (nicho médio)',
    clientName: 'Roberto Teste',
    clientSegment: 'Família 4',
    types: ['sedan'],
    fuels: ['hybrid', 'flex'],
    lifestyle: ['family'],
    priorities: ['safety', 'economy'],
    budget: [150, 250],
    yearMin: 2022,
    expect: { minResults: 3 },
  },
  {
    name: 'G · SUV ou Picape diesel R$250-400k (multi-tipo)',
    clientName: 'Marcelo Teste',
    clientSegment: 'Empresário rural',
    types: ['suv', 'pickup'],
    fuels: ['diesel'],
    lifestyle: ['offroad', 'work'],
    priorities: ['safety'],
    budget: [250, 400],
    yearMin: 2022,
    expect: { minResults: 5, mustNotInclude: ['flex', 'gasolina'] },
  },
  {
    name: 'H · Tudo mundo (universo total: todos tipos, todos combs, R$50-600k 2018+)',
    clientName: 'Universo',
    clientSegment: 'Maior pool possível',
    types: ['hatch', 'sedan', 'suv', 'pickup', 'coupe'],
    fuels: ['flex', 'gas', 'diesel', 'hybrid', 'plugin', 'electric'],
    lifestyle: [],
    priorities: [],
    budget: [50, 600],
    yearMin: 2018,
    expect: { minResults: 10 },
  },
  {
    name: 'I · Hatch urbano R$60-90k 2020+ (compacto economia)',
    clientName: 'Letícia Teste',
    clientSegment: 'Universitária primeiro carro',
    types: ['hatch'],
    fuels: ['flex', 'gas'],
    lifestyle: ['urban'],
    priorities: ['economy'],
    budget: [60, 90],
    yearMin: 2020,
    expect: { minResults: 6 },
  },
  {
    name: 'J · SUV premium R$200-280k 2023+ (família travel comfort)',
    clientName: 'Patrícia Teste',
    clientSegment: 'Família 4 viagens longas',
    types: ['suv'],
    fuels: ['flex', 'gas', 'hybrid'],
    lifestyle: ['family', 'travel'],
    priorities: ['comfort', 'tech'],
    budget: [200, 280],
    yearMin: 2023,
    expect: { minResults: 5 },
  },
];

const TYPE_CHIP_LABELS = { hatch: 'Hatch', sedan: 'Sedan', suv: 'SUV', pickup: 'Picape', coupe: 'Coupé', minivan: 'Minivan' };
const FUEL_CHIP_LABELS = { flex: 'Flex', gas: 'Gasolina', diesel: 'Diesel', hybrid: 'Híbrido', plugin: 'Híbrido plug-in', electric: 'Elétrico' };
const LIFESTYLE_CHIP_LABELS = { family: 'Família', urban: 'Cidade', travel: 'Viagens longas', work: 'Trabalho', offroad: 'Estradas de terra', sport: 'Esportivo' };
const PRIORITY_CHIP_LABELS = { safety: 'Segurança', comfort: 'Conforto', economy: 'Economia', tech: 'Tecnologia', design: 'Design', resale: 'Revenda' };

function trunc(s, n) { return !s ? '' : (s.length > n ? s.slice(0, n - 1) + '…' : s); }

async function setOverlay(page, text, color = '#19193A') {
  await page.evaluate(({ text, color }) => {
    let el = document.getElementById('__test_overlay__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__test_overlay__';
      el.style.cssText = `
        position:fixed;bottom:12px;left:12px;z-index:99999;
        background:${color};color:#fff;padding:14px 18px;
        font-family:system-ui;font-size:14px;font-weight:600;
        border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);
        max-width:380px;line-height:1.4;pointer-events:none;
      `;
      document.body.appendChild(el);
    }
    el.style.background = color;
    el.innerHTML = text;
  }, { text, color });
}

async function fillForm(page, sc) {
  // Espera form
  await page.waitForSelector('text=Briefing 360°', { timeout: 10000 });
  await page.waitForTimeout(300);

  // Nome do cliente
  if (sc.clientName) {
    const nameInput = page.locator('input.tk-input').first();
    await nameInput.fill(sc.clientName);
    await page.waitForTimeout(150);
  }
  if (sc.clientSegment) {
    const segInput = page.locator('input.tk-input').nth(1);
    await segInput.fill(sc.clientSegment);
    await page.waitForTimeout(150);
  }

  // Tipos: deseleciona os atuais, seleciona os pedidos
  // Como o estado padrão é ['suv'], se sc.types não inclui 'suv', clico em SUV pra desativar.
  const currentDefaultTypes = ['suv'];
  for (const t of currentDefaultTypes) {
    if (!sc.types.includes(t)) {
      await page.locator(`button.q2__type:has-text("${TYPE_CHIP_LABELS[t]}")`).click();
      await page.waitForTimeout(120);
    }
  }
  for (const t of sc.types) {
    if (!currentDefaultTypes.includes(t)) {
      await page.locator(`button.q2__type:has-text("${TYPE_CHIP_LABELS[t]}")`).click();
      await page.waitForTimeout(120);
    }
  }

  // Combustíveis: default ['flex','hybrid']
  const currentDefaultFuels = ['flex', 'hybrid'];
  for (const f of currentDefaultFuels) {
    if (!sc.fuels.includes(f)) {
      await page.locator(`button.tk-chip:has-text("${FUEL_CHIP_LABELS[f]}")`).first().click();
      await page.waitForTimeout(120);
    }
  }
  for (const f of sc.fuels) {
    if (!currentDefaultFuels.includes(f)) {
      await page.locator(`button.tk-chip:has-text("${FUEL_CHIP_LABELS[f]}")`).first().click();
      await page.waitForTimeout(120);
    }
  }

  // Lifestyle: default ['family','travel']
  const currentDefaultLifestyle = ['family', 'travel'];
  for (const l of currentDefaultLifestyle) {
    if (!sc.lifestyle.includes(l)) {
      await page.locator(`button.tk-chip:has-text("${LIFESTYLE_CHIP_LABELS[l]}")`).click();
      await page.waitForTimeout(120);
    }
  }
  for (const l of sc.lifestyle) {
    if (!currentDefaultLifestyle.includes(l)) {
      await page.locator(`button.tk-chip:has-text("${LIFESTYLE_CHIP_LABELS[l]}")`).click();
      await page.waitForTimeout(120);
    }
  }

  // Prioridades: default ['safety','comfort','economy']
  const currentDefaultPriorities = ['safety', 'comfort', 'economy'];
  for (const p of currentDefaultPriorities) {
    if (!sc.priorities.includes(p)) {
      await page.locator(`button.tk-chip:has-text("${PRIORITY_CHIP_LABELS[p]}")`).click();
      await page.waitForTimeout(120);
    }
  }
  for (const p of sc.priorities) {
    if (!currentDefaultPriorities.includes(p)) {
      await page.locator(`button.tk-chip:has-text("${PRIORITY_CHIP_LABELS[p]}")`).click();
      await page.waitForTimeout(120);
    }
  }

  // Budget — DualRange usa 2 inputs type=range, ambos dentro do mesmo container (.q2__field)
  if (sc.budget) {
    const [lo, hi] = sc.budget;
    // Pega os 2 inputs range dentro da seção de orçamento (são os 2 primeiros do form)
    const ranges = page.locator('input[type="range"]');
    // ranges[0] = lo do budget, ranges[1] = hi do budget, ranges[2] = trunk (se !trunkAny), ranges[3] = yearMin
    // Como o default tem trunkAny=true, a ordem é: budget-lo, budget-hi, yearMin
    await ranges.nth(0).evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, lo);
    await page.waitForTimeout(150);
    await ranges.nth(1).evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, hi);
    await page.waitForTimeout(150);
  }

  // yearMin
  if (sc.yearMin) {
    const ranges = page.locator('input[type="range"]');
    // Posição depende de trunkAny — assumindo default trunkAny=true, é o 3º range (índice 2)
    await ranges.last().evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, sc.yearMin);
    await page.waitForTimeout(150);
  }
}

function summarize(sc, result, dt) {
  console.log('\n' + '─'.repeat(80));
  console.log(`▶ ${sc.name}   (${dt}s)`);
  console.log('─'.repeat(80));

  if (!result.ok) {
    console.log(`   ❌ ok:false`);
    console.log(`   reason: ${result.reason}`);
    return { issues: [`backend:${result.reason}`] };
  }

  const d = result.diagnostico || {};
  if (d.catalogTotal !== undefined) {
    // Pipeline novo (catálogo)
    const dp = d.descartesPorEtapa || {};
    console.log(`   funil: catálogo=${d.catalogTotal} → pool=${d.catalogPool} → curadorLeve=${d.curadorLeveSelecionou ?? '-'} → vendedor=${d.vendedorRetornou}`);
    console.log(`   descartes do catálogo: ano=${dp.ano||0} tipo=${dp.tipo||0} comb=${dp.comb||0} orçamento=${dp.orcamento||0} sem-preço=${dp.semPreco||0}`);
    if (d.builtAt) console.log(`   catálogo built: ${d.builtAt}`);
  } else {
    // Pipeline legado
    console.log(`   funil: curador=${d.curadorSugeriu} fipe=${d.fipeResolvidos} fipe-falhou=${d.fipeFalhou} apósAno=${d.aposFiltroAno ?? '-'} apósTipo=${d.aposFiltroTipo ?? '-'} apósComb=${d.aposFiltroComb ?? '-'} vendedor=${d.vendedorRetornou}`);
  }
  if (d.descartadosFipe?.length) {
    console.log(`   FIPE descartou (${d.descartadosFipe.length}):`);
    d.descartadosFipe.slice(0, 12).forEach(f => console.log(`     - ${(f.input?.marca||'?').padEnd(14)} ${(f.input?.modelo||'?').padEnd(36)} ${f.input?.ano||'?'}    motivo: ${f.reason}`));
  }
  if (d.duplicadosDetalhe?.length) {
    console.log(`   FIPE duplicados (${d.duplicadosDetalhe.length}) — LLM gerou variações que casam com mesmo código FIPE:`);
    d.duplicadosDetalhe.slice(0, 12).forEach(d2 => console.log(`     - LLM: ${d2.input.marca} ${d2.input.modelo} (${d2.input.ano}) → casou com: ${d2.casouCom.marca} ${d2.casouCom.modelo} (${d2.casouCom.ano})`));
  }
  if (d.descartadosPorAno?.length) {
    console.log(`   ANO descartou (${d.descartadosPorAno.length}):`);
    d.descartadosPorAno.forEach(x => console.log(`     - ${x.marca} ${x.modelo} (${x.ano})`));
  }
  if (d.descartadosPorTipo?.length) {
    console.log(`   TIPO descartou (${d.descartadosPorTipo.length}):`);
    d.descartadosPorTipo.forEach(x => console.log(`     - ${x.marca} ${x.modelo} (${x.ano}) tipo=${x.tipoLLM} corrigido=${x.tipoCorrigido||'-'}`));
  }
  if (d.descartadosPorCombustivel?.length) {
    console.log(`   COMB descartou (${d.descartadosPorCombustivel.length}):`);
    d.descartadosPorCombustivel.forEach(x => console.log(`     - ${x.marca} ${x.modelo} (${x.ano}) comb=${x.combustivel}`));
  }
  if (d.foraDoOrcamento?.length) {
    console.log(`   ORÇAMENTO descartou (${d.foraDoOrcamento.length}):`);
    d.foraDoOrcamento.slice(0, 12).forEach(x => console.log(`     - ${x.marca} ${x.modelo} (${x.ano}) ${x.precoTexto}`));
  }
  if (d.descartadosPeloVendedor?.length) {
    console.log(`   VENDEDOR descartou (${d.descartadosPeloVendedor.length}):`);
    d.descartadosPeloVendedor.forEach(x => console.log(`     - ${x.marca} ${x.modelo} (${x.ano}) ${x.precoTexto}`));
  }
  console.log(`   resultado: ${result.top.length} carros`);
  result.top.forEach((c, i) => {
    const fic = c.fichaTecnica || {};
    console.log(`     #${String(i+1).padStart(2,'0')} ${trunc(c.brand, 14).padEnd(14)} ${trunc(c.model, 36).padEnd(36)} ${String(c.year).padEnd(4)} ${(c.price||'').padStart(14)} fuel:${(c.fuel||'').padEnd(10)} type:${(c.type||'').padEnd(7)} motor:${trunc(fic.motor||'-', 18)}`);
  });

  const issues = [];
  if (sc.expect?.minResults && result.top.length < sc.expect.minResults) issues.push(`esperava ≥${sc.expect.minResults}, veio ${result.top.length}`);
  const seenInResult = new Set();
  result.top.forEach(c => {
    const tiposPedidos = sc.types;
    if (!tiposPedidos.includes(c.type)) issues.push(`${c.brand} ${c.model}: type='${c.type}' fora de ${tiposPedidos.join(',')}`);
    if (sc.expect?.mustNotInclude) {
      const fuel = (c.fuel || '').toLowerCase();
      sc.expect.mustNotInclude.forEach(bad => {
        if (fuel.includes(bad)) issues.push(`${c.brand} ${c.model}: fuel viola filtro (${bad})`);
      });
    }
    const k = `${c.brand}|${c.model}|${c.year}`;
    if (seenInResult.has(k)) issues.push(`duplicata: ${c.brand} ${c.model} (${c.year})`);
    seenInResult.add(k);
  });
  if (issues.length) {
    console.log(`   ⚠ PROBLEMAS:`);
    issues.forEach(i => console.log(`      - ${i}`));
  } else {
    console.log(`   ✅ sem problemas detectados`);
  }
  return { issues };
}

const runOnly = process.argv[2];

const browser = await chromium.launch({ headless: false, slowMo: 50 });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();

console.log('Abrindo app em', API);

const summary = [];

for (const sc of SCENARIOS) {
  if (runOnly && !sc.name.startsWith(runOnly + ' ')) continue;

  console.log(`\n>> Iniciando: ${sc.name}`);
  await page.goto(API);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  await setOverlay(page, `<div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Cenário em teste</div><div>${sc.name}</div><div style="font-size:12px;font-weight:400;margin-top:8px;opacity:.8">tipos: ${sc.types.join(', ')}<br>combustíveis: ${sc.fuels.join(', ')}<br>prioridades: ${sc.priorities.join(', ')}</div>`);

  await fillForm(page, sc);

  await setOverlay(page, `<div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Buscando…</div><div>Backend processando briefing</div>`, '#1F3A8A');

  // Click submit + capture API response
  const t0 = Date.now();
  const respPromise = page.waitForResponse(r => r.url().includes('/api/recommend'), { timeout: 180000 });
  await page.locator('button.tk-btn-primary:has-text("Buscar recomendações")').click();
  let result;
  try {
    const resp = await respPromise;
    result = await resp.json();
  } catch (e) {
    console.log(`   ❌ erro aguardando resposta: ${e.message}`);
    summary.push({ name: sc.name, ok: false, count: 0, dt: '-' });
    continue;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // Espera tela renderizar
  await page.waitForTimeout(1500);

  const { issues } = summarize(sc, result, dt);
  await setOverlay(page,
    `<div style="font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Resultado</div><div>${result.ok ? `${result.top.length} carros encontrados` : 'FALHA'}</div>${issues.length ? `<div style="font-size:11px;font-weight:400;margin-top:8px;color:#ffd166">${issues.length} problema(s) — ver console</div>` : '<div style="font-size:11px;font-weight:400;margin-top:8px;color:#7af6b1">✓ tudo certo</div>'}`,
    issues.length ? '#7c1d6f' : '#0f5132'
  );

  summary.push({ name: sc.name, ok: result.ok, count: result.top?.length ?? 0, dt, issues: issues.length });

  // Pausa para visibilidade
  await page.waitForTimeout(8000);
}

console.log('\n' + '═'.repeat(80));
console.log('RESUMO');
console.log('═'.repeat(80));
summary.forEach(s => {
  const status = s.ok ? `${String(s.count).padStart(2)} carros` : 'FALHA';
  const flag = s.issues ? `⚠ ${s.issues} issue(s)` : '✓';
  console.log(`  ${status}  ${s.dt}s  ${flag}  ${s.name}`);
});

console.log('\nNavegador permanece aberto. Ctrl+C quando quiser fechar.');
await new Promise(() => {});

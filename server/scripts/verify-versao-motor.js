/* Verificação visual do split versão/motor nos cards.
 * Roda 1 cenário (hatch+coupe, leque de versões variado), tira screenshot
 * e confere no DOM que a versão (.tk-cc__model) e o motor (linha discreta)
 * aparecem como elementos separados.
 *
 * Rodar (com server no ar em :3001): node server/scripts/verify-versao-motor.js
 */
import { chromium } from 'playwright';

const API = 'http://localhost:3001';
const OUT = 'C:/JS/TechnikSearch/server/scripts/_verify-versao-motor.png';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1600 } });
const page = await ctx.newPage();

await page.goto(API);
await page.waitForLoadState('domcontentloaded');
await page.waitForSelector('text=Briefing 360°', { timeout: 15000 });
await page.waitForTimeout(400);

// Cenário: hatch + coupé, flex+gas (default é suv, flex+hybrid)
// Tipos: desativa SUV, ativa Hatch e Coupé
await page.locator('button.q2__type:has-text("SUV")').click();
await page.waitForTimeout(120);
await page.locator('button.q2__type:has-text("Hatch")').click();
await page.waitForTimeout(120);
await page.locator('button.q2__type:has-text("Coupé")').click();
await page.waitForTimeout(120);
// Combustível: tira Híbrido, põe Gasolina
await page.locator('button.tk-chip:has-text("Híbrido")').first().click();
await page.waitForTimeout(120);
await page.locator('button.tk-chip:has-text("Gasolina")').first().click();
await page.waitForTimeout(120);

const respPromise = page.waitForResponse(r => r.url().includes('/api/recommend'), { timeout: 180000 });
await page.locator('button.tk-btn-primary:has-text("Buscar recomendações")').click();

let result;
try {
  const resp = await respPromise;
  result = await resp.json();
} catch (e) {
  console.log('❌ erro aguardando /api/recommend:', e.message);
  await browser.close();
  process.exit(1);
}

await page.waitForTimeout(2000);

console.log('\n── Resposta da API ──');
console.log('ok:', result.ok, '| carros:', result.top?.length ?? 0);
if (result.ok) {
  console.log('\nCampos versao/motor por carro (vindo do backend):');
  result.top.forEach((c, i) => {
    console.log(`  #${i + 1}  versao="${c.versao ?? '(ausente)'}"  motor="${c.motor ?? '(ausente)'}"`);
    console.log(`      model cru="${c.model}"`);
  });
}

// Confere no DOM renderizado
const domCheck = await page.evaluate(() => {
  const models = [...document.querySelectorAll('.tk-cc__model')].map(el => el.textContent.trim());
  return { modelTitles: models.slice(0, 6) };
});
console.log('\n── DOM renderizado (.tk-cc__model — título da versão) ──');
domCheck.modelTitles.forEach(t => console.log('  •', t));

await page.screenshot({ path: OUT, fullPage: true });
console.log('\n📸 screenshot:', OUT);

// Veredito
const backendOk = result.ok && result.top.every(c => c.versao !== undefined);
const splitHappened = result.ok && result.top.some(c => c.motor && c.versao && c.versao !== c.model);
console.log('\n── Veredito ──');
console.log(backendOk ? '✅ backend expõe versao/motor em todos os carros' : '❌ backend NÃO expôs versao em algum carro');
console.log(splitHappened ? '✅ split de fato separou versão de motor em pelo menos um carro' : '⚠ nenhum carro teve split (todos sem motor na string?)');

await browser.close();

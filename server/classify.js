/* Regras compartilhadas de classificação de tipo e combustível.
 * Usadas pelo build do catálogo (build-catalog.js, build-catalog-from-cache.js).
 *
 * Convenção: as regras recebem `${marca} ${modelo}` (com marca incluída),
 * pra ajudar quando o modelo é "1500 LARAMIE" sem prefixo da marca.
 */

// Ordem importa — primeiro match vence.
const TYPE_RULES = [
  // ─── PICKUP ────────────────────────────────────────────────────────────
  { type: 'pickup', patterns: [
    /\bhilux\b/i, /\branger\b/i, /\bs10\b/i, /\bl[ -]?200\b/i, /\bamarok\b/i,
    /\bfrontier\b/i, /\bmaverick\b/i, /\bgladiator\b/i,
    /\bram\s*\d/i, /\bram\s+\w/i, /\b1500\s+(laramie|limited|big|rebel|sport|laramie longhorn)/i, /\b3500\s+(laramie|limited)/i, /\b2500\s+(laramie|limited)/i,
    /\btitan\b/i, /\bsilverado\b/i, /\bf-?150\b/i, /\bf-?250\b/i, /\bf-?1000\b/i,
    /\boroch\b/i, /\bsaveiro\b/i, /\bstrada\b/i, /\bmontana\b/i, /\btoro\b/i,
    /\bhoggar\b/i, /\bcourier\b/i, /\bd-?max\b/i, /\bdakota\b/i,
    /pick[ -]?up/i, /\bcabine\b/i,
  ]},

  // ─── SUV ───────────────────────────────────────────────────────────────
  { type: 'suv', patterns: [
    // Jeep
    /\bcompass\b/i, /\brenegade\b/i, /\bcommander\b/i, /\bgrand\s*cherokee\b/i, /\bwrangler\b/i,
    // Mitsubishi
    /\beclipse\s*cross\b/i, /\boutlander\b/i, /\basx\b/i, /\bpajero\b/i,
    // VW
    /\bt-?cross\b/i, /\btaos\b/i, /\btiguan\b/i, /\bnivus\b/i,
    // Hyundai
    /\bcreta\b/i, /\btucson\b/i, /\bsanta\s*fe\b/i, /\bkona\b/i, /\bpalisade\b/i,
    // GM/Chevrolet
    /\btracker\b/i, /\btrailblazer\b/i, /\bequinox\b/i, /\bblazer\b/i, /\bcaptiva\b/i,
    /\bbolt\s*euv\b/i,
    // Nissan
    /\bkicks\b/i, /\bxterra\b/i, /\bmurano\b/i,
    // Honda
    /\bhr-?v\b/i, /\bwr-?v\b/i, /\bzr-?v\b/i, /\bcr-?v\b/i,
    // Fiat
    /\bpulse\b/i, /\bfastback\b/i,
    // Caoa Chery / Haval / chineses
    /\btiggo\b/i, /\bhaval\b/i, /\bsong\b/i, /\byuan\b/i, /\bjolion\b/i,
    // Toyota
    /\bcorolla\s*cross\b/i, /\brav4\b/i, /\bsw4\b/i, /\bland\s*cruiser\b/i,
    // Audi
    /\bq[3-8]\b/i, /\brsq[3-8]\b/i, /\brs\s*q[3-8]\b/i,
    // BMW
    /\bx[1-7]\b/i, /\bix\b/i, /\bix\s*[1-7]\b/i,
    // Mercedes
    /\bgla\b/i, /\bglb\b/i, /\bglc\b/i, /\bgle\b/i, /\bgls\b/i,
    /\beqa\b/i, /\beqb\b/i, /\beqc\b/i,
    // Volvo
    /\bxc\s*[34679]0\b/i, /\bec\s*40\b/i,
    // Audi E-TRON SUV (sem Sportback no nome) e E-TRON Sportback (que é variante SUV)
    /\be-tron\s+(performa|s\s+sportback|sportb|sportback)/i,
    // Land Rover
    /\bevoque\b/i, /\bvelar\b/i, /\bdiscovery\b/i, /\bdefender\b/i, /\bsport\s*lr/i, /\brange\s*rover\b/i,
    // Porsche
    /\bmacan\b/i, /\bcayenne\b/i,
    // Ford (Mustang Mach-E é SUV elétrico, não confundir com Mustang coupé)
    /\bterritory\b/i, /\bbronco\b/i, /\bedge\b/i, /\becosport\b/i,
    /\bmustang\s*mach[ -]?e\b/i,
    // Renault
    /\bduster\b/i, /\bkardian\b/i, /\bkoleos\b/i, /\bcaptur\b/i,
    // Kia
    /\bsorento\b/i, /\bsportage\b/i, /\bmohave\b/i, /\bstonic\b/i, /\bseltos\b/i, /\bev9\b/i,
    // Citroen / Peugeot
    /\baircross\b/i, /\bc4\s*cactus\b/i,
    /\b2008\b/i, /\b3008\b/i, /\b5008\b/i, /\b4008\b/i,
    // Lexus
    /\blexus\s*nx\b/i, /\blexus\s*rx\b/i, /\blexus\s*lx\b/i, /\blexus\s*ux\b/i,
    /\bnx[ -]?[23]\d{2}/i, /\brx[ -]?[345]\d{2}/i,
    // Genéricos
    /4motion/i, /\bsuv\b/i,
  ]},

  // ─── COUPÉ / ESPORTIVO ─────────────────────────────────────────────────
  { type: 'coupe', patterns: [
    /\bcoupe\b|\bcoupé\b/i, /\bcabriolet\b/i, /\bcabrio\b/i, /\bspyder\b/i, /\bconvertible\b/i,
    /\bgran\s*coupe\b/i, /\bgrancoupe\b/i, /\bgran\s*coupé\b/i,
    /\broadster\b/i, /\b z\d\b/i, /\bz4\b/i, /\bz3\b/i,
    // Esportivos clássicos (Mustang só o coupé tradicional — Mach-E é SUV elétrico, vai pra SUV)
    /\bmustang\b(?!\s*mach)/i, /\bcamaro\b/i, /\bchallenger\b/i, /\bcorvette\b/i,
    /\bsupra\b/i, /\bgr\s*86\b/i, /\bgr86\b/i, /\bbrz\b/i, /\bgr\s*yaris\b/i, /\byaris\s*gr\b/i,
    /\b370z\b/i, /\b350z\b/i,
    // BMW M
    /\bm2\b|\bm3\b|\bm4\b|\bm5\b|\bm6\b|\bm8\b/i,
    /\bm235i\b/i, /\bm240i\b/i, /\bm340i\b/i, /\bm550i\b/i, /\bm850i\b/i,
    // Porsche
    /\b911\b/i, /\bcayman\b/i, /\bboxster\b/i, /\b718\b/i,
    // Audi TT, A5/RS5 Coupé
    /\baudi\s*tt\b/i, /\btt\s*\d/i,
    /\brs[3-8]\s+sed/i, /\brs[3-8]\s+coupe/i,
    /\ba3\s*cabriolet\b/i, /\ba5\s*coupe\b/i,
    // Mercedes CLA / SL / SLC
    /\bcla\b/i, /\bsl-?class\b/i, /\bslc\b/i, /\bslk\b/i,
    // Jaguar F-Type
    /\bf-?type\b/i,
    // Kia Stinger
    /\bstinger\b/i,
  ]},

  // ─── SEDAN ─────────────────────────────────────────────────────────────
  { type: 'sedan', patterns: [
    /\bsedan\b/i, /\bsed\.\b|\bsed\b/i,
    // Brasileiros populares
    /\bonix\s*plus\b/i, /\bonix\s*sed/i, /\bcorsa\s*sedan\b/i,
    /\bclassic\s*sedan\b/i, /\bvoyage\b/i, /\bsiena\b/i, /\bcronos\b/i,
    /\bhb20s\b/i, /\bhb20\s*sed/i,
    /\bcivic\b/i, /\bcorolla\b(?!\s*cross)/i, /\bcity\b(?!\s*hatch)/i,
    /\blogan\b/i, /\bversa\b/i, /\bsentra\b/i, /\baltima\b/i, /\bmaxima\b/i,
    /\bvirtus\b/i, /\bjetta\b/i, /\bvento\b/i, /\bgol\s*sed/i,
    /\bcobalt\b/i, /\bprisma\b/i, /\bcruze\b/i,
    /\bfluence\b/i, /\bsymbol\b/i,
    /\bsandero\s*sed/i,
    /\bcerato\b/i, /\boptima\b/i, /\bk5\b/i, /\bg70\b/i, /\bg80\b/i,
    // Volvo S
    /\bvolvo\s*s\d{2}/i, /\bs60\b/i, /\bs90\b/i,
    // Audi A
    /\baudi\s*s[3-8]\b/i,
    /\baudi\s*a4\b/i, /\baudi\s*a5\b/i, /\baudi\s*a6\b/i, /\baudi\s*a7\b/i, /\baudi\s*a8\b/i,
    /\ba5\s*(sportb|ambient|attraction|ambit)/i,
    // Audi RS4 Avant (perua/wagon — classifica como sedan)
    /\brs4\s+\d/i, /\brs4\s+avant/i,
    // Audi E-TRON GT (sedan elétrico 4p, 4 portas)
    /\be-tron\s+gt\b/i,
    // BMW
    /\bbmw\s*3[2-3]0i\b/i, /\b3[2-3]0i\b/i, /\bm340/i, /\bm550/i,
    /\bbmw\s*série\s*3\b/i, /\bbmw\s*serie\s*3\b/i,
    // Mercedes Classe C
    /\bc[ -]?1[8-9]0\b|\bc[ -]?2[0-3]0\b|\bc[ -]?3[0-3]0\b|\bc[ -]?4[03]\b/i,
    /\bclass[ -]?c\b/i,
    // Mercedes EQ Sedan
    /\beqe\b(?!\s*suv)/i, /\beqs\b(?!\s*suv)/i,
    // Toyota Camry, Honda Accord
    /\bcamry\b/i, /\baccord\b/i,
    // Lexus
    /\bes\s*[23]50/i, /\bes-?350\b/i, /\bis\s*[23][05]0\b/i,
    /\bsonata\b/i, /\bk[34]\b/i, /\bgenesis\b/i,
    /\barteon\b/i, /\bpassat\b/i, /\bbora\b/i,
    /\bfocus\s*sed/i, /\bfusion\b/i,
  ]},

  // ─── HATCH ─────────────────────────────────────────────────────────────
  { type: 'hatch', patterns: [
    /\bhatch\b/i,
    /\bonix\b(?!\s*plus|\s*sed)/i, /\bcobalt\s*hatch\b/i, /\bmeriva\b/i,
    /\bgol\b(?!\s*sed)/i, /\bup\b/i, /\bfox\b/i, /\bpolo\b/i, /\bgolf\b/i, /\bscirocco\b/i,
    /\bka\b(?!\s*sed)/i, /\bfiesta\b/i, /\bfocus\b(?!\s*sed)/i,
    /\bhb20\b(?!s)/i, /\bi30\b/i, /\bveloster\b/i,
    /\bcity\s*hatch\b/i, /\bfit\b/i, /\bjazz\b/i,
    /\bargo\b/i, /\bmobi\b/i, /\bpalio\b/i, /\buno\b/i, /\bbravo\b/i, /\bpunto\b/i, /\bidea\b/i,
    /\bclio\b/i, /\bsandero\b(?!\s*sed)/i, /\bkwid\b/i, /\bzoe\b/i,
    /\bmarch\b/i, /\bversa\s*hatch\b/i,
    /\b208\b/i, /\b207\b/i, /\b206\b/i, /\b308\b/i,
    /\bc3\b(?!\s*aircross)/i, /\bc4\s*hatch\b/i, /\bc4\s*pallas\b/i,
    /\byaris\b(?!\s*cross|\s*gr)/i, /\betios\b/i, /\bagya\b/i,
    /\brio\b(?!\s*sed)/i, /\bsoul\b/i, /\bpicanto\b/i,
    /\bcooper\b/i, /\bclubman\b/i,
    // BMW Série 1 hatch
    /\bbmw\s*1\b/i, /\bseries?\s*1\b/i, /\b1\s*series\b/i,
    /\b118i\b/i, /\b120i\b/i, /\b125i\b/i, /\b135i\b/i, /\b140i\b/i,
    // Audi A1 / A3 hatch (Sportback é hatch 5p)
    /\baudi\s*a1\b/i, /\ba1\s*sportb/i,
    /\baudi\s*a3\b/i, /\ba3\s*sportb/i,
    // Mercedes Classe A hatch
    /\bclass[ -]?a\b/i, /\ba\s*200\b|\ba\s*250\b|\ba\s*35\b|\ba\s*45\b/i,
  ]},

  // ─── MINIVAN / VAN ─────────────────────────────────────────────────────
  { type: 'minivan', patterns: [
    /\bspin\b/i, /\bidea\s*adv/i, /\bdoblo\b/i, /\bberlingo\b/i, /\bkangoo\b/i, /\bpartner\b/i,
    /\bzafira\b/i, /\borlando\b/i, /\bsharan\b/i, /\bcaravan\b/i, /\bsedona\b/i, /\bcarens\b/i,
    /\btouran\b/i, /\bodyssey\b/i, /\bsienna\b/i, /\balphard\b/i,
    /\bjumpy\b/i, /\bexpert\b/i, /\bducato\b/i, /\bscudo\b/i,
    /\bmpv\b/i, /\bvan\b/i, /\bminibus\b/i,
  ]},
];

export function classifyTipo(marcaModelo) {
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some(p => p.test(marcaModelo))) return rule.type;
  }
  return 'unknown';
}

const FUEL_HINTS_ELECTRIC = /\beletric|\(elétrico\)|\bev\b|\b e[ -]?(tech|drive|3p)\b|tesla|taycan|\bi[3-8]\b|\b ix\b|\beq[abc]\b|\beqe\b|\beqs\b|recharge\s*(pure|twin)|c40\s*recharge|xc40\s*recharge|\benyaq\b|\bid\.\s*\d|\be-tron\b|\bev9\b|\bbolt\s*euv\b/i;
const FUEL_HINTS_HYBRID = /híbrid|hibrid|hybrid|\bphev\b|\bhev\b|plug-?in|t8\s*recharge/i;
const FUEL_HINTS_DIESEL = /\bdiesel\b|\btdi\b|\bcrdi\b|\bbluetec\b|\bd[24]d\b/i;

export function classifyFuel(marcaModelo, fipeFuel) {
  if (FUEL_HINTS_ELECTRIC.test(marcaModelo)) return 'eletrico';
  if (FUEL_HINTS_HYBRID.test(marcaModelo)) return 'hibrido';
  if (FUEL_HINTS_DIESEL.test(marcaModelo)) return 'diesel';
  const f = (fipeFuel || '').toLowerCase();
  if (f.includes('elétr') || f.includes('eletr')) return 'eletrico';
  if (f.includes('híbri') || f.includes('hibri')) return 'hibrido';
  if (f.includes('diesel')) return 'diesel';
  if (f.includes('flex') || f.includes('álcool') || f.includes('alcool')) return 'flex';
  if (f.includes('gasolina')) return 'gasolina';
  return 'gasolina';
}

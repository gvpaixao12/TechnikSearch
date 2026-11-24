// Saneamento determinístico da ficha técnica que o vendedor (LLM) escreve.
//
// Medido nas pesquisas modelo de nov/2026: Mustang, Camaro, M2, M4, M6, Z4 e
// 650i saíram todos com tração "Dianteira" (o primeiro exemplo do prompt),
// o Camaro SS virou manual, o M850i de "530cv" no nome levou outro torque e
// torques vieram ora em kgfm, ora em Nm. O nome FIPE já carrega parte da
// verdade (cv, Mec./Aut., xDrive/quattro/4MATIC) — aqui ele manda sobre o
// palpite do LLM. Onde não há como saber, a regra NÃO inventa: só corrige o
// que o nome ou a lista abaixo provam.
//
// Idempotente: rodar duas vezes dá o mesmo resultado. Por isso também roda na
// leitura de consultas salvas — as antigas se corrigem sem migração.

// Tração integral declarada no próprio nome FIPE.
const MARCA_INTEGRAL = /\b(xdrive|quattro|quat|qt|4matic\+?|4x4|awd|4wd|4motion|q4|all4|sh-awd|e-?four)\b/i;

// Carros que só existem com tração traseira quando o nome não diz o contrário.
// Lista conservadora: entra aqui só o que nunca teve versão de tração dianteira.
// (BMW M5 F90 e M8 são integrais sem "xDrive" no nome FIPE — ficam de fora.)
const SEMPRE_TRASEIRA = [
  { marca: /ford/i, modelo: /\bmustang\b(?!.*mach)/i },
  { marca: /chevrolet|gm/i, modelo: /\b(camaro|corvette)\b/i },
  { marca: /dodge/i, modelo: /\b(challenger|charger)\b/i },
  { marca: /porsche/i, modelo: /\b(718|cayman|boxster)\b/i },
  { marca: /porsche/i, modelo: /^(?!.*(carrera\s*4|\b4s\b|\bturbo\b|targa)).*\b(911|carrera)\b/i },
  // M2/M3/M4/M6, Z4 e as séries 3 a 8 "redondas" (320i, 420i, 530e, 650i,
  // 740Li, 840i). \b antes do dígito exclui M340i/M440i/M850i, que no Brasil
  // são xDrive com frequência e nem sempre dizem isso no nome.
  { marca: /bmw/i, modelo: /\b(m[2346]|z4)\b|\b[3-8]\d{2}(i|d|e|li|ci)\b/i },
  // Classe C/E/S/CLS/SL/SLK/SLC e AMG GT. "GLC-43" e "CLA-45" não casam (a letra
  // antes não é fronteira de palavra).
  { marca: /mercedes/i, modelo: /\b(c|e|s|cls|sl|slk|slc)[\s-]?\d{2,3}\b|\bamg\s*gt\b/i },
  { marca: /jaguar/i, modelo: /\b(f-?type|xkr?|xf|xe|xj)\b/i },
  { marca: /aston/i, modelo: /^(?!.*dbx)/i },
  { marca: /lexus/i, modelo: /\b(is|rc|lc|gs)[\s-]*\d{3}\b/i },
  { marca: /toyota/i, modelo: /\b(gr[\s-]?86|gt[\s-]?86|supra)\b/i },
  { marca: /subaru/i, modelo: /\bbrz\b/i },
  { marca: /nissan/i, modelo: /\b(350\s?z|370\s?z)\b/i },
  { marca: /mazda/i, modelo: /\bmx-?5\b/i },
  { marca: /ferrari/i, modelo: /^(?!.*(purosangue|\bff\b|gtc4|sf90))/i },
  { marca: /maserati/i, modelo: /\b(ghibli|quattroporte|granturismo|grancabrio|mc20)\b/i },
];

const ehSempreTraseira = (marca, modelo) =>
  SEMPRE_TRASEIRA.some(r => r.marca.test(marca) && r.modelo.test(modelo));

// "550 Nm" → "56,1 kgfm". O resto do app escreve torque em kgfm.
function torqueEmKgfm(s) {
  const m = String(s || '').match(/^\s*(\d{2,4}(?:[.,]\d+)?)\s*n\.?\s?m\b/i);
  if (!m) return null;
  const nm = Number(m[1].replace(',', '.'));
  return `${(nm / 9.80665).toFixed(1).replace('.', ',')} kgfm`;
}

// Potência que o nome FIPE declara ("M850i XDrive Coupé 4.4 V8 530cv Aut.").
// Faixas como "315/319cv" (duas potências possíveis) não decidem nada.
function cvDoNome(modelo) {
  const s = String(modelo || '');
  if (/\d\s*\/\s*\d+\s*cv\b/i.test(s)) return null;
  const todos = [...s.matchAll(/\b(\d{2,4})\s*cv\b/gi)].map(m => Number(m[1]));
  if (todos.length !== 1) return null;
  const cv = todos[0];
  return cv >= 50 && cv <= 1600 ? cv : null;
}

const numero = s => { const m = String(s || '').match(/\d{2,4}/); return m ? Number(m[0]) : null; };

// Devolve { ficha, ajustes } — ficha nova (não muta a entrada) e a lista do
// que mudou, pra log/diagnóstico.
export function saneaFicha(fichaIn, marca = '', modelo = '') {
  const ficha = { ...(fichaIn || {}) };
  const ajustes = [];
  const troca = (campo, valor) => {
    if (String(ficha[campo] ?? '') === String(valor)) return;
    ajustes.push({ campo, de: ficha[campo] ?? '', para: valor });
    ficha[campo] = valor;
  };

  const kgfm = torqueEmKgfm(ficha.torque);
  if (kgfm) troca('torque', kgfm);

  const cv = cvDoNome(modelo);
  if (cv && numero(ficha.potencia) !== cv) troca('potencia', `${cv} cv`);

  // Câmbio: "Mec." no nome = manual; "Aut." = automático. Quando o nome
  // contradiz a ficha, o número de marchas que veio junto também é suspeito.
  const cambio = String(ficha.cambio || '');
  // Lookahead em vez de \b: sem flag u, "ê" não é \w e "Autêntico" casaria.
  if (/\bmec(?![a-zà-ÿ])/i.test(modelo) && cambio && !/manual|mec/i.test(cambio)) troca('cambio', 'Manual');
  if (/\baut(?![a-zà-ÿ])/i.test(modelo) && /manual|mec/i.test(cambio)) troca('cambio', 'Automático');

  const tracao = String(ficha.tracao || '');
  if (MARCA_INTEGRAL.test(modelo)) {
    if (!/4x4|integral/i.test(tracao)) troca('tracao', '4x4');
  } else if (ehSempreTraseira(marca, modelo) && (!tracao || /dianteira/i.test(tracao))) {
    troca('tracao', 'Traseira');
  }
  // Rótulos equivalentes num só, pra tabela comparativa não mostrar três jeitos.
  if (/^(awd|quattro|integral)$/i.test(String(ficha.tracao || '').trim())) troca('tracao', '4x4');

  return { ficha, ajustes };
}

// Aplica em todos os carros de um top (formato do /api/recommend).
export function saneaTop(top) {
  return (top || []).map(t => ({ ...t, fichaTecnica: saneaFicha(t.fichaTecnica, t.brand, t.model).ficha }));
}

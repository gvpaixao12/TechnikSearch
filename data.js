// Mock car catalog — Brazilian market 2026
// Each car: id, brand, model, trim, type, price, year, km, fuel, gearbox, seats, trunkL,
//   tags (array of lifestyle tags used for matching), highlight (text), pros, cons, dealer
//
// Image placeholders use data URLs / local stripes — user should swap with real photos.

window.TECHNIK_CARS = [
  { id:"vw-nivus", brand:"Volkswagen", model:"Nivus", trim:"1.0 200 TSI Highline",
    type:"SUV", price:189900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:415, hp:128,
    tags:["urbano","família","conforto","economia","versátil"],
    highlight:"SUV-coupé urbano com porta-malas grande",
    pros:["Visual jovem","Bom porta-malas","Câmbio AT6 macio"],
    cons:["Banco traseiro justo p/ 3","Rodas pequenas no Highline"],
    dealer:"VW Sorocaba" },

  { id:"toy-corolla-cross", brand:"Toyota", model:"Corolla Cross", trim:"1.8 Hybrid XRX",
    type:"SUV", price:235900, year:2026, km:0, fuel:"híbrido", gearbox:"automático",
    seats:5, trunkL:440, hp:122,
    tags:["família","economia","conforto","durabilidade","híbrido"],
    highlight:"O híbrido mais querido do Brasil",
    pros:["Consumo excelente","Revenda altíssima","Espaço generoso"],
    cons:["Acabamento conservador","Acelera modesta"],
    dealer:"Toyota Granja Vianna" },

  { id:"hon-civic", brand:"Honda", model:"Civic", trim:"2.0 e:HEV Touring",
    type:"Sedan", price:259900, year:2026, km:0, fuel:"híbrido", gearbox:"automático",
    seats:5, trunkL:519, hp:184,
    tags:["executivo","conforto","performance","status","tecnologia"],
    highlight:"Sedã híbrido com pegada esportiva",
    pros:["Direção refinada","Cabine silenciosa","Pacote ADAS completo"],
    cons:["Preço alto","Sem tração nas 4"],
    dealer:"Honda Itaim" },

  { id:"jee-compass", brand:"Jeep", model:"Compass", trim:"T270 Limited",
    type:"SUV", price:218500, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:438, hp:185,
    tags:["família","aventura","status","versátil"],
    highlight:"SUV médio versátil para cidade e estrada",
    pros:["Posição de dirigir alta","Cabine espaçosa","Visual robusto"],
    cons:["Consumo médio","Suspensão firme em buracos"],
    dealer:"Jeep Morumbi" },

  { id:"hyu-creta", brand:"Hyundai", model:"Creta", trim:"1.0 T-GDI Limited",
    type:"SUV", price:179900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:431, hp:120,
    tags:["urbano","família","tecnologia","economia"],
    highlight:"SUV compacto recheado de tecnologia",
    pros:["Multimídia 10\"","Bom isolamento","Garantia 5 anos"],
    cons:["Motor 1.0 fica curto cheio","Plásticos duros atrás"],
    dealer:"Caoa Hyundai" },

  { id:"vw-polo", brand:"Volkswagen", model:"Polo", trim:"1.0 200 TSI Highline",
    type:"Hatch", price:128990, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:300, hp:128,
    tags:["urbano","economia","jovem","primeiro carro"],
    highlight:"Hatch premium do segmento",
    pros:["Acabamento sólido","TSI animado","Boa revenda"],
    cons:["Porta-malas modesto","Multimídia trava às vezes"],
    dealer:"VW Anhanguera" },

  { id:"fia-pulse", brand:"Fiat", model:"Pulse", trim:"Turbo 200 Impetus",
    type:"SUV", price:144900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:370, hp:130,
    tags:["jovem","urbano","versátil","aventura"],
    highlight:"SUV-cupê compacto, design ousado",
    pros:["Visual jovem","Boa dirigibilidade","Câmbio CVT decente"],
    cons:["Espaço atrás médio","Acabamento plástico"],
    dealer:"Fiat Tatuapé" },

  { id:"che-tracker", brand:"Chevrolet", model:"Tracker", trim:"1.2 Turbo Premier",
    type:"SUV", price:169900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:393, hp:133,
    tags:["urbano","família","tecnologia","economia"],
    highlight:"Compacto bem equipado e econômico",
    pros:["Multimídia MyLink fluido","Bom consumo","Direção leve"],
    cons:["Motor levemente ruidoso","Banco motorista sem altura elétrica"],
    dealer:"Chevrolet Marginal" },

  { id:"toy-yaris-cross", brand:"Toyota", model:"Yaris Cross", trim:"1.5 HEV XRX",
    type:"SUV", price:172390, year:2026, km:0, fuel:"híbrido", gearbox:"automático",
    seats:5, trunkL:390, hp:115,
    tags:["urbano","economia","família","híbrido"],
    highlight:"Híbrido pequeno com consumo de carro chinês",
    pros:["18 km/l fácil","Cabine silenciosa","Suave"],
    cons:["Visual tímido","Motor não anima"],
    dealer:"Toyota Berrini" },

  { id:"byd-dolphin", brand:"BYD", model:"Dolphin", trim:"GL Plus",
    type:"Hatch", price:149800, year:2026, km:0, fuel:"elétrico", gearbox:"automático",
    seats:5, trunkL:345, hp:95,
    tags:["urbano","tecnologia","economia","elétrico","jovem"],
    highlight:"Elétrico de entrada com 290 km de autonomia",
    pros:["Custo de uso baixíssimo","Tela giratória 12.8\"","Aceleração linear"],
    cons:["Rede de recarga ainda limitada","Plásticos econômicos"],
    dealer:"BYD Faria Lima" },

  { id:"mit-triton", brand:"Mitsubishi", model:"Triton", trim:"2.4 Biturbo Diesel GLS 4x4",
    type:"Picape", price:269990, year:2027, km:0, fuel:"diesel", gearbox:"automático",
    seats:5, trunkL:0, hp:201,
    tags:["aventura","trabalho","família","off-road","status"],
    highlight:"Picape média robusta com 4x4 redutora",
    pros:["Torque alto","Off-road competente","Cabine espaçosa"],
    cons:["Consumo na cidade","Manobra exige espaço"],
    dealer:"Mitsubishi Brooklin" },

  { id:"toy-hilux", brand:"Toyota", model:"Hilux", trim:"2.8 SRX Plus 4x4",
    type:"Picape", price:339900, year:2026, km:0, fuel:"diesel", gearbox:"automático",
    seats:5, trunkL:0, hp:204,
    tags:["aventura","trabalho","off-road","durabilidade","status"],
    highlight:"Padrão-ouro de picape grande no Brasil",
    pros:["Indestrutível","Revenda fortíssima","Off-road sério"],
    cons:["Acabamento conservador","Preço subiu muito"],
    dealer:"Toyota Tatuapé" },

  { id:"bmw-320i", brand:"BMW", model:"320i", trim:"M Sport",
    type:"Sedan", price:339900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:480, hp:184,
    tags:["executivo","status","performance","conforto","luxo"],
    highlight:"Sedã premium de entrada com chassi referência",
    pros:["Dirigibilidade exemplar","Acabamento premium","Câmbio ZF imbatível"],
    cons:["Manutenção cara","Multimídia em curva de aprendizado"],
    dealer:"BMW Eurobike" },

  { id:"vol-xc60", brand:"Volvo", model:"XC60", trim:"T8 Recharge Ultimate",
    type:"SUV", price:469900, year:2026, km:0, fuel:"híbrido plug-in", gearbox:"automático",
    seats:5, trunkL:483, hp:455,
    tags:["luxo","família","status","tecnologia","conforto","performance"],
    highlight:"SUV híbrido plug-in com 455 cv",
    pros:["Aceleração brutal","Cabine silenciosa","Pacote de segurança líder"],
    cons:["Preço","Recarga depende de tomada em casa"],
    dealer:"Volvo Cidade Jardim" },

  { id:"por-718", brand:"Porsche", model:"718 Cayman", trim:"GTS 4.0",
    type:"Esportivo", price:849000, year:2026, km:0, fuel:"gasolina", gearbox:"automático",
    seats:2, trunkL:275, hp:400,
    tags:["esportivo","status","performance","luxo","trackday"],
    highlight:"Motor central, 6-cilindros aspirado",
    pros:["Dirigibilidade pura","Visual atemporal","Som do flat-6"],
    cons:["Apenas 2 lugares","Custo de manutenção"],
    dealer:"Porsche Center São Paulo" },

  { id:"gwm-haval", brand:"GWM", model:"Haval H6", trim:"GT PHEV",
    type:"SUV", price:259900, year:2026, km:0, fuel:"híbrido plug-in", gearbox:"automático",
    seats:5, trunkL:560, hp:321,
    tags:["família","tecnologia","status","conforto","aventura"],
    highlight:"SUV cupê chinês com 1000 km de autonomia combinada",
    pros:["Recheado de tela e ADAS","Aceleração forte","Porta-malas grande"],
    cons:["Marca jovem no Brasil","Acabamento divide opiniões"],
    dealer:"GWM Berrini" },

  { id:"hyu-hb20", brand:"Hyundai", model:"HB20", trim:"1.0 Comfort Plus",
    type:"Hatch", price:92900, year:2026, km:0, fuel:"flex", gearbox:"manual",
    seats:5, trunkL:300, hp:80,
    tags:["primeiro carro","economia","urbano","jovem"],
    highlight:"Hatch popular bem-resolvido",
    pros:["Custo-benefício","Manutenção barata","Bom espaço"],
    cons:["Motor 1.0 aspirado fraco na estrada","Sem direção elétrica em algumas versões"],
    dealer:"Caoa Hyundai" },

  { id:"ren-kwid", brand:"Renault", model:"Kwid", trim:"E-Tech elétrico",
    type:"Hatch", price:119900, year:2026, km:0, fuel:"elétrico", gearbox:"automático",
    seats:4, trunkL:290, hp:64,
    tags:["primeiro carro","urbano","economia","elétrico"],
    highlight:"Elétrico mais barato do Brasil",
    pros:["Manutenção mínima","Ágil em cidade","Recarrega em tomada"],
    cons:["Autonomia 185 km","Espaço atrás justo"],
    dealer:"Renault Pinheiros" },

  { id:"vw-tcross", brand:"Volkswagen", model:"T-Cross", trim:"1.4 TSI Highline",
    type:"SUV", price:189900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:373, hp:150,
    tags:["família","urbano","conforto","versátil"],
    highlight:"SUV familiar com bom espaço interno",
    pros:["Banco traseiro corrediço","Motor 1.4 forte","Acabamento sólido"],
    cons:["Multimídia datada","Câmbio Tiptronic não é dos mais rápidos"],
    dealer:"VW Anhanguera" },

  { id:"che-onix-plus", brand:"Chevrolet", model:"Onix Plus", trim:"Premier 1.0 Turbo",
    type:"Sedan", price:118900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:469, hp:116,
    tags:["urbano","família","economia","conforto"],
    highlight:"Sedã compacto líder de vendas",
    pros:["Porta-malas enorme","Motor turbo econômico","OnStar"],
    cons:["Acabamento simples","Visual conservador"],
    dealer:"Chevrolet Marginal" },

  { id:"fia-toro", brand:"Fiat", model:"Toro", trim:"Ranch 2.2 Diesel 4x4",
    type:"Picape", price:229900, year:2026, km:0, fuel:"diesel", gearbox:"automático",
    seats:5, trunkL:0, hp:200,
    tags:["aventura","família","trabalho","versátil"],
    highlight:"Picape média urbana com cara de SUV",
    pros:["Cabine confortável","Diesel torcudo","Visual diferenciado"],
    cons:["Caçamba menor que rivais","Off-road moderado"],
    dealer:"Fiat Tatuapé" },

  { id:"aud-q3", brand:"Audi", model:"Q3", trim:"Sportback Performance Black",
    type:"SUV", price:359900, year:2026, km:0, fuel:"flex", gearbox:"automático",
    seats:5, trunkL:530, hp:230,
    tags:["status","luxo","performance","conforto","tecnologia"],
    highlight:"SUV-cupê premium ágil",
    pros:["Motor 2.0 turbo forte","Cabine high-tech","Visual marcante"],
    cons:["Espaço atrás comprometido pelo cupê","Manutenção premium"],
    dealer:"Audi Center Aclimação" }
];

// Profile examples — saved client profiles
window.TECHNIK_PROFILES = [
  { id:"p1", name:"Ricardo Almeida", initials:"RA", date:"há 3 dias",
    age:42, marital:"casado", kids:2, kidsAge:"8 e 11",
    profession:"Diretor Comercial", income:"25k+",
    types:["SUV","Sedan"], budget:[180000, 280000],
    use:"família", fuel:["flex","híbrido"], gearbox:"automático",
    lifestyle:["família","conforto"], priority:"segurança",
    space:"alto", note:"Família com mãe + 2 filhos. Viaja para o litoral todo mês." },
  { id:"p2", name:"Camila Tavares", initials:"CT", date:"há 1 semana",
    age:28, marital:"solteira", kids:0, kidsAge:"",
    profession:"Designer Sênior", income:"12-18k",
    types:["Hatch","SUV"], budget:[100000, 170000],
    use:"cidade", fuel:["flex","elétrico"], gearbox:"automático",
    lifestyle:["urbano","jovem"], priority:"economia",
    space:"baixo", note:"Mora em SP, anda muito de Uber e quer trocar por algo prático." },
  { id:"p3", name:"Eduardo Veloso", initials:"EV", date:"há 2 semanas",
    age:55, marital:"casado", kids:3, kidsAge:"adultos",
    profession:"Empresário", income:"50k+",
    types:["Sedan","Esportivo","SUV"], budget:[300000, 900000],
    use:"prazer", fuel:["gasolina","híbrido"], gearbox:"automático",
    lifestyle:["luxo","status"], priority:"performance",
    space:"médio", note:"Tem 2 carros, busca um terceiro só pelo prazer de dirigir." }
];

// Constants
window.TECHNIK_TYPES = ["Hatch","Sedan","SUV","Picape","Esportivo"];
window.TECHNIK_FUELS = ["flex","elétrico","híbrido","híbrido plug-in","diesel","gasolina"];
window.TECHNIK_LIFESTYLES = ["urbano","família","aventura","luxo","jovem","executivo"];
window.TECHNIK_PRIORITIES = ["economia","conforto","performance","segurança","status"];
window.TECHNIK_USES = ["cidade","estrada","família","trabalho","prazer"];

// Match scoring — lightweight rule-based
window.scoreCar = function(car, profile) {
  let score = 50;
  const reasons = [];

  // Type match
  if (profile.types && profile.types.includes(car.type)) {
    score += 18;
    reasons.push(`É um ${car.type.toLowerCase()}, exatamente o que você busca`);
  } else if (profile.types && profile.types.length > 0) {
    score -= 10;
  }

  // Budget
  if (profile.budget && profile.budget.length === 2) {
    const [min, max] = profile.budget;
    if (car.price >= min && car.price <= max) {
      score += 14;
      reasons.push(`Dentro do orçamento (R$ ${(car.price/1000).toFixed(0)}k)`);
    } else if (car.price < min) {
      score += 4;
      reasons.push(`Abaixo do orçamento — sobra para personalização`);
    } else {
      score -= 18;
    }
  }

  // Fuel
  if (profile.fuel && profile.fuel.length > 0) {
    if (profile.fuel.includes(car.fuel)) {
      score += 8;
      reasons.push(`Motorização ${car.fuel} preferida`);
    }
  }

  // Gearbox
  if (profile.gearbox && profile.gearbox === car.gearbox) {
    score += 4;
  }

  // Family / kids
  if (profile.kids > 0) {
    if (car.seats >= 5) score += 4;
    if (car.trunkL >= 380) {
      score += 6;
      reasons.push(`Porta-malas de ${car.trunkL}L acomoda a família`);
    }
    if (car.tags && car.tags.includes("família")) {
      score += 6;
    }
  }

  // Lifestyle tag overlap
  if (profile.lifestyle && car.tags) {
    const overlap = profile.lifestyle.filter(t => car.tags.includes(t)).length;
    score += overlap * 5;
    if (overlap > 0) {
      reasons.push(`Combina com seu estilo: ${profile.lifestyle.filter(t => car.tags.includes(t)).join(", ")}`);
    }
  }

  // Priority
  if (profile.priority === "performance" && car.hp >= 180) {
    score += 8;
    reasons.push(`${car.hp} cv entrega a performance que você busca`);
  }
  if (profile.priority === "economia" && (car.fuel === "elétrico" || car.fuel === "híbrido")) {
    score += 8;
    reasons.push(`${car.fuel.charAt(0).toUpperCase()+car.fuel.slice(1)}: economia no dia-a-dia`);
  }
  if (profile.priority === "status" && car.price >= 250000) {
    score += 6;
    reasons.push(`Marca premium reforça presença executiva`);
  }
  if (profile.priority === "conforto" && car.tags && car.tags.includes("conforto")) {
    score += 6;
  }
  if (profile.priority === "segurança" && car.tags && (car.tags.includes("família") || car.brand === "Volvo")) {
    score += 6;
    reasons.push(`Reconhecido pela segurança`);
  }

  // Use
  if (profile.use === "família" && car.tags && car.tags.includes("família")) {
    score += 4;
  }
  if (profile.use === "cidade" && car.tags && car.tags.includes("urbano")) {
    score += 4;
  }
  if (profile.use === "estrada" && car.trunkL >= 400) {
    score += 3;
  }

  // Age preferences (heuristic)
  if (profile.age && profile.age < 30 && car.tags && car.tags.includes("jovem")) {
    score += 4;
  }
  if (profile.age && profile.age > 50 && car.tags && (car.tags.includes("conforto") || car.tags.includes("luxo"))) {
    score += 4;
  }

  score = Math.max(1, Math.min(99, Math.round(score)));
  return { score, reasons: reasons.slice(0, 3) };
};

window.formatBRL = function(n) {
  return "R$ " + n.toLocaleString("pt-BR");
};

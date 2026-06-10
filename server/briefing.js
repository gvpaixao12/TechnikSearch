const TYPE_LABELS = {
  hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV',
  pickup: 'Picape', coupe: 'Coupé', minivan: 'Minivan',
};

const FUEL_LABELS = {
  flex: 'Flex', gas: 'Gasolina', diesel: 'Diesel',
  hybrid: 'Híbrido', plugin: 'Híbrido plug-in', electric: 'Elétrico',
};

const LIFESTYLE_LABELS = {
  family: 'família', urban: 'uso urbano', travel: 'viagens longas',
  work: 'trabalho/carga', offroad: 'estradas de terra/off-road',
  sport: 'uso esportivo',
};

const PRIORITY_LABELS = {
  safety: 'segurança', comfort: 'conforto', economy: 'economia de combustível',
  tech: 'conectividade/tecnologia', design: 'design',
  resale: 'valor de revenda',
};

function translate(list, dict) {
  if (!Array.isArray(list)) return [];
  return list.map(s => dict[s] || s).filter(Boolean);
}

export function normalizeBriefing(raw) {
  return {
    cliente: {
      nome: raw.client?.name || 'Cliente',
      perfil: raw.client?.segment || '',
    },
    orcamentoReais: {
      min: (raw.budget?.[0] ?? 0) * 1000,
      // budgetOpen = topo no talo ("600k+"): sem teto de preço (null).
      max: raw.budgetOpen ? null : (raw.budget?.[1] ?? 0) * 1000,
    },
    lugaresMin: raw.seats ?? null,
    portaMalasMinL: raw.trunk ?? null,
    anoMin: raw.yearMin ?? null,
    anoMax: raw.yearMax ?? null,
    tiposDesejados: translate(raw.types, TYPE_LABELS),
    combustiveisAceitos: translate(raw.fuels, FUEL_LABELS),
    estiloDeVida: translate(raw.lifestyle, LIFESTYLE_LABELS),
    prioridades: translate(raw.priorities, PRIORITY_LABELS),
    observacoes: raw.notes || '',
  };
}

export function briefingToText(b) {
  const orc = b.orcamentoReais.max == null
    ? `a partir de R$ ${b.orcamentoReais.min.toLocaleString('pt-BR')} (sem teto)`
    : `R$ ${b.orcamentoReais.min.toLocaleString('pt-BR')} a R$ ${b.orcamentoReais.max.toLocaleString('pt-BR')}`;
  const lines = [
    `Cliente: ${b.cliente.nome}${b.cliente.perfil ? ` (${b.cliente.perfil})` : ''}`,
    `Orçamento: ${orc}`,
    b.lugaresMin ? `Lugares mínimos: ${b.lugaresMin}` : null,
    b.portaMalasMinL ? `Porta-malas mínimo: ${b.portaMalasMinL} litros` : null,
    b.anoMin ? `Ano mínimo: ${b.anoMin}` : null,
    b.anoMax ? `Ano máximo: ${b.anoMax}` : null,
    b.tiposDesejados.length ? `Tipos de carroceria: ${b.tiposDesejados.join(', ')}` : null,
    b.combustiveisAceitos.length ? `Combustíveis aceitos: ${b.combustiveisAceitos.join(', ')}` : null,
    b.estiloDeVida.length ? `Estilo de vida / uso: ${b.estiloDeVida.join(', ')}` : null,
    b.prioridades.length ? `Prioridades (em ordem): ${b.prioridades.join(', ')}` : null,
    b.observacoes ? `Observações livres do consultor: ${b.observacoes}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

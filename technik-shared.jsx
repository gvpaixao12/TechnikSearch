/* Technik — Componentes compartilhados (logo, ícones, silhuetas, CarCard) */
/* global React */

const { useState, useMemo, useEffect, useRef } = React;

// ─── Logo ─────────────────────────────────────────────────────
function TechnikLogo({ height = 32, color, sublabel = true, style }) {
  // SVG-recreated logo so we can color it dynamically
  const c = color || 'currentColor';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', ...style }}>
      <svg viewBox="0 0 220 56" style={{ height, width: 'auto', display: 'block' }} aria-label="Technik">
        <g fill={c} fontFamily="Exo, sans-serif" fontWeight="700" letterSpacing="-0.5">
          <text x="0" y="40" fontSize="44">Technik</text>
          {/* magnifier with car */}
          <circle cx="161" cy="14" r="9.5" fill="none" stroke={c} strokeWidth="2.4" />
          <path d="M168 21 L173 26" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M155 16 L155.5 14 L157 12.5 L165 12.5 L166.5 14 L167 16 Z M156.5 16 L156.5 17 M165.5 16 L165.5 17" 
                fill={c} stroke={c} strokeWidth="0.6" strokeLinejoin="round" transform="translate(0,-1)" />
        </g>
      </svg>
      {sublabel && (
        <div style={{
          fontFamily: 'Exo, sans-serif',
          fontSize: Math.max(10, height * 0.30),
          fontWeight: 500,
          color: 'var(--tk-secondary)',
          letterSpacing: '0.04em',
          marginTop: -2,
          marginLeft: 1
        }}>
          Consultoria Automotiva
        </div>
      )}
    </div>
  );
}

// White variant for dark sidebar
function TechnikLogoMark({ height = 38 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, color: '#fff' }}>
      <svg viewBox="0 0 220 56" style={{ height, width: 'auto', display: 'block' }} aria-label="Technik">
        <g fill="#fff" fontFamily="Exo, sans-serif" fontWeight="700" letterSpacing="-0.5">
          <text x="0" y="40" fontSize="44">Technik</text>
          <circle cx="161" cy="14" r="9.5" fill="none" stroke="#fff" strokeWidth="2.4" />
          <path d="M168 21 L173 26" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </svg>
      <div style={{
        fontFamily: 'Exo, sans-serif', fontSize: 11, fontWeight: 500,
        color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em', marginTop: -2
      }}>
        Consultoria Automotiva
      </div>
    </div>
  );
}

// ─── Icons (line, 1.6 stroke) ─────────────────────────────────
const Icon = {
  Car: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 17h14M5 17l-1.5-4.5L6 7h12l2.5 5.5L19 17M7 11h10M7 17v2H5v-2M19 17v2h-2v-2"/><circle cx="8" cy="14.5" r="1.2"/><circle cx="16" cy="14.5" r="1.2"/></svg>),
  Search: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>),
  Users: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M16 12a3 3 0 1 0 0-6M21 19c0-2.4-2-4.2-4.5-4.8"/></svg>),
  History: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4M12 7v5l3 2"/></svg>),
  Reports: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>),
  Settings: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>),
  Bell: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>),
  Plus: (p) => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14"/></svg>),
  Check: (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 12l5 5L20 6"/></svg>),
  ChevronRight: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m9 6 6 6-6 6"/></svg>),
  Sparkle: (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><path d="M12 2 13.5 8 19 9.5 13.5 11 12 17 10.5 11 5 9.5 10.5 8Z"/><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" opacity=".7"/></svg>),
  Bookmark: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 4h12v17l-6-4-6 4Z"/></svg>),
  Compare: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 3v18M15 3v18M3 7l3-3 3 3M21 17l-3 3-3-3"/></svg>),
  Filter: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 5h16l-6 8v6l-4-2v-4Z"/></svg>),
  Family: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="7" r="2.5"/><circle cx="16" cy="8" r="2"/><path d="M5 19c0-3 2-5 4-5s4 2 4 5M14 19c0-2 1.5-4 3-4s3 2 3 4"/></svg>),
  Fuel: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M9 11h2M17 8l3 3v8a2 2 0 1 1-4 0v-3a2 2 0 0 0-2-2"/></svg>),
  Suitcase: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/></svg>),
  Star: (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}><path d="M12 3 14.5 9l6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9Z"/></svg>),
  Lightning: (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M13 3 4 14h6l-1 7 9-11h-6Z"/></svg>),
  Eye: (p) => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>),
  Download: (p) => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4v12m0 0 4-4m-4 4-4-4M4 20h16"/></svg>),
};

// ─── Car silhouettes (SVG) ────────────────────────────────────
const CarSilhouette = ({ type = 'suv', stroke = 'currentColor', fill = 'none', sw = 1.4 }) => {
  const props = { fill, stroke, strokeWidth: sw, strokeLinejoin: 'round', strokeLinecap: 'round' };
  switch (type) {
    case 'sedan':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M8 36 L14 22 Q24 14 38 13 L72 13 Q86 13 98 22 L112 28 Q116 30 116 34 L116 38 L8 38 Z"/><path d="M28 22 L50 16 L72 16 L88 22"/><circle cx="32" cy="38" r="6"/><circle cx="92" cy="38" r="6"/></svg>);
    case 'hatch':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M14 36 L18 22 Q26 14 40 13 L70 13 Q80 13 90 22 L100 32 L106 34 L106 38 L14 38 Z"/><path d="M30 22 L52 16 L70 16 L84 22"/><circle cx="32" cy="38" r="6"/><circle cx="86" cy="38" r="6"/></svg>);
    case 'suv':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M10 36 L12 24 Q16 16 28 14 L82 14 Q96 14 106 22 L114 28 Q116 30 116 34 L116 38 L10 38 Z"/><path d="M22 22 L40 16 L82 16 L98 22"/><circle cx="30" cy="38" r="7"/><circle cx="94" cy="38" r="7"/></svg>);
    case 'pickup':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M6 36 L10 24 Q14 18 24 16 L60 16 L64 26 L114 26 L114 38 L6 38 Z"/><path d="M22 22 L40 18 L58 18 L62 26"/><circle cx="28" cy="38" r="7"/><circle cx="98" cy="38" r="7"/></svg>);
    case 'coupe':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M8 36 L14 24 Q24 14 44 12 Q70 11 92 22 L112 30 Q114 32 114 36 L114 38 L8 38 Z"/><path d="M30 24 L54 14 L84 18 L98 24"/><circle cx="34" cy="38" r="6"/><circle cx="92" cy="38" r="6"/></svg>);
    case 'electric':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M10 36 L14 22 Q22 14 36 13 L78 13 Q92 13 102 22 L114 28 Q116 30 116 34 L116 38 L10 38 Z"/><path d="M26 22 L48 15 L78 15 L96 22"/><circle cx="32" cy="38" r="6"/><circle cx="92" cy="38" r="6"/><path d="M58 22 L54 28 L60 28 L56 34" strokeWidth="1.6"/></svg>);
    case 'minivan':
      return (<svg viewBox="0 0 120 50" {...props}><path d="M8 36 L10 18 Q14 12 26 11 L94 11 Q108 12 112 22 L114 28 L114 38 L8 38 Z"/><path d="M22 18 L40 14 L94 14 L106 22M62 14 L62 22"/><circle cx="30" cy="38" r="6"/><circle cx="96" cy="38" r="6"/></svg>);
    default: return null;
  }
};

// ─── Match ring ───────────────────────────────────────────────
function MatchRing({ pct = 80, size = 44 }) {
  return (
    <div className="tk-ring" style={{ '--p': pct, '--size': `${size}px` }}>
      <span>{pct}</span>
    </div>
  );
}

// ─── Fotos dos carros (backend cacheia em Supabase) ───────────
// Mesma lógica de API_BASE: localhost em dev, mesma origem em produção.
const CAR_PHOTO_API = window.API_BASE !== undefined
  ? window.API_BASE
  : (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '');

// Ordem e rótulos das categorias de foto (campo `view` que vem do backend).
const VIEW_ORDER = ['front', 'side', 'rear', 'interior'];
const VIEW_LABEL_PT = { front: 'Frente', side: 'Lateral', rear: 'Traseira', interior: 'Interior' };

// Agrupa as imagens por categoria, preservando a ordem de VIEW_ORDER e
// ignorando views desconhecidas. Devolve só as categorias que têm foto.
function groupByView(images) {
  const out = {};
  for (const v of VIEW_ORDER) {
    const arr = (images || []).filter(im => im.view === v);
    if (arr.length) out[v] = arr;
  }
  return out;
}

// Escolhe a foto da frente pro card (fallback: primeira disponível).
function pickFront(images) {
  if (!images || !images.length) return null;
  return images.find(im => im.view === 'front') || images[0];
}

function useCarImages({ brand, model, year, enabled = true }) {
  const [state, setState] = useState({ loading: false, images: [] });
  useEffect(() => {
    if (!enabled || !brand || !model || !year) return;
    let cancelled = false;
    setState({ loading: true, images: [] });
    const url = `${CAR_PHOTO_API}/api/images/${encodeURIComponent(brand)}/${encodeURIComponent(model)}/${year}`;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setState({ loading: false, images: data.images || [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, images: [] }); });
    return () => { cancelled = true; };
  }, [brand, model, year, enabled]);
  return state;
}

const _arrow = (side) => ({
  position: 'absolute', top: '50%', [side]: 8, transform: 'translateY(-50%)',
  width: 32, height: 32, borderRadius: '50%', border: 'none', padding: 0,
  background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 22, fontWeight: 600, lineHeight: 1,
  transition: 'background .15s, opacity .15s', opacity: 0.85,
});

// Lazy-load via IntersectionObserver. Aspecto 4:3 (mais quadrado).
// No card mostra SÓ a foto da frente; clique abre o tour de fotos por categoria.
function CarPhoto({ brand, model, year, type = 'suv', eager = false, rounded = false, aspect = '4 / 3', openSignal = 0 }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(eager);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    if (visible || !containerRef.current) return;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) setVisible(true); }),
      { rootMargin: '200px' }
    );
    io.observe(containerRef.current);
    return () => io.disconnect();
  }, [visible]);

  // O card (pai) pode abrir a galeria clicando em qualquer lugar: cada clique
  // incrementa openSignal. Abrir por aqui mantém a busca de imagens centralizada.
  useEffect(() => { if (openSignal) setTourOpen(true); }, [openSignal]);

  const { images, loading } = useCarImages({ brand, model, year, enabled: visible });
  const n = images.length;
  const front = pickFront(images);

  const containerStyle = {
    position: 'relative', width: '100%', aspectRatio: aspect,
    overflow: 'hidden', borderRadius: rounded ? 8 : 0,
    background: 'rgba(0,0,0,0.04)',
  };

  if (!visible || n === 0) {
    return (
      <div ref={containerRef} style={containerStyle}>
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tk-primary)' }}>
          <CarSilhouette type={type} sw={1.4} />
        </div>
        {visible && loading && (
          <div style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: 'var(--tk-muted)', opacity: 0.6, fontFamily: 'JetBrains Mono, monospace' }}>
            carregando…
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        onClick={() => setTourOpen(true)}
        title="Ver todas as fotos"
        style={{ ...containerStyle, cursor: 'zoom-in' }}
      >
        <img
          src={front.url}
          alt={`${brand} ${model} ${year}`}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {n > 1 && (
          <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            {n}
          </div>
        )}
      </div>

      {tourOpen && (
        <PhotoTourModal
          brand={brand} model={model} year={year}
          images={images}
          onClose={() => setTourOpen(false)}
        />
      )}
    </>
  );
}

// Modal "Tour por fotos" (estilo galeria Airbnb): faixa de categorias no topo,
// uma seção por categoria com foto grande + miniaturas, e lightbox interno com
// navegação dentro da categoria. Recebe as imagens já com o campo `view`.
function PhotoTourModal({ brand, model, year, images, onClose }) {
  const grouped = useMemo(() => groupByView(images), [images]);
  const views = Object.keys(grouped);
  const [lb, setLb] = useState(null); // { view, idx } | null

  // Trava o scroll do body enquanto o modal está aberto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Pré-carrega tudo pra navegação instantânea.
  useEffect(() => {
    images.forEach(im => { const i = new Image(); i.src = im.url; });
  }, [images]);

  const lbList = lb ? grouped[lb.view] : null;
  const lbCur = lbList ? lbList[lb.idx % lbList.length] : null;

  const lbGo = (delta) => (e) => {
    if (e) e.stopPropagation();
    setLb(s => {
      if (!s) return s;
      const list = grouped[s.view];
      return { ...s, idx: (s.idx + delta + list.length) % list.length };
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (lb) setLb(null); else onClose(); }
      else if (lb && e.key === 'ArrowRight') lbGo(1)();
      else if (lb && e.key === 'ArrowLeft') lbGo(-1)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb]);

  return ReactDOM.createPortal(
    // stopPropagation: eventos de um portal sobem pela árvore REACT (não a DOM),
    // então cliques aqui chegariam no onClick do card e reabririam a galeria.
    <div className="tk-gallery" onClick={(e) => e.stopPropagation()}>
      {/* Barra superior: voltar pro top 10 + título do carro */}
      <div className="tk-gallery__bar">
        <button className="tk-gallery__back" onClick={onClose} aria-label="Voltar ao top 10">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          Voltar
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="tk-gallery__title-brand">{brand} · {year}</div>
          <div className="tk-gallery__title-model">{model}</div>
        </div>
      </div>

      {/* Uma seção por categoria de foto: título + as fotos que temos */}
      <div className="tk-gallery__inner">
        {views.map(v => (
          <section key={v} className="tk-gallery__section">
            <h3>{VIEW_LABEL_PT[v]}</h3>
            <div className="tk-gallery__grid">
              {grouped[v].map((im, i) => (
                <img
                  key={i}
                  src={im.url}
                  alt={`${model} ${VIEW_LABEL_PT[v]} ${i + 1}`}
                  loading="lazy"
                  onClick={() => setLb({ view: v, idx: i })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Lightbox interno (zoom full-screen, navega dentro da categoria) */}
      {lbCur && (
        <div
          onClick={(e) => { e.stopPropagation(); setLb(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000000, background: 'rgba(0,0,0,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={lbCur.url} alt={`${brand} ${model} ${year}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', boxShadow: '0 30px 100px rgba(0,0,0,0.6)', cursor: 'default' }} />
          {lbList.length > 1 && (
            <>
              <button onClick={lbGo(-1)} aria-label="Anterior" style={{ ..._arrow('left'), left: 24, width: 52, height: 52, fontSize: 34, background: 'rgba(255,255,255,0.18)' }}>‹</button>
              <button onClick={lbGo(1)} aria-label="Próxima" style={{ ..._arrow('right'), right: 24, width: 52, height: 52, fontSize: 34, background: 'rgba(255,255,255,0.18)' }}>›</button>
              <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, opacity: 0.85, background: 'rgba(0,0,0,0.5)', padding: '6px 14px', borderRadius: 999 }}>
                {VIEW_LABEL_PT[lb.view]} · {(lb.idx % lbList.length) + 1} / {lbList.length}
              </div>
            </>
          )}
          <button onClick={(e) => { e.stopPropagation(); setLb(null); }} aria-label="Fechar" style={{ position: 'absolute', top: 20, right: 24, width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── Car catalog ──────────────────────────────────────────────
const CARS = [
  { id: 'tig',  brand: 'Volkswagen', model: 'Tiguan Allspace', year: 2024, type: 'suv',     price: 'R$ 312.900', priceN: 312900, match: 96, why: ['Porta-malas de 480L acomoda família e bagagem', '7 lugares para imprevistos', 'Custo de manutenção dentro do orçamento'] },
  { id: 'rav',  brand: 'Toyota',     model: 'RAV4 Hybrid',     year: 2024, type: 'electric',price: 'R$ 298.500', priceN: 298500, match: 93, why: ['Híbrido entrega 18 km/L em ciclo urbano', 'Robustez Toyota — revenda preservada', 'Tração AWD para fim-de-semana fora da cidade'] },
  { id: 'cor',  brand: 'Toyota',     model: 'Corolla Altis',   year: 2024, type: 'sedan',   price: 'R$ 198.700', priceN: 198700, match: 91, why: ['Conforto de viagem premium no segmento', 'Centrais multimídia e ADAS de série', 'Confiabilidade comprovada em consultoria'] },
  { id: 'comp', brand: 'Jeep',       model: 'Compass Limited', year: 2024, type: 'suv',     price: 'R$ 234.900', priceN: 234900, match: 88, why: ['Posição de dirigir alta e visibilidade', 'Pacote off-light para estradas de terra', 'Boa oferta no estoque atual'] },
  { id: 'civ',  brand: 'Honda',      model: 'Civic Touring',   year: 2024, type: 'sedan',   price: 'R$ 224.500', priceN: 224500, match: 86, why: ['Direção esportiva com baixo consumo', 'Acabamento e isolamento acústico premium', 'Honda Sensing completo de série'] },
  { id: 'kic',  brand: 'Nissan',     model: 'Kicks Exclusive', year: 2024, type: 'suv',     price: 'R$ 159.900', priceN: 159900, match: 84, why: ['SUV compacto fácil de manobrar', 'Bom espaço interno para 5 pessoas', 'Dentro do orçamento com folga'] },
  { id: 'arg',  brand: 'Fiat',       model: 'Argo Trekking',   year: 2024, type: 'hatch',   price: 'R$ 102.700', priceN: 102700, match: 81, why: ['Hatch com visual aventureiro', 'Manutenção econômica e barata', 'Ótimo custo-benefício comprovado'] },
  { id: 'ran',  brand: 'Ford',       model: 'Ranger XLT',      year: 2024, type: 'pickup',  price: 'R$ 289.000', priceN: 289000, match: 79, why: ['Picape robusta para trabalho e lazer', 'Caçamba de 1.230 litros', 'Tração 4x4 e diesel torque alto'] },
  { id: 'pol',  brand: 'Volkswagen', model: 'Polo Highline',   year: 2024, type: 'hatch',   price: 'R$ 119.500', priceN: 119500, match: 77, why: ['Hatch europeu com acabamento premium', 'Bom para uso urbano', 'Revenda VW consistente'] },
  { id: 'mus',  brand: 'Ford',       model: 'Mustang Mach 1',  year: 2023, type: 'coupe',   price: 'R$ 549.000', priceN: 549000, match: 72, why: ['Coupé V8 470cv para o fim-de-semana', 'Som e desempenho icônicos', 'Acima do orçamento — segunda escolha'] },
];

// ─── Dataset for the form ─────────────────────────────────────
const TYPE_OPTIONS = [
  { id: 'sedan',    label: 'Sedan' },
  { id: 'hatch',    label: 'Hatch' },
  { id: 'suv',      label: 'SUV' },
  { id: 'pickup',   label: 'Picape' },
  { id: 'coupe',    label: 'Coupé' },
];
const FUEL_OPTIONS = [
  { id: 'flex',     label: 'Flex' },
  { id: 'gas',      label: 'Gasolina' },
  { id: 'diesel',   label: 'Diesel' },
  { id: 'hybrid',   label: 'Híbrido' },
  { id: 'plugin',   label: 'Híbrido plug-in' },
  { id: 'electric', label: 'Elétrico' },
];
const LIFESTYLE_OPTIONS = [
  { id: 'family',   label: 'Família' },
  { id: 'urban',    label: 'Cidade' },
  { id: 'travel',   label: 'Viagens longas' },
  { id: 'work',     label: 'Trabalho' },
  { id: 'offroad',  label: 'Estradas de terra' },
  { id: 'sport',    label: 'Esportivo' },
];
const PRIORITY_OPTIONS = [
  { id: 'safety',     label: 'Segurança' },
  { id: 'comfort',    label: 'Conforto' },
  { id: 'economy',    label: 'Economia' },
  { id: 'tech',       label: 'Tecnologia' },
  { id: 'design',     label: 'Design' },
  { id: 'resale',     label: 'Revenda' },
];

Object.assign(window, {
  TechnikLogo, TechnikLogoMark, Icon, CarSilhouette, MatchRing,
  CarPhoto, useCarImages,
  CARS, TYPE_OPTIONS, FUEL_OPTIONS, LIFESTYLE_OPTIONS, PRIORITY_OPTIONS
});

// shared.jsx — components used by all 3 variations.
// Exports to window so other scripts can reference them.

const { useState, useEffect, useRef, useMemo } = React;

// ─── Tiny SVG icon set ───────────────────────────────────────────────────
const Icon = ({ name, size = 16, stroke = 1.6 }) => {
  const c = "currentColor";
  const props = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: c, strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round"
  };
  switch (name) {
    case "search":     return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
    case "user":       return <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>;
    case "users":      return <svg {...props}><circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><circle cx="17" cy="6" r="3"/><path d="M22 19c0-2.8-2.2-5-5-5"/></svg>;
    case "history":    return <svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>;
    case "settings":   return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case "arrow-r":    return <svg {...props}><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>;
    case "arrow-l":    return <svg {...props}><path d="M19 12H5"/><path d="m11 5-7 7 7 7"/></svg>;
    case "check":      return <svg {...props}><path d="M20 6 9 17l-5-5"/></svg>;
    case "plus":       return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case "minus":      return <svg {...props}><path d="M5 12h14"/></svg>;
    case "x":          return <svg {...props}><path d="M18 6 6 18M6 6l18 12"/></svg>;
    case "heart":      return <svg {...props}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>;
    case "compare":    return <svg {...props}><path d="M3 6h7v14H3z"/><path d="M14 4h7v18h-7z"/><path d="M10 10h4M10 14h4"/></svg>;
    case "send":       return <svg {...props}><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>;
    case "spark":      return <svg {...props}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>;
    case "fuel":       return <svg {...props}><path d="M3 22V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v18"/><path d="M3 14h11"/><path d="M14 8h2a3 3 0 0 1 3 3v6a2 2 0 0 0 4 0v-9l-3-3"/></svg>;
    case "gauge":      return <svg {...props}><path d="M12 14 8 10"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>;
    case "trunk":      return <svg {...props}><path d="M3 17V8h18v9"/><path d="M3 17h18v3H3z"/><path d="M9 12h6"/></svg>;
    case "cog":        return <svg {...props}><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="5"/></svg>;
    case "filter":     return <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>;
    case "save":       return <svg {...props}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21V13H7v8M7 3v5h8"/></svg>;
    case "edit":       return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>;
    case "share":      return <svg {...props}><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8.6 13.5 6.8 3M15.4 7.5l-6.8 3"/></svg>;
    case "chevron-r":  return <svg {...props}><path d="m9 6 6 6-6 6"/></svg>;
    case "chevron-d":  return <svg {...props}><path d="m6 9 6 6 6-6"/></svg>;
    case "sparkles":   return <svg {...props}><path d="M9 3 11 8 16 10 11 12 9 17 7 12 2 10 7 8z"/><path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg>;
    case "mic":        return <svg {...props}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>;
    default: return null;
  }
};

// ─── Match Ring (% with conic gradient ring) ───────────────────────────
const MatchRing = ({ score, size = 44 }) => (
  <div className="tk-ring" style={{ "--p": score, "--size": size + "px" }}>
    <span style={{ fontSize: size > 60 ? 22 : 13 }}>{score}</span>
  </div>
);

// ─── Car SVG silhouette (placeholder while user drops real photos) ─────
// Different shapes per type so cards still feel distinct.
const CarSilhouette = ({ type = "Hatch", color = "#ddd6c5" }) => {
  // simple parametric silhouettes
  const ink = "rgba(0,0,0,0.35)";
  const window_ = "rgba(0,0,0,0.18)";
  if (type === "Picape") {
    return (
      <svg viewBox="0 0 220 100" style={{ width: "100%", height: "100%" }}>
        <path d="M10 78 C 10 60 25 56 45 56 L 75 50 L 95 38 L 130 38 L 145 56 L 200 56 C 210 56 212 64 212 76 L 212 82 L 10 82 Z" fill={color}/>
        <path d="M75 52 L 90 42 L 128 42 L 142 52 Z" fill={window_}/>
        <circle cx="48" cy="82" r="11" fill={ink}/>
        <circle cx="170" cy="82" r="11" fill={ink}/>
        <circle cx="48" cy="82" r="5" fill="#999"/>
        <circle cx="170" cy="82" r="5" fill="#999"/>
      </svg>
    );
  }
  if (type === "SUV") {
    return (
      <svg viewBox="0 0 220 100" style={{ width: "100%", height: "100%" }}>
        <path d="M16 76 C 16 56 28 50 48 48 L 70 36 C 80 30 90 28 110 28 L 140 28 C 156 28 168 36 178 48 L 196 52 C 208 54 210 62 210 74 L 210 82 L 16 82 Z" fill={color}/>
        <path d="M70 38 C 80 32 90 32 108 32 L 138 32 C 152 32 162 38 168 48 L 80 48 Z" fill={window_}/>
        <circle cx="56" cy="82" r="12" fill={ink}/>
        <circle cx="168" cy="82" r="12" fill={ink}/>
        <circle cx="56" cy="82" r="5.5" fill="#999"/>
        <circle cx="168" cy="82" r="5.5" fill="#999"/>
      </svg>
    );
  }
  if (type === "Esportivo") {
    return (
      <svg viewBox="0 0 220 100" style={{ width: "100%", height: "100%" }}>
        <path d="M12 80 C 12 70 20 66 36 64 L 60 56 C 80 44 110 40 134 44 L 168 56 C 188 60 208 66 210 78 L 210 84 L 12 84 Z" fill={color}/>
        <path d="M64 58 C 84 48 108 46 130 50 L 158 60 L 84 60 Z" fill={window_}/>
        <circle cx="56" cy="84" r="11" fill={ink}/>
        <circle cx="168" cy="84" r="11" fill={ink}/>
        <circle cx="56" cy="84" r="5" fill="#999"/>
        <circle cx="168" cy="84" r="5" fill="#999"/>
      </svg>
    );
  }
  if (type === "Sedan") {
    return (
      <svg viewBox="0 0 220 100" style={{ width: "100%", height: "100%" }}>
        <path d="M10 78 C 10 64 22 58 40 56 L 64 42 C 76 36 90 34 110 34 L 138 34 C 158 36 168 44 178 56 L 200 60 C 210 62 212 70 212 78 L 212 82 L 10 82 Z" fill={color}/>
        <path d="M64 44 C 76 38 90 38 108 38 L 134 38 C 152 40 162 46 168 56 L 78 56 Z" fill={window_}/>
        <circle cx="52" cy="82" r="11" fill={ink}/>
        <circle cx="170" cy="82" r="11" fill={ink}/>
        <circle cx="52" cy="82" r="5" fill="#999"/>
        <circle cx="170" cy="82" r="5" fill="#999"/>
      </svg>
    );
  }
  // Hatch (default)
  return (
    <svg viewBox="0 0 220 100" style={{ width: "100%", height: "100%" }}>
      <path d="M14 78 C 14 62 28 56 48 54 L 70 42 C 82 36 96 34 116 34 L 144 34 C 158 36 168 44 174 54 L 196 58 C 206 60 208 68 208 78 L 208 82 L 14 82 Z" fill={color}/>
      <path d="M70 44 C 82 38 96 38 114 38 L 142 38 C 154 40 162 46 168 54 L 80 54 Z" fill={window_}/>
      <circle cx="56" cy="82" r="11" fill={ink}/>
      <circle cx="166" cy="82" r="11" fill={ink}/>
      <circle cx="56" cy="82" r="5" fill="#999"/>
      <circle cx="166" cy="82" r="5" fill="#999"/>
    </svg>
  );
};

// Color rotation for silhouettes (diversity in the grid)
const CAR_COLORS = ["#cdd5db","#e6dfd0","#c2b8a4","#3a3a3e","#86614a","#d4c4b0","#9aa4ab","#1c1c1c"];
function colorFor(id) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CAR_COLORS[h % CAR_COLORS.length];
}

// ─── CarCard (3 styles via prop) ────────────────────────────────────────
// style: "editorial" | "minimal" | "magazine"
const CarCard = ({ car, score, reasons, rank, style = "editorial", onCompare, isCompare, onOpen }) => {
  const carColor = colorFor(car.id);
  const tag = score >= 90 ? "Match Premium"
            : score >= 80 ? "Forte Recomendação"
            : score >= 70 ? "Boa Combinação"
            : "Considere";

  if (style === "minimal") {
    // Clean white card, score top-right ring
    return (
      <article className="tk-card tk-cc-min" onClick={onOpen}>
        <header className="tk-cc-min__head">
          <span className="tk-pill tk-pill-outline">#{rank}</span>
          <MatchRing score={score} size={42}/>
        </header>
        <div className="tk-cc-min__img">
          <CarSilhouette type={car.type} color={carColor}/>
        </div>
        <div className="tk-cc-min__body">
          <div className="tk-eyebrow">{car.brand}</div>
          <h3 className="tk-display" style={{ fontSize: 22, margin: "2px 0 4px" }}>{car.model}</h3>
          <div className="tk-help" style={{ marginBottom: 10 }}>{car.trim}</div>
          <div className="tk-cc-min__meta">
            <span><Icon name="fuel" size={13}/> {car.fuel}</span>
            <span><Icon name="cog" size={13}/> {car.gearbox}</span>
            <span><Icon name="trunk" size={13}/> {car.trunkL || "—"}L</span>
          </div>
          <div className="tk-cc-min__price">{window.formatBRL(car.price)}</div>
        </div>
        <footer className="tk-cc-min__foot">
          <button className="tk-btn tk-btn-primary" style={{padding:"10px 14px", fontSize:12}}>Ver oferta <Icon name="arrow-r" size={14}/></button>
          <button className={"tk-icobtn" + (isCompare ? " is-active":"")}
                  onClick={(e)=>{e.stopPropagation(); onCompare && onCompare(car);}}>
            <Icon name="compare" size={15}/>
          </button>
        </footer>
      </article>
    );
  }

  if (style === "magazine") {
    // Rank as huge serif numeral, image to the right
    return (
      <article className="tk-card tk-cc-mag" onClick={onOpen}>
        <div className="tk-cc-mag__rank">
          <div className="tk-rank">{String(rank).padStart(2,"0")}</div>
          <div className="tk-eyebrow" style={{marginTop:6}}>{tag}</div>
          <div className="tk-cc-mag__score">
            <MatchRing score={score} size={38}/>
            <span className="tk-mono" style={{fontSize:11, color:"var(--tk-muted)"}}>match</span>
          </div>
        </div>
        <div className="tk-cc-mag__main">
          <div className="tk-cc-mag__img">
            <CarSilhouette type={car.type} color={carColor}/>
          </div>
          <div className="tk-cc-mag__info">
            <div className="tk-eyebrow">{car.brand} · {car.year} · 0 km</div>
            <h3 className="tk-display" style={{ fontSize: 26, margin: "4px 0 6px" }}>{car.model}</h3>
            <div className="tk-help" style={{ marginBottom: 10 }}>{car.trim}</div>
            <div className="tk-cc-mag__why">
              <Icon name="sparkles" size={13}/>
              <span>{reasons[0] || car.highlight}</span>
            </div>
            <div className="tk-cc-mag__bar">
              <div>
                <div className="tk-eyebrow">a partir de</div>
                <div className="tk-cc-mag__price">{window.formatBRL(car.price)}</div>
              </div>
              <div className="tk-cc-mag__actions">
                <button className={"tk-icobtn" + (isCompare ? " is-active":"")} title="Comparar"
                        onClick={(e)=>{e.stopPropagation(); onCompare && onCompare(car);}}>
                  <Icon name="compare" size={15}/>
                </button>
                <button className="tk-btn tk-btn-primary" style={{padding:"10px 16px", fontSize:12}}>
                  Detalhes <Icon name="arrow-r" size={14}/>
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>
    );
  }

  // "editorial" — default: rank pill, gold band, prós/contras teaser
  return (
    <article className="tk-card tk-cc-ed" onClick={onOpen}>
      <header className="tk-cc-ed__head">
        <div className="tk-cc-ed__rank">
          <span className="tk-mono">No.</span><span className="tk-cc-ed__rnum">{rank}</span>
        </div>
        <span className={"tk-pill " + (score >= 85 ? "tk-pill-gold" : "tk-pill-outline")}>{tag}</span>
      </header>
      <div className="tk-cc-ed__img">
        <CarSilhouette type={car.type} color={carColor}/>
        <div className="tk-cc-ed__match">
          <MatchRing score={score} size={48}/>
        </div>
      </div>
      <div className="tk-cc-ed__body">
        <div className="tk-eyebrow">{car.brand}</div>
        <h3 className="tk-display" style={{ fontSize: 24, margin: "4px 0 4px" }}>{car.model}</h3>
        <div className="tk-help" style={{ marginBottom: 12 }}>{car.trim} · {car.year}</div>
        <ul className="tk-cc-ed__reasons">
          {reasons.slice(0,2).map((r,i)=>(
            <li key={i}><Icon name="check" size={13}/> {r}</li>
          ))}
        </ul>
      </div>
      <footer className="tk-cc-ed__foot">
        <div>
          <div className="tk-eyebrow">a partir de</div>
          <div className="tk-cc-ed__price">{window.formatBRL(car.price)}</div>
        </div>
        <div style={{display:"flex", gap:6}}>
          <button className={"tk-icobtn" + (isCompare ? " is-active":"")}
                  onClick={(e)=>{e.stopPropagation(); onCompare && onCompare(car);}} title="Comparar">
            <Icon name="compare" size={15}/>
          </button>
          <button className="tk-btn tk-btn-primary" style={{padding:"10px 14px", fontSize:12}}>
            Ver <Icon name="arrow-r" size={14}/>
          </button>
        </div>
      </footer>
    </article>
  );
};

// ─── Sidebar (used by all variations) ───────────────────────────────────
const Sidebar = ({ active, onSelect, profilesCount, theme, onTheme }) => {
  const items = [
    { id:"new",      label:"Nova consulta", icon:"plus" },
    { id:"profiles", label:"Clientes",      icon:"users", badge: profilesCount },
    { id:"history",  label:"Histórico",     icon:"history" },
    { id:"compare",  label:"Comparativo",   icon:"compare" },
  ];
  return (
    <aside className="tk-side">
      <div className="tk-side__brand">
        <span className="tk-logo">technik</span>
      </div>
      <nav className="tk-side__nav">
        {items.map(it => (
          <button key={it.id}
            className={"tk-side__item" + (active === it.id ? " is-active" : "")}
            onClick={()=>onSelect && onSelect(it.id)}>
            <Icon name={it.icon} size={16}/>
            <span>{it.label}</span>
            {it.badge ? <span className="tk-side__badge">{it.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="tk-side__foot">
        <button className="tk-side__theme" onClick={onTheme}>
          <span>{theme === "dark" ? "Modo escuro" : "Modo claro"}</span>
          <span className={"tk-toggle " + (theme === "dark" ? "is-on":"")}><span/></span>
        </button>
        <div className="tk-side__user">
          <div className="tk-side__avatar">JC</div>
          <div>
            <div style={{fontSize:13, fontWeight:500}}>Júlia Castro</div>
            <div className="tk-help">Consultora · technik</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

// ─── Saved profile card ─────────────────────────────────────────────────
const ProfileMini = ({ p, onClick }) => (
  <button className="tk-profile-mini" onClick={onClick}>
    <div className="tk-profile-mini__av">{p.initials}</div>
    <div style={{flex:1, textAlign:"left"}}>
      <div style={{fontSize:13, fontWeight:500}}>{p.name}</div>
      <div className="tk-help">{p.age} anos · {p.marital} · {p.types.join(" / ")}</div>
    </div>
    <span className="tk-help">{p.date}</span>
  </button>
);

// ─── Loading screen (used after submit) ─────────────────────────────────
const LoadingScreen = ({ profile }) => {
  const steps = [
    "Lendo perfil do cliente",
    "Filtrando 247 modelos do mercado",
    "Cruzando estilo de vida e prioridades",
    "Calculando match individual",
    "Selecionando o Top 10"
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => Math.min(x+1, steps.length-1)), 480);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="tk-loading">
      <div className="tk-loading__inner">
        <div className="tk-eyebrow">Technik · curadoria</div>
        <h2 className="tk-display" style={{fontSize:42, margin:"10px 0 4px"}}>
          Selecionando os 10 melhores carros<br/>para {profile?.name?.split(" ")[0] || "este cliente"}
        </h2>
        <p style={{color:"var(--tk-muted)", maxWidth:520, lineHeight:1.5}}>
          Nosso algoritmo cruza estilo de vida, perfil familiar e prioridades com o catálogo
          atualizado de 247 modelos disponíveis no Brasil.
        </p>
        <div className="tk-progress-stripes" style={{margin:"24px 0 18px", maxWidth:380}}/>
        <ul className="tk-loading__steps">
          {steps.map((s, k) => (
            <li key={k} className={k <= i ? "is-on" : ""}>
              <span className="tk-loading__dot">{k < i ? "✓" : k === i ? "·" : ""}</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

Object.assign(window, {
  Icon, MatchRing, CarSilhouette, CarCard, Sidebar, ProfileMini, LoadingScreen
});

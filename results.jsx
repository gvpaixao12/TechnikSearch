// results.jsx — Top 10 grid + spotlight + compare bar

const Results = ({ profile, onBack, cardStyle = "editorial" }) => {
  const { useState, useMemo } = React;
  const [compare, setCompare] = useState([]);
  const [filter, setFilter] = useState("all");

  const ranked = useMemo(() => {
    return window.TECHNIK_CARS
      .map(car => ({ car, ...window.scoreCar(car, profile) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 10);
  }, [profile]);

  const filtered = filter === "all"
    ? ranked
    : ranked.filter(r => r.car.type === filter);

  const top1 = ranked[0];
  const rest = filtered.slice(top1 && filter === "all" ? 1 : 0);

  const toggleCompare = (car) => {
    setCompare(prev => {
      if (prev.find(c => c.id === car.id)) return prev.filter(c => c.id !== car.id);
      if (prev.length >= 3) return prev;
      return [...prev, car];
    });
  };

  const types = ["all", ...Array.from(new Set(ranked.map(r => r.car.type)))];
  const avgScore = Math.round(ranked.reduce((s,r) => s + r.score, 0) / ranked.length);

  return (
    <div className="tk-results tk-scroll">
      <div className="tk-results__hero">
        <div>
          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
            <button className="tk-icobtn" onClick={onBack} title="Voltar">
              <Icon name="arrow-l" size={15}/>
            </button>
            <span className="tk-eyebrow">Top 10 · curadoria Technik</span>
          </div>
          <h1>Os 10 carros que mais combinam com {profile.name || "este cliente"}.</h1>
          <p>
            Cruzamos {profile.types?.length ? profile.types.join(", ").toLowerCase() : "carrocerias"},
            faixa de orçamento de {window.formatBRL(profile.budget?.[0] || 0)}–{window.formatBRL(profile.budget?.[1] || 0)},
            uso {profile.use || "geral"} e prioridade em <strong>{profile.priority || "conforto"}</strong>.
            Cada carro recebeu uma nota de match individual com explicação.
          </p>
          <div className="tk-results__pills">
            <span className="tk-results__pill"><Icon name="users" size={11}/> {profile.kids ? `${profile.kids} filhos` : "sem filhos"}</span>
            {profile.age && <span className="tk-results__pill">{profile.age} anos</span>}
            {profile.marital && <span className="tk-results__pill">{profile.marital}</span>}
            {profile.priority && <span className="tk-results__pill" style={{background:"var(--tk-gold)", color:"#1f1606"}}><Icon name="sparkles" size={11}/> {profile.priority}</span>}
            <span className="tk-results__pill">média de match {avgScore}%</span>
          </div>
        </div>
        <div className="tk-results__client">
          <div className="tk-eyebrow" style={{marginBottom:8}}>Snapshot do cliente</div>
          <div className="tk-results__client-row"><span>Tipos buscados</span><strong>{(profile.types || []).join(", ") || "—"}</strong></div>
          <div className="tk-results__client-row"><span>Orçamento</span><strong>{(profile.budget?.[0]/1000 || 0).toFixed(0)}–{(profile.budget?.[1]/1000 || 0).toFixed(0)}k</strong></div>
          <div className="tk-results__client-row"><span>Uso</span><strong>{profile.use || "—"}</strong></div>
          <div className="tk-results__client-row"><span>Combustível</span><strong>{(profile.fuel || []).join(", ") || "—"}</strong></div>
          <div className="tk-results__client-row"><span>Câmbio</span><strong>{profile.gearbox || "—"}</strong></div>
          <div style={{display:"flex", gap:6, marginTop:10}}>
            <button className="tk-btn tk-btn-ghost" style={{padding:"8px 12px", fontSize:11.5, flex:1, justifyContent:"center"}}>
              <Icon name="edit" size={12}/> Editar
            </button>
            <button className="tk-btn tk-btn-ghost" style={{padding:"8px 12px", fontSize:11.5, flex:1, justifyContent:"center"}}>
              <Icon name="share" size={12}/> Compartilhar
            </button>
          </div>
        </div>
      </div>

      {/* Spotlight #1 */}
      {top1 && filter === "all" && (
        <div className="tk-spotlight tk-grain">
          <div className="tk-spotlight__img">
            <span className="tk-spotlight__rank">01</span>
            <div>
              <CarSilhouette type={top1.car.type} color="#d9b878"/>
            </div>
          </div>
          <div className="tk-spotlight__body">
            <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:4}}>
              <span className="tk-eyebrow">Match Premium</span>
              <span style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"var(--tk-gold)", color:"#1f1606",
                padding:"3px 10px", borderRadius:999,
                fontFamily:"var(--tk-font-mono)", fontSize:11, letterSpacing:".1em"
              }}>
                <Icon name="sparkles" size={11}/> {top1.score}% MATCH
              </span>
            </div>
            <div className="tk-eyebrow" style={{color:"rgba(255,255,255,0.5)", fontSize:10.5}}>{top1.car.brand} · {top1.car.year} · 0 km</div>
            <h3>{top1.car.model}</h3>
            <div className="tk-help">{top1.car.trim}</div>
            <ul className="tk-spotlight__why" style={{listStyle:"none", padding:0, margin:"14px 0 0"}}>
              {top1.reasons.map((r, i) => (
                <li key={i}><Icon name="check" size={14}/> {r}</li>
              ))}
              {top1.reasons.length === 0 && (
                <li><Icon name="check" size={14}/> {top1.car.highlight}</li>
              )}
            </ul>
            <div className="tk-spotlight__bar">
              <div>
                <div className="tk-eyebrow" style={{color:"rgba(255,255,255,0.5)", fontSize:10}}>a partir de</div>
                <div className="tk-spotlight__price">{window.formatBRL(top1.car.price)}</div>
              </div>
              <div style={{display:"flex", gap:8}}>
                <button className="tk-icobtn" style={{background:"transparent", borderColor:"rgba(255,255,255,0.2)", color:"#fff"}} onClick={()=>toggleCompare(top1.car)}>
                  <Icon name="compare" size={15}/>
                </button>
                <button className="tk-btn tk-btn-gold" style={{padding:"12px 20px"}}>
                  Ver detalhes <Icon name="arrow-r" size={14}/>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section header + filters */}
      <div className="tk-results__toolbar">
        <h2 className="tk-results__section-h" style={{margin:0}}>
          <span>{filter === "all" ? "Demais sugestões" : filter}</span>
          <span className="tk-eyebrow">{rest.length} carros</span>
        </h2>
        <div className="tk-results__filters">
          {types.map(t => (
            <button key={t} className={"tk-chip " + (filter === t ? "is-active":"")} onClick={()=>setFilter(t)}>
              {t === "all" ? "todos" : t}
            </button>
          ))}
        </div>
      </div>

      <div className={"tk-results__grid " + (cardStyle === "magazine" ? "tk-results__grid--mag" : "")}>
        {rest.map((r, i) => (
          <CarCard
            key={r.car.id}
            car={r.car}
            score={r.score}
            reasons={r.reasons.length ? r.reasons : [r.car.highlight]}
            rank={ranked.indexOf(r) + 1}
            style={cardStyle}
            isCompare={!!compare.find(c => c.id === r.car.id)}
            onCompare={toggleCompare}
          />
        ))}
      </div>

      {/* Compare bar */}
      {compare.length > 0 && (
        <div className="tk-compare-bar">
          <div className="tk-compare-bar__avs">
            {compare.map(c => (
              <div key={c.id} title={c.model}>{c.brand.slice(0,2).toUpperCase()}</div>
            ))}
          </div>
          <span style={{fontSize:13}}>
            {compare.length} {compare.length === 1 ? "carro selecionado" : "carros selecionados"}
            {compare.length < 3 && <span style={{opacity:0.5}}> · adicione até 3</span>}
          </span>
          <button className="tk-btn tk-btn-gold" style={{padding:"8px 14px", fontSize:12}}>
            <Icon name="compare" size={13}/> Comparar agora
          </button>
          <button className="tk-icobtn" style={{background:"transparent", border:"none", color:"#fff"}} onClick={()=>setCompare([])}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      )}
    </div>
  );
};

window.Results = Results;

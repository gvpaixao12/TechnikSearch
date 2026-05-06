// variation2-cards.jsx
// All-in-one form. Visual selectable cards for car types, sliders for ranges,
// chip groups for tags, live preview panel on the right.

const Q2 = ({ onSubmit, onSelectProfile }) => {
  const { useState } = React;
  const TYPES = window.TECHNIK_TYPES;
  const FUELS = window.TECHNIK_FUELS;
  const LIFES = window.TECHNIK_LIFESTYLES;
  const PRIOS = window.TECHNIK_PRIORITIES;
  const USES  = window.TECHNIK_USES;

  const [p, setP] = useState({
    name: "", age: 35, marital: "casado", kids: 0, kidsAge: "",
    profession: "", income: "12-18k",
    types: ["SUV"], budget: [120000, 250000],
    use: "família", fuel: ["flex"], gearbox: "automático",
    lifestyle: ["família"], priority: "conforto",
    space: "médio"
  });
  const upd = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  const toggle = (k, v) => setP(prev => ({
    ...prev,
    [k]: prev[k].includes(v) ? prev[k].filter(x=>x!==v) : [...prev[k], v]
  }));

  const filled = [p.name, p.types.length, p.priority, p.use, p.lifestyle.length].filter(Boolean).length;
  const completeness = Math.round((filled / 5) * 100);

  return (
    <div className="q2">
      <div className="q2__form tk-scroll">
        <div className="q2__hero">
          <span className="tk-eyebrow">Nova consulta</span>
          <h2>Quem é o cliente — e que carro combina com a vida dele.</h2>
          <p>Preencha o que souber. Quanto mais contexto, melhor o ranqueamento. Você pode salvar como rascunho a qualquer momento.</p>
        </div>

        {/* Identificação */}
        <section className="q2__sect" style={{borderTop: "none", paddingTop: 0}}>
          <div className="q2__sect-h">
            <h3>Cliente</h3>
            <span className="tk-help">básico</span>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">Nome</label>
              <input className="tk-input" value={p.name} onChange={e=>upd("name", e.target.value)} placeholder="Como o cliente assina"/>
            </div>
            <div className="q2__field">
              <label className="tk-label">Profissão</label>
              <input className="tk-input" value={p.profession} onChange={e=>upd("profession", e.target.value)} placeholder="Diretor, advogado, etc."/>
            </div>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">
                <span>Idade</span>
                <span className="tk-mono" style={{color:"var(--tk-gold-ink)", fontSize:13}}>{p.age} anos</span>
              </label>
              <input className="tk-range" type="range" min="18" max="80" value={p.age} onChange={e=>upd("age", +e.target.value)}/>
            </div>
            <div className="q2__field">
              <label className="tk-label">Renda mensal</label>
              <div className="q1__chips">
                {["até 5k","5-12k","12-18k","18-25k","25-50k","50k+"].map(v => (
                  <button key={v} className={"tk-chip " + (p.income === v ? "is-active":"")} onClick={()=>upd("income", v)}>{v}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Família */}
        <section className="q2__sect">
          <div className="q2__sect-h">
            <h3>Vida pessoal</h3>
            <span className="tk-help">define se é carro pessoal ou familiar</span>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">Estado civil</label>
              <div className="q1__chips">
                {["solteiro","namora","casado","divorciado"].map(v => (
                  <button key={v} className={"tk-chip " + (p.marital === v ? "is-active":"")} onClick={()=>upd("marital", v)}>{v}</button>
                ))}
              </div>
            </div>
            <div className="q2__field">
              <label className="tk-label">Filhos</label>
              <div style={{display:"flex", alignItems:"center", gap:14}}>
                <div className="tk-stepper">
                  <button onClick={()=>upd("kids", Math.max(0, p.kids-1))}><Icon name="minus" size={14}/></button>
                  <input value={p.kids} onChange={e=>upd("kids", Math.max(0, +e.target.value || 0))}/>
                  <button onClick={()=>upd("kids", p.kids+1)}><Icon name="plus" size={14}/></button>
                </div>
                {p.kids > 0 && (
                  <input className="tk-input" style={{flex:1}} value={p.kidsAge} onChange={e=>upd("kidsAge", e.target.value)} placeholder="idade dos filhos (ex.: 4 e 9)"/>
                )}
              </div>
            </div>
          </div>
          <div className="q2__field" style={{marginTop:6}}>
            <label className="tk-label">Estilo de vida</label>
            <div className="q1__chips">
              {LIFES.map(v => (
                <button key={v} className={"tk-chip " + (p.lifestyle.includes(v) ? "is-active":"")} onClick={()=>toggle("lifestyle", v)}>
                  {p.lifestyle.includes(v) && <Icon name="check" size={12}/>}
                  {v}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tipo de carro - cards visuais */}
        <section className="q2__sect">
          <div className="q2__sect-h">
            <h3>Carroceria</h3>
            <span className="tk-help">pode marcar mais de uma</span>
          </div>
          <div className="q2__type-grid">
            {TYPES.map(t => (
              <button key={t} className={"q2__type " + (p.types.includes(t) ? "is-on":"")} onClick={()=>toggle("types", t)}>
                <CarSilhouette type={t} color={p.types.includes(t) ? "var(--tk-gold)" : "var(--tk-line-2)"}/>
                <div className="tk-display" style={{fontSize:16}}>{t}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Orçamento */}
        <section className="q2__sect">
          <div className="q2__sect-h">
            <h3>Orçamento e técnica</h3>
            <span className="tk-help">faixa de preço, motor e câmbio</span>
          </div>
          <div className="q2__field">
            <label className="tk-label">
              <span>Faixa de investimento</span>
              <span className="tk-mono" style={{fontSize:12}}>{window.formatBRL(p.budget[0])} – {window.formatBRL(p.budget[1])}</span>
            </label>
            <input className="tk-range" type="range" min="50000" max="800000" step="5000" value={p.budget[0]}
              onChange={e=>upd("budget", [Math.min(+e.target.value, p.budget[1]-20000), p.budget[1]])}/>
            <input className="tk-range" type="range" min="50000" max="800000" step="5000" value={p.budget[1]}
              onChange={e=>upd("budget", [p.budget[0], Math.max(+e.target.value, p.budget[0]+20000)])} style={{marginTop:8}}/>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">Combustível</label>
              <div className="q1__chips">
                {FUELS.map(v => (
                  <button key={v} className={"tk-chip " + (p.fuel.includes(v) ? "is-active":"")} onClick={()=>toggle("fuel", v)}>
                    {p.fuel.includes(v) && <Icon name="check" size={12}/>}
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="q2__field">
              <label className="tk-label">Câmbio</label>
              <div className="q1__chips">
                {["automático","manual","tanto faz"].map(v => (
                  <button key={v} className={"tk-chip " + (p.gearbox === v ? "is-active":"")} onClick={()=>upd("gearbox", v)}>{v}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Uso */}
        <section className="q2__sect">
          <div className="q2__sect-h">
            <h3>Uso e prioridade</h3>
            <span className="tk-help">o que pesa mais na decisão</span>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">Uso principal</label>
              <div className="q1__chips">
                {USES.map(v => (
                  <button key={v} className={"tk-chip " + (p.use === v ? "is-active":"")} onClick={()=>upd("use", v)}>{v}</button>
                ))}
              </div>
            </div>
            <div className="q2__field">
              <label className="tk-label">Espaço necessário</label>
              <div className="q1__chips">
                {["baixo","médio","alto"].map(v => (
                  <button key={v} className={"tk-chip " + (p.space === v ? "is-active":"")} onClick={()=>upd("space", v)}>{v}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="q2__field">
            <label className="tk-label">Prioridade nº 1</label>
            <div className="q1__chips">
              {PRIOS.map(v => (
                <button key={v} className={"tk-chip " + (p.priority === v ? "is-active":"")} onClick={()=>upd("priority", v)}>{v}</button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <aside className="q2__side">
        <div className="q2__side-h">
          <div className="tk-eyebrow">Resumo da consulta</div>
          <h3 className="tk-display" style={{fontSize:22, fontWeight:500, margin:"6px 0 8px"}}>{p.name || "Sem nome"}</h3>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <div className="q1__bar" style={{flex:1}}><span style={{width: completeness + "%"}}/></div>
            <span className="tk-mono" style={{fontSize:11, color:"var(--tk-muted)"}}>{completeness}%</span>
          </div>
        </div>
        <div className="q2__side-body tk-scroll">
          <div className="q2__preview-row"><span>Idade</span><strong>{p.age} anos</strong></div>
          <div className="q2__preview-row"><span>Civil</span><strong>{p.marital}</strong></div>
          <div className="q2__preview-row"><span>Filhos</span><strong>{p.kids ? `${p.kids}${p.kidsAge ? ` · ${p.kidsAge}` : ""}` : "—"}</strong></div>
          <div className="q2__preview-row"><span>Renda</span><strong>{p.income}</strong></div>
          <div className="q2__preview-row"><span>Carroceria</span><strong>{p.types.join(" / ") || "—"}</strong></div>
          <div className="q2__preview-row"><span>Orçamento</span><strong>{(p.budget[0]/1000).toFixed(0)}k–{(p.budget[1]/1000).toFixed(0)}k</strong></div>
          <div className="q2__preview-row"><span>Combustível</span><strong>{p.fuel.join(", ")}</strong></div>
          <div className="q2__preview-row"><span>Câmbio</span><strong>{p.gearbox}</strong></div>
          <div className="q2__preview-row"><span>Uso</span><strong>{p.use}</strong></div>
          <div className="q2__preview-row"><span>Espaço</span><strong>{p.space}</strong></div>
          <div className="q2__preview-row"><span>Estilo</span><strong>{p.lifestyle.join(", ") || "—"}</strong></div>
          <div className="q2__preview-row"><span>Prioridade</span><strong style={{color:"var(--tk-gold-ink)"}}>{p.priority}</strong></div>

          <div style={{marginTop:18}}>
            <div className="tk-eyebrow" style={{marginBottom:8}}>Carregar perfil salvo</div>
            <div style={{display:"flex", flexDirection:"column", gap:6}}>
              {window.TECHNIK_PROFILES.slice(0,2).map(prof => (
                <ProfileMini key={prof.id} p={prof} onClick={()=>onSelectProfile && onSelectProfile(prof)}/>
              ))}
            </div>
          </div>
        </div>
        <div className="q2__side-foot">
          <button className="tk-btn tk-btn-gold" style={{width:"100%", justifyContent:"center"}} onClick={()=>onSubmit(p)}>
            <Icon name="sparkles" size={14}/> Encontrar Top 10
          </button>
          <button className="tk-btn tk-btn-ghost" style={{width:"100%", justifyContent:"center", marginTop:8}}>
            <Icon name="save" size={14}/> Salvar como rascunho
          </button>
        </div>
      </aside>
    </div>
  );
};

window.Q2 = Q2;

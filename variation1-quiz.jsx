// variation1-quiz.jsx
// Step-by-step conversational quiz. One question per screen, side panel shows
// live profile summary. Premium feel: huge serif headlines, slow transitions.

const Q1 = ({ onSubmit, theme, onTheme, onSelectProfile }) => {
  const { useState } = React;
  const TYPES = window.TECHNIK_TYPES;
  const FUELS = window.TECHNIK_FUELS;
  const LIFES = window.TECHNIK_LIFESTYLES;
  const PRIOS = window.TECHNIK_PRIORITIES;
  const USES  = window.TECHNIK_USES;

  const [step, setStep] = useState(0);
  const [p, setP] = useState({
    name: "", age: 35, marital: "", kids: 0, kidsAge: "",
    profession: "", income: "",
    types: [], budget: [80000, 250000],
    use: "", fuel: [], gearbox: "",
    lifestyle: [], priority: "",
    space: ""
  });

  const upd = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  const toggle = (k, v) => setP(prev => ({
    ...prev,
    [k]: prev[k].includes(v) ? prev[k].filter(x=>x!==v) : [...prev[k], v]
  }));

  const steps = [
    {
      eyebrow: "01 · Identificação", title: "Sobre quem é essa consulta?",
      sub: "Comece com o básico: nome do cliente e idade. Isso direciona desde já o universo de carros.",
      content: () => (
        <div className="tk-fieldset" style={{maxWidth:480}}>
          <div className="tk-fieldset">
            <label className="tk-label">Nome do cliente</label>
            <input className="tk-input" value={p.name} onChange={e=>upd("name", e.target.value)} placeholder="Ex.: Ricardo Almeida"/>
          </div>
          <div className="tk-fieldset">
            <label className="tk-label">
              <span>Idade</span>
              <span className="tk-mono" style={{color:"var(--tk-gold-ink)", fontSize:13}}>{p.age} anos</span>
            </label>
            <div className="tk-range-wrap">
              <input className="tk-range" type="range" min="18" max="80" value={p.age} onChange={e=>upd("age", +e.target.value)}/>
            </div>
          </div>
          <div className="tk-fieldset">
            <label className="tk-label">Profissão (opcional)</label>
            <input className="tk-input" value={p.profession} onChange={e=>upd("profession", e.target.value)} placeholder="Ex.: Diretor Comercial"/>
          </div>
        </div>
      )
    },
    {
      eyebrow: "02 · Vida pessoal", title: "Como é o dia-a-dia dele?",
      sub: "Estado civil, filhos e estilo de vida ajudam a entender se o carro é pessoal, familiar ou de status.",
      content: () => (
        <div className="tk-fieldset" style={{maxWidth:560}}>
          <div className="tk-fieldset">
            <label className="tk-label">Estado civil</label>
            <div className="q1__chips">
              {["solteiro","namora","casado","divorciado"].map(v => (
                <button key={v} className={"tk-chip " + (p.marital === v ? "is-active":"")} onClick={()=>upd("marital", v)}>{v}</button>
              ))}
            </div>
          </div>
          <div className="q2__row">
            <div className="tk-fieldset">
              <label className="tk-label">Filhos</label>
              <div className="tk-stepper">
                <button onClick={()=>upd("kids", Math.max(0, p.kids-1))}><Icon name="minus" size={14}/></button>
                <input value={p.kids} onChange={e=>upd("kids", Math.max(0, +e.target.value || 0))}/>
                <button onClick={()=>upd("kids", p.kids+1)}><Icon name="plus" size={14}/></button>
              </div>
            </div>
            {p.kids > 0 && (
              <div className="tk-fieldset">
                <label className="tk-label">Idade dos filhos</label>
                <input className="tk-input" value={p.kidsAge} onChange={e=>upd("kidsAge", e.target.value)} placeholder="ex.: 4 e 9 anos"/>
              </div>
            )}
          </div>
          <div className="tk-fieldset">
            <label className="tk-label">Estilo de vida (escolha 1 ou 2)</label>
            <div className="q1__chips">
              {LIFES.map(v => (
                <button key={v} className={"tk-chip " + (p.lifestyle.includes(v) ? "is-active":"")} onClick={()=>toggle("lifestyle", v)}>
                  {p.lifestyle.includes(v) && <Icon name="check" size={12}/>}
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      eyebrow: "03 · Carroceria", title: "Que tipo de carro ele procura?",
      sub: "O cliente já tem preferência? Pode marcar mais de um. Se não fizer ideia, deixe vazio que sugerimos com base no perfil.",
      content: () => (
        <div className="q1__cards">
          {TYPES.map(t => (
            <button key={t} className={"q1__opt-card " + (p.types.includes(t) ? "is-on":"")} onClick={()=>toggle("types", t)}>
              <div style={{height:40, marginBottom:4}}>
                <CarSilhouette type={t} color={p.types.includes(t) ? "var(--tk-gold)" : "var(--tk-line-2)"}/>
              </div>
              <div className="tk-display" style={{fontSize:18}}>{t}</div>
              <div className="tk-help" style={{fontSize:11.5}}>
                {{"Hatch":"prático urbano","Sedan":"executivo, porta-malas grande","SUV":"posição alta, versátil","Picape":"trabalho e aventura","Esportivo":"prazer de dirigir"}[t]}
              </div>
            </button>
          ))}
        </div>
      )
    },
    {
      eyebrow: "04 · Orçamento", title: "Qual a faixa de investimento?",
      sub: "Movimente o slider para definir a faixa de preço-alvo. O algoritmo prioriza dentro desta janela mas considera bons negócios próximos.",
      content: () => (
        <div className="tk-fieldset" style={{maxWidth: 560}}>
          <div className="tk-fieldset">
            <label className="tk-label">
              <span>De {window.formatBRL(p.budget[0])}</span>
              <span>até {window.formatBRL(p.budget[1])}</span>
            </label>
            <div className="tk-range-wrap" style={{position:"relative"}}>
              <input className="tk-range" type="range" min="50000" max="800000" step="5000" value={p.budget[0]} onChange={e=>upd("budget", [Math.min(+e.target.value, p.budget[1]-20000), p.budget[1]])}/>
              <input className="tk-range" type="range" min="50000" max="800000" step="5000" value={p.budget[1]} onChange={e=>upd("budget", [p.budget[0], Math.max(+e.target.value, p.budget[0]+20000)])} style={{marginTop:10}}/>
            </div>
          </div>
          <div className="tk-fieldset">
            <label className="tk-label">Faixa de renda mensal (opcional)</label>
            <div className="q1__chips">
              {["até 5k","5-12k","12-18k","18-25k","25-50k","50k+"].map(v => (
                <button key={v} className={"tk-chip " + (p.income === v ? "is-active":"")} onClick={()=>upd("income", v)}>{v}</button>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      eyebrow: "05 · Uso & técnica", title: "Onde o carro vai rodar?",
      sub: "Preferências técnicas afinam o resultado. Combustível pode ser múltiplo — sugerimos opções relevantes.",
      content: () => (
        <div className="tk-fieldset" style={{maxWidth: 720}}>
          <div className="tk-fieldset">
            <label className="tk-label">Uso principal</label>
            <div className="q1__chips">
              {USES.map(v => (
                <button key={v} className={"tk-chip " + (p.use === v ? "is-active":"")} onClick={()=>upd("use", v)}>{v}</button>
              ))}
            </div>
          </div>
          <div className="q2__row">
            <div className="tk-fieldset">
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
            <div className="tk-fieldset">
              <label className="tk-label">Câmbio</label>
              <div className="q1__chips">
                {["automático","manual","tanto faz"].map(v => (
                  <button key={v} className={"tk-chip " + (p.gearbox === v ? "is-active":"")} onClick={()=>upd("gearbox", v)}>{v}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      eyebrow: "06 · Prioridade", title: "O que é inegociável?",
      sub: "Toda compra envolve trade-off. Escolha a prioridade nº 1 — vamos ranquear o Top 10 ao redor disso.",
      content: () => (
        <div className="q1__cards" style={{gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))"}}>
          {PRIOS.map(v => (
            <button key={v} className={"q1__opt-card " + (p.priority === v ? "is-on":"")} onClick={()=>upd("priority", v)}>
              <Icon name={{economia:"fuel", conforto:"users", performance:"gauge", "segurança":"check", status:"sparkles"}[v]} size={22}/>
              <div className="tk-display" style={{fontSize:20, marginTop:8}}>{v}</div>
              <div className="tk-help" style={{fontSize:12, lineHeight:1.4}}>
                {{
                  economia:"Menor custo total — combustível, manutenção, IPVA",
                  conforto:"Cabine silenciosa, banco confortável, suspensão macia",
                  performance:"Aceleração, dirigibilidade, motor responsivo",
                  "segurança":"ADAS completo, estrutura robusta, airbags",
                  status:"Marca reconhecida, presença, exclusividade"
                }[v]}
              </div>
            </button>
          ))}
        </div>
      )
    }
  ];

  const total = steps.length;
  const cur = steps[step];

  // Profile completeness
  const filled = [
    p.name && "nome", p.marital && "civil", p.types.length && "tipo",
    p.budget && "orçamento", p.use && "uso", p.priority && "prioridade"
  ].filter(Boolean).length;

  const summaryRows = [
    ["Nome", p.name || "—"],
    ["Idade", p.age + " anos"],
    ["Estado civil", p.marital || "—"],
    ["Filhos", p.kids ? `${p.kids}${p.kidsAge ? ` (${p.kidsAge})` : ""}` : "nenhum"],
    ["Tipos", p.types.join(", ") || "—"],
    ["Orçamento", `${(p.budget[0]/1000).toFixed(0)}k–${(p.budget[1]/1000).toFixed(0)}k`],
    ["Uso", p.use || "—"],
    ["Combustível", p.fuel.join(", ") || "—"],
    ["Estilo", p.lifestyle.join(", ") || "—"],
    ["Prioridade", p.priority || "—"]
  ];

  return (
    <div className="q1">
      <div className="q1__stage">
        <div className="q1__progress">
          <span className="q1__step-num">{String(step+1).padStart(2,"0")} / {String(total).padStart(2,"0")}</span>
          <div className="q1__bar"><span style={{ width: ((step+1)/total*100) + "%" }}/></div>
        </div>
        <div className="q1__heading">
          <span className="tk-eyebrow">{cur.eyebrow}</span>
          <h2>{cur.title}</h2>
          <p>{cur.sub}</p>
        </div>
        <div className="q1__answers">{cur.content()}</div>
        <div className="q1__nav">
          <button className="tk-btn tk-btn-ghost" onClick={()=>setStep(s=>Math.max(0, s-1))} disabled={step===0}>
            <Icon name="arrow-l" size={14}/> Voltar
          </button>
          {step < total-1 ? (
            <button className="tk-btn tk-btn-primary" onClick={()=>setStep(s=>s+1)}>
              Próxima pergunta <Icon name="arrow-r" size={14}/>
            </button>
          ) : (
            <button className="tk-btn tk-btn-gold" onClick={()=>onSubmit(p)}>
              <Icon name="sparkles" size={14}/> Encontrar Top 10
            </button>
          )}
        </div>
      </div>

      <aside className="q1__side">
        <div className="tk-eyebrow">Perfil em construção</div>
        <h3 className="tk-display tk-h-underline" style={{fontSize:24, margin:"6px 0 18px"}}>
          {p.name || "Sem nome ainda"}
        </h3>

        <div className="q1__sum">
          {summaryRows.map(([k, v]) => (
            <div className="q1__sum-row" key={k}><span>{k}</span><strong>{v}</strong></div>
          ))}
        </div>

        <div style={{marginTop:24}}>
          <div className="tk-eyebrow" style={{marginBottom:10}}>Clientes recentes</div>
          <div style={{display:"flex", flexDirection:"column", gap:6}}>
            {window.TECHNIK_PROFILES.slice(0,3).map(prof => (
              <ProfileMini key={prof.id} p={prof} onClick={()=>onSelectProfile && onSelectProfile(prof)}/>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
};

window.Q1 = Q1;

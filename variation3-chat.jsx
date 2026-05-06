// variation3-chat.jsx
// Chat-style profile capture with right-hand "extracted profile" panel that
// fills in as the conversation progresses. Uses a scripted conversation flow
// (deterministic for demo) but UI suggests real-time AI extraction.

const Q3 = ({ onSubmit, onSelectProfile }) => {
  const { useState, useRef, useEffect } = React;

  // Scripted demo flow: when user sends, bot extracts certain fields.
  const FLOW = [
    {
      bot: "Olá! Sou a IA da Technik. Me conte sobre o cliente que está atendendo — eu extraio o que precisamos automaticamente. Pode ser informal, do jeito que você anotaria.",
      suggestions: [
        "Casado, 42 anos, 2 filhos pequenos, busca SUV familiar",
        "Solteira, 28, mora em SP, quer trocar de carro popular",
        "Empresário 55, busca um esportivo de fim de semana"
      ],
      extract: () => ({})  // first turn just primes the chat
    },
    {
      bot: "Anotei. Que tipo de carroceria ele já considera? E qual a faixa de orçamento?",
      suggestions: [
        "SUV ou Sedã, entre 180 e 280 mil",
        "Hatch ou compacto até 160 mil",
        "Aberto a esportivos, sem teto rígido"
      ],
      extract: (text) => {
        const types = [];
        ["SUV","Sedan","Hatch","Picape","Esportivo"].forEach(t => {
          if (text.toLowerCase().includes(t.toLowerCase())) types.push(t);
        });
        return { types: types.length ? types : ["SUV","Sedan"] };
      }
    },
    {
      bot: "Perfeito. E como ele vai usar o carro no dia-a-dia? Cidade, estrada, viagens em família?",
      suggestions: [
        "Família, viagens de fim de semana ao litoral",
        "Cidade, trânsito pesado de SP",
        "Estrada — pega 2000 km por mês"
      ],
      extract: (text) => {
        const t = text.toLowerCase();
        let use = "cidade";
        if (t.includes("famíl")) use = "família";
        else if (t.includes("estrada")) use = "estrada";
        else if (t.includes("trabalho")) use = "trabalho";
        else if (t.includes("prazer") || t.includes("fim de semana")) use = "prazer";
        return { use, lifestyle: t.includes("famíl") ? ["família","conforto"] : ["urbano"] };
      }
    },
    {
      bot: "E o que é mais importante para ele? Economia, conforto, performance, segurança ou status?",
      suggestions: [
        "Conforto e segurança em primeiro lugar",
        "Performance, ele gosta de dirigir",
        "Economia — quer híbrido ou elétrico"
      ],
      extract: (text) => {
        const t = text.toLowerCase();
        let priority = "conforto";
        if (t.includes("performan")) priority = "performance";
        else if (t.includes("econom")) priority = "economia";
        else if (t.includes("seguran")) priority = "segurança";
        else if (t.includes("status") || t.includes("luxo")) priority = "status";
        const fuel = [];
        if (t.includes("híbrid")) fuel.push("híbrido");
        if (t.includes("elétric")) fuel.push("elétrico");
        if (fuel.length === 0) fuel.push("flex");
        return { priority, fuel };
      }
    },
    {
      bot: "Ótimo. Última coisa — qual a idade dele? Tem filhos? Me dê o que tiver.",
      suggestions: [
        "42 anos, casado, 2 filhos (8 e 11)",
        "28, solteira, sem filhos",
        "55, casado, filhos adultos"
      ],
      extract: (text) => {
        const t = text.toLowerCase();
        const ageM = t.match(/\b(\d{2})\b/);
        const kidsM = t.match(/(\d+)\s*filh/);
        let marital = "";
        if (t.includes("casad")) marital = "casado";
        else if (t.includes("solteir")) marital = "solteiro";
        else if (t.includes("namora")) marital = "namora";
        return {
          age: ageM ? +ageM[1] : 35,
          kids: kidsM ? +kidsM[1] : 0,
          marital,
          name: "Cliente Technik"
        };
      }
    },
    {
      bot: "Pronto! Cruzei o perfil com o catálogo brasileiro de 247 modelos. Confirma os dados extraídos no painel à direita e clico em \"Encontrar Top 10\"?",
      suggestions: [],
      extract: () => ({}),
      isFinal: true
    }
  ];

  const [turn, setTurn] = useState(0);
  const [messages, setMessages] = useState([
    { kind:"bot", text: FLOW[0].bot }
  ]);
  const [profile, setProfile] = useState({
    name:"", age:null, marital:"", kids:null,
    types:[], budget:[100000, 300000], use:"", fuel:[],
    gearbox:"automático", lifestyle:[], priority:""
  });
  const [newKeys, setNewKeys] = useState(new Set());
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const msgsRef = useRef(null);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = (text) => {
    if (!text.trim()) return;
    setMessages(m => [...m, { kind:"user", text }]);
    setDraft("");

    const cur = FLOW[turn];
    const extracted = cur.extract ? cur.extract(text) : {};
    if (Object.keys(extracted).length > 0) {
      setProfile(prev => ({ ...prev, ...extracted }));
      setNewKeys(new Set(Object.keys(extracted)));
      setTimeout(() => setNewKeys(new Set()), 1500);
    }

    const next = turn + 1;
    if (next < FLOW.length) {
      setThinking(true);
      setTimeout(() => {
        setThinking(false);
        setMessages(m => [...m, { kind:"bot", text: FLOW[next].bot }]);
        setTurn(next);
      }, 900);
    }
  };

  const cur = FLOW[turn];

  // Profile rows for right panel
  const PROF_ROWS = [
    { k: "name", label: "Nome" },
    { k: "age", label: "Idade", fmt: v => v ? v + " anos" : null },
    { k: "marital", label: "Estado civil" },
    { k: "kids", label: "Filhos", fmt: v => (v || v === 0) ? (v === 0 ? "nenhum" : `${v} filhos`) : null },
    { k: "types", label: "Carroceria", fmt: v => v && v.length ? v.join(" / ") : null },
    { k: "budget", label: "Orçamento", fmt: v => v ? `${(v[0]/1000).toFixed(0)}k–${(v[1]/1000).toFixed(0)}k` : null },
    { k: "use", label: "Uso" },
    { k: "fuel", label: "Combustível", fmt: v => v && v.length ? v.join(", ") : null },
    { k: "lifestyle", label: "Estilo", fmt: v => v && v.length ? v.join(", ") : null },
    { k: "priority", label: "Prioridade" }
  ];

  return (
    <div className="q3">
      <div className="q3__chat">
        <div className="q3__msgs tk-scroll" ref={msgsRef}>
          {messages.map((m, i) => (
            <div key={i} className={"q3__msg " + (m.kind === "bot" ? "is-bot" : "is-user")}>
              <div className="q3__avatar">{m.kind === "bot" ? "T" : "JC"}</div>
              <div className="q3__bubble">{m.text}</div>
            </div>
          ))}
          {thinking && (
            <div className="q3__msg is-bot">
              <div className="q3__avatar">T</div>
              <div className="q3__bubble" style={{display:"flex", gap:6, padding:"16px 18px"}}>
                <span className="q3__dot" style={{width:8, height:8, borderRadius:"50%", background:"var(--tk-muted)", animation:"tk-blink 1.2s infinite"}}/>
                <span className="q3__dot" style={{width:8, height:8, borderRadius:"50%", background:"var(--tk-muted)", animation:"tk-blink 1.2s infinite .2s"}}/>
                <span className="q3__dot" style={{width:8, height:8, borderRadius:"50%", background:"var(--tk-muted)", animation:"tk-blink 1.2s infinite .4s"}}/>
              </div>
            </div>
          )}
        </div>

        {cur.suggestions && cur.suggestions.length > 0 && !thinking && (
          <div className="q3__suggestions">
            {cur.suggestions.map((s, i) => (
              <button key={i} className="tk-chip" onClick={()=>send(s)}>{s}</button>
            ))}
          </div>
        )}

        <div className="q3__composer">
          <div className="q3__composer-inner">
            <textarea
              value={draft}
              onChange={e=>setDraft(e.target.value)}
              onKeyDown={e=>{ if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
              placeholder={cur.isFinal ? "Pergunte algo, ou clique em Encontrar Top 10 →" : "Descreva o cliente, ou escolha uma sugestão acima"}
              rows={1}
            />
            <button className="tk-icobtn" title="Áudio"><Icon name="mic" size={15}/></button>
            <button className="q3__send" onClick={()=>send(draft)} disabled={!draft.trim()}>
              <Icon name="send" size={15}/>
            </button>
          </div>
          <div style={{textAlign:"center", marginTop:8, fontSize:11, color:"var(--tk-muted)"}}>
            Powered by Technik AI · cruzando 247 modelos do mercado brasileiro 2026
          </div>
        </div>
      </div>

      <aside className="q3__panel">
        <div className="q3__panel-h">
          <div className="tk-eyebrow">Perfil extraído</div>
          <h3 className="tk-display" style={{fontSize:22, fontWeight:500, margin:"6px 0 4px"}}>
            {profile.name || "Em análise…"}
          </h3>
          <div style={{display:"flex", alignItems:"center", gap:6}}>
            <Icon name="sparkles" size={13}/>
            <span className="tk-help" style={{fontSize:11.5}}>preenchido pela IA</span>
          </div>
        </div>
        <div className="q3__panel-body tk-scroll">
          {PROF_ROWS.map(({k, label, fmt}) => {
            const v = profile[k];
            const display = fmt ? fmt(v) : (v || null);
            const pending = !display;
            const isNew = newKeys.has(k);
            return (
              <div key={k} className={"q3__extracted-row " + (pending ? "is-pending" : "") + (isNew ? " is-new" : "")}>
                <div style={{flex:1}}>
                  <label>{label}</label>
                  <strong>{display || "aguardando…"}</strong>
                </div>
                {!pending && <Icon name="check" size={14} style={{color:"var(--tk-gold)", flexShrink:0, marginTop:2}}/>}
              </div>
            );
          })}

          <div style={{marginTop:14}}>
            <div className="tk-eyebrow" style={{marginBottom:8}}>Ou carregue um perfil</div>
            <div style={{display:"flex", flexDirection:"column", gap:6}}>
              {window.TECHNIK_PROFILES.slice(0,2).map(prof => (
                <ProfileMini key={prof.id} p={prof} onClick={()=>onSelectProfile && onSelectProfile(prof)}/>
              ))}
            </div>
          </div>
        </div>
        <div className="q3__panel-foot">
          <button
            className={"tk-btn tk-btn-gold"}
            style={{width:"100%", justifyContent:"center"}}
            disabled={!cur.isFinal}
            onClick={()=>onSubmit(profile)}>
            <Icon name="sparkles" size={14}/> Encontrar Top 10
          </button>
          {!cur.isFinal && (
            <div className="tk-help" style={{textAlign:"center", marginTop:8, fontSize:11}}>
              Continue a conversa para liberar o ranqueamento
            </div>
          )}
        </div>
      </aside>

      <style>{`
        @keyframes tk-blink {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

window.Q3 = Q3;

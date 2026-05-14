/* Technik — Variação 2: Painel Visual (formulário em tela única) */
/* global React, ReactDOM, TechnikLogo, TechnikLogoMark, Icon, CarSilhouette, MatchRing, CARS, TYPE_OPTIONS, FUEL_OPTIONS, LIFESTYLE_OPTIONS, PRIORITY_OPTIONS, useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakRadio, TweakColor, TweakSlider */

const { useState, useMemo, useEffect } = React;

const API_BASE = 'http://localhost:3001';

const NAV = [
  { id: 'new',     label: 'Nova consulta', icon: <Icon.Plus />,   badge: '⌘N' },
  { id: 'clients', label: 'Clientes',      icon: <Icon.Users />,  badge: '128' },
  { id: 'history', label: 'Histórico',     icon: <Icon.History /> },
  { id: 'reports', label: 'Relatórios',    icon: <Icon.Reports /> },
  { id: 'settings',label: 'Ajustes',       icon: <Icon.Settings /> },
];

function fmtBRL(n) {
  return 'R$ ' + n.toLocaleString('pt-BR');
}

function App() {
  const [t, setTweak] = useTweaks(/*EDITMODE-BEGIN*/{
    "darkMode": false,
    "primaryColor": "#19193A",
    "showCompareBar": true,
    "cardStyle": "editorial"
  }/*EDITMODE-END*/);

  // Apply theme
  useEffect(() => {
    document.documentElement.dataset.theme = t.darkMode ? 'dark' : 'light';
    document.documentElement.style.setProperty('--tk-primary', t.primaryColor);
  }, [t.darkMode, t.primaryColor]);

  const [activeNav, setActiveNav] = useState('new');
  const [stage, setStage] = useState('form'); // form | loading | results

  // Form state
  const [client, setClient] = useState({ name: 'Mariana Coutinho', segment: 'Família 4 + 1 cão' });
  const [budget, setBudget]   = useState([180, 320]); // R$ mil
  const [seats, setSeats]     = useState(5);
  const [seatsAny, setSeatsAny] = useState(true);
  const [trunk, setTrunk]     = useState(420); // litros
  const [trunkAny, setTrunkAny] = useState(true);
  const [yearMin, setYearMin] = useState(2022);
  const [types, setTypes]     = useState(['suv']);
  const [fuels, setFuels]     = useState(['flex','hybrid']);
  const [lifestyle, setLifestyle] = useState(['family','travel']);
  const [priorities, setPriorities] = useState(['safety','comfort','economy']);
  const [notes, setNotes]     = useState('Cliente viaja para a serra duas vezes por mês. Prioriza espaço e segurança ativa.');
  const [notesAny, setNotesAny] = useState(true);

  function toggle(setter, list, id) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }

  // Loading flow + real backend call
  const [loadStep, setLoadStep] = useState(0);
  const [recommendation, setRecommendation] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (stage !== 'loading') return;
    setLoadStep(0);
    setLoadError(null);

    // Animate the 5 step indicators while the backend works (~30s real).
    // Each step holds for ~6s; after the 5th, we keep it pulsing on the last.
    const seq = [3500, 5500, 9000, 6000, 4000];
    let acc = 0;
    const timers = seq.map((d, i) => {
      acc += d;
      return setTimeout(() => setLoadStep(i + 1), acc);
    });

    const ctrl = new AbortController();
    const briefing = {
      client, budget, yearMin,
      seats: seatsAny ? null : seats,
      trunk: trunkAny ? null : trunk,
      types, fuels, lifestyle, priorities,
      notes: notesAny ? '' : notes,
    };

    fetch(`${API_BASE}/api/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefing),
      signal: ctrl.signal,
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok || data.ok === false) {
          throw new Error(data.reason || data.error || `HTTP ${r.status}`);
        }
        return data;
      })
      .then(data => {
        setRecommendation(data);
        setLoadStep(5);
        setStage('results');
      })
      .catch(e => {
        if (e.name === 'AbortError') return;
        setLoadError(e.message || 'Erro desconhecido');
      });

    return () => { timers.forEach(clearTimeout); ctrl.abort(); };
  }, [stage]);

  return (
    <div className="tk-app">
      {/* Sidebar */}
      <aside className="tk-side">
        <div className="tk-side__brand">
          <TechnikLogoMark height={34} />
        </div>
        <nav className="tk-side__nav">
          {NAV.map(n => (
            <button key={n.id}
              className={`tk-side__item ${activeNav === n.id ? 'is-active' : ''}`}
              onClick={() => setActiveNav(n.id)}>
              {n.icon}
              <span>{n.label}</span>
              {n.badge && <span className="tk-side__badge">{n.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="tk-side__foot">
          <button className="tk-side__theme" onClick={() => setTweak('darkMode', !t.darkMode)}>
            <span>Modo {t.darkMode ? 'escuro' : 'claro'}</span>
            <span className={`tk-toggle ${t.darkMode ? 'is-on' : ''}`}><span /></span>
          </button>
          <div className="tk-side__user">
            <div className="tk-side__avatar">RC</div>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Rodrigo Cunha</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Consultor sênior</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <section className="tk-main">
        <header className="tk-topbar">
          <div className="tk-topbar__title">
            <span className="tk-eyebrow">
              {stage === 'form' && 'Nova consulta · etapa 1/2'}
              {stage === 'loading' && 'Calculando recomendações'}
              {stage === 'results' && 'Recomendações · entrega ao cliente'}
            </span>
            <h1>
              {stage === 'form' && 'Briefing do perfil'}
              {stage === 'loading' && 'Cruzando catálogo'}
              {stage === 'results' && `Top 10 para ${client.name.split(' ')[0]}`}
            </h1>
          </div>
          <div className="tk-topbar__actions">
            {stage === 'form' && (
              <>
                <button className="tk-btn tk-btn-ghost"><Icon.Bookmark /> Salvar rascunho</button>
                <button className="tk-btn tk-btn-primary"
                  onClick={() => setStage('loading')}>
                  Buscar recomendações <Icon.ChevronRight />
                </button>
              </>
            )}
            {stage === 'results' && (
              <>
                <button className="tk-btn tk-btn-ghost" onClick={() => setStage('form')}>← Editar briefing</button>
                <button className="tk-btn tk-btn-ghost"><Icon.Download /> Exportar PDF</button>
                <button className="tk-btn tk-btn-primary"><Icon.Sparkle /> Enviar ao cliente</button>
              </>
            )}
          </div>
        </header>

        {stage === 'form' && (
          <FormView
            client={client} setClient={setClient}
            budget={budget} setBudget={setBudget}
            seats={seats} setSeats={setSeats}
            seatsAny={seatsAny} setSeatsAny={setSeatsAny}
            trunk={trunk} setTrunk={setTrunk}
            trunkAny={trunkAny} setTrunkAny={setTrunkAny}
            yearMin={yearMin} setYearMin={setYearMin}
            types={types} setTypes={setTypes}
            fuels={fuels} setFuels={setFuels}
            lifestyle={lifestyle} setLifestyle={setLifestyle}
            priorities={priorities} setPriorities={setPriorities}
            notes={notes} setNotes={setNotes}
            notesAny={notesAny} setNotesAny={setNotesAny}
            toggle={toggle}
          />
        )}

        {stage === 'loading' && (
          <LoadingView
            step={loadStep}
            error={loadError}
            onRetry={() => setStage('loading')}
            onCancel={() => setStage('form')}
          />
        )}

        {stage === 'results' && recommendation && (
          <ResultsView
            client={client}
            cardStyle={t.cardStyle}
            showCompareBar={t.showCompareBar}
            cars={recommendation.top}
            briefing={recommendation.briefing}
            diagnostico={recommendation.diagnostico}
          />
        )}
      </section>

      <TweaksPanel title="Tweaks · Technik">
        <TweakSection title="Tema">
          <TweakToggle label="Modo escuro" value={t.darkMode}
            onChange={v => setTweak('darkMode', v)} />
          <TweakColor label="Cor primária" value={t.primaryColor}
            onChange={v => setTweak('primaryColor', v)}
            options={['#19193A','#1F3A8A','#465151','#0F3D2E','#3D1F1F']} />
        </TweakSection>
        <TweakSection title="Resultados">
          <TweakRadio label="Estilo do card" value={t.cardStyle}
            onChange={v => setTweak('cardStyle', v)}
            options={[
              { label: 'Editorial', value: 'editorial' },
              { label: 'Minimal',   value: 'minimal' },
            ]} />
          <TweakToggle label="Barra de comparação" value={t.showCompareBar}
            onChange={v => setTweak('showCompareBar', v)} />
        </TweakSection>
        <TweakSection title="Catálogo">
          <CatalogPanel />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ─── CATALOG PANEL (admin) ────────────────────────────────────
function CatalogPanel() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rebuildState, setRebuildState] = useState(null); // 'running' | {ok, durationMs, total} | {error}

  async function fetchInfo() {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/catalog/info`);
      const j = await r.json();
      setInfo(j.ok ? j : null);
    } catch { setInfo(null); }
    setLoading(false);
  }

  useEffect(() => { fetchInfo(); }, []);

  async function rebuild() {
    setRebuildState('running');
    try {
      const r = await fetch(`${API_BASE}/api/catalog/rebuild-from-cache`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        setRebuildState(j);
        await fetchInfo();
      } else {
        setRebuildState({ error: j.reason });
      }
    } catch (e) {
      setRebuildState({ error: e.message });
    }
  }

  const labelStyle = { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 4 };
  const valueStyle = { fontFamily: 'Exo', fontSize: 14, color: '#fff', fontWeight: 600 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {loading && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Carregando…</div>}
      {!loading && !info && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Catálogo não disponível.</div>}
      {info && (
        <>
          <div>
            <div style={labelStyle}>Total</div>
            <div style={valueStyle}>{info.total} carros · {info.marcas?.length || 0} marcas</div>
          </div>
          <div>
            <div style={labelStyle}>Última atualização</div>
            <div style={valueStyle}>{new Date(info.builtAt).toLocaleString('pt-BR')} <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>({info.builtFrom})</span></div>
          </div>
          <div>
            <div style={labelStyle}>Distribuição</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {Object.entries(info.tipos || {}).map(([t, n]) => (
                <span key={t} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
                  {t}: {n}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={rebuild}
            disabled={rebuildState === 'running'}
            style={{
              marginTop: 6, padding: '8px 12px', borderRadius: 6,
              background: rebuildState === 'running' ? 'rgba(255,255,255,0.1)' : 'var(--tk-accent, #f0b429)',
              color: rebuildState === 'running' ? 'rgba(255,255,255,0.5)' : '#19193A',
              border: 'none', cursor: rebuildState === 'running' ? 'wait' : 'pointer',
              fontWeight: 600, fontSize: 12,
            }}>
            {rebuildState === 'running' ? 'Reconstruindo…' : 'Reconstruir do cache'}
          </button>
          {rebuildState && rebuildState !== 'running' && rebuildState.ok && (
            <div style={{ fontSize: 11, color: '#7af6b1' }}>
              ✓ {rebuildState.total} carros em {(rebuildState.durationMs / 1000).toFixed(1)}s
            </div>
          )}
          {rebuildState?.error && (
            <div style={{ fontSize: 11, color: '#ffd166' }}>
              Falhou: {rebuildState.error}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4, lineHeight: 1.4 }}>
            "Reconstruir do cache" reclassifica usando os dados FIPE já em disco.<br/>
            Pra atualização completa da FIPE, rodar <code style={{ color: 'rgba(255,255,255,0.7)' }}>node server/scripts/build-catalog.js</code> no terminal.
          </div>
        </>
      )}
    </div>
  );
}

// ─── FORM VIEW ────────────────────────────────────────────────
function FormView(props) {
  const { client, setClient, budget, setBudget,
          seats, setSeats, seatsAny, setSeatsAny,
          trunk, setTrunk, trunkAny, setTrunkAny,
          yearMin, setYearMin, types, setTypes, fuels, setFuels,
          lifestyle, setLifestyle, priorities, setPriorities,
          notes, setNotes, notesAny, setNotesAny, toggle } = props;

  const total = (
    (client.name ? 1 : 0) +
    (budget.length === 2 ? 1 : 0) +
    (types.length ? 1 : 0) +
    (fuels.length ? 1 : 0) +
    (lifestyle.length ? 1 : 0) +
    (priorities.length ? 1 : 0)
  );
  const completion = Math.round((total / 6) * 100);

  return (
    <div className="q2">
      <div className="q2__form tk-scroll">

        <div className="q2__hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tk-eyebrow">Briefing 360°</span>
            <span className="tk-help">Dura 2-3 minutos · você pode salvar a qualquer momento</span>
          </div>
          <h2>Tudo que precisa saber sobre <strong>{client.name.split(' ')[0]}</strong>, em uma tela.</h2>
          <p>Preencha os campos visuais à esquerda e o painel à direita atualiza o perfil em tempo real. Quando clicar em <em>Buscar</em>, cruzamos com 1.200 opções do estoque parceiro e devolvemos um Top 10 com justificativa.</p>
        </div>

        {/* Cliente */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>1 · Cliente</h3>
            <span className="tk-help">Quem está comprando o carro</span>
          </div>
          <div className="q2__row">
            <div className="q2__field">
              <label className="tk-label">Nome do cliente</label>
              <input className="tk-input" value={client.name}
                onChange={e => setClient({ ...client, name: e.target.value })}
                placeholder="Ex.: Mariana Coutinho" />
            </div>
            <div className="q2__field">
              <label className="tk-label">Perfil resumido <span className="tk-help">opcional</span></label>
              <input className="tk-input" value={client.segment}
                onChange={e => setClient({ ...client, segment: e.target.value })}
                placeholder="Ex.: Família 4 + 1 cão" />
            </div>
          </div>
        </div>

        {/* Tipo */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>2 · Tipo de veículo</h3>
            <span className="tk-help">Pode escolher mais de um · {types.length} selecionados</span>
          </div>
          <div className="q2__type-grid">
            {TYPE_OPTIONS.map(opt => (
              <button key={opt.id}
                className={`q2__type ${types.includes(opt.id) ? 'is-on' : ''}`}
                onClick={() => toggle(setTypes, types, opt.id)}>
                <CarSilhouette type={opt.id} stroke="currentColor" sw={1.4} />
                <span className="q2__type-name">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Orçamento */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>3 · Orçamento e dimensões</h3>
            <span className="tk-help">Faixa em mil R$, lugares e bagagem</span>
          </div>
          <div className="q2__row" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
            <div className="q2__field">
              <label className="tk-label">
                <span>Faixa de preço</span>
                <span className="tk-mono">{fmtBRL(budget[0]*1000)} — {fmtBRL(budget[1]*1000)}</span>
              </label>
              <DualRange min={50} max={600} step={5} value={budget} onChange={setBudget} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tk-muted)', marginTop: 4 }}>
                <span>R$ 50k</span><span>R$ 200k</span><span>R$ 400k</span><span>R$ 600k+</span>
              </div>
            </div>
            <div className="q2__field">
              <label className="tk-label">
                <span><Icon.Family style={{ verticalAlign: -3, marginRight: 4 }}/> Lugares</span>
                <AnyToggle on={seatsAny} onChange={setSeatsAny} />
              </label>
              {seatsAny ? (
                <div style={{ padding: '10px 0', color: 'var(--tk-muted)', fontStyle: 'italic', fontSize: 13 }}>Sem preferência</div>
              ) : (
                <Stepper value={seats} onChange={setSeats} min={2} max={9} />
              )}
            </div>
            <div className="q2__field">
              <label className="tk-label">
                <span><Icon.Suitcase style={{ verticalAlign: -3, marginRight: 4 }}/> Porta-malas</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {!trunkAny && <span className="tk-mono">{trunk} L</span>}
                  <AnyToggle on={trunkAny} onChange={setTrunkAny} />
                </span>
              </label>
              {trunkAny ? (
                <div style={{ padding: '10px 0', color: 'var(--tk-muted)', fontStyle: 'italic', fontSize: 13 }}>Sem preferência</div>
              ) : (
                <input type="range" min={150} max={900} step={10} value={trunk}
                  className="tk-range"
                  onChange={e => setTrunk(+e.target.value)} />
              )}
            </div>
          </div>
          <div className="q2__field" style={{ marginTop: 16, maxWidth: 380 }}>
            <label className="tk-label">
              <span>Ano mínimo</span>
              <span className="tk-mono">≥ {yearMin}</span>
            </label>
            <input type="range" min={2018} max={2024} step={1} value={yearMin}
              className="tk-range"
              onChange={e => setYearMin(+e.target.value)} />
          </div>
        </div>

        {/* Combustível */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>4 · Combustível</h3>
            <span className="tk-help">{fuels.length} selecionados</span>
          </div>
          <div className="q2__chips">
            {FUEL_OPTIONS.map(opt => (
              <button key={opt.id}
                className={`tk-chip ${fuels.includes(opt.id) ? 'is-active' : ''}`}
                onClick={() => toggle(setFuels, fuels, opt.id)}>
                <Icon.Fuel /> {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lifestyle */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>5 · Estilo de vida</h3>
            <span className="tk-help">Como vai usar o carro no dia-a-dia</span>
          </div>
          <div className="q2__chips">
            {LIFESTYLE_OPTIONS.map(opt => (
              <button key={opt.id}
                className={`tk-chip ${lifestyle.includes(opt.id) ? 'is-active' : ''}`}
                onClick={() => toggle(setLifestyle, lifestyle, opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prioridades */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>6 · Prioridades</h3>
            <span className="tk-help">O que pesa mais na decisão</span>
          </div>
          <div className="q2__chips">
            {PRIORITY_OPTIONS.map(opt => (
              <button key={opt.id}
                className={`tk-chip ${priorities.includes(opt.id) ? 'is-active' : ''}`}
                onClick={() => toggle(setPriorities, priorities, opt.id)}>
                <Icon.Star /> {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="q2__sect">
          <div className="q2__sect-h">
            <h3>7 · Observações da consultoria</h3>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span className="tk-help">Contexto extra que a IA leva em conta</span>
              <AnyToggle on={notesAny} onChange={setNotesAny} />
            </span>
          </div>
          {notesAny ? (
            <div style={{ padding: '14px 0', color: 'var(--tk-muted)', fontStyle: 'italic', fontSize: 13 }}>Sem observações</div>
          ) : (
            <textarea className="tk-input" rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notas sobre uso, restrições, preferências de marca…" />
          )}
        </div>
      </div>

      {/* Side preview */}
      <aside className="q2__side">
        <div className="q2__side-h">
          <span className="tk-eyebrow">Perfil em construção</span>
          <h3>{client.name || '—'}</h3>
          <span className="tk-help">{client.segment}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <div className="q2__bar"><span style={{ width: `${completion}%` }} /></div>
            <span className="tk-mono" style={{ fontSize: 11, color: 'var(--tk-secondary)', fontWeight: 600 }}>{completion}%</span>
          </div>
        </div>
        <div className="q2__side-body tk-scroll">
          <span className="tk-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Briefing</span>
          <div className="q2__preview-row">
            <span>Tipo</span>
            <strong>{types.length ? types.map(t => TYPE_OPTIONS.find(o=>o.id===t).label).join(' · ') : '—'}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Orçamento</span>
            <strong>{fmtBRL(budget[0]*1000)} — {fmtBRL(budget[1]*1000)}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Lugares</span><strong>{seatsAny ? 'Indiferente' : seats}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Porta-malas</span><strong>{trunkAny ? 'Indiferente' : `≥ ${trunk} L`}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Ano mínimo</span><strong>{yearMin}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Combustível</span>
            <strong>{fuels.length ? fuels.map(f => FUEL_OPTIONS.find(o=>o.id===f).label).join(', ') : 'Indiferente'}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Estilo de vida</span>
            <strong style={{ textAlign: 'right', maxWidth: '60%' }}>{lifestyle.length ? lifestyle.map(l => LIFESTYLE_OPTIONS.find(o=>o.id===l).label).join(', ') : '—'}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Prioridades</span>
            <strong style={{ textAlign: 'right', maxWidth: '60%' }}>{priorities.length ? priorities.map(p => PRIORITY_OPTIONS.find(o=>o.id===p).label).join(', ') : '—'}</strong>
          </div>

          <span className="tk-eyebrow" style={{ display: 'block', margin: '24px 0 10px' }}>Pré-match no estoque</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CARS.slice(0, 3).map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: 'var(--tk-paper)',
                border: '1px solid var(--tk-line)', borderRadius: 10
              }}>
                <div style={{ width: 44, height: 28, color: 'var(--tk-secondary)' }}>
                  <CarSilhouette type={c.type} sw={1.5} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tk-primary)' }}>{c.brand} {c.model}</div>
                  <div style={{ fontSize: 11, color: 'var(--tk-muted)' }}>{c.price}</div>
                </div>
                <MatchRing pct={c.match} size={36} />
              </div>
            ))}
          </div>
        </div>
        <div className="q2__side-foot">
          <button className="tk-btn tk-btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            <Icon.Sparkle /> Cruzar com 1.200 opções
          </button>
          <span className="tk-help" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
            Estoque atualizado há 14 minutos
          </span>
        </div>
      </aside>
    </div>
  );
}

// ─── "TANTO FAZ" TOGGLE ───────────────────────────────────────
function AnyToggle({ on, onChange }) {
  return (
    <button type="button"
      onClick={() => onChange(!on)}
      style={{
        position: 'relative',
        width: 32, height: 18,
        borderRadius: 999,
        background: on ? 'var(--tk-primary)' : 'rgba(0,0,0,0.18)',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 0.15s ease',
        flexShrink: 0,
      }}
      title={on ? 'Sem preferência — clique pra definir' : 'Clique se tanto faz'}>
      <span style={{
        position: 'absolute',
        top: 2, left: on ? 16 : 2,
        width: 14, height: 14,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.15s ease',
      }} />
    </button>
  );
}

// ─── DUAL RANGE SLIDER ────────────────────────────────────────
function DualRange({ min, max, step, value, onChange }) {
  const [lo, hi] = value;
  const pctLo = ((lo - min) / (max - min)) * 100;
  const pctHi = ((hi - min) / (max - min)) * 100;

  return (
    <div style={{ position: 'relative', height: 28, padding: '12px 0' }}>
      <div style={{
        position: 'absolute', top: 12, left: 0, right: 0, height: 4,
        background: 'var(--tk-bg-3)', borderRadius: 999
      }} />
      <div style={{
        position: 'absolute', top: 12, left: `${pctLo}%`, width: `${pctHi - pctLo}%`,
        height: 4, background: 'var(--tk-primary)', borderRadius: 999
      }} />
      <input type="range" min={min} max={max} step={step} value={lo}
        onChange={e => onChange([Math.min(+e.target.value, hi - step), hi])}
        style={{ position: 'absolute', inset: 0, width: '100%', appearance: 'none', background: 'transparent', pointerEvents: 'none' }}
        className="tk-dual-thumb" />
      <input type="range" min={min} max={max} step={step} value={hi}
        onChange={e => onChange([lo, Math.max(+e.target.value, lo + step)])}
        style={{ position: 'absolute', inset: 0, width: '100%', appearance: 'none', background: 'transparent', pointerEvents: 'none' }}
        className="tk-dual-thumb" />
    </div>
  );
}

// ─── STEPPER ──────────────────────────────────────────────────
function Stepper({ value, onChange, min = 0, max = 99 }) {
  return (
    <div className="tk-stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <input value={value} readOnly />
      <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

// ─── LOADING ──────────────────────────────────────────────────
function LoadingView({ step, error, onRetry, onCancel }) {
  const steps = [
    'Lendo o briefing do cliente',
    'Curador IA montando shortlist de 15-18 candidatos',
    'Consultando preços reais na Tabela FIPE',
    'Filtrando por orçamento e deduplicando',
    'Vendedor IA ranqueando o Top 10',
  ];

  if (error) {
    return (
      <div className="tk-loading">
        <div className="tk-loading__inner">
          <span className="tk-eyebrow" style={{ color: '#c0392b' }}>Falha na consulta</span>
          <h2>Não consegui completar a recomendação.</h2>
          <p style={{ color: 'var(--tk-muted)' }}>
            <strong>Detalhe:</strong> {error}
          </p>
          <p style={{ color: 'var(--tk-muted)', fontSize: 13 }}>
            Verifique se o servidor backend está rodando em <code>localhost:3001</code> e se a chave Groq está configurada no <code>.env</code>.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="tk-btn tk-btn-primary" onClick={onRetry}>Tentar de novo</button>
            <button className="tk-btn tk-btn-ghost" onClick={onCancel}>Voltar ao briefing</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-loading">
      <div className="tk-loading__inner">
        <span className="tk-eyebrow">Tempo médio · 25-40 segundos</span>
        <h2>Cruzando o briefing com<br/>a Tabela FIPE em tempo real.</h2>
        <p>Dois agentes IA estão trabalhando: um curador que conhece o catálogo brasileiro inteiro e um consultor sênior que valida preços reais e monta o ranking final.</p>
        <div className="tk-progress-stripes" style={{ margin: '22px 0 26px', maxWidth: 420 }} />
        <ul className="tk-loading__steps">
          {steps.map((s, i) => (
            <li key={i} className={i < step ? 'is-on' : ''}>
              <span className="tk-loading__dot">{i < step ? <Icon.Check /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── RESULTS ──────────────────────────────────────────────────
function ResultsView({ client, cardStyle, showCompareBar, cars = [], briefing, diagnostico }) {
  const [filter, setFilter] = useState('all');
  const [compare, setCompare] = useState([]);

  const TYPE_LABEL = { suv: 'SUV', sedan: 'Sedan', hatch: 'Hatch', pickup: 'Picape', coupe: 'Esportivo', minivan: 'Minivan' };
  const counts = useMemo(() => {
    const c = {};
    cars.forEach(car => { c[car.type] = (c[car.type] || 0) + 1; });
    return c;
  }, [cars]);
  const filterOpts = useMemo(() => {
    const opts = [{ id: 'all', label: `Todos · ${cars.length}` }];
    Object.entries(counts).forEach(([t, n]) => {
      opts.push({ id: t, label: `${TYPE_LABEL[t] || t} · ${n}` });
    });
    return opts;
  }, [cars, counts]);

  const filtered = filter === 'all' ? cars : cars.filter(c => c.type === filter);
  const top = cars[0];

  function toggleCompare(id) {
    if (compare.includes(id)) setCompare(compare.filter(x => x !== id));
    else if (compare.length < 3) setCompare([...compare, id]);
  }

  if (!cars.length) {
    return (
      <div className="tk-results tk-scroll">
        <div className="tk-results__hero">
          <div>
            <span className="tk-eyebrow">Nenhum resultado</span>
            <h1>Não encontramos carros que atendam ao briefing.</h1>
            <p>Tente relaxar o orçamento, o ano mínimo, ou o tipo de carroceria.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-results tk-scroll">
      {/* Hero */}
      <div className="tk-results__hero">
        <div>
          <span className="tk-eyebrow">Opções para o briefing</span>
          <h1>{cars.length} carros encontrados para {client.name.split(' ')[0]}.</h1>
          <p>Preços validados na Tabela FIPE — referência {top.mesReferencia}. Use a barra inferior para comparar lado a lado.</p>
          <div className="tk-results__pills">
            <span className="tk-results__pill">{cars.length} opções · {new Set(cars.map(c => c.brand)).size} marcas</span>
            <span className="tk-results__pill">FIPE {top.mesReferencia}</span>
            {diagnostico?.catalogTotal && (
              <span className="tk-results__pill" title={`Pool de ${diagnostico.catalogPool ?? '-'} candidatos do briefing · vendedor escolheu ${diagnostico.vendedorRetornou ?? cars.length}`}>
                Catálogo: {diagnostico.catalogTotal} carros
                {diagnostico.builtAt && ` · ${new Date(diagnostico.builtAt).toLocaleDateString('pt-BR')}`}
              </span>
            )}
          </div>
        </div>
        <div className="tk-results__client">
          <span className="tk-eyebrow" style={{ display: 'block', marginBottom: 10 }}>Cliente</span>
          <div style={{ fontFamily: 'Exo', fontSize: 18, fontWeight: 700, color: 'var(--tk-primary)', letterSpacing: '-0.01em' }}>{client.name}</div>
          <div className="tk-help" style={{ marginBottom: 10 }}>{client.segment}</div>
          {briefing && (
            <>
              <div className="tk-results__client-row">
                <span>Orçamento</span>
                <strong>{fmtBRL(briefing.orcamentoReais.min)} — {fmtBRL(briefing.orcamentoReais.max)}</strong>
              </div>
              {briefing.tiposDesejados?.length > 0 && (
                <div className="tk-results__client-row"><span>Tipo</span><strong>{briefing.tiposDesejados.join(' · ')}</strong></div>
              )}
              {briefing.combustiveisAceitos?.length > 0 && (
                <div className="tk-results__client-row"><span>Combustível</span><strong>{briefing.combustiveisAceitos.join(' · ')}</strong></div>
              )}
              {briefing.prioridades?.length > 0 && (
                <div className="tk-results__client-row"><span>Prioridades</span><strong style={{ textAlign: 'right', maxWidth: '60%' }}>{briefing.prioridades.slice(0, 3).join(' · ')}</strong></div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="tk-results__toolbar">
        <div className="tk-results__filters">
          {filterOpts.map(o => (
            <button key={o.id}
              className={`tk-chip ${filter === o.id ? 'is-active' : ''}`}
              onClick={() => setFilter(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="tk-icobtn"><Icon.Filter /></button>
          <button className="tk-icobtn"><Icon.Eye /></button>
        </div>
      </div>

      {/* Grid — todos os carros lado a lado, sem destaque */}
      <div className="tk-results__grid">
        {filtered.map((c, i) => (
          <CarCard key={c.id} car={c} rank={i + 1}
            isComparing={compare.includes(c.id)}
            onCompare={() => toggleCompare(c.id)}
            variant={cardStyle} />
        ))}
      </div>

      {showCompareBar && compare.length > 0 && (
        <div className="tk-compare-bar">
          <div className="tk-compare-bar__avs">
            {compare.map((id, i) => {
              const c = CARS.find(x => x.id === id);
              return <div key={id}>{c.brand[0]}{c.model[0]}</div>;
            })}
          </div>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {compare.length} carro{compare.length > 1 ? 's' : ''} para comparar
          </span>
          <button className="tk-btn" style={{ background: '#fff', color: 'var(--tk-primary)', padding: '8px 14px' }}>
            <Icon.Compare /> Comparar
          </button>
          <button className="tk-icobtn" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }}
            onClick={() => setCompare([])}>×</button>
        </div>
      )}
    </div>
  );
}

function SpecRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12, borderBottom: '1px dashed var(--tk-border, rgba(0,0,0,0.08))' }}>
      <span style={{ color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, fontSize: 10 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--tk-primary)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function FichaTecnica({ ficha }) {
  if (!ficha) return null;
  const lugaresStr = ficha.lugares && ficha.lugares > 0 ? `${ficha.lugares} lugares` : '';
  const hasAny = [ficha.motor, ficha.cambio, ficha.potencia, ficha.torque, ficha.tracao, ficha.consumoCidade, ficha.consumoEstrada, ficha.porta_malas].some(Boolean) || lugaresStr;
  if (!hasAny) {
    return (
      <div style={{ fontSize: 12, color: 'var(--tk-muted)', fontStyle: 'italic', padding: '8px 0' }}>
        Ficha técnica indisponível.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <SpecRow label="Motor" value={ficha.motor} />
      <SpecRow label="Câmbio" value={ficha.cambio} />
      <SpecRow label="Potência" value={ficha.potencia} />
      <SpecRow label="Torque" value={ficha.torque} />
      <SpecRow label="Tração" value={ficha.tracao} />
      <SpecRow label="Consumo cidade" value={ficha.consumoCidade} />
      <SpecRow label="Consumo estrada" value={ficha.consumoEstrada} />
      <SpecRow label="Porta-malas" value={ficha.porta_malas} />
      <SpecRow label="Lugares" value={lugaresStr} />
    </div>
  );
}

function CarCard({ car, rank, isComparing, onCompare, variant = 'editorial' }) {
  if (variant === 'minimal') {
    return (
      <div className="tk-cc" style={{ borderRadius: 10 }}>
        <div style={{ padding: '14px 16px 0' }}>
          <div className="tk-cc__brand">{car.brand} · {car.year}</div>
          <div className="tk-cc__model" style={{ fontSize: 18 }}>{car.model}</div>
          <div style={{ height: 60, color: 'var(--tk-secondary)', margin: '12px 0' }}>
            <CarSilhouette type={car.type} sw={1.4} />
          </div>
          <FichaTecnica ficha={car.fichaTecnica} />
        </div>
        <div className="tk-cc__foot">
          <div className="tk-cc__price" style={{ fontSize: 18 }}>{car.price}</div>
          <button className={`tk-icobtn ${isComparing ? 'is-active' : ''}`} onClick={onCompare}>
            <Icon.Compare />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-cc">
      <div className="tk-cc__img">
        <div style={{ width: '100%', color: 'var(--tk-primary)' }}>
          <CarSilhouette type={car.type} sw={1.4} />
        </div>
      </div>
      <div className="tk-cc__body">
        <div className="tk-cc__brand">{car.brand} · {car.year}</div>
        <div className="tk-cc__model">{car.model}</div>
        <FichaTecnica ficha={car.fichaTecnica} />
      </div>
      <div className="tk-cc__foot">
        <div>
          <div style={{ fontSize: 10, color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>A partir de</div>
          <div className="tk-cc__price">{car.price}</div>
        </div>
        <button className={`tk-icobtn ${isComparing ? 'is-active' : ''}`} onClick={onCompare} title="Adicionar à comparação">
          <Icon.Compare />
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

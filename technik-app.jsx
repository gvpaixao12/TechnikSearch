/* Technik — Variação 2: Painel Visual (formulário em tela única) */
/* global React, ReactDOM, TechnikLogo, TechnikLogoMark, Icon, CarSilhouette, CarPhoto, useCarImages, MatchRing, CARS, TYPE_OPTIONS, FUEL_OPTIONS, LIFESTYLE_OPTIONS, PRIORITY_OPTIONS, useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakRadio, TweakColor, TweakSlider */

const { useState, useMemo, useEffect } = React;

// Em dev (localhost) bate no backend em :3001; em produção o próprio
// servidor serve o frontend, então usa a mesma origem ('' = relativo).
// Override manual possível via window.API_BASE.
const API_BASE = window.API_BASE !== undefined
  ? window.API_BASE
  : (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '');

const NAV = [
  { id: 'new',     label: 'Nova consulta', icon: <Icon.Plus />,   badge: '⌘N' },
  { id: 'history', label: 'Histórico',     icon: <Icon.History /> },
  { id: 'settings',label: 'Ajustes',       icon: <Icon.Settings /> },
];

function fmtBRL(n) {
  return 'R$ ' + n.toLocaleString('pt-BR');
}

// Faixa de orçamento (em MILHARES de R$). O campo de digitação aceita qualquer
// valor até BUDGET_MAX (R$ 5 mi) — só no talo a faixa vira "sem teto" e o backend
// ignora o limite superior. A barra usa um teto BASE (600) que cresce sozinho
// quando o valor digitado passa dele: assim ranges premium (700k–1mi) continuam
// ajustáveis na barra sem travar em 600.
const BUDGET_MIN = 50;
const BUDGET_MAX = 5000;        // teto do campo (R$ 5 mi); no talo = "sem teto"
const BUDGET_SLIDER_BASE = 600; // teto padrão da barra (cresce se digitar mais)

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

  // Form state — começa em branco para o consultor preencher
  const [client, setClient] = useState({ name: '', segment: '' });
  const [budget, setBudget]   = useState([50, 600]); // R$ mil
  const [seats, setSeats]     = useState(5);
  const [seatsAny, setSeatsAny] = useState(true);
  const [trunk, setTrunk]     = useState(420); // litros
  const [trunkAny, setTrunkAny] = useState(true);
  const [yearMin, setYearMin] = useState(2005);
  const [yearMax, setYearMax] = useState(2025);
  const [yearMaxAny, setYearMaxAny] = useState(true); // default: sem teto de ano
  const [types, setTypes]     = useState([]);
  const [fuels, setFuels]     = useState([]);
  const [lifestyle, setLifestyle] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [notes, setNotes]     = useState('');
  const [notesAny, setNotesAny] = useState(true);

  // Rascunho em edição: se veio de um rascunho salvo, guardamos o id pra que
  // "Salvar rascunho" ATUALIZE o mesmo registro em vez de criar duplicatas.
  const [draftId, setDraftId] = useState(null);
  // 'idle' | 'saving' | 'saved' | 'error' — feedback do botão Salvar rascunho.
  const [draftState, setDraftState] = useState('idle');

  function toggle(setter, list, id) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }

  // Snapshot do formulário inteiro (o que vai pro rascunho).
  function collectForm() {
    return {
      client, budget, seats, seatsAny, trunk, trunkAny,
      yearMin, yearMax, yearMaxAny,
      types, fuels, lifestyle, priorities, notes, notesAny,
    };
  }

  // Restaura o formulário a partir de um snapshot salvo. Defensivo: cada campo
  // cai no default se o rascunho for antigo/incompleto.
  function applyForm(f = {}) {
    setClient(f.client || { name: '', segment: '' });
    setBudget(Array.isArray(f.budget) ? f.budget : [50, 600]);
    setSeats(f.seats ?? 5); setSeatsAny(f.seatsAny ?? true);
    setTrunk(f.trunk ?? 420); setTrunkAny(f.trunkAny ?? true);
    setYearMin(f.yearMin ?? 2005);
    setYearMax(f.yearMax ?? 2025); setYearMaxAny(f.yearMaxAny ?? true);
    setTypes(f.types || []); setFuels(f.fuels || []);
    setLifestyle(f.lifestyle || []); setPriorities(f.priorities || []);
    setNotes(f.notes || ''); setNotesAny(f.notesAny ?? true);
  }

  // Salva (ou atualiza, se já veio de um rascunho) o formulário atual.
  async function saveDraft() {
    setDraftState('saving');
    try {
      const r = await fetch(`${API_BASE}/api/rascunhos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, client_name: client.name, form: collectForm() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.reason || `HTTP ${r.status}`);
      setDraftId(j.id);
      setDraftState('saved');
      setTimeout(() => setDraftState('idle'), 2500);
    } catch (e) {
      console.warn('[saveDraft]', e);
      setDraftState('error');
      setTimeout(() => setDraftState('idle'), 4000);
    }
  }

  // Reabre um rascunho do histórico: restaura o formulário e volta pra edição.
  async function resumeDraft(id) {
    try {
      const r = await fetch(`${API_BASE}/api/rascunhos/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.reason || 'Falha ao abrir rascunho');
      applyForm(j.rascunho.form || {});
      setDraftId(id);
      setRecommendation(null);
      setLoadError(null);
      setActiveNav('new');
      setStage('form');
    } catch (e) {
      console.warn('[resumeDraft]', e);
      alert('Não consegui abrir esse rascunho: ' + e.message);
    }
  }

  // Zera o formulário inteiro (usado pela ação "Nova consulta")
  function resetForm() {
    setClient({ name: '', segment: '' });
    setBudget([50, 600]);
    setSeats(5); setSeatsAny(true);
    setTrunk(420); setTrunkAny(true);
    setYearMin(2005);
    setYearMax(2025); setYearMaxAny(true);
    setTypes([]); setFuels([]); setLifestyle([]); setPriorities([]);
    setNotes(''); setNotesAny(true);
    setDraftId(null); setDraftState('idle');
  }

  function handleNav(id) {
    setActiveNav(id);
    if (id === 'new') {
      resetForm();
      setRecommendation(null);
      setLoadError(null);
      setStage('form');
    }
  }

  // Reabre uma consulta do histórico: recarrega o resultado salvo e volta
  // pra tela de resultados, exatamente como foi entregue ao cliente.
  async function openConsulta(id) {
    try {
      const r = await fetch(`${API_BASE}/api/consultas/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.reason || 'Falha ao abrir consulta');
      const c = j.consulta;
      setClient({ name: c.client_name || '', segment: c.client_segment || '' });
      setRecommendation({ top: c.top || [], briefing: c.briefing, diagnostico: c.diagnostico });
      setLoadError(null);
      setDraftId(null);
      setActiveNav('new');
      setStage('results');
    } catch (e) {
      console.warn('[openConsulta]', e);
      alert('Não consegui abrir essa consulta: ' + e.message);
    }
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
      client, budget,
      budgetOpen: budget[1] >= BUDGET_MAX, // teto no talo (R$ 5 mi) = sem teto
      yearMin,
      yearMax: yearMaxAny ? null : yearMax,
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
              onClick={() => handleNav(n.id)}>
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
              {activeNav === 'history' && 'Atendimentos salvos'}
              {activeNav !== 'history' && stage === 'form' && 'Nova consulta · etapa 1/2'}
              {activeNav !== 'history' && stage === 'loading' && 'Calculando recomendações'}
              {activeNav !== 'history' && stage === 'results' && 'Recomendações · entrega ao cliente'}
            </span>
            <h1>
              {activeNav === 'history' && 'Histórico de consultas'}
              {activeNav !== 'history' && stage === 'form' && 'Briefing do perfil'}
              {activeNav !== 'history' && stage === 'loading' && 'Cruzando catálogo'}
              {activeNav !== 'history' && stage === 'results' && `Top 10 para ${client.name.split(' ')[0]}`}
            </h1>
          </div>
          <div className="tk-topbar__actions">
            {activeNav !== 'history' && stage === 'form' && (
              <>
                <button className="tk-btn tk-btn-ghost" onClick={saveDraft}
                  disabled={draftState === 'saving'}
                  style={draftState === 'error' ? { color: '#c0392b', borderColor: '#c0392b' } : undefined}>
                  {draftState === 'saved'
                    ? (<><Icon.Check /> Rascunho salvo</>)
                    : draftState === 'saving'
                    ? (<><Icon.Bookmark /> Salvando…</>)
                    : draftState === 'error'
                    ? (<><Icon.Bookmark /> Falhou — tentar de novo</>)
                    : (<><Icon.Bookmark /> {draftId ? 'Atualizar rascunho' : 'Salvar rascunho'}</>)}
                </button>
                <button className="tk-btn tk-btn-primary"
                  onClick={() => setStage('loading')}>
                  Buscar recomendações <Icon.ChevronRight />
                </button>
              </>
            )}
            {activeNav !== 'history' && stage === 'results' && (
              <>
                <button className="tk-btn tk-btn-ghost" onClick={() => setStage('form')}>← Editar briefing</button>
              </>
            )}
          </div>
        </header>

        {activeNav === 'history' ? (
          <HistoryView onOpen={openConsulta} onNew={() => handleNav('new')} onResumeDraft={resumeDraft} />
        ) : (
          <>
        {stage === 'form' && (
          <FormView
            client={client} setClient={setClient}
            budget={budget} setBudget={setBudget}
            seats={seats} setSeats={setSeats}
            seatsAny={seatsAny} setSeatsAny={setSeatsAny}
            trunk={trunk} setTrunk={setTrunk}
            trunkAny={trunkAny} setTrunkAny={setTrunkAny}
            yearMin={yearMin} setYearMin={setYearMin}
            yearMax={yearMax} setYearMax={setYearMax}
            yearMaxAny={yearMaxAny} setYearMaxAny={setYearMaxAny}
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
          </>
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
          yearMin, setYearMin, yearMax, setYearMax, yearMaxAny, setYearMaxAny,
          types, setTypes, fuels, setFuels,
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

  // Teto da barra: fica em 600 por padrão e cresce (com ~15% de folga, alinhado
  // ao step de 5) pra acompanhar valores digitados acima de 600 — sem ultrapassar
  // o teto do campo. Assim o thumb do máximo nunca fica colado na borda.
  const sliderCeil = Math.ceil(budget[1] / 5) * 5 <= BUDGET_SLIDER_BASE
    ? BUDGET_SLIDER_BASE
    : Math.min(BUDGET_MAX, Math.ceil((budget[1] * 1.15) / 5) * 5);
  const kLabel = v => v >= 1000
    ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}mi`
    : `R$ ${v}k`;
  const budgetTicks = [0, 1, 2, 3].map(i => Math.round((BUDGET_MIN + (sliderCeil - BUDGET_MIN) * i / 3) / 5) * 5);

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
                placeholder="Ex.: Nome Cliente" />
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
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <BudgetInput value={budget[0]} min={BUDGET_MIN} max={budget[1] - 5}
                  onCommit={v => setBudget([v, budget[1]])} />
                <span style={{ color: 'var(--tk-muted)', flexShrink: 0 }}>—</span>
                <BudgetInput value={budget[1]} min={budget[0] + 5} max={BUDGET_MAX} openAtMax
                  onCommit={v => setBudget([budget[0], v])} />
              </div>
              <DualRange min={BUDGET_MIN} max={sliderCeil} step={5} value={budget} onChange={setBudget} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tk-muted)', marginTop: 4 }}>
                {budgetTicks.map((v, i) => (
                  <span key={i}>{kLabel(v)}{i === budgetTicks.length - 1 && sliderCeil >= BUDGET_MAX ? '+' : ''}</span>
                ))}
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
          <div className="q2__row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16, maxWidth: 560 }}>
            <div className="q2__field">
              <label className="tk-label">
                <span>Ano mínimo</span>
                <span className="tk-mono">≥ {yearMin}</span>
              </label>
              <input type="range" min={2005} max={2025} step={1} value={yearMin}
                className="tk-range"
                onChange={e => {
                  const v = +e.target.value;
                  setYearMin(v);
                  if (!yearMaxAny && yearMax < v) setYearMax(v); // máx nunca abaixo do mín
                }} />
            </div>
            <div className="q2__field">
              <label className="tk-label">
                <span>Ano máximo</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {!yearMaxAny && <span className="tk-mono">≤ {yearMax}</span>}
                  <AnyToggle on={yearMaxAny} onChange={setYearMaxAny} />
                </span>
              </label>
              {yearMaxAny ? (
                <div style={{ padding: '10px 0', color: 'var(--tk-muted)', fontStyle: 'italic', fontSize: 13 }}>Sem teto de ano</div>
              ) : (
                <input type="range" min={yearMin} max={2025} step={1} value={Math.max(yearMax, yearMin)}
                  className="tk-range"
                  onChange={e => setYearMax(Math.max(+e.target.value, yearMin))} />
              )}
            </div>
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
            <strong>{fmtBRL(budget[0]*1000)} — {budget[1] >= BUDGET_MAX ? `${fmtBRL(budget[1]*1000)}+` : fmtBRL(budget[1]*1000)}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Lugares</span><strong>{seatsAny ? 'Indiferente' : seats}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Porta-malas</span><strong>{trunkAny ? 'Indiferente' : `≥ ${trunk} L`}</strong>
          </div>
          <div className="q2__preview-row">
            <span>Ano</span><strong>{yearMaxAny ? `≥ ${yearMin}` : `${yearMin} – ${yearMax}`}</strong>
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
// Caixa editável de orçamento (em R$ cheios). value/min/max chegam em MILHARES.
// A barra acompanha em tempo real: cada dígito digitado já chama onCommit com o
// valor (arredondado p/ múltiplo de 5 e travado entre min/max). Enquanto o campo
// está focado, mostra o rascunho cru pra não brigar com a digitação; ao sair,
// normaliza pro valor canônico.
function BudgetInput({ value, min, max, onCommit, openAtMax = false }) {
  const [draft, setDraft] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  // Topo aberto: no máximo, mostra "600.000+" (sem teto). Ao focar, edita normal.
  const isOpen = openAtMax && value >= max;
  const display = focused
    ? draft
    : (value * 1000).toLocaleString('pt-BR') + (isOpen ? '+' : '');

  function commitDigits(digits) {
    if (digits === '') return;
    let mil = Math.round(Number(digits) / 1000 / 5) * 5;     // alinha ao step da barra
    mil = Math.max(min, Math.min(max, mil));
    onCommit(mil);
  }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0,
      border: '1px solid var(--tk-bg-3)', borderRadius: 8, padding: '7px 10px',
      background: 'var(--tk-bg-2, var(--tk-bg))',
    }}>
      <span style={{ color: 'var(--tk-muted)', fontSize: 13, flexShrink: 0 }}>R$</span>
      <input
        inputMode="numeric"
        value={display}
        onFocus={() => { setFocused(true); setDraft(String(value * 1000)); }}
        onBlur={() => { commitDigits(draft.replace(/\D/g, '')); setFocused(false); }}
        onChange={e => { const d = e.target.value.replace(/\D/g, ''); setDraft(d); commitDigits(d); }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        style={{
          border: 'none', outline: 'none', background: 'transparent', width: '100%',
          minWidth: 0, fontFamily: 'inherit', fontSize: 13, color: 'var(--tk-fg, inherit)',
        }} />
    </span>
  );
}

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
        <div className="tk-porsche-loader" role="status" aria-label="Carregando recomendações">
          <div className="tk-porsche-carwrap">
            <div className="tk-porsche-car">
              <div className="tk-porsche-ghost"></div>
              <div className="tk-porsche-fill"></div>
              <div className="tk-porsche-shine"></div>
            </div>
          </div>
        </div>
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

// ─── HISTORY VIEW ─────────────────────────────────────────────
// Lista os atendimentos salvos (resumo) com filtro por cliente.
// Clicar numa consulta chama onOpen(id) → o App recarrega o resultado salvo.
function HistoryView({ onOpen, onNew, onResumeDraft }) {
  const [state, setState] = useState({ loading: true, error: null, consultas: [] });
  const [drafts, setDrafts] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, consultas: [] });

    fetch(`${API_BASE}/api/consultas?limit=100`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.ok) throw new Error(j.reason || 'Falha ao carregar histórico');
        setState({ loading: false, error: null, consultas: j.consultas });
      })
      .catch(e => { if (!cancelled) setState({ loading: false, error: e.message, consultas: [] }); });

    // Rascunhos: independente do histórico — se a tabela não existir, só não aparece.
    fetch(`${API_BASE}/api/rascunhos?limit=100`)
      .then(r => r.json())
      .then(j => { if (!cancelled && j.ok) setDrafts(j.rascunhos); })
      .catch(() => { /* rascunhos indisponíveis — ignora */ });

    return () => { cancelled = true; };
  }, []);

  async function removeDraft(id) {
    if (!window.confirm('Excluir este rascunho?')) return;
    setDrafts(ds => ds.filter(d => d.id !== id)); // otimista
    try {
      const r = await fetch(`${API_BASE}/api/rascunhos/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.reason);
    } catch (e) {
      console.warn('[removeDraft]', e);
      alert('Não consegui excluir o rascunho: ' + e.message);
    }
  }

  const TYPE_LABEL = { suv: 'SUV', sedan: 'Sedan', hatch: 'Hatch', pickup: 'Picape', coupe: 'Esportivo', minivan: 'Minivan' };
  const fmtDate = (s) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Filtro por cliente: casa nome ou perfil resumido.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return state.consultas;
    return state.consultas.filter(c =>
      `${c.client_name || ''} ${c.client_segment || ''}`.toLowerCase().includes(q)
    );
  }, [state.consultas, q]);

  if (state.loading) {
    return <div className="tk-results tk-scroll"><div className="tk-help" style={{ padding: 28 }}>Carregando histórico…</div></div>;
  }

  if (state.error) {
    return (
      <div className="tk-results tk-scroll">
        <div className="tk-results__hero">
          <div>
            <span className="tk-eyebrow" style={{ color: '#c0392b' }}>Histórico indisponível</span>
            <h1>Não consegui carregar o histórico.</h1>
            <p style={{ color: 'var(--tk-muted)' }}><strong>Detalhe:</strong> {state.error}</p>
            <p style={{ color: 'var(--tk-muted)', fontSize: 13 }}>
              Confirme que a tabela <code>consultas</code> existe no Supabase (rode <code>server/scripts/consultas-schema.sql</code> no SQL Editor) e que o backend tem as chaves Supabase no <code>.env</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-results tk-scroll">
      <div className="tk-results__hero">
        <div>
          <span className="tk-eyebrow">Atendimentos salvos</span>
          <h1>{state.consultas.length} consulta{state.consultas.length !== 1 ? 's' : ''} no histórico.</h1>
          <p>Cada recomendação entregue fica registrada aqui. Clique pra reabrir os resultados exatamente como foram apresentados ao cliente.</p>
        </div>
      </div>

      {drafts.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon.Bookmark style={{ color: 'var(--tk-secondary)' }} />
            <span className="tk-eyebrow" style={{ margin: 0 }}>Rascunhos · {drafts.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.map(d => (
              <div key={d.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
                  padding: '13px 16px', borderRadius: 12,
                  border: '1px dashed var(--tk-line)', background: 'var(--tk-bg)',
                }}>
                <button onClick={() => onResumeDraft(d.id)}
                  title="Retomar este rascunho"
                  style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--tk-ink)', padding: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>{d.client_name || 'Sem nome'}</span>
                  <span style={{ fontFamily: 'var(--tk-font-mono)', fontSize: 11, color: 'var(--tk-muted)' }}>
                    Editado {fmtDate(d.updated_at || d.created_at)}
                  </span>
                </button>
                <button onClick={() => onResumeDraft(d.id)} className="tk-btn tk-btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }}>
                  Retomar <Icon.ChevronRight />
                </button>
                <button onClick={() => removeDraft(d.id)} title="Excluir rascunho"
                  style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--tk-line)', background: 'var(--tk-bg)', color: 'var(--tk-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                  <Icon.Trash />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.consultas.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 320px', maxWidth: 420 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--tk-muted)', display: 'flex', pointerEvents: 'none' }}>
              <Icon.Search />
            </span>
            <input
              type="text"
              className="tk-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Filtrar por cliente…"
              style={{ paddingLeft: 38, paddingRight: query ? 34 : 14 }}
            />
            {query && (
              <button onClick={() => setQuery('')} title="Limpar filtro"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--tk-bg-3)', color: 'var(--tk-ink)', cursor: 'pointer', fontSize: 15, lineHeight: 1, display: 'grid', placeItems: 'center' }}>×</button>
            )}
          </div>
          {q && (
            <span className="tk-help" style={{ fontFamily: 'var(--tk-font-mono)', fontSize: 11 }}>
              {filtered.length} de {state.consultas.length}
            </span>
          )}
        </div>
      )}

      {state.consultas.length === 0 ? (
        <div className="tk-help" style={{ padding: '28px 4px' }}>
          Nenhuma consulta salva ainda.{' '}
          <button onClick={onNew} style={{ background: 'none', border: 'none', color: 'var(--tk-primary)', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>Fazer a primeira</button>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="tk-help" style={{ padding: '28px 4px' }}>
          Nenhum cliente corresponde a “<strong>{query.trim()}</strong>”.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(c => (
            <button key={c.id} onClick={() => onOpen(c.id)} className="tk-hist-row"
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
                textAlign: 'left', padding: '15px 18px', borderRadius: 12,
                border: '1px solid var(--tk-line)', background: 'var(--tk-bg)', cursor: 'pointer',
                fontFamily: 'var(--tk-font)', color: 'var(--tk-ink)',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--tk-font)', fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', color: 'var(--tk-ink)' }}>{c.client_name || 'Sem nome'}</span>
                  {c.client_segment && <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--tk-secondary)' }}>{c.client_segment}</span>}
                  {!c.ok && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#c0392b', textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid currentColor', borderRadius: 4, padding: '1px 5px' }}>sem resultado</span>}
                </div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontFamily: 'var(--tk-font-mono)', fontSize: 11, color: 'var(--tk-muted)', letterSpacing: '0.01em' }}>
                  <span>{fmtDate(c.created_at)}</span>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ color: 'var(--tk-secondary)', fontWeight: 500 }}>{c.total_resultados} resultado{c.total_resultados !== 1 ? 's' : ''}</span>
                  {(c.orcamento_min != null && c.orcamento_max != null) && (
                    <><span style={{ opacity: 0.4 }}>·</span><span>{fmtBRL(c.orcamento_min)}–{fmtBRL(c.orcamento_max)}</span></>
                  )}
                  {c.tipos?.length > 0 && (
                    <><span style={{ opacity: 0.4 }}>·</span><span>{c.tipos.map(t => TYPE_LABEL[t] || t).join(', ')}</span></>
                  )}
                </div>
                {c.top_models?.length > 0 && (
                  <div style={{ marginTop: 7, fontSize: 13, fontWeight: 500, lineHeight: 1.35, color: 'var(--tk-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.top_models.slice(0, 3).join('  ·  ')}
                    {c.top_models.length > 3 && <span style={{ color: 'var(--tk-muted)', fontWeight: 600 }}>{`  +${c.top_models.length - 3}`}</span>}
                  </div>
                )}
              </div>
              <Icon.ChevronRight style={{ color: 'var(--tk-muted)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RESULTS ──────────────────────────────────────────────────
function ResultsView({ client, cardStyle, showCompareBar, cars = [], briefing, diagnostico }) {
  const [filter, setFilter] = useState('all');
  const [compare, setCompare] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

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

  const q = query.trim().toLowerCase();
  const filtered = cars.filter(c => {
    const typeOk = filter === 'all' || c.type === filter;
    const queryOk = !q || `${c.brand} ${c.model}`.toLowerCase().includes(q);
    return typeOk && queryOk;
  });
  const top = cars[0];

  // Por enquanto a comparação é entre 2 carros. Ao selecionar um terceiro,
  // o mais antigo sai pra dar lugar ao novo (a seleção sempre mira nos 2 atuais).
  function toggleCompare(id) {
    setCompare(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
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
          <div style={{ fontFamily: 'Exo', fontSize: 18, fontWeight: 700, color: 'var(--tk-ink)', letterSpacing: '-0.01em' }}>{client.name}</div>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {searchOpen && (
            <input
              type="text"
              className="tk-search-inline"
              autoFocus
              placeholder="Marca ou modelo…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false); } }}
            />
          )}
          <button
            className={`tk-icobtn ${searchOpen || q ? 'is-active' : ''}`}
            title="Filtrar por marca ou modelo"
            onClick={() => setSearchOpen(o => !o)}>
            <Icon.Filter />
          </button>
        </div>
      </div>

      {/* Grid — todos os carros lado a lado, sem destaque */}
      {filtered.length === 0 ? (
        <div className="tk-help" style={{ padding: '28px 4px' }}>
          Nenhum carro corresponde {q ? <>a “<strong>{query.trim()}</strong>”</> : 'ao filtro'}.
        </div>
      ) : (
        <div className="tk-results__grid">
          {filtered.map((c, i) => (
            <CarCard key={c.id} car={c} rank={i + 1}
              isComparing={compare.includes(c.id)}
              onCompare={() => toggleCompare(c.id)}
              variant={cardStyle} />
          ))}
        </div>
      )}

      {showCompareBar && compare.length > 0 && (() => {
        // Resolve os ids selecionados nos carros reais vindos do backend
        // (antes lia do array estático CARS, que não bate com o catálogo real).
        const picked = compare.map(id => cars.find(c => c.id === id)).filter(Boolean);
        const ready = picked.length >= 2;
        return (
          <div className="tk-compare-bar">
            <div className="tk-compare-bar__avs">
              {picked.map(c => (
                <div key={c.id} title={`${c.brand} ${c.model}`}>{c.brand[0]}{c.model[0]}</div>
              ))}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {ready
                ? 'Pronto para comparar'
                : 'Selecione mais 1 carro para comparar'}
            </span>
            <button className="tk-btn"
              style={{ background: '#fff', color: 'var(--tk-primary)', padding: '8px 14px', opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'not-allowed' }}
              disabled={!ready}
              onClick={() => ready && setCompareOpen(true)}>
              <Icon.Compare /> Comparar
            </button>
            <button className="tk-icobtn" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.2)', color: '#fff' }}
              onClick={() => setCompare([])}>×</button>
          </div>
        );
      })()}

      {compareOpen && (
        <CompareModal
          cars={compare.map(id => cars.find(c => c.id === id)).filter(Boolean)}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}

// ─── COMPARE MODAL (2 carros lado a lado) ─────────────────────
// Recebe os 2 carros já selecionados e mostra foto, identificação e a ficha
// técnica alinhada linha a linha. Onde os dois diferem, marca com um ponto.
function CompareModal({ cars = [], onClose }) {
  const TYPE_LABEL = { suv: 'SUV', sedan: 'Sedan', hatch: 'Hatch', pickup: 'Picape', coupe: 'Esportivo', minivan: 'Minivan' };

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Mesma ordem/rótulos da FichaTecnica do card, mais preço/ano/tipo no topo.
  const specs = [
    { label: 'Preço', get: c => c.price, strong: true },
    { label: 'Ano', get: c => c.year ? String(c.year) : '' },
    { label: 'Tipo', get: c => TYPE_LABEL[c.type] || c.type || '' },
    { label: 'Motor', get: c => c.fichaTecnica?.motor },
    { label: 'Câmbio', get: c => c.fichaTecnica?.cambio },
    { label: 'Potência', get: c => c.fichaTecnica?.potencia },
    { label: 'Torque', get: c => c.fichaTecnica?.torque },
    { label: 'Tração', get: c => c.fichaTecnica?.tracao },
    { label: 'Consumo cidade', get: c => c.fichaTecnica?.consumoCidade },
    { label: 'Consumo estrada', get: c => c.fichaTecnica?.consumoEstrada },
    { label: 'Porta-malas', get: c => c.fichaTecnica?.porta_malas },
    { label: 'Lugares', get: c => c.fichaTecnica?.lugares > 0 ? `${c.fichaTecnica.lugares} lugares` : '' },
  ];

  const val = v => (v === undefined || v === null || v === '') ? '—' : v;

  return ReactDOM.createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(10,10,25,0.66)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--tk-bg)', borderRadius: 16, width: '100%', maxWidth: 760,
        boxShadow: '0 40px 120px rgba(0,0,0,0.45)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--tk-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--tk-ink)' }}>
            <Icon.Compare />
            <span style={{ fontFamily: 'Exo', fontWeight: 700, fontSize: 16 }}>Comparativo</span>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--tk-bg-2)', color: 'var(--tk-ink)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Grade: coluna de rótulos + 1 coluna por carro */}
        <div style={{ display: 'grid', gridTemplateColumns: '124px 1fr 1fr' }}>
          {/* Cabeçalho: foto + identificação */}
          <div />
          {cars.map(c => (
            <div key={c.id} style={{ padding: 14, borderLeft: '1px solid var(--tk-line)' }}>
              <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                <CarPhoto brand={c.brand} model={c.model} year={c.year} type={c.type} rounded aspect="4 / 3" />
              </div>
              <div style={{ fontSize: 10, color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>{c.brand} · {c.year}</div>
              <div style={{ fontFamily: 'Exo', fontWeight: 700, fontSize: 15, color: 'var(--tk-ink)', lineHeight: 1.2 }}>{c.versao || c.model}</div>
              {c.motor && <div style={{ fontSize: 11, color: 'var(--tk-muted)', marginTop: 2 }}>{c.motor}</div>}
            </div>
          ))}

          {/* Linhas de especificação */}
          {specs.map((s, i) => {
            const vals = cars.map(c => val(s.get(c)));
            const diff = vals.length === 2 && vals[0] !== vals[1] && vals[0] !== '—' && vals[1] !== '—';
            const zebra = i % 2 === 0 ? 'var(--tk-bg-2)' : 'transparent';
            return (
              <React.Fragment key={s.label}>
                <div style={{ padding: '10px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--tk-muted)', background: zebra, display: 'flex', alignItems: 'center' }}>{s.label}</div>
                {vals.map((v, j) => (
                  <div key={j} style={{
                    padding: '10px 14px', fontSize: s.strong ? 15 : 13,
                    fontWeight: s.strong ? 700 : (diff ? 600 : 500),
                    color: v === '—' ? 'var(--tk-muted)' : (s.strong ? 'var(--tk-primary)' : 'var(--tk-ink)'),
                    background: zebra, borderLeft: '1px solid var(--tk-line)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {diff && v !== '—' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--tk-gold, #f0b429)', flexShrink: 0 }} />}
                    {v}
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>

        <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--tk-muted)', borderTop: '1px solid var(--tk-line)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tk-gold, #f0b429)' }} /> ponto marca onde os dois diferem
        </div>
      </div>
    </div>,
    document.body
  );
}

function SpecRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12, borderBottom: '1px dashed var(--tk-line)' }}>
      <span style={{ color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, fontSize: 10 }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--tk-ink)', textAlign: 'right' }}>{value}</span>
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
  // Clicar em qualquer lugar do card abre a galeria de fotos. Cada clique
  // incrementa openSignal, que o CarPhoto observa pra abrir a tela cheia.
  const [openSignal, setOpenSignal] = useState(0);
  const openGallery = () => setOpenSignal(n => n + 1);

  if (variant === 'minimal') {
    return (
      <div className="tk-cc" onClick={openGallery} title="Ver todas as fotos" style={{ borderRadius: 10, cursor: 'pointer' }}>
        <div style={{ padding: '14px 16px 0' }}>
          <div className="tk-cc__brand">{car.brand} · {car.year}</div>
          <div className="tk-cc__model" style={{ fontSize: 18 }}>{car.versao || car.model}</div>
          {car.motor && <div style={{ fontSize: 12, color: 'var(--tk-muted)', marginTop: 2 }}>{car.motor}</div>}
          <div style={{ height: 100, margin: '12px 0', overflow: 'hidden', borderRadius: 6 }}>
            <CarPhoto brand={car.brand} model={car.model} year={car.year} type={car.type} openSignal={openSignal} />
          </div>
          <FichaTecnica ficha={car.fichaTecnica} />
        </div>
        <div className="tk-cc__foot">
          <div className="tk-cc__price" style={{ fontSize: 18 }}>{car.price}</div>
          <button className={`tk-icobtn ${isComparing ? 'is-active' : ''}`} onClick={(e) => { e.stopPropagation(); onCompare(); }}>
            <Icon.Compare />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tk-cc" onClick={openGallery} title="Ver todas as fotos" style={{ cursor: 'pointer' }}>
      <div className="tk-cc__img" style={{ height: 'auto', padding: 0, overflow: 'hidden' }}>
        <CarPhoto brand={car.brand} model={car.model} year={car.year} type={car.type} eager={rank === 1} rounded openSignal={openSignal} />
      </div>
      <div className="tk-cc__body">
        <div className="tk-cc__brand">{car.brand} · {car.year}</div>
        <div className="tk-cc__model">{car.versao || car.model}</div>
        {car.motor && <div style={{ fontSize: 12, color: 'var(--tk-muted)', marginTop: 2 }}>{car.motor}</div>}
        <FichaTecnica ficha={car.fichaTecnica} />
      </div>
      <div className="tk-cc__foot">
        <div>
          <div style={{ fontSize: 10, color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>A partir de</div>
          <div className="tk-cc__price">{car.price}</div>
        </div>
        <button className={`tk-icobtn ${isComparing ? 'is-active' : ''}`} onClick={(e) => { e.stopPropagation(); onCompare(); }} title="Adicionar à comparação">
          <Icon.Compare />
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

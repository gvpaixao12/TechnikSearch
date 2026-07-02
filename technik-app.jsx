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

// Reverte o briefing NORMALIZADO (rótulos em pt-BR de server/briefing.js) de volta
// pro formato de formulário (códigos). Usado ao reabrir uma consulta do histórico
// e clicar em "Editar briefing" — a consulta só guarda o briefing normalizado,
// não o form cru. Mantenha em sincronia com os *_LABELS de server/briefing.js.
const LABEL_TO_TYPE = {
  'Hatch': 'hatch', 'Sedã': 'sedan', 'SUV': 'suv',
  'Picape': 'pickup', 'Coupé': 'coupe', 'Minivan': 'minivan',
};
const LABEL_TO_FUEL = {
  'Flex': 'flex', 'Gasolina': 'gas', 'Diesel': 'diesel',
  'Híbrido': 'hybrid', 'Híbrido plug-in': 'plugin', 'Elétrico': 'electric',
};
const LABEL_TO_LIFESTYLE = {
  'família': 'family', 'uso urbano': 'urban', 'viagens longas': 'travel',
  'trabalho/carga': 'work', 'estradas de terra/off-road': 'offroad', 'uso esportivo': 'sport',
};
const LABEL_TO_PRIORITY = {
  'segurança': 'safety', 'conforto': 'comfort', 'economia de combustível': 'economy',
  'conectividade/tecnologia': 'tech', 'design': 'design', 'valor de revenda': 'resale',
};

function briefingToForm(b = {}, client) {
  const rev = (list, dict) => (Array.isArray(list) ? list.map(s => dict[s]).filter(Boolean) : []);
  const orc = b.orcamentoReais || {};
  const min = Number.isFinite(orc.min) ? Math.round(orc.min / 1000) : BUDGET_MIN;
  const max = orc.max == null ? BUDGET_MAX : Math.round(orc.max / 1000);
  return {
    client: client || { name: '', segment: '' },
    budget: [min, max],
    seats: b.lugaresMin ?? 5, seatsAny: b.lugaresMin == null,
    trunk: b.portaMalasMinL ?? 420, trunkAny: b.portaMalasMinL == null,
    yearMin: b.anoMin ?? 2005,
    yearMax: b.anoMax ?? 2025, yearMaxAny: b.anoMax == null,
    types: rev(b.tiposDesejados, LABEL_TO_TYPE),
    fuels: rev(b.combustiveisAceitos, LABEL_TO_FUEL),
    lifestyle: rev(b.estiloDeVida, LABEL_TO_LIFESTYLE),
    priorities: rev(b.prioridades, LABEL_TO_PRIORITY),
    notes: b.observacoes || '', notesAny: !b.observacoes,
  };
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
      const client = { name: c.client_name || '', segment: c.client_segment || '' };
      // Repopula o formulário a partir do briefing salvo, pra que "Editar
      // briefing" abra a tela já preenchida com o que o cliente pediu.
      applyForm(briefingToForm(c.briefing || {}, client));
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
              {activeNav === 'settings' && 'Configurações'}
              {activeNav === 'new' && stage === 'form' && 'Nova consulta · etapa 1/2'}
              {activeNav === 'new' && stage === 'loading' && 'Calculando recomendações'}
              {activeNav === 'new' && stage === 'results' && 'Recomendações · entrega ao cliente'}
            </span>
            <h1>
              {activeNav === 'history' && 'Histórico de consultas'}
              {activeNav === 'settings' && 'Ajustes'}
              {activeNav === 'new' && stage === 'form' && 'Briefing do perfil'}
              {activeNav === 'new' && stage === 'loading' && 'Cruzando catálogo'}
              {activeNav === 'new' && stage === 'results' && `Top 10 para ${client.name.split(' ')[0]}`}
            </h1>
          </div>
          <div className="tk-topbar__actions">
            {activeNav === 'new' && stage === 'form' && (
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
            {activeNav === 'new' && stage === 'results' && (
              <>
                <button className="tk-btn tk-btn-ghost" onClick={() => setStage('form')}>← Editar briefing</button>
              </>
            )}
          </div>
        </header>

        {activeNav === 'history' ? (
          <HistoryView onOpen={openConsulta} onNew={() => handleNav('new')} onResumeDraft={resumeDraft} />
        ) : activeNav === 'settings' ? (
          <SettingsView />
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

// ─── SETTINGS ─────────────────────────────────────────────────
// Tela de Ajustes com abas. Cada aba é uma área de configuração diferente;
// por enquanto só "Catálogo no Supabase" (lista o que está cadastrado no cache
// de imagens). Novas abas entram em SETTINGS_TABS + no switch de conteúdo.
const SETTINGS_TABS = [
  { id: 'catalog', label: 'Catálogo no Supabase' },
];

function SettingsView() {
  const [tab, setTab] = useState('catalog');

  return (
    <div className="tk-results tk-scroll">
      <div className="tk-results__hero" style={{ display: 'block' }}>
        <span className="tk-eyebrow">Ajustes</span>
        <h1>Configurações</h1>
        <p>Área de administração da Technik. Comece pelo catálogo cadastrado no Supabase.</p>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--tk-line)', marginBottom: 24 }}>
        {SETTINGS_TABS.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', background: 'none',
              cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 600,
              color: tab === t.id ? 'var(--tk-primary)' : 'var(--tk-muted)',
              borderBottom: tab === t.id ? '2px solid var(--tk-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalog' && <SupabaseCatalogTab />}
    </div>
  );
}

// Estágios macro da busca com IA (backend emite via SSE) → rótulo + % da barra.
// Ordem: fila → busca → download → validação → upload → (done = 100%).
const AI_STAGES = {
  queue:    { pct: 8,  label: 'Na fila…' },
  search:   { pct: 25, label: 'Buscando fotos…' },
  download: { pct: 45, label: 'Baixando candidatos…' },
  validate: { pct: 70, label: 'Validando com visão…' },
  upload:   { pct: 90, label: 'Subindo aprovadas…' },
};

// Barrinha de progresso reutilizável (modal + bandeja de tarefas).
function ProgressBar({ pct, label, tone = 'run', compact = false }) {
  const fill = tone === 'err' ? '#c0392b' : tone === 'warn' ? 'var(--tk-accent)' : tone === 'ok' ? '#1a7a4a' : 'var(--tk-primary)';
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 11 : 12, color: 'var(--tk-secondary)', marginBottom: 4 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ fontFamily: 'var(--tk-font-mono)', flexShrink: 0, marginLeft: 8 }}>{Math.round(pct)}%</span>
        </div>
      )}
      <div style={{ height: compact ? 5 : 7, borderRadius: 999, background: 'var(--tk-bg-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: fill, borderRadius: 999, transition: 'width .45s ease' }} />
      </div>
    </div>
  );
}

// As 4 vistas que compõem uma galeria completa + helpers de status por carro.
const PHOTO_VIEWS = [
  { id: 'front', label: 'Frente' },
  { id: 'rear', label: 'Traseira' },
  { id: 'side', label: 'Lateral' },
  { id: 'interior', label: 'Interior' },
];
function viewsPresent(views) {
  return PHOTO_VIEWS.filter(pv => (views?.[pv.id] || 0) > 0).length;
}
function missingViews(views) {
  return PHOTO_VIEWS.filter(pv => !((views?.[pv.id] || 0) > 0));
}
// Conta fotos por vista a partir da lista de imagens (client-side).
function countViews(images) {
  const o = { front: 0, rear: 0, side: 0, interior: 0 };
  (images || []).forEach(im => { if (im && o[im.view] !== undefined) o[im.view]++; });
  return o;
}
// 'without' (0 fotos) | 'incomplete' (tem foto, falta vista) | 'complete' (4 vistas)
function carStatus(car) {
  if (!car.photoCount) return 'without';
  return viewsPresent(car.views) >= PHOTO_VIEWS.length ? 'complete' : 'incomplete';
}

// ─── ABA: CATÁLOGO NO SUPABASE ────────────────────────────────
// Lista tudo que está cadastrado no cache de imagens (car_images_cache),
// agrupado por marca → modelo → versões (ano). Mostra quem tem foto completa,
// incompleta (falta alguma vista) ou nenhuma.
function SupabaseCatalogTab() {
  const [state, setState] = useState({ loading: true, error: null, cars: [] });
  const [query, setQuery] = useState('');
  const [photoFilter, setPhotoFilter] = useState('all'); // 'all' | 'complete' | 'incomplete' | 'without'
  const [expanded, setExpanded] = useState({}); // { [marca]: true }
  const [selected, setSelected] = useState(null); // carro aberto no modal de fotos
  // Tarefas de busca com IA em segundo plano. Vivem AQUI (acima do modal) pra
  // sobreviver ao fechar do modal — o usuário acompanha pela bandeja.
  const [tasks, setTasks] = useState([]);
  const esRef = React.useRef({}); // id da tarefa → EventSource aberto

  // Fecha todos os streams ao desmontar (troca de aba/tela).
  useEffect(() => () => {
    Object.values(esRef.current).forEach(es => { try { es.close(); } catch {} });
    esRef.current = {};
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, cars: [] });
    fetch(`${API_BASE}/api/supabase/cars`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.ok) throw new Error(j.reason || 'Falha ao carregar catálogo');
        setState({ loading: false, error: null, cars: j.cars || [] });
      })
      .catch(e => { if (!cancelled) setState({ loading: false, error: e.message, cars: [] }); });
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();

  // Agrupa: marca → modelo → [versões]. Aplica o filtro de busca por marca/modelo.
  const grouped = useMemo(() => {
    const brands = {};
    for (const car of state.cars) {
      if (q && !`${car.marca} ${car.modelo}`.toLowerCase().includes(q)) continue;
      if (photoFilter !== 'all' && carStatus(car) !== photoFilter) continue;
      const marca = car.marca || '—';
      const modelo = car.modelo || '—';
      if (!brands[marca]) brands[marca] = {};
      if (!brands[marca][modelo]) brands[marca][modelo] = [];
      brands[marca][modelo].push(car);
    }
    return Object.entries(brands)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([marca, models]) => {
        const modelList = Object.entries(models)
          .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
          .map(([modelo, versions]) => ({
            modelo,
            versions: versions.slice().sort((a, b) => (a.ano || 0) - (b.ano || 0)),
          }));
        const cars = modelList.reduce((n, m) => n + m.versions.length, 0);
        const complete = modelList.reduce((n, m) => n + m.versions.filter(v => carStatus(v) === 'complete').length, 0);
        return { marca, models: modelList, cars, complete };
      });
  }, [state.cars, q, photoFilter]);

  // Estatísticas globais (sobre o total, não sobre o filtro).
  const stats = useMemo(() => {
    let complete = 0, incomplete = 0, without = 0;
    for (const c of state.cars) {
      const s = carStatus(c);
      if (s === 'complete') complete++;
      else if (s === 'incomplete') incomplete++;
      else without++;
    }
    const brands = new Set(state.cars.map(c => c.marca)).size;
    return { total: state.cars.length, complete, incomplete, without, brands };
  }, [state.cars]);

  // Busca ou filtro de foto ativo → marcas começam abertas (mas dá pra fechar
  // cada uma). Sem filtro → começam fechadas. `expanded` guarda só os overrides
  // manuais do usuário; ao mudar busca/filtro, zeramos pra valer o novo default.
  const defaultOpen = !!q || photoFilter !== 'all';
  useEffect(() => { setExpanded({}); }, [q, photoFilter]);

  function toggleBrand(marca) {
    setExpanded(e => {
      const cur = marca in e ? e[marca] : defaultOpen;
      return { ...e, [marca]: !cur };
    });
  }

  // Atualiza um carro na lista depois de buscar/inserir foto, pra o chip refletir
  // o novo total na hora (e sair do filtro "sem foto", se for o caso).
  function updateCar(key, patch) {
    setState(s => ({ ...s, cars: s.cars.map(c => c.key === key ? { ...c, ...patch } : c) }));
    setSelected(sel => sel && sel.key === key ? { ...sel, ...patch } : sel);
  }

  // Dispara uma busca com IA em segundo plano via SSE. A tarefa aparece na
  // bandeja e progride sozinha; o modal pode ser fechado sem interromper.
  function startPhotoTask(car, scope) {
    const key = car.key;
    // Um carro por vez: se já há tarefa rodando pra ele, ignora o clique.
    if (tasks.some(t => t.key === key && t.status === 'running')) return;
    const id = `${key}:${Date.now()}`;
    const title = `${car.marca} ${car.modelo} · ${car.ano}`;
    // Substitui qualquer resultado antigo do MESMO carro (mantém 1 cartão por carro).
    setTasks(ts => [
      ...ts.filter(t => t.key !== key),
      { id, key, title, scope, stage: 'queue', pct: AI_STAGES.queue.pct, status: 'running', msg: null },
    ]);

    const params = new URLSearchParams({ marca: car.marca, modelo: car.modelo, ano: car.ano, scope });
    const es = new EventSource(`${API_BASE}/api/supabase/cars/fetch-ai-stream?${params}`);
    esRef.current[id] = es;
    const cleanup = () => { try { es.close(); } catch {} delete esRef.current[id]; };

    es.addEventListener('progress', (e) => {
      try {
        const { stage } = JSON.parse(e.data);
        const ui = AI_STAGES[stage];
        if (ui) setTasks(ts => ts.map(t => t.id === id ? { ...t, stage, pct: ui.pct } : t));
      } catch {}
    });
    es.addEventListener('done', (e) => {
      cleanup();
      let j = {}; try { j = JSON.parse(e.data); } catch {}
      const added = j.added != null ? j.added : j.photoCount;
      const gotSomething = scope === 'full' ? j.photoCount > 0 : added > 0;
      const msg = gotSomething
        ? { tone: 'ok', text: scope === 'full'
            ? `Refeito: ${j.photoCount} foto${j.photoCount !== 1 ? 's' : ''} validada${j.photoCount !== 1 ? 's' : ''}.`
            : `Completou (+${added}). Total ${j.photoCount}.` }
        : { tone: 'warn', text: 'Não achou foto boa o suficiente. Tente inserir manualmente.' };
      setTasks(ts => ts.map(t => t.id === id ? { ...t, status: gotSomething ? 'done' : 'warn', pct: 100, msg } : t));
      updateCar(key, { photoCount: j.photoCount, views: j.views, validated: j.validated });
    });
    es.addEventListener('error', (e) => {
      // Evento nomeado do servidor traz .data; erro de conexão nativo não.
      let text = 'Conexão perdida com o servidor.';
      if (e && e.data) { try { text = JSON.parse(e.data).reason || text; } catch {} }
      cleanup();
      // Só marca erro se a tarefa ainda estava rodando (não sobrescreve um 'done').
      setTasks(ts => ts.map(t => (t.id === id && t.status === 'running')
        ? { ...t, status: 'error', msg: { tone: 'err', text } } : t));
    });
  }

  function dismissTask(id) {
    const es = esRef.current[id];
    if (es) { try { es.close(); } catch {} delete esRef.current[id]; }
    setTasks(ts => ts.filter(t => t.id !== id));
  }

  if (state.loading) {
    return <div className="tk-help" style={{ padding: '28px 4px' }}>Carregando catálogo do Supabase…</div>;
  }

  if (state.error) {
    return (
      <div className="tk-help" style={{ padding: '20px 4px', maxWidth: 620 }}>
        <div style={{ color: 'var(--tk-accent)', fontWeight: 600, marginBottom: 6 }}>Catálogo indisponível</div>
        <div><strong>Detalhe:</strong> {state.error}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          Confirme que a tabela <code>car_images_cache</code> existe no Supabase e que o backend
          tem <code>SUPABASE_URL</code>/<code>SUPABASE_SERVICE_KEY</code> no <code>.env</code>.
        </div>
      </div>
    );
  }

  // Pill de resumo. Se receber `filter`, vira botão que liga/desliga aquele
  // filtro de foto (clicar de novo volta pra "todos"). O pill ativo fica destacado.
  const badge = (label, value, filter) => {
    const active = filter && photoFilter === filter;
    const clickable = !!filter;
    return (
      <button
        type="button"
        className="tk-results__pill"
        onClick={clickable ? () => setPhotoFilter(f => f === filter ? 'all' : filter) : undefined}
        style={{
          border: 'none',
          cursor: clickable ? 'pointer' : 'default',
          background: active ? 'var(--tk-primary)' : 'var(--tk-bg-2)',
          color: active ? '#fff' : 'var(--tk-ink)',
          opacity: clickable ? 1 : 0.85,
        }}>
        {value} {label}
      </button>
    );
  };

  return (
    <div>
      {/* Resumo — pills de status filtram ao clicar; "carros" reseta */}
      <div className="tk-results__pills" style={{ marginTop: 0, marginBottom: 18 }}>
        {badge('carros', stats.total, 'all')}
        {badge('marcas', stats.brands)}
        {badge('completos', stats.complete, 'complete')}
        {badge('incompletos', stats.incomplete, 'incomplete')}
        {badge('sem foto', stats.without, 'without')}
      </div>

      {/* Busca */}
      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 18 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--tk-muted)', display: 'flex', pointerEvents: 'none' }}>
          <Icon.Search />
        </span>
        <input
          type="text"
          className="tk-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }}
          placeholder="Filtrar por marca ou modelo…"
          style={{ paddingLeft: 38, paddingRight: query ? 34 : 14 }}
        />
        {query && (
          <button onClick={() => setQuery('')} title="Limpar filtro"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--tk-bg-3)', color: 'var(--tk-ink)', cursor: 'pointer', fontSize: 15, lineHeight: 1, display: 'grid', placeItems: 'center' }}>×</button>
        )}
      </div>

      {grouped.length === 0 ? (
        <div className="tk-help" style={{ padding: '28px 4px' }}>
          {state.cars.length === 0
            ? 'Nenhum carro cadastrado no Supabase ainda.'
            : q
            ? <>Nenhuma marca/modelo corresponde a “<strong>{query.trim()}</strong>”.</>
            : photoFilter === 'complete'
            ? 'Nenhum carro com a galeria completa ainda.'
            : photoFilter === 'incomplete'
            ? 'Nenhum carro incompleto. 🎉'
            : photoFilter === 'without'
            ? 'Todos os carros têm ao menos uma foto. 🎉'
            : 'Nenhum carro encontrado.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grouped.map(brand => {
            const open = brand.marca in expanded ? expanded[brand.marca] : defaultOpen;
            return (
              <div key={brand.marca} style={{ border: '1px solid var(--tk-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--tk-bg)' }}>
                {/* Cabeçalho da marca */}
                <button onClick={() => toggleBrand(brand.marca)}
                  style={{
                    width: '100%', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
                    padding: '14px 16px', border: 'none', background: 'var(--tk-bg-2)', cursor: 'pointer',
                    font: 'inherit', color: 'var(--tk-ink)', textAlign: 'left',
                  }}>
                  <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--tk-muted)' }}>
                    <Icon.ChevronRight />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>{brand.marca}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--tk-font-mono)', fontSize: 11, color: 'var(--tk-muted)' }}>
                    {brand.models.length} modelo{brand.models.length !== 1 ? 's' : ''} · {brand.cars} carro{brand.cars !== 1 ? 's' : ''}
                    <span style={{ color: brand.complete === brand.cars ? '#1a7a4a' : 'var(--tk-muted)' }}>· {brand.complete}/{brand.cars} completos</span>
                  </span>
                </button>

                {/* Modelos + versões */}
                {open && (
                  <div style={{ padding: '6px 16px 12px 44px' }}>
                    {brand.models.map(m => (
                      <div key={m.modelo} style={{ padding: '10px 0', borderBottom: '1px solid var(--tk-line)' }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: 'var(--tk-ink)' }}>{m.modelo}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {m.versions.map(v => {
                            const status = carStatus(v);
                            const miss = missingViews(v.views);
                            const dot = status === 'complete' ? '#1a7a4a' : status === 'incomplete' ? '#c98a1a' : 'var(--tk-line-2)';
                            const text = status === 'without'
                              ? 'sem foto'
                              : status === 'complete'
                              ? `${v.photoCount} fotos · completo`
                              : `${v.photoCount} foto${v.photoCount !== 1 ? 's' : ''} · falta ${miss.length === 1 ? miss[0].label.toLowerCase() : miss.length + ' vistas'}`;
                            const title = status === 'complete'
                              ? 'Galeria completa (frente, traseira, lateral, interior)'
                              : status === 'incomplete'
                              ? 'Falta: ' + miss.map(m2 => m2.label).join(', ')
                              : 'Sem nenhuma foto';
                            return (
                              <button key={v.key} onClick={() => setSelected(v)} title={title}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 6,
                                  padding: '4px 10px', borderRadius: 999, fontSize: 12,
                                  border: '1px solid var(--tk-line-2)', cursor: 'pointer',
                                  background: v.photoCount > 0 ? 'var(--tk-bg-2)' : 'transparent',
                                  color: 'var(--tk-ink)', opacity: v.expired ? 0.55 : 1,
                                  fontFamily: 'var(--tk-font)',
                                }}>
                                <span style={{ fontFamily: 'var(--tk-font-mono)', fontWeight: 600 }}>{v.ano}</span>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
                                <span style={{ color: 'var(--tk-muted)', fontSize: 11 }}>{text}</span>
                                <Icon.Camera width={13} height={13} style={{ color: 'var(--tk-muted)', marginLeft: 1 }} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <CarPhotoModal
          car={selected}
          onClose={() => setSelected(null)}
          onUpdated={updateCar}
          task={tasks.find(t => t.key === selected.key) || null}
          onStartTask={(scope) => startPhotoTask(selected, scope)}
        />
      )}

      <TaskTray
        tasks={tasks}
        onDismiss={dismissTask}
        onOpen={(key) => setSelected(state.cars.find(c => c.key === key) || null)}
      />
    </div>
  );
}

// ─── CONFIRMAÇÃO (no estilo do projeto, não o confirm() do browser) ──────
function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ReactDOM.createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 1000000,
      background: 'rgba(10,10,25,0.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--tk-bg)', borderRadius: 16, width: '100%', maxWidth: 400,
        boxShadow: '0 40px 120px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 22px' }}>
          {title && <div style={{ fontFamily: 'var(--tk-font)', fontWeight: 700, fontSize: 17, color: 'var(--tk-ink)', marginBottom: 6 }}>{title}</div>}
          <div style={{ fontSize: 14, color: 'var(--tk-secondary)', lineHeight: 1.5 }}>{message}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '0 22px 20px' }}>
          <button className="tk-btn tk-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className="tk-btn tk-btn-primary" onClick={onConfirm}
            style={danger ? { background: '#c0392b', borderColor: '#c0392b', color: '#fff' } : undefined}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── BANDEJA DE TAREFAS (canto superior direito) ──────────────
// Mostra as buscas com IA rodando em segundo plano. O usuário pode fechar o
// modal e continuar mexendo; cada tarefa guarda o desfecho (ok / não achou foto
// boa / erro) pra ele ler depois e decidir. Clicar numa tarefa reabre o carro.
function TaskTray({ tasks, onDismiss, onOpen }) {
  if (!tasks || tasks.length === 0) return null;
  const running = tasks.filter(t => t.status === 'running').length;
  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 1000001,
      width: 320, maxWidth: 'calc(100vw - 32px)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {tasks.map(t => {
        const done = t.status !== 'running';
        const tone = t.status === 'error' ? 'err' : t.status === 'warn' ? 'warn' : t.status === 'done' ? 'ok' : 'run';
        const ui = AI_STAGES[t.stage] || { label: 'Trabalhando…' };
        return (
          <div key={t.id} style={{
            background: 'var(--tk-bg)', border: '1px solid var(--tk-line)', borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)', padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: done ? 4 : 8 }}>
              <button onClick={() => onOpen(t.key)} title="Abrir este carro"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 10, color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t.scope === 'full' ? 'varredura completa' : 'completar vistas'}
                </div>
              </button>
              {done && (
                <button onClick={() => onDismiss(t.id)} aria-label="Dispensar"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-muted)', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
              )}
            </div>
            {done
              ? <div style={{ fontSize: 12.5, fontWeight: 500, color: tone === 'err' ? '#c0392b' : tone === 'warn' ? 'var(--tk-accent)' : '#1a7a4a' }}>{t.msg?.text || (t.status === 'done' ? 'Concluído.' : '')}</div>
              : <ProgressBar pct={t.pct} label={ui.label} tone="run" compact />}
          </div>
        );
      })}
      {running > 0 && (
        <div style={{ fontSize: 10, color: 'var(--tk-muted)', textAlign: 'right', paddingRight: 4 }}>
          {running} tarefa{running !== 1 ? 's' : ''} em andamento
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── MODAL: FOTOS DE UM CARRO ─────────────────────────────────
// Por carro: buscar com IA (completa OU só as vistas que faltam), inserir foto
// manual por vista, e remover foto específica. Mostra a galeria atual agrupada
// por vista com botão de excluir em cada foto.
function CarPhotoModal({ car, onClose, onUpdated, task, onStartTask }) {
  const [busy, setBusy] = useState(null); // 'upload' | 'delete' | null (a IA roda como tarefa em segundo plano)
  const [msg, setMsg] = useState(null);   // { tone: 'ok'|'warn'|'err', text }
  const [view, setView] = useState('front'); // vista da foto no upload manual
  const [aiChoosing, setAiChoosing] = useState(false); // mostrando escopo da IA?
  const [photos, setPhotos] = useState(null); // null = carregando; array = carregado
  const [confirm, setConfirm] = useState(null); // diálogo de confirmação pendente
  const fileRef = React.useRef(null);

  const post = (path, body) => fetch(`${API_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marca: car.marca, modelo: car.modelo, ano: car.ano, ...body }),
  }).then(async r => { const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.reason || `HTTP ${r.status}`); return j; });

  async function loadPhotos() {
    try { const j = await post('/api/supabase/cars/photos'); setPhotos(j.images || []); }
    catch { setPhotos([]); }
  }
  useEffect(() => { loadPhotos(); }, [car.key]);

  // Quando a tarefa de IA deste carro termina (com o modal aberto), recarrega a
  // galeria pra mostrar as fotos novas na hora.
  const taskStatus = task?.status;
  useEffect(() => {
    if (taskStatus && taskStatus !== 'running') loadPhotos();
  }, [taskStatus]);
  const aiRunning = taskStatus === 'running';
  const anyBusy = !!busy || aiRunning;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy]);

  // Contagens ao vivo: a partir das fotos carregadas (fonte da verdade após
  // qualquer mutação); cai pro que veio na lista enquanto carrega.
  const liveViews = photos ? countViews(photos) : (car.views || {});
  const missCount = missingViews(liveViews).length;

  // Dispara a busca como tarefa em segundo plano (roda na bandeja; o modal pode
  // ser fechado). O progresso e o desfecho vêm pela prop `task`.
  function runAI(scope) {
    setAiChoosing(false); setMsg(null);
    if (scope === 'full') {
      setConfirm({
        title: 'Varredura completa',
        message: 'Isso apaga TODAS as fotos atuais deste carro (inclusive as inseridas manualmente) e refaz a busca do zero. Deseja continuar?',
        confirmLabel: 'Apagar e refazer',
        danger: true,
        onConfirm: () => onStartTask('full'),
      });
      return;
    }
    onStartTask('missing');
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('não consegui ler ' + file.name));
      fr.readAsDataURL(file);
    });
  }

  async function onFilesChosen(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy('upload'); setMsg(null);
    try {
      const images = await Promise.all(files.map(readAsDataUrl));
      const j = await post('/api/supabase/cars/manual-photos', { images, view });
      onUpdated(car.key, { photoCount: j.photoCount, views: j.views, validated: j.validated });
      await loadPhotos();
      const viewLabel = (PHOTO_VIEWS.find(pv => pv.id === view) || {}).label || view;
      setMsg({ tone: 'ok', text: `${j.added} foto${j.added !== 1 ? 's' : ''} de ${viewLabel.toLowerCase()} adicionada${j.added !== 1 ? 's' : ''} (total ${j.photoCount}).` });
    } catch (e) {
      setMsg({ tone: 'err', text: 'Falha no upload: ' + e.message });
    } finally { setBusy(null); }
  }

  function deletePhoto(url) {
    setConfirm({
      message: 'Excluir esta foto?',
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: () => doDeletePhoto(url),
    });
  }

  async function doDeletePhoto(url) {
    setBusy('delete'); setMsg(null);
    try {
      const j = await post('/api/supabase/cars/delete-photo', { url });
      onUpdated(car.key, { photoCount: j.photoCount, views: j.views, validated: j.validated });
      setPhotos(j.images || []);
      setMsg({ tone: 'ok', text: 'Foto removida.' });
    } catch (e) {
      setMsg({ tone: 'err', text: 'Falha ao remover: ' + e.message });
    } finally { setBusy(null); }
  }

  // Favoritar/desfavoritar: foto com estrela não é apagada na varredura completa.
  // Atualização otimista da galeria; reverte se o backend falhar.
  async function toggleFavorite(url, favorite) {
    setPhotos(ps => (ps || []).map(p => p.url === url ? { ...p, favorite } : p));
    try {
      const j = await post('/api/supabase/cars/favorite-photo', { url, favorite });
      setPhotos(j.images || []);
    } catch (e) {
      setPhotos(ps => (ps || []).map(p => p.url === url ? { ...p, favorite: !favorite } : p));
      setMsg({ tone: 'err', text: 'Falha ao favoritar: ' + e.message });
    }
  }

  const toneColor = { ok: '#1a7a4a', warn: 'var(--tk-accent)', err: '#c0392b' };

  return (
    <>
    {ReactDOM.createPortal(
    <div onClick={() => { if (!busy) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(10,10,25,0.55)', backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--tk-bg)', borderRadius: 16, width: '100%', maxWidth: 480,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 40px 120px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--tk-line)', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--tk-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
              {car.marca} · {car.ano}
            </div>
            <div style={{ fontFamily: 'var(--tk-font)', fontWeight: 700, fontSize: 17, color: 'var(--tk-ink)', lineHeight: 1.2 }}>{car.modelo}</div>
            {(() => {
              const liveCount = photos ? photos.length : car.photoCount;
              const status = !liveCount ? 'without' : (missingViews(liveViews).length === 0 ? 'complete' : 'incomplete');
              const miss = missingViews(liveViews);
              const color = status === 'complete' ? '#1a7a4a' : status === 'incomplete' ? '#c98a1a' : 'var(--tk-muted)';
              const text = status === 'without'
                ? 'sem foto no momento'
                : status === 'complete'
                ? `galeria completa · ${liveCount} foto${liveCount !== 1 ? 's' : ''}`
                : `${liveCount} foto${liveCount !== 1 ? 's' : ''} · falta ${miss.map(m => m.label.toLowerCase()).join(', ')}`;
              return <div style={{ marginTop: 4, fontSize: 12, color }}>{text}</div>;
            })()}
          </div>
          <button onClick={() => { if (!busy) onClose(); }} aria-label="Fechar"
            style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', border: 'none', background: 'var(--tk-bg-2)', color: 'var(--tk-ink)', fontSize: 20, cursor: busy ? 'not-allowed' : 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Corpo rolável */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {/* Buscar com IA — escolhe escopo */}
          {aiRunning ? (
            <div style={{ padding: '12px 14px', border: '1px solid var(--tk-line)', borderRadius: 10, background: 'var(--tk-bg-2)' }}>
              <ProgressBar pct={task.pct} label={(AI_STAGES[task.stage] || {}).label || 'Trabalhando…'} tone="run" />
              <div className="tk-help" style={{ fontSize: 11, marginTop: 8 }}>
                Pode fechar — a busca continua na bandeja do canto.
              </div>
            </div>
          ) : !aiChoosing ? (
            <button onClick={() => setAiChoosing(true)} disabled={!!busy}
              className="tk-btn tk-btn-primary"
              style={{ justifyContent: 'center', width: '100%', opacity: !!busy ? 0.5 : 1 }}>
              <Icon.Sparkle /> Buscar com IA
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--tk-line)', borderRadius: 10, background: 'var(--tk-bg-2)' }}>
              <div className="tk-help" style={{ fontSize: 11 }}>Como você quer buscar?</div>
              <button onClick={() => runAI('missing')} disabled={missCount === 0}
                className="tk-btn tk-btn-primary"
                style={{ justifyContent: 'center', width: '100%', opacity: missCount === 0 ? 0.5 : 1 }}>
                <Icon.Sparkle /> Só as vistas que faltam{missCount > 0 ? ` (${missCount})` : ''}
              </button>
              <button onClick={() => runAI('full')}
                className="tk-btn tk-btn-ghost"
                style={{ justifyContent: 'center', width: '100%', color: 'var(--tk-accent)', borderColor: 'var(--tk-accent)' }}>
                <Icon.Sparkle /> Varredura completa (apaga tudo e refaz)
              </button>
              <button onClick={() => setAiChoosing(false)} className="tk-help"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 2 }}>Cancelar</button>
            </div>
          )}

          <div style={{ height: 1, background: 'var(--tk-line)', margin: '2px 0' }} />

          {/* Upload manual por vista */}
          <div>
            <div className="tk-help" style={{ fontSize: 11, marginBottom: 6 }}>Qual vista você vai subir?</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PHOTO_VIEWS.map(pv => {
                const n = liveViews?.[pv.id] || 0;
                return (
                  <button key={pv.id}
                    className={`tk-chip ${view === pv.id ? 'is-active' : ''}`}
                    onClick={() => setView(pv.id)} disabled={anyBusy}
                    style={{ opacity: anyBusy ? 0.5 : 1 }}>
                    {pv.label}
                    <span style={{
                      marginLeft: 6, fontFamily: 'var(--tk-font-mono)', fontSize: 10, fontWeight: 700,
                      color: view === pv.id ? 'inherit' : (n > 0 ? '#1a7a4a' : '#c98a1a'),
                    }}>{n > 0 ? n : '0'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={anyBusy}
            className="tk-btn tk-btn-ghost"
            style={{ justifyContent: 'center', width: '100%', opacity: anyBusy && busy !== 'upload' ? 0.5 : 1 }}>
            {busy === 'upload' ? 'Enviando…' : <><Icon.Upload /> Inserir foto de {(PHOTO_VIEWS.find(pv => pv.id === view) || {}).label?.toLowerCase()}</>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFilesChosen} style={{ display: 'none' }} />

          {(() => {
            // Prioriza a mensagem local (upload/delete); senão, o desfecho da
            // última tarefa de IA deste carro (some enquanto ela ainda roda).
            const shown = msg || (task && task.status !== 'running' ? task.msg : null);
            return shown ? (
              <div style={{ fontSize: 13, fontWeight: 500, color: toneColor[shown.tone] }}>{shown.text}</div>
            ) : null;
          })()}

          {/* Galeria atual, por vista, com excluir */}
          <div style={{ height: 1, background: 'var(--tk-line)', margin: '2px 0' }} />
          <div className="tk-help" style={{ fontSize: 11 }}>Fotos atuais {photos ? `(${photos.length})` : ''}</div>
          {photos === null ? (
            <div className="tk-help" style={{ fontSize: 12 }}>Carregando fotos…</div>
          ) : photos.length === 0 ? (
            <div className="tk-help" style={{ fontSize: 12 }}>Nenhuma foto ainda.</div>
          ) : (
            PHOTO_VIEWS.filter(pv => photos.some(p => p.view === pv.id)).map(pv => (
              <div key={pv.id}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tk-muted)', margin: '4px 0' }}>{pv.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {photos.filter(p => p.view === pv.id).map(p => (
                    <div key={p.url} style={{ position: 'relative', width: 74, height: 56, borderRadius: 8, overflow: 'hidden', border: p.favorite ? '2px solid #f5b301' : '1px solid var(--tk-line)' }}>
                      <img src={p.url} alt={pv.label} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      {p.manual && <span title="Inserida manualmente" style={{ position: 'absolute', left: 3, top: 3, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', letterSpacing: '0.04em' }}>MANUAL</span>}
                      <button onClick={() => toggleFavorite(p.url, !p.favorite)} disabled={!!busy}
                        title={p.favorite ? 'Favorita — protegida da varredura completa' : 'Favoritar (protege da varredura completa)'}
                        style={{ position: 'absolute', right: 27, top: 3, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: p.favorite ? '#f5b301' : 'rgba(255,255,255,0.7)', cursor: busy ? 'not-allowed' : 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
                        <Icon.Star width={11} height={11} />
                      </button>
                      <button onClick={() => deletePhoto(p.url)} disabled={!!busy} title="Excluir esta foto"
                        style={{ position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'rgba(192,57,43,0.92)', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
                        <Icon.Trash width={11} height={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
    )}
    {confirm && (
      <ConfirmDialog
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger={confirm.danger}
        onConfirm={() => { const fn = confirm.onConfirm; setConfirm(null); if (fn) fn(); }}
        onCancel={() => setConfirm(null)}
      />
    )}
    </>
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
  const [expanded, setExpanded] = useState({}); // overrides manuais de abrir/fechar por cliente

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

  // Agrupa por nome de cliente (mesmo esquema de Ajustes: card colapsável por
  // grupo). As consultas já chegam ordenadas por data desc da API; os grupos
  // são ordenados pela consulta mais recente de cada cliente.
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of filtered) {
      const name = (c.client_name || '').trim() || 'Sem nome';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(c);
    }
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        items,
        count: items.length,
        latest: items.reduce((m, c) => (c.created_at > m ? c.created_at : m), items[0].created_at),
        total: items.reduce((n, c) => n + (c.total_resultados || 0), 0),
      }))
      .sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
  }, [filtered]);

  // Buscando → grupos abrem por padrão. Sem busca → começam fechados. `expanded`
  // guarda só os overrides manuais; ao mudar a busca, zeramos pro novo default.
  const defaultOpen = !!q;
  useEffect(() => { setExpanded({}); }, [q]);
  function toggleGroup(name) {
    setExpanded(e => {
      const cur = name in e ? e[name] : defaultOpen;
      return { ...e, [name]: !cur };
    });
  }

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
          {groups.map(g => {
            const open = g.name in expanded ? expanded[g.name] : defaultOpen;
            return (
              <div key={g.name} style={{ border: '1px solid var(--tk-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--tk-bg)' }}>
                {/* Cabeçalho do cliente */}
                <button onClick={() => toggleGroup(g.name)}
                  style={{
                    width: '100%', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
                    padding: '14px 16px', border: 'none', background: 'var(--tk-bg-2)', cursor: 'pointer',
                    font: 'inherit', color: 'var(--tk-ink)', textAlign: 'left',
                  }}>
                  <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--tk-muted)' }}>
                    <Icon.ChevronRight />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>{g.name}</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--tk-font-mono)', fontSize: 11, color: 'var(--tk-muted)' }}>
                    {g.count} consulta{g.count !== 1 ? 's' : ''}
                    <span style={{ opacity: 0.4 }}>·</span>
                    <span>última {fmtDate(g.latest)}</span>
                  </span>
                </button>

                {/* Consultas do cliente */}
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 16px 14px' }}>
                    {g.items.map(c => (
                      <button key={c.id} onClick={() => onOpen(c.id)} className="tk-hist-row"
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
                          textAlign: 'left', padding: '15px 18px', borderRadius: 12,
                          border: '1px solid var(--tk-line)', background: 'var(--tk-bg)', cursor: 'pointer',
                          fontFamily: 'var(--tk-font)', color: 'var(--tk-ink)',
                        }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--tk-font-mono)', fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em', color: 'var(--tk-ink)' }}>{fmtDate(c.created_at)}</span>
                            {c.client_segment && <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--tk-secondary)' }}>{c.client_segment}</span>}
                            {!c.ok && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#c0392b', textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid currentColor', borderRadius: 4, padding: '1px 5px' }}>sem resultado</span>}
                          </div>
                          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontFamily: 'var(--tk-font-mono)', fontSize: 11, color: 'var(--tk-muted)', letterSpacing: '0.01em' }}>
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
          })}
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

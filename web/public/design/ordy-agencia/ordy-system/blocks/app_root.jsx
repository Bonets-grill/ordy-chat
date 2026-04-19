const { useState, useEffect } = React;

const App = () => {
  const AppContext = window.AppContext;
  const { Landing, Signup, Dashboard, Builder, NewAgentModal, TweaksPanel } = window;
  // Persistent nav state
  const [route, setRoute] = useState(() => localStorage.getItem('ordy_route') || 'landing');
  const [signupData, setSignupData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ordy_signup') || 'null'); } catch { return null; }
  });
  const [activeAgent, setActiveAgent] = useState(() => localStorage.getItem('ordy_agent') || null);
  const [newAgentOpen, setNewAgentOpen] = useState(false);

  // Tweakable state
  const [lang, setLang]       = useState(TWEAK_DEFAULTS.lang);
  const [theme, setTheme]     = useState(TWEAK_DEFAULTS.theme);
  const [accentH, setAccentH] = useState(TWEAK_DEFAULTS.accentH);
  const [density, setDensity] = useState(TWEAK_DEFAULTS.density);
  const [landingVariant, setLandingVariant] = useState(TWEAK_DEFAULTS.landingVariant);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.setProperty('--accent-h', String(accentH));
    document.documentElement.style.setProperty('--density', density === 'compact' ? '0.82' : '1');
  }, [theme, accentH, density]);

  useEffect(() => { localStorage.setItem('ordy_route', route); }, [route]);
  useEffect(() => { if (signupData) localStorage.setItem('ordy_signup', JSON.stringify(signupData)); }, [signupData]);
  useEffect(() => { if (activeAgent) localStorage.setItem('ordy_agent', activeAgent); }, [activeAgent]);

  // Edit-mode host protocol
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === '__activate_edit_mode') setEditMode(true);
      if (d.type === '__deactivate_edit_mode') setEditMode(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const appCtx = {
    lang, theme, accentH, density, landingVariant, editMode,
    set: (patch) => {
      if ('lang' in patch) setLang(patch.lang);
      if ('theme' in patch) setTheme(patch.theme);
      if ('accentH' in patch) setAccentH(patch.accentH);
      if ('density' in patch) setDensity(patch.density);
      if ('landingVariant' in patch) setLandingVariant(patch.landingVariant);
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
    },
  };

  const navigate = (to) => {
    setRoute(to);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const onOpenAgent = (id) => {
    if (id === 'new') {
      setNewAgentOpen(true);
    } else {
      setActiveAgent(id);
      navigate('builder');
    }
  };

  const onCreateAgent = ({ name, template }) => {
    setActiveAgent('new_' + Date.now());
    setNewAgentOpen(false);
    navigate('builder');
  };

  return (
    <AppContext.Provider value={appCtx}>
      {route === 'landing'   && <Landing onNav={navigate} />}
      {route === 'signup'    && <Signup onNav={navigate} onComplete={(d) => { setSignupData(d); navigate('dashboard'); }} />}
      {route === 'dashboard' && <Dashboard onNav={navigate} signupData={signupData} onOpenAgent={onOpenAgent} />}
      {route === 'builder'   && <Builder onNav={navigate} agentId={activeAgent} agentName={activeAgent && activeAgent.startsWith('new_') ? null : undefined} />}

      {newAgentOpen && <NewAgentModal onClose={() => setNewAgentOpen(false)} onCreate={onCreateAgent} />}

      {/* Floating route jumper (always visible — helps user move around the prototype) */}
      <div style={{
        position: 'fixed', bottom: 20, left: 20, zIndex: 80,
        background: 'var(--bg-card)',
        border: '1px solid var(--line-strong)',
        borderRadius: 999,
        padding: 4,
        display: 'inline-flex', gap: 2,
        boxShadow: 'var(--shadow)',
        fontSize: 11,
      }}>
        {[
          { k: 'landing',   l: lang === 'es' ? 'Landing'   : 'Landing' },
          { k: 'signup',    l: lang === 'es' ? 'Signup'    : 'Signup' },
          { k: 'dashboard', l: lang === 'es' ? 'Dashboard' : 'Dashboard' },
          { k: 'builder',   l: lang === 'es' ? 'Builder'   : 'Builder' },
        ].map(r => (
          <button key={r.k}
            onClick={() => { if (r.k === 'builder' && !activeAgent) setActiveAgent('ag_01'); navigate(r.k); }}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              background: route === r.k ? 'var(--ink)' : 'transparent',
              color: route === r.k ? 'var(--bg)' : 'var(--ink-2)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >{r.l}</button>
        ))}
      </div>

      <TweaksPanel />
    </AppContext.Provider>
  );
};

function mount() {
  if (!window.AppContext || !window.Landing || !window.Signup || !window.Dashboard || !window.Builder) {
    return setTimeout(mount, 40);
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}
mount();
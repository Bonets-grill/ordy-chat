/* Ordy-AgencIA — Dashboard */

const SAMPLE_AGENTS = [
  { id: 'ag_01', name: 'Lucía', client: 'Moda Verano SL', niche: 'E-commerce', status: 'active',  convos: 2840, csat: 4.9, cost: 142.10, channel: 'WhatsApp', color: 120 },
  { id: 'ag_02', name: 'Dr. Álex', client: 'Clínica Nova',   niche: 'Salud',       status: 'active',  convos: 1204, csat: 4.7, cost: 89.50,  channel: 'Web',       color: 200 },
  { id: 'ag_03', name: 'Iker',    client: 'Bufete Morán',    niche: 'Legal',       status: 'active',  convos: 412,  csat: 4.8, cost: 56.80,  channel: 'Web',       color: 60 },
  { id: 'ag_04', name: 'Marta',   client: 'InmoSur',         niche: 'Inmobiliaria', status: 'active',  convos: 890,  csat: 4.6, cost: 67.30,  channel: 'WhatsApp', color: 25 },
  { id: 'ag_05', name: 'Saba',    client: 'Academia Plural', niche: 'Educación',   status: 'draft',   convos: 0,    csat: 0,   cost: 0,      channel: '—',         color: 320 },
  { id: 'ag_06', name: 'Nora',    client: 'Restaurante Mare',niche: 'Hostelería',  status: 'paused',  convos: 1508, csat: 4.4, cost: 102.40, channel: 'Instagram',  color: 250 },
  { id: 'ag_07', name: 'Ori',     client: 'Envíos Norte',    niche: 'Logística',   status: 'active',  convos: 3200, csat: 4.5, cost: 178.00, channel: 'WhatsApp',  color: 180 },
  { id: 'ag_08', name: 'Eli',     client: 'Fintaxi',         niche: 'Finanzas',    status: 'active',  convos: 680,  csat: 4.9, cost: 91.20,  channel: 'Web',       color: 40 },
];

const Sidebar = ({ active, onNav, signupData }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const items = [
    { k: 'overview', icon: 'grid',    l: t.dash_overview },
    { k: 'agents',   icon: 'bot',     l: t.dash_agents },
    { k: 'clients',  icon: 'folder',  l: t.dash_clients },
    { k: 'analytics',icon: 'chart',   l: t.dash_analytics },
    { k: 'billing',  icon: 'layers',  l: t.dash_billing },
    { k: 'settings', icon: 'settings',l: t.dash_settings },
  ];
  const company = signupData?.company || 'Norte Digital';
  return (
    <aside style={{
      width: 240, background: 'var(--bg-elev)',
      borderRight: '1px solid var(--line)',
      padding: '20px 16px',
      display: 'flex', flexDirection: 'column', gap: 20,
      position: 'sticky', top: 0, height: '100vh',
    }}>
      <div className="row between">
        <Logo size={20} />
      </div>
      <button className="btn" style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--line)',
        justifyContent: 'space-between',
        width: '100%',
        padding: '8px 10px',
      }}>
        <div className="row gap-2">
          <div style={{
            width: 22, height: 22, borderRadius: 5,
            background: 'var(--accent)', color: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontFamily: 'var(--font-display)',
          }}>{company[0]?.toUpperCase()}</div>
          <span style={{ fontSize: 13 }}>{company}</span>
        </div>
        <Icon name="dots" size={14} />
      </button>

      <nav className="col gap-1">
        {items.map(i => (
          <button key={i.k} onClick={() => onNav(i.k)} className="row gap-2" style={{
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 13,
            color: active === i.k ? 'var(--ink)' : 'var(--ink-2)',
            background: active === i.k ? 'var(--bg-card)' : 'transparent',
            border: active === i.k ? '1px solid var(--line)' : '1px solid transparent',
            justifyContent: 'flex-start',
            width: '100%',
          }}>
            <Icon name={i.icon} size={15} />
            {i.l}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="caps" style={{ marginBottom: 8 }}>Trial</div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>11 {app.lang === 'es' ? 'días restantes' : 'days left'}</div>
          <div style={{ height: 4, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '78%', background: 'var(--accent)' }} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontSize: 12, padding: '8px' }}>
            {app.lang === 'es' ? 'Ver planes' : 'View plans'}
          </button>
        </div>
        <button className="row gap-2" onClick={() => onNav('landing')} style={{ padding: '6px 10px', fontSize: 12, color: 'var(--ink-3)', width: '100%', justifyContent: 'flex-start' }}>
          <Icon name="logout" size={14} /> {app.lang === 'es' ? 'Cerrar sesión' : 'Log out'}
        </button>
      </div>
    </aside>
  );
};

const Topbar = ({ signupData }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const name = signupData?.email?.split('@')[0] || 'alex';
  return (
    <header style={{
      padding: '18px 28px',
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg)',
      position: 'sticky', top: 0, zIndex: 5,
    }} className="row between">
      <div className="row gap-2" style={{ background: 'var(--bg-elev)', padding: '8px 14px', borderRadius: 999, border: '1px solid var(--line)', width: 320 }}>
        <Icon name="search" size={14} />
        <input placeholder={t.dash_search} style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, width: '100%' }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line-strong)', padding: '1px 5px', borderRadius: 4 }}>⌘K</span>
      </div>
      <div className="row gap-3">
        <button className="btn btn-ghost" style={{ padding: '8px' }}><Icon name="bell" size={15} /></button>
        <button className="btn btn-ghost" style={{ padding: '8px' }}><Icon name="book" size={15} /></button>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'var(--ink)', color: 'var(--bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 500,
        }}>{name[0]?.toUpperCase()}</div>
      </div>
    </header>
  );
};

const KpiCard = ({ label, value, delta, spark }) => (
  <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div className="caps">{label}</div>
    <div className="row between" style={{ alignItems: 'flex-end' }}>
      <div className="display" style={{ fontSize: 40, lineHeight: 1 }}>{value}</div>
      {spark && (
        <svg width="72" height="28" viewBox="0 0 72 28" style={{ color: 'var(--accent)' }}>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            points={spark}
          />
        </svg>
      )}
    </div>
    <div style={{ fontSize: 12, color: delta > 0 ? 'var(--accent-ink)' : 'var(--ink-3)' }} className="mono">
      {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}% {I18N.es && 'VS. MES ANT.'}
    </div>
  </div>
);

const StatusDot = ({ s }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const colors = { active: 'var(--accent)', draft: 'var(--ink-4)', paused: 'var(--warn)' };
  const labels = { active: t.dash_active, draft: t.dash_draft, paused: t.dash_paused };
  return (
    <div className="row gap-2" style={{ fontSize: 12 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: colors[s], display: 'inline-block' }} />
      <span style={{ color: 'var(--ink-2)' }}>{labels[s]}</span>
    </div>
  );
};

const AgentRow = ({ a, onOpen }) => (
  <tr
    style={{ borderTop: '1px solid var(--line)', cursor: 'pointer', transition: 'background 0.1s' }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elev)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    onClick={onOpen}
  >
    <td style={{ padding: '14px 12px' }}>
      <div className="row gap-3">
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `oklch(0.92 0.06 ${a.color})`,
          color: `oklch(0.35 0.1 ${a.color})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontFamily: 'var(--font-display)',
        }}>{a.name[0]}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }} className="mono">{a.id}</div>
        </div>
      </div>
    </td>
    <td style={{ padding: '14px 12px', fontSize: 13 }}>{a.client}</td>
    <td style={{ padding: '14px 12px' }}><span className="badge">{a.niche}</span></td>
    <td style={{ padding: '14px 12px' }}><StatusDot s={a.status} /></td>
    <td style={{ padding: '14px 12px', fontSize: 13 }} className="mono">{a.convos.toLocaleString()}</td>
    <td style={{ padding: '14px 12px', fontSize: 13 }} className="mono">{a.csat > 0 ? a.csat.toFixed(1) + '★' : '—'}</td>
    <td style={{ padding: '14px 12px', fontSize: 13 }} className="mono">{a.cost.toFixed(2)}€</td>
    <td style={{ padding: '14px 12px', fontSize: 13 }}>{a.channel}</td>
    <td style={{ padding: '14px 12px', textAlign: 'right' }}>
      <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }}>
        <Icon name="arrow_up_right" size={12} />
      </button>
    </td>
  </tr>
);

const Dashboard = ({ onNav, signupData, onOpenAgent }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const [active, setActive] = React.useState('agents');
  const [filter, setFilter] = React.useState('all');
  const name = (signupData?.email?.split('@')[0] || 'alex');
  const filtered = SAMPLE_AGENTS.filter(a => filter === 'all' || a.status === filter);

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar active={active} onNav={(k) => k === 'landing' ? onNav('landing') : setActive(k)} signupData={signupData} />
      <div style={{ flex: 1, minHeight: '100vh' }}>
        <Topbar signupData={signupData} />
        <main style={{ padding: '32px 28px' }}>
          {/* Header row */}
          <div className="row between" style={{ marginBottom: 28 }}>
            <div>
              <h1 className="display" style={{ fontSize: 42, margin: '0 0 6px', fontWeight: 400 }}>
                {t.dash_greeting}<span style={{ fontStyle: 'italic', color: 'var(--accent-ink)' }}>{name.charAt(0).toUpperCase() + name.slice(1)}</span>.
              </h1>
              <p style={{ color: 'var(--ink-3)', margin: 0, fontSize: 14 }}>
                {app.lang === 'es'
                  ? 'Hoy hay 6 agentes activos sirviendo a 4 clientes. Aquí está el resumen.'
                  : 'Today, 6 agents are live serving 4 clients. Here is the rundown.'}
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => onOpenAgent('new')}>
              <Icon name="plus" size={12} /> {t.dash_new_agent}
            </button>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            <KpiCard label={app.lang === 'es' ? 'Conversaciones' : 'Conversations'} value="10,734" delta={23} spark="0,20 10,18 20,14 30,16 40,10 50,8 60,4 72,6" />
            <KpiCard label={app.lang === 'es' ? 'Conversión media' : 'Avg. conversion'} value="34%" delta={8} spark="0,22 10,18 20,16 30,12 40,14 50,8 60,10 72,6" />
            <KpiCard label={app.lang === 'es' ? 'CSAT' : 'CSAT'} value="4.74★" delta={2} spark="0,16 10,14 20,12 30,10 40,12 50,10 60,8 72,6" />
            <KpiCard label={app.lang === 'es' ? 'Coste del mes' : 'Month cost'} value="627€" delta={-12} spark="0,8 10,12 20,14 30,10 40,14 50,16 60,18 72,22" />
          </div>

          {/* Agents table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row between" style={{ padding: '20px 20px 12px' }}>
              <div>
                <h3 className="display" style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>
                  {app.lang === 'es' ? 'Tus agentes' : 'Your agents'}
                </h3>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }} className="mono">
                  {filtered.length} / {SAMPLE_AGENTS.length}
                </div>
              </div>
              <div className="row gap-2">
                <div className="tweaks-seg" style={{ background: 'var(--bg-elev)' }}>
                  {['all', 'active', 'draft', 'paused'].map(f => (
                    <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? (app.lang === 'es' ? 'Todos' : 'All') :
                       f === 'active' ? t.dash_active :
                       f === 'draft' ? t.dash_draft : t.dash_paused}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)', borderTop: '1px solid var(--line)' }}>
                  {['Agente', 'Cliente', 'Nicho', 'Estado', 'Conv.', 'CSAT', 'Coste', 'Canal', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => <AgentRow key={a.id} a={a} onOpen={() => onOpenAgent(a.id)} />)}
              </tbody>
            </table>
          </div>

          {/* Activity + channels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginTop: 28 }}>
            <div className="card" style={{ padding: 20 }}>
              <div className="row between" style={{ marginBottom: 20 }}>
                <h3 className="display" style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>
                  {app.lang === 'es' ? 'Actividad reciente' : 'Recent activity'}
                </h3>
                <span className="caps">Live</span>
              </div>
              <div className="col gap-3">
                {[
                  { n: 'Lucía',  a: 'cerró venta #40281 · 39,90€', t: 'hace 2 min', c: 120 },
                  { n: 'Ori',    a: 'derivó incidencia a soporte humano', t: 'hace 6 min', c: 180 },
                  { n: 'Iker',   a: 'agendó consulta con Bufete Morán', t: 'hace 14 min', c: 60 },
                  { n: 'Dr. Álex', a: 'completó triaje · riesgo bajo', t: 'hace 22 min', c: 200 },
                  { n: 'Marta',  a: 'envió 3 propiedades a un lead', t: 'hace 38 min', c: 25 },
                ].map((ev, i) => (
                  <div key={i} className="row between" style={{ padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                    <div className="row gap-3">
                      <div style={{
                        width: 26, height: 26, borderRadius: 6,
                        background: `oklch(0.92 0.06 ${ev.c})`,
                        color: `oklch(0.35 0.1 ${ev.c})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontFamily: 'var(--font-display)',
                      }}>{ev.n[0]}</div>
                      <div style={{ fontSize: 13 }}><b>{ev.n}</b> <span style={{ color: 'var(--ink-2)' }}>{ev.a}</span></div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }} className="mono">{ev.t}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <h3 className="display" style={{ fontSize: 22, margin: '0 0 20px', fontWeight: 400 }}>
                {app.lang === 'es' ? 'Canales' : 'Channels'}
              </h3>
              {[
                { n: 'WhatsApp',   v: 58 },
                { n: 'Web widget', v: 26 },
                { n: 'Instagram',  v: 9 },
                { n: 'API',        v: 7 },
              ].map(ch => (
                <div key={ch.n} style={{ padding: '10px 0' }}>
                  <div className="row between" style={{ marginBottom: 6, fontSize: 13 }}>
                    <span>{ch.n}</span>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{ch.v}%</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-elev)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${ch.v}%`, background: 'var(--ink)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
window.SAMPLE_AGENTS = SAMPLE_AGENTS;

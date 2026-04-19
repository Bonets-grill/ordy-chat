/* Ordy-AgencIA — Agent Builder */

const TEMPLATES = [
  { id: 'tmpl_ecom',   name: 'E-commerce',   desc: 'Ventas, catálogo, pedidos, devoluciones', icon: 'shop',   color: 25 },
  { id: 'tmpl_health', name: 'Clínica',      desc: 'Citas, triaje, recordatorios',             icon: 'shield', color: 200 },
  { id: 'tmpl_legal',  name: 'Despacho legal',desc: 'Consulta inicial, calificación, derivación', icon: 'book', color: 60 },
  { id: 'tmpl_real',   name: 'Inmobiliaria', desc: 'Captación, visitas, financiación',         icon: 'folder', color: 40 },
  { id: 'tmpl_edu',    name: 'Educación',    desc: 'Matrícula, tutorías, evaluaciones',        icon: 'star',   color: 320 },
  { id: 'tmpl_blank',  name: 'En blanco',    desc: 'Empieza desde cero',                       icon: 'plus',   color: 180 },
];

const NewAgentModal = ({ onClose, onCreate }) => {
  const app = useApp();
  const [sel, setSel] = React.useState('tmpl_ecom');
  const [name, setName] = React.useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.3)',
      backdropFilter: 'blur(4px)',
      zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 40,
    }} onClick={onClose}>
      <div className="card fade-in" style={{ padding: 32, maxWidth: 760, width: '100%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 24 }}>
          <div>
            <h2 className="display" style={{ fontSize: 32, margin: '0 0 4px', fontWeight: 400 }}>
              {app.lang === 'es' ? 'Nuevo agente' : 'New agent'}
            </h2>
            <p style={{ color: 'var(--ink-3)', margin: 0, fontSize: 14 }}>
              {app.lang === 'es' ? 'Parte de una plantilla o empieza en blanco.' : 'Start from a template or blank.'}
            </p>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--ink-3)', padding: 4 }}>×</button>
        </div>
        <label className="label">{app.lang === 'es' ? 'Nombre del agente' : 'Agent name'}</label>
        <input className="input" placeholder={app.lang === 'es' ? 'ej. Lucía, Atención Verano' : 'e.g. Lucia, Summer Support'} value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 20 }} />
        <label className="label">{app.lang === 'es' ? 'Plantilla' : 'Template'}</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => setSel(t.id)} className="card" style={{
              padding: 14, textAlign: 'left',
              border: '1px solid',
              borderColor: sel === t.id ? 'var(--ink)' : 'var(--line)',
              background: sel === t.id ? 'var(--bg-elev)' : 'var(--bg-card)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `oklch(0.92 0.06 ${t.color})`,
                color: `oklch(0.35 0.1 ${t.color})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 10,
              }}><Icon name={t.icon} size={16} /></div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={onClose}>{app.lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
          <button className="btn btn-primary" disabled={!name} onClick={() => onCreate({ name, template: sel })} style={{ opacity: name ? 1 : 0.4 }}>
            {app.lang === 'es' ? 'Crear y abrir' : 'Create & open'} <Icon name="arrow_right" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Flow canvas (visual nodes) ----
const FlowNode = ({ x, y, w = 180, title, subtitle, icon, selected, onSelect, tone = 'neutral' }) => {
  const tones = {
    neutral: { bg: 'var(--bg-card)', ic: 'var(--ink-3)' },
    accent:  { bg: 'var(--accent-soft)', ic: 'var(--accent-ink)' },
    ink:     { bg: 'var(--ink)', ic: 'var(--bg)', tx: 'var(--bg)' },
  };
  const tn = tones[tone];
  return (
    <div
      onClick={onSelect}
      style={{
        position: 'absolute', left: x, top: y, width: w,
        padding: '10px 12px',
        background: tn.bg,
        color: tn.tx || 'var(--ink)',
        border: '1px solid',
        borderColor: selected ? 'var(--accent)' : 'var(--line-strong)',
        borderRadius: 10,
        boxShadow: selected ? '0 0 0 3px var(--accent-soft), var(--shadow)' : 'var(--shadow-sm)',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      <div className="row gap-2" style={{ marginBottom: 2 }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: 'color-mix(in oklch, var(--ink) 8%, transparent)', color: tn.ic, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={12} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{title}</div>
      </div>
      {subtitle && <div style={{ fontSize: 11, color: tone === 'ink' ? 'oklch(0.7 0 0)' : 'var(--ink-3)', paddingLeft: 28 }}>{subtitle}</div>}
    </div>
  );
};

const FlowCanvas = ({ selected, setSelected }) => {
  return (
    <div className="grid-bg" style={{ position: 'relative', height: 520, overflow: 'hidden', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--line)' }}>
      {/* Edges */}
      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="100%" height="100%">
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-3)" />
          </marker>
        </defs>
        {[
          'M 150 70 C 230 70, 240 120, 320 120',
          'M 500 120 C 580 120, 590 70, 670 70',
          'M 500 120 C 580 120, 590 180, 670 180',
          'M 500 120 C 580 120, 590 280, 670 280',
          'M 850 70 C 930 70, 940 400, 500 400',
          'M 850 180 C 920 180, 920 400, 500 400',
          'M 850 280 C 900 280, 900 400, 500 400',
        ].map((d, i) => (
          <path key={i} d={d} stroke="var(--ink-3)" strokeWidth="1.4" fill="none" strokeDasharray={i > 3 ? '4 3' : ''} markerEnd="url(#arr)" opacity="0.7" />
        ))}
      </svg>

      <FlowNode x={30}  y={50}  w={140} title="Trigger"    subtitle="WhatsApp msg"   icon="bolt"     tone="accent" selected={selected === 'trigger'}  onSelect={() => setSelected('trigger')} />
      <FlowNode x={320} y={100} w={180} title="Clasificar intención" subtitle="7 ramas · gpt-4o" icon="grid" selected={selected === 'classify'} onSelect={() => setSelected('classify')} />
      <FlowNode x={670} y={50}  w={180} title="Buscar producto" subtitle="→ tool: catalog" icon="search" selected={selected === 'search'} onSelect={() => setSelected('search')} />
      <FlowNode x={670} y={160} w={180} title="Estado del pedido" subtitle="→ tool: orders_api" icon="folder" selected={selected === 'order'} onSelect={() => setSelected('order')} />
      <FlowNode x={670} y={260} w={180} title="Devolución" subtitle="→ human handoff" icon="plug" selected={selected === 'return'} onSelect={() => setSelected('return')} />
      <FlowNode x={320} y={390} w={180} title="Responder al usuario" subtitle="tono: cercano, es-ES" icon="bot" tone="ink" selected={selected === 'reply'} onSelect={() => setSelected('reply')} />

      {/* Toolbar */}
      <div style={{ position: 'absolute', top: 12, right: 12 }} className="row gap-1">
        {['+ Nodo', 'Auto-layout', 'Zoom 100%'].map(x => (
          <button key={x} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, background: 'var(--bg-card)' }}>{x}</button>
        ))}
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 10, color: 'var(--ink-3)' }} className="mono">
        6 NODOS · 7 ARISTAS · VALIDADO ✓
      </div>
    </div>
  );
};

const Inspector = ({ selected }) => {
  const app = useApp();
  const titles = {
    trigger: 'WhatsApp Trigger',
    classify: 'Clasificar intención',
    search: 'Buscar producto',
    order: 'Estado del pedido',
    return: 'Devolución',
    reply: 'Responder al usuario',
  };
  return (
    <div className="card" style={{ padding: 20, height: 520, overflowY: 'auto' }}>
      <div className="caps" style={{ marginBottom: 8 }}>{app.lang === 'es' ? 'Inspector' : 'Inspector'}</div>
      <h3 className="display" style={{ fontSize: 20, margin: '0 0 20px', fontWeight: 400 }}>
        {titles[selected] || 'Clasificar intención'}
      </h3>
      <div className="col gap-4">
        <div>
          <label className="label">{app.lang === 'es' ? 'Prompt del sistema' : 'System prompt'}</label>
          <textarea className="textarea" defaultValue={`Eres Lucía, asistente de Moda Verano SL. Habla en español de España, cercana y breve. Tu objetivo: ayudar con catálogo, pedidos y devoluciones. Si no estás 100% segura, pasa a un humano. Nunca inventes precios ni stock.`} style={{ minHeight: 110, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
        <div>
          <label className="label">{app.lang === 'es' ? 'Modelo' : 'Model'}</label>
          <div className="row gap-2">
            {['gpt-4o', 'claude-3.5', 'llama-3.1'].map((m, i) => (
              <button key={m} className="btn" style={{
                flex: 1, justifyContent: 'center', fontSize: 12,
                border: '1px solid',
                borderColor: i === 0 ? 'var(--ink)' : 'var(--line-strong)',
                background: i === 0 ? 'var(--bg-elev)' : 'var(--bg-card)',
              }}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">{app.lang === 'es' ? 'Temperatura' : 'Temperature'}</label>
          <div className="row gap-3">
            <input type="range" min="0" max="1" step="0.1" defaultValue="0.3" style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>0.3</span>
          </div>
        </div>
        <div>
          <label className="label">{app.lang === 'es' ? 'Herramientas conectadas' : 'Connected tools'}</label>
          <div className="col gap-2">
            {[
              { n: 'catalog.search()', d: 'PostgreSQL · 1,240 SKU' },
              { n: 'orders.get()',     d: 'Shopify API' },
              { n: 'handoff.human()',  d: 'Slack #soporte' },
            ].map(t => (
              <div key={t.n} className="row between" style={{ padding: '8px 10px', background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--line)' }}>
                <div>
                  <div className="mono" style={{ fontSize: 12 }}>{t.n}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.d}</div>
                </div>
                <span className="badge"><span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent)' }} />ok</span>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ justifyContent: 'center', fontSize: 12 }}><Icon name="plus" size={11} /> {app.lang === 'es' ? 'Añadir herramienta' : 'Add tool'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const TestPanel = ({ open, onClose, agentName }) => {
  const app = useApp();
  const [msgs, setMsgs] = React.useState([
    { r: 'system', t: 'Agente "' + (agentName || 'Lucía') + '" cargado · WhatsApp simulado' },
    { r: 'user',   t: '¿Tenéis la sudadera crema en L?' },
    { r: 'agent',  t: 'Sí, tenemos L en stock (3 unidades). ¿Te la guardo y te la envío a tu dirección habitual?', meta: '0.9s · 142 tok · 0,003€' },
  ]);
  const [input, setInput] = React.useState('');
  const send = async () => {
    if (!input.trim()) return;
    const user = { r: 'user', t: input };
    setMsgs(m => [...m, user, { r: 'thinking' }]);
    const userMsg = input;
    setInput('');
    try {
      const reply = await window.claude.complete(
        `Eres ${agentName || 'Lucía'}, asistente de una tienda de moda online en español. Sé breve, cercana y útil. Máximo 2 frases. Usuario: ${userMsg}`
      );
      setMsgs(m => [...m.slice(0, -1), { r: 'agent', t: reply.trim(), meta: '1.1s · ~140 tok · 0,003€' }]);
    } catch (e) {
      setMsgs(m => [...m.slice(0, -1), { r: 'agent', t: 'Uy, ha habido un problema conectando. Prueba de nuevo en un momento.', meta: 'fallback' }]);
    }
  };
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
      background: 'var(--bg-card)',
      borderLeft: '1px solid var(--line-strong)',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 50,
      display: 'flex', flexDirection: 'column',
    }}>
      <div className="row between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="caps">{app.lang === 'es' ? 'Probar agente' : 'Test agent'}</div>
          <div className="row gap-2" style={{ marginTop: 2, fontSize: 13, fontWeight: 500 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--accent)' }} className="pulse" />
            {agentName || 'Lucía'} · preview
          </div>
        </div>
        <button onClick={onClose} style={{ fontSize: 18, color: 'var(--ink-3)' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.map((m, i) => {
          if (m.r === 'system') return <div key={i} className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', textAlign: 'center', padding: 6 }}>— {m.t} —</div>;
          if (m.r === 'thinking') return (
            <div key={i} style={{ alignSelf: 'flex-start', padding: '10px 14px', background: 'var(--bg-elev)', borderRadius: '14px 14px 14px 4px', border: '1px solid var(--line)' }} className="row gap-1 pulse">
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--ink-3)' }} />
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--ink-3)' }} />
              <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--ink-3)' }} />
            </div>
          );
          return (
            <div key={i} className="fade-in" style={{ alignSelf: m.r === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{
                padding: '10px 14px',
                background: m.r === 'user' ? 'var(--ink)' : 'var(--bg-elev)',
                color: m.r === 'user' ? 'var(--bg)' : 'var(--ink)',
                borderRadius: m.r === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                border: m.r === 'user' ? 'none' : '1px solid var(--line)',
                fontSize: 13,
              }}>{m.t}</div>
              {m.meta && <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 4, paddingLeft: 4 }}>{m.meta}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
        <div className="row gap-2">
          <input
            className="input"
            placeholder={app.lang === 'es' ? 'Escribe un mensaje…' : 'Write a message…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          <button className="btn btn-accent" onClick={send}><Icon name="arrow_right" size={14} /></button>
        </div>
      </div>
    </div>
  );
};

const Builder = ({ onNav, agentId, agentName: initName }) => {
  const app = useApp();
  const t = I18N[app.lang];
  const [tab, setTab] = React.useState('flow');
  const [selected, setSelected] = React.useState('classify');
  const [testOpen, setTestOpen] = React.useState(false);
  const meta = SAMPLE_AGENTS.find(a => a.id === agentId);
  const agentName = initName || meta?.name || 'Lucía';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ padding: '14px 24px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }} className="row between">
        <div className="row gap-4">
          <button className="btn btn-link" onClick={() => onNav('dashboard')}>{t.builder_back}</button>
          <div style={{ height: 20, width: 1, background: 'var(--line)' }} />
          <div className="row gap-3">
            <div style={{ width: 28, height: 28, borderRadius: 6, background: `oklch(0.92 0.06 ${meta?.color || 120})`, color: `oklch(0.35 0.1 ${meta?.color || 120})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 14 }}>
              {agentName[0]}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{agentName}</div>
              <div className="row gap-2" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                <span className="mono">v0.4 · borrador</span>
                <span>·</span>
                <span>{meta?.client || 'Nuevo cliente'}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="row gap-2">
          <div className="tweaks-seg" style={{ background: 'var(--bg-elev)' }}>
            {['flow', 'knowledge', 'tools', 'deploy'].map(k => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {t['builder_tab_' + k]}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 6px' }} />
          <button className="btn btn-ghost">{t.builder_save}</button>
          <button className="btn btn-ghost" onClick={() => setTestOpen(true)}><Icon name="play" size={12} /> {t.builder_test}</button>
          <button className="btn btn-primary">{t.builder_publish} <Icon name="arrow_up_right" size={12} /></button>
        </div>
      </header>

      <main style={{ padding: 24, marginRight: testOpen ? 420 : 0, transition: 'margin 0.2s ease' }}>
        {tab === 'flow' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
            <FlowCanvas selected={selected} setSelected={setSelected} />
            <Inspector selected={selected} />
          </div>
        )}
        {tab === 'knowledge' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
            <div className="card" style={{ padding: 24, minHeight: 520 }}>
              <h3 className="display" style={{ fontSize: 24, margin: '0 0 4px', fontWeight: 400 }}>{app.lang === 'es' ? 'Base de conocimiento' : 'Knowledge base'}</h3>
              <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 20px' }}>{app.lang === 'es' ? '3 fuentes conectadas · 284 chunks indexados · sincronizado hace 4 min' : '3 connected sources · 284 chunks · synced 4 min ago'}</p>
              {[
                { n: 'catalogo-verano-2026.pdf', d: '2,4 MB · PDF · 48 chunks', s: 'indexado' },
                { n: 'politicas-devolucion.md',  d: '4 KB · Markdown · 6 chunks', s: 'indexado' },
                { n: 'shopify/products',         d: 'API sync · 1,240 productos', s: 'en vivo' },
                { n: 'faq-verano.csv',           d: '82 KB · CSV · 230 chunks', s: 'indexado' },
              ].map(f => (
                <div key={f.n} className="row between" style={{ padding: '14px 0', borderTop: '1px solid var(--line)' }}>
                  <div className="row gap-3">
                    <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                      <Icon name="folder" size={14} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{f.n}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }} className="mono">{f.d}</div>
                    </div>
                  </div>
                  <span className="badge"><span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent)' }} />{f.s}</span>
                </div>
              ))}
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
                <Icon name="plus" size={12} /> {app.lang === 'es' ? 'Subir documento' : 'Upload document'}
              </button>
            </div>
            <div className="card" style={{ padding: 20, height: 'fit-content' }}>
              <div className="caps" style={{ marginBottom: 8 }}>{app.lang === 'es' ? 'Calidad de indexado' : 'Index quality'}</div>
              <div className="display" style={{ fontSize: 42, lineHeight: 1, marginBottom: 8 }}>94<span style={{ fontSize: 24 }}>%</span></div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0 }}>{app.lang === 'es' ? '12 chunks tienen baja cobertura. Revisa y reetiqueta.' : '12 chunks have low coverage. Review and re-tag.'}</p>
              <div className="hr" style={{ margin: '20px 0' }} />
              <div className="caps" style={{ marginBottom: 8 }}>{app.lang === 'es' ? 'Consultas top' : 'Top queries'}</div>
              <div className="col gap-2">
                {['devolución', 'talla', 'envío península', 'cambio de pedido'].map(q => (
                  <div key={q} className="row between" style={{ fontSize: 12 }}>
                    <span>{q}</span><span className="mono" style={{ color: 'var(--ink-3)' }}>{Math.floor(Math.random() * 200 + 30)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'tools' && (
          <div className="card" style={{ padding: 24 }}>
            <h3 className="display" style={{ fontSize: 24, margin: '0 0 4px', fontWeight: 400 }}>{app.lang === 'es' ? 'Herramientas' : 'Tools'}</h3>
            <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 20px' }}>{app.lang === 'es' ? 'APIs y funciones que el agente puede llamar.' : 'APIs and functions the agent can call.'}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { n: 'Shopify Orders', d: 'GET /orders/:id · POST /orders', s: 'conectado' },
                { n: 'HubSpot CRM',    d: 'contacts · deals · tickets',     s: 'conectado' },
                { n: 'Stripe',         d: 'Cobros y reembolsos',            s: 'conectado' },
                { n: 'WhatsApp Business', d: 'Envío y plantillas',          s: 'conectado' },
                { n: 'Google Calendar',d: 'events.insert',                  s: 'desconectado' },
                { n: 'Webhook custom', d: 'POST https://…',                 s: 'conectado' },
              ].map(t => (
                <div key={t.n} className="card" style={{ padding: 16 }}>
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <Icon name="plug" size={16} />
                    <span className="badge" style={{ color: t.s === 'conectado' ? 'var(--accent-ink)' : 'var(--ink-3)' }}>
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: t.s === 'conectado' ? 'var(--accent)' : 'var(--ink-4)' }} />
                      {t.s}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.n}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }} className="mono">{t.d}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'deploy' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { n: 'Web Widget',     d: 'Embed de 1 línea en el sitio del cliente', c: '<scr' + 'ipt src="https://cdn.ordy.ai/w/ag_01.js"></scr' + 'ipt>', s: 'activo' },
              { n: 'WhatsApp Business', d: 'Número verificado · Meta Cloud API',    c: '+34 600 123 456 · plantillas aprobadas ✓',            s: 'activo' },
              { n: 'API REST',       d: 'Integra el agente en tu propio stack',     c: 'POST https://api.ordy.ai/v1/ag_01/chat',              s: 'activo' },
              { n: 'Slack',          d: 'Agente como bot interno',                  c: '@lucia-moda-verano',                                  s: 'pendiente' },
            ].map(d => (
              <div key={d.n} className="card" style={{ padding: 20 }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <h4 className="display" style={{ fontSize: 20, margin: 0, fontWeight: 400 }}>{d.n}</h4>
                  <span className="badge badge-accent">{d.s}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 12px' }}>{d.d}</p>
                <div className="mono" style={{ fontSize: 11, background: 'var(--bg-elev)', padding: 10, borderRadius: 6, border: '1px solid var(--line)', color: 'var(--ink-2)' }}>
                  {d.c}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <TestPanel open={testOpen} onClose={() => setTestOpen(false)} agentName={agentName} />
    </div>
  );
};

window.Builder = Builder;
window.NewAgentModal = NewAgentModal;
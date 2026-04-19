/* Ordy-AgencIA — Landing (clean bold centered style) */

const { useState: useStateL, useEffect: useEffectL } = React;

const Nav = ({ onNav }) => {
  const app = useApp();
  const t = I18N[app.lang];
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'color-mix(in oklch, var(--bg) 92%, transparent)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '16px 28px' }} className="row between">
        <div className="row gap-8">
          <Logo />
          <div className="row gap-6" style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
            <a href="#product">{t.nav_product}</a>
            <a href="#usecases">{t.nav_usecases}</a>
            <a href="#">{app.lang === 'es' ? 'Recursos' : 'Resources'}</a>
            <a href="#">Enterprise</a>
            <a href="#pricing">{t.nav_pricing}</a>
          </div>
        </div>
        <div className="row gap-3">
          <button className="btn btn-link" onClick={() => onNav('signup')}>{t.nav_login}</button>
          <button className="btn btn-ghost" onClick={() => onNav('signup')}>
            {app.lang === 'es' ? 'Reservar demo' : 'Book a demo'}
          </button>
          <button className="btn btn-primary" onClick={() => onNav('signup')}>
            {t.nav_cta}
          </button>
        </div>
      </div>
    </nav>
  );
};

const NICHE_TABS = [
  { k: 'ecom',    es: 'E-commerce',        en: 'E-commerce',       prompt: 'un agente de ventas para mi tienda Shopify que responda por WhatsApp sobre stock, tallas y envíos' },
  { k: 'support', es: 'Atención al cliente', en: 'Customer support', prompt: 'un agente de soporte 24/7 para mi SaaS, con acceso a mi base de conocimiento y capaz de crear tickets' },
  { k: 'sales',   es: 'CRM y ventas',       en: 'Sales CRM',         prompt: 'un SDR virtual que califique leads entrantes, los enriquezca con datos y agende demos en HubSpot' },
  { k: 'health',  es: 'Clínicas',           en: 'Clinics',           prompt: 'un agente para mi clínica dental que agende citas, confirme por SMS y haga triaje básico' },
  { k: 'legal',   es: 'Despachos legales',  en: 'Legal',             prompt: 'un agente para mi bufete que haga la primera consulta, califique el caso y me pase los prometedores' },
  { k: 'real',    es: 'Inmobiliaria',       en: 'Real estate',       prompt: 'un agente que capte leads de mis anuncios de Idealista, les mande propiedades y agende visitas' },
  { k: 'edu',     es: 'Academias',          en: 'Academies',         prompt: 'un tutor que responda dudas de mis alumnos sobre el temario, 24/7, con mi propia voz pedagógica' },
];

const PromptHero = ({ onNav }) => {
  const app = useApp();
  const [tab, setTab] = useStateL('ecom');
  const [text, setText] = useStateL('');
  const current = NICHE_TABS.find(t => t.k === tab);
  const [phIdx, setPhIdx] = useStateL(0);
  const [typed, setTyped] = useStateL('');

  // Auto-type placeholder when tab changes
  useEffectL(() => {
    const target = current.prompt;
    setTyped('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [tab]);

  return (
    <section style={{ padding: '72px 28px 96px', position: 'relative', overflow: 'hidden' }}>
      {/* Subtle grid bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at 50% 30%, black 10%, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black 10%, transparent 70%)',
        opacity: 0.5,
      }} />

      <div style={{ maxWidth: 1040, margin: '0 auto', position: 'relative', textAlign: 'center' }}>
        {/* New pill */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--ink)', color: 'var(--bg)', padding: '6px 6px 6px 14px', borderRadius: 999, fontSize: 13, marginBottom: 36 }}>
          <span style={{ background: 'var(--accent)', color: 'var(--ink)', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
            ✦ {app.lang === 'es' ? 'Nuevo' : 'New'}
          </span>
          <span style={{ opacity: 0.9 }}>
            {app.lang === 'es' ? 'La primera plataforma para agencias de agentes IA' : 'The first platform for AI-agent agencies'}
          </span>
          <Icon name="arrow_right" size={12} />
        </div>

        {/* Mega headline */}
        <h1 style={{
          fontSize: 'clamp(48px, 8vw, 104px)',
          lineHeight: 0.95,
          letterSpacing: '-0.035em',
          margin: '0 0 32px',
          fontWeight: 700,
          fontFamily: 'var(--font-ui)',
        }}>
          {app.lang === 'es' ? (
            <>Construye agentes IA<br />— <span style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)', fontWeight: 400 }}>que de verdad venden.</span></>
          ) : (
            <>Build AI agents<br />— <span style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)', fontWeight: 400 }}>that actually convert.</span></>
          )}
        </h1>

        <p style={{ fontSize: 18, color: 'var(--ink-2)', margin: '0 0 40px', fontWeight: 500 }}>
          {app.lang === 'es'
            ? 'Describe el agente que tu cliente necesita. Nosotros lo montamos.'
            : 'Describe the agent your client needs. We build it.'}
        </p>

        {/* Pill tabs */}
        <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
          {NICHE_TABS.map(nt => (
            <button key={nt.k}
              onClick={() => setTab(nt.k)}
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid',
                borderColor: tab === nt.k ? 'var(--ink)' : 'var(--line-strong)',
                background: tab === nt.k ? 'var(--ink)' : 'var(--bg-card)',
                color: tab === nt.k ? 'var(--bg)' : 'var(--ink-2)',
                transition: 'all 0.15s ease',
              }}
            >
              {app.lang === 'es' ? nt.es : nt.en}
            </button>
          ))}
        </div>

        {/* Prompt box */}
        <div className="neon-wrap" style={{
          maxWidth: 720, margin: '0 auto',
          borderRadius: 22,
          position: 'relative',
          padding: 2,
          '--neon-h1': app.accentH,
          '--neon-h2': (app.accentH + 80) % 360,
          '--neon-h3': (app.accentH + 180) % 360,
        }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 20,
            padding: 20,
            position: 'relative',
            zIndex: 1,
          }}>
          <textarea
            className="textarea"
            placeholder={(app.lang === 'es' ? 'Descríbelo como si se lo dijeras a un colega… ej: ' : 'Describe it like you would to a teammate… e.g. ') + typed}
            value={text}
            onChange={e => setText(e.target.value)}
            style={{
              width: '100%',
              minHeight: 100,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              resize: 'none',
              fontSize: 16,
              fontFamily: 'var(--font-ui)',
              color: 'var(--ink)',
              lineHeight: 1.5,
            }}
          />
          <div className="row between" style={{ marginTop: 4 }}>
            <div className="row gap-2">
              <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12, borderRadius: 999 }}>
                <Icon name="spark" size={12} /> {app.lang === 'es' ? 'Mejorar prompt' : 'Improve prompt'}
              </button>
              <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12, borderRadius: 999 }}>
                <Icon name="plug" size={12} /> {app.lang === 'es' ? 'Conectar datos' : 'Connect data'}
              </button>
            </div>
            <button className="btn btn-primary" onClick={() => onNav('signup')} style={{ borderRadius: 999, padding: '10px 18px' }}>
              {app.lang === 'es' ? 'Construir' : 'Build'} <Icon name="arrow_right" size={12} />
            </button>
          </div>
          </div>
        </div>

        <div style={{ marginTop: 24, fontSize: 13, color: 'var(--ink-3)' }}>
          {app.lang === 'es' ? 'Sin tarjeta · 14 días · Despliegue en WhatsApp, Web o API' : 'No card · 14 days · Deploy to WhatsApp, Web or API'}
        </div>
      </div>
    </section>
  );
};

const LogoStrip = () => {
  const app = useApp();
  const logos = ['HELIX', 'mirador', 'NORTE·CO', 'Parábola', 'flan', 'KAURA', 'quercus', 'oksana'];
  return (
    <section style={{ padding: '32px 28px 64px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-3)', marginBottom: 24 }}>
          {app.lang === 'es' ? '+ 860 agencias ya lo usan' : '+ 860 agencies already use it'}
        </div>
        <div className="row" style={{ gap: 56, justifyContent: 'center', flexWrap: 'wrap', color: 'var(--ink-3)', fontSize: 22, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
          {logos.map((l, i) => (
            <span key={i} style={{ opacity: 0.55, fontStyle: i % 2 === 0 ? 'normal' : 'italic' }}>{l}</span>
          ))}
        </div>
      </div>
    </section>
  );
};

// Feature section: big screenshot + small copy
const FeatureShowcase = () => {
  const app = useApp();
  const [active, setActive] = useStateL(0);
  const features = [
    {
      tag: app.lang === 'es' ? 'Builder visual' : 'Visual builder',
      title: app.lang === 'es' ? 'Diseña flujos arrastrando. Sin código.' : 'Design flows by dragging. No code.',
      desc: app.lang === 'es' ? 'Prompts, herramientas, memoria y guardrails en un solo canvas. Lo que ves es lo que se despliega.' : 'Prompts, tools, memory and guardrails on one canvas. What you see is what ships.',
    },
    {
      tag: app.lang === 'es' ? 'Multi-cliente' : 'Multi-tenant',
      title: app.lang === 'es' ? 'Un workspace por cliente, facturación separada.' : 'One workspace per client, separate billing.',
      desc: app.lang === 'es' ? 'Datos aislados, permisos granulares y branding propio. Tus clientes nunca ven nuestra marca.' : 'Isolated data, granular permissions, and your own branding. Clients never see ours.',
    },
    {
      tag: app.lang === 'es' ? 'Despliegue 1-click' : '1-click deploy',
      title: app.lang === 'es' ? 'WhatsApp, Web, API. En 30 segundos.' : 'WhatsApp, Web, API. In 30 seconds.',
      desc: app.lang === 'es' ? 'Todos los canales que usan tus clientes, ya verificados y aprobados por Meta.' : 'Every channel your clients use — verified and approved with Meta.',
    },
  ];
  return (
    <section id="product" style={{ padding: '96px 28px', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ fontSize: 13, color: 'var(--accent-ink)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
            {app.lang === 'es' ? 'Una plataforma. Todo el stack.' : 'One platform. The whole stack.'}
          </div>
          <h2 style={{ fontSize: 'clamp(36px, 5vw, 68px)', letterSpacing: '-0.03em', fontWeight: 700, margin: 0, lineHeight: 1 }}>
            {app.lang === 'es' ? 'Lo que toda agencia' : 'Everything an agency'}<br />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontStyle: 'italic' }}>
              {app.lang === 'es' ? 'necesita desde el día uno.' : 'needs from day one.'}
            </span>
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 48, alignItems: 'center' }}>
          {/* Selector */}
          <div className="col gap-3">
            {features.map((f, i) => (
              <button key={i} onClick={() => setActive(i)} style={{
                textAlign: 'left',
                padding: 20,
                borderRadius: 14,
                border: '1px solid',
                borderColor: active === i ? 'var(--ink)' : 'var(--line)',
                background: active === i ? 'var(--bg-card)' : 'transparent',
                boxShadow: active === i ? 'var(--shadow)' : 'none',
              }}>
                <div className="caps" style={{ color: active === i ? 'var(--accent-ink)' : 'var(--ink-3)', marginBottom: 8 }}>{f.tag}</div>
                <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: active === i ? 6 : 0, color: 'var(--ink)' }}>{f.title}</div>
                {active === i && <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>{f.desc}</div>}
              </button>
            ))}
          </div>
          {/* Product preview */}
          <div style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 18,
            padding: 8,
            boxShadow: 'var(--shadow-lg)',
            aspectRatio: '4/3',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div className="grid-bg" style={{ width: '100%', height: '100%', borderRadius: 12, background: 'var(--bg-card)', position: 'relative' }}>
              {active === 0 && (
                <svg viewBox="0 0 400 300" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <defs><marker id="arrsc" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="var(--ink-3)" /></marker></defs>
                  {['M 70 80 C 120 80, 130 110, 180 110','M 240 110 C 290 110, 300 80, 340 80','M 240 110 C 290 110, 300 170, 340 170','M 340 80 C 360 80, 360 230, 240 230','M 340 170 C 355 170, 355 230, 240 230'].map((d,i)=>(
                    <path key={i} d={d} stroke="var(--ink-4)" strokeWidth="1.2" fill="none" markerEnd="url(#arrsc)" />
                  ))}
                  {[
                    {x:20,y:60,w:100,t:'Trigger',s:'WhatsApp',tone:'a'},
                    {x:180,y:90,w:110,t:'Clasificar',s:'7 ramas',tone:'n'},
                    {x:340,y:60,w:80,t:'Catálogo',s:'tool',tone:'n'},
                    {x:340,y:150,w:80,t:'Pedidos',s:'API',tone:'n'},
                    {x:180,y:210,w:110,t:'Responder',s:'es-ES',tone:'i'},
                  ].map((n,i)=>(
                    <g key={i}>
                      <rect x={n.x} y={n.y} width={n.w} height="40" rx="6" fill={n.tone==='a'?'var(--accent-soft)':n.tone==='i'?'var(--ink)':'var(--bg-card)'} stroke="var(--line-strong)"/>
                      <text x={n.x+10} y={n.y+16} fontSize="10" fill={n.tone==='i'?'var(--bg)':'var(--ink)'} fontWeight="600">{n.t}</text>
                      <text x={n.x+10} y={n.y+30} fontSize="8" fill={n.tone==='i'?'oklch(0.7 0 0)':'var(--ink-3)'}>{n.s}</text>
                    </g>
                  ))}
                </svg>
              )}
              {active === 1 && (
                <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[{n:'Moda Verano',c:120,a:4},{n:'Clínica Nova',c:200,a:2},{n:'Bufete Morán',c:60,a:1},{n:'InmoSur',c:25,a:3}].map(c => (
                    <div key={c.n} style={{ padding: 12, background: 'var(--bg-card)', border: '1px solid var(--line)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: `oklch(0.92 0.06 ${c.c})`, color: `oklch(0.35 0.1 ${c.c})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 14 }}>{c.n[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{c.n}</div>
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{c.a} agentes · workspace aislado</div>
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 8px', background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderRadius: 999 }}>activo</span>
                    </div>
                  ))}
                </div>
              )}
              {active === 2 && (
                <div style={{ padding: 24, height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[{n:'WhatsApp',s:'Business API · verificado'},{n:'Web Widget',s:'Embed 1 línea'},{n:'API REST',s:'api.ordy.ai/v1'},{n:'Slack',s:'Bot interno'}].map(d=>(
                    <div key={d.n} style={{ padding: 14, background: 'var(--bg-card)', border: '1px solid var(--line)', borderRadius: 10 }}>
                      <div className="row between" style={{ marginBottom: 8 }}>
                        <Icon name="plug" size={14} />
                        <span style={{ fontSize: 9, padding: '2px 6px', background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderRadius: 999 }}>listo</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{d.n}</div>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{d.s}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Stats = () => {
  const app = useApp();
  const t = I18N[app.lang];
  const stats = [
    { n: '12,400+', l: t.stat_agents },
    { n: '860',    l: t.stat_agencies },
    { n: '3.2M',   l: t.stat_convos },
    { n: '99.98%', l: t.stat_uptime },
  ];
  return (
    <section style={{ padding: '64px 28px', background: 'var(--ink)', color: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'oklch(0.28 0 0)' }}>
        {stats.map((s, i) => (
          <div key={i} style={{ padding: '24px 28px', background: 'var(--ink)' }}>
            <div style={{ fontSize: 52, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.03em' }}>{s.n}</div>
            <div style={{ fontSize: 12, color: 'oklch(0.7 0 0)', marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const UseCases = () => {
  const app = useApp();
  const cases = [
    { t: 'E-commerce', d: app.lang==='es'?'Ventas, stock, devoluciones por WhatsApp.':'Sales, stock, returns via WhatsApp.', c: 25 },
    { t: app.lang==='es'?'Salud':'Health', d: app.lang==='es'?'Citas, triaje, recordatorios GDPR.':'Appointments, triage, GDPR reminders.', c: 200 },
    { t: 'Legal', d: app.lang==='es'?'Consulta inicial, calificación, derivación.':'First consult, qualification, handoff.', c: 60 },
    { t: app.lang==='es'?'Educación':'Education', d: app.lang==='es'?'Tutorías 24/7 con tu temario.':'24/7 tutoring on your curriculum.', c: 320 },
    { t: app.lang==='es'?'Inmobiliaria':'Real estate', d: app.lang==='es'?'Captación, visitas, financiación.':'Lead capture, visits, financing.', c: 40 },
    { t: app.lang==='es'?'Hostelería':'Hospitality', d: app.lang==='es'?'Reservas, menús, fidelización.':'Reservations, menus, loyalty.', c: 140 },
    { t: app.lang==='es'?'Logística':'Logistics', d: app.lang==='es'?'Tracking, incidencias, WhatsApp.':'Tracking, incidents, WhatsApp.', c: 180 },
    { t: app.lang==='es'?'Finanzas':'Finance', d: app.lang==='es'?'KYC, onboarding, consultas.':'KYC, onboarding, product Q&A.', c: 240 },
  ];
  return (
    <section id="usecases" style={{ padding: '96px 28px', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div className="caps" style={{ color: 'var(--accent-ink)', marginBottom: 16 }}>
            {app.lang === 'es' ? 'Plantillas por nicho' : 'Templates by niche'}
          </div>
          <h2 style={{ fontSize: 'clamp(36px, 5vw, 68px)', letterSpacing: '-0.03em', fontWeight: 700, margin: 0, lineHeight: 1 }}>
            {app.lang === 'es' ? 'Agentes listos para' : 'Agents ready for'} <span style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontStyle: 'italic' }}>{app.lang === 'es' ? 'cada nicho.' : 'every niche.'}</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {cases.map((n, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)', border: '1px solid var(--line)', borderRadius: 14,
              padding: 20, minHeight: 160, display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ink)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `oklch(0.92 0.06 ${n.c})`, color: `oklch(0.35 0.1 ${n.c})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 'auto' }}>
                {n.t[0]}
              </div>
              <h4 style={{ fontSize: 18, fontWeight: 600, margin: '16px 0 4px', letterSpacing: '-0.01em' }}>{n.t}</h4>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0, lineHeight: 1.4 }}>{n.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Pricing = () => {
  const app = useApp();
  const plans = [
    { n: app.lang==='es'?'Starter':'Starter', p: '29', c: 'Hasta 3 agentes · 1,000 conv/mes · Web + WhatsApp', cta: app.lang==='es'?'Empezar gratis':'Start free' },
    { n: 'Agency', p: '99', c: 'Agentes ilimitados · 10 clientes · White-label · API', cta: app.lang==='es'?'Probar 14 días':'Try 14 days', highlight: true },
    { n: 'Enterprise', p: app.lang==='es'?'A medida':'Custom', c: 'SSO · SLA · DPA · Soporte dedicado', cta: app.lang==='es'?'Hablar con ventas':'Talk to sales' },
  ];
  return (
    <section id="pricing" style={{ padding: '96px 28px', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(36px, 5vw, 68px)', letterSpacing: '-0.03em', fontWeight: 700, margin: 0, lineHeight: 1 }}>
            {app.lang === 'es' ? 'Precios simples.' : 'Simple pricing.'} <span style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontStyle: 'italic' }}>{app.lang==='es'?'Sin sorpresas.':'No surprises.'}</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {plans.map(p => (
            <div key={p.n} style={{
              padding: 28, borderRadius: 18,
              background: p.highlight ? 'var(--ink)' : 'var(--bg-card)',
              color: p.highlight ? 'var(--bg)' : 'var(--ink)',
              border: '1px solid', borderColor: p.highlight ? 'var(--ink)' : 'var(--line)',
              position: 'relative',
            }}>
              {p.highlight && <span style={{ position: 'absolute', top: -10, right: 20, background: 'var(--accent)', color: 'var(--ink)', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{app.lang==='es'?'MÁS POPULAR':'MOST POPULAR'}</span>}
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{p.n}</div>
              <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 4 }}>
                {p.p.includes('medida') || p.p.includes('Custom') ? p.p : <>{p.p}€<span style={{ fontSize: 16, fontWeight: 500, color: p.highlight ? 'oklch(0.7 0 0)' : 'var(--ink-3)' }}>/mes</span></>}
              </div>
              <p style={{ fontSize: 13, color: p.highlight ? 'oklch(0.75 0 0)' : 'var(--ink-3)', margin: '12px 0 24px', minHeight: 50 }}>{p.c}</p>
              <button className={p.highlight ? 'btn btn-accent' : 'btn btn-primary'} style={{ width: '100%', justifyContent: 'center' }}>{p.cta}</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const CTA = ({ onNav }) => {
  const app = useApp();
  return (
    <section style={{ padding: '120px 28px', textAlign: 'center', borderTop: '1px solid var(--line)' }}>
      <h2 style={{ fontSize: 'clamp(48px, 7vw, 96px)', letterSpacing: '-0.035em', fontWeight: 700, margin: '0 0 24px', lineHeight: 1 }}>
        {app.lang === 'es' ? 'Tu próxima agencia' : 'Your next agency'}<br />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontStyle: 'italic' }}>{app.lang === 'es' ? 'empieza hoy.' : 'starts today.'}</span>
      </h2>
      <p style={{ fontSize: 18, color: 'var(--ink-2)', marginBottom: 32 }}>
        {app.lang === 'es' ? 'Gratis durante 14 días. Sin tarjeta.' : 'Free for 14 days. No card.'}
      </p>
      <div className="row gap-3" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={() => onNav('signup')} style={{ padding: '14px 24px', fontSize: 15 }}>
          {app.lang === 'es' ? 'Empezar gratis' : 'Start free'} <Icon name="arrow_right" size={14} />
        </button>
        <button className="btn btn-ghost" style={{ padding: '14px 24px', fontSize: 15 }}>
          {app.lang === 'es' ? 'Reservar demo' : 'Book a demo'}
        </button>
      </div>
    </section>
  );
};

const Footer = () => {
  const app = useApp();
  const t = I18N[app.lang];
  const cols = [
    { t: t.footer_product, items: ['Builder', 'Plantillas', 'White-label', 'API', 'Integraciones', 'Changelog'] },
    { t: t.footer_resources, items: ['Docs', 'Guías', 'Blog', 'Academia', 'Comunidad', 'Soporte'] },
    { t: t.footer_company, items: [app.lang==='es'?'Sobre nosotros':'About', 'Carreras', 'Prensa', 'Partners', app.lang==='es'?'Contacto':'Contact'] },
    { t: t.footer_legal, items: [app.lang==='es'?'Términos':'Terms', app.lang==='es'?'Privacidad':'Privacy', 'Cookies', 'GDPR', 'DPA', app.lang==='es'?'Seguridad':'Security'] },
  ];
  return (
    <footer style={{ padding: '64px 28px 32px', background: 'var(--bg-elev)', borderTop: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr repeat(4, 1fr)', gap: 48, marginBottom: 48 }}>
          <div>
            <Logo size={26} />
            <p style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 16, maxWidth: 260, lineHeight: 1.5 }}>{t.footer_tagline}</p>
          </div>
          {cols.map((c, i) => (
            <div key={i}>
              <div className="caps" style={{ marginBottom: 14 }}>{c.t}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {c.items.map(it => <li key={it} style={{ padding: '5px 0', fontSize: 13, color: 'var(--ink-2)' }}><a href="#">{it}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' }}>
          <div className="mono">© 2026 Ordy-AgencIA · Valencia / Madrid / Remoto</div>
          <span className="badge"><span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} /> All systems normal</span>
        </div>
      </div>
    </footer>
  );
};

const Landing = ({ onNav }) => (
  <div>
    <Nav onNav={onNav} />
    <PromptHero onNav={onNav} />
    <LogoStrip />
    <WaiterDemo />
    <FeatureShowcase />
    <Stats />
    <UseCases />
    <Pricing />
    <CTA onNav={onNav} />
    <Footer />
  </div>
);

window.Landing = Landing;